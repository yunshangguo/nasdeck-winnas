'use strict';
/* WinNAS search.js 的全盘遍历：默认每 1000 项只休眠 2ms，在文件很多的机器上
   会把 CPU / 磁盘 IO 打满，连带拖慢整个 桌面界面。这里放慢到 20ms/1000 项，
   仍是同一份 WinNAS 实现，不改变其行为，只降低对本机的影响。 */
if (!process.env.SEARCH_THROTTLE_MS) process.env.SEARCH_THROTTLE_MS = '20';
/* ============================================================
 * NasDeck 2.5 Web Desktop — Windows 原生后端（零第三方依赖）
 * 启动: node server.js    默认 http://127.0.0.1:5080
 * 环境变量: PORT / HOST / NasDeck_USER / NasDeck_PASSWORD / NasDeck_DOCKER_HOST / NasDeck_DOCKER_PORT
 *
 * 全部数据来自真实 Windows：CIM / PowerShell / 性能计数器 / 事件日志 /
 * robocopy / winget / Docker Engine(WSL) / aria2。不编造任何硬件或容器数据。
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { createApp, json, streamFile } = require('./lib/core');
const { Store } = require('./lib/store');
const { initAuth } = require('./lib/auth');
const sysinfo = require('./lib/sysinfo');
const windows = require('./lib/windows');
const { initWsl } = require('./lib/wsl');
const { initMonitor } = require('./lib/monitor');
const { initBackups, initAria2, fmt: fmtSize } = require('./lib/extras');
const { initFiles } = require('./lib/files');
const { initTerminal, initDownloads, initMedia } = require('./lib/services');
const { initWinNas } = require('./lib/winnas');
const { createBoot } = require('./lib/boot');
const { initPlugins } = require('./lib/plugins');

/* 启动编排器在「启动」段赋值；health / boot 状态接口在 listen 之后才会被调用，
   这里用可空变量避免任何 TDZ 风险。 */
let BOOT = null;

const ROOT = __dirname;
/* 数据目录默认仍落在项目内（node server.js 直跑行为不变）；
   桌面 exe 会在 require 本文件之前注入 NasDeck_DATA_DIR，指向 userData/data，
   保证打包态可写、且关闭重开后用户/日志/设置都还在。 */
const DATA = path.resolve(process.env.NasDeck_DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DATA, { recursive: true });

const auth = initAuth(DATA);
const files = initFiles(DATA);
/* 项目共享目录按 WinNAS 的 ROOTS 机制注册为静态根（真实 Windows 目录） */
const shareRoots = {};
try {
  for (const d of fs.readdirSync(files.sharesRoot, { withFileTypes: true })) {
    if (d.isDirectory() && !/^[A-Za-z]$/.test(d.name)) shareRoots[d.name] = path.join(files.sharesRoot, d.name);
  }
} catch (e) { /* 共享目录不可读时不注册，不影响其它能力 */ }
/* 文件 / 回收站 / 版本快照 / 压缩 / 搜索 / 分享统一走既有 WinNAS 项目的实现，
   NasDeck 这一层只做 Windows 功能的可视化与 Web 远程管理，不另造平行实现。 */
const winnas = initWinNas({ shareRoots });
if (!winnas.available) console.error('[WinNAS] ' + winnas.state.reason);
else console.log('[WinNAS] engine=' + winnas.home + ' v' + winnas.state.version + ' modules=' + winnas.state.modules.length);
const terminal = initTerminal();
const wsl = initWsl(process.env.NasDeck_DOCKER_HOST ? {
  host: process.env.NasDeck_DOCKER_HOST, port: Number(process.env.NasDeck_DOCKER_PORT || 2375)
} : null);
const settings = new Store(DATA, 'settings', {
  theme: 'dark', wall: 'blue', accent: '#22a7e8', bright: 100, volume: 65,
  widgets: true, installed: null, fw: null, cloud: null, hbs: null, cp: null,
  net: null, mediaRoots: null, wslEndpoint: null, aria2: null, thresholds: null
});
const logStore = new Store(DATA, 'logs', { logs: [] });
const notiStore = new Store(DATA, 'notis', { notis: [] });
/* 插件中心：项目功能 = 内置插件；用户上传的插件存 data/plugins/（纯文件，不执行） */
const plugins = initPlugins(DATA);
const { initV15 } = require('./lib/v15');
/* v16：断点续传 + WebDAV/SMB 网络共享（零依赖，独立模块） */
const { initTransfer } = require('./lib/transfer');
const { initNetShare } = require('./lib/netshare');
const { createWebDavServer } = require('./lib/webdav-server');
const { createProtoTransfer } = require('./lib/proto-transfer');

/* v15：镜像仓库 / 更新检测 / 容器重构 / 文件预览编辑 / 分享加密。
   依赖注入而非全局单例，保持与 server.js 现有模块同一份状态。 */
const v15 = initV15({ wsl, settings, winnas, nasResolve, addLog, requestBase, streamFile });

let LOGS = logStore.get('logs', []);
let NOTIS = notiStore.get('notis', []);
if (!Array.isArray(LOGS)) LOGS = [];
if (!Array.isArray(NOTIS)) NOTIS = [];

const app = createApp({ root: ROOT, dataDir: DATA, sessionProvider: req => auth.getSession(req) });
const emit = app.broadcast;

function pad(n) { return String(n).padStart(2, '0'); }
function nowStr() {
  const d = new Date();
  return pad(d.getFullYear()).slice(-2) + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function fmt(n) { return fmtSize(n); }
function addLog(lv, msg, src) {
  const e = { time: nowStr(), lv, msg, src: src || 'system' };
  LOGS.push(e);
  if (LOGS.length > 1500) LOGS = LOGS.slice(-1500);
  logStore.set('logs', LOGS);
  emit('log', e);
  return e;
}
function addNoti(t, p, k) {
  const e = { t, p, k: k || 'info', time: nowStr(), u: 1, id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) };
  NOTIS.unshift(e);
  if (NOTIS.length > 100) NOTIS = NOTIS.slice(0, 100);
  notiStore.set('notis', NOTIS);
  emit('noti', e);
  return e;
}
function tokenSession(ctx) {
  return ctx.session || auth.getSession({ headers: { 'x-nasdeck-token': ctx.query.token || '' } });
}
function ok(c, data) { c.json(200, Object.assign({ ok: true }, data || {})); }
function bad(c, msg) { c.json(400, { ok: false, error: String(msg || '操作失败') }); }

/* ---------------- WinNAS 引擎 → NasDeck 可视化格式适配 ----------------
   路径规则与 WinNAS 完全相同：/ → 此电脑，/C:/Windows → C:\Windows。
   只做字段映射，不做任何数据加工或补值。 */
function nasCtx(vp) { const v = winnas.vpath(vp || '/'); return { root: v.root, sub: v.sub }; }
function nasdeckType(name, isDir) {
  if (isDir) return 'dir';
  const e = path.extname(String(name || '')).toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|tif|tiff|heic)$/.test(e)) return 'img';
  if (/\.(mp4|mkv|webm|avi|mov|wmv|flv|m4v|ts|rmvb)$/.test(e)) return 'vid';
  if (/\.(mp3|m4a|wav|flac|ogg|aac|wma|ape)$/.test(e)) return 'aud';
  if (/\.(zip|7z|rar|tar|gz|bz2|xz|tgz)$/.test(e)) return 'zip';
  return 'doc';
}
function nasdeckEntries(r) {
  return (r.entries || []).map(e => ({
    n: e.name, t: nasdeckType(e.name, e.isDir), sz: e.size, m: winnas.mtimeStr(e.mtime),
    drive: !!r.computer,
    desc: r.computer ? winnas.fmtSize(e.free || 0) + ' 可用' : undefined,
    share: false, favorited: !!e.favorited
  }));
}
function nasdeckList(vp, o) {
  const c = nasCtx(vp);
  const r = winnas.list(c.root, c.sub, o || {});
  return {
    path: vp, real: r.abs || '此电脑', root: c.root, sub: c.sub,
    entries: nasdeckEntries(r), total: r.total, page: r.page, pageSize: r.pageSize,
    error: r.error || '', restricted: !!r.restricted,
    engine: 'WinNAS', engineHome: winnas.home
  };
}
function nasDrivesNasDeck() {
  return winnas.drives().map(d => ({
    drive: d.key + ':', path: d.key + ':\\', vpath: '/' + d.key + ':/',
    total: d.size, free: d.free, used: Math.max(0, d.size - d.free),
    pct: d.size ? +((d.size - d.free) / d.size * 100).toFixed(1) : null,
    label: 'N/A', type: d.type
  }));
}
function nasTreeNasDeck() {
  const out = [{ p: '/', n: '此电脑', d: 0 }];
  for (const d of winnas.drives()) {
    out.push({ p: '/' + d.key + ':/', n: d.key + ' 本地磁盘 (' + winnas.fmtSize(d.size) + ')', d: 1, drive: true });
  }
  /* 文件总管只列「此电脑的硬盘」与「我的空间」。
     Windows 用户主目录（C:\Users\...）及项目内部静态共享根（Container /
     homes / Public …）不再出现在导航树里；winnas.roots() 已收敛为这两项。 */
  for (const r of winnas.roots()) {
    if (r.key === '__computer__') continue;
    out.push({ p: '/' + r.key, n: r.label || r.key, d: 1, real: true });
  }
  return out;
}
function nasResolve(vp, name) {
  const c = nasCtx(vp);
  const dir = winnas.absOf(c.root, c.sub);
  if (!name) return dir;
  const b = path.basename(String(name));
  if (!b || b === '.' || b === '..' || b !== String(name)) throw new Error('非法文件名');
  return path.join(dir, b);
}

/* ---------------- v16：断点续传 + WebDAV / SMB 网络共享 ----------------
   复用同一套路径解析（nasResolve / winnas.vpath），不另造存储；
   WebDAV 服务是独立端口的 http.Server，默认关闭，需用户在「传输与共享」里开启。 */
function davResolve(vp) {
  const c = winnas.vpath(vp);
  return winnas.absOf(c.root, c.sub);
}
async function davTrash(vp) {
  /* WebDAV 的 DELETE 优先送 Windows 系统回收站，与文件总管一致。
     某些路径（盘符根下的自定义目录）WinNAS 的回收站会返回 RECYCLE_FAILED，
     此时退到项目内隔离区 data/webdav-trash/，绝不真删，也不让客户端删除失败。 */
  const abs = davResolve(vp);
  const seg = String(vp || '').replace(/\\/g, '/').split('/').filter(Boolean);
  const name = seg.pop();
  if (!name) throw new Error('路径无效');
  try {
    const c = winnas.vpath('/' + seg.join('/'));
    await winnas.remove(c.root, c.sub, name);
    if (!fs.existsSync(abs)) return;
  } catch (e) { /* 落到隔离区 */ }
  if (!fs.existsSync(abs)) return;
  const bin = path.join(DATA, 'webdav-trash');
  fs.mkdirSync(bin, { recursive: true });
  const dest = path.join(bin, Date.now() + '_' + require('crypto').randomBytes(4).toString('hex') + '_' + path.basename(abs));
  fs.renameSync(abs, dest);
  addLog('WARN', 'WebDAV 删除已转入隔离区（系统回收站不可用）：' + vp, 'webdav');
}
const transfer = initTransfer(DATA, {
  resolve: nasResolve, list: nasdeckList, log: addLog, noti: addNoti
});
/* 协议通信传输任务池：WebDAV / SMB 协议栈发生的传输全部登记在这里，
   与文件总管通道（lib/transfer.js + 前端任务队列）严格分开。 */
const proto = createProtoTransfer({ log: addLog });
const netshare = initNetShare(DATA, { windows, log: addLog, proto });
const dav = createWebDavServer({
  resolve: davResolve,
  verify: (u, p) => auth.verify(u, p),
  trash: davTrash,
  log: addLog,
  track: proto,
  getConfig: () => netshare.webdavConfig()
});

const downloads = initDownloads(DATA, emit);
const media = initMedia(DATA, files.sharesRoot);
if (settings.get('mediaRoots')) media.setRoots(settings.get('mediaRoots'));
if (settings.get('mediaKindRoots')) {
  const kr = settings.get('mediaKindRoots') || {};
  ['photo', 'music', 'video'].forEach(k => { if (Array.isArray(kr[k])) media.setKindRoots(k, kr[k]); });
}
const backups = initBackups(DATA, emit, addLog, addNoti);
const aria2 = initAria2(emit);
if (settings.get('aria2')) aria2.configure(settings.get('aria2'));
if (settings.get('wslEndpoint')) wsl.setEndpoint(settings.get('wslEndpoint'));

const monitor = initMonitor({ emit, windows, wsl, addLog, addNoti });
if (settings.get('thresholds')) monitor.setThresholds(settings.get('thresholds'));

/* WSL 容器引擎：后台缓存，避免 TCP 探测阻塞登录 */
let wslCache = { available: false, message: '正在检测 WSL 容器引擎…', containers: [], images: [], endpoint: wsl.endpoint };
let wslPending = null;
/* 并发刷新复用同一个 in-flight Promise；force=true 用于「动作刚执行完」，
   必须等上一次快照跑完再重新取一次，否则会复用动作发起前的轮询结果，
   界面仍然显示操作前的容器状态（点了启动却还是「已停止」）。 */
function refreshWsl(force) {
  if (wslPending && !force) return wslPending;
  const prev = wslPending;
  const job = (async () => {
    if (prev) { try { await prev; } catch (e) {} }
    try { wslCache = await wsl.snapshot(); }
    catch (e) { wslCache = { available: false, message: e.message, containers: [], images: [], endpoint: wsl.endpoint }; }
    emit('wsl', wslCache);
    return wslCache;
  })();
  wslPending = job;
  const clear = () => { if (wslPending === job) wslPending = null; };
  job.then(clear, clear);
  return job;
}
/* 首次探测与低频轮询改由启动编排器的「WSL / Docker 引擎」阶段注册：
   开机不一次性把所有采集任务一起拉起来，前端面板先可用，功能再逐级上线。
   例外：只读的 Engine 快照（纯 TCP/HTTP，毫秒级，不碰 wsl.exe）在
   HTTP 一监听就开始，见 startWslPoller()。 */
let wslPoller = null, wslExtraPoller = null;
/* 轻量：只读 Docker Engine REST，不启动 wsl.exe、不改任何数据。
   让 容器工作台 在 coreReady 时就能显示真实容器与镜像，
   不必等第⑦阶段唤醒 WSL（冷启动实测可达 50 秒）跑完。 */
function startWslPoller() {
  if (wslPoller) return;
  refreshWsl().catch(() => {});
  wslPoller = setInterval(() => { refreshWsl().catch(() => {}); }, 15000);
  if (wslPoller.unref) wslPoller.unref();
}
/* 重：发行版枚举会调用 wsl.exe / PowerShell，仍留在分级启动的靠后阶段。 */
function startWslExtraPoller() {
  if (!WSL_EXTRA_ENABLED || wslExtraPoller) return;
  refreshWslExtra().catch(() => {});
  wslExtraPoller = setInterval(() => { refreshWslExtra().catch(() => {}); }, 60000);
  if (wslExtraPoller.unref) wslExtraPoller.unref();
}
function startBackgroundPollers() { startWslPoller(); startWslExtraPoller(); }

/* WSL 发行版与本机管理器状态：后台缓存，读不到一律 N/A，不阻塞登录。
   发行版枚举会拉起 wsl.exe / reg.exe / PowerShell。受控终端、安全策略
   或不需要 WSL 功能时可用 NasDeck_WSL_EXTRA=0 完全关闭这类后台进程；
   界面「WSL 发行版」标签仍可由用户手动点按钮发起一次性查询。 */
const WSL_EXTRA_ENABLED = process.env.NasDeck_WSL_EXTRA !== '0';
let wslExtra = {
  distros: [], distrosOk: false, distrosSource: 'N/A', distrosMessage: 'N/A',
  manager: null, message: 'N/A', updated: 0
};
async function refreshWslExtra() {
  if (!WSL_EXTRA_ENABLED) {
    wslExtra = Object.assign({}, wslExtra, { message: '发行版后台枚举已禁用（NasDeck_WSL_EXTRA=0）' });
    return wslExtra;
  }
  try {
    const [d, m] = await Promise.all([wsl.distros(), wsl.managerStatus()]);
    wslExtra = {
      distros: d.distros || [], distrosOk: !!d.ok,
      distrosSource: d.source || 'N/A', distrosMessage: d.message || 'N/A',
      manager: m, message: d.message, updated: Date.now()
    };
    wslCache.distros = wslExtra.distros;
    wslCache.distrosOk = wslExtra.distrosOk;
    wslCache.distrosSource = wslExtra.distrosSource;
    wslCache.manager = wslExtra.manager;
    emit('wslstate', wslExtra);
  } catch (e) { wslExtra.message = e.message; }
  return wslExtra;
}
/* 发行版 / 管理器状态同样延迟到引擎阶段（见 startBackgroundPollers）。 */

