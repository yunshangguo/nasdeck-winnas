'use strict';
/* ============================================================
 * services.js — 真实终端 / Docker / HTTP 下载 / 媒体库扫描
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { loadJson, saveJson } = require('./store');
const { typeOf } = require('./files');
const { initMedia } = require('./media');

function decodeOut(buf) {
  const u = buf.toString('utf8');
  if (u.indexOf('\ufffd') >= 0) {
    try { return new TextDecoder('gbk').decode(buf); } catch (e) {}
    try { return new TextDecoder('gb18030').decode(buf); } catch (e) {}
  }
  return u;
}

/* ------------------------- 真实终端 ------------------------- */
function initTerminal() {
  function normalizeCwd(cwd, base) {
    let p = String(cwd || '').trim().replace(/^["']|["']$/g, '');
    if (!p) return base;
    if (process.platform === 'win32') p = p.replace(/\//g, '\\');
    const r = path.isAbsolute(p) ? path.resolve(p) : path.resolve(base, p);
    return r;
  }
  function exec(cmd, cwd) {
    return new Promise(resolve => {
      const raw = String(cmd || '').trim();
      if (!raw) return resolve({ out: '', cwd, code: 0 });
      const m = /^cd\s+(.+)$/i.exec(raw);
      if (m || /^cd$/i.test(raw)) {
        const target = m ? normalizeCwd(m[1], cwd) : (process.platform === 'win32' ? process.cwd() : os.homedir());
        try {
          if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error('目录不存在');
          return resolve({ out: '', cwd: target, code: 0 });
        } catch (e) { return resolve({ out: 'cd: ' + e.message + '\r\n', cwd, code: 1 }); }
      }
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const args = process.platform === 'win32' ? ['/d', '/s', '/c', raw] : ['-c', raw];
      let child;
      try { child = cp.spawn(shell, args, { cwd, windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { return resolve({ out: e.message + '\n', cwd, code: 1 }); }
      let out = '', err = '', n = 0, done = false;
      const cap = d => { n += d.length; if (n < 600000) out += decodeOut(d); };
      child.stdout.on('data', cap);
      child.stderr.on('data', d => { n += d.length; if (n < 600000) err += decodeOut(d); });
      const timer = setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch (e) {} finish('命令执行超时（30 秒）已终止\n', 124); } }, 30000);
      const finish = (extra, code) => {
        if (done && extra === undefined) return;
        done = true; clearTimeout(timer);
        resolve({ out: (out + err + (extra || '')).replace(/\r\n/g, '\n'), cwd, code });
      };
      child.on('error', e => finish(e.message + '\n', 1));
      child.on('close', code => finish(undefined, code));
    });
  }
  return { exec, normalizeCwd };
}

/* ------------------------- Docker CLI ------------------------- */
function initDocker() {
  function run(args, timeout = 12000) {
    return new Promise(resolve => {
      cp.execFile('docker', args, { timeout, maxBuffer: 6 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err) resolve({ ok: false, out: String(stdout || ''), err: String(stderr || err.message) });
        else resolve({ ok: true, out: String(stdout || ''), err: '' });
      });
    });
  }
  async function available() { const r = await run(['--version'], 6000); return r.ok; }
  function jsonLines(s) {
    const out = [];
    for (const l of String(s).split('\n')) {
      const t = l.trim(); if (!t) continue;
      try { out.push(JSON.parse(t)); } catch (e) {}
    }
    return out;
  }
  async function ps() {
    const r = await run(['ps', '-a', '--format', '{{json .}}']);
    if (!r.ok) return { available: false, containers: [], message: r.err || '未检测到 Docker' };
    const rows = jsonLines(r.out);
    return {
      available: true,
      containers: rows.map(x => ({
        id: x.ID || '', n: x.Names || x.ID || '', img: x.Image || '',
        st: /running/i.test(x.State || x.Status || '') ? 1 : 0,
        status: x.Status || x.State || '', port: (x.Ports || '').slice(0, 46) || '—',
        cpu: '—', mem: '—'
      }))
    };
  }
  async function images() {
    const r = await run(['images', '--format', '{{json .}}']);
    if (!r.ok) return [];
    return jsonLines(r.out).map(x => ({ repo: x.Repository || '', tag: x.Tag || '', id: x.ID || '', size: x.Size || '', created: x.CreatedSince || '' }));
  }
  async function action(id, act) {
    const allow = { start: ['start'], stop: ['stop'], restart: ['restart'], pause: ['pause'], unpause: ['unpause'], remove: ['rm', '-f'], logs: ['logs', '--tail', '80'] };
    if (!allow[act]) throw new Error('不支持的操作: ' + act);
    if (!/^[\w.\-]+$/.test(String(id))) throw new Error('非法容器 ID');
    const r = await run(allow[act].concat([String(id)]), 20000);
    return { ok: r.ok, out: (r.out || r.err).slice(0, 12000) };
  }
  return { available, ps, images, action };
}

/* ------------------------- 真实 HTTP(S) 下载 ------------------------- */
function initDownloads(dataDir, emit) {
  const dir = path.join(dataDir, 'downloads');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dataDir, 'downloads.json');
  let tasks = loadJson(file, []);
  if (!Array.isArray(tasks)) tasks = [];
  const active = new Map();
  const persist = () => { try { saveJson(file, tasks.filter(t => t.st !== 1)); } catch (e) {} };

  function safeName(n) { return String(n || 'download.bin').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || 'download.bin'; }
  function snapshot() {
    return tasks.map(t => ({
      id: t.id, n: t.n, sz: t.total ? fmt(t.total) : '—', p: t.total ? Math.min(100, Math.round(t.got / t.total * 100)) : 0,
      sp: t.speed ? fmt(t.speed) + '/s' : '0 B/s', st: t.st, url: t.url, err: t.err || '', path: t.path || ''
    }));
  }
  function fmt(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; }
  function push() { try { emit('downloads', snapshot()); } catch (e) {} }

  function start(t, resume) {
    if (active.has(t.id)) return;
    let u;
    try { u = new URL(t.url); } catch (e) { t.st = 3; t.err = 'URL 无效'; push(); return; }
    const mod = u.protocol === 'https:' ? https : http;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') { t.st = 3; t.err = '仅支持 HTTP / HTTPS'; push(); return; }
    const target = path.join(dir, safeName(t.n));
    const part = target + '.part';
    const headers = { 'User-Agent': 'NasDeck-Web/1.0' };
    let offset = 0;
    if (resume && fs.existsSync(part)) { offset = fs.statSync(part).size; if (offset) headers.Range = 'bytes=' + offset + '-'; }
    t.st = 1; t.err = ''; t.got = offset; t.lastGot = offset; t.speed = 0; t.path = target;
    const req = mod.get(u, { headers }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); t.url = new URL(res.headers.location, u).href;
        active.delete(t.id); start(t, false); return;
      }
      if (res.statusCode >= 400) {
        res.resume(); t.st = 3; t.err = 'HTTP ' + res.statusCode; active.delete(t.id); push(); return;
      }
      if (!t.total || (!offset && res.headers['content-length'])) t.total = (offset ? offset : 0) + Number(res.headers['content-length'] || 0);
      const ws = fs.createWriteStream(part, { flags: offset ? 'a' : 'w' });
      res.pipe(ws);
      const rec = { req, res, ws }; active.set(t.id, rec);
      res.on('data', c => { t.got += c.length; });
      ws.on('finish', () => {
        active.delete(t.id);
        try {
          if (fs.existsSync(target)) fs.unlinkSync(target);
          fs.renameSync(part, target);
          t.st = 2; t.got = t.total || fs.statSync(target).size; t.speed = 0; t.path = target;
        } catch (e) { t.st = 3; t.err = e.message; }
        push(); persist();
      });
      ws.on('error', e => { active.delete(t.id); t.st = 3; t.err = e.message; push(); });
    });
    req.on('error', e => { active.delete(t.id); t.st = 3; t.err = e.message; push(); });
    req.setTimeout(30000, () => { try { req.destroy(new Error('连接超时')); } catch (e) {} });
    push();
  }
  function add(url, name) {
    url = String(url || '').trim();
    if (/^(magnet:|bt:)/i.test(url) || /\.torrent$/i.test(url)) throw new Error('BT / 磁力链接需要额外的 BT 引擎，当前仅支持 HTTP / HTTPS 直链');
    let n = name;
    if (!n) { try { n = decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'download.bin'; } catch (e) { n = 'download.bin'; } }
    const t = { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), url, n: safeName(n), total: 0, got: 0, st: 0, speed: 0, path: '' };
    tasks.unshift(t); start(t, false);
    return snapshot();
  }
  function action(id, act) {
    const t = tasks.find(x => x.id === id);
    if (!t) throw new Error('任务不存在');
    if (act === 'remove') {
      const a = active.get(id); if (a) { try { a.req.destroy(); } catch (e) {} active.delete(id); }
      for (const p of [t.path, t.path + '.part']) { if (p) try { fs.rmSync(p, { force: true }); } catch (e) {} }
      tasks = tasks.filter(x => x.id !== id); persist(); push(); return snapshot();
    }
    if (act === 'pause' || act === 'stop') {
      const a = active.get(id); if (a) { try { a.req.destroy(); a.ws.end(); } catch (e) {} active.delete(id); }
      t.st = 0; t.speed = 0; push(); return snapshot();
    }
    if (act === 'resume' || act === 'start') { t.st = 0; start(t, true); return snapshot(); }
    throw new Error('不支持的操作');
  }
  // 每秒计算真实速度
  setInterval(() => {
    let any = false;
    for (const t of tasks) {
      if (t.st !== 1) continue;
      const d = t.got - (t.lastGot || 0);
      t.speed = Math.max(0, d); t.lastGot = t.got; any = true;
    }
    if (any) push();
  }, 1000);
  // 恢复上次未完成的任务
  for (const t of tasks) if (t.st === 1) { t.st = 0; start(t, true); }
  return { snapshot, add, action, get tasks() { return tasks; } };
}

/* 真实媒体库已拆到 lib/media.js：可选择媒体文件夹、读取 EXIF / ID3 /
 * MP4 时长 / 内嵌封面 / 字幕 / 歌词。这里保留同一导出名 initMedia，
 * server.js 的 require 与 bootstrap 调用完全不用改。 */

module.exports = { initTerminal, initDocker, initDownloads, initMedia, decodeOut };
