'use strict';
// ============================================================================
// NasDeck WinNAS 桌面版入口（Electron 主进程）
// ----------------------------------------------------------------------------
// 两套完全独立的窗口：
//   ① 前端页面窗口  「NasDeck WinNAS · 桌面」    → http://127.0.0.1:<port>/
//      展示 NasDeck 2.5 Web 桌面、分级启动进度屏与全部 NAS 功能。
//   ② 后端设置窗口  「NasDeck WinNAS · 后端设置」→ file://electron/settings.html
//      端口 / 绑定地址 / 管理员账号密码 / WinNAS 引擎 / 数据目录 /
//      WSL-Docker / 启动阶段进度 / 后端控制台日志 / 窗口行为。
//
// 后端 server.js 直接在主进程内 require（不 fork 子进程、不开黑色控制台）。
// 所有设置一律「运行时热生效」：进程不退出、两个窗口都不关；
// 端口/地址切换失败会自动回退，绝不因为一次误配置把服务打死。
// 数据安全：密码不写进 settings.json；改密只更新 users.json（原子写）；
// 数据目录/引擎路径这类结构性变更明确标注「需重启应用」，不偷偷迁移数据。
// 服务常驻：关窗口默认最小化到托盘，后端继续运行；托盘/菜单可随时打开任一窗口。
// ============================================================================
const { app, BrowserWindow, Menu, ipcMain, dialog, Tray, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

const isDev = !app.isPackaged;
const APP_DIR = app.getAppPath();
const ELECTRON_DIR = __dirname;

// ---- 可写基目录：打包态固定 userData（便携版 exe 解压目录不持久） ----
function resolveBaseDir() {
  if (isDev) return APP_DIR;
  return app.getPath('userData');
}
const BASE = resolveBaseDir();
const SETTINGS_PATH = path.join(BASE, 'settings.json');
const DESKTOP_LOG_LIMIT = 400;

// 旧版本把 settings.json 放在 exe 同目录：一次性迁移，避免升级后被误判首跑
(function migrateOldSettings() {
  try {
    const oldPath = path.join(path.dirname(process.execPath), 'settings.json');
    if (fs.existsSync(oldPath) && !fs.existsSync(SETTINGS_PATH)) {
      fs.mkdirSync(BASE, { recursive: true });
      fs.copyFileSync(oldPath, SETTINGS_PATH);
      console.log('[NasDeck] 已迁移旧设置: ' + oldPath + ' -> ' + SETTINGS_PATH);
    }
  } catch (e) { /* 迁移失败不影响启动 */ }
})();

const DEFAULTS = {
  port: 5080,
  host: '127.0.0.1',
  username: 'admin',
  dataDir: path.join(BASE, 'data'),
  winnasHome: '',                 // 空 = 自动探测 C:\AI使用\项目\NasManager / 其它盘 / vendor
  wslAutostart: true,
  bootGapMs: 320,
  autoOpenSettings: true,        // 启动时两套窗口一起出现
  minimizeToTray: true,
  startWithWindows: false
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      return Object.assign({}, DEFAULTS, raw || {});
    }
  } catch (e) { console.error('[NasDeck] 读取设置失败，使用默认值:', e.message); }
  return Object.assign({}, DEFAULTS);
}
let settings = loadSettings();

function persistSettings() {
  try {
    fs.mkdirSync(BASE, { recursive: true });
    const tmp = SETTINGS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, SETTINGS_PATH);
    return true;
  } catch (e) {
    console.error('[NasDeck] 保存设置失败:', e.message);
    return false;
  }
}

// ---- WinNAS 引擎位置：自动探测，不写回配置文件 ----
function resolveWinnasHome() {
  const cands = [];
  if (settings.winnasHome) cands.push(settings.winnasHome);
  if (process.env.WINNAS_HOME) cands.push(process.env.WINNAS_HOME);
  cands.push('C:\\AI使用\\项目\\NasManager');
  for (let i = 67; i <= 90; i++) cands.push(String.fromCharCode(i) + ':\\NasManager');
  cands.push(path.join(APP_DIR, 'vendor', 'winnas'));
  for (const c of cands) {
    try {
      if (c && (fs.existsSync(path.join(c, 'config.js')) || fs.existsSync(path.join(c, 'src', 'config.js')))) {
        return { home: path.resolve(c), source: c === settings.winnasHome ? 'settings' : 'auto' };
      }
    } catch (e) { /* 继续下一个候选 */ }
  }
  return { home: '', source: 'not-found' };
}

