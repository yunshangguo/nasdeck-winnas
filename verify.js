'use strict';
/* ============================================================
 * 端到端验证：真实 Chromium + 真实 Windows 后端
 * 注意：本脚本刻意不触发任何 wsl.exe 调用（只验证 WSL 引擎的
 * HTTP 探测与降级 UI），避免在当前会话里启动被策略限制的进程。
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:5080';
const OUT = __dirname;
const errors = [];
const logs = [];
function log(k, v) { const s = k + ' ' + (typeof v === 'string' ? v : JSON.stringify(v)); logs.push(s); console.log(s); }

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.goto(BASE + '/', { waitUntil: 'load' });
  // 必须等异步 probe 接管登录按钮，否则会回落到 demo 登录
  await page.waitForFunction(
    () => window.NasDeck && NasDeck.mode === 'live' && typeof window.__NasDeck_LOGIN__ === 'function',
    null, { timeout: 20000 });
  await page.waitForTimeout(600);
  log('PROBE', await page.evaluate(() => ({ mode: window.NasDeck && NasDeck.mode, health: !!(window.NasDeck && NasDeck.health) })));
  await page.screenshot({ path: path.join(OUT, 'login-win.png') });

  await page.fill('#lg-user', 'admin');
  await page.fill('#lg-pass', 'admin');
  await page.click('#lg-go');
  await page.waitForTimeout(3000);
  log('AFTER_LOGIN', await page.evaluate(() => ({
    deskVisible: !document.getElementById('desk').classList.contains('hidden'),
    mode: NasDeck.mode, token: !!NasDeck.token, installed: NasDeck.installed,
    sse: NasDeck.es ? NasDeck.es.readyState : -1,
    winInstalled: typeof NasDeck_WIN_INSTALL === 'function' && !!NasDeck.win,
    bootApi: NasDeck.boot && NasDeck.boot.api,
    lgErr: document.getElementById('lg-err').textContent
  })));
  log('EARLY_ERRORS', errors);

  // 等待后台 WMI 预热推送
  await page.waitForTimeout(9000);
  log('WIN_DATA', await page.evaluate(() => ({
    ready: (NasDeck.win.ready || []).length, pending: (NasDeck.win.pending || []).length,
    services: (NasDeck.win.services || []).length,
    firewallRules: ((NasDeck.win.firewall || {}).rules || []).length,
    firewallTotal: (NasDeck.win.firewall || {}).total,
    events: (NasDeck.win.events || []).length,
    adapters: (NasDeck.win.adapters || []).length,
    apps: (NasDeck.win.apps || []).length,
    processes: (NasDeck.win.processes || []).length,
    tasks: (NasDeck.win.tasks || []).length,
    shares: (NasDeck.win.shares || []).length,
    listenPorts: ((NasDeck.win.connections || {}).listen || []).length,
    physDisks: ((NasDeck.win.storage || {}).physical || []).length,
    volumes: ((NasDeck.win.storage || {}).volumes || []).length,
    admin: NasDeck.admin, wslAvailable: NasDeck.wsl.available,
    wslEndpoint: NasDeck.wsl.endpoint && (NasDeck.wsl.endpoint.host + ':' + NasDeck.wsl.endpoint.port),
    alerts: (NasDeck.mon.alerts || []).length,
    hostname: NasDeck.boot.server.hostname, osCaption: NasDeck.boot.server.osCaption,
    board: NasDeck.boot.server.board, gpu: (NasDeck.boot.server.gpus || []).length
  })));

  // 真实文件总管：C: 盘 + CRUD
  await page.evaluate(() => openApp('filestation'));
  await page.waitForTimeout(250);
  await page.evaluate(() => fsGoto('/C:/'));
  await page.waitForTimeout(550);
  log('FS_C_DRIVE', await page.evaluate(() => ({ path: FS_STATE.path, count: (FS[FS_STATE.path] || []).length })));
  await page.evaluate(() => fsGoto('/Public'));
  await page.waitForTimeout(400);
  const testName = 'nasdeck_verify_' + Date.now().toString(36);
  await page.evaluate(n => NasDeck.post('/api/files/mkdir', { path: '/Public', name: n }).then(r => NasDeck.applyFiles(r)), testName);
  await page.evaluate(n => NasDeck.post('/api/files/rename', { path: '/Public', from: n, to: n + '_r' }).then(r => NasDeck.applyFiles(r)), testName);
  await page.waitForTimeout(250);
  log('FILE_CRUD', await page.evaluate(n => ({ exists: (FS['/Public'] || []).some(x => x.n === n + '_r') }), testName));
  await page.evaluate(n => NasDeck.post('/api/files/delete', { path: '/Public', name: n + '_r' }).then(r => { NasDeck.applyFiles(r.files); NasDeck.fillBIN(r.trash); }).catch(() => {}), testName);
  /* 安全约束：验证脚本绝不能调用 /api/bin/clear。
     旧版这里清空的是项目私有 trash.json；接上真实 Windows 回收站后，
     它会永久删除用户回收站里的全部内容（曾误清 14483 项）。改为只读列表。 */
  await page.evaluate(() => NasDeck.get('/api/bin/list?limit=5').then(r => NasDeck.fillBIN(r.bin || [])).catch(() => {}));

  // 真实终端
  await page.evaluate(() => openApp('terminal'));
  await page.waitForTimeout(200);
  await page.fill('#term-in', 'echo NasDeck_WIN_OK');
  await page.press('#term-in', 'Enter');
  await page.waitForTimeout(2600);
  log('TERMINAL', await page.evaluate(() => ({ last: TERM_LINES.slice(-3).map(x => x.t), ok: TERM_LINES.some(x => x.t.indexOf('NasDeck_WIN_OK') >= 0) })));

  // 真实指标 + 监测历史
  await page.waitForTimeout(2400);
  log('MONITOR', await page.evaluate(() => ({ cpu: CUR.cpu, mem: CUR.mem, disk: CUR.disk, down: NasDeck.latest.down, up: NasDeck.latest.up })));
  const mon = await page.evaluate(() => NasDeck.get('/api/monitor'));
  log('MONITOR_HISTORY', { points: mon.history.cpu.length, hourly: mon.hourly.cpu.length, alerts: mon.alerts.length, thresholds: mon.thresholds });

  // Windows 原生动作（不触碰 wsl.exe）
  const diag = await page.evaluate(() => NasDeck.get('/api/win/diag?act=ping'));
  log('NET_DIAG', { ok: diag.ok, head: (diag.out || '').split('\n')[0] });
  const th = await page.evaluate(() => NasDeck.post('/api/monitor/thresholds', { cpu: 88, mem: 91, disk: 92, temp: 82 }));
  log('THRESHOLDS', th.thresholds);

  // 真实 HBS 备份（项目内临时目录，验证后清理）
  const src = path.join(OUT, 'data', 'shares', 'Public');
  const dst = path.join(OUT, 'data', '_verify_backup');
  const bk = await page.evaluate(o => NasDeck.post('/api/backups/create', { name: '验证备份', src: o.src, dst: o.dst, mode: 'incremental' }), { src, dst });
  log('BACKUP_CREATE', { ok: bk.ok, jobs: (bk.jobs || []).length, err: bk.error });
  if (bk.ok && bk.jobs && bk.jobs[0]) {
    const run = await page.evaluate(id => NasDeck.post('/api/backups/run', { id }), bk.jobs[0].id);
    await page.waitForTimeout(2600);
    const state = await page.evaluate(() => NasDeck.get('/api/backups'));
    log('BACKUP_RUN', { ok: run.ok, st: state.jobs[0] && state.jobs[0].st, size: state.jobs[0] && state.jobs[0].size });
    await page.evaluate(id => NasDeck.post('/api/backups/remove', { id }), bk.jobs[0].id);
  }
  try { fs.rmSync(dst, { recursive: true, force: true }); } catch (e) {}

  // HTTP 下载（真实完成）
  await page.evaluate(() => openApp('download'));
  await page.evaluate(() => NasDeck.post('/api/downloads/add', { url: location.origin + '/api/health', name: 'nasdeck_verify_health.json' })
    .then(r => NasDeck.fillDLS(r.downloads)).catch(() => {}));
  await page.waitForTimeout(1500);
  log('DOWNLOAD', await page.evaluate(() => DLS.slice(0, 2)));

  // 全部 20 个 App 打开，检查新渲染器无异常
  const apps = ['storage', 'controlpanel', 'appcenter', 'container', 'hbs', 'photodeck', 'music', 'video',
    'network', 'qufirewall', 'remotelink', 'logs', 'trash', 'settings', 'about', 'help', 'dashboard'];
  await page.evaluate(list => list.forEach(id => openApp(id)), apps);
  await page.waitForTimeout(1400);
  log('ALL_APPS', await page.evaluate(() => ({
    windows: WINS.filter(w => !w.closed).length,
    bodies: WINS.filter(w => !w.closed).map(w => ({ id: w.id, len: w.el.querySelector('.win-body') ? w.el.querySelector('.win-body').innerHTML.length : 0 }))
  })));

  // 各窗口真实内容关键字检查
  log('WINDOWS_UI', await page.evaluate(() => {
    const pick = id => { const w = W(id); return w ? (w.el.querySelector('.win-body') || {}).textContent || '' : ''; };
    const has = (id, k) => pick(id).indexOf(k) >= 0;
    return {
      services: has('controlpanel', 'Windows 服务'),
      firewall: has('qufirewall', '防火墙配置文件'),
      network: has('network', '网络适配器') || has('network', '本机网络适配器'),
      storage: has('storage', '物理磁盘'),
      hbs: has('hbs', 'robocopy'),
      appcenter: has('appcenter', '已安装'),
      container: has('container', '容器工作台') || has('container', 'WSL'),
      remotelink: has('remotelink', '本机 IPv4') || has('remotelink', '联机'),
      logs: has('logs', '监测'),
      about: has('about', '本机硬件') || has('about', 'CIM'),
      download: has('download', 'aria2')
    };
  }));

  // Tab 切换与刷新动作（ACT 层）
  await page.evaluate(() => {
    ACT['win-cp-tab'](null, { t: 'tasks' });
    ACT['win-net-tab'](null, { t: 'ports' });
    ACT['win-st-tab'](null, { t: 'snap' });
    ACT['win-ct-tab'](null, { t: 'engine' });
    ACT['win-log-tab'](null, { t: 'winevent' });
    ACT['win-ap-tab'](null, { t: 'winget' });
  });
  await page.waitForTimeout(600);
  log('TABS', await page.evaluate(() => ({
    cp: (W('controlpanel').el.textContent || '').indexOf('Windows 计划任务') >= 0,
    net: (W('network').el.textContent || '').indexOf('监听端口') >= 0,
    st: (W('storage').el.textContent || '').indexOf('卷影副本') >= 0,
    log: (W('logs').el.textContent || '').indexOf('Windows 事件日志') >= 0
  })));
  log('TAB_ERRORS', errors);

  // 验证期间改过告警阈值，恢复默认值，避免污染用户首次使用的配置
  await page.evaluate(() => NasDeck.post('/api/monitor/thresholds', { cpu: 85, mem: 90, disk: 90, temp: 80 }));

  // 三张单窗口展示图：右侧小工具完整可见，真实数据区不被遮挡
  async function shot(id, file, tab) {
    await page.evaluate(o => {
      WINS.filter(w => !w.closed).forEach(w => closeWin(w));
      S.theme = 'dark'; S.wall = 'blue'; applyTheme();
      if (o.tab) { const key = { controlpanel: 'cp', container: 'ct', storage: 'st' }[o.id]; if (key) NasDeck.tabs[key] = o.tab; }
      openApp(o.id);
      const rec = W(o.id);
      if (rec) { rec.x = 132; rec.y = 58; rec.w = 830; rec.h = 620; applyRect(rec); }
      document.getElementById('toasts').innerHTML = '';
    }, { id, tab });
    await page.waitForTimeout(1800);  // 等指标回落，避免截图里 CPU 显示瞬时 100%
    await page.screenshot({ path: path.join(OUT, file) });
  }
  await shot('controlpanel', 'preview-windows.png', 'services');
  await shot('container', 'preview-wsl.png', 'containers');
  await shot('storage', 'preview-storage.png', 'disk');

  log('FINAL', await page.evaluate(() => ({
    mode: NasDeck.mode, sse: NasDeck.es ? NasDeck.es.readyState : -1,
    windows: WINS.filter(w => !w.closed).length,
    winReady: (NasDeck.win.ready || []).length, winPending: (NasDeck.win.pending || []).length
  })));
  log('ERRORS', errors);
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'verify-result.txt'), logs.join('\n') + '\n\nERRORS: ' + JSON.stringify(errors, null, 2), 'utf8');
  if (errors.length) process.exitCode = 1;
})().catch(e => { console.error('FATAL', e.stack || e); fs.writeFileSync(path.join(OUT, 'verify-result.txt'), 'FATAL ' + (e.stack || e), 'utf8'); process.exitCode = 1; });
