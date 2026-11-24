//__NasDeck_V15_START__
/* ==========================================================================
 * nasdeck-v15.src.js —— NasDeck v15 前端总控层（零第三方依赖）
 *
 * 由 build.py 在 winnas 之后、boot 之前注入主 <script>，与主体共享词法作用域。
 * 本层只提供「能力」，不替换任何 RENDER 函数 —— real 层的 enforceAll() 每
 * 1.5s 会把 RENDER.container / RENDER.appcenter 还原成它自己的函数，替换必被打回。
 * 界面改造通过两个途径落地：
 *   ① 精确补丁修改 real / winnas 的 src 函数本体（还原的仍是改过的函数）；
 *   ② 本层导出渲染片段 + ACT 动作 + 独立守卫，供函数体调用。
 *
 * 覆盖 v15 的 11 项需求：
 *   1  镜像仓库添加 / 登录 / 登出 / 测试 / 删除
 *   2  容器镜像更新自动检测 + 可点击「有更新」标签 + 一键更新
 *   3  容器「重构」：读取 inspect 配置 → 可编辑表单 → 备份旧容器后重建
 *   4  文件总管去掉顶部两个按钮，改用底部固定的「目录树 / 分享链接」切换
 *   6  文件预览与编辑：文本编码不乱码、媒体播放、Office 内置在线文档查看
 *   7  分享链接「是否加密访问」开关
 *   8  本机存储空间 + 分享链接按钮固定在窗口最下面
 *   9  工具条按钮放不下时合并为一个「更多」下拉
 *   10 媒体播放页重做（音频酷狗式 / 视频腾讯视频式）
 *   11 App Center 每个插件独立彩色图标，应用商店式卡片
 *
 * 数据安全：所有失败如实回传，不把 N/A 包装成成功；模态窗挂 document.body，
 * 不会被 6s 状态重绘或 rerender() 连 .win-body 一起删掉。
 * ======================================================================== */
