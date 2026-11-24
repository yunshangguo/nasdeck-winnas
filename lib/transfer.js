'use strict';
/* ============================================================
 * transfer.js — 断点续传上传（分片 / 恢复 / 原子落盘）
 * 零第三方依赖。临时分片放在 data/transfers/<uploadId>/，
 * 只有全部收齐 + 大小/哈希校验通过后，才原子改名到最终路径。
 * 目标已存在时自动加序号，绝不静默覆盖用户原有文件。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadJson, saveJson } = require('./store');

const MIN_CHUNK = 64 * 1024;
const MAX_CHUNK = 16 * 1024 * 1024;
const MAX_SIZE = 512 * 1024 * 1024 * 1024; // 512GB 上限，防误传
const STALE_MS = 7 * 24 * 60 * 60 * 1000;  // 7 天未完成的任务自动清理

function initTransfer(dataDir, opts) {
  const resolve = opts.resolve;      // (vp, name) => 绝对最终路径
  const listFn = opts.list;          // (vp) => 文件列表（可抛错）
  const log = opts.log || function () {};
  const noti = opts.noti || function () {};
  const base = path.join(dataDir, 'transfers');
  fs.mkdirSync(base, { recursive: true });
  const indexFile = path.join(base, 'index.json');
  let jobs = loadJson(indexFile, {});
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) jobs = {};
  const persist = () => { try { saveJson(indexFile, jobs); } catch (e) { log('WARN', '传输任务索引写入失败: ' + e.message, 'transfer'); } };

  function safeName(n) {
    const b = path.basename(String(n || ''));
    if (!b || b === '.' || b === '..' || b !== String(n)) throw new Error('非法文件名');
    if (/[\\/:*?"<>|]/.test(b) || b.length > 200) throw new Error('文件名含非法字符或过长');
    return b;
  }
  function safeId(id) { return /^[A-Za-z0-9_-]{8,64}$/.test(String(id || '')); }
  function jobDir(id) { return path.join(base, id); }
  function chunkPath(id, i) { return path.join(jobDir(id), String(i) + '.part'); }
  function job(id) {
    if (!safeId(id) || !jobs[id]) throw new Error('上传任务不存在或已过期');
    return jobs[id];
  }
  function existing(j) {
    const out = [];
    try {
      const d = jobDir(j.id);
      for (let i = 0; i < j.chunks; i++) if (fs.existsSync(chunkPath(j.id, i))) out.push(i);
    } catch (e) {}
    return out;
  }
  function publicJob(j) {
    return {
      uploadId: j.id, path: j.path, name: j.name, size: j.size,
      chunkSize: j.chunkSize, chunks: j.chunks, lastModified: j.lastModified || 0,
      sha256: j.sha256 || '', uploaded: existing(j), created: j.created,
      updated: j.updated, complete: !!j.complete
    };
  }
  function uniqueTarget(dir, name) {
    let p = path.join(dir, name);
    if (!fs.existsSync(p)) return p;
    const ext = path.extname(name), stem = path.basename(name, ext);
    for (let i = 1; i < 1000; i++) {
      const q = path.join(dir, stem + ' (' + i + ')' + ext);
      if (!fs.existsSync(q)) return q;
    }
    throw new Error('同名文件过多，请先重命名或清理目录');
  }
  function cleanup(id) {
    try { fs.rmSync(jobDir(id), { recursive: true, force: true }); } catch (e) {}
    delete jobs[id]; persist();
  }
  /* 启动清理：只删 7 天前的残留，用户正在传的任务一律不动 */
  function sweep() {
    let n = 0;
    for (const id of Object.keys(jobs)) {
      const j = jobs[id];
      if (j.complete || Date.now() - (j.updated || j.created || 0) < STALE_MS) continue;
      try { fs.rmSync(jobDir(id), { recursive: true, force: true }); } catch (e) {}
      delete jobs[id]; n++;
    }
    if (n) { persist(); log('INFO', '清理 ' + n + ' 个过期上传任务', 'transfer'); }
    return n;
  }
  sweep();

  /* ---------------- 初始化 ---------------- */
  function init(o) {
    const vp = String(o.path || '/');
    const name = safeName(o.name);
    const size = Number(o.size);
    if (!Number.isFinite(size) || size < 0 || size > MAX_SIZE) throw new Error('文件大小无效');
    let chunkSize = Number(o.chunkSize) || 4 * 1024 * 1024;
    if (chunkSize < MIN_CHUNK || chunkSize > MAX_CHUNK) throw new Error('分片大小必须在 64KB~16MB 之间');
    const chunks = Math.max(1, Math.ceil(size / chunkSize));
    if (chunks > 200000) throw new Error('分片数量过多，请增大分片大小');
    const target = resolve(vp, name);            // 同时校验虚拟路径合法性
    const dir = path.dirname(target);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('目标目录不存在');
    /* 同参数任务复用 = 刷新页面后天然续传；参数变了则重开一个任务 */
    for (const id of Object.keys(jobs)) {
      const j = jobs[id];
      if (!j.complete && j.path === vp && j.name === name && j.size === size &&
          j.chunkSize === chunkSize && fs.existsSync(jobDir(id))) {
        j.updated = Date.now(); persist();
        return publicJob(j);
      }
    }
    const id = crypto.randomBytes(12).toString('hex') + Date.now().toString(36);
    fs.mkdirSync(jobDir(id), { recursive: true });
    const j = {
      id, path: vp, name, size, chunkSize, chunks,
      lastModified: Number(o.lastModified) || 0,
      sha256: /^[a-f0-9]{64}$/i.test(String(o.sha256 || '')) ? String(o.sha256).toLowerCase() : '',
      created: Date.now(), updated: Date.now(), complete: false
    };
    jobs[id] = j; persist();
    /* 0 字节文件没有分片，complete 会直接落盘 */
    return publicJob(j);
  }

  /* ---------------- 单片写入 ---------------- */
  function saveChunk(id, index, req) {
    const j = job(id);
    if (j.complete) throw new Error('任务已完成');
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= j.chunks) throw new Error('分片序号越界');
    const dir = jobDir(id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, String(i) + '.tmp');
    const final = chunkPath(id, i);
    return new Promise((resolveP, reject) => {
      let size = 0, done = false;
      const ws = fs.createWriteStream(tmp);
      const fail = e => {
        if (done) return;
        done = true;
        try { ws.destroy(); } catch (x) {}
        try { fs.rmSync(tmp, { force: true }); } catch (x) {}
        reject(e);
      };
      req.on('data', d => {
        if (done) return;
        size += d.length;
        const expect = (i === j.chunks - 1) ? (j.size - i * j.chunkSize) : j.chunkSize;
        if (size > expect) { fail(new Error('分片数据超过预期长度')); return; }
        ws.write(d);
      });
      req.on('end', () => {
        if (done) return;
        const expect = (i === j.chunks - 1) ? (j.size - i * j.chunkSize) : j.chunkSize;
        if (size !== expect) { fail(new Error('分片长度不符（期望 ' + expect + ' 字节，收到 ' + size + '）')); return; }
        ws.end(() => {
          if (done) return;
          done = true;
          try { fs.renameSync(tmp, final); } catch (e) { fail(e); return; }
          j.updated = Date.now(); persist();
          resolveP({ ok: true, index: i, size, uploaded: existing(j).length, chunks: j.chunks });
        });
      });
      req.on('error', e => fail(e));
      ws.on('error', e => fail(e));
    });
  }

  /* ---------------- 状态 / 列表 / 取消 ---------------- */
  function status(id) {
    const j = job(id);
    return publicJob(j);
  }
  function list(vp) {
    const out = [];
    for (const id of Object.keys(jobs)) {
      const j = jobs[id];
      if (j.complete) continue;
      if (vp && j.path !== vp) continue;
      out.push(publicJob(j));
    }
    return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }
  function abort(id) { job(id); cleanup(id); return { ok: true }; }

  /* ---------------- 合并 + 原子落盘 ---------------- */
  async function complete(id) {
    const j = job(id);
    if (j.complete) throw new Error('任务已完成');
    const got = existing(j);
    if (got.length !== j.chunks) {
      const missing = [];
      for (let i = 0; i < j.chunks; i++) if (got.indexOf(i) < 0) missing.push(i);
      throw new Error('还有 ' + missing.length + ' 个分片未上传（首个缺失 #' + missing[0] + '）');
    }
    const target0 = resolve(j.path, j.name);
    const dir0 = path.dirname(target0);
    const target = uniqueTarget(dir0, j.name);
    /* 临时文件以 . 开头，WinNAS 的 hiddenName() 会过滤，用户不会看到半截文件 */
    const tmp = path.join(dir0, '.' + path.basename(target) + '.nasdeck-uploading');
    try { fs.rmSync(tmp, { force: true }); } catch (e) {}
    /* 用 FileHandle.write 逐片顺序写，避开 WriteStream.write/end 回调在
       磁盘紧张时偶发不触发导致 complete 请求永久挂起的问题。 */
    const hash = j.sha256 ? crypto.createHash('sha256') : null;
    let total = 0, fh = null;
    try {
      fh = await fs.promises.open(tmp, 'w');
      for (let i = 0; i < j.chunks; i++) {
        const buf = await fs.promises.readFile(chunkPath(j.id, i));
        if (hash) hash.update(buf);
        total += buf.length;
        await fh.write(buf);
      }
      await fh.close(); fh = null;
      if (total !== j.size) throw new Error('合并后大小不符（期望 ' + j.size + '，实际 ' + total + '），已放弃落盘');
      if (hash && hash.digest('hex') !== j.sha256) throw new Error('SHA-256 校验失败，已放弃落盘');
      /* 到这一步才改最终路径：断线 / 校验失败都不会留下半截文件 */
      fs.renameSync(tmp, target);
    } catch (e) {
      try { if (fh) await fh.close(); } catch (x) {}
      try { fs.rmSync(tmp, { force: true }); } catch (x) {}
      throw e;
    }
    const finalName = path.basename(target);
    j.complete = true; j.updated = Date.now();
    cleanup(id);
    log('INFO', '分片上传完成 ' + finalName + ' (' + total + ' 字节 / ' + j.chunks + ' 片)', 'files');
    noti('上传完成', finalName + ' 已保存至 ' + j.path, 'ok');
    let files = null; try { files = listFn(j.path); } catch (e) {}
    return {
      ok: true, name: finalName, size: total, chunks: j.chunks,
      renamed: finalName !== j.name, files
    };
  }

  /* ---------------- 旧的一次性 PUT：也改成 .part + 原子改名 ---------------- */
  function legacy(req, res, target, vp, name, json) {
    const dir = path.dirname(target);
    const tmp = path.join(dir, '.' + path.basename(target) + '.nasdeck-uploading');
    try { fs.rmSync(tmp, { force: true }); } catch (e) {}
    const ws = fs.createWriteStream(tmp);
    let size = 0, settled = false;
    const finish = (code, obj) => {
      if (settled) return; settled = true;
      json(res, code, obj);
    };
    req.on('data', d => { size += d.length; ws.write(d); });
    req.on('end', () => ws.end());
    req.on('error', e => {
      try { ws.destroy(); fs.rmSync(tmp, { force: true }); } catch (x) {}
      finish(500, { ok: false, error: e.message });
    });
    ws.on('error', e => {
      try { fs.rmSync(tmp, { force: true }); } catch (x) {}
      finish(500, { ok: false, error: e.message });
    });
    ws.on('finish', () => {
      try {
        const final = uniqueTarget(dir, path.basename(target));
        fs.renameSync(tmp, final);
        const finalName = path.basename(final);
        log('INFO', '上传完成 ' + finalName + ' (' + size + ' 字节)', 'files');
        noti('上传完成', finalName + ' 已上传至 ' + vp, 'ok');
        let files = null; try { files = listFn(vp); } catch (e) {}
        finish(200, { ok: true, name: finalName, size, renamed: finalName !== name, files });
      } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch (x) {}
        finish(500, { ok: false, error: e.message });
      }
    });
  }

  return { init, saveChunk, status, list, abort, complete, legacy, sweep,
    get jobs() { return jobs; } };
}

module.exports = { initTransfer };