// ---- 端口占用检测：被占用只在本此运行临时顺延，不改用户配置 ----
function portFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}
async function pickFreePort(preferred) {
  let p = Number(preferred) || 5080;
  for (let i = 0; i < 20; i++) {
    if (await portFree(p)) return { port: p, shifted: i > 0, preferred: Number(preferred) || 5080 };
    p++;
  }
  return { port: Number(preferred) || 5080, shifted: false, preferred: Number(preferred) || 5080 };
}

// ---- 后端控制台日志收集（供设置窗口查看，无需登录、无 CORS） ----
const consoleLines = [];
function pushLine(level, args) {
  const text = args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }).join(' ');
  consoleLines.push({ t: Date.now(), level, text: String(text).slice(0, 1000) });
  if (consoleLines.length > DESKTOP_LOG_LIMIT) consoleLines.splice(0, consoleLines.length - DESKTOP_LOG_LIMIT);
}
(function hookConsole() {
  for (const lv of ['log', 'info', 'warn', 'error']) {
    const orig = console[lv].bind(console);
    console[lv] = (...args) => { pushLine(lv === 'warn' || lv === 'error' ? lv : 'log', args); orig(...args); };
  }
})();

// ---- 启动后端：主进程内 require server.js ----
let backend = null;
let backendError = '';
let runtime = { port: settings.port, shifted: false, preferred: settings.port, winnas: null, firstRun: false };

function startBackend(portInfo, winnasInfo) {
  process.env.NasDeck_DATA_DIR = settings.dataDir || path.join(BASE, 'data');
  process.env.PORT = String(portInfo.port);
  process.env.HOST = settings.host || '127.0.0.1';
  process.env.NasDeck_USER = settings.username || 'admin';
  // 密码绝不写 settings.json：首次播种用默认口令，用户可在设置窗口立即改密
  process.env.NasDeck_WSL_AUTOSTART = settings.wslAutostart === false ? '0' : '1';
  process.env.NasDeck_BOOT_GAP_MS = String(settings.bootGapMs || 320);
  process.env.NasDeck_DESKTOP = '1';
  if (winnasInfo.home) process.env.WINNAS_HOME = winnasInfo.home;
  try {
    fs.mkdirSync(process.env.NasDeck_DATA_DIR, { recursive: true });
    backend = require(path.join(APP_DIR, 'server.js'));
    runtime.port = backend.port;
    console.log('[NasDeck] 后端已在桌面主进程内启动 · ' + backend.host + ':' + backend.port +
      ' · 数据目录 ' + backend.dataDir);
  } catch (e) {
    backendError = (e && e.stack) || String(e);
    console.error('[NasDeck] 后端启动失败:', backendError);
    dialog.showErrorBox('NasDeck WinNAS 启动失败',
      '后端未能启动：\n' + String((e && e.message) || e) + '\n\n可在「后端设置」窗口查看日志。');
  }
  return backend;
}

function backendStatus() {
  try { return backend ? backend.status() : null; }
  catch (e) { return { ok: false, error: e.message }; }
}

// 主进程代理 HTTP 请求：设置窗口是 file://，直接 fetch 会被 CORS 拦
function apiGet(apiPath, port, timeoutMs) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: port || runtime.port, path: apiPath, timeout: timeoutMs || 2000 }, r => {
      let b = '';
      r.on('data', d => { b += d; if (b.length > 200000) r.destroy(); });
      r.on('end', () => { try { resolve({ ok: true, status: r.statusCode, json: JSON.parse(b) }); } catch (e) { resolve({ ok: false, status: r.statusCode, error: b.slice(0, 200) }); } });
    });
    req.on('error', e => resolve({ ok: false, status: 0, error: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
  });
}

async function waitServerThenLoad(win) {
  for (let i = 0; i < 80; i++) {
    const r = await apiGet('/api/health', runtime.port, 1200);
    if (r.ok && r.json && r.json.ok) {
      if (win && !win.isDestroyed()) win.loadURL('http://127.0.0.1:' + runtime.port + '/');
      return true;
    }
    await new Promise(res => setTimeout(res, 400));
  }
  if (win && !win.isDestroyed()) {
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<meta charset="utf-8"><div style="font:14px/1.7 Segoe UI,Microsoft YaHei,sans-serif;padding:36px;color:#dce8f2;background:#12212e;height:100vh">' +
      '<h2>后端服务未就绪</h2><p>请打开「后端设置」窗口查看日志与端口配置。</p>' +
      '<p style="color:#8fa8ba">常见原因：端口被占用、数据目录不可写、或后端启动异常。</p></div>'));
  }
  return false;
}