/* ============================ 路由 ============================ */
app.get('/api/health', c => {
  c.json(200, {
    ok: true, name: 'NasDeck 2.5 Windows Native Backend', version: '2.4.0', mode: 'live',
    platform: process.platform, hostname: os.hostname(), node: process.version,
    admin: windows.isAdmin(), winReady: windows.progress(), wslEndpoint: wsl.endpoint,
    boot: BOOT ? { phase: BOOT.phase, coreReady: BOOT.coreReady, overall: BOOT.status().overall } : { phase: 'waiting', coreReady: false, overall: 0 },
    time: Date.now(), api: 2
  });
}, { auth: false });

/* ---------------- 渐进式启动状态（启动屏免登录轮询） ----------------
   status / log 只读且不含任何凭据、token 或用户数据，允许未登录访问：
   浏览器打开页面那一刻后端可能还在启动，必须能立刻看到真实进度。
   skip / retry / start 会改变运行状态，一律要求登录会话。 */
app.get('/api/boot/status', c => {
  if (!BOOT) return c.json(200, {
    ok: false, phase: 'waiting', coreReady: false, overall: 0, running: false,
    stages: [], log: [], onDemand: [], counts: { total: 0 }, safety: {},
    message: '启动编排器尚未初始化'
  });
  c.json(200, BOOT.status());
}, { auth: false });
app.get('/api/boot/log', c => {
  const s = BOOT ? BOOT.status() : { log: [] };
  c.json(200, { ok: true, log: s.log, phase: s.phase, coreReady: s.coreReady });
}, { auth: false });
app.post('/api/boot/skip', c => {
  if (!BOOT) return bad(c, '启动编排器尚未初始化');
  const r = BOOT.skip(String(c.body.id || c.body.stage || ''));
  if (!r.ok) return bad(c, r.error);
  addLog('WARN', '启动阶段被用户跳过：' + r.id, 'boot');
  ok(c, r);
});
app.post('/api/boot/retry', async c => {
  if (!BOOT) return bad(c, '启动编排器尚未初始化');
  const r = await BOOT.retry(String(c.body.id || c.body.stage || ''));
  if (!r.ok) return bad(c, r.error);
  addLog('INFO', '启动阶段重跑完成：' + r.id + ' · ' + r.status, 'boot');
  ok(c, r);
});
app.post('/api/boot/start', async c => {
  if (!BOOT) return bad(c, '启动编排器尚未初始化');
  const r = await BOOT.startOnDemand(String(c.body.id || ''));
  if (!r.ok) return bad(c, r.error || r.message);
  addLog('INFO', '按需功能已启动：' + r.id + ' · ' + (r.message || ''), 'boot');
  ok(c, r);
});

app.post('/api/auth/login', async c => {
  const s = auth.login(c.body.user || c.body.username, c.body.pass || c.body.password);
  if (!s) {
    addLog('WARN', '使用者 ' + String(c.body.user || '') + ' 登入失败（密码错误或账号不存在）', 'auth');
    c.json(401, { ok: false, error: '账号或密码不正确' });
    return;
  }
  resCookie(c.res, auth.cookie(s.sid));
  addLog('INFO', '使用者 ' + s.user + ' 从 ' + (c.req.socket.remoteAddress || 'localhost') + ' 登入成功', 'auth');
  c.json(200, { ok: true, token: s.sid, user: s.user, role: s.role });
}, { auth: false });
function resCookie(res, v) { res.setHeader('Set-Cookie', v); }

app.post('/api/auth/logout', c => {
  auth.logout(c.req);
  resCookie(c.res, auth.clearCookie());
  c.json(200, { ok: true });
}, { auth: false });

app.get('/api/auth/session', c => {
  c.json(200, { authenticated: true, user: c.session.user, role: c.session.role, cwd: c.session.cwd });
});
app.post('/api/auth/passwd', c => {
  try { auth.changePassword(c.session.user, c.body.old, c.body.next); }
  catch (e) { bad(c, e.message); return; }
  addLog('INFO', '使用者 ' + c.session.user + ' 已变更密码', 'auth');
  ok(c);
});
app.get('/api/users', c => c.json(200, { users: auth.listUsers() }));
app.post('/api/users/add', c => {
  try { ok(c, { users: auth.addUser(c.body.username, c.body.password, c.body.role) }); }
  catch (e) { bad(c, e.message); }
});
app.post('/api/users/del', c => {
  try { ok(c, { users: auth.delUser(c.body.username) }); }
  catch (e) { bad(c, e.message); }
});

/* -------------------- bootstrap -------------------- */
app.get('/api/bootstrap', async c => {
  const s = sysinfo.snapshot();
  const drv = sysinfo.drives();
  const win = windows.snapshotAll();
  const sys = win.system || {};
  /* 卷本身没有独立温度/健康/序号；这些字段必须来自真实采集，读不到就是 N/A。
     物理磁盘的型号、序号、SMART、健康状态由 /api/win/hardware 提供。 */
  const disks = drv.map((d, i) => ({
    bay: i + 1, model: d.name + ' 磁盘卷', sn: 'N/A', cap: fmt(d.total),
    temp: 'N/A', h: 'N/A', st: 'N/A',
    total: d.total, used: d.used, free: d.free, pct: +d.pct.toFixed(1), mount: d.mount
  }));
  let root, pub;
  try { root = nasdeckList('/'); } catch (e) { root = { entries: [] }; }
  try { pub = nasdeckList('/Public'); } catch (e) { pub = { entries: [] }; }
  const scan = media.scan();
  const inst = Object.assign({
    sysboot: 1, filestation: 1, storage: 1, dashboard: 1, controlpanel: 1, appcenter: 1,
    container: 1, photodeck: 1, terminal: 1, logs: 1, trash: 1, settings: 1
  }, settings.get('installed') || {});
  inst.sysboot = 1; /* 系统启动中心是内置能力，不参与 App Center 安装/卸载 */
  const mh = monitor.snapshot();
  const binBoot = winnas.binPeek(); /* 只读缓存，绝不因回收站有上万项而拖慢登录 */
  const hwTemp = windows.cpuTemp();
  const curTemp = (hwTemp !== null && hwTemp !== undefined) ? hwTemp : (s.temp === null || s.temp === undefined ? 'N/A' : s.temp);
  const curve = k => mh.history[k] && mh.history[k].length > 3
    ? mh.history[k].slice(-40)
    : Array.from({ length: 40 }, () => +s[k].toFixed(1));
  c.json(200, {
    mode: 'live', user: c.session.user, role: c.session.role, api: 2,
    server: Object.assign(sysinfo.info(), {
      osCaption: sys.osCaption || '', osBuild: sys.osBuild || '',
      board: sys.board || '', serial: sys.serial || '', bios: sys.bios || '',
      manufacturer: sys.manufacturer || '', model: sys.model || '',
      gpus: sys.gpus || [], ramSticks: sys.ramSticks || [],
      physicalDisks: sys.physicalDisks || [], nics: sys.nics || [],
      lastBoot: sys.lastBoot || '', isAdmin: win.admin
    }),
    metrics: { cpu: curve('cpu'), mem: curve('mem'), net: curve('net'), disk: curve('disk') },
    cur: { cpu: s.cpu, mem: s.mem, net: s.net, disk: s.disk, temp: curTemp, down: s.down, up: s.up, netOk: s.netOk },
    disks, network: sysinfo.interfaces(), processes: sysinfo.processes,
    fs: { '/': root.entries, '/Public': pub.entries }, fsPath: '/', fsTree: nasTreeNasDeck(),
    drives: winnas.drives().map(d => d.key + ':'), realRoot: nasDrivesNasDeck(),
    bin: binBoot.items,
    binInfo: { total: binBoot.total, usedText: binBoot.usedText, source: binBoot.source, loading: !!binBoot.loading, message: binBoot.message || '' },
    recycleStatus: winnas.status().bin,
    winnas: winnas.status(),
    containers: wslCache.containers, dockerAvailable: wslCache.available,
    dockerMessage: wslCache.message || '', dockerImages: wslCache.images,
    wsl: wslCache,
    wslExtra,
    windows: win,
    monitor: { alerts: mh.alerts, thresholds: mh.thresholds, enabled: mh.enabled, hourly: mh.hourly },
    backups: backups.snapshot(),
    bt: { endpoint: aria2.config.host + ':' + aria2.config.port },
    downloads: downloads.snapshot(),
    logs: LOGS.slice(-300), notis: NOTIS.slice(0, 30),
    installed: inst,
    fw: settings.get('fw') || null, cloud: settings.get('cloud') || null,
    hbs: settings.get('hbs') || backups.snapshot(), cp: settings.get('cp') || null,
    net: settings.get('net') || null,
    media: { photos: scan.photos, songs: scan.songs, movies: scan.movies, roots: scan.roots, scanned: scan.scanned },
    settings: {
      theme: settings.get('theme'), wall: settings.get('wall'), accent: settings.get('accent'),
      bright: settings.get('bright'), volume: settings.get('volume'), widgets: settings.get('widgets')
    },
    sharesRoot: files.sharesRoot, dataDir: DATA,
    capabilities: {
      platform: 'windows-native', admin: win.admin, files: true, terminal: true,
      downloads: 'http/https', bt: 'aria2', wsl: true, docker: wslCache.available,
      media: true, metrics: true, services: true, firewall: true, shares: true,
      events: true, tasks: true, apps: true, vss: true, backup: true,
      defender: true, power: true, smart: true, raid: false, cloud: false,
      winnas: winnas.available, winnasHome: winnas.home,
      rates: { winReady: win.ready, winPending: win.pending }
    }
  });
});

/* -------------------- 系统信息 -------------------- */
app.get('/api/sys/info', c => c.json(200, sysinfo.info()));
app.get('/api/sys/metrics', c => c.json(200, sysinfo.snapshot()));
app.get('/api/sys/disks', c => c.json(200, { disks: sysinfo.drives(), summary: sysinfo.diskSummary() }));
app.get('/api/sys/network', c => c.json(200, { interfaces: sysinfo.interfaces(), down: sysinfo.state.down, up: sysinfo.state.up, ok: sysinfo.state.netOk }));
app.get('/api/sys/processes', c => c.json(200, { processes: sysinfo.processes }));

/* -------------------- 文件总管（全部走 WinNAS 引擎） -------------------- */
app.get('/api/files/list', c => {
  try {
    const r = nasdeckList(c.query.path || '/', {
      page: c.query.page, pageSize: c.query.pageSize, sort: c.query.sort,
      sortDir: c.query.sortDir, showHidden: c.query.showHidden === '1'
    });
    addLog('INFO', '浏览目录 ' + r.real, 'files');
    c.json(200, r);
  } catch (e) { bad(c, e.message); }
});
/* 真实盘符 + 真实目录树 + 真实卷容量，全部来自 WinNAS 的 config/paths + statfs */
app.get('/api/files/drives', c => c.json(200, {
  drives: nasDrivesNasDeck(), tree: nasTreeNasDeck(), root: '/', roots: winnas.roots(),
  engine: 'WinNAS', engineHome: winnas.home, source: 'Windows 本机磁盘 · WinNAS 引擎'
}));
app.post('/api/files/mkdir', c => {
  try {
    const x = nasCtx(c.body.path), r = winnas.mkdir(x.root, x.sub, c.body.name);
    addLog('INFO', '建立文件夹 ' + r.path, 'files');
    ok(c, Object.assign(r, { files: nasdeckList(c.body.path) }));
  } catch (e) { bad(c, e.message); }
});
app.post('/api/files/newfile', c => {
  try {
    const x = nasCtx(c.body.path), r = winnas.createFile(x.root, x.sub, c.body.name, c.body.content);
    addLog('INFO', '建立文件 ' + r.path, 'files');
    ok(c, Object.assign(r, { files: nasdeckList(c.body.path) }));
  } catch (e) { bad(c, e.message); }
});
app.post('/api/files/rename', c => {
  try {
    const x = nasCtx(c.body.path), r = winnas.rename(x.root, x.sub, c.body.from, c.body.to);
    addLog('INFO', '重命名 ' + r.from + ' -> ' + r.to, 'files');
    ok(c, Object.assign(r, { files: nasdeckList(c.body.path) }));
  } catch (e) { bad(c, e.message); }
});
/* 复制 / 移动 / 批量删除 / 真实路径：文件总管完整管理能力，全部落在本机磁盘 */
app.post('/api/files/copy', c => {
  try {
    const s = nasCtx(c.body.path || '/'), d = nasCtx(c.body.dest || c.body.path || '/');
    const r = winnas.moveOrCopy(s.root, s.sub, c.body.items, d.root, d.sub, 'copy');
    addLog('INFO', '复制 ' + (c.body.items || []).length + ' 项 → ' + (c.body.dest || c.body.path), 'files');
    ok(c, Object.assign(r, { files: nasdeckList(c.body.path || '/') }));
  } catch (e) { bad(c, e.message); }
});
app.post('/api/files/move', c => {
  try {
    const s = nasCtx(c.body.path || '/'), d = nasCtx(c.body.dest || c.body.path || '/');
    const r = winnas.moveOrCopy(s.root, s.sub, c.body.items, d.root, d.sub, 'move');
    addLog('INFO', '移动 ' + (c.body.items || []).length + ' 项 → ' + (c.body.dest || c.body.path), 'files');
    ok(c, Object.assign(r, { files: nasdeckList(c.body.path || '/') }));
  } catch (e) { bad(c, e.message); }
});
app.post('/api/files/batch-delete', async c => {
  try {
    const vp = c.body.path || '/', x = nasCtx(vp);
    const items = (c.body.items || []).slice(0, 100), results = [];
    for (const n of items) {
      try { await winnas.remove(x.root, x.sub, n); results.push({ name: n, ok: true }); }
      catch (e) { results.push({ name: n, ok: false, error: e.message }); }
    }
    addLog('WARN', '批量送入 Windows 回收站 ' + results.filter(r => r.ok).length + ' 项', 'files');
    const b = winnas.binPeek();
    emit('bin', b.items);
    ok(c, { results, trash: b.items, files: nasdeckList(vp), method: winnas.status().recycleSource });
  } catch (e) { bad(c, e.message); }
});
app.get('/api/files/realpath', c => {
  try {
    const vp = c.query.path || '/', r = nasdeckList(vp);
    c.json(200, { ok: true, path: vp, real: r.real, root: r.root, sub: r.sub, engine: r.engine });
  } catch (e) { bad(c, e.message); }
});
/* 删除 = SHFileOperation(FOF_ALLOWUNDO) 送进 Windows 系统回收站，与 WinNAS 完全同一实现 */
app.post('/api/files/delete', async c => {
  try {
    const vp = c.body.path || '/', x = nasCtx(vp);
    const r = await winnas.remove(x.root, x.sub, c.body.name);
    addLog('WARN', '移至 Windows 系统回收站 ' + r.path, 'files');
    const b = winnas.binPeek();
    emit('bin', b.items);
    ok(c, {
      trash: b.items, files: nasdeckList(vp), method: r.method,
      binInfo: { total: b.total, usedText: b.usedText, source: b.source, loading: true }
    });
  } catch (e) { bad(c, e.message); }
});
/* 兼容旧客户端的一次性 PUT：同样改为「写 .part 临时文件 → 完成才原子改名」，
   断线不再留下半截文件，也不再静默覆盖同名原文件。新前端走 /api/transfer/upload/* 分片接口。 */
app.put('/api/files/upload', c => {
  let target;
  const vp = c.query.path || '/';
  try { target = nasResolve(vp, c.query.name); }
  catch (e) { c.json(400, { ok: false, error: e.message }); c.req.resume(); return; }
  transfer.legacy(c.req, c.res, target, vp, c.query.name || '', json);
}, { raw: true });
function fileRoute(c, download) {
  try {
    const p = nasResolve(c.query.path, c.query.name);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Error('文件不存在');
    streamFile(c.req, c.res, p, { download, name: path.basename(p), cache: 'no-store' });
  } catch (e) { c.json(400, { ok: false, error: e.message }); }
}
app.get('/api/files/download', c => fileRoute(c, true), { auth: false });
app.get('/api/files/open', c => {
  if (!tokenSession(c)) { c.json(401, { error: '未登录' }); return; }
  fileRoute(c, false);
}, { auth: false });
/* 资源回收站：WinNAS 的 Shell.Application + SHFileOperation 实现，直接作用于真实系统回收站 */
async function binPayload(limit, force) {
  const b = await winnas.binList(!!force);
  const n = Number(limit || 200) || 200;
  return {
    bin: (b.items || []).slice(0, n), total: b.total || 0, used: b.used || 0,
    usedText: b.usedText || 'N/A', truncated: (b.total || 0) > n,
    source: b.source || 'N/A', loading: !!b.loading, message: b.message || '',
    progress: winnas.status().bin, roots: b.roots || [], engine: 'WinNAS'
  };
}
app.get('/api/bin/list', async c => {
  c.json(200, await binPayload(Number(c.query.limit || 200), c.query.wait === '1'));
});
app.get('/api/bin/info', async c => c.json(200, Object.assign(winnas.status().bin, winnas.binPeek())));
app.post('/api/bin/refresh', async c => {
  const r = await binPayload(200, true);
  emit('bin', r.bin);
  ok(c, r);
});
app.post('/api/bin/restore', async c => {
  try {
    const r = await winnas.binRestore(c.body.id);
    addLog('INFO', '从 Windows 回收站还原 → ' + r.restoredTo, 'files');
    const out = await binPayload(200, false);
    emit('bin', out.bin);
    let list = null; try { list = nasdeckList(c.body.path || '/'); } catch (e) {}
    ok(c, Object.assign(out, { restoredTo: r.restoredTo, files: list }));
  } catch (e) { bad(c, e.message); }
});
app.post('/api/bin/purge', async c => {
  try {
    await winnas.binPurge(c.body.id);
    addLog('WARN', '永久删除 Windows 回收站项目', 'files');
    const out = await binPayload(200, false);
    emit('bin', out.bin);
    ok(c, out);
  } catch (e) { bad(c, e.message); }
});
/* 危险：清空真实 Windows 回收站。仅由界面二次确认触发；验证脚本一律不得调用。 */
app.post('/api/bin/clear', async c => {
  try {
    if (!c.body || c.body.confirm !== true) { bad(c, '需要前端二次确认（confirm:true）'); return; }
    const r = await winnas.binClear();
    addLog('WARN', '清空 Windows 回收站（' + (r.purged || 0) + ' 项）', 'files');
    const out = await binPayload(200, false);
    emit('bin', out.bin);
    ok(c, out);
  } catch (e) { bad(c, e.message); }
});
app.get('/api/search', c => {
  const q = String(c.query.q || '').toLowerCase();
  const win = windows.snapshotAll();
  const hit = (arr, fields) => arr.filter(x => fields.some(f => String(x[f] || '').toLowerCase().includes(q))).slice(0, 12);
  c.json(200, { q, files: files.search(c.query.q || ''), apps: [],
    services: hit(win.services, ['n', 'd']), winapps: hit(win.apps, ['n', 'pub']),
    processes: hit(win.processes, ['n']), events: hit(win.events, ['msg', 'src']) });
});

