'use strict';
/* ============================================================
 * extras.js — 真实 HBS 备份（robocopy / 计划任务）与 BT 下载引擎（aria2）
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const http = require('http');
const { loadJson, saveJson } = require('./store');

function fmt(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function decode(b) {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(String(b || ''));
  const u = buf.toString('utf8');
  if (u.indexOf('\ufffd') >= 0) { try { return new TextDecoder('gbk').decode(buf); } catch (e) {} }
  return u;
}

/* ------------------------- BackupDeck 真实备份 ------------------------- */
function initBackups(dataDir, emit, addLog, addNoti) {
  const file = path.join(dataDir, 'backups.json');
  let jobs = loadJson(file, []);
  if (!Array.isArray(jobs)) jobs = [];
  const running = new Map();
  const persist = () => { try { saveJson(file, jobs); } catch (e) {} };
  const push = () => { try { emit('backups', { jobs: snapshot() }); } catch (e) {} };
  function snapshot() {
    return jobs.map(j => ({
      id: j.id, n: j.n, src: j.src, dst: j.dst, mode: j.mode || 'incremental',
      st: j.st, p: j.p || 0, last: j.last || '—', size: j.size || '—',
      files: j.files || 0, err: j.err || '', schedule: j.schedule || '', log: (j.log || '').slice(-1600)
    }));
  }
  function validDir(p) {
    if (!p || typeof p !== 'string' || p.length > 250) return false;
    if (!/^[A-Za-z]:[\\/]/.test(p) && !p.startsWith('/')) return false;
    return true;
  }
  function create(o) {
    const src = String(o.src || '').trim(), dst = String(o.dst || '').trim();
    if (!validDir(src) || !validDir(dst)) return { ok: false, error: '需要本机绝对路径，例如 C:\\Users\\me\\Documents' };
    if (!fs.existsSync(src)) return { ok: false, error: '源目录不存在：' + src };
    const j = {
      id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      n: String(o.name || '备份任务').slice(0, 60), src, dst,
      mode: o.mode === 'mirror' ? 'mirror' : 'incremental',
      st: '就绪', p: 0, last: '—', size: '—', files: 0, err: '', schedule: '', log: ''
    };
    jobs.unshift(j); persist(); push();
    addLog('INFO', '建立备份任务 ' + j.n + ' · ' + src + ' → ' + dst, 'backup');
    return { ok: true, jobs: snapshot() };
  }
  function run(id, restore) {
    const j = jobs.find(x => x.id === id);
    if (!j) return { ok: false, error: '任务不存在' };
    if (running.has(id)) return { ok: false, error: '任务正在执行中' };
    const from = restore ? j.dst : j.src, to = restore ? j.src : j.dst;
    try { fs.mkdirSync(to, { recursive: true }); } catch (e) { return { ok: false, error: '无法建立目标目录：' + e.message }; }
    // 说明：默认增量复制 /E，不使用 /MIR，避免删除目标端的额外文件（防数据丢失）
    const flags = ['/E', '/Z', '/R:1', '/W:1', '/NFL', '/NDL', '/NP', '/BYTES', '/NJH'];
    if (j.mode === 'mirror') flags.push('/PURGE');
    const args = [from, to].concat(flags);
    j.st = '执行中'; j.p = 5; j.err = ''; j.log = ''; push();
    let child;
    try { child = cp.spawn('robocopy.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { j.st = '失败'; j.err = e.message; push(); return { ok: false, error: e.message }; }
    running.set(id, child);
    let log = '', count = 0;
    const onData = d => {
      const t = decode(d);
      log += t; if (log.length > 40000) log = log.slice(-40000);
      j.log = log.slice(-1600);
      count++;
      // robocopy 每输出若干行推进一次进度（真实执行进度，不做假百分比动画）
      j.p = Math.min(95, 5 + count * 2);
      if (count % 4 === 0) push();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', e => { running.delete(id); j.st = '失败'; j.err = e.message; persist(); push(); });
    child.on('close', code => {
      running.delete(id);
      // robocopy 退出码 0-7 为成功，>=8 为失败
      const ok = code < 8;
      const m = /Bytes\s*:\s*([\d.]+)\s+/.exec(log);
      const fm = /Files\s*:\s*(\d+)\s+/.exec(log);
      j.files = fm ? Number(fm[1]) : 0;
      try {
        let sz = 0;
        const walk = (d, dep) => {
          if (dep > 3) return;
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) walk(path.join(d, e.name), dep + 1);
            else { try { sz += fs.statSync(path.join(d, e.name)).size; } catch (er) {} }
          }
        };
        walk(to, 0);
        j.size = fmt(sz);
      } catch (e) { j.size = m ? m[1] + ' B' : '—'; }
      j.st = ok ? '完成' : '失败'; j.p = ok ? 100 : j.p;
      j.last = new Date().toLocaleString('zh-CN', { hour12: false });
      j.err = ok ? '' : 'robocopy 退出码 ' + code;
      addLog(ok ? 'INFO' : 'ERR', '备份任务 ' + j.n + (ok ? ' 完成' : ' 失败') + ' · ' + j.size + ' / ' + j.files + ' 个文件', 'backup');
      if (ok) addNoti('备份完成', j.n + ' · ' + j.size + '，共 ' + j.files + ' 个文件', 'ok');
      persist(); push();
    });
    return { ok: true, jobs: snapshot() };
  }
  function remove(id) {
    jobs = jobs.filter(x => x.id !== id); persist(); push();
    return { ok: true, jobs: snapshot() };
  }
  /* 真实 Windows 计划任务：每日定时备份 */
  function schedule(id, at, removeSchedule) {
    const j = jobs.find(x => x.id === id);
    if (!j) return { ok: false, error: '任务不存在' };
    const tn = 'NasDeck-Backup-' + j.id;
    if (removeSchedule) {
      cp.execFile('schtasks.exe', ['/Delete', '/TN', tn, '/F'], { windowsHide: true }, () => {});
      j.schedule = ''; persist(); push();
      return { ok: true, jobs: snapshot() };
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(at || ''))) return { ok: false, error: '时间格式须为 HH:MM' };
    const cmd = 'robocopy "' + j.src + '" "' + j.dst + '" /E /Z /R:1 /W:1 /NFL /NDL /NP /NJH';
    cp.execFile('schtasks.exe', ['/Create', '/TN', tn, '/SC', 'DAILY', '/ST', at, '/TR', 'cmd /c ' + cmd, '/F'],
      { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
        if (err) addLog('ERR', '建立备份计划任务失败：' + (decode(stderr) || err.message), 'backup');
        else addLog('INFO', '备份任务 ' + j.n + ' 已排程每日 ' + at, 'backup');
      });
    j.schedule = '每日 ' + at; persist(); push();
    return { ok: true, jobs: snapshot() };
  }
  return { snapshot, create, run, remove, schedule, get jobs() { return jobs; } };
}