// ---- 两套窗口 ----
let mainWindow = null;      // ① 前端页面窗口
let settingsWindow = null;  // ② 后端设置窗口
let tray = null;
let reallyQuit = false;
let statusTimer = null;

function placeWindows() {
  let area = { x: 0, y: 0, width: 1440, height: 900 };
  try { area = screen.getPrimaryDisplay().workArea; } catch (e) {}
  const mainW = Math.min(1180, Math.max(900, area.width - 470));
  const mainH = Math.min(820, area.height - 60);
  return {
    main: { x: area.x + 8, y: area.y + 8, width: mainW, height: mainH },
    set: { x: Math.min(area.x + area.width - 440, area.x + mainW + 20), y: area.y + 24, width: 420, height: Math.min(720, area.height - 60) }
  };
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
  } else createMainWindow();
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { showMainWindow(); return mainWindow; }
  const pos = placeWindows().main;
  mainWindow = new BrowserWindow({
    x: pos.x, y: pos.y, width: pos.width, height: pos.height,
    minWidth: 880, minHeight: 560, show: false,
    title: 'NasDeck WinNAS · 桌面',
    icon: path.join(ELECTRON_DIR, 'tray-icon.png'),
    backgroundColor: '#0d1b26',
    webPreferences: {
      preload: path.join(ELECTRON_DIR, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  mainWindow.once('ready-to-show', () => { mainWindow.show(); });
  mainWindow.on('close', e => {
    if (reallyQuit) return;
    if (!settings.minimizeToTray) { quitApp(); return; }
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question', buttons: ['最小化到托盘', '退出程序'], defaultId: 0, cancelId: 0,
      title: '关闭 NasDeck WinNAS',
      message: '关闭前端窗口后后端服务是否继续运行？',
      detail: '选择「最小化到托盘」：NAS 服务、文件共享与 Docker 继续在后台运行，' +
        '可从托盘图标随时重新打开前端窗口或后端设置窗口。'
    });
    if (choice === 0) {
      createTray();
      mainWindow.hide();
      try { tray && tray.displayBalloon && tray.displayBalloon({
        title: 'NasDeck WinNAS 仍在运行',
        content: '后端服务保持在线。右键托盘图标可打开桌面或设置窗口。'
      }); } catch (err) {}
    } else quitApp();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  // 主窗口内 Ctrl+, 直接呼出后端设置窗口
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && input.key === ',') { e.preventDefault(); openSettings(); }
  });
  waitServerThenLoad(mainWindow);
  console.log('[NasDeck] ① 前端页面窗口已创建 · ' + mainWindow.title);
  return mainWindow;
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return settingsWindow; }
  const pos = placeWindows().set;
  settingsWindow = new BrowserWindow({
    x: pos.x, y: pos.y, width: pos.width, height: pos.height,
    minWidth: 380, minHeight: 520, show: false,
    title: 'NasDeck WinNAS · 后端设置',
    icon: path.join(ELECTRON_DIR, 'tray-icon.png'),
    backgroundColor: '#f4f6f9',
    // 独立窗口、非模态：两个窗口可以同时显示、分别操作
    webPreferences: {
      preload: path.join(ELECTRON_DIR, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  settingsWindow.loadFile(path.join(ELECTRON_DIR, 'settings.html'));
  settingsWindow.once('ready-to-show', () => { settingsWindow.show(); });
  settingsWindow.on('closed', () => { settingsWindow = null; console.log('[NasDeck] ② 后端设置窗口已关闭'); });
  console.log('[NasDeck] ② 后端设置窗口已创建 · ' + settingsWindow.title);
  return settingsWindow;
}

// ---- 托盘 ----
function quitApp() {
  reallyQuit = true;
  if (tray) { try { tray.destroy(); } catch (e) {} tray = null; }
  app.quit();
}

function createTray() {
  if (tray) return tray;
  try { tray = new Tray(path.join(ELECTRON_DIR, 'tray-icon.png')); }
  catch (e) { console.error('[NasDeck] 托盘图标创建失败:', e.message); return null; }
  tray.setToolTip('NasDeck WinNAS · Windows 原生 NAS');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开前端页面窗口', click: () => showMainWindow() },
    { label: '打开后端设置窗口', click: () => openSettings() },
    { type: 'separator' },
    { label: '重启后端服务', click: () => restartApp() },
    { type: 'separator' },
    { label: '退出（停止服务）', click: () => quitApp() }
  ]));
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  return tray;
}