/* ================================================================
 * WinNAS 引擎 API —— 文件 / 版本快照 / 压缩 / 搜索 / 分享 / 缩略图
 * 全部调用 C:\AI使用\项目\NasManager 的同一份实现，NasDeck 只负责可视化与远程管理。
 * ================================================================ */
const NAS = fn => async c => { try { await fn(c); } catch (e) { bad(c, e.message); } };

app.get('/api/nas/status', c => c.json(200, winnas.status()));
app.get('/api/nas/roots', c => c.json(200, { roots: winnas.roots(), drives: winnas.drives(), engine: 'WinNAS', home: winnas.home }));
app.get('/api/nas/list', NAS(c => {
  const x = nasCtx(c.query.path || '/');
  const r = winnas.list(x.root, x.sub, {
    page: c.query.page, pageSize: c.query.pageSize, sort: c.query.sort,
    sortDir: c.query.sortDir, showHidden: c.query.showHidden === '1'
  });
  c.json(200, Object.assign({ ok: true }, r));
}));
app.get('/api/nas/stat', NAS(c => {
  const x = nasCtx(c.query.path || '/');
  c.json(200, Object.assign({ ok: true }, winnas.stat(x.root, x.sub)));
}));
app.post('/api/nas/mkdir', NAS(c => {
  const x = nasCtx(c.body.path);
  ok(c, winnas.mkdir(x.root, x.sub, c.body.name));
}));
app.post('/api/nas/newfile', NAS(c => {
  const x = nasCtx(c.body.path);
  ok(c, winnas.createFile(x.root, x.sub, c.body.name, c.body.content));
}));
app.post('/api/nas/rename', NAS(c => {
  const x = nasCtx(c.body.path);
  ok(c, winnas.rename(x.root, x.sub, c.body.from, c.body.to));
}));
app.post('/api/nas/move', NAS(c => {
  const x = nasCtx(c.body.path), d = nasCtx(c.body.dest || c.body.path);
  ok(c, winnas.moveOrCopy(x.root, x.sub, c.body.items, d.root, d.sub, 'move'));
}));
app.post('/api/nas/copy', NAS(c => {
  const x = nasCtx(c.body.path), d = nasCtx(c.body.dest || c.body.path);
  ok(c, winnas.moveOrCopy(x.root, x.sub, c.body.items, d.root, d.sub, 'copy'));
}));
app.post('/api/nas/write', NAS(c => {
  const x = nasCtx(c.body.path);
  addLog('INFO', '保存文件（自动生成版本快照）' + c.body.path, 'files');
  ok(c, winnas.writeFile(x.root, x.sub, c.body.content));
}));

/* 文件版本快照（WinNAS versions.js：DATA_DIR/versions/<root>/<rel>/<ts>） */
app.get('/api/nas/versions', NAS(c => {
  const x = nasCtx(c.query.path || '/');
  c.json(200, { ok: true, versions: winnas.versionList(x.root, x.sub), dir: winnas.status().fileVersionDir || 'N/A' });
}));
app.post('/api/nas/version/create', NAS(c => {
  const x = nasCtx(c.body.path);
  addLog('INFO', '创建文件版本快照 ' + c.body.path, 'snapshot');
  c.json(200, { ok: true, versions: winnas.versionCreate(x.root, x.sub) });
}));
app.post('/api/nas/version/restore', NAS(c => {
  const x = nasCtx(c.body.path);
  const r = winnas.versionRestore(x.root, x.sub, c.body.name);
  addLog('INFO', '还原文件版本 ' + c.body.name, 'snapshot');
  ok(c, r);
}));
app.post('/api/nas/version/remove', NAS(c => {
  const x = nasCtx(c.body.path);
  ok(c, winnas.versionRemove(x.root, x.sub, c.body.name));
}));
app.get('/api/nas/version/content', NAS(c => {
  const x = nasCtx(c.query.path || '/');
  const p = winnas.versionRead(x.root, x.sub, c.query.name);
  if (!p || !fs.existsSync(p)) { c.json(404, { error: '版本文件不存在' }); return; }
  streamFile(c.req, c.res, p, { download: false, name: path.basename(p), cache: 'no-store' });
}));

/* 压缩 / 解压 / 压缩包内容（WinNAS archive.js，含 AES） */
app.post('/api/nas/compress', NAS(async c => {
  const x = nasCtx(c.body.path);
  const r = await winnas.compress(x.root, x.sub, c.body.items, c.body.name, c.body.password);
  addLog('INFO', '压缩 ' + r.count + ' 项 → ' + r.path, 'files');
  ok(c, r);
}));
app.post('/api/nas/extract', NAS(async c => {
  const x = nasCtx(c.body.path);
  const r = await winnas.extract(x.root, x.sub, c.body.name, c.body.dest, c.body.password);
  addLog('INFO', '解压 → ' + r.path, 'files');
  ok(c, r);
}));
app.post('/api/nas/archive/list', NAS(async c => {
  const x = nasCtx(c.body.path);
  const r = await winnas.archiveList(x.root, x.sub);
  c.json(200, { ok: true, entries: Array.isArray(r) ? r : (r.entries || []), raw: Array.isArray(r) ? null : r });
}));

/* 名称索引 + 全文内容搜索（WinNAS search.js，异步分块不冻结事件循环） */
app.get('/api/nas/search', NAS(async c => {
  const r = await winnas.search(c.query.q || '', {
    root: c.query.root, ext: c.query.ext, limit: Number(c.query.limit || 200)
  });
  c.json(200, r);
}));
app.post('/api/nas/search/content', NAS(async c => {
  const r = await winnas.searchContent(c.body.q || '', c.body.opts || {});
  c.json(200, { ok: true, results: r || [] });
}));
app.get('/api/nas/search/status', c => c.json(200, (winnas.searchEngine && winnas.searchEngine.getStatus()) || { building: false, count: 0, error: 'WinNAS 引擎不可用' }));
app.post('/api/nas/search/reindex', NAS(async c => {
  if (!winnas.searchEngine) throw new Error('WinNAS 引擎不可用');
  const r = await winnas.searchEngine.buildIndexAsync(c.body && c.body.root);
  c.json(200, { ok: true, result: r || null, status: winnas.searchEngine.getStatus() });
}));

/* 分享链接 / 收藏 / 去重 / Office 预览 / 后台任务 */
/* 当前连接地址：从真实请求的 Host / 转发头计算，不写死 127.0.0.1:5080。
   前端分享链接一律基于此值或页面 location.origin 拼装，端口改了也跟着变。 */
function requestBase(c) {
  const h = String((c.req.headers && (c.req.headers['x-forwarded-host'] || c.req.headers.host)) || '').trim();
  const proto = String((c.req.headers && c.req.headers['x-forwarded-proto']) || 'http').split(',')[0].trim();
  const host = h || ('127.0.0.1:' + (Number(process.env.PORT) || 5080));
  return { protocol: proto + ':', host, origin: proto + '://' + host, baseUrl: proto + '://' + host };
}
/* 分享的 absBase 必须指向「文件所在目录」。调用方有两种传法：
   · path 是完整虚拟文件路径（右键单项 /Public/a.txt + name=a.txt）→ 取 dirname
   · path 是目录（批量 /Public + items=[a.txt]）→ 目录本身就是 absBase
   旧版一律 dirname，批量场景会少一层，导致 /s/token 指向不存在的文件而 404。 */
function shareBaseOf(vp, x, name) {
  try {
    const abs = winnas.absOf(x.root, x.sub);
    const tail = String(vp || '').replace(/\/+$/, '');
    return (tail === name || tail.endsWith('/' + name)) ? path.dirname(abs) : abs;
  } catch (e) { return null; }
}
app.get('/api/share/base', c => c.json(200, Object.assign({ ok: true }, requestBase(c))));
app.get('/api/nas/shares', c => c.json(200, {
  ok: true, shares: winnas.shares(), base: requestBase(c)
}));
app.post('/api/nas/share/add', NAS(c => {
  const x = nasCtx(c.body.path);
  const name = c.body.name || path.basename(x.sub) || '未知';
  const absBase = shareBaseOf(c.body.path, x, name);
  /* v14：生成前确认目标在分享目录内且真实存在，避免生成指向空目录 / 不存在文件的死链。
     同时支持「分享整个文件夹」—— 落地页会列出其中的文件供勾选下载。 */
  const target = absBase ? path.resolve(absBase, String(name)) : null;
  if (!target || !target.startsWith(absBase + path.sep) || !fs.existsSync(target)) {
    bad(c, '要分享的文件/文件夹在本机磁盘上不存在：' + name); return;
  }
  const r = winnas.shareAdd({
    root: x.root, itemPath: name, absBase,
    expiresInHours: Number(c.body.hours || 72), password: v15.shareEncryptArgs(c.body).password
  });
  addLog('INFO', '生成分享链接 ' + r.token + ' -> ' + name, 'share');
  const rel = '/s/' + r.token, base = requestBase(c);
  c.json(200, { ok: true, share: r, url: base.origin + rel, rel: rel, path: rel, base: base, name: name });
}));
/* 批量：一次给当前目录里选中的多个文件各生成一条链接，逐项如实回传成败 */
app.post('/api/nas/share/batch', NAS(c => {
  const items = Array.isArray(c.body.items) ? c.body.items.slice(0, 100) : [];
  if (!items.length) { bad(c, '请先选择要分享的文件'); return; }
  const results = [];
  for (const name of items) {
    try {
      const x = nasCtx(c.body.path);
      const absBase = shareBaseOf(c.body.path, x, name);
      const target = absBase ? path.resolve(absBase, String(name)) : null;
      if (!target || !target.startsWith(absBase + path.sep) || !fs.existsSync(target)) {
        throw new Error('文件在本机磁盘上不存在：' + name);
      }
      const r = winnas.shareAdd({
        root: x.root, itemPath: name, absBase,
        expiresInHours: Number(c.body.hours || 72), password: v15.shareEncryptArgs(c.body).password
      });
      const rel = '/s/' + r.token;
      results.push({ ok: true, name, token: r.token, rel: rel, url: requestBase(c).origin + rel });
    } catch (e) { results.push({ ok: false, name, error: e.message }); }
  }
  addLog('INFO', '批量生成分享链接 ' + results.filter(r => r.ok).length + '/' + results.length, 'share');
  c.json(200, { ok: true, results, base: requestBase(c) });
}));
app.post('/api/nas/share/revoke', NAS(c => {
  if (!winnas.share) throw new Error('WinNAS 引擎不可用');
  ok(c, { revoked: winnas.share.revoke(c.body.token) });
}));
app.post('/api/nas/share/extend', NAS(c => {
  if (!winnas.share) throw new Error('WinNAS 引擎不可用');
  ok(c, { extended: winnas.share.extend(c.body.token, Number(c.body.hours || 24)) });
}));
/* 批量撤销 / 批量续期：tokens 数组，逐项返回真实结果，不静默吞错 */
app.post('/api/nas/share/batch-action', NAS(c => {
  if (!winnas.share) throw new Error('WinNAS 引擎不可用');
  const tokens = Array.isArray(c.body.tokens) ? c.body.tokens.slice(0, 200) : [];
  const act = String(c.body.act || '');
  if (!tokens.length) { bad(c, '请先勾选分享链接'); return; }
  if (act !== 'revoke' && act !== 'extend') { bad(c, '不支持的批量操作'); return; }
  const results = tokens.map(t => {
    try {
      const done = act === 'revoke' ? winnas.share.revoke(t) : winnas.share.extend(t, Number(c.body.hours || 72));
      return { ok: !!done, token: t };
    } catch (e) { return { ok: false, token: t, error: e.message }; }
  });
  addLog('INFO', '批量' + (act === 'revoke' ? '撤销' : '续期') + '分享链接 ' + results.filter(r => r.ok).length + '/' + results.length, 'share');
  ok(c, { results });
}));

/* -------------------- 分享链接落地页（免登录） --------------------
 * v14：由「点开就是下载页」改为网盘式文件页：列出分享里的真实文件，
 * 可勾选、单个下载、打包下载 ZIP、预览、复制分享链接；支持分享整个文件夹。
 * 所有文件始终在 Windows 本机磁盘，任何路径都严格限制在分享根目录内。
 * 路由用前缀 '/s/*'（core.js 的匹配器只认精确路径或 * 前缀）。
 * //__NasDeck_V14_SHARE_START__ */