/* ------------------------- BT / 磁力：aria2 RPC ------------------------- */
function initAria2(emit) {
  const cfg = { host: '127.0.0.1', port: 6800, secret: '', enabled: true };
  let rpcId = 0;
  function call(method, params) {
    return new Promise(resolve => {
      const body = Buffer.from(JSON.stringify({
        jsonrpc: '2.0', id: 'nasdeck' + (++rpcId), method,
        params: (cfg.secret ? ['token:' + cfg.secret] : []).concat(params || [])
      }));
      const r = http.request({ host: cfg.host, port: cfg.port, path: '/jsonrpc', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }, timeout: 6000, agent: false },
      res => {
        const bufs = []; res.on('data', d => bufs.push(d));
        res.on('end', () => { try { resolve({ ok: true, data: JSON.parse(Buffer.concat(bufs).toString('utf8')) }); }
          catch (e) { resolve({ ok: false, error: 'RPC 响应解析失败' }); } });
      });
      r.on('timeout', () => { r.destroy(); resolve({ ok: false, error: 'RPC 超时' }); });
      r.on('error', e => resolve({ ok: false, error: e.code === 'ECONNREFUSED' ? 'aria2 未运行' : e.message }));
      r.write(body); r.end();
    });
  }
  async function status() {
    const r = await call('aria2.getVersion');
    return r.ok && r.data && r.data.result ? {
      available: true, version: r.data.result.version || '', endpoint: cfg.host + ':' + cfg.port,
      message: 'aria2 RPC 已连线，BT / 磁力 / 金属链接可用'
    } : { available: false, version: '', endpoint: cfg.host + ':' + cfg.port,
      message: (r.error || 'aria2 RPC 不可用') + ' · 可执行 winget install --id aria2.aria2 安装后启动 aria2c --enable-rpc' };
  }
  async function list() {
    const [act, wait, stop] = await Promise.all([
      call('aria2.tellActive', [['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'files', 'errorMessage']]),
      call('aria2.tellWaiting', [0, 50, ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'files']]),
      call('aria2.tellStopped', [0, 50, ['gid', 'status', 'totalLength', 'completedLength', 'files']])
    ]);
    const all = [act, wait, stop].flatMap(x => (x.ok && x.data && Array.isArray(x.data.result)) ? x.data.result : []);
    return all.map(t => {
      const total = Number(t.totalLength || 0), done = Number(t.completedLength || 0);
      const f = (t.files && t.files[0] && t.files[0].path || '').split(/[\\/]/).pop();
      const uri = t.files && t.files[0] && t.files[0].uris && t.files[0].uris[0] && t.files[0].uris[0].uri;
      return {
        gid: t.gid, n: f || (uri || t.gid).slice(0, 70), sz: fmt(total),
        p: total ? Math.round(done / total * 100) : 0,
        sp: fmt(Number(t.downloadSpeed || 0)) + '/s', st: t.status || '', error: t.errorMessage || ''
      };
    });
  }
  async function add(uri, name) {
    const r = await call('aria2.addUri', [[uri], name ? { 'out': name } : {}]);
    if (!r.ok || !r.data || !r.data.result) return { ok: false, error: r.error || (r.data && r.data.error && r.data.error.message) || '添加失败' };
    return { ok: true, gid: r.data.result, tasks: await list() };
  }
  async function action(gid, act) {
    if (!/^[A-Za-z0-9]{1,40}$/.test(String(gid || ''))) return { ok: false, error: '非法 GID' };
    const map = { pause: 'aria2.pause', resume: 'aria2.unpause', remove: 'aria2.remove' };
    if (!map[act]) return { ok: false, error: '不支持的操作' };
    const r = await call(map[act], [gid]);
    return { ok: r.ok && !r.data.error, tasks: await list(), error: r.data && r.data.error ? r.data.error.message : r.error };
  }
  function configure(o) {
    if (o.host && /^[\w.\-]{1,80}$/.test(o.host)) cfg.host = o.host;
    if (o.port) cfg.port = Math.max(1, Math.min(65535, Number(o.port) || 6800));
    if (typeof o.secret === 'string') cfg.secret = o.secret.slice(0, 100);
    return { ...cfg };
  }
  return { status, list, add, action, configure, get config() { return { ...cfg }; } };
}

module.exports = { initBackups, initAria2, fmt };
