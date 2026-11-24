//__NasDeck_BOOT_START__
/* ==================================================================
 * nasdeck-boot.src.js — 系统启动中心（分级启动可视化）
 * 由 build.py 最后注入主 <script>，与主体共享词法作用域。
 *
 * 对应后端 lib/boot.js + /api/boot/status：
 *  - 桌面新增「系统启动中心」App，展示每个阶段的状态 / 子步骤 / 耗时 /
 *    日志，可跳过、重跑阶段，可手动启动按需功能；
 *  - 右下角常驻启动进度胶囊，未全部就绪时显示实时百分比，点击直达面板；
 *  - 启动屏（由 build.py 注入的内联脚本驱动）与本层共用同一份状态。
 * 无任何模拟数据：后端不可达时显示 N/A 与重试提示。
 * ================================================================== */
(function () {
  'use strict';

  var BC = window.NasDeck_BOOT_CENTER = {
    state: null, lastSig: '', timer: null, badge: null, style: false
  };

  function E(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function n(v, d) { var x = Number(v); return isFinite(x) ? x : (d || 0); }
  function ms(v) { if (!v) return '—'; return v < 1000 ? v + 'ms' : (v / 1000).toFixed(1) + 's'; }
  function el(id) { return document.getElementById(id); }
  function toastSafe(t, m, k) { try { if (typeof toast === 'function') toast(t, m, k); } catch (e) {} }

  var ST = {
    pending:  { t: '等待', c: '#6e8ba5', g: '○' },
    running:  { t: '进行中', c: '#22a7e8', g: '◐' },
    done:     { t: '已完成', c: '#35c88a', g: '✓' },
    warn:     { t: '降级', c: '#f4aa48', g: '!' },
    timeout:  { t: '后台继续', c: '#f4aa48', g: '⏱' },
    skipped:  { t: '已跳过', c: '#8aa2b8', g: '↷' },
    error:    { t: '异常', c: '#ea6a6a', g: '✕' }
  };
  function st(k) { return ST[k] || ST.pending; }

  /* ---------------- 样式（只注入一次） ---------------- */
  function installStyle() {
    if (BC.style) return;
    BC.style = true;
    var css = [
      '.bc-wrap{padding:16px 18px;color:var(--txt,#dce9f5);font-size:12px;line-height:1.55;overflow:auto;height:100%;box-sizing:border-box}',
      '.bc-hero{display:flex;gap:18px;align-items:center;justify-content:space-between;background:linear-gradient(100deg,rgba(20,58,88,.62),rgba(10,28,44,.32));border:1px solid rgba(80,160,210,.22);border-radius:12px;padding:14px 18px}',
      '.bc-kicker{font-size:10.5px;letter-spacing:.18em;color:#66b6e0;text-transform:uppercase}',
      '.bc-hero h2{margin:4px 0 6px;font-size:19px;font-weight:600;letter-spacing:.03em}',
      '.bc-hero p{margin:0;font-size:11.5px;color:#8ba8bf;max-width:620px}',
      '.bc-hero-r{text-align:right;min-width:118px}',
      '.bc-pct{font-size:30px;font-weight:700;color:#4fd0ee;line-height:1.1;letter-spacing:-.02em}',
      '.bc-phase{font-size:11px;color:#93b2c8;margin-top:3px}',
      '.bc-bar{height:7px;border-radius:7px;background:rgba(255,255,255,.08);overflow:hidden;margin:14px 0 6px}',
      '.bc-bar i{display:block;height:100%;border-radius:7px;background:linear-gradient(90deg,#00a3e0,#00e0c0);transition:width .4s ease}',
      '.bc-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:#7f9db4;margin-bottom:12px}',
      '.bc-meta b{color:#cfe4f5;font-weight:600}',
      '.bc-safety{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}',
      '.bc-chip{font-size:10.5px;padding:3px 9px;border-radius:999px;border:1px solid rgba(53,200,138,.35);color:#7fe0b0;background:rgba(53,200,138,.08)}',
      '.bc-cols{display:grid;grid-template-columns:1.18fr .82fr;gap:14px;align-items:start}',
      '@media(max-width:760px){.bc-cols{grid-template-columns:1fr}}',
      '.bc-card{background:rgba(10,24,38,.62);border:1px solid rgba(120,170,210,.16);border-radius:11px;padding:10px 12px}',
      '.bc-card h3{margin:0 0 9px;font-size:12.5px;font-weight:600;color:#d7ecfa;display:flex;justify-content:space-between;align-items:center}',
      '.bc-card h3 small{font-weight:400;color:#7f9db4;font-size:10.5px}',
      '.bc-stage{display:flex;gap:10px;align-items:flex-start;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.055)}',
      '.bc-stage:last-child{border-bottom:0}',
      '.bc-dot{flex:0 0 19px;width:19px;height:19px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;background:rgba(255,255,255,.06)}',
      '.bc-stage-main{flex:1;min-width:0}',
      '.bc-stage-t{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}',
      '.bc-stage-t b{font-size:12px;font-weight:600;color:#e2f1fc}',
      '.bc-tag{font-size:9.5px;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,.07);color:#8ba8bf}',
      '.bc-stage-d{font-size:10.5px;color:#8ba8bf;margin-top:2px;word-break:break-all}',
      '.bc-stage-msg{font-size:10.5px;color:#b6d2e6;margin-top:3px;word-break:break-all}',
      '.bc-stage-r{text-align:right;min-width:74px;font-size:10.5px;color:#7f9db4}',
      '.bc-stage-r .bc-time{display:block;color:#9fbdd2}',
      '.bc-btn{border:1px solid rgba(120,180,220,.32);background:rgba(34,167,232,.12);color:#cfe9fa;border-radius:6px;padding:3px 9px;font-size:10.5px;cursor:pointer;font-family:inherit;margin-left:4px}',
      '.bc-btn:hover{background:rgba(34,167,232,.26)}',
      '.bc-btn:disabled{opacity:.4;cursor:default}',
      '.bc-od{display:flex;gap:9px;align-items:flex-start;padding:7px 2px;border-bottom:1px solid rgba(255,255,255,.05)}',
      '.bc-od:last-child{border-bottom:0}',
      '.bc-od-main{flex:1;min-width:0}',
      '.bc-od-main b{font-size:11.5px;color:#e2f1fc;font-weight:600}',
      '.bc-od-main p{margin:2px 0 0;font-size:10px;color:#819fb6;line-height:1.45}',
      '.bc-log{font:10.5px/1.5 Consolas,Monaco,monospace;max-height:210px;overflow:auto;color:#9fc0d6;white-space:pre-wrap;word-break:break-all}',
      '.bc-log div{padding:1px 0;border-bottom:1px solid rgba(255,255,255,.035)}',
      '.bc-log .lv-ERR,.bc-log .lv-WARN{color:#f4b26a}',
      '.bc-log .lv-INFO{color:#8fb6cf}',
      '.bc-log em{font-style:normal;color:#5f829b;margin-right:6px}',
      '.bc-empty{color:#6e8ba5;font-size:11px;padding:10px 2px}',
      '#bc-pill{position:fixed;right:14px;bottom:46px;z-index:2147482000;padding:6px 12px;border-radius:999px;font-size:11px;color:#eaf6ff;background:rgba(12,26,40,.9);border:1px solid rgba(34,167,232,.45);box-shadow:0 3px 14px rgba(0,0,0,.35);cursor:pointer;user-select:none;font-family:inherit}',
      '#bc-pill .bc-pill-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;background:#22a7e8;box-shadow:0 0 6px #22a7e8}'
    ].join('\n');
    try {
      var s = document.createElement('style');
      s.id = 'nasdeck-boot-center-css';
      s.textContent = css;
      (document.head || document.body).appendChild(s);
    } catch (e) {}
  }

  /* ---------------- 注册应用 ---------------- */
  function installApp() {
    try {
      if (typeof APPS === 'object' && APPS) {
        APPS.sysboot = {
          name: '系统启动中心', en: 'Boot Center', cat: '系统', icon: 'activity',
          g1: '#2aa7d8', g2: '#0d5c92', w: 980, h: 690,
          desc: '分级启动进度、环境检查、按需功能', desk: 1, pin: 1
        };
      }
      if (typeof APPS_INSTALLED === 'object' && APPS_INSTALLED) APPS_INSTALLED.sysboot = 1;
    } catch (e) {}
    /* hydrate 会 obj() 清空 APPS_INSTALLED，登录后再补一次 */
    try {
      if (window.NasDeck && !NasDeck.__bootLayer) {
        NasDeck.__bootLayer = true;
        var _h = NasDeck.hydrate;
        NasDeck.hydrate = function () {
          var r = _h.apply(this, arguments);
          try { if (typeof APPS_INSTALLED === 'object' && APPS_INSTALLED) APPS_INSTALLED.sysboot = 1; } catch (e) {}
          try { if (typeof APPS === 'object' && APPS && !APPS.sysboot) APPS.sysboot = { name: '系统启动中心', en: 'Boot Center', cat: '系统', icon: 'activity', g1: '#2aa7d8', g2: '#0d5c92', w: 980, h: 690, desc: '分级启动进度', desk: 1, pin: 1 }; } catch (e) {}
          return r;
        };
      }
    } catch (e) {}
  }

  /* ---------------- 取状态 ---------------- */
  function sig(s) {
    if (!s) return 'null';
    return [s.phase, s.overall, s.coreReady, s.finished,
      (s.stages || []).map(function (x) { return x.id + x.status + x.progress + x.message; }).join('|'),
      (s.onDemand || []).map(function (x) { return x.id + x.status; }).join('|'),
      (s.log || []).length].join('~');
  }

  function api(path, body) {
    var opt = { method: body ? 'POST' : 'GET', headers: {} };
    if (body) opt.headers['Content-Type'] = 'application/json';
    try {
      if (window.NasDeck && NasDeck.token) opt.headers['X-NasDeck-Token'] = NasDeck.token;
    } catch (e) {}
    if (body) opt.body = JSON.stringify(body);
    return fetch((window.NasDeck && NasDeck.base ? NasDeck.base : '') + path, opt).then(function (r) {
      return r.json().then(function (j) { if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
    });
  }

  function refresh(force) {
    return api('/api/boot/status').then(function (s) {
      BC.state = s;
      window.NasDeck_BOOT_STATE = s;
      var g = sig(s);
      var changed = g !== BC.lastSig;
      BC.lastSig = g;
      renderPill(s);
      if (changed || force) {
        try {
          if (typeof rerender === 'function' && typeof W === 'function' && W('sysboot')) {
            /* 用户正在窗口内点按钮时不要整窗重绘，否则刚按下的按钮会被
               新 DOM 换掉，点击事件丢失（看起来像按钮没反应）。 */
            var win = W('sysboot');
            var ae = document.activeElement;
            if (force || !(ae && win.el && win.el.contains(ae) && ae !== document.body)) rerender('sysboot');
          }
        } catch (e) {}
      }
      return s;
    }).catch(function (e) {
      BC.state = BC.state || null;
      renderPill(null, e.message);
      return null;
    });
  }

  /* ---------------- 渲染：启动中心 ---------------- */
  function phaseText(s) {
    if (!s) return '后端未连接';
    return ({
      waiting: '等待编排器', booting: '正在逐级启动', 'core-ready': '核心已就绪 · 后台继续',
      ready: '全部就绪', degraded: '系统可用（降级）'
    })[s.phase] || s.phase;
  }

  function renderSysboot() {
    var s = BC.state;
    var stages = s && s.stages || [];
    var od = s && s.onDemand || [];
    var logs = (s && s.log || []).slice(-40).reverse();
    var pct = s ? n(s.overall) : 0;
    var h = '';

    h += '<div class="bc-wrap">';
    h += '<div class="bc-hero"><div class="bc-hero-l">' +
      '<div class="bc-kicker">NasDeck WinNAS · Staged Startup</div>' +
      '<h2>系统启动中心</h2>' +
      '<p>后端启动后先撑起前端面板，再检查运行环境，随后按顺序逐级启动内部功能。' +
      '核心三阶段就绪即可进入系统；重功能默认按需启动，避免一次性打满本机资源。</p>' +
      '</div><div class="bc-hero-r">' +
      '<div class="bc-pct">' + (s ? pct.toFixed(1) : 'N/A') + '%</div>' +
      '<div class="bc-phase">' + E(phaseText(s)) + '</div>' +
      '</div></div>';

    h += '<div class="bc-bar"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>';
    h += '<div class="bc-meta">' +
      '<span>阶段 <b>' + (s ? s.counts.done : 0) + ' / ' + (s ? s.counts.total : 'N/A') + '</b> 完成</span>' +
      '<span>核心能力 <b>' + (s && s.coreReady ? '已就绪' : '未就绪') + '</b></span>' +
      '<span>已耗时 <b>' + (s ? ms(s.elapsed) : 'N/A') + '</b></span>' +
      '<span>后端 <b>' + (s && s.server ? E(s.server.node) + ' · ' + s.server.rssMB + 'MB' : 'N/A') + '</b></span>' +
      '<span>启动方式 <b>串行 · 分阶段</b></span>' +
      '</div>';

    h += '<div class="bc-safety">' +
      '<span class="bc-chip">环境与数据阶段只读校验</span>' +
      '<span class="bc-chip">不改写 / 不删除既有数据</span>' +
      '<span class="bc-chip">单阶段失败不阻断</span>' +
      '<span class="bc-chip">重功能按需启动</span>' +
      '<button class="bc-btn" data-act="boot-refresh">刷新状态</button>' +
      '</div>';

    h += '<div class="bc-cols"><div class="bc-card"><h3>启动阶段 <small>按顺序串行执行 · 阶段之间让出系统资源</small></h3>';
    if (!stages.length) h += '<div class="bc-empty">尚未取得后端启动状态（N/A）。请确认后端已启动，或点击「刷新状态」。</div>';
    stages.forEach(function (x, i) {
      var k = st(x.status);
      var canAct = (x.status === 'pending' || x.status === 'running');
      h += '<div class="bc-stage">' +
        '<div class="bc-dot" style="color:' + k.c + ';border:1px solid ' + k.c + '55">' + k.g + '</div>' +
        '<div class="bc-stage-main">' +
        '<div class="bc-stage-t"><b>' + (i + 1) + '. ' + E(x.name) + '</b>' +
        '<span class="bc-tag">' + E(x.group) + '</span>' +
        (x.core ? '<span class="bc-tag" style="color:#7fe0b0">核心</span>' : '') +
        '<span style="font-size:10.5px;color:' + k.c + '">' + E(k.t) + '</span></div>' +
        '<div class="bc-stage-d">' + E(x.desc) + '</div>' +
        (x.message ? '<div class="bc-stage-msg">→ ' + E(x.message) + '</div>' : '') +
        (x.detail && x.status === 'running' ? '<div class="bc-stage-d">当前：' + E(x.detail) + ' · ' + n(x.progress) + '%</div>' : '') +
        '</div><div class="bc-stage-r">' +
        '<span class="bc-time">' + (x.ms ? ms(x.ms) : '—') + '</span>' +
        (canAct ? '<button class="bc-btn" data-act="boot-skip" data-id="' + E(x.id) + '">跳过</button>' : '') +
        (!canAct && x.status !== 'done' ? '<button class="bc-btn" data-act="boot-retry" data-id="' + E(x.id) + '">重跑</button>' : '') +
        '</div></div>';
    });
    h += '</div>';

    h += '<div class="bc-side">';
    h += '<div class="bc-card" style="margin-bottom:14px"><h3>按需功能 <small>开机不自动运行</small></h3>';
    if (!od.length) h += '<div class="bc-empty">N/A</div>';
    od.forEach(function (x) {
      var busy = x.status === 'running';
      h += '<div class="bc-od"><div class="bc-od-main"><b>' + E(x.name) + '</b>' +
        '<p>' + E(x.desc) + ' · 预计 ' + E(x.cost) + '</p>' +
        (x.message ? '<p style="color:#b6d2e6">→ ' + E(x.message) + '</p>' : '') +
        '</div><button class="bc-btn" data-act="boot-start" data-id="' + E(x.id) + '"' + (busy ? ' disabled' : '') + '>' +
        (busy ? '启动中' : (x.status === 'done' ? '再启动' : '启动')) + '</button></div>';
    });
    h += '</div>';

    h += '<div class="bc-card"><h3>启动日志 <small>最近 ' + logs.length + ' 条 · 真实事件</small></h3><div class="bc-log">';
    if (!logs.length) h += '<div class="bc-empty">N/A</div>';
    logs.forEach(function (l) {
      var t = String(l.t || '').slice(11, 19);
      h += '<div class="lv-' + E(l.level) + '"><em>' + E(t) + ' [' + E(l.stage) + ']</em>' + E(l.msg) + '</div>';
    });
    h += '</div></div></div></div></div>';
    return h;
  }

  /* ---------------- 渲染：桌面进度胶囊 ---------------- */
  function renderPill(s, err) {
    try {
      if (!document.body) return;
      var d = el('bc-pill');
      if (!d) {
        d = document.createElement('div');
        d.id = 'bc-pill';
        d.onclick = function () { try { if (typeof openApp === 'function') openApp('sysboot'); } catch (e) {} };
        document.body.appendChild(d);
        BC.badge = d;
      }
      /* 启动屏期间 / 未登录时不抢视觉焦点；进入桌面后才显示进度胶囊 */
      var bootEl = el('boot');
      var onBoot = bootEl && !bootEl.classList.contains('hidden');
      var logged = true;
      try { logged = !(typeof S === 'object' && S && S.logged === false); } catch (e) {}
      if (onBoot || !logged) { d.style.display = 'none'; return; }
      d.style.display = '';
      var done = !!s && !!s.finished;
      var txt = s
        ? (done ? '启动完成 ' + n(s.overall).toFixed(0) + '% · 查看' : '系统启动中 ' + n(s.overall).toFixed(0) + '% · ' + E(phaseText(s)) + ' · 查看')
        : ('启动状态 N/A' + (err ? ' · ' + E(err) : ' · 等待后端'));
      d.innerHTML = '<span class="bc-pill-dot" style="background:' + (done ? '#35c88a' : (s ? '#22a7e8' : '#f4aa48')) + '"></span>' + txt;
    } catch (e) {}
  }

  /* ---------------- 动作 ---------------- */
  function needLogin() {
    var has = !!(window.NasDeck && NasDeck.token);
    if (!has) toastSafe('需要登录', '请先登录本机管理台再操作启动阶段。', 'warn');
    return has;
  }
  function act(name, body, okMsg) {
    return api(name, body).then(function (r) {
      toastSafe('操作成功', okMsg || r.message || '已完成', 'ok');
      return refresh(true);
    }).catch(function (e) { toastSafe('操作失败', e.message, 'err'); });
  }
  function installActions() {
    try {
      if (typeof ACT !== 'object' || !ACT) return;
      ACT['boot-refresh'] = function () { refresh(true).then(function (s) { toastSafe('已刷新', s ? '启动状态已更新' : '后端未连接', s ? 'ok' : 'warn'); }); };
      ACT['boot-skip'] = function (t, d) { if (!needLogin()) return; act('/api/boot/skip', { id: d.id }, '已请求跳过该阶段'); };
      ACT['boot-retry'] = function (t, d) { if (!needLogin()) return; act('/api/boot/retry', { id: d.id }, '阶段已重新执行'); };
      ACT['boot-start'] = function (t, d) { if (!needLogin()) return; act('/api/boot/start', { id: d.id }, '按需功能已执行'); };
      ACT['boot-open'] = function () { try { if (typeof openApp === 'function') openApp('sysboot'); } catch (e) {} };
    } catch (e) {}
  }

  /* ---------------- 安装 ----------------
     注册 App / 动作 / 渲染器必须「立即」执行：nasdeckInit() 里的 renderDeskIcons()
     在同一份 script 末尾就会跑，等 DOMContentLoaded 就来不及把桌面图标加进去。
     只有依赖 DOM 的样式与胶囊才延后到 DOMContentLoaded。 */
  installApp();
  installActions();
  try { if (typeof RENDER === 'object' && RENDER) RENDER.sysboot = renderSysboot; } catch (e) {}

  function installDom() {
    installStyle();
    renderPill(null);
    refresh();
    if (!BC.timer) BC.timer = setInterval(refresh, 1500);
    /* 多层渲染覆盖可能把 RENDER.sysboot / APPS.sysboot 抹掉，低频守卫确保面板始终可用 */
    setInterval(function () {
      try { if (typeof RENDER === 'object' && RENDER && RENDER.sysboot !== renderSysboot) RENDER.sysboot = renderSysboot; } catch (e) {}
      try { if (typeof APPS === 'object' && APPS && !APPS.sysboot) APPS.sysboot = { name: '系统启动中心', en: 'Boot Center', cat: '系统', icon: 'activity', g1: '#2aa7d8', g2: '#0d5c92', w: 980, h: 690, desc: '分级启动进度', desk: 1, pin: 1 }; } catch (e) {}
    }, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installDom);
  else installDom();
})();
//__NasDeck_BOOT_END__