function escHtml(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
let ZIP_CRC_T = null;
function zipCrc32(buf) {
  if (!ZIP_CRC_T) {
    ZIP_CRC_T = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); ZIP_CRC_T[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = ZIP_CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function zipDos(d) {
  return { t: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
    dt: (((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF };
}
/* 零依赖 ZIP（store 模式）：勾选多个文件时打包成一个压缩包下载，
   避免浏览器把「连续多次下载」当作弹窗拦截。 */
function buildZip(entries) {
  const parts = [], central = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), data = e.data;
    const crc = zipCrc32(data), dos = zipDos(new Date());
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dos.t, 10); lh.writeUInt16LE(dos.dt, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10); ch.writeUInt16LE(dos.t, 12); ch.writeUInt16LE(dos.dt, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(central), head = Buffer.concat(parts), eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(0, 4); eo.writeUInt16LE(0, 6);
  eo.writeUInt16LE(entries.length, 8); eo.writeUInt16LE(entries.length, 10);
  eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(head.length, 16); eo.writeUInt16LE(0, 20);
  return Buffer.concat([head, cd, eo]);
}
function shareHtml(title, inner) {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + ' · NasDeck 分享</title><style>' +
    '*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0b1622;color:#e8f3fb;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}' +
    '.wrap{width:min(920px,94vw);margin:0 auto;padding:22px 0 40px}' +
    '.bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 18px;border-radius:12px 12px 0 0;background:linear-gradient(135deg,#12314a,#0f2437);border:1px solid #2a4a63;border-bottom:0}' +
    '.logo{width:34px;height:34px;flex:none;border-radius:9px;background:#22a7e8;display:grid;place-items:center;font-weight:800;color:#fff}' +
    '.bar b{font-size:15px}.bar .dim{color:#8fb0c7;font-size:11.5px}' +
    '.panel{background:#12283a;border:1px solid #2a4a63;border-radius:0 0 12px 12px;padding:18px}' +
    'h1{font-size:17px;margin:0 0 4px;word-break:break-all}.m{color:#8fb0c7;font-size:12px;margin:0 0 14px}' +
    '.tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 0;border-top:1px solid #24405a;border-bottom:1px solid #24405a;margin-bottom:12px}' +
    '.grow{flex:1;min-width:8px}label{display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer}' +
    '.btn,.tools button{border:1px solid #37607c;background:#17354c;color:#e8f3fb;padding:8px 14px;border-radius:8px;font:600 12.5px system-ui,"Microsoft YaHei",sans-serif;cursor:pointer;text-decoration:none;display:inline-block;line-height:1.4}' +
    '.btn.primary,.tools button.primary{background:#22a7e8;border-color:#22a7e8;color:#fff}' +
    '.btn:hover,.tools button:hover{filter:brightness(1.14)}' +
    '.file{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #24405a;border-radius:10px;background:#0f2334;margin-bottom:9px;flex-wrap:wrap}' +
    '.ico{width:42px;height:42px;flex:none;border-radius:9px;background:#1c4260;display:grid;place-items:center;font-size:10.5px;font-weight:800;color:#8fd3f7;overflow:hidden}' +
    '.info{flex:1;min-width:170px}.info b{display:block;word-break:break-all;font-size:13.5px}.info span{color:#8fb0c7;font-size:11.5px}' +
    '.ops{display:flex;gap:7px;flex-wrap:wrap}' +
    'input[type=checkbox]{width:16px;height:16px;accent-color:#22a7e8;flex:none}' +
    'input[type=password]{padding:9px 11px;border-radius:8px;border:1px solid #37607c;background:#0c1c29;color:#e8f3fb;min-width:200px}' +
    'a{color:#4fc3f7}.foot{color:#7a9bb3;font-size:11px;margin-top:16px;text-align:center}' +
    '@media(max-width:560px){.wrap{width:96vw;padding-top:10px}.ops{width:100%}.hide-s{display:none}}' +
    '</style></head><body><div class="wrap"><div class="bar"><div class="logo">Q</div>' +
    '<div><b>NasDeck 分享 · 文件网盘</b><div class="dim">文件保存在 Windows 本机磁盘 · 由本机后端直出，不经过第三方服务器</div></div></div>' +
    '<div class="panel"><h1>' + title + '</h1>' + inner + '</div>' +
    '<div class="foot">桌面 · 勾选文件后可选择单个下载或打包下载</div></div></body></html>';
}
function shareExt(name, isDir) {
  if (isDir) return 'DIR';
  const m = /\.([a-z0-9]{1,6})$/i.exec(name || '');
  return (m ? m[1] : 'FILE').toUpperCase().slice(0, 4);
}
function shareResolved(baseDir, rel) {
  if (!rel || String(rel).indexOf('\0') >= 0) return null;
  const p = path.resolve(baseDir, String(rel));
  if (p !== baseDir && !p.startsWith(baseDir + path.sep)) return null;
  try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (e) {}
  return null;
}
function shareEntries(abs, isDir) {
  if (!isDir) return [{ name: path.basename(abs), abs, size: fs.statSync(abs).size }];
  const out = [];
  try {
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!d.isFile()) continue;
      const p = path.join(abs, d.name);
      try { out.push({ name: d.name, abs: p, size: fs.statSync(p).size }); } catch (e) {}
      if (out.length >= 200) break;
    }
  } catch (e) {}
  return out;
}
app.get('/s/*', c => {
  const token = decodeURIComponent(String(c.url.pathname || '').slice(3)).replace(/^\/+|\/+$/g, '').split('/')[0];
  const share = winnas.share && winnas.share.getShare(token);
  if (!share) { c.json(404, { error: '分享链接不存在或已被撤销' }); return; }
  if (share.expiresAt && share.expiresAt > 0 && share.expiresAt < Date.now()) { c.json(410, { error: '分享链接已过期' }); return; }
  const pwq = c.query.pw ? '&pw=' + encodeURIComponent(String(c.query.pw)) : '';
  const mk = q => '/s/' + encodeURIComponent(token) + '?' + q + pwq;
  if (share.password && !winnas.share.verifyPw(String(c.query.pw || ''), share.password)) {
    c.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    c.res.end(shareHtml('需要访问密码', '<div class="m">此分享链接受密码保护，请输入访问密码后查看文件列表。</div>' +
      '<form method="get" action="/s/' + escHtml(token) + '"><p><input name="pw" type="password" placeholder="访问密码" autofocus> ' +
      '<button class="btn primary" type="submit">查看文件</button></p></form>'));
    return;
  }
  const abs = share.absBase && share.itemPath ? path.resolve(share.absBase, share.itemPath) : null;
  if (!abs || !fs.existsSync(abs)) { c.json(404, { error: '分享的文件已不存在于本机磁盘' }); return; }
  const st = fs.statSync(abs), isDir = st.isDirectory();
  const baseDir = isDir ? abs : path.dirname(abs);
  const primary = isDir ? '' : path.basename(abs);
  const entries = shareEntries(abs, isDir);
  const qfile = String(c.query.file || primary || '');

  /* 单文件下载 / 预览 */
  if (c.query.dl === '1' || c.query.view === '1') {
    const target = shareResolved(baseDir, qfile);
    if (!target) { c.json(404, { error: '文件不存在或超出分享范围' }); return; }
    if (c.query.dl === '1' && winnas.share) winnas.share.bump(token, 'downloads');
    streamFile(c.req, c.res, target, { download: c.query.dl === '1', name: path.basename(target), cache: 'no-store' });
    return;
  }
  /* 打包下载（勾选文件 → ZIP）。只打包真实存在且在分享目录内的文件。 */
  if (c.query.dl === 'zip') {
    const picked = String(c.query.files || '').split(',').filter(Boolean).slice(0, 200);
    const list = (picked.length ? picked : entries.map(e => e.name))
      .map(n => ({ n, p: shareResolved(baseDir, n) })).filter(x => x.p);
    if (!list.length) { c.json(404, { error: '没有可下载的文件' }); return; }
    let total = 0; for (const x of list) total += fs.statSync(x.p).size;
    if (total > 128 * 1024 * 1024) { c.json(413, { error: '所选文件超过 128 MB，请改用单个下载' }); return; }
    try {
      /* 打包结果先落成按内容签名命名的缓存文件，再走 streamFile。
         这样 ZIP 下载也支持 Accept-Ranges / 206，浏览器断线可续传；
         签名含每个文件的 size+mtime，源文件变了会生成新包，不会用旧包续传。
         （buildZip 内置当前 DOS 时间，若不缓存，每次 Range 请求内容都不同。） */
      const zipDir = path.join(DATA, 'share-zip');
      fs.mkdirSync(zipDir, { recursive: true });
      const sig = list.map(x => x.n + ':' + fs.statSync(x.p).size + ':' + Math.floor(fs.statSync(x.p).mtimeMs)).join('|');
      const key = require('crypto').createHash('md5').update(token + '|' + sig).digest('hex');
      const tmp = path.join(zipDir, key + '.zip');
      if (!fs.existsSync(tmp)) {
        fs.writeFileSync(tmp, buildZip(list.map(x => ({ name: x.n, data: fs.readFileSync(x.p) }))));
      }
      try {
        for (const f of fs.readdirSync(zipDir)) {
          const p = path.join(zipDir, f);
          if (Date.now() - fs.statSync(p).mtimeMs > 86400000) fs.rmSync(p, { force: true });
        }
      } catch (e) {}
      if (winnas.share) winnas.share.bump(token, 'downloads');
      streamFile(c.req, c.res, tmp, { download: true, name: 'nasdeck-share.zip', type: 'application/zip', cache: 'no-store' });
    } catch (e) { c.json(500, { error: '打包失败：' + e.message }); }
    return;
  }
  /* 网盘式文件页 */
  if (winnas.share) winnas.share.bump(token, 'views');
  const exp = share.expiresAt ? new Date(share.expiresAt).toLocaleString('zh-CN') : '永久有效';
  const cards = entries.length ? entries.map(function (e) {
    const ext = shareExt(e.name, false), enc = encodeURIComponent(e.name);
    const canView = /\.(png|jpe?g|gif|webp|bmp|svg|txt|md|log|json|srt|vtt|lrc|mp3|wav|m4a|mp4|webm|pdf)$/i.test(e.name);
    return '<div class="file"><input type="checkbox" class="pick" checked data-name="' + escHtml(e.name) + '">' +
      '<div class="ico">' + escHtml(ext) + '</div><div class="info"><b>' + escHtml(e.name) + '</b>' +
      '<span>' + escHtml(fmtSize(e.size)) + ' · 修改于 ' + escHtml(new Date(fs.statSync(e.abs).mtime).toLocaleString('zh-CN')) + '</span></div>' +
      '<div class="ops">' + (canView ? '<a class="btn" target="_blank" href="' + escHtml(mk('view=1&file=' + enc)) + '">预览</a>' : '') +
      '<a class="btn primary" href="' + escHtml(mk('dl=1&file=' + enc)) + '">下载</a></div></div>';
  }).join('') : '<div class="file"><div class="info"><b>此分享里没有可下载的文件</b><span>文件夹为空，或文件已被移出本机磁盘。</span></div></div>';
  const pageUrl = requestBase(c).origin + '/s/' + encodeURIComponent(token) + (c.query.pw ? '?pw=' + encodeURIComponent(String(c.query.pw)) : '');
  const inner = '<p class="m">' + (isDir ? '文件夹分享' : '单文件分享') + ' · 共 ' + entries.length + ' 个文件 · 有效期至 ' + escHtml(exp) +
    ' · 浏览 ' + (share.views || 0) + ' 次 · 下载 ' + (share.downloads || 0) + ' 次' + (share.password ? ' · <b>加密访问（需密码）</b>' : ' · <b>公开访问（无需密码）</b>') + '</p>' +
    '<div class="tools"><label><input type="checkbox" id="all" checked> 全选</label><span class="grow"></span>' +
    '<button class="primary" id="dlsel">下载所选（打包 ZIP）</button>' +
    '<a class="btn" href="' + escHtml(mk('dl=zip')) + '">打包全部</a>' +
    '<button id="copylink">复制分享链接</button></div>' +
    '<div id="sharebox" data-zip="' + escHtml(mk('dl=zip')) + '" data-page="' + escHtml(pageUrl) + '">' + cards + '</div>' +
    '<p class="m" style="margin-top:12px">勾选文件后点「下载所选」会打包成一个 ZIP；也可对单个文件点「下载」或「预览」。' +
    '文件始终保存在 Windows 本机磁盘，由 NasDeck 后端直出。</p>' +
    '<script>(function(){' +
    'var all=document.getElementById("all"),picks=[].slice.call(document.querySelectorAll(".pick"));' +
    'all.addEventListener("change",function(){picks.forEach(function(p){p.checked=all.checked})});' +
    'picks.forEach(function(p){p.addEventListener("change",function(){all.checked=picks.every(function(x){return x.checked})})});' +
    'document.getElementById("dlsel").addEventListener("click",function(){' +
    'var ns=picks.filter(function(p){return p.checked}).map(function(p){return p.dataset.name});' +
    'if(!ns.length){alert("请先勾选要下载的文件");return}' +
    'location.href=document.getElementById("sharebox").dataset.zip+"&files="+encodeURIComponent(ns.join(","));});' +
    'document.getElementById("copylink").addEventListener("click",function(){' +
    'var u=document.getElementById("sharebox").dataset.page,b=this;' +
    'function done(){b.textContent="已复制";setTimeout(function(){b.textContent="复制分享链接"},1800)}' +
    'if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(done,function(){prompt("复制此链接",u)})}else{prompt("复制此链接",u)}});' +
    '})();</script>';
  c.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  c.res.end(shareHtml('分享文件 · ' + escHtml(share.itemPath || path.basename(abs)), inner));
}, { auth: false });
//__NasDeck_V14_SHARE_END__

//__NasDeck_V15_START__
/* ==========================================================================
 * NasDeck v15 后端路由
 *  需求 1 镜像仓库   需求 2 镜像更新   需求 3 容器重构
 *  需求 6 文件预览/编辑   需求 7 分享加密
 * 所有失败如实回传 error，绝不把 N/A 包装成成功。
 * ======================================================================== */
app.get('/api/docker/registries', c => {
  c.json(200, { ok: true, registries: v15.registries().map(v15.registryShape),
    engine: { online: !!(wsl.endpoint && (wsl.endpoint.socket || wsl.endpoint.port)), distro: (wsl.endpoint || {}).distro || 'N/A' } });
});
app.post('/api/docker/registries', c => {
  try {
    const act = String((c.body || {}).act || 'add');
    let r;
    if (act === 'add') r = { registry: v15.addRegistry(c.body) };
    else if (act === 'remove') r = v15.removeRegistry(String(c.body.id || ''));
    else throw new Error('不支持的仓库操作: ' + act);
    ok(c, r);
  } catch (e) { bad(c, e.message); }
});
app.post('/api/docker/registry/login', async c => {
  try { ok(c, await v15.loginRegistry(c.body)); }
  catch (e) { addLog('WARN', '镜像仓库登录失败：' + e.message, 'docker'); bad(c, e.message); }
});
app.post('/api/docker/registry/logout', async c => {
  try { ok(c, await v15.logoutRegistry(c.body)); } catch (e) { bad(c, e.message); }
});
app.post('/api/docker/registry/test', async c => {
  /* 连通性测试失败是「结果」不是「请求异常」：用 c.json 如实回传 ok:false +
     可读原因，不能用 ok() 包装（那会把失败补成恒真 ok:true）。 */
  try { c.json(200, await v15.testRegistry(c.body)); } catch (e) { bad(c, e.message); }
});
app.get('/api/docker/updates', async c => {
  try {
    const items = await v15.checkUpdates(String(c.query.force || '') === '1');
    c.json(200, { ok: true, items, at: Date.now(), checked: items.length });
  } catch (e) { bad(c, e.message); }
});
app.post('/api/docker/updates', async c => {
  try {
    const items = await v15.checkUpdates(true);
    ok(c, { items, at: Date.now(), checked: items.length });
  } catch (e) { bad(c, e.message); }
});
app.post('/api/docker/container/update', async c => {
  try {
    const r = await v15.updateContainer(c.body);
    await refreshWsl(true);
    ok(c, r);
  } catch (e) { addLog('WARN', '容器镜像更新失败：' + e.message, 'docker'); bad(c, e.message); }
});
app.get('/api/docker/container/inspect', async c => {
  try { ok(c, { config: await v15.inspectContainer(String(c.query.id || '')) }); }
  catch (e) { bad(c, e.message); }
});
app.post('/api/docker/container/recreate', async c => {
  try {
    const r = await v15.recreateContainer(c.body);
    await refreshWsl(true);
    ok(c, r);
  } catch (e) { addLog('WARN', '容器重构失败：' + e.message, 'docker'); bad(c, e.message); }
});
/* 文件预览：文本按编码解码（BOM/UTF-8/GBK/UTF-16），媒体给出播放 URL，
   Office 用内置在线文档查看器（不上传第三方、不经过外网）。 */
app.get('/api/nas/file/preview', NAS(async c => {
  const r = v15.previewFile(c);
  const v = (r && typeof r.then === 'function') ? await r : r;
  c.json(200, v);
}));
app.post('/api/nas/file/save', NAS(c => {
  ok(c, v15.saveFile(c));
}));
//__NasDeck_V15_END__



app.get('/api/nas/favorites', c => c.json(200, { ok: true, favorites: winnas.favoritesList() }));
app.post('/api/nas/favorite/add', NAS(c => {
  const x = nasCtx(c.body.path);
  if (!winnas.favorites) throw new Error('WinNAS 引擎不可用');
  c.json(200, { ok: true, favorite: winnas.favorites.add(x.root, c.body.name || x.sub) });
}));
app.post('/api/nas/favorite/remove', NAS(c => {
  const x = nasCtx(c.body.path);
  if (!winnas.favorites) throw new Error('WinNAS 引擎不可用');
  ok(c, { removed: winnas.favorites.remove(x.root, c.body.name || x.sub) });
}));
app.get('/api/nas/dedup', NAS(async c => {
  const r = await winnas.dedup(c.query.root || 'C');
  c.json(200, { ok: true, groups: Array.isArray(r) ? r : (r.groups || []) });
}));
app.get('/api/nas/office/preview', NAS(async c => {
  const x = nasCtx(c.query.path || '/');
  c.json(200, Object.assign({ ok: true }, await winnas.officePreview(x.root, x.sub)));
}));
app.get('/api/nas/jobs', c => c.json(200, { ok: true, jobs: winnas.jobs ? winnas.jobs.listJobs() : [] }));
/* 缩略图：<img> 不能带自定义 header，走 ?token= 校验 */
app.get('/api/nas/thumbnail', async c => {
  if (!tokenSession(c)) { c.json(401, { error: '未登录' }); return; }
  try {
    const x = nasCtx(c.query.path || '/');
    const r = await winnas.thumbnail(x.root, x.sub);
    if (!r || r.status === 'error' || !r.buffer) { c.json(404, { error: r && r.error ? r.error : '无缩略图' }); return; }
    c.res.writeHead(200, { 'Content-Type': r.contentType || 'image/jpeg', 'Cache-Control': 'no-store', 'Content-Length': r.buffer.length });
    c.res.end(r.buffer);
  } catch (e) { c.json(404, { error: e.message }); }
}, { auth: false });

/* -------------------- 终端 -------------------- */
app.post('/api/terminal/exec', async c => {
  const cwd = c.session.cwd || process.cwd();
  const r = await terminal.exec(c.body.cmd, cwd);
  auth.setCwd(c.req, r.cwd);
  addLog('INFO', '终端执行: ' + String(c.body.cmd).slice(0, 160), 'terminal');
  c.json(200, { ok: true, out: r.out, cwd: r.cwd, code: r.code });
});

/* -------------------- WSL 容器引擎（容器工作台） -------------------- */
app.get('/api/wsl/snapshot', c => c.json(200, wslCache));
app.get('/api/wsl/status', async c => {
  addLog('INFO', '查询 WSL 发行版状态', 'wsl');
  c.json(200, await wsl.wslStatus());
});
app.post('/api/wsl/engine/start', async c => {
  addLog('INFO', '尝试启动 WSL 内的 Docker 引擎', 'wsl');
  const r = await wsl.engineStart();
  addLog(r.ok ? 'INFO' : 'WARN', r.message, 'wsl');
  await refreshWsl(true);
  ok(c, r);
});
app.get('/api/wsl/discover', async c => {
  const r = await wsl.discover();
  wslCache = Object.assign({}, wslCache, { discover: r, available: !!r.found });
  emit('wsl', wslCache);
  c.json(200, r);
});
app.post('/api/wsl/distro', async c => {
  try { const r = await wsl.distroAction(c.body.name, c.body.act); addLog('INFO', 'WSL 发行版 ' + c.body.name + ' ' + c.body.act, 'wsl'); ok(c, r); }
  catch (e) { bad(c, e.message); }
});
app.post('/api/wsl/endpoint', c => {
  const ep = wsl.setEndpoint(c.body);
  settings.set('wslEndpoint', { host: ep.host, port: ep.port, distro: ep.distro, socket: ep.socket || '' });
  addLog('INFO', '容器引擎端点改为 ' + (ep.socket || (ep.host + ':' + ep.port)), 'wsl');
  refreshWsl(true).catch(() => {});
  ok(c, { endpoint: ep });
});
app.post('/api/wsl/action', async c => {
  try {
    const r = await wsl.action(c.body.id, c.body.act);
    addLog(r.ok ? 'INFO' : 'WARN',
      'WSL 容器 ' + c.body.act + ' ' + c.body.id + (r.ok ? '' : ' · ' + (r.error || ('HTTP ' + r.code))), 'wsl');
    const snap = await refreshWsl(true);
    /* 必须如实回传本次动作的结果。过去这里把 wsl.action() 的结果摊进
       wslCache，再由 ok() 补上恒真的 ok:true —— 真实失败（No such
       container / 409 paused / 304 already stopped）在界面上永远显示
       「操作成功」，用户看不到任何原因，正是「似乎没启动」的根源。 */
    c.json(200, Object.assign({ ok: !!r.ok }, snap, {
      out: r.out || '', error: r.error || '', code: r.code || 0,
      action: c.body.act, id: c.body.id
    }));
  } catch (e) { bad(c, e.message); }
});
app.get('/api/wsl/image/inspect', async c => {
  try {
    const r = await wsl.imageInspect(c.query.image || '');
    addLog(r.ok ? 'INFO' : 'WARN', '读取镜像元数据 ' + (c.query.image || '') + (r.ok ? '' : ' · ' + r.error), 'wsl');
    c.json(200, r);
  } catch (e) { bad(c, e.message); }
});
app.post('/api/wsl/create', async c => {
  try {
    const r = await wsl.create(c.body);
    addLog(r.ok ? 'INFO' : 'WARN',
      '建立容器 ' + (c.body.image || '') + (r.ok ? (' · ' + (r.id || 'N/A')) : (' · ' + (r.error || 'N/A'))), 'wsl');
    await refreshWsl(true);
    /* 如实回传：ok() 会补恒真 ok:true，这里显式覆盖为本次 create 的结果 */
    c.json(200, Object.assign({}, wslCache, r, { ok: !!r.ok }));
  } catch (e) { bad(c, e.message); }
});
app.post('/api/wsl/pull', async c => {
  try { const r = await wsl.pull(c.body.image); addLog('INFO', '拉取镜像 ' + c.body.image, 'wsl'); await refreshWsl(true); ok(c, r); }
  catch (e) { bad(c, e.message); }
});
app.get('/api/wsl/distros', async c => {
  addLog('INFO', '枚举 WSL 发行版', 'wsl');
  const r = await wsl.distros();
  await refreshWslExtra();
  c.json(200, r);
});
app.get('/api/wsl/manager', async c => {
  c.json(200, await wsl.managerStatus());
});
app.post('/api/wsl/exec', async c => {
  const cmd = String(c.body.cmd || '').trim();
  if (!cmd) { bad(c, '命令为空'); return; }
  try {
    const r = await wsl.distroExec(c.body.distro || wsl.endpoint.distro, cmd, {
      root: c.body.root !== false,
      timeout: Math.min(Math.max(Number(c.body.timeout) || 30000, 1000), 120000)
    });
    addLog(r.ok ? 'INFO' : 'WARN', 'WSL 命令 [' + r.distro + '] ' + cmd.slice(0, 90), 'wsl');
    ok(c, r);
  } catch (e) { bad(c, e.message); }
});
/* v14 常驻终端：同一个 sid 内保持 cwd / 发行版，连续执行多条命令，
   连接的发行版就是 dockerd 所在的 WSL 系统（默认 endpoint.distro）。 */
const TERM_SESS = new Map();
function shQuote(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }
app.get('/api/wsl/term', c => {
  let distros = [];
  try { const d = wslCache && wslCache.distros; if (Array.isArray(d)) distros = d.map(x => x.name || x); } catch (e) {}
  c.json(200, { ok: true, distro: wsl.endpoint.distro || 'Debian', distros, sessions: TERM_SESS.size });
});
app.post('/api/wsl/term', async c => {
  const sid = /^[A-Za-z0-9_.\-]{1,64}$/.test(String(c.body.sid || '')) ? String(c.body.sid) : 'default';
  let ses = TERM_SESS.get(sid);
  if (!ses) { ses = { cwd: '', distro: wsl.endpoint.distro || 'Debian', created: Date.now() }; TERM_SESS.set(sid, ses); }
  if (c.body.distro) ses.distro = String(c.body.distro).slice(0, 60);
  const cmd = String(c.body.cmd || '').trim().slice(0, 2000);
  if (!cmd) { bad(c, '命令为空'); return; }
  const pre = ses.cwd ? ('cd ' + shQuote(ses.cwd) + ' 2>/dev/null || cd "$HOME"; ') : 'cd "$HOME" 2>/dev/null; ';
  const wrapped = pre + cmd + '; printf "\n__NasDeck_CWD__%s\n" "$PWD"';
  try {
    const r = await wsl.distroExec(ses.distro, wrapped, {
      root: c.body.root !== false, timeout: Math.min(Math.max(Number(c.body.timeout) || 30000, 1000), 120000)
    });
    let out = String(r.out || ''), cwd = ses.cwd;
    const m = /__NasDeck_CWD__([^\n]*)\n?\s*$/.exec(out);
    if (m) { cwd = m[1].trim() || cwd; out = out.slice(0, m.index).replace(/\n$/, ''); }
    ses.cwd = cwd;
    addLog(r.ok ? 'INFO' : 'WARN', '终端 [' + ses.distro + '] ' + cmd.slice(0, 90), 'wsl');
    c.json(200, { ok: !!r.ok, out: out, err: r.err || '', cwd: cwd, distro: r.distro || ses.distro, sid: sid, cmd: cmd,
      prompt: (c.body.root === false ? 'user' : 'root') + '@' + (r.distro || ses.distro) + ':' + (cwd || '~') + '# ' });
  } catch (e) { bad(c, e.message); }
});
app.post('/api/wsl/term/close', c => {
  const sid = String(c.body.sid || 'default');
  c.json(200, { ok: true, closed: TERM_SESS.delete(sid) });
});
app.post('/api/wsl/autostart', async c => {
  addLog('INFO', '一键发现并启动 WSL Docker 引擎', 'wsl');
  let r;
  try { r = await wsl.autoStart(); }
  catch (e) { r = { ok: false, message: '自动启动失败（N/A）：' + e.message, steps: [], discovered: null }; }
  addLog(r.ok ? 'INFO' : 'WARN', r.message, 'wsl');
  /* 启动成功后开启 WSL 会话保活 + 引擎看门狗：
     否则 WSL2 空闲自动休眠会再次让 2375 掉线，界面看起来「控制不了」。 */
  let keep = null;
  if (r.ok) keep = wsl.keepAliveStart();
  await refreshWsl(true);
  await refreshWslExtra();
  ok(c, Object.assign({}, r, { wsl: wslCache, keepAlive: keep }));
});
/* WSL 会话保活 / 引擎看门狗：GET 查实时状态，POST 开关 */
app.get('/api/wsl/keepalive', async c => c.json(200, await wsl.keepAliveStatus()));
app.post('/api/wsl/keepalive', async c => {
  const on = c.body && c.body.on !== false;
  const r = on ? wsl.keepAliveStart() : wsl.keepAliveStop();
  addLog('INFO', on ? '开启 WSL 保活与引擎看门狗' : '关闭 WSL 保活', 'wsl');
  emit('wsl', wslCache);
  ok(c, Object.assign({ on }, r));
});
/* 引擎显式控制：重启 / 停止（真实作用于 WSL 内 systemd 服务） */
app.post('/api/wsl/engine/restart', async c => {
  addLog('INFO', '重启 WSL 内 Docker 引擎', 'wsl');
  const r = await wsl.engineRestart();
  addLog(r.ok ? 'INFO' : 'WARN', r.message, 'wsl');
  await refreshWsl(true);
  ok(c, Object.assign({}, r, { wsl: wslCache, keepAlive: await wsl.keepAliveStatus() }));
});
app.post('/api/wsl/engine/stop', async c => {
  addLog('WARN', '停止 WSL 内 Docker 引擎', 'wsl');
  const r = await wsl.engineStop();
  await refreshWsl(true);
  ok(c, Object.assign({}, r, { wsl: wslCache }));
});
/* 强制立即刷新真实容器 / 镜像 / 网络 / 卷快照 */
app.post('/api/wsl/refresh', async c => {
  await refreshWsl(true);
  await refreshWslExtra();
  c.json(200, Object.assign({ ok: true }, wslCache, { keepAlive: await wsl.keepAliveStatus() }));
});
/* 兼容旧前端的 Docker 路由名：同样必须 await 刷新，否则永远返回旧缓存 */
app.get('/api/docker/ps', async c => { c.json(200, await refreshWsl()); });
app.get('/api/docker/images', async c => {
  const snap = await refreshWsl(true);
  c.json(200, { ok: !!snap.available, images: snap.images || [], available: snap.available, message: snap.message || '' });
});
/* v14 容器标签下半窗：资源占用与日志。直接读 Engine，不做整份快照刷新（快）。 */
app.get('/api/docker/container', async c => {
  const id = String(c.query.id || ''), act = String(c.query.act || 'stats');
  if (!/^[A-Za-z0-9_.\-]{1,80}$/.test(id)) { bad(c, '非法容器 ID'); return; }
  if (act !== 'stats' && act !== 'logs') { bad(c, '不支持的查询'); return; }
  try {
    const r = await wsl.action(id, act);
    c.json(200, { ok: !!r.ok, out: r.out || '', error: r.error || '', code: r.code || 0, act, id });
  } catch (e) { bad(c, e.message); }
});
app.post('/api/docker/action', async c => {
  try {
    const r = await wsl.action(c.body.id, c.body.act);
    const snap = await refreshWsl(true);
    c.json(200, Object.assign({ ok: !!r.ok }, snap, {
      out: r.out || '', error: r.error || '', code: r.code || 0,
      action: c.body.act, id: c.body.id
    }));
  } catch (e) { bad(c, e.message); }
});

/* -------------------- Windows 原生能力 -------------------- */
app.get('/api/win/snapshot', c => c.json(200, windows.snapshotAll()));
const WIN_GETTERS = {
  system: windows.system, services: windows.services, firewall: windows.firewall,
  shares: windows.shares, adapters: windows.adapters, events: windows.events,
  tasks: windows.tasks, apps: windows.apps, processes: windows.processes,
  connections: windows.connections, storage: windows.storage, defender: windows.defender,
  users: windows.users, vss: windows.vss, perf: windows.perf,
  hardware: windows.hardware
};
for (const [k, fn] of Object.entries(WIN_GETTERS)) {
  app.get('/api/win/' + k, async c => {
    const force = c.query.force === '1';
    if (force) windows.drop([k]);
    c.json(200, { ok: true, section: k, data: await fn() });
  });
}
app.post('/api/win/refresh', async c => {
  const sec = String(c.body.section || '').replace(/[^\w]/g, '');
  const fn = WIN_GETTERS[sec];
  if (!fn) { bad(c, '未知采集项'); return; }
  windows.drop([sec]);
  const data = await fn(true);
  emit('windows', { section: sec, data });
  ok(c, { section: sec, data });
});
app.post('/api/win/service', async c => {
  const r = await windows.serviceAction(c.body.name, c.body.act);
  addLog(r.ok ? 'INFO' : 'WARN', 'Windows 服务 ' + c.body.act + ' ' + c.body.name, 'service');
  if (r.ok) emit('services', { services: (await windows.services(true)).services });
  r.ok ? ok(c, r) : bad(c, (r.error || '') + (r.out ? ' · ' + r.out.slice(0, 200) : ''));
});
app.post('/api/win/firewall/rule', async c => {
  const r = await windows.firewallRule(c.body);
  addLog(r.ok ? 'INFO' : 'WARN', '防火墙规则 ' + (c.body.act || 'add') + ' ' + (c.body.name || ''), 'firewall');
  if (r.ok) emit('firewall', await windows.firewall(true));
  r.ok ? ok(c, r) : bad(c, r.error || r.out);
});
app.post('/api/win/firewall/profile', async c => {
  const r = await windows.firewallProfile(c.body.name, !!c.body.enabled);
  addLog('INFO', '防火墙配置文件 ' + c.body.name + ' → ' + (c.body.enabled ? '启用' : '停用'), 'firewall');
  if (r.ok) emit('firewall', await windows.firewall(true));
  r.ok ? ok(c, r) : bad(c, r.error || r.out);
});
app.post('/api/win/share', async c => {
  const r = await windows.shareAction(c.body);
  addLog(r.ok ? 'INFO' : 'WARN', 'SMB 共享 ' + (c.body.act || 'add') + ' ' + (c.body.name || ''), 'share');
  if (r.ok) emit('shares', await windows.shares(true));
  r.ok ? ok(c, r) : bad(c, r.error || r.out);
});
app.post('/api/win/vss/create', async c => {
  const r = await windows.vssCreate(c.body.volume);
  addLog(r.ok ? 'INFO' : 'WARN', '建立卷影副本 ' + (c.body.volume || ''), 'vss');
  if (r.ok) emit('vss', await windows.vss(true));
  r.ok ? ok(c, r) : bad(c, r.error || r.out);
});
app.post('/api/win/task', async c => {
  const r = await windows.taskAction(c.body.name, c.body.act);
  addLog(r.ok ? 'INFO' : 'WARN', '计划任务 ' + c.body.act + ' ' + c.body.name, 'task');
  r.ok ? ok(c, r) : bad(c, r.error || r.out);
});
app.post('/api/win/process/kill', async c => {
  const r = await windows.processKill(c.body.pid);
  addLog(r.ok ? 'WARN' : 'WARN', '结束进程 PID ' + c.body.pid, 'process');
  r.ok ? ok(c, r) : bad(c, r.error || r.out);
});
app.post('/api/win/winget', async c => {
  const r = await windows.winget(c.body.act, c.body.id);
  addLog(r.ok ? 'INFO' : 'WARN', 'winget ' + c.body.act + ' ' + c.body.id, 'appcenter');
  if (r.ok) emit('apps', await windows.apps(true));
  r.ok ? ok(c, r) : bad(c, r.error || r.out);
});
app.post('/api/win/defender/scan', async c => {
  const r = await windows.defenderScan();
  addLog('INFO', '启动 Windows Defender 快速扫描', 'security');
  r.ok ? ok(c, r) : bad(c, r.error || r.out);
});
/* -------------------- 真实网卡写操作 -------------------- */
function q1(v) { return "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'"; }
function validIP(v) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(v || '').trim());
  return !!m && [1, 2, 3, 4].every(i => Number(m[i]) <= 255);
}
app.post('/api/win/adapter', async c => {
  const b = c.body || {};
  const act = String(b.act || 'info');
  const n = String(b.name || '');
  const globalAct = ['renew', 'flushdns'].includes(act);
  if (!globalAct && !/^[\w .\-()]{1,80}$/.test(n)) { bad(c, '网卡名称不合法'); return; }
  if (!windows.IS_WIN) { bad(c, '网卡管理仅支持 Windows'); return; }
  const admin = windows.isAdmin();
  let script = '';
  const N = q1(n);
  switch (act) {
    case 'enable':
      script = "Enable-NetAdapter -Name " + N + " -Confirm:$false -ErrorAction Stop; Get-NetAdapter -Name " + N + " | Select-Object Name,Status,LinkSpeed | ConvertTo-Json -Compress";
      break;
    case 'disable':
      script = "Disable-NetAdapter -Name " + N + " -Confirm:$false -ErrorAction Stop; Get-NetAdapter -Name " + N + " | Select-Object Name,Status,LinkSpeed | ConvertTo-Json -Compress";
      break;
    case 'restart':
      script = "Disable-NetAdapter -Name " + N + " -Confirm:$false -ErrorAction Stop; Start-Sleep -Seconds 2; Enable-NetAdapter -Name " + N + " -Confirm:$false -ErrorAction Stop; Get-NetAdapter -Name " + N + " | Select-Object Name,Status,LinkSpeed | ConvertTo-Json -Compress";
      break;
    case 'flushdns':
      script = "Clear-DnsClientCache -ErrorAction Stop; 'DNS_CACHE_CLEARED'";
      break;
    case 'renew':
      script = "& ipconfig.exe /release; & ipconfig.exe /renew; 'DHCP_RENEW_DONE'";
      break;
    case 'setdns': {
      const list = String(b.dns || '').split(/[,;\s]+/).filter(Boolean);
      if (!list.length || !list.every(validIP)) { bad(c, '请提供合法的 DNS IPv4 地址'); return; }
      script = "Set-DnsClientServerAddress -InterfaceAlias " + N + " -ServerAddresses @(" +
        list.map(q1).join(',') + ") -ErrorAction Stop; Get-DnsClientServerAddress -InterfaceAlias " + N + " -AddressFamily IPv4 | Select-Object -ExpandProperty ServerAddresses | ConvertTo-Json -Compress";
      break;
    }
    case 'dhcp':
      script = "Set-NetIPInterface -InterfaceAlias " + N + " -Dhcp Enabled -ErrorAction Stop; 'DHCP_ENABLED'";
      break;
    case 'setip': {
      const ip = String(b.ip || ''), gw = String(b.gateway || ''), pref = Number(b.prefix || 24);
      if (!validIP(ip) || (gw && !validIP(gw)) || !(pref >= 1 && pref <= 32)) { bad(c, 'IP / 网关 / 前缀长度不合法'); return; }
      script = "New-NetIPAddress -InterfaceAlias " + N + " -IPAddress " + q1(ip) +
        " -PrefixLength " + pref + (gw ? " -DefaultGateway " + q1(gw) : "") +
        " -ErrorAction Stop | Select-Object InterfaceAlias,IPAddress,PrefixLength | ConvertTo-Json -Compress";
      break;
    }
    case 'info':
      script = "Get-NetAdapter -Name " + N + " | Select-Object Name,InterfaceDescription,Status,LinkSpeed,MacAddress,ifIndex,MediaType,PhysicalMediaType,HardwareInterface | ConvertTo-Json -Compress -Depth 3";
      break;
    default:
      bad(c, '不支持的网卡操作: ' + act); return;
  }
  const r = await windows.ps("$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Continue'; " + script, 35000);
  const needAdmin = ['enable', 'disable', 'restart', 'setdns', 'dhcp', 'setip'].includes(act) && !admin;
  addLog(needAdmin ? 'WARN' : 'INFO', '网卡操作 ' + act + ' · ' + n + (needAdmin ? '（权限不足）' : ''), 'network');
  let adapters = [];
  try { adapters = (await windows.adapters(true)).adapters || []; } catch (e) {}
  emit('adapters', { adapters });
  ok(c, {
    ok: !!r.ok && !/Access is denied|拒绝访问|权限不足|not have| insufficient/i.test(r.err || ''),
    act, name: n, out: r.out, err: r.err,
    admin, needAdmin, adapters
  });
});

app.get('/api/win/diag', async c => {
  const r = await windows.netDiag(c.query.act || 'ipconfig');
  addLog('INFO', '网络诊断 ' + (c.query.act || 'ipconfig'), 'network');
  ok(c, r);
});

/* -------------------- 监测与告警 -------------------- */
app.get('/api/monitor', c => c.json(200, monitor.snapshot()));
app.post('/api/monitor/thresholds', c => {
  const t = monitor.setThresholds(c.body);
  settings.set('thresholds', { ...t });
  addLog('INFO', '更新告警阈值 ' + JSON.stringify(t), 'monitor');
  ok(c, { thresholds: t });
});
app.post('/api/monitor/alerts/clear', c => { ok(c, { alerts: monitor.clearAlerts() }); });
app.post('/api/monitor/toggle', c => { monitor.conf.enabled = c.body.enabled !== false; ok(c, { enabled: monitor.conf.enabled }); });

/* -------------------- BackupDeck 真实备份 -------------------- */
app.get('/api/backups', c => c.json(200, { jobs: backups.snapshot() }));
app.post('/api/backups/create', c => {
  const r = backups.create(c.body); r.ok ? ok(c, r) : bad(c, r.error);
});
app.post('/api/backups/run', c => {
  const r = backups.run(c.body.id, !!c.body.restore); r.ok ? ok(c, r) : bad(c, r.error);
});
app.post('/api/backups/remove', c => ok(c, backups.remove(c.body.id)));
app.post('/api/backups/schedule', c => {
  const r = backups.schedule(c.body.id, c.body.at, !!c.body.remove); r.ok ? ok(c, r) : bad(c, r.error);
});

/* -------------------- BT / 磁力（aria2 RPC） -------------------- */
app.get('/api/bt/status', async c => c.json(200, await aria2.status()));
app.get('/api/bt/list', async c => c.json(200, { tasks: await aria2.list() }));
app.post('/api/bt/add', async c => {
  const r = await aria2.add(c.body.url, c.body.name);
  addLog(r.ok ? 'INFO' : 'WARN', 'BT 任务 ' + String(c.body.url).slice(0, 100), 'download');
  r.ok ? ok(c, r) : bad(c, r.error);
});
app.post('/api/bt/action', async c => {
  const r = await aria2.action(c.body.gid, c.body.act); r.ok ? ok(c, r) : bad(c, r.error);
});
app.post('/api/bt/config', c => {
  const cfg = aria2.configure(c.body);
  settings.set('aria2', cfg);
  ok(c, { config: cfg });
});

/* -------------------- 下载 -------------------- */
app.get('/api/downloads', c => c.json(200, { downloads: downloads.snapshot() }));
app.post('/api/downloads/add', async c => {
  const url = String(c.body.url || '').trim();
  if (/^(magnet:|bt:)/i.test(url) || /\.torrent$/i.test(url)) {
    const st = await aria2.status();
    if (!st.available) { bad(c, 'BT / 磁力需要 aria2 RPC：' + st.message); return; }
    try {
      const r = await aria2.add(url, c.body.name);
      addLog('INFO', '新增 BT 任务 ' + url.slice(0, 100), 'download');
      c.json(200, { ok: true, bt: true, gid: r.gid, tasks: r.tasks, downloads: downloads.snapshot() });
    } catch (e) { bad(c, e.message); }
    return;
  }
  try {
    const list = downloads.add(url, c.body.name);
    addLog('INFO', '新增下载任务 ' + url.slice(0, 120), 'download');
    ok(c, { downloads: list });
  } catch (e) { bad(c, e.message); }
});
app.post('/api/downloads/action', c => {
  try { ok(c, { downloads: downloads.action(c.body.id, c.body.act) }); }
  catch (e) { bad(c, e.message); }
});

/* -------------------- 媒体库 --------------------
 * v13：三个媒体 App 可各自选择文件夹；扫描会读取真实元数据 / 封面 /
 * 字幕 / 歌词。目录选择只能选本机真实存在的绝对路径。 */
app.get('/api/media/scan', c => c.json(200, media.scan()));
app.post('/api/media/roots', c => {
  const body = c.body || {};
  if (body.kind) {
    if (!['photo', 'music', 'video'].includes(body.kind)) { bad(c, '未知的媒体类别'); return; }
    media.setKindRoots(body.kind, body.roots || []);
  } else media.setRoots(body.roots || []);
  settings.set('mediaRoots', media.roots);
  settings.set('mediaKindRoots', media.rootsByKind);
  addLog('INFO', '更新媒体库目录：' + media.roots.length + ' 个（按类别 ' + JSON.stringify(Object.keys(media.rootsByKind).map(k => k + ':' + media.rootsByKind[k].length).join(' ')) + '）', 'media');
  ok(c, { roots: media.roots, rootsByKind: media.rootsByKind, scan: media.scan() });
});
app.get('/api/media/browse', c => c.json(200, media.browse(c.query.path || '__root__')));
app.get('/api/media/detail', c => c.json(200, media.detail(c.query.path || '')));
app.get('/api/media/file', c => {
  if (!tokenSession(c)) { c.json(401, { error: '未登录' }); return; }
  const p = String(c.query.path || '');
  if (!path.isAbsolute(p)) { c.json(400, { error: '需要绝对路径' }); return; }
  if (!fs.existsSync(p)) { c.json(404, { error: '文件不存在' }); return; }
  streamFile(c.req, c.res, p, { cache: 'private, max-age=3600' });
}, { auth: false });

/* -------------------- 日志 / 通知 / 设置 -------------------- */
app.get('/api/logs', c => c.json(200, { logs: LOGS.slice(-500) }));
app.get('/api/logs/export', c => {
  if (!tokenSession(c)) { c.json(401, { error: '未登录' }); return; }
  const txt = LOGS.map(l => l.time + ' [' + l.lv + '] [' + l.src + '] ' + l.msg).join('\r\n');
  c.res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': "attachment; filename*=UTF-8''nasdeck-system.log" });
  c.res.end('\ufeff' + txt);
}, { auth: false });
app.post('/api/logs/clear', c => { LOGS = []; logStore.set('logs', LOGS); addLog('INFO', '系统日志已清空', 'system'); ok(c, { logs: LOGS }); });
app.get('/api/notis', c => c.json(200, { notis: NOTIS }));
app.post('/api/notis/read', c => {
  if (c.body.all) NOTIS.forEach(n => n.u = 0);
  else { const n = NOTIS.find(x => x.id === c.body.id || x.t === c.body.t); if (n) n.u = 0; }
  notiStore.set('notis', NOTIS);
  ok(c, { notis: NOTIS });
});
app.post('/api/notis/clear', c => { NOTIS = []; notiStore.set('notis', NOTIS); ok(c, { notis: [] }); });
app.get('/api/settings', c => c.json(200, { settings: settings.all() }));
app.post('/api/settings', c => {
  const allow = ['theme', 'wall', 'accent', 'bright', 'volume', 'widgets', 'installed', 'fw', 'cloud', 'hbs', 'cp', 'net', 'fwRules', 'mediaRoots', 'mediaKindRoots', 'pluginIcons', 'dockerRegistries'];
  const patch = {};
  for (const k of allow) if (c.body[k] !== undefined) patch[k] = c.body[k];
  settings.patch(patch);
  ok(c, { settings: settings.all() });
});
app.post('/api/apps/install', c => {
  const inst = Object.assign({}, settings.get('installed') || {});
  inst[c.body.id] = c.body.remove ? 0 : 1;
  settings.set('installed', inst);
  addLog('INFO', (c.body.remove ? '卸载' : '安装') + '应用 ' + c.body.id, 'appcenter');
  ok(c, { installed: inst });
});

/* -------------------- 插件中心（App Center） --------------------
   不再读取本机已安装软件 / 注册表卸载项。App Center 存放的是本项目功能，
   以「插件」形式登记；用户可按模板编写 .js 插件并上传。 */
app.get('/api/plugins/list', c => c.json(200, plugins.list()));
app.get('/api/plugins/template', c => c.json(200, { ok: true, code: plugins.template(), filename: 'my-plugin.js' }));
app.get('/api/plugins/content', c => {
  try { c.json(200, plugins.content(c.query.id || '')); }
  catch (e) { bad(c, e.message); }
});
app.post('/api/plugins/upload', c => {
  try {
    const r = plugins.upload(c.body);
    /* 安装即上桌面：自动登记一个可删除的快捷方式（不影响插件本体） */
    try {
      const p = (plugins.list().plugins || []).filter(x => x.id === r.id)[0] || {};
      const icons = settings.get('pluginIcons', []);
      const arr = (Array.isArray(icons) ? icons : []).filter(x => x && x.id !== r.id);
      arr.push({ id: r.id, name: p.name || r.name || r.id, icon: p.icon || 'box',
        category: p.category || '插件', builtin: false });
      settings.set('pluginIcons', arr.slice(0, 100));
    } catch (e) {}
    addLog('INFO', '上传插件 ' + r.id + '（' + r.size + ' bytes）并添加到桌面', 'appcenter');
    ok(c, r);
  } catch (e) { addLog('WARN', '插件上传失败：' + e.message, 'appcenter'); bad(c, e.message); }
});
app.post('/api/plugins/toggle', c => {
  try {
    const r = plugins.toggle(c.body.id, c.body.enabled !== false);
    addLog('INFO', (r.enabled ? '启用' : '停用') + '插件 ' + r.id, 'appcenter');
    ok(c, r);
  } catch (e) { bad(c, e.message); }
});
app.post('/api/plugins/remove', c => {
  try {
    const r = plugins.remove(c.body.id);
    const icons = iconList().filter(x => x.id !== r.id);
    settings.set('pluginIcons', icons);
    addLog('WARN', '删除插件 ' + r.id, 'appcenter');
    ok(c, r);
  } catch (e) { bad(c, e.message); }
});
/* v14 桌面图标：插件安装后在桌面显示快捷方式；删除图标只删快捷方式，
   插件本体（data/plugins/*.js）与启用状态完全保留，随时可恢复图标。 */
function iconList() {
  const v = settings.get('pluginIcons', []);
  return Array.isArray(v) ? v.filter(x => x && x.id && x.name).slice(0, 100) : [];
}
app.get('/api/plugins/icons', c => c.json(200, { ok: true, icons: iconList() }));
app.post('/api/plugins/icons', c => {
  const act = String(c.body.act || 'add'), id = String(c.body.id || '').slice(0, 80);
  let icons = iconList();
  if (act === 'remove') icons = icons.filter(x => x.id !== id);
  else if (act === 'add' && id) {
    icons = icons.filter(x => x.id !== id);
    icons.push({ id: id, name: String(c.body.name || id).slice(0, 60), icon: String(c.body.icon || 'box').slice(0, 40),
      category: String(c.body.category || '插件').slice(0, 40), builtin: !!c.body.builtin });
  } else if (act === 'clear') icons = [];
  else { bad(c, '不支持的桌面图标操作'); return; }
  settings.set('pluginIcons', icons);
  addLog('INFO', (act === 'remove' ? '移除' : '添加') + '桌面插件图标 ' + id, 'appcenter');
  ok(c, { icons: icons });
});

/* -------------------- 电源（真实执行，60 秒延时可取消） -------------------- */
let powerPending = null;
app.post('/api/power', async c => {
  if (c.body.cancel) {
    if (powerPending) { clearTimeout(powerPending.timer); powerPending = null; }
    await windows.power('', true);
    addLog('INFO', '电源操作已取消', 'power');
    ok(c, { executed: false, message: '已取消关机 / 重启计划' });
    return;
  }
  const r = await windows.power(c.body.act || '');
  if (!r.ok) { bad(c, r.error); return; }
  if (r.scheduled && r.run) {
    if (powerPending) clearTimeout(powerPending.timer);
    const timer = setTimeout(() => {
      const done = r.run();
      addLog(done ? 'WARN' : 'ERR', done ? '系统电源命令已执行' : '系统电源命令执行失败（可能被系统策略阻止）', 'power');
      powerPending = null;
    }, r.delay * 1000);
    powerPending = { timer, act: c.body.act };
  }
  addLog('WARN', '收到电源请求 ' + (c.body.act || '') + ' · ' + r.message, 'power');
  c.json(200, { ok: true, executed: !!r.executed, scheduled: !!r.scheduled, delay: r.delay || 0, message: r.message });
});
app.get('/api/power/status', c => c.json(200, { pending: powerPending ? { act: powerPending.act } : null }));

/* ============================ 启动 ============================
 * 用户要求的启动顺序（v8）：
 *  [第一部分] HTTP 服务 / 静态首页 / 鉴权 / 基础 API / SSE 通道 ——
 *             在 app.listen() 之前就已全部注册完成，浏览器一打开就看得见。
 *  [之后]     启动编排器按阶段「串行」执行：
 *             ① 前端面板支持 → ② 环境检查 → ③ 文件与数据引擎（只读校验）
 *             → ④ 系统采样与监测 → ⑤ Windows 管理数据 → ⑥ 回收站缓存
 *             → ⑦ WSL / Docker 引擎 → ⑧ 按需服务登记 → ⑨ 系统就绪
 *  ①②③ 完成即 coreReady：用户可以立刻进系统，剩余功能继续在后台
 *  逐级上线，并在「启动进度屏 / 系统启动中心」里实时可见。
 *  重功能（全盘索引、硬件深采、媒体扫描、BT、Docker 冷启动）默认不随
 *  开机全跑，登记为「按需启动」，避免一次把系统负担拉满。
 * ============================================================ */
/* 桌面版「后端设置窗口」可在运行时热切这些值；node server.js 直跑时
   仍从环境变量取初值，行为与之前完全一致。 */
let PORT = Number(process.env.PORT || 5080);
let HOST = process.env.HOST || '127.0.0.1';
let DOCKER_AUTOSTART = process.env.NasDeck_WSL_AUTOSTART !== '0';
let HTTP_SERVER = null;
const STARTED_AT = Date.now();

let metricsTimer = null;
function startMetrics() {
  if (metricsTimer) return;
  sysinfo.start(() => {});      // 只做底层采样，metrics 由 monitor 统一发
  metricsTimer = setInterval(() => {
    try {
      const snap = sysinfo.snapshot();
      const ht = windows.cpuTemp();
      if (ht !== null && ht !== undefined) { snap.temp = ht; snap.tempSource = 'hardware'; }
      monitor.sample(snap);
    } catch (e) {}
  }, 2000);
  if (metricsTimer.unref) metricsTimer.unref();
  monitor.start();
}

/* ---------- ① 前端面板支持：listen 之前已完成，这里只做如实校验 ---------- */
async function stageFrontend(ctx) {
  ctx.step('HTTP 监听与路由表', 20, '共 ' + app.routes.length + ' 条路由');
  ctx.step('静态首页 / no-store 缓存策略', 42,
    fs.existsSync(path.join(ROOT, 'index.html')) ? 'index.html 就位' : 'index.html 缺失');
  ctx.step('鉴权 / 会话 / 水合接口', 64, 'login · session · bootstrap');
  ctx.step('启动状态接口（免登录轮询）', 84, 'health · boot/status · boot/log');
  ctx.step('SSE 实时通道', 98, '/api/events 已挂载');
  return { message: '浏览器现在可以连接 ' + HOST + ':' + PORT };
}

/* ---------- ② 运行环境检查：全部只读，绝不改写数据 ---------- */
async function stageEnvironment(ctx) {
  const notes = [];
  ctx.step('Node 运行时与操作系统', 14, process.version + ' / ' + process.platform + ' ' + process.arch);
  const admin = windows.isAdmin();
  ctx.step('管理员权限探测', 30, admin ? '已提权：全部管理功能可用' : '未提权：服务/防火墙/VSS 写操作会返回明确错误');
  if (!admin) notes.push('未提权');
  let writable = false, dirErr = '';
  try { fs.accessSync(DATA, fs.constants.W_OK); writable = true; }
  catch (e) { dirErr = e.message; }
  ctx.step('数据目录可写性（只读校验）', 50, writable ? '可写 · 未写入任何文件' : '不可写：' + dirErr);
  if (!writable) notes.push('数据目录不可写');
  let freeGB = null;
  try { const st = fs.statfsSync(ROOT); freeGB = +(st.bavail * st.bsize / 1073741824).toFixed(1); } catch (e) {}
  ctx.step('磁盘可用空间', 66, freeGB === null ? 'N/A' : freeGB + ' GB 可用');
  const modOk = !!winnas.available;
  ctx.step('WinNAS 引擎模块', 80, modOk ? (winnas.state.modules.length + ' 个模块已挂载') : ('N/A：' + winnas.state.reason));
  if (!modOk) notes.push('WinNAS 引擎不可用');
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  ctx.step('WSL 可执行环境（只探测文件存在）', 92, fs.existsSync(wslExe) ? 'wsl.exe 存在' : 'wsl.exe 不存在（N/A）');
  const weakPwd = !process.env.NasDeck_PASSWORD;
  const exposed = HOST === '0.0.0.0';
  ctx.step('安全配置检查', 99, weakPwd && exposed ? '监听所有网卡且仍用默认密码：建议设置 NasDeck_PASSWORD' : '配置检查完成');
  return {
    message: notes.length ? ('检查完成 · 需要注意：' + notes.join('、')) : '环境检查通过（只读，未改动任何数据）',
    warn: notes.length > 0
  };
}

/* ---------- ③ 文件与数据引擎：只读快照，不写不删 ---------- */
async function stageStorage(ctx) {
  ctx.step('WinNAS 引擎状态', 22, winnas.available ? winnas.state.version : 'N/A');
  let roots = 0, drives = 0;
  try { roots = winnas.roots().filter(r => r.key !== '__computer__').length; } catch (e) {}
  try { drives = winnas.drives().length; } catch (e) {}
  ctx.step('ROOTS 静态根与本机盘符', 48, roots + ' 个静态根 · ' + drives + ' 个盘符');
  let binTotal = 0;
  try { const b = winnas.binPeek(); binTotal = b.total || 0; } catch (e) {}
  ctx.step('回收站 / 版本 / 索引缓存（只读快照）', 74, '回收站缓存 ' + binTotal + ' 项');
  let settingsOk = false;
  try { settingsOk = !!settings.all(); } catch (e) {}
  ctx.step('配置与日志持久化校验', 88, settingsOk ? '可读 · 未写入' : 'N/A');
  /* 核心阶段就确保只读 Engine 快照在跑（listen 时已启动，这里幂等兜底）。
     容器/镜像来自真实 Docker Engine REST，Engine 在线时界面立刻有数据，
     Engine 掉线时如实显示 N/A，绝不编造。 */
  startWslPoller();
  ctx.step('容器引擎快照（只读 HTTP，不唤醒 WSL）', 96,
    wslCache.available
      ? ('Docker 在线 · 容器 ' + (wslCache.containers || []).length + ' / 镜像 ' + (wslCache.images || []).length)
      : 'Engine 未连线（N/A）· 由启动中心按需唤醒');
  return {
    message: winnas.available
      ? 'WinNAS 引擎就绪 · 文件始终保存在 Windows 本机磁盘'
      : 'WinNAS 引擎不可用，文件类功能会显示 N/A',
    warn: !winnas.available
  };
}

/* ---------- ④ 系统采样与监测 ---------- */
async function stageMetrics(ctx) {
  ctx.step('启动底层指标采样', 30, 'CPU / 内存 / 磁盘 / 网速');
  startMetrics();
  ctx.step('注册 2 秒采样与阈值告警', 70, 'CPU ≥85% · 内存 ≥90% · 温度 ≥80°C');
  ctx.step('Windows 事件日志 / 服务 / 网卡轮询', 98, 'monitor.start()');
  return { message: '实时监测已上线（SSE 每 2 秒推送）' };
}

/* ---------- ⑤ Windows 管理数据：后台分批预热，不阻塞登录 ---------- */
async function stageWindows(ctx) {
  ctx.step('分批预热 WMI / CIM 数据', 18, '服务 / 防火墙 / 计划任务 / 硬件清单');
  windows.warmup(emit);        // 内部异步分批，完成后推 SSE winready
  for (let i = 1; i <= 6; i++) {
    await ctx.sleep(320);
    ctx.step('后台预热进行中 ' + i + '/6', 18 + i * 13, '不阻塞前端与后续阶段');
  }
  ctx.step('已交给后台分批执行', 99, '完成后前端自动补齐，绝不使用模拟数据');
  return { message: 'WMI 预热已排队（后台执行）' };
}

/* ---------- ⑥ 回收站与文件缓存 ---------- */
async function stageRecycle(ctx) {
  ctx.step('后台预热真实 Windows 回收站缓存', 30, 'Shell.Application 列举，上万项时较慢');
  winnas.warm(b => {
    try {
      emit('bin', (b.items || []).slice(0, 200));
      emit('bininfo', { total: b.total, usedText: b.usedText, source: b.source, loading: false });
    } catch (e) { /* 忽略 SSE 推送异常 */ }
  });
  await ctx.sleep(500);
  ctx.step('缓存就绪', 99, 'bootstrap 只读缓存快照，不阻塞登录');
  return { message: '回收站缓存预热已排队（后台执行）' };
}

/* ---------- ⑦ WSL / Docker 引擎（排在最后一级，可跳过 / 可禁用） ---------- */
async function stageDocker(ctx) {
  if (!DOCKER_AUTOSTART) ctx.skip('启动脚本使用 --nodocker，Docker 自动启动已禁用');
  ctx.step('探测 Docker Engine 端点', 12, wsl.endpoint.host + ':' + wsl.endpoint.port);
  let found = false, msg = '';
  try {
    const d = await wsl.discover();
    found = !!d.found;
    msg = d.message || '';
    ctx.step(found ? '引擎已在线，读取版本与容器' : '端点未在线，准备唤醒 WSL', found ? 56 : 32, msg);
  } catch (e) { msg = e.message; }
  ctx.checkSkip();
  if (!found) {
    ctx.step('唤醒 WSL 发行版并启动 dockerd', 44, 'systemd drop-in + nohup 兜底');
    try {
      const r = await wsl.autoStart();
      msg = r.message || '';
      addLog(r.ok ? 'INFO' : 'WARN', r.message, 'wsl');
    } catch (e) { msg = e.message; addLog('WARN', 'WSL 自动启动失败（N/A）：' + e.message, 'wsl'); }
  }
  ctx.checkSkip();
  ctx.step('验证 Engine /_ping 并刷新容器快照', 80, '');
  await refreshWsl(true);
  const online = !!wslCache.available;
  if (online) {
    ctx.step('开启 WSL 会话保活与引擎看门狗', 96, 'v' + (wslCache.version || 'N/A'));
    wsl.keepAliveStart();      // 防 WSL2 空闲休眠导致 2375 再次掉线
    addLog('INFO', msg || ('Docker 引擎已在线 ' + (wslCache.version || '')), 'wsl');
  } else {
    ctx.step('引擎仍未连线（如实显示 N/A）', 96, '可在 容器工作台 手动启动');
    addLog('WARN', 'Docker 引擎未在线（N/A），系统其余功能不受影响', 'wsl');
  }
  startBackgroundPollers();
  return {
    message: online ? ('Docker Engine 在线 · ' + (wslCache.version || '') + ' · 保活已开启')
                    : 'Docker Engine 未在线（N/A）· 可在启动中心按需启动',
    warn: !online
  };
}

/* ---------- ⑧ 按需服务登记：只登记状态，不拉起重活 ---------- */
async function stageServices(ctx) {
  ctx.step('登记按需功能', 35, '全盘索引 / 硬件深采 / 媒体扫描 / 回收站重扫 / BT / Docker 冷启动');
  ctx.step('读取现有服务快照（不触发任何扫描）', 72, '备份 / 下载 / 终端 / 媒体');
  let jobs = 0;
  try { jobs = (backups.snapshot() || []).length || 0; } catch (e) {}
  ctx.step('低频后台轮询已注册', 96, 'WSL 15 秒 · 发行版 60 秒');
  startBackgroundPollers();
  return { message: '按需功能已登记 ' + ON_DEMAND.length + ' 项 · 备份任务 ' + jobs + ' 个 · 开机不跑重活' };
}

/* ---------- ⑨ 系统就绪 ---------- */
async function stageReady(ctx) {
  ctx.step('汇总启动结果', 45, '');
  const s = BOOT.status();
  const bad = s.stages.filter(x => x.status === 'error').length;
  const skipped = s.stages.filter(x => x.status === 'skipped' || x.status === 'timeout' || x.status === 'warn').length;
  ctx.step('写入系统日志与通知', 82, '');
  addLog(bad ? 'WARN' : 'INFO',
    'NasDeck WinNAS 分级启动完成 · ' + s.counts.done + ' 个阶段正常 / ' + skipped + ' 个降级或跳过 / 耗时 ' + (s.elapsed / 1000).toFixed(1) + 's', 'boot');
  addNoti('系统已就绪', '前端面板、环境、数据引擎已就绪；其余功能按阶段逐级上线，可在「系统启动中心」查看进度。', 'ok');
  if (skipped) addNoti('部分功能需手动启动', '有 ' + skipped + ' 个可选阶段降级或跳过，不影响系统使用，可在系统启动中心重试或按需启动。', 'info');
  ctx.step('启动完成', 100, '');
  return { message: bad ? '系统可用（降级）' : '系统已就绪' };
}

/* 按需功能：开机绝不自动执行，必须由用户在「系统启动中心」点击启动 */
const ON_DEMAND = [
  {
    id: 'docker', name: 'Docker 引擎冷启动', cost: '约 10–60 秒',
    desc: '唤醒 WSL 发行版、拉起 dockerd 并开启会话保活（WSL2 空闲休眠的根治方案）',
    run: async () => {
      const r = await wsl.autoStart();
      if (r.ok) wsl.keepAliveStart();
      await refreshWsl(true);
      return { message: r.message, data: { version: wslCache.version || '' } };
    }
  },
  {
    id: 'index', name: '全盘名称索引', cost: '数分钟 · 占磁盘 IO',
    desc: 'WinNAS search.js 分块遍历本机磁盘建立名称索引，供全盘搜索使用',
    run: async () => {
      if (!winnas.searchEngine) throw new Error('WinNAS 引擎不可用');
      const r = await winnas.searchEngine.buildIndexAsync();
      return { message: '名称索引建立完成', data: r };
    }
  },
  {
    id: 'hardware', name: '硬件深度重采', cost: '约 10 秒',
    desc: 'CIM 重新采集 CPU / 主板 / BIOS / 内存条 / GPU / 物理磁盘 / SMART',
    run: async () => {
      windows.drop(['hardware']);
      const d = await WIN_GETTERS.hardware(true);
      emit('windows', { section: 'hardware', data: d });
      return { message: '硬件清单已重新采集' };
    }
  },
  {
    id: 'media', name: '媒体库扫描', cost: '视文件量',
    desc: '扫描 Pictures / Music / Videos 与已配置的媒体根目录',
    run: async () => { const r = media.scan(); return { message: '媒体库扫描完成', data: r }; }
  },
  {
    id: 'bin', name: '回收站全量重扫', cost: '数十秒',
    desc: '重新列举真实 Windows 回收站（上万项时较慢），只读、不删除任何内容',
    run: async () => {
      const r = await binPayload(200, true);
      emit('bin', r.bin);
      return { message: '回收站已重新扫描 · ' + r.total + ' 项' };
    }
  },
  {
    id: 'bt', name: 'BT / aria2 连接检测', cost: '1 秒',
    desc: '探测本机 aria2 RPC 是否在线，不会自动安装或启动外部程序',
    run: async () => {
      const s = await aria2.status();
      return { message: s && s.ok ? 'aria2 RPC 在线' : 'aria2 未在线（N/A）', data: s };
    }
  }
];

/* ---------------- 编排器定义（只定义，不执行） ---------------- */
BOOT = createBoot({
  emit,
  /* 阶段之间的喘息时间。低配 / 机械盘机器可调大（如 NasDeck_BOOT_GAP_MS=1500），
     让每一级启动之间留出更长的系统空闲窗口；默认 320ms 已经能明显削峰。 */
  gapMs: Number(process.env.NasDeck_BOOT_GAP_MS || 320)
});
BOOT.define([
  { id: 'frontend', name: '前端面板支持', group: '基础', core: true, critical: true, weight: 1.2, timeoutMs: 10000,
    desc: 'HTTP / 静态页 / 鉴权 / 基础 API / SSE —— 让 Web 面板先可见', run: stageFrontend },
  { id: 'environment', name: '运行环境检查', group: '环境', core: true, critical: true, weight: 1.2, timeoutMs: 20000,
    desc: 'Node / 权限 / 数据目录 / 磁盘 / 引擎模块 / 安全配置（只读）', run: stageEnvironment },
  { id: 'storage', name: '文件与数据引擎', group: '数据', core: true, critical: true, weight: 1.2, timeoutMs: 20000,
    desc: 'WinNAS 引擎、ROOTS、回收站与配置只读校验', run: stageStorage },
  { id: 'metrics', name: '系统采样与监测', group: '功能', weight: 1, timeoutMs: 20000,
    desc: '2 秒指标采样、阈值告警、Windows 事件日志轮询', run: stageMetrics },
  { id: 'windows', name: 'Windows 管理数据', group: '功能', weight: 1, timeoutMs: 30000,
    desc: 'WMI / CIM 分批预热（服务 / 防火墙 / 硬件清单）', run: stageWindows },
  { id: 'recycle', name: '回收站与文件缓存', group: '功能', weight: 1, timeoutMs: 30000,
    desc: '真实 Windows 回收站后台预热，不阻塞登录', run: stageRecycle },
  { id: 'docker', name: 'WSL / Docker 引擎', group: '功能', weight: 1.5, timeoutMs: 120000,
    desc: '端点发现 → 唤醒 WSL → 启动 dockerd → 验证 /_ping → 会话保活', run: stageDocker },
  { id: 'services', name: '按需服务登记', group: '功能', weight: 0.8, timeoutMs: 20000,
    desc: '登记全盘索引 / 硬件深采 / 媒体扫描等按需功能，开机不跑重活', run: stageServices },
  { id: 'ready', name: '系统就绪', group: '完成', critical: true, weight: 0.6, timeoutMs: 15000,
    desc: '汇总启动结果并写入系统日志与通知', run: stageReady }
]);
BOOT.addOnDemand(ON_DEMAND);
BOOT.bus.on('core', () => addLog('INFO', '核心能力就绪：前端 / 环境 / 数据，用户现在即可进入系统。', 'boot'));

/* 启动日志（纯内存，不占系统资源，保留给一登录就能看到的历史记录） */
addLog('INFO', 'NasDeck Windows 原生后端启动 · ' + os.hostname() + ' · ' + sysinfo.info().osType, 'system');
addLog('INFO', 'Node ' + process.version + ' · CPU ' + (os.cpus()[0] || {}).model + ' · ' + os.cpus().length + ' 核心', 'system');
addLog('INFO', '管理员权限：' + (windows.isAdmin() ? '是（全部管理功能可用）' : '否（服务/防火墙/VSS 等写操作需以管理员运行 start-nasdeck.bat）'), 'system');
addLog('INFO', '分级启动编排器已装载 ' + BOOT.status().stages.length + ' 个阶段 · Docker 自动启动 ' + (DOCKER_AUTOSTART ? '开启' : '关闭'), 'boot');
if (!NOTIS.length) {
  addNoti('已接入真实 Windows', '硬件、服务、防火墙、事件日志、共享与 WMI 监测均为本机真实数据。', 'ok');
  addNoti('分级启动已开启', '前端面板先就绪，其余功能按顺序逐级上线，可在「系统启动中心」查看实时进度。', 'info');
}

/* ================================================================
 * v16 路由：断点续传（上传 / 下载元信息）+ WebDAV / SMB 网络共享
 * 全部默认需要登录；WebDAV 协议本身由独立端口的 dav 服务对外提供。
 * ================================================================ */
app.get('/api/files/meta', c => {
  try {
    const p = nasResolve(c.query.path, c.query.name);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Error('文件不存在');
    const st = fs.statSync(p);
    const etag = '"' + require('crypto').createHash('md5')
      .update(p + ':' + st.size + ':' + st.mtimeMs).digest('hex') + '"';
    c.json(200, {
      ok: true, name: path.basename(p), size: st.size, mtime: st.mtimeMs,
      etag, modified: new Date(st.mtimeMs).toISOString(), ranges: true
    });
  } catch (e) { bad(c, e.message); }
});

app.post('/api/transfer/upload/init', c => {
  try { c.json(200, { ok: true, job: transfer.init(c.body || {}) }); }
  catch (e) { bad(c, e.message); }
});
app.put('/api/transfer/upload/chunk', async c => {
  let r;
  try { r = await transfer.saveChunk(c.query.id || c.query.uploadId || '', c.query.index, c.req); }
  catch (e) { try { c.req.resume(); } catch (x) {} c.json(400, { ok: false, error: e.message }); return; }
  c.json(200, Object.assign({ ok: true }, r));
}, { raw: true });
app.get('/api/transfer/upload/status', c => {
  try { c.json(200, { ok: true, job: transfer.status(c.query.id || c.query.uploadId || '') }); }
  catch (e) { bad(c, e.message); }
});
app.get('/api/transfer/uploads', c => {
  c.json(200, { ok: true, jobs: transfer.list(c.query.path || '') });
});
app.post('/api/transfer/upload/complete', async c => {
  try { c.json(200, await transfer.complete((c.body || {}).id || (c.body || {}).uploadId || '')); }
  catch (e) { bad(c, e.message); }
});
app.post('/api/transfer/upload/abort', c => {
  try { c.json(200, transfer.abort((c.body || {}).id || (c.body || {}).uploadId || '')); }
  catch (e) { bad(c, e.message); }
});

app.get('/api/netshare/status', async c => {
  try {
    c.json(200, {
      ok: true, webdav: dav.status(), smb: await netshare.smbStatus(c.query.force === '1'),
      mounts: netshare.mounts(), config: { webdav: netshare.webdavConfig() },
      protocol: proto.stats()
    });
  } catch (e) { bad(c, e.message); }
});
app.post('/api/netshare/webdav/config', async c => {
  try {
    const cfg = netshare.setWebdavConfig(c.body || {});
    const st = await dav.start(cfg);
    addLog('INFO', 'WebDAV 配置已更新（enabled=' + !!cfg.enabled + ', port=' + cfg.port + '）', 'netshare');
    c.json(200, { ok: true, config: cfg, status: st });
  } catch (e) { bad(c, e.message); }
});
app.get('/api/netshare/smb/status', async c => {
  try { c.json(200, Object.assign({ ok: true }, await netshare.smbStatus(c.query.force === '1'))); }
  catch (e) { bad(c, e.message); }
});
app.post('/api/netshare/smb/share', async c => {
  try {
    const r = await netshare.smbShare(c.body || {});
    const s = await netshare.smbStatus(true);
    c.json(200, { ok: !!r.ok, out: r.out || '', error: r.error || '', shares: s.shares, admin: s.admin });
  } catch (e) { bad(c, e.message); }
});
app.post('/api/netshare/smb/connect', async c => {
  try { c.json(200, Object.assign({ ok: true }, await netshare.smbConnect(c.body || {}))); }
  catch (e) { bad(c, e.message); }
});
app.get('/api/netshare/mounts', c => c.json(200, { ok: true, mounts: netshare.mounts() }));
app.post('/api/netshare/mounts', c => {
  try { c.json(200, { ok: true, mounts: netshare.addMount(c.body || {}) }); }
  catch (e) { bad(c, e.message); }
});
app.post('/api/netshare/mounts/delete', c => {
  try { c.json(200, { ok: true, mounts: netshare.delMount((c.body || {}).id || '') }); }
  catch (e) { bad(c, e.message); }
});
app.post('/api/netshare/mounts/password', c => {
  try { c.json(200, { ok: true, mounts: netshare.setPassword((c.body || {}).id || '', (c.body || {}).password || '') }); }
  catch (e) { bad(c, e.message); }
});
app.get('/api/netshare/browse', async c => {
  try { c.json(200, await netshare.browse(c.query.id || '', c.query.path || '')); }
  catch (e) { bad(c, e.message); }
});
app.post('/api/netshare/action', async c => {
  const b = c.body || {};
  try { c.json(200, await netshare.action(b.id || '', b.act || '', b)); }
  catch (e) { bad(c, e.message); }
});
/* 远程文件读写：走原始流，支持 Range 透传 / 流式 PUT，且不落本地临时文件 */
app.get('/api/netshare/file', c => {
  try { netshare.getFile(c.query.id || '', c.query.path || '', c.req, c.res, c.query.taskId || ''); }
  catch (e) { if (!c.res.headersSent) c.json(400, { ok: false, error: e.message }); }
}, { raw: true });
app.put('/api/netshare/file', c => {
  try { netshare.putFile(c.query.id || '', c.query.path || '', c.req, c.res, c.query.taskId || ''); }
  catch (e) { if (!c.res.headersSent) c.json(400, { ok: false, error: e.message }); }
}, { raw: true });

/* 协议通信传输任务：与「文件管理器」任务完全独立的一组接口。
   tasks 只返回 channel=protocol 的记录；file-transfer 相关接口见 /api/transfer/*。 */
app.get('/api/netshare/tasks', c => {
  c.json(200, {
    ok: true, channel: 'protocol',
    tasks: proto.list({ limit: Number(c.query.limit) || 100,
      proto: c.query.proto || '', via: c.query.via || '', state: c.query.state || '' }),
    stats: proto.stats()
  });
});
app.post('/api/netshare/tasks/cancel', c => {
  c.json(200, { ok: true, canceled: proto.cancel((c.body || {}).id || '') });
});
app.post('/api/netshare/tasks/remove', c => {
  c.json(200, { ok: true, removed: proto.remove((c.body || {}).id || '') });
});
app.post('/api/netshare/tasks/clear', c => {
  c.json(200, { ok: true, removed: proto.clear((c.body || {}).scope || 'done') });
});

/* ---- 关键：先 listen，让前端立刻能访问 /api/boot/status ---- */
HTTP_SERVER = app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  NasDeck 2.5 Web Desktop  ·  Windows 原生后端已启动（分级启动 v2.3.0）');
  console.log('  ------------------------------------------------------------');
  console.log('  地址     http://' + HOST + ':' + PORT + '/');
  console.log('  账号     ' + (process.env.NasDeck_USER || 'admin') + ' / ' + (process.env.NasDeck_PASSWORD || 'admin'));
  console.log('  管理员   ' + (windows.isAdmin() ? '是' : '否（部分管理功能受限，建议用 start-nasdeck.bat 提权）'));
  console.log('  数据目录 ' + DATA);
  console.log('  启动进度 ' + 'http://' + HOST + ':' + PORT + '/api/boot/status (' + BOOT.status().stages.length + ' 个阶段)');
  console.log('  WSL 引擎 ' + wsl.endpoint.host + ':' + wsl.endpoint.port + ' (' + wsl.endpoint.source + ') · 自动启动 ' + (DOCKER_AUTOSTART ? 'ON' : 'OFF'));
  console.log('  实时通道 SSE /api/events · 零第三方依赖');
  console.log('');
  /* v16：按持久化配置恢复 WebDAV 服务。默认关闭；开启后会在独立端口监听，
     配置变更通过 /api/netshare/webdav/config 即时 stop/start，无需重启主服务。 */
  try {
    const _davCfg = netshare.webdavConfig();
    if (_davCfg.enabled) {
      dav.start(_davCfg).then(st => {
        addLog(st.running ? 'INFO' : 'WARN',
          'WebDAV 自启动 ' + (st.running ? '成功 ' + st.localUrl : '失败 ' + (st.error || '')), 'netshare');
      });
    }
  } catch (e) { addLog('WARN', 'WebDAV 自启动异常: ' + e.message, 'netshare'); }
  /* HTTP 一可用就做一次只读 Engine 快照（纯 TCP/HTTP，毫秒级，不启动
     wsl.exe、不写任何数据）：真实容器/镜像在 coreReady 时即可见，
     不必等第⑦阶段唤醒 WSL。重型的发行版枚举仍由分级编排器延后。 */
  startWslPoller();
  /* HTTP 已可用，编排器从这一刻才开始逐级启动内部功能 */
  BOOT.start().catch(e => console.error('[BOOT]', e && e.stack || e));
});

