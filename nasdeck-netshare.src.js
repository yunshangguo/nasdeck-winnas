//__NasDeck_NS_START__
/* ==================================================================
 * nasdeck-netshare.src.js — v16：断点续传 + WebDAV / SMB 网络共享
 *
 * 设计约束（与既有注入层共存）：
 *   · 不替换任何 RENDER 引用，只新增 RENDER.netshare / MOUNT.netshare；
 *     real 层的 enforceAll() 每 1.5s 还原 container/appcenter，不碰新键。
 *   · 只覆盖文件总管的 fsx-upload / fsx-download 两个动作，
 *     用守卫在动作被别的层改回去时重新装回。
 *   · 应用注册同时兼容 APPS_INSTALLED 被 NasDeck.hydrate 的 obj() 清空。
 *   · 所有协议能力都走后端 /api/transfer/* 与 /api/netshare/*，
 *     前端不持有任何协议实现，也不保存明文凭据。
 * ================================================================== */
(function () {
  'use strict';
  var NS = window.NasDeck_NS = {
    S: {
      tab: 'transfer', uploads: [], downloads: [], dav: null, smb: null,
      mounts: [], cfg: null, mount: null, mountPath: '', mountRows: [],
      /* 协议通信任务（后端任务池镜像）与文件管理器任务分开存放，绝不合并 */
      proto: [], protoSig: '', protoReq: {}, protoBusy: false, lastProto: 0,
      /* 统一文件操作任务池：v16.3 起上传/下载/复制/移动/删除/新建/重命名
         全部登记到这一条时间线，传输进度面板只渲染它，不再分区分通道。 */
      ops: [],
      busy: false, seq: 0, lastSig: '', lastFull: 0, uiSeq: 0
    }
  };
  var S = NS.S;
  var E = function (x) {
    var s = String(x === null || x === undefined ? '' : x);
    try { if (typeof esc === 'function') return esc(s); } catch (e) {}
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var enc = encodeURIComponent;
  function fmtB(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function toast(t, m, k) { try { if (typeof window.toast === 'function') window.toast(t, m, k || 'info'); } catch (e) {} }
  function api(p, body) {
    if (body === undefined) return NasDeck.get(p);
    return NasDeck.post(p, body || {});
  }
  function curPath() {
    try { return (typeof FS_STATE !== 'undefined' && FS_STATE.path) || '/'; } catch (e) { return '/'; }
  }
  function applyFiles(r) {
    try { if (typeof NasDeck.applyFiles === 'function') NasDeck.applyFiles(r); }
    catch (e) { try { rerender('filestation'); } catch (x) {} }
  }
  function saveLocal() {
    try {
      localStorage.setItem('nasdeck_ns_uploads', JSON.stringify(S.uploads.map(function (t) {
        return { id: t.id, uploadId: t.uploadId, name: t.name, size: t.size,
          chunkSize: t.chunkSize, path: t.path, lastModified: t.lastModified, state: t.state };
      })));
    } catch (e) {}
  }
  function loadLocal() {
    try { return JSON.parse(localStorage.getItem('nasdeck_ns_uploads') || '[]') || []; } catch (e) { return []; }
  }
  /* 协议任务 id 由前端先生成并回传后端，前端据此绑定「取消」（abort 本地请求） */
  function newProtoId() {
    return 'pt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------------------------------------------------------------- 样式 */
  function style() {
    if (document.getElementById('nasdeck-ns-style')) return;
    var st = document.createElement('style');
    st.id = 'nasdeck-ns-style';
    st.textContent = [
      '.ns-wrap{display:flex;flex-direction:column;height:100%;min-height:0;gap:10px;font-size:13px}',
      '.ns-tabs{display:flex;gap:6px;flex:none;flex-wrap:wrap;border-bottom:1px solid var(--line,rgba(128,128,128,.3));padding-bottom:8px}',
      '.ns-tabs button{border:1px solid var(--line,rgba(128,128,128,.3));background:transparent;color:inherit;border-radius:7px;padding:7px 13px;cursor:pointer;font-size:12px}',
      '.ns-tabs button.on{background:rgba(34,167,232,.16);color:var(--accent,#22a7e8);border-color:var(--accent,#22a7e8)}',
      '.ns-body{flex:1;min-height:0;overflow:auto;padding-right:4px}',
      '.ns-card{border:1px solid var(--line,rgba(128,128,128,.28));border-radius:9px;padding:12px 14px;margin-bottom:12px;background:rgba(127,127,127,.045)}',
      '.ns-card h4{margin:0 0 9px;font-size:13px;font-weight:600}',
      '.ns-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:7px 0}',
      '.ns-row label{min-width:110px;opacity:.85;font-size:12px}',
      '.ns-in{border:1px solid var(--line,rgba(128,128,128,.4));background:transparent;color:inherit;border-radius:6px;padding:6px 9px;font-size:12px;min-width:180px;flex:1}',
      '.ns-in[type=checkbox]{min-width:auto;flex:none;width:15px;height:15px}',
      '.ns-btn{border:1px solid var(--line,rgba(128,128,128,.4));background:transparent;color:inherit;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;white-space:nowrap}',
      '.ns-btn:hover{border-color:var(--accent,#22a7e8);color:var(--accent,#22a7e8)}',
      '.ns-btn.pri{background:var(--accent,#22a7e8);border-color:var(--accent,#22a7e8);color:#fff}',
      '.ns-btn.warn{border-color:#d97757;color:#d97757}',
      '.ns-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.ns-tbl{width:100%;border-collapse:collapse;font-size:12px}',
      '.ns-tbl th,.ns-tbl td{padding:7px 8px;border-bottom:1px solid var(--line,rgba(128,128,128,.2));text-align:left;vertical-align:middle}',
      '.ns-tbl th{opacity:.7;font-weight:600;white-space:nowrap}',
      '.ns-bar{height:6px;border-radius:4px;background:rgba(128,128,128,.22);overflow:hidden;min-width:90px}',
      '.ns-bar i{display:block;height:100%;background:var(--accent,#22a7e8);border-radius:4px;transition:width .25s}',
      '.ns-tag{display:inline-block;border-radius:5px;padding:2px 7px;font-size:11px;border:1px solid var(--line,rgba(128,128,128,.35))}',
      '.ns-tag.ok{color:#2bb673;border-color:#2bb673}.ns-tag.err{color:#d97757;border-color:#d97757}',
      '.ns-tag.off{opacity:.65}',
      '.ns-hint{font-size:11px;opacity:.72;line-height:1.65;margin:6px 0 0}',
      '.ns-mono{font-family:Consolas,Monaco,monospace;font-size:11px;word-break:break-all}',
      '.ns-empty{opacity:.6;padding:16px;text-align:center;font-size:12px}',
      '.ns-crumb{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:9px;font-size:12px}',
      '.ns-crumb button{border:none;background:transparent;color:var(--accent,#22a7e8);cursor:pointer;padding:0;font-size:12px}',
      '.ns-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}',
      '.ns-sum{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:9px}',
      '.ns-sum div{flex:1;min-width:190px;border:1px solid var(--line,rgba(128,128,128,.28));border-radius:8px;padding:9px 12px;background:rgba(127,127,127,.04)}',
      '.ns-sum b{font-size:17px;margin-right:4px}.ns-sum span{font-size:11px;opacity:.7}',
      '.ns-chan{border:1px solid var(--line,rgba(128,128,128,.35));border-left:3px solid var(--accent,#22a7e8);border-radius:9px;padding:10px 12px 2px;margin-bottom:14px;background:rgba(34,167,232,.045)}',
      '.ns-chan.proto{border-left-color:#8b7af0;background:rgba(139,122,240,.055)}',
      '.ns-chan-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:13px;font-weight:600;margin:0 0 4px}',
      '.ns-chan-no{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border-radius:50%;background:var(--accent,#22a7e8);color:#fff;font-size:11px;flex:none}',
      '.ns-chan.proto .ns-chan-no{background:#8b7af0}',
      '.ns-chan .ns-card{background:rgba(127,127,127,.035)}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- 应用注册 */
  function installApp() {
    try {
      if (typeof APPS === 'object' && APPS && !APPS.netshare) {
        APPS.netshare = {
          name: '传输与共享', en: 'Transfer & Sharing', cat: '文件', icon: 'folder',
          g1: '#2aa7d8', g2: '#12557f', w: 1040, h: 690,
          desc: '断点续传 · WebDAV 服务 · SMB 共享 · 远程挂载', desk: 1, pin: 1
        };
      }
      if (typeof APPS_INSTALLED === 'object' && APPS_INSTALLED) APPS_INSTALLED.netshare = 1;
      if (typeof RENDER === 'object' && RENDER) RENDER.netshare = render;
      if (typeof MOUNT === 'object' && MOUNT) MOUNT.netshare = mount;
    } catch (e) {}
  }

  var TABS = [
    ['transfer', '传输任务'], ['webdav', 'WebDAV 服务'],
    ['smb', 'SMB 共享'], ['mounts', '远程挂载']
  ];
  function render() {
    var h = '<div class="ns-wrap"><div class="ns-tabs">' + TABS.map(function (t) {
      return '<button data-ns="tab" data-tab="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '">' + E(t[1]) + '</button>';
    }).join('') + '</div><div class="ns-body">';
    if (S.tab === 'transfer') h += renderTransfer();
    else if (S.tab === 'webdav') h += renderWebdav();
    else if (S.tab === 'smb') h += renderSmb();
    else h += renderMounts();
    return h + '</div></div>';
  }

  /* ---------------------------------------------------------------- 传输任务 */
  function taskRow(t, kind) {
    var pct = t.size ? Math.min(100, Math.round((t.got || 0) / t.size * 100)) : 0;
    var stMap = { running: '传输中', paused: '已暂停', done: '已完成', error: '失败', canceled: '已取消' };
    var cls = t.state === 'done' ? 'ok' : (t.state === 'error' ? 'err' : (t.state === 'paused' ? 'off' : ''));
    var acts = '';
    if (t.state === 'running') acts += '<button class="ns-btn" data-ns="' + kind + '-pause" data-id="' + E(t.id) + '">暂停</button> ';
    if (t.state === 'paused' || t.state === 'error') acts += '<button class="ns-btn pri" data-ns="' + kind + '-resume" data-id="' + E(t.id) + '">' + (t.state === 'error' ? '重试' : '继续') + '</button> ';
    if (t.state !== 'done' && t.state !== 'running') acts += '<button class="ns-btn warn" data-ns="' + kind + '-remove" data-id="' + E(t.id) + '">移除</button>';
    if (t.state === 'done') acts += '<button class="ns-btn" data-ns="' + kind + '-remove" data-id="' + E(t.id) + '">清除</button>';
    if (kind === 'up' && t.state === 'paused' && t.needsFile) acts += '<button class="ns-btn" data-ns="up-pick" data-id="' + E(t.id) + '">选择原文件续传</button>';
    return '<tr><td>' + E(t.name) + (t.renamed ? '<br><span class="ns-hint">另存为 ' + E(t.renamed) + '</span>' : '') +
      '</td><td>' + fmtB(t.size) + '</td><td style="min-width:150px"><div class="ns-bar"><i data-bar="' + E(t.id) + '" style="width:' + pct + '%"></i></div>' +
      '<span data-pct="' + E(t.id) + '" class="ns-hint">' + pct + '% · ' + fmtB(t.got || 0) + (t.speed ? ' · ' + fmtB(t.speed) + '/s' : '') + '</span></td>' +
      '<td><span class="ns-tag ' + cls + '">' + E(stMap[t.state] || t.state) + '</span>' +
      (t.error ? '<br><span class="ns-hint">' + E(String(t.error).slice(0, 60)) + '</span>' : '') +
      '</td><td>' + acts + '</td></tr>';
  }
  /* 协议通信任务行：与文件管理器任务行分列不同，显示协议 / 来源 / 方向 */
  function protoRow(t) {
    var pct = t.size ? Math.min(100, Math.round((t.got || 0) / t.size * 100)) : (t.state === 'done' ? 100 : 0);
    var stMap = { running: '传输中', done: '已完成', error: '失败', canceled: '已取消' };
    var cls = t.state === 'done' ? 'ok' : (t.state === 'error' ? 'err' : 'off');
    var acts = '';
    if (t.state === 'running') acts += '<button class="ns-btn warn" data-ns="pt-cancel" data-id="' + E(t.id) + '">取消</button> ';
    if (t.state !== 'running') acts += '<button class="ns-btn" data-ns="pt-remove" data-id="' + E(t.id) + '">清除</button>';
    return '<tr><td>' + E(t.name) + '<br><span class="ns-hint ns-mono">' + E(t.path || '') + '</span></td>' +
      '<td><span class="ns-tag ' + (t.proto === 'WEBDAV' ? 'ok' : '') + '">' + E(t.proto) + '</span>' +
      '<br><span class="ns-hint">' + (t.via === 'server' ? '本机服务端' : E(t.mount || '远程挂载')) + '</span></td>' +
      '<td>' + (t.dir === 'up' ? '↑ 上传' : '↓ 下载') + '</td><td>' + fmtB(t.size) + '</td>' +
      '<td style="min-width:140px"><div class="ns-bar"><i data-bar="' + E(t.id) + '" style="width:' + pct + '%"></i></div>' +
      '<span data-pct="' + E(t.id) + '" class="ns-hint">' + pct + '% · ' + fmtB(t.got || 0) + '</span></td>' +
      '<td><span class="ns-tag ' + cls + '">' + E(stMap[t.state] || t.state) + '</span>' +
      (t.error ? '<br><span class="ns-hint">' + E(String(t.error).slice(0, 50)) + '</span>' : '') + '</td>' +
      '<td>' + acts + '</td></tr>';
  }
  function renderTransfer() {
    /* v16.4：「传输与共享」页只显示 WebDAV / SMB 协议通信任务。
       文件管理器的上传 / 下载 / 复制 / 移动 / 删除等操作只在
       「文件管理 → 传输进度」页显示，两页职责彻底分开。 */
    return opsTableHtml('proto');
  }
  /* 上次未完成的上传恢复入口（断点续传）——属于文件管理器的上传任务，
     v16.4 起从「传输与共享」页移到「文件管理 → 传输进度」页。 */
  function pendingUploadHtml() {
    var pending = loadLocal().filter(function (x) { return x.state !== 'done' && x.uploadId; });
    if (!pending.length) return '';
    return '<div class="ns-card"><h4>上次未完成的上传（' + pending.length + '）</h4>' +
      '<div class="ns-hint">刷新页面后文件对象会丢失，点「恢复」重新选择同一个文件即可从已上传分片继续。</div>' +
      pending.map(function (x) {
        return '<div class="ns-row"><span style="flex:1">' + E(x.name) + ' · ' + fmtB(x.size) + '</span>' +
          '<button class="ns-btn pri" data-ns="up-restore" data-uid="' + E(x.uploadId) + '">恢复</button>' +
          '<button class="ns-btn warn" data-ns="up-forget" data-uid="' + E(x.uploadId) + '">放弃</button></div>';
      }).join('') + '</div>';
  }

  /* ------------------------------------------- v16.3 统一传输进度列表
   * 上传/下载/复制/移动/删除/新建/重命名全部进 S.ops 一条时间线，不再分区、
   * 不再区分上传下载。列：操作/文件/起始目录/目标目录/大小/进度/创建时间/用时/状态/操作。
   * 停止按钮：running 时可用（terminate）；删除按钮：仅 done/canceled/error 终态可用。 */
  function ensureOps() {
    /* 兼容：首次加载时 S.ops 为空但引擎数组里已有任务（例如刷新前的旧状态），
       这里把它们补登记进统一池（同一对象引用，不复制）。 */
    var known = {};
    (S.ops || []).forEach(function (t) { known[t.id] = 1; });
    (S.uploads || []).concat(S.downloads || []).forEach(function (t) {
      if (!known[t.id]) {
        if (!t.op) t.op = t.kind === 'up' ? 'upload' : 'download';
        if (!t.createdAt) t.createdAt = Date.now();
        if (!t.srcDir) t.srcDir = t.kind === 'up' ? '本机文件' : (t.path || '/');
        if (!t.dstDir) t.dstDir = t.kind === 'up' ? (t.path || '/') : '本机保存位置';
        S.ops.unshift(t);
      }
    });
    /* 协议任务镜像：用固定前缀 id，刷新字段、清理已消失项，避免重复堆叠。 */
    var protoIds = {};
    (S.proto || []).forEach(function (t) {
      var mid = 'proto:' + t.id;
      protoIds[mid] = 1;
      var mirror = null;
      for (var i = 0; i < S.ops.length; i++) if (S.ops[i].id === mid) { mirror = S.ops[i]; break; }
      if (!mirror) {
        mirror = {
          id: mid, op: (t.dir === 'up' ? 'upload' : 'download'),
          name: t.name, srcDir: t.via === 'server' ? '外部客户端' : (t.mount || '远程挂载'),
          dstDir: t.path || '/', size: t.size || 0, got: t.got || 0,
          state: t.state, createdAt: t.createdAt || Date.now(), finishedAt: t.finishedAt || 0,
          elapsedMs: t.elapsedMs || 0, error: t.error || '', proto: t.proto || '', protoId: t.id
        };
        S.ops.unshift(mirror);
      } else {
        mirror.got = t.got || 0; mirror.state = t.state; mirror.error = t.error || '';
        mirror.finishedAt = t.finishedAt || mirror.finishedAt;
        if (isTerminal(mirror) && !mirror.finishedAt) { mirror.finishedAt = Date.now(); mirror.elapsedMs = Math.max(0, mirror.finishedAt - mirror.createdAt); }
      }
    });
    S.ops = S.ops.filter(function (t) { return !/^proto:/.test(t.id) || protoIds[t.id]; });
  }
  function opRow(t) {
    var pct = t.size ? Math.min(100, Math.round((t.got || 0) / t.size * 100)) : (isTerminal(t) ? 100 : 0);
    var stMap = { running: '传输中', paused: '已暂停', done: '已完成', error: '失败', canceled: '已停止' };
    var cls = t.state === 'done' ? 'ok' : (t.state === 'error' ? 'err' : (t.state === 'canceled' || t.state === 'paused' ? 'off' : ''));
    var opLabel = OP_LABEL[t.op] || t.op || '操作';
    var protoTag = t.proto ? '<br><span class="ns-hint">' + E(t.proto) + '</span>' : '';
    var acts = '';
    if (t.state === 'running') acts += '<button class="ns-btn warn" data-ns="op-stop" data-id="' + E(t.id) + '">停止</button>';
    if (isTerminal(t)) acts += '<button class="ns-btn" data-ns="op-remove" data-id="' + E(t.id) + '">删除任务</button>';
    if (t.state === 'paused') acts += '<span class="ns-hint">已暂停（不可删除）</span>';
    return '<tr>' +
      '<td><span class="ns-tag ' + cls + '">' + E(opLabel) + '</span>' + protoTag + '</td>' +
      '<td>' + E(t.name) + (t.error ? '<br><span class="ns-hint ns-mono">' + E(String(t.error).slice(0, 60)) + '</span>' : '') + '</td>' +
      '<td class="ns-mono">' + E(t.srcDir) + '</td>' +
      '<td class="ns-mono">' + E(t.dstDir) + '</td>' +
      '<td>' + (t.size ? fmtB(t.size) : '—') + '</td>' +
      '<td style="min-width:120px"><div class="ns-bar"><i data-bar="' + E(t.id) + '" style="width:' + pct + '%"></i></div>' +
      '<span data-pct="' + E(t.id) + '" class="ns-hint">' + pct + '%' + (t.size ? ' · ' + fmtB(t.got || 0) : '') + '</span></td>' +
      '<td class="ns-mono">' + timeText(t.createdAt) + '</td>' +
      '<td data-elapsed="' + E(t.id) + '">' + elapsedText(t) + '</td>' +
      '<td><span class="ns-tag ' + cls + '">' + E(stMap[t.state] || t.state) + '</span></td>' +
      '<td style="white-space:nowrap">' + (acts || '—') + '</td></tr>';
  }
  /* mode='proto' → 「传输与共享」页：只显示协议镜像任务（带 protoId，来自 WebDAV / SMB 后端任务池）。
     默认（无参）→ 「文件管理 → 传输进度」页：显示全部文件操作（上传/下载/复制/移动/删除/新建/重命名 + 协议镜像）。 */
  function opsTableHtml(mode) {
    ensureOps();
    var protoOnly = mode === 'proto';
    var ops = (S.ops || []).slice();
    if (protoOnly) ops = ops.filter(function (t) { return !!t.protoId; });
    var running = ops.filter(function (t) { return t.state === 'running'; }).length;
    var doneN = ops.filter(function (t) { return t.state === 'done'; }).length;
    var failedN = ops.filter(function (t) { return t.state === 'error' || t.state === 'canceled'; }).length;
    var h = '<div class="ns-sum">' +
      '<div><b>' + ops.length + '</b> ' + (protoOnly ? '项协议任务' : '项操作') + ' <span>· 进行中 ' + running + '</span></div>' +
      '<div><b>' + doneN + '</b> 已完成 <span>· ' + failedN + ' 失败/停止</span></div></div>';
    if (protoOnly) {
      h += '<div class="ns-hint" style="margin:0 0 12px">这里只显示 WebDAV / SMB 协议通信产生的传输任务：在「远程挂载」里上传 / 下载远程文件，或外部客户端访问本机协议服务。文件管理器的上传 / 下载 / 复制 / 移动 / 删除等操作请到「文件管理 → 传输进度」查看。</div>';
    } else {
      h += '<div class="ns-hint" style="margin:0 0 12px">所有文件操作（上传 / 下载 / 复制 / 移动 / 删除 / 新建 / 重命名）统一记录在这一张表里。上传下载不再分开；「删除任务」仅在任务停止（完成 / 失败 / 已停止）后可用。</div>';
    }
    var thead = '<tr><th>操作</th><th>文件 / 内容</th><th>起始目录</th><th>目标目录</th><th>大小</th><th>进度</th><th>创建时间</th><th>用时</th><th>状态</th><th>操作</th></tr>';
    h += '<div class="ns-card"><h4>' + (protoOnly ? '协议通信任务' : '传输进度') + ' <span class="ns-tag off">' + (protoOnly ? 'WebDAV / SMB · 后端任务池' : '统一时间线 · 最新在上') + '</span></h4>';
    h += '<table class="ns-tbl">' + thead + (ops.length ? ops.map(opRow).join('') :
      '<tr><td colspan="10"><div class="ns-empty">' +
      (protoOnly ? '暂无协议通信任务 · 通过 WebDAV / SMB 协议传输文件后即会记录在此' : '暂无文件操作 · 在文件浏览里上传 / 下载 / 复制 / 删除后即会记录在此') +
      '</div></td></tr>') + '</table>';
    h += '</div>';
    return h;
  }
  function fsTransferPane() {
    return '<div class="ns-wrap">' + opsTableHtml() + pendingUploadHtml() + '</div>';
  }

  /* ------------------------------------------- 文件管理窗口内嵌：操作历史面板
   * 数据源是 index.html 的全局 LOGS（SSE 'log' 事件实时 push），只保留
   * src ∈ {files, share, snapshot} 的文件类操作，不碰 docker/wsl/auth 等。 */
  function fsHistRows() {
    try {
      var all = (typeof LOGS !== 'undefined' && Array.isArray(LOGS)) ? LOGS : [];
      var keep = { files: 1, share: 1, snapshot: 1 };
      return all.filter(function (l) { return l && keep[l.src]; }).slice().reverse();
    } catch (e) { return []; }
  }
  var SRC_LABEL = { files: '文件操作', share: '分享链接', snapshot: '版本快照' };
  function fsHistoryPane() {
    var rows = fsHistRows();
    var cnt = { files: 0, share: 0, snapshot: 0 };
    rows.forEach(function (l) { if (cnt[l.src] !== undefined) cnt[l.src]++; });
    var h = '<div class="ns-wrap"><div class="ns-sum">' +
      '<div><b>' + rows.length + '</b> 条文件操作记录 <span>· 后端实时事件</span></div>' +
      '<div><b>' + cnt.files + '</b> 文件 · <b>' + cnt.share + '</b> 分享 · <b>' + cnt.snapshot + '</b> 版本</div>' +
      '</div><div class="ns-hint" style="margin:0 0 12px">仅显示文件相关操作（浏览 / 新建 / 重命名 / 复制 / 移动 / 删除 / 压缩 / 解压 / 保存 / 分享 / 版本）。上传下载进度请切到「传输进度」。记录由后端实时推送，重启服务前一直保留。</div>';
    h += '<div class="ns-card"><h4>操作时间线 <span class="ns-tag off">最近 ' + rows.length + ' 条</span></h4>';
    h += rows.length ? '<table class="ns-tbl"><tr><th style="width:148px">时间</th><th style="width:82px">来源</th><th style="width:58px">级别</th><th>操作内容</th></tr>' +
      rows.map(function (l) {
        var lv = String(l.lv || 'INFO');
        var cls = (lv === 'ERR' || lv === 'CRIT' || lv === 'WARN') ? 'err' : 'ok';
        return '<tr><td class="ns-mono">' + E(l.time) + '</td><td><span class="ns-tag off">' + E(SRC_LABEL[l.src] || l.src) + '</span></td>' +
          '<td><span class="ns-tag ' + cls + '">' + E(lv) + '</span></td><td>' + E(l.msg) + '</td></tr>';
      }).join('') + '</table>' : '<div class="ns-empty">暂无文件操作记录 · 在文件浏览里做一次新建 / 复制 / 分享后即会出现</div>';
    h += '<div class="ns-row"><button class="ns-btn" data-ns="fm-hist-refresh">刷新记录</button></div></div></div>';
    return h;
  }

  /* ---------------------------------------------------------------- WebDAV 服务 */
  function renderWebdav() {
    var c = S.cfg || { enabled: false, port: 5280, bind: '0.0.0.0', readonly: false, roots: ['__home__'], allowDrives: false, authRequired: true };
    var d = S.dav || {};
    var badge = d.running ? '<span class="ns-tag ok">运行中 · 端口 ' + E(d.port) + '</span>' : '<span class="ns-tag off">已停止</span>';
    var urls = (d.urls || []).slice(0, 6);
    var h = '<div class="ns-card"><h4>WebDAV 服务端 ' + badge + '</h4>' +
      '<div class="ns-hint">把本机目录以标准 WebDAV 协议共享给手机 / 其他电脑。默认关闭、默认需要账号；' +
      'Basic 认证复用本系统账号，不另存密码。独立端口，不影响 5080 主服务。</div>' +
      '<div class="ns-row"><label>启用服务</label><input class="ns-in" type="checkbox" data-field="enabled" ' + (c.enabled ? 'checked' : '') + '></div>' +
      '<div class="ns-row"><label>端口</label><input class="ns-in" type="number" min="1" max="65535" data-field="port" value="' + E(c.port) + '"></div>' +
      '<div class="ns-row"><label>绑定地址</label><select class="ns-in" data-field="bind">' +
      '<option value="0.0.0.0" ' + (c.bind === '0.0.0.0' ? 'selected' : '') + '>0.0.0.0（局域网可访问）</option>' +
      '<option value="127.0.0.1" ' + (c.bind === '127.0.0.1' ? 'selected' : '') + '>127.0.0.1（仅本机）</option></select></div>' +
      '<div class="ns-row"><label>只读</label><input class="ns-in" type="checkbox" data-field="readonly" ' + (c.readonly ? 'checked' : '') + '>' +
      '<label style="min-width:auto">允许写</label><input class="ns-in" type="checkbox" data-field="allowWrite" ' + (c.allowWrite !== false ? 'checked' : '') + '></div>' +
      '<div class="ns-row"><label>需要登录</label><input class="ns-in" type="checkbox" data-field="authRequired" ' + (c.authRequired !== false ? 'checked' : '') + '>' +
      '<label style="min-width:auto">开放所有盘符</label><input class="ns-in" type="checkbox" data-field="allowDrives" ' + (c.allowDrives ? 'checked' : '') + '></div>' +
      '<div class="ns-row"><label>开放根目录</label><input class="ns-in" data-field="roots" value="' + E((c.roots || []).join(',')) + '" placeholder="__home__ 或 D:"></div>' +
      '<div class="ns-row"><button class="ns-btn pri" data-ns="dav-save">保存并应用</button>' +
      '<button class="ns-btn" data-ns="refresh">刷新状态</button></div>';
    if (d.error) h += '<div class="ns-hint" style="color:#d97757">启动失败：' + E(d.error) + '</div>';
    h += '</div>';
    h += '<div class="ns-card"><h4>连接地址</h4>' + (urls.length ? urls.map(function (u) {
      return '<div class="ns-row"><span class="ns-mono" style="flex:1">' + E(u) + '</span>' +
        '<button class="ns-btn" data-ns="copy" data-text="' + E(u) + '">复制</button></div>';
    }).join('') : '<div class="ns-empty">启用后这里会显示局域网地址</div>') +
      '<div class="ns-hint">Windows：资源管理器 → 映射网络驱动器 → 填入上方地址；' +
      'macOS：Finder → 连接服务器；手机：任意支持 WebDAV 的文件管理器。' +
      '删除操作会送入 Windows 系统回收站，不会直接永久删除。</div></div>';
    return h;
  }

  /* ---------------------------------------------------------------- SMB 共享 */
  function renderSmb() {
    var s = S.smb || {};
    var h = '<div class="ns-card"><h4>SMB 服务端（Windows 文件共享）</h4>' +
      '<div class="ns-row"><span class="ns-tag ' + (s.admin ? 'ok' : 'err') + '">管理员权限：' + (s.admin ? '是' : '否') + '</span>' +
      '<span class="ns-tag ' + (s.port445 ? 'ok' : 'off') + '">445 端口：' + (s.port445 ? '已监听' : '未监听') + '</span>' +
      '<span class="ns-tag off">共享数 ' + ((s.shares || []).length) + '</span>' +
      '<button class="ns-btn" data-ns="refresh">刷新</button></div>' +
      (!s.admin ? '<div class="ns-hint" style="color:#d97757">新建 / 删除共享需要管理员权限，请用「以管理员身份运行」启动 NasDeck；查看列表不受影响。</div>' : '') +
      (s.error ? '<div class="ns-hint">状态提示：' + E(s.error) + '</div>' : '') +
      '<div class="ns-hint">共享由 Windows 自身的 SMB 服务提供，NasDeck 只做创建 / 删除与状态展示；' +
      '客户端用 \\\\主机\\共享名 访问，权限沿用 Windows 账户体系。</div></div>';
    h += '<div class="ns-card"><h4>本机共享列表</h4>' + ((s.shares || []).length ?
      '<table class="ns-tbl"><tr><th>名称</th><th>路径</th><th>说明</th><th>操作</th></tr>' +
      (s.shares || []).map(function (x) {
        return '<tr><td>' + E(x.n) + '</td><td class="ns-mono">' + E(x.path) + '</td><td>' + E(x.desc || '') + '</td>' +
          '<td><button class="ns-btn warn" data-ns="smb-del" data-name="' + E(x.n) + '" ' + (s.admin ? '' : 'disabled') + '>删除</button></td></tr>';
      }).join('') + '</table>' : '<div class="ns-empty">没有自定义共享（系统默认共享已隐藏）</div>') + '</div>';
    h += '<div class="ns-card"><h4>新建共享</h4>' +
      '<div class="ns-row"><label>共享名</label><input class="ns-in" data-field="smbName" placeholder="例如 NasDeckShare"></div>' +
      '<div class="ns-row"><label>本机路径</label><input class="ns-in" data-field="smbPath" placeholder="例如 D:\\Share"></div>' +
      '<div class="ns-row"><button class="ns-btn pri" data-ns="smb-add" ' + (s.admin ? '' : 'disabled') + '>创建共享</button></div></div>';
    h += '<div class="ns-card"><h4>连接远程 SMB（保存 Windows 凭据）</h4>' +
      '<div class="ns-row"><label>UNC 地址</label><input class="ns-in" data-field="smbUnc" placeholder="\\\\192.168.1.10\\share"></div>' +
      '<div class="ns-row"><label>用户名</label><input class="ns-in" data-field="smbUser" placeholder="可留空使用当前 Windows 身份"></div>' +
      '<div class="ns-row"><label>密码</label><input class="ns-in" type="password" data-field="smbPass" placeholder="可留空"></div>' +
      '<div class="ns-row"><button class="ns-btn" data-ns="smb-connect">建立映射</button>' +
      '<span class="ns-hint" style="margin:0">密码经编码传入系统命令，不写入项目配置。</span></div></div>';
    return h;
  }

  /* ---------------------------------------------------------------- 远程挂载 */
  function renderMounts() {
    var h = '<div class="ns-card"><h4>远程挂载（WebDAV / SMB 客户端）</h4>' +
      '<div class="ns-hint">把别的 NAS / Windows 共享挂进来统一浏览。凭据在本机加密保存，' +
      '也可以选择「不保存密码」，重启后重新输入。SMB 走 UNC 路径，由 Windows 负责认证。</div>';
    h += (S.mounts || []).length ? '<table class="ns-tbl"><tr><th>名称</th><th>类型</th><th>地址</th><th>凭据</th><th>操作</th></tr>' +
      S.mounts.map(function (m) {
        return '<tr><td>' + E(m.name) + '</td><td>' + E(m.type.toUpperCase()) + '</td>' +
          '<td class="ns-mono">' + E(m.url || m.unc) + '</td>' +
          '<td><span class="ns-tag ' + (m.hasCredential ? 'ok' : 'off') + '">' + (m.hasCredential ? '已保存' : '无') + '</span></td>' +
          '<td><button class="ns-btn" data-ns="mount-open" data-id="' + E(m.id) + '">浏览</button> ' +
          '<button class="ns-btn warn" data-ns="mount-del" data-id="' + E(m.id) + '">删除</button></td></tr>';
      }).join('') + '</table>' : '<div class="ns-empty">还没有远程挂载</div>';
    h += '</div>';
    h += '<div class="ns-card"><h4>新增挂载</h4>' +
      '<div class="ns-row"><label>类型</label><select class="ns-in" data-field="mType">' +
      '<option value="webdav">WebDAV</option><option value="smb">SMB / Windows 共享</option></select></div>' +
      '<div class="ns-row"><label>名称</label><input class="ns-in" data-field="mName" placeholder="例如 办公室 NAS"></div>' +
      '<div class="ns-row"><label>地址</label><input class="ns-in" data-field="mAddr" placeholder="http://host:5280/dav/ 或 \\\\host\\share"></div>' +
      '<div class="ns-row"><label>用户名</label><input class="ns-in" data-field="mUser" placeholder="可留空"></div>' +
      '<div class="ns-row"><label>密码</label><input class="ns-in" type="password" data-field="mPass" placeholder="可留空"></div>' +
      '<div class="ns-row"><label>保存凭据</label><input class="ns-in" type="checkbox" data-field="mSave" checked></div>' +
      '<div class="ns-row"><button class="ns-btn pri" data-ns="mount-add">添加</button></div></div>';
    if (S.mount) {
      var m = S.mount;
      var seg = S.mountPath.split('/').filter(Boolean);
      h += '<div class="ns-card"><h4>浏览：' + E(m.name) + ' <button class="ns-btn" data-ns="mount-close" style="float:right">返回列表</button></h4>' +
        '<div class="ns-crumb"><button data-ns="mount-nav" data-p="">根目录</button>' +
        seg.map(function (x, i) {
          return '<span>/</span><button data-ns="mount-nav" data-p="' + E(seg.slice(0, i + 1).join('/')) + '">' + E(x) + '</button>';
        }).join('') + '</div>' +
        '<div class="ns-row"><button class="ns-btn" data-ns="mount-up">上传文件到此目录</button>' +
        '<button class="ns-btn" data-ns="mount-mkdir">新建文件夹</button>' +
        '<button class="ns-btn" data-ns="mount-refresh">刷新</button></div>' +
        (S.mountRows.length ? '<table class="ns-tbl"><tr><th>名称</th><th>大小</th><th>修改时间</th><th>操作</th></tr>' +
          S.mountRows.map(function (r, i) {
            var p = (S.mountPath ? S.mountPath.replace(/\/$/, '') + '/' : '') + r.n;
            return '<tr><td>' + (r.dir ? '📁 ' : '📄 ') + (r.dir ?
              '<button class="ns-crumb" style="display:inline" data-ns="mount-nav" data-p="' + E(p) + '">' + E(r.n) + '</button>' : E(r.n)) + '</td>' +
              '<td>' + (r.dir ? '—' : fmtB(r.sz)) + '</td><td>' + E(r.m) + '</td>' +
              '<td>' + (r.dir ? '' : '<button class="ns-btn" data-ns="mount-get" data-p="' + E(p) + '">下载</button> ') +
              '<button class="ns-btn warn" data-ns="mount-rm" data-p="' + E(p) + '">删除</button></td></tr>';
          }).join('') + '</table>' : '<div class="ns-empty">目录为空或无法访问</div>') + '</div>';
    }
    return h;
  }

  /* ---------------------------------------------------------------- 数据刷新 */
  function field(name, root) {
    var el = (root || document).querySelector('[data-field="' + name + '"]');
    if (!el) return undefined;
    return el.type === 'checkbox' ? el.checked : el.value;
  }
  async function refresh(force) {
    if (S.busy) return;
    S.busy = true;
    var seq = ++S.seq;
    try {
      var r = await api('/api/netshare/status' + (force ? '?force=1' : ''));
      if (seq !== S.seq) return;
      S.dav = r.webdav || {};
      S.smb = r.smb || {};
      S.mounts = r.mounts || [];
      S.cfg = (r.config && r.config.webdav) || S.cfg;
      S.lastFull = Date.now();
      repaint();
    } catch (e) { toast('状态刷新失败', e.message, 'err'); }
    finally { S.busy = false; }
  }
  /* 当前聚焦的文件管理窗口是否停在某个内嵌 tab（由 winnas 的 FSX.tab 提供） */
  function fsTab() {
    try { return (typeof NasDeck !== 'undefined' && NasDeck.fsx && NasDeck.fsx.tab) || ''; }
    catch (e) { return ''; }
  }
  function repaint() {
    try { if (typeof W === 'function' && W('netshare')) rerender('netshare'); } catch (e) {}
    /* 文件管理窗口正停在传输进度时，同步重绘它，避免两个入口显示不一致 */
    try {
      var t = fsTab();
      if (t === 'transfer' && typeof W === 'function' && W('filestation')) rerender('filestation');
    } catch (e) {}
  }
  /* 协议通信任务由后端协议栈维护。只在「成员 / 状态」变化时整窗重绘，
     字节进度走局部 DOM 更新，避免轮询打断正在填写的表单。 */
  async function refreshTasks(force) {
    if (S.protoBusy && !force) return;
    /* 未登录时绝不发鉴权请求：否则登录页会刷出 401，被回归套件的
       「无控制台错误 / 无 API 失败」断言如实抓到。 */
    if (!NasDeck || !NasDeck.token) return;
    S.protoBusy = true;
    try {
      var r = await api('/api/netshare/tasks?limit=100');
      S.proto = r.tasks || [];
      var sig = S.proto.map(function (x) { return x.id + ':' + x.state; }).join('|');
      S.lastProto = Date.now();
      var onTransfer = (S.tab === 'transfer') || (fsTab() === 'transfer');
      if (force || sig !== S.protoSig) {
        S.protoSig = sig;
        if (onTransfer) repaint();
      } else if (onTransfer) paintProgress();
    } catch (e) {}
    finally { S.protoBusy = false; }
  }

  /* ---------------------------------------------------------------- 统一任务池
   * v16.3：所有文件操作共用一个任务对象形状，传输进度面板只渲染 S.ops 一条时间线。
   * 字段：op(操作类型) / name / srcDir(起始目录) / dstDir(目标目录) /
   *      createdAt / finishedAt / elapsedMs(用时) / size / got / state。
   * 上传/下载任务同时进 S.ops 与其引擎数组（同一对象引用），进度自然同步。 */
  var OP_LABEL = {
    upload: '上传', download: '下载', copy: '复制', move: '移动',
    del: '删除', mkdir: '新建文件夹', newfile: '新建文件', rename: '重命名'
  };
  function newOpId() { return 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function makeOp(op, name, srcDir, dstDir, size) {
    return {
      op: op, id: newOpId(), name: String(name || ''),
      srcDir: String(srcDir || '/'), dstDir: String(dstDir || '/'),
      size: Number(size) || 0, got: 0, speed: 0, state: 'running',
      createdAt: Date.now(), finishedAt: 0, elapsedMs: 0, error: ''
    };
  }
  /** 登记一条文件操作任务（复制/移动/删除/新建等瞬时操作用，落库即 running，
   *  调用方稍后 setOpDone / setOpError；上传下载由 newTask 复用同一形状）。 */
  function recordOp(op, name, srcDir, dstDir, size) {
    var t = makeOp(op, name, srcDir, dstDir, size);
    S.ops.unshift(t);
    repaint();
    return t;
  }
  function setOpDone(t, extra) {
    if (!t) return;
    t.state = 'done'; t.got = t.size;
    t.finishedAt = Date.now(); t.elapsedMs = Math.max(0, t.finishedAt - t.createdAt);
    if (extra) { for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) t[k] = extra[k]; }
    repaint();
  }
  function setOpError(t, msg) {
    if (!t) return;
    t.state = 'error'; t.error = String(msg || '操作失败');
    t.finishedAt = Date.now(); t.elapsedMs = Math.max(0, t.finishedAt - t.createdAt);
    repaint();
  }
  function elapsedText(t) {
    var ms = t.elapsedMs || (t.finishedAt ? t.finishedAt - t.createdAt : Date.now() - t.createdAt);
    if (ms < 1000) return ms + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
    var m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
    return m + ' m ' + s + ' s';
  }
  function isTerminal(t) { return t.state === 'done' || t.state === 'error' || t.state === 'canceled'; }
  function timeText(ts) {
    try {
      var d = new Date(ts);
      var p = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    } catch (e) { return String(ts || ''); }
  }

  /* ---------------------------------------------------------------- 上传引擎 */
  function newTask(kind, name, size, path) {
    var op = kind === 'up' ? 'upload' : 'download';
    var vp = String(path || '/');
    /* 上传：起始=本机文件，目标=目标虚拟目录；下载：起始=来源虚拟目录，目标=本机保存位置 */
    var t = {
      kind: kind, id: kind + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      op: op, name: name, size: size, path: path,
      srcDir: kind === 'up' ? '本机文件' : vp,
      dstDir: kind === 'up' ? vp : '本机保存位置',
      createdAt: Date.now(), finishedAt: 0, elapsedMs: 0,
      got: 0, speed: 0, state: 'running',
      error: '', xhrs: [], ctl: null, chunkLoaded: {}, uploadId: '',
      chunkSize: 2 * 1024 * 1024, lastModified: 0, renamed: '', needsFile: false
    };
    S.ops.unshift(t);
    return t;
  }
  function taskGot(t) {
    var n = 0;
    for (var k in t.chunkLoaded) if (Object.prototype.hasOwnProperty.call(t.chunkLoaded, k)) n += t.chunkLoaded[k];
    return n;
  }
  function putChunk(t, file, i) {
    return new Promise(function (res, rej) {
      var start = i * t.chunkSize, end = Math.min(t.size, start + t.chunkSize);
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', NasDeck.base + '/api/transfer/upload/chunk?id=' + enc(t.uploadId) + '&index=' + i, true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      if (NasDeck.token) xhr.setRequestHeader('X-NasDeck-Token', NasDeck.token);
      xhr.upload.onprogress = function (ev) {
        if (ev.lengthComputable) t.chunkLoaded[i] = Math.min(end - start, ev.loaded);
      };
      xhr.onload = function () {
        t.chunkLoaded[i] = end - start;
        if (xhr.status === 200) res();
        else rej(new Error('HTTP ' + xhr.status + ' ' + String(xhr.responseText || '').slice(0, 90)));
      };
      xhr.onerror = function () { rej(new Error('网络中断')); };
      xhr.onabort = function () { rej(new Error('已暂停')); };
      t.xhrs.push(xhr);
      try { xhr.send(file.slice(start, end)); } catch (e) { rej(e); }
    });
  }
  function abortXhrs(t) {
    (t.xhrs || []).forEach(function (x) { try { x.abort(); } catch (e) {} });
    t.xhrs = [];
  }
  async function runUpload(t, file) {
    t.state = 'running'; t.error = ''; t.needsFile = false;
    try {
      var r = await api('/api/transfer/upload/init', {
        path: t.path, name: t.name, size: t.size, chunkSize: t.chunkSize,
        lastModified: t.lastModified || (file && file.lastModified) || 0
      });
      if (!r || !r.job) throw new Error('初始化上传失败');
      t.job = r.job; t.uploadId = r.job.uploadId;
      t.chunkSize = r.job.chunkSize;
      (r.job.uploaded || []).forEach(function (i) {
        t.chunkLoaded[i] = Math.min(t.chunkSize, Math.max(0, t.size - i * t.chunkSize));
      });
      saveLocal();
      var guard = 0;
      while (guard++ < 500000) {
        if (t.state === 'paused' || t.state === 'canceled') return;
        var pending = [];
        for (var i = 0; i < t.job.chunks; i++) if (!t.chunkLoaded[i] && t.chunkLoaded[i] !== 0) pending.push(i);
        /* 0 字节文件：chunks=1，chunkLoaded 里没有键，直接传空片 */
        if (!pending.length && !t.job.uploaded.length && t.size === 0) pending = [0];
        if (!pending.length) break;
        var batch = pending.slice(0, 2);
        await Promise.all(batch.map(function (k) { return putChunk(t, file, k); }));
        if (t.state === 'paused' || t.state === 'canceled') return;
      }
      if (t.state === 'paused' || t.state === 'canceled') return;
      var fin = await api('/api/transfer/upload/complete', { id: t.uploadId });
      t.state = 'done'; t.got = t.size; t.renamed = fin && fin.renamed ? fin.name : '';
      t.finishedAt = Date.now(); t.elapsedMs = Math.max(0, t.finishedAt - t.createdAt);
      saveLocal();
      try { applyFiles(fin); } catch (e) {}
      toast('上传完成', fin && fin.name || t.name, 'ok');
    } catch (e) {
      if (/已暂停/.test(String(e && e.message))) { t.state = 'paused'; saveLocal(); return; }
      t.state = 'error'; t.error = (e && e.message) || '上传失败';
      t.finishedAt = Date.now(); t.elapsedMs = Math.max(0, t.finishedAt - t.createdAt);
      saveLocal();
      toast('上传失败', t.name + '：' + t.error, 'err');
    }
  }
  function startUpload(file, vp) {
    var t = newTask('up', file.name, file.size, vp);
    t.lastModified = file.lastModified || 0;
    /* 页面内的「暂停→继续」可直接复用 File；刷新后引用丢失，
       则由「选择原文件续传」重新提供（校验 name/size 一致）。 */
    t.fileRef = file;
    S.uploads.unshift(t);
    runUpload(t, file);
    openPanel('transfer');
    return t;
  }
  function resumeUpload(t, file) {
    if (!file) {
      t.state = 'paused'; t.needsFile = true; repaint(); return;
    }
    if (file.name !== t.name || file.size !== t.size) {
      toast('文件不匹配', '请选择原文件 ' + t.name, 'err'); return;
    }
    t.fileRef = file;
    runUpload(t, file);
  }
  function pickFile(t) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = function () { var f = (inp.files || [])[0]; resumeUpload(t, f); try { inp.remove(); } catch (e) {} };
    inp.click();
  }

  /* ---------------------------------------------------------------- 下载引擎 */
  function downloadUrl(t) {
    return NasDeck.base + '/api/files/download?path=' + enc(t.path) + '&name=' + enc(t.name) +
      (NasDeck.token ? '&token=' + enc(NasDeck.token) : '');
  }
  async function runDownload(t) {
    t.state = 'running'; t.error = '';
    try {
      if (t.handle) t.writer = await t.handle.createWritable({ keepExistingData: true });
      else t.chunks = t.chunks || [];
      var CH = 2 * 1024 * 1024;
      var guard = 0;
      while (t.got < t.size && guard++ < 200000) {
        if (t.state === 'paused' || t.state === 'canceled') { await closeWriter(t); return; }
        t.ctl = new AbortController();
        var end = Math.min(t.size - 1, t.got + CH - 1);
        var headers = { Range: 'bytes=' + t.got + '-' + end };
        if (NasDeck.token) headers['X-NasDeck-Token'] = NasDeck.token;
        var r = await fetch(downloadUrl(t), { headers: headers, signal: t.ctl.signal });
        if (r.status !== 206 && !(r.status === 200 && t.got === 0)) throw new Error('HTTP ' + r.status + '（服务端未返回 Range 分片）');
        var buf = await r.arrayBuffer();
        if (!buf.byteLength) throw new Error('分片为空，传输中断');
        if (t.writer) { await t.writer.seek(t.got); await t.writer.write(buf); }
        else t.chunks.push(buf);
        t.got += buf.byteLength;
        if (t.state === 'paused' || t.state === 'canceled') { await closeWriter(t); return; }
      }
      if (t.writer) { await t.writer.close(); t.writer = null; }
      else {
        var blob = new Blob(t.chunks || [], { type: 'application/octet-stream' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = t.name;
        document.body.appendChild(a); a.click();
        setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 30000);
        t.chunks = [];
      }
      t.state = 'done'; t.speed = 0;
      t.finishedAt = Date.now(); t.elapsedMs = Math.max(0, t.finishedAt - t.createdAt);
      toast('下载完成', t.name + ' · ' + fmtB(t.size), 'ok');
    } catch (e) {
      await closeWriter(t);
      if (t.state === 'paused' || t.state === 'canceled') return;
      t.state = 'error'; t.error = (e && e.message) || '下载失败';
      t.finishedAt = Date.now(); t.elapsedMs = Math.max(0, t.finishedAt - t.createdAt);
      toast('下载失败', t.name + '：' + t.error, 'err');
    }
  }
  async function closeWriter(t) {
    if (t.writer) { try { await t.writer.close(); } catch (e) {} t.writer = null; }
  }
  async function startDownload(vp, name, noPicker) {
    /* showSaveFilePicker 必须在用户手势的同步栈里发起；一旦 await 过别的
       Promise 再调用就会因 transient activation 失效而抛 SecurityError。
       这里把它放在函数第一个 await 上，取消则直接放弃建任务。 */
    var handle = null;
    if (!noPicker && typeof window.showSaveFilePicker === 'function') {
      try { handle = await window.showSaveFilePicker({ suggestedName: name }); }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    var meta;
    try { meta = await api('/api/files/meta?path=' + enc(vp) + '&name=' + enc(name)); }
    catch (e) { toast('下载失败', e.message, 'err'); return; }
    var t = newTask('dl', name, meta.size || 0, vp);
    t.etag = meta.etag || ''; t.handle = handle;
    S.downloads.unshift(t);
    openPanel('transfer');
    runDownload(t);
  }
  async function resumeDownload(t) {
    if (t.state !== 'paused' && t.state !== 'error') return;
    try {
      var meta = await api('/api/files/meta?path=' + enc(t.path) + '&name=' + enc(t.name));
      if (meta.size !== t.size || (t.etag && meta.etag && meta.etag !== t.etag)) {
        toast('文件已变化', '服务端文件被修改，请重新下载', 'warn');
        t.state = 'error'; t.error = '文件已变化，请移除后重新下载'; repaint(); return;
      }
    } catch (e) { toast('续传失败', e.message, 'err'); return; }
    runDownload(t);
  }

  /* ---------------------------------------------------------------- 覆盖文件总管动作 */
  function openPanel(tab) {
    try {
      if (typeof openApp === 'function') openApp('netshare');
      if (tab && S.tab !== tab) { S.tab = tab; repaint(); }
      else if (S.tab === 'transfer') paintProgress();
    } catch (e) {}
  }
  function ourUpload() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = function () {
      var vp = curPath();
      Array.prototype.forEach.call(inp.files || [], function (f) { startUpload(f, vp); });
      try { inp.remove(); } catch (e) {}
    };
    inp.click();
  }
  var _origDownload = null;
  function ourDownload() {
    /* 原 fsx-download 内部用 FSX.sel / fshown() 判断选中项与文件类型，
       这些是 winnas 层的局部变量，注入层拿不到。这里临时拦截 window.open，
       让原逻辑照常跑一遍并「捕获」它本来要打开的下载 URL，再改走断点任务。
       这样选中态、Ctrl/Shift 多选、文件夹过滤全部与原来完全一致。 */
    var urls = [];
    if (_origDownload) {
      var origOpen = window.open;
      window.open = function (u) { if (u) urls.push(String(u)); return null; };
      try { _origDownload(); } catch (e) {} finally { window.open = origOpen; }
    }
    if (urls.length) {
      /* 多选时逐个弹保存对话框体验很差：走内存合并后自动下载；
         单文件才使用「选择保存位置 + 直接写盘」的真断点模式。 */
      var many = urls.length > 1;
      urls.forEach(function (u) {
        var mn = /[?&]name=([^&]+)/.exec(u), mp = /[?&]path=([^&]+)/.exec(u);
        if (!mn || !mp) return;
        var name, vp;
        try { name = decodeURIComponent(mn[1]); vp = decodeURIComponent(mp[1]); } catch (e) { return; }
        startDownload(vp, name, many);
      });
      return;
    }
    /* 兜底：从选中的 DOM 行里取 data-i，再按当前目录列表映射 */
    var vp0 = curPath(), all = [];
    try { all = (typeof FS === 'object' && FS[vp0]) || []; } catch (e) {}
    var rows = document.querySelectorAll('#filestation tr.sel[data-i], #filestation .fs-cell.sel[data-i]');
    var n = 0;
    rows.forEach(function (r) {
      var i = Number(r.getAttribute('data-i'));
      var f = all[i];
      if (!f || f.t === 'dir' || f.drive) return;
      startDownload(vp0, f.n); n++;
    });
    if (!n) toast('请先选择文件', '在文件总管里点选要下载的文件', 'warn');
  }
  function installActions() {
    try {
      if (typeof ACT !== 'object' || !ACT) return;
      if (!_origDownload && typeof ACT['fsx-download'] === 'function' && ACT['fsx-download'] !== ourDownload)
        _origDownload = ACT['fsx-download'];
      ACT['fsx-upload'] = ourUpload;
      ACT['fsx-download'] = ourDownload;
      S.actDone = true;
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- 事件 */
  function onClick(e) {
    /* 同一个原生事件会先走 document 捕获监听、再冒泡到窗口的 rec.el.onclick。
       同一个事件对象上打标记，避免一次点击把配置/挂载动作执行两遍。 */
    if (e && e.__nsHandled) return;
    if (e) e.__nsHandled = true;
    var el = e.target && e.target.closest ? e.target.closest('[data-ns]') : null;
    if (!el) return;
    var a = el.getAttribute('data-ns');
    var id = el.getAttribute('data-id') || '';
    var p = el.getAttribute('data-p') || '';
    try {
      if (a === 'tab') {
        S.tab = el.getAttribute('data-tab'); repaint();
        if (S.tab === 'smb' || S.tab === 'webdav') refresh();
        if (S.tab === 'transfer') refreshTasks(true);
        return;
      }
      if (a === 'refresh') { refresh(true); return; }
      if (a === 'copy') {
        var txt = el.getAttribute('data-text') || '';
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { toast('已复制', txt, 'ok'); });
        else toast('复制', txt, 'info');
        return;
      }
      /* 协议通信任务：与文件管理器动作分开处理，互不干涉 */
      if (a === 'pt-goto-mounts') { S.tab = 'mounts'; repaint(); return; }
      if (a === 'pt-refresh') { refreshTasks(true); return; }
      if (a === 'pt-clear' || a === 'pt-remove' || a === 'pt-cancel') {
        if (a === 'pt-cancel') {
          var rq = S.protoReq[id];
          if (rq) { try { if (rq.abort) rq.abort(); } catch (x) {} delete S.protoReq[id]; }
        }
        var ep = a === 'pt-clear' ? '/api/netshare/tasks/clear' :
          (a === 'pt-remove' ? '/api/netshare/tasks/remove' : '/api/netshare/tasks/cancel');
        var body = a === 'pt-clear' ? { scope: 'done' } : { id: id };
        api(ep, body).then(function () { refreshTasks(true); })
          .catch(function (er) { toast('操作失败', er.message, 'err'); });
        return;
      }
      /* v16.3 统一任务池：停止（running）与删除任务（仅终态） */
      if (a === 'op-stop' || a === 'op-remove') {
        ensureOps();
        var ot = null;
        for (var oi = 0; oi < S.ops.length; oi++) if (S.ops[oi].id === id) { ot = S.ops[oi]; break; }
        if (!ot) { toast('任务不存在', '', 'warn'); return; }
        if (a === 'op-stop') {
          /* 停止仅对进行中任务有效；停止后保留记录，删除按钮随之可用 */
          if (ot.state !== 'running') { repaint(); return; }
          if (ot.protoId) {
            var rq2 = S.protoReq[ot.protoId];
            if (rq2) { try { if (rq2.abort) rq2.abort(); } catch (x) {} delete S.protoReq[ot.protoId]; }
            api('/api/netshare/tasks/cancel', { id: ot.protoId }).catch(function () {});
          } else if (ot.kind === 'up' || ot.kind === 'dl') {
            abortXhrs(ot);
            if (ot.ctl) { try { ot.ctl.abort(); } catch (x) {} }
            if (ot.kind === 'up' && ot.uploadId) api('/api/transfer/upload/abort', { id: ot.uploadId }).catch(function () {});
          }
          ot.state = 'canceled'; ot.error = '';
          ot.finishedAt = Date.now(); ot.elapsedMs = Math.max(0, ot.finishedAt - ot.createdAt);
          toast('任务已停止', ot.name, 'ok');
        } else {
          /* 删除任务：仅终态允许（防御性二次校验） */
          if (!isTerminal(ot)) { toast('请先停止任务', '只有完成 / 停止 / 失败的任务才能删除', 'warn'); return; }
          if (ot.protoId) api('/api/netshare/tasks/remove', { id: ot.protoId }).catch(function () {});
          else if (ot.kind === 'up' && ot.uploadId) api('/api/transfer/upload/abort', { id: ot.uploadId }).catch(function () {});
          /* 同步清理引擎数组（同一对象引用） */
          if (ot.kind) {
            var eng = ot.kind === 'up' ? S.uploads : S.downloads;
            var ei = eng.findIndex(function (x) { return x.id === ot.id; });
            if (ei >= 0) eng.splice(ei, 1);
            if (ot.kind === 'up') saveLocal();
          }
          S.ops = S.ops.filter(function (x) { return x.id !== id; });
          toast('任务已删除', ot.name, 'ok');
        }
        repaint(); return;
      }
      /* 文件管理器传输任务（旧按钮，保留兼容） */
      var list = a.indexOf('up-') === 0 ? S.uploads : S.downloads;
      var t = list.filter(function (x) { return x.id === id; })[0];
      if (/^(up|dl)-(pause|resume|remove)$/.test(a) && t) {
        var act = a.split('-')[1];
        if (act === 'pause') {
          t.state = 'paused'; abortXhrs(t);
          if (t.ctl) { try { t.ctl.abort(); } catch (x) {} }
        } else if (act === 'resume') {
          if (t.kind === 'up') resumeUpload(t, t.fileRef || null);
          else resumeDownload(t);
        } else {
          t.state = 'canceled'; abortXhrs(t);
          if (t.ctl) { try { t.ctl.abort(); } catch (x) {} }
          if (t.kind === 'up' && t.uploadId) api('/api/transfer/upload/abort', { id: t.uploadId }).catch(function () {});
          list.splice(list.indexOf(t), 1); saveLocal();
        }
        repaint(); return;
      }
      if (a === 'up-pick' && t) { pickFile(t); return; }
      if (a === 'up-restore') {
        var uid = el.getAttribute('data-uid') || '';
        api('/api/transfer/upload/status?id=' + enc(uid)).then(function (r) {
          var j = r.job, nt = newTask('up', j.name, j.size, j.path);
          nt.state = 'paused'; nt.uploadId = uid; nt.lastModified = j.lastModified || 0;
          nt.chunkSize = j.chunkSize; nt.needsFile = true;
          S.uploads.unshift(nt); saveLocal(); pickFile(nt);
        }).catch(function (er) { toast('任务已过期', er.message, 'warn'); });
        return;
      }
      if (a === 'up-forget') {
        var fid = el.getAttribute('data-uid') || '';
        api('/api/transfer/upload/abort', { id: fid }).catch(function () {});
        var rest = loadLocal().filter(function (x) { return x.uploadId !== fid; });
        try { localStorage.setItem('nasdeck_ns_uploads', JSON.stringify(rest)); } catch (er) {}
        repaint(); return;
      }
      /* WebDAV 配置 */
      if (a === 'dav-save') {
        var cfg = {
          enabled: !!field('enabled'), port: Number(field('port')) || 5280,
          bind: field('bind') || '0.0.0.0', readonly: !!field('readonly'),
          allowWrite: !!field('allowWrite'), authRequired: !!field('authRequired'),
          allowDrives: !!field('allowDrives'),
          roots: String(field('roots') || '__home__').split(',').map(function (x) { return x.trim(); }).filter(Boolean)
        };
        api('/api/netshare/webdav/config', cfg).then(function (r) {
          S.cfg = r.config || cfg; S.dav = r.status || {};
          toast(cfg.enabled ? 'WebDAV 已启用' : 'WebDAV 已关闭', r.status && r.status.error ? r.status.error : '端口 ' + cfg.port, 'ok');
          repaint();
        }).catch(function (er) { toast('保存失败', er.message, 'err'); });
        return;
      }
      /* SMB */
      if (a === 'smb-add') {
        api('/api/netshare/smb/share', { name: field('smbName'), path: field('smbPath') }).then(function (r) {
          if (r.ok) { S.smb = Object.assign(S.smb || {}, { shares: r.shares || [] }); toast('共享已创建', field('smbName'), 'ok'); }
          else toast('创建失败', r.error || '请检查管理员权限与路径', 'err');
          repaint();
        }).catch(function (er) { toast('创建失败', er.message, 'err'); });
        return;
      }
      if (a === 'smb-del') {
        var nm = el.getAttribute('data-name') || '';
        api('/api/netshare/smb/share', { act: 'delete', name: nm }).then(function (r) {
          if (r.ok) { S.smb = Object.assign(S.smb || {}, { shares: r.shares || [] }); toast('共享已删除', nm, 'ok'); }
          else toast('删除失败', r.error || '', 'err');
          repaint();
        }).catch(function (er) { toast('删除失败', er.message, 'err'); });
        return;
      }
      if (a === 'smb-connect') {
        api('/api/netshare/smb/connect', { unc: field('smbUnc'), username: field('smbUser'), password: field('smbPass') })
          .then(function (r) { toast(r.ok ? '映射成功' : '映射失败', r.ok ? field('smbUnc') : (r.error || ''), r.ok ? 'ok' : 'err'); })
          .catch(function (er) { toast('映射失败', er.message, 'err'); });
        return;
      }
      /* 挂载 */
      if (a === 'mount-add') {
        var type = field('mType') || 'webdav';
        var body = {
          type: type, name: field('mName'), username: field('mUser'),
          password: field('mPass'), saveCredential: !!field('mSave')
        };
        body[type === 'webdav' ? 'url' : 'unc'] = field('mAddr');
        api('/api/netshare/mounts', body).then(function (r) {
          S.mounts = r.mounts || []; toast('挂载已添加', body.name, 'ok'); repaint();
        }).catch(function (er) { toast('添加失败', er.message, 'err'); });
        return;
      }
      if (a === 'mount-del') {
        api('/api/netshare/mounts/delete', { id: id }).then(function (r) {
          S.mounts = r.mounts || [];
          if (S.mount && S.mount.id === id) { S.mount = null; S.mountRows = []; S.mountPath = ''; }
          repaint();
        }).catch(function (er) { toast('删除失败', er.message, 'err'); });
        return;
      }
      if (a === 'mount-open') {
        var mm = S.mounts.filter(function (x) { return x.id === id; })[0];
        if (!mm) return;
        S.mount = mm; S.mountPath = ''; S.mountRows = [];
        mountBrowse('');
        return;
      }
      if (a === 'mount-close') { S.mount = null; S.mountRows = []; repaint(); return; }
      if (a === 'mount-nav') { mountBrowse(p); return; }
      if (a === 'mount-refresh') { mountBrowse(S.mountPath); return; }
      if (a === 'mount-mkdir') {
        var nm2 = window.prompt('新建文件夹名称');
        if (!nm2) return;
        api('/api/netshare/action', { id: S.mount.id, act: 'mkdir', path: S.mountPath, name: nm2 })
          .then(function (r) { S.mountRows = r.entries || []; repaint(); })
          .catch(function (er) { toast('新建失败', er.message, 'err'); });
        return;
      }
      if (a === 'mount-rm') {
        if (!window.confirm('确定删除 ' + p + ' ？SMB 挂载为永久删除。')) return;
        var segs = p.split('/'); var nm3 = segs.pop(); var dir = segs.join('/');
        api('/api/netshare/action', { id: S.mount.id, act: 'delete', path: dir, name: nm3 })
          .then(function (r) { S.mountRows = r.entries || []; repaint(); })
          .catch(function (er) { toast('删除失败', er.message, 'err'); });
        return;
      }
      if (a === 'mount-get') {
        var tidD = newProtoId();
        var u = NasDeck.base + '/api/netshare/file?id=' + enc(S.mount.id) + '&path=' + enc(p) +
          '&taskId=' + enc(tidD) + '&token=' + enc(NasDeck.token || '');
        var xd = new XMLHttpRequest();
        xd.open('GET', u, true);
        xd.responseType = 'blob';
        if (NasDeck.token) xd.setRequestHeader('X-NasDeck-Token', NasDeck.token);
        S.protoReq[tidD] = xd;
        xd.onload = function () {
          delete S.protoReq[tidD];
          if (xd.status !== 200 && xd.status !== 206) { toast('下载失败', 'HTTP ' + xd.status, 'err'); refreshTasks(); return; }
          var a2 = document.createElement('a'); a2.href = URL.createObjectURL(xd.response);
          a2.download = p.split('/').pop() || 'download';
          document.body.appendChild(a2); a2.click();
          setTimeout(function () { try { URL.revokeObjectURL(a2.href); a2.remove(); } catch (er) {} }, 30000);
          refreshTasks();
        };
        xd.onerror = function () { delete S.protoReq[tidD]; toast('下载失败', '网络中断', 'err'); refreshTasks(); };
        xd.onabort = function () { delete S.protoReq[tidD]; refreshTasks(); };
        xd.send();
        toast('协议下载已开始', S.mount.type.toUpperCase() + ' · ' + p, 'info');
        setTimeout(refreshTasks, 120);
        return;
      }
      if (a === 'mount-up') {
        var inp2 = document.createElement('input');
        inp2.type = 'file'; inp2.style.display = 'none'; document.body.appendChild(inp2);
        inp2.onchange = function () {
          var f = (inp2.files || [])[0]; if (!f) return;
          var rel = (S.mountPath ? S.mountPath.replace(/\/$/, '') + '/' : '') + f.name;
          var tidU = newProtoId();
          var xhr = new XMLHttpRequest();
          xhr.open('PUT', NasDeck.base + '/api/netshare/file?id=' + enc(S.mount.id) +
            '&path=' + enc(rel) + '&taskId=' + enc(tidU), true);
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          if (NasDeck.token) xhr.setRequestHeader('X-NasDeck-Token', NasDeck.token);
          S.protoReq[tidU] = xhr;
          xhr.onload = function () {
            delete S.protoReq[tidU];
            toast(xhr.status === 200 ? '上传完成' : '上传失败', f.name, xhr.status === 200 ? 'ok' : 'err');
            mountBrowse(S.mountPath); refreshTasks();
          };
          xhr.onerror = function () { delete S.protoReq[tidU]; toast('上传失败', '网络中断', 'err'); refreshTasks(); };
          xhr.onabort = function () { delete S.protoReq[tidU]; refreshTasks(); };
          xhr.send(f);
          try { inp2.remove(); } catch (er) {}
          toast('协议上传已开始', S.mount.type.toUpperCase() + ' · ' + f.name, 'info');
          setTimeout(refreshTasks, 120);
        };
        inp2.click();
        return;
      }
    } catch (er) { toast('操作失败', er && er.message || String(er), 'err'); }
  }
  function mountBrowse(p) {
    if (!S.mount) return;
    var seq = ++S.uiSeq;
    api('/api/netshare/browse?id=' + enc(S.mount.id) + '&path=' + enc(p || ''))
      .then(function (r) {
        if (seq !== S.uiSeq) return;
        S.mountPath = r.path || ''; S.mountRows = r.entries || [];
        repaint();
      }).catch(function (er) { toast('浏览失败', er.message, 'err'); });
  }

  /* ---------------------------------------------------------------- 守卫 / 进度 */
  function paintProgress() {
    var all = S.uploads.concat(S.downloads);
    all.forEach(function (t) {
      var g = t.kind === 'up' ? taskGot(t) : t.got;
      t.got = Math.min(t.size || 0, g);
      var bar = document.querySelector('[data-bar="' + t.id + '"]');
      var pct = t.size ? Math.min(100, Math.round(t.got / t.size * 100)) : 0;
      if (bar) bar.style.width = pct + '%';
      var lab = document.querySelector('[data-pct="' + t.id + '"]');
      if (lab) lab.textContent = pct + '% · ' + fmtB(t.got) + (t.speed ? ' · ' + fmtB(t.speed) + '/s' : '');
    });
    /* 协议通信任务的进度来自后端任务池，只更新数字不重绘；
       统一列表里镜像 DOM id 带 proto: 前缀，两个 id 都刷。 */
    (S.proto || []).forEach(function (t) {
      var q = t.size ? Math.min(100, Math.round((t.got || 0) / t.size * 100)) : (t.state === 'done' ? 100 : 0);
      [t.id, 'proto:' + t.id].forEach(function (domId) {
        var bar = document.querySelector('[data-bar="' + domId + '"]');
        if (bar) bar.style.width = q + '%';
        var lab = document.querySelector('[data-pct="' + domId + '"]');
        if (lab) lab.textContent = q + '% · ' + fmtB(t.got || 0);
      });
    });
    /* 统一列表的「用时」列：运行中的任务每秒走字（不整窗重绘） */
    (S.ops || []).forEach(function (t) {
      var el = document.querySelector('[data-elapsed="' + t.id + '"]');
      if (el) el.textContent = elapsedText(t);
    });
  }
  var lastTick = Date.now();
  function enforce() {
    /* 其它层的守卫可能重新赋值 NasDeck.install，包装要幂等补回 */
    installBridgeHooks();
    /* 应用注册可能被 hydrate / 其它层抹掉：只补不覆盖 */
    var sig = '';
    try { sig = [typeof APPS === 'object' && APPS && APPS.netshare ? 1 : 0,
      typeof APPS_INSTALLED === 'object' && APPS_INSTALLED && APPS_INSTALLED.netshare ? 1 : 0,
      typeof RENDER === 'object' && RENDER && RENDER.netshare === render ? 1 : 0].join(''); } catch (e) {}
    if (sig !== '111') installApp();
    try { if (typeof ACT !== 'object' || !ACT || ACT['fsx-upload'] !== ourUpload || ACT['fsx-download'] !== ourDownload) installActions(); } catch (e) {}
    /* 进度条只改 DOM，不整窗重绘，避免打断正在填写的表单。
       两个入口：传输与共享应用、文件管理窗口的「传输进度」tab。 */
    var onTransfer = (S.tab === 'transfer') || (fsTab() === 'transfer');
    if (onTransfer) paintProgress();
    var now = Date.now();
    /* 只有停在传输任务页且已登录才轮询，避免后台空跑与登录页 401 */
    if (onTransfer && now - S.lastProto > 1200) refreshTasks();
    if (now - lastTick > 1000) {
      S.uploads.concat(S.downloads).forEach(function (t) {
        if (t.state !== 'running') { t.speed = 0; return; }
        var g = t.kind === 'up' ? taskGot(t) : t.got;
        t.speed = Math.max(0, g - (t.lastGot || 0)); t.lastGot = g;
      });
      lastTick = now;
    }
    if (S.tab === 'smb' || S.tab === 'webdav') {
      if (now - S.lastFull > 30000) refresh();
    }
  }

  /* 底座 NasDeck.install() 在登录时会 hydrate() 清空 APPS_INSTALLED、
     patchActions() 重放 ACT，把本层的应用注册与文件总管动作覆盖一起冲掉。
     只靠 1.5s 守卫会留下「登录后短时间内点上传/下载仍走旧逻辑」的竞态窗口，
     所以精确包装 install / obj，在每次重放的同步栈末尾立即补装。 */
  function reinstall() { installApp(); installActions(); }
  function wrapBridge(key, after) {
    try {
      if (!NasDeck || typeof NasDeck[key] !== 'function' || NasDeck[key].__nsWrapped) return;
      var orig = NasDeck[key];
      var f = function () {
        var r = orig.apply(this, arguments);
        try { after(); } catch (e) {}
        return r;
      };
      f.__nsWrapped = true;
      NasDeck[key] = f;
    } catch (e) {}
  }
  function installBridgeHooks() {
    wrapBridge('install', reinstall);
    wrapBridge('obj', function () {
      try { if (typeof APPS_INSTALLED === 'object' && APPS_INSTALLED) APPS_INSTALLED.netshare = 1; } catch (e) {}
    });
  }

  /* 启动：恢复上次未完成上传的任务卡（File 需用户重新选择） */
  style();
  installApp();
  installActions();
  installBridgeHooks();
  document.addEventListener('click', onClick, true);
  setInterval(enforce, 1500);
  setTimeout(refreshTasks, 400);
  if (NasDeck && NasDeck.token) setTimeout(function () { refresh(); }, 800);
  else {
    var iv = setInterval(function () {
      if (NasDeck && NasDeck.token) { clearInterval(iv); refresh(); }
    }, 1200);
  }
  NS.isInstalled = function () {
    try { return ACT['fsx-upload'] === ourUpload && ACT['fsx-download'] === ourDownload; }
    catch (e) { return false; }
  };
  NS.refresh = refresh;
  NS.refreshTasks = refreshTasks;
  NS.startUpload = startUpload;
  NS.startDownload = startDownload;
  /* v16.3 统一任务池 API：供 winnas 层把复制/移动/删除/新建/重命名登记进传输进度 */
  NS.recordOp = recordOp;
  NS.setOpDone = setOpDone;
  NS.setOpError = setOpError;
  NS.ops = S.ops;
  NS.render = render;
  NS.mountFn = mount;
  /* 文件管理窗口内嵌「传输进度」面板生成器（winnas.renderFileManager 调用） */
  NS.fsTransferPane = fsTransferPane;
  NS.fsTab = fsTab;
  function mount(rec) { rec.el.onclick = onClick; }
})();
//__NasDeck_NS_END__