function restartApp() {
  reallyQuit = true;
  if (tray) { try { tray.destroy(); } catch (e) {} tray = null; }
  try { if (backend && typeof backend.shutdown === 'function') backend.shutdown(); } catch (e) {}
  try { app.relaunch(); } catch (e) { console.error('[NasDeck] relaunch 失败:', e.message); }
  app.exit(0);
}

// ---- IPC：设置窗口专用 ----
function meta() {
  return {
    baseDir: BASE, settingsPath: SETTINGS_PATH, appDir: APP_DIR,
    packaged: !isDev, firstRun: runtime.firstRun,
    electron: process.versions.electron || 'N/A', node: process.version,
    winnas: runtime.winnas, portShifted: runtime.shifted,
    portPreferred: runtime.preferred, backendError
  };
}

ipcMain.handle('nasdeck:get-settings', () => ({
  ok: true, settings: Object.assign({}, settings), status: backendStatus(), meta: meta()
}));

ipcMain.handle('nasdeck:get-status', async () => {
  const health = await apiGet('/api/health', runtime.port, 1500);
  const boot = await apiGet('/api/boot/status', runtime.port, 1500);
  return {
    ok: true, status: backendStatus(), health: health.ok ? health.json : null,
    boot: boot.ok ? boot.json : null, meta: meta()
  };
});

ipcMain.handle('nasdeck:get-logs', () => ({ ok: true, lines: consoleLines.slice(-220) }));

ipcMain.handle('nasdeck:api', async (e, p) => {
  if (typeof p !== 'string' || !p.startsWith('/api/')) return { ok: false, error: '仅允许 /api/ 路径' };
  return apiGet(p, runtime.port, 3000);
});

ipcMain.handle('nasdeck:save-settings', async (e, data) => {
  data = data || {};
  const prev = Object.assign({}, settings);
  const next = Object.assign({}, settings);
  if (data.port !== undefined) next.port = Math.max(1, Math.min(65535, Number(data.port) || 5080));
  if (data.host === '0.0.0.0' || data.host === '127.0.0.1') next.host = data.host;
  if (data.username !== undefined) next.username = String(data.username).trim() || 'admin';
  if (data.dataDir !== undefined) next.dataDir = String(data.dataDir).trim() || DEFAULTS.dataDir;
  if (data.winnasHome !== undefined) next.winnasHome = String(data.winnasHome).trim();
  if (data.wslAutostart !== undefined) next.wslAutostart = !!data.wslAutostart;
  if (data.bootGapMs !== undefined) next.bootGapMs = Math.max(0, Math.min(5000, Number(data.bootGapMs) || 0));
  if (data.autoOpenSettings !== undefined) next.autoOpenSettings = !!data.autoOpenSettings;
  if (data.minimizeToTray !== undefined) next.minimizeToTray = !!data.minimizeToTray;
  if (data.startWithWindows !== undefined) next.startWithWindows = !!data.startWithWindows;

  const structural = (prev.dataDir !== next.dataDir) || (prev.winnasHome !== next.winnasHome);
  settings = next;
  const saved = persistSettings();

  // 开机自启（独立于后端，立即生效）
  try {
    app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, path: process.execPath });
  } catch (err) { console.warn('[NasDeck] 设置开机自启失败:', err.message); }

  // 运行时热应用：端口 / 绑定地址 / 账号密码 / Docker 保活 / 启动间隔
  let applied = { ok: false, reason: '后端未启动' };
  if (backend && typeof backend.reconfigure === 'function') {
    // 端口被占用时本次运行会临时顺延；若用户没改端口，就不要把「配置值」
    // 当成一次新的切换请求，否则每次保存都会报一次无谓的 EADDRINUSE。
    const portUnchanged = prev.port === next.port;
    const skipPort = portUnchanged && backend.port !== next.port;
    applied = await backend.reconfigure({
      port: skipPort ? backend.port : settings.port,
      host: settings.host,
      username: settings.username,
      password: data.password || '',
      wslAutostart: settings.wslAutostart,
      bootGapMs: settings.bootGapMs
    });
    runtime.port = backend.port;
    // 端口热切成功：仅刷新页面，两个窗口都不关
    if (applied.portChanged && mainWindow && !mainWindow.isDestroyed()) waitServerThenLoad(mainWindow);
  }
  return {
    ok: !!saved && (applied.ok !== false), saved, applied,
    needsRestart: structural || !!applied.needsRestart,
    restartReason: structural
      ? (prev.dataDir !== next.dataDir ? '数据目录已变更' : 'WinNAS 引擎路径已变更')
      : '部分启动参数将于下次启动生效',
    sessionsCleared: !!applied.sessionsCleared,
    status: backendStatus(), meta: meta()
  };
});

