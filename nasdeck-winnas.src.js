//__NasDeck_WINNAS_START__
/* ==================================================================
 * nasdeck-winnas.src.js —— WinNAS 引擎可视化层（最后注入）
 *
 * 这一层不实现任何文件能力，只把「既有 WinNAS 项目」提供的能力摆到
 * 桌面界面上：文件总管 / 资源回收站 / 存储与快照 / 容器工作台。
 * 所有按钮都调用 /api/nas/* 或 /api/bin/*，后端直接复用 C:\AI使用\项目\NasManager
 * 的同一份源码模块。引擎不可用时显示 N/A，绝不伪造。
 *
 * 由 build.py 在 real 层之后注入，包装 NasDeck.install / NasDeck.hydrate。
 * ================================================================== */
(function () {
  'use strict';
  var NA = 'N/A';
  var E = function (x) { return esc(String(x === null || x === undefined ? '' : x)); };
  var R = function (v) { return (v === null || v === undefined || v === '' || v === '—' || v === '-') ? NA : String(v); };
  var st = function () { return (window.NasDeck && NasDeck.winnas) || {}; };
  var btn = function (act, label, extra, cls) {
    return '<button class="btn sm ' + (cls || '') + '" data-act="' + act + '" ' + (extra || '') + '>' + E(label) + '</button>';
  };
  var recOf = function () { return (typeof W === 'function' && (W('filestation') || W('storage') || W('trash'))) || document.body; };
  var kv = function (k, v) { return '<div class="kv"><span class="k">' + E(k) + '</span><span class="v">' + E(R(v)) + '</span></div>'; };

  function bar(inner) {
    return '<div class="wns-bar" style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;' +
      'padding:7px 12px;border-bottom:1px solid var(--line,rgba(127,127,127,.22));font-size:11px;' +
      'color:var(--muted,inherit);background:rgba(34,167,232,.06)">' + inner + '</div>';
  }
  function tag(t) {
    return '<span style="font-weight:700;color:var(--accent,#22a7e8);letter-spacing:.3px">' + E(t) + '</span>';
  }
  function engineBar() {
    var s = st();
    return bar(tag('WinNAS 引擎') +
      '<span>版本 ' + E(R(s.version)) + '</span>' +
      '<span class="mono">实现 ' + E(R(s.home)) + '</span>' +
      '<span class="mono">数据 ' + E(R(s.dataDir)) + '</span>' +
      '<span>' + E((s.modules || []).length) + ' 个复用模块</span>' +
      '<span style="flex:1"></span>' +
      '<span>文件保存在 Windows 本机磁盘</span>');
  }
  function fileActions() {
    return bar('<span>' + tag('文件能力') + ' 由 WinNAS 的 paths / archive / versions / search / share 模块提供：</span>' +
      btn('wns-compress', '压缩选中') + btn('wns-extract', '解压选中') +
      btn('wns-versions', '版本快照') + btn('wns-share', '生成分享链接') +
      btn('wns-search', '全盘搜索') + btn('wns-status', '引擎详情'));
  }
  function binBar() {
    var s = st();
    return bar(tag('回收站实现') +
      '<span>Windows 系统回收站 · Shell.Application NameSpace(10) 列举 / SHFileOperation(FOF_ALLOWUNDO) 删除</span>' +
      '<span class="mono">' + E(R(s.recycleSource)) + '</span>' +
      '<span>与 WinNAS 的 src/recycle.js 同一份代码，桌面删的文件在这里同样可见</span>');
  }
  function snapshotBar() {
    var s = st();
    return bar(tag('文件版本快照') +
      '<span class="mono">' + E(R(s.fileVersionDir)) + '</span>' +
      '<span>保存文本文件时自动生成，可随时还原；与 WinNAS 的 src/versions.js 同一份代码</span>' +
      btn('wns-snapshot-open', '查看任意文件的版本') +
      '<span>卷影复制(VSS) 由「控制台 → 存储」管理，两者互不替代</span>');
  }
  function dockerBar() {
    return bar(tag('Docker') + '<span>只是本工具的一个小功能：沿用 WinNAS 的 WSL Docker 管理器方案，' +
      'dockerd 跑在 WSL 子系统内，容器工作台 直接读 Engine REST API；未上线时如实显示 N/A</span>');
  }

  function inject(html, k) {
    var b = engineBar();
    if (k === 'filestation') b += fileActions();
    else if (k === 'trash') b += binBar();
    else if (k === 'storage') b += snapshotBar();
    else if (k === 'container') b = dockerBar();
    if (html.indexOf('<div class="app">') === 0) return html.replace('<div class="app">', '<div class="app">' + b);
    if (html.indexOf('<div class="app-scroll">') >= 0) return html.replace('<div class="app-scroll">', '<div class="app-scroll">' + b);
    return b + html;
  }

  function hookRenders() {
    /* container 不在这里包装：容器工作台 已由 real 层重做为
       「单窗口 + 多标签页」，再插 dockerBar 横幅只会让窗口变乱。 */
    ['trash', 'storage'].forEach(function (k) {
      var orig = RENDER[k];
      if (typeof orig !== 'function' || orig.__wns) return;
      var wrapped = function () {
        var html = orig.apply(this, arguments);
        return typeof html === 'string' ? inject(html, k) : html;
      };
      wrapped.__wns = true;
      RENDER[k] = wrapped;
    });
    /* 文件总管不再用「包装」方式叠加横条：直接换成完整可用的真实文件管理器，
       内部自己带上 WinNAS 引擎横条与文件能力横条，避免多层包装丢样式/丢动作。 */
    RENDER.filestation = renderFileManager;
  }

  /* ---------------- 当前选中项 → 虚拟路径 ---------------- */
  function selected() {
    try { return (typeof fsSelected === 'function') ? fsSelected() : null; } catch (e) { return null; }
  }
  function curPath() {
    var f = selected();
    var base = (typeof FS_STATE !== 'undefined' && FS_STATE.path) ? FS_STATE.path : '/';
    var name = f ? String(f.n || '') : '';
    var p = (base === '/' ? '' : String(base).replace(/\/$/, '')) + '/' + name;
    return { dir: base, path: p, name: name };
  }
  function extra(c) {
    return 'data-path="' + E(c.path) + '" data-dir="' + E(c.dir) + '" data-name="' + E(c.name) + '"';
  }
  function need(c) {
    if (!c.name) { toast('请先在文件总管中选中一个项目', '', 'warn'); return false; }
    return true;
  }
  function fail(e) { toast('操作失败', e && e.message ? e.message : String(e), 'err'); }
  function refresh(c) {
    return NasDeck.get('/api/files/list?path=' + encodeURIComponent(c.dir)).then(function (r) {
      if (NasDeck.applyFiles) NasDeck.applyFiles(r);
    }).catch(function () {});
  }

  /* ---------------- ACT：全部只做「可视化 + 调 API」 ---------------- */
  function installActions() {
    ACT['wns-status'] = async function () {
      try {
        var s = await NasDeck.get('/api/nas/status');
        infoModal(recOf(), 'WinNAS 引擎状态',
          kv('可用', s.available ? '是' : '否') + kv('版本', s.version) + kv('实现目录', s.home) +
          kv('数据目录', s.dataDir) + kv('复用模块', (s.modules || []).join(', ')) +
          kv('盘符根已注入', s.rootsInjected ? '是' : '否') + kv('回收站实现', s.recycleSource) +
          kv('文件版本目录', s.fileVersionDir) + kv('缩略图引擎', s.sharp ? 'sharp 可用' : NA) +
          kv('回收站缓存', s.bin && s.bin.cached ? '已就绪' : '扫描中/未就绪') +
          kv('名称索引条目', s.search && s.search.count));
      } catch (e) { fail(e); }
    };

    ACT['wns-compress'] = function () {
      var c = curPath(); if (!need(c)) return;
      askModal(recOf(), '压缩为 ZIP', 'WinNAS archive.js：支持多项与 AES 密码（留空即不加密）', 'archive.zip', async function (v) {
        try {
          var r = await NasDeck.post('/api/nas/compress', { path: c.dir, items: [c.name], name: v || 'archive.zip' });
          toast('压缩完成', r.path + ' · ' + fmtSize(r.size), 'ok'); await refresh(c);
        } catch (e) { fail(e); }
      });
    };
    ACT['wns-extract'] = function () {
      var c = curPath(); if (!need(c)) return;
      if (!/\.(zip|tgz|tar\.gz)$/i.test(c.name)) { toast('请选择 ZIP / TAR.GZ 压缩包', '', 'warn'); return; }
      try {
        NasDeck.post('/api/nas/extract', { path: c.dir, name: c.name }).then(async function (r) {
          toast('解压完成', r.path, 'ok'); await refresh(c);
        }).catch(fail);
      } catch (e) { fail(e); }
    };
    ACT['wns-share'] = async function () {
      var c = curPath(); if (!need(c)) return;
      try {
        var r = await NasDeck.post('/api/nas/share/add', {
          path: c.path, name: c.name, hours: Number(SHS.hours) || 72, password: SHS.password || ''
        });
        v14ShareResult(r, c.name);
      } catch (e) { fail(e); }
    };
    ACT['wns-search'] = function () {
      askModal(recOf(), '全盘名称搜索', 'WinNAS search.js：admin 实时受限遍历本机所有盘（带上限）', '', async function (v) {
        if (!v) return;
        try {
          toast('正在搜索', '全盘遍历可能需要一点时间', 'info');
          var r = await NasDeck.get('/api/nas/search?q=' + encodeURIComponent(v) + '&limit=100');
          var rows = (r.results || []).map(function (x) {
            return '<tr><td>' + E(R(x.name)) + '</td><td class="mono dim">' + E(R(x.path || x.rel)) + '</td>' +
              '<td>' + E(x.size !== undefined ? fmtSize(x.size) : NA) + '</td></tr>';
          }).join('') || '<tr><td colspan="3" class="dim">没有匹配项 / N/A</td></tr>';
          infoModal(recOf(), '搜索结果 · ' + v,
            '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>名称</th><th>路径</th><th>大小</th></tr></thead><tbody>' +
            rows + '</tbody></table></div><p class="desc">共 ' + E(r.total || 0) + ' 条，全部来自本机真实磁盘。</p>');
        } catch (e) { fail(e); }
      });
    };

    /* 文件版本快照：列出 / 创建 / 还原 */
    ACT['wns-versions'] = async function () {
      var c = curPath(); if (!need(c)) return;
      try { await showVersions(c); } catch (e) { fail(e); }
    };
    ACT['wns-snapshot-open'] = function () {
      var c = curPath();
      askModal(recOf(), '查看文件版本快照', '输入虚拟路径，例如 /C:/Users/admin/Documents/note.txt',
        c.path && c.name ? c.path : '', async function (v) {
          if (!v) return;
          try { await showVersions({ path: v, name: v.split('/').pop(), dir: v }); } catch (e) { fail(e); }
        });
    };
    ACT['wns-version-create'] = async function (e, d) {
      var p = d && d.path; if (!p) { toast('缺少文件路径', '', 'warn'); return; }
      try {
        await NasDeck.post('/api/nas/version/create', { path: p });
        toast('版本快照已创建', p, 'ok');
        await showVersions({ path: p, name: p.split('/').pop(), dir: p });
      } catch (er) { fail(er); }
    };
    ACT['wns-version-restore'] = async function (e, d) {
      var p = d && d.path, n = d && d.name;
      if (!p || !n) { toast('缺少版本信息', '', 'warn'); return; }
      askModal(recOf(), '还原文件版本', '会用该版本覆盖当前文件，覆盖前自动再生成一个快照。', null, async function () {
        try { await NasDeck.post('/api/nas/version/restore', { path: p, name: n }); toast('版本已还原', n, 'ok'); }
        catch (er) { fail(er); }
      });
    };
  }
  async function showVersions(c) {
    var r = await NasDeck.get('/api/nas/versions?path=' + encodeURIComponent(c.path));
    var vs = r.versions || [];
    var rows = vs.map(function (v) {
      return '<tr><td>' + E(R(v.t)) + '</td><td>' + E(fmtSize(v.size)) + '</td>' +
        '<td class="mono dim">' + E(R(v.name)) + '</td><td>' +
        btn('wns-version-restore', '还原', 'data-path="' + E(c.path) + '" data-name="' + E(v.name) + '"') +
        '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="dim">N/A · 该文件暂无版本快照</td></tr>';
    infoModal(recOf(), '文件版本快照 · ' + c.name,
      kv('文件', c.path) + kv('快照目录', r.dir) + kv('快照数量', vs.length) +
      '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>时间</th><th>大小</th><th>版本文件</th><th>操作</th></tr></thead><tbody>' +
      rows + '</tbody></table></div><div style="margin-top:9px">' +
      btn('wns-version-create', '立即创建快照', 'data-path="' + E(c.path) + '"') + '</div>' +
      '<p class="desc">版本数据存放于 WinNAS 的 DATA_DIR/versions，不污染源文件目录。</p>');
  }

  /* ---------------- 版本徽标：一眼确认浏览器跑的是哪版前端 ----------------
   * 之前只有四个 App 窗口内有细横条，桌面/登录页外观完全没变，
   * 很容易让人以为「还是之前的前端」。这里在标签页标题 + 桌面右下角
   * 常驻显示版本与 build 日期，刷新后立刻可辨新旧。 */
  var BUILD = '2026-11-12';
  function badgeLabel() {
    var s = st();
    return 'WinNAS 引擎 v' + R(s.version || '2.2.0') + ' · ' +
      ((s.modules || []).length || 13) + ' 模块 · build ' + BUILD;
  }
  function mountBadge() {
    try {
      document.title = 'NasDeck · WinNAS 本机版 v2.2.0 (build ' + BUILD + ')';
      if (!document.body) return;
      var d = document.getElementById('wns-badge');
      if (d) {
        var t = document.getElementById('wns-badge-txt');
        if (t) t.textContent = badgeLabel();
        return;
      }
      d = document.createElement('div');
      d.id = 'wns-badge';
      d.title = '点击查看 WinNAS 引擎详情';
      d.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;' +
        'background:#22c55e;box-shadow:0 0 6px #22c55e;margin-right:7px"></span>' +
        '<span id="wns-badge-txt">' + E(badgeLabel()) + '</span>' +
        '<span style="opacity:.62;margin-left:7px">文件在 Windows 本机</span>';
      d.style.cssText = 'position:fixed;right:14px;bottom:12px;z-index:2147483000;' +
        'padding:6px 12px;border-radius:999px;font-size:11px;letter-spacing:.2px;' +
        'color:#eaf6ff;background:rgba(12,26,40,.88);border:1px solid rgba(34,167,232,.45);' +
        'box-shadow:0 3px 14px rgba(0,0,0,.35);cursor:pointer;user-select:none;font-family:inherit';
      d.onclick = function () { try { if (typeof ACT === 'object' && ACT['wns-status']) ACT['wns-status'](); } catch (e) {} };
      document.body.appendChild(d);
    } catch (e) {}
  }

  /* ==================================================================
   * 文件总管 —— 真正可用的 Windows 本机文件管理器
   *
   * 旧版只能「看」：没有分页（大目录只出前 200 项）、没有复制/移动/下载、
   * 没有多选、没有排序、系统保护目录直接 400 报「无法打开目录」。
   * 这里全部补齐，每个动作都走 /api/files/* 或 /api/nas/*，
   * 底层仍是 C:\AI使用\项目\NasManager 的 paths / archive / versions 等同一份实现。
   * ================================================================== */
  var FSX = {
    page: 1, pageSize: 100, sort: '', sortDir: 1, showHidden: false,
    view: 'list', q: '', sel: {}, anchor: -1, clipboard: null,
    total: 0, real: '', error: '', restricted: false, loading: false, qt: null
  };
  NasDeck.fsx = FSX;
  var FB = function (a, l, d, c, ic) {
    return '<button class="btn sm ' + (c || '') + '" data-act="' + a + '" ' + (d || '') + '>' +
      (ic ? glyph(ic, 12) + ' ' : '') + E(l) + '</button>';
  };
  function fpath() { return (typeof FS_STATE !== 'undefined' && FS_STATE.path) || '/'; }
  function fchild(p, n) { return (p === '/' ? '' : String(p).replace(/\/$/, '')) + '/' + n; }
  function fshown() {
    var all = FS[fpath()] || [], q = String(FSX.q || '').trim().toLowerCase();
    return q ? all.filter(function (f) { return String(f.n).toLowerCase().indexOf(q) >= 0; }) : all;
  }
  function fnames() {
    var out = [];
    Object.keys(FSX.sel).forEach(function (k) { if (FSX.sel[k]) out.push(k); });
    return out;
  }
  function fabs(n) {
    var base = FSX.real ? String(FSX.real).replace(/[\\\/]+$/, '') : '';
    return base ? base + '\\' + n : fchild(fpath(), n);
  }
  function furl(api, name, download) {
    return NasDeck.base + '/api/files/' + api + '?path=' + encodeURIComponent(fpath()) +
      '&name=' + encodeURIComponent(name) + (NasDeck.token ? '&token=' + encodeURIComponent(NasDeck.token) : '') +
      (download ? '&download=1' : '');
  }
  var FSEQ = 0;
  function fload(p, keepPage) {
    p = p || '/';
    if (!keepPage) FSX.page = 1;
    /* 用递增序号而不是「loading 标志」处理并发：
       快速连续点击目录时，旧请求要被丢弃，但新请求绝不能被 silent 丢掉，
       否则界面会停在旧目录（看起来就是「文件管理不能正常导航」）。
       同时给每个请求 20 秒兜底，避免任何一次挂起永久卡住 loading。 */
    var my = ++FSEQ, timer = null;
    FSX.loading = true; FSX.error = ''; FSX.restricted = false;
    var qs = '/api/files/list?path=' + encodeURIComponent(p) +
      '&page=' + FSX.page + '&pageSize=' + FSX.pageSize +
      '&sort=' + encodeURIComponent(FSX.sort) + '&sortDir=' + (FSX.sortDir < 0 ? '-1' : '1') +
      (FSX.showHidden ? '&showHidden=1' : '');
    var watchdog = new Promise(function (res) { timer = setTimeout(function () { res({ __timeout: true }); }, 20000); });
    return Promise.race([NasDeck.get(qs), watchdog]).then(function (r) {
      clearTimeout(timer);
      if (my !== FSEQ) return null;
      FSX.loading = false;
      if (!r || r.__timeout) {
        FSX.error = '读取超时（N/A）'; rerender('filestation');
        toast('目录读取超时', p, 'warn'); return null;
      }
      FSX.total = Number(r.total) || 0; FSX.real = r.real || '';
      FSX.error = r.error || ''; FSX.restricted = !!r.restricted;
      FS[r.path] = r.entries || [];
      FS_STATE.path = r.path; FS_STATE.sel = -1; FS_STATE.q = FSX.q;
      FSX.sel = {}; FSX.anchor = -1;
      rerender('filestation');
      return r;
    }).catch(function (e) {
      clearTimeout(timer);
      if (my !== FSEQ) return null;
      FSX.loading = false; FSX.error = e.message;
      rerender('filestation');
      toast('无法打开目录', e.message, 'err');
      return null;
    });
  }
  function fnav(p) {
    p = p || '/';
    try { if (p !== FS_STATE.path) FS_STATE.hist.push(FS_STATE.path); } catch (e) {}
    FSX.q = '';
    return fload(p);
  }
  function freload() { return fload(fpath(), true); }
  function fail(e) { toast('操作失败', e && e.message ? e.message : String(e), 'err'); }
  function fneed() {
    var n = fnames();
    if (!n.length) { toast('请先选择项目', '单击选中，Ctrl / Shift 可多选', 'warn'); return null; }
    return n;
  }
  function fApply(r) {
    if (r && r.files && r.files.path) {
      FS[r.files.path] = r.files.entries || [];
      FSX.total = r.files.total || 0;
      FSX.real = r.files.real || FSX.real;
    }
    freload();
  }

//__NasDeck_V13_FS_START__
  /* ==================================================================
   * v13 文件总管增强（需求 1~4）
   *  1 分页固定底部  2 键盘快捷键 + 鼠标框选
   *  3 目录树下方「分享链接」独立标签页 + 单独/批量管理
   *  4 链接按当前连接地址动态拼装（不硬编码 127.0.0.1:5080）
   * ================================================================== */
  var SHS = {
    loaded: false, loading: false, seq: 0, items: [], sel: {}, base: null,
    error: '', hours: 72, password: '', busy: false
  };
  NasDeck.shares = SHS;
  FSX.tab = FSX.tab || 'files';

  function v13Style() {
    if (document.getElementById('nasdeck-v13-style')) return;
    var el = document.createElement('style');
    el.id = 'nasdeck-v13-style';
    el.textContent = [
      '.nasdeck-fs-main{display:flex;flex-direction:column;min-height:0;overflow:hidden}',
      '.nasdeck-fs-foot{flex:none;display:flex;flex-direction:column;background:var(--panel);border-top:1px solid var(--line);padding:5px 12px 2px;box-shadow:0 -3px 12px rgba(0,0,0,.10)}',
      '.nasdeck-fs-pager{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-height:31px;font-size:11px;color:var(--muted)}',
      '.nasdeck-fs-foot .fs-status{border-top:0;background:none;height:25px;padding:0 2px}',
      '.nasdeck-fs-tabs{display:flex;align-items:center;gap:3px;flex:none;padding:5px 12px;border-bottom:1px solid var(--line);background:var(--panel)}',
      '.nasdeck-fs-tabs>button{padding:6px 14px;border:0;border-radius:7px;background:none;color:var(--muted);font:inherit;font-size:11.5px;cursor:pointer}',
      '.nasdeck-fs-tabs>button.on{background:rgba(34,167,232,.14);color:var(--accent);font-weight:700}',
      '.nasdeck-fs-tabs .sp{flex:1}',
      '.nasdeck-conn{font-size:10.5px;color:var(--muted);white-space:nowrap}',
      '.nasdeck-conn b{color:var(--accent);font-weight:600}',
      '.nasdeck-shares-entry{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;margin:10px 0 2px;padding:9px 8px;border:1px solid rgba(34,167,232,.42);border-radius:8px;background:rgba(34,167,232,.09);color:var(--accent);font:inherit;font-size:11.5px;font-weight:700;cursor:pointer}',
      '.nasdeck-shares-entry:hover{background:rgba(34,167,232,.18)}',
      '.nasdeck-shares-entry .badge{margin-left:4px}',
      '.nasdeck-shares-hint{font-size:10px;color:var(--muted);text-align:center;line-height:1.5;margin-bottom:4px}',
      '.nasdeck-sh-wrap{flex:1;min-height:0;overflow:auto;padding:12px 14px}',
      '.nasdeck-sh-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:11px}',
      '.nasdeck-sh-inp{width:78px;height:27px;padding:0 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:inherit;font:inherit;font-size:11px}',
      '.nasdeck-sh-url{font-size:10px;word-break:break-all;max-width:420px;margin-top:3px}',
      '.nasdeck-sh-pane .tbl-wrap{max-height:none}',
      '.nasdeck-sh-empty{padding:36px 10px;text-align:center;color:var(--muted);font-size:12px}',
      '.nasdeck-marquee{position:fixed;z-index:2147482000;border:1px solid var(--accent,#22a7e8);background:rgba(34,167,232,.16);pointer-events:none;border-radius:2px}',
      'body.nasdeck-marquee-on,body.nasdeck-marquee-on *{user-select:none!important;-webkit-user-select:none!important}',
      '.nasdeck-keyhint{font-size:10px;color:var(--muted);padding:0 2px}'
    ].join('\n');
    document.head.appendChild(el);
  }
  /* 登录/启动屏里静态写死的地址改成当前真实连接，端口可配置时不再误导 */
  function patchStaticHost() {
    try {
      var host = (location && location.host) || '';
      if (!host) return;
      var bs = document.querySelectorAll('b');
      for (var i = 0; i < bs.length; i++) {
        if (bs[i].textContent === '127.0.0.1:5080') bs[i].textContent = host;
      }
    } catch (e) {}
  }
  function shareOrigin() {
    try { if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin; }
    catch (e) {}
    if (SHS.base && SHS.base.origin) return SHS.base.origin;
    return '';
  }
  NasDeck.shareOrigin = shareOrigin;
  function shareUrl(rel) {
    var o = shareOrigin();
    try { return new URL(rel, o || location.href).href; }
    catch (e) { return (o || '') + rel; }
  }
  NasDeck.shareUrl = shareUrl;
  function copyText(v) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(v); return true; } } catch (e) {}
    try {
      var t = document.createElement('textarea');
      t.value = v; t.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(t); t.select();
      var done = document.execCommand('copy'); t.remove(); return done;
    } catch (e) { return false; }
  }
  function fmtDate(ms) {
    if (!ms) return 'N/A';
    try { return new Date(ms).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return String(ms); }
  }
  function shTokens() {
    return Object.keys(SHS.sel).filter(function (k) { return SHS.sel[k]; });
  }
  function shErr(e) { toast('分享操作失败', e && e.message ? e.message : String(e), 'err'); }
  function shReload() { return shsLoad(); }
  function shsLoad() {
    if (!NasDeck.token) return Promise.resolve();
    var my = ++SHS.seq;
    SHS.loading = true;
    return NasDeck.get('/api/nas/shares').then(function (r) {
      if (my !== SHS.seq) return;
      SHS.loading = false; SHS.loaded = true; SHS.error = '';
      SHS.items = (r && r.shares) || [];
      if (r && r.base && r.base.origin) SHS.base = r.base;
      var valid = {};
      SHS.items.forEach(function (s) { if (SHS.sel[s.token]) valid[s.token] = true; });
      SHS.sel = valid;
      try { if (typeof W === 'function' && W('filestation') && typeof rerender === 'function') rerender('filestation'); } catch (e) {}
      return r;
    }).catch(function (e) {
      if (my !== SHS.seq) return;
      SHS.loading = false; SHS.error = e.message || String(e);
    });
  }
  function shAfter(r, msg) {
    var bad = ((r && r.results) || []).filter(function (x) { return !x.ok; });
    toast(bad.length ? '部分操作未完成' : msg,
      bad.length ? bad.slice(0, 3).map(function (x) { return (x.name || x.token || '') + ': ' + (x.error || '失败'); }).join('; ')
        : ((r && r.results) || []).length + ' 项', bad.length ? 'warn' : 'ok');
    return shReload();
  }
  function shCreateFromSelection() {
    var names = fnames();
    if (!names.length) {
      toast('请先选择文件', '切到「文件浏览」标签，用单击 / Ctrl+A / 框选选中文件后再生成', 'warn');
      return;
    }
    SHS.busy = true;
    /* v14 需求 6：切页放在请求发起前。慢响应不得在用户已经点目录树切走之后
       再把 FSX.tab 抢回 shares（那会表现为「目录树点了没反应」）。 */
    SHS.tab = 'shares'; FSX.tab = 'shares';
    var enc = (window.NasDeck_V15 && typeof NasDeck_V15.shareArgs === 'function')
      ? NasDeck_V15.shareArgs() : { encrypted: false, password: SHS.password || '' };
    if (enc.encrypted && !enc.password) { toast('已开启加密访问', '请先填写访问密码', 'warn'); SHS.busy = false; return; }
    NasDeck.post('/api/nas/share/batch', {
      path: fpath(), items: names, hours: Number(SHS.hours) || 72,
      encrypted: enc.encrypted, password: enc.password
    }).then(function (r) { SHS.busy = false; v14ShareBatchResult(r); return shAfter(r, '已生成分享链接'); })
      .catch(function (e) { SHS.busy = false; shErr(e); });
  }
  function shCreateByPath() {
    askModal(fsWin() || document.body, '按路径生成分享链接',
      '输入文件总管里的虚拟路径，例如 /C:/Users/admin/Documents/a.txt 或 /Public/a.zip',
      fpath() === '/' ? '/Public/' : fpath().replace(/\/?$/, '/'), async function (v) {
        if (!v) return;
        try {
          var s = String(v).replace(/\\/g, '/');
          var dir = s.slice(0, s.lastIndexOf('/')) || '/';
          var name = s.slice(s.lastIndexOf('/') + 1);
          if (!name) { toast('路径需要包含文件名', '', 'warn'); return; }
          /* v14 需求 6：同 shCreateFromSelection，切页在发起请求前完成 */
          SHS.tab = 'shares'; FSX.tab = 'shares';
          var enc2 = (window.NasDeck_V15 && typeof NasDeck_V15.shareArgs === 'function')
            ? NasDeck_V15.shareArgs() : { encrypted: false, password: SHS.password || '' };
          if (enc2.encrypted && !enc2.password) { toast('已开启加密访问', '请先填写访问密码', 'warn'); return; }
          var r = await NasDeck.post('/api/nas/share/add', {
            path: dir, name: name, hours: Number(SHS.hours) || 72,
            encrypted: enc2.encrypted, password: enc2.password
          });
          v14ShareResult(r, name);
        } catch (e) { shErr(e); }
      });
  }
  function shActOne(act, token, extra) {
    var body = { act: act, tokens: [token] };
    if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    return NasDeck.post('/api/nas/share/batch-action', body).then(function (r) {
      return shAfter(r, act === 'revoke' ? '已撤销链接' : '已续期');
    });
  }
  function shBatch(act) {
    var t = shTokens();
    if (!t.length) { toast('请先勾选分享链接', '可以点表头全选，或逐条勾选', 'warn'); return; }
    if (act === 'copy') {
      var urls = SHS.items.filter(function (s) { return SHS.sel[s.token]; })
        .map(function (s) { return shareUrl('/s/' + s.token); }).join('\n');
      copyText(urls);
      toast('已复制 ' + t.length + ' 条链接', '完整地址基于当前连接 ' + shareOrigin(), 'ok');
      return;
    }
    if (act === 'revoke') {
      askModal(fsWin() || document.body, '批量撤销分享链接',
        '将撤销选中的 ' + t.length + ' 条链接，撤销后原地址立即失效。', null, function () {
          SHS.busy = true;
          NasDeck.post('/api/nas/share/batch-action', { act: 'revoke', tokens: t })
            .then(function (r) { SHS.busy = false; SHS.sel = {}; return shAfter(r, '已批量撤销'); })
            .catch(function (e) { SHS.busy = false; shErr(e); });
        });
      return;
    }
    SHS.busy = true;
    NasDeck.post('/api/nas/share/batch-action', { act: 'extend', tokens: t, hours: Number(SHS.hours) || 72 })
      .then(function (r) { SHS.busy = false; return shAfter(r, '已批量续期'); })
      .catch(function (e) { SHS.busy = false; shErr(e); });
  }

  function renderSharesPane() {
    var items = SHS.items || [], n = items.length, nsel = shTokens().length;
    var origin = shareOrigin();
    var bar = '<div class="nasdeck-sh-bar">' +
      '<span class="badge info">共 ' + n + ' 条</span>' +
      '<span class="badge">已选 ' + nsel + ' 条</span>' +
      '<span class="badge">连接 <b class="mono">' + E(origin || 'N/A') + '</b></span>' +
      '<div class="sp" style="flex:1"></div>' +
      FB('sh-refresh', '刷新', '', '', 'refresh') +
      FB('sh-create-selected', '为选中文件生成', '', 'primary', 'link') +
      FB('sh-create-path', '按路径生成', '', '', 'link') + '</div>';
    var cfg = '<div class="nasdeck-sh-bar">' +
      '<span class="muted">有效期(小时)</span>' +
      '<input class="nasdeck-sh-inp" id="sh-hours" type="number" min="0" max="8760" value="' + E(SHS.hours) + '" title="0 = 永久有效">' +
      '<span class="muted">访问密码(可留空)</span>' +
      '<input class="nasdeck-sh-inp" id="sh-password" style="width:120px" type="text" value="' + E(SHS.password) + '" placeholder="留空即无密码">' +
      (window.NasDeck_V15 && typeof NasDeck_V15.shareCfgHtml === 'function' ? NasDeck_V15.shareCfgHtml() : '') +
      '<div class="sp" style="flex:1"></div>' +
      FB('sh-all', nsel && nsel === n ? '取消全选' : '全选', '', '', 'grid') +
      FB('sh-batch-copy', '批量复制链接', '', '', 'copy') +
      FB('sh-batch-extend', '批量续期', '', '', 'refresh') +
      FB('sh-batch-revoke', '批量撤销', '', 'danger', 'trash') + '</div>';
    var rows = items.map(function (s) {
      var full = shareUrl('/s/' + s.token);
      var exp = !s.expiresAt ? '永久' : fmtDate(s.expiresAt);
      var dead = s.expiresAt && s.expiresAt > 0 && s.expiresAt < Date.now();
      var on = !!SHS.sel[s.token];
      var ops = FB('sh-copy-one', '复制链接', 'data-token="' + E(s.token) + '"', '', 'copy') +
        FB('sh-open', '打开', 'data-token="' + E(s.token) + '"', '', 'external') +
        FB('sh-extend-one', '续期', 'data-token="' + E(s.token) + '"', '', 'refresh') +
        FB('sh-revoke-one', '撤销', 'data-token="' + E(s.token) + '"', 'danger', 'trash');
      return '<tr class="' + (on ? 'sel' : '') + '">' +
        '<td style="width:28px"><input type="checkbox" ' + (on ? 'checked' : '') + ' data-act="sh-pick" data-token="' + E(s.token) + '" style="accent-color:var(--accent,#22a7e8)"></td>' +
        '<td><b>' + E(s.name || '(未知)') + '</b>' +
        '<div class="mono dim nasdeck-sh-url">' + E(full) + '</div>' +
        (s.passwordText ? '<div class="dim" style="font-size:10px">密码 ' + E(s.passwordText) + '</div>' : '') + '</td>' +
        '<td class="muted" style="font-size:10.5px">' + E(fmtDate(s.createdAt)) + '</td>' +
        '<td>' + (dead ? '<span class="badge">已过期</span>' : E(exp)) + '</td>' +
        '<td>' + (s.hasPassword ? '<span class="v15-tag warn">加密访问</span>' : '<span class="v15-tag ok">公开访问</span>') + '</td>' +
        '<td class="muted" style="font-size:10.5px">浏览 ' + (s.views || 0) + ' / 下载 ' + (s.downloads || 0) + '</td>' +
        '<td><div style="display:flex;gap:4px;flex-wrap:wrap">' + ops + '</div></td></tr>';
    }).join('');
    var table = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:28px"></th>' +
      '<th style="width:38%">文件 / 完整链接</th><th>创建时间</th><th>有效期至</th><th>保护</th><th>统计</th><th>单独管理</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="dim">' +
        (SHS.loading ? '正在读取分享列表…' : '还没有分享链接。切到「文件浏览」选中文件后点「为选中文件生成」。') +
        '</td></tr>') + '</tbody></table></div>';
    var note = '<p class="desc" style="margin-top:10px;font-size:10.5px">' +
      '链接由「当前连接地址 + 令牌」实时拼装：此处显示 <b class="mono">' + E(origin || 'N/A') +
      '</b>，改端口或改用局域网 IP 访问后会自动跟着变，不会写死 127.0.0.1:5080。' +
      '分享记录来自 WinNAS 的 data/shares.json；打开链接会校验有效期与密码后由本机后端直出文件。</p>' +
      (SHS.error ? '<div class="card" style="border-color:var(--warn)"><p class="desc">读取失败：' + E(SHS.error) + '</p></div>' : '');
    return '<div class="nasdeck-sh-pane nasdeck-sh-wrap">' +
      '<div class="section-title">' + glyph('link', 14) + '分享链接 · 单独 / 批量管理</div>' +
      bar + cfg + table + note +
      '<div class="nasdeck-keyhint">提示：在「文件浏览」标签可用 Ctrl+A 全选、Ctrl+C / Ctrl+X / Ctrl+V、Delete、鼠标拖拽框选；切回本页即可批量生成。</div>' +
      '</div>';
  }

  function renderFileManager() {
    var p = fpath(), list = fshown(), total = FSX.total || list.length;
    var pages = Math.max(1, Math.ceil(total / FSX.pageSize));
    if (FSX.page > pages) FSX.page = pages;
    var segs = (p === '/' ? [] : p.split('/').filter(Boolean));
    var crumbs = segs.map(function (c, i) {
      return '<button data-act="fsx-crumb" data-depth="' + (i + 1) + '">' + E(c) + '</button>';
    }).join('<span style="color:var(--dim)">/</span>');
    var nsel = fnames().length;

    var tb =
      FB('fsx-back', '', '', '', 'back') + FB('fsx-up', '', '', '', 'up') + FB('fsx-refresh', '刷新', '', '', 'refresh') +
      '<div class="tb-div" style="height:20px;margin:0 3px"></div>' +
      FB('fsx-newfolder', '新建文件夹', '', '', 'folder') + FB('fsx-newfile', '新建文件', '', '', 'file') +
      FB('fsx-upload', '上传', '', '', 'upload') +
      FB('fsx-copy', '复制', '', '', 'copy') + FB('fsx-cut', '剪切', '', '', 'scissors') +
      FB('fsx-paste', '粘贴' + (FSX.clipboard ? ' (' + FSX.clipboard.items.length + ')' : ''), '', '', 'clipboard') +
      FB('fsx-download', '下载', '', '', 'download') +
      FB('fsx-rename', '重命名', '', '', 'edit') + FB('fsx-delete', '删除', '', 'danger', 'trash') +
      FB('fsx-prop', '属性', '', '', 'info') + FB('fsx-realpath', '复制真实路径', '', '', 'link') +
      '<div class="sp"></div>' +
      FB('fsx-sort', '名称', 'data-s=""', FSX.sort === '' ? 'primary' : '') +
      FB('fsx-sort', '大小', 'data-s="size"', FSX.sort === 'size' ? 'primary' : '') +
      FB('fsx-sort', '时间', 'data-s="mtime"', FSX.sort === 'mtime' ? 'primary' : '') +
      FB('fsx-hidden', FSX.showHidden ? '隐藏：显示' : '隐藏：不显示', '', FSX.showHidden ? 'primary' : '', 'eye') +
      '<div class="seg"><button class="' + (FSX.view === 'grid' ? 'on' : '') + '" data-act="fsx-view" data-v="grid">' + glyph('grid', 13) + '</button><button class="' + (FSX.view === 'list' ? 'on' : '') + '" data-act="fsx-view" data-v="list">' + glyph('list', 13) + '</button></div>';

    var tree = '<div class="side-t">本机磁盘与目录（真实）</div>' +
      (FS_TREE || []).map(function (t) {
        return '<button class="fs-node ' + (p === t.p ? 'on' : '') + '" data-act="fsx-goto" data-path="' +
          E(t.p) + '" style="padding-left:' + (8 + (t.d || 0) * 13) + 'px"><span class="ind">' +
          (t.d ? '' : '▾') + '</span>' + glyph(t.d ? 'folder' : 'home', 13) + E(t.n) + '</button>';
      }).join('');
    /* 需求 3：目录树正下方一个独立按钮，点开是独立标签页 */
    var shareEntry = '<button class="nasdeck-shares-entry" data-act="fsx-shares-tab">' + glyph('link', 13) +
      '分享链接' + (SHS.items.length ? ' <span class="badge">' + SHS.items.length + '</span>' : '') + '</button>' +
      '<div class="nasdeck-shares-hint">管理本机文件外链<br>支持单独与批量操作</div>';

    var ds = NasDeck.realDrives || [];
    var vol = '<div class="side-t" style="margin-top:14px">本机存储空间</div><div class="card" style="padding:10px 11px">' +
      (ds.length ? ds.map(function (d) {
        var pct = (d.pct === null || d.pct === undefined) ? null : Number(d.pct);
        return '<div style="margin-bottom:10px"><div style="font-size:11px;font-weight:600;margin-bottom:5px">' +
          E(d.drive) + ' <span class="badge">' + (pct === null ? 'N/A' : pct.toFixed(1) + '%') + '</span></div>' +
          '<div class="prog warn"><i style="width:' + (pct === null || isNaN(pct) ? 0 : pct) + '%"></i></div>' +
          '<div style="font-size:10px;color:var(--muted);margin-top:5px">' +
          E(d.total ? fmtSize(d.total) : 'N/A') + ' · 可用 ' + E(d.free ? fmtSize(d.free) : 'N/A') + '</div></div>';
      }).join('') : '<div class="dim" style="font-size:11px">N/A</div>') + '</div>';

    var rows = list.map(function (f, i) {
      var on = !!FSX.sel[f.n];
      var chk = '<input type="checkbox" ' + (on ? 'checked' : '') + ' style="pointer-events:none;accent-color:var(--accent,#22a7e8)">';
      var size = f.drive ? E(f.desc || f.n) : (f.t === 'dir' ? '文件夹' : fmtSize(f.sz || 0));
      var type = f.drive ? '本地磁盘' : (f.t === 'dir' ? '文件夹' : ({ doc: '文档', img: '照片', vid: '影片', aud: '音乐', zip: '压缩档' }[f.t] || '文件'));
      return '<tr class="' + (on ? 'sel' : '') + '" data-act="fsx-sel" data-i="' + i + '" data-open="fsx-open">' +
        '<td style="width:30px">' + chk + '</td>' +
        '<td><div class="nm">' + glyph(f.t === 'dir' || f.drive ? 'folder' : 'file', 15, 'var(--accent)') + E(f.n) + '</div></td>' +
        '<td>' + size + '</td><td>' + type + '</td><td class="muted">' + E(f.m || 'N/A') + '</td></tr>';
    }).join('');
    var table = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:30px"><input type="checkbox" ' +
      (nsel && nsel === list.length ? 'checked' : '') + ' data-act="fsx-selall" style="accent-color:var(--accent,#22a7e8)"></th>' +
      '<th style="width:42%">名称</th><th>大小 / 容量</th><th>类型</th><th>修改日期</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5"><div class="empty" style="height:150px">' + glyph('folderopen', 36) +
        (FSX.error ? E(FSX.error) : (FSX.loading ? '正在读取真实目录…' : '此文件夹是空的')) + '</div></td></tr>') +
      '</tbody></table></div>';
    var grid = '<div class="fs-grid">' + list.map(function (f, i) {
      return '<div class="fs-cell ' + (FSX.sel[f.n] ? 'sel' : '') + '" data-act="fsx-sel" data-i="' + i + '" data-open="fsx-open">' +
        (FSX.sel[f.n] ? '<span style="position:absolute;right:6px;top:5px;color:var(--accent)">✓</span>' : '') +
        fsIcon(f.t) + '<b>' + E(f.n) + '</b><small>' +
        (f.drive ? E(f.desc || f.n) : (f.t === 'dir' ? '文件夹' : fmtSize(f.sz || 0))) + '</small></div>';
    }).join('') + '</div>';

    /* 需求 1：分页条移出 .fs-view，放进窗口固定的底部栏 */
    var pager = FB('fsx-page', '首页', 'data-p="1"', FSX.page <= 1 ? 'disabled' : '') +
      FB('fsx-page', '上一页', 'data-d="-1"', FSX.page <= 1 ? 'disabled' : '') +
      '<span>第 <b>' + FSX.page + '</b> / ' + pages + ' 页 · 共 <b>' + total + '</b> 项</span>' +
      FB('fsx-page', '下一页', 'data-d="1"', FSX.page >= pages ? 'disabled' : '') +
      FB('fsx-page', '末页', 'data-p="' + pages + '"', FSX.page >= pages ? 'disabled' : '') +
      '<span style="margin-left:8px">每页</span>' +
      [50, 100, 200, 500].map(function (n) {
        return '<button class="btn sm ' + (FSX.pageSize === n ? 'primary' : '') + '" data-act="fsx-pagesize" data-n="' + n + '">' + n + '</button>';
      }).join('') +
      '<span style="flex:1"></span>' + FB('fsx-searchall', '全盘名称搜索', '', '', 'search');

    var notice = FSX.error
      ? '<div class="card" style="border-color:var(--warn,#e0a020);margin-bottom:9px"><div class="section-title">' +
        glyph('alert', 14) + '目录访问提示</div><p class="desc">' + E(FSX.error) +
        '。这是 Windows 的真实权限结果，不是数据缺失；可返回上层或换一个目录。</p></div>' : '';

    var status = '<div class="fs-status"><span>' + list.length + ' 个显示 / ' + total + ' 个实际</span>' +
      '<span>已选 ' + nsel + ' 项</span><span>真实路径：<span class="mono">' + E(FSX.real || R(fpath())) + '</span></span>' +
      '<div class="sp"></div><span>' + (FSX.loading ? '读取中…' : 'Windows 本机磁盘 · WinNAS 引擎') +
      (FSX.clipboard ? ' · 剪贴板 ' + FSX.clipboard.mode + ' ' + FSX.clipboard.items.length + ' 项' : '') + '</span></div>';

    /* v15 需求 9：按钮放不下时由 v15 层把尾部按钮搬进这个下拉 */
    var moreBtn = '<button class="v15-more-btn" data-act="v15-more">更多 ▾</button>' +
      '<div class="v15-more-menu" hidden></div>';

    /* v15 需求 4：顶部不再放「文件浏览 / 分享链接」按钮，
       统一由窗口底部固定栏的「目录树 / 分享链接」切换标签页。 */
    var tabs = (window.NasDeck_V15 && typeof NasDeck_V15.fsTabsHtml === 'function')
      ? NasDeck_V15.fsTabsHtml() : '<div class="nasdeck-fs-tabs"></div>';

    /* v15 需求 8：本机存储空间与分享链接按钮移到窗口最下面的固定栏 */
    var side = tree;
    var dock = (window.NasDeck_V15 && typeof NasDeck_V15.fsDockHtml === 'function')
      ? NasDeck_V15.fsDockHtml(FSX.tab) : '';
    if (FSX.tab === 'shares') {
      return '<div class="app">' + engineBar() + fileActions() +
        '<div class="toolbar v15-toolbar" id="v15-fs-toolbar">' + tb + moreBtn + '</div>' + tabs +
        '<div class="app-row"><div class="app-side">' + side + '</div>' +
        '<div class="app-main nasdeck-fs-main">' + renderSharesPane() + '</div></div>' + dock + '</div>';
    }
    /* v16.3：底部 dock 只保留「传输进度」一个面板 tab（操作历史 Tab 已按需求移除）。
       面板由 netshare 层提供；运行时才取 NasDeck_NS（注入顺序 wns < ns），未加载时给友好降级。 */
    if (FSX.tab === 'transfer') {
      var pane = '';
      try {
        var NS = window.NasDeck_NS;
        pane = (NS && typeof NS.fsTransferPane === 'function') ? NS.fsTransferPane() : '';
      } catch (er) { pane = ''; }
      if (!pane) pane = '<div class="ns-empty" style="padding:24px;text-align:center;opacity:.6">面板加载中，请稍候…</div>';
      return '<div class="app">' + engineBar() +
        '<div class="toolbar v15-toolbar" id="v15-fs-toolbar">' + tb + moreBtn + '</div>' + tabs +
        '<div class="app-row"><div class="app-side">' + side + '</div>' +
        '<div class="app-main nasdeck-fs-main">' + pane + '</div></div>' + dock + '</div>';
    }
    return '<div class="app">' + engineBar() + fileActions() +
      '<div class="toolbar v15-toolbar" id="v15-fs-toolbar">' + tb + moreBtn + '</div>' + tabs +
      '<div class="app-row"><div class="app-side">' + side + '</div>' +
      '<div class="app-main nasdeck-fs-main">' +
      '<div class="fs-path">' + glyph('home', 14, 'var(--muted)') +
      '<div class="crumb"><button data-act="fsx-crumb" data-depth="0">此电脑</button>' +
      (crumbs ? '<span style="color:var(--dim)">/</span>' + crumbs : '') + '</div><div style="flex:1"></div>' +
      '<div class="inp" style="display:flex;align-items:center;gap:7px;width:190px;padding:0 9px;height:28px">' +
      glyph('search', 13, 'var(--muted)') + '<input id="fsx-q" style="flex:1;background:none;border:0;font-size:11px;min-width:0" placeholder="筛选当前目录" value="' + E(FSX.q) + '"></div></div>' +
      '<div class="fs-view" style="padding:10px 12px">' + notice + (list.length ? (FSX.view === 'grid' ? grid : table) :
        '<div class="empty">' + glyph('folderopen', 40) + '此文件夹是空的</div>') + '</div>' +
      '<div class="nasdeck-fs-foot"><div class="nasdeck-fs-pager">' + pager + '</div>' + status + '</div>' +
      '</div></div>' + dock + '</div>';
  }

  /* ---------------- 需求 2a：键盘快捷键 ---------------- */
  function fsTopWin() {
    var wins = document.querySelectorAll('.win'), best = null, bz = -Infinity;
    for (var i = 0; i < wins.length; i++) {
      var w = wins[i];
      if (w.style.display === 'none' || w.classList.contains('hidden')) continue;
      var z = parseInt(w.style.zIndex || '0', 10); if (isNaN(z)) z = 0;
      if (z >= bz) { bz = z; best = w; }
    }
    return best;
  }
  function fsKeysActive() {
    var win = fsWin();
    if (!win || !win.el) return false;
    var top = fsTopWin();
    if (top && top !== win.el && !win.el.contains(top)) return false;
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return false;
    return true;
  }
  function installFsKeys() {
    if (window.__NasDeck_V13_KEYS__) return;
    window.__NasDeck_V13_KEYS__ = true;
    document.addEventListener('keydown', function (e) {
      if (!fsKeysActive()) return;
      var k = String(e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (FSX.tab === 'shares') {
        if (mod && k === 'a') { e.preventDefault(); ACT['sh-all'] && ACT['sh-all'](); }
        return;
      }
      if (mod && k === 'a') { e.preventDefault(); ACT['fsx-selall'](); return; }
      if (mod && k === 'c') { e.preventDefault(); ACT['fsx-copy'](); return; }
      if (mod && k === 'x') { e.preventDefault(); ACT['fsx-cut'](); return; }
      if (mod && k === 'v') { e.preventDefault(); ACT['fsx-paste'](); return; }
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); ACT['fsx-delete'](); return; }
      if (k === 'f2') { e.preventDefault(); ACT['fsx-rename'](); return; }
      if (k === 'escape') {
        FSX.sel = {}; FSX.anchor = -1;
        try { rerender('filestation'); } catch (er) {}
      }
    }, true);
  }

  /* ---------------- 需求 2b：鼠标拖拽框选 ---------------- */
  function installFsMarquee() {
    if (window.__NasDeck_V13_MARQUEE__) return;
    window.__NasDeck_V13_MARQUEE__ = true;
    var box = null, view = null, sx = 0, sy = 0, active = false, additive = false, baseSel = {}, shown = [];
    function rectOf(el) { return el.getBoundingClientRect(); }
    function paint(cx, cy) {
      var l = Math.min(sx, cx), t = Math.min(sy, cy), r = Math.max(sx, cx), b = Math.max(sy, cy);
      box.style.left = l + 'px'; box.style.top = t + 'px';
      box.style.width = Math.max(0, r - l) + 'px'; box.style.height = Math.max(0, b - t) + 'px';
      var next = additive ? Object.assign({}, baseSel) : {};
      var nodes = view.querySelectorAll('[data-act="fsx-sel"]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i], q = rectOf(el);
        var hit = q.right > l && q.left < r && q.bottom > t && q.top < b;
        var f = shown[+(el.dataset.i)];
        if (!f) continue;
        if (hit) next[f.n] = true;
        /* 只改 class / 勾选态，不重绘：重绘会重建 DOM 打断框选 */
        el.classList.toggle('sel', !!next[f.n]);
        var cb = el.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = !!next[f.n];
      }
      FSX.sel = next;
    }
    function finish() {
      if (!active) return;
      active = false;
      if (box) { box.remove(); box = null; }
      document.body.classList.remove('nasdeck-marquee-on');
      var st = 0; try { st = view.scrollTop; } catch (e) {}
      try { rerender('filestation'); } catch (e) {}
      try { var v2 = fsWin() && fsWin().el.querySelector('.fs-view'); if (v2) v2.scrollTop = st; } catch (e) {}
      view = null;
    }
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || active || !fsKeysActive() || FSX.tab !== 'files') return;
      var win = fsWin();
      if (!win || !win.el.contains(e.target)) return;
      view = e.target.closest ? e.target.closest('.fs-view') : null;
      if (!view) return;
      /* 只在空白区域起手：点到行 / 按钮 / 输入框交给原有单击逻辑 */
      if (e.target.closest('[data-act],button,input,a,.btn,.tbl-wrap,.fs-grid')) {
        var c = e.target.closest('[data-act="fsx-sel"]');
        if (c) { view = null; return; }
        /* .tbl-wrap / .fs-grid 的空白（表头与容器间隙）仍允许起手 */
        if (e.target.closest('button,input,a,.btn,[data-act]')) { view = null; return; }
      }
      active = true; additive = !!(e.ctrlKey || e.metaKey || e.shiftKey);
      baseSel = Object.assign({}, FSX.sel); shown = fshown();
      sx = e.clientX; sy = e.clientY;
      box = document.createElement('div'); box.className = 'nasdeck-marquee';
      document.body.appendChild(box);
      document.body.classList.add('nasdeck-marquee-on');
      paint(sx, sy);
      e.preventDefault();
    }, true);
    document.addEventListener('mousemove', function (e) {
      if (!active || !box) return;
      paint(e.clientX, e.clientY);
    }, true);
    document.addEventListener('mouseup', function () { finish(); }, true);
  }

  /* ---------------- v16.3 统一文件操作任务池埋点 ----------------
   * 把复制/移动/删除/新建/重命名登记到 NasDeck_NS 的 S.ops，
   * 与上传/下载共用同一条「传输进度」时间线。NS 在本层之后注入，
   * 但 ACT 在运行时（用户点击时）执行，此时 window.NasDeck_NS 已就绪。 */
  function opBegin(op, name, srcDir, dstDir, size) {
    try {
      if (window.NasDeck_NS && typeof NasDeck_NS.recordOp === 'function')
        return NasDeck_NS.recordOp(op, name, srcDir, dstDir, size);
    } catch (e) {}
    return null;
  }
  function opDone(t, extra) { try { if (t && window.NasDeck_NS) NasDeck_NS.setOpDone(t, extra); } catch (e) {} }
  function opFail(t, msg) { try { if (t && window.NasDeck_NS) NasDeck_NS.setOpError(t, msg); } catch (e) {} }

  /* ---------------- 需求 3/4：分享标签页与动态链接动作 ---------------- */
  function installV13Actions() {
    ACT['fsx-tab'] = function (e, d) {
      var t = (d && d.t) || 'files';
      /* v16.3：files/shares 为原有页；transfer 为内嵌面板页（操作历史 Tab 已移除） */
      FSX.tab = (t === 'shares' || t === 'transfer') ? t : 'files';
      if (FSX.tab === 'shares') shsLoad();
      if (FSX.tab === 'transfer' && window.NasDeck_NS && typeof NasDeck_NS.refreshTasks === 'function') {
        try { NasDeck_NS.refreshTasks(true); } catch (er) {}
      }
      rerender('filestation');
    };
    ACT['fsx-shares-tab'] = function () {
      FSX.tab = 'shares'; shsLoad(); rerender('filestation');
    };
    ACT['sh-refresh'] = function () { shReload(); toast('已刷新分享列表', shareOrigin(), 'ok'); };
    ACT['sh-pick'] = function (e, d) {
      var t = d && d.token; if (!t) return;
      SHS.sel[t] = !SHS.sel[t]; rerender('filestation');
    };
    ACT['sh-all'] = function () {
      var all = shTokens().length === SHS.items.length && SHS.items.length > 0;
      SHS.sel = {};
      if (!all) SHS.items.forEach(function (s) { SHS.sel[s.token] = true; });
      rerender('filestation');
    };
    ACT['sh-copy-one'] = function (e, d) {
      var t = d && d.token; if (!t) return;
      copyText(shareUrl('/s/' + t));
      toast('已复制完整分享链接', shareUrl('/s/' + t), 'ok');
    };
    ACT['sh-open'] = function (e, d) {
      var t = d && d.token; if (!t) return;
      window.open(shareUrl('/s/' + t), '_blank');
    };
    ACT['sh-extend-one'] = function (e, d) {
      var t = d && d.token; if (!t) return;
      shActOne('extend', t, { hours: Number(SHS.hours) || 72 }).catch(shErr);
    };
    ACT['sh-revoke-one'] = function (e, d) {
      var t = d && d.token; if (!t) return;
      askModal(fsWin() || document.body, '撤销分享链接', '撤销后该地址立即失效，本机文件不会被删除。', null, function () {
        shActOne('revoke', t).catch(shErr);
      });
    };
    ACT['sh-batch-copy'] = function () { shBatch('copy'); };
    ACT['sh-batch-extend'] = function () { shBatch('extend'); };
    ACT['sh-batch-revoke'] = function () { shBatch('revoke'); };
    ACT['sh-create-selected'] = function () { shCreateFromSelection(); };
    ACT['sh-create-path'] = function () { shCreateByPath(); };
    /* 分享页配置输入：值存在 state 里，重绘不会丢 */
    if (!window.__NasDeck_V13_SH_INPUT__) {
      window.__NasDeck_V13_SH_INPUT__ = true;
      document.addEventListener('input', function (e) {
        if (!e.target || !e.target.id) return;
        if (e.target.id === 'sh-hours') SHS.hours = e.target.value;
        else if (e.target.id === 'sh-password') SHS.password = e.target.value;
      });
    }
  }
  function installV13() {
    v13Style(); patchStaticHost(); installFsKeys(); installFsMarquee(); installV13Actions(); installV14Fs();
    /* 登录后拉一次真实分享列表（带 token，避免加载阶段 401） */
    if (NasDeck.token && !SHS.loaded && !SHS.loading) shsLoad();
  }
