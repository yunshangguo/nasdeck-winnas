'use strict';
/* ============================================================
 * netshare.js — 网络共享总控（零第三方依赖）
 *   · 挂载配置：WebDAV / SMB 远程共享，凭据 AES-256-GCM 加密落盘
 *     （或仅在内存中保存，重启后需重新输入）
 *   · WebDAV 客户端：PROPFIND / GET / PUT / MKCOL / DELETE / MOVE 代理
 *   · SMB 客户端：UNC 路径用 Node 原生 fs 直接读写（Windows 已缓存凭据时）
 *   · SMB 服务端：复用 lib/windows.js 的 shares() / shareAction()，不另造实现
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const { Store } = require('./store');

const IMG = /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|tif|tiff|heic)$/i;
const VID = /\.(mp4|mkv|webm|avi|mov|wmv|flv|m4v|ts|rmvb)$/i;
const AUD = /\.(mp3|m4a|wav|flac|ogg|aac|wma|ape)$/i;
const ZIP = /\.(zip|7z|rar|tar|gz|bz2|xz|tgz)$/i;
function typeOf(n, dir) {
  if (dir) return 'dir';
  if (IMG.test(n)) return 'img';
  if (VID.test(n)) return 'vid';
  if (AUD.test(n)) return 'aud';
  if (ZIP.test(n)) return 'zip';
  return 'doc';
}
function fmtTime(ms) {
  if (!ms) return 'N/A';
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function cleanRel(r) {
  const s = String(r || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (s.split('/').indexOf('..') >= 0) throw new Error('路径越界');
  return s;
}
function xmlTag(s, name) {
  const m = new RegExp('<(?:[A-Za-z0-9_-]+:)?' + name + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?' + name + '>', 'i').exec(s);
  return m ? m[1].trim() : '';
}

function initNetShare(dataDir, opts) {
  const windows = opts.windows;
  const log = opts.log || function () {};
  /* 协议通信任务池由 server.js 注入（lib/proto-transfer.js）。
     未注入时全部是 no-op，便于独立单测本模块且不产生任何副作用。
     注意：这里只记录「经协议栈」的传输，文件总管的分片上传 / Range
     下载属于另一个通道，绝不混进来。 */
  const proto = opts.proto || null;
  function pBegin(o) { return proto ? proto.begin(o) : null; }
  function pEnd(t, s, e) { if (proto && t) proto.end(t, s, e); }
  function pHookReq(t, req) { if (proto && t) proto.hookRequest(t, req); }
  function pHookRes(t, res, count) { if (proto && t) proto.hookResponse(t, res, count); }
  const store = new Store(dataDir, 'netshare', {
    webdav: { enabled: false, port: 5280, bind: '0.0.0.0', readonly: false,
      roots: ['__home__'], allowDrives: false, authRequired: true, allowWrite: true },
    mounts: []
  });
  const keyFile = path.join(dataDir, 'netshare.key');
  const memCred = new Map();
  function machineKey() {
    try {
      const b = fs.readFileSync(keyFile);
      if (b.length >= 32) return b.slice(0, 32);
    } catch (e) {}
    const k = crypto.randomBytes(32);
    try { fs.writeFileSync(keyFile, k, { mode: 0o600 }); } catch (e) {}
    return k;
  }
  const KEY = machineKey();
  function enc(s) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const data = Buffer.concat([c.update(String(s), 'utf8'), c.final()]);
    return 'v1:' + iv.toString('base64') + ':' + c.getAuthTag().toString('base64') + ':' + data.toString('base64');
  }
  function dec(s) {
    /* enc() 输出 'v1:<iv>:<tag>:<data>' = 4 段；早期写成 5 段判断会永远
       抛「凭据格式无效」，导致 WebDAV Basic 认证只带用户名、自连恒 401。 */
    const p = String(s || '').split(':');
    if (p.length !== 4 || p[0] !== 'v1') throw new Error('凭据格式无效');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(p[1], 'base64'));
    d.setAuthTag(Buffer.from(p[2], 'base64'));
    return Buffer.concat([d.update(Buffer.from(p[3], 'base64')), d.final()]).toString('utf8');
  }

  /* ---------------- 配置 ---------------- */
  function config() { return store.all(); }
  function webdavConfig() { return Object.assign({
    enabled: false, port: 5280, bind: '0.0.0.0', readonly: false,
    roots: ['__home__'], allowDrives: false, authRequired: true, allowWrite: true
  }, store.get('webdav', {})); }
  function setWebdavConfig(o) {
    const cur = webdavConfig();
    const n = Object.assign(cur, o || {});
    n.port = Math.max(1, Math.min(65535, Number(n.port) || 5280));
    if (!Array.isArray(n.roots) || !n.roots.length) n.roots = ['__home__'];
    n.roots = n.roots.map(String).slice(0, 32);
    n.bind = /^(0\.0\.0\.0|127\.0\.0\.1|localhost)$/.test(String(n.bind)) ? String(n.bind) : '0.0.0.0';
    store.set('webdav', n); store.saveNow();
    return n;
  }

  /* ---------------- 挂载 ---------------- */
  function mounts() {
    const list = store.get('mounts', []);
    return (Array.isArray(list) ? list : []).map(m => ({
      id: m.id, type: m.type, name: m.name,
      url: m.url || '', unc: m.unc || '', username: m.username || '',
      hasCredential: !!(m.cred || memCred.has(m.id)),
      saveCredential: !!m.saveCredential, created: m.created || 0
    }));
  }
  function mount(id) {
    const list = store.get('mounts', []);
    const m = (Array.isArray(list) ? list : []).find(x => x.id === id);
    if (!m) throw new Error('挂载不存在');
    return m;
  }
  function passwordOf(m) {
    if (memCred.has(m.id)) return memCred.get(m.id);
    if (m.cred) { try { return dec(m.cred); } catch (e) {} }
    return '';
  }
  function addMount(o) {
    const type = String(o.type || '').toLowerCase();
    if (type !== 'webdav' && type !== 'smb') throw new Error('挂载类型必须是 webdav 或 smb');
    const name = String(o.name || '').trim().slice(0, 60);
    if (!name) throw new Error('请填写名称');
    let url = '', unc = '';
    if (type === 'webdav') {
      url = String(o.url || '').trim();
      let u; try { u = new URL(url); } catch (e) { throw new Error('WebDAV 地址无效'); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('WebDAV 仅支持 http/https');
      url = u.href.replace(/\/+$/, '');
    } else {
      unc = String(o.unc || '').trim().replace(/\//g, '\\');
      if (!/^\\\\[^\\]+\\[^\\]+/.test(unc)) throw new Error('SMB 地址格式应为 \\\\主机\\共享名');
    }
    const id = 'm' + crypto.randomBytes(8).toString('hex');
    const m = {
      id, type, name, url, unc, username: String(o.username || '').trim(),
      saveCredential: o.saveCredential !== false,
      cred: '', created: Date.now()
    };
    const pw = String(o.password || '');
    if (pw) {
      if (m.saveCredential) m.cred = enc(pw);
      else memCred.set(id, pw);
    }
    const list = store.get('mounts', []);
    const arr = Array.isArray(list) ? list : [];
    arr.push(m); store.set('mounts', arr); store.saveNow();
    log('INFO', '新增网络挂载 ' + name + ' (' + type + ')', 'netshare');
    return mounts();
  }
  function delMount(id) {
    mount(id);
    const arr = (store.get('mounts', []) || []).filter(x => x.id !== id);
    store.set('mounts', arr); store.saveNow(); memCred.delete(id);
    return mounts();
  }
  function setPassword(id, pw) {
    const m = mount(id);
    const list = store.get('mounts', []);
    const i = list.findIndex(x => x.id === id);
    if (String(pw)) {
      if (m.saveCredential) list[i].cred = enc(String(pw));
      else memCred.set(id, String(pw));
    }
    store.set('mounts', list); store.saveNow();
    return mounts();
  }

  /* ---------------- WebDAV 客户端 ---------------- */
  function davUrl(m, rel) {
    /* 绝不给 URL 对象的 pathname 重新赋值：赋回去时 URL 规范会把 base 里
       已编码的 %E9 再编码成 %25E9，中文路径会 404。这里直接拼字符串，
       只对新增的相对段做 encodeURIComponent。 */
    const base = String(m.url || '').replace(/\/+$/, '');
    const seg = cleanRel(rel).split('/').filter(Boolean).map(encodeURIComponent);
    const suffix = seg.length
      ? '/' + seg.join('/') + (String(rel).endsWith('/') ? '/' : '')
      : '/';
    return new URL(base + suffix);
  }
  function davHeaders(m, extra) {
    const h = Object.assign({ 'User-Agent': 'NasDeck-WebDAV/1.0', Accept: '*/*' }, extra || {});
    const pw = passwordOf(m);
    if (m.username || pw) h.Authorization = 'Basic ' + Buffer.from(String(m.username || '') + ':' + pw).toString('base64');
    return h;
  }
  function davRequest(m, method, rel, extra, body) {
    return new Promise((resolveP, reject) => {
      const u = davUrl(m, rel);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(u, { method, headers: davHeaders(m, extra), timeout: 25000 }, res => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => resolveP({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('WebDAV 连接超时')));
      if (body) req.write(body);
      req.end();
    });
  }
  function normHref(s) {
    let x = String(s || '').split('?')[0];
    if (/^https?:\/\//i.test(x)) { try { x = new URL(x).pathname; } catch (e) {} }
    try { x = decodeURIComponent(x); } catch (e) {}
    /* 自家 WebDAV 服务端的 hrefOf() 会额外补一个前导斜杠（'//dav/...'），
       折叠多出来的斜杠后才能和 URL.pathname 规范化比较。 */
    x = x.replace(/^\/+/, '/').replace(/\/+$/, '');
    return x || '/';
  }
  function parsePropfind(xml, m, rel) {
    const out = [];
    const parts = String(xml).split(/<(?:[A-Za-z0-9_-]+:)?response\b[^>]*>/i).slice(1);
    let selfAbs = '', baseAbs = '';
    try {
      selfAbs = normHref(davUrl(m, rel).pathname);
      baseAbs = normHref(davUrl(m, '').pathname);
    } catch (e) {}
    for (const p of parts) {
      const seg = p.split(/<\/(?:[A-Za-z0-9_-]+:)?response>/i)[0];
      const href = xmlTag(seg, 'href');
      if (!href) continue;
      const hp = normHref(href);
      /* PROPFIND Depth:1 会把「请求目录自身」也作为一条 response 返回，只需跳过它。
         绝不能用 endsWith 判断：rel 为空时 self 会退化成空串，endsWith('') 恒真，
         所有子项会被静默丢掉（表现就是浏览挂载目录 total=0）。 */
      if (hp === selfAbs || hp === baseAbs) continue;
      const nRaw = hp.split('/').filter(Boolean).pop() || '';
      if (!nRaw) continue;
      const isDir = /<(?:[A-Za-z0-9_-]+:)?collection\s*\/?\s*>/i.test(seg) || String(href).trim().endsWith('/');
      const sz = Number(xmlTag(seg, 'getcontentlength')) || 0;
      let ms = 0;
      const lm = xmlTag(seg, 'getlastmodified');
      if (lm) { const t = Date.parse(lm); if (!Number.isNaN(t)) ms = t; }
      out.push({ n: nRaw, t: typeOf(nRaw, isDir), sz, m: fmtTime(ms), dir: isDir, href: hp });
    }
    return out.sort((a, b) => (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || a.n.localeCompare(b.n));
  }
  async function davBrowse(m, rel) {
    const r = await davRequest(m, 'PROPFIND', rel, { Depth: '1', 'Content-Type': 'application/xml' },
      Buffer.from('<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>', 'utf8'));
    if (r.status !== 207 && r.status !== 200) throw new Error('WebDAV PROPFIND 返回 HTTP ' + r.status);
    return parsePropfind(r.body.toString('utf8'), m, rel);
  }
  function davGet(m, rel, req, res, task) {
    const u = davUrl(m, rel);
    const mod = u.protocol === 'https:' ? https : http;
    const r2 = mod.request(u, { method: 'GET', headers: davHeaders(m, req.headers.range ? { Range: req.headers.range } : {}), timeout: 30000 }, upstream => {
      if (task) {
        /* 远端 Content-Length 到这里才知道；Range 206 时总长度在 Content-Range 尾部 */
        const cl = Number(upstream.headers['content-length']) || 0;
        const cr = /\/(\d+)\s*$/.exec(String(upstream.headers['content-range'] || ''));
        task.size = cl || (cr ? Number(cr[1]) : 0) || task.size;
      }
      const h = { 'Content-Type': upstream.headers['content-type'] || 'application/octet-stream' };
      if (upstream.headers['content-length']) h['Content-Length'] = upstream.headers['content-length'];
      if (upstream.headers['content-range']) h['Content-Range'] = upstream.headers['content-range'];
      if (upstream.headers['accept-ranges']) h['Accept-Ranges'] = upstream.headers['accept-ranges'];
      h['Content-Disposition'] = 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(path.basename(cleanRel(rel)) || 'download');
      res.writeHead(upstream.statusCode || 200, h);
      upstream.pipe(res);
    });
    r2.on('error', e => { pEnd(task, 'error', e.message); if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: e.message })); });
    req.on('close', () => { try { r2.destroy(); } catch (e) {} });
    r2.end();
  }
  function davPut(m, rel, req, res, task) {
    const u = davUrl(m, rel);
    const mod = u.protocol === 'https:' ? https : http;
    const r2 = mod.request(u, { method: 'PUT', headers: davHeaders(m, { 'Content-Type': 'application/octet-stream' }), timeout: 120000 }, upstream => {
      let body = '';
      upstream.on('data', d => { body += d.toString('utf8'); });
      upstream.on('end', () => {
        const good = upstream.statusCode >= 200 && upstream.statusCode < 300;
        res.writeHead(good ? 200 : 502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(good ? { ok: true } : { ok: false, error: 'WebDAV PUT 返回 HTTP ' + upstream.statusCode + ' ' + body.slice(0, 120) }));
      });
    });
    r2.on('error', e => { pEnd(task, 'error', e.message); if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, error: e.message })); });
    req.pipe(r2);
  }

  /* ---------------- SMB 客户端 ---------------- */
  function smbAbs(m, rel) {
    const base = String(m.unc || '').replace(/[\\/]+$/, '').replace(/\//g, '\\');
    const r = cleanRel(rel).replace(/\//g, '\\');
    const full = r ? base + '\\' + r : base + '\\';
    if (!full.startsWith(base + '\\') && full !== base) throw new Error('路径越界');
    return full;
  }
  function smbBrowse(m, rel) {
    const abs = smbAbs(m, rel);
    const ds = fs.readdirSync(abs, { withFileTypes: true });
    return ds.filter(d => !d.name.startsWith('.') && d.name.toLowerCase() !== 'desktop.ini').map(d => {
      let st = null;
      try { st = fs.statSync(path.join(abs, d.name)); } catch (e) {}
      const isDir = d.isDirectory();
      return { n: d.name, t: typeOf(d.name, isDir), sz: isDir || !st ? 0 : st.size,
        m: fmtTime(st ? st.mtimeMs : 0), dir: isDir, href: '' };
    }).sort((a, b) => (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || a.n.localeCompare(b.n));
  }

  /* ---------------- 统一浏览 / 操作 ---------------- */
  async function browse(id, rel) {
    const m = mount(id);
    const r = cleanRel(rel);
    const entries = m.type === 'webdav' ? await davBrowse(m, r) : smbBrowse(m, r);
    return { ok: true, id, name: m.name, type: m.type, path: r, entries, total: entries.length };
  }
  async function action(id, act, o) {
    const m = mount(id);
    const rel = cleanRel(o.path);
    o = o || {};
    if (m.type === 'webdav') {
      const child = (rel ? rel.replace(/\/$/, '') + '/' : '') + String(o.name || '').replace(/^\/+/, '');
      if (act === 'mkdir') {
        const r = await davRequest(m, 'MKCOL', child, {});
        if (r.status >= 300) throw new Error('MKCOL 返回 HTTP ' + r.status);
      } else if (act === 'delete') {
        const r = await davRequest(m, 'DELETE', child, {});
        if (r.status >= 300 && r.status !== 404) throw new Error('DELETE 返回 HTTP ' + r.status);
      } else if (act === 'rename') {
        const dest = (rel ? rel.replace(/\/$/, '') + '/' : '') + String(o.to || '');
        const r = await davRequest(m, 'MOVE', child, { Destination: new URL(davUrl(m, dest)).href, Overwrite: 'F' });
        if (r.status >= 300) throw new Error('MOVE 返回 HTTP ' + r.status);
      } else throw new Error('不支持的操作');
    } else {
      const dir = smbAbs(m, rel);
      const name = path.basename(String(o.name || '').replace(/\\/g, '/'));
      if (!name || name === '.' || name === '..') throw new Error('非法文件名');
      const target = path.join(dir, name);
      if (act === 'mkdir') fs.mkdirSync(target);
      else if (act === 'delete') fs.rmSync(target, { recursive: true, force: true });
      else if (act === 'rename') {
        const to = path.basename(String(o.to || '').replace(/\\/g, '/'));
        if (!to || to === '.' || to === '..') throw new Error('非法新名称');
        fs.renameSync(target, path.join(dir, to));
      } else throw new Error('不支持的操作');
    }
    return await browse(id, rel);
  }
  /* 远程挂载的读写：每次真实协议传输都登记到「协议通信」任务池。
     taskId 由前端在发起请求时生成并回传，前端据此绑定「取消」操作；
     外部 WebDAV 客户端没有 taskId，由服务端自行生成。 */
  function protoTask(m, r, dir, size, taskId) {
    return pBegin({
      id: taskId, proto: m.type, via: 'client', dir,
      name: path.basename(r) || 'download', path: r,
      mount: m.name || m.id, peer: m.url || m.unc || '', size
    });
  }
  function getFile(id, rel, req, res, taskId) {
    const m = mount(id);
    const r = cleanRel(rel);
    const t = protoTask(m, r, 'down', 0, taskId);
    pHookRes(t, res);
    if (m.type === 'webdav') return davGet(m, r, req, res, t);
    const abs = smbAbs(m, r);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404); res.end('文件不存在'); return; }
    if (t) t.size = fs.statSync(abs).size;
    const { streamFile } = require('./core');
    streamFile(req, res, abs, { download: true, name: path.basename(abs), cache: 'no-store' });
  }
  function putFile(id, rel, req, res, taskId) {
    const m = mount(id);
    const r = cleanRel(rel);
    const t = protoTask(m, r, 'up', Number(req.headers['content-length']) || 0, taskId);
    pHookReq(t, req);
    pHookRes(t, res, false);
    if (m.type === 'webdav') return davPut(m, r, req, res, t);
    const abs = smbAbs(m, r);
    const ws = fs.createWriteStream(abs);
    req.pipe(ws);
    ws.on('finish', () => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true })); });
    ws.on('error', e => { res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, error: e.message })); });
  }

  /* ---------------- SMB 服务端（复用 windows 模块） ---------------- */
  async function smbStatus(force) {
    const out = { admin: !!windows.isAdmin(), port445: false, firewall: '未知', shares: [], error: '', platform: process.platform };
    try {
      const r = await windows.shares(!!force);
      out.shares = (r.shares || []).filter(s => !/\$$/.test(s.n)).map(s => ({
        n: s.n, path: s.path, desc: s.desc, access: s.access || []
      }));
      if (r.error) out.error = r.error;
    } catch (e) { out.error = e.message; }
    out.port445 = await new Promise(res => {
      const s = net.connect({ host: '127.0.0.1', port: 445, timeout: 1200 });
      s.on('connect', () => { s.destroy(); res(true); });
      s.on('error', () => res(false));
      s.on('timeout', () => { s.destroy(); res(false); });
    });
    if (process.platform !== 'win32') out.error = 'SMB 共享仅在 Windows 主机上可用';
    return out;
  }
  async function smbShare(o) {
    if (!windows.isAdmin()) return { ok: false, error: '此操作需要管理员权限，请「以管理员身份运行」启动 NasDeck' };
    if (String(o.act || 'add') === 'delete') return await windows.shareAction({ act: 'delete', name: o.name });
    return await windows.shareAction({ act: 'add', name: o.name, path: o.path });
  }
  async function smbConnect(o) {
    /* 凭据经 UTF-8 base64 传入 -EncodedCommand，明文不出现在命令行/进程列表 */
    if (process.platform !== 'win32') return { ok: false, error: '仅支持 Windows' };
    const unc = String(o.unc || '').replace(/\//g, '\\');
    if (!/^\\\\[^\\]+\\[^\\]+/.test(unc)) throw new Error('SMB 地址无效');
    const b64 = Buffer.from(JSON.stringify({ unc, user: String(o.username || ''), pass: String(o.password || '') }), 'utf8').toString('base64');
    const script = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference="Stop";' +
      '$j=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + b64 + '")) | ConvertFrom-Json;' +
      'if($j.user){$sec=ConvertTo-SecureString $j.pass -AsPlainText -Force;' +
      '$cred=New-Object System.Management.Automation.PSCredential($j.user,$sec);' +
      'New-SmbMapping -RemotePath $j.unc -UserName $j.user -Password $j.pass -Persistent $true -ErrorAction Stop | Out-Null}' +
      'else{New-SmbMapping -RemotePath $j.unc -Persistent $true -ErrorAction Stop | Out-Null}; "OK"';
    const r = await windows.ps(script, 25000);
    return { ok: r.ok && /OK/.test(r.out), out: (r.out || '').slice(0, 300), error: r.err || (r.ok ? '' : (r.out || '').slice(0, 300)) };
  }

  return { config, webdavConfig, setWebdavConfig, mounts, addMount, delMount, setPassword,
    browse, action, getFile, putFile, smbStatus, smbShare, smbConnect,
    davRequest, get store() { return store; } };
}

module.exports = { initNetShare };
