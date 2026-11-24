'use strict';
/* ============================================================
 * winnas.js — WinNAS 引擎桥接层
 *
 * 定位：桌面「只负责可视化 Windows 的一切功能」，文件、回收站、
 * 快照、压缩、搜索、分享这些能力不另造一套，直接复用已装在本机的
 * WinNAS 项目（默认 C:\AI使用\项目\NasManager）的同一份源码模块、同一份数据目录、
 * 同一套路径规则。文件始终保存在 Windows 本机磁盘上。
 *
 * 复用模块（全部用绝对路径 require，不改 WinNAS 一行代码）：
 *   config.js     ROOTS / DATA_DIR / USER_HOME_BASE / SYSTEM_DRIVES
 *   paths.js      resolveWithin 防越界（__computer__ / __home__ / 静态根）
 *   recycle.js    Windows 系统回收站：Shell.Application NameSpace(10) 列举、
 *                 SHFileOperation(FOF_ALLOWUNDO) 删除、$R/$I 还原与清除
 *   versions.js   文件版本快照（DATA_DIR/versions，可列/读/还原/删除）
 *   archive.js    zip / tgz 压缩解压（含 WinZip-AES）
 *   search.js     名称索引 + 全文内容搜索（异步分块，不冻结事件循环）
 *   thumbnails.js 图片/视频缩略图（sharp + ffmpeg，带并发队列与缓存）
 *   share.js      分享链接（有效期 / 密码 / 撤销 / 续期）
 *   favorites.js / dedup.js / office.js / jobs.js
 *
 * 原则：引擎不可用 → available:false + 明确原因，绝不回落到模拟数据；
 * 读不到的字段一律 N/A。高危操作（清空回收站）只由前端二次确认后触发。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const COMPUTER_ROOT = '__computer__';
const HOME_ROOT = '__home__';

function initWinNas(opts) {
  opts = opts || {};
  /* 引擎位置解析：优先设置窗口指定的 WINNAS_HOME，其次本机 C:\AI使用\项目\NasManager，
     再扫描其它盘符，最后回落随 exe 一起分发的 vendor\winnas。
     这样打包成 exe 后即使换一台机器、或 WinNAS 装在 E 盘，也能找到同一份
     WinNAS 实现（NasDeck 始终坚持复用，不另造平行实现）。 */
  function resolveHome() {
    const cands = [];
    if (process.env.WINNAS_HOME) cands.push(process.env.WINNAS_HOME);
    cands.push('C:\\AI使用\\项目\\NasManager');
    for (let i = 67; i <= 90; i++) cands.push(String.fromCharCode(i) + ':\\NasManager');
    cands.push(path.join(__dirname, '..', 'vendor', 'winnas'));
    cands.push(path.join(__dirname, '..', '..', 'NasManager'));
    for (const c of cands) {
      try {
        if (!c) continue;
        if (fs.existsSync(path.join(c, 'config.js')) || fs.existsSync(path.join(c, 'src', 'config.js'))) return path.resolve(c);
      } catch (e) { /* 候选不可读则继续尝试下一个 */ }
    }
    return path.resolve(process.env.WINNAS_HOME || 'C:\\AI使用\\项目\\NasManager');
  }
  const home = resolveHome();
  /* 项目自带的共享目录（Public / Multimedia / …）也是 Windows 上的真实目录，
     按 WinNAS 的 ROOTS 机制注册为静态根，而不是另造一套虚拟路径映射。 */
  const shareRoots = opts.shareRoots || {};
  const S = {
    available: false, home, reason: '', dataDir: '', rootsInjected: false,
    engine: 'WinNAS', version: 'N/A', modules: [], recycleSource: 'N/A'
  };
  let M = null;
  try {
    const R = p => require(path.join(home, p));
    M = {
      config: R('config.js'),
      paths: R('src/paths.js'),
      recycle: R('src/recycle.js'),
      versions: R('src/versions.js'),
      archive: R('src/archive.js'),
      search: R('src/search.js'),
      thumbnails: R('src/thumbnails.js'),
      share: R('src/share.js'),
      favorites: R('src/favorites.js'),
      dedup: R('src/dedup.js'),
      office: R('src/office.js'),
      jobs: R('src/jobs.js'),
      userctx: R('src/userctx.js')
    };
    S.modules = Object.keys(M);
    S.dataDir = M.config.dataDir;
    S.recycleSource = 'Windows 回收站 · Shell.Application / SHFileOperation';
    S.available = true;
    try { S.version = JSON.parse(fs.readFileSync(path.join(home, 'package.json'), 'utf8')).version || 'N/A'; }
    catch (e) { S.version = 'N/A'; }
  } catch (e) {
    S.reason = 'WinNAS 引擎加载失败：' + e.message;
    return stub(S);
  }

  /* NasDeck 单入口以管理员身份运行；与 WinNAS 的 admin 语义一致。
     userctx 承载当前用户，供 paths.resolveWithin 解析 __home__。 */
  const USER = { username: 'admin', role: 'admin', roots: [], perms: { read: true, write: true, delete: true } };
  const withUser = fn => M.userctx.run(USER, fn);

  /* WinNAS 的 recycle.doDelete / versions.snapshot 依赖 ROOTS 判定归属。
     本项目以「此电脑 + 真实盘符」为文件视图，故把本机盘符作为静态根注入
     同一个 ROOTS 对象（setRoots 是原地清空重填，其它模块持有的引用同步生效）。
     这样删除一定能进系统回收站、文件版本快照也一定有归属；ROOTS 里
     原有的自定义共享目录全部保留。此操作只在 NasDeck 进程内生效，不写 WinNAS 配置。 */
  function injectDriveRoots() {
    const keep = [];
    for (const [k, v] of Object.entries(shareRoots)) keep.push(k + ':' + v);
    for (const [k, v] of Object.entries(M.config.ROOTS)) {
      if (!/^[A-Za-z]$/.test(k) && !shareRoots[k]) keep.push(k + ':' + v);
    }
    const disks = [];
    for (let i = 65; i <= 90; i++) {
      const L = String.fromCharCode(i), root = L + ':\\';
      try { if (fs.existsSync(root)) disks.push(L + ':' + root); } catch (e) { /* 不可读盘符跳过 */ }
    }
    M.config.setRoots(keep.concat(disks).join(';'));
    S.rootsInjected = true;
    return disks;
  }
  injectDriveRoots();
  try { M.share.init(M.config.dataDir); } catch (e) { /* 分享数据目录不可写时如实报错 */ }

  /* 真实盘符 + 真实容量（fs.statfsSync，读不到给 0，不编造） */
  function drives() {
    const out = [];
    for (let i = 65; i <= 90; i++) {
      const L = String.fromCharCode(i), root = L + ':\\';
      let size = 0, free = 0, ready = false;
      try {
        if (fs.existsSync(root)) {
          ready = true;
          const st = fs.statfsSync(root);
          size = Number(st.blocks) * Number(st.bsize);
          free = Number(st.bavail) * Number(st.bsize);
        }
      } catch (e) { ready = fs.existsSync(root); }
      if (ready) out.push({ key: L, name: L + ':', size, free, type: 'Fixed', ready: true });
    }
    return out;
  }
  M.search.setListDrives(() => drives());

  /* 文件总管的顶层视图只呈现「此电脑（本机硬盘盘符）」+「我的空间」。
     项目内部的静态共享根（Container / homes / Public / Multimedia / …）以及
     Windows 用户主目录都不作为可浏览入口暴露；它们仍保留在 M.config.ROOTS
     里，供回收站归属判定、版本快照与分享等底层功能使用，不破坏既有链路。 */
  function roots() {
    const out = [{ key: COMPUTER_ROOT, path: '此电脑', label: '此电脑', systemDrive: false }];
    const h = M.paths.homePathFor(USER);
    if (h) out.push({ key: HOME_ROOT, path: h, label: '我的空间 (admin)', systemDrive: false });
    return out;
  }

  /* NasDeck 虚拟路径 → WinNAS 的 root + sub
       /                → __computer__ / ''
       /C:/Windows/...  → __computer__ / 'C:/Windows/...'
       /__home__/x      → __home__ / 'x'
       /<静态根>/...    → <静态根> / '...'                                */
  function vpath(vp) {
    const s = String(vp || '/').replace(/\\/g, '/');
    const seg = s.split('/').filter(Boolean);
    if (!seg.length) return { root: COMPUTER_ROOT, sub: '' };
    if (/^[A-Za-z]:$/.test(seg[0])) return { root: COMPUTER_ROOT, sub: seg.join('/') };
    if (seg[0] === HOME_ROOT || M.config.ROOTS[seg[0]]) {
      return { root: seg[0], sub: seg.slice(1).join('/') };
    }
    return { root: seg[0], sub: seg.slice(1).join('/') };
  }
  function resolve(root, sub) {
    return withUser(() => M.paths.resolveWithin(root || COMPUTER_ROOT, sub || '', USER));
  }
  function absOf(root, sub) {
    const a = resolve(root, sub);
    if (!a || a === M.paths.COMPUTER_SENTINEL) throw new Error('路径无效或不允许越界');
    return a;
  }
  function hiddenName(n) {
    return n.startsWith('.') || n.toLowerCase().endsWith('.bak') || n.startsWith('$') ||
      n === 'desktop.ini' || n === 'System Volume Information';
  }
  function mtimeStr(ms) {
    if (!ms) return 'N/A';
    const d = new Date(ms), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* 列目录：与 WinNAS /api/list 同规则（隐藏过滤 / 收藏标记 / 排序 / 分页） */
  function list(root, sub, o) {
    o = o || {};
    return withUser(() => {
      const abs = resolve(root, sub);
      if (abs === M.paths.COMPUTER_SENTINEL) {
        const ds = drives();
        return {
          path: '此电脑', abs: '', computer: true, drives: ds,
          entries: ds.map(d => ({ name: d.name, isDir: true, size: d.size, mtime: 0, free: d.free, hidden: false, favorited: false })),
          total: ds.length, page: 1, pageSize: ds.length || 1
        };
      }
      if (!abs) throw new Error('路径无效或越界');
      if (!fs.existsSync(abs)) throw new Error('路径不存在：' + abs);
      if (!fs.statSync(abs).isDirectory()) throw new Error('不是目录：' + abs);
      const showHidden = !!o.showHidden;
      const baseRel = sub || '';
      let entries = [];
      let dirents;
      try { dirents = fs.readdirSync(abs, { withFileTypes: true }); }
      catch (e) {
        /* Windows 的系统保护目录 / 旧版 junction（如 C:\Documents and Settings）
           会直接 EPERM。过去整条 /api/files/list 变成 400，界面报「无法打开目录」。
           这里如实返回「拒绝访问」而不是伪造空目录，界面可以正常导航与提示。 */
        return {
          path: abs, abs, root, sub: baseRel, entries: [], total: 0, page: 1,
          pageSize: 200, restricted: true,
          error: e.code === 'EPERM' ? 'Windows 拒绝访问该目录（系统保护或权限不足）'
            : (e.code === 'ENOENT' ? '路径不存在：' + abs : e.message)
        };
      }
      for (const d of dirents) {
        let st = null;
        try { st = fs.statSync(path.join(abs, d.name)); } catch (e) { /* 占用文件跳过 */ }
        const isDir = st ? st.isDirectory() : !!d.isDirectory();
        const rel = baseRel ? baseRel.replace(/\/$/, '') + '/' + d.name : d.name;
        entries.push({
          name: d.name, isDir, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0,
          hidden: hiddenName(d.name), favorited: M.favorites.has(root, rel)
        });
      }
      if (!showHidden) entries = entries.filter(e => !e.hidden);
      const sk = o.sort || '', dir = o.sortDir === '-1' ? -1 : 1;
      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        if (!sk) return a.name.localeCompare(b.name, 'zh-CN');
        if (sk === 'size') return dir * ((a.size || 0) - (b.size || 0));
        if (sk === 'mtime') return dir * ((a.mtime || 0) - (b.mtime || 0));
        return dir * a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
      const pageSize = Math.min(Math.max(parseInt(o.pageSize || 200, 10) || 200, 1), 1000);
      const page = Math.max(parseInt(o.page || 1, 10) || 1, 1);
      return { path: abs, abs, root, sub: baseRel, entries: entries.slice((page - 1) * pageSize, page * pageSize),
        total: entries.length, page, pageSize };
    });
  }

  function stat(root, sub) {
    const abs = absOf(root, sub);
    if (!fs.existsSync(abs)) throw new Error('路径不存在：' + abs);
    /* 与 WinNAS /api/stat 同逻辑，但加遍历上限，避免对 C:\Windows 这类
       巨型目录做无界递归把服务卡死；截断时如实返回 truncated:true。 */
    const MAX = 20000, MAXDEPTH = 16;
    let size = 0, files = 0, dirs = 0, visited = 0, truncated = false;
    (function walk(p, depth) {
      if (depth > MAXDEPTH) { truncated = true; return; }
      if (++visited > MAX) { truncated = true; return; }
      let st; try { st = fs.statSync(p); } catch (e) { return; }
      if (!st.isDirectory()) { size += st.size; files++; return; }
      dirs++;
      let ents; try { ents = fs.readdirSync(p); } catch (e) { return; }
      for (const n of ents) walk(path.join(p, n), depth + 1);
    })(abs, 0);
    const st = fs.statSync(abs);
    return { path: abs, size, files, dirs, isDir: st.isDirectory(), mtime: st.mtimeMs,
      ctime: st.ctimeMs, truncated, visited };
  }

  /* 路径归属：给版本快照用（返回 ROOTS 里的 key 与相对路径） */
  function owner(abs) {
    for (const [k, r] of Object.entries(M.config.ROOTS)) {
      const rel = path.relative(r, abs);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { rootKey: k, rel };
    }
    return null;
  }

  /* ---------------- 文件操作（全部落在 Windows 真实磁盘） ---------------- */
  function mkdir(root, sub, name) {
    const abs = absOf(root, sub);
    const target = path.join(abs, path.basename(String(name || '')));
    if (path.dirname(path.resolve(target)) !== path.resolve(abs)) throw new Error('非法文件名');
    fs.mkdirSync(target, { recursive: false });
    return { path: target };
  }
  function createFile(root, sub, name, content) {
    const abs = absOf(root, sub);
    const target = path.join(abs, path.basename(String(name || '')));
    if (path.dirname(path.resolve(target)) !== path.resolve(abs)) throw new Error('非法文件名');
    if (fs.existsSync(target)) throw new Error('文件已存在');
    fs.writeFileSync(target, content == null ? '' : String(content), 'utf8');
    return { path: target };
  }
  function rename(root, sub, from, to) {
    const abs = absOf(root, sub);
    const src = path.join(abs, path.basename(String(from || '')));
    const dst = path.join(abs, path.basename(String(to || '')));
    if (!fs.existsSync(src)) throw new Error('源文件不存在');
    if (fs.existsSync(dst)) throw new Error('目标名称已存在');
    fs.renameSync(src, dst);
    return { from: src, to: dst };
  }
  function moveOrCopy(srcRoot, srcSub, items, destRoot, destSub, mode) {
    const srcDir = absOf(srcRoot, srcSub);
    const dstDir = absOf(destRoot || srcRoot, destSub || '');
    if (!fs.statSync(dstDir).isDirectory()) throw new Error('目标不是目录');
    const out = [];
    for (const n of (items || [])) {
      const src = path.join(srcDir, path.basename(String(n || '')));
      let dst = path.join(dstDir, path.basename(String(n || '')));
      if (!fs.existsSync(src)) { out.push({ name: n, ok: false, error: 'NOT_FOUND' }); continue; }
      /* 同目录「复制→粘贴」：Windows 会生成「xxx - 副本.ext」，
         这里同样处理，避免 fs.cpSync 报 src and dest cannot be the same。 */
      if (mode === 'copy' && path.resolve(src) === path.resolve(dst)) {
        const ext = path.extname(src), base = path.basename(src, ext);
        let i = 1, candidate = path.join(dstDir, base + ' - 副本' + ext);
        while (fs.existsSync(candidate) && i < 100) candidate = path.join(dstDir, base + ' - 副本 (' + (++i) + ')' + ext);
        dst = candidate;
      }
      try {
        if (mode === 'copy') fs.cpSync(src, dst, { recursive: true, force: false });
        else {
          try { fs.renameSync(src, dst); }
          catch (e) { fs.cpSync(src, dst, { recursive: true }); fs.rmSync(src, { recursive: true, force: true }); }
        }
        out.push({ name: n, ok: true, to: dst, as: path.basename(dst) });
      } catch (e) { out.push({ name: n, ok: false, error: e.message }); }
    }
    return { results: out };
  }
  /* 删除 = 送进 Windows 系统回收站（WinNAS recycle.doDelete 的同一实现） */
  async function remove(root, sub, name) {
    const abs = absOf(root, sub);
    const target = path.join(abs, path.basename(String(name || '')));
    if (path.dirname(path.resolve(target)) !== path.resolve(abs)) throw new Error('非法文件名');
    if (!fs.existsSync(target)) throw new Error('文件不存在');
    const r = await M.recycle.doDelete(target);
    if (!r.ok) throw new Error('送回收站失败：' + (r.error || '未知原因'));
    invalidateBin();
    return { path: target, method: S.recycleSource };
  }
  /* 文本文件写入前生成版本快照（与 WinNAS PUT /api/file 完全一致） */
  function writeFile(root, sub, content) {
    const abs = absOf(root, sub);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) throw new Error('不是文件');
    const own = owner(abs);
    if (own) { try { M.versions.snapshot(own.rootKey, own.rel, fs.readFileSync(abs)); } catch (e) {} }
    fs.writeFileSync(abs, content == null ? '' : String(content), 'utf8');
    return { path: abs, snapshot: !!own };
  }

  /* ---------------- 系统回收站（WinNAS 实现 + 缓存） ----------------
     Shell.Application 列举 1.4 万项并逐项统计体积可能较慢，因此：
     后台预热 + 90 秒缓存 + 首次请求 12 秒内不返回就先给 loading 状态，
     绝不因为慢就回落到假数据。 */
  let binCache = null, binAt = 0, binBusy = null;
  const BIN_TTL = 90000;
  function binShape(items) {
    const used = items.reduce((n, x) => n + (Number(x.size) || 0), 0);
    return {
      items: items.map(x => {
        let isDir = false;
        try { isDir = fs.statSync(x.id).isDirectory(); } catch (e) { /* 已清除的条目 */ }
        const sz = Number(x.size) || 0;
        const dm = String(x.id || '').match(/^([A-Za-z]):/);
        return {
          id: x.id, n: x.name, name: x.name,
          from: x.originalPath || 'N/A', originalPath: x.originalPath || 'N/A', root: x.root || '',
          sz, size: sz, sizeText: fmtSize(sz),
          time: mtimeStr(x.deletedAt), deletedAt: x.deletedAt || 0,
          drive: dm ? dm[1] + ':' : 'N/A', isDir, t: isDir ? '文件夹' : '文件'
        };
      }),
      total: items.length, used, usedText: fmtSize(used),
      source: S.recycleSource, loading: false, truncated: false,
      roots: ['Windows Shell 命名空间 NameSpace(10)', '各盘 $Recycle.Bin（由系统回收站统一管理）']
    };
  }
  function invalidateBin() { binCache = null; binAt = 0; }
  /* 只读缓存快照，绝不触发扫描、绝不等待 —— 给 /api/bootstrap 用，保证登录不被拖慢 */
  function binPeek() {
    return binCache || {
      items: [], total: 0, used: 0, usedText: 'N/A', source: S.recycleSource,
      loading: true, message: '正在扫描 Windows 回收站…', truncated: false, roots: []
    };
  }
  function scanBin() {
    if (binBusy) return binBusy;
    binBusy = (async () => {
      try { const items = await M.recycle.doList(); binCache = binShape(items); binAt = Date.now(); }
      catch (e) { binCache = { items: [], total: 0, used: 0, usedText: 'N/A', source: S.recycleSource, loading: false, error: e.message }; binAt = Date.now(); }
      finally { binBusy = null; }
      return binCache;
    })();
    return binBusy;
  }
  async function binList(force) {
    if (!force && binCache && Date.now() - binAt < BIN_TTL) return binCache;
    if (force) invalidateBin();
    const p = binBusy || scanBin();
    const fast = await Promise.race([p, new Promise(r => setTimeout(() => r(null), 12000))]);
    return fast || {
      items: [], total: 0, used: 0, usedText: 'N/A', source: S.recycleSource,
      loading: true, message: '正在扫描 Windows 回收站（条目较多，稍后自动刷新）…',
      truncated: false, roots: []
    };
  }
  function binItem(id) {
    return (binCache && binCache.items || []).find(x => x.id === id) || null;
  }
  async function binRestore(id) {
    const it = binItem(id) || (await scanBin()).items.find(x => x.id === id);
    if (!it) throw new Error('回收站中找不到该项目，请先刷新');
    const r = await M.recycle.doRestore(it.id, it.originalPath === 'N/A' ? '' : it.originalPath, it.name);
    invalidateBin();
    if (!r.ok) throw new Error(r.error || '还原失败');
    return r;
  }
  async function binPurge(id) {
    const r = await M.recycle.doPurge(id);
    invalidateBin();
    if (!r.ok) throw new Error(r.error || '永久删除失败');
    return r;
  }
  /* 危险：清空真实 Windows 回收站，仅由前端二次确认后调用 */
  async function binClear() {
    const r = await new Promise((resolve, reject) => M.recycle.run('purge', null, (e, d) => e ? reject(e) : resolve(d)));
    invalidateBin();
    return r;
  }

  /* ---------------- 文件版本快照（WinNAS 实现） ---------------- */
  function versionList(root, sub) {
    const own = owner(absOf(root, sub));
    if (!own) return [];
    return M.versions.list(own.rootKey, own.rel).map(v => ({
      name: v.name, size: v.size, time: v.time, t: mtimeStr(v.time), rootKey: own.rootKey, rel: own.rel
    }));
  }
  function versionRestore(root, sub, name) {
    const own = owner(absOf(root, sub));
    if (!own) throw new Error('该文件不在受管根目录内，无版本快照');
    const r = M.versions.restore(own.rootKey, own.rel, path.basename(String(name || '')));
    if (!r.ok) throw new Error(r.error || '还原失败');
    return r;
  }
  function versionRead(root, sub, name) {
    const own = owner(absOf(root, sub));
    if (!own) throw new Error('该文件不在受管根目录内');
    return M.versions.read(own.rootKey, own.rel, path.basename(String(name || '')));
  }
  function versionRemove(root, sub, name) {
    const own = owner(absOf(root, sub));
    if (!own) throw new Error('该文件不在受管根目录内');
    return M.versions.remove(own.rootKey, own.rel, path.basename(String(name || '')));
  }
  /* 手动为任意文件生成一次版本快照（存储与快照面板「立即创建」） */
  function versionCreate(root, sub) {
    const abs = absOf(root, sub);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) throw new Error('只能为文件创建版本快照');
    const own = owner(abs);
    if (!own) throw new Error('该文件不在受管根目录内');
    M.versions.snapshot(own.rootKey, own.rel, fs.readFileSync(abs));
    return versionList(root, sub);
  }

  /* ---------------- 压缩 / 解压 / 搜索 / 分享 / 收藏 / 去重 ---------------- */
  async function compress(root, sub, items, outName, password) {
    const dir = absOf(root, sub);
    const src = (items || []).map(n => ({ abs: path.join(dir, path.basename(String(n || ''))), entryName: path.basename(String(n || '')) }))
      .filter(x => fs.existsSync(x.abs));
    if (!src.length) throw new Error('没有可压缩的文件');
    const out = path.join(dir, path.basename(String(outName || ('archive_' + Date.now() + '.zip'))));
    await M.archive.zipItems(src, out, password ? { password } : {});
    return { path: out, size: fs.statSync(out).size, count: src.length };
  }
  async function extract(root, sub, name, destSub, password) {
    const dir = absOf(root, sub);
    const abs = path.join(dir, path.basename(String(name || '')));
    const dest = destSub ? absOf(root, destSub) : path.join(dir, path.basename(name, path.extname(name)));
    fs.mkdirSync(dest, { recursive: true });
    await M.archive.extractArchive(abs, dest, password ? { password } : {});
    return { path: dest };
  }
  async function archiveList(root, sub) {
    return M.archive.listArchive(absOf(root, sub));
  }
  async function search(q, o) {
    o = o || {};
    const root = o.root || '';
    const limit = o.limit || 200;
    /* WinNAS 的 __computer__ 实时遍历会走遍所有盘（分块但仍可能几分钟），
       过去前端「全盘搜索」直接卡死 60 秒无响应。改为：先用 WinNAS 的
       名称索引（同一份 search.js 实现）；索引为空时后台开始建索引并
       立刻返回 indexing:true，绝不把 HTTP 请求挂住，也绝不编造结果。 */
    const st = M.search.getStatus();
    if ((!root || root === COMPUTER_ROOT) && !st.count) {
      /* 不再自动触发全盘 rebuild：那会在用户点一次搜索时把整台机器的
         磁盘遍历起来（CPU/IO 打满）。改为明确告知需要建索引，由界面按钮触发。 */
      return {
        ok: true, results: [], total: 0, indexing: !!st.building, needsIndex: !st.building,
        status: st,
        message: st.building ? '本机名称索引正在后台构建（WinNAS search.js），完成后重试即可。'
          : '本机名称索引尚未建立；点「建立名称索引」（后台分块执行，不阻塞界面）后再搜索。'
      };
    }
    const list = await M.search.query({ q, root: root === COMPUTER_ROOT ? '' : root, ext: o.ext, limit }, USER);
    return { ok: true, results: list || [], total: (list || []).length, indexing: false, status: M.search.getStatus(), message: '' };
  }
  async function searchContent(q, o) {
    return M.search.searchContent(q, o || {}, USER);
  }
  async function thumbnail(root, sub) {
    return M.thumbnails.getThumbnail(root, sub, absOf(root, sub));
  }
  function shares() { return M.share.listShares(); }
  function shareAdd(o) { return M.share.addShare(o || {}); }
  function favoritesList() { return M.favorites.all(); }
  function dedup(root) { return M.dedup.findDuplicates(root || COMPUTER_ROOT); }
  async function officePreview(root, sub) {
    const abs = absOf(root, sub), ext = path.extname(abs).toLowerCase();
    const kind = ext === '.docx' ? 'docx' : (ext === '.xlsx' || ext === '.xls' ? 'xlsx' : null);
    if (!kind) throw new Error('仅支持 docx / xlsx 预览');
    return M.office.preview(abs, kind);
  }

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB', 'PB']; let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2) + ' ' + u[i];
  }

  function status() {
    return {
      available: S.available, home: S.home, reason: S.reason, version: S.version,
      dataDir: S.dataDir, engine: S.engine, modules: S.modules,
      roots: roots().length, drives: drives().length, rootsInjected: S.rootsInjected,
      recycleSource: S.recycleSource,
      bin: { cached: !!binCache, ageMs: binCache ? Date.now() - binAt : null, scanning: !!binBusy },
      search: M.search.getStatus(), sharp: M.thumbnails.hasSharp,
      fileVersionDir: path.join(M.config.dataDir, 'versions')
    };
  }

  /* 服务启动后后台预热回收站（不阻塞登录）；扫描完成通过回调推 SSE */
  function warm(onDone) {
    setTimeout(() => {
      /* 等扫描真正完成再推送，12 秒的「请求超时」不算完成 */
      scanBin().then(b => { if (onDone) { try { onDone(b); } catch (e) {} } }).catch(() => {});
    }, 3500);
  }

  return {
    available: true, home, state: S, status, warm, fmtSize,
    COMPUTER_ROOT, HOME_ROOT, USER, withUser,
    drives, roots, vpath, resolve, absOf, list, stat, owner, mtimeStr,
    mkdir, createFile, rename, moveOrCopy, remove, writeFile,
    binList, binPeek, binRestore, binPurge, binClear, invalidateBin, binShape,
    versionList, versionRestore, versionRead, versionRemove, versionCreate,
    compress, extract, archiveList, search, searchContent, thumbnail,
    shares, shareAdd, favoritesList, dedup, officePreview,
    jobs: M.jobs, share: M.share, favorites: M.favorites, versions: M.versions,
    archive: M.archive, searchEngine: M.search, recycle: M.recycle
  };
}

