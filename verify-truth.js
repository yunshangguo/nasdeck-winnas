'use strict';
/* ============================================================
 * verify-truth.js — 双入口真实性验证
 *   Case A  无后端（拦截 /api/health）→ 必须显示 N/A 状态页、0 假数据
 *   Case B  live 5080 → 全站 0 假数据、真实硬件值、WSL 子系统可用
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:5080';
const OUT = __dirname;
const errors = [];
const logs = [];
const log = (k, v) => { const s = k + ' ' + (typeof v === 'string' ? v : JSON.stringify(v)); logs.push(s); console.log(s); };

const FAKE = [
  'N5105', 'Celeron', '4 核心', '16 GB DDR4', '1,120 RPM', '26 天 14 小时',
  '8.0 TB', '21.8 TB', '18.4 TB', '18.4 /', 'ST8000VN', 'DataVol1', 'RAID 5',
  '2.5 GbE', 'Windows 本机', 'LOCAL-NAS', '模拟数据', '均为模拟', '演示环境', '演示模式',
  '41 °C', '192.168.1.88', 'qulogd', '/dev/mapper/vg1', '4-Bay NAS', 'QN-2025-',
  'NasDeck 2.5.0 build', 'Linux 5.10.60', 'jellyfin/jellyfin:10.9', 'photodeck-index',
  '界面演示', '均为模拟数据', '本页面为 NasDeck NasDeck Web 界面演示'
];

const APPS = ['storage', 'controlpanel', 'appcenter', 'container', 'hbs', 'photodeck', 'music', 'video',
  'network', 'qufirewall', 'remotelink', 'logs', 'trash', 'settings', 'about', 'help', 'download',
  'filestation', 'dashboard', 'terminal'];

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* ==================== Case A：无后端 ==================== */
  const pa = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1 });
  pa.on('pageerror', e => errors.push('A PAGEERROR: ' + e.message));
  pa.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR|ERR_FAILED/.test(m.text())) errors.push('A CONSOLE: ' + m.text()); });
  await pa.route('**/api/health', r => r.abort());
  await pa.goto(BASE + '/', { waitUntil: 'load' });
  await pa.waitForTimeout(6500);
  const off = await pa.evaluate(fake => {
    const scr = document.getElementById('nasdeck-na-screen');
    const t = document.body.innerText || '';
    return {
      naScreen: !!scr,
      naCount: (t.match(/N\/A/g) || []).length,
      mode: window.NasDeck ? NasDeck.mode : 'none',
      fake: fake.filter(k => t.indexOf(k) >= 0),
      hasGuide: t.indexOf('start.bat') >= 0,
      hasWslGuide: t.indexOf('start-wsl-docker.bat') >= 0
    };
  }, FAKE);
  log('OFFLINE', off);
  await pa.screenshot({ path: path.join(OUT, 'preview-truth-offline.png') });

  /* ==================== Case B：live 后端 ==================== */
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('B PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text())) errors.push('B CONSOLE: ' + m.text()); });

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.NasDeck && NasDeck.mode === 'live' && typeof window.__NasDeck_LOGIN__ === 'function',
    null, { timeout: 20000 });
  await page.fill('#lg-user', 'admin');
  await page.fill('#lg-pass', 'admin');
  await page.click('#lg-go');
  await page.waitForTimeout(3500);

  log('BOOT', await page.evaluate(() => ({
    mode: NasDeck.mode, sse: NasDeck.es ? NasDeck.es.readyState : -1,
    purged: !!window.__NasDeck_TRUTH_PURGED__,
    truth: !!window.__NasDeck_TRUTH__,
    naScreen: !!document.getElementById('nasdeck-na-screen'),
    bootApi: NasDeck.boot && NasDeck.boot.api
  })));

  /* 等全部真实采集就绪 */
  let hw = null;
  for (let i = 0; i < 60; i++) {
    const snap = await page.evaluate(() => NasDeck.get('/api/win/snapshot').then(r => ({
      ready: (r.ready || []).length, adapters: (r.adapters || []).length, hardware: r.hardware || null
    })));
    if (snap.hardware && snap.hardware.cpu && snap.hardware.cpu.name && snap.adapters > 0 && snap.ready >= 15) {
      hw = snap.hardware; break;
    }
    await page.waitForTimeout(2000);
  }
  log('HARDWARE', hw ? {
    cpu: hw.cpu.name, cores: hw.cpu.cores, threads: hw.cpu.threads,
    memTotalGB: hw.memory.totalGB, sticks: hw.memory.stickCount,
    board: hw.board.maker + ' ' + hw.board.product,
    disks: (hw.disks || []).map(d => d.model + ' ' + d.sizeGB + 'GB'),
    volumes: (hw.volumes || []).map(v => v.drive + ' ' + v.sizeGB + 'GB'),
    sensorsSupported: hw.sensors.supported, cpuTempC: hw.sensors.cpuTempC
  } : 'TIMEOUT');

  /* 源头 demo 数据源必须已清空或为真实数据 */
  log('DEMO_SOURCES', await page.evaluate(() => ({
    STORE_APPS: STORE_APPS.length, FAQS: FAQS.length, SNAPS: SNAPS.length,
    HBS_JOBS: HBS_JOBS.length, PHOTOS: PHOTOS.length, SONGS: SONGS.length,
    MOVIES: MOVIES.length, FW_RULES: FW_RULES.length, DISKS: DISKS.length,
    NOTIS: NOTIS.length, CONTAINERS: CONTAINERS.length, DLS: DLS.length,
    CUR: { cpu: CUR.cpu, mem: CUR.mem, temp: CUR.temp }
  })));

  await page.evaluate(() => NasDeck.syncWin());
  await page.waitForTimeout(1200);

  /* 打开全部 App，逐个扫描 */
  await page.evaluate(list => {
    WINS.filter(w => !w.closed).forEach(w => closeWin(w));
    list.forEach(id => openApp(id));
  }, APPS);
  await page.waitForTimeout(2000);
  const perApp = await page.evaluate(fake => {
    const out = {};
    WINS.filter(w => !w.closed).forEach(w => {
      const t = (w.el.innerText || '');
      out[w.id] = { len: t.length, fake: fake.filter(k => t.indexOf(k) >= 0) };
    });
    return out;
  }, FAKE);
  log('PER_APP_FAKE', Object.fromEntries(Object.entries(perApp).filter(([, v]) => v.fake.length)));
  log('PER_APP_COUNT', Object.keys(perApp).length);

  const bodyFake = await page.evaluate(fake => {
    const t = document.body.innerText || '';
    return { len: t.length, hit: fake.filter(k => t.indexOf(k) >= 0) };
  }, FAKE);
  log('BODY_VISIBLE', bodyFake);

  /* 真实值必须真的出现在界面上 */
  const real = await page.evaluate(cpu => {
    const t = document.body.innerText || '';
    return {
      cpuModel: t.indexOf(cpu.slice(0, 14)) >= 0,
      physicalDisk: /MZVLB512HBJQ|Msft Virtual Disk/.test(t),
      board: /HUAWEI|MACHD/.test(t),
      windowsBuild: /26200|Windows 11/.test(t),
      volumes: /C:|D:/.test(t),
      naPresent: (t.match(/N\/A/g) || []).length
    };
  }, hw ? hw.cpu.name : '___');
  log('REAL_VALUES_VISIBLE', real);

  /* WSL 子系统页 */
  await page.evaluate(() => {
    WINS.filter(w => !w.closed).forEach(w => closeWin(w));
    openApp('container');
    /* 容器工作台 已重做为「单窗口 + 多标签页」：
       WSL 子系统内容现在在「WSL 发行版」标签里，点标签才会显示。 */
    const cw = W('container');
    const wb = cw && cw.el.querySelector('[data-act="dkr-tab"][data-t="wsl"]');
    if (wb) wb.click();
    const rec = W('container');
    if (rec) { rec.x = 140; rec.y = 24; rec.w = 1060; rec.h = 890; applyRect(rec); }
    document.getElementById('toasts').innerHTML = '';
    const sc = rec && rec.el.querySelector('.app-scroll');
    if (sc) sc.scrollTop = 210;
  });
  await page.waitForTimeout(1600);
  const wslPage = await page.evaluate(() => {
    const w = W('container');
    const t = w ? (w.el.innerText || '') : '';
    return {
      len: t.length,
      hasDebian: t.indexOf('Debian') >= 0,
      hasBasePath: /D:\\WSL\\Debian/.test(t),
      hasWslTerminal: t.indexOf('WSL 终端') >= 0,
      hasManager: t.indexOf('管理器') >= 0,
      hasAutostart: t.indexOf('启动 Docker 引擎') >= 0,
      hasNA: t.indexOf('N/A') >= 0
    };
  });
  log('WSL_PAGE', wslPage);
  await page.screenshot({ path: path.join(OUT, 'preview-truth-wsl.png') });

  /* 资源监控截图 */
  await page.evaluate(() => {
    WINS.filter(w => !w.closed).forEach(w => closeWin(w));
    S.theme = 'dark'; S.wall = 'blue'; applyTheme();
    openApp('dashboard');
    const rec = W('dashboard');
    if (rec) { rec.x = 120; rec.y = 52; rec.w = 880; rec.h = 700; applyRect(rec); }
    document.getElementById('toasts').innerHTML = '';
  });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(OUT, 'preview-truth-hardware.png') });

  /* API 层：WSL 发行版与管理器 */
  const apiWsl = await page.evaluate(async () => {
    const d = await NasDeck.get('/api/wsl/distros');
    const m = await NasDeck.get('/api/wsl/manager');
    return {
      distrosOk: d.ok, source: d.source,
      distros: d.distros.map(x => ({ name: x.name, state: x.state, version: x.version, basePath: x.basePath })),
      manager: { available: m.available, port: m.port, message: m.message }
    };
  });
  log('WSL_API', apiWsl);

  log('ERRORS', errors);
  const ok = !off.fake.length && off.naScreen && !bodyFake.hit.length &&
    !Object.values(perApp).some(v => v.fake.length) &&
    real.cpuModel && wslPage.hasDebian && apiWsl.distrosOk && !errors.length;
  log('VERDICT', ok ? 'PASS' : 'FAIL');
  fs.writeFileSync(path.join(OUT, 'verify-truth-result.txt'), logs.join('\n') + '\n', 'utf8');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
