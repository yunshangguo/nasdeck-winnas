//__NasDeck_TRUTH_START__
/* ==================================================================
 * nasdeck-truth.src.js —— 真实性守卫层（NasDeck 全站禁止虚拟数据）
 *
 * 原则：有真实数据 → 显示真实值；读不到 → 显示 N/A；绝不显示模拟值。
 *
 * 三层防护：
 *   1) purgeDemoSources()  在 NasDeck.install() 前清空所有 demo 数据源，
 *      hydrate() 只回填后端真实数据，没回填的一律空 / N/A。
 *   2) 离线 N/A 状态页     未探测到后端时，整套 demo 桌面不再展示。
 *   3) DOM 哨兵            任何残留的硬编码假串即时改写为 N/A。
 *
 * 本文件由 build.py 注入主 <script>，与主体共享词法作用域。
 * ================================================================== */
(function () {
  'use strict';

  var NA = 'N/A';
  window.NasDeck_NA = function (v) {
    return (v === null || v === undefined || v === '' || v === '—' || v === '-' || v === 'null') ? NA : v;
  };

  /* ------------------------------------------------------------------
   * 1) 源头清空：所有演示数据源
   * ---------------------------------------------------------------- */
  function purgeDemoSources() {
    /* 这些数组在主体里是 const/let，统一用 length=0 清空，避免赋值失败。
       逐个 try：某个变量若不存在也不影响其余清理。 */
    var groups = [
      function () { return [BIN, NOTIS, LOGS, CONTAINERS, DLS, SNAPS, DISKS]; },
      function () { return [HBS_JOBS, FW_RULES, FS_TREE]; },
      function () { return [STORE_APPS, FAQS, TERM_LINES, TERM_HIST]; }
    ];
    for (var g = 0; g < groups.length; g++) {
      var arr;
      try { arr = groups[g](); } catch (e) { continue; }
      for (var i = 0; i < arr.length; i++) {
        try { if (arr[i] && typeof arr[i].length === 'number') arr[i].length = 0; } catch (e) {}
      }
    }
    /* 媒体数组不能清空成 0：原渲染会直接读 SONGS[i].al / PHOTOS[i].sky。
       放一个字段完整的 N/A 占位（不是假数据），真实媒体存在时 hydrate 会覆盖它。 */
    try { PHOTOS.length = 0; PHOTOS.push({ n: 'N/A', pl: 'N/A', d: 'N/A', sky: ['#1b2b3a', '#243447'], land: '#22303f', el: '#8fa8bd', k: 0 }); } catch (e) {}
    try { SONGS.length = 0; SONGS.push({ t: 'N/A', a: 'N/A', al: 'N/A', dur: 0 }); } catch (e) {}
    try { MOVIES.length = 0; MOVIES.push({ t: 'N/A', y: 'N/A', g: 'N/A', dur: 'N/A', c: ['#1b2b3a', '#243447'] }); } catch (e) {}
    try { MU.i = 0; MU.playing = false; MU.pos = 0; } catch (e) {}
    try { PH.cur = 0; if (PH.fav && PH.fav.clear) PH.fav.clear(); } catch (e) {}
    try { Object.keys(FS).forEach(function (k) { delete FS[k]; }); } catch (e) {}
    try {
      METRIC.cpu.length = 0; METRIC.mem.length = 0;
      METRIC.net.length = 0; METRIC.disk.length = 0;
    } catch (e) {}
    try {
      CUR.cpu = 0; CUR.mem = 0; CUR.net = 0; CUR.disk = 0;
      CUR.temp = null; CUR.down = 0; CUR.up = 0;
    } catch (e) {}
    /* 演示开关：无真实来源时全部关闭，避免伪造「已启用」状态 */
    try { CP.sleep = 0; CP.https = 0; CP.fw = 0; CP.ssh = 0; CP.ntp = 0; CP.jumbo = 0; } catch (e) {}
    try { FW.on = 0; FW.geo = 0; FW.ddos = 0; FW.notify = 0; } catch (e) {}
    try { CLOUD.link = 0; CLOUD.ddns = 0; CLOUD.upnp = 0; CLOUD.https = 0; } catch (e) {}
    try { NET.vs = 0; NET.vlan = 0; NET.dhcp = 0; NET.jumbo = 0; } catch (e) {}
    window.__NasDeck_TRUTH_PURGED__ = true;
  }

  /* ------------------------------------------------------------------
   * 2) DOM 哨兵：把任何残留的假值改写为 N/A
   *    只匹配「不可能来自真实物理机」的演示标识，避免误伤真实读数
   * ---------------------------------------------------------------- */
  var FAKE_RULES = [
    [/\bWindows 本机\b/g, NA], [/\bLOCAL-NAS\b/g, NA], [/QN-2025-LocalNAS-\d+/g, NA],
    [/Intel Celeron N5105[^\n<]{0,40}/g, NA], [/\bN5105\b/g, NA],
    [/\b16 GB DDR4(?: SO-DIMM)?\b/g, NA], [/\b16\.0 GiB\b/g, NA],
    [/\b4 核心\b/g, NA], [/Intel UHD Graphics 24EU/g, NA],
    [/\b8\.0 TB\b/g, NA], [/\b21\.8 TB\b/g, NA], [/\b21\.8T\b/g, NA],
    [/\b18\.4(?: TB|\b)/g, NA], [/\b18\.4T\b/g, NA], [/\b3\.4 TB\b/g, NA],
    [/\b32 TB\b/g, NA], [/ST8000VN[\w-]*/g, NA], [/\bDataVol1\b/g, NA],
    [/\bRAID 5\b/g, NA], [/1,120 RPM/g, NA], [/2\.5GbE \(Intel i225-V\)/g, NA],
    [/4 × SATA 6Gb\/s \(3\.5"\/2\.5"\)/g, NA], [/2 × PCIe Gen3 x2 NVMe/g, NA],
    [/4 GB DOM/g, NA], [/NasDeck 6\.1\.0 build 20261105/g, NA],
    [/Linux 5\.10\.60(?:-local)?/g, NA], [/26 天 14 小时(?: 03 分)?/g, NA],
    [/26 days, 14 hours/g, NA], [/26 days, 14:03/g, NA],
    [/jellyfin\/jellyfin:10\.9/g, NA], [/portainer\/portainer-ce:2\.20/g, NA],
    [/mariadb:11\.4/g, NA], [/photodeck-index/g, NA], [/hbs3-agent/g, NA],
    [/NasDeck_6\.1\.0_build20261105\.zip/g, NA],
    [/192\.168\.1\.88/g, NA], [/24:5e:be:11:0a:88/g, NA],
    [/本作品为界面演示。?/g, '未连接后端 · 数据 N/A'],
    [/本页面为 NasDeck NasDeck Web 界面演示，所有硬件数据均为模拟数据。?/g, '所有硬件数据均由本机 Windows 实时采集；读取不到的项目显示 N/A。'],
    [/所有硬件数据均为模拟数据/g, '所有硬件数据均为真实采集或 N/A'],
    [/NasDeck Web 界面演示/g, 'NasDeck Web · Windows 本机'],
    [/演示环境可任意填写/g, '默认 admin / admin'],
    [/演示环境/g, '本机环境'], [/均为模拟数据/g, '均为真实采集或 N/A'],
    [/均为模拟/g, '均为真实采集或 N/A'], [/模拟数据/g, '真实采集或 N/A']
  ];

  function scrubText(root) {
    var w, n, p, v, o, i, hits = [];
    try {
      w = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null);
    } catch (e) { return 0; }
    while (w.nextNode()) {
      n = w.currentNode; p = n.parentElement;
      if (!p) continue;
      var tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'INPUT' ||
          tag === 'TEXTAREA' || tag === 'OPTION' || p.isContentEditable) continue;
      v = n.nodeValue;
      if (!v) continue;
      o = v;
      /* 独立的占位符「—」→ N/A（不误伤句子中的破折号） */
      if (v.trim() === '—' || v.trim() === '-') v = NA;
      for (i = 0; i < FAKE_RULES.length; i++) v = v.replace(FAKE_RULES[i][0], FAKE_RULES[i][1]);
      if (v !== o) hits.push([n, v]);
    }
    for (i = 0; i < hits.length; i++) {
      try { hits[i][0].nodeValue = hits[i][1]; } catch (e) {}
    }
    return hits.length;
  }

  var mo = null, busy = false, pending = null;
  function runScrub() {
    if (busy) return;
    busy = true;
    try { if (mo) mo.disconnect(); scrubText(document.body); }
    catch (e) {}
    finally {
      busy = false;
      try { if (mo) mo.observe(document.documentElement, OBS_OPT); } catch (e) {}
    }
  }
  var OBS_OPT = { childList: true, subtree: true, characterData: true };
  function scheduleScrub() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; runScrub(); }, 24);
  }
  function installSentinel() {
    try {
      mo = new MutationObserver(function () { if (!busy) scheduleScrub(); });
      mo.observe(document.documentElement, OBS_OPT);
    } catch (e) {}
    setInterval(runScrub, 1500);
    runScrub();
  }

  /* ------------------------------------------------------------------
   * 3) 顶栏网速：用真实 latest，否则 N/A
   * ---------------------------------------------------------------- */
  function patchClock() {
    var orig = tick;
    tick = function () {
      orig();
      var n = document.querySelector('#tb-net');
      if (!n) return;
      var L = window.NasDeck && NasDeck.latest;
      if (window.NasDeck && NasDeck.mode === 'live' && L &&
          (Number(L.down) || Number(L.up))) {
        n.innerHTML = glyph('lan', 13, 'var(--muted)') + '<span>↓ <b>' +
          (Number(L.down) || 0).toFixed(2) + '</b> MB/s &nbsp; ↑ ' +
          (Number(L.up) || 0).toFixed(2) + ' MB/s</span>';
      } else {
        n.innerHTML = glyph('lan', 13, 'var(--muted)') +
          '<span>网络吞吐 <b>' + NA + '</b></span>';
      }
    };
  }

  /* ------------------------------------------------------------------
   * 4) 离线 N/A 状态页
   * ---------------------------------------------------------------- */
  function showOfflineNA() {
    if (document.getElementById('nasdeck-na-screen')) return;
    var fields = [
      ['CPU 型号', '需要本机 CIM 采集'],
      ['CPU 使用率 / 温度', '需要本机性能计数器与传感器'],
      ['内存容量 / 占用', '需要本机 CIM 采集'],
      ['物理磁盘 / 存储容量', '需要本机 Get-PhysicalDisk / 卷'],
      ['风扇转速 / 硬盘温度', '需要驱动级传感器（未暴露则保持 N/A）'],
      ['服务 / 防火墙 / 事件日志', '需要本机管理权限与 WMI'],
      ['WSL 发行版 / Docker 容器', '需要 WSL2 与 Docker Engine']
    ];
    var rows = fields.map(function (f) {
      return '<div style="display:flex;gap:16px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.07)">' +
        '<span style="flex:1;min-width:0;color:#a9bdd0;font-size:12.5px">' + f[0] + '</span>' +
        '<span style="width:88px;text-align:center;color:#ffcf6b;font-family:Consolas,monospace;font-size:12.5px;font-weight:700">N/A</span>' +
        '<span style="flex:1.2;min-width:0;color:#6f869a;font-size:11px">' + f[1] + '</span></div>';
    }).join('');
    var d = document.createElement('div');
    d.id = 'nasdeck-na-screen';
    d.style.cssText = 'position:fixed;inset:0;z-index:999999;background:linear-gradient(145deg,#071321,#0d2033 60%,#0a1826);' +
      'color:#e8f3fb;font-family:"Segoe UI","Microsoft YaHei",sans-serif;overflow:auto;padding:38px 20px';
    d.innerHTML =
      '<div style="max-width:760px;margin:0 auto">' +
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">' +
      '<div style="width:42px;height:42px;border-radius:12px;background:#153b5c;display:grid;place-items:center;font-size:22px">🖥</div>' +
      '<div><div style="font-size:20px;font-weight:700;letter-spacing:.3px">未连接 Windows 本机后端</div>' +
      '<div style="font-size:12.5px;color:#8fa8bd;margin-top:3px">NasDeck Web Desktop · 真实性模式</div></div></div>' +
      '<p style="font-size:13px;line-height:1.8;color:#b9cbda;margin:18px 0 20px">' +
      '本项目的所有硬件、存储、监测、服务与容器数据都必须由运行在这台物理机上的后端实时采集。' +
      '当前没有检测到后端，因此<b style="color:#ffcf6b">不显示任何非真实值</b>，全部字段按你的要求标为 <b style="color:#ffcf6b">N/A</b>。</p>' +
      '<div style="background:rgba(12,28,44,.85);border:1px solid rgba(90,160,210,.22);border-radius:12px;padding:8px 18px 14px">' +
      '<div style="display:flex;gap:16px;padding:8px 0;color:#6f869a;font-size:11px;border-bottom:1px solid rgba(255,255,255,.1)">' +
      '<span style="flex:1">监测项目</span><span style="width:88px;text-align:center">读数</span><span style="flex:1.2">数据来源</span></div>' + rows + '</div>' +
      '<div style="margin-top:20px;background:rgba(20,52,78,.5);border-left:3px solid #2f9bd6;border-radius:6px;padding:14px 16px">' +
      '<div style="font-size:13px;font-weight:700;margin-bottom:8px">如何获得真实数据</div>' +
      '<div style="font-size:12.5px;line-height:1.9;color:#b9cbda">' +
      '1. 在项目目录双击 <span style="font-family:Consolas,monospace;color:#7fd0ff">start.bat</span>（会自动请求管理员权限，用于服务/防火墙等管理功能）<br>' +
      '2. 浏览器打开 <span style="font-family:Consolas,monospace;color:#7fd0ff">http://127.0.0.1:5080/</span>，登录 admin / admin<br>' +
      '3. 后端会自动采集 CPU、内存、物理磁盘、卷、网卡、服务、事件日志等真实数据；传感器读不到时显示 N/A<br>' +
      '4. 需要使用 WSL 子系统与 Docker：在 容器工作台 点「启动 WSL 内 dockerd」，或运行 <span style="font-family:Consolas,monospace;color:#7fd0ff">start-wsl-docker.bat</span></div></div>' +
      '<div style="display:flex;gap:10px;margin-top:22px;flex-wrap:wrap">' +
      '<button id="nasdeck-na-retry" style="padding:10px 20px;border:0;border-radius:8px;background:#1a7fc1;color:#fff;font-size:13px;font-weight:600;cursor:pointer">重新连接后端</button>' +
      '<button id="nasdeck-na-api" style="padding:10px 20px;border:1px solid rgba(120,180,220,.4);border-radius:8px;background:transparent;color:#b9cbda;font-size:13px;cursor:pointer">直接打开 http://127.0.0.1:5080/</button>' +
      '</div>' +
      '<div style="margin-top:18px;font-size:11px;color:#5f778c">直接以 file:// 打开 index.html 不会有后端；请务必通过后端提供的 HTTP 地址访问。</div>' +
      '</div>';
    document.body.appendChild(d);
    var r = document.getElementById('nasdeck-na-retry');
    if (r) r.onclick = function () { location.reload(); };
    var a = document.getElementById('nasdeck-na-api');
    if (a) a.onclick = function () { location.href = 'http://127.0.0.1:5080/'; };
  }

  /* ------------------------------------------------------------------
   * 5) 安装守卫：包装 install / BOOT，装哨兵
   * ---------------------------------------------------------------- */
  function installGuard() {
    var origInstall = NasDeck.install;
    NasDeck.install = function () {
      purgeDemoSources();
      return origInstall.apply(this, arguments);
    };
    patchClock();
    installSentinel();
    window.__NasDeck_TRUTH__ = { purge: purgeDemoSources, scrub: runScrub, offline: showOfflineNA, NA: NA };

    /* 关键修复：页面加载「立即」清空 demo 数据源。
       原来 purgeDemoSources() 只在 NasDeck.install() 里执行，而 install() 仅在
       登录成功后才调用 —— 残留 token / bootstrap 失败 / demo 登录都会让
       整套假数据（假 CPU、ST8000VN 硬盘、5 个假容器）重新显示出来。
       此时 NasDeck_BOOT 尚未执行、hydrate 尚未回填，清空是安全的。 */
    try { purgeDemoSources(); } catch (e) {}
  }

  installGuard();

  var origBoot = NasDeck_BOOT;
  NasDeck_BOOT = async function () {
    await origBoot();

    /* 关键修复：无论登录是否成功，都确保 Windows 真实界面层已安装。
       原 NasDeck_WIN_INSTALL() 只在 NasDeck.install() 内被调用（登录成功后），
       未登录 / 自动登录失败时 20 个 App 会全部回落到 demo 渲染。 */
    try { if (typeof NasDeck_WIN_INSTALL === 'function') NasDeck_WIN_INSTALL(); } catch (e) {}

    runScrub();
    if (NasDeck.mode !== 'live') showOfflineNA();
  };
})();
//__NasDeck_TRUTH_END__