process.on('uncaughtException', e => console.error('[UNCAUGHT]', e.stack || e.message));
process.on('unhandledRejection', e => console.error('[UNHANDLED]', e && e.stack || e));

/* ============================================================
 * 桌面壳接口 —— 只被 electron/main.js 在 require 本文件后使用
 * ------------------------------------------------------------
 * 与 WinNAS 桌面端同一套原则：改设置一律「热生效」，进程不退出、
 * 两个窗口都不关。端口/绑定地址切换失败自动回退，绝不因为一次误配置
 * 把服务打死（数据安全与稳定优先）。node server.js 直跑完全不受影响。
 * ============================================================ */
function listening() { return !!(HTTP_SERVER && HTTP_SERVER.listening); }

function closeListener() {
  return new Promise(resolve => {
    if (!HTTP_SERVER || !HTTP_SERVER.listening) return resolve();
    const srv = HTTP_SERVER;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    /* SSE 是长连接，先主动断开，否则 close() 会一直等客户端超时 */
    try { if (srv.closeAllConnections) srv.closeAllConnections(); } catch (e) {}
    try { srv.close(finish); } catch (e) { finish(); }
    setTimeout(finish, 1500);
  });
}

function bindListener(port, host) {
  return new Promise((resolve, reject) => {
    const srv = HTTP_SERVER;
    if (!srv) return reject(new Error('HTTP Server 未创建'));
    const onErr = e => { srv.removeListener('listening', onOk); reject(e); };
    const onOk = () => { srv.removeListener('error', onErr); resolve(); };
    srv.once('error', onErr);
    srv.once('listening', onOk);
    try { srv.listen(port, host); } catch (e) { onErr(e); }
  });
}

