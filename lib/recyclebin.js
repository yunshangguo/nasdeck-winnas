'use strict';
/* ============================================================
 * recyclebin.js — Windows 真实「回收站」读写
 *
 * 每个 NTFS 分区的 `$Recycle.Bin\<SID>\` 里成对存放：
 *   $Ixxxxxx.<ext> → 元数据（版本 / 原始大小 / 删除 FILETIME / 原始完整路径）
 *   $Rxxxxxx.<ext> → 被删除的真实文件或目录内容
 *
 * 列出的是资源管理器回收站里真正的项目（不是项目私有目录）。
 * 还原 = 把 $R 移回 $I 记录的原始路径并删掉 $I；
 * 永久删除 / 清空 = 删除成对的 $R 与 $I。
 * 删除文件入回收站 = .NET Microsoft.VisualBasic.FileIO.FileSystem
 * (RecycleOption.SendToRecycleBin)，由 Windows 生成 $I/$R。
 *
 * 性能：真实机器上回收站可能有上万项，扫描用异步并发 + 90 秒缓存，
 *       绝不阻塞 Node 事件循环；列表接口只返回最近 N 项并给出真实总数。
 * ============================================================ */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cp = require('child_process');

const NA = 'N/A';

function decodeOut(buf) {
  if (!buf) return '';
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
  if (b.length >= 2 && b.length % 2 === 0) {
    let zero = 0;
    for (let i = 1; i < b.length; i += 2) if (b[i] === 0) zero++;
    if (zero / (b.length / 2) >= 0.8) return b.toString('utf16le');
  }
  return b.toString('utf8');
}