(function () {
  'use strict';

  var V = window.NasDeck_V15 = {
    S: {
      regs: [], regsLoaded: false, regsBusy: false, regMsg: '',
      upd: [], updMap: {}, updAt: 0, updBusy: false, updMsg: '',
      preview: null, previewBusy: false,
      shareEncrypted: false, sharePassword: '',
      moreOpen: false, fitAt: 0, lastFitSig: '',
      recreate: null, regLogin: null,
      busy: false, msg: ''
    },
    styleDone: false, actDone: false, seq: 0
  };
  try { NasDeck.v15 = V; } catch (e) {}

  /* ---------------------------------------------------------------- 基础工具 */
  function E(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function G(n, sz, col) {
    try { return glyph(String(n || 'box'), sz || 14, col || 'currentColor'); }
    catch (e) { return '<span style="font-size:' + (sz || 14) + 'px">◻</span>'; }
  }
  function T(t, sub, kind) { try { toast(String(t), String(sub || ''), kind || 'info'); } catch (e) {} }
  function R(id) { try { return rerender(id); } catch (e) {} }
  function WN(id) { try { return W(id); } catch (e) { return null; } }
  function open(id) { try { openApp(id); } catch (e) {} }
  function api(p, b) {
    return b === undefined ? NasDeck.get(p) : NasDeck.post(p, b);
  }
  function err(e) { return (e && (e.message || e.error)) ? String(e.message || e.error) : String(e || '未知错误'); }
  function now() { return Date.now(); }
  function fmtT(ms) {
    if (!ms) return 'N/A';
    try { return new Date(ms).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return String(ms); }
  }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB', 'TB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(n >= 100 ? 0 : 1) + ' ' + u[i];
  }
  function url(p) { try { return NasDeck.withToken(p); } catch (e) { return p; } }
  function copy(v) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(v); return true; } } catch (e) {}
    try {
      var t = document.createElement('textarea'); t.value = v;
      t.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(t); t.select();
      var d = document.execCommand('copy'); t.remove(); return d;
    } catch (e) { return false; }
  }
  V.E = E; V.G = G; V.api = api; V.url = url; V.fmtSize = fmtSize;

  /* ---------------------------------------------------------------- 样式 */
  function style() {
    if (V.styleDone && document.getElementById('nasdeck-v15-style')) return;
    var el = document.getElementById('nasdeck-v15-style');
    if (el) { V.styleDone = true; return; }
    el = document.createElement('style'); el.id = 'nasdeck-v15-style';
    el.textContent = [
      /* ---- 通用模态窗（需求 1/3/6/7 共用） ---- */
      '.v15-mask{position:fixed;inset:0;z-index:2147483000;background:rgba(3,9,17,.66);display:flex;align-items:center;justify-content:center;padding:16px}',
      '.v15-dlg{display:flex;flex-direction:column;background:var(--appbg,#131c28);border:1px solid var(--line2,#2a3a4c);border-radius:12px;',
      ' box-shadow:0 26px 76px rgba(0,0,0,.6);overflow:hidden;max-width:96vw;max-height:92vh}',
      '.v15-hd{flex:none;display:flex;align-items:center;gap:9px;padding:11px 14px;border-bottom:1px solid var(--line,#2a3a4c);',
      ' background:linear-gradient(180deg,var(--panel2,#223042),var(--panel,#182534));font-size:12.5px;font-weight:700}',
      '.v15-hd .sub{font-size:10.5px;font-weight:400;color:var(--muted,#8ba0b6)}',
      '.v15-hd .sp{flex:1}',
      '.v15-x{border:0;background:none;color:inherit;font-size:19px;line-height:1;cursor:pointer;padding:0 3px}',
      '.v15-bd{flex:1;min-height:0;overflow:auto;padding:13px 15px;font-size:11.5px}',
      '.v15-ft{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;',
      ' border-top:1px solid var(--line,#2a3a4c);background:var(--panel,#182534)}',
      '.v15-ft .sp{flex:1}',
      '.v15-row{display:grid;grid-template-columns:132px 1fr;gap:9px 11px;align-items:center;margin-bottom:10px}',
      '.v15-row>label{font-size:11.5px;color:var(--muted,#8ba0b6)}',
      '.v15-inp,.v15-area,.v15-sel{width:100%;box-sizing:border-box;background:var(--bg2,#0f1722);',
      ' border:1px solid var(--line,#2a3a4c);border-radius:6px;padding:7px 9px;',
      ' font:11.5px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:var(--fg,#dbe7f3);outline:none}',
      '.v15-inp:focus,.v15-area:focus{border-color:var(--accent,#22a7e8)}',
      '.v15-area{resize:vertical;min-height:120px;font:12px/1.7 Consolas,"Courier New",monospace;white-space:pre;tab-size:2}',
      '.v15-hint{grid-column:2;font-size:10px;color:var(--dim,#6b8199);margin-top:-5px}',
      '.v15-msg{padding:8px 11px;border-radius:7px;font-size:11px;margin-bottom:10px;',
      ' background:rgba(34,167,232,.09);border:1px solid rgba(34,167,232,.3);white-space:pre-wrap;word-break:break-all}',
      '.v15-msg.err{background:rgba(224,90,90,.1);border-color:rgba(224,90,90,.42);color:#ffb4b4}',
      '.v15-msg.ok{background:rgba(53,200,138,.1);border-color:rgba(53,200,138,.4)}',
      '.v15-pre{background:var(--bg2,#0f1722);border:1px solid var(--line,#2a3a4c);border-radius:7px;padding:10px;',
      ' font:10.5px/1.6 Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:240px;overflow:auto}',
      '.v15-tbl{width:100%;border-collapse:collapse;font-size:11px}',
      '.v15-tbl th{text-align:left;color:var(--muted,#8ba0b6);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line,#2a3a4c)}',
      '.v15-tbl td{padding:7px 8px;border-bottom:1px solid rgba(42,58,76,.5);vertical-align:middle}',
      '.v15-tbl tr:hover td{background:rgba(34,167,232,.05)}',
      '.v15-tag{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:10px;font-size:10px;',
      ' border:1px solid var(--line,#2a3a4c);color:var(--muted,#8ba0b6);white-space:nowrap}',
      '.v15-tag.ok{color:#35c88a;border-color:rgba(53,200,138,.5);background:rgba(53,200,138,.09)}',
      '.v15-tag.warn{color:#f4aa48;border-color:rgba(244,170,72,.5);background:rgba(244,170,72,.09)}',
      '.v15-tag.upd{color:#fff;border-color:#e06a5a;background:#c94f3f;cursor:pointer;font-weight:700}',
      '.v15-tag.upd:hover{filter:brightness(1.15)}',
      '.v15-tag.info{color:var(--accent,#22a7e8);border-color:rgba(34,167,232,.5)}',
      '.v15-sec{font-size:12px;font-weight:700;margin:2px 0 11px;padding-bottom:6px;border-bottom:1px solid var(--line,#2a3a4c)}',
      '.v15-card{border:1px solid var(--line,#2a3a4c);border-radius:9px;padding:11px 12px;background:var(--panel,#182534);margin-bottom:10px}',
      '.v15-switch{display:inline-flex;align-items:center;gap:7px;cursor:pointer;font-size:11.5px;user-select:none}',
      '.v15-switch input{accent-color:var(--accent,#22a7e8);width:15px;height:15px;cursor:pointer}',
      /* ---- 需求 4/8：文件总管底部固定栏 ---- */
      '.v15-fs-dock{flex:none;display:flex;align-items:stretch;gap:10px;padding:7px 11px;',
      ' border-top:1px solid var(--line,#2a3a4c);background:var(--panel,#182534);box-shadow:0 -3px 12px rgba(0,0,0,.12)}',
      '.v15-fs-dock .nav{display:flex;align-items:center;gap:6px;flex:none}',
      '.v15-fs-dock .nav button{border:1px solid var(--line,#2a3a4c);border-radius:7px;padding:7px 12px;',
      ' background:var(--bg2,#0f1722);color:var(--muted,#8ba0b6);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}',
      '.v15-fs-dock .nav button.on{background:rgba(34,167,232,.16);color:var(--accent,#22a7e8);',
      ' border-color:var(--accent,#22a7e8);font-weight:700}',
      '.v15-fs-vol{flex:1;min-width:0;display:flex;gap:9px;overflow-x:auto;align-items:center;padding:2px 0}',
      '.v15-fs-vol .v15-vol-item{flex:none;min-width:118px;max-width:170px;padding:4px 8px;border-radius:6px;',
      ' background:var(--bg2,#0f1722);border:1px solid var(--line,#2a3a4c);font-size:10px;line-height:1.35}',
      '.v15-fs-vol .v15-vol-item b{font-size:10.5px}',
      '.v15-fs-vol .prog{height:4px;border-radius:3px;background:rgba(127,127,127,.25);margin:4px 0 2px;overflow:hidden}',
      '.v15-fs-vol .prog i{display:block;height:100%;background:var(--accent,#22a7e8)}',
      '.v15-fs-vol .prog.warn i{background:#f4aa48}',
      '.v15-fs-conn{flex:none;display:flex;align-items:center;font-size:10px;color:var(--muted,#8ba0b6);white-space:nowrap}',
      /* ---- 需求 9：工具条「更多」下拉 ---- */
      '.v15-toolbar{position:relative}',
      '.v15-more-btn{flex:none;border:1px solid var(--accent,#22a7e8);border-radius:6px;padding:5px 10px;',
      ' background:rgba(34,167,232,.12);color:var(--accent,#22a7e8);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}',
      '.v15-more-btn.on{background:var(--accent,#22a7e8);color:#fff}',
      '.v15-more-menu{position:absolute;right:8px;top:100%;z-index:120;min-width:174px;max-height:290px;overflow:auto;',
      ' padding:6px;border-radius:9px;background:var(--panel,#182534);border:1px solid var(--line2,#2a3a4c);',
      ' box-shadow:0 14px 38px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:2px}',
      '.v15-more-menu[hidden]{display:none}',
      '.v15-more-menu button{display:flex;align-items:center;gap:7px;width:100%;text-align:left;border:0;border-radius:6px;',
      ' padding:7px 9px;background:none;color:inherit;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}',
      '.v15-more-menu button:hover{background:rgba(34,167,232,.15)}',
      '.v15-more-menu button.danger{color:#ff9b9b}',
      /* ---- 需求 6：Office 在线文档查看器 ---- */
      '.v15-office{background:#fff;color:#1a1a1a;border-radius:8px;padding:22px 26px;min-height:220px;',
      ' font:14px/1.8 system-ui,"Microsoft YaHei",sans-serif;overflow:auto}',
      '.v15-office h1,.v15-office h2,.v15-office h3{color:#111;margin:.7em 0 .4em}',
      '.v15-office p{margin:.5em 0}.v15-office img{max-width:100%}',
      '.v15-office table{border-collapse:collapse;width:100%;font-size:12px}',
      '.v15-office td,.v15-office th{border:1px solid #d0d7de;padding:5px 8px}',
      '.v15-office th{background:#f2f5f8;font-weight:600}',
      '.v15-office-bar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 12px;',
      ' border-bottom:1px solid var(--line,#2a3a4c);font-size:11px;color:var(--muted,#8ba0b6)}',
      /* ---- 需求 6：媒体预览 ---- */
      '.v15-media{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:200px;background:#060d15;border-radius:9px;padding:16px}',
      '.v15-media img{max-width:100%;max-height:56vh;object-fit:contain;border-radius:6px}',
      '.v15-media video{max-width:100%;max-height:56vh;background:#000;border-radius:6px}',
      '.v15-media audio{width:100%;max-width:520px}',
      '.v15-media iframe{width:100%;height:56vh;border:0;border-radius:6px;background:#fff}',
      /* ---- 需求 11：应用商店式插件图标 / 卡片 ---- */
      '.v15-picon{border-radius:14px;display:grid;place-items:center;flex:none;color:#fff;',
      ' box-shadow:0 5px 16px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.28);',
      ' border:1px solid rgba(255,255,255,.18);font-weight:800;letter-spacing:.5px;position:relative;overflow:hidden}',
      '.v15-picon:before{content:"";position:absolute;inset:0;background:linear-gradient(150deg,rgba(255,255,255,.28),transparent 58%)}',
      '.v15-picon svg,.v15-picon span{position:relative;z-index:1}',
      '.v15-store{display:grid !important;grid-template-columns:repeat(auto-fill,minmax(216px,1fr));gap:13px}',
      '.v15-pcard{border:1px solid var(--line,#2a3a4c);border-radius:12px;padding:15px 14px;',
      ' background:var(--panel,#182534);display:flex;flex-direction:column;gap:9px;transition:.15s}',
      '.v15-pcard:hover{border-color:var(--accent,#22a7e8);transform:translateY(-2px);box-shadow:0 10px 26px rgba(0,0,0,.28)}',
      '.v15-pcard .top{display:flex;align-items:center;gap:11px}',
      '.v15-pcard .nm{flex:1;min-width:0}',
      '.v15-pcard .nm b{display:block;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.v15-pcard .nm small{display:block;font-size:10px;color:var(--muted,#8ba0b6);margin-top:2px}',
      '.v15-pcard .desc{font-size:10.5px;color:var(--muted,#8ba0b6);line-height:1.55;min-height:32px;margin:0}',
      '.v15-pcard .tags{display:flex;gap:5px;flex-wrap:wrap}',
      '.v15-pcard .ops{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}',
      '.v15-pcard .rate{font-size:10px;color:#f4aa48}',
      /* ---- 需求 10：沉浸式媒体播放页 ---- */
      '.v15-pl{height:100%;display:flex;flex-direction:column;overflow:hidden;color:#e9f2fa;',
      ' background:radial-gradient(1200px 620px at 50% -10%,#16324a 0%,#0a1420 55%,#070e17 100%)}',
      '.v15-pl-top{flex:none;display:flex;align-items:center;gap:12px;padding:9px 16px;',
      ' background:linear-gradient(90deg,#1657c8,#1e6fe8 55%,#1b5fd0);box-shadow:0 2px 12px rgba(0,0,0,.35)}',
      '.v15-pl-top .brand{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;white-space:nowrap}',
      '.v15-pl-top .brand i{width:22px;height:22px;border-radius:6px;background:#fff;color:#1e6fe8;',
      ' display:grid;place-items:center;font-style:normal;font-size:13px}',
      '.v15-pl-top .navlinks{display:flex;gap:14px;font-size:11px;opacity:.9;flex-wrap:wrap}',
      '.v15-pl-top .navlinks span{cursor:default}.v15-pl-top .navlinks span.on{font-weight:800;opacity:1}',
      '.v15-pl-top .search{margin-left:auto;display:flex;align-items:center;gap:6px;',
      ' background:rgba(255,255,255,.16);border-radius:14px;padding:5px 12px;font-size:10.5px;min-width:150px;max-width:260px}',
      '.v15-pl-top .search input{flex:1;min-width:0;border:0;background:none;outline:0;color:#fff;font:inherit;font-size:10.5px}',
      '.v15-pl-top .search input::placeholder{color:rgba(255,255,255,.65)}',
      '.v15-pl-main{flex:1;min-height:0;display:flex;gap:14px;padding:14px 16px;overflow:hidden}',
      /* 音频：中间大黑场 + 封面 + 歌名，底部固定播放条 */
      '.v15-audio-stage{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;',
      ' align-items:center;justify-content:center;gap:16px;background:#05090e;border-radius:10px;overflow:auto;padding:18px}',
      '.v15-audio-cover{width:min(216px,30vh);height:min(216px,30vh);min-width:112px;min-height:112px;',
      ' border-radius:9px;overflow:hidden;background:linear-gradient(150deg,#2b4a72,#3b2c63);',
      ' display:grid;place-items:center;box-shadow:0 20px 54px rgba(0,0,0,.65);flex:none}',
      '.v15-audio-cover img{width:100%;height:100%;object-fit:cover}',
      '.v15-audio-cover .ph{color:rgba(255,255,255,.5);font-size:13px;letter-spacing:2px}',
      '.v15-audio-title{text-align:center;max-width:min(560px,90%)}',
      '.v15-audio-title b{display:block;font-size:15px;word-break:break-all}',
      '.v15-audio-title span{font-size:11px;color:#8fb0c7}',
      '.v15-audio-dl{border:1px solid rgba(255,255,255,.4);background:none;color:#e9f2fa;',
      ' border-radius:18px;padding:7px 22px;font:inherit;font-size:11.5px;cursor:pointer}',
      '.v15-audio-dl:hover{background:rgba(255,255,255,.12)}',
      '.v15-audio-lyrics{flex:1;min-height:0;max-width:620px;width:100%;overflow:auto;text-align:center;',
      ' font-size:11.5px;line-height:2;color:#8ba9c0;white-space:pre-wrap;margin:0;padding:4px}',
      '.v15-pl-side{flex:0 1 248px;min-width:160px;display:flex;flex-direction:column;min-height:0;',
      ' border:1px solid rgba(120,170,210,.17);border-radius:10px;background:rgba(9,20,32,.72);overflow:hidden}',
      '.v15-pl-side .hd{flex:none;padding:9px 11px;border-bottom:1px solid rgba(120,170,210,.15);',
      ' font-size:11.5px;font-weight:700;color:#9fd0ee}',
      '.v15-pl-side .lst{flex:1;min-height:0;overflow:auto;padding:5px}',
      /* 底部固定播放条（酷狗式） */
      '.v15-playbar{flex:none;display:flex;align-items:center;gap:10px;padding:9px 16px;',
      ' border-top:1px solid rgba(120,170,210,.18);background:#0d1420;flex-wrap:wrap}',
      '.v15-playbar .ctl{display:flex;align-items:center;gap:5px}',
      '.v15-playbar .ctl button{width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.24);',
      ' background:none;color:#dbe7f3;font-size:13px;cursor:pointer;display:grid;place-items:center}',
      '.v15-playbar .ctl button.primary{background:#22a7e8;border-color:#22a7e8;color:#fff;width:34px;height:34px}',
      '.v15-playbar .mini{width:38px;height:38px;border-radius:5px;overflow:hidden;background:#1c3a56;flex:none;display:grid;place-items:center;font-size:15px}',
      '.v15-playbar .mini img{width:100%;height:100%;object-fit:cover}',
      '.v15-playbar .track{flex:1;min-width:130px;display:flex;flex-direction:column;gap:3px}',
      '.v15-playbar .track .nm{font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.v15-playbar .seek{width:100%;height:4px;accent-color:#22a7e8}',
      '.v15-playbar .tm{font:10.5px Consolas,monospace;color:#9fc4dc;white-space:nowrap}',
      '.v15-playbar .extra{display:flex;align-items:center;gap:8px;font-size:10.5px;color:#9fc4dc}',
      '.v15-playbar .extra button{border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:3px 5px}',
      /* 视频：大播放器 + 右侧信息 + 下方推荐 */
      '.v15-video-wrap{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:auto}',
      '.v15-video-stage{flex:none;position:relative;width:100%;aspect-ratio:16/9;max-height:62vh;',
      ' background:#000;border-radius:9px;overflow:hidden;display:grid;place-items:center}',
      '.v15-video-stage video{width:100%;height:100%;object-fit:contain;background:#000}',
      '.v15-video-info{flex:none;display:flex;align-items:flex-start;gap:11px;flex-wrap:wrap}',
      '.v15-video-info h3{margin:0;font-size:15px;word-break:break-all}',
      '.v15-video-info .meta{font-size:10.5px;color:#8fb0c7;line-height:1.6}',
      '.v15-video-info .go{margin-left:auto;border:0;border-radius:16px;padding:8px 20px;',
      ' background:#f5c451;color:#3a2a00;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer}',
      '.v15-recs{flex:none;display:flex;gap:9px;overflow-x:auto;padding:3px 0 6px}',
      '.v15-rec{flex:none;width:112px;cursor:pointer}',
      '.v15-rec .thumb{width:112px;height:70px;border-radius:6px;overflow:hidden;',
      ' background:linear-gradient(140deg,#1d3b57,#2b2f52);display:grid;place-items:center;color:#7ea6c2;font-size:10px}',
      '.v15-rec .thumb img{width:100%;height:100%;object-fit:cover}',
      '.v15-rec small{display:block;font-size:10px;color:#9fbdd2;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.v15-rec.on .thumb{outline:2px solid #22a7e8}',
      '.v15-pl-side .ep{padding:6px 8px;border-radius:6px;cursor:pointer;font-size:10.5px;color:#cfe4f3;',
      ' overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.v15-pl-side .ep:hover{background:rgba(34,167,232,.14)}',
      '.v15-pl-side .ep.on{background:rgba(34,167,232,.26);color:#fff;font-weight:700}',
      '.win.narrow .v15-pl-main{flex-direction:column;gap:8px;padding:8px}',
      '.win.narrow .v15-pl-side{flex:0 0 122px;min-width:0}',
      '.win.narrow .v15-audio-cover{width:min(150px,26vh);height:min(150px,26vh)}',
      '.win.narrow .v15-pl-top .navlinks{display:none}'
    ].join('\n');
    document.head.appendChild(el);
    V.styleDone = true;
  }
  V.style = style;

  /* ---------------------------------------------------------------- 模态窗 */
  function modal(o) {
    o = o || {};
    style();
    closeModal(o.id || 'main');
    var mask = document.createElement('div');
    mask.className = 'v15-mask'; mask.id = 'v15-mask-' + (o.id || 'main');
    var w = Math.min(Number(o.width) || 720, innerWidth - 32);
    var h = Math.min(Number(o.height) || 560, innerHeight - 40);
    mask.innerHTML =
      '<div class="v15-dlg" style="width:' + w + 'px;height:' + h + 'px">' +
      '<div class="v15-hd">' + G(o.icon || 'layers', 16, 'var(--accent)') +
      '<b>' + E(o.title || 'NasDeck') + '</b>' +
      (o.sub ? '<span class="sub">' + E(o.sub) + '</span>' : '') +
      '<span class="sp"></span><button class="v15-x" data-act="v15-close" title="关闭">×</button></div>' +
      '<div class="v15-bd" id="v15-bd"></div>' +
      '<div class="v15-ft" id="v15-ft"></div></div>';
    document.body.appendChild(mask);
    var bd = mask.querySelector('#v15-bd'), ft = mask.querySelector('#v15-ft');
    var M = {
      el: mask, body: bd, foot: ft,
      setBody: function (h) { bd.innerHTML = h; },
      setFoot: function (h) { ft.innerHTML = h; },
      msg: function (t, kind) {
        var m = bd.querySelector('#v15-msg');
        if (!m) { m = document.createElement('div'); m.id = 'v15-msg'; bd.insertBefore(m, bd.firstChild); }
        m.className = 'v15-msg' + (kind ? ' ' + kind : '');
        m.textContent = String(t || ''); m.style.display = t ? '' : 'none';
      },
      close: function () { mask.remove(); }
    };
    /* 把控制器挂到遮罩 DOM 上：curModal() 需要拿到带 msg/el/close 的对象，
       而不是裸 DOM。否则 savePreview / regLoginGo / doUpdateGo / recreateGo
       里的 M.msg(...) 会抛 "M.msg is not a function"，整条反馈链路中断。 */
    mask._v15modal = M;
    M.setBody(o.body || ''); M.setFoot(o.foot || '<span class="sp"></span><button class="btn sm" data-act="v15-close">关闭</button>');
    if (o.onMount) { try { o.onMount(M); } catch (e) {} }
    return M;
  }
  function closeModal(id) {
    var m = document.getElementById('v15-mask-' + (id || 'main'));
    if (m) m.remove();
  }
  /* 返回最近打开的模态窗控制器（含 msg / el / close），不是裸 DOM。
     多个模态叠加时取最上层；无模态时返回 null，调用方已有 if (M) 保护。 */
  function curModal() {
    var list = document.querySelectorAll('.v15-mask');
    var el = list.length ? list[list.length - 1] : null;
    return el ? (el._v15modal || null) : null;
  }
  V.modal = modal; V.closeModal = closeModal;

  function btn(act, label, extra, cls, icon) {
    return '<button class="btn sm ' + (cls || '') + '" data-act="' + act + '" ' + (extra || '') + '>' +
      (icon ? G(icon, 12) + ' ' : '') + E(label) + '</button>';
  }
  V.btn = btn;

  /* ================================================================ 需求 1
   * 镜像仓库：增删查 + 登录 / 登出 / 测试。密码只通过 --password-stdin 交给
   * WSL 内的 docker CLI，本项目不落盘、不出现在命令行参数里。 */
  function regLoad(force) {
    if (!NasDeck.token) return Promise.resolve();
    if (V.S.regsBusy) return Promise.resolve();
    if (!force && V.S.regsLoaded && now() - V.S.regs._at < 15000) return Promise.resolve();
    V.S.regsBusy = true;
    return api('/api/docker/registries').then(function (r) {
      V.S.regs = r.registries || []; V.S.regs._at = now();
      V.S.regsLoaded = true; V.S.regsBusy = false;
      V.S.regEngine = r.engine || {};
      if (dkrTab() === 'registries') R('container');
    }).catch(function (e) {
      V.S.regsBusy = false; V.S.regMsg = err(e);
      if (dkrTab() === 'registries') R('container');
    });
  }
  function regPane() {
    var list = V.S.regs || [], eng = V.S.regEngine || {};
    var bar = '<div class="v15-card" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<span class="v15-tag ' + (eng.online ? 'ok' : 'warn') + '">Docker Engine ' + (eng.online ? '在线' : '未连线 / N/A') + '</span>' +
      '<span class="v15-tag info">发行版 ' + E(eng.distro || 'N/A') + '</span>' +
      '<span class="v15-tag">已登记 ' + list.length + ' 个仓库</span>' +
      '<span class="sp" style="flex:1"></span>' +
      btn('v15-reg-add', '添加镜像仓库', '', 'primary', 'plus') +
      btn('v15-reg-refresh', '刷新', '', '', 'refresh') + '</div>';
    var rows = list.map(function (x) {
      var ops = btn('v15-reg-login', x.loggedIn ? '重新登录' : '登录', 'data-id="' + E(x.id) + '"', x.loggedIn ? '' : 'primary', 'key') +
        ' ' + btn('v15-reg-test', '测试', 'data-id="' + E(x.id) + '"', '', 'activity') +
        ' ' + (x.loggedIn ? btn('v15-reg-logout', '登出', 'data-id="' + E(x.id) + '"', '', 'x') : '') +
        ' ' + btn('v15-reg-del', '删除', 'data-id="' + E(x.id) + '"', 'danger', 'trash');
      return '<tr><td><b>' + E(x.name) + '</b>' +
        (x.note ? '<div class="dim" style="font-size:10px">' + E(x.note) + '</div>' : '') + '</td>' +
        '<td><span class="mono" style="font-size:10.5px">' + E(x.url) + '</span></td>' +
        '<td>' + E(x.username || '—') + '</td>' +
        '<td>' + (x.loggedIn ? '<span class="v15-tag ok">已登录 · ' + E(fmtT(x.loginAt)) + '</span>'
          : '<span class="v15-tag">未登录</span>') + '</td>' +
        '<td><div style="display:flex;gap:4px;flex-wrap:wrap">' + ops + '</div></td></tr>';
    }).join('');
    var tbl = '<div class="v15-card" style="padding:0;overflow:hidden"><div style="padding:10px 12px" class="v15-sec">' +
      '镜像仓库清单</div><div style="overflow:auto"><table class="v15-tbl"><thead><tr>' +
      '<th>名称</th><th>地址</th><th>用户名</th><th>登录状态</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="dim" style="padding:22px;text-align:center">' +
        (V.S.regsLoaded ? '还没有登记仓库。点「添加镜像仓库」录入，例如 1Panel 的 docker.1panel.top。' : '正在读取仓库清单…') +
        '</td></tr>') + '</tbody></table></div></div>';
    var tip = '<div class="v15-card"><div class="v15-sec">说明</div>' +
      '<p class="desc" style="margin:0 0 8px">仓库凭据由 WSL 内的 <span class="mono">docker login --password-stdin</span> 管理，' +
      '本项目只保存名称 / 地址 / 用户名与登录状态，<b>不保存密码</b>；删除仓库时会先执行 docker logout，避免留下孤儿凭据。</p>' +
      '<p class="desc" style="margin:0">登录需要 WSL 内可用 docker CLI。若本机安全策略禁止启动 wsl.exe，登录会如实返回失败原因（不会伪装成功）。' +
      '镜像更新检测同样依赖远端 manifest，读不到时显示「未确认」而非「有更新」。</p>' +
      (V.S.regMsg ? '<div class="v15-msg err" style="margin-top:9px">' + E(V.S.regMsg) + '</div>' : '') + '</div>';
    return '<div class="v15-reg-pane">' + bar + tbl + tip + '</div>';
  }
  function regAddDlg() {
    var M = modal({
      id: 'reg', title: '添加镜像仓库', sub: '支持 Docker Hub / 1Panel / 私有仓库', icon: 'download', width: 560, height: 470,
      body: '<div class="v15-row"><label>仓库名称 *</label><input class="v15-inp" id="v15-rg-name" placeholder="例如 1Panel 镜像仓库"></div>' +
        '<div class="v15-row"><label>仓库地址 *</label><input class="v15-inp" id="v15-rg-url" placeholder="例如 docker.1panel.top 或 registry.example.com:5000"></div>' +
        '<div class="v15-hint">可带 http(s):// 前缀，保存时自动去掉；支持域名 + 端口 + 路径。</div>' +
        '<div class="v15-row"><label>用户名（可选）</label><input class="v15-inp" id="v15-rg-user" placeholder="登录时也可再填"></div>' +
        '<div class="v15-row"><label>备注（可选）</label><input class="v15-inp" id="v15-rg-note" placeholder="用途说明"></div>' +
        '<div class="v15-row"><label>类型</label><label class="v15-switch"><input type="checkbox" id="v15-rg-mirror"> 作为镜像加速器</label></div>' +
        '<div class="v15-msg" id="v15-reg-add-msg" style="display:none"></div>',
      foot: '<span class="sp"></span>' + btn('v15-close', '取消') + ' ' + btn('v15-reg-add-go', '添加仓库', '', 'primary', 'plus')
    });
    V.S.regForm = M;
  }
  function regAddGo() {
    var M = V.S.regForm; if (!M) return;
    var g = function (id) { var x = document.getElementById(id); return x ? x.value : ''; };
    var b = {
      act: 'add', name: g('v15-rg-name'), url: g('v15-rg-url'),
      username: g('v15-rg-user'), note: g('v15-rg-note'),
      mirror: !!(document.getElementById('v15-rg-mirror') || {}).checked
    };
    if (!b.name || !b.url) { M.msg('请填写仓库名称和地址', 'err'); return; }
    M.msg('正在保存…');
    api('/api/docker/registries', b).then(function (r) {
      if (!r.ok) throw new Error(r.error || '保存失败');
      T('已添加镜像仓库', b.name, 'ok'); M.close(); V.S.regForm = null; V.S.regMsg = '';
      return regLoad(true);
    }).catch(function (e) { M.msg('添加失败：' + err(e), 'err'); });
  }
  function regLoginDlg(id) {
    var x = (V.S.regs || []).filter(function (a) { return a.id === id; })[0];
    if (!x) { T('仓库不存在', '', 'err'); return; }
    var M = modal({
      id: 'login', title: '登录镜像仓库 · ' + x.name, sub: x.url, icon: 'key', width: 520, height: 380,
      body: '<div class="v15-msg">凭据通过 <span class="mono">docker login --password-stdin</span> 传给 WSL 内的 docker CLI，' +
        '本项目磁盘不保存密码。</div>' +
        '<div class="v15-row"><label>用户名 *</label><input class="v15-inp" id="v15-lg-user" value="' + E(x.username || '') + '" placeholder="用户名"></div>' +
        '<div class="v15-row"><label>密码 / 访问令牌 *</label><input class="v15-inp" id="v15-lg-pw" type="password" placeholder="密码或 Personal Access Token"></div>' +
        '<div class="v15-hint">私有仓库建议使用访问令牌；登录状态会记录在仓库清单中。</div>' +
        '<div class="v15-msg" id="v15-login-msg" style="display:none"></div>',
      foot: '<span class="sp"></span>' + btn('v15-close', '取消') + ' ' + btn('v15-reg-login-go', '登录', 'data-id="' + E(id) + '"', 'primary', 'key')
    });
  }
  function regLoginGo(id) {
    var m = curModal();
    var u = (document.getElementById('v15-lg-user') || {}).value || '';
    var p = (document.getElementById('v15-lg-pw') || {}).value || '';
    if (!u || !p) { if (m) m.msg('请填写用户名和密码 / 令牌', 'err'); return; }
    if (m) m.msg('正在调用 WSL docker login…');
    api('/api/docker/registry/login', { id: id, username: u, password: p }).then(function (r) {
      if (!r.ok) throw new Error(r.error || '登录失败');
      T('登录成功', (r.registry || {}).name || id, 'ok');
      closeModal('login'); return regLoad(true);
    }).catch(function (e) {
      if (m && m.el.isConnected) m.msg('登录失败：' + err(e), 'err');
      else T('登录失败', err(e), 'err');
    });
  }
  function regAct(act, id) {
    if (act === 'logout') {
      api('/api/docker/registry/logout', { id: id }).then(function (r) {
        T(r.ok ? '已登出' : '登出未成功', r.out || '', r.ok ? 'ok' : 'warn'); return regLoad(true);
      }).catch(function (e) { T('登出失败', err(e), 'err'); });
    } else if (act === 'test') {
      T('正在测试仓库连通性', '使用 WSL docker CLI', 'info');
      api('/api/docker/registry/test', { id: id }).then(function (r) {
        modal({
          id: 'test', title: '仓库连通性测试', sub: r.url || '', icon: 'activity', width: 620, height: 400,
          body: '<div class="v15-msg ' + (r.ok ? 'ok' : 'err') + '">' + (r.ok ? 'docker CLI 可用' : 'docker CLI 不可用（如实回传，未伪造成成功）') + '</div>' +
            '<div class="v15-pre">' + E(r.out || '(无输出)') + '</div>'
        });
      }).catch(function (e) { T('测试失败', err(e), 'err'); });
    } else if (act === 'del') {
      var x = (V.S.regs || []).filter(function (a) { return a.id === id; })[0] || {};
      var M = modal({
        id: 'del', title: '删除镜像仓库', icon: 'trash', width: 470, height: 250,
        body: '<div class="v15-msg err">将删除「' + E(x.name || id) + '」的登记，并尝试执行 docker logout 清理凭据。镜像与容器不受影响。</div>',
        foot: '<span class="sp"></span>' + btn('v15-close', '取消') + ' ' + btn('v15-reg-del-go', '确认删除', 'data-id="' + E(id) + '"', 'primary', 'trash')
      });
    }
  }
  V.regLoad = regLoad; V.regPane = regPane; V.regAddDlg = regAddDlg;
  V.regAddGo = regAddGo; V.regLoginDlg = regLoginDlg; V.regLoginGo = regLoginGo; V.regAct = regAct;

  /* ================================================================ 需求 2
   * 镜像更新检测：只有 status==='update' 才显示可点击的「有更新」标签。
   * unknown / up-to-date 一律不显示「有更新」，绝不编造。 */
  function updLoad(force) {
    if (!NasDeck.token) return Promise.resolve();
    if (V.S.updBusy) return Promise.resolve();
    if (!force && V.S.upd.length && now() - V.S.updAt < 60000) return Promise.resolve();
    V.S.updBusy = true;
    return api('/api/docker/updates' + (force ? '?force=1' : '')).then(function (r) {
      V.S.upd = r.items || []; V.S.updAt = now(); V.S.updBusy = false;
      V.S.updMap = {};
      V.S.upd.forEach(function (x) { V.S.updMap[x.id] = x; });
      if (dkrTab() === 'containers') R('container');
    }).catch(function (e) {
      V.S.updBusy = false; V.S.updMsg = err(e);
    });
  }
  function updBadge(cid) {
    var x = V.S.updMap[cid];
    if (!x) return '';
    if (x.status === 'update') {
      return ' <span class="v15-tag upd" data-act="v15-ct-update" data-id="' + E(cid) + '" ' +
        'title="检测到镜像有新版本，点击拉取并重建容器">↑ 有更新</span>';
    }
    if (x.status === 'up-to-date') return ' <span class="v15-tag ok" title="本地与远端 digest 一致">已最新</span>';
    return ' <span class="v15-tag" title="' + E(x.reason || '无法确认') + '">未确认</span>';
  }
  function doUpdate(cid) {
    var x = V.S.updMap[cid] || {};
    var M = modal({
      id: 'upd', title: '更新容器镜像', sub: x.name || cid, icon: 'refresh', width: 540, height: 300,
      body: '<div class="v15-msg">将拉取镜像 <b class="mono">' + E(x.image || 'N/A') + '</b> 的最新版本，' +
        '然后按原配置重建容器。<b>旧容器会保留为 -bak- 备份，不会删除。</b></div>' +
        '<div class="v15-msg" id="v15-upd-msg" style="display:none"></div>',
      foot: '<span class="sp"></span>' + btn('v15-close', '取消') + ' ' + btn('v15-ct-update-go', '开始更新', 'data-id="' + E(cid) + '"', 'primary', 'refresh')
    });
  }
  function doUpdateGo(cid) {
    var M = curModal();
    if (M) M.msg('正在拉取最新镜像并重建容器…（可能需要几十秒）');
    api('/api/docker/container/update', { id: cid }).then(function (r) {
      if (!r.ok) throw new Error(r.error || '更新失败');
      T('容器已更新', '新容器 ' + (r.id || 'N/A') + ' · 旧容器保留为 ' + (r.backup || 'N/A'), 'ok');
      closeModal('upd'); V.S.upd = []; V.S.updMap = {}; V.S.updAt = 0;
      try { api('/api/wsl/refresh', {}).then(function(){ R('container'); }); } catch (e) {}
      return updLoad(true);
    }).catch(function (e) {
      if (M && M.el.isConnected) M.msg('更新失败：' + err(e), 'err');
      else T('更新失败', err(e), 'err');
    });
  }
  V.updLoad = updLoad; V.updBadge = updBadge; V.doUpdate = doUpdate; V.doUpdateGo = doUpdateGo;

  /* ================================================================ 需求 3
   * 容器重构：读取 inspect 配置填入可编辑表单，提交后备份旧容器并重建。 */
  var RECREATE_FIELDS = [
    ['name', '容器名称', 'text', '留空沿用原名'],
    ['image', '镜像', 'text', '一般不建议修改'],
    ['cmd', '启动命令', 'text', '空格分隔，留空沿用原值'],
    ['entrypoint', 'Entrypoint', 'text', '空格分隔'],
    ['env', '环境变量', 'area', '每行一个 KEY=VALUE'],
    ['ports', '端口映射', 'area', '每行一个：容器端口:宿主端口，例 80/tcp:8080'],
    ['binds', '文件映射', 'area', '每行一个 /host:/container[:ro]'],
    ['workdir', '工作目录', 'text', ''],
    ['user', '用户', 'text', ''],
    ['hostname', '主机名', 'text', ''],
    ['restart', '重启策略', 'sel', 'no / on-failure / always / unless-stopped'],
    ['network', '网络模式', 'text', 'bridge / host / none'],
    ['memory', '内存限制 (MB)', 'text', '0 = 不限制'],
    ['cpus', 'CPU 核数', 'text', '0 = 不限制，例 1.5'],
    ['privileged', '特权模式', 'chk', '']
  ];
  function rcField(k, label, type, hint, val) {
    var id = 'v15-rc-' + k;
    var inp;
    if (type === 'area') inp = '<textarea class="v15-area" id="' + id + '" style="min-height:62px">' + E(val || '') + '</textarea>';
    else if (type === 'sel') {
      var opts = ['no', 'on-failure', 'always', 'unless-stopped'];
      inp = '<select class="v15-sel" id="' + id + '">' + opts.map(function (o) {
        return '<option ' + (o === (val || 'no') ? 'selected' : '') + '>' + o + '</option>';
      }).join('') + '</select>';
    } else if (type === 'chk') inp = '<label class="v15-switch"><input type="checkbox" id="' + id + '" ' + (val ? 'checked' : '') + '> 开启特权模式</label>';
    else inp = '<input class="v15-inp" id="' + id + '" value="' + E(val === undefined || val === null ? '' : val) + '">';
    return '<div class="v15-row"><label>' + E(label) + '</label>' + inp +
      (hint ? '<div class="v15-hint">' + E(hint) + '</div>' : '') + '</div>';
  }
  function recreateDlg(cid) {
    T('正在读取容器配置', cid, 'info');
    api('/api/docker/container/inspect?id=' + encodeURIComponent(cid)).then(function (r) {
      if (!r.ok || !r.config) throw new Error(r.error || '读取配置失败');
      var c = r.config; V.S.recreate = { id: cid, orig: c };
      var body = '<div class="v15-msg">修改设置后点「重构容器」：旧容器会先停止并改名为 ' +
        '<span class="mono">' + E(c.name || '') + '-bak-*</span> 保留（不删除），再用新配置建立并启动同名容器；' +
        '任一步失败都会自动回滚旧容器。</div>' +
        '<div class="v15-sec">基本设置</div>' +
        RECREATE_FIELDS.slice(0, 5).map(function (f) { return rcField(f[0], f[1], f[2], f[3], c[f[0]]); }).join('') +
        '<div class="v15-sec">端口 / 存储 / 网络</div>' +
        RECREATE_FIELDS.slice(5, 12).map(function (f) { return rcField(f[0], f[1], f[2], f[3], c[f[0]]); }).join('') +
        '<div class="v15-sec">资源限制</div>' +
        RECREATE_FIELDS.slice(12).map(function (f) { return rcField(f[0], f[1], f[2], f[3], c[f[0]]); }).join('') +
        '<div class="v15-msg" id="v15-rc-msg" style="display:none"></div>';
      modal({
        id: 'rc', title: '重构容器 · ' + (c.name || cid), sub: cid, icon: 'box', width: 760, height: 660,
        body: body,
        foot: '<span class="sub" style="font-size:10px;color:var(--muted)">仅提交有改动的字段，未改动项沿用原配置</span>' +
          '<span class="sp"></span>' + btn('v15-close', '取消') + ' ' +
          btn('v15-ct-recreate-go', '重构容器', 'data-id="' + E(cid) + '"', 'primary', 'refresh')
      });
    }).catch(function (e) {
      /* inspect 失败时给出可见、可复制的原因，而不是一闪而过的 toast。 */
      var reason = err(e);
      T('读取容器配置失败', reason, 'err');
      modal({
        id: 'rc', title: '重构容器 · 读取配置失败', sub: cid, icon: 'alert', width: 560, height: 300,
        body: '<div class="v15-msg err">无法读取该容器的当前配置，因此不能生成重构表单（如实反馈，未编造默认值）。</div>' +
          '<div class="v15-sec">失败原因</div><div class="v15-pre">' + E(reason) + '</div>' +
          '<p class="desc" style="margin:9px 0 0">常见原因：Docker Engine 未连线、容器已被删除，或当前端点不提供 inspect（N/A）。</p>',
        foot: '<span class="sp"></span>' + btn('v15-close', '关闭')
      });
    });
  }
  function recreateGo(cid) {
    var M = curModal();
    var cfg = {};
    RECREATE_FIELDS.forEach(function (f) {
      var el = document.getElementById('v15-rc-' + f[0]);
      if (!el) return;
      var v = f[2] === 'chk' ? !!el.checked : el.value;
      if (String(v) !== String(V.S.recreate.orig[f[0]] === undefined ? '' : V.S.recreate.orig[f[0]])) cfg[f[0]] = v;
    });
    if (M) M.msg('正在备份旧容器并按新配置重建…（可能需要几十秒）');
    api('/api/docker/container/recreate', { id: cid, config: cfg }).then(function (r) {
      if (!r.ok) throw new Error(r.error || '重构失败');
      T('容器已重构', '新容器 ' + (r.id || 'N/A') + ' · 旧容器备份 ' + (r.backup || 'N/A'), 'ok');
      closeModal('rc');
      try { api('/api/wsl/refresh', {}).then(function(){ R('container'); }); } catch (e) {}
      return updLoad(true);
    }).catch(function (e) {
      if (M && M.el.isConnected) M.msg('重构失败：' + err(e), 'err');
      else T('重构失败', err(e), 'err');
    });
  }
  V.recreateDlg = recreateDlg; V.recreateGo = recreateGo;

  /* ================================================================ 需求 6
   * 文件预览 / 编辑：文本按编码解码（UTF-8 / GBK / UTF-16 / BOM 均不乱码），
   * 图片音视频直接播放，PDF / Office 用内置查看器，不上传第三方。 */
  function previewQ(f) {
    return '/api/nas/file/preview?path=' + encodeURIComponent(f.path || '/') +
      '&name=' + encodeURIComponent(f.n || '');
  }
  function openPreview(f) {
    if (!f || !f.n) return;
    if (f.t === 'dir' || f.drive) return false;
    /* 连续快速打开不同文件时只认最后一次请求：旧请求晚到不得覆盖新预览，
       也不能用布尔忙锁把新请求静默丢掉（否则关闭弹窗后出现空白 / 停留在旧文件）。 */
    var seq = ++V.seq;
    V.S.previewBusy = true;
    api(previewQ(f)).then(function (info) {
      if (seq !== V.seq) return;
      V.S.previewBusy = false;
      if (!info.ok) throw new Error(info.error || '预览失败');
      V.S.preview = { info: info, f: f };
      renderPreview(info, f);
    }).catch(function (e) {
      if (seq !== V.seq) return;
      V.S.previewBusy = false; T('预览失败', err(e), 'err');
    });
    return true;
  }
  function kindLabel(k) {
    return ({ image: '图片', audio: '音频', video: '视频', pdf: 'PDF 文档', office: 'Office 在线文档', text: '文本编辑', binary: '二进制' })[k] || k;
  }
  function renderPreview(info, f) {
    var body = '', foot = '', h = 560, w = 780;
    var head = '<div class="v15-office-bar">' + G('file', 14, 'var(--accent)') +
      '<b>' + E(info.name || f.n) + '</b><span class="v15-tag info">' + E(kindLabel(info.kind)) + '</span>' +
      '<span>' + E(fmtSize(info.size)) + '</span><span>修改 ' + E(fmtT(info.mtime)) + '</span>' +
      (info.encoding ? '<span class="v15-tag ok">编码 ' + E(info.encoding) + '</span>' : '') +
      '<span class="sp" style="flex:1"></span><span class="mono dim">' + E(info.path || f.path || '') + '</span></div>';
    if (info.kind === 'text') {
      w = 860; h = 640;
      body = head + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
        '<span class="v15-tag">原编码 ' + E(info.encoding || 'N/A') + '</span>' +
        (info.lang ? '<span class="v15-tag">' + E(info.lang) + '</span>' : '') +
        '<span class="dim" style="font-size:10.5px">保存时自动生成版本快照；GBK / Big5 原文件会转存为 UTF-8 并如实提示</span></div>' +
        '<textarea class="v15-area" id="v15-text" spellcheck="false" style="min-height:340px">' + E(info.text || '') + '</textarea>' +
        '<div class="v15-msg" id="v15-save-msg" style="display:none"></div>';
      foot = '<span class="sp"></span>' + btn('v15-close', '关闭') + ' ' +
        btn('v15-file-save', '保存修改', '', 'primary', 'save');
    } else if (info.kind === 'office') {
      w = 900; h = 660;
      var oh = info.office && info.office.html;
      body = head + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px;flex-wrap:wrap">' +
        '<span class="v15-tag ok">内置在线文档查看器</span>' +
        '<span class="dim" style="font-size:10.5px">在本机后端解析 docx / xlsx 后直接渲染，不上传文件、不经过外网</span></div>' +
        (oh ? '<div class="v15-office">' + oh + '</div>'
          : '<div class="v15-msg err">' + E(info.officeError || '该 Office 格式暂不支持在线预览（当前支持 docx / xlsx / xls）') + '</div>') +
        (oh ? '' : '<div class="v15-msg">可用「下载」在本机 Office / WPS 中打开。</div>');
      foot = '<span class="sp"></span>' + btn('v15-preview-dl', '下载原文件', '', '', 'download') + ' ' + btn('v15-close', '关闭');
    } else if (info.kind === 'image' || info.kind === 'audio' || info.kind === 'video' || info.kind === 'pdf') {
      w = 900; h = 660;
      var media;
      if (info.kind === 'image') media = '<img src="' + E(url(info.url)) + '" alt="' + E(info.name) + '">';
      else if (info.kind === 'audio') media = '<audio controls autoplay src="' + E(url(info.url)) + '"></audio>' +
        '<div class="v15-audio-title"><b>' + E(info.name) + '</b><span>本机音频 · ' + E(fmtSize(info.size)) + '</span></div>';
      else if (info.kind === 'video') media = '<video controls autoplay playsinline src="' + E(url(info.url)) + '"></video>';
      else media = '<iframe src="' + E(url(info.url)) + '" title="PDF 预览"></iframe>';
      body = head + '<div class="v15-media">' + media + '</div>';
      foot = '<span class="sp"></span>' + btn('v15-preview-dl', '下载原文件', '', '', 'download') + ' ' +
        (info.kind === 'audio' || info.kind === 'video' || info.kind === 'image'
          ? btn('v15-preview-immersive', '沉浸式播放', 'data-kind="' + (info.kind === 'image' ? 'img' : (info.kind === 'audio' ? 'aud' : 'vid')) + '"', 'primary', 'play') + ' '
          : '') + btn('v15-close', '关闭');
    } else {
      body = head + '<div class="v15-msg">' + E(info.reason || '此类型暂不支持在线预览') + '</div>';
      foot = '<span class="sp"></span>' + btn('v15-preview-dl', '下载原文件', '', 'primary', 'download') + ' ' + btn('v15-close', '关闭');
    }
    modal({ id: 'preview', title: '文件预览 · ' + (info.name || f.n), sub: kindLabel(info.kind), icon: 'file', width: w, height: h, body: body, foot: foot });
  }
  function savePreview() {
    var p = V.S.preview; if (!p) return;
    var ta = document.getElementById('v15-text'); if (!ta) return;
    /* 反馈写进预览弹窗自带的 #v15-save-msg：用户能在编辑框正下方看到结果，
       同时兼容通用模态消息条。 */
    function say(t, kind) {
      var el = document.getElementById('v15-save-msg');
      if (el) {
        el.className = 'v15-msg' + (kind ? ' ' + kind : '');
        el.textContent = String(t || '');
        el.style.display = t ? '' : 'none';
      }
    }
    say('正在保存…');
    api('/api/nas/file/save', {
      path: p.f.path || '/', name: p.f.n, content: ta.value
    }).then(function (r) {
      if (!r.ok) throw new Error(r.error || '保存失败');
      var note = r.encodingChanged ? ('原编码 ' + r.fromEncoding + ' 已转为 UTF-8') : ('保持 ' + r.encoding);
      T('保存成功', note + (r.snapshot ? ' · 已生成版本快照' : ''), 'ok');
      say('已保存：' + note, 'ok');
      p.info.text = ta.value; p.info.encoding = r.encoding;
    }).catch(function (e) { say('保存失败：' + err(e), 'err'); });
  }
  function previewDl() {
    var p = V.S.preview; if (!p) return;
    var u = p.info.url || ('/api/files/open?path=' + encodeURIComponent(p.f.path || '/') +
      '&name=' + encodeURIComponent(p.f.n));
    window.open(url(u), '_blank');
  }
  V.openPreview = openPreview; V.savePreview = savePreview; V.previewDl = previewDl;
  V.renderPreview = renderPreview;

  /* ================================================================ 需求 7
   * 分享加密开关：状态存本层，winnas 的 shCreate* 会读取它并带上 encrypted。 */
  function shareArgs() {
    return {
      encrypted: !!V.S.shareEncrypted,
      password: V.S.shareEncrypted ? String(V.S.sharePassword || '').trim() : ''
    };
  }
  function shareCfgHtml() {
    return '<label class="v15-switch" title="开启后访问链接需要输入密码">' +
      '<input type="checkbox" id="v15-sh-encrypted" ' + (V.S.shareEncrypted ? 'checked' : '') + '> 加密访问</label>' +
      '<input class="nasdeck-sh-inp" id="v15-sh-password" type="password" style="width:118px" ' +
      'placeholder="访问密码" value="' + E(V.S.sharePassword) + '" ' + (V.S.shareEncrypted ? '' : 'disabled') + '>' +
      '<span class="dim" style="font-size:10px">' + (V.S.shareEncrypted ? '访问者需输入密码' : '公开访问 · 无需密码') + '</span>';
  }
  function shareInputListen() {
    if (window.__NasDeck_V15_SH_INPUT__) return;
    window.__NasDeck_V15_SH_INPUT__ = true;
    document.addEventListener('change', function (e) {
      if (!e.target || e.target.id !== 'v15-sh-encrypted') return;
      V.S.shareEncrypted = !!e.target.checked;
      var pw = document.getElementById('v15-sh-password');
      if (pw) pw.disabled = !V.S.shareEncrypted;
      try { R('filestation'); } catch (er) {}
    }, true);
    document.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'v15-sh-password') V.S.sharePassword = e.target.value;
    }, true);
  }
  V.shareArgs = shareArgs; V.shareCfgHtml = shareCfgHtml;

  /* ================================================================ 需求 4/8
   * 文件总管：顶部不再放「文件浏览 / 分享链接」按钮；切换统一走底部固定栏。
   * 底部固定栏同时承载「本机存储空间」与「分享链接」按钮。 */
  function fsDockHtml(tab) {
    var ds = [];
    try { ds = NasDeck.realDrives || []; } catch (e) {}
    var vol = ds.length ? ds.map(function (d) {
      var pct = (d.pct === null || d.pct === undefined) ? null : Number(d.pct);
      return '<div class="v15-vol-item"><b>' + E(d.drive) + '</b> ' +
        '<span class="dim">' + (pct === null ? 'N/A' : pct.toFixed(1) + '%') + '</span>' +
        '<div class="prog ' + (pct !== null && pct > 85 ? 'warn' : '') + '"><i style="width:' +
        (pct === null || isNaN(pct) ? 0 : pct) + '%"></i></div>' +
        '<span class="dim">' + E(d.total ? fmtSize(d.total) : 'N/A') + ' · 可用 ' + E(d.free ? fmtSize(d.free) : 'N/A') + '</span></div>';
    }).join('') : '<span class="dim" style="font-size:10.5px">本机存储空间：N/A</span>';
    var origin = '';
    try { origin = location.origin; } catch (e) {}
    return '<div class="v15-fs-dock">' +
      '<div class="nav">' +
      '<button class="' + (tab === 'files' ? 'on' : '') + '" data-act="v15-fs-tab" data-t="files" ' +
      'title="显示本机目录树与文件列表">' + G('folder', 13) + ' 目录树 / 文件浏览</button>' +
      '<button class="' + (tab === 'shares' ? 'on' : '') + '" data-act="v15-fs-tab" data-t="shares" ' +
      'title="管理分享链接（生成 / 复制 / 撤销）">' + G('link', 13) + ' 分享链接' +
      ((sharesRef().items || []).length ? ' <span class="badge">' + (sharesRef().items || []).length + '</span>' : '') + '</button>' +
      /* v16.3：只保留「传输进度」内嵌 tab（操作历史已按需求移除），
         徽标显示统一任务池里进行中的任务数。 */
      '<button class="' + (tab === 'transfer' ? 'on' : '') + '" data-act="v15-fs-tab" data-t="transfer" ' +
      'title="查看所有文件操作的传输进度（上传/下载/复制/移动/删除/新建/重命名）">' + G('activity', 13) + ' 传输进度' +
      (function () {
        try {
          var N = window.NasDeck_NS, n = 0;
          if (N && N.S) {
            var ops = N.S.ops || [];
            if (ops.length) ops.forEach(function (t) { if (t.state === 'running') n++; });
            else {
              (N.S.uploads || []).concat(N.S.downloads || []).forEach(function (t) { if (t.state === 'running') n++; });
              (N.S.proto || []).forEach(function (t) { if (t.state === 'running') n++; });
            }
          }
          return n ? ' <span class="badge">' + n + '</span>' : '';
        } catch (e) { return ''; }
      })() + '</button></div>' +
      '<div class="v15-fs-vol" title="本机存储空间（固定在窗口底部）">' + vol + '</div>' +
      '<div class="v15-fs-conn">连接 <b class="mono">' + E(origin || 'N/A') + '</b></div></div>';
  }
  function fsTabsHtml() {
    var origin = '';
    try { origin = location.origin; } catch (e) {}
    return '<div class="nasdeck-fs-tabs"><span style="font-size:11.5px;font-weight:700">' +
      G('folder', 13, 'var(--accent)') + ' 本机文件</span>' +
      '<span class="sp"></span><span class="nasdeck-conn">当前连接 <b class="mono">' +
      E(origin || 'N/A') + '</b></span></div>';
  }
  V.fsDockHtml = fsDockHtml; V.fsTabsHtml = fsTabsHtml;

  /* ================================================================ 需求 9
   * 工具条按钮放不下时，把尾部按钮收进「更多」下拉。
   * 用真实 offsetWidth 测量：只有 scrollWidth 溢出容器时才折叠，窗口变大自动还原。 */
  function fitToolbar() {
    if (!NasDeck.token) return;
    /* 用户手动展开「更多」期间不重排：enforce() 每 1.5s 会调本函数，
       否则刚点开的菜单会被守卫立刻收起（窗口 resize 会先清掉 moreOpen）。 */
    if (V.S.moreOpen) return;
    var tb = document.querySelector('.v15-toolbar');
    if (!tb) return;
    var more = tb.querySelector('.v15-more-btn');
    var menu = tb.querySelector('.v15-more-menu');
    if (!more || !menu) return;
    /* 先把菜单里的按钮搬回工具条（保持原始顺序） */
    var parked = menu.querySelectorAll('button[data-v15-move]');
    for (var i = parked.length - 1; i >= 0; i--) tb.insertBefore(parked[i], more);
    menu.hidden = true; more.classList.remove('on');
    more.style.display = '';
    var kids = [];
    for (var j = 0; j < tb.children.length; j++) {
      var c = tb.children[j];
      if (c === more || c === menu) continue;
      if (c.tagName === 'BUTTON' && !c.classList.contains('v15-more-btn')) kids.push(c);
    }
    var avail = tb.clientWidth - 72;   /* 给「更多」按钮和边距留位 */
    if (avail < 160) return;
    var used = 0, over = [];
    for (var k = 0; k < kids.length; k++) {
      used += kids[k].offsetWidth + 6;
      if (used > avail) over.push(kids[k]);
    }
    if (!over.length) { more.style.display = 'none'; return; }
    over.forEach(function (b) {
      b.setAttribute('data-v15-move', '1');
      menu.appendChild(b);
    });
  }
  function moreToggle() {
    var tb = document.querySelector('.v15-toolbar');
    if (!tb) return;
    var menu = tb.querySelector('.v15-more-menu'), more = tb.querySelector('.v15-more-btn');
    if (!menu) return;
    /* menu.hidden 为 true 表示当前收起 -> 本次打开；反之收起。
       旧写法先 !menu.hidden 再取反，会把状态写回原值，菜单永远打不开。 */
    var willOpen = !!menu.hidden;
    menu.hidden = !willOpen;
    V.S.moreOpen = willOpen;
    if (more) more.classList.toggle('on', willOpen);
  }
  V.fitToolbar = fitToolbar; V.moreToggle = moreToggle;

  /* ================================================================ 需求 11
   * 每个插件生成确定性的独立彩色图标（应用商店式），同一 id 永远同色同字形。 */
  var P_ICONS = ['box', 'layers', 'activity', 'terminal', 'music', 'film', 'image', 'folder', 'grid',
    'download', 'refresh', 'link', 'file', 'search', 'info', 'play', 'home', 'copy', 'archive', 'alert'];
  var P_HUES = [206, 262, 22, 158, 340, 190, 288, 42, 122, 12, 230, 320, 96, 174];
  function pHash(s) {
    var h = 0; s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function pluginIcon(p, size) {
    p = p || {};
    var h = pHash(p.id || p.name || 'plugin'), sz = size || 48;
    var hue = P_HUES[h % P_HUES.length], hue2 = (hue + 34 + (h % 40)) % 360;
    var ic = p.icon && P_ICONS.indexOf(p.icon) >= 0 ? p.icon : P_ICONS[(h >>> 3) % P_ICONS.length];
    var bg = 'linear-gradient(145deg,hsl(' + hue + ',68%,58%),hsl(' + hue2 + ',62%,36%))';
    return '<div class="v15-picon" style="width:' + sz + 'px;height:' + sz + 'px;background:' + bg +
      ';font-size:' + Math.round(sz * 0.19) + 'px">' + G(ic, Math.round(sz * 0.48), '#fff') + '</div>';
  }
  /* ================================================================ 统一应用目录
   * 用户反馈：App Center 里的「插件」和桌面上显示的「程序」本来就是同一个东西，
   * 项目却拆成了三套互不相干的数据：
   *   ① PLG.list（后端 BUILTIN 内置功能 + 上传 .js 插件）
   *   ② APPS[k].desk（底座写死的桌面程序，用 appIcon 渐变图标）
   *   ③ V14.icons.list（/api/plugins/icons 桌面快捷方式，用首字母方块图标）
   * 结果：两边清单对不上、同一个应用三种图标、还得手动「添加到桌面」。
   *
   * 这里合并为一份 catalog()：两处共用同一 id / 名称 / 描述 / 版本 / 彩色图标。
   * 「是否在桌面显示」只是每个应用的一个属性 onDesk，不再是另一套数据：
   *   · 上传插件 -> 后端已自动写入快捷方式表 -> 自动出现在桌面
   *   · 从桌面隐藏 -> 只切换 onDesk（本地 hidden 表 + 后端快捷方式表同步）
   *   · App Center 里随时可「显示到桌面」恢复，永不卸载 / 删除应用本体
   * ============================================================== */
  var DESK_HIDE_KEY = 'nasdeck61_desk_hidden';
  function loadHidden() {
    if (V.S.deskHidden) return V.S.deskHidden;
    var o = {};
    try { o = JSON.parse(localStorage.getItem(DESK_HIDE_KEY) || '{}') || {}; } catch (e) {}
    V.S.deskHidden = o; return o;
  }
  function saveHidden() {
    try { localStorage.setItem(DESK_HIDE_KEY, JSON.stringify(V.S.deskHidden || {})); } catch (e) {}
  }
  function catalog() {
    var apps = {}, plg = [], icons = [], hidden = loadHidden(), byId = {}, order = [];
    try { apps = (typeof APPS === 'object' && APPS) || {}; } catch (e) {}
    try { plg = (NasDeck.plugins && NasDeck.plugins.list) || []; } catch (e) {}
    try { icons = (NasDeck.v14 && NasDeck.v14.icons && NasDeck.v14.icons.list) || []; } catch (e) {}
    var iconIds = {};
    (icons || []).forEach(function (x) { if (x && x.id) iconIds[x.id] = x; });
    /* ① 底座程序：窗口元数据 + 默认桌面可见性 */
    Object.keys(apps).forEach(function (id) {
      var a = apps[id] || {};
      byId[id] = {
        id: id, name: a.name || id, en: a.en || id, cat: a.cat || '应用',
        icon: a.icon || 'box', desc: a.desc || '', version: '2.5.0',
        builtin: true, enabled: true, source: 'system',
        deskDefault: !!a.desk, hasWindow: true
      };
      order.push(id);
    });
    /* ② 后端插件清单：补齐元数据，并登记不在 APPS 里的用户上传插件 */
    (plg || []).forEach(function (p) {
      if (!p || !p.id) return;
      var b = byId[p.id];
      if (!b) {
        byId[p.id] = {
          id: p.id, name: p.name || p.id, en: p.en || p.id,
          cat: p.category || '应用', icon: p.icon || 'box',
          desc: p.description || '', version: p.version || '1.0.0',
          builtin: !!p.builtin, enabled: p.enabled !== false,
          source: p.builtin ? 'builtin' : 'uploaded',
          deskDefault: false, hasWindow: false,
          manifestOk: p.manifestOk, hasRegister: p.hasRegister
        };
        order.push(p.id);
      } else {
        if (p.description) b.desc = p.description;
        if (p.icon) b.icon = p.icon;
        if (p.category) b.cat = p.category;
        if (p.version) b.version = p.version;
        b.enabled = p.enabled !== false;
      }
    });
    /* ③ 快捷方式表里残留的历史项也保留，绝不丢用户数据 */
    Object.keys(iconIds).forEach(function (id) {
      if (byId[id]) return;
      var x = iconIds[id];
      byId[id] = {
        id: id, name: x.name || id, en: id, cat: x.category || '插件',
        icon: x.icon || 'box', desc: '', version: '1.0.0',
        builtin: !!x.builtin, enabled: true, source: 'shortcut',
        deskDefault: false, hasWindow: false
      };
      order.push(id);
    });
    return order.map(function (id) {
      var b = byId[id];
      b.onDesk = !hidden[id] && (b.deskDefault || !!iconIds[id]);
      b.installed = true;
      return b;
    });
  }
  V.catalog = catalog;
  function catFind(id) {
    var a = catalog();
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }
  function deskRepaint() {
    try { if (typeof renderDeskIcons === 'function') renderDeskIcons(); } catch (e) {}
    try { R('appcenter'); } catch (e) {}
  }
  function deskUnhide(id) {
    var h = loadHidden();
    if (h[id]) { delete h[id]; saveHidden(); }
  }
  V.deskUnhide = deskUnhide;
  function deskHide(id) {
    if (!id) return;
    var p = catFind(id), h = loadHidden();
    h[id] = 1; saveHidden();
    /* 上传插件同时登记在后端快捷方式表里，一并撤掉让两处状态一致 */
    var inIcons = false;
    try {
      inIcons = ((NasDeck.v14 && NasDeck.v14.icons && NasDeck.v14.icons.list) || [])
        .some(function (x) { return x && x.id === id; });
    } catch (e) {}
    if (inIcons) {
      api('/api/plugins/icons', { act: 'remove', id: id }).then(function (r) {
        try { if (r && r.icons && NasDeck.v14 && NasDeck.v14.icons) NasDeck.v14.icons.list = r.icons; } catch (e) {}
        deskRepaint();
      }).catch(function () {});
    }
    deskRepaint();
    T('已隐藏桌面图标', (p && p.name || id) + ' 仍在应用清单里，可随时恢复', 'ok');
  }
  V.deskHide = deskHide;
  function deskShow(id) {
    var p = catFind(id);
    deskUnhide(id);
    if (p) {
      api('/api/plugins/icons', {
        act: 'add', id: id, name: p.name, icon: p.icon,
        category: p.cat, builtin: !!p.builtin
      }).then(function (r) {
        try { if (r && r.icons && NasDeck.v14 && NasDeck.v14.icons) NasDeck.v14.icons.list = r.icons; } catch (e) {}
        deskRepaint();
      }).catch(function () {});
    }
    deskRepaint();
    T('已显示到桌面', (p && p.name) || id, 'ok');
  }
  V.deskShow = deskShow;
  function ensureDeskStyle() {
    if (document.getElementById('nasdeck-v15-desk-style')) return;
    var el = document.createElement('style');
    el.id = 'nasdeck-v15-desk-style';
    el.textContent = '#desk-icons{overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}'
      + '#desk-icons .di{position:relative}'
      + '#desk-icons .di:hover .v14-ic-x{opacity:1}'
      + '#desk-icons .v15-picon{flex:none}';
    document.head.appendChild(el);
  }
  function deskIconsHtml() {
    ensureDeskStyle();
    return catalog().filter(function (p) { return p.onDesk; }).map(function (p) {
      var ext = (p.source === 'uploaded' || p.source === 'shortcut');
      var delAct = ext ? 'v14-icon-del' : 'v15-desk-hide';
      return '<div class="di' + (ext ? ' v14-plugin' : ' nasdeck-app') + '" data-di="' + E(p.id) + '"'
        + (ext ? ' data-v14-icon="' + E(p.id) + '"' : '')
        + ' title="' + E(p.name) + '（双击打开 · × 只隐藏桌面图标，不卸载应用）">'
        + '<button class="v14-ic-x" data-act="' + delAct + '" data-id="' + E(p.id)
        + '" title="只隐藏桌面图标，不卸载应用">×</button>'
        + pluginIcon(p, 46) + '<span>' + E(p.name) + '</span></div>';
    }).join('');
  }
  V.deskIconsHtml = deskIconsHtml;

  function pluginCard(p0) {
    var p = p0 || {};
    var cat = catFind(p.id);
    var onDesk = cat ? !!cat.onDesk : false;
    var acts;
    if (p.builtin) acts = btn('plg-open', '打开', 'data-id="' + E(p.id) + '"', 'primary', 'external');
    else acts = btn('plg-run', '运行', 'data-id="' + E(p.id) + '"', 'primary', 'play') + ' ' +
      btn('plg-view', '源码', 'data-id="' + E(p.id) + '"', '', 'file') + ' ' +
      btn('plg-toggle', p.enabled ? '停用' : '启用',
        'data-id="' + E(p.id) + '" data-v="' + (p.enabled ? '0' : '1') + '"', '', p.enabled ? 'pause' : 'play') + ' ' +
      btn('plg-remove', '删除', 'data-id="' + E(p.id) + '"', 'danger', 'trash');
    /* 同一个应用，两处呈现：App Center 直接切换它在桌面上的快捷方式 */
    if (onDesk) {
      acts += ' ' + btn('v15-desk-hide', '从桌面隐藏', 'data-id="' + E(p.id) + '"', '', 'grid');
    } else {
      acts += ' ' + btn('v14-icon-add', '显示到桌面', 'data-id="' + E(p.id) + '" data-name="' + E(p.name || p.id) +
        '" data-icon="' + E(p.icon || 'box') + '" data-cat="' + E(p.category || p.cat || '应用') +
        '" data-builtin="' + (p.builtin ? '1' : '0') + '"', '', 'grid');
    }
    return '<div class="v15-pcard' + (p.enabled === false ? ' off' : '') + '">' +
      '<div class="top">' + pluginIcon(p, 52) +
      '<div class="nm"><b>' + E(p.name) + '</b><small>' + E(p.en || p.id) + ' · v' + E(p.version || 'N/A') + '</small></div></div>' +
      '<p class="desc">' + E(p.description || p.desc || '') + '</p>' +
      '<div class="tags"><span class="v15-tag info">' + E(p.category || p.cat || '应用') + '</span>' +
      '<span class="v15-tag ' + (p.builtin ? 'ok' : '') + '">' + (p.builtin ? '内置功能' : '用户上传') + '</span>' +
      '<span class="v15-tag ' + (p.enabled ? 'ok' : 'warn') + '">' + (p.enabled ? '已启用' : '已停用') + '</span>' +
      '<span class="v15-tag ' + (onDesk ? 'ok' : 'warn') + '">' + (onDesk ? '桌面已显示' : '未显示到桌面') + '</span>' +
      (p.manifestOk === false ? '<span class="v15-tag warn">manifest 缺失</span>' : '') +
      (p.hasRegister === false ? '<span class="v15-tag warn">缺注册调用</span>' : '') + '</div>' +
      '<div class="ops">' + acts + '</div></div>';
  }
  V.pluginIcon = pluginIcon; V.pluginCard = pluginCard;

  /* ================================================================ 需求 10
   * 沉浸式媒体播放页：音频 = 蓝色顶栏 + 中央大黑场封面 + 底部固定播放条（酷狗式）；
   * 视频 = 深色顶栏 + 大播放器 + 右侧选集/信息 + 下方推荐横排（腾讯视频式）。
   * 复用 v14 的 DOM id（v14-audio / v14-video / v14-seek / v14-time / v14-play-btn /
   * v14-vol），这样 v14 已注册的播放 / 进度 / 音量动作无需重写。 */
  function playerTop(kind, title) {
    return '<div class="v15-pl-top">' +
      '<div class="brand"><i>' + (kind === 'video' ? '▶' : '♫') + '</i>' +
      (kind === 'video' ? '影音中心' : '音乐中心') + '</div>' +
      '<div class="navlinks"><span class="on">' + (kind === 'video' ? '首页' : '首页') + '</span>' +
      '<span>' + (kind === 'video' ? '剧集' : '榜单') + '</span><span>' + (kind === 'video' ? '电影' : '歌单') + '</span>' +
      '<span>' + (kind === 'video' ? '综艺' : '电台') + '</span><span>' + (kind === 'video' ? '动漫' : '下载客户端') + '</span></div>' +
      '<div class="search">' + G('search', 12, '#fff') +
      '<input placeholder="搜索本机' + (kind === 'video' ? '影片' : '音乐') + '" value="' + E(title || '') + '" readonly></div></div>';
  }
  function plRow(it, x, i, idx, id, kind) {
    var sub = kind === 'music' ? (x.artist || 'N/A') + ' · ' + (x.durText || 'N/A')
      : (x.durText || 'N/A') + ' · ' + (x.szText || 'N/A');
    return '<button class="v14-pl-row ' + (i === idx ? 'on' : '') + '" data-act="v14-med-play" data-app="' + id +
      '" data-p="' + E(x.path) + '"><span>' + E(x.title || x.n) + '</span>' +
      '<small style="opacity:.65;font-size:10px;white-space:nowrap">' + E(sub) + '</small></button>';
  }
  function playerPage(id, ctx) {
    var cfg = ctx.cfg, list = ctx.list || [], idx = ctx.idx, kind = ctx.kind;
    if (idx < 0 || !list[idx]) return '';
    var it = list[idx], det = ctx.det || {}, ditem = det.item || it, tx = det.text || {};
    var back = '<button class="v14-btn" data-act="v14-med-back" data-app="' + id + '">← 媒体库</button>';
    var main, bottom = '';

    if (kind === 'music') {
      var cover = ctx.cover(it);
      var lyrics = tx.lyrics || it.lyrics || '（本机文件未内嵌歌词，也没有同名 LRC · N/A）';
      var mm = playerTop('audio', it.title || it.n) +
        '<div style="flex:none;display:flex;align-items:center;gap:8px;padding:7px 16px;border-bottom:1px solid rgba(120,170,210,.12);font-size:10.5px;color:#8fb0c7">' +
        back + '<span class="v15-tag info">' + (idx + 1) + ' / ' + list.length + '</span>' +
        '<span>' + E(it.title || it.n) + '</span><span class="sp" style="flex:1"></span>' +
        '<span>本机音频 · WinNAS 引擎</span></div>';
      main = mm + '<div class="v15-pl-main">' +
        '<div class="v15-audio-stage">' +
        '<div class="v15-audio-cover">' + (cover.indexOf('<img') >= 0 ? cover : '<div class="ph">♫ 无封面</div>') + '</div>' +
        '<div class="v15-audio-title"><b>' + E(it.title || it.n) + '</b><span>' +
        E(it.artist || 'N/A') + ' · ' + E(it.album || 'N/A') + ' · ' + E(it.durText || 'N/A') + '</span></div>' +
        '<a class="v15-audio-dl" href="' + E(url(it.url)) + '" download="' + E(it.n) + '">下载这首歌</a>' +
        '<pre class="v15-audio-lyrics">' + E(lyrics) + '</pre></div>' +
        '<div class="v15-pl-side"><div class="hd">播放列表 · ' + list.length + ' 首</div>' +
        '<div class="lst">' + list.map(function (x, i) { return plRow(it, x, i, idx, id, kind); }).join('') + '</div>' +
        '<div class="hd">文件信息</div><div class="v15-meta" style="padding:9px 11px;font-size:10.5px;overflow:auto">' +
        '<div class="kv"><span class="k">文件</span><span class="v">' + E(it.n) + '</span></div>' +
        '<div class="kv"><span class="k">大小</span><span class="v">' + E(it.szText || 'N/A') + '</span></div>' +
        '<div class="kv"><span class="k">路径</span><span class="v mono" style="word-break:break-all">' + E(it.path || 'N/A') + '</span></div>' +
        '</div></div></div>' +
        /* 底部固定播放条：id 与 v14 动作保持一致 */
        '<div class="v15-playbar">' +
        '<div class="ctl">' +
        '<button data-act="v14-med-prev" data-app="' + id + '" title="上一首">⏮</button>' +
        '<button class="primary" data-act="v14-med-toggle" data-app="' + id + '" id="v14-play-btn" title="播放 / 暂停">⏸</button>' +
        '<button data-act="v14-med-next" data-app="' + id + '" title="下一首">⏭</button></div>' +
        '<div class="mini">' + (cover.indexOf('<img') >= 0 ? cover : '♫') + '</div>' +
        '<div class="track"><span class="nm">' + E(it.title || it.n) + ' <span style="opacity:.6">- ' + E(it.artist || 'N/A') + '</span></span>' +
        '<input type="range" class="seek" id="v14-seek" min="0" max="100" value="0"></div>' +
        '<span class="tm" id="v14-time">0:00 / ' + E(it.durText || 'N/A') + '</span>' +
        '<div class="extra">' + G('volume', 12) +
        '<input type="range" id="v14-vol" min="0" max="100" value="' + Math.round((ctx.V14.media.volume || .8) * 100) + '" style="width:66px;accent-color:#22a7e8">' +
        '<button data-act="v14-med-loop" data-app="' + id + '">' + (ctx.V14.media.loop ? '循环：开' : '循环：关') + '</button>' +
        '<button data-act="v14-med-next" data-app="' + id + '" title="播放列表">☰ ' + list.length + '</button></div>' +
        '<audio id="v14-audio" src="' + E(url(it.url)) + '" autoplay' + (ctx.V14.media.loop ? ' loop' : '') + '></audio>' +
        '</div>';
      return '<div class="app v14-player v15-pl">' + main + '</div>';
    }

    if (kind === 'video') {
      var vtt = (ditem.subtitles || it.subtitles || []).filter(function (s) { return /\.vtt$/i.test(s.n); })[0];
      var vm = playerTop('video', it.title || it.n) +
        '<div style="flex:none;display:flex;align-items:center;gap:8px;padding:7px 16px;border-bottom:1px solid rgba(120,170,210,.12);font-size:10.5px;color:#8fb0c7">' +
        back + '<b style="font-size:12px">精彩免费试看</b><span class="sp" style="flex:1"></span>' +
        '<span>' + (idx + 1) + ' / ' + list.length + ' · 本机影片</span></div>';
      var recs = list.map(function (x, i) {
        var th = x.cover && x.cover.url ? '<img src="' + E(url(x.cover.url)) + '" alt="">' : (i + 1);
        return '<div class="v15-rec ' + (i === idx ? 'on' : '') + '" data-act="v14-med-play" data-app="' + id +
          '" data-p="' + E(x.path) + '"><div class="thumb">' + th + '</div><small>' + E(x.title || x.n) + '</small></div>';
      }).join('');
      var eps = list.map(function (x, i) {
        return '<div class="ep ' + (i === idx ? 'on' : '') + '" data-act="v14-med-play" data-app="' + id +
          '" data-p="' + E(x.path) + '">第 ' + (i + 1) + ' 集 · ' + E(x.title || x.n) + '</div>';
      }).join('');
      main = vm + '<div class="v15-pl-main">' +
        '<div class="v15-video-wrap">' +
        '<div class="v15-video-stage"><video id="v14-video" controls autoplay playsinline src="' + E(url(it.url)) + '">' +
        (vtt ? '<track kind="subtitles" src="' + E(url(vtt.url)) + '" srclang="zh" label="' + E(vtt.n) + '" default>' : '') +
        '</video></div>' +
        '<div class="v15-video-info"><div><h3>' + E(it.title || it.n) + '</h3>' +
        '<div class="meta">' + E(it.szText || 'N/A') + ' · ' + E(it.durText || 'N/A') + ' · ' + E(it.d || 'N/A') +
        '<br><span class="mono">' + E(it.path || 'N/A') + '</span></div></div>' +
        '<button class="go" data-act="v14-med-full" data-app="' + id + '">全屏播放</button></div>' +
        '<div class="v15-sec" style="margin:2px 0 4px">为你推荐 · 本机影片</div>' +
        '<div class="v15-recs">' + recs + '</div></div>' +
        '<div class="v15-pl-side"><div class="hd">选集 · ' + list.length + ' 部</div>' +
        '<div class="lst">' + eps + '</div>' +
        '<div class="hd">影片信息</div><div class="v15-meta" style="padding:9px 11px;font-size:10.5px;overflow:auto">' +
        ctx.metaRows(ditem, tx, kind) + '</div></div></div>';
      return '<div class="app v14-player v15-pl">' + main + '</div>';
    }
    return '';   /* 图片沿用 v14 原页面 */
  }
  V.playerPage = playerPage;

  /* ================================================================ 动作注册
   * 全部用 v15- 前缀，不与 real / winnas 既有动作冲突；幂等，可被守卫重复调用。 */
  function installActions() {
    if (typeof ACT !== 'object' || !ACT) return;
    ACT['v15-close'] = function () {
      /* 用户关窗后，任何在途的预览请求都不应再弹出新窗口。 */
      V.seq++;
      V.S.previewBusy = false;
      closeModal('all');
      document.querySelectorAll('.v15-mask').forEach(function (m) { m.remove(); });
    };
    ACT['v15-reg-add'] = function () { regAddDlg(); };
    ACT['v15-reg-add-go'] = function () { regAddGo(); };
    ACT['v15-reg-refresh'] = function () { regLoad(true); T('已刷新仓库清单', '', 'ok'); };
    ACT['v15-reg-login'] = function (e, d) { regLoginDlg((d || {}).id); };
    ACT['v15-reg-login-go'] = function (e, d) { regLoginGo((d || {}).id); };
    ACT['v15-reg-logout'] = function (e, d) { regAct('logout', (d || {}).id); };
    ACT['v15-reg-test'] = function (e, d) { regAct('test', (d || {}).id); };
    ACT['v15-reg-del'] = function (e, d) { regAct('del', (d || {}).id); };
    ACT['v15-reg-del-go'] = function (e, d) {
      api('/api/docker/registries', { act: 'remove', id: (d || {}).id }).then(function (r) {
        if (!r.ok) throw new Error(r.error || '删除失败');
        T('已删除仓库', '', 'ok'); closeModal('del'); return regLoad(true);
      }).catch(function (er) { T('删除失败', err(er), 'err'); });
    };
    ACT['v15-upd-check'] = function () { T('正在检测镜像更新', '对比本地与远端 digest', 'info'); updLoad(true); };
    ACT['v15-ct-update'] = function (e, d) { doUpdate((d || {}).id); };
    ACT['v15-ct-update-go'] = function (e, d) { doUpdateGo((d || {}).id); };
    ACT['v15-ct-recreate'] = function (e, d) { recreateDlg((d || {}).id); };
    ACT['v15-ct-recreate-go'] = function (e, d) { recreateGo((d || {}).id); };
    ACT['v15-file-save'] = function () { savePreview(); };
    ACT['v15-preview-dl'] = function () { previewDl(); };
    ACT['v15-preview-immersive'] = function (e, d) {
      var p = V.S.preview; if (!p) return;
      V.seq++;
      closeModal('all'); document.querySelectorAll('.v15-mask').forEach(function (m) { m.remove(); });
      try {
        var it = {
          n: p.f.n, path: p.info.path, url: p.info.url, title: p.f.n,
          kind: (d || {}).kind === 'img' ? 'photo' : ((d || {}).kind === 'aud' ? 'music' : 'video'),
          artist: 'N/A', album: 'N/A', durText: 'N/A', szText: fmtSize(p.info.size),
          d: fmtT(p.info.mtime), cover: null, lyrics: null, subtitles: [], meta: {}
        };
        var app = (d || {}).kind === 'img' ? 'photodeck' : ((d || {}).kind === 'aud' ? 'music' : 'video');
        if (NasDeck.v14 && typeof NasDeck.v14.openSingle === 'function') NasDeck.v14.openSingle(app, it);
      } catch (er) { T('打开播放页失败', err(er), 'err'); }
    };
    ACT['v15-fs-tab'] = function (e, d) {
      var v = (d || {}).t;
      /* v16.3：透传三个 tab（操作历史已移除）；其余值回落到 files。复用 winnas 的 fsx-tab */
      var t = (v === 'shares' || v === 'transfer') ? v : 'files';
      try { if (typeof ACT['fsx-tab'] === 'function') ACT['fsx-tab'](null, { t: t }); } catch (er) {}
    };
    ACT['v15-more'] = function () { moreToggle(); };
    ACT['v15-desk-hide'] = function (e, d) { if (d && d.id) deskHide(d.id); };
    ACT['v15-desk-show'] = function (e, d) { if (d && d.id) deskShow(d.id); };
    V.actDone = true;
  }
  V.installActions = installActions;

  /* ---------------------------------------------------------------- 守卫 */
  function dkrTab() { try { return (NasDeck.dkr || {}).tab || ''; } catch (e) { return ''; } }
  function sharesRef() { try { return NasDeck.shares || { items: [] }; } catch (e) { return { items: [] }; } }
  function enforce() {
    try { style(); } catch (e) {}
    try {
      if (!V.actDone || typeof ACT !== 'object' || !ACT || typeof ACT['v15-reg-add'] !== 'function') installActions();
    } catch (e) {}
    try { shareInputListen(); } catch (e) {}
    /* 需求 9：只在视口变化或工具条结构签名变化时重算，避免每 1.5s 抖动 */
    try {
      var tb = document.querySelector('.v15-toolbar');
      if (tb) {
        var sig = tb.clientWidth + ':' + tb.children.length + ':' + innerWidth;
        if (sig !== V.S.lastFitSig) { V.S.lastFitSig = sig; fitToolbar(); }
      }
    } catch (e) {}
    /* 统一清单：插件上传 / 删除 / 快捷方式变化后，桌面与 App Center 同步重绘 */
    try {
      var sig = catalog().map(function (p) { return p.id + ':' + (p.onDesk ? 1 : 0) + ':' + (p.enabled ? 1 : 0); }).join('|');
      if (sig !== V.S.lastCatSig) { V.S.lastCatSig = sig; if (V.S.catSigReady) deskRepaint(); V.S.catSigReady = true; }
    } catch (e) {}
    /* 需求 1/2：登录后首次拉取；容器标签打开时才做更新检测（60s 节流） */
    try {
      if (NasDeck.token && !V.S.regsLoaded && !V.S.regsBusy) regLoad();
      if (NasDeck.token && dkrTab() === 'containers' && !V.S.updBusy && now() - V.S.updAt > 60000) updLoad();
    } catch (e) {}
  }
  V.enforce = enforce;

  /* 全局点击：点遮罩空白处关闭；点下拉菜单外收起 */
  document.addEventListener('click', function (e) {
    try {
      if (e.target && e.target.classList && e.target.classList.contains('v15-mask')) e.target.remove();
      var menu = document.querySelector('.v15-more-menu');
      if (menu && !menu.hidden && e.target && !menu.contains(e.target) &&
          !(e.target.closest && e.target.closest('.v15-more-btn'))) {
        menu.hidden = true; V.S.moreOpen = false;
        var mb = document.querySelector('.v15-more-btn'); if (mb) mb.classList.remove('on');
      }
    } catch (er) {}
  }, true);
  window.addEventListener('resize', function () {
    try {
      /* 尺寸变化必须先收起菜单，再允许 fitToolbar 重新测量按钮。 */
      V.S.moreOpen = false;
      var m = document.querySelector('.v15-more-menu'); if (m) m.hidden = true;
      var b = document.querySelector('.v15-more-btn'); if (b) b.classList.remove('on');
      V.S.lastFitSig = ''; fitToolbar();
    } catch (e) {}
  });

  style();
  installActions();
  shareInputListen();
  setInterval(enforce, 1500);
})();
//__NasDeck_V15_END__
