'use strict';
/* ============================================================
 * webdav-server.js — 零依赖 WebDAV 服务端（独立可开关端口）
 *
 * 为什么不挂在 5080：core.js 会把 OPTIONS 无条件短路成 204、并且非 raw
 * 路由会先读 JSON body，WebDAV 的 PROPFIND/PUT/LOCK 全都会被吃掉。
 * 独立 http.Server 可以完整实现 DAV 方法、独立绑定网卡、独立开关，
 * 完全不改动既有框架，回归风险为零。
 *
 * 支持：OPTIONS / PROPFIND / GET / HEAD / PUT / MKCOL / DELETE /
 *       MOVE / COPY / LOCK / UNLOCK / PROPPATCH
 * 认证：HTTP Basic -> 复用主服务的账号校验（不另存密码）
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { streamFile, mimeOf } = require('./core');

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>\n';
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function hrefOf(p) {
  return '/' + String(p).split('/').map(s => { try { return encodeURIComponent(s); } catch (e) { return s; } }).join('/');
}
function etagOf(st) {
  return '"' + crypto.createHash('md5')
    .update(String(st.size) + ':' + String(st.mtimeMs) + ':' + String(st.ino || '')).digest('hex') + '"';
}
function propsXml(href, st, isDir) {
  const lm = new Date(st.mtimeMs || st.mtime || 0).toUTCString();
  const cd = new Date(st.birthtimeMs || st.mtimeMs || 0).toISOString();
  return '<D:response>' +
    '<D:href>' + esc(href) + '</D:href>' +
    '<D:propstat><D:prop>' +
    '<D:resourcetype>' + (isDir ? '<D:collection/>' : '') + '</D:resourcetype>' +
    '<D:displayname>' + esc(path.basename(href) || '/') + '</D:displayname>' +
    (isDir ? '' : '<D:getcontentlength>' + st.size + '</D:getcontentlength><D:getcontenttype>' + esc(mimeOf(href)) + '</D:getcontenttype>') +
    '<D:getlastmodified>' + lm + '</D:getlastmodified>' +
    '<D:creationdate>' + cd + '</D:creationdate>' +
    '<D:getetag>' + etagOf(st) + '</D:getetag>' +
    '<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope>' +
    '<D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>' +
    '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>' +
    '</D:response>';
}
function multiStatus(res, responses) {
  const body = Buffer.from(XML_HEAD + '<D:multistatus xmlns:D="DAV:">' + responses.join('') + '</D:multistatus>', 'utf8');
  res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}
function davErr(res, code, msg) {
  const body = Buffer.from(XML_HEAD + '<D:error xmlns:D="DAV:"><D:' +
    (code === 404 ? 'not-found' : code === 403 ? 'forbidden' : 'locked') + '>' +
    esc(msg || '') + '</D:' + (code === 404 ? 'not-found' : code === 403 ? 'forbidden' : 'locked') + '></D:error>', 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}
function basicUser(req) {
  const h = req.headers.authorization || '';
  const m = /^Basic\s+(.+)$/i.exec(h);
  if (!m) return null;
  try {
    const s = Buffer.from(m[1], 'base64').toString('utf8');
    const i = s.indexOf(':');
    if (i < 0) return null;
    return { username: s.slice(0, i), password: s.slice(i + 1) };
  } catch (e) { return null; }
}

function createWebDavServer(opts) {
  const resolve = opts.resolve;         // (vp) => abs，抛错表示路径非法/越界
  const verify = opts.verify;           // (user, pass) => boolean
  const trash = opts.trash;             // 可选 (vp) => Promise，送系统回收站
  const log = opts.log || function () {};
  /* 可选：协议通信任务池（lib/proto-transfer.js）。注入后，外部 WebDAV
     客户端的 GET / PUT 也会被如实登记；未注入则完全无副作用。 */
  const track = opts.track || null;
  function tBegin(o) { return track ? track.begin(o) : null; }
  function tHookReq(t, req) { if (track && t) track.hookRequest(t, req); }
  function tHookRes(t, res, count) { if (track && t) track.hookResponse(t, res, count); }
  let server = null, runtime = { running: false, port: 0, bind: '', error: '', requests: 0, startedAt: 0 };

  function cfg() { return opts.getConfig() || {}; }
  function urlToVp(u) {
    let p;
    try { p = decodeURIComponent(u.split('?')[0]); } catch (e) { throw new Error('URL 编码错误'); }
    if (!/^\/dav(\/|$)/i.test(p)) throw new Error('路径不在 WebDAV 命名空间');
    const rel = p.replace(/^\/dav\/?/i, '').replace(/\\/g, '/');
    const vp = '/' + rel.replace(/^\/+/, '');
    if (vp.indexOf('..') >= 0) throw new Error('路径越界');
    return vp;
  }
  function allowed(vp) {
    const c = cfg();
    const roots = Array.isArray(c.roots) && c.roots.length ? c.roots : ['__home__'];
    const seg = vp.split('/').filter(Boolean)[0] || '';
    if (roots.indexOf(seg) >= 0) return true;
    if (c.allowDrives && /^[A-Za-z]:$/.test(seg)) return true;
    return false;
  }
  function writeAllowed() {
    const c = cfg();
    return !c.readonly && c.allowWrite !== false;
  }
  function needAuth(res) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="NasDeck WebDAV", charset="UTF-8"', 'Content-Length': 0 });
    res.end();
  }

  async function handle(req, res) {
    runtime.requests++;
    const c = cfg();
    res.setHeader('Server', 'NasDeck-WebDAV/1.0');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'DAV': '1,2', 'Allow': 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, LOCK, UNLOCK, PROPPATCH',
        'MS-Author-Via': 'DAV', 'Content-Length': 0
      });
      res.end(); return;
    }
    /* 认证：默认开启；Basic 校验复用主服务账号，绝不另存一套密码 */
    if (c.authRequired !== false) {
      const u = basicUser(req);
      if (!u || !verify(u.username, u.password)) { needAuth(res); return; }
    }
    let vp, abs;
    try {
      vp = urlToVp(req.url);
      if (!allowed(vp)) { davErr(res, 403, '该根目录未开放 WebDAV 共享，请到「传输与共享」配置'); return; }
      abs = resolve(vp);
    } catch (e) { davErr(res, 403, e.message); return; }

    const method = req.method.toUpperCase();
    try {
      /* -------- 读 -------- */
      if (method === 'GET' || method === 'HEAD') {
        if (!fs.existsSync(abs)) { davErr(res, 404, '文件不存在'); return; }
        if (fs.statSync(abs).isDirectory()) {
          const body = Buffer.from(XML_HEAD + '<html><meta charset="utf-8"><title>NasDeck WebDAV</title><body><h3>' +
            esc(vp) + '</h3><p>请使用支持 WebDAV 的客户端访问此目录。</p></body></html>', 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
          res.end(method === 'HEAD' ? '' : body); return;
        }
        /* 外部客户端通过 WebDAV 协议下载文件 → 登记为「协议通信 / 服务端」任务 */
        if (track) {
          const t = tBegin({ proto: 'WEBDAV', via: 'server', dir: 'down',
            name: path.basename(vp), path: vp, mount: '本机 WebDAV 服务',
            peer: String((req.socket && req.socket.remoteAddress) || ''),
            size: fs.statSync(abs).size });
          tHookRes(t, res);
        }
        streamFile(req, res, abs, { cache: 'no-store' });
        return;
      }
      if (method === 'PROPFIND') {
        if (!fs.existsSync(abs)) { davErr(res, 404, '资源不存在'); return; }
        const st = fs.statSync(abs);
        const isDir = st.isDirectory();
        const out = [propsXml(hrefOf('/dav' + vp.replace(/^\//, '/')), st, isDir)];
        const depth = String(req.headers.depth || '1');
        if (isDir && depth !== '0') {
          let names = [];
          try { names = fs.readdirSync(abs); } catch (e) {}
          for (const n of names) {
            if (n.startsWith('.') || n.toLowerCase() === 'desktop.ini') continue;
            const child = path.join(abs, n);
            let cst;
            try { cst = fs.statSync(child); } catch (e) { continue; }
            out.push(propsXml(hrefOf('/dav' + (vp.replace(/\/$/, '') + '/' + n)), cst, cst.isDirectory()));
          }
        }
        multiStatus(res, out);
        return;
      }
      if (method === 'LOCK') {
        const token = 'opaquelocktoken:' + crypto.randomBytes(12).toString('hex');
        const body = Buffer.from(XML_HEAD + '<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>' +
          '<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>0</D:depth>' +
          '<D:owner><D:href>NasDeck</D:href></D:owner><D:timeout>Second-3600</D:timeout>' +
          '<D:locktoken><D:href>' + token + '</D:href></D:locktoken>' +
          '</D:activelock></D:lockdiscovery></D:prop>', 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': body.length });
        res.end(body); return;
      }
      if (method === 'UNLOCK') { res.writeHead(204); res.end(); return; }
      if (method === 'PROPPATCH') {
        multiStatus(res, [propsXml(hrefOf('/dav' + vp), fs.existsSync(abs) ? fs.statSync(abs) : { size: 0, mtimeMs: 0 }, false)]);
        return;
      }

      /* -------- 写（受只读开关约束） -------- */
      if (!writeAllowed()) { davErr(res, 403, '当前 WebDAV 为只读模式'); return; }

      if (method === 'PUT') {
        const dir = path.dirname(abs);
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { davErr(res, 409, '父目录不存在'); return; }
        if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) { davErr(res, 405, '目标是目录'); return; }
        const tmp = abs + '.nasdeck-dav';
        try { fs.rmSync(tmp, { force: true }); } catch (e) {}
        const ws = fs.createWriteStream(tmp);
        let settled = false;
        const done = (code) => { if (!settled) { settled = true; res.writeHead(code); res.end(); } };
        /* 外部客户端通过 WebDAV 协议上传文件 → 登记为「协议通信 / 服务端」任务 */
        const pt = tBegin({ proto: 'WEBDAV', via: 'server', dir: 'up',
          name: path.basename(vp), path: vp, mount: '本机 WebDAV 服务',
          peer: String((req.socket && req.socket.remoteAddress) || ''),
          size: Number(req.headers['content-length']) || 0 });
        tHookReq(pt, req);
        tHookRes(pt, res, false);
        req.on('data', d => ws.write(d));
        req.on('end', () => ws.end());
        req.on('error', () => { try { ws.destroy(); fs.rmSync(tmp, { force: true }); } catch (e) {} done(500); });
        ws.on('error', () => { try { fs.rmSync(tmp, { force: true }); } catch (e) {} done(500); });
        ws.on('finish', () => {
          try {
            if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
            fs.renameSync(tmp, abs);
            log('INFO', 'WebDAV 写入 ' + vp, 'webdav');
            done(fs.existsSync(abs) ? 201 : 200);
          } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch (x) {} done(500); }
        });
        return;
      }
      if (method === 'MKCOL') {
        if (fs.existsSync(abs)) { davErr(res, 405, '已存在'); return; }
        fs.mkdirSync(abs, { recursive: false });
        res.writeHead(201); res.end(); return;
      }
      if (method === 'DELETE') {
        if (!fs.existsSync(abs)) { davErr(res, 404, '资源不存在'); return; }
        if (trash) { await trash(vp); }
        else fs.rmSync(abs, { recursive: true, force: true });
        res.writeHead(204); res.end(); return;
      }
      if (method === 'MOVE' || method === 'COPY') {
        const dest = req.headers.destination;
        if (!dest) { davErr(res, 400, '缺少 Destination'); return; }
        let du;
        try { du = new URL(dest, 'http://localhost'); } catch (e) { davErr(res, 400, 'Destination 无效'); return; }
        let dvp;
        try { dvp = urlToVp(du.pathname); } catch (e) { davErr(res, 403, e.message); return; }
        if (!allowed(dvp)) { davErr(res, 403, '目标根目录未开放'); return; }
        let dabs;
        try { dabs = resolve(dvp); } catch (e) { davErr(res, 403, e.message); return; }
        if (!fs.existsSync(abs)) { davErr(res, 404, '源不存在'); return; }
        if (method === 'MOVE') {
          if (fs.existsSync(dabs)) fs.rmSync(dabs, { recursive: true, force: true });
          fs.renameSync(abs, dabs);
        } else {
          fs.cpSync(abs, dabs, { recursive: true, force: true });
        }
        res.writeHead(fs.existsSync(dabs) ? 201 : 204); res.end(); return;
      }
      davErr(res, 405, '不支持的方法 ' + method);
    } catch (e) {
      log('WARN', 'WebDAV ' + method + ' ' + vp + ' 失败: ' + e.message, 'webdav');
      davErr(res, 500, e.message);
    }
  }

  function stop() {
    return new Promise(resolveP => {
      if (!server) { runtime.running = false; resolveP(true); return; }
      const s = server; server = null;
      let settled = false, timer = null;
      /* 超时兜底必须在 close 回调里 clearTimeout。否则即使服务已正常关闭并
         立刻重启，1.5s 后残留的定时器仍会把 runtime.running 打回 false，
         表现为「端口在监听，状态却显示未运行」。 */
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        runtime.running = false;
        resolveP(true);
      };
      timer = setTimeout(finish, 1500);
      try { s.close(finish); } catch (e) { finish(); }
    });
  }
  function start(conf) {
    return stop().then(() => new Promise(resolveP => {
      if (!conf || !conf.enabled) { runtime = Object.assign(runtime, { running: false, error: '' }); resolveP(status()); return; }
      const port = Number(conf.port) || 5280;
      const bind = String(conf.bind || '0.0.0.0');
      const s = http.createServer((req, res) => { handle(req, res).catch(e => { try { davErr(res, 500, e.message); } catch (x) {} }); });
      s.on('error', e => {
        runtime = Object.assign(runtime, { running: false, error: e.message, port, bind });
        log('WARN', 'WebDAV 服务启动失败: ' + e.message, 'webdav');
        try { s.close(); } catch (x) {}
        resolveP(status());
      });
      s.listen(port, bind, () => {
        server = s;
        runtime = { running: true, port, bind, error: '', requests: 0, startedAt: Date.now() };
        log('INFO', 'WebDAV 服务已启动 http://' + bind + ':' + port + '/dav/', 'webdav');
        resolveP(status());
      });
    }));
  }
  function status(conf) {
    const c = conf || cfg();
    const ips = [];
    try {
      const n = require('os').networkInterfaces();
      for (const k of Object.keys(n)) for (const a of (n[k] || []))
        if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    } catch (e) {}
    return Object.assign({}, runtime, {
      enabled: !!(c && c.enabled), configuredPort: Number(c && c.port) || 5280,
      readonly: !!(c && c.readonly), roots: (c && c.roots) || ['__home__'],
      urls: ips.map(ip => 'http://' + ip + ':' + (runtime.port || Number(c && c.port) || 5280) + '/dav/'),
      localUrl: 'http://127.0.0.1:' + (runtime.port || Number(c && c.port) || 5280) + '/dav/'
    });
  }
  return { start, stop, status, get running() { return !!server; } };
}

module.exports = { createWebDavServer };