/* 引擎不可用时的诚实降级：只报原因，不提供任何模拟数据 */
function stub(S) {
  const no = () => { throw new Error(S.reason || 'WinNAS 引擎不可用'); };
  return {
    available: false, home: S.home, state: S, status: () => S, warm: () => {},
    fmtSize: () => 'N/A', COMPUTER_ROOT, HOME_ROOT, USER: null,
    withUser: no, drives: () => [], roots: () => [], vpath: () => ({ root: COMPUTER_ROOT, sub: '' }),
    resolve: () => null, absOf: no, list: no, stat: no, owner: () => null, mtimeStr: () => 'N/A',
    mkdir: no, createFile: no, rename: no, moveOrCopy: no, remove: no, writeFile: no,
    binList: async () => ({ items: [], total: 0, used: 0, usedText: 'N/A', source: 'N/A', loading: false, error: S.reason }),
    binPeek: () => ({ items: [], total: 0, used: 0, usedText: 'N/A', source: 'N/A', loading: false, error: S.reason }),
    binRestore: no, binPurge: no, binClear: no, invalidateBin: () => {}, binShape: () => ({ items: [] }),
    versionList: () => [], versionRestore: no, versionRead: no, versionRemove: no, versionCreate: no,
    compress: no, extract: no, archiveList: no, search: async () => [],
    searchContent: async () => [], thumbnail: no, shares: () => [], shareAdd: no,
    favoritesList: () => [], dedup: () => [], officePreview: no
  };
}

module.exports = { initWinNas };
