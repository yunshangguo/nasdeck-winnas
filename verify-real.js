'use strict';
/* ============================================================
 * verify-real.js — 「全部数据必须真实」专项端到端验证
 * 用真实 Chromium 打开真实后端，检查所有可见文本里不存在任何
 * 演示期硬编码的硬件数值，且能看到本机真实 CPU / 主板 / 磁盘。
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
  '41 °C', '192.168.1.88', 'qulogd', '/dev/mapper/vg1', '4-Bay NAS', 'QN-2025-'
];

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.goto(BASE + '/', { waitUntil: 'load' });
  // NasDeck_BOOT() 的 probe 是异步的（最多约 4s），必须等它接管登录按钮，
  // 否则点击会走演示版 doLogin()，整个页面回落 demo 模式。
  await page.waitForFunction(
    () => window.NasDeck && NasDeck.mode === 'live' && typeof window.__NasDeck_LOGIN__ === 'function',
    null, { timeout: 20000 });
  await page.waitForTimeout(500);

  // A. 登录页文案（install 之前先记录，install 后会由 scrubDemoText 改写）
  log('LOGIN_TIP_BEFORE', await page.evaluate(() => {
    const e = document.querySelector('.lg-tip');
    return e ? e.textContent : '(none)';
  }));

  await page.fill('#lg-user', 'admin');
  await page.fill('#lg-pass', 'admin');
  await page.click('#lg-go');
  await page.waitForTimeout(3200);
  log('AFTER_LOGIN', await page.evaluate(() => ({
    mode: NasDeck.mode, sse: NasDeck.es ? NasDeck.es.readyState : -1,
    winInstalled: typeof NasDeck_WIN_INSTALL === 'function' && !!NasDeck.win,
    bootApi: NasDeck.boot && NasDeck.boot.api
  })));
  log('LOGIN_TIP_AFTER', await page.evaluate(() => {
    const e = document.querySelector('.lg-tip');
    return { text: e ? e.textContent : '(none)', hasDemo: e ? /演示|密码 任意/.test(e.textContent) : true };
  }));

  // B. 等后台全部采集完成（hardware 第二组、adapters 第四组）
  let hw = null;
  for (let i = 0; i < 60; i++) {
    const snap = await page.evaluate(() => NasDeck.get('/api/win/snapshot').then(r => ({
      ready: (r.ready || []).length, adapters: (r.adapters || []).length, hardware: r.hardware || null
    })));
    if (snap.hardware && snap.hardware.cpu && snap.hardware.cpu.name && snap.adapters > 0 && snap.ready >= 15) {
      hw = snap.hardware;
      log('WIN_READY', { ready: snap.ready, adapters: snap.adapters });
      break;
    }
    await page.waitForTimeout(2000);
  }
  log('HARDWARE_API', hw ? {
    cpu: hw.cpu.name, cores: hw.cpu.cores, threads: hw.cpu.threads,
    memTotalGB: hw.memory.totalGB, sticks: hw.memory.stickCount,
    board: hw.board.maker + ' ' + hw.board.product, bios: hw.bios.version,
    os: hw.os.caption + ' Build ' + hw.os.build,
    disks: (hw.disks || []).map(d => d.model + ' ' + d.sizeGB + 'GB ' + d.bus),
    volumes: (hw.volumes || []).map(v => v.drive + ' ' + v.sizeGB + 'GB'),
    monitors: (hw.monitors || []).length,
    sensorSupported: hw.sensors.supported, cpuTempC: hw.sensors.cpuTempC,
    diskTempAvailable: hw.sensors.diskTempAvailable,
    sensorNote: hw.sensors.note
  } : 'TIMEOUT');

  // C. 强制把硬件数据同步进前端并重绘
  await page.evaluate(() => NasDeck.syncWin());
  await page.waitForTimeout(1200);
  await page.evaluate(() => { WINS.filter(w => !w.closed).forEach(w => closeWin(w)); openApp('dashboard'); });
  await page.waitForTimeout(1200);

  const dash = await page.evaluate(() => {
    const w = W('dashboard');
    return w ? (w.el.querySelector('.win-body') || w.el).innerText : '';
  });
  log('DASHBOARD_LEN', dash.length);
  log('DASHBOARD_REAL', {
    cpu: dash.indexOf(hwCpu()) >= 0,
    board: dash.indexOf(hwBoard()) >= 0,
    physicalDisk: dash.indexOf('物理磁盘与卷') >= 0,
    sensor: dash.indexOf('传感器与监测状态') >= 0,
    hardwareList: dash.indexOf('硬件清单') >= 0
  });
  function hwCpu() { return (hw && hw.cpu ? hw.cpu.name : '___').slice(0, 12); }
  function hwBoard() { return (hw && hw.board ? hw.board.maker : '___'); }
  const dashFake = FAKE.filter(k => dash.indexOf(k) >= 0);
  log('DASHBOARD_FAKE', dashFake);

  // D. 桌面小工具
  const widgets = await page.evaluate(() => (document.getElementById('widgets') || {}).innerText || '');
  log('WIDGETS_REAL', {
    hasCpu: widgets.indexOf('CPU 使用率') >= 0,
    hasRealCpuName: widgets.indexOf(hwCpuName()) >= 0,
    hasVolumes: /个真实卷/.test(widgets),
    hasEvents: widgets.indexOf('真实系统日志') >= 0
  });
  function hwCpuName() { return (hw && hw.cpu ? hw.cpu.name : '___').slice(0, 10); }
  log('WIDGETS_FAKE', FAKE.filter(k => widgets.indexOf(k) >= 0));

  // E. 逐个打开所有 App，扫描可见文本
  const apps = ['storage', 'controlpanel', 'appcenter', 'container', 'hbs', 'photodeck', 'music', 'video',
    'network', 'qufirewall', 'remotelink', 'logs', 'trash', 'settings', 'about', 'help', 'download', 'filestation'];
  await page.evaluate(list => list.forEach(id => openApp(id)), apps);
  await page.waitForTimeout(1600);
  const perApp = await page.evaluate(fake => {
    const out = {};
    WINS.filter(w => !w.closed).forEach(w => {
      const t = (w.el.innerText || '');
      const hit = fake.filter(k => t.indexOf(k) >= 0);
      out[w.id] = { len: t.length, fake: hit };
    });
    return out;
  }, FAKE);
  log('PER_APP', perApp);

  // F. 全桌面可见文本兜底扫描
  const bodyFake = await page.evaluate(fake => {
    const t = document.body.innerText || '';
    return { len: t.length, hit: fake.filter(k => t.indexOf(k) >= 0) };
  }, FAKE);
  log('BODY_VISIBLE', bodyFake);

  // G. 关键 App 的真实内容存在性
  log('REAL_CONTENT', await page.evaluate(() => {
    const pick = id => { const w = W(id); return w ? (w.el.innerText || '') : ''; };
    const has = (id, k) => pick(id).indexOf(k) >= 0;
    return {
      aboutHardware: has('about', '本机硬件'),
      aboutBoard: has('about', 'BIOS'),
      dashboardHardware: has('dashboard', '硬件清单'),
      dashboardDisk: has('dashboard', 'Get-PhysicalDisk'),
      filestationReal: has('filestation', '本机卷') || has('filestation', '真实 Windows 文件系统'),
      helpNoDemo: !has('help', '均为模拟数据'),
      storageReal: has('storage', '物理磁盘')
    };
  }));

  // H. 硬件刷新按钮真实动作
  await page.evaluate(() => ACT['win-hw-refresh'] && ACT['win-hw-refresh']());
  await page.waitForTimeout(1500);
  log('HW_REFRESH', await page.evaluate(() => ({ hasHardware: !!(NasDeck.win.hardware && NasDeck.win.hardware.cpu) })));

  // I. 三张新截图（单窗口 + 右侧小工具完整可见）
  async function shot(id, file, scrollTo) {
    await page.evaluate(o => {
      WINS.filter(w => !w.closed).forEach(w => closeWin(w));
      S.theme = 'dark'; S.wall = 'blue'; applyTheme();
      openApp(o.id);
      const rec = W(o.id);
      if (rec) { rec.x = 132; rec.y = 58; rec.w = 830; rec.h = 780; applyRect(rec); }
      document.getElementById('toasts').innerHTML = '';
      if (o.scrollTo) {
        const sc = rec && rec.el.querySelector('.app-scroll');
        if (sc) sc.scrollTop = o.scrollTo;
      }
    }, { id, scrollTo: scrollTo || 0 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, file) });
  }
  await shot('dashboard', 'preview-real-hardware.png');
  await shot('dashboard', 'preview-real-hardware-detail.png', 1050);
  await shot('about', 'preview-real-about.png');
  await shot('storage', 'preview-real-storage.png');

  log('FINAL', {
    errors, dashFake, widgetsFake: FAKE.filter(k => widgets.indexOf(k) >= 0),
    bodyFake: bodyFake.hit, hardwareReady: !!(hw && hw.cpu && hw.cpu.name)
  });
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'verify-real-result.txt'), logs.join('\n') + '\n\nERRORS: ' + JSON.stringify(errors, null, 2), 'utf8');
  if (errors.length || dashFake.length || bodyFake.hit.length) process.exitCode = 1;
})().catch(e => {
  console.error('FATAL', e.stack || e);
  fs.writeFileSync(path.join(OUT, 'verify-real-result.txt'), 'FATAL ' + (e.stack || e), 'utf8');
  process.exitCode = 1;
});