ipcMain.handle('nasdeck:pick-dir', async () => {
  const r = await dialog.showOpenDialog({ title: '选择目录', properties: ['openDirectory', 'createDirectory'] });
  return { ok: !r.canceled, path: (r.filePaths || [])[0] || '' };
});
ipcMain.handle('nasdeck:open-main', () => { showMainWindow(); return { ok: true }; });
ipcMain.handle('nasdeck:reload-main', () => {
  if (mainWindow && !mainWindow.isDestroyed()) waitServerThenLoad(mainWindow);
  return { ok: true };
});
ipcMain.handle('nasdeck:open-data-dir', () => {
  try { shell.openPath(settings.dataDir || DEFAULTS.dataDir); } catch (e) {}
  return { ok: true };
});
ipcMain.handle('nasdeck:open-external', (e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) { try { shell.openExternal(url); } catch (err) {} }
  return { ok: true };
});
ipcMain.handle('nasdeck:restart-app', () => { setTimeout(restartApp, 120); return { ok: true }; });

// 每 2 秒把真实后端状态推给设置窗口（分级启动进度、健康、WSL 状态）
function startStatusPush() {
  if (statusTimer) return;
  statusTimer = setInterval(async () => {
    if (!settingsWindow || settingsWindow.isDestroyed()) return;
    const health = await apiGet('/api/health', runtime.port, 1200);
    const boot = await apiGet('/api/boot/status', runtime.port, 1200);
    const payload = {
      ok: true, status: backendStatus(), health: health.ok ? health.json : null,
      boot: boot.ok ? boot.json : null, meta: meta(),
      logs: consoleLines.slice(-40)
    };
    try { settingsWindow.webContents.send('nasdeck:status', payload); } catch (e) {}
  }, 2000);
  if (statusTimer.unref) statusTimer.unref();
}

// ---- 菜单 ----
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'NasDeck WinNAS',
      submenu: [
        { label: '打开前端页面窗口', click: () => showMainWindow() },
        { label: '后端设置窗口', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
        { type: 'separator' },
        { label: '重新加载前端界面', click: () => { if (mainWindow && !mainWindow.isDestroyed()) waitServerThenLoad(mainWindow); } },
        { label: '重启后端服务', click: () => restartApp() },
        { type: 'separator' },
        { label: '退出（停止服务）', click: () => quitApp() }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '在浏览器中打开 Web 桌面', click: () => { try { shell.openExternal('http://127.0.0.1:' + runtime.port + '/'); } catch (e) {} } },
        { label: '打开数据目录', click: () => { try { shell.openPath(settings.dataDir || DEFAULTS.dataDir); } catch (e) {} } }
      ]
    }
  ]));
}

// ---- 单实例 ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.whenReady().then(async () => {
  runtime.firstRun = !fs.existsSync(SETTINGS_PATH);
  buildMenu();
  const portInfo = await pickFreePort(settings.port);
  const winnasInfo = resolveWinnasHome();
  runtime.shifted = portInfo.shifted;
  runtime.preferred = portInfo.preferred;
  runtime.winnas = winnasInfo;
  if (portInfo.shifted) console.warn('[NasDeck] 端口 ' + portInfo.preferred + ' 被占用，本次临时改用 ' + portInfo.port + '（不修改已保存的设置）');

  startBackend(portInfo, winnasInfo);
  createTray();
  createMainWindow();                       // ① 前端页面窗口
  if (settings.autoOpenSettings || runtime.firstRun) openSettings();  // ② 后端设置窗口
  startStatusPush();
  if (runtime.firstRun) console.log('[NasDeck] 首次运行：请在「后端设置」窗口尽快修改默认管理员密码。');

  app.on('second-instance', () => { showMainWindow(); openSettings(); });
  app.on('activate', () => { if (!mainWindow) createMainWindow(); });
}).catch(e => console.error('[NasDeck] 桌面启动流程异常:', (e && e.stack) || e));

app.on('window-all-closed', () => {
  // 托盘常驻模式：两个窗口都关掉也保持后端服务在线（NAS 不该因为关窗口就停服）
  if (settings.minimizeToTray && tray) return;
  quitApp();
});

app.on('before-quit', () => {
  reallyQuit = true;
  if (statusTimer) { try { clearInterval(statusTimer); } catch (e) {} }
  try { if (backend && typeof backend.shutdown === 'function') backend.shutdown(); } catch (e) {}
  if (tray) { try { tray.destroy(); } catch (e) {} tray = null; }
});
