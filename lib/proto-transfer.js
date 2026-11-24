'use strict';
/* ==================================================================
 * lib/proto-transfer.js — 协议通信传输任务池（v16.1）
 *
 * 与「文件管理器」通道严格分离：
 *   · 文件管理器任务 = lib/transfer.js 的分片上传 + 前端 Range 下载任务，
 *     由文件总管发起，带断点续传。
 *   · 协议通信任务 = 本模块，只记录经由 WebDAV / SMB 协议栈发生的传输：
 *       - via=client：在「远程挂载」里上传 / 下载远程文件
 *       - via=server：外部客户端访问本机 WebDAV 服务（PUT / GET）
 *     任务状态由后端协议栈如实记录，刷新页面不会丢失。
 *
 * 零第三方依赖；被 lib/netshare.js 与 lib/webdav-server.js 共同引用，
 * 在 server.js 里创建唯一实例后注入，两个模块之间不互相 require。
 * ================================================================== */

const MAX = 300;

function createProtoTransfer(opts) {
  opts = opts || {};
  const log = opts.log || function () {};
  const tasks = [];

  function begin(o) {
    o = o || {};
    const t = {
      id: String(o.id || ('pt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7))),
      channel: 'protocol',                       /* 与文件管理器通道区分的唯一标识 */
      proto: String(o.proto || '').toUpperCase() === 'SMB' ? 'SMB' : 'WEBDAV',
      via: o.via === 'server' ? 'server' : 'client',
      dir: o.dir === 'up' ? 'up' : 'down',
      name: String(o.name || ''),
      path: String(o.path || ''),
      mount: String(o.mount || ''),
      peer: String(o.peer || ''),
      size: Math.max(0, Number(o.size) || 0),
      got: 0, state: 'running', error: '',
      started: Date.now(), ended: 0
    };
    /* 同一个 taskId 重试时不要留下两条同 id 记录 */
    for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].id === t.id) tasks.splice(i, 1);
    tasks.unshift(t);
    if (tasks.length > MAX) tasks.length = MAX;
    return t;
  }

  function progress(t, n) {
    if (!t || t.state !== 'running') return;
    n = Number(n) || 0;
    if (n > 0) t.got += n;
    if (t.size && t.got > t.size) t.got = t.size;
  }

  function end(t, state, err) {
    if (!t || t.state !== 'running') return;
    t.state = state || 'done';
    t.error = err ? String(err).slice(0, 160) : '';
    t.ended = Date.now();
    if (t.state === 'done' && t.size) t.got = t.size;
  }

  function bytesOf(chunk) {
    if (!chunk) return 0;
    if (Buffer.isBuffer(chunk)) return chunk.length;
    if (typeof chunk === 'string') return Buffer.byteLength(chunk, 'utf8');
    return 0;
  }

  /* hookRequest：统计「浏览器/客户端 → 协议栈」的字节（PUT 上传进度）。
     与 req.pipe() 共存：pipe 只是另一个 data 监听器，不会吞掉本监听。 */
  function hookRequest(t, req) {
    if (!t) return t;
    req.on('data', d => progress(t, bytesOf(d)));
    req.on('aborted', () => end(t, 'canceled', '请求中断'));
    req.on('error', () => end(t, 'error', '请求读取失败'));
    return t;
  }

  /* hookResponse：统计「协议栈 → 浏览器/客户端」的字节（GET 下载进度），
     并在响应结束时按真实 HTTP 状态收口。包装只对本次请求生效，
     res.end 后立即还原，绝不污染 keep-alive 上的后续请求。 */
  function hookResponse(t, res, countWrites) {
    if (!t) return t;
    const ow = res.write, oe = res.end;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true; res.write = ow; res.end = oe;
    };
    if (countWrites !== false) {
      res.write = function (chunk) {
        try { progress(t, bytesOf(chunk)); } catch (e) {}
        return ow.apply(this, arguments);
      };
    }
    res.end = function (chunk) {
      try { if (countWrites !== false) progress(t, bytesOf(chunk)); } catch (e) {}
      const code = res.statusCode || 200;
      end(t, code >= 400 ? 'error' : 'done', code >= 400 ? 'HTTP ' + code : '');
      restore();
      return oe.apply(this, arguments);
    };
    res.on('close', () => { restore(); if (t.state === 'running') end(t, 'canceled', '连接中断'); });
    return t;
  }

  function list(o) {
    o = o || {};
    const lim = Math.max(1, Math.min(MAX, Number(o.limit) || 100));
    let arr = tasks.slice();
    if (o.proto) arr = arr.filter(t => t.proto === String(o.proto).toUpperCase());
    if (o.via) arr = arr.filter(t => t.via === o.via);
    if (o.state) arr = arr.filter(t => t.state === o.state);
    return arr.slice(0, lim).map(t => Object.assign({}, t));
  }

  function stats() {
    const s = { total: tasks.length, running: 0, done: 0, error: 0, canceled: 0,
      up: 0, down: 0, webdav: 0, smb: 0, client: 0, server: 0 };
    for (const t of tasks) {
      if (Object.prototype.hasOwnProperty.call(s, t.state)) s[t.state]++;
      s[t.dir]++; s[t.proto.toLowerCase()]++; s[t.via]++;
    }
    return s;
  }

  function cancel(id) {
    const t = tasks.find(x => x.id === String(id || ''));
    if (!t) return false;
    if (t.state === 'running') { t.state = 'canceled'; t.error = '用户取消'; t.ended = Date.now(); }
    return true;
  }

  /* scope: 'done'（非运行中的全部）/ 'all' / 单个 taskId */
  function clear(scope) {
    let n = 0;
    const sc = String(scope || 'done');
    for (let i = tasks.length - 1; i >= 0; i--) {
      const t = tasks[i];
      if (sc === 'all' || t.id === sc || (sc === 'done' && t.state !== 'running')) {
        tasks.splice(i, 1); n++;
      }
    }
    return n;
  }

  function remove(id) {
    const i = tasks.findIndex(x => x.id === String(id || ''));
    if (i < 0) return false;
    tasks.splice(i, 1);
    return true;
  }

  return { begin, progress, end, hookRequest, hookResponse, list, stats, cancel, clear, remove,
    get tasks() { return tasks; } };
}

module.exports = { createProtoTransfer };
