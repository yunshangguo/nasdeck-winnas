'use strict';
/* ============================================================
 * files.js — 真实文件系统：任意路径浏览 / CRUD / 上传下载 / 回收站
 *
 * 虚拟路径规则（Windows）：
 *   /                     虚拟根：所有盘符 + 共享文件夹
 *   /C:/Users/xxx         ->  C:\Users\xxx     （任意绝对路径）
 *   /Public/项目资料       ->  data/shares/Public/项目资料
 * Linux 下 / 为虚拟根，/mnt/xxx 等直接映射到真实绝对路径。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { loadJson, saveJson } = require('./store');

const IMG = /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|tif|tiff|heic)$/i;
const VID = /\.(mp4|mkv|webm|avi|mov|wmv|flv|m4v|ts|rmvb)$/i;
const AUD = /\.(mp3|m4a|wav|flac|ogg|aac|wma|ape)$/i;
const ZIP = /\.(zip|7z|rar|tar|gz|bz2|xz|tgz)$/i;

function typeOf(name, isDir) {
  if (isDir) return 'dir';
  if (IMG.test(name)) return 'img';
  if (VID.test(name)) return 'vid';
  if (AUD.test(name)) return 'aud';
  if (ZIP.test(name)) return 'zip';
  return 'doc';
}
function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function initFiles(dataDir) {
  const trashDir = path.join(dataDir, 'trash');
  const sharesRoot = path.join(dataDir, 'shares');
  const trashFile = path.join(dataDir, 'trash.json');
  const SHARES = ['Public', 'Multimedia', 'Download', 'Web', 'Container', 'homes'];
  fs.mkdirSync(trashDir, { recursive: true });
  for (const s of SHARES) {
    try { fs.mkdirSync(path.join(sharesRoot, s), { recursive: true }); } catch (e) {}
  }
  try { fs.mkdirSync(path.join(sharesRoot, 'homes', 'admin'), { recursive: true }); } catch (e) {}
  try { fs.mkdirSync(path.join(sharesRoot, 'Multimedia', 'Photos'), { recursive: true }); } catch (e) {}
  try { fs.mkdirSync(path.join(sharesRoot, 'Multimedia', 'Music'), { recursive: true }); } catch (e) {}
  try { fs.mkdirSync(path.join(sharesRoot, 'Multimedia', 'Video'), { recursive: true }); } catch (e) {}
  let trash = loadJson(trashFile, []);
  if (!Array.isArray(trash)) trash = [];
  const saveTrash = () => saveJson(trashFile, trash);

  function drives() {
    const out = [];
    if (process.platform === 'win32') {
      for (let i = 65; i <= 90; i++) {
        const L = String.fromCharCode(i), root = L + ':\\';
        try { if (fs.existsSync(root)) out.push(L + ':'); } catch (e) {}
      }
    } else out.push('mnt', 'home', 'media');
    return out;
  }

  /* 真实磁盘容量（fs.statfsSync），读不到就是 0 / N/A，绝不编造 */
  function realRootInfo() {
    return drives().map(L => {
      const root = L + '\\';
      let total = 0, free = 0;
      try {
        const st = fs.statfsSync(root);
        total = Number(st.blocks) * Number(st.bsize);
        free = Number(st.bavail) * Number(st.bsize);
      } catch (e) {}
      return {
        drive: L, path: root, vpath: '/' + L + '/',
        total, free, used: Math.max(0, total - free),
        pct: total ? +((total - free) / total * 100).toFixed(1) : null,
        label: 'N/A', type: 'N/A'
      };
    });
  }

  function toReal(vp) {
    vp = String(vp || '/').replace(/\\/g, '/');
    if (!vp.startsWith('/')) vp = '/' + vp;
    const clean = path.posix.normalize(vp);
    const seg = clean.split('/').filter(Boolean);
    if (!seg.length) return { virtual: true, real: null, vpath: '/' };
    const first = seg[0];
    if (/^[A-Za-z]:$/.test(first)) {
      if (process.platform !== 'win32') return { virtual: false, real: path.resolve('/' + seg.join('/')), vpath: '/' + seg.join('/') };
      const rest = seg.slice(1).join('\\');
      return { virtual: false, real: path.resolve(first + '\\' + (rest ? '\\' + rest : '\\')), vpath: '/' + seg.join('/') };
    }
    if (process.platform !== 'win32' && ['mnt', 'home', 'media', 'volume1', 'var', 'opt'].includes(first)) {
      return { virtual: false, real: path.resolve('/' + seg.join('/')), vpath: '/' + seg.join('/') };
    }
    return { virtual: false, real: path.resolve(sharesRoot, ...seg), vpath: '/' + seg.join('/') };
  }
  function parentV(vp) {
    const s = String(vp || '/').split('/').filter(Boolean);
    s.pop();
    return '/' + s.join('/');
  }
  function readEntries(real, limit = 3000) {
    const out = [];
    let list;
    try { list = fs.readdirSync(real, { withFileTypes: true }); }
    catch (e) { return { entries: [], error: e.message }; }
    for (const d of list.slice(0, limit)) {
      if (d.name.startsWith('~$') || d.name === 'desktop.ini' || d.name === 'System Volume Information') continue;
      let isDir = false, sz = 0, m = Date.now();
      try {
        const st = fs.statSync(path.join(real, d.name));
        isDir = st.isDirectory(); sz = st.size; m = st.mtimeMs;
      } catch (e) { isDir = !!d.isDirectory(); }
      out.push({ n: d.name, t: typeOf(d.name, isDir), sz, m: fmtTime(m) });
    }
    out.sort((a, b) => (a.t === 'dir' ? -1 : 1) - (b.t === 'dir' ? -1 : 1) || a.n.localeCompare(b.n, 'zh-CN'));
    return { entries: out, truncated: list.length > limit };
  }
  function list(vp) {
    const r = toReal(vp);
    if (r.virtual) {
      /* 「此电脑」根目录只列本机真实盘符。
         项目内共享目录不再混进根目录（用户要求全部对接真实 Windows 文件系统），
         仍可通过 /Public 等路径单独访问，toReal 映射保持不变。 */
      const dv = realRootInfo().map(d => ({
        n: d.drive, t: 'dir', sz: d.total, m: '', drive: true,
        label: d.label, total: d.total, free: d.free, pct: d.pct,
        desc: (d.total ? fmtSizeNative(d.total) + ' · 可用 ' + fmtSizeNative(d.free) : 'N/A')
      }));
      return { path: '/', real: null, parent: null, entries: dv, virtual: true, drives: realRootInfo() };
    }
    const x = readEntries(r.real);
    return { path: r.vpath, real: r.real, parent: parentV(r.vpath), entries: x.entries, error: x.error, truncated: x.truncated };
  }
  function stat(vp, name) {
    const r = toReal(vp);
    if (r.virtual) throw new Error('根目录不能存放文件');
    const target = path.join(r.real, path.basename(String(name || '')));
    return { real: target, st: fs.statSync(target) };
  }
  function ensureDir(vp) {
    const r = toReal(vp);
    if (r.virtual) throw new Error('根目录不可写');
    fs.mkdirSync(r.real, { recursive: true });
    return r.real;
  }
  function mkdir(vp, name) {
    const dir = ensureDir(vp);
    const target = path.join(dir, path.basename(String(name || '新建文件夹')));
    if (fs.existsSync(target)) throw new Error('同名项目已存在');
    fs.mkdirSync(target, { recursive: false });
    return list(vp);
  }
  function createFile(vp, name, content) {
    const dir = ensureDir(vp);
    const target = path.join(dir, path.basename(String(name || '未命名.txt')));
    if (fs.existsSync(target)) throw new Error('同名项目已存在');
    fs.writeFileSync(target, content === undefined ? '' : content, 'utf8');
    return list(vp);
  }
  function rename(vp, from, to) {
    const dir = ensureDir(vp);
    const a = path.join(dir, path.basename(String(from)));
    const b = path.join(dir, path.basename(String(to)));
    if (!fs.existsSync(a)) throw new Error('源文件不存在');
    if (fs.existsSync(b)) throw new Error('目标名称已存在');
    fs.renameSync(a, b);
    return list(vp);
  }
  function moveToTrash(vp, name) {
    const dir = ensureDir(vp);
    const src = path.join(dir, path.basename(String(name)));
    if (!fs.existsSync(src)) throw new Error('文件不存在');
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const dst = path.join(trashDir, id + '__' + path.basename(src));
    try { fs.renameSync(src, dst); }
    catch (e) {
      // 跨盘符：复制后删除
      const st = fs.statSync(src);
      if (st.isDirectory()) throw new Error('跨盘符移动文件夹失败: ' + e.message);
      fs.copyFileSync(src, dst); fs.unlinkSync(src);
    }
    const st = fs.statSync(dst);
    trash.unshift({
      id, n: path.basename(src), from: vp, real: dst, time: fmtTime(Date.now()),
      sz: st.size, t: typeOf(path.basename(src), st.isDirectory()), isDir: st.isDirectory()
    });
    saveTrash();
    return { trash: trashList(), files: list(vp) };
  }
  function trashList() {
    return trash.map(x => ({ id: x.id, n: x.n, from: x.from, sz: x.sz, time: x.time, t: x.t }));
  }
  function trashRestore(id) {
    const i = trash.findIndex(x => x.id === id);
    if (i < 0) throw new Error('回收站中没有该项目');
    const x = trash[i];
    let target = path.join(toReal(x.from).real || sharesRoot, x.n);
    if (fs.existsSync(target)) {
      const ext = path.extname(x.n), base = path.basename(x.n, ext);
      target = path.join(path.dirname(target), base + '_还原_' + Date.now().toString(36) + ext);
    }
    try { fs.renameSync(x.real, target); }
    catch (e) { fs.copyFileSync(x.real, target); fs.unlinkSync(x.real); }
    trash.splice(i, 1); saveTrash();
    return trashList();
  }
  function trashPurge(id) {
    const i = trash.findIndex(x => x.id === id);
    if (i < 0) throw new Error('回收站中没有该项目');
    const x = trash[i];
    try { fs.rmSync(x.real, { recursive: true, force: true }); } catch (e) {}
    trash.splice(i, 1); saveTrash();
    return trashList();
  }
  function trashClear() {
    for (const x of trash) { try { fs.rmSync(x.real, { recursive: true, force: true }); } catch (e) {} }
    trash = []; saveTrash();
    return [];
  }
  /* 侧栏目录树：全部是这台机器上真实存在的路径 */
  function tree() {
    const out = [{ p: '/', n: '此电脑', d: 0 }];
    for (const d of realRootInfo()) {
      out.push({ p: d.vpath, n: d.drive + ' 本地磁盘' + (d.total ? ' (' + fmtSizeNative(d.total) + ')' : ''), d: 1, drive: true });
    }
    const home = process.env.USERPROFILE || '';
    if (home) {
      const hp = '/' + home.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:');
      out.push({ p: hp, n: '用户主目录', d: 1, real: true });
      for (const sub of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']) {
        const full = path.join(home, sub);
        if (fs.existsSync(full)) out.push({ p: hp + '/' + sub, n: sub, d: 2, real: true });
      }
    }
    /* 「此电脑」目录树只列真实 Windows 路径；项目内共享目录不再出现，
       仍可通过 /Public 等路径单独访问（toReal 映射保留）。 */
    return out;
  }
  function fmtSizeNative(n) {
    if (!Number.isFinite(n) || n <= 0) return 'N/A';
    if (n < 1073741824) return (n / 1048576).toFixed(0) + ' MB';
    return (n / 1073741824).toFixed(1) + ' GB';
  }
  /* 真实文件搜索：共享目录递归 + 指定绝对路径的浅层扫描 */
  function search(q, max = 120) {
    q = String(q || '').toLowerCase().trim();
    if (!q) return [];
    const hits = [];
    const roots = [sharesRoot];
    const walk = (dir, depth, vprefix) => {
      if (hits.length >= max || depth > 5) return;
      let list;
      try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const d of list) {
        if (hits.length >= max) break;
        const full = path.join(dir, d.name);
        const v = vprefix + '/' + d.name;
        if (d.name.toLowerCase().includes(q)) {
          let sz = 0; try { sz = fs.statSync(full).size; } catch (e) {}
          hits.push({ n: d.name, p: v, sz, t: typeOf(d.name, d.isDirectory()) });
        }
        if (d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules' && d.name !== 'trash') walk(full, depth + 1, v);
      }
    };
    walk(sharesRoot, 0, '');
    return hits;
  }
  function resolveUpload(vp, name) {
    const dir = ensureDir(vp);
    const target = path.join(dir, path.basename(String(name || 'upload.bin')));
    return target;
  }
  function resolveRead(vp, name) {
    const r = toReal(vp);
    if (r.virtual) throw new Error('根目录没有文件');
    const p = name ? path.join(r.real, path.basename(String(name))) : r.real;
    if (!fs.existsSync(p)) throw new Error('文件不存在');
    const st = fs.statSync(p);
    if (!st.isFile()) throw new Error('不是文件');
    return p;
  }

  return {
    sharesRoot, trashDir, list, stat, mkdir, createFile, rename, moveToTrash,
    trashList, trashRestore, trashPurge, trashClear, tree, search,
    toReal, parentV, resolveUpload, resolveRead, drives, SHARES, typeOf, realRootInfo
  };
}

module.exports = { initFiles, typeOf };
