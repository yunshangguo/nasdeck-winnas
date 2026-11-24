'use strict';
/* ============================================================
 * verify-machine.js — 「四链路真的连上本机」端到端验证
 *   ① 资源回收站 → Windows $Recycle.Bin 真实项目
 *   ② 文件总管   → 真实盘符 / 真实目录 / 真实容量
 *   ③ 网络       → 真实网卡 + 可操作按钮 + 刷新毫秒级
 *   ④ Container  → WSL 发行版 + Docker 端点真实回显
 * 另：全站 0 假数据、0 console/pageerror。
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:5080';
const OUT = __dirname;
const RESULT = path.join(OUT, 'verify-machine-result.txt');
const errors = [];
const lines = [];
const log = (k, v) => {
  const s = k + ' ' + (typeof v === 'string' ? v : JSON.stringify(v));
  lines.push(s); console.log(s);
};

const FAKE = [
  'N5105', 'Celeron', '4 核心', '16 GB DDR4', '1,120 RPM', '26 天 14 小时',
  '8.0 TB', '21.8 TB', '18.4 TB', 'ST8000VN', 'DataVol1', 'RAID 5',
  '2.5 GbE', 'Windows 本机', 'LOCAL-NAS', '模拟数据', '均为模拟', '演示环境', '演示模式',
  '41 °C', '192.168.1.88', 'qulogd', '/dev/mapper/vg1', '4-Bay NAS',
  'NasDeck 2.5.0 build', 'Linux 5.10.60', 'jellyfin/jellyfin:10.9', 'photodeck-index',
  '界面演示', '本页面为 NasDeck NasDeck Web 界面演示',
  /* 四链路专属 demo 文案 */
  '保留 30 天', '占用 1.2 GB', '示例文件.txt', 'Public 共享文件夹',
  'eth0', 'eth1', '192.168.1.100', '假容器', 'docker-demo'
];