//__NasDeck_V13_FS_END__
//__NasDeck_V14_FS_START__
  /* ==================================================================
   * v14 文件总管（需求 1 / 5 / 6）
   *  · 媒体文件双击不再弹小窗，改为打开对应媒体 App 的沉浸式播放页
   *  · 分享链接生成后即显示「复制链接」并默认复制；链接是完整 URL
   *  · 目录树 / 面包屑 / 上层 / 后退 一律切回「文件浏览」标签
   *  · 单击选中改为局部 DOM 更新：整窗重绘会让浏览器 dblclick 丢失目标，
   *    这正是「文件夹不能双击打开」的根因
   * ================================================================== */
  function v14FsPaintSel() {
    var win = fsWin();
    if (!win || !win.el) { try { rerender('filestation'); } catch (e) {} return; }
    var shown = fshown(), n = fnames().length;
    var nodes = win.el.querySelectorAll('[data-act="fsx-sel"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i], f = shown[+el.dataset.i]; if (!f) continue;
      var on = !!FSX.sel[f.n];
      el.classList.toggle('sel', on);
      var cb = el.querySelector('input[type="checkbox"]'); if (cb) cb.checked = on;
    }
    var st = win.el.querySelector('.nasdeck-fs-foot .fs-status');
    if (st) {
      var spans = st.querySelectorAll('span');
      if (spans.length > 1) spans[1].textContent = '已选 ' + n + ' 项';
    }
    var all = win.el.querySelector('[data-act="fsx-selall"]');
    if (all) all.checked = !!(shown.length && n >= shown.length);
  }

  /* askModal / infoModal 的宿主必须是带 .win-body 的窗口记录；
     桌面上一个窗口都没开时 document.body 会让底座弹窗函数抛错。 */
  function v14ModalHost() {
    try { var w = fsWin(); if (w && w.el && w.el.querySelector('.win-body')) return w; } catch (e) {}
    try {
      if (typeof WINS !== 'undefined' && WINS) {
        var a = WINS.filter(function (x) { return !x.closed && x.el && x.el.querySelector('.win-body'); })[0];
        if (a) return a;
      }
    } catch (e) {}
    return null;
  }

  /* 分享结果浮层：挂在 body 而不是 .win-body。
     窗口内 modal 会被后续的 shReload()→rerender() 连 .win-body 一起重建删掉，
     用户会看到「复制链接」按钮一闪即逝 —— v14 改为独立浮层，稳定可点。 */
  function v14SharePanel(title, html) {
    var old = document.getElementById('v14-share-panel'); if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'v14-share-panel';
    el.style.cssText = 'position:fixed;z-index:2147481000;right:18px;bottom:64px;width:min(520px,92vw);' +
      'max-height:76vh;overflow:auto;border:1px solid rgba(34,167,232,.55);border-radius:12px;' +
      'background:var(--panel,#12283a);box-shadow:0 18px 60px rgba(0,0,0,.55);color:inherit;font-size:11.5px';
    el.innerHTML = '<div style="display:flex;align-items:center;gap:9px;padding:11px 14px;' +
      'border-bottom:1px solid var(--line,#2a4a63);font-size:12.5px;font-weight:700">' +
      '<span style="flex:1">' + E(title) + '</span>' +
      '<button class="btn sm" data-act="v14-share-close" title="关闭">×</button></div>' +
      '<div style="padding:12px 14px">' + html + '</div>';
    document.body.appendChild(el);
    return el;
  }

  /* 生成分享链接后的统一结果弹窗：完整 URL + 一键复制 + 默认已复制 */
  function v14ShareUrl(r) {
    if (!r) return '';
    return shareUrl(r.url || r.rel || r.path || ('/s/' + ((r.share || {}).token || '')));
  }
  function v14ShareResult(r, name) {
    var url = v14ShareUrl(r);
    if (!url) { toast('分享链接生成异常', '后端未返回链接', 'err'); return; }
    copyText(url);
    var html = '<div class="card" style="padding:12px">' +
      kv('分享对象', name || (r.name || 'N/A')) +
      '<div class="kv"><span class="k">完整链接</span><span class="v mono" style="word-break:break-all">' + E(url) + '</span></div>' +
      kv('有效期', (Number(SHS.hours) || 72) + ' 小时') +
      kv('访问密码', SHS.password || '无') +
      kv('链接来源', '当前连接 ' + shareOrigin()) + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
      '<button class="btn primary" data-act="v14-share-copy" data-url="' + E(url) + '">复制链接</button>' +
      '<button class="btn" data-act="v14-share-open" data-url="' + E(url) + '">打开链接</button>' +
      '<button class="btn" data-act="v14-share-tab">进入分享管理</button></div>' +
      '<p class="desc" style="margin-top:10px">链接已自动复制到剪贴板。打开后是网盘式文件页：列出分享内的真实文件，' +
      '可勾选后单个下载或打包 ZIP、预览，不会一打开就直接下载。</p>';
    v14SharePanel('分享链接已生成 · 可分享文件', html);
    shReload();
  }
  function v14ShareBatchResult(r) {
    var oks = ((r && r.results) || []).filter(function (x) { return x.ok; });
    var urls = oks.map(function (x) { return v14ShareUrl(x); }).join('\n');
    if (urls) copyText(urls);
    var rows = ((r && r.results) || []).map(function (x) {
      return '<tr><td>' + E(x.name) + '</td><td>' + (x.ok
        ? '<span class="mono" style="word-break:break-all">' + E(v14ShareUrl(x)) + '</span>'
        : '<span style="color:var(--warn)">' + E(x.error || '失败') + '</span>') + '</td></tr>';
    }).join('');
    var html = '<div class="tbl-wrap" style="max-height:230px"><table class="tbl"><thead><tr><th>文件 / 文件夹</th><th>结果</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="2" class="dim">没有结果</td></tr>') + '</tbody></table></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
      '<button class="btn primary" data-act="v14-share-copy" data-url="' + E(urls) + '">复制全部链接</button>' +
      '<button class="btn" data-act="v14-share-tab">进入分享管理</button></div>' +
      '<p class="desc" style="margin-top:10px">共成功 ' + oks.length + ' 条，链接已自动复制。' +
      '失败项会如实显示原因（多为文件已不在本机磁盘）。</p>';
    v14SharePanel('批量分享链接已生成', html);
    shReload();
  }

  /* 需求 1：文件总管里双击媒体文件 → 对应媒体 App 的沉浸式播放页 */
  function v14OpenMedia(f) {
    var id = f.t === 'img' ? 'photodeck' : (f.t === 'aud' ? 'music' : 'video');
    var abs = fabs(f.n);
    var url = NasDeck.base + '/api/files/open?path=' + encodeURIComponent(fpath()) + '&name=' + encodeURIComponent(f.n);
    var it = {
      n: f.n, path: abs, url: url, title: f.n, kind: (f.t === 'img' ? 'photo' : (f.t === 'aud' ? 'music' : 'video')),
      artist: 'N/A', album: 'N/A', durText: 'N/A', szText: fmtSize(f.sz || 0), d: f.m || 'N/A',
      cover: null, lyrics: null, lyricsUrl: null, subtitles: [], meta: {}
    };
    if (NasDeck.v14 && typeof NasDeck.v14.openSingle === 'function') { NasDeck.v14.openSingle(id, it); return; }
    toast('媒体播放页尚未就绪', '请稍候 1 秒再试，或先打开一次 ' + id, 'warn');
  }

  /* 需求 5/6 的动作：installV13() 里调用，本身幂等，不与 v13 的 ACT 互相覆盖 */
  function installV14Fs() {
    if (window.__NasDeck_V14_FS_ACT__) return;
    window.__NasDeck_V14_FS_ACT__ = true;
    ACT['v14-share-copy'] = function (e, d) {
      var u = (d && d.url) || '';
      if (!u) { toast('没有可复制的链接', '', 'warn'); return; }
      copyText(u); toast('已复制分享链接', u, 'ok');
    };
    ACT['v14-share-open'] = function (e, d) { if (d && d.url) window.open(d.url, '_blank'); };
    ACT['v14-share-tab'] = function () { FSX.tab = 'shares'; shsLoad(); try { rerender('filestation'); } catch (er) {} };
    ACT['v14-share-close'] = function () {
      var p = document.getElementById('v14-share-panel'); if (p) p.remove();
    };
  }
