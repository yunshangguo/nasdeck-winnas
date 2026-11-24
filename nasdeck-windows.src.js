/* ============================================================
 * NasDeck Windows 原生界面层（由 build.py 注入到主 script）
 * 把 20 个 App 的渲染与动作替换为真实 Windows 数据 / 真实操作。
 * 依赖：NasDeck, RENDER, ACT, esc, glyph, fmtSize, toast, rerender, W ...
 * ============================================================ */
function NasDeck_WIN_INSTALL() {
  const B = NasDeck.boot || {}, CAP = B.capabilities || {};
  NasDeck.win = B.windows || {};
  NasDeck.wsl = B.wsl || {};
  NasDeck.wslExtra = B.wslExtra || {};
  NasDeck.wslTermLines = NasDeck.wslTermLines || [];
  NasDeck.mon = B.monitor || { alerts: [], thresholds: {} };
  NasDeck.backups = B.backups || [];
  NasDeck.btTasks = NasDeck.btTasks || [];
  /* 未登录时 NasDeck.boot 为空，用 probe 阶段拿到的 health.admin 判定，
     避免真实渲染层被"未登录"状态固化成"非管理员"警告。 */
  NasDeck.admin = B.server ? !!(B.server.isAdmin) : !!(NasDeck.health && NasDeck.health.admin);
  NasDeck.tabs = NasDeck.tabs || { cp: 'services', net: 'iface', st: 'disk',
    /* 引擎离线时默认展示 WSL 子系统页（真实发行版 / 端点 / 管理器），
       而不是一张空的容器表 —— 那看起来就像"面板不对"。 */
    ct: ((NasDeck.wsl || {}).available ? 'containers' : 'wsl'), log: 'system', ap: 'installed' };
  NasDeck.winDirty = false;

  /* 防重入：渲染覆盖只安装一次。
     页面加载后会先安装一次（此时还没登录，数据为空但 RENDER 已是真实版），
     登录成功后 NasDeck.install() 再次调用时只刷新数据引用并重绘，
     避免 RENDER 被层层包装导致重复内容。 */
  /* 记录底座 RENDER 引用（仅"包装型"覆盖需要），供重复安装时还原，
     否则第二次安装会把上一次包装后的函数当成底座，产生嵌套重复内容。 */
  if (!NasDeck.__winBaseRender) {
    NasDeck.__winBaseRender = {
      dashboard: RENDER.dashboard, download: RENDER.download,
      filestation: RENDER.filestation, help: RENDER.help
    };
  }

  if (window.__NasDeck_WIN_VIEWS__) {
    /* NasDeck.install() 内 bridge 会先用 v1.0 的 RENDER / widgets 覆盖盖掉
       本层的 v3 增强渲染。这里还原底座引用后完整重装一次，保证登录后
       最终仍是完整的真实渲染层，且不会层层嵌套。 */
    try {
      var base = NasDeck.__winBaseRender;
      Object.keys(base).forEach(function (k) { RENDER[k] = base[k]; });
      window.__NasDeck_WIN_VIEWS__ = false;
      NasDeck_WIN_INSTALL();
    } catch (e) { console.warn('[NasDeck_WIN_INSTALL] re-install:', e.message); }

    /* 延迟到 real / winnas 层的 install 包装完成后再重绘已打开的窗口 */
    setTimeout(function () {
      try {
        if (typeof rerender === 'function') {
          ['dashboard', 'controlpanel', 'storage', 'network', 'container', 'logs', 'about',
            'hbs', 'qufirewall', 'appcenter', 'remotelink', 'download'].forEach(function (k) {
            try { if (typeof W === 'function' && W(k)) rerender(k); } catch (e) {}
          });
        }
      } catch (e) {}
    }, 0);
    return;
  }
  window.__NasDeck_WIN_VIEWS__ = true;

  const E = x => esc(String(x === null || x === undefined ? '' : x));
  const nz = (x, d) => (x === null || x === undefined || x === '' ? (d || 'N/A') : x);
  const F = n => fmtSize(Number(n) || 0);
  const gd = (n, sz, c) => glyph(n, sz || 14, c || 'var(--accent)');
  const bd = (t, c) => '<span class="badge ' + (c || '') + '"><i></i> ' + E(t) + '</span>';
  const bt = (a, label, data, cls, icon) => '<button class="btn sm ' + (cls || '') + '" data-act="' + a + '" ' + (data || '') + '>' + (icon ? gd(icon, 12) + ' ' : '') + E(label) + '</button>';
  const tbl = (heads, rows) => '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + heads.map(h => '<th>' + E(h) + '</th>').join('') + '</tr></thead><tbody>' + (rows.join('') || '<tr><td colspan="' + heads.length + '" class="dim">暂无数据</td></tr>') + '</tbody></table></div>';
  const row = cells => '<tr>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
  const card = (title, inner, right) => '<div class="card"><div class="section-title">' + gd('layers', 14) + E(title) + '<span class="sp"></span>' + (right || '') + '</div>' + inner + '</div>';
  const stat = (l, v, foot, cls) => '<div class="card stat"><span class="lbl">' + E(l) + '</span><span class="val ' + (cls || '') + '">' + v + '</span><span class="foot">' + E(foot) + '</span></div>';
  const shell = (title, icon, badge, actions, inner) => '<div class="app"><div class="toolbar"><div class="mini-title" style="margin:0">' + gd(icon, 15) + E(title) + '</div>' + (badge || '') + '<div class="sp"></div>' + (actions || '') + '</div><div class="app-scroll">' + inner + '</div></div>';
  const refresh = s => bt('win-refresh', '刷新', 'data-s="' + s + '"', '', 'refresh');
  const tabs = (list, cur, act) => '<div class="tabs">' + list.map(t => '<button class="' + (cur === t[0] ? 'on' : '') + '" data-act="' + act + '" data-t="' + t[0] + '">' + E(t[1]) + '</button>').join('') + '</div>';
  const adminWarn = NasDeck.admin ? '' : '<div class="card" style="border-color:var(--warn,#e0a020)"><div class="section-title">' + gd('alert', 14) + '权限提示</div><p class="desc">当前后端非管理员运行，服务启停 / 防火墙规则 / SMB 共享 / 卷影副本等写操作会被系统拒绝。请用「以管理员身份运行」启动 start.bat。</p></div>';
  const WN = () => NasDeck.win || {};

  /* ---------- 弹窗工具 ---------- */
  function nasdeckForm(title, fields, onOK) {
    document.querySelectorAll('.nasdeck-modal').forEach(m => m.remove());
    const d = document.createElement('div');
    d.className = 'modal nasdeck-modal';
    d.innerHTML = '<div class="modal-box" style="max-width:480px"><h3>' + E(title) + '</h3>'
      + fields.map(f => '<div style="margin:9px 0"><label style="display:block;font-size:11px;color:var(--muted);margin-bottom:4px">' + E(f.label) + '</label><input class="inp" data-k="' + E(f.k) + '" value="' + E(f.v || '') + '" placeholder="' + E(f.ph || '') + '" style="width:100%"></div>').join('')
      + '<div class="modal-acts"><button class="btn" data-q="cancel">取消</button><button class="btn primary" data-q="ok">确定</button></div></div>';
    document.body.appendChild(d);
    d.addEventListener('click', ev => {
      const q = ev.target.getAttribute && ev.target.getAttribute('data-q');
      if (!q) return;
      if (q === 'cancel') { d.remove(); return; }
      const o = {};
      d.querySelectorAll('input[data-k]').forEach(i => { o[i.getAttribute('data-k')] = i.value.trim(); });
      d.remove(); try { onOK(o); } catch (e) { toast('操作失败', e.message, 'err'); }
    });
    const first = d.querySelector('input'); if (first) first.focus();
  }
  function nasdeckOut(title, text) {
    document.querySelectorAll('.nasdeck-modal').forEach(m => m.remove());
    const d = document.createElement('div'); d.className = 'modal nasdeck-modal';
    d.innerHTML = '<div class="modal-box" style="max-width:760px"><h3>' + E(title) + '</h3><pre style="max-height:56vh;overflow:auto;background:var(--bg2,#0f1722);padding:12px;border-radius:8px;font:11px/1.5 Consolas,monospace;white-space:pre-wrap;color:var(--fg,#dbe7f3)">' + E(text || '(无输出)') + '</pre><div class="modal-acts"><button class="btn primary" data-q="cancel">关闭</button></div></div>';
    document.body.appendChild(d);
    d.addEventListener('click', ev => { if (ev.target.getAttribute && ev.target.getAttribute('data-q') === 'cancel') d.remove(); });
  }
  async function api(p, body, okMsg) {
    try {
      const r = body === undefined ? await NasDeck.get(p) : await NasDeck.post(p, body);
      if (r && r.error) throw new Error(r.error);
      if (okMsg) toast(okMsg, (r && r.message) || '', 'ok');
      return r;
    } catch (e) { toast('操作失败', e.message, 'err'); return null; }
  }
  async function syncWin() {
    const r = await NasDeck.get('/api/win/snapshot').catch(() => null);
    if (!r) return;
    NasDeck.win = r;
    ['controlpanel', 'qufirewall', 'network', 'storage', 'appcenter', 'remotelink', 'logs', 'dashboard', 'about'].forEach(k => { if (W(k)) rerender(k); });
  }
  NasDeck.syncWin = syncWin;

  /* ============================ 渲染覆盖 ============================ */

  /* 1. 控制台 → Windows 服务 / 计划任务 / 本机用户 */
  RENDER.controlpanel = function () {
    const w = WN(), svcs = w.services || [], tasks = w.tasks || [], users = (w.users || {}).users || [], groups = (w.users || {}).groups || [];
    const running = svcs.filter(s => s.st === 'Running').length, auto = svcs.filter(s => /auto/i.test(s.start || '')).length;
    const t = NasDeck.tabs.cp;
    let inner = '<div class="grid g4" style="margin-bottom:14px">'
      + stat('Windows 服务', svcs.length, '来自 Win32_Service')
      + stat('运行中', running, '实时服务状态', 'ok')
      + stat('已停止', svcs.length - running, '含手动与禁用')
      + stat('自动启动', auto, '开机自启服务') + '</div>' + adminWarn;
    inner += tabs([['services', '服务 (' + svcs.length + ')'], ['tasks', '计划任务 (' + tasks.length + ')'], ['users', '本机用户 (' + users.length + ')']], t, 'win-cp-tab');
    if (t === 'services') {
      const list = (NasDeck.svcFilter ? svcs.filter(s => (s.n + ' ' + s.d).toLowerCase().includes(NasDeck.svcFilter)) : svcs).slice(0, 40);
      inner += card('Windows 服务 · 可真实启停',
        '<div style="display:flex;gap:8px;margin-bottom:10px"><input class="inp" id="nasdeck-svc-q" placeholder="筛选服务名称…" value="' + E(NasDeck.svcFilter || '') + '" style="flex:1">' + bt('win-svc-filter', '筛选') + '</div>'
        + tbl(['服务名', '显示名称', '状态', '启动类型', 'PID', '操作'], list.map(s => row([
          '<b class="mono">' + E(s.n) + '</b>', E(s.d || s.n),
          s.st === 'Running' ? bd('运行中', 'ok') : bd(s.st || 'N/A'),
          E(s.start || 'N/A'), s.pid || 'N/A',
          bt('win-svc', s.st === 'Running' ? '停止' : '启动', 'data-n="' + E(s.n) + '" data-a="' + (s.st === 'Running' ? 'stop' : 'start') + '"')
          + ' ' + bt('win-svc', '重启', 'data-n="' + E(s.n) + '" data-a="restart"')
        ]))));
    } else if (t === 'tasks') {
      inner += card('Windows 计划任务', tbl(['任务名称', '路径', '状态', '上次运行', '结果', '操作'],
        tasks.slice(0, 40).map(x => row([E(x.n), '<span class="mono dim">' + E(x.path) + '</span>',
          bd(x.st || 'N/A', x.st === 'Running' ? 'ok' : ''), E(x.last || 'N/A'), E(x.result),
          bt('win-task', '执行', 'data-n="' + E(x.n) + '" data-a="start"')]))));
    } else {
      inner += card('本机账户', tbl(['用户名', '状态', '描述', '上次登录'], users.map(x => row([
        '<b>' + E(x.n) + '</b>', x.enabled ? bd('已启用', 'ok') : bd('已停用'), E(x.desc || 'N/A'), E(x.last || 'N/A')]))))
        + card('本机群组 (' + groups.length + ')', '<div class="grid g4">' + groups.slice(0, 24).map(g => '<div class="tile"><span class="t">' + E(g.n) + '</span><span class="v" style="font-size:10px">' + E(g.desc || '') + '</span></div>').join('') + '</div>');
    }
    return shell('控制台 · Windows 系统管理', 'settings', bd(NasDeck.admin ? '管理员' : '普通用户', NasDeck.admin ? 'ok' : 'warn'), refresh('services'), inner);
  };

  /* 2. QuFirewall → 真实 Windows Defender 防火墙 */
  RENDER.qufirewall = function () {
    const w = WN(), fw = w.firewall || {}, rules = fw.rules || [], prof = fw.profiles || [], df = w.defender || {};
    const on = prof.filter(p => p.enabled).length;
    let inner = '<div class="grid g4" style="margin-bottom:14px">'
      + stat('防火墙规则总数', fw.total || rules.length, 'Get-NetFirewallRule')
      + stat('已启用规则', rules.length, '本页显示前 ' + rules.length + ' 条')
      + stat('配置文件', on + '/3', 'Domain / Private / Public', on === 3 ? 'ok' : 'warn')
      + stat('Defender 实时防护', df.realtime ? '开启' : '关闭', nz(df.sig, '签名库 —'), df.realtime ? 'ok' : 'warn') + '</div>' + adminWarn;
    inner += card('防火墙配置文件', '<div class="grid g3">' + prof.map(p => '<div class="tile"><span class="t">' + E(p.name) + '</span><span class="v">' + (p.enabled ? '已启用' : '已停用') + '</span><div style="margin-top:8px">' + bt('win-fw-profile', p.enabled ? '停用' : '启用', 'data-n="' + E(p.name) + '" data-v="' + (p.enabled ? '0' : '1') + '"') + '</div></div>').join('') + '</div>');
    inner += card('入站 / 出站规则（真实）', tbl(['规则名称', '方向', '动作', '协议', '端口', '作用域', '操作'],
      rules.slice(0, 50).map(r => row([
        '<b>' + E(r.d || r.n) + '</b>', E(r.dir), r.act === 'Allow' ? bd('允许', 'ok') : bd('阻止', 'err'),
        E(r.proto || 'N/A'), '<span class="mono">' + E(r.port || 'N/A') + '</span>', E(r.profile || 'N/A'),
        bt('win-fw-del', '删除', 'data-n="' + E(r.d || r.n) + '"')
      ]))));
    inner += card('Defender 状态', '<div class="grid g2"><div class="kv"><span class="k">防病毒启用</span><span class="v">' + (df.av ? '是' : '否') + '</span></div><div class="kv"><span class="k">实时保护</span><span class="v">' + (df.realtime ? '是' : '否') + '</span></div><div class="kv"><span class="k">签名版本</span><span class="v mono">' + E(nz(df.sig)) + '</span></div><div class="kv"><span class="k">上次快速扫描</span><span class="v">' + E(nz(df.lastScan)) + '</span></div></div><div style="margin-top:10px">' + bt('win-defender-scan', '启动快速扫描', '', 'primary', 'shield') + '</div>');
    return shell('QuFirewall · Windows 防火墙', 'shield', bd(on === 3 ? '防护中' : '部分关闭', on === 3 ? 'ok' : 'warn'),
      bt('win-fw-add', '新增规则', '', 'primary', 'plus') + refresh('firewall'), inner);
  };

  /* 3. 网络与虚拟交换机 → 真实网卡 / 端口 / 诊断 */
  RENDER.network = function () {
    const w = WN(), ads = w.adapters || [], cn = w.connections || {}, listen = cn.listen || [], virt = ads.filter(a => a.virtual);
    const up = ads.filter(a => a.st === 'Up').length;
    let inner = '<div class="grid g4" style="margin-bottom:14px">'
      + stat('网络接口', ads.length, 'Get-NetAdapter')
      + stat('已连接', up, '状态 Up', 'ok')
      + stat('虚拟适配器', virt.length, 'WSL / Hyper-V / Docker')
      + stat('监听端口', (cn.counts || {}).listen || listen.length, 'TCP Listen') + '</div>';
    inner += tabs([['iface', '实体 / 虚拟网卡'], ['ports', '监听端口'], ['diag', '网络诊断']], NasDeck.tabs.net, 'win-net-tab');
    if (NasDeck.tabs.net === 'iface') {
      inner += card('本机网络适配器', tbl(['接口', '描述', '状态', '链接速度', 'IPv4', 'DNS', 'MAC', '接收 / 发送'],
        ads.map(a => row(['<b>' + E(a.n) + '</b>' + (a.virtual ? ' <span class="badge info"><i></i> 虚拟</span>' : ''),
          '<span class="dim">' + E(a.desc) + '</span>', a.st === 'Up' ? bd('已联机', 'ok') : bd(a.st || 'N/A'),
          E(a.speed), '<span class="mono">' + E(a.ip || 'N/A') + '</span>', '<span class="mono dim">' + E(a.dns || 'N/A') + '</span>',
          '<span class="mono dim">' + E(a.mac) + '</span>', F(a.rx) + ' / ' + F(a.tx)]))));
      inner += card('虚拟交换机说明', '<p class="desc">本机为 Windows 11 家庭版，未启用 Hyper-V 角色，因此没有 NAS 系统意义上的「虚拟交换机」。WSL2 / Docker 使用的虚拟网卡由系统自动创建，已在上表标记为「虚拟」；它们由 WSL 的 NAT 网络管理，不能在此新建 vSwitch。</p>');
    } else if (NasDeck.tabs.net === 'ports') {
      inner += card('TCP 监听端口（真实）', tbl(['本地地址', '端口', '进程', 'PID', '状态'],
        listen.slice(0, 60).map(x => row(['<span class="mono">' + E(x.addr) + '</span>', '<b class="mono">' + E(x.port) + '</b>', E(x.proc), E(x.pid), bd('监听', 'ok')]))));
    } else {
      inner += card('网络诊断', '<div style="display:flex;gap:8px;flex-wrap:wrap">'
        + ['ipconfig', 'ping', 'dns', 'route', 'netstat', 'wifi'].map(a => bt('win-diag', a, 'data-a="' + a + '"')).join('') + '</div>'
        + '<p class="desc" style="margin-top:10px">诊断命令在本机真实执行（ipconfig / ping / route / netstat / netsh wlan）。</p>');
    }
    return shell('网络与虚拟交换机', 'network', bd(up + ' 个接口在线', 'ok'), refresh('adapters'), inner);
  };

  /* 4. 存储与快照 → 真实物理磁盘 / 卷 / VSS */
  RENDER.storage = function () {
    const w = WN(), st = w.storage || {}, phys = st.physical || [], vols = st.volumes || [], smart = st.smart || [], parts = st.partitions || [];
    const vs = w.vss || {}, shadows = vs.shadows || [];
    const total = vols.reduce((a, x) => a + (Number(x.sizeGB) || 0), 0), free = vols.reduce((a, x) => a + (Number(x.freeGB) || 0), 0);
    let inner = '<div class="grid g4" style="margin-bottom:14px">'
      + stat('物理磁盘', phys.length, 'Get-PhysicalDisk')
      + stat('总容量', total.toFixed(0) + '<small>GB</small>', vols.length + ' 个卷')
      + stat('可用空间', free.toFixed(0) + '<small>GB</small>', (total ? (free / total * 100).toFixed(0) : 0) + '% 可用', 'ok')
      + stat('卷影副本', shadows.length, 'VSS 快照') + '</div>';
    inner += tabs([['disk', '物理磁盘'], ['vol', '磁盘卷'], ['snap', '卷影副本'], ['smart', 'SMART']], NasDeck.tabs.st, 'win-st-tab');
    if (NasDeck.tabs.st === 'disk') {
      inner += card('物理磁盘（真实）', tbl(['型号', '介质', '总线', '容量', '健康', '运行状态', '序列号', '分区'],
        phys.map(p => row(['<b>' + E(p.n) + '</b>', E(p.media), E(p.bus), (p.sizeGB || 0) + ' GB',
          p.health === 'Healthy' ? bd('良好', 'ok') : bd(p.health || 'N/A', 'warn'), E(p.op), '<span class="mono dim">' + E(p.serial) + '</span>', E(p.partitions)]))));
    } else if (NasDeck.tabs.st === 'vol') {
      inner += card('磁盘卷（真实）', tbl(['盘符', '标签', '文件系统', '容量', '剩余', '使用率', '健康', '类型'],
        vols.map(v => {
          const sz = Number(v.sizeGB) || 0, fr = Number(v.freeGB) || 0, pct = sz ? (sz - fr) / sz * 100 : 0;
          return row(['<b>' + E(v.drive) + ':</b>', E(v.label || 'N/A'), E(v.fs || 'N/A'), sz + ' GB', fr + ' GB',
            '<div class="prog" style="width:90px"><i style="width:' + pct.toFixed(0) + '%"></i></div> ' + pct.toFixed(0) + '%',
            v.health === 'Healthy' ? bd('良好', 'ok') : E(v.health || 'N/A'), E(v.type || 'N/A')]);
        })));
      inner += card('分区', tbl(['盘符', '磁盘编号', '容量', '类型'], parts.map(p => row([E(p.drive) + ':', E(p.disk), (p.sizeGB || 0) + ' GB', E(p.type)]))));
    } else if (NasDeck.tabs.st === 'snap') {
      inner += card('Windows 卷影副本 (VSS)', (shadows.length ? tbl(['建立时间', '卷', '状态', '持久', '设备对象'], shadows.map(s => row([E(s.date), '<span class="mono">' + E(s.volume) + '</span>', E(s.state), s.persistent ? '是' : '否', '<span class="mono dim">' + E(s.device) + '</span>']))) : '<p class="desc">当前没有卷影副本。可以点右上角「建立快照」为系统卷创建真实 VSS 快照（需要管理员权限）。</p>')
        + '<p class="desc" style="margin-top:10px">RAID 组 / 存储池是 NAS 专属概念，普通 Windows PC 无对应实体；此处展示的是本机 VSS 卷影副本与真实磁盘卷。</p>');
    } else {
      const smartRows = smart.map(x => row([
        '<span class="mono">' + E(x.instance) + '</span>',
        x.predict ? bd('预测故障', 'err') : bd('正常', 'ok'),
        E(x.reason)
      ]));
      inner += card('SMART 故障预测', smart.length
        ? tbl(['磁盘实例', '预测故障', '原因码'], smartRows)
        : '<p class="desc">本机未通过 WMI 暴露 MSStorageDriver_FailurePredictStatus（常见于 NVMe / 第三方驱动）。物理磁盘健康状态请以「物理磁盘」页的 Get-PhysicalDisk HealthStatus 为准。</p>');
    }
    return shell('存储与快照总管', 'database', bd('真实磁盘', 'ok'),
      bt('win-vss-create', '建立快照', '', 'primary', 'plus') + bt('win-st-smart', '刷新 SMART', '', '', 'refresh') + refresh('storage'), inner);
  };

  /* 5. BackupDeck → 真实 robocopy 备份 */
  RENDER.hbs = function () {
    const jobs = NasDeck.backups || [];
    const done = jobs.filter(j => j.st === '完成').length;
    let inner = '<div class="grid g4" style="margin-bottom:14px">'
      + stat('备份任务', jobs.length, 'robocopy 真实执行')
      + stat('已完成', done, '含排程任务', 'ok')
      + stat('引擎', 'robocopy', 'Windows 内置')
      + stat('计划任务', jobs.filter(j => j.schedule).length, 'schtasks 每日排程') + '</div>' + adminWarn;
    inner += card('备份与同步任务', (jobs.length ? jobs.map((j, i) =>
      '<div class="job-card"><div style="display:flex;align-items:center;gap:10px"><div class="nm"><b>' + E(j.n) + '</b><p class="mono dim">' + E(j.src) + ' → ' + E(j.dst) + '</p></div><span class="sp"></span>'
      + bd(j.st, j.st === '完成' ? 'ok' : j.st === '失败' ? 'err' : 'info') + '</div>'
      + '<div class="prog" style="margin-top:9px"><i style="width:' + (j.p || 0) + '%"></i></div>'
      + '<div class="kv"><span class="k">上次执行</span><span class="v">' + E(j.last) + '</span></div>'
      + '<div class="kv"><span class="k">数据量 / 文件</span><span class="v">' + E(j.size) + ' · ' + E(j.files) + ' 个</span></div>'
      + '<div class="kv"><span class="k">排程</span><span class="v">' + E(j.schedule || '未排程') + '</span></div>'
      + (j.err ? '<div class="kv"><span class="k">错误</span><span class="v err">' + E(j.err) + '</span></div>' : '')
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">'
      + bt('win-backup-run', '立即执行', 'data-i="' + i + '"', 'primary', 'play')
      + bt('win-backup-schedule', '每日排程', 'data-i="' + i + '"', '', 'clock')
      + bt('win-backup-log', '查看日志', 'data-i="' + i + '"', '', 'file')
      + bt('win-backup-run', '还原', 'data-i="' + i + '" data-r="1"', '', 'refresh')
      + bt('win-backup-del', '删除任务', 'data-i="' + i + '"', '', 'x') + '</div></div>').join('')
      : '<p class="desc">还没有备份任务。点右上角「建立备份任务」，填写本机真实路径，任务会用 robocopy 真实复制文件。</p>')
      + '<p class="desc" style="margin-top:12px">默认增量复制（/E），不会删除目标端多余文件；选择「镜像」模式才会启用 /PURGE。还原 = 反向 robocopy，执行前请确认路径。</p>');
    return shell('BackupDeck · 混合型备份与同步', 'refresh', bd('真实备份', 'ok'), bt('win-backup-new', '建立备份任务', '', 'primary', 'plus'), inner);
  };

  /* 6. App Center → 真实已安装软件 + winget */
  RENDER.appcenter = function () {
    const w = WN(), apps = w.apps || [], inst = NasDeck.winInstalled || {};
    const t = NasDeck.tabs.ap;
    let inner = '<div class="grid g4" style="margin-bottom:14px">'
      + stat('已安装软件', apps.length, '注册表卸载项')
      + stat('发布者', new Set(apps.map(a => a.pub)).size, '去重统计')
      + stat('包管理器', 'winget', '可真实安装 / 卸载')
      + stat('系统模块', '20', '内置应用', 'ok') + '</div>' + adminWarn;
    inner += tabs([['installed', '本机已安装'], ['winget', 'winget 安装'], ['modules', '系统模块']], t, 'win-ap-tab');
    if (t === 'installed') {
      inner += card('本机已安装程序（真实）', '<div style="display:flex;gap:8px;margin-bottom:10px"><input class="inp" id="nasdeck-app-q" placeholder="筛选软件名称 / 发布者…" style="flex:1">' + bt('win-app-filter', '筛选') + '</div>'
        + tbl(['名称', '版本', '发布者', '安装日期', '占用', '操作'],
          (NasDeck.appFilter ? apps.filter(a => (a.n + ' ' + a.pub).toLowerCase().includes(NasDeck.appFilter)) : apps).slice(0, 50).map(a => row([
            '<b>' + E(a.n) + '</b>', '<span class="mono">' + E(a.ver || 'N/A') + '</span>', E(a.pub || 'N/A'),
            E(a.date || 'N/A'), a.sizeMB ? a.sizeMB + ' MB' : 'N/A',
            bt('win-winget', '卸载', 'data-a="uninstall" data-n="' + E(a.n) + '"')
          ]))));
    } else if (t === 'winget') {
      inner += card('winget 真实安装', '<p class="desc">输入 winget 包 ID（例如 <span class="mono">7zip.7zip</span>、<span class="mono">Mozilla.Firefox</span>），后端会真实执行 <span class="mono">winget install --id ... -e --silent</span>。安装可能需要几十秒。</p><div style="margin-top:10px">' + bt('win-winget-add', '安装 winget 包', '', 'primary', 'plus') + '</div>');
    } else {
      inner += card('系统模块', '<div class="grid g4">' + Object.keys(APPS).map(id => '<div class="tile"><span class="t">' + E(APPS[id].name) + '</span><span class="v" style="font-size:11px">内置 · 已启用</span></div>').join('') + '</div>');
    }
    return shell('App Center', 'grid', bd(apps.length + ' 个软件', 'ok'), refresh('apps'), inner);
  };

  /* 7. 云枢联机 → 本机真实远程访问信息 */
  RENDER.remotelink = function () {
    const w = WN(), ads = w.adapters || [], cn = w.connections || {}, fw = w.firewall || {};
    const ips = ads.filter(a => a.ip && !/^127\./.test(a.ip));
    const prof = fw.profiles || [];
    const s = (B.server || {});
    let inner = '<div class="info-hero" style="margin-bottom:14px"><div>' + gd('cloud', 44, '#fff') + '</div><div><h2>远程联机</h2><p>' + E(s.hostname) + ' · Windows 原生模式<br>云枢联机 云端中继依赖 云端账号，本机版展示真实网络与端口状态。</p></div><div style="flex:1"></div>' + bd('本机联机', 'ok') + '</div>';
    inner += '<div class="grid g4" style="margin-bottom:14px">' + stat('主机名称', '<span style="font-size:16px">' + E(s.hostname) + '</span>', E(s.osCaption || '')) + stat('本机 IPv4', '<span style="font-size:16px">' + E((ips[0] || {}).ip || 'N/A') + '</span>', E((ips[0] || {}).n || '')) + stat('监听端口', (cn.counts || {}).listen || 0, 'TCP Listen') + stat('防火墙', prof.filter(p => p.enabled).length + '/3', '配置文件启用数') + '</div>';
    inner += card('本机访问地址', '<div class="kv"><span class="k">Web 控制台</span><span class="v mono">http://' + E((ips[0] || {}).ip || '127.0.0.1') + ':5080</span></div>'
      + '<div class="kv"><span class="k">绑定地址</span><span class="v mono">127.0.0.1:5080（仅本机）</span></div>'
      + '<div class="kv"><span class="k">域名 / 工作组</span><span class="v">' + E(s.domain || (WN().system || {}).domain || 'WORKGROUP') + '</span></div>'
      + '<div style="margin-top:10px">' + bt('win-copy', '复制联机网址', 'data-v="http://' + E((ips[0] || {}).ip || '127.0.0.1') + ':5080"', 'primary', 'copy') + '</div>'
      + '<p class="desc" style="margin-top:10px">后端默认只绑定 127.0.0.1，不监听局域网。若要从其他设备访问，需自行设 HOST 环境变量并在 Windows 防火墙放行 5080 端口；DDNS / 中继 / 云端账号属 云端专有服务，不在本机实现。</p>');
    inner += card('当前监听端口', tbl(['地址', '端口', '进程', 'PID'], (cn.listen || []).slice(0, 20).map(x => row(['<span class="mono">' + E(x.addr) + '</span>', '<b class="mono">' + E(x.port) + '</b>', E(x.proc), E(x.pid)]))));
    return shell('云枢联机 · 远程联机', 'cloud', '', refresh('adapters'), inner);
  };

  /* 8. 容器工作台 → WSL Docker Engine */
  RENDER.container = function () {
    const w = NasDeck.wsl || {}, cts = w.containers || [], imgs = w.images || [], ep = w.endpoint || {};
    const av = !!w.available, t = NasDeck.tabs.ct;
    const running = cts.filter(c => c.st).length;
    let inner = '<div class="info-hero" style="margin-bottom:14px"><div>' + gd('box', 44, '#fff') + '</div><div><h2>容器工作台 · WSL</h2><p>' + E(w.message || '正在检测…') + '<br>引擎端点 <span class="mono">' + E((ep.host || '127.0.0.1') + ':' + (ep.port || 2375)) + '</span> · 发行版 <span class="mono">' + E(ep.distro || 'Debian') + '</span></p></div><div style="flex:1"></div>' + bd(av ? '引擎已连线' : '引擎未运行', av ? 'ok' : 'warn') + '</div>';
    inner += '<div class="grid g4" style="margin-bottom:14px">'
      + stat('容器总数', cts.length, 'Docker Engine API')
      + stat('运行中', running, 'State=running', 'ok')
      + stat('镜像', imgs.length, '本机镜像库')
      + stat('Engine 版本', '<span style="font-size:18px">' + E(w.version || 'N/A') + '</span>', E(w.kernel || 'N/A')) + '</div>';
    if (!av) {
      inner += card('WSL 容器引擎未上线', '<p class="desc">后端已自动识别你本机 <span class="mono">D:\\WslDockerManager\\config.json</span> 的 WSL Docker 配置，但 <span class="mono">' + E((ep.host || '127.0.0.1') + ':' + (ep.port || 2375)) + '</span> 当前拒绝连接（WSL 内 dockerd 没在跑）。可以：</p>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'
        + bt('wsl-status', '查询 WSL 状态', '', '', 'activity')
        + bt('wsl-engine-start', '启动 WSL 内 dockerd', '', 'primary', 'play')
        + bt('wsl-refresh', '重新探测', '', '', 'refresh')
        + bt('wsl-endpoint', '修改引擎端点', '', '', 'settings') + '</div>'
        + '<p class="desc" style="margin-top:10px">也可以在本机运行 <span class="mono">D:\\WslDockerManager\\restart-backend.bat</span> 或直接 <span class="mono">wsl -d Debian -u root service docker start</span>。引擎上线后本页会自动显示真实容器，绝不编造数据。</p>');
    }
    inner += tabs([['containers', '容器 (' + cts.length + ')'], ['images', '镜像 (' + imgs.length + ')'], ['engine', '引擎信息'], ['wsl', 'WSL 子系统']], t, 'win-ct-tab');
    if (t === 'containers') {
      inner += card('WSL 容器清单', tbl(['名称', '镜像', '状态', '端口映射', 'CPU', '内存', '操作'], cts.map((c, i) => row([
        '<b>' + E(c.n) + '</b><p class="mono dim">' + E(c.id) + '</p>', E(c.img),
        c.st ? bd('执行中', 'ok') : bd(c.state || '已停止'),
        '<span class="mono">' + E(c.port || 'N/A') + '</span>', E(c.cpu), E(c.mem),
        bt('wsl-action', c.st ? '停止' : '启动', 'data-n="' + E(c.id) + '" data-a="' + (c.st ? 'stop' : 'start') + '"')
        + ' ' + bt('wsl-action', '重启', 'data-n="' + E(c.id) + '" data-a="restart"')
        + ' ' + bt('wsl-action', '日志', 'data-n="' + E(c.id) + '" data-a="logs"')
      ]))));
    } else if (t === 'images') {
      inner += card('本机镜像', tbl(['仓库', '标签', 'ID', '大小', '建立日期', '引用容器'], imgs.map(im => row([
        '<b>' + E(im.repo) + '</b>', E(im.tag), '<span class="mono dim">' + E(im.id) + '</span>', E(im.size), E(im.created), E(im.containers)]))));
    } else if (t === 'wsl') {
      /* ---------- WSL 子系统：真实发行版 + 管理器 + 可执行的 WSL 终端 ---------- */
      const ex = NasDeck.wslExtra || {}, ds = w.distros || ex.distros || [], mg = w.manager || ex.manager || {};
      const termLines = NasDeck.wslTermLines || [];
      inner += card('WSL 子系统（真实）', '<p class="desc">' + E(ex.distrosMessage || w.message || 'N/A')
        + '<br>探测来源 <span class="mono">' + E(ex.distrosSource || w.distrosSource || 'N/A') + '</span>'
        + ' · 引擎端点 <span class="mono">' + E((ep.host || '127.0.0.1') + ':' + (ep.port || 2375)) + '</span>'
        + ' · 引擎 ' + (av ? bd('已连线 ' + E(w.version || ''), 'ok') : bd('未运行 / N/A', 'warn')) + '</p>'
        + (ds.length
          ? tbl(['发行版', 'WSL 版本', '运行状态', '安装路径', '默认', '操作'], ds.map(d => row([
              '<b>' + E(d.name) + '</b>', E(d.version || 'N/A'),
              d.state && d.state !== 'N/A' ? bd(E(d.state), /Running/i.test(d.state) ? 'ok' : '') : 'N/A',
              '<span class="mono dim">' + E(d.basePath || 'N/A') + '</span>',
              d.isDefault ? bd('默认', 'ok') : 'N/A',
              bt('wsl-distro', '启动', 'data-n="' + E(d.name) + '" data-a="start"')
              + ' ' + bt('wsl-distro', '停止', 'data-n="' + E(d.name) + '" data-a="terminate"')
              + ' ' + bt('wsl-exec-quick', 'uname', 'data-c="uname -a" data-n="' + E(d.name) + '"')
            ])))
          : '<p class="desc">未检测到 WSL 发行版：<b>N/A</b></p>')
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'
        + bt('wsl-autostart', '启动 Docker 引擎', '', 'primary', 'play')
        + bt('wsl-distro-refresh', '重新枚举发行版', '', '', 'refresh')
        + bt('wsl-manager', '管理器状态 / 日志', '', '', 'activity') + '</div>');

      inner += card('本机 WSL Docker 管理器', '<div class="grid g2">'
        + [['状态', mg.available ? '在线' : '未运行 / N/A'],
           ['端口', mg.port || 'N/A'],
           ['配置发行版', (mg.config || {}).distro || 'N/A'],
           ['引擎端点', mg.config ? ((mg.config.dockerHost || '127.0.0.1') + ':' + (mg.config.dockerPort || 2375)) : 'N/A'],
           ['自动恢复容器', mg.config ? String(mg.config.autostartContainers) : 'N/A'],
           ['重启脚本', mg.restartScript || 'N/A']]
          .map(x => '<div class="kv"><span class="k">' + E(x[0]) + '</span><span class="v mono">' + E(x[1]) + '</span></div>').join('')
        + '</div><p class="desc" style="margin-top:8px">' + E(mg.message || 'N/A') + '</p>');

      const quick = [
        ['uname -a', '系统信息'], ['cat /etc/os-release', '发行版'], ['df -h', '磁盘'],
        ['free -h', '内存'], ['docker ps -a', '容器'], ['docker images', '镜像'],
        ['docker info --format "{{.ServerVersion}}"', 'Engine 版本'], ['ip addr', '网络']
      ];
      inner += card('WSL 终端 · 在 ' + E(ep.distro || 'Debian') + ' 内真实执行',
        '<div style="display:flex;gap:8px;margin-bottom:10px"><input id="wsl-cmd" class="inp" placeholder="输入 Linux 命令，例如 docker ps -a" value="docker ps -a" style="flex:1;min-width:0">'
        + bt('wsl-exec', '执行', '', 'primary', 'play') + bt('wsl-term-clear', '清屏', '', '', 'x') + '</div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">'
        + quick.map(q => bt('wsl-exec-quick', q[1], 'data-c="' + E(q[0]) + '"')).join('') + '</div>'
        + '<pre style="max-height:280px;min-height:120px;overflow:auto;background:var(--bg2,#0f1722);padding:12px;border-radius:8px;font:11px/1.6 Consolas,monospace;white-space:pre-wrap;color:var(--fg,#dbe7f3)">'
        + (termLines.length ? E(termLines.join('\n')) : '（尚无输出 · 点击上方按钮或输入命令后执行）') + '</pre>'
        + '<p class="desc" style="margin-top:8px">命令通过后端 <span class="mono">wsl.exe -d ' + E(ep.distro || 'Debian') + ' -u root -- sh -c</span> 执行，输出为子系统真实回显；执行失败会显示真实错误信息，不做任何模拟。</p>');
    } else {
      const inf = w.info || {};
      inner += card('Docker Engine / WSL 信息', '<div class="grid g2">'
        + [['Server', w.version || 'N/A'], ['API', w.apiVersion || 'N/A'], ['Kernel', w.kernel || 'N/A'],
           ['OS', nz(inf.os, w.os || 'linux')], ['CPU', nz(inf.ncpu, 'N/A')], ['内存', inf.memTotal ? F(inf.memTotal) : 'N/A'],
           ['镜像数', nz(inf.images, imgs.length)], ['运行中容器', nz(inf.running, running)],
           ['存储驱动', nz(inf.driver, 'N/A')], ['根目录', nz(inf.rootDir, 'N/A')]]
          .map(x => '<div class="kv"><span class="k">' + E(x[0]) + '</span><span class="v mono">' + E(x[1]) + '</span></div>').join('') + '</div>');
      if ((w.networks || []).length) inner += card('Docker 网络', tbl(['名称', '驱动', '作用域', 'ID'], w.networks.map(n => row([E(n.n), E(n.driver), E(n.scope), E(n.id)]))));
    }
    const acts = bt('wsl-refresh', '刷新', '', '', 'refresh') + bt('wsl-status', 'WSL 状态', '', '', 'activity')
      + bt('wsl-engine-start', '启动引擎', '', '', 'play') + bt('wsl-endpoint', '端点', '', '', 'settings')
      + bt('wsl-pull', '拉取镜像', '', '', 'download') + bt('wsl-create', '建立容器', '', 'primary', 'plus');
    return shell('容器工作台', 'box', av ? bd('真实容器', 'ok') : bd('离线', 'warn'), acts, inner);
  };

  /* 9. 系统日志 → NasDeck 日志 / Windows 事件 / 监测告警 */
  RENDER.logs = function () {
    const t = NasDeck.tabs.log, ev = WN().events || [], al = NasDeck.mon.alerts || [];
    let inner = '<div class="grid g4" style="margin-bottom:14px">'
      + stat('系统日志', LOGS.length, '后端持久化')
      + stat('Windows 事件', ev.length, 'System / Application')
      + stat('监测告警', al.length, '阈值 + 事件轮询', al.length ? 'warn' : 'ok')
      + stat('告警阈值', 'CPU ' + (NasDeck.mon.thresholds || {}).cpu + '%', '内存 ' + (NasDeck.mon.thresholds || {}).mem + '% · 磁盘 ' + (NasDeck.mon.thresholds || {}).disk + '%') + '</div>';
    inner += tabs([['system', '系统日志'], ['winevent', 'Windows 事件'], ['alerts', '监测告警']], t, 'win-log-tab');
    if (t === 'system') {
      inner += card('系统事件记录', tbl(['时间', '级别', '来源', '内容'], LOGS.slice(-120).reverse().map(l => row([
        '<span class="mono dim">' + E(l.time) + '</span>',
        l.lv === 'ERR' || l.lv === 'CRIT' ? bd(l.lv, 'err') : l.lv === 'WARN' ? bd(l.lv, 'warn') : bd(l.lv || 'INFO', 'ok'),
        E(l.src || 'system'), E(l.msg)]))));
    } else if (t === 'winevent') {
      inner += card('Windows 事件日志（Error / Warning / Critical）', tbl(['时间', '级别', '来源', 'ID', '日志', '内容'], ev.map(e => row([
        '<span class="mono dim">' + E(e.time) + '</span>', e.lv === 'CRIT' ? bd('严重', 'err') : e.lv === 'ERR' ? bd('错误', 'err') : bd('警告', 'warn'),
        E(e.src), E(e.id), E(e.log), E(e.msg)]))));
    } else {
      inner += card('监测告警（真实阈值触发）', (al.length ? al.map(a => '<div class="job-card"><div style="display:flex;align-items:center;gap:10px"><div class="nm"><b>' + E(a.t) + '</b><p>' + E(a.m) + '</p></div><span class="sp"></span>' + bd(a.lv, a.lv === 'CRIT' ? 'err' : 'warn') + '</div><div class="kv"><span class="k">时间 / 来源</span><span class="v">' + E(a.time) + ' · ' + E(a.src) + '</span></div></div>').join('') : '<p class="desc">暂无告警。监测引擎每 2 秒采样 CPU / 内存 / 磁盘 / 温度，每 60 秒轮询 Windows 事件日志。</p>')
        + '<div style="display:flex;gap:8px;margin-top:10px">' + bt('win-mon-threshold', '调整告警阈值', '', '', 'settings') + bt('win-mon-clear', '清空告警', '', '', 'x') + '</div>');
    }
    return shell('系统日志 · 监测中心', 'file', bd('真实事件', 'ok'), bt('win-log-export', '导出日志', '', '', 'download') + bt('win-log-clear', '清空', '', '', 'x') + refresh('events'), inner);
  };

  /* 10. 资源监控：在原有真实数据基础上追加 Windows 进程与告警 */
  const _dash = RENDER.dashboard;
  RENDER.dashboard = function () {
    let h = _dash();
    const procs = (WN().processes || []).slice(0, 12);
    if (procs.length) {
      const t = '<table class="tbl"><thead><tr><th>处理程序</th><th>PID</th><th>内存</th><th>线程</th><th>路径</th></tr></thead><tbody>'
        + procs.map(p => '<tr><td><b>' + E(p.n) + '</b></td><td>' + E(p.pid) + '</td><td>' + F(p.mem) + '</td><td>' + E(p.threads) + '</td><td class="mono dim" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + E(p.path || 'N/A') + '</td></tr>').join('')
        + '</tbody></table>';
      h = h.replace(/<table class="tbl">[\s\S]*?<\/table>/, t);
    }
    const al = (NasDeck.mon.alerts || []).slice(0, 3);
    const extra = '<div class="card" style="margin-top:12px"><div class="section-title">' + gd('activity', 14) + 'Windows 监测引擎<span class="sp"></span><span class="badge ok"><i class="blink"></i> 运行中</span></div>'
      + '<div class="grid g4">' + [['CPU 阈值', (NasDeck.mon.thresholds || {}).cpu + '%'], ['内存阈值', (NasDeck.mon.thresholds || {}).mem + '%'], ['磁盘阈值', (NasDeck.mon.thresholds || {}).disk + '%'], ['未读告警', al.length]]
        .map(x => '<div class="tile"><span class="t">' + E(x[0]) + '</span><span class="v">' + E(x[1]) + '</span></div>').join('') + '</div>'
      + (al.length ? '<div style="margin-top:10px">' + al.map(a => '<div class="wevt warn"><i></i><span>' + E(a.t + ' · ' + a.m) + '</span><time>' + E(String(a.time).slice(-8)) + '</time></div>').join('') + '</div>' : '<p class="desc" style="margin-top:10px">阈值告警、Windows 事件日志轮询、服务状态监测、网卡掉线监测均已启用。</p>') + '</div>';
    return h.replace(/<\/div><\/div>\s*$/, '</div>' + extra + '</div>');
  };

  /* 11. Download Station：追加 aria2 BT 状态 */
  const _dl = RENDER.download;
  RENDER.download = function () {
    const h = _dl();
    const btState = NasDeck.btState || {}, tasks = NasDeck.btTasks || [];
    const btRows = tasks.map(x => row([
      E(x.n), E(x.sz), x.p + '%', E(x.sp), E(x.st),
      bt('bt-action', '暂停', 'data-n="' + E(x.gid) + '" data-a="pause"')
      + ' ' + bt('bt-action', '移除', 'data-n="' + E(x.gid) + '" data-a="remove"')
    ]));
    const extra = '<div class="card" style="margin-top:12px"><div class="section-title">' + gd('download', 14) + 'BT / 磁力引擎 (aria2)<span class="sp"></span>' + bd(btState.available ? '已连线' : '未安装 / 未运行', btState.available ? 'ok' : 'warn') + '</div>'
      + '<p class="desc">' + E(btState.message || '正在检测 aria2 RPC…') + '</p>'
      + '<div style="display:flex;gap:8px;margin:9px 0;flex-wrap:wrap">' + bt('win-http-new', '新增 HTTP 下载', '', '', 'plus') + bt('bt-new', '新增 BT / 磁力任务', '', 'primary', 'plus') + bt('bt-refresh', '刷新', '', '', 'refresh') + bt('bt-config', 'RPC 设置', '', '', 'settings') + '</div>'
      + (tasks.length
        ? tbl(['任务', '大小', '进度', '速度', '状态', '操作'], btRows)
        : '<p class="desc">启用 aria2 RPC 后，magnet: 与 .torrent 任务会在这里显示真实进度。</p>')
      + '</div>';
    return h.replace(/<\/div><\/div>\s*$/, '</div>' + extra + '</div>');
  };

  /* 12. 关于本机：完整 Windows 硬件信息 */
  RENDER.about = function () {
    const s = B.server || {}, sy = WN().system || {}, d = NasDeck.real.disks || [];
    const kv = (k, v) => '<div class="kv"><span class="k">' + E(k) + '</span><span class="v">' + E(nz(v)) + '</span></div>';
    const total = d.reduce((a, x) => a + (x.total || 0), 0);
    let inner = '<div class="info-hero" style="margin-bottom:14px"><div>' + qmark(64) + '</div><div><h2>' + E(s.hostname) + '</h2><p>' + E(s.osCaption || s.osType) + ' · Build ' + E(s.osBuild || s.release) + '<br>NasDeck 2.5 Web · Windows 原生后端 v2.0</p></div><div style="flex:1"></div>' + bd(NasDeck.admin ? '管理员模式' : '普通用户模式', NasDeck.admin ? 'ok' : 'warn') + '</div>';
    inner += '<div class="grid g2" style="margin-bottom:12px"><div class="card"><div class="section-title">处理器与主板</div>'
      + kv('处理器', sy.cpu || s.cpuModel) + kv('核心 / 线程', (sy.cpuCores || s.cores) + ' 核 / ' + (sy.cpuThreads || s.cores) + ' 线程')
      + kv('插槽', sy.cpuSocket) + kv('主板', sy.board) + kv('制造商 / 型号', sy.manufacturer + ' ' + sy.model)
      + kv('BIOS', sy.bios) + kv('序列号', sy.serial) + '</div><div class="card"><div class="section-title">内存与图形</div>'
      + kv('系统内存', F(s.totalMem)) + kv('内存条', (sy.ramSticks || []).map(x => x.capGB + 'GB@' + x.speed).join(' / ') || 'N/A')
      + (sy.gpus || []).map((g, i) => kv('显卡 ' + (i + 1), g.name + ' · 驱动 ' + g.driver + ' · ' + g.res)).join('')
      + kv('磁盘卷', d.length + ' 个 · ' + F(total)) + '</div></div>';
    inner += card('Windows 与运行时', '<div class="grid g2">' + [['操作系统', s.osCaption], ['版本 / Build', s.osVersion + ' / ' + s.osBuild],
      ['架构', s.arch], ['上次启动', sy.lastBoot], ['运行时长', Math.round((s.uptime || 0) / 3600) + ' 小时'],
      ['Node.js', s.node], ['PowerShell', sy.psVersion], ['后端端口', '5080']]
      .map(x => kv(x[0], x[1])).join('') + '</div>');
    inner += card('真实能力矩阵', '<div class="grid g4">' + [
      ['文件总管', '真实'], ['系统监控', '真实'], ['终端机', '真实'], ['HTTP 下载', '真实'],
      ['Windows 服务', '真实'], ['防火墙规则', '真实'], ['SMB 共享', '真实'], ['事件日志', '真实'],
      ['VSS 快照', '真实'], ['计划任务', '真实'], ['winget', '真实'], ['HBS 备份', '真实'],
      ['WSL 容器', NasDeck.wsl.available ? '真实' : '引擎离线'], ['BT / 磁力', 'aria2'], ['RAID', '不适用'], ['云端中继', '不适用']
    ].map(x => '<div class="tile"><span class="t">' + E(x[0]) + '</span><span class="v" style="font-size:12px">' + E(x[1]) + '</span></div>').join('') + '</div>');
    return '<div class="app"><div class="app-scroll">' + inner + '</div></div>';
  };

  /* ============================================================
   * 全站真实化 v3：所有硬件 / 监测数字均来自本机 Windows 采集。
   * 铁律：没有真实读数就显示「—」并说明原因，绝不用占位数值冒充。
   * ============================================================ */
  const HW = () => (WN().hardware || {});
  const SY = () => (WN().system || {});
  const HWSYS = () => (HW().system || {});
  const SENS = () => (HW().sensors || {});
  const STOR = () => (WN().storage || {});
  const ADS = () => (WN().adapters || []);
  const N = (v, d, u) => {
    if (v === null || v === undefined || v === '' || v === 'N/A') return 'N/A';
    const n = Number(v); if (!isFinite(n)) return 'N/A';
    return n.toFixed(d === undefined ? 1 : d) + (u || '');
  };
  const DASH = v => (v === null || v === undefined || v === '' || v === 'N/A') ? 'N/A' : v;
  function uptimeStr(sec) {
    sec = Number(sec || 0); if (!sec || sec < 0) return 'N/A';
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    return (d ? d + ' 天 ' : '') + h + ' 小时 ' + m + ' 分';
  }
  function tempStr() {
    const t = SENS().cpuTempC;
    if (t !== null && t !== undefined && t !== '') return Number(t).toFixed(1) + ' °C';
    const l = NasDeck.latest && NasDeck.latest.temp;
    if (l !== null && l !== undefined && l !== '' && l !== 'N/A' && isFinite(Number(l))) return Number(l).toFixed(1) + ' °C';
    return 'N/A';
  }
  function fanStr() {
    const f = SENS().fans || [];
    return f.length ? f.slice(0, 2).map(x => (Number(x.rpm) || 0) + ' RPM').join(' / ') : 'N/A';
  }
  function realDiskList() {
    const a = Array.isArray(HW().disks) ? HW().disks : [];
    if (a.length) return a.map(d => ({
      model: d.model || 'N/A', sizeGB: Number(d.sizeGB || 0), bus: d.bus || 'N/A', media: d.media || 'N/A',
      health: d.health || 'N/A', serial: d.serial || 'N/A', firmware: d.firmware || 'N/A',
      tempC: (d.tempC === null || d.tempC === undefined) ? null : d.tempC,
      powerOnHours: (d.powerOnHours === null || d.powerOnHours === undefined) ? null : d.powerOnHours,
      reliability: !!d.reliabilityAvailable
    }));
    return (STOR().physical || []).map(d => ({
      model: d.n || 'N/A', sizeGB: Number(d.sizeGB || 0), bus: d.bus || 'N/A', media: d.media || 'N/A',
      health: d.health || 'N/A', serial: d.serial || 'N/A', firmware: 'N/A',
      tempC: null, powerOnHours: null, reliability: false
    }));
  }
  function realVolList() {
    const a = STOR().volumes || [], b = HW().volumes || [];
    const src = a.length ? a : b;
    return src.map(v => ({
      drive: String(v.drive || '').replace(/:$/, '') + ':', label: v.label || 'N/A', fs: v.fs || 'N/A',
      sizeGB: Number(v.sizeGB || 0), freeGB: Number(v.freeGB || 0), health: v.health || 'N/A'
    }));
  }
  function realNic() { const a = ADS(); return a.find(x => /up/i.test(x.st || '')) || a[0] || {}; }
  function realModel() { return HWSYS().model || (B.server || {}).model || (B.server || {}).hostname || 'Windows 主机'; }
  function realHost() { return (B.server || {}).hostname || HW().hostname || 'localhost'; }
  function curNum(k) { const L = NasDeck.latest || {}; const v = (L[k] !== null && L[k] !== undefined) ? L[k] : CUR[k]; return Number(v) || 0; }
  const kv = (k, v) => '<div class="kv"><span class="k">' + E(k) + '</span><span class="v">' + E(DASH(v)) + '</span></div>';

  /* ---------- 1. 资源监控：完全重写，不复用演示版字符串 ---------- */
  RENDER.dashboard = function () {
    const hw = HW(), sy = SY(), hs = HWSYS(), se = SENS();
    const cpus = hw.cpu || {}, mem = hw.memory || {}, bios = hw.bios || {}, osi = hw.os || {};
    const board = hw.board || {}, disks = realDiskList(), vols = realVolList(), nic = realNic();
    const gpus = (hw.gpus || []).filter(g => g.videoProcessor || Number(g.ramGB) > 0);
    const mons = hw.monitors || [], bats = hw.batteries || [];
    const cpuv = curNum('cpu'), memv = curNum('mem'), diskv = curNum('disk');
    const downv = Number((NasDeck.latest || {}).down || 0), upv2 = Number((NasDeck.latest || {}).up || 0);
    const netv = downv + upv2;
    const tstr = tempStr(), fstr = fanStr(), uptime = uptimeStr(osi.uptimeSec);
    const total = vols.reduce((a, v) => a + v.sizeGB, 0), free = vols.reduce((a, v) => a + v.freeGB, 0);
    const cpuName = cpus.name || sy.cpu || (B.server || {}).cpuModel || 'N/A';
    const cores = cpus.cores || sy.cpuCores || (B.server || {}).cores || 'N/A';
    const threads = cpus.threads || sy.cpuThreads || cores;
    const memTotalGB = Number(mem.totalGB || 0) || (((B.server || {}).totalMem || 0) / 1073741824);
    const memUsedGB = memTotalGB * memv / 100;
    const sticks = mem.sticks || [];

    const procRows = (WN().processes || []).slice(0, 12).map(p => row([
      '<b>' + E(p.n) + '</b>', E(p.pid), F(p.mem), E(p.threads),
      '<span class="mono dim" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + E(p.path || 'N/A') + '</span>'
    ]));

    const hwPairs = [
      ['处理器', cpuName], ['核心 / 线程', cores + ' 核 / ' + threads + ' 线程'],
      ['基频 / 当前频率', N((cpus.maxMHz || 0) / 1000, 2, ' GHz') + ' / ' + N((cpus.currentMHz || 0) / 1000, 2, ' GHz')],
      ['L2 / L3 快取', N((cpus.l2KB || 0) / 1024, 1, ' MB') + ' / ' + N((cpus.l3KB || 0) / 1024, 1, ' MB')],
      ['插槽 / 虚拟化', (cpus.socket || 'N/A') + ' / ' + (cpus.virtualization ? '已启用' : '未启用')],
      ['主板', (board.maker || '') + ' ' + (board.product || '') + (board.version ? ' · ' + board.version : '')],
      ['BIOS', (bios.version || 'N/A') + ' · ' + (bios.vendor || '') + ' · ' + (bios.date || 'N/A')],
      ['系统内存', N(memTotalGB, 2, ' GB') + ' · ' + (mem.stickCount || sticks.length || 'N/A') + ' 条'],
      ['内存规格', sticks.length ? ((sticks[0].maker || '') + ' ' + N(sticks[0].capGB, 0, 'GB') + ' × ' + sticks.length + ' @ ' + (sticks[0].speed || 'N/A') + ' MHz') : 'N/A'],
      ['操作系统', (osi.caption || sy.osCaption || 'N/A') + ' · Build ' + (osi.build || sy.osBuild || 'N/A')],
      ['安装日期 / 上次启动', (osi.installDate || 'N/A') + ' / ' + (osi.lastBoot || sy.lastBoot || 'N/A')],
      ['运行时长', uptime], ['主机型号 / 名称', realModel() + ' · ' + realHost()],
      ['主网卡', (nic.n || 'N/A') + ' · ' + (nic.speed || 'N/A') + ' · ' + (nic.ip || 'N/A')]
    ];
    gpus.forEach((g, i) => hwPairs.push(['显卡 ' + (i + 1), g.name + ' · 驱动 ' + (g.driver || 'N/A') + ' · ' + (g.res || 'N/A')]));
    mons.forEach((m, i) => hwPairs.push(['显示器 ' + (i + 1), (m.maker || '') + ' ' + (m.name || '') + ' · ' + (m.width || 'N/A') + '×' + (m.height || 'N/A')]));
    bats.forEach((b, i) => hwPairs.push(['电池 ' + (i + 1), (b.charge == null ? 'N/A' : b.charge + '%') + ' · ' + (Number(b.status) === 2 ? '已接电' : '状态 ' + b.status) + (b.runtimeMin ? ' · 可用 ' + b.runtimeMin + ' 分' : '')]));

    const diskRows = disks.map(d => row([
      '<b>' + E(d.model) + '</b>', E(d.bus), E(d.media), N(d.sizeGB, 1, ' GB'),
      /healthy/i.test(String(d.health)) ? bd('良好', 'ok') : E(d.health),
      d.tempC === null ? '<span class="dim">驱动未暴露</span>' : N(d.tempC, 0, ' °C'),
      d.powerOnHours === null ? '<span class="dim">—</span>' : E(d.powerOnHours) + ' h',
      '<span class="mono dim">' + E(d.serial) + '</span>'
    ]));
    const volRows = vols.map(v => {
      const pct = v.sizeGB ? (v.sizeGB - v.freeGB) / v.sizeGB * 100 : 0;
      return row(['<b>' + E(v.drive) + '</b>', E(v.label), E(v.fs), N(v.sizeGB, 1, ' GB'), N(v.freeGB, 1, ' GB'),
        '<div class="prog" style="width:88px"><i style="width:' + pct.toFixed(0) + '%"></i></div> ' + pct.toFixed(0) + '%']);
    });

    const al = (NasDeck.mon.alerts || []).slice(0, 3);
    const th = NasDeck.mon.thresholds || {};
    const monInner = '<div class="grid g4">'
      + stat('CPU 阈值', N(th.cpu, 0, '%'), '连续 3 次触发')
      + stat('内存阈值', N(th.mem, 0, '%'), '连续 2 次触发')
      + stat('磁盘阈值', N(th.disk, 0, '%'), '空间告警')
      + stat('未读告警', (NasDeck.mon.alerts || []).length, '真实事件 / 服务 / 网卡', (NasDeck.mon.alerts || []).length ? 'warn' : 'ok')
      + '</div>' + (al.length ? '<div style="margin-top:10px">' + al.map(a => '<div class="wevt warn"><i></i><span>' + E(a.t + ' · ' + a.m) + '</span><time>' + E(String(a.time).slice(-8)) + '</time></div>').join('') + '</div>' : '<p class="desc" style="margin-top:10px">阈值告警、Windows 事件日志轮询、服务状态监测、网卡掉线监测均已启用。</p>');

    return '<div class="app"><div class="toolbar">'
      + '<div class="mini-title" style="margin:0">' + gd('activity', 15, 'var(--accent)') + '资源监控</div>'
      + '<span class="badge ok"><i class="blink"></i> Windows 实时</span>'
      + '<span class="muted" style="font-size:10.5px">每 2 秒 · ' + E(realHost()) + '</span><div class="sp"></div>'
      + bt('win-hw-refresh', '重新采集硬件', '', 'primary', 'refresh') + '</div><div class="app-scroll">'
      + '<div class="grid g4" style="margin-bottom:14px">'
      + '<div class="card stat"><span class="lbl">CPU 使用率</span><span class="val" id="rm-cpu">' + cpuv.toFixed(0) + '<small>%</small></span><span class="foot">' + E(String(cpuName).slice(0, 24)) + ' · ' + E(cores) + '核/' + E(threads) + '线程</span></div>'
      + '<div class="card stat"><span class="lbl">内存使用率</span><span class="val" id="rm-mem">' + memv.toFixed(0) + '<small>%</small></span><span class="foot" id="rm-mem-foot">' + memUsedGB.toFixed(1) + ' / ' + memTotalGB.toFixed(1) + ' GB</span></div>'
      + '<div class="card stat"><span class="lbl">网络吞吐</span><span class="val" id="rm-net">' + netv.toFixed(2) + '<small>MB/s</small></span><span class="foot">' + E(nic.n || 'N/A') + ' · ' + E(nic.speed || 'N/A') + '</span></div>'
      + '<div class="card stat"><span class="lbl">磁盘已用</span><span class="val" id="rm-disk">' + diskv.toFixed(0) + '<small>%</small></span><span class="foot" id="rm-disk-foot">' + (total - free).toFixed(0) + ' / ' + total.toFixed(0) + ' GB · ' + vols.length + ' 个卷</span></div></div>'
      + '<div class="card"><div class="section-title">CPU / 内存 · 最近 60 秒<span class="sp"></span><span class="legend" style="margin:0"><span><i style="background:#3fc4ee"></i>CPU %</span><span><i style="background:#f2b34a"></i>内存 %</span></span></div><div class="rm-chart" id="rm-chart-cpu">' + dualLine(METRIC.cpu.slice(-40), METRIC.mem.slice(-40), '#3fc4ee', '#f2b34a') + '</div></div>'
      + '<div class="card"><div class="section-title">网络吞吐量 · 最近 60 秒<span class="sp"></span><span class="legend" style="margin:0"><span><i style="background:#39d8a8"></i>MB/s</span></span></div><div class="rm-chart" id="rm-chart-net" style="height:100px">' + line(METRIC.net.slice(-40), '#39d8a8') + '</div></div>'
      + '<div class="grid g2" style="margin-top:12px"><div class="card"><div class="section-title">系统负载</div><div class="rm-gauge"><div class="rm-ring"><svg viewBox="0 0 104 104"><circle cx="52" cy="52" r="44" fill="none" stroke="var(--card2)" stroke-width="9"/><circle id="rm-ring-c" cx="52" cy="52" r="44" fill="none" stroke="var(--accent)" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + (cpuv / 100 * 276) + ' 276"/></svg><div class="lbl"><b id="rm-ring-v">' + cpuv.toFixed(0) + '%</b><small>CPU</small></div></div>'
      + '<div class="rm-legend">'
      + '<div>' + gd('cpu', 14, 'var(--muted)') + '处理器 <b>' + E(cores + ' 核 / ' + threads + ' 线程') + '</b></div>'
      + '<div>' + gd('memory', 14, 'var(--muted)') + '内存 <b>' + E(memTotalGB.toFixed(1) + ' GB · ' + (mem.stickCount || sticks.length || 'N/A') + ' 条') + '</b></div>'
      + '<div>' + gd('thermo', 14, 'var(--muted)') + 'CPU 温度 <b id="rm-temp">' + E(tstr) + '</b></div>'
      + '<div>' + gd('fan', 14, 'var(--muted)') + '系统风扇 <b>' + E(fstr) + '</b></div>'
      + '<div>' + gd('clock', 14, 'var(--muted)') + '正常运行 <b>' + E(uptime) + '</b></div></div></div></div>'
      + '<div class="card"><div class="section-title">处理程序（依内存排序 · 真实进程）</div>' + tbl(['处理程序', 'PID', '内存', '线程', '路径'], procRows) + '</div></div>'
      + '<div style="margin-top:12px">' + card('硬件清单 · 本机真实采集', '<div class="grid g2">' + hwPairs.map(x => kv(x[0], x[1])).join('') + '</div>') + '</div>'
      + '<div style="margin-top:12px">' + card('物理磁盘与卷 · Get-PhysicalDisk / Get-Volume',
          tbl(['型号', '总线', '介质', '容量', '健康', '温度', '通电时数', '序列号'], diskRows)
          + '<div style="height:12px"></div>'
          + tbl(['盘符', '标签', '文件系统', '容量', '剩余', '使用率'], volRows)) + '</div>'
      + '<div style="margin-top:12px">' + card('传感器与监测状态', '<div class="grid g4">'
          + stat('CPU 温度', tstr, se.cpuTempSource || '本机传感器', tstr === 'N/A' ? '' : 'ok')
          + stat('系统风扇', fstr, (se.fans || []).length ? 'WMI / LHM' : '本机未暴露')
          + stat('磁盘温度', se.diskTempAvailable ? '可读' : '不可读', 'Storage Reliability Counter', se.diskTempAvailable ? 'ok' : '')
          + stat('传感器', se.supported ? '可用' : '未暴露', 'WMI / ACPI / LHM', se.supported ? 'ok' : '')
          + '</div><p class="desc" style="margin-top:10px">' + E(se.note || '传感器读数由本机 WMI 采集') + '</p>') + '</div>'
      + '<div style="margin-top:12px">' + card('Windows 监测引擎', monInner) + '</div>'
      + '</div></div>';
  };

  /* ---------- 2. 2 秒增量刷新：只更新真实数值，不重建 DOM ---------- */
  refreshDashboardLive = function () {
    const set = (q, v) => { const e = document.querySelector(q); if (e) e.innerHTML = v; };
    const cpuv = curNum('cpu'), memv = curNum('mem'), diskv = curNum('disk');
    const L = NasDeck.latest || {}, netv = Number(L.down || 0) + Number(L.up || 0);
    set('#rm-cpu', cpuv.toFixed(0) + '<small>%</small>');
    set('#rm-mem', memv.toFixed(0) + '<small>%</small>');
    set('#rm-net', netv.toFixed(2) + '<small>MB/s</small>');
    set('#rm-disk', diskv.toFixed(0) + '<small>%</small>');
    set('#rm-chart-cpu', dualLine(METRIC.cpu.slice(-40), METRIC.mem.slice(-40), '#3fc4ee', '#f2b34a'));
    set('#rm-chart-net', line(METRIC.net.slice(-40), '#39d8a8'));
    set('#rm-ring-v', cpuv.toFixed(0) + '%');
    set('#rm-temp', E(tempStr()));
    const c = document.querySelector('#rm-ring-c'); if (c) c.setAttribute('stroke-dasharray', (cpuv / 100 * 276) + ' 276');
    const mt = Number((HW().memory || {}).totalGB || 0) || (((B.server || {}).totalMem || 0) / 1073741824);
    const mf = document.querySelector('#rm-mem-foot'); if (mf && mt) mf.textContent = (mt * memv / 100).toFixed(1) + ' / ' + mt.toFixed(1) + ' GB';
    const vs = realVolList(), tt = vs.reduce((a, v) => a + v.sizeGB, 0), ff = vs.reduce((a, v) => a + v.freeGB, 0);
    const df = document.querySelector('#rm-disk-foot'); if (df && tt) df.textContent = (tt - ff).toFixed(0) + ' / ' + tt.toFixed(0) + ' GB · ' + vs.length + ' 个卷';
  };

  /* ---------- 3. 右侧小工具：全部真实 ---------- */
  renderWidgets = function () {
    const w = document.getElementById('widgets'); if (!w) return;
    const hw = HW(), sy = SY(), se = SENS(), nic = realNic();
    const cpus = hw.cpu || {}, mem = hw.memory || {}, vols = realVolList(), disks = realDiskList();
    const cpuv = curNum('cpu'), memv = curNum('mem');
    const total = vols.reduce((a, v) => a + v.sizeGB, 0), free = vols.reduce((a, v) => a + v.freeGB, 0);
    const pct = total ? (total - free) / total * 100 : 0;
    const mt = Number(mem.totalGB || 0) || (((B.server || {}).totalMem || 0) / 1073741824);
    const mu = mt * memv / 100;
    const L = NasDeck.latest || {};
    const alerts = (NasDeck.mon.alerts || []).length;
    const evts = (LOGS || []).slice(-4).reverse().map(l =>
      '<div class="wevt ' + (l.lv === 'ERROR' || l.lv === 'WARN' || l.lv === 'ERR' ? 'warn' : '') + '"><i></i><span>' + E(String(l.msg || '').slice(0, 22)) + '</span><time>' + E(String(l.time || '').slice(-5)) + '</time></div>').join('');
    w.innerHTML = ''
      + '<div class="wcard"><h4>系统健康 <b>' + (alerts ? '● ' + alerts + ' 则告警' : '● 正常') + '</b></h4>'
      + '<div class="wbig" id="w-cpu">' + cpuv.toFixed(0) + '<small>%</small></div>'
      + '<div class="wlabel">CPU 使用率 · ' + E(String(cpus.name || sy.cpu || 'N/A').slice(0, 22)) + '</div>'
      + '<div class="prog"><i id="w-cpu-bar" style="width:' + cpuv + '%"></i></div>'
      + '<svg class="spark" id="w-spark" viewBox="0 0 220 38" preserveAspectRatio="none"></svg>'
      + '<div class="wkv" style="border-top:1px solid var(--line);padding-top:8px"><span>核心 / 温度</span><b id="w-temp">' + E((cpus.cores || sy.cpuCores || 'N/A') + '核/' + (cpus.threads || sy.cpuThreads || 'N/A') + '线程 · ' + tempStr()) + '</b></div></div>'
      + '<div class="wcard"><h4>内存 <span id="w-mem-v">' + memv.toFixed(0) + '%</span></h4>'
      + '<div class="wbig" id="w-mem-big">' + mu.toFixed(1) + '<small>/ ' + mt.toFixed(1) + ' GB</small></div>'
      + '<div class="prog ok"><i id="w-mem-bar" style="width:' + memv + '%"></i></div>'
      + '<div class="wkv"><span>已用 / 可用</span><b id="w-mem-kv">' + mu.toFixed(1) + ' / ' + (mt - mu).toFixed(1) + ' GB</b></div>'
      + '<div class="wkv"><span>内存条</span><b>' + E((mem.stickCount || (mem.sticks || []).length || 'N/A') + ' 条') + '</b></div></div>'
      + '<div class="wcard"><h4>存储空间 <span>' + vols.length + ' 个真实卷</span></h4>'
      + '<div class="wbig">' + (total - free).toFixed(0) + '<small> GB / ' + total.toFixed(0) + ' GB</small></div>'
      + '<div class="prog warn"><i style="width:' + pct.toFixed(0) + '%"></i></div>'
      + '<div class="wkv"><span>已用 ' + pct.toFixed(0) + '%</span><b>剩余 ' + free.toFixed(0) + ' GB</b></div>'
      + '<div class="wkv"><span>物理磁盘</span><b class="ok">' + E(disks.length + ' 块 · ' + (disks[0] ? String(disks[0].model).slice(0, 16) : 'N/A')) + '</b></div></div>'
      + '<div class="wcard"><h4>网络流量 <span>' + E(nic.n || '网卡') + '</span></h4>'
      + '<svg class="spark" id="w-net" viewBox="0 0 220 38" preserveAspectRatio="none"></svg>'
      + '<div class="wkv"><span>↓ 下载</span><b id="w-down">' + Number(L.down || 0).toFixed(2) + ' MB/s</b></div>'
      + '<div class="wkv"><span>↑ 上传</span><b id="w-up">' + Number(L.up || 0).toFixed(2) + ' MB/s</b></div>'
      + '<div class="wkv"><span>IP / 链路</span><b>' + E((nic.ip || 'N/A') + ' · ' + (nic.speed || 'N/A')) + '</b></div></div>'
      + '<div class="wcard"><h4>最近事件 <span>真实系统日志</span></h4>' + (evts || '<div class="wevt"><i></i><span>暂无事件</span><time>—</time></div>') + '</div>';
    updateWidgets();
  };
  updateWidgets = function () {
    const sp = document.getElementById('w-spark'), nt = document.getElementById('w-net');
    if (sp) sp.innerHTML = line(METRIC.cpu.slice(-22), '#3fc4ee');
    if (nt) nt.innerHTML = line(METRIC.net.slice(-22), '#39d8a8');
    const cpuv = curNum('cpu'), memv = curNum('mem'), L = NasDeck.latest || {};
    const a = document.getElementById('w-cpu'); if (a) a.innerHTML = cpuv.toFixed(0) + '<small>%</small>';
    const bar = document.getElementById('w-cpu-bar'); if (bar) bar.style.width = cpuv + '%';
    const mv = document.getElementById('w-mem-v'); if (mv) mv.textContent = memv.toFixed(0) + '%';
    const mb = document.getElementById('w-mem-bar'); if (mb) mb.style.width = memv + '%';
    const mt = Number((HW().memory || {}).totalGB || 0) || (((B.server || {}).totalMem || 0) / 1073741824);
    if (mt) {
      const mu = mt * memv / 100;
      const big = document.getElementById('w-mem-big'); if (big) big.innerHTML = mu.toFixed(1) + '<small>/ ' + mt.toFixed(1) + ' GB</small>';
      const k = document.getElementById('w-mem-kv'); if (k) k.textContent = mu.toFixed(1) + ' / ' + (mt - mu).toFixed(1) + ' GB';
    }
    const d = document.getElementById('w-down'); if (d) d.textContent = Number(L.down || 0).toFixed(2) + ' MB/s';
    const u = document.getElementById('w-up'); if (u) u.textContent = Number(L.up || 0).toFixed(2) + ' MB/s';
    const t = document.getElementById('w-temp');
    if (t) t.textContent = ((HW().cpu || {}).cores || (SY().cpuCores) || 'N/A') + '核/' + ((HW().cpu || {}).threads || (SY().cpuThreads) || 'N/A') + '线程 · ' + tempStr();
  };

  /* ---------- 4. 关于本机：完整真实硬件清单 ---------- */
  RENDER.about = function () {
    const hw = HW(), sy = SY(), hs = HWSYS(), se = SENS();
    const cpus = hw.cpu || {}, mem = hw.memory || {}, board = hw.board || {}, bios = hw.bios || {}, osi = hw.os || {};
    const disks = realDiskList(), vols = realVolList(), nic = realNic();
    const gpus = (hw.gpus || []).filter(g => g.videoProcessor || Number(g.ramGB) > 0);
    const pairs = [
      ['主机名称', realHost()], ['制造商 / 型号', (hs.maker || '') + ' ' + (hs.model || '')],
      ['处理器', cpus.name || sy.cpu], ['核心 / 线程', (cpus.cores || 'N/A') + ' 核 / ' + (cpus.threads || 'N/A') + ' 线程'],
      ['基频', N((cpus.maxMHz || 0) / 1000, 2, ' GHz')], ['插槽', cpus.socket],
      ['L2 / L3 快取', N((cpus.l2KB || 0) / 1024, 1, ' MB') + ' / ' + N((cpus.l3KB || 0) / 1024, 1, ' MB')],
      ['主板', (board.maker || '') + ' ' + (board.product || '')], ['BIOS', (bios.version || 'N/A') + ' · ' + (bios.date || 'N/A')],
      ['主板序号', board.serial], ['系统内存', N(mem.totalGB, 2, ' GB') + ' · ' + (mem.stickCount || 'N/A') + ' 条'],
      ['内存型号', (mem.sticks || []).length ? ((mem.sticks[0].maker || '') + ' ' + (mem.sticks[0].part || '') + ' @ ' + (mem.sticks[0].speed || 'N/A') + ' MHz') : 'N/A'],
      ['操作系统', osi.caption || sy.osCaption], ['版本 / Build', (osi.version || 'N/A') + ' / ' + (osi.build || 'N/A')],
      ['安装日期', osi.installDate], ['上次启动', osi.lastBoot || sy.lastBoot], ['运行时长', uptimeStr(osi.uptimeSec)],
      ['主网卡', (nic.n || 'N/A') + ' · ' + (nic.speed || 'N/A') + ' · ' + (nic.ip || 'N/A')],
      ['物理磁盘', disks.length + ' 块 · ' + N(disks.reduce((a, d) => a + d.sizeGB, 0), 1, ' GB')],
      ['磁盘卷', vols.length + ' 个 · ' + N(vols.reduce((a, v) => a + v.sizeGB, 0), 1, ' GB')],
      ['CPU 温度', tempStr()], ['系统风扇', fanStr()],
      ['Node.js', (B.server || {}).node || 'N/A'], ['后端', 'Windows 原生 v2.0 · 端口 5080']
    ];
    gpus.forEach((g, i) => pairs.push(['显卡 ' + (i + 1), g.name + ' · ' + (g.driver || 'N/A') + ' · ' + (g.res || 'N/A')]));
    (hw.monitors || []).forEach((m, i) => pairs.push(['显示器 ' + (i + 1), (m.maker || '') + ' ' + (m.name || '') + ' · ' + (m.width || 'N/A') + '×' + (m.height || 'N/A')]));
    (hw.batteries || []).forEach((b, i) => pairs.push(['电池 ' + (i + 1), (b.charge == null ? 'N/A' : b.charge + '%') + ' · ' + (Number(b.status) === 2 ? '已接电' : '状态 ' + b.status)]));
    return '<div class="app"><div class="app-scroll"><div class="info-hero" style="margin-bottom:14px"><div>' + qmark(64) + '</div>'
      + '<div><h2>' + E(realModel()) + '</h2><p>' + E(osi.caption || sy.osCaption || 'Windows') + ' · Build ' + E(osi.build || sy.osBuild || 'N/A')
      + '<br>NasDeck 2.5 Web · Windows 原生后端 · 全部硬件数据真实采集</p></div><div style="flex:1"></div>'
      + bd(NasDeck.admin ? '管理员模式' : '普通用户模式', NasDeck.admin ? 'ok' : 'warn') + '</div>'
      + '<div style="margin-bottom:12px">' + card('本机硬件（CIM / Get-PhysicalDisk 实时采集）', '<div class="grid g2">' + pairs.map(x => kv(x[0], x[1])).join('') + '</div>') + '</div>'
      + '<div style="margin-bottom:12px">' + card('传感器状态', '<p class="desc">' + E(se.note || '传感器读数由本机 WMI 采集') + '</p>'
        + '<div class="grid g4">' + stat('CPU 温度', tempStr(), se.cpuTempSource || '本机', tempStr() === 'N/A' ? '' : 'ok')
        + stat('风扇', fanStr(), 'Win32_Fan') + stat('磁盘温度', se.diskTempAvailable ? '可读' : '未暴露', 'Reliability Counter')
        + stat('热区', (se.thermalZones || []).length, 'ACPI ThermalZone') + '</div>') + '</div>'
      + card('能力矩阵', '<div class="grid g4">' + [
        ['CPU / 内存', '实时'], ['物理磁盘 / 卷', '真实'], ['SMART 健康', '真实'], ['网络链路', '真实'],
        ['服务 / 防火墙', '真实'], ['事件日志', '真实'], ['进程表', '真实'], ['阈值告警', '真实'],
        ['VSS 快照', '真实'], ['HBS 备份', 'robocopy'], ['WSL 容器', NasDeck.wsl.available ? '真实' : '引擎离线'],
        ['温度 / 风扇', se.supported ? '真实' : '本机未暴露'], ['RAID', 'Windows 无实体'], ['云端中继', '不适用']
      ].map(x => '<div class="tile"><span class="t">' + E(x[0]) + '</span><span class="v" style="font-size:12px">' + E(x[1]) + '</span></div>').join('') + '</div>')
      + '</div></div>';
  };

  /* ---------- 5. 其余页面里的假硬件文案 ---------- */
  const _fsr = RENDER.filestation;
  RENDER.filestation = function () {
    let h = _fsr.apply(this, arguments);
    const vols = realVolList(), total = vols.reduce((a, v) => a + v.sizeGB, 0), free = vols.reduce((a, v) => a + v.freeGB, 0);
    const pct = total ? (total - free) / total * 100 : 0;
    h = h.replace('DataVol1 <span class="badge ok">正常</span>', E(vols.length + ' 个本机卷 <span class="badge ok">真实</span>'));
    h = h.replace('<i style="width:84%"></i>', '<i style="width:' + pct.toFixed(0) + '%"></i>');
    h = h.replace('18.4 / 21.8 TB 已使用', (total - free).toFixed(0) + ' / ' + total.toFixed(0) + ' GB 已使用');
    h = h.replace('文件总管 · 支持拖放上传（演示）', '文件总管 · 真实 Windows 文件系统');
    return h;
  };
  const _hpr = RENDER.help;
  RENDER.help = function () {
    let h = _hpr.apply(this, arguments);
    h = h.replace('本页面为 NasDeck NasDeck Web 界面演示，所有硬件数据均为模拟数据。', '本页所有硬件与监测数据均由本机 Windows 实时采集；未暴露的传感器会明确标示，不使用模拟值。');
    h = h.replace('NasDeck 本机环境中的 Safari / 浏览器应用只渲染本地页面，外部链接请在新标签页开启。', '内嵌浏览器受目标站点 X-Frame-Options / CSP 限制，外部链接请在本机浏览器开启。');
    return h;
  };

  /* ---------- 6. 静态文案清理（只改文本节点，不破坏 DOM） ---------- */
  function scrubDemoText() {
    const model = realModel(), host = realHost(), disks = realDiskList();
    const up = uptimeStr((HW().os || {}).uptimeSec);
    const pairs = [
      ['NasDeck 2.5.0 · 4 Bay · 正常运行 26 天 14 小时', 'Windows 本机 · ' + disks.length + ' 块物理磁盘 · 运行 ' + up],
      ['快速设置 · Windows 本机', '快速设置 · ' + host],
      ['按 Enter 或点击箭头解锁 · 演示环境密码任意', '按 Enter 或点击箭头解锁'],
      ['本页面为 NasDeck NasDeck Web 界面演示，所有硬件数据均为模拟数据。', '本页所有硬件与监测数据均由本机 Windows 实时采集。'],
      ['文件总管 · 支持拖放上传（演示）', '文件总管 · 真实 Windows 文件系统'],
      ['（演示环境）', '（本机真实执行）'],
      ['演示环境不包含外部链接，请使用本机浏览器访问 NasDeck 项目页', '外部链接请在本机浏览器开启'],
      ['演示环境不修改实际系统配置', '该项为界面偏好设置'],
      ['演示条目', '未安装的应用'],
      ['演示模式不会修改数据', 'Windows VSS 还原请在本机执行'],
      ['所有硬件数据均为模拟数据', '所有硬件数据均为真实采集'],
      ['演示环境', '本机 Windows'],
      ['Windows 本机', model], ['LOCAL-NAS', host]
    ];
    try {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
      for (const n of nodes) {
        let v = n.nodeValue; if (!v) continue;
        for (const p of pairs) if (v.indexOf(p[0]) >= 0) v = v.split(p[0]).join(p[1]);
        if (v !== n.nodeValue) n.nodeValue = v;
      }
    } catch (e) {}
    const tip = document.querySelector('.lg-tip');
    if (tip) tip.innerHTML = 'Windows 本机 · 账号 <b>admin</b>，密码 <b>admin</b>（需先运行 start.bat 启动后端）';
  }
  NasDeck.scrubDemoText = scrubDemoText;
  scrubDemoText();
  try { const _mm = renderMM; renderMM = function () { const r = _mm.apply(this, arguments); scrubDemoText(); return r; }; } catch (e) {}
  try { const _rc = renderCtrl; renderCtrl = function () { const r = _rc.apply(this, arguments); scrubDemoText(); return r; }; } catch (e) {}
  try { const _rn = renderNoti; renderNoti = function () { const r = _rn.apply(this, arguments); scrubDemoText(); return r; }; } catch (e) {}
  try { const _rr = rerender; rerender = function () { const r = _rr.apply(this, arguments); setTimeout(scrubDemoText, 0); return r; }; } catch (e) {}
  setInterval(scrubDemoText, 4000);

  /* ---------- 7. 清掉演示期残留的假通知 / 假日志 / 假快照 ---------- */
  try {
    const fake = /ST8000VN|DataVol1|qulogd|192\.168\.1\.88|磁盘 3 温度|Windows 本机|RS-1221\+/;
    if (Array.isArray(NOTIS)) for (let i = NOTIS.length - 1; i >= 0; i--)
      if (fake.test(String(NOTIS[i].t || '') + String(NOTIS[i].p || ''))) NOTIS.splice(i, 1);
    if (Array.isArray(LOGS)) for (let i = LOGS.length - 1; i >= 0; i--)
      if (fake.test(String(LOGS[i].msg || ''))) LOGS.splice(i, 1);
    if (Array.isArray(SNAPS)) SNAPS.length = 0;
  } catch (e) {}

  /* ---------- 8. 演示动作 → 真实或明确说明 ---------- */
  ACT['win-hw-refresh'] = async () => {
    toast('正在采集', '重新读取本机 CPU / 内存 / 磁盘 / 传感器', 'info');
    const r = await api('/api/win/refresh', { section: 'hardware' });
    if (r && r.data) { NasDeck.win.hardware = r.data.data || r.data; }
    const snap = await NasDeck.get('/api/win/snapshot').catch(() => null);
    if (snap) NasDeck.win = snap;
    scrubDemoText();
    if (W('dashboard')) rerender('dashboard');
    if (W('about')) rerender('about');
    renderWidgets();
    toast('硬件已刷新', '全部读数已重新从本机采集', 'ok');
  };
  ACT['st-restore'] = () => toast('快照还原', 'Windows VSS 还原需在本机用 vssadmin / 磁盘管理执行', 'warn');
  ACT['cp-action'] = (e, d) => toast('设置项目', ((d && d.v) || '') + ' · 界面偏好保存在本机', '');
  ACT['help-link'] = (e, d) => toast((d && d.v) || '外部链接', '请在本机浏览器开启', 'warn');
  ACT['log-export'] = () => {
    const rows = [['时间', '等级', '来源', '内容']].concat((LOGS || []).map(l => [l.time, l.lv, l.src, l.msg]));
    const csv = rows.map(r => r.map(x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'nasdeck-logs.csv'; a.click();
    toast('日志已导出', '真实系统日志 ' + (LOGS || []).length + ' 条', 'ok');
  };
  ACT['about-license'] = () => {
    const rec = W('about'); if (!rec) return;
    infoModal(rec, '本机系统信息', '<div class="kv"><span class="k">主机</span><span class="v">' + E(realHost()) + '</span></div>'
      + '<div class="kv"><span class="k">型号</span><span class="v">' + E(realModel()) + '</span></div>'
      + '<div class="kv"><span class="k">系统</span><span class="v">' + E((HW().os || {}).caption || SY().osCaption || 'Windows') + '</span></div>'
      + '<div class="kv"><span class="k">后端</span><span class="v">NasDeck 2.5 Web · Windows 原生 v2.0</span></div>');
  };

  /* ---------- 9. 硬件数据到达后自动重绘 ---------- */
  NasDeck.syncWin = async function () {
    const r = await NasDeck.get('/api/win/snapshot').catch(() => null);
    if (!r) return;
    const had = !!(NasDeck.win.hardware && NasDeck.win.hardware.cpu);
    NasDeck.win = r;
    ['controlpanel', 'qufirewall', 'network', 'storage', 'appcenter', 'remotelink',
      'logs', 'dashboard', 'about', 'filestation', 'help'].forEach(k => { if (W(k)) rerender(k); });
    renderWidgets(); scrubDemoText();
    if (!had && NasDeck.win.hardware && NasDeck.win.hardware.cpu) toast('硬件已就绪', '已读取本机真实 CPU / 内存 / 磁盘信息', 'ok');
  };

  /* winready / 所有 win-* 动作调用的是词法绑定 syncWin，必须一起指向新逻辑 */
  syncWin = async function () { await NasDeck.syncWin(); };

  /* ============================ 动作 ============================ */
  const set = (k, fn) => { ACT[k] = fn; };

  set('win-refresh', async (e, d) => {
    const s = d.s || 'services';
    toast('正在刷新', '读取真实 Windows 数据：' + s, 'info');
    await api('/api/win/refresh', { section: s });
    await syncWin();
  });
  ['win-cp-tab', 'win-net-tab', 'win-st-tab', 'win-ct-tab', 'win-log-tab', 'win-ap-tab'].forEach(k => {
    const key = { 'win-cp-tab': 'cp', 'win-net-tab': 'net', 'win-st-tab': 'st', 'win-ct-tab': 'ct', 'win-log-tab': 'log', 'win-ap-tab': 'ap' }[k];
    const id = { 'win-cp-tab': 'controlpanel', 'win-net-tab': 'network', 'win-st-tab': 'storage', 'win-ct-tab': 'container', 'win-log-tab': 'logs', 'win-ap-tab': 'appcenter' }[k];
    set(k, (e, d) => { NasDeck.tabs[key] = d.t; rerender(id); });
  });
  set('win-svc-filter', () => { NasDeck.svcFilter = (document.getElementById('nasdeck-svc-q') || {}).value || ''; rerender('controlpanel'); });
  set('win-app-filter', () => { NasDeck.appFilter = (document.getElementById('nasdeck-app-q') || {}).value || ''; rerender('appcenter'); });
  set('win-svc', async (e, d) => {
    const r = await api('/api/win/service', { name: d.n, act: d.a }, '服务操作完成');
    if (r) { await syncWin(); }
  });
  set('win-task', async (e, d) => { await api('/api/win/task', { name: d.n, act: d.a }, '计划任务已触发'); await syncWin(); });
  set('win-fw-profile', async (e, d) => { await api('/api/win/firewall/profile', { name: d.n, enabled: d.v === '1' }); await syncWin(); });
  set('win-fw-add', () => nasdeckForm('新增 Windows 防火墙规则', [
    { k: 'name', label: '规则名称', v: 'NasDeck Web Rule', ph: '只允许字母数字与 - _ .' },
    { k: 'dir', label: '方向 Inbound / Outbound', v: 'Inbound' },
    { k: 'action', label: '动作 Allow / Block', v: 'Block' },
    { k: 'proto', label: '协议 TCP / UDP / Any', v: 'TCP' },
    { k: 'port', label: '本地端口（可留空，例 8080 或 8000-8100）', v: '' },
    { k: 'remote', label: '远程地址（Any 或 IP/CIDR）', v: 'Any' }
  ], async o => { if (!o.name) return; const r = await api('/api/win/firewall/rule', Object.assign({ act: 'add' }, o), '规则已创建'); if (r) await syncWin(); }));
  set('win-fw-del', (e, d) => nasdeckForm('删除防火墙规则', [{ k: 'name', label: '确认规则名称', v: d.n }], async o => {
    const r = await api('/api/win/firewall/rule', { act: 'delete', name: o.name }, '规则已删除'); if (r) await syncWin();
  }));
  set('win-defender-scan', async () => { await api('/api/win/defender/scan', {}, '快速扫描已启动'); });
  set('win-vss-create', () => nasdeckForm('建立 VSS 卷影副本', [{ k: 'volume', label: '卷标（例 C:）', v: 'C:' }], async o => {
    toast('正在建立快照', 'vssadmin create shadow 可能需要 10-60 秒', 'info');
    const r = await api('/api/win/vss/create', { volume: o.volume || 'C:' }, '快照建立完成'); if (r) { NasDeck.tabs.st = 'snap'; await syncWin(); rerender('storage'); }
  }));
  set('win-st-smart', async () => { NasDeck.tabs.st = 'smart'; await api('/api/win/refresh', { section: 'storage' }); await syncWin(); rerender('storage'); });
  set('win-diag', async (e, d) => { toast('正在执行', d.a, 'info'); const r = await api('/api/win/diag?act=' + encodeURIComponent(d.a)); if (r) nasdeckOut('网络诊断 · ' + d.a, r.out); });
  set('win-copy', (e, d) => { try { navigator.clipboard.writeText(d.v); toast('已复制', d.v, 'ok'); } catch (er) { toast('复制失败', '', 'err'); } });
  set('win-winget-add', () => nasdeckForm('winget 安装软件', [{ k: 'id', label: 'winget 包 ID', v: '7zip.7zip', ph: '例如 Mozilla.Firefox' }], async o => {
    if (!o.id) return; toast('正在安装', o.id + ' · 可能需要几十秒', 'info');
    const r = await api('/api/win/winget', { act: 'install', id: o.id }, '安装命令已执行'); if (r) await syncWin();
  }));
  set('win-winget', (e, d) => nasdeckForm(d.a === 'uninstall' ? 'winget 卸载' : 'winget 操作', [
    { k: 'id', label: 'winget 包 ID（注册表名称不一定等于包 ID）', v: '' }
  ], async o => { if (!o.id) return; const r = await api('/api/win/winget', { act: d.a || 'uninstall', id: o.id }, '命令已执行'); if (r) await syncWin(); }));
  set('win-mon-threshold', () => nasdeckForm('监测告警阈值 (%)', [
    { k: 'cpu', label: 'CPU 使用率', v: (NasDeck.mon.thresholds || {}).cpu || 85 },
    { k: 'mem', label: '内存使用率', v: (NasDeck.mon.thresholds || {}).mem || 90 },
    { k: 'disk', label: '磁盘使用率', v: (NasDeck.mon.thresholds || {}).disk || 90 },
    { k: 'temp', label: '温度 (°C)', v: (NasDeck.mon.thresholds || {}).temp || 80 }
  ], async o => {
    const r = await api('/api/monitor/thresholds', { cpu: +o.cpu, mem: +o.mem, disk: +o.disk, temp: +o.temp }, '阈值已更新');
    if (r) { NasDeck.mon.thresholds = r.thresholds; rerender('logs'); if (W('dashboard')) rerender('dashboard'); }
  }));
  set('win-mon-clear', async () => { await api('/api/monitor/alerts/clear', {}, '告警已清空'); NasDeck.mon.alerts = []; rerender('logs'); });
  set('win-log-export', () => { location.href = NasDeck.withToken('/api/logs/export'); toast('导出中', '系统日志已开始下载', 'ok'); });
  set('win-log-clear', async () => { await api('/api/logs/clear', {}, '日志已清空'); LOGS.length = 0; rerender('logs'); });

  /* HBS 备份 */
  set('win-backup-new', () => nasdeckForm('建立真实备份任务 (robocopy)', [
    { k: 'name', label: '任务名称', v: '本机备份' },
    { k: 'src', label: '源目录（本机绝对路径）', v: 'C:\\Users\\' + (B.user || 'admin') + '\\Documents', ph: 'C:\\Users\\...\\Documents' },
    { k: 'dst', label: '目标目录（本机绝对路径）', v: 'D:\\NasDeckBackup', ph: 'D:\\NasDeckBackup' },
    { k: 'mode', label: '模式 incremental / mirror', v: 'incremental' }
  ], async o => {
    const r = await api('/api/backups/create', o, '备份任务已建立');
    if (r) { NasDeck.backups = r.jobs; rerender('hbs'); }
  }));
  set('win-backup-run', async (e, d) => {
    const j = NasDeck.backups[+d.i]; if (!j) return;
    const r = await api('/api/backups/run', { id: j.id, restore: d.r === '1' }, '备份任务已启动');
    if (r) { NasDeck.backups = r.jobs; rerender('hbs'); }
  });
  set('win-backup-del', async (e, d) => { const j = NasDeck.backups[+d.i]; if (!j) return; const r = await api('/api/backups/remove', { id: j.id }, '任务已删除'); if (r) { NasDeck.backups = r.jobs; rerender('hbs'); } });
  set('win-backup-schedule', (e, d) => nasdeckForm('每日定时备份 (schtasks)', [{ k: 'at', label: '执行时间 HH:MM', v: '03:00' }], async o => {
    const j = NasDeck.backups[+d.i]; if (!j) return;
    const r = await api('/api/backups/schedule', { id: j.id, at: o.at }, '已建立 Windows 计划任务'); if (r) { NasDeck.backups = r.jobs; rerender('hbs'); }
  }));
  set('win-backup-log', (e, d) => { const j = NasDeck.backups[+d.i]; if (j) nasdeckOut('备份日志 · ' + j.n, j.log || '(暂无输出)'); });

  /* WSL 容器 */
  async function wslSync() {
    const r = await NasDeck.get('/api/wsl/snapshot').catch(() => null);
    if (!r) return;
    NasDeck.wsl = r; NasDeck.fill(CONTAINERS, r.containers || []);
    if (W('container')) rerender('container');
  }
  set('wsl-refresh', async () => { toast('正在探测', 'WSL Docker Engine…', 'info'); await api('/api/wsl/endpoint', { host: (NasDeck.wsl.endpoint || {}).host, port: (NasDeck.wsl.endpoint || {}).port }); await wslSync(); toast('探测完成', NasDeck.wsl.message || '', NasDeck.wsl.available ? 'ok' : 'warn'); });
  set('wsl-status', async () => { toast('查询中', '读取 WSL 发行版状态', 'info'); const r = await api('/api/wsl/status'); if (r) nasdeckOut('WSL 状态', '=== wsl -l -v ===\n' + (r.listOutput || '') + '\n\n=== wsl --status ===\n' + (r.statusOutput || '') + '\n\n=== wsl --version ===\n' + (r.versionOutput || '') + '\n\n=== 引擎 ===\n' + JSON.stringify(r.engine, null, 2) + '\n\n' + (r.message || '')); });
  set('wsl-engine-start', async () => { toast('启动中', '在 WSL 发行版内启动 dockerd…', 'info'); const r = await api('/api/wsl/engine/start', {}, '引擎状态'); if (r) { await wslSync(); nasdeckOut('启动 WSL Docker 引擎', (r.out || '') + '\n\n' + (r.message || '')); } });
  set('wsl-endpoint', () => nasdeckForm('Docker Engine 端点', [
    { k: 'host', label: '主机', v: (NasDeck.wsl.endpoint || {}).host || '127.0.0.1' },
    { k: 'port', label: '端口', v: (NasDeck.wsl.endpoint || {}).port || 2375 },
    { k: 'distro', label: 'WSL 发行版', v: (NasDeck.wsl.endpoint || {}).distro || 'Debian' }
  ], async o => { await api('/api/wsl/endpoint', { host: o.host, port: +o.port, distro: o.distro }, '端点已更新'); await wslSync(); }));
  set('wsl-create', () => nasdeckForm('建立 WSL 容器', [
    { k: 'image', label: '镜像', v: 'nginx:alpine', ph: 'nginx:alpine' },
    { k: 'name', label: '容器名称（可留空）', v: '' },
    { k: 'ports', label: '端口映射（例 8080:80，逗号分隔）', v: '' },
    { k: 'cmd', label: '启动命令（可留空）', v: '' }
  ], async o => { if (!o.image) return; toast('创建中', o.image, 'info'); const r = await api('/api/wsl/create', o, '容器已建立'); if (r) await wslSync(); }));
  set('wsl-pull', () => nasdeckForm('拉取镜像', [{ k: 'image', label: '镜像名', v: 'alpine:latest' }], async o => {
    if (!o.image) return; toast('拉取中', o.image, 'info'); const r = await api('/api/wsl/pull', o, '拉取完成'); if (r) await wslSync();
  }));
  /* WSL 子系统动作 */
  set('wsl-distro-refresh', async () => {
    toast('枚举中', '读取 WSL 发行版与管理器状态', 'info');
    const r = await api('/api/wsl/distros', undefined);
    if (r) {
      NasDeck.wslExtra = Object.assign(NasDeck.wslExtra || {}, {
        distros: r.distros || [], distrosOk: r.ok, distrosSource: r.source,
        distrosMessage: r.message
      });
      NasDeck.wsl = Object.assign(NasDeck.wsl || {}, { distros: r.distros || [], distrosSource: r.source });
      NasDeck.tabs.ct = 'wsl'; rerender('container');
      toast('枚举完成', r.message || '', r.ok ? 'ok' : 'warn');
    }
  });
  set('wsl-distro', async (e, d) => {
    toast('执行中', 'WSL 发行版 ' + d.n + ' ' + d.a, 'info');
    const r = await api('/api/wsl/distro', { name: d.n, act: d.a }, '发行版操作完成');
    if (r) nasdeckOut('WSL 发行版 · ' + d.n, (r.out || '') + '\n\n' + (r.error || ''));
    await ACT['wsl-distro-refresh']();
  });
  set('wsl-manager', async () => {
    const r = await api('/api/wsl/manager', undefined);
    if (r) nasdeckOut('WSL Docker 管理器',
      '状态: ' + (r.message || 'N/A') + '\n端口: ' + (r.port || 'N/A') +
      '\n配置: ' + JSON.stringify(r.config || {}, null, 2) +
      '\n重启脚本: ' + (r.restartScript || 'N/A') +
      '\n\n=== wsl-docker.log 末尾 ===\n' + (r.logTail || 'N/A'));
  });
  set('wsl-autostart', async () => {
    toast('启动中', '在 WSL 内拉起 dockerd（可能需要 10–30 秒）', 'info');
    const r = await api('/api/wsl/autostart', {}, '引擎启动流程结束');
    if (r) {
      await wslSync();
      nasdeckOut('启动 WSL Docker 引擎', (r.steps || []).join('\n') + '\n\n' + (r.message || ''));
    }
  });
  async function wslRunCmd(cmd, distro) {
    if (!cmd) return;
    NasDeck.wslTermLines = NasDeck.wslTermLines || [];
    NasDeck.wslTermLines.push('$ ' + cmd);
    if (NasDeck.tabs.ct === 'wsl') rerender('container');
    const r = await api('/api/wsl/exec', {
      cmd, distro: distro || (NasDeck.wsl.endpoint || {}).distro || 'Debian', root: true
    });
    NasDeck.wslTermLines.push(r
      ? ((r.out || '') + (r.err ? '\n[stderr] ' + r.err : '') + (r.ok ? '' : '\n[执行失败]'))
      : '[请求失败 / N/A]');
    if (NasDeck.wslTermLines.length > 120) NasDeck.wslTermLines.splice(0, NasDeck.wslTermLines.length - 120);
    NasDeck.tabs.ct = 'wsl'; rerender('container');
  }
  set('wsl-exec', () => {
    const i = document.querySelector('#wsl-cmd');
    wslRunCmd(i ? i.value.trim() : '', (NasDeck.wsl.endpoint || {}).distro);
  });
  set('wsl-exec-quick', (e, d) => wslRunCmd(d.c, d.n || (NasDeck.wsl.endpoint || {}).distro));
  set('wsl-term-clear', () => { NasDeck.wslTermLines = []; NasDeck.tabs.ct = 'wsl'; rerender('container'); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target && e.target.id === 'wsl-cmd') {
      e.preventDefault();
      wslRunCmd(String(e.target.value || '').trim(), (NasDeck.wsl.endpoint || {}).distro);
    }
  });

  set('wsl-action', async (e, d) => {
    const r = await api('/api/wsl/action', { id: d.n, act: d.a }, '容器操作完成');
    if (r) { await wslSync(); if (r.out && d.a === 'logs') nasdeckOut('容器日志 · ' + d.n, r.out); }
  });
  /* 覆盖旧的容器动作 */
  set('ct-toggle', async (e, d) => { const c = CONTAINERS[+d.i]; if (!c || !c.id) { toast('引擎未就绪', NasDeck.wsl.message || '', 'warn'); return; } await ACT['wsl-action'](e, { n: c.id, a: c.st ? 'stop' : 'start' }); });
  set('ct-new', () => ACT['wsl-create']());
  set('ct-logs', async (e, d) => { const c = CONTAINERS[+d.i]; if (c && c.id) await ACT['wsl-action'](e, { n: c.id, a: 'logs' }); });
  /* 覆盖旧快照 / 备份 / 防火墙 / 下载新增动作 */
  set('st-snapshot', () => ACT['win-vss-create']());
  set('st-scan', () => ACT['win-st-smart']());
  set('st-restore', () => toast('快照还原', 'Windows VSS 还原需通过「磁盘管理 / vssadmin」操作，此处不自动覆盖卷。', 'warn'));
  set('st-cache', () => toast('SSD 快取', 'Windows 无 SSD 快取实体；本机 NVMe 磁盘信息见「物理磁盘」页。', 'warn'));
  set('hbs-new', () => ACT['win-backup-new']());
  set('hbs-run', (e, d) => ACT['win-backup-run'](e, d));
  set('fw-add', () => ACT['win-fw-add']());
  set('fw-toggle', () => { toast('防火墙开关', '请使用本页「防火墙配置文件」的真实开关（Set-NetFirewallProfile）。', 'info'); });
  set('win-http-new', () => {
    const rec = W('download'); if (!rec) return;
    askModal(rec, '新增 HTTP / HTTPS 下载', '输入文件直链', 'https://', async v => {
      if (!v) return;
      const r = await api('/api/downloads/add', { url: v }, '下载已开始');
      if (r) { NasDeck.fillDLS(r.downloads || []); rerender('download'); }
    });
  });
  set('cp-action', (e, d) => toast('控制台', 'Windows 原生设置请在「服务 / 计划任务 / 本机用户」页操作。', 'info'));
  set('cp-scan', async () => { await api('/api/win/defender/scan', {}, 'Defender 快速扫描已启动'); });
  set('cp-newuser', () => toast('建立使用者', '本机用户管理请通过 Windows「计算机管理 → 本地用户和组」。', 'info'));
  set('log-export', () => ACT['win-log-export']());
  set('log-clear', () => ACT['win-log-clear']());
  set('power-cancel', async () => { await api('/api/power', { cancel: true }, '已取消电源操作'); });

  /* BT / 磁力 */
  set('bt-new', () => nasdeckForm('新增 BT / 磁力下载', [
    { k: 'url', label: 'magnet: 链接或 .torrent URL', v: '', ph: 'magnet:?xt=urn:btih:...' },
    { k: 'name', label: '保存文件名（可留空）', v: '' }
  ], async o => { if (!o.url) return; const r = await api('/api/downloads/add', o, 'BT 任务已添加'); if (r) { NasDeck.btTasks = r.tasks || []; rerender('download'); } }));
  set('bt-action', async (e, d) => { const r = await api('/api/bt/action', { gid: d.n, act: d.a }, 'BT 任务操作完成'); if (r) { NasDeck.btTasks = r.tasks || []; rerender('download'); } });
  set('bt-config', () => nasdeckForm('aria2 RPC 设置', [
    { k: 'host', label: '主机', v: (NasDeck.btState || {}).endpoint ? String((NasDeck.btState || {}).endpoint).split(':')[0] : '127.0.0.1' },
    { k: 'port', label: '端口', v: '6800' }, { k: 'secret', label: 'RPC secret（可留空）', v: '' }
  ], async o => { await api('/api/bt/config', { host: o.host, port: +o.port, secret: o.secret }, 'RPC 配置已保存'); await ACT['bt-refresh'](); }));
  set('bt-refresh', async () => {
    const [st, li] = await Promise.all([NasDeck.get('/api/bt/status').catch(() => ({})), NasDeck.get('/api/bt/list').catch(() => ({}))]);
    NasDeck.btState = st; NasDeck.btTasks = li.tasks || []; if (W('download')) rerender('download');
  });
  /* 等拿到有效 token 再拉 BT 状态：未登录时发请求会 401，也会污染控制台 */
  setTimeout(function tryBtRefresh() {
    if (!NasDeck.token) { setTimeout(tryBtRefresh, 1500); return; }
    try { ACT['bt-refresh'](); } catch (e) {}
  }, 1200);

  /* ============================ SSE 扩展（只包装一次） ============================ */
  if (!NasDeck.__winSseWrapped) {
    NasDeck.__winSseWrapped = true;
    const _connect = NasDeck.connect;
    NasDeck.connect = function () {
    _connect.call(this);
    const es = this.es; if (!es) return;
    const on = (name, fn) => es.addEventListener(name, ev => { try { fn(JSON.parse(ev.data)); } catch (e) {} });
    on('winready', async () => { await syncWin(); renderWidgets(); });
    on('windows', r => { if (r && r.section) { NasDeck.win[r.section] = r.data; ['controlpanel', 'qufirewall', 'network', 'storage', 'appcenter', 'logs'].forEach(k => { if (W(k)) rerender(k); }); } });
    on('wsl', r => { NasDeck.wsl = r; NasDeck.fill(CONTAINERS, r.containers || []); if (W('container')) rerender('container'); });
    on('wslstate', () => wslSync());
    on('alert', a => { NasDeck.mon.alerts = [a].concat(NasDeck.mon.alerts || []).slice(0, 60); if (W('logs')) rerender('logs'); if (W('dashboard')) rerender('dashboard'); toast(a.t, a.m, a.lv === 'CRIT' ? 'err' : 'warn'); });
    on('alerts', r => { NasDeck.mon.alerts = r.alerts || []; if (W('logs')) rerender('logs'); });
    on('services', r => { NasDeck.win.services = r.services; if (W('controlpanel')) rerender('controlpanel'); });
    on('firewall', r => { NasDeck.win.firewall = r; if (W('qufirewall')) rerender('qufirewall'); });
    on('shares', r => { NasDeck.win.shares = r.shares || r; });
    on('apps', r => { NasDeck.win.apps = r.apps || r; if (W('appcenter')) rerender('appcenter'); });
    on('vss', r => { NasDeck.win.vss = r; if (W('storage')) rerender('storage'); });
    on('winevents', r => { NasDeck.win.events = r.events; if (W('logs')) rerender('logs'); });
    on('backups', r => { NasDeck.backups = r.jobs || []; if (W('hbs')) rerender('hbs'); });
    on('docker', r => { NasDeck.wsl = Object.assign(NasDeck.wsl || {}, r); NasDeck.fill(CONTAINERS, r.containers || []); if (W('container')) rerender('container'); });
    };
  }

  /* 顶栏补充真实状态与电源取消入口 */
  const s = B.server || {};
  const tn = document.querySelector('.tb-name');
  if (tn) tn.textContent = s.hostname + ' · Windows 原生';
  const sty = document.createElement('style');
  sty.id = 'nasdeck-win-term-style';
  const oldSty = document.getElementById(sty.id); if (oldSty) oldSty.remove();
  sty.textContent = '.term .cmd::before{content:"' + ((S.user || 'admin') + '@' + (s.hostname || 'WIN')).replace(/["\\]/g, '') + ' C:\\> " !important;color:#3aa8e0}'
    + '.card .job-card{margin-bottom:10px}.modal-box input.inp{box-sizing:border-box}';
  document.head.appendChild(sty);

  /* Windows 事件日志并入系统日志视图的数据源（不改动 LOGS 本体）
     未登录时不发请求：inject 层若提前安装，此处会在登录前执行。 */
  if (NasDeck.token) syncWin();
  addNotiSafe('Windows 原生模式', '服务 / 防火墙 / 事件日志 / VSS / winget / WSL 容器已接入真实系统。');
  function addNotiSafe(t, m) { try { if (typeof NOTIS !== 'undefined' && NOTIS.length < 4) NOTIS.unshift({ t, p: m, k: 'info', time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), u: 1 }); } catch (e) {} }
}
