//__NasDeck_REAL_START__
/* ==================================================================
 * nasdeck-real.src.js —— 真实机器操作层
 *
 * 前几层解决的是「不显示假数据」；这一层解决的是「每个功能真的能操作本机」：
 *   · 资源回收站 → Windows $Recycle.Bin 真实项目 / 还原 / 永久删除 / 清空
 *   · 文件总管   → 真实盘符根、真实目录树、真实容量、真实路径面包屑
 *   · 网络       → 真实网卡启用/禁用/重启、DNS 设置、DHCP 续租、清缓存
 *   · Container  → Docker Engine 多端点发现 + 一键启动 + 真实端点回显
 *
 * 由 build.py 注入，包装 NasDeck.install / NasDeck.hydrate，在 NasDeck_WIN_INSTALL
 * 执行完毕后覆盖对应 RENDER 与 ACT。全部读不到的值显示 N/A。
 * ================================================================== */
(function () {
  'use strict';

  var NA = 'N/A';
  var RNA = function (v) {
    return (v === null || v === undefined || v === '' || v === '—' || v === '-') ? NA : v;
  };
  var RE = function (x) { return esc(String(x === null || x === undefined ? '' : x)); };
  var RBT = function (a, label, data, cls, icon) {
    return '<button class="btn sm ' + (cls || '') + '" data-act="' + a + '" ' + (data || '') + '>' +
      (icon ? glyph(icon, 12, 'var(--accent)') + ' ' : '') + RE(label) + '</button>';
  };
  var RTBL = function (heads, rows) {
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      heads.map(function (h) { return '<th>' + RE(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + (rows.join('') || '<tr><td colspan="' + heads.length +
      '" class="dim">N/A · 无数据</td></tr>') + '</tbody></table></div>';
  };
  var RROW = function (cells) {
    return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
  };
  var RCARD = function (title, inner, right) {
    return '<div class="card"><div class="section-title">' + glyph('layers', 14) + RE(title) +
      '<span class="sp"></span>' + (right || '') + '</div>' + inner + '</div>';
  };
  var RSTAT = function (l, v, foot) {
    return '<div class="card stat"><span class="lbl">' + RE(l) + '</span><span class="val">' +
      v + '</span><span class="foot">' + RE(foot) + '</span></div>';
  };
  function winPath(vp) {
    if (!vp || vp === '/') return '此电脑';
    var m = /^\/([A-Za-z]):\/(.*)$/.exec(vp);
    if (m) return m[1] + ':\\' + (m[2] ? m[2].replace(/\//g, '\\') : '');
    var m2 = /^\/([A-Za-z]):$/.exec(vp);
    if (m2) return m2[1] + ':\\';
    return String(vp).replace(/\//g, '\\');
  }
  function realDrives() { return (NasDeck.realDrives || []); }
  function realBinInfo() { return NasDeck.realBin || {}; }

  /* ------------------------------------------------------------------
   * 1) 资源回收站 —— Windows $Recycle.Bin 真实项目
   * ---------------------------------------------------------------- */
  function renderTrash() {
    var list = BIN || [];
    var info = realBinInfo();
    var total = (info.total === undefined ? list.length : info.total);
    var used = RNA(info.usedText);
    var loading = !!info.loading;
    var prog = NasDeck.recycleStatus || info.progress || {};
    var src = RNA(info.source);

    var bar = '<div class="toolbar"><div class="mini-title" style="margin:0">' +
      glyph('trash', 15, 'var(--accent)') + '资源回收站 · Windows 本机</div>' +
      '<span class="badge">' + RE(total) + ' 个项目</span>' +
      '<span class="badge info"><i></i> 占用 ' + RE(used) + '</span>' +
      '<div class="sp"></div>' +
      RBT('bin-restore', '还原选中', '', '', 'undo') +
      RBT('bin-del', '永久删除', '', 'danger', 'trash') +
      RBT('bin-refresh', '重新扫描', '', '', 'refresh') +
      RBT('bin-clear', '清空回收站', '', 'danger', 'alert') + '</div>';

    var notice = loading
      ? '<div class="card" style="border-color:var(--accent)"><div class="section-title">' +
        glyph('refresh', 14) + '正在扫描本机回收站</div><p class="desc">Windows 回收站项目较多，后台正在读取 ' +
        RE(prog.total || NA) + ' 条元数据（已完成 ' + RE(prog.done || 0) +
        '）。扫描完成后会自动刷新，期间不会显示任何模拟数据。</p></div>'
      : '';

    var rows = list.map(function (b, i) {
      return '<tr class="' + (BIN_SEL === i ? 'sel' : '') + '" data-act="bin-sel" data-i="' + i + '">' +
        '<td><div class="nm">' + glyph(b.isDir ? 'folder' : 'file', 15, 'var(--muted)') + RE(b.n) + '</div></td>' +
        '<td class="mono dim">' + RE(RNA(b.from)) + '</td>' +
        '<td>' + RE(RNA(b.sizeText || (b.sz !== undefined ? fmtSize(b.sz) : NA))) + '</td>' +
        '<td class="muted">' + RE(RNA(b.time)) + '</td>' +
        '<td>' + RE(RNA(b.drive)) + '</td>' +
        '<td>' + RE(b.isDir ? '文件夹' : RNA(b.t)) + '</td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="6"><div class="empty" style="height:180px">' +
      glyph('trash', 40) + (loading ? '正在读取本机回收站…' : '回收站是空的') + '</div></td></tr>';

    var table = '<div class="card" style="padding:0;overflow:hidden"><div class="tbl-wrap" style="border:0">' +
      RTBL(['名称', '原始位置（真实）', '大小', '删除时间', '盘符', '类型'], [rows]) + '</div></div>';

    var trunc = info.truncated || (list.length < total)
      ? '<p class="desc" style="margin-top:8px">为保证界面流畅，仅显示最近 ' + list.length +
        ' / ' + total + ' 项；全部项目均来自本机回收站，可还原或清空。</p>' : '';

    var roots = (info.roots || []).map(function (r) { return '<span class="mono">' + RE(r) + '</span>'; }).join('<br>') || NA;
    var detail = RCARD('回收站真实来源',
      '<div class="kv"><span class="k">数据来源</span><span class="v">' + RE(src) + '</span></div>' +
      '<div class="kv"><span class="k">项目总数</span><span class="v">' + RE(total) + '</span></div>' +
      '<div class="kv"><span class="k">占用空间</span><span class="v">' + RE(used) + '</span></div>' +
      '<div class="kv"><span class="k">扫描位置</span><span class="v mono" style="font-size:11px">' + roots + '</span></div>' +
      '<div class="kv"><span class="k">删除行为</span><span class="v">文件总管的删除会真正送入 Windows 回收站</span></div>' + trunc);

    return '<div class="app">' + bar + '<div class="app-scroll">' + notice + table + detail + '</div></div>';
  }

  /* ------------------------------------------------------------------
   * 2) 文件总管 —— 真实盘符 / 真实目录树 / 真实容量
   * ---------------------------------------------------------------- */
  function renderFileStation() {
    var p = FS_STATE.path || '/';
    var all = FS[p] || [];
    var q = FS_STATE.q || '';
    var list = all.filter(function (f) { return !q || String(f.n).toLowerCase().indexOf(q.toLowerCase()) >= 0; });
    var segs = (p === '/' ? [] : p.split('/').filter(Boolean));
    var crumbs = segs.map(function (c, i) {
      return '<button data-act="fs-crumb" data-depth="' + (i + 1) + '">' + RE(c) + '</button>';
    }).join('<span style="color:var(--dim)">/</span>');

    var treeHtml = '<div class="side-t">本机磁盘与目录</div>' +
      (FS_TREE || []).map(function (t) {
        return '<button class="fs-node ' + (p === t.p ? 'on' : '') + '" data-act="fs-goto" data-path="' +
          RE(t.p) + '" style="padding-left:' + (8 + (t.d || 0) * 13) + 'px"><span class="ind">' +
          (t.d ? '' : '▾') + '</span>' + glyph(t.d ? 'folder' : 'home', 13) + RE(t.n) + '</button>';
      }).join('');

    var ds = realDrives();
    var volCard = '<div class="side-t" style="margin-top:14px">本机存储空间</div><div class="card" style="padding:10px 11px">' +
      (ds.length ? ds.map(function (d) {
        var pct = (d.pct === null || d.pct === undefined) ? NA : (Number(d.pct).toFixed(1) + '%');
        return '<div style="margin-bottom:10px"><div style="font-size:11px;font-weight:600;margin-bottom:5px">' +
          RE(d.drive) + ' <span class="badge">' + RE(pct) + '</span></div>' +
          '<div class="prog warn"><i style="width:' + (isNaN(Number(d.pct)) ? 0 : Number(d.pct)) + '%"></i></div>' +
          '<div style="font-size:10px;color:var(--muted);margin-top:5px">' +
          RE(d.total ? fmtSize(d.total) : NA) + ' · 可用 ' + RE(d.free ? fmtSize(d.free) : NA) + '</div></div>';
      }).join('') : '<div class="dim" style="font-size:11px">N/A</div>') + '</div>';

    var grid = '<div class="fs-grid">' + list.map(function (f, i) {
      return '<div class="fs-cell ' + (FS_STATE.sel === i ? 'sel' : '') + '" data-act="fs-sel" data-i="' + i +
        '" data-open="fs-open">' + fsIcon(f.t) + '<b>' + RE(f.n) + '</b><small>' +
        (f.drive ? RE(f.desc || f.n) : (f.t === 'dir' ? '文件夹' : fmtSize(f.sz || 0))) + '</small></div>';
    }).join('') + '</div>';
    var table = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:42%">名称</th><th>大小 / 容量</th><th>类型</th><th>修改日期</th><th>说明</th></tr></thead><tbody>' +
      list.map(function (f, i) {
        return '<tr class="' + (FS_STATE.sel === i ? 'sel' : '') + '" data-act="fs-sel" data-i="' + i + '" data-open="fs-open">' +
          '<td><div class="nm">' + glyph(f.t === 'dir' ? 'folder' : 'file', 15, 'var(--accent)') + RE(f.n) + '</div></td>' +
          '<td>' + (f.drive ? RE(f.desc || NA) : (f.t === 'dir' ? '文件夹' : fmtSize(f.sz || 0))) + '</td>' +
          '<td>' + (f.drive ? '本地磁盘' : f.share ? '项目共享目录' : (f.t === 'dir' ? '文件夹' : ({ doc: '文档', img: '照片', vid: '影片', aud: '音乐', zip: '压缩档' }[f.t] || '文件'))) + '</td>' +
          '<td class="muted">' + RE(f.m || NA) + '</td>' +
          '<td class="dim">' + RE(f.desc || (f.share ? '项目内共享目录' : 'N/A')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    var tb = RBT('fs-back', '', '', '', 'back') + RBT('fs-up', '', '', '', 'up') +
      '<div class="tb-div" style="height:20px;margin:0 3px"></div>' +
      RBT('fs-newfolder', '新建文件夹', '', '', 'folder') + RBT('fs-newfile', '新建文件', '', '', 'file') +
      RBT('fs-upload', '上传', '', '', 'upload') + RBT('fs-rename', '重命名', '', '', 'edit') +
      RBT('fs-delete', '删除', '', 'danger', 'trash') + RBT('fs-prop', '属性', '', '', 'info') +
      '<div class="sp"></div><div class="seg"><button class="' + (FS_STATE.view === 'grid' ? 'on' : '') +
      '" data-act="fs-view" data-v="grid">' + glyph('grid', 13) + '</button><button class="' +
      (FS_STATE.view === 'list' ? 'on' : '') + '" data-act="fs-view" data-v="list">' + glyph('list', 13) + '</button></div>';

    var status = '<div class="fs-status"><span>' + list.length + ' 个项目</span><span>' +
      (FS_STATE.sel >= 0 ? '已选择 1 项' : '未选择项目') + '</span><span>真实路径：' + RE(winPath(p)) +
      '</span><div class="sp"></div><span>Windows 文件系统 · 删除送入系统回收站</span></div>';

    return '<div class="app"><div class="toolbar">' + tb + '</div><div class="app-row">' +
      '<div class="app-side">' + treeHtml + volCard + '</div><div class="app-main">' +
      '<div class="fs-path">' + glyph('home', 14, 'var(--muted)') + '<div class="crumb"><button data-act="fs-crumb" data-depth="0">此电脑</button>' +
      (crumbs ? '<span style="color:var(--dim)">/</span>' + crumbs : '') + '</div><div style="flex:1"></div>' +
      '<div class="inp" style="display:flex;align-items:center;gap:7px;width:170px;padding:0 9px;height:28px">' +
      glyph('search', 13, 'var(--muted)') + '<input id="fs-q" style="flex:1;background:none;border:0;font-size:11px;min-width:0" placeholder="搜索此文件夹" value="' + RE(FS_STATE.q) + '"></div></div>' +
      '<div class="fs-view">' + (list.length ? (FS_STATE.view === 'grid' ? grid : table) :
        '<div class="empty">' + glyph('folderopen', 40) + '此文件夹是空的</div>') + '</div>' + status +
      '</div></div></div>';
  }

  /* ------------------------------------------------------------------
   * 3) 网络页 / Container 页：插入真实操作卡片
   * ---------------------------------------------------------------- */
  function injectAfterScroll(html, block) {
    var m = /<div class="app-scroll">/.exec(html);
    if (!m) return html + block;
    return html.slice(0, m.index + m[0].length) + block + html.slice(m.index + m[0].length);
  }
  function adapterBlock() {
    var ads = ((NasDeck.win || {}).adapters) || [];
    var rows = ads.map(function (a) {
      var n = RE(a.n || NA);
      var d = 'data-n="' + RE(a.n || '') + '"';
      return RROW([
        '<b>' + n + '</b>', RE(RNA(a.st)), RE(RNA(a.speed)), RE(RNA(a.mac)),
        RBT('win-adapter', '停用', d + ' data-a="disable"', '', 'pause') + ' ' +
        RBT('win-adapter', '启用', d + ' data-a="enable"', '', 'play') + ' ' +
        RBT('win-adapter', '重启', d + ' data-a="restart"', '', 'refresh') + ' ' +
        RBT('win-adapter', '详情', d + ' data-a="info"', '', 'info') + ' ' +
        RBT('win-adapter-dns', '设置 DNS', d, '', 'settings')
      ]);
    });
    return RCARD('真实网卡操作（作用于本机 Windows）',
      '<p class="desc">下列操作直接调用本机 PowerShell 的 Enable/Disable-NetAdapter、Set-DnsClientServerAddress 等，' +
      '需要管理员权限；非提权运行时会返回明确的权限错误，不会伪造成功。</p>' +
      RTBL(['网卡', '状态', '链路速度', 'MAC', '操作'], rows) +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
      RBT('win-adapter', '释放 / 续租 DHCP', 'data-a="renew" data-n="-"', '', 'refresh') +
      RBT('win-adapter', '清除 DNS 缓存', 'data-a="flushdns" data-n="-"', '', 'trash') +
      RBT('win-adapter-refresh', '刷新网卡状态', '', '', 'refresh') + '</div>');
  }
  /* ---------------- Docker / WSL 真实控制台 ----------------
     用户要的是「能控制真实 WSL 和 Docker」：这里把引擎状态、WSL 发行版、
     容器/镜像、每一步的真实执行输出全部摆到最上面，所有按钮都直接打
     /api/wsl/* 后端接口，不做任何本地模拟。 */
  var DKR = {
    ka: null, busy: false, out: '', msg: '', timer: null, polls: 0,
    tab: 'overview'   /* 当前标签：单窗口多标签页，避免内容全部平铺 */
  };
  NasDeck.dkr = DKR;
  function dkrSet(o) {
    if (o.ka !== undefined) DKR.ka = o.ka;
    if (o.wsl !== undefined) NasDeck.wsl = Object.assign({}, NasDeck.wsl || {}, o.wsl);
    if (o.out !== undefined) DKR.out = String(o.out || '');
    if (o.msg !== undefined) DKR.msg = String(o.msg || '');
    if (o.busy !== undefined) DKR.busy = !!o.busy;
    try { if (W('container')) rerender('container'); } catch (e) {}
  }
  async function dkrFetchStatus(silent) {
    try {
      const [ka, snap] = await Promise.all([NasDeck.get('/api/wsl/keepalive'), NasDeck.get('/api/wsl/snapshot')]);
      NasDeck.fill(CONTAINERS, snap.containers || []);
      dkrSet({ ka: ka, wsl: snap, msg: silent ? DKR.msg : ka.message, busy: !!ka.busy });
      return ka;
    } catch (e) { if (!silent) toast('状态读取失败', e.message, 'err'); return null; }
  }
  /* 启动后引擎需要 20~40 秒才在线：边轮询边把真实进度显示出来 */
  function dkrPoll(limit) {
    if (DKR.timer) clearInterval(DKR.timer);
    DKR.polls = 0;
    DKR.timer = setInterval(async function () {
      DKR.polls++;
      const ka = await dkrFetchStatus(true);
      if (!ka) return;
      if (ka.online || DKR.polls >= (limit || 30)) {
        clearInterval(DKR.timer); DKR.timer = null;
        DKR.busy = false;
        DKR.msg = ka.online ? ('已连接真实 Docker Engine · ' + (ka.version || 'N/A') + ' · 保活已开启') : ('启动未完成（N/A）：' + ka.message);
        try { await dkrForceRefresh(); } catch (e) {}
        if (W('container')) rerender('container');
      }
    }, 2000);
  }
  async function dkrForceRefresh() {
    const r = await NasDeck.post('/api/wsl/refresh', {});
    NasDeck.fill(CONTAINERS, r.containers || []);
    dkrSet({ wsl: r, ka: r.keepAlive || DKR.ka });
    return r;
  }
  /* ---------------- Docker / WSL 真实控制台（单窗口 · 多标签页） ----------------
     旧版把引擎状态 / 容器 / 镜像 / WSL / 端点 / 输出 9 块内容全部平铺在
     一个窗口里，并且叠了 windows 层的 hero+统计卡与 winnas 层横幅，非常乱。
     现在：一个窗口 = 一条引擎状态条 + 一组标签 + 一个当前标签页，
     所有真实能力按功能归纳到 5 个标签，点标签才显示对应内容。
     RENDER.container 直接返回本函数结果，不再包装其它层的旧界面。 */
  /* ==================================================================
   * 建立容器 · 独立设置窗口
   * 旧版只弹一个「输入镜像名」的单行输入框，无法设置 CPU / 内存 / 端口 /
   * 环境变量 / 网络 / 重启策略 / 文件映射，也看不到镜像元数据。
   * 这里做一个独立于 .win-body 的模态窗口（不会被 6 秒状态重绘冲掉），
   * 用标签页把 7 组设置归纳起来，提交时组装完整 Docker create 配置。
   * ================================================================ */
  var DKR_STYLE = false;
  function uiEnsureStyle() {
    if (DKR_STYLE) return;
    DKR_STYLE = true;
    var css = [
      '.nasdeck-dlg-mask{position:fixed;inset:0;z-index:9000;background:rgba(3,9,17,.62);display:flex;align-items:center;justify-content:center}',
      '.nasdeck-dlg{position:fixed;z-index:9001;display:flex;flex-direction:column;min-width:660px;min-height:440px;',
      ' background:var(--appbg,#131c28);border:1px solid var(--line2,#2a3a4c);border-radius:11px;',
      ' box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden;resize:both}',
      '.nasdeck-dlg-bar{height:40px;flex:none;display:flex;align-items:center;gap:9px;padding:0 12px;cursor:move;',
      ' background:linear-gradient(180deg,var(--panel2,#223042),var(--panel,#182534));border-bottom:1px solid var(--line,#2a3a4c);user-select:none}',
      '.nasdeck-dlg-bar b{font-size:12.5px}.nasdeck-dlg-bar .dim{font-size:10.5px;color:var(--muted,#8ba0b6)}',
      '.nasdeck-dlg-bar button{margin-left:auto;background:none;border:0;color:var(--fg,#dbe7f3);cursor:pointer;font-size:18px;line-height:1}',
      '.nasdeck-dlg-tabs{display:flex;gap:2px;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid var(--line,#2a3a4c);flex:none}',
      '.nasdeck-dlg-tabs button{background:none;border:1px solid transparent;border-radius:6px;padding:5px 10px;font-size:11px;',
      ' color:var(--muted,#8ba0b6);cursor:pointer}',
      '.nasdeck-dlg-tabs button:hover{color:var(--fg,#dbe7f3)}',
      '.nasdeck-dlg-tabs button.on{color:var(--accent,#22a7e8);border-color:var(--accent,#22a7e8);background:rgba(34,167,232,.09)}',
      '.nasdeck-dlg-body{flex:1;min-height:0;overflow:auto;padding:14px 16px}',
      '.nasdeck-dlg-foot{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;',
      ' border-top:1px solid var(--line,#2a3a4c);background:var(--panel,#182534)}',
      '.qf-row{display:grid;grid-template-columns:158px 1fr;gap:9px 12px;align-items:center;margin-bottom:9px}',
      '.qf-row>label{font-size:11.5px;color:var(--muted,#8ba0b6)}',
      '.qf-inp{width:100%;box-sizing:border-box;background:var(--bg2,#0f1722);border:1px solid var(--line,#2a3a4c);',
      ' border-radius:6px;padding:6px 9px;font-size:11.5px;color:var(--fg,#dbe7f3);outline:none}',
      '.qf-inp:focus{border-color:var(--accent,#22a7e8)}',
      '.qf-hint{grid-column:2;font-size:10px;color:var(--dim,#6b8199);margin-top:-5px}',
      '.qf-tbl{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}',
      '.qf-tbl th{text-align:left;color:var(--muted,#8ba0b6);font-weight:600;padding:5px 6px;border-bottom:1px solid var(--line,#2a3a4c)}',
      '.qf-tbl td{padding:4px 6px;border-bottom:1px solid rgba(42,58,76,.5)}',
      '.qf-tbl .qf-inp{padding:5px 7px}',
      '.qf-sec{font-size:12px;font-weight:600;margin:2px 0 12px;color:var(--fg,#dbe7f3)}',
      '.qf-msg{padding:9px 11px;border-radius:7px;font-size:11px;margin-bottom:10px;background:rgba(34,167,232,.09);',
      ' border:1px solid rgba(34,167,232,.3)}',
      '.qf-msg.err{background:rgba(224,90,90,.1);border-color:rgba(224,90,90,.4)}',
      '.qf-pre{background:var(--bg2,#0f1722);border:1px solid var(--line,#2a3a4c);border-radius:7px;padding:10px;',
      ' font:10.5px/1.55 Consolas,monospace;white-space:pre-wrap;max-height:260px;overflow:auto;color:var(--fg,#dbe7f3)}',
      '.plg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}',
      '.plg-card{border:1px solid var(--line,#2a3a4c);border-radius:9px;padding:11px 12px;background:var(--panel,#182534)}',
      '.plg-card.off{opacity:.55}.plg-card h4{margin:0 0 5px;font-size:12px}.plg-card p{margin:0 0 9px;font-size:10.5px;color:var(--muted,#8ba0b6);line-height:1.5}',
      '.plg-card .plg-ops{display:flex;gap:6px;flex-wrap:wrap}',
      'body.nasdeck-dlg-drag{cursor:move!important}body.nasdeck-dlg-drag iframe{pointer-events:none}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'nasdeck-extra-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  var DKR_C_TABS = [
    ['basic', '基本设置'], ['resources', '资源限制'], ['ports', '端口映射'],
    ['env', '环境变量'], ['mounts', '文件映射'], ['network', '网络 / 重启'], ['meta', '镜像元数据']
  ];
  function cDefault() {
    return {
      tab: 'basic', image: '', name: '', cmd: '', entrypoint: '', workdir: '', user: '', hostname: '',
      tty: false, privileged: false, autoRemove: false,
      cpus: '', cpuShares: '', memoryMb: '', memorySwapMb: '',
      ports: [], env: [], mounts: [],
      network: 'bridge', dns: '', extraHosts: '',
      restart: 'unless-stopped', restartRetries: '0', labels: '',
      meta: null, metaErr: '', busy: false, result: '', resultOk: false, preview: false, start: true
    };
  }
  DKR.c = null;

  function cDlg() { return document.getElementById('nasdeck-dlg'); }
  function cCollect() {
    var root = cDlg();
    if (!root || !DKR.c) return;
    try {
      root.querySelectorAll('[data-cf]').forEach(function (el) {
        DKR.c[el.dataset.cf] = (el.type === 'checkbox') ? el.checked : el.value;
      });
      ['ports', 'env', 'mounts'].forEach(function (g) {
        root.querySelectorAll('[data-cf-row="' + g + '"]').forEach(function (el) {
          var row = DKR.c[g][+el.dataset.i];
          if (row) row[el.dataset.k] = (el.type === 'checkbox') ? el.checked : el.value;
        });
      });
    } catch (e) {}
  }
  function cPaint() {
    var root = cDlg();
    if (!root || !DKR.c) return;
    var body = root.querySelector('.nasdeck-dlg-body');
    if (body) { var st = body.scrollTop; body.innerHTML = cTabHtml(); body.scrollTop = st; }
    var tabs = root.querySelector('.nasdeck-dlg-tabs');
    if (tabs) tabs.innerHTML = cTabsHtml();
    var foot = root.querySelector('.nasdeck-dlg-foot');
    if (foot) foot.innerHTML = cFootHtml();
  }
  function cTabsHtml() {
    return DKR_C_TABS.map(function (t) {
      return '<button data-act="dkr-c-tab" data-t="' + t[0] + '" class="' + (DKR.c.tab === t[0] ? 'on' : '') + '">' + RE(t[1]) + '</button>';
    }).join('');
  }
  function cFootHtml() {
    var c = DKR.c;
    var msg = c.result ? '<div class="qf-msg ' + (c.resultOk ? '' : 'err') + '" style="flex-basis:100%;margin-bottom:2px">' +
      RE(c.result) + '</div>' : '';
    return msg +
      '<button class="btn sm" data-act="dkr-c-preview">' + (c.preview ? '收起请求预览' : '预览请求 JSON') + '</button>' +
      '<span style="flex:1"></span>' +
      '<span style="font-size:10.5px;color:var(--muted)">' + (c.busy ? '正在提交…' : '') + '</span>' +
      '<button class="btn sm" data-act="dkr-c-close">取消</button>' +
      '<button class="btn sm" data-act="dkr-c-submit" data-start="0">仅创建</button>' +
      '<button class="btn sm primary" data-act="dkr-c-submit" data-start="1">创建并启动</button>';
  }
  function cFld(k, label, val, ph, hint, type) {
    return '<div class="qf-row"><label>' + RE(label) + '</label>' +
      '<input class="qf-inp" data-cf="' + k + '" type="' + (type || 'text') + '" value="' + RE(val) + '" placeholder="' + RE(ph || '') + '">' +
      (hint ? '<div class="qf-hint">' + RE(hint) + '</div>' : '') + '</div>';
  }
  function cChk(k, label, val, hint) {
    return '<div class="qf-row"><label>' + RE(label) + '</label>' +
      '<div><label style="font-size:11.5px"><input type="checkbox" data-cf="' + k + '" ' + (val ? 'checked' : '') + '> 启用</label>' +
      (hint ? '<div class="qf-hint" style="margin-top:4px">' + RE(hint) + '</div>' : '') + '</div></div>';
  }
  function cRowHead(cols) {
    return '<table class="qf-tbl"><thead><tr>' + cols.map(function (x) { return '<th>' + RE(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
  }
  function cImgOptions() {
    var imgs = ((NasDeck.wsl || {}).images) || [];
    return imgs.map(function (im) {
      var t = (im.repo && im.tag) ? (im.repo + ':' + im.tag) : (im.id || '');
      return '<option value="' + RE(t) + '">';
    }).join('');
  }
  function cTabHtml() {
    var c = DKR.c, t = c.tab;
    var h = '';
    if (c.preview) {
      h += '<div class="qf-sec">请求预览（发给 /api/wsl/create 的结构化参数）</div>' +
        '<pre class="qf-pre">' + RE(JSON.stringify(cPayload(true), null, 2)) + '</pre>' +
        '<div style="height:14px"></div>';
    }
    if (t === 'basic') {
      h += '<div class="qf-sec">镜像与基本信息</div>' +
        '<div class="qf-row"><label>镜像</label><div><input class="qf-inp" data-cf="image" list="dkr-img-list" value="' + RE(c.image) +
        '" placeholder="例如 nginx:latest、镜像短 ID"><datalist id="dkr-img-list">' + cImgOptions() + '</datalist></div></div>' +
        '<div class="qf-row"><label></label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        RBT('dkr-c-meta', '读取镜像元数据', '', '', 'info') +
        RBT('dkr-c-import', '从元数据自动填充', '', '', 'download') +
        '<span style="font-size:10.5px;color:var(--muted)">' + (c.meta ? '已读取 ' + RE(c.meta.architecture + ' / ' + c.meta.os) : '尚未读取') + '</span></div></div>' +
        (c.metaErr ? '<div class="qf-msg err">' + RE(c.metaErr) + '</div>' : '') +
        cFld('name', '容器名称', c.name, '留空由 Docker 自动生成', '只允许字母、数字、_ . -') +
        cFld('cmd', '启动命令 Cmd', c.cmd, '留空使用镜像默认命令', '多个参数用空格分隔，例如 nginx -g daemon off;') +
        cFld('entrypoint', '入口 Entrypoint', c.entrypoint, '留空使用镜像默认值') +
        cFld('workdir', '工作目录', c.workdir, '/app') +
        cFld('user', '运行用户', c.user, 'root') +
        cFld('hostname', '主机名', c.hostname, '留空由 Docker 分配') +
        cChk('tty', '分配 TTY', c.tty, '需要交互式终端时开启');
    } else if (t === 'resources') {
      h += '<div class="qf-sec">CPU / 内存资源限制</div>' +
        '<div class="qf-msg">留空或 0 = 不限制（由 Docker 使用宿主机全部资源）。这些值会映射为 NanoCpus / CpuShares / Memory / MemorySwap。</div>' +
        cFld('cpus', 'CPU 核数上限', c.cpus, '例如 1.5', '按小数核数限制，映射 NanoCpus = 核数 × 1e9', 'number') +
        cFld('cpuShares', 'CPU 相对权重', c.cpuShares, '默认 1024', '仅在 CPU 竞争时生效，2 ~ 262144', 'number') +
        cFld('memoryMb', '内存上限 (MB)', c.memoryMb, '例如 512', '映射 HostConfig.Memory', 'number') +
        cFld('memorySwapMb', '内存 + Swap (MB)', c.memorySwapMb, '例如 1024', '必须 ≥ 内存上限；留空表示不设置', 'number') +
        cChk('privileged', '特权模式', c.privileged, '容器获得宿主机近乎全部能力，请谨慎开启');
    } else if (t === 'ports') {
      h += '<div class="qf-sec">端口映射</div>' +
        '<div class="qf-msg">宿主机端口留空 = 由 Docker 随机分配；容器端口来自镜像的 ExposedPorts 或自行填写。可先到「基本设置」读取镜像元数据并自动填充。</div>' +
        cRowHead(['宿主机 IP（可选）', '宿主机端口', '容器端口', '协议', '']) +
        c.ports.map(function (p, i) {
          return '<tr><td><input class="qf-inp" data-cf-row="ports" data-i="' + i + '" data-k="hostIp" value="' + RE(p.hostIp) + '" placeholder="0.0.0.0"></td>' +
            '<td><input class="qf-inp" data-cf-row="ports" data-i="' + i + '" data-k="host" value="' + RE(p.host) + '" placeholder="8080"></td>' +
            '<td><input class="qf-inp" data-cf-row="ports" data-i="' + i + '" data-k="container" value="' + RE(p.container) + '" placeholder="80"></td>' +
            '<td><select class="qf-inp" data-cf-row="ports" data-i="' + i + '" data-k="proto"><option value="tcp" ' + (p.proto !== 'udp' ? 'selected' : '') + '>tcp</option>' +
            '<option value="udp" ' + (p.proto === 'udp' ? 'selected' : '') + '>udp</option></select></td>' +
            '<td><button class="btn sm danger" data-act="dkr-c-delrow" data-g="ports" data-i="' + i + '">删除</button></td></tr>';
        }).join('') + '</tbody></table>' +
        RBT('dkr-c-addrow', '添加端口映射', 'data-g="ports"', '', 'plus') + ' ' +
        RBT('dkr-c-import', '从镜像元数据导入', '', '', 'download');
    } else if (t === 'env') {
      h += '<div class="qf-sec">环境变量与标签</div>' +
        cRowHead(['变量名 KEY', '值 VALUE', '']) +
        c.env.map(function (e, i) {
          return '<tr><td><input class="qf-inp" data-cf-row="env" data-i="' + i + '" data-k="k" value="' + RE(e.k) + '" placeholder="TZ"></td>' +
            '<td><input class="qf-inp" data-cf-row="env" data-i="' + i + '" data-k="v" value="' + RE(e.v) + '" placeholder="Asia/Shanghai"></td>' +
            '<td><button class="btn sm danger" data-act="dkr-c-delrow" data-g="env" data-i="' + i + '">删除</button></td></tr>';
        }).join('') + '</tbody></table>' +
        RBT('dkr-c-addrow', '添加环境变量', 'data-g="env"', '', 'plus') + ' ' +
        RBT('dkr-c-import', '从镜像元数据导入', '', '', 'download') +
        '<div style="height:16px"></div>' +
        cFld('labels', '容器标签', c.labels, 'key=value,owner=me', '逗号分隔，只接受 KEY=VALUE 形式');
    } else if (t === 'mounts') {
      var vols = ((NasDeck.wsl || {}).volumes) || [];
      h += '<div class="qf-sec">文件 / 文件夹映射</div>' +
        '<div class="qf-msg">Windows 路径请填 Docker 守护进程可见的形式（WSL dockerd 用 <span class="mono">/mnt/c/...</span>，Docker Desktop 用 <span class="mono">C:\\...</span>）。类型选 volume 且源留空 = 匿名卷。</div>' +
        cRowHead(['源（宿主路径 / 卷名）', '容器内路径', '类型', '只读', '']) +
        c.mounts.map(function (m, i) {
          return '<tr><td><input class="qf-inp" data-cf-row="mounts" data-i="' + i + '" data-k="source" value="' + RE(m.source) + '" placeholder="/mnt/c/Data 或 mydata" list="dkr-vol-list"></td>' +
            '<td><input class="qf-inp" data-cf-row="mounts" data-i="' + i + '" data-k="target" value="' + RE(m.target) + '" placeholder="/data"></td>' +
            '<td><select class="qf-inp" data-cf-row="mounts" data-i="' + i + '" data-k="type"><option value="bind" ' + (m.type !== 'volume' ? 'selected' : '') + '>bind 文件/目录</option>' +
            '<option value="volume" ' + (m.type === 'volume' ? 'selected' : '') + '>volume 具名卷</option></select></td>' +
            '<td style="text-align:center"><input type="checkbox" data-cf-row="mounts" data-i="' + i + '" data-k="ro" ' + (m.ro ? 'checked' : '') + '></td>' +
            '<td><button class="btn sm danger" data-act="dkr-c-delrow" data-g="mounts" data-i="' + i + '">删除</button></td></tr>';
        }).join('') + '</tbody></table>' +
        '<datalist id="dkr-vol-list">' + vols.map(function (v) { return '<option value="' + RE(v.n) + '">'; }).join('') + '</datalist>' +
        RBT('dkr-c-addrow', '添加映射', 'data-g="mounts"', '', 'plus') + ' ' +
        RBT('dkr-c-import', '从镜像元数据导入卷', '', '', 'download');
    } else if (t === 'network') {
      var nets = ((NasDeck.wsl || {}).networks) || [];
      var opts = ['bridge', 'host', 'none'].concat(nets.map(function (n) { return n.n; }))
        .filter(function (v, i, a) { return a.indexOf(v) === i; });
      h += '<div class="qf-sec">网络与重启策略</div>' +
        '<div class="qf-row"><label>网络模式</label><select class="qf-inp" data-cf="network">' +
        opts.map(function (n) { return '<option value="' + RE(n) + '" ' + (c.network === n ? 'selected' : '') + '>' + RE(n) + '</option>'; }).join('') +
        '</select><div class="qf-hint">来自真实 Docker 网络的 /networks；自定义网络可直接按名称选择</div></div>' +
        cFld('dns', '自定义 DNS', c.dns, '8.8.8.8,1.1.1.1', '逗号分隔，留空使用默认') +
        cFld('extraHosts', 'ExtraHosts', c.extraHosts, 'host.docker.internal:host-gateway', '逗号分隔') +
        '<div class="qf-row"><label>重启策略</label><select class="qf-inp" data-cf="restart">' +
        [['no', '不自动重启'], ['always', '总是重启'], ['unless-stopped', '除非手动停止（推荐）'], ['on-failure', '失败时重启']]
          .map(function (x) { return '<option value="' + x[0] + '" ' + (c.restart === x[0] ? 'selected' : '') + '>' + RE(x[1]) + '</option>'; }).join('') +
        '</select></div>' +
        cFld('restartRetries', '最大重试次数', c.restartRetries, '0', '仅「失败时重启」策略生效', 'number') +
        cChk('autoRemove', '停止后自动删除容器', c.autoRemove, '调试一次性任务时有用');
    } else {
      var m = c.meta;
      h += '<div class="qf-sec">镜像元数据（真实 /images/{name}/json）</div>';
      if (!m) {
        h += '<div class="qf-msg">尚未读取。到「基本设置」选择镜像后点「读取镜像元数据」。</div>';
      } else {
        var kv = function (k, v) { return '<div class="kv"><span class="k">' + RE(k) + '</span><span class="v mono">' + RE(v) + '</span></div>'; };
        var arr = function (a) { return (a && a.length) ? a.map(function (x) { return RE(x); }).join('<br>') : 'N/A'; };
        h += '<div class="grid g2" style="margin-bottom:12px">' +
          kv('镜像 ID', m.id) + kv('架构 / 系统', m.architecture + ' / ' + m.os) +
          kv('大小', m.sizeText) + kv('创建时间', m.created || 'N/A') +
          kv('作者', m.author) + kv('Docker 版本', m.dockerVersion) +
          kv('Digest', m.digest) + kv('默认用户', m.user || 'N/A') +
          kv('工作目录', m.workingDir || 'N/A') + kv('Cmd', (m.cmd || []).join(' ') || 'N/A') +
          kv('Entrypoint', (m.entrypoint || []).join(' ') || 'N/A') + '</div>' +
          RCARD('暴露端口 ExposedPorts', '<div class="mono" style="font-size:11px">' + arr(m.exposedPorts) + '</div>') +
          RCARD('默认环境变量 Env', '<div class="mono" style="font-size:11px">' + arr(m.env) + '</div>') +
          RCARD('声明卷 Volumes', '<div class="mono" style="font-size:11px">' + arr(m.volumes) + '</div>') +
          RCARD('标签 Labels', '<div class="mono" style="font-size:11px">' +
            arr(Object.keys(m.labels || {}).map(function (k) { return k + '=' + m.labels[k]; })) + '</div>') +
          '<div style="margin-top:10px">' + RBT('dkr-c-import', '把端口 / 环境变量 / 卷导入表单', '', 'primary', 'download') + '</div>';
      }
    }
    return h;
  }
  function cPayload(startIt) {
    var c = DKR.c || cDefault();
    return {
      image: c.image, name: c.name, cmd: c.cmd, entrypoint: c.entrypoint,
      workdir: c.workdir, user: c.user, hostname: c.hostname,
      tty: !!c.tty, privileged: !!c.privileged, autoRemove: !!c.autoRemove,
      cpus: Number(c.cpus) || 0, cpuShares: Number(c.cpuShares) || 0,
      memoryMb: Number(c.memoryMb) || 0, memorySwapMb: Number(c.memorySwapMb) || 0,
      env: (c.env || []).filter(function (x) { return x.k; }).map(function (x) { return x.k + '=' + (x.v || ''); }),
      labels: c.labels,
      ports: (c.ports || []).filter(function (x) { return x.container; }).map(function (x) {
        return { hostIp: x.hostIp || '', host: x.host || '', container: x.container, proto: x.proto || 'tcp' };
      }),
      mounts: (c.mounts || []).filter(function (x) { return x.target; }).map(function (x) {
        return { source: x.source || '', target: x.target, type: x.type === 'volume' ? 'volume' : 'bind', readOnly: !!x.ro };
      }),
      network: c.network, dns: c.dns, extraHosts: c.extraHosts,
      restart: c.restart, restartRetries: Number(c.restartRetries) || 0,
      start: startIt !== false
    };
  }
  function cApplyMeta() {
    var m = DKR.c.meta;
    if (!m) return;
    (m.exposedPorts || []).forEach(function (p) {
      var mm = /^(\d{1,5})\/(tcp|udp|sctp)$/.exec(p);
      if (!mm) return;
      if (DKR.c.ports.some(function (x) { return x.container === mm[1] && x.proto === mm[2]; })) return;
      DKR.c.ports.push({ hostIp: '', host: '', container: mm[1], proto: mm[2] === 'udp' ? 'udp' : 'tcp' });
    });
    (m.env || []).forEach(function (e) {
      var i = e.indexOf('=');
      if (i <= 0) return;
      var k = e.slice(0, i), v = e.slice(i + 1);
      if (DKR.c.env.some(function (x) { return x.k === k; })) return;
      DKR.c.env.push({ k: k, v: v });
    });
    (m.volumes || []).forEach(function (v) {
      if (DKR.c.mounts.some(function (x) { return x.target === v; })) return;
      DKR.c.mounts.push({ source: '', target: v, type: 'volume', ro: false });
    });
    if (!DKR.c.cmd && (m.cmd || []).length) DKR.c.cmd = m.cmd.join(' ');
    if (!DKR.c.entrypoint && (m.entrypoint || []).length) DKR.c.entrypoint = m.entrypoint.join(' ');
    if (!DKR.c.workdir && m.workingDir) DKR.c.workdir = m.workingDir;
    if (!DKR.c.user && m.user) DKR.c.user = m.user;
  }
  function cOpen(image) {
    uiEnsureStyle();
    cClose();
    DKR.c = cDefault();
    if (image) DKR.c.image = image;
    var mask = document.createElement('div');
    mask.className = 'nasdeck-dlg-mask';
    mask.id = 'nasdeck-dlg-mask';
    var w = Math.min(960, Math.max(660, innerWidth - 70));
    var h = Math.min(700, Math.max(440, innerHeight - 90));
    mask.innerHTML = '<div class="nasdeck-dlg" id="nasdeck-dlg" style="left:' + Math.round((innerWidth - w) / 2) +
      'px;top:' + Math.round((innerHeight - h) / 2) + 'px;width:' + w + 'px;height:' + h + 'px">' +
      '<div class="nasdeck-dlg-bar" id="nasdeck-dlg-bar">' + glyph('box', 16, 'var(--accent)') +
      '<b>建立容器 · 完整设置</b><span class="dim">真实 Docker Engine create 参数 · 文件保存在 Windows 本机磁盘</span>' +
      '<button data-act="dkr-c-close" title="关闭">×</button></div>' +
      '<div class="nasdeck-dlg-tabs">' + cTabsHtml() + '</div>' +
      '<div class="nasdeck-dlg-body">' + cTabHtml() + '</div>' +
      '<div class="nasdeck-dlg-foot">' + cFootHtml() + '</div></div>';
    document.body.appendChild(mask);
    cBindDialog();
    if (image && NasDeck.token) cLoadMeta(true);
  }
  function cClose() {
    var m = document.getElementById('nasdeck-dlg-mask');
    if (m) m.remove();
    document.body.classList.remove('nasdeck-dlg-drag');
  }
  function cBindDialog() {
    var root = cDlg();
    if (!root || root.__bound) return;
    root.__bound = true;
    ['input', 'change'].forEach(function (ev) {
      root.addEventListener(ev, function (e) {
        if (e.target.matches('[data-cf],[data-cf-row]')) cCollect();
      });
    });
    /* 不阻止冒泡：底座的 document click 委托需要收到所有 data-act 按钮点击。
       对话框挂在 body 而非 #desk 内，点击空白处不会触发桌面动作。 */
    var bar = root.querySelector('.nasdeck-dlg-bar');
    bar.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      var el = cDlg();
      window.__NasDeck_DLG_DRAG__ = {
        sx: e.clientX, sy: e.clientY,
        x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0
      };
      document.body.classList.add('nasdeck-dlg-drag');
      e.preventDefault();
    });
    if (!window.__NasDeck_DLG_DRAG_BOUND__) {
      window.__NasDeck_DLG_DRAG_BOUND__ = true;
      document.addEventListener('mousemove', function (e) {
        var d = window.__NasDeck_DLG_DRAG__;
        if (!d) return;
        var el = cDlg();
        if (!el) { window.__NasDeck_DLG_DRAG__ = null; return; }
        el.style.left = Math.max(0, Math.min(innerWidth - 120, d.x + e.clientX - d.sx)) + 'px';
        el.style.top = Math.max(0, Math.min(innerHeight - 60, d.y + e.clientY - d.sy)) + 'px';
      });
      document.addEventListener('mouseup', function () {
        if (!window.__NasDeck_DLG_DRAG__) return;
        window.__NasDeck_DLG_DRAG__ = null;
        document.body.classList.remove('nasdeck-dlg-drag');
      });
    }
  }
  async function cLoadMeta(silent) {
    var img = (DKR.c.image || '').trim();
    if (!img) { if (!silent) toast('请先选择镜像', '', 'warn'); return; }
    try {
      var r = await NasDeck.get('/api/wsl/image/inspect?image=' + encodeURIComponent(img));
      if (!r.ok) {
        DKR.c.metaErr = r.error || '读取失败';
        if (!silent) toast('镜像元数据读取失败', r.error || '', 'warn');
      } else {
        DKR.c.meta = r; DKR.c.metaErr = '';
        if (silent) cApplyMeta();
        if (!silent) toast('已读取镜像元数据', (r.exposedPorts || []).length + ' 个端口 / ' + (r.env || []).length + ' 个环境变量', 'ok');
      }
      cPaint();
    } catch (e) {
      DKR.c.metaErr = e.message;
      cPaint();
      if (!silent) toast('镜像元数据读取失败', e.message, 'err');
    }
  }

  /* ==================================================================
   * 插件中心（App Center）
   * 定位：这里登记的是「本项目的功能」，以插件形式呈现；
   *      不读取本机已安装软件 / 注册表卸载项。
   *      内置功能 = 内置插件；用户可按模板编写 .js 插件上传。
   *      后端只把插件当文件保存，从不自动执行，运行需用户手动触发。
   * ================================================================ */
  var PLG_TABS = [['all', '全部插件'], ['uploaded', '我上传的'], ['dev', '插件开发 / 上传']];
  var PLG = {
    tab: 'all', list: [], dir: '', counts: null, template: '', loaded: false,
    loading: false, error: '', q: '', msg: '', busy: false,
    upName: 'my-plugin.js', upCode: ''
  };
  NasDeck.plugins = PLG;

  function plgSaveInputs() {
    var w = W('appcenter'), root = w && w.el;
    if (!root) return;
    try {
      root.querySelectorAll('[data-pf]').forEach(function (el) { PLG[el.dataset.pf] = el.value; });
    } catch (e) {}
  }
  function plgToast(t, sub, kind) { try { toast(t, sub, kind); } catch (e) {} }
  function plgBadge(t, ok, warn) {
    return '<span class="badge ' + (ok ? 'ok' : (warn ? 'warn' : '')) + '"><i></i> ' + RE(t) + '</span>';
  }
  var PLG_SEQ = 0;
  async function plgLoad(silent) {
    /* 上传 / 启停 / 删除都会立刻刷新列表；并发时先发出的旧响应可能后到，
       把「已删除」的结果又覆盖成旧列表。用序号只让最后一次请求落地。 */
    var seq = ++PLG_SEQ;
    var r = null, err = null;
    try { r = await NasDeck.get('/api/plugins/list'); }
    catch (e) { err = e; }
    if (seq !== PLG_SEQ) return;
    if (err) {
      PLG.error = err.message;
      PLG.loaded = true;
      if (!silent) plgToast('读取插件列表失败', err.message, 'err');
    } else {
      PLG.list = r.plugins || [];
      PLG.dir = r.dir || '';
      PLG.counts = r.counts || null;
      if (r.template) PLG.template = r.template;
      PLG.loaded = true; PLG.error = '';
      if (!silent) plgToast('插件列表已刷新', '共 ' + PLG.list.length + ' 个插件', 'ok');
    }
    try { if (W('appcenter')) rerender('appcenter'); } catch (e) {}
  }

  /* 受限运行沙箱：插件拿不到后端 token / 内部对象，只能用白名单 API */
  function plgSandbox(id) {
    return {
      registerPlugin: function (o) { PLG.__captured = o; },
      get: function (u) { return NasDeck.get(u); },
      post: function (u, b) { return NasDeck.post(u, b); },
      toast: function (a, b, c) { plgToast(a, b, c); },
      esc: RE,
      pluginId: id,
      version: '2.4.0'
    };
  }
  function plgWindow(id, title, html, plugin) {
    uiEnsureStyle();
    var old = document.getElementById('nasdeck-plg-mask');
    if (old) old.remove();
    var mask = document.createElement('div');
    mask.className = 'nasdeck-dlg-mask';
    mask.id = 'nasdeck-plg-mask';
    var w = Math.min(880, Math.max(560, innerWidth - 90));
    var h = Math.min(640, Math.max(360, innerHeight - 110));
    mask.innerHTML = '<div class="nasdeck-dlg" id="nasdeck-plg-dlg" style="left:' +
      Math.round((innerWidth - w) / 2) + 'px;top:' + Math.round((innerHeight - h) / 2) +
      'px;width:' + w + 'px;height:' + h + 'px">' +
      '<div class="nasdeck-dlg-bar">' + glyph('grid', 16, 'var(--accent)') +
      '<b>' + RE(title) + '</b><span class="dim">插件 · ' + RE(id) +
      ' · 在独立窗口中手动运行</span>' +
      '<button data-act="plg-close" title="关闭">×</button></div>' +
      '<div class="nasdeck-dlg-body" style="flex:1;overflow:auto;padding:14px">' + html + '</div>' +
      '<div class="nasdeck-dlg-foot"><span style="flex:1"></span>' +
      '<button class="btn sm" data-act="plg-close">关闭</button></div></div>';
    document.body.appendChild(mask);
    if (plugin && typeof plugin.onMount === 'function') {
      try { plugin.onMount(document.getElementById('nasdeck-plg-dlg')); } catch (e) {}
    }
  }
  function plgRun(id, code) {
    PLG.__captured = null;
    try { new Function('NasDeck', String(code || ''))(plgSandbox(id)); }
    catch (e) { plgToast('插件代码执行出错', e.message, 'err'); return; }
    var p = PLG.__captured;
    if (!p || typeof p.render !== 'function') {
      plgToast('插件未正确注册', '必须调用 NasDeck.registerPlugin({ render: ... })', 'warn');
      return;
    }
    var html = '';
    try { html = String(p.render() || ''); }
    catch (e) { plgToast('插件渲染出错', e.message, 'err'); return; }
    plgWindow(id, p.name || id, html, p);
    PLG.msg = '已运行插件 ' + id;
  }

  function plgCard(p) {
    /* v15 需求 11：每个插件一个确定性独立彩色图标，应用商店式卡片。
       实现放在 v15 层，保证图标与桌面快捷方式同源；层未就绪时回退旧卡片。 */
    if (window.NasDeck_V15 && typeof NasDeck_V15.pluginCard === 'function')
      return NasDeck_V15.pluginCard(p);
    return '<div class="card"><p class="desc">' + RE(p.name) + '（插件界面未就绪 · N/A）</p></div>';
  }

  function plgDevHtml() {
    var tpl = PLG.template || '/* 点「填入模板」从后端读取 */';
    var guide = '<div class="card" style="margin-bottom:12px">' +
      '<div class="section-title">' + glyph('layers', 14) + '插件开发规范</div>' +
      '<div class="kv"><span class="k">文件形式</span><span class="v">单个 .js 文件，英文小写 ID 作为文件名（如 my-tool.js），上限 512 KB</span></div>' +
      '<div class="kv"><span class="k">元数据</span><span class="v mono">/*NasDeck-PLUGIN { "name":"...", "en":"...", "version":"1.0.0", "description":"...", "icon":"box", "author":"...", "category":"应用" } */</span></div>' +
      '<div class="kv"><span class="k">注册调用</span><span class="v mono">NasDeck.registerPlugin({ name, render(), onMount(root) })</span></div>' +
      '<div class="kv"><span class="k">可用 API</span><span class="v mono">NasDeck.get(url) / NasDeck.post(url, body) / NasDeck.toast(t, sub, kind) / NasDeck.esc(s) / NasDeck.pluginId</span></div>' +
      '<div class="kv"><span class="k">存放位置</span><span class="v mono">' + RE(PLG.dir || 'data/plugins') + '</span></div>' +
      '<div class="kv"><span class="k">运行方式</span><span class="v">后端只保存文件、绝不自动执行；在「我上传的」点「运行」才在独立窗口里执行，且只暴露上述白名单 API</span></div>' +
      '<p class="desc" style="margin:9px 0 0">内置功能同样以插件清单登记，可在「全部插件」里直接打开。插件停用时不会出现在运行入口，删除只影响上传的 .js 文件。</p></div>';
    var form = '<div class="card" style="margin-bottom:12px">' +
      '<div class="section-title">' + glyph('upload', 14) + '上传新插件</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:9px">' +
      '<span style="font-size:11px;color:var(--muted)">文件名</span>' +
      '<input class="inp" data-pf="upName" value="' + RE(PLG.upName) + '" style="width:220px" placeholder="my-plugin.js">' +
      RBT('plg-file', '选择本地 .js 文件', '', '', 'folder') + ' ' +
      RBT('plg-template', '填入模板', '', '', 'file') + ' ' +
      RBT('plg-download', '下载模板', '', '', 'download') + '</div>' +
      '<textarea class="inp" data-pf="upCode" spellcheck="false" ' +
      'style="width:100%;height:230px;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.5" ' +
      'placeholder="粘贴插件源码，或点「选择本地 .js 文件」">' + RE(PLG.upCode) + '</textarea>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:9px">' +
      RBT('plg-upload', PLG.busy ? '正在上传…' : '上传并安装插件', '', 'primary', 'upload') +
      '<span class="desc" style="margin:0">上传后立即出现在「我上传的」，可启用 / 停用 / 删除 / 运行</span></div></div>';
    var tplCard = '<div class="card"><div class="section-title">' + glyph('file', 14) + '模板预览（可编辑后上传）</div>' +
      '<pre class="mono" style="white-space:pre-wrap;font-size:11px;line-height:1.5;margin:0;max-height:260px;overflow:auto">' +
      RE(tpl) + '</pre></div>';
    return guide + form + tplCard;
  }

  function pluginCenter() {
    plgSaveInputs();
    var counts = PLG.counts || {};
    /* 统一应用目录：App Center 与桌面共用同一份清单，不再分成「插件」和「程序」 */
    var ALL = (window.NasDeck_V15 && typeof NasDeck_V15.catalog === 'function')
      ? NasDeck_V15.catalog() : PLG.list;
    var uploaded = ALL.filter(function (p) { return !p.builtin; });
    var builtinN = ALL.filter(function (p) { return !!p.builtin; }).length;
    var onDeskN = ALL.filter(function (p) { return !!p.onDesk; }).length;
    var tabs = '<div class="tabs">' + PLG_TABS.map(function (t) {
      var n = t[0] === 'all' ? ALL.length : (t[0] === 'uploaded' ? uploaded.length : -1);
      return '<button class="' + (PLG.tab === t[0] ? 'on' : '') +
        '" data-act="plg-tab" data-t="' + t[0] + '">' + RE(t[1]) +
        (n >= 0 ? ' (' + n + ')' : '') + '</button>';
    }).join('') + '</div>';

    var status = '<div class="card" style="padding:10px 12px;margin-bottom:12px">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      plgBadge('应用中心 · 统一清单', true, false) +
      plgBadge('共 ' + ALL.length + ' 个应用') +
      plgBadge('内置 ' + builtinN) +
      plgBadge('扩展 ' + uploaded.length) +
      plgBadge('桌面显示 ' + onDeskN) +
      plgBadge('目录 ' + RE(PLG.dir || 'N/A')) +
      (PLG.error ? plgBadge('读取失败：' + RE(PLG.error), false, true) : '') +
      '<span style="flex:1"></span>' +
      RBT('plg-refresh', '刷新列表', '', '', 'refresh') + '</div>' +
      '<p class="desc" style="margin:9px 0 0"><b>App Center 与桌面是同一份应用清单</b>：' +
      '这里列出的每个应用与桌面图标是同一个实体，名称、描述与彩色图标完全一致；' +
      '「显示到桌面 / 从桌面隐藏」只切换快捷方式，既不安装也不卸载。' +
      '上传插件后自动出现在桌面，内置功能可直接打开。' +
      '插件文件保存在 Windows 本机 <span class="mono">' + RE(PLG.dir || 'data/plugins') + '</span>，' +
      '后端只存不执行。</p>' +
      (PLG.msg ? '<p class="desc" style="margin:7px 0 0">最近操作：<span class="mono">' + RE(PLG.msg) + '</span></p>' : '') +
      '</div>';

    var body = '';
    if (!PLG.loaded) {
      body = '<div class="card"><p class="desc">正在读取插件清单…（登录完成后自动加载，也可点「刷新列表」）</p></div>';
    } else if (PLG.tab === 'dev') {
      body = plgDevHtml();
    } else {
      var src = PLG.tab === 'uploaded' ? uploaded : ALL;
      var q = (PLG.q || '').toLowerCase();
      if (q) src = src.filter(function (p) {
        return ((p.name || '') + ' ' + (p.en || '') + ' ' + (p.id || '') + ' ' +
          (p.description || '')).toLowerCase().indexOf(q) >= 0;
      });
      var search = '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">' +
        '<input class="inp" data-pf="q" value="' + RE(PLG.q) +
        '" placeholder="筛选插件名称 / ID / 描述…" style="flex:1">' +
        RBT('plg-search', '筛选', '', '', 'search') + ' ' +
        RBT('plg-tab', '去上传插件', 'data-t="dev"', '', 'upload') + '</div>';
      var cards = src.length
        ? '<div class="v15-store">' + src.map(plgCard).join('') + '</div>'
        : '<div class="card"><p class="desc">' +
          (PLG.tab === 'uploaded'
            ? '还没有上传插件。切到「插件开发 / 上传」按模板写一个，或点上面的「去上传插件」。'
            : '没有匹配的插件。') + '</p></div>';
      body = search + cards;
    }
    return '<div class="app">' + tabs + '<div class="app-scroll">' + status + body + '</div></div>';
  }

  var DKR_TABS = [
    ['overview', '概览 / 引擎控制'],
    ['containers', '容器'],
    ['images', '镜像'],
    ['wsl', 'WSL 发行版'],
    ['diag', 'WSL 终端'],
    ['registries', '镜像仓库']
  ];
  function dockerBlock() {
    var w = NasDeck.wsl || {}, ka = DKR.ka || {}, d = NasDeck.wslDiscover || w.discover || null;
    var ep = w.endpoint || ka.endpoint || {}, cts = w.containers || [], imgs = w.images || [];
    var ds = w.distros || ((NasDeck.wslExtra || {}).distros) || [];
    var online = !!(w.available || ka.online);
    var tab = DKR.tab || 'overview';
    var badge = function (t, ok, warn) {
      return '<span class="badge ' + (ok ? 'ok' : (warn ? 'warn' : '')) + '"><i></i> ' + RE(t) + '</span>';
    };
    var kvRow = function (k, v) { return '<div class="kv"><span class="k">' + RE(k) + '</span><span class="v mono">' + v + '</span></div>'; };
    var secTitle = function (t) { return '<div class="section-title">' + glyph('layers', 14) + RE(t) + '</div>'; };

    var runningN = cts.filter(function (c) { return c.st || String(c.state) === 'running'; }).length;
    /* 引擎状态条：每个标签页顶部都有，随时知道真实引擎是否在线。
       未连线时给出明确下一步，避免用户面对 N/A 不知道该点哪里。 */
    var status = '<div class="card" style="padding:10px 12px;margin-bottom:12px">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      badge('Docker Engine ' + (online ? '在线' : '未运行 / N/A'), online, !online) +
      badge(RE(RNA(w.version || ka.version))) +
      badge('容器 ' + cts.length + '（运行 ' + runningN + '）· 镜像 ' + imgs.length + ' · 发行版 ' + ds.length) +
      badge('保活 ' + (ka.on ? '开启' : '关闭'), !!ka.on, false) +
      '<span style="flex:1"></span>' +
      (DKR.busy ? badge('正在启动引擎…', false, true) : '') + '</div>' +
      (online ? '' : '<p class="desc" style="margin:8px 0 0"><b>引擎未连线：</b>到「概览 / 引擎控制」点「连接并启动引擎」，' +
        '或在「系统启动中心」执行「Docker 引擎冷启动」（WSL 冷启动约 20–60 秒）。</p>') +
      '<p class="desc" style="margin:9px 0 0">最近动作：<span class="mono">' + RE(DKR.msg || '（尚无操作）') +
      '</span> · 完整执行输出见「端点探测 / 日志」标签。</p></div>';

    var tabs = '<div class="tabs">' + DKR_TABS.map(function (t) {
      var n = t[0] === 'containers' ? cts.length : (t[0] === 'images' ? imgs.length : (t[0] === 'wsl' ? ds.length : -1));
      return '<button class="' + (tab === t[0] ? 'on' : '') + '" data-act="dkr-tab" data-t="' + t[0] + '">' +
        RE(t[1]) + (n >= 0 ? ' (' + n + ')' : '') + '</button>';
    }).join('') + '</div>';

    var body = '';
    if (tab === 'overview') {
      var info = '<div class="grid g2" style="margin-bottom:12px">' +
        kvRow('Engine 端点', RE(ep.socket ? ('命名管道 ' + ep.socket) : ((ep.host || '127.0.0.1') + ':' + (ep.port || 2375)))) +
        kvRow('Engine 版本', RE(RNA(w.version || ka.version))) +
        kvRow('内核', RE(RNA(w.kernel))) +
        kvRow('WSL 会话', RE(ka.on ? ('常驻 PID ' + RNA(ka.pid)) : '未保活（空闲后 WSL 会休眠）')) +
        kvRow('看门狗', RE(ka.on ? '每 20 秒探测，掉线自动拉起 dockerd' : 'N/A')) +
        kvRow('最近动作', RE(RNA(ka.lastAction))) + '</div>';
      var btns = '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        RBT('dkr-start', online ? '重新连接 / 保持引擎在线' : '连接并启动引擎（含 WSL 唤醒）', '', 'primary', 'play') +
        RBT('dkr-restart', '重启 dockerd', '', '', 'refresh') +
        RBT('dkr-stop', '停止 dockerd', '', 'danger', 'pause') +
        RBT('dkr-keepoff', '关闭保活', '', '', 'x') +
        RBT('dkr-refresh', '刷新容器 / 镜像', '', '', 'refresh') +
        RBT('dkr-discover', '重新探测端点', '', '', 'activity') + '</div>';
      body = '<div class="card" style="margin-bottom:12px">' + secTitle('引擎与 WSL 控制') + info +
        '<p class="desc">所有按钮调用本机后端的 <span class="mono">/api/wsl/*</span>，在 WSL 发行版内真实执行 ' +
        '<span class="mono">systemctl / dockerd / docker</span>；容器与镜像来自 Docker Engine REST API，' +
        '读不到就显示 N/A，绝不编造。</p>' + btns + '</div>' +
        '<div class="card">' + secTitle('关于 容器工作台') +
        '<p class="desc">Docker 只是本工具的一个小功能：沿用 WinNAS 的 WSL Docker 管理器方案，dockerd 跑在 WSL 子系统内；' +
        '文件始终保存在 Windows 本机磁盘。WSL2 空闲会自动休眠，因此默认开启常驻会话保活 + 掉线自动重启。</p></div>';
    } else if (tab === 'containers') {
      var createRow = '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        RBT('v15-upd-check', '检测镜像更新', '', '', 'activity') +
        RBT('dkr-pull', '拉取镜像', '', '', 'download') +
        RBT('dkr-create', '建立容器（完整设置）', '', 'primary', 'box') +
        RBT('dkr-exec', 'docker ps -a', 'data-c="docker ps -a"', '', 'terminal') +
        RBT('dkr-exec', 'docker info', 'data-c="docker info --format {{.ServerVersion}}"', '', 'info') + '</div>';
      var ctRows = cts.map(function (c) {
        var id = RE(c.id || '');
        var state = String(c.state || (c.st ? 'running' : 'exited'));
        var isRunning = state === 'running', isPaused = state === 'paused';
        var stateBadge = isRunning ? badge('执行中', true, false)
          : (isPaused ? badge('已暂停', false, true) : badge(RE(RNA(state)), false, false));
        /* 按真实状态给动作：过去 paused 容器也只给「启动」，Docker 会回
           409，而接口又把错误吞掉，结果「点了启动却永远起不来」。 */
        var ops = isRunning
          ? (RBT('dkr-action', '停止', 'data-n="' + id + '" data-a="stop"', '', 'pause') + ' ' +
             RBT('dkr-action', '暂停', 'data-n="' + id + '" data-a="pause"', '', 'pause'))
          : (isPaused
            ? (RBT('dkr-action', '继续', 'data-n="' + id + '" data-a="unpause"', 'primary', 'play') + ' ' +
               RBT('dkr-action', '停止', 'data-n="' + id + '" data-a="stop"', '', 'pause'))
            : RBT('dkr-action', '启动', 'data-n="' + id + '" data-a="start"', 'primary', 'play'));
        ops += ' ' + RBT('dkr-action', '重启', 'data-n="' + id + '" data-a="restart"', '', 'refresh') + ' ' +
          RBT('dkr-action', '日志', 'data-n="' + id + '" data-a="logs"', '', 'file') + ' ' +
          RBT('v15-ct-recreate', '重构', 'data-id="' + id + '"', '', 'box') + ' ' +
          RBT('dkr-action', '删除', 'data-n="' + id + '" data-a="remove"', 'danger', 'trash');
        /* v15 需求 2：仅 status==='update' 才显示可点击「有更新」标签；
           unknown / up-to-date 显示灰色或绿色状态，绝不编造有更新。 */
        var updTag = (window.NasDeck_V15 && typeof NasDeck_V15.updBadge === 'function')
          ? NasDeck_V15.updBadge(id) : '';
        return RROW([
          '<b>' + RE(c.n) + '</b><p class="mono dim">' + id + '</p>' + updTag, RE(RNA(c.img)),
          stateBadge, RE(RNA(c.port)), RE(RNA(c.status)), ops
        ]);
      });
      var ctTbl = RTBL(['容器（真实）', '镜像', '状态', '端口', '运行信息', '操作'], ctRows);
      /* v14 需求 2：清单按比例自适应，下方常驻「资源占用 / 日志」窗 */
      body = v14ContainerBody(cts, createRow);
    } else if (tab === 'images') {
      var imgRows = imgs.slice(0, 30).map(function (im) {
        var repo = im.repo || '', tg = im.tag || '';
        var tag = RE((repo || 'N/A') + ':' + (tg || 'N/A'));
        var usable = !!im.id && !/<none>|N\/A/i.test(repo + ':' + tg);
        /* <none>:<none> 悬空镜像不能用名字创建容器；改用短 ID，
           否则按钮点下去必然失败却看不到原因。 */
        var arg = usable ? (repo + ':' + tg) : (im.id || '');
        return RROW([tag, '<span class="mono dim">' + RE(im.id) + '</span>', RE(im.size), RE(im.created),
          arg ? RBT('dkr-run', usable ? '用它建容器' : '用镜像 ID 建容器', 'data-n="' + RE(arg) + '"', '', 'play')
            : '<span class="dim">N/A</span>']);
      });
      var imgTbl = imgs.length ? RTBL(['镜像（真实）', 'ID', '大小', '建立日期', '操作'], imgRows)
        : '<p class="desc">镜像库为空或引擎未运行（N/A）。</p>';
      body = '<div class="card">' + secTitle('本机镜像库') +
        '<p class="desc">来自 Docker Engine REST API <span class="mono">/images/json</span>；拉取镜像后在「容器」标签即可用它建立容器。</p>' +
        '<div style="margin-bottom:10px">' + RBT('dkr-pull', '拉取镜像', '', 'primary', 'download') + ' ' +
        RBT('dkr-refresh', '刷新镜像', '', '', 'refresh') + '</div>' + imgTbl + '</div>';
    } else if (tab === 'wsl') {
      var distroRows = ds.map(function (x) {
        var n = RE(x.name || 'N/A');
        return RROW(['<b>' + n + '</b>', RE(RNA(x.version)), RE(RNA(x.state)),
          '<span class="mono dim">' + RE(RNA(x.basePath)) + '</span>',
          RBT('dkr-distro', '启动发行版', 'data-n="' + n + '" data-a="start"', '', 'play') + ' ' +
          RBT('dkr-distro', '停止发行版', 'data-n="' + n + '" data-a="terminate"', 'danger', 'pause') + ' ' +
          RBT('dkr-exec', 'uname', 'data-c="uname -a" data-n="' + n + '"', '', 'terminal')]);
      });
      var distroTbl = ds.length ? RTBL(['WSL 发行版（真实）', 'WSL 版本', '状态', '安装路径', '操作'], distroRows)
        : '<p class="desc">未检测到 WSL 发行版（N/A）。</p>';
      body = '<div class="card">' + secTitle('WSL 子系统') +
        '<p class="desc">发行版由 <span class="mono">wsl.exe --list --verbose</span> 真实枚举；' +
        'dockerd 跑在发行版内，发行版被终止会导致 Engine 掉线。</p>' +
        '<div style="margin-bottom:10px">' + RBT('dkr-exec', '执行 docker ps -a', 'data-c="docker ps -a"', '', 'terminal') + ' ' +
        RBT('dkr-start', '唤醒并启动引擎', '', 'primary', 'play') + '</div>' + distroTbl + '</div>';
    } else if (tab === 'registries') {
      /* v15 需求 1：镜像仓库由 v15 层渲染，未就绪时如实显示提示 */
      body = (window.NasDeck_V15 && typeof NasDeck_V15.regPane === 'function')
        ? NasDeck_V15.regPane()
        : '<div class="card"><p class="desc">镜像仓库界面尚未就绪（N/A）</p></div>';
    } else {
      var tried = (d && d.tried) ? d.tried.map(function (t) {
        return RROW([RE(t.host + (t.port ? ':' + t.port : '')),
          t.ok ? badge('Docker 在线', true, false) : badge('未响应', false, false),
          RE(RNA(t.version)), RE(RNA(t.error))]);
      }) : [];
      var probeTbl = tried.length ? RTBL(['端点探测', '结果', 'Engine 版本', '说明'], tried)
        : '<p class="desc">尚未执行端点探测，点「重新探测端点」。</p>';
      var out = '<div class="card" style="padding:0;overflow:hidden"><div class="section-title" style="padding:10px 12px">' +
        glyph('terminal', 14) + '真实执行输出 / 当前状态<span class="sp"></span>' +
        RBT('dkr-clear', '清空输出', '', '', 'trash') + '</div>' +
        '<pre style="margin:0;padding:10px 12px;max-height:260px;overflow:auto;background:var(--bg2,#0f1722);' +
        'font:11px/1.6 Consolas,monospace;white-space:pre-wrap;color:var(--fg,#dbe7f3)">' +
        RE(DKR.msg || '（尚无操作）') + (DKR.out ? '\n\n' + RE(DKR.out) : '') + '</pre></div>';
      /* v14 需求 4：日志区改成连到 dockerd 所在 WSL 发行版的常驻终端 */
      body = v14TerminalBody();
    }

    /* v14 需求 2/4：容器清单与终端需要占满窗口高度的弹性宿主 */
    var shell = (tab === 'containers' || tab === 'diag')
      ? '<div class="v14-flex-host">' + status + body + '</div>'
      : '<div class="app-scroll">' + status + body + '</div>';
    return '<div class="app">' + tabs + shell + '</div>';
  }

  /* ------------------------------------------------------------------
   * 4) 动作：全部指向真实后端 API
   * ---------------------------------------------------------------- */
  async function refreshBin(silent) {
    try {
      var r = await NasDeck.get('/api/bin/list?limit=200');
      NasDeck.fillBIN(r.bin || []);
      NasDeck.realBin = {
        total: r.total, usedText: r.usedText, source: r.source,
        loading: !!r.loading, truncated: r.truncated, roots: r.roots, progress: r.progress
      };
      if (W('trash')) rerender('trash');
      if (!silent && r.loading) toast('后台扫描中', '回收站数据稍后自动补齐', 'warn');
    } catch (e) { if (!silent) toast('回收站读取失败', e.message, 'err'); }
  }
  function applyActions() {
    ACT['bin-sel'] = function (e, d) {
      BIN_SEL = +d.i;
      var tb = e.closest('tbody');
      if (tb) tb.querySelectorAll('tr').forEach(function (x) { x.classList.remove('sel'); });
      e.classList.add('sel');
    };
    ['bin-restore', 'bin-del', 'bin-clear'].forEach(function (k) {
      ACT[k] = async function (e, d) {
        var id = null;
        if (k !== 'bin-clear') {
          var v = (typeof BIN_SEL === 'number' ? BIN_SEL : (d && d.i));
          id = (BIN[v] || BIN[0] || {}).id;
          if (!id) { toast('请先选择项目', '', 'warn'); return; }
        }
        if (k === 'bin-clear') {
          var n = (NasDeck.realBin || {}).total || BIN.length;
          var rec = W('trash');
          askModal(rec, '清空 Windows 回收站',
            '这将永久删除本机回收站中的 ' + n + ' 个项目（' + ((NasDeck.realBin || {}).usedText || 'N/A') + '），且无法复原。',
            null, async function () {
              try {
                var r = await NasDeck.post('/api/bin/clear', { confirm: true });
                NasDeck.fillBIN(r.bin || []); NasDeck.realBin.total = r.total;
                rerender('trash'); toast('回收站已清空', '', 'warn');
              } catch (er) { toast('清空失败', er.message, 'err'); }
            });
          return;
        }
        if (k === 'bin-del') {
          var rec2 = W('trash');
          askModal(rec2, '永久删除', '该项目将从本机回收站永久移除，无法复原。', null, async function () {
            try { var r = await NasDeck.post('/api/bin/purge', { id: id }); NasDeck.fillBIN(r.bin || []); rerender('trash'); toast('已永久删除', '', 'warn'); }
            catch (er) { toast('删除失败', er.message, 'err'); }
          });
          return;
        }
        try {
          var r = await NasDeck.post('/api/bin/restore', { id: id });
          NasDeck.fillBIN(r.bin || []); rerender('trash');
          toast('已还原到原始位置', r.restoredTo || '', 'ok');
        } catch (er) { toast('还原失败', er.message, 'err'); }
      };
    });
    ACT['bin-refresh'] = async function () {
      toast('重新扫描本机回收站', 'WinNAS 引擎读取系统回收站中', 'info');
      try {
        var r = await NasDeck.post('/api/bin/refresh', {});
        if (r.bin && r.bin.length) NasDeck.fillBIN(r.bin);
        NasDeck.realBin = { total: r.total, usedText: r.usedText, source: r.source, loading: !!r.loading, truncated: r.truncated, roots: r.roots };
        rerender('trash');
        if (!r.loading) { toast('扫描完成', r.total + ' 个项目', 'ok'); return; }
        /* 条目多时首轮扫描会超过单次请求窗口，轮询到完成为止，期间不显示任何模拟数据 */
        var tries = 0;
        var poll = setInterval(async function () {
          if (++tries > 60) { clearInterval(poll); return; }
          try {
            var b = await NasDeck.get('/api/bin/list?limit=200');
            if (!b.loading) {
              clearInterval(poll);
              NasDeck.fillBIN(b.bin || []);
              NasDeck.realBin = { total: b.total, usedText: b.usedText, source: b.source, loading: false, truncated: b.truncated, roots: b.roots };
              rerender('trash'); toast('扫描完成', b.total + ' 个项目', 'ok');
            }
          } catch (er) { clearInterval(poll); }
        }, 3000);
      } catch (e) { toast('扫描失败', e.message, 'err'); }
    };

    /* 文件删除 → Windows 真实回收站，并如实回显采用的方式 */
    ACT['fs-delete'] = function () {
      var f = fsSelected();
      if (!f) { toast('请先选择项目', '', 'warn'); return; }
      var rec = W('filestation');
      askModal(rec, '送入 Windows 回收站',
        '「' + f.n + '」会从真实路径 ' + winPath(FS_STATE.path) + ' 移入本机回收站，可在资源回收站中还原。',
        null, async function () {
          try {
            var r = await NasDeck.post('/api/files/delete', { path: FS_STATE.path, name: f.n });
            NasDeck.applyFiles(r.files);
            NasDeck.fillBIN(r.trash || []);
            if (r.binInfo) NasDeck.realBin = r.binInfo;
            FS_STATE.sel = -1;
            toast('已送入 ' + (r.method || '回收站'), r.note || f.n, 'ok');
          } catch (e) { toast('删除失败', e.message, 'err'); }
        });
    };
    ACT['fs-prop'] = function () {
      var f = fsSelected();
      if (!f) { toast('请先选择项目', '', 'warn'); return; }
      var rec = W('filestation');
      infoModal(rec, '属性 · ' + f.n,
        '<div class="kv"><span class="k">名称</span><span class="v">' + RE(f.n) + '</span></div>' +
        '<div class="kv"><span class="k">真实路径</span><span class="v mono">' + RE(winPath(FS_STATE.path) + '\\' + f.n) + '</span></div>' +
        '<div class="kv"><span class="k">类型</span><span class="v">' + (f.drive ? '本地磁盘' : f.t === 'dir' ? '文件夹' : '文件') + '</span></div>' +
        '<div class="kv"><span class="k">大小 / 容量</span><span class="v">' + RE(f.drive ? f.desc : (f.t === 'dir' ? '文件夹' : fmtSize(f.sz || 0))) + '</span></div>' +
        '<div class="kv"><span class="k">修改日期</span><span class="v">' + RE(RNA(f.m)) + '</span></div>' +
        '<div class="kv"><span class="k">来源</span><span class="v">Windows 本机文件系统</span></div>');
    };

    /* 网卡真实操作 */
    ACT['win-adapter'] = async function (e, d) {
      var act = d.a, name = d.n;
      if (!name || name === '-') name = (((NasDeck.win || {}).adapters) || [])[0] || {};
      if (act === 'renew' || act === 'flushdns') {
        toast('正在执行', act === 'renew' ? 'ipconfig /release + /renew' : 'Clear-DnsClientCache', 'info');
      }
      try {
        var r = await NasDeck.post('/api/win/adapter', { act: act, name: (typeof name === 'string' ? name : name.n) });
        if (r.adapters) { NasDeck.win.adapters = r.adapters; }
        if (r.out) console.log('[win-adapter]', r.out);
        if (r.needAdmin || !r.ok) {
          toast('操作未生效', (r.needAdmin ? '需要管理员权限（请用 start.bat 提权）· ' : '') + (r.err || r.out || 'N/A').slice(0, 160), 'warn');
        } else {
          toast('网卡操作成功', act + ' · ' + (typeof name === 'string' ? name : name.n), 'ok');
        }
        if (W('network')) rerender('network');
      } catch (er) { toast('网卡操作失败', er.message, 'err'); }
    };
    ACT['win-adapter-dns'] = function (e, d) {
      var rec = W('network');
      askModal(rec, '设置 DNS · ' + d.n, '输入 IPv4 DNS，多个用逗号分隔（例如 8.8.8.8,1.1.1.1）',
        '8.8.8.8,1.1.1.1', async function (v) {
          if (!v) return;
          try {
            var r = await NasDeck.post('/api/win/adapter', { act: 'setdns', name: d.n, dns: v });
            if (r.adapters) NasDeck.win.adapters = r.adapters;
            toast(r.ok && !r.needAdmin ? 'DNS 已设置' : 'DNS 设置未生效',
              (r.needAdmin ? '需要管理员权限 · ' : '') + (r.err || r.out || '').slice(0, 140), r.ok ? 'ok' : 'warn');
            if (W('network')) rerender('network');
          } catch (er) { toast('DNS 设置失败', er.message, 'err'); }
        });
    };
ACT['win-adapter-refresh'] = async function () {
/* 走 snapshot 缓存（毫秒级），避免 /api/win/adapters 触发 15~20s 实时 CIM 重采 */
try {
var r = await NasDeck.get('/api/win/snapshot');
NasDeck.win.adapters = r.adapters || [];
if (r.storage) NasDeck.win.storage = r.storage;
rerender('network'); toast('网卡状态已刷新（真实数据）', '', 'ok');
} catch (er) { toast('刷新失败', er.message, 'err'); }
};

    /* Docker：一键发现并启动 / 仅探测 */
    async function wslReload() {
      try {
        var s = await NasDeck.get('/api/wsl/snapshot');
        NasDeck.wsl = Object.assign({}, NasDeck.wsl, s);
        if (W('container')) rerender('container');
      } catch (e) {}
    }
    ACT['wsl-discover'] = async function () {
      try {
        var d = await NasDeck.get('/api/wsl/discover');
        NasDeck.wslDiscover = d;
        toast(d.found ? '已发现真实 Docker Engine' : '未发现运行中的引擎', d.message, d.found ? 'ok' : 'warn');
        wslReload();
      } catch (e) { toast('探测失败', e.message, 'err'); }
    };
    ACT['wsl-autostart'] = async function () {
      toast('正在启动 WSL Docker 引擎', '自动发现 → 必要时拉起 dockerd → 复查', 'info');
      try {
        var r = await NasDeck.post('/api/wsl/autostart', {});
        NasDeck.wslDiscover = r.discovered || null;
        if (r.wsl) NasDeck.wsl = Object.assign({}, NasDeck.wsl, r.wsl);
        if (r.steps && r.steps.length) console.log('[wsl-autostart]', r.steps.join('\n'));
        toast(r.ok ? 'Docker 引擎已上线' : '引擎仍未上线（N/A）', r.message || 'N/A', r.ok ? 'ok' : 'warn');
        if (W('container')) rerender('container');
      } catch (e) { toast('启动失败', e.message, 'err'); }
    };

    /* ---------------- Docker / WSL 真实控制动作 ---------------- */
    /* 标签切换：只换一个展示页，不重新拉数据、不重启引擎 */
    ACT['dkr-tab'] = function (e, d) {
      var t = d && d.t;
      if (!t || !DKR_TABS.some(function (x) { return x[0] === t; })) return;
      DKR.tab = t;
      try { rerender('container'); } catch (er) {}
      /* 切到 WSL 标签时补一次真实发行版枚举：bootstrap 不一定带 distros，
         但 /api/wsl/distros 一定返回本机 wsl -l -v 的真实结果。 */
      if (t === 'wsl' && NasDeck.token && typeof NasDeck.get === 'function') {
        NasDeck.get('/api/wsl/distros').then(function (r) {
          if (!r || !r.distros) return;
          NasDeck.wslExtra = Object.assign({}, NasDeck.wslExtra || {}, { distros: r.distros, distrosSource: r.source });
          try { if (DKR.tab === 'wsl' && W('container')) rerender('container'); } catch (er) {}
        }).catch(function () {});
      }
    };
    ACT['dkr-start'] = async function () {
      DKR.busy = true; DKR.msg = '正在开启 WSL 常驻会话并拉起 dockerd（首次冷启动约 20–40 秒）…'; DKR.out = '';
      dkrSet({ msg: DKR.msg, busy: true });
      try {
        var r = await NasDeck.post('/api/wsl/keepalive', { on: true });
        DKR.ka = r; DKR.out = r.lastAction || '';
        toast('已下发启动命令', '后台正在唤醒 WSL / 启动 dockerd，状态会自动刷新', 'info');
        dkrPoll(75);
      } catch (e) { DKR.busy = false; dkrSet({ msg: '启动失败：' + e.message, out: '' }); toast('启动失败', e.message, 'err'); }
    };
    ACT['dkr-restart'] = async function () {
      DKR.busy = true; dkrSet({ msg: '正在重启 WSL 内 dockerd…', busy: true, out: '' });
      try {
        var r = await NasDeck.post('/api/wsl/engine/restart', {});
        NasDeck.wsl = Object.assign({}, NasDeck.wsl, r.wsl || {});
        DKR.ka = r.keepAlive || DKR.ka;
        dkrSet({ msg: r.message || '重启流程结束', out: (r.steps || []).join('\n') || r.out || '', busy: false });
        toast(r.ok ? '引擎已重启' : '重启未成功（N/A）', r.message || 'N/A', r.ok ? 'ok' : 'warn');
      } catch (e) { DKR.busy = false; dkrSet({ msg: '重启失败：' + e.message, busy: false }); toast('重启失败', e.message, 'err'); }
    };
    ACT['dkr-stop'] = async function () {
      try {
        var r = await NasDeck.post('/api/wsl/engine/stop', {});
        NasDeck.wsl = Object.assign({}, NasDeck.wsl, r.wsl || {});
        dkrSet({ msg: r.message || 'dockerd 已停止', out: r.out || '' });
        toast('已停止 dockerd', r.message || '', 'warn');
      } catch (e) { toast('停止失败', e.message, 'err'); }
    };
    ACT['dkr-keepoff'] = async function () {
      try {
        var r = await NasDeck.post('/api/wsl/keepalive', { on: false });
        DKR.ka = r; dkrSet({ msg: r.lastAction || '保活已关闭' });
        toast('已关闭 WSL 保活', 'WSL 空闲后可能自动休眠，届时引擎会掉线', 'warn');
      } catch (e) { toast('操作失败', e.message, 'err'); }
    };
    ACT['dkr-refresh'] = async function () {
      try {
        var r = await dkrForceRefresh();
        dkrSet({ msg: r.available ? ('引擎在线 · ' + RNA(r.version) + ' · 容器 ' + (r.containers || []).length) : (r.message || '引擎未运行（N/A）') });
        toast('已刷新真实数据', (r.containers || []).length + ' 个容器 / ' + (r.images || []).length + ' 个镜像', 'ok');
      } catch (e) { toast('刷新失败', e.message, 'err'); }
    };
    ACT['dkr-discover'] = async function () {
      try {
        var d = await NasDeck.get('/api/wsl/discover');
        NasDeck.wslDiscover = d;
        dkrSet({ msg: d.message || '端点探测结束', out: (d.tried || []).map(function (t) {
          return t.host + ':' + t.port + ' ' + (t.ok ? 'ONLINE ' + (t.version || '') : (t.error || '无响应'));
        }).join('\n') });
        toast(d.found ? '发现真实 Engine' : '未发现运行中的引擎', d.message, d.found ? 'ok' : 'warn');
      } catch (e) { toast('探测失败', e.message, 'err'); }
    };
    ACT['dkr-action'] = async function (e, d) {
      if (!d || !d.n) { toast('缺少容器 ID', '', 'warn'); return; }
      var isView = d.a === 'logs' || d.a === 'inspect' || d.a === 'stats';
      if (d.a === 'remove') {
        var rec = W('container');
        askModal(rec, '删除容器', '容器 ' + d.n + ' 将被强制移除（真实 Docker 操作，不可复原）。', null, async function () {
          try {
            var r = await NasDeck.post('/api/wsl/action', { id: d.n, act: 'remove' });
            await dkrForceRefresh();
            dkrSet({ msg: r.ok ? '容器已移除' : ('移除失败：' + (r.error || ('HTTP ' + (r.code || 'N/A')))), out: r.out || '' });
            toast(r.ok ? '容器已移除' : '移除失败', r.error || d.n, r.ok ? 'ok' : 'warn');
          } catch (er) { toast('删除失败', er.message, 'err'); }
        });
        return;
      }
      try {
        var r = await NasDeck.post('/api/wsl/action', { id: d.n, act: d.a });
        await dkrForceRefresh();
        /* 日志 / 检查类输出放在「端点探测 / 日志」标签：过去在「容器」
           标签点「日志」只把内容写进隐藏区，用户什么都看不到。 */
        if (isView) { try { if (NasDeck.v14) { NasDeck.v14.dkr.sel = d.n; NasDeck.v14.dkr.pane = (d.a === 'logs' ? 'logs' : 'stats'); } } catch (er) {} }
        var why = r.error ? (' · ' + r.error) : (!r.ok && r.code ? (' · HTTP ' + r.code) : '');
        dkrSet({
          msg: (r.ok ? '操作成功：' : '操作失败：') + d.a + ' ' + d.n + why,
          out: r.out || ''
        });
        toast(r.ok ? '容器操作成功' : '容器操作未生效',
          r.error || (d.a + ' ' + d.n), r.ok ? 'ok' : 'warn');
      } catch (er) { toast('容器操作失败', er.message, 'err'); }
    };
    ACT['dkr-distro'] = async function (e, d) {
      if (!d || !d.n) return;
      toast('正在操作 WSL 发行版', d.n + ' ' + d.a, 'info');
      try {
        var r = await NasDeck.post('/api/wsl/distro', { name: d.n, act: d.a });
        await dkrForceRefresh();
        dkrSet({ msg: d.n + ' ' + d.a + '：' + (r.ok ? '成功' : (r.error || '失败')), out: r.out || '' });
      } catch (er) { toast('WSL 操作失败', er.message, 'err'); }
    };
    ACT['dkr-exec'] = async function (e, d) {
      var cmd = (d && d.c) || 'docker ps -a';
      try {
        var r = await NasDeck.post('/api/wsl/exec', { cmd: cmd, distro: (d && d.n) || ((NasDeck.wsl || {}).endpoint || {}).distro || 'Debian', root: true });
        dkrSet({ out: '$ ' + cmd + '\n' + (r.out || r.err || 'N/A'), msg: r.ok ? '命令已在真实 WSL 内执行' : ('命令执行失败：' + (r.err || 'N/A')) });
      } catch (er) { toast('WSL 命令失败', er.message, 'err'); }
    };
    ACT['dkr-pull'] = function () {
      askModal(W('container'), '拉取镜像', '输入真实镜像名（需要网络），例如 alpine:latest', 'alpine:latest', async function (v) {
        if (!v) return;
        dkrSet({ msg: '正在拉取镜像 ' + v + '…', out: '', busy: true });
        try { var r = await NasDeck.post('/api/wsl/pull', { image: v }); await dkrForceRefresh(); dkrSet({ msg: r.ok ? ('镜像拉取完成：' + v) : ('拉取失败：' + (r.error || 'N/A')), out: r.out || '', busy: false }); }
        catch (er) { dkrSet({ msg: '拉取失败：' + er.message, busy: false }); }
      });
    };
    ACT['dkr-create'] = function () { cOpen(); };
    ACT['dkr-run'] = function (e, d) { cOpen(d && d.n); };
    /* ---------------- 建立容器设置窗口的动作 ---------------- */
    ACT['dkr-c-close'] = function () { cClose(); };
    ACT['dkr-c-tab'] = function (e, d) {
      cCollect();
      if (!d || !d.t) return;
      DKR.c.tab = d.t;
      cPaint();
    };
    ACT['dkr-c-preview'] = function () { cCollect(); DKR.c.preview = !DKR.c.preview; cPaint(); };
    ACT['dkr-c-meta'] = function () { cCollect(); cLoadMeta(false); };
    ACT['dkr-c-import'] = function () {
      cCollect();
      if (!DKR.c.meta) { toast('请先读取镜像元数据', '', 'warn'); return; }
      cApplyMeta();
      cPaint();
      toast('已导入镜像元数据', '端口 / 环境变量 / 卷已填入表单，可继续修改', 'ok');
    };
    ACT['dkr-c-addrow'] = function (e, d) {
      cCollect();
      var g = d && d.g;
      if (!g || !DKR.c[g]) return;
      if (g === 'ports') DKR.c.ports.push({ hostIp: '', host: '', container: '', proto: 'tcp' });
      if (g === 'env') DKR.c.env.push({ k: '', v: '' });
      if (g === 'mounts') DKR.c.mounts.push({ source: '', target: '', type: 'bind', ro: false });
      cPaint();
    };
    ACT['dkr-c-delrow'] = function (e, d) {
      cCollect();
      var g = d && d.g, i = +((d || {}).i);
      if (!g || !DKR.c[g] || isNaN(i)) return;
      DKR.c[g].splice(i, 1);
      cPaint();
    };
    ACT['dkr-c-submit'] = async function (e, d) {
      cCollect();
      var startIt = !(d && d.start === '0');
      var p = cPayload(startIt);
      if (!p.image) { DKR.c.result = '请填写镜像名'; DKR.c.resultOk = false; cPaint(); return; }
      if (p.memoryMb && p.memorySwapMb && p.memorySwapMb < p.memoryMb) {
        DKR.c.result = '内存 + Swap 必须大于或等于内存上限'; DKR.c.resultOk = false; cPaint(); return;
      }
      DKR.c.busy = true;
      DKR.c.result = '正在向真实 Docker Engine 提交创建请求…';
      DKR.c.resultOk = false;
      cPaint();
      try {
        var r = await NasDeck.post('/api/wsl/create', p);
        DKR.c.busy = false;
        DKR.c.result = r.ok
          ? ('创建成功 · 容器 ' + (r.id || '') + (r.started ? ' 已启动' : '（仅创建，未启动）'))
          : ('失败：' + (r.error || 'N/A') + (r.created ? (' · 容器已创建 ' + (r.id || '')) : ''));
        DKR.c.resultOk = !!r.ok;
        cPaint();
        toast(r.ok ? '容器已建立' : '容器创建未成功', r.error || (r.id || ''), r.ok ? 'ok' : 'warn');
        await dkrForceRefresh();
        DKR.tab = 'containers';
        try { if (W('container')) rerender('container'); } catch (er) {}
      } catch (er) {
        DKR.c.busy = false;
        DKR.c.result = '请求失败：' + er.message;
        DKR.c.resultOk = false;
        cPaint();
        toast('容器创建失败', er.message, 'err');
      }
    };
    ACT['dkr-clear'] = function () { DKR.out = ''; DKR.msg = '（已清空）'; dkrSet({ msg: DKR.msg, out: '' }); };
    /* ---------------- 插件中心动作 ---------------- */
    ACT['plg-tab'] = function (e, d) {
      plgSaveInputs();
      if (!d || !d.t || !PLG_TABS.some(function (x) { return x[0] === d.t; })) return;
      PLG.tab = d.t;
      try { rerender('appcenter'); } catch (er) {}
    };
    ACT['plg-refresh'] = function () { plgSaveInputs(); plgLoad(false); };
    ACT['plg-search'] = function () { plgSaveInputs(); try { rerender('appcenter'); } catch (e) {} };
    ACT['plg-open'] = function (e, d) {
      if (!d || !d.id) return;
      try { openApp(d.id); }
      catch (er) { plgToast('打开失败', '该功能没有对应窗口：' + d.id, 'warn'); }
    };
    ACT['plg-file'] = function () {
      plgSaveInputs();
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.js,text/javascript'; inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        if (!f) { inp.remove(); return; }
        var rd = new FileReader();
        rd.onload = function () {
          PLG.upName = String(f.name || 'my-plugin.js').replace(/[^A-Za-z0-9_.\-]/g, '-');
          PLG.upCode = String(rd.result || '');
          PLG.msg = '已选择本地文件 ' + PLG.upName + '（' + PLG.upCode.length + ' 字符）';
          try { rerender('appcenter'); } catch (e) {}
          inp.remove();
        };
        rd.onerror = function () { plgToast('读取文件失败', '', 'err'); inp.remove(); };
        rd.readAsText(f, 'utf-8');
      });
      inp.click();
    };
    ACT['plg-template'] = function () {
      plgSaveInputs();
      if (!PLG.template) { plgToast('模板尚未就绪', '请先点「刷新列表」', 'warn'); return; }
      PLG.upName = 'my-plugin.js'; PLG.upCode = PLG.template;
      PLG.msg = '已填入官方插件模板，可修改后上传';
      try { rerender('appcenter'); } catch (e) {}
    };
    ACT['plg-download'] = function () {
      plgSaveInputs();
      if (!PLG.template) { plgToast('模板尚未就绪', '请先点「刷新列表」', 'warn'); return; }
      try {
        var b = new Blob([PLG.template], { type: 'text/javascript;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = 'my-plugin.js';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
        PLG.msg = '模板已下载为 my-plugin.js';
      } catch (e) { plgToast('下载失败', e.message, 'err'); }
    };
    ACT['plg-upload'] = async function () {
      plgSaveInputs();
      var name = String(PLG.upName || '').trim() || 'my-plugin.js';
      var code = String(PLG.upCode || '');
      if (!code) { plgToast('请先选择文件或粘贴插件代码', '', 'warn'); return; }
      if (!/\.js$/i.test(name)) name += '.js';
      PLG.busy = true; PLG.msg = '正在上传 ' + name + '…';
      try { rerender('appcenter'); } catch (e) {}
      try {
        var r = await NasDeck.post('/api/plugins/upload', { filename: name, content: code });
        PLG.msg = '上传成功：' + (r.id || name) + '（' + (r.size || 0) + ' bytes）';
        PLG.upCode = ''; PLG.tab = 'uploaded';
        plgToast('插件已上传', PLG.msg, 'ok');
      } catch (e) {
        PLG.msg = '上传失败：' + e.message;
        plgToast('上传失败', e.message, 'err');
      }
      PLG.busy = false;
      await plgLoad(true);
      PLG.tab = 'uploaded';
      try { rerender('appcenter'); } catch (e) {}
    };
    ACT['plg-toggle'] = async function (e, d) {
      if (!d || !d.id) return;
      try {
        var r = await NasDeck.post('/api/plugins/toggle', { id: d.id, enabled: d.v !== '0' });
        PLG.msg = (r.enabled ? '已启用 ' : '已停用 ') + d.id;
        plgToast(PLG.msg, '', 'ok');
      } catch (er) { plgToast('操作失败', er.message, 'err'); }
      await plgLoad(true);
    };
    ACT['plg-remove'] = function (e, d) {
      if (!d || !d.id) return;
      var rec = W('appcenter');
      askModal(rec, '删除插件',
        '插件 ' + d.id + '.js 将从本机插件目录真实删除（内置功能不受影响）。', null,
        async function () {
          try {
            await NasDeck.post('/api/plugins/remove', { id: d.id });
            PLG.msg = '已删除插件 ' + d.id;
            plgToast('插件已删除', d.id, 'ok');
          } catch (er) { plgToast('删除失败', er.message, 'err'); }
          await plgLoad(true);
        });
    };
    ACT['plg-view'] = async function (e, d) {
      if (!d || !d.id) return;
      try {
        var r = await NasDeck.get('/api/plugins/content?id=' + encodeURIComponent(d.id));
        plgWindow(d.id, '源码 · ' + d.id,
          '<pre class="mono" style="white-space:pre-wrap;font-size:11.5px;line-height:1.55;margin:0">' +
          RE(r.code || '') + '</pre>', null);
      } catch (er) { plgToast('读取源码失败', er.message, 'err'); }
    };
    ACT['plg-run'] = async function (e, d) {
      if (!d || !d.id) return;
      try {
        var r = await NasDeck.get('/api/plugins/content?id=' + encodeURIComponent(d.id));
        plgRun(d.id, r.code || '');
      } catch (er) { plgToast('运行失败', er.message, 'err'); }
    };
    ACT['plg-close'] = function () {
      var m = document.getElementById('nasdeck-plg-mask');
      if (m) m.remove();
    };

  }

  /* ------------------------------------------------------------------
   * 5) 安装：包装 install / hydrate，覆盖渲染与动作
   * ---------------------------------------------------------------- */
  function installRealLayer() {
    var origInstall = NasDeck.install;
    NasDeck.install = function () {
      var r = origInstall.apply(this, arguments);
      /* NasDeck_WIN_INSTALL 已在 origInstall 内执行完，这里覆盖其渲染结果 */
      try {
        wrapHydrate();
        RENDER.trash = renderTrash;
        RENDER.filestation = renderFileStation;
        var _net = RENDER.network;
        RENDER.network = function () {
          var h = _net.apply(this, arguments);
          return injectAfterScroll(h, adapterBlock());
        };
        /* 容器工作台 彻底重做：一个窗口、一组标签、一个当前页。
           不再调用 windows 层的 hero + 统计卡 + 旧标签，也不再用
           injectAfterScroll 把整块真实控制台塞进旧页面 —— 那三层叠加
           正是「内容太乱」的根源。 */
        RENDER.container = dockerBlock;
        RENDER.appcenter = pluginCenter;
        RENDER.photodeck = renderPhotoDeckV13;
        RENDER.music = renderMusicV13;
        RENDER.video = renderVideoV13;
        applyActions();
        installMediaActions();
        /* 面板打开时定期同步真实状态；只有在线状态 / 容器数变化才重绘，
           否则每 6 秒重绘会把用户正在看的滚动位置和弹窗冲掉。 */
        if (!window.__NasDeck_DKR_TIMER__) {
          window.__NasDeck_DKR_TIMER__ = setInterval(async function () {
            try {
              if (!NasDeck.token || !W('container') || DKR.busy) return;
              const [ka, snap] = await Promise.all([NasDeck.get('/api/wsl/keepalive'), NasDeck.get('/api/wsl/snapshot')]);
              const changed = !DKR.ka || DKR.ka.online !== ka.online || DKR.ka.on !== ka.on ||
                ((NasDeck.wsl || {}).available !== snap.available) ||
                (((NasDeck.wsl || {}).containers || []).length !== (snap.containers || []).length);
              DKR.ka = ka; NasDeck.wsl = Object.assign({}, NasDeck.wsl || {}, snap);
              NasDeck.fill(CONTAINERS, snap.containers || []);
              if (changed) rerender('container');
            } catch (e) { /* 静默：状态同步失败不影响界面 */ }
          }, 6000);
        }
        window.__NasDeck_REAL__ = { refreshBin: refreshBin, winPath: winPath, dkrStatus: dkrFetchStatus };
      } catch (e) { console.error('[NasDeck_REAL]', e); }
      return r;
    };
  }
  function wrapHydrate() {
    if (NasDeck.__realHydrateWrapped) return;
    var orig = NasDeck.hydrate;
    NasDeck.hydrate = function (b) {
      orig.call(this, b);
      NasDeck.realBin = b.binInfo || { total: (b.bin || []).length, usedText: NA, source: NA, loading: false };
      /* realRoot 含真实 total/free/pct，drives 只有盘符字符串，优先用前者 */
      NasDeck.realDrives = (b.realRoot && b.realRoot.length ? b.realRoot : b.drives) || [];
      NasDeck.realFsTree = b.fsTree || [];
      NasDeck.recycleStatus = b.recycleStatus || null;
      NasDeck.wslDiscover = (b.wsl || {}).discover || null;
      /* 登录后主动跑一次「只读」真实端点探测，让 容器工作台 一打开
         就有每个端点的实测结果，而不是停在"尚未执行端点探测"。
         不启动引擎、不修改系统，失败静默保持 N/A。 */
      if (NasDeck.token && typeof NasDeck.get === 'function') {
        NasDeck.get('/api/wsl/discover').then(function (d) {
          NasDeck.wslDiscover = d || null;
          try {
            if (typeof W === 'function' && W('container') && typeof rerender === 'function') rerender('container');
          } catch (e) {}
        }).catch(function () {});
        NasDeck.get('/api/wsl/keepalive').then(function (ka) {
          DKR.ka = ka || null;
          try { if (typeof W === 'function' && W('container')) rerender('container'); } catch (e) {}
        }).catch(function () {});
      }
      refreshBin(true);
    };
    NasDeck.__realHydrateWrapped = true;
  }

  wrapHydrate();
  installRealLayer();

  /* 顶层接管 + 守卫：多层 NasDeck.install 的包装时序可能让 windows 层的旧
     Container 界面（hero + 4 标签 + 演示数据）短暂回归 —— 后端水合较慢时
     用户先打开窗口就会看到旧界面，直到某个动作触发重绘。
     这里页面加载即接管，并持续保证 RENDER.container 是多标签页版本；
     一旦发现被覆盖，立刻改回并重绘已打开的窗口。 */
  function enforceContainer() {
    try {
      /* 界面提前可用时，动作也必须同时可用：applyActions 全是幂等的
         ACT[...] 赋值，提前调用不会覆盖其它层、也不会触发任何请求。 */
      if (typeof ACT === 'object' && ACT && typeof ACT['dkr-tab'] !== 'function') applyActions();
    } catch (e) {}
    try {
      if (typeof RENDER !== 'object' || !RENDER) return;
      if (RENDER.container !== dockerBlock) {
        RENDER.container = dockerBlock;
        try {
          if (typeof W === 'function' && W('container') && typeof rerender === 'function') rerender('container');
        } catch (e) {}
      }
    } catch (e) {}
  }
  function enforcePlugins() {
    try {
      if (typeof ACT === 'object' && ACT && typeof ACT['plg-tab'] !== 'function') applyActions();
    } catch (e) {}
    try {
      if (typeof RENDER === 'object' && RENDER && RENDER.appcenter !== pluginCenter) {
        RENDER.appcenter = pluginCenter;
        try {
          if (typeof W === 'function' && W('appcenter') && typeof rerender === 'function') rerender('appcenter');
        } catch (e) {}
      }
    } catch (e) {}
    /* 只在已登录后发首次请求，避免页面加载阶段出现 401 */
    try {
      if (NasDeck && NasDeck.token && !PLG.loaded && !PLG.loading) {
        PLG.loading = true;
        plgLoad(true).catch(function () {}).then(function () { PLG.loading = false; });
      }
    } catch (e) {}
  }
  function enforceAll() { enforceContainer(); enforcePlugins();
    enforceMedia();
    enforceV14();
  }
//__NasDeck_V13_MEDIA_START__
  /* ==================================================================
   * v13 需求 5：PhotoDeck / MusicDeck / VideoDeck
   *   · 各自可以选择媒体文件夹（逐级浏览本机真实目录，可添加 / 移除多个）
   *   · 选定后读取该文件夹里的媒体文件 + 真实元数据 / 封面 / 字幕 / 歌词
   *   · 读不到一律 N/A，不使用假 SVG / 假时长 / 假艺术家
   * ================================================================== */
  var MED_KINDS = {
    photodeck: { kind: 'photo', key: 'photos', title: 'PhotoDeck', icon: 'image', label: '照片' },
    music: { kind: 'music', key: 'songs', title: 'MusicDeck', icon: 'music', label: '音乐' },
    video: { kind: 'video', key: 'movies', title: 'VideoDeck', icon: 'film', label: '影片' }
  };
  var MED = {
    loaded: false, loading: false, seq: 0, error: '',
    browseSeq: 0, browseLoading: false,
    data: { photos: [], songs: [], movies: [], rootsByKind: {}, roots: [], stats: {} },
    tab: {}, q: {}, browse: { path: '__root__', dirs: [], parent: null, label: '此电脑', mediaCount: 0, error: '' }
  };
  NasDeck.mediaV13 = MED;
  function medCfg(id) { return MED_KINDS[id] || MED_KINDS.photodeck; }
  function medItems(id) { return MED.data[medCfg(id).key] || []; }
  function medRoots(id) { return (MED.data.rootsByKind || {})[medCfg(id).kind] || []; }
  function medErr(e) { toast('媒体库操作失败', e && e.message ? e.message : String(e), 'err'); }
  function medUrl(u) { try { return NasDeck.withToken(u); } catch (e) { return u; } }
  function medLoad() {
    if (!NasDeck.token) return Promise.resolve();
    var my = ++MED.seq;
    MED.loading = true;
    return NasDeck.get('/api/media/scan').then(function (r) {
      if (my !== MED.seq) return;
      MED.loading = false; MED.loaded = true; MED.error = '';
      MED.data = r || MED.data;
      Object.keys(MED_KINDS).forEach(function (id) {
        try { if (typeof W === 'function' && W(id) && typeof rerender === 'function') rerender(id); } catch (e) {}
      });
      return r;
    }).catch(function (e) {
      if (my !== MED.seq) return;
      MED.loading = false; MED.error = e.message || String(e);
    });
  }
  function medBrowse(p) {
    /* 请求序号守卫：快速连续点击目录树时，先发的慢响应不得覆盖后选中的目录 */
    var my = ++MED.browseSeq;
    MED.browseLoading = true;
    return NasDeck.get('/api/media/browse?path=' + encodeURIComponent(p || '__root__')).then(function (r) {
      if (my !== MED.browseSeq) return r;
      MED.browseLoading = false;
      MED.browse = r && r.error ? { path: p, dirs: [], parent: '__root__', label: p, mediaCount: 0, error: r.error } : r;
      Object.keys(MED_KINDS).forEach(function (id) {
        try { if (typeof W === 'function' && W(id) && typeof rerender === 'function') rerender(id); } catch (e) {}
      });
      return r;
    }).catch(function (e) {
      if (my !== MED.browseSeq) return;
      MED.browseLoading = false; medErr(e);
    });
  }
  function medSetRoots(id, roots) {
    var cfg = medCfg(id);
    MED.loading = true;
    /* 作废所有在途 scan 响应，避免旧快照把刚设置的新根目录覆盖回去 */
    MED.seq++;
    return NasDeck.post('/api/media/roots', { kind: cfg.kind, roots: roots }).then(function (r) {
      MED.loading = false;
      if (r && r.scan) MED.data = r.scan;
      toast('媒体文件夹已更新', cfg.title + ' · 当前 ' + roots.length + ' 个目录，已重新扫描真实文件', 'ok');
      return medLoad();
    }).catch(function (e) { MED.loading = false; medErr(e); });
  }
  function medDetail(id, p) {
    var cfg = medCfg(id);
    NasDeck.get('/api/media/detail?path=' + encodeURIComponent(p)).then(function (r) {
      if (!r || !r.ok) { toast('无法读取元数据', (r && r.error) || 'N/A', 'warn'); return; }
      var it = r.item || {}, tx = r.text || {};
      var cover = it.cover ? '<div style="text-align:center;margin-bottom:12px"><img src="' + RE(medUrl(it.cover.url)) +
        '" style="max-width:100%;max-height:230px;border-radius:9px;object-fit:contain"><div class="dim" style="font-size:10px;margin-top:4px">' +
        RE(it.cover.source || '封面') + '</div></div>' : '';
      var meta = Object.keys(it.meta || {}).map(function (k) {
        return '<div class="kv"><span class="k">' + RE(k) + '</span><span class="v">' + RE(it.meta[k]) + '</span></div>';
      }).join('');
      var player = '';
      if (cfg.kind === 'music') {
        player = '<audio controls style="width:100%;margin:10px 0" src="' + RE(medUrl(it.url)) + '"></audio>';
      } else if (cfg.kind === 'video') {
        var track = (it.subtitles || []).filter(function (s) { return /\.vtt$/i.test(s.n); })[0];
        player = '<video controls style="width:100%;max-height:300px;background:#000;margin:10px 0" src="' + RE(medUrl(it.url)) + '">' +
          (track ? '<track kind="subtitles" src="' + RE(medUrl(track.url)) + '" srclang="zh" label="' + RE(track.n) + '" default>' : '') + '</video>';
      } else {
        player = '<div style="text-align:center;margin:10px 0"><img src="' + RE(medUrl(it.url)) +
          '" style="max-width:100%;max-height:300px;border-radius:9px"></div>';
      }
      var subs = (it.subtitles || []).map(function (s) {
        return '<a class="btn sm" target="_blank" href="' + RE(medUrl(s.url)) + '">' + glyph('download', 12) + ' ' + RE(s.n) + '</a>';
      }).join(' ');
      var extra = '';
      if (tx.lyrics) extra += '<div class="section-title" style="margin-top:12px">歌词 · ' + RE(it.lyricsSource || '内嵌') +
        '</div><pre style="max-height:180px;overflow:auto;white-space:pre-wrap;font-size:11px;background:rgba(127,127,127,.08);padding:10px;border-radius:8px">' + RE(tx.lyrics) + '</pre>';
      if (tx.subtitle) extra += '<div class="section-title" style="margin-top:12px">字幕正文 · ' +
        RE(((it.subtitles || [])[0] || {}).n || '') + '</div><pre style="max-height:150px;overflow:auto;white-space:pre-wrap;font-size:10.5px;background:rgba(127,127,127,.08);padding:10px;border-radius:8px">' + RE(tx.subtitle) + '</pre>';
      if (subs) extra += '<div style="margin-top:10px">' + subs + '</div>';
      var html = cover + player +
        '<div class="kv"><span class="k">真实路径</span><span class="v mono">' + RE(it.path) + '</span></div>' +
        '<div class="kv"><span class="k">大小</span><span class="v">' + RE(it.szText) + '</span></div>' +
        '<div class="kv"><span class="k">修改日期</span><span class="v">' + RE(it.d) + '</span></div>' + meta + extra;
      infoModal((typeof W === 'function' && W(id)) || document.body,
        cfg.title + ' · 媒体详情', html);
    }).catch(medErr);
  }

  function medCard(id, it, i) {
    var cfg = medCfg(id);
    var art = '';
    if (cfg.kind === 'photo') {
      art = '<img src="' + RE(medUrl(it.url)) + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" alt="' + RE(it.n) + '">';
    } else if (it.cover) {
      art = '<img src="' + RE(medUrl(it.cover.url)) + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" alt="' + RE(it.n) + '">';
    } else {
      art = '<div style="width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(140deg,#1b3550,#2b5570);color:#bcd7ea;font-size:11px;padding:8px;text-align:center;word-break:break-all">' +
        RE(cfg.label) + ' · 无封面 (N/A)</div>';
    }
    var badges = '';
    if (cfg.kind === 'music') {
      if (it.lyrics || it.lyricsUrl) badges += '<span class="badge info">歌词</span>';
      if (it.cover) badges += '<span class="badge">封面</span>';
      if (it.meta && it.meta['标签来源'] === 'ID3 标签') badges += '<span class="badge">ID3</span>';
    } else if (cfg.kind === 'video') {
      if ((it.subtitles || []).length) badges += '<span class="badge info">字幕 ' + it.subtitles.length + '</span>';
      if (it.cover) badges += '<span class="badge">封面</span>';
    } else {
      if (it.camera || it.dateTaken) badges += '<span class="badge info">EXIF</span>';
    }
    var sub = cfg.kind === 'photo'
      ? (it.width && it.height ? it.width + ' × ' + it.height : RE(it.szText)) + ' · ' + RE(it.d)
      : cfg.kind === 'music'
        ? RE(it.artist || 'N/A') + ' · ' + RE(it.album || 'N/A') + ' · ' + RE(it.durText)
        : RE(it.year || 'N/A') + ' · ' + RE(it.genre || 'N/A') + ' · ' + RE(it.durText);
    return '<div class="card" style="padding:0;overflow:hidden;cursor:pointer" data-act="med-detail" data-app="' + id + '" data-p="' + RE(it.path) + '">' +
      '<div style="height:118px;background:#0f2233">' + art + '</div>' +
      '<div style="padding:9px 10px"><b style="font-size:11.5px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + RE(it.n) + '">' +
      RE(it.title || it.n) + '</b><div class="dim" style="font-size:10px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + sub + '</div>' +
      '<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">' + badges + '</div></div></div>';
  }

  function medFolderPane(id) {
    var cfg = medCfg(id), b = MED.browse || {}, roots = medRoots(id);
    var rootRows = roots.length ? roots.map(function (p) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line);font-size:11px">' +
        glyph('folder', 13, 'var(--accent)') + '<span class="mono" style="flex:1;word-break:break-all">' + RE(p) + '</span>' +
        '<button class="btn sm danger" data-act="med-remove-root" data-app="' + id + '" data-p="' + RE(p) + '">移除</button></div>';
    }).join('') : '<div class="dim" style="padding:14px;font-size:11px">尚未选择媒体文件夹，请在下方浏览本机目录并添加。</div>';
    var dirs = (b.dirs || []).map(function (d) {
      return '<button class="btn sm" style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:5px;text-align:left" ' +
        'data-act="med-browse" data-p="' + RE(d.p) + '">' + glyph('folder', 12) + ' <span style="flex:1;margin-left:6px">' + RE(d.n) + '</span>' +
        '<span class="dim">›</span></button>';
    }).join('') || '<div class="dim" style="font-size:11px;padding:8px">此目录没有可进入的子文件夹</div>';
    var st = (MED.data.stats || {})[cfg.kind] || {};
    var statRow = '<div class="grid g4" style="margin-top:10px">' +
      Object.keys(st).map(function (k) {
        var names = { items: '媒体文件', covers: '封面', exif: 'EXIF 元数据', id3: 'ID3 标签', lyrics: '歌词', subtitles: '字幕', duration: '真实时长' };
        return '<div class="tile"><span class="t">' + RE(names[k] || k) + '</span><span class="v">' + RE(st[k]) + '</span></div>';
      }).join('') + '</div>';
    return '<div class="app-scroll" style="padding:12px 14px">' +
      RCARD('已选媒体文件夹 · ' + cfg.title,
        '<div class="card" style="padding:0">' + rootRows + '</div>' +
        '<p class="desc" style="margin-top:8px">选择后立刻重新扫描该文件夹：读取媒体文件本身、EXIF / ID3 / MP4 元数据、内嵌或同目录封面、同名字幕与歌词。所有内容来自 Windows 本机磁盘。</p>' + statRow,
        RBT('med-refresh', '重新扫描', 'data-app="' + id + '"', '', 'refresh')) +
      '<div class="card" style="margin-top:12px"><div class="section-title">' + glyph('folder', 14) + '浏览本机目录 · 选择文件夹</div>' +
      '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:9px">' +
      RBT('med-browse', '此电脑', 'data-p="__root__"', '', 'home') +
      (b.parent ? RBT('med-browse', '上一级', 'data-p="' + RE(b.parent) + '"', '', 'back') : '') +
      '<span class="mono dim" style="font-size:10.5px;word-break:break-all;flex:1">' + RE(b.label || b.path || '此电脑') + '</span>' +
      '<span class="badge info">本目录媒体文件 ' + RE(b.mediaCount || 0) + '</span>' +
      RBT('med-add-folder', '添加当前文件夹', 'data-app="' + id + '"', 'primary', 'link') + '</div>' +
      (b.error ? '<div class="desc" style="color:var(--warn)">' + RE(b.error) + '</div>' : '') +
      '<div style="max-height:230px;overflow:auto;padding-right:4px">' + dirs + '</div></div>' +
      (MED.error ? '<div class="card" style="border-color:var(--warn);margin-top:12px"><p class="desc">扫描状态：' + RE(MED.error) + '</p></div>' : '') +
      '</div>';
  }

  function mediaApp(id) {
    var cfg = medCfg(id), tab = MED.tab[id] || 'library';
    var list = medItems(id), q = String(MED.q[id] || '').trim().toLowerCase();
    if (q) list = list.filter(function (x) {
      return [x.n, x.title, x.artist, x.album, x.pl].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var stats = (MED.data.stats || {})[cfg.kind] || {};
    var tabs = '<div class="tabs">' +
      '<button class="' + (tab === 'library' ? 'on' : '') + '" data-act="med-tab" data-app="' + id + '" data-t="library">' + glyph(cfg.icon, 13) + ' 媒体库</button>' +
      '<button class="' + (tab === 'folders' ? 'on' : '') + '" data-act="med-tab" data-app="' + id + '" data-t="folders">' + glyph('folder', 13) + ' 选择媒体文件夹</button></div>';
    var bar = '<div class="toolbar">' +
      '<span class="muted" style="font-size:11px">' + RE(list.length) + ' / ' + RE(medItems(id).length) + ' 个' + cfg.label +
      ' · ' + RE(medRoots(id).length) + ' 个媒体文件夹</span>' +
      '<span class="badge info">封面 ' + RE(stats.covers === undefined ? 'N/A' : stats.covers) + '</span>' +
      (cfg.kind === 'video' ? '<span class="badge info">字幕 ' + RE(stats.subtitles === undefined ? 'N/A' : stats.subtitles) + '</span>' : '') +
      (cfg.kind === 'music' ? '<span class="badge info">歌词 ' + RE(stats.lyrics === undefined ? 'N/A' : stats.lyrics) + '</span>' : '') +
      (cfg.kind === 'photo' ? '<span class="badge info">EXIF ' + RE(stats.exif === undefined ? 'N/A' : stats.exif) + '</span>' : '') +
      '<div class="sp"></div>' +
      RBT('med-tab', '选择文件夹', 'data-app="' + id + '" data-t="folders"', '', 'folder') +
      RBT('med-refresh', '重新扫描', 'data-app="' + id + '"', '', 'refresh') +
      '<div class="inp" style="display:flex;align-items:center;gap:7px;width:170px;padding:0 9px">' + glyph('search', 13, 'var(--muted)') +
      '<input id="med-q" data-app="' + id + '" style="flex:1;background:none;border:0;font-size:11px;min-width:0" placeholder="筛选" value="' + RE(MED.q[id] || '') + '"></div></div>';
    var body;
    if (tab === 'folders') body = medFolderPane(id);
    else body = '<div class="app-scroll" style="padding:12px 14px">' +
      (list.length ? '<div class="grid g4">' + list.map(function (it, i) { return medCard(id, it, i); }).join('') + '</div>'
        : '<div class="empty">' + glyph('folderopen', 40) + (MED.loading ? '正在扫描真实媒体文件夹…' : '所选文件夹内没有' + cfg.label + '文件') + '</div>') +
      '<p class="desc" style="margin-top:12px;font-size:10.5px">点任意卡片查看完整元数据 / 封面 / 字幕 / 歌词并播放真实文件。' +
      '元数据由本机解析：JPEG EXIF、PNG IHDR、ID3v1/v2（含 APIC 内嵌封面与 USLT 歌词）、MP4 mvhd 时长、同名 SRT/ASS/VTT 字幕、LRC 歌词与目录封面。</p></div>';
    return '<div class="app">' + tabs + bar + body + '</div>';
  }
  function renderPhotoDeckV13() { return mediaApp('photodeck'); }
  function renderMusicV13() { return mediaApp('music'); }
  function renderVideoV13() { return mediaApp('video'); }

  function installMediaActions() {
    ACT['med-tab'] = function (e, d) {
      var id = (d && d.app) || 'photodeck';
      MED.tab[id] = (d && d.t === 'folders') ? 'folders' : 'library';
      if (MED.tab[id] === 'folders' && !MED.browse.dirs.length) medBrowse(MED.browse.path || '__root__');
      rerender(id);
    };
    ACT['med-refresh'] = function (e, d) {
      var id = (d && d.app) || 'photodeck';
      medLoad(); toast('正在重新扫描', medCfg(id).title + ' · 读取所选文件夹的真实媒体文件', 'info');
    };
    ACT['med-browse'] = function (e, d) { medBrowse((d && d.p) || '__root__'); };
    ACT['med-add-folder'] = function (e, d) {
      var id = (d && d.app) || 'photodeck', p = MED.browse && MED.browse.path;
      if (MED.browseLoading) { toast('正在读取目录', '请等目录加载完成后再添加', 'warn'); return; }
      if (!p || p === '__root__') { toast('请先进入一个具体文件夹', '「此电脑」是盘符列表，不能直接作为媒体目录', 'warn'); return; }
      var roots = medRoots(id).slice();
      if (roots.some(function (x) { return x.toLowerCase() === String(p).toLowerCase(); })) {
        toast('该文件夹已在媒体库中', p, 'warn'); return;
      }
      roots.push(p);
      medSetRoots(id, roots);
    };
    ACT['med-remove-root'] = function (e, d) {
      var id = (d && d.app) || 'photodeck', p = d && d.p;
      var roots = medRoots(id).filter(function (x) { return x !== p; });
      medSetRoots(id, roots);
    };
    ACT['med-detail'] = function (e, d) {
      var id = (d && d.app) || 'photodeck', p = d && d.p;
      if (p) medDetail(id, p);
    };
    if (!window.__NasDeck_V13_MED_INPUT__) {
      window.__NasDeck_V13_MED_INPUT__ = true;
      document.addEventListener('input', function (e) {
        if (!e.target || e.target.id !== 'med-q') return;
        var id = e.target.dataset.app || 'photodeck', v = e.target.value;
        MED.q[id] = v;
        clearTimeout(MED.qt);
        MED.qt = setTimeout(function () {
          rerender(id);
          var el = document.getElementById('med-q');
          if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (x) {} }
        }, 220);
      });
    }
  }
  function enforceMedia() {
    try {
      if (typeof ACT === 'object' && ACT && typeof ACT['med-tab'] !== 'function') installMediaActions();
    } catch (e) {}
    try {
      if (typeof RENDER !== 'object' || !RENDER) return;
      var map = { photodeck: renderPhotoDeckV14, music: renderMusicV14, video: renderVideoV14 };
      Object.keys(map).forEach(function (id) {
        if (RENDER[id] !== map[id]) {
          RENDER[id] = map[id];
          try { if (typeof W === 'function' && W(id) && typeof rerender === 'function') rerender(id); } catch (e) {}
        }
      });
    } catch (e) {}
    /* 只在登录后首次拉真实数据，避免页面加载阶段 401 */
    try {
      if (NasDeck && NasDeck.token && !MED.loaded && !MED.loading) {
        MED.loading = true;
        medLoad().catch(function () {}).then(function () { MED.loading = false; });
      }
    } catch (e) {}
  }
//__NasDeck_V13_MEDIA_END__
//__NasDeck_V14_UI_START__
  /* ==================================================================
   * v14 前端增强（七项需求）
   *  1 媒体文件不再弹小窗：改为占满 App 的沉浸式播放页（酷狗 / 爱奇艺 / 看图）
   *  2 容器标签：清单按比例自适应 + 下方选中容器的资源占用与日志窗
   *  3 插件安装后在桌面显示图标；只删图标不卸载插件，可随时恢复
   *  4 「端点探测」标签去掉日志，改为连到 dockerd 所在 WSL 发行版的常驻终端
   *  5 分享：完整 URL + 生成即复制 + 网盘式落地页（后端已实现）
   *  6/7 文件总管交互修复 + 全窗口尺寸自适应
   * 本段位于 real 层 IIFE 内，函数声明提升，可被前面的 dockerBlock/mediaApp 调用。
   * ================================================================== */
  var V14 = {
    media: { cur: {}, detail: {}, single: {}, scale: 1, rotate: 0, volume: 0.8, loop: false },
    dkr: { sel: '', pane: 'stats', stats: '', logs: '', busy: false, seq: 0, at: 0 },
    term: {
      sid: 'nasdeck' + Math.random().toString(36).slice(2, 9), lines: [], busy: false,
      distro: '', cwd: '', distros: [], history: [], hidx: 0, inited: false
    },
    icons: { list: [], loaded: false, loading: false, seq: 0, at: 0 },
    fitAt: 0
  };
  NasDeck.v14 = V14;

  /* ---------------------------------------------------------------- 样式 */
  function v14Style() {
    if (document.getElementById('nasdeck-v14-style')) return;
    var el = document.createElement('style'); el.id = 'nasdeck-v14-style';
    el.textContent = [
      /* 需求 7：小窗口不裁切按钮 —— 工具条允许换行、侧栏按比例收缩、窗口不设硬性最小宽 */
      '.win{min-width:min(380px,96vw);min-height:min(260px,70vh)}',
      '.toolbar{height:auto;min-height:44px;flex-wrap:wrap;align-content:center;gap:6px;padding:6px 10px}',
      '.app-side{width:clamp(116px,20%,196px);min-width:116px}',
      '.app-row{min-height:96px}',
      '.win.narrow .app-side{width:100%;max-height:118px;flex:none;border-right:0;border-bottom:1px solid var(--line)}',
      '.win.narrow .app-row{flex-direction:column;overflow:auto}',
      '.win.narrow .app-main{min-height:220px}',
      '.win.narrow .toolbar{font-size:10.5px}',
      '.win.narrow .tabs{flex-wrap:wrap;height:auto;min-height:34px}',
      '.win-body .app-scroll{padding:12px 12px 18px}',
      '.nasdeck-fs-pager,.nasdeck-sh-bar{row-gap:5px}',
      /* 需求 1：沉浸式播放页 */
      '.v14-player{height:100%;background:linear-gradient(160deg,#0d1c2b,#0a1420 60%,#101f2e);color:#e8f3fb}',
      '.v14-p-top{flex:none;display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:9px 14px;border-bottom:1px solid rgba(120,170,210,.18);background:rgba(8,18,28,.72)}',
      '.v14-p-top .t{font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:44vw}',
      '.v14-p-top .sp{flex:1}',
      '.v14-p-main{flex:1;min-height:0;display:flex;gap:12px;padding:12px 14px;overflow:hidden}',
      '.v14-p-left{flex:1 1 60%;min-width:0;display:flex;flex-direction:column;gap:10px;overflow:hidden}',
      '.v14-p-right{flex:0 1 250px;min-width:150px;display:flex;flex-direction:column;min-height:0;overflow:hidden;border:1px solid rgba(120,170,210,.18);border-radius:10px;background:rgba(9,20,32,.72)}',
      '.v14-p-right .hd{flex:none;padding:9px 11px;border-bottom:1px solid rgba(120,170,210,.16);font-size:11.5px;font-weight:700;color:#9fd0ee}',
      '.v14-p-right .lst{flex:1;min-height:0;overflow:auto;padding:6px}',
      '.v14-p-bottom{flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 14px;border-top:1px solid rgba(120,170,210,.18);background:rgba(8,18,28,.86)}',
      '.v14-cover{flex:none;width:min(230px,32vw);height:min(230px,32vw);min-width:110px;min-height:110px;margin:0 auto;border-radius:12px;overflow:hidden;background:#162c40;display:grid;place-items:center;box-shadow:0 14px 40px rgba(0,0,0,.45)}',
      '.v14-cover img{width:100%;height:100%;object-fit:cover}',
      '.v14-cover .ph{font-size:11px;color:#7ea6c2;text-align:center;padding:10px}',
      '.v14-track{text-align:center;flex:none}',
      '.v14-track b{display:block;font-size:15px;word-break:break-all}',
      '.v14-track span{font-size:11px;color:#8fb0c7}',
      '.v14-lyrics{flex:1;min-height:60px;overflow:auto;margin:0;padding:10px 14px;background:rgba(4,12,20,.45);border-radius:9px;' +
        'font:12px/1.9 system-ui,"Microsoft YaHei",sans-serif;white-space:pre-wrap;color:#b9d9ee;text-align:center}',
      '.v14-pl-row{display:flex;align-items:center;gap:7px;width:100%;padding:7px 8px;border:0;border-radius:7px;background:none;color:#cfe4f3;' +
        'font:inherit;font-size:11px;text-align:left;cursor:pointer;overflow:hidden}',
      '.v14-pl-row:hover{background:rgba(34,167,232,.14)}',
      '.v14-pl-row.on{background:rgba(34,167,232,.24);color:#fff;font-weight:700}',
      '.v14-pl-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}',
      '.v14-stage{flex:1;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#050b12;border-radius:10px;position:relative}',
      '.v14-stage video{width:100%;height:100%;max-height:100%;object-fit:contain;background:#000}',
      '.v14-stage img{max-width:100%;max-height:100%;object-fit:contain;transition:transform .18s;transform-origin:center center}',
      '.v14-btn{border:1px solid rgba(120,170,210,.34);background:rgba(23,53,76,.9);color:#e8f3fb;padding:7px 12px;border-radius:8px;' +
        'font:600 11.5px system-ui,"Microsoft YaHei",sans-serif;cursor:pointer;white-space:nowrap}',
      '.v14-btn:hover{filter:brightness(1.2)}.v14-btn.primary{background:#22a7e8;border-color:#22a7e8;color:#fff}',
      '.v14-seek{flex:1;min-width:90px;accent-color:#22a7e8;height:5px}',
      '.v14-mono{font:11px/1.5 Consolas,monospace;color:#9fc4dc;word-break:break-all}',
      '.v14-meta{padding:9px 11px;font-size:11px;color:#b6d2e6;overflow:auto;flex:1;min-height:0}',
      '.v14-meta .kv{border-bottom:1px solid rgba(120,170,210,.12)}',
      '.v14-thumbs{flex:none;display:flex;gap:7px;overflow-x:auto;padding:8px 14px;border-top:1px solid rgba(120,170,210,.18);background:rgba(8,18,28,.7)}',
      '.v14-thumbs img{width:52px;height:42px;object-fit:cover;border-radius:6px;border:2px solid transparent;cursor:pointer;flex:none}',
      '.v14-thumbs img.on{border-color:#22a7e8}',
      '.v14-player .btn.sm,.v14-player button.v14-btn{font-size:11px}',
      '.win.narrow .v14-p-main{flex-direction:column;gap:8px;padding:8px}',
      '.win.narrow .v14-p-right{flex:0 0 120px;min-width:0}',
      '.win.narrow .v14-cover{width:min(160px,38vw);height:min(160px,38vw)}',
      /* 需求 2：容器清单 + 下半窗。窗口内的弹性宿主让两区随窗口高度按比例伸缩 */
      '.v14-flex-host{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:12px 14px}',
      '.v14-ct-wrap{flex:1;min-height:0;display:flex;flex-direction:column;gap:9px}',
      '.v14-ct-ops{flex:none;display:flex;gap:7px;flex-wrap:wrap;align-items:center}',
      '.v14-ct-list{flex:1 1 54%;min-height:80px;overflow:auto;border:1px solid var(--line);border-radius:9px;background:var(--panel)}',
      '.v14-ct-info{flex:1 1 46%;min-height:80px;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--line);border-radius:9px;background:var(--panel)}',
      '.v14-ct-hd{flex:none;display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid var(--line);font-size:11px}',
      '.v14-ct-body{flex:1;min-height:0;overflow:auto;padding:9px 11px;' +
        'font:11px/1.65 Consolas,monospace;white-space:pre-wrap;word-break:break-all;background:var(--bg2,#0f1722);color:var(--fg,#dbe7f3);margin:0}',
      '.v14-ct-pick{cursor:pointer}.v14-ct-pick.on{background:rgba(34,167,232,.20)!important}',
      '.v14-ct-pick.on td{color:var(--accent)}',
      /* 需求 4：常驻终端 */
      '.v14-term-wrap{flex:1;min-height:0;display:flex;flex-direction:column;border:1px solid #2a4a63;border-radius:9px;overflow:hidden;background:#08131e}',
      '.v14-term-hd{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 11px;background:#102a3d;border-bottom:1px solid #2a4a63;color:#cfe6f6;font-size:11px}',
      '.v14-term-out{flex:1;min-height:90px;overflow:auto;padding:10px 12px;margin:0;font:11.5px/1.7 Consolas,"Courier New",monospace;' +
        'white-space:pre-wrap;word-break:break-all;color:#cfe6f6;background:#08131e}',
      '.v14-term-out .ok{color:#8fe0a8}.v14-term-out .err{color:#ff9b9b}.v14-term-out .cmd{color:#6fd0ff;font-weight:700}',
      '.v14-term-in{flex:none;display:flex;align-items:center;gap:8px;padding:8px 11px;border-top:1px solid #2a4a63;background:#0c1c29}',
      '.v14-term-in .pr{font:11.5px Consolas,monospace;color:#6fd0ff;white-space:nowrap;max-width:46%;overflow:hidden;text-overflow:ellipsis}',
      '.v14-term-in input{flex:1;min-width:60px;background:none;border:0;outline:0;color:#e8f3fb;font:12px Consolas,monospace}',
      /* 需求 3：桌面插件图标 */
      '.di.v14-plugin{position:relative}',
      '.v14-ic-img{width:46px;height:46px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(140deg,#1d5b83,#123a56);' +
        'color:#dff2ff;font-size:19px;font-weight:800;border:1px solid rgba(120,200,240,.42);box-shadow:0 4px 12px rgba(0,0,0,.35)}',
      '.v14-ic-x{position:absolute;top:2px;right:4px;width:17px;height:17px;line-height:14px;padding:0;border:1px solid rgba(255,255,255,.28);' +
        'border-radius:50%;background:rgba(10,20,30,.82);color:#ffb4b4;font-size:12px;cursor:pointer;opacity:0;transition:.12s}',
      '.di.v14-plugin:hover .v14-ic-x{opacity:1}',
      '.v14-ic-x:hover{background:#b33131;color:#fff}'
    ].join('\n');
    document.head.appendChild(el);
  }

  /* ---------------------------------------------------------------- 需求 7：窗口尺寸自适应 */
  function v14FitWins() {
    try {
      var AW = Math.max(320, innerWidth), AH = Math.max(240, availH());
      if (typeof WINS === 'undefined' || !WINS) return;
      /* 修复「窗口拉大后自动变回原尺寸」：
         旧实现只在「视口未变」的分支里采样式地记住用户手动缩放的尺寸，
         一旦用户刚拉大窗口就遇到视口变化（拉大外层窗口、滚动条出现/消失
         导致 innerWidth 抖动、显示缩放切换），clamp 分支会拿窗口「打开时」
         的旧期望尺寸 __v14w 把窗口压回去。
         现在把「用户手动尺寸」的识别提到所有判断之前、无条件优先执行，
         并在 clamp 时永远不把窗口缩到比当前尺寸更小。 */
      WINS.forEach(function (r) {
        if (!r || r.closed || !r.el || r.max) return;
        /* 记住窗口打开时的期望尺寸：视口变小只做 clamp，视口恢复时还原，
           否则从大屏切到小屏再切回来，所有窗口会永久停留在小尺寸。 */
        if (!isFinite(r.__v14w) || !r.__v14w) { r.__v14w = r.w; r.__v14h = r.h; }
        var manual = isFinite(r.__v14lastW) &&
                     (r.w !== r.__v14lastW || r.h !== r.__v14lastH);
        if (manual) {
          /* 用户刚手动调整过：立即把新尺寸写为期望尺寸，本拍不做还原式 clamp。 */
          r.__v14w = r.w; r.__v14h = r.h;
          r.__v14lastW = r.w; r.__v14lastH = r.h;
          /* 仅做「不超出视口」的上界保护；__v14w 保留用户设定的原始尺寸，
             这样视口恢复变大时仍能还原到用户拉大的尺寸。 */
          var bw = Math.max(300, Math.min(r.w, AW - 8));
          var bh = Math.max(220, Math.min(r.h, AH - 8));
          var bx = Math.max(2, Math.min(r.x || 8, AW - bw - 2));
          var by = Math.max(2, Math.min(r.y || 8, AH - bh - 2));
          if (bw !== r.w || bh !== r.h || bx !== r.x || by !== r.y) {
            r.w = bw; r.h = bh; r.x = bx; r.y = by;
            r.__v14lastW = bw; r.__v14lastH = bh;
            if (typeof applyRect === 'function') applyRect(r);
          }
          r.el.classList.toggle('narrow', (r.el.clientWidth || r.w) < 640);
          return;
        }
        /* 上界取「期望尺寸」与「当前尺寸」的较大者：绝不把用户已放大的窗口缩回。 */
        var nw = Math.max(300, Math.min(Math.max(r.__v14w || 900, r.w || 900), AW - 8));
        var nh = Math.max(220, Math.min(Math.max(r.__v14h || 600, r.h || 600), AH - 8));
        var nx = Math.max(2, Math.min(r.x || 8, AW - nw - 2));
        var ny = Math.max(2, Math.min(r.y || 8, AH - nh - 2));
        if (nw !== r.w || nh !== r.h || nx !== r.x || ny !== r.y) {
          r.w = nw; r.h = nh; r.x = nx; r.y = ny;
          if (typeof applyRect === 'function') applyRect(r);
        }
        r.__v14lastW = r.w; r.__v14lastH = r.h;
        r.el.classList.toggle('narrow', (r.el.clientWidth || r.w) < 640);
      });
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- 需求 1：沉浸式媒体播放页 */
  /* 文件总管里双击的媒体文件可能不在已选媒体文件夹内：临时插到播放列表首位，
     依然用本机绝对路径直出，不改动用户的媒体根目录设置。 */
  function v14MediaList(id) {
    var extra = V14.media.single[id], base = medItems(id);
    if (!extra) return base;
    return [extra].concat(base.filter(function (x) { return x.path !== extra.path; }));
  }
  function v14MediaIndex(id) {
    var list = v14MediaList(id), cur = V14.media.cur[id], i;
    for (i = 0; i < list.length; i++) if (list[i].path === cur) return i;
    return list.length ? 0 : -1;
  }
  NasDeck.v14.openSingle = function (id, it) {
    if (!it || !it.path) return;
    V14.media.single[id] = it;
    v14MedOpen(id, it.path);
    try { if (typeof openApp === 'function') openApp(id); } catch (e) {}
    try { rerender(id); } catch (e) {}
  };
  function v14MedOpen(id, p) {
    V14.media.cur[id] = p;
    MED.tab[id] = 'player';
    V14.media.scale = 1; V14.media.rotate = 0;
    var cfg = medCfg(id);
    if (!NasDeck.token) { try { rerender(id); } catch (e) {} return; }
    NasDeck.get('/api/media/detail?path=' + encodeURIComponent(p)).then(function (r) {
      V14.media.detail[id] = r || {};
      try { rerender(id); } catch (e) {}
    }).catch(function () { V14.media.detail[id] = {}; try { rerender(id); } catch (e) {} });
    try { rerender(id); } catch (e) {}
    if (cfg.kind === 'photo') V14.media.rotate = 0;
  }
  function v14MedStep(id, delta) {
    var list = v14MediaList(id), n = list.length;
    if (!n) return;
    var i = v14MediaIndex(id);
    var j = (i + delta + n) % n;
    v14MedOpen(id, list[j].path);
  }
  function v14Cover(it, cls) {
    var c = it && it.cover;
    if (c && c.url) return '<img src="' + RE(medUrl(c.url)) + '" alt="' + RE(it.n) + '" class="' + (cls || '') + '">';
    return '<div class="ph">无封面 · N/A</div>';
  }
  function v14Playlist(id, list, idx, kind) {
    return list.map(function (x, i) {
      var sub = kind === 'music' ? RE(x.artist || 'N/A') + ' · ' + RE(x.durText || 'N/A')
        : kind === 'video' ? RE(x.durText || 'N/A') + ' · ' + RE(x.szText || 'N/A')
          : (x.width ? x.width + '×' + x.height : RE(x.szText || 'N/A'));
      return '<button class="v14-pl-row ' + (i === idx ? 'on' : '') + '" data-act="v14-med-play" data-app="' + id + '" data-p="' + RE(x.path) + '">' +
        '<span>' + RE(x.title || x.n) + '</span><small style="opacity:.65;font-size:10px;white-space:nowrap">' + sub + '</small></button>';
    }).join('');
  }
  function v14MetaRows(it, tx, kind) {
    var rows = [
      ['文件', RE(it.n || 'N/A')], ['真实路径', '<span class="mono">' + RE(it.path || 'N/A') + '</span>'],
      ['大小', RE(it.szText || 'N/A')], ['修改日期', RE(it.d || 'N/A')]
    ];
    if (kind === 'photo') rows.push(['尺寸', (it.width && it.height) ? it.width + ' × ' + it.height : 'N/A'],
      ['相机', RE(it.camera || 'N/A')], ['拍摄时间', RE(it.dateTaken || 'N/A')], ['格式', RE((it.meta || {})['格式'] || 'N/A')]);
    if (kind === 'music') rows.push(['艺术家', RE(it.artist || 'N/A')], ['专辑', RE(it.album || 'N/A')],
      ['时长', RE(it.durText || 'N/A')], ['标签来源', RE((it.meta || {})['标签来源'] || 'N/A')]);
    if (kind === 'video') rows.push(['时长', RE(it.durText || 'N/A')], ['字幕', String((it.subtitles || []).length) + ' 个']);
    var extra = Object.keys(it.meta || {}).filter(function (k) { return k !== '格式' && k !== '标签来源'; })
      .map(function (k) { return [k, RE(it.meta[k])]; });
    return rows.concat(extra).map(function (r) {
      return '<div class="kv"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>';
    }).join('');
  }
  function v14PlayerPage(id) {
    var cfg = medCfg(id), list = v14MediaList(id), idx = v14MediaIndex(id);
    if (idx < 0) {
      return '<div class="app v14-player"><div class="v14-p-top">' +
        '<button class="v14-btn" data-act="v14-med-back" data-app="' + id + '">← 返回媒体库</button>' +
        '<b class="t">' + RE(cfg.title) + '</b></div><div class="empty" style="color:#bcd7ea;padding:40px">' +
        '媒体库为空，请先到「选择媒体文件夹」添加目录</div></div>';
    }
    var it = list[idx], det = V14.media.detail[id] || {}, ditem = det.item || it, tx = det.text || {};
    var kind = cfg.kind;
    /* v15 需求 10：音频/视频播放页按参考图重做（酷狗式 / 腾讯视频式）。
       v15 层复用 v14 的 DOM id 与动作，图片页仍沿用下方原实现。 */
    if ((kind === 'music' || kind === 'video') && window.NasDeck_V15 &&
        typeof NasDeck_V15.playerPage === 'function') {
      var v15html = NasDeck_V15.playerPage(id, {
        cfg: cfg, list: list, idx: idx, kind: kind, it: it, det: det, ditem: ditem, tx: tx,
        V14: V14, cover: v14Cover, metaRows: v14MetaRows
      });
      if (v15html) return v15html;
    }
    var top = '<div class="v14-p-top">' +
      '<button class="v14-btn" data-act="v14-med-back" data-app="' + id + '">← 媒体库</button>' +
      '<b class="t">' + RE(it.title || it.n) + '</b>' +
      '<span class="badge info">' + (idx + 1) + ' / ' + list.length + '</span>' +
      '<span class="sp"></span>' +
      (kind === 'photo' ?
        '<button class="v14-btn" data-act="v14-med-zoom" data-app="' + id + '" data-v="-1">− 缩小</button>' +
        '<button class="v14-btn" data-act="v14-med-zoom" data-app="' + id + '" data-v="1">＋ 放大</button>' +
        '<button class="v14-btn" data-act="v14-med-rot" data-app="' + id + '">旋转 90°</button>' : '') +
      (kind === 'video' ? '<button class="v14-btn" data-act="v14-med-full" data-app="' + id + '">全屏</button>' : '') +
      '<button class="v14-btn" data-act="v14-med-prev" data-app="' + id + '">上一' + (kind === 'photo' ? '张' : '个') + '</button>' +
      '<button class="v14-btn primary" data-act="v14-med-next" data-app="' + id + '">下一' + (kind === 'photo' ? '张' : '个') + '</button>' +
      '</div>';

    var main, bottom = '';
    if (kind === 'music') {
      var lyrics = tx.lyrics || it.lyrics || '（这首歌没有内嵌歌词或同名 LRC，显示 N/A）';
      main = '<div class="v14-p-left">' +
        '<div class="v14-cover">' + v14Cover(it) + '</div>' +
        '<div class="v14-track"><b>' + RE(it.title || it.n) + '</b><span>' + RE(it.artist || 'N/A') + ' · ' + RE(it.album || 'N/A') + ' · ' + RE(it.durText || 'N/A') + '</span></div>' +
        '<pre class="v14-lyrics">' + RE(lyrics) + '</pre></div>' +
        '<div class="v14-p-right"><div class="hd">播放列表 · ' + list.length + ' 首</div>' +
        '<div class="lst">' + v14Playlist(id, list, idx, kind) + '</div></div>';
      bottom = '<audio id="v14-audio" src="' + RE(medUrl(it.url)) + '" autoplay' + (V14.media.loop ? ' loop' : '') + '></audio>' +
        '<button class="v14-btn" data-act="v14-med-prev" data-app="' + id + '">⏮</button>' +
        '<button class="v14-btn primary" data-act="v14-med-toggle" data-app="' + id + '" id="v14-play-btn">⏸ 暂停</button>' +
        '<button class="v14-btn" data-act="v14-med-next" data-app="' + id + '">⏭</button>' +
        '<input type="range" class="v14-seek" id="v14-seek" min="0" max="100" value="0" data-app="' + id + '">' +
        '<span class="v14-mono" id="v14-time">0:00 / ' + RE(it.durText || 'N/A') + '</span>' +
        '<button class="v14-btn" data-act="v14-med-loop" data-app="' + id + '">' + (V14.media.loop ? '循环：开' : '循环：关') + '</button>' +
        '<span class="v14-mono">音量</span><input type="range" id="v14-vol" min="0" max="100" value="' + Math.round(V14.media.volume * 100) + '" style="width:76px;accent-color:#22a7e8">';
    } else if (kind === 'video') {
      var vtt = (ditem.subtitles || it.subtitles || []).filter(function (s) { return /\.vtt$/i.test(s.n); })[0];
      main = '<div class="v14-stage"><video id="v14-video" controls autoplay playsinline src="' + RE(medUrl(it.url)) + '">' +
        (vtt ? '<track kind="subtitles" src="' + RE(medUrl(vtt.url)) + '" srclang="zh" label="' + RE(vtt.n) + '" default>' : '') +
        '</video></div>' +
        '<div class="v14-p-right"><div class="hd">选集 · ' + list.length + ' 部</div>' +
        '<div class="lst">' + v14Playlist(id, list, idx, kind) + '</div>' +
        '<div class="hd">字幕与元数据</div><div class="v14-meta">' + v14MetaRows(ditem, tx, kind) +
        ((ditem.subtitles || it.subtitles || []).length ? '<div class="section-title" style="margin-top:8px">外挂字幕</div>' +
          (ditem.subtitles || it.subtitles).map(function (s) { return '<div class="v14-mono">' + RE(s.n) + ' · ' + RE(s.lang || '默认') + '</div>'; }).join('') : '') +
        (tx.subtitle ? '<pre class="v14-ct-body" style="max-height:130px">' + RE(tx.subtitle) + '</pre>' : '') +
        '</div></div>';
      bottom = '<span class="v14-mono">真实文件：' + RE(it.n) + ' · ' + RE(it.szText || 'N/A') + ' · ' + RE(it.durText || 'N/A') + '</span>' +
        '<span class="sp" style="flex:1"></span>' +
        '<button class="v14-btn" data-act="v14-med-full" data-app="' + id + '">全屏播放</button>';
    } else {
      var tr = 'scale(' + V14.media.scale + ') rotate(' + V14.media.rotate + 'deg)';
      main = '<div class="v14-stage"><img id="v14-photo" src="' + RE(medUrl(it.url)) + '" style="transform:' + tr + '" alt="' + RE(it.n) + '"></div>' +
        '<div class="v14-p-right"><div class="hd">照片信息 · EXIF</div><div class="v14-meta">' + v14MetaRows(ditem, tx, kind) + '</div></div>';
      bottom = '<div class="v14-thumbs">' + list.map(function (x, i) {
        return '<img class="' + (i === idx ? 'on' : '') + '" src="' + RE(medUrl(x.cover ? x.cover.url : x.url)) +
          '" title="' + RE(x.n) + '" data-act="v14-med-play" data-app="' + id + '" data-p="' + RE(x.path) + '">';
      }).join('') + '</div>';
    }
    return '<div class="app v14-player">' + top + '<div class="v14-p-main">' + main + '</div>' + bottom + '</div>';
  }
  function renderPhotoDeckV14() { return MED.tab.photodeck === 'player' ? v14PlayerPage('photodeck') : mediaApp('photodeck'); }
  function renderMusicV14() { return MED.tab.music === 'player' ? v14PlayerPage('music') : mediaApp('music'); }
  function renderVideoV14() { return MED.tab.video === 'player' ? v14PlayerPage('video') : mediaApp('video'); }

  /* ---------------------------------------------------------------- 需求 2：容器清单 + 资源/日志下半窗 */
  function v14CtRows(cts) {
    if (!cts.length) return '<tr><td colspan="5" class="dim" style="padding:16px">没有容器 / 引擎未连线（N/A）</td></tr>';
    return cts.map(function (c) {
      var id = RE(c.id || ''), state = String(c.state || (c.st ? 'running' : 'exited'));
      var on = V14.dkr.sel && (V14.dkr.sel === (c.id || ''));
      var ops = (state === 'running'
        ? RBT('dkr-action', '停止', 'data-n="' + id + '" data-a="stop"', '', 'pause') + ' ' + RBT('dkr-action', '暂停', 'data-n="' + id + '" data-a="pause"', '', 'pause')
        : state === 'paused'
          ? RBT('dkr-action', '继续', 'data-n="' + id + '" data-a="unpause"', 'primary', 'play')
          : RBT('dkr-action', '启动', 'data-n="' + id + '" data-a="start"', 'primary', 'play')) + ' ' +
        RBT('dkr-action', '重启', 'data-n="' + id + '" data-a="restart"', '', 'refresh') + ' ' +
        RBT('v14-ct-log', '日志', 'data-n="' + id + '"', '', 'file') + ' ' +
        /* v15 需求 3：容器「重构」。必须放在这里（v14CtRows），因为 containers
           标签真正渲染的是 v14ContainerBody() -> v14CtRows()；dockerBlock() 里
           那段 ctRows/ctTbl 是未被使用的死代码，加在那里按钮永远不会出现。 */
        RBT('v15-ct-recreate', '重构', 'data-id="' + id + '"', '', 'box') + ' ' +
        RBT('dkr-action', '删除', 'data-n="' + id + '" data-a="remove"', 'danger', 'trash');
      /* v15 需求 2：仅 status==='update' 才出可点击「有更新」标签，否则灰/绿状态。 */
      var updTag = (window.NasDeck_V15 && typeof NasDeck_V15.updBadge === 'function')
        ? NasDeck_V15.updBadge(id) : '';
      return '<tr class="v14-ct-pick ' + (on ? 'on' : '') + '" data-act="v14-ct-pick" data-id="' + id + '">' +
        '<td><b>' + RE(c.n) + '</b><div class="mono dim" style="font-size:10px">' + id + '</div>' + updTag + '</td>' +
        '<td>' + RE(c.img || 'N/A') + '</td>' +
        '<td><span class="badge ' + (state === 'running' ? 'ok' : '') + '">' + RE(state) + '</span></td>' +
        '<td class="mono dim">' + RE(c.port || 'N/A') + '</td>' +
        '<td><div style="display:flex;gap:4px;flex-wrap:wrap">' + ops + '</div></td></tr>';
    }).join('');
  }
  function v14CtBodyHtml() {
    var pane = V14.dkr.pane, txt = pane === 'logs' ? V14.dkr.logs : V14.dkr.stats;
    if (!V14.dkr.sel) return '先在上表点选一个容器，下半窗会显示它的真实 CPU / 内存 / 网络占用（stats）或容器日志（logs）。\n数据直接来自 Docker Engine REST API，读不到显示 N/A。';
    if (V14.dkr.busy) {
      /* 后台自动刷新不清空已有内容：否则用户刚读到的日志会被「正在读取」盖掉 */
      return txt ? txt + '\n\n⟳ 正在刷新…' :
        '正在读取 ' + V14.dkr.sel + ' 的' + (pane === 'logs' ? '日志' : '资源占用') + '…';
    }
    return txt || '暂无输出（N/A）。点「刷新」重新读取。';
  }
  function v14CtPaint() {
    var el = document.querySelector('.v14-ct-body');
    if (el) el.textContent = v14CtBodyHtml();
    document.querySelectorAll('.v14-ct-hd [data-act="v14-ct-pane"]').forEach(function (b) {
      b.classList.toggle('primary', b.dataset.t === V14.dkr.pane);
    });
  }
  function v14CtLoad(pane, silent) {
    if (!V14.dkr.sel || !NasDeck.token) { v14CtPaint(); return Promise.resolve(); }
    var my = ++V14.dkr.seq, id = V14.dkr.sel, act = pane || V14.dkr.pane;
    /* silent = 后台定时刷新：不置 busy、不重绘成 loading，只在拿到数据后静默替换 */
    if (!silent) { V14.dkr.busy = true; v14CtPaint(); }
    return NasDeck.get('/api/docker/container?id=' + encodeURIComponent(id) + '&act=' + act).then(function (r) {
      if (my !== V14.dkr.seq) return;
      if (!silent) V14.dkr.busy = false;
      var txt = (r && r.ok) ? (r.out || '（无输出 / N/A）') :
        ('读取失败：' + ((r && (r.error || r.out)) || 'N/A') + '\n容器 ' + id + ' · 动作 ' + act);
      if (act === 'logs') V14.dkr.logs = txt; else V14.dkr.stats = txt;
      v14CtPaint();
    }).catch(function (e) {
      if (my !== V14.dkr.seq) return;
      if (!silent) V14.dkr.busy = false;
      var msg = '读取失败：' + (e.message || e) + '\n容器 ' + id + ' · 动作 ' + act;
      if (act === 'logs') V14.dkr.logs = msg; else V14.dkr.stats = msg;
      v14CtPaint();
    });
  }
  function v14ContainerBody(cts, createRow) {
    var sel = V14.dkr.sel || '';
    return '<div class="v14-ct-wrap">' +
      '<div class="v14-ct-ops">' + createRow +
      '<span class="sp" style="flex:1"></span><span class="badge info">' + cts.length + ' 个容器</span>' +
      '<span class="badge">已选 ' + RE(sel || '无') + '</span>' +
      RBT('dkr-refresh', '刷新清单', '', '', 'refresh') + '</div>' +
      '<div class="v14-ct-list"><table class="tbl"><thead><tr><th style="width:26%">容器（点行选中）</th>' +
      '<th>镜像</th><th>状态</th><th>端口</th><th style="width:34%">操作</th></tr></thead><tbody>' +
      v14CtRows(cts) + '</tbody></table></div>' +
      '<div class="v14-ct-info"><div class="v14-ct-hd">' +
      RBT('v14-ct-pane', '资源占用 (stats)', 'data-t="stats"', V14.dkr.pane === 'stats' ? 'primary' : '', 'activity') +
      RBT('v14-ct-pane', '容器日志 (logs)', 'data-t="logs"', V14.dkr.pane === 'logs' ? 'primary' : '', 'file') +
      '<span class="sp" style="flex:1"></span><span class="mono dim">' + RE(sel || '未选择容器') + '</span>' +
      RBT('v14-ct-refresh', '刷新', '', '', 'refresh') + '</div>' +
      '<pre class="v14-ct-body">' + RE(v14CtBodyHtml()) + '</pre></div></div>';
  }

  /* ---------------------------------------------------------------- 需求 4：WSL 常驻终端 */
  function v14TermPush(cls, txt) {
    V14.term.lines.push({ c: cls, t: String(txt == null ? '' : txt) });
    if (V14.term.lines.length > 400) V14.term.lines = V14.term.lines.slice(-400);
  }
  function v14TermPaint() {
    var el = document.querySelector('.v14-term-out');
    if (el) {
      el.innerHTML = V14.term.lines.map(function (l) {
        return '<span class="' + l.c + '">' + RE(l.t) + '</span>';
      }).join('\n');
      el.scrollTop = el.scrollHeight;
    }
    var p = document.querySelector('.v14-term-in .pr');
    if (p) p.textContent = (V14.term.cwd ? 'root@' + (V14.term.distro || 'Debian') + ':' + V14.term.cwd : 'root@' + (V14.term.distro || 'Debian') + ':~') + '# ';
  }
  function v14TermInit() {
    if (V14.term.inited || !NasDeck.token) return;
    V14.term.inited = true;
    NasDeck.get('/api/wsl/term').then(function (r) {
      V14.term.distro = (r && r.distro) || 'Debian';
      V14.term.distros = (r && r.distros) || [];
      v14TermPush('ok', 'NasDeck 常驻终端 · 已连接 dockerd 所在 WSL 发行版：' + V14.term.distro);
      v14TermPush('', '同一会话内保持当前目录（cd 会记住），可连续执行多条命令。输入 help 查看示例。');
      v14TermPaint();
      try { rerender('container'); } catch (e) {}
    }).catch(function (e) { v14TermPush('err', '终端初始化失败：' + (e.message || e)); v14TermPaint(); });
  }
  function v14TermRun(cmd) {
    cmd = String(cmd || '').trim();
    if (!cmd || V14.term.busy) return;
    if (cmd === 'clear') { V14.term.lines = []; v14TermPaint(); return; }
    V14.term.history.push(cmd); V14.term.hidx = V14.term.history.length;
    v14TermPush('cmd', '$ ' + cmd);
    V14.term.busy = true; v14TermPaint();
    var inp = document.getElementById('v14-term-cmd'); if (inp) inp.value = '';
    NasDeck.post('/api/wsl/term', { sid: V14.term.sid, distro: V14.term.distro, cmd: cmd, timeout: 30000 }).then(function (r) {
      V14.term.busy = false;
      V14.term.cwd = (r && r.cwd) || V14.term.cwd;
      V14.term.distro = (r && r.distro) || V14.term.distro;
      var out = (r && (r.out || r.err)) || '';
      v14TermPush(r && r.ok ? '' : 'err', out || (r && r.ok ? '（命令执行完毕，无输出）' : '命令执行失败，未拿到输出（N/A）'));
      v14TermPaint();
    }).catch(function (e) {
      V14.term.busy = false;
      v14TermPush('err', '执行失败：' + (e.message || e) + '\n（终端连接的仍是本机 WSL 发行版，真实错误如实显示）');
      v14TermPaint();
    });
  }
  function v14TerminalBody() {
    var ds = V14.term.distros || [];
    return '<div class="v14-term-wrap"><div class="v14-term-hd">' +
      '<b>WSL 常驻终端</b>' +
      '<span class="badge info">' + RE(V14.term.distro || 'Debian') + '</span>' +
      '<span class="mono dim">dockerd 所在系统 · 会话 ' + RE(V14.term.sid) + '</span>' +
      (ds.length ? '<select id="v14-term-distro" class="inp" style="height:26px;font-size:11px">' + ds.map(function (d) {
        return '<option ' + (d === V14.term.distro ? 'selected' : '') + '>' + RE(d) + '</option>';
      }).join('') + '</select>' : '') +
      '<span class="sp" style="flex:1"></span>' +
      RBT('v14-term-clear', '清屏', '', '', 'trash') +
      RBT('dkr-discover', '探测端点', '', '', 'activity') +
      '</div>' +
      '<pre class="v14-term-out">' + V14.term.lines.map(function (l) { return '<span class="' + l.c + '">' + RE(l.t) + '</span>'; }).join('\n') + '</pre>' +
      '<div class="v14-term-in"><span class="pr">root@' + RE(V14.term.distro || 'Debian') + ':~# </span>' +
      '<input id="v14-term-cmd" autocomplete="off" spellcheck="false" placeholder="输入命令后回车执行，例如 uname -a / docker ps -a / ls -la（↑↓ 翻历史）">' +
      RBT('v14-term-go', '执行', '', 'primary', 'terminal') + '</div></div>';
  }

  /* ---------------------------------------------------------------- 需求 3：插件桌面图标 */
  function v14IconsHtml() {
    var arr = V14.icons.list || [];
    if (!arr.length) return '';
    return arr.map(function (x) {
      var nm = String(x.name || x.id || '插件');
      return '<div class="di v14-plugin" data-v14-icon="' + RE(x.id) + '" title="' + RE(nm) +
        '（双击打开 · 右上角 × 只删除桌面图标）">' +
        '<button class="v14-ic-x" data-act="v14-icon-del" data-id="' + RE(x.id) + '" title="只删除桌面图标，不卸载插件">×</button>' +
        '<div class="v14-ic-img">' + RE(nm.slice(0, 1).toUpperCase()) + '</div><span>' + RE(nm) + '</span></div>';
    }).join('');
  }
  window.NasDeck_V14_ICONS = { html: v14IconsHtml };
  NasDeck.v14.icons.reload = function () { return v14IconsLoad(true); };
  function v14IconsLoad(force) {
    if (!NasDeck.token) return Promise.resolve();
    if (V14.icons.loading) return Promise.resolve();
    if (!force && V14.icons.loaded && Date.now() - V14.icons.at < 15000) return Promise.resolve();
    var my = ++V14.icons.seq;
    V14.icons.loading = true;
    return NasDeck.get('/api/plugins/icons').then(function (r) {
      if (my !== V14.icons.seq) return;
      V14.icons.loading = false; V14.icons.loaded = true; V14.icons.at = Date.now();
      V14.icons.list = (r && r.icons) || [];
      if (typeof renderDeskIcons === 'function') renderDeskIcons();
    }).catch(function () { if (my === V14.icons.seq) V14.icons.loading = false; });
  }
  function v14IconSave(act, o) {
    return NasDeck.post('/api/plugins/icons', Object.assign({ act: act }, o || {})).then(function (r) {
      if (r && r.icons) V14.icons.list = r.icons;
      else return v14IconsLoad(true);
      if (typeof renderDeskIcons === 'function') renderDeskIcons();
      return r;
    });
  }

  /* ---------------------------------------------------------------- 动作 */
  function installV14Actions() {
    /* 媒体播放页 */
    ACT['med-detail'] = function (e, d) {
      var id = (d && d.app) || 'photodeck', p = d && d.p;
      if (p) v14MedOpen(id, p);
    };
    ACT['med-detail'].__v14 = true; /* 防止 v13 installMediaActions 被重新调用时回退成弹窗 */
    ACT['v14-med-back'] = function (e, d) {
      var id = (d && d.app) || 'photodeck'; MED.tab[id] = 'library';
      try { rerender(id); } catch (er) {}
    };
    ACT['v14-med-play'] = function (e, d) { if (d && d.p) v14MedOpen((d && d.app) || 'photodeck', d.p); };
    ACT['v14-med-prev'] = function (e, d) { v14MedStep((d && d.app) || 'photodeck', -1); };
    ACT['v14-med-next'] = function (e, d) { v14MedStep((d && d.app) || 'photodeck', 1); };
    ACT['v14-med-toggle'] = function () {
      var a = document.getElementById('v14-audio'), b = document.getElementById('v14-play-btn');
      if (!a) { toast('播放器未就绪', '请先打开一首音乐', 'warn'); return; }
      if (a.paused) { try { a.play(); } catch (er) {} } else a.pause();
      if (b) b.textContent = a.paused ? '▶ 播放' : '⏸ 暂停';
    };
    ACT['v14-med-loop'] = function (e, d) {
      V14.media.loop = !V14.media.loop;
      var a = document.getElementById('v14-audio'); if (a) a.loop = V14.media.loop;
      try { rerender((d && d.app) || 'music'); } catch (er) {}
    };
    ACT['v14-med-zoom'] = function (e, d) {
      V14.media.scale = Math.max(0.2, Math.min(6, V14.media.scale + Number((d || {}).v || 0) * 0.25));
      v14PhotoTransform();
    };
    ACT['v14-med-rot'] = function () { V14.media.rotate = (V14.media.rotate + 90) % 360; v14PhotoTransform(); };
    ACT['v14-med-full'] = function () {
      var v = document.getElementById('v14-video');
      if (!v) { toast('播放器未就绪', '', 'warn'); return; }
      try { if (v.requestFullscreen) v.requestFullscreen(); else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen(); }
      catch (er) { toast('全屏不可用', er.message || '', 'warn'); }
    };
    /* 容器下半窗 */
    /* 底座 ACT 约定是 (元素, dataset, 原生事件)，第一个参数不是 event */
    ACT['v14-ct-pick'] = function (e, d, ev) {
      var id = (d && d.id) || '';
      if (!id || (ev && ev.target && ev.target.closest && ev.target.closest('button'))) return;
      V14.dkr.sel = id; V14.dkr.stats = ''; V14.dkr.logs = '';
      document.querySelectorAll('.v14-ct-pick').forEach(function (tr) { tr.classList.toggle('on', tr.dataset.id === id); });
      v14CtPaint(); v14CtLoad(V14.dkr.pane);
    };
    ACT['v14-ct-pane'] = function (e, d) {
      V14.dkr.pane = ((d && d.t) === 'logs') ? 'logs' : 'stats';
      v14CtPaint(); v14CtLoad(V14.dkr.pane);
    };
    ACT['v14-ct-log'] = function (e, d) {
      V14.dkr.sel = (d && d.n) || V14.dkr.sel; V14.dkr.pane = 'logs';
      V14.dkr.logs = ''; v14CtPaint(); v14CtLoad('logs');
    };
    ACT['v14-ct-refresh'] = function () { v14CtLoad(V14.dkr.pane); };
    /* 常驻终端 */
    ACT['v14-term-go'] = function () {
      var i = document.getElementById('v14-term-cmd');
      if (i) v14TermRun(i.value);
    };
    ACT['v14-term-clear'] = function () { V14.term.lines = []; v14TermPaint(); };
    /* 桌面插件图标 */
    ACT['v14-icon-del'] = function (e, d) {
      var id = (d && d.id) || ''; if (!id) return;
      var doDel = function () {
        v14IconSave('remove', { id: id }).then(function () { toast('已移除桌面图标', '插件本身未被卸载：' + id, 'ok'); })
          .catch(function (er) { toast('移除失败', er.message || String(er), 'err'); });
      };
      /* 桌面图标不属于任何 .win；必须找一个已打开的窗口承载确认弹窗 */
      var host = null;
      try {
        host = (typeof WINS !== 'undefined' && WINS ? WINS.filter(function (w) {
          return !w.closed && w.el && w.el.querySelector('.win-body');
        })[0] : null) || (typeof W === 'function' ? W('filestation') : null);
      } catch (er) {}
      if (!host || !host.el) { doDel(); return; }
      try {
        askModal(host, '删除桌面图标', '只删除「' + id + '」在桌面上的快捷方式，插件本体与启用状态完全保留；' +
          '可在 App Center 里点「显示到桌面」随时恢复。', null, doDel);
      } catch (er) { doDel(); }
    };
    ACT['v14-icon-add'] = function (e, d) {
      if (!d || !d.id) return;
      /* 统一清单：清掉「从桌面隐藏」标记，否则已隐藏的应用加回快捷方式仍不显示 */
      try { if (window.NasDeck_V15 && NasDeck_V15.deskUnhide) NasDeck_V15.deskUnhide(d.id); } catch (er) {}
      v14IconSave('add', {
        id: d.id, name: d.name || d.id, icon: d.icon || 'box',
        category: d.cat || '插件', builtin: d.builtin === '1' || d.builtin === 1
      }).then(function () { toast('已添加到桌面', d.name || d.id, 'ok'); })
        .catch(function (er) { toast('添加失败', er.message || String(er), 'err'); });
    };
    ACT['v14-icon-open'] = function (e, d) {
      var id = (d && d.id) || ''; if (!id) return;
      if (typeof openApp === 'function' && typeof APPS !== 'undefined' && APPS[id]) { openApp(id); return; }
      toast('打开插件', '该插件没有独立窗口，已在 App Center 中定位：' + id, 'info');
      if (typeof openApp === 'function') openApp('appcenter');
    };

    /* capture：终端输入框回车 / 历史；播放器进度与音量；插件图标双击 */
    if (!window.__NasDeck_V14_INPUT__) {
      window.__NasDeck_V14_INPUT__ = true;
      document.addEventListener('keydown', function (e) {
        var t = e.target;
        if (!t || t.id !== 'v14-term-cmd') return;
        if (e.key === 'Enter') { e.preventDefault(); v14TermRun(t.value); }
        else if (e.key === 'ArrowUp') {
          e.preventDefault(); V14.term.hidx = Math.max(0, V14.term.hidx - 1);
          t.value = V14.term.history[V14.term.hidx] || '';
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); V14.term.hidx = Math.min(V14.term.history.length, V14.term.hidx + 1);
          t.value = V14.term.history[V14.term.hidx] || '';
        }
      }, true);
      document.addEventListener('change', function (e) {
        var t = e.target;
        if (!t) return;
        if (t.id === 'v14-term-distro') { V14.term.distro = t.value; v14TermPaint(); v14TermPush('ok', '已切换发行版：' + t.value); v14TermPaint(); }
      }, true);
      document.addEventListener('input', function (e) {
        var t = e.target; if (!t) return;
        if (t.id === 'v14-seek') {
          var a = document.getElementById('v14-audio');
          if (a && isFinite(a.duration) && a.duration > 0) a.currentTime = (Number(t.value) / 100) * a.duration;
        }
        if (t.id === 'v14-vol') {
          V14.media.volume = Number(t.value) / 100;
          var a2 = document.getElementById('v14-audio'); if (a2) a2.volume = V14.media.volume;
        }
      }, true);
      /* timeupdate 不冒泡，必须在 capture 阶段监听 */
      document.addEventListener('timeupdate', function (e) {
        var a = e.target; if (!a || a.id !== 'v14-audio') return;
        var sk = document.getElementById('v14-seek'), tm = document.getElementById('v14-time');
        var fmt = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
        if (sk && isFinite(a.duration) && a.duration > 0) sk.value = Math.round(a.currentTime / a.duration * 100);
        if (tm) tm.textContent = fmt(a.currentTime) + ' / ' + fmt(a.duration);
        var b = document.getElementById('v14-play-btn'); if (b) b.textContent = a.paused ? '▶ 播放' : '⏸ 暂停';
      }, true);
      document.addEventListener('dblclick', function (e) {
        var di = e.target && e.target.closest ? e.target.closest('[data-v14-icon]') : null;
        if (!di || (e.target.closest && e.target.closest('.v14-ic-x'))) return;
        e.preventDefault(); e.stopImmediatePropagation();
        ACT['v14-icon-open'](null, { id: di.dataset.v14Icon });
      }, true);
      window.addEventListener('resize', function () { v14FitWins(); });
    }
  }
  function v14PhotoTransform() {
    var img = document.getElementById('v14-photo');
    if (img) img.style.transform = 'scale(' + V14.media.scale + ') rotate(' + V14.media.rotate + 'deg)';
  }

  /* ---------------------------------------------------------------- 统一守卫（与 real 层共用一个 1.5s 节拍） */
  function enforceV14() {
    try { v14Style(); } catch (e) {}
    try {
      if (typeof ACT === 'object' && ACT &&
          (typeof ACT['v14-term-go'] !== 'function' || !ACT['med-detail'] || !ACT['med-detail'].__v14)) installV14Actions();
      /* 插件上传成功后立刻把新图标同步到桌面，不必等 20 秒轮询 */
      if (typeof ACT === 'object' && ACT && typeof ACT['plg-upload'] === 'function' && !ACT['plg-upload'].__v14) {
        var up = ACT['plg-upload'];
        var wrapped = function (e, d) {
          var r = up.apply(this, arguments);
          setTimeout(function () { try { v14IconsLoad(true); } catch (er) {} }, 1400);
          return r;
        };
        wrapped.__v14 = true; ACT['plg-upload'] = wrapped;
      }
    } catch (e) {}
    try { if (NasDeck.token && Date.now() - V14.fitAt > 900) { V14.fitAt = Date.now(); v14FitWins(); } } catch (e) {}
    try { if (NasDeck.token && !V14.icons.loaded && !V14.icons.loading) v14IconsLoad(); } catch (e) {}
    try { if (NasDeck.token && V14.icons.loaded && Date.now() - V14.icons.at > 20000) v14IconsLoad(true); } catch (e) {}
    try {
      if (DKR.tab === 'diag' && typeof W === 'function' && W('container')) v14TermInit();
      if (DKR.tab === 'containers' && typeof W === 'function' && W('container') && V14.dkr.sel &&
          NasDeck.token && !V14.dkr.busy && Date.now() - V14.dkr.at > 6000) {
        V14.dkr.at = Date.now(); v14CtLoad(V14.dkr.pane, true);
      }
    } catch (e) {}
  }
//__NasDeck_V14_UI_END__
  enforceAll();
  setInterval(enforceAll, 1500);
})();
//__NasDeck_REAL_END__