/* 用独立的临时 socket 预检目标地址能否绑定：只有确认可用才去关闭旧监听。
   这样「端口被占用」这种最常见的误配置不会让在线服务出现哪怕一瞬间的中断，
   也不会让唯一挂着全部路由的 http.Server 进入 listen 失败后的异常状态。 */
function probeBind(port, host) {
  return new Promise(resolve => {
    const probe = net.createServer();
    const done = v => { try { probe.removeAllListeners(); } catch (e) {} resolve(v); };
    probe.once('error', e => done({ ok: false, code: e.code || e.message }));
    probe.once('listening', () => probe.close(() => done({ ok: true })));
    try { probe.listen(port, host); } catch (e) { done({ ok: false, code: e.code || e.message }); }
  });
}

function status() {
  const b = BOOT ? BOOT.status() : null;
  let users = [];
  try { users = auth.listUsers().map(u => u.username); } catch (e) {}
  return {
    ok: true, name: 'NasDeck WinNAS', version: '2.4.0',
    port: PORT, host: HOST, dataDir: DATA, root: ROOT,
    address: 'http://' + (HOST === '0.0.0.0' ? '127.0.0.1' : HOST) + ':' + PORT + '/',
    listening: listening(),
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    pid: process.pid, node: process.version, platform: process.platform,
    admin: (() => { try { return windows.isAdmin(); } catch (e) { return false; } })(),
    routes: app.routes.length, sseClients: app.sseClients,
    users, sessionCount: auth.sessionCount,
    wsl: {
      endpoint: { host: wsl.endpoint.host, port: wsl.endpoint.port, source: wsl.endpoint.source, distro: wsl.endpoint.distro },
      autostart: DOCKER_AUTOSTART,
      available: !!wslCache.available,
      message: wslCache.message || '',
      containers: (wslCache.containers || []).length,
      images: (wslCache.images || []).length
    },
    winnas: {
      available: winnas.available, home: winnas.state.home,
      version: winnas.state.version, modules: winnas.state.modules.length,
      reason: winnas.state.reason
    },
    boot: b ? {
      phase: b.phase, overall: b.overall, coreReady: b.coreReady,
      finished: b.finished, running: b.running, elapsed: b.elapsed,
      counts: b.counts,
      stages: b.stages.map(s => ({ id: s.id, name: s.name, status: s.status, progress: s.progress, message: s.message, ms: s.ms })),
      log: b.log.slice(-24)
    } : null
  };
}