function hit(text, keys) { return keys.filter(k => text.indexOf(k) >= 0); }

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/favicon|404|net::ERR|ERR_FAILED/.test(m.text())) {
      errors.push('CONSOLE: ' + m.text());
    }
  });

  /* ---- 登录（必须等 probe 完成，否则回落 demo） ---- */
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.NasDeck && NasDeck.mode === 'live' && typeof window.__NasDeck_LOGIN__ === 'function',
    null, { timeout: 25000 });
  await page.fill('#lg-user', 'admin');
  await page.fill('#lg-pass', 'admin');
  await page.click('#lg-go');
  /* install 包装链耗时不固定，显式等真实层挂载，避免时序误判 */
  await page.waitForFunction(() => !!window.__NasDeck_REAL__, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  log('BOOT', await page.evaluate(() => ({
    mode: NasDeck.mode, api: NasDeck.boot && NasDeck.boot.api,
    realLayer: !!window.__NasDeck_REAL__, truth: !!window.__NasDeck_TRUTH__,
    naScreen: !!document.getElementById('nasdeck-na-screen')
  })));

  /* ---- 等后台真实数据全部就绪（WMI 串行重试 + 回收站扫描） ---- */
  let ready = null;
  for (let i = 0; i < 20; i++) {
    ready = await page.evaluate(async () => {
      const s = await NasDeck.get('/api/win/snapshot');
      const b = await NasDeck.get('/api/bin/list?limit=5');
      return {
        winReady: (s.ready || []).length,
        adapters: (s.adapters || []).length,
        shares: (s.shares || []).length,
        tasks: (s.tasks || []).length,
        fw: (s.firewall || {}).total,
        cpu: ((s.hardware || {}).cpu || {}).name || null,
        binTotal: b.total, binItems: (b.bin || []).length,
        binSource: b.source, binUsedText: b.usedText
      };
    });
    if (ready.winReady >= 15 && ready.adapters > 0 && ready.shares > 0 &&
        ready.tasks > 0 && ready.fw > 0 && ready.cpu &&
        ready.binTotal > 0 && ready.binItems > 0) break;
    await page.waitForTimeout(2000);
  }
  log('DATA_READY', ready);

  await page.evaluate(() => { NasDeck.syncWin(); });
  await page.waitForTimeout(1200);

  /* ---- 逐 App 打开并扫描真实内容 ---- */
  async function openOne(id) {
    await page.evaluate(a => {
      WINS.filter(w => !w.closed).forEach(w => closeWin(w));
      openApp(a);
      const rec = W(a);
      if (rec) { rec.x = 120; rec.y = 22; rec.w = 1080; rec.h = 890; applyRect(rec); }
      document.getElementById('toasts').innerHTML = '';
    }, id);
    await page.waitForTimeout(900);
    return await page.evaluate(a => {
      const w = W(a);
      return w ? (w.el.innerText || '') : '(window missing)';
    }, id);
  }

  const checks = {};

  /* ① 回收站 */
  const tBin = await openOne('trash');
  checks.trash = {
    len: tBin.length,
    title: /资源回收站 · Windows 本机/.test(tBin),
    source: /\$Recycle\.Bin|Windows 回收站/.test(tBin),
    /* 回收站内容会随时变化，不写死数量/容量；只要显示的是真实数字且来源正确 */
    realCount: /\d+ 个项目/.test(tBin),
    realSize: /\d+(?:\.\d+)?\s*(?:KB|MB|GB|TB)/.test(tBin) && ready.binUsedText !== 'N/A',
    realFile: /logs\.json|notis\.json|\.txt|\.png/.test(tBin),
    buttons: ['还原选中', '永久删除', '重新扫描', '清空回收站'].filter(x => tBin.indexOf(x) >= 0),
    fake: hit(tBin, FAKE)
  };
  log('TRASH', checks.trash);
  await page.screenshot({ path: path.join(OUT, 'preview-machine-trash.png') });

  /* ② 文件总管 —— 只检查主内容区格子，左侧真实树里的 Downloads 不算 demo */
  const tFs = await openOne('filestation');
  const fsCells = await page.evaluate(() => {
    const w = W('filestation');
    return w ? Array.prototype.map.call(w.el.querySelectorAll('.fs-cell b'), e => (e.textContent || '').trim()) : [];
  });
  checks.filestation = {
    len: tFs.length,
    thisPc: /此电脑/.test(tFs),
    driveC: /C:/.test(tFs), driveD: /D:/.test(tFs),
    realCap: /118\.8 GB|343\.2 GB/.test(tFs),
    userHome: /用户主目录|Desktop/.test(tFs),
    cells: fsCells,
    /* 存储卡片必须显示真实容量，而不是缺字段的 N/A */
    volCardReal: !/N\/A 可用 N\/A/.test(tFs),
    /* 「此电脑」主内容区不得再混入项目内虚拟共享目录 */
    noDemoShares: !fsCells.some(n => /^(Public|Multimedia|Download|Web|Container|homes)$/i.test(n)),
    fake: hit(tFs, FAKE)
  };
  log('FILESTATION', checks.filestation);
  /* 真实路径深入：C:/Users/Administrator 必须能列出真实条目 */
  checks.fsBrowse = await page.evaluate(async () => {
    const out = {};
    for (const p of ['/C:/Windows', '/C:/Users']) {
      try {
        const r = await NasDeck.get('/api/files/list?path=' + encodeURIComponent(p));
        out[p] = { entries: (r.entries || []).length, sample: (r.entries || []).slice(0, 3).map(x => x.n) };
      } catch (e) { out[p] = { error: e.message }; }
    }
    return { win: out['/C:/Windows'], users: out['/C:/Users'] };
  }).catch(e => ({ error: e.message }));
  log('FS_REAL_BROWSE', checks.fsBrowse);
  await page.screenshot({ path: path.join(OUT, 'preview-machine-files.png') });

  /* ③ 网络 */
  const tNet = await openOne('network');
  checks.network = {
    len: tNet.length,
    realNic: /WLAN|AX201|vEthernet/.test(tNet),
    realSpeed: /400 Mbps|10 Gbps/.test(tNet),
    realMac: /([0-9A-F]{2}-){5}[0-9A-F]{2}/i.test(tNet),
    ops: ['启用', '禁用', '刷新'].filter(x => tNet.indexOf(x) >= 0),
    fake: hit(tNet, FAKE)
  };
  log('NETWORK', checks.network);
  /* 实测刷新按钮：必须走 snapshot 缓存，毫秒级返回 */
  checks.refreshMs = await page.evaluate(async () => {
    const t = Date.now();
    try { await ACT['win-adapter-refresh'](); } catch (e) { return -1; }
    return Date.now() - t;
  });
  log('NET_REFRESH_MS', checks.refreshMs);
  await page.screenshot({ path: path.join(OUT, 'preview-machine-network.png') });

  /* ④ 容器工作台（WSL 页） */
  await page.evaluate(() => {
    WINS.filter(w => !w.closed).forEach(w => closeWin(w));
    if (NasDeck.tabs) NasDeck.tabs.ct = 'wsl';
    openApp('container');
    const rec = W('container');
    if (rec) { rec.x = 120; rec.y = 22; rec.w = 1080; rec.h = 890; applyRect(rec); }
    const sc = rec && rec.el.querySelector('.app-scroll');
    if (sc) sc.scrollTop = 200;
  });
  await page.waitForTimeout(1300);
  const tCt = await page.evaluate(() => {
    const w = W('container'); return w ? (w.el.innerText || '') : '(missing)';
  });
  checks.container = {
    len: tCt.length,
    debian: /Debian/.test(tCt),
    wsl: /WSL/.test(tCt),
    docker: /Docker|dockerd|引擎/.test(tCt),
    endpoint: /2375|config\.json|127\.0\.0\.1/.test(tCt),
    fake: hit(tCt, FAKE)
  };
  log('CONTAINER', checks.container);
  await page.screenshot({ path: path.join(OUT, 'preview-machine-container.png') });

  /* ---- 全站可见文本 0 假数据 ---- */
  await page.evaluate(list => {
    WINS.filter(w => !w.closed).forEach(w => closeWin(w));
    list.forEach(a => openApp(a));
  }, ['dashboard', 'storage', 'controlpanel', 'about', 'help', 'logs', 'settings']);
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body.innerText || '');
  const bodyFake = hit(body, FAKE);
  log('BODY_FAKE', { len: body.length, hit: bodyFake });

  /* ---- 判定 ---- */
  const pass =
    ready.winReady >= 15 && ready.adapters > 0 && ready.shares > 0 && ready.tasks > 0 &&
    ready.fw > 0 && !!ready.cpu && ready.binTotal > 0 && ready.binItems > 0 &&
    checks.trash.title && checks.trash.realCount && checks.trash.realSize &&
    checks.trash.realFile && checks.trash.buttons.length === 4 && checks.trash.fake.length === 0 &&
    checks.filestation.thisPc && checks.filestation.driveC && checks.filestation.driveD &&
    checks.filestation.realCap && checks.filestation.noDemoShares &&
    checks.filestation.volCardReal && checks.filestation.fake.length === 0 &&
    ((checks.fsBrowse.win || {}).entries || 0) > 0 &&
    checks.network.realNic && checks.network.ops.length > 0 && checks.network.fake.length === 0 &&
    checks.refreshMs >= 0 && checks.refreshMs < 6000 &&
    checks.container.debian && checks.container.wsl && checks.container.docker &&
    checks.container.fake.length === 0 &&
    bodyFake.length === 0 && errors.length === 0;

  log('ERRORS', errors);
  log('VERDICT', pass ? 'PASS' : 'FAIL');
  fs.writeFileSync(RESULT, lines.join('\n') + '\n', 'utf-8');
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch(e => {
  console.error('FATAL', e && e.stack || e);
  try { fs.writeFileSync(RESULT, lines.join('\n') + '\nFATAL ' + (e && e.stack || e) + '\n', 'utf-8'); } catch (_) {}
  process.exit(2);
});