//__NasDeck_V14_FS_END__
  function installFsActions() {
    ACT['fsx-nav'] = fnav; /* 作为「本层已安装」的哨兵 */
    ACT['fsx-back'] = function () { FSX.tab = 'files'; var p = (FS_STATE.hist || []).pop() || '/'; return fload(p); };
    ACT['fsx-up'] = function () {
      var p = fpath(); if (p === '/') return;
      var s = String(p).replace(/\/$/, ''); s = s.slice(0, s.lastIndexOf('/')) || '/';
      FSX.tab = 'files'; return fnav(s);
    };
    ACT['fsx-refresh'] = function () { freload(); toast('已刷新', fpath(), 'ok'); };
    /* v14 需求 6：点目录树任意节点都回到文件浏览，包括根节点（data-path 为空）；
       否则从「分享链接」页点树节点仍停在分享页，看起来像目录树点不动。 */
    ACT['fsx-goto'] = function (e, d) {
      FSX.tab = 'files';
      if (d && d.path) fnav(d.path); else rerender('filestation');
    };
    ACT['fsx-crumb'] = function (e, d) {
      var segs = fpath().split('/').filter(Boolean), k = Math.max(0, Math.min(+((d || {}).depth || 0), segs.length));
      FSX.tab = 'files'; fnav('/' + segs.slice(0, k).join('/'));
    };
    ACT['fsx-sel'] = function (e, d, ev) {
      var shown = fshown(), i = +((d || {}).i), f = shown[i];
      if (!f) return;
      if (ev && (ev.ctrlKey || ev.metaKey)) FSX.sel[f.n] = !FSX.sel[f.n];
      else if (ev && ev.shiftKey && FSX.anchor >= 0) {
        var a = Math.min(FSX.anchor, i), b = Math.max(FSX.anchor, i);
        FSX.sel = {};
        for (var k = a; k <= b; k++) if (shown[k]) FSX.sel[shown[k].n] = true;
      } else { FSX.sel = {}; FSX.sel[f.n] = true; }
      FSX.anchor = i;
      try { FS_STATE.sel = (FS[fpath()] || []).indexOf(f); } catch (er) {}
      /* v14 需求 6：不重绘，保留 DOM 节点，否则双击的第二次点击落在新节点上，dblclick 不触发 */
      v14FsPaintSel();
    };
    ACT['fsx-selall'] = function () {
      var shown = fshown(), all = fnames().length === shown.length && shown.length > 0;
      FSX.sel = {};
      if (!all) shown.forEach(function (f) { FSX.sel[f.n] = true; });
      rerender('filestation');
    };
    ACT['fsx-open'] = function (e, d) {
      var shown = fshown(), f = shown[+((d || {}).i)]; if (!f) return;
      if (f.t === 'dir' || f.drive) { fnav(fchild(fpath(), f.n)); return; }
      var url = furl('open', f.n);
      /* v14 需求 1：图片 / 音乐 / 影片一律进对应 App 的沉浸式播放页，不弹小窗 */
      if (f.t === 'img' || f.t === 'vid' || f.t === 'aud') { v14OpenMedia(f); return; }
      /* v15 需求 6：其它文件走内置预览 / 编辑器（文本按编码解码、
         Office 内置在线文档查看器、PDF / 媒体直接播放）。 */
      if (window.NasDeck_V15 && typeof NasDeck_V15.openPreview === 'function') {
        if (NasDeck_V15.openPreview({ n: f.n, t: f.t, path: fpath(), sz: f.sz, m: f.m })) return;
      }
      window.open(url, '_blank');
    };
    ACT['fsx-view'] = function (e, d) { FSX.view = (d && d.v) === 'grid' ? 'grid' : 'list'; rerender('filestation'); };
    ACT['fsx-page'] = function (e, d) {
      var pages = Math.max(1, Math.ceil((FSX.total || 0) / FSX.pageSize));
      if (d && d.p) FSX.page = Math.max(1, Math.min(Number(d.p) || 1, pages));
      else FSX.page = Math.max(1, Math.min(FSX.page + (Number((d || {}).d) || 0), pages));
      fload(fpath(), true);
    };
    ACT['fsx-pagesize'] = function (e, d) {
      var n = Number((d || {}).n) || 100;
      FSX.pageSize = Math.max(10, Math.min(n, 1000)); FSX.page = 1; fload(fpath(), true);
    };
    ACT['fsx-sort'] = function (e, d) {
      var s = (d && d.s) || '';
      if (FSX.sort === s) FSX.sortDir = -FSX.sortDir; else { FSX.sort = s; FSX.sortDir = 1; }
      fload(fpath());
    };
    ACT['fsx-hidden'] = function () { FSX.showHidden = !FSX.showHidden; fload(fpath()); };
    ACT['fsx-newfolder'] = function () {
      askModal(W('filestation'), '新建文件夹', '将在真实路径 ' + (FSX.real || fpath()) + ' 下建立', '新建文件夹', async function (v) {
        if (!v) return;
        var t = opBegin('mkdir', v, '—', fpath(), 0);
        try { var r = await NasDeck.post('/api/files/mkdir', { path: fpath(), name: v }); fApply(r); opDone(t); toast('文件夹已建立', fabs(v), 'ok'); }
        catch (er) { opFail(t, er && er.message); fail(er); }
      });
    };
    ACT['fsx-newfile'] = function () {
      askModal(W('filestation'), '新建文本文件', '将在真实路径 ' + (FSX.real || fpath()) + ' 下建立', '未命名.txt', async function (v) {
        if (!v) return;
        var t = opBegin('newfile', v, '—', fpath(), 0);
        try { var r = await NasDeck.post('/api/files/newfile', { path: fpath(), name: v, content: '' }); fApply(r); opDone(t); toast('文件已建立', fabs(v), 'ok'); }
        catch (er) { opFail(t, er && er.message); fail(er); }
      });
    };
    ACT['fsx-upload'] = function () {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = true; inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = async function () {
        var files = Array.from(inp.files || []);
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          try {
            var r = await NasDeck.put('/api/files/upload?path=' + encodeURIComponent(fpath()) + '&name=' + encodeURIComponent(f.name), f);
            fApply(r); toast('上传完成', f.name + ' · ' + fmtSize(f.size), 'ok');
          } catch (er) { toast('上传失败', f.name + '：' + er.message, 'err'); }
        }
        inp.remove();
      };
      inp.click();
    };
    ACT['fsx-rename'] = function () {
      var n = fneed(); if (!n) return;
      if (n.length > 1) { toast('重命名只支持单个项目', '', 'warn'); return; }
      askModal(W('filestation'), '重命名', '将重命名磁盘上的真实文件：' + fabs(n[0]), n[0], async function (v) {
        if (!v || v === n[0]) return;
        var t = opBegin('rename', n[0] + ' → ' + v, fpath(), fpath(), 0);
        try { var r = await NasDeck.post('/api/files/rename', { path: fpath(), from: n[0], to: v }); fApply(r); opDone(t); toast('已重命名', v, 'ok'); }
        catch (er) { opFail(t, er && er.message); fail(er); }
      });
    };
    ACT['fsx-copy'] = function () {
      var n = fneed(); if (!n) return;
      FSX.clipboard = { path: fpath(), items: n, mode: 'copy' };
      rerender('filestation'); toast('已复制 ' + n.length + ' 项', '进入目标目录后点「粘贴」', 'ok');
    };
    ACT['fsx-cut'] = function () {
      var n = fneed(); if (!n) return;
      FSX.clipboard = { path: fpath(), items: n, mode: 'cut' };
      rerender('filestation'); toast('已剪切 ' + n.length + ' 项', '进入目标目录后点「粘贴」', 'ok');
    };
    ACT['fsx-paste'] = async function () {
      var c = FSX.clipboard;
      if (!c) { toast('剪贴板为空', '请先「复制」或「剪切」', 'warn'); return; }
      if (c.path === fpath() && c.mode === 'cut') { toast('剪切的源目录与目标目录相同', '请进入另一个目录再粘贴', 'warn'); return; }
      var mode = c.mode === 'cut' ? 'move' : 'copy';
      var t = opBegin(mode, c.items.length + ' 项', c.path, fpath(), 0);
      try {
        var r = await NasDeck.post('/api/files/' + mode,
          { path: c.path, dest: fpath(), items: c.items });
        var bad = (r.results || []).filter(function (x) { return !x.ok; });
        if (c.mode === 'cut' && !bad.length) FSX.clipboard = null;
        fApply(r);
        if (bad.length) opFail(t, bad.map(function (x) { return x.name + ': ' + x.error; }).join('; ').slice(0, 160));
        else opDone(t);
        toast(bad.length ? '部分项目未完成' : (c.mode === 'cut' ? '已移动' : '已复制'),
          bad.length ? bad.map(function (x) { return x.name + ': ' + x.error; }).join('; ').slice(0, 200) : (r.results || []).length + ' 项',
          bad.length ? 'warn' : 'ok');
      } catch (er) { opFail(t, er && er.message); fail(er); }
    };
    ACT['fsx-download'] = function () {
      var n = fneed(); if (!n) return;
      var all = FS[fpath()] || [], cnt = 0;
      n.forEach(function (name) {
        var f = all.filter(function (x) { return x.n === name; })[0];
        if (!f || f.t === 'dir' || f.drive) return;
        window.open(furl('download', name), '_blank'); cnt++;
      });
      if (!cnt) toast('没有可下载的文件', '文件夹请先「压缩选中」再下载', 'warn');
      else toast('已开始下载', cnt + ' 个文件（真实磁盘内容）', 'ok');
    };
    ACT['fsx-delete'] = function () {
      var n = fneed(); if (!n) return;
      askModal(W('filestation'), '送入 Windows 回收站',
        '这 ' + n.length + ' 项将从真实路径 ' + (FSX.real || fpath()) + ' 移入本机回收站，可在「资源回收站」还原。',
        null, async function () {
          var t = opBegin('del', n.length + ' 项', fpath(), '回收站', 0);
          try {
            var r = await NasDeck.post('/api/files/batch-delete', { path: fpath(), items: n });
            if (r.trash) NasDeck.fillBIN(r.trash);
            var bad = (r.results || []).filter(function (x) { return !x.ok; });
            fApply(r);
            if (bad.length) opFail(t, bad.map(function (x) { return x.name + ': ' + x.error; }).join('; ').slice(0, 160));
            else opDone(t);
            toast(bad.length ? '部分项目未删除' : '已送入回收站',
              bad.length ? bad.map(function (x) { return x.name + ': ' + x.error; }).join('; ').slice(0, 200) : n.length + ' 项',
              bad.length ? 'warn' : 'ok');
          } catch (er) { opFail(t, er && er.message); fail(er); }
        });
    };
    ACT['fsx-prop'] = async function () {
      var n = fneed(); if (!n) return;
      var name = n[0], full = fchild(fpath(), name), f = (FS[fpath()] || []).filter(function (x) { return x.n === name; })[0] || {};
      var html = '<div class="kv"><span class="k">名称</span><span class="v">' + E(name) + '</span></div>' +
        '<div class="kv"><span class="k">真实路径</span><span class="v mono">' + E(fabs(name)) + '</span></div>' +
        '<div class="kv"><span class="k">虚拟路径</span><span class="v mono">' + E(full) + '</span></div>' +
        '<div class="kv"><span class="k">类型</span><span class="v">' + (f.t === 'dir' || f.drive ? '文件夹 / 磁盘' : '文件') + '</span></div>' +
        '<div class="kv"><span class="k">大小</span><span class="v">' + (f.t === 'dir' ? '文件夹' : fmtSize(f.sz || 0)) + '</span></div>' +
        '<div class="kv"><span class="k">修改日期</span><span class="v">' + E(f.m || 'N/A') + '</span></div>' +
        '<div class="kv"><span class="k">来源</span><span class="v">Windows 本机文件系统 · WinNAS 引擎</span></div>';
      try {
        var r = await NasDeck.get('/api/nas/stat?path=' + encodeURIComponent(full));
        html += '<div class="kv"><span class="k">目录统计</span><span class="v">' +
          (r.files || 0) + ' 个文件 / ' + (r.dirs || 0) + ' 个目录 · 合计 ' + fmtSize(r.size || 0) +
          (r.truncated ? '（已达遍历上限，N/A）' : '') + '</span></div>';
      } catch (e) {}
      infoModal(W('filestation'), '属性 · ' + name, html);
    };
    ACT['fsx-reindex'] = function () {
      toast('正在建立名称索引', 'WinNAS search.js 后台分块遍历本机磁盘', 'info');
      NasDeck.post('/api/nas/search/reindex', {}).then(function (r) {
        infoModal(W('filestation'), '名称索引',
          '<p class="desc">已在后台开始构建（不阻塞界面）。完成后再点「全盘名称搜索」即可获得真实结果。</p>' +
          '<p class="desc">状态：' + E((r.status || {}).building ? '构建中' : '已结束') +
          ' · 条目 ' + E((r.status || {}).count || 0) + '</p>');
      }).catch(fail);
    };
    ACT['fsx-realpath'] = function () {
      var v = FSX.real || fpath();
      try { navigator.clipboard.writeText(v); } catch (e) {}
      toast('真实 Windows 路径已复制', v, 'ok');
    };
    ACT['fsx-searchall'] = function () {
      var el = document.getElementById('fsx-q'), q = el ? el.value.trim() : '';
      if (!q) { toast('请输入关键词', '在上方搜索框输入后再点全盘搜索', 'warn'); return; }
      toast('正在搜索', '使用 WinNAS 名称索引（真实磁盘）', 'info');
      NasDeck.get('/api/nas/search?q=' + encodeURIComponent(q) + '&limit=100').then(function (r) {
        if (r.indexing || r.needsIndex) {
          infoModal(W('filestation'), '全盘搜索 · 名称索引',
            '<p class="desc">' + E(r.message) + '</p>' +
            '<p class="desc">索引状态：' + E((r.status || {}).building ? '构建中' : '未构建') +
            ' · 已有条目 ' + E((r.status || {}).count || 0) + '</p>' +
            FB('fsx-reindex', '建立 / 重建名称索引', '', 'primary', 'refresh'));
          return;
        }
        var rows = (r.results || []).map(function (x) {
          return '<tr><td>' + E(x.name) + '</td><td class="mono dim">' + E(x.path || x.rel || 'N/A') + '</td><td>' +
            (x.size !== undefined ? fmtSize(x.size) : 'N/A') + '</td></tr>';
        }).join('') || '<tr><td colspan="3" class="dim">没有匹配项 / N/A</td></tr>';
        infoModal(W('filestation'), '全盘名称搜索 · ' + q,
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>名称</th><th>路径</th><th>大小</th></tr></thead><tbody>' + rows +
          '</tbody></table></div><p class="desc">共 ' + E(r.total || 0) + ' 条，全部来自本机真实磁盘（WinNAS search.js）。</p>');
      }).catch(fail);
    };
    /* 右键菜单与旧 ACT 名全部指向真实实现（其它层 / 旧代码也会命中这里） */
    ACT['fs-open'] = ACT['fsx-open'];
    ACT['fs-rename'] = ACT['fsx-rename'];
    ACT['fs-delete'] = ACT['fsx-delete'];
    ACT['fs-prop'] = ACT['fsx-prop'];
    ACT['fs-newfolder'] = ACT['fsx-newfolder'];
    ACT['fs-newfile'] = ACT['fsx-newfile'];
    ACT['fs-upload'] = ACT['fsx-upload'];
    ACT['fs-copypath'] = function () {
      var n = fnames();
      var v = n.length ? fabs(n[0]) : (FSX.real || fpath());
      try { navigator.clipboard.writeText(v); } catch (e) {}
      toast('真实路径已复制', v);
    };
    if (!window.__NasDeck_FSX_INPUT__) {
      window.__NasDeck_FSX_INPUT__ = true;
      document.addEventListener('input', function (e) {
        if (!e.target || e.target.id !== 'fsx-q') return;
        FSX.q = e.target.value; FS_STATE.q = FSX.q;
        clearTimeout(FSX.qt);
        FSX.qt = setTimeout(function () {
          rerender('filestation');
          var el = document.getElementById('fsx-q');
          if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (x) {} }
        }, 220);
      });
    }
  }

  /* ---------------- 右键菜单：直接选中目标再操作 ----------------
     底座的 contextmenu 只弹菜单、不更新选中集，所以「右键一个没选中的文件」
     菜单动作仍作用于之前选中的项，甚至提示「请先选择项目」。
     这里在 capture 阶段接管文件总管的右键：先把点击目标设为操作对象
     （未选中→单选它；已在多选内→保留整组多选），再弹出作用于该对象的
     真实菜单；在空白处右键则给「新建 / 粘贴 / 刷新 / 搜索」。 */
  function fsWin() {
    try { return (typeof W === 'function' && W('filestation')) || null; } catch (e) { return null; }
  }
  function fsRightSelect(i, ev) {
    var shown = fshown(), f = shown[i];
    if (!f) return false;
    if (!FSX.sel[f.n]) {
      if (ev && (ev.ctrlKey || ev.metaKey)) FSX.sel[f.n] = true;
      else { FSX.sel = {}; FSX.sel[f.n] = true; }
    }
    /* 在已选中项上右键：保留整组多选，便于批量操作 */
    FSX.anchor = i;
    try { FS_STATE.sel = (FS[fpath()] || []).indexOf(f); } catch (er) {}
    return true;
  }
  function fsRepaintSelection() {
    var win = fsWin(), st = 0;
    try { var v = win && win.el && win.el.querySelector('.fs-view'); if (v) st = v.scrollTop; } catch (e) {}
    try { rerender('filestation'); } catch (e) {}
    /* 重绘会重建 .win-body，恢复滚动位置，避免右键后列表跳回顶部 */
    try { var v2 = win && win.el && win.el.querySelector('.fs-view'); if (v2) v2.scrollTop = st; } catch (e) {}
  }
  function installFsContextMenu() {
    if (window.__NasDeck_FSX_CTX__) return;
    window.__NasDeck_FSX_CTX__ = true;
    document.addEventListener('contextmenu', function (e) {
      var win = fsWin();
      if (!win || !win.el || !win.el.contains(e.target)) return; /* 只管文件总管窗口 */
      var c = e.target.closest ? e.target.closest('[data-act="fsx-sel"]') : null;
      var blank = !c && e.target.closest ? e.target.closest('.fs-view,.app-main') : null;
      if (!c && !blank) return;
      e.preventDefault();
      /* 阻止底座那套「只弹菜单不选中」的旧处理器；其它窗口的右键不受影响 */
      e.stopImmediatePropagation();
      var items;
      if (c) {
        var i = +(c.dataset.i);
        if (!fsRightSelect(i, e)) return;
        fsRepaintSelection();
        items = [
          { label: '打开', icon: 'external', act: 'fsx-open', data: 'data-i="' + i + '"', hint: '双击' },
          { label: '下载', icon: 'download', act: 'fsx-download' }, '-',
          { label: '复制', icon: 'copy', act: 'fsx-copy' },
          { label: '剪切', icon: 'scissors', act: 'fsx-cut' },
          { label: '粘贴', icon: 'clipboard', act: 'fsx-paste' }, '-',
          { label: '重命名', icon: 'edit', act: 'fsx-rename' },
          { label: '压缩选中', icon: 'box', act: 'wns-compress' },
          { label: '生成分享链接', icon: 'link', act: 'wns-share' },
          { label: '复制真实路径', icon: 'link', act: 'fsx-realpath' },
          { label: '属性', icon: 'info', act: 'fsx-prop' }, '-',
          { label: '移至回收站', icon: 'trash', act: 'fsx-delete', danger: true }
        ];
      } else {
        items = [
          { label: '新建文件夹', icon: 'folder', act: 'fsx-newfolder' },
          { label: '新建文本文件', icon: 'file', act: 'fsx-newfile' },
          { label: '上传文件', icon: 'upload', act: 'fsx-upload' }, '-',
          { label: '粘贴', icon: 'clipboard', act: 'fsx-paste' },
          { label: '全选 / 取消全选', icon: 'grid', act: 'fsx-selall' },
          { label: '刷新', icon: 'refresh', act: 'fsx-refresh' }, '-',
          { label: '复制当前真实路径', icon: 'link', act: 'fsx-realpath' },
          { label: '全盘名称搜索', icon: 'search', act: 'fsx-searchall' }
        ];
      }
      try { ctxMenu(e.clientX, e.clientY, items); } catch (er) {}
    }, true); /* capture：先于底座 bubble 监听器执行 */
  }

  function installFs() {
    installFsContextMenu();
    try { installV13(); } catch (e) {}
    RENDER.filestation = renderFileManager;
    /* 底座导航函数也换成走真实 API 的版本（面包屑 / 后退 / 上层 / 旧代码都走这里） */
    try { fsGoto = function (p) { FSX.tab = 'files'; return fnav(p || '/'); }; } catch (e) {}
    try { fsBack = function () { var p = (FS_STATE.hist || []).pop() || '/'; return fload(p); }; } catch (e) {}
    try {
      fsUp = function () {
        var p = fpath(); if (p === '/') return;
        var s = String(p).replace(/\/$/, ''); s = s.slice(0, s.lastIndexOf('/')) || '/';
        FSX.tab = 'files'; return fnav(s);
      };
    } catch (e) {}
    installFsActions();
  }
  /* 多层 install 会互相覆盖 RENDER / ACT；2 秒守卫保证最终始终是完整文件管理器 */
  setInterval(function () {
    try { if (RENDER.filestation !== renderFileManager || ACT['fsx-nav'] !== fnav) installFs(); }
    catch (e) {}
  }, 2000);

  /* ---------------- 包装 NasDeck.install / NasDeck.hydrate ---------------- */
  function installWinnasLayer() {
    if (!window.NasDeck || NasDeck.__winnasLayer) return;
    v13Style(); patchStaticHost();
    NasDeck.__winnasLayer = true;
    mountBadge();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBadge);
    setTimeout(mountBadge, 800);
    setInterval(mountBadge, 5000);
    var _install = NasDeck.install;
    NasDeck.install = function () {
      var r = _install.apply(this, arguments);
      try { hookRenders(); installActions(); installFs(); mountBadge(); }
      catch (e) { console.warn('[WinNAS] layer hook:', e.message); }
      return r;
    };
    var _hydrate = NasDeck.hydrate;
    NasDeck.hydrate = function (b) {
      var r = _hydrate.apply(this, arguments);
      if (b && b.winnas) NasDeck.winnas = b.winnas;
      try { installFs(); } catch (e) {}
      mountBadge();
      /* 登录后用带分页/排序的真实目录数据重填一次，避免停留在 bootstrap
         预置的静态 '/' 列表（那是登录前的快照，不含分页与真实路径）。 */
      if (NasDeck.token) setTimeout(function () { try { fload(FS_STATE.path || '/'); } catch (e) {} }, 350);
      return r;
    };
    /* 引擎状态随 /api/bootstrap 水合到位（NasDeck.winnas），
       不在页面加载阶段额外发请求 —— 那时还没有 token，会触发 401。 */
  }
  installWinnasLayer();
})();
//__NasDeck_WINNAS_END__
