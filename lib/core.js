'use strict';
/* ============================================================
 * core.js — 零依赖 HTTP 框架（Express 风格路由）+ SSE 事件总线
 * 只使用 Node 内置模块，不需要 npm install
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip', '.7z': 'application/x-7z-compressed',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'
};
function mimeOf(f) { return MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'; }

function fail(code, msg) { const e = new Error(msg); e.code = code; return e; }

function json(res, code, obj) {
  if (res.headersSent || res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(obj === undefined ? {} : obj));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0, done = false;
    req.on('data', c => {
      if (done) return;
      n += c.length;
      if (n > limit) { done = true; reject(fail(413, '请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', e => { if (!done) { done = true; reject(e); } });
  });
}
async function jsonBody(req) {
  const b = await readBody(req);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); }
  catch (e) { throw fail(400, 'JSON 解析失败: ' + e.message); }
}

/* 支持 HTTP Range 的文件流（音视频拖动进度条必需） */
function streamFile(req, res, file, o = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { json(res, 404, { error: '文件不存在或不可读' }); return; }
    const type = o.type || mimeOf(file);
    let start = 0, end = st.size - 1, code = 200;
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        if (m[1] !== '') start = parseInt(m[1], 10);
        if (m[2] !== '') end = parseInt(m[2], 10);
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= st.size) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); res.end(); return;
        }
        if (end >= st.size) end = st.size - 1;
        code = 206;
      }
    }
    const h = {
      'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Length': Math.max(0, end - start + 1),
      'Cache-Control': o.cache || 'no-cache'
    };
    /* HTML 一律禁止任何形式的缓存：避免旧版单文件前端被浏览器/代理复用，
       导致改了代码却「看到的还是之前的前端」。 */
    if (/no-store/i.test(h['Cache-Control'])) {
      h['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
      h['Pragma'] = 'no-cache';
      h['Expires'] = '0';
    }
    if (o.download) h['Content-Disposition'] = "attachment; filename*=UTF-8''" + encodeURIComponent(o.name || path.basename(file));
    else h['Content-Disposition'] = 'inline';
    if (code === 206) h['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
    res.writeHead(code, h);
    if (req.method === 'HEAD') { res.end(); return; }
    const rs = fs.createReadStream(file, { start, end });
    rs.pipe(res);
    rs.on('error', () => { try { res.destroy(); } catch (e) {} });
  });
}

function createApp(opts) {
  const { root, dataDir, sessionProvider } = opts;
  const routes = [];
  const clients = new Set();
  const bus = new EventEmitter(); bus.setMaxListeners(0);

  function reg(method, pattern, handler, o = {}) {
    routes.push({ method, pattern, handler, auth: o.auth !== false, raw: !!o.raw, prefix: pattern.endsWith('*') });
  }
  function match(method, p) {
    for (const r of routes) {
      if (r.method !== method) continue;
      if (r.prefix) { if (p.startsWith(r.pattern.slice(0, -1))) return r; }
      else if (r.pattern === p) return r;
    }
    return null;
  }
  function broadcast(event, payload) {
    let line;
    try { line = 'event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n'; }
    catch (e) { return; }
    for (const c of clients) { try { c.write(line); } catch (e) { clients.delete(c); } }
  }
  bus.on('emit', (ev, data) => broadcast(ev, data));
  const emit = (ev, data) => broadcast(ev, data);

  function handleSSE(req, res, u) {
    let s = sessionProvider ? sessionProvider(req) : null;
    if (!s && u && u.searchParams.get('token')) {
      s = sessionProvider({ headers: { 'x-nasdeck-token': u.searchParams.get('token') } });
    }
    if (!s) { json(res, 401, { error: '未登录' }); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    res.write(': connected\n\n');
    clients.add(res);
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
    req.on('close', () => { clearInterval(hb); clients.delete(res); });
  }

  function serveStatic(p, req, res) {
    let rel = p;
    if (rel === '/' || rel === '') rel = '/index.html';
    // 后端源码与运行数据不可通过静态服务读取
    if (/^\/(lib|data|node_modules)(\/|$)/i.test(rel) || /^\/(server|build)\./i.test(rel)) {
      json(res, 403, { error: '禁止访问' }); return;
    }
    const base = path.resolve(root);
    const full = path.resolve(base, '.' + rel);
    if (full !== base && !full.startsWith(base + path.sep)) { json(res, 403, { error: '路径越界' }); return; }
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) { json(res, 404, { error: '404 Not Found: ' + rel }); return; }
      streamFile(req, res, full, { cache: rel.endsWith('.html') ? 'no-store' : 'public, max-age=300' });
    });
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    } else res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-NasDeck-Token, X-Requested-With, Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Range');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    let u;
    try { u = new URL(req.url, 'http://localhost'); }
    catch (e) { json(res, 400, { error: 'URL 解析失败' }); return; }
    let p;
    try { p = decodeURIComponent(u.pathname); }
    catch (e) { json(res, 400, { error: 'URL 编码错误' }); return; }

    if (p === '/api/events') { handleSSE(req, res, u); return; }

    const r = match(req.method, p);
    if (!r) { serveStatic(p, req, res); return; }

    try {
      const session = sessionProvider ? sessionProvider(req) : null;
      if (r.auth && !session) { json(res, 401, { error: '未登录或会话已过期' }); return; }
      const query = {};
      for (const [k, v] of u.searchParams) query[k] = v;
      const body = r.raw ? null : await jsonBody(req);
      const ctx = {
        req, res, url: u, query, body, session, root, dataDir,
        broadcast: emit, bus, emit, app, json: (code, o) => json(res, code, o)
      };
      await r.handler(ctx);
    } catch (e) {
      if (!res.headersSent) json(res, e.code || 500, { error: e.message || '内部错误' });
      else { try { res.end(); } catch (_) {} }
      if (!e.code || e.code >= 500) console.error('[API ERROR]', req.method, p, e.stack || e.message);
    }
  });

  function listen(port, host, cb) {
    server.on('clientError', (err, sock) => { try { sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) {} });
    return server.listen(port, host, cb);
  }

  const app = {
    get: (p, h, o) => reg('GET', p, h, o),
    post: (p, h, o) => reg('POST', p, h, o),
    put: (p, h, o) => reg('PUT', p, h, o),
    del: (p, h, o) => reg('DELETE', p, h, o),
    reg, listen, broadcast: emit, emit, bus,
    get sseClients() { return clients.size; },
    get routes() { return routes; },
    server
  };
  return app;
}

module.exports = { createApp, json, fail, readBody, jsonBody, streamFile, mimeOf };