function ps(script, timeout) {
  return new Promise(resolve => {
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    cp.execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
      { timeout: timeout || 25000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'buffer' },
      (err, so, se) => resolve({
        ok: !err,
        out: decodeOut(so).trim(),
        err: decodeOut(se).trim() || (err ? err.message : '')
      })
    );
  });
}
function psQuote(s) { return String(s).replace(/'/g, "''"); }

/* ---------- 磁盘上的回收站根目录 ---------- */
function binRoots() {
  const out = [];
  for (let i = 65; i <= 90; i++) {
    const L = String.fromCharCode(i);
    const root = L + ':\\$Recycle.Bin';
    try {
      if (!fs.existsSync(root)) continue;
      for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const p = path.join(root, d.name);
        try { fs.readdirSync(p); out.push({ drive: L, dir: p, sid: d.name }); } catch (e) {}
      }
    } catch (e) { /* 无权访问该盘或该 SID 目录 */ }
  }
  return out;
}

/* ---------- $I 元数据解析 ---------- */
function parseI(file) {
  const b = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  if (b.length < 28) return null;
  const ver = Number(b.readBigUInt64LE(0));
  const size = Number(b.readBigUInt64LE(8));
  const ft = b.readBigUInt64LE(16);
  let orig = '';
  if (ver >= 2) {
    const chars = b.readUInt32LE(24);
    if (!Number.isFinite(chars) || chars < 1 || chars > 4096) return null;
    orig = b.slice(28, 28 + chars * 2).toString('utf16le').replace(/\0+$/, '');
  } else {
    orig = b.slice(24, Math.min(b.length, 24 + 520)).toString('utf16le').replace(/\0.*$/, '');
  }
  if (!orig) return null;
  let time = NA, ts = 0;
  try {
    const ms = Number(ft / 10000n) - 11644473600000;
    if (ms > 0 && ms < Date.now() + 86400000) {
      ts = ms;
      const d = new Date(ms), p = n => String(n).padStart(2, '0');
      time = d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
  } catch (e) {}
  return { size, orig, time, ts };
}

function idOf(iFile) { return Buffer.from(iFile, 'utf8').toString('base64url'); }
function fromId(id) {
  let p;
  try { p = Buffer.from(String(id), 'base64url').toString('utf8'); } catch (e) { return null; }
  if (!/^[A-Za-z]:\\\$Recycle\.Bin\\/i.test(p)) return null;   // 防路径穿越
  if (!/\\\$I[^\\]*$/i.test(p)) return null;
  return p;
}
function rOf(iFile) {
  const dir = path.dirname(iFile), base = path.basename(iFile);
  return path.join(dir, '$R' + base.slice(2));
}
function fmtSize(n) {
  if (!Number.isFinite(n) || n < 0) return NA;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function typeOf(n) {
  const x = String(n || '').toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|tif|tiff|heic)$/.test(x)) return 'img';
  if (/\.(mp4|mkv|webm|avi|mov|wmv|flv|m4v|ts|rmvb)$/.test(x)) return 'vid';
  if (/\.(mp3|m4a|wav|flac|ogg|aac|wma|ape)$/.test(x)) return 'aud';
  if (/\.(zip|7z|rar|tar|gz|bz2|xz|tgz)$/.test(x)) return 'zip';
  return 'doc';
}

/* ---------- 异步并发扫描 + 缓存 ---------- */
let CACHE = null, SCANNING = null;
let PROGRESS = { running: false, done: 0, total: 0 };
let ON_UPDATE = null;
const TTL = 90 * 1000;
function invalidate() { CACHE = null; }
function onUpdate(cb) { ON_UPDATE = cb; }
function status() {
  return {
    cached: !!CACHE, running: PROGRESS.running,
    done: PROGRESS.done, total: PROGRESS.total,
    count: CACHE ? CACHE.items.length : 0
  };
}
function warm() { if (!CACHE && !SCANNING) scan().catch(() => {}); }
function fireUpdate() { if (ON_UPDATE) { try { ON_UPDATE(); } catch (e) {} } }

/* 增删改后原地更新缓存，避免为一次操作重新扫描上万项 */
function removeFromCache(iFile) {
  if (!CACHE) return;
  const key = String(iFile).toLowerCase();
  const i = CACHE.items.findIndex(x => x._i.toLowerCase() === key);
  if (i < 0) return;
  CACHE.used -= CACHE.items[i].sz || 0;
  CACHE.items.splice(i, 1);
  CACHE.scanned = CACHE.items.length;
  CACHE.ts = Date.now();
  fireUpdate();
}
function addToCache(iFile) {
  if (!CACHE) return;
  try {
    const m = parseI(fs.readFileSync(iFile));
    if (!m) return;
    const orig = m.orig.replace(/\//g, '\\');
    const item = {
      id: idOf(iFile), n: path.basename(orig) || NA,
      from: path.dirname(orig) || NA, orig,
      sz: Number(m.size) || 0, sizeText: fmtSize(Number(m.size) || 0),
      time: m.time, ts: m.ts,
      drive: String(iFile)[0].toUpperCase(),
      source: 'Windows 回收站', _i: iFile, _r: rOf(iFile)
    };
    CACHE.items.unshift(item);
    CACHE.used += item.sz;
    CACHE.ts = Date.now();
    fireUpdate();
  } catch (e) {}
}

const yieldLoop = () => new Promise(r => setImmediate(r));

async function scan(force) {
  if (!force && CACHE && Date.now() - CACHE.ts < TTL) return CACHE;
  if (SCANNING) return SCANNING;
  SCANNING = (async () => {
    const roots = binRoots();
    const jobs = [];
    for (const root of roots) {
      let names;
      try { names = fs.readdirSync(root.dir); } catch (e) { continue; }
      for (const n of names) {
        if (/^\$I/i.test(n)) jobs.push({ drive: root.drive, iFile: path.join(root.dir, n) });
      }
    }
    const items = [];
    PROGRESS = { running: true, done: 0, total: jobs.length };
    for (let k = 0; k < jobs.length; k++) {
      const j = jobs[k];
      let m = null;
      try { m = parseI(fs.readFileSync(j.iFile)); } catch (e) {}
      if (m) {
        const orig = m.orig.replace(/\//g, '\\');
        items.push({
          id: idOf(j.iFile),
          n: path.basename(orig) || NA,
          from: path.dirname(orig) || NA,
          orig,
          sz: Number(m.size) || 0,
          sizeText: fmtSize(Number(m.size) || 0),
          time: m.time,
          ts: m.ts,
          drive: j.drive,
          source: 'Windows 回收站',
          _i: j.iFile, _r: rOf(j.iFile)
        });
      }
      /* 每 400 项让出事件循环：扫描上万项时不阻塞 HTTP / SSE */
      PROGRESS.done = k + 1;
      if ((k & 399) === 399) await yieldLoop();
    }
    PROGRESS.running = false;
    items.sort((a, b) => (b.ts - a.ts) || String(b.time).localeCompare(String(a.time)));
    CACHE = {
      ts: Date.now(), items, scanned: items.length,
      used: items.reduce((a, x) => a + x.sz, 0),
      roots: roots.map(r => r.dir)
    };
    fireUpdate();
    return CACHE;
  })();
  try { return await SCANNING; } finally { SCANNING = null; }
}

/* ---------- 对外：列表 / 统计 ---------- */
async function list(limit, fast) {
  if (fast && !CACHE) {
    warm();
    return {
      items: [], total: 0, used: 0, usedText: 'N/A', truncated: false,
      source: 'Windows $Recycle.Bin', loading: true, progress: status(), roots: binRoots().map(r => r.dir)
    };
  }
  if (fast && CACHE && Date.now() - CACHE.ts >= TTL) scan().catch(() => {});
  const c = CACHE || await scan();
  const n = Math.min(Math.max(1, limit || 200), c.items.length);
  const out = [];
  for (let k = 0; k < n; k++) {
    const x = c.items[k];
    let isDir = false, sz = x.sz;
    try {
      const st = fs.statSync(x._r);
      isDir = st.isDirectory();
      if (!isDir) sz = st.size;
    } catch (e) { /* $R 已被外部清理 */ }
    const y = Object.assign({}, x, {
      sz, sizeText: fmtSize(sz), isDir, t: isDir ? 'dir' : typeOf(x.n)
    });
    delete y._i; delete y._r; delete y.ts;
    out.push(y);
  }
  return {
    items: out, total: c.items.length, used: c.used, usedText: fmtSize(c.used),
    truncated: c.items.length > n, source: 'Windows $Recycle.Bin', roots: c.roots,
    cachedAt: new Date(c.ts).toLocaleTimeString('zh-CN')
  };
}
async function info(fast) {
  const r = await list(1, fast);
  return { ok: true, source: r.source, count: r.total, used: r.used, usedText: r.usedText, roots: r.roots, cachedAt: r.cachedAt, loading: !!r.loading, progress: r.progress || status() };
}

/* ---------- 还原 ---------- */
async function restore(id) {
  const iFile = fromId(id);
  if (!iFile || !fs.existsSync(iFile)) throw new Error('回收站项目不存在或已失效');
  const meta = parseI(iFile);
  if (!meta) throw new Error('无法读取回收站元数据');
  const rFile = rOf(iFile);
  if (!fs.existsSync(rFile)) throw new Error('回收站中的文件内容已被移除');
  let target = meta.orig.replace(/\//g, '\\');
  try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch (e) {}
  if (fs.existsSync(target)) {
    const ext = path.extname(target), base = path.basename(target, ext);
    target = path.join(path.dirname(target), base + '_还原_' + Date.now().toString(36) + ext);
  }
  const st = fs.statSync(rFile);
  try {
    if (st.isDirectory()) fs.cpSync(rFile, target, { recursive: true });
    else fs.copyFileSync(rFile, target);
  } catch (e) { throw new Error('还原失败：' + e.message); }
  try { fs.rmSync(rFile, { recursive: true, force: true }); } catch (e) {}
  try { fs.unlinkSync(iFile); } catch (e) {}
  removeFromCache(iFile);
  return { restoredTo: target };
}

/* ---------- 永久删除 / 清空 ---------- */
async function purge(id) {
  const iFile = fromId(id);
  if (!iFile || !fs.existsSync(iFile)) throw new Error('回收站项目不存在或已失效');
  const rFile = rOf(iFile);
  try { if (fs.existsSync(rFile)) fs.rmSync(rFile, { recursive: true, force: true }); }
  catch (e) { throw new Error('无法删除内容：' + e.message); }
  try { fs.unlinkSync(iFile); } catch (e) {}
  removeFromCache(iFile);
  return { ok: true };
}
async function clear() {
  const c = await scan();
  let n = 0;
  for (const x of c.items) {
    try {
      if (fs.existsSync(x._r)) fs.rmSync(x._r, { recursive: true, force: true });
      if (fs.existsSync(x._i)) fs.unlinkSync(x._i);
      n++;
    } catch (e) {}
  }
  if (CACHE) {
    CACHE.items = []; CACHE.used = 0; CACHE.scanned = 0; CACHE.ts = Date.now();
    fireUpdate();
  } else invalidate();
  return { removed: n };
}

/* ---------- 把文件真正送进 Windows 回收站 ---------- */
function iNames() {
  const set = new Set();
  for (const root of binRoots()) {
    let names;
    try { names = fs.readdirSync(root.dir); } catch (e) { continue; }
    for (const n of names) if (/^\$I/i.test(n)) set.add(path.join(root.dir, n));
  }
  return set;
}
async function sendToBin(realPath) {
  const p = path.resolve(String(realPath || ''));
  if (!fs.existsSync(p)) throw new Error('文件不存在');
  /* 只记录 $I 文件名集合（毫秒级），避免为一次删除全量重扫上万项 */
  const before = iNames();
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName Microsoft.VisualBasic",
    "$p='" + psQuote(p) + "'",
    "$it=Get-Item -LiteralPath $p -Force",
    "if($it.PSIsContainer){",
    "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)",
    "}else{",
    "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)",
    "}",
    "'OK'"
  ].join('\n');
  const r = await ps(script, 30000);
  /* Windows 的 VB FileIO 在把文件送进回收站后偶尔会抛 FileNotFoundException，
     但 $I/$R 已正确生成。因此以「磁盘上出现的新 $I 记录」为唯一判据，
     不看 PowerShell 的退出码或输出。 */
  const fresh = [...iNames()].filter(f => !before.has(f));
  let verified = false;
  for (const f of fresh) {
    try {
      const m = parseI(fs.readFileSync(f));
      if (m && m.orig.replace(/\//g, '\\').toLowerCase() === p.toLowerCase()) {
        verified = true;
        addToCache(f);
        break;
      }
    } catch (e) {}
  }
  const gone = !fs.existsSync(p);
  if (gone && verified) return { ok: true, method: 'Windows 回收站', verified: true, path: p };
  throw new Error('未能送入 Windows 回收站：' +
    ((r.err || r.out || 'PowerShell 未生成 $I 元数据').split('\n')[0] || '').replace(/#< CLIXML[^>]*>/g, '').slice(0, 180));
}

function initRecycleBin() {
  return { list, info, restore, purge, clear, sendToBin, invalidate, scan, warm, status, onUpdate, binRoots, NA };
}

module.exports = { initRecycleBin };