async function reconfigure(o) {
  o = o || {};
  const out = { ok: true, applied: [], errors: [], portChanged: false, hostChanged: false, needsRestart: false };

  /* 1) 管理员账户 / 密码：原地更新 users.json（原子写），改成功后既有会话失效 */
  if (o.username !== undefined || o.password !== undefined) {
    try {
      const r = auth.reconfigureAdmin({ username: o.username, password: o.password });
      if (r.username) process.env.NasDeck_USER = r.username;      // 仅内存，不落明文
      if (o.password) process.env.NasDeck_PASSWORD = String(o.password);
      out.applied.push(r.changed ? 'account' : 'account-unchanged');
      out.sessionsCleared = r.sessionsCleared;
      if (r.sessionsCleared) addLog('INFO', '管理员账户已由桌面设置窗口更新，既有会话已失效', 'system');
    } catch (e) { out.errors.push('账户：' + e.message); }
  }

  /* 2) WSL / Docker 自动启动：只控制保活与看门狗，绝不主动停用户容器 */
  if (o.wslAutostart !== undefined) {
    const on = !!o.wslAutostart;
    DOCKER_AUTOSTART = on;
    process.env.NasDeck_WSL_AUTOSTART = on ? '1' : '0';
    try {
      if (on) wsl.keepAliveStart();   // 内部自带看门狗 + 2.5s 后 ensureEngine
      else wsl.keepAliveStop();       // 只停保活会话，不动 dockerd / 容器
      out.applied.push('docker');
      addLog('INFO', 'WSL/Docker 自动启动已' + (on ? '开启' : '关闭') + '（桌面设置窗口）', 'wsl');
    } catch (e) { out.errors.push('Docker：' + e.message); }
  }

  /* 3) 端口 / 绑定地址：热切监听；被占用则回退原地址并如实报错 */
  let np = o.port !== undefined ? Number(o.port) : PORT;
  let nh = o.host !== undefined ? String(o.host) : HOST;
  if (!Number.isFinite(np) || np < 1 || np > 65535) np = PORT;
  if (nh !== '127.0.0.1' && nh !== '0.0.0.0') nh = HOST;
  if (np !== PORT || nh !== HOST) {
    const oldP = PORT, oldH = HOST;
    const probe = await probeBind(np, nh);
    if (!probe.ok) {
      out.errors.push('新地址 ' + nh + ':' + np + ' 不可用（' + probe.code + '），已保持原地址 ' + oldH + ':' + oldP + ' 不变');
    } else {
      await closeListener();
      try {
        await bindListener(np, nh);
        PORT = np; HOST = nh;
        process.env.PORT = String(PORT);
        process.env.HOST = HOST;
        out.portChanged = np !== oldP;
        out.hostChanged = nh !== oldH;
        out.applied.push('listen');
        addLog('INFO', '监听地址已热切换为 ' + HOST + ':' + PORT + '（进程未重启）', 'system');
      } catch (e) {
        /* 极端竞态（预检后端口被别的进程抢走）：重试回退，确保服务始终在线 */
        let backOk = false;
        for (let i = 0; i < 3 && !backOk; i++) {
          try { await bindListener(oldP, oldH); backOk = true; }
          catch (e2) { await new Promise(r => setTimeout(r, 150)); }
        }
        out.errors.push('新地址 ' + nh + ':' + np + ' 绑定失败（' + (e.code || e.message) + '），' +
          (backOk ? '已回退 ' + oldH + ':' + oldP : '回退监听失败，请重启应用'));
        out.portChanged = false; out.hostChanged = false;
      }
    }
  }

  /* 4) 这类值只影响下次启动，明确告知上层，不伪装成"已生效" */
  if (o.bootGapMs !== undefined) {
    process.env.NasDeck_BOOT_GAP_MS = String(Math.max(0, Math.min(5000, Number(o.bootGapMs) || 0)));
    out.needsRestart = true;
  }
  out.ok = out.errors.length === 0;
  out.status = status();
  return out;
}

function shutdown() {
  try { if (metricsTimer) clearInterval(metricsTimer); } catch (e) {}
  try { if (wslPoller) clearInterval(wslPoller); } catch (e) {}
  try { if (wslExtraPoller) clearInterval(wslExtraPoller); } catch (e) {}
  try { if (BOOT && typeof BOOT.stop === 'function') BOOT.stop(); } catch (e) {}
  try { wsl.keepAliveStop(); } catch (e) {}
  try {
    if (HTTP_SERVER) {
      if (HTTP_SERVER.closeAllConnections) HTTP_SERVER.closeAllConnections();
      HTTP_SERVER.close();
    }
  } catch (e) {}
  try { logStore.saveNow(); notiStore.saveNow(); settings.saveNow(); } catch (e) {}
  return { ok: true, stopped: true };
}

module.exports = {
  reconfigure, status, shutdown,
  get port() { return PORT; },
  get host() { return HOST; },
  get dataDir() { return DATA; },
  get boot() { return BOOT; }
};
