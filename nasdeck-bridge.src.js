//__NasDeck_BRIDGE_START__
/* ==================================================================
 * NasDeck Bridge — 把 NasDeck 2.5 Web 前端接到真实后端
 * 由 build.py 注入 index.html 的主 <script> 内，与主逻辑共享词法作用域。
 * 无后端时自动进入 demo 模式，界面行为与原始版本完全一致。
 * ================================================================== */
const NasDeck = {
  mode: 'demo', base: '', token: '', boot: null, real: null, latest: null,
  es: null, installed: false, autoLogin: false, mediaEmpty: false,
  searchCache: null, EXPLICIT: new Set(), ORIG: {},

  hdr() { return this.token ? { 'X-NasDeck-Token': this.token } : {}; },
  withToken(u) { return this.token ? u + (u.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(this.token) : u; },
  readToken() { try { return localStorage.getItem('nasdeck61_token') || ''; } catch (e) { return ''; } },
  saveToken(t) { try { localStorage.setItem('nasdeck61_token', t); } catch (e) {} },
  clearToken() { this.token = ''; try { localStorage.removeItem('nasdeck61_token'); } catch (e) {} },

  async probe() {
    const list = [];
    if (location.protocol === 'http:' || location.protocol === 'https:') list.push('');
    list.push('http://127.0.0.1:5080', 'http://localhost:5080');
    for (const b of list) {
      try {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 5000);
        const r = await fetch(b + '/api/health', { signal: ctl.signal });
        clearTimeout(to);
        if (r.ok) {
          const j = await r.json();
          if (j.ok && Number(j.api) >= 1) { this.base = b; this.mode = 'live'; this.health = j; return true; }
        }
      } catch (e) {}
    }
    return false;
  },
  async request(p, opt) {
    opt = opt || {};
    const h = Object.assign({}, this.hdr());
    let body;
    if (opt.raw) body = opt.body;
    else { h['Content-Type'] = 'application/json'; body = opt.body === undefined ? undefined : JSON.stringify(opt.body); }
    const r = await fetch(this.base + p, { method: opt.method || 'GET', headers: h, body });
    const txt = await r.text();
    let j;
    try { j = JSON.parse(txt); } catch (e) { throw new Error('服务器返回异常：' + txt.slice(0, 120)); }
    if (!r.ok) {
      if (r.status === 401 && p !== '/api/auth/login') { this.clearToken(); }
      throw new Error(j.error || ('HTTP ' + r.status));
    }
    return j;
  },
  get(p) { return this.request(p); },
  post(p, b) { return this.request(p, { method: 'POST', body: b || {} }); },
  put(p, b) { return this.request(p, { method: 'PUT', body: b, raw: true }); },
  async session() {
    if (!this.token) return null;
    try { const j = await this.get('/api/auth/session'); return j.authenticated ? j : null; }
    catch (e) { return null; }
  },
  async loadBoot() {
    try { const b = await this.get('/api/bootstrap'); if (b && b.mode === 'live') { this.boot = b; return true; } }
    catch (e) {}
    return false;
  },

  fill(arr, items) { arr.length = 0; (items || []).forEach(x => arr.push(x)); },
  obj(target, src) { Object.keys(target).forEach(k => delete target[k]); Object.assign(target, src || {}); },
  child(p, n) { return (p === '/' ? '' : p) + '/' + n; },
  applyFiles(r) {
    if (!r) return;
    if (r.path && r.entries) FS[r.path] = r.entries;
    if (r.files && r.files.path && r.files.entries) FS[r.files.path] = r.files.entries;
    rerender('filestation');
  },
  fillDLS(list) { this.fill(DLS, list || []); },
  fillBIN(list) { this.fill(BIN, list || []); },

  /* ---------------- 数据水合：把模拟数据换成真实数据 ---------------- */
  hydrate(b) {
    this.obj(S, Object.assign({}, S, {
      theme: b.settings.theme || S.theme, wall: b.settings.wall || S.wall,
      accent: b.settings.accent || S.accent, bright: b.settings.bright ?? S.bright,
      volume: b.settings.volume ?? S.volume, widgets: b.settings.widgets !== false,
      user: b.user
    }));
    try {
      localStorage.setItem('nasdeck61_state', JSON.stringify({
        theme: S.theme, wall: S.wall, accent: S.accent, bright: S.bright,
        volume: S.volume, wifi: S.wifi, night: S.night, widgets: S.widgets
      }));
    } catch (e) {}

    this.obj(FS, b.fs || {});
    FS_STATE.path = b.fsPath || '/Public'; FS_STATE.hist = []; FS_STATE.sel = -1;
    this.obj(METRIC, b.metrics || METRIC);
    this.obj(CUR, b.cur || CUR);
    this.fill(CONTAINERS, b.containers);
    this.fill(DLS, b.downloads);
    this.fill(BIN, b.bin);
    this.fill(NOTIS, b.notis);
    this.obj(APPS_INSTALLED, b.installed || APPS_INSTALLED);
    this.fill(DISKS, b.disks);
    this.fill(LOGS, b.logs);
    this.fill(FS_TREE, b.fsTree);
    if (b.fwRules) this.fill(FW_RULES, b.fwRules);
    if (b.fw) this.obj(FW, b.fw);
    if (b.cloud) this.obj(CLOUD, b.cloud);
    if (b.cp) this.obj(CP, b.cp);
    if (b.net) this.obj(NET, b.net);
    if (b.hbs) this.fill(HBS_JOBS, b.hbs);

    // 媒体：某一类没有真实文件时保留演示占位，避免空数组导致除零/渲染异常
    const m = b.media || {};
    this.mediaEmpty = !m.scanned;
    if (m.photos && m.photos.length) this.fill(PHOTOS, m.photos);
    if (m.songs && m.songs.length) this.fill(SONGS, m.songs);
    if (m.movies && m.movies.length) this.fill(MOVIES, m.movies);

    this.real = {
      server: b.server, disks: b.disks, network: b.network, processes: b.processes,
      capabilities: b.capabilities, dockerAvailable: b.dockerAvailable,
      dockerMessage: b.dockerMessage, mediaRoots: (m.roots || []), sharesRoot: b.sharesRoot,
      dataDir: b.dataDir
    };
    this.latest = {
      cpu: b.cur.cpu, mem: b.cur.mem, net: b.cur.net, disk: b.cur.disk,
      temp: b.cur.temp, down: b.cur.down || 0, up: b.cur.up || 0
    };
  },

  /* ---------------- 渲染层覆盖 ---------------- */
  patchRenderers() {
    const _photo = photoSVG, _album = albumSVG, _poster = posterSVG;
    photoSVG = function (i, big) {
      const p = PHOTOS[i];
      if (p && p.url) return '<img src="' + esc(NasDeck.withToken(p.url)) + '" alt="' + esc(p.n || '') + '" style="width:100%;height:100%;object-fit:cover;display:block">';
      return _photo(i, big);
    };
    albumSVG = function (i) {
      const s = SONGS[i];
      if (s && s.url) return '<div style="width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(140deg,#3b2f8c,#8b5cf6);color:#fff;font-size:11px;padding:8px;text-align:center;word-break:break-all">' + esc(s.t || s.n) + '</div>';
      return _album(i);
    };
    posterSVG = function (i) {
      const m = MOVIES[i];
      if (m && m.url) return '<div style="width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(140deg,#12304e,#1f7a8c);color:#eaf6ff;font-size:12px;padding:10px;text-align:center;word-break:break-all">' + esc(m.t || m.n) + '</div>';
      return _poster(i);
    };

    // 资源监控：把演示进程表替换成真实进程表
    const _dash = RENDER.dashboard;
    RENDER.dashboard = function () {
      let h = _dash();
      const ps = (NasDeck.real.processes || []).slice(0, 14);
      if (ps.length) {
        const tbl = '<table class="tbl"><thead><tr><th>处理程序</th><th>PID</th><th>内存占用</th><th>CPU 时间</th></tr></thead><tbody>'
          + ps.map(p => '<tr><td>' + esc(p.name) + '</td><td>' + p.pid + '</td><td>' + fmtSize(p.mem || 0) + '</td><td>' + Number(p.cpu || 0).toFixed(1) + ' s</td></tr>').join('')
          + '</tbody></table>';
        h = h.replace(/<table class="tbl">[\s\S]*?<\/table>/, tbl);
      }
      const s = NasDeck.real.server, net = (NasDeck.real.network || []).filter(x => !x.internal && x.family === 'IPv4')[0];
      h = h.replace('Intel Celeron N5105 · 4 核', esc(s.cpuModel.slice(0, 22)) + ' · ' + s.cores + ' 核');
      h = h.replace(/\d+\.\d+ \/ 16\.0 GB/g, fmtSize(NasDeck.latest.mem / 100 * s.totalMem) + ' / ' + fmtSize(s.totalMem));
      h = h.replace('eth0 · 2.5 GbE 全双工', esc((net && net.name) || '主网卡') + ' · ' + esc((net && net.ip) || 'N/A'));
      h = h.replace(/读取 \d+ MB\/s/, '磁盘占用 ' + CUR.disk.toFixed(0) + '%');
      return h;
    };

    // 关于本机：真实硬件信息
    RENDER.about = function () {
      const s = NasDeck.real.server, d = NasDeck.real.disks || [];
      const kv = (k, v) => '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + esc(String(v)) + '</span></div>';
      const total = d.reduce((a, x) => a + (x.total || 0), 0);
      return '<div class="app"><div class="app-scroll"><div class="info-hero" style="margin-bottom:14px"><div>'
        + qmark(64) + '</div><div><h2>' + esc(s.hostname) + '</h2><p>NasDeck 2.5 Web · 真实后端 v1.0<br>'
        + esc(s.platform + ' ' + s.arch + ' · ' + s.release) + '</p></div><div style="flex:1"></div>'
        + '<span class="badge ok"><i></i> 后端已连接</span></div>'
        + '<div class="grid g2" style="margin-bottom:12px"><div class="card"><div class="section-title">硬件信息</div>'
        + kv('处理器', s.cpuModel) + kv('核心数', s.cores + ' 核') + kv('系统内存', fmtSize(s.totalMem))
        + kv('主机名称', s.hostname) + kv('运行时长', Math.round(s.uptime / 3600) + ' 小时')
        + '</div><div class="card"><div class="section-title">软件与存储</div>'
        + kv('操作系统', s.osType + ' ' + s.release) + kv('Node.js', s.node)
        + kv('磁盘卷', d.length + ' 个 · 合计 ' + fmtSize(total))
        + kv('数据目录', NasDeck.real.dataDir) + kv('共享目录', NasDeck.real.sharesRoot)
        + '</div></div><div class="card"><div class="section-title">真实能力状态</div><div class="grid g4">'
        + [['文件总管', '真实'], ['系统监控', '真实'], ['终端机', '真实'], ['HTTP 下载', '真实'],
           ['Docker', NasDeck.real.dockerAvailable ? '真实' : '未安装'], ['媒体库', NasDeck.mediaEmpty ? '无文件' : '真实'],
           ['RAID / 快照', '不适用'], ['云端服务', '演示']]
          .map(x => '<div class="tile"><span class="t">' + x[0] + '</span><span class="v" style="font-size:13px">' + x[1] + '</span></div>').join('')
        + '</div></div></div></div>';
    };

    // 右侧小工具：全部改为真实主机数据
    renderWidgets = function () {
      const w = $('#widgets'); if (!w) return;
      const s = NasDeck.real.server, d = NasDeck.real.disks || [], net = (NasDeck.real.network || []).filter(x => !x.internal && x.family === 'IPv4')[0];
      const total = d.reduce((a, x) => a + (x.total || 0), 0), used = d.reduce((a, x) => a + (x.used || 0), 0);
      const pct = total ? used / total * 100 : 0;
      const memT = s.totalMem, memU = NasDeck.latest.mem / 100 * memT;
      const temp = (NasDeck.latest.temp === null || NasDeck.latest.temp === undefined || NasDeck.latest.temp === 'N/A') ? 'N/A' : NasDeck.latest.temp + ' °C';
      const evts = LOGS.slice(-2).reverse().map(l =>
        '<div class="wevt ' + (l.lv === 'ERROR' || l.lv === 'WARN' ? 'warn' : '') + '"><i></i><span>' + esc(String(l.msg).slice(0, 22)) + '</span><time>' + esc(String(l.time).slice(-5)) + '</time></div>').join('');
      w.innerHTML = ''
        + '<div class="wcard"><h4>系统健康 <b>● 正常</b></h4><div class="wbig" id="w-cpu">' + CUR.cpu.toFixed(0) + '<small>%</small></div>'
        + '<div class="wlabel">CPU 使用率 · ' + esc(s.cpuModel.slice(0, 18)) + ' · ' + s.cores + ' 核</div>'
        + '<div class="prog"><i id="w-cpu-bar" style="width:' + CUR.cpu + '%"></i></div>'
        + '<svg class="spark" id="w-spark" viewBox="0 0 220 38" preserveAspectRatio="none"></svg>'
        + '<div class="wkv" style="border-top:1px solid var(--line);padding-top:8px"><span>CPU 温度 / 主机</span><b id="w-temp">' + temp + ' · ' + esc(s.hostname) + '</b></div></div>'
        + '<div class="wcard"><h4>内存 <span id="w-mem-v">' + CUR.mem.toFixed(0) + '%</span></h4>'
        + '<div class="wbig">' + (memU / 1073741824).toFixed(1) + '<small>/ ' + (memT / 1073741824).toFixed(1) + ' GB</small></div>'
        + '<div class="prog ok"><i id="w-mem-bar" style="width:' + CUR.mem + '%"></i></div>'
        + '<div class="wkv"><span>已用</span><b>' + fmtSize(memU) + '</b></div>'
        + '<div class="wkv"><span>可用</span><b>' + fmtSize(memT - memU) + '</b></div></div>'
        + '<div class="wcard"><h4>存储空间 <span>' + d.length + ' 个磁盘卷</span></h4>'
        + '<div class="wbig">' + (used / 1073741824).toFixed(0) + '<small> GB / ' + (total / 1073741824).toFixed(0) + ' GB</small></div>'
        + '<div class="prog warn"><i style="width:' + pct.toFixed(0) + '%"></i></div>'
        + '<div class="wkv"><span>已用 ' + pct.toFixed(0) + '%</span><b>剩余 ' + fmtSize(total - used) + '</b></div>'
        + '<div class="wkv"><span>本机磁盘</span><b class="ok">' + esc(d.map(x => x.name || x.mount).join(' / ')) + '</b></div></div>'
        + '<div class="wcard"><h4>网络流量 <span>' + esc((net && net.name) || '网卡') + '</span></h4>'
        + '<svg class="spark" id="w-net" viewBox="0 0 220 38" preserveAspectRatio="none"></svg>'
        + '<div class="wkv"><span>↓ 下载</span><b id="w-down">' + (NasDeck.latest.down || 0).toFixed(2) + ' MB/s</b></div>'
        + '<div class="wkv"><span>↑ 上传</span><b id="w-up">' + (NasDeck.latest.up || 0).toFixed(2) + ' MB/s</b></div>'
        + '<div class="wkv"><span>本机 IP</span><b>' + esc((net && net.ip) || 'N/A') + '</b></div></div>'
        + '<div class="wcard"><h4>最近事件 <span>真实系统日志</span></h4>' + evts + '</div>';
      updateWidgets();
    };

    // 小工具数值实时刷新（真实网速 / 温度 / 内存）
    const _uw = updateWidgets;
    updateWidgets = function () {
      _uw();
      if (!NasDeck.latest) return;
      const d = $('#w-down'); if (d) d.textContent = (NasDeck.latest.down || 0).toFixed(2) + ' MB/s';
      const u = $('#w-up'); if (u) u.textContent = (NasDeck.latest.up || 0).toFixed(2) + ' MB/s';
      const t = $('#w-temp'); if (t) {
        const tp = (NasDeck.latest.temp === null || NasDeck.latest.temp === undefined || NasDeck.latest.temp === 'N/A') ? 'N/A' : NasDeck.latest.temp + ' °C';
        t.textContent = tp + ' · ' + NasDeck.real.server.hostname;
      }
      const m = $('#w-mem-v'); if (m) m.textContent = (NasDeck.latest.mem || 0).toFixed(0) + '%';
    };

    // 全局搜索附加真实文件命中
    const _sr = searchResults;
    searchResults = function (q) {
      const r = _sr(q);
      const key = (q || '').trim().toLowerCase();
      if (key && NasDeck.mode === 'live') {
        if (NasDeck.searchCache && NasDeck.searchCache.q === key) {
          r.files = NasDeck.searchCache.files.concat(r.files).slice(0, 10);
        } else {
          NasDeck.get('/api/search?q=' + encodeURIComponent(key)).then(j => {
            NasDeck.searchCache = {
              q: key,
              files: (j.files || []).map(f => ({ p: f.p, f: { n: f.n, t: f.t, sz: f.sz, m: '' } }))
            };
            const sb = $('#searchbox');
            if (sb && !sb.classList.contains('hidden')) renderSearch();
          }).catch(() => {});
        }
      }
      return r;
    };

    // 进入桌面的欢迎信息改为真实主机
    enterDesktop = function () {
      $('#login').classList.add('hidden'); $('#desk').classList.remove('hidden');
      $('#lg-go').textContent = '登 录'; $('#lg-go').disabled = false;
      renderDeskIcons(); renderTaskbar(); renderWidgets(); renderTray(); tick(); renderNoti(); renderCtrl(); renderMM();
      const s = NasDeck.real && NasDeck.real.server;
      toast('欢迎回来，' + S.user, s ? ('已连接真实主机 ' + s.hostname + ' · ' + s.cores + ' 核 · ' + fmtSize(s.totalMem)) : '已成功登入 Windows 本机 · NasDeck 2.5.0', 'ok');
      setTimeout(() => openApp('dashboard'), 520);
    };
  },

  /* ---------------- 文件总管：真实路径导航 ---------------- */
  patchFs() {
    const _fsGoto = fsGoto, _fsBack = fsBack, _fsUp = fsUp;
    fsGoto = async function (p) {
      if (NasDeck.mode !== 'live') return _fsGoto(p);
      p = p || '/';
      try {
        const r = await NasDeck.get('/api/files/list?path=' + encodeURIComponent(p));
        FS[r.path] = r.entries;
        _fsGoto(r.path);
      } catch (e) { toast('无法打开目录', e.message, 'err'); }
    };
    fsBack = function () {
      if (NasDeck.mode !== 'live') return _fsBack();
      const p = FS_STATE.hist.length ? FS_STATE.hist[FS_STATE.hist.length - 1] : '/';
      FS_STATE.hist.pop();
      fsGoto(p);
    };
    fsUp = function () {
      if (NasDeck.mode !== 'live') return _fsUp();
      const p = FS_STATE.path;
      if (p === '/') return;
      fsGoto(p.slice(0, p.lastIndexOf('/')) || '/');
    };

    const set = (k, fn) => { NasDeck.ORIG[k] = ACT[k]; ACT[k] = fn; NasDeck.EXPLICIT.add(k); };
    set('fs-newfolder', () => {
      const rec = W('filestation'); if (!rec) return;
      askModal(rec, '新建文件夹', '将在 ' + FS_STATE.path + ' 建立真实文件夹', '新建文件夹', async v => {
        if (!v) return;
        try { NasDeck.applyFiles(await NasDeck.post('/api/files/mkdir', { path: FS_STATE.path, name: v })); toast('文件夹已建立', v, 'ok'); }
        catch (e) { toast('建立失败', e.message, 'err'); }
      });
    });
    set('fs-newfile', () => {
      const rec = W('filestation'); if (!rec) return;
      askModal(rec, '新建文本文件', '将在 ' + FS_STATE.path + ' 建立真实文件', '未命名.txt', async v => {
        if (!v) return;
        try { NasDeck.applyFiles(await NasDeck.post('/api/files/newfile', { path: FS_STATE.path, name: v, content: '' })); toast('文件已建立', v, 'ok'); }
        catch (e) { toast('建立失败', e.message, 'err'); }
      });
    });
    set('fs-rename', () => {
      const f = fsSelected();
      if (!f) { toast('请先选择项目', '', 'warn'); return; }
      const rec = W('filestation'); if (!rec) return;
      askModal(rec, '重命名', '输入新名称（将重命名磁盘上的真实文件）', f.n, async v => {
        if (!v || v === f.n) return;
        try { NasDeck.applyFiles(await NasDeck.post('/api/files/rename', { path: FS_STATE.path, from: f.n, to: v })); toast('已重命名', v, 'ok'); }
        catch (e) { toast('重命名失败', e.message, 'err'); }
      });
    });
    set('fs-delete', () => {
      const f = fsSelected();
      if (!f) { toast('请先选择项目', '', 'warn'); return; }
      const rec = W('filestation'); if (!rec) return;
      askModal(rec, '移至资源回收站', '确定要删除「' + f.n + '」吗？文件会被移动到本机回收目录，可还原。', null, async () => {
        try {
          const r = await NasDeck.post('/api/files/delete', { path: FS_STATE.path, name: f.n });
          NasDeck.applyFiles(r.files); NasDeck.fillBIN(r.trash); FS_STATE.sel = -1;
          toast('已移至回收站', f.n, 'ok');
        } catch (e) { toast('删除失败', e.message, 'err'); }
      });
    });
    set('fs-upload', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = true; inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = async () => {
        const list = Array.from(inp.files || []);
        for (const f of list) {
          try {
            const p = '/api/files/upload?path=' + encodeURIComponent(FS_STATE.path) + '&name=' + encodeURIComponent(f.name);
            const r = await NasDeck.put(p, f);
            NasDeck.applyFiles(r.files);
            toast('上传完成', f.name + ' · ' + fmtSize(f.size), 'ok');
          } catch (e) { toast('上传失败', f.name + '：' + e.message, 'err'); }
        }
        inp.remove();
      };
      inp.click();
    });
    set('fs-open', (e, d) => {
      const list = (FS[FS_STATE.path] || []).filter(f => !FS_STATE.q || f.n.toLowerCase().includes(FS_STATE.q.toLowerCase()));
      const f = list[+d.i]; if (!f) return;
      const np = NasDeck.child(FS_STATE.path, f.n);
      if (f.t === 'dir') { fsGoto(np); return; }
      const url = NasDeck.base + '/api/files/open?path=' + encodeURIComponent(FS_STATE.path) + '&name=' + encodeURIComponent(f.n) + (NasDeck.token ? '&token=' + encodeURIComponent(NasDeck.token) : '');
      if (f.t === 'img') { openApp('photodeck'); toast('打开照片', f.n); return; }
      if (f.t === 'aud' || f.t === 'vid') {
        NasDeck.openPlayer('媒体预览 · ' + f.n,
          (f.t === 'aud' ? '<audio controls autoplay style="width:100%" src="' + esc(url) + '"></audio>'
            : '<video controls autoplay style="width:100%;max-height:62vh;background:#000" src="' + esc(url) + '"></video>'));
        return;
      }
      window.open(url, '_blank');
      toast('已在新标签页打开', f.n);
    });
  },

  /* ---------------- 真实终端 ---------------- */
  patchTerminal() {
    termExec = async function (inp) {
      const raw = inp.value, cmd = raw.trim();
      if (!cmd) return;
      inp.value = '';
      TERM_HIST.push(cmd); TERM_HI = TERM_HIST.length;
      tpush('cmd', cmd);
      if (cmd === 'clear') { TERM_LINES.length = 0; termOut(); return; }
      if (cmd === 'help') {
        ['真实终端 · 命令直接在本机 shell 执行（Windows: cmd.exe / Linux: sh）',
          '  cd <路径>   切换工作目录     pwd / dir / ls   查看当前位置与内容',
          '  docker ps   容器列表         node -v / python --version',
          '  任意系统命令均可执行，例如 ipconfig、tasklist、git status、echo 等',
          '  clear 清屏 · help 显示本说明 · 单条命令超时 30 秒'
        ].forEach(l => tpush('out', l));
        termOut(); return;
      }
      tpush('out', '… 执行中'); termOut();
      try {
        const r = await NasDeck.post('/api/terminal/exec', { cmd });
        TERM_LINES.pop();
        String(r.out || '').split('\n').forEach(l => tpush('out', l));
        if (r.code) tpush('out', '[exit ' + r.code + ']');
        TERM_CWD = r.cwd || TERM_CWD;
        termOut();
        const ps = document.querySelector('.term-in .ps');
        if (ps) ps.textContent = S.user + '@' + (NasDeck.real.server.hostname) + ':' + TERM_CWD + '$';
      } catch (e) {
        TERM_LINES.pop(); tpush('out', '错误：' + e.message); termOut();
      }
    };
  },

  /* ---------------- 媒体播放器浮层 ---------------- */
  openPlayer(title, inner) {
    let d = document.getElementById('nasdeck-player');
    if (!d) {
      d = document.createElement('div'); d.id = 'nasdeck-player';
      d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(4,10,22,.82);backdrop-filter:blur(9px);display:flex;align-items:center;justify-content:center';
      document.body.appendChild(d);
    }
    const close = () => { d.innerHTML = ''; d.style.display = 'none'; };
    d.innerHTML = '<div style="width:min(720px,88vw);background:#152641;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:18px;box-shadow:0 30px 90px rgba(0,0,0,.6)">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;color:#eaf3ff;font-size:13px;font-weight:600">'
      + '<span>' + esc(title) + '</span><button id="nasdeck-player-x" style="background:rgba(255,255,255,.1);border:0;color:#eaf3ff;width:28px;height:28px;border-radius:7px;cursor:pointer;font-size:15px">✕</button></div>'
      + inner + '</div>';
    d.style.display = 'flex';
    d.querySelector('#nasdeck-player-x').onclick = close;
    d.onclick = ev => { if (ev.target === d) close(); };
  },

  /* ---------------- 显式覆盖需要走 API 的动作 ---------------- */
  patchActions() {
    const set = (k, fn) => { NasDeck.ORIG[k] = ACT[k]; ACT[k] = fn; NasDeck.EXPLICIT.add(k); };

    /* 登录 / 电源 */
    set('logout', async () => {
      try { await NasDeck.post('/api/auth/logout'); } catch (e) {}
      NasDeck.clearToken(); location.reload();
    });
    set('reboot', () => NasDeck.post('/api/power', { act: 'reboot' }).then(r => toast('重新启动', r.message, 'warn')).catch(e => toast('操作失败', e.message, 'err')));
    set('shutdown', () => NasDeck.post('/api/power', { act: 'shutdown' }).then(r => toast('关机', r.message, 'warn')).catch(e => toast('操作失败', e.message, 'err')));

    /* 资源回收站 */
    const binId = d => {
      let v = (typeof BIN_SEL === 'number' ? BIN_SEL : (d && d.i));
      const item = BIN[v] || BIN[0];
      return item && item.id;
    };
    set('bin-restore', async (e, d) => {
      const id = binId(d);
      if (!id) { toast('请先选择项目', '', 'warn'); return; }
      try {
        const r = await NasDeck.post('/api/bin/restore', { id, path: (BIN.find(x => x.id === id) || {}).from || '/' });
        NasDeck.fillBIN(r.bin); rerender('trash'); toast('已还原到原始位置', '', 'ok');
      } catch (er) { toast('还原失败', er.message, 'err'); }
    });
    set('bin-del', async (e, d) => {
      const id = binId(d);
      if (!id) { toast('请先选择项目', '', 'warn'); return; }
      try { const r = await NasDeck.post('/api/bin/purge', { id }); NasDeck.fillBIN(r.bin); rerender('trash'); toast('已永久删除', '', 'warn'); }
      catch (er) { toast('删除失败', er.message, 'err'); }
    });
    /* 清空的是用户真实的 Windows 回收站，必须二次确认（不可复原）。
       real 层会用带真实项目数的确认框覆盖此动作；这里保留兜底确认，
       避免任何路径绕过直接永久删除。 */
    set('bin-clear', () => {
      const rec = typeof W === 'function' ? W('trash') : null;
      const n = (NasDeck.realBin && NasDeck.realBin.total) || (typeof BIN !== 'undefined' ? BIN.length : 0);
      askModal(rec, '清空 Windows 回收站',
        '这将永久删除本机回收站中的 ' + n + ' 个项目，且无法复原。确定继续？', null, async () => {
          try { const r = await NasDeck.post('/api/bin/clear', { confirm: true }); NasDeck.fillBIN(r.bin); rerender('trash'); toast('回收站已清空', '', 'warn'); }
          catch (e) { toast('清空失败', e.message, 'err'); }
        });
    });

    /* 容器工作台 → 真实 Docker CLI */
    set('ct-toggle', async (e, d) => {
      const c = CONTAINERS[+d.i];
      if (!c || !c.id) { toast('Docker 未就绪', NasDeck.real.dockerMessage || '本机未检测到运行中的 Docker', 'warn'); return; }
      const act = c.st ? 'stop' : 'start';
      try {
        const r = await NasDeck.post('/api/docker/action', { id: c.id, act });
        NasDeck.fill(CONTAINERS, r.containers || []); rerender('container');
        toast('容器 ' + c.n, act === 'start' ? '已启动' : '已停止', r.ok ? 'ok' : 'warn');
      } catch (er) { toast('操作失败', er.message, 'err'); }
    });
    set('ct-logs', async (e, d) => {
      const c = CONTAINERS[+d.i];
      if (!c || !c.id) { toast('Docker 未就绪', '', 'warn'); return; }
      const rec = W('container'); if (!rec) return;
      try {
        const r = await NasDeck.post('/api/docker/action', { id: c.id, act: 'logs' });
        infoModal(rec, '容器日志 · ' + c.n, '<div class="mono" style="white-space:pre-wrap;font-size:11px;max-height:400px;overflow:auto">' + esc(r.out || '(无输出)') + '</div>');
      } catch (er) { toast('读取失败', er.message, 'err'); }
    });
    set('ct-new', () => toast('建立容器', '请在终端执行 docker run …，或启动 Docker Desktop 后刷新 容器工作台', 'warn'));

    /* Download Station → 真实 HTTP(S) 下载 */
    set('dl-new', () => {
      const rec = W('download'); if (!rec) return;
      askModal(rec, '新增下载任务', '输入 HTTP / HTTPS 文件直链（BT / 磁力链接需要额外引擎）', 'https://', async v => {
        if (!v) return;
        try { const r = await NasDeck.post('/api/downloads/add', { url: v }); NasDeck.fillDLS(r.downloads); rerender('download'); toast('下载已开始', v, 'ok'); }
        catch (e) { toast('添加失败', e.message, 'err'); }
      });
    });
    set('dl-toggle', async (e, d) => {
      const x = DLS[+d.i]; if (!x || !x.id) return;
      if (x.st === 2) { toast('任务已完成', x.n); return; }
      try { const r = await NasDeck.post('/api/downloads/action', { id: x.id, act: x.st === 1 ? 'pause' : 'resume' }); NasDeck.fillDLS(r.downloads); rerender('download'); }
      catch (er) { toast('操作失败', er.message, 'err'); }
    });
    set('dl-del', async (e, d) => {
      const x = DLS[+d.i]; if (!x || !x.id) return;
      try { const r = await NasDeck.post('/api/downloads/action', { id: x.id, act: 'remove' }); NasDeck.fillDLS(r.downloads); rerender('download'); toast('任务已移除', x.n); }
      catch (er) { toast('操作失败', er.message, 'err'); }
    });

    /* App Center → 安装状态真实持久化 */
    set('ac-install', (e, d) => {
      const orig = NasDeck.ORIG['ac-install']; if (orig) orig(e, d);
      NasDeck.post('/api/apps/install', { id: d.id }).then(r => NasDeck.obj(APPS_INSTALLED, r.installed)).catch(() => {});
    });
    set('ac-uninstall', (e, d) => {
      const orig = NasDeck.ORIG['ac-uninstall']; if (orig) orig(e, d);
      NasDeck.post('/api/apps/install', { id: d.id, remove: true }).then(r => NasDeck.obj(APPS_INSTALLED, r.installed)).catch(() => {});
    });

    /* 日志 / 通知 */
    set('log-clear', async () => {
      try { const r = await NasDeck.post('/api/logs/clear', {}); NasDeck.fill(LOGS, r.logs); rerender('logs'); toast('日志已清除', '服务端事件记录已清空', 'warn'); }
      catch (e) { toast('清除失败', e.message, 'err'); }
    });
    set('log-export', () => {
      window.open(NasDeck.base + '/api/logs/export?token=' + encodeURIComponent(NasDeck.token), '_blank');
      toast('日志已导出', '已从服务端下载 nasdeck-system.log', 'ok');
    });
    set('noti-clear', async () => {
      try { await NasDeck.post('/api/notis/clear', {}); NasDeck.fill(NOTIS, []); renderNoti(); renderTray(); toast('通知', '通知列表已清空'); }
      catch (e) { toast('操作失败', e.message, 'err'); }
    });
    set('noti-read', (e, d) => {
      const orig = NasDeck.ORIG['noti-read']; if (orig) orig(e, d);
      const n = NOTIS[+d.i]; if (n) NasDeck.post('/api/notis/read', { t: n.t }).catch(() => {});
    });
    set('noti-allread', (e, d) => {
      const orig = NasDeck.ORIG['noti-allread']; if (orig) orig(e, d);
      NasDeck.post('/api/notis/read', { all: true }).catch(() => {});
    });

    /* 真实媒体播放 */
    set('mu-play', () => NasDeck.playSong(false));
    set('mu-select', (e, d) => {
      MU.i = +d.i; MU.pos = 0; MU.playing = true; rerender('music');
      NasDeck.playSong(true);
    });
    set('vid-play', (e, d) => {
      const m = MOVIES[+d.i];
      if (!m || !m.url) { toast('无真实影片', '媒体目录中未找到视频文件，可在系统设置中配置媒体目录', 'warn'); return; }
      NasDeck.openPlayer('影片 · ' + (m.t || m.n),
        '<video controls autoplay style="width:100%;max-height:66vh;background:#000;border-radius:8px" src="' + esc(NasDeck.withToken(m.url)) + '"></video>'
        + '<div class="kv" style="margin-top:10px"><span class="k">文件</span><span class="v mono">' + esc(m.path) + '</span></div>');
    });
    set('vid-scan', () => {
      NasDeck.get('/api/media/scan').then(r => {
        if (r.movies && r.movies.length) NasDeck.fill(MOVIES, r.movies);
        if (r.photos && r.photos.length) NasDeck.fill(PHOTOS, r.photos);
        if (r.songs && r.songs.length) NasDeck.fill(SONGS, r.songs);
        toast('媒体库扫描完成', '真实文件 ' + r.scanned + ' 个 · 目录 ' + (r.roots || []).length + ' 个', 'ok');
        if (W('video')) rerender('video');
      }).catch(e => toast('扫描失败', e.message, 'err'));
    });
    set('rm-refresh', () => {
      NasDeck.get('/api/sys/processes').then(r => { NasDeck.real.processes = r.processes || []; }).catch(() => {});
      NasDeck.get('/api/sys/metrics').then(r => NasDeck.onMetrics(r)).catch(() => {});
      toast('已刷新', '已从本机读取最新 CPU / 内存 / 网速 / 进程数据', 'ok');
      if (W('dashboard')) rerender('dashboard');
    });
    set('st-scan', () => {
      NasDeck.get('/api/sys/disks').then(r => {
        const list = (r.disks || []).map((d, i) => ({
          bay: i + 1, model: d.name + ' 磁盘卷', sn: 'N/A', cap: fmtSize(d.total),
          temp: 'N/A', h: '良好', st: '正常', total: d.total, used: d.used, free: d.free, pct: d.pct, mount: d.mount
        }));
        NasDeck.fill(DISKS, list);
        toast('磁盘扫描完成', '检测到 ' + list.length + ' 个真实磁盘卷', 'ok');
        if (W('storage')) rerender('storage');
      }).catch(e => toast('扫描失败', e.message, 'err'));
    });

    /* 媒体目录配置（系统设置里的通用开关会由 wrapActions 持久化） */
    set('cp-newuser', () => {
      const rec = W('controlpanel'); if (!rec) return;
      askModal(rec, '建立使用者', '输入新使用者账号名称（将写入本机 users.json）', 'newuser', async v => {
        if (!v) return;
        try { await NasDeck.post('/api/users/add', { username: v, password: '123456', role: 'user' }); toast('使用者已建立', v + ' 已写入 users.json', 'ok'); }
        catch (e) { toast('建立失败', e.message, 'err'); }
      });
    });
  },

  playSong(force) {
    const s = SONGS[MU.i];
    if (!s || !s.url) {
      toast('无真实音频', '媒体目录中未找到音频文件。当前媒体目录：' + (NasDeck.real.mediaRoots || []).join('、'), 'warn');
      MU.playing = false; rerender('music'); return;
    }
    MU.playing = true; rerender('music');
    NasDeck.openPlayer('音乐 · ' + (s.t || s.n),
      '<audio controls autoplay style="width:100%" src="' + esc(NasDeck.withToken(s.url)) + '"></audio>'
      + '<div class="kv" style="margin-top:10px"><span class="k">文件</span><span class="v mono">' + esc(s.path) + '</span></div>');
  },

  /* ---------------- 其余动作：保留原 UI 逻辑，自动持久化状态 ---------------- */
  wrapActions() {
    const watch = [
      { get: () => JSON.stringify({ theme: S.theme, wall: S.wall, accent: S.accent, bright: S.bright, volume: S.volume, widgets: S.widgets }), save: v => NasDeck.post('/api/settings', JSON.parse(v)) },
      { get: () => JSON.stringify(FW), save: v => NasDeck.post('/api/settings', { fw: JSON.parse(v) }) },
      { get: () => JSON.stringify(CLOUD), save: v => NasDeck.post('/api/settings', { cloud: JSON.parse(v) }) },
      { get: () => JSON.stringify(CP), save: v => NasDeck.post('/api/settings', { cp: JSON.parse(v) }) },
      { get: () => JSON.stringify(NET), save: v => NasDeck.post('/api/settings', { net: JSON.parse(v) }) },
      { get: () => JSON.stringify(FW_RULES), save: v => NasDeck.post('/api/settings', { fwRules: JSON.parse(v) }) },
      { get: () => JSON.stringify(HBS_JOBS), save: v => NasDeck.post('/api/settings', { hbs: JSON.parse(v) }) }
    ];
    for (const key of Object.keys(ACT)) {
      if (NasDeck.EXPLICIT.has(key)) continue;
      const fn = ACT[key];
      if (typeof fn !== 'function') continue;
      ACT[key] = function (e, d, ev) {
        const before = watch.map(w => w.get());
        const r = fn.call(this, e, d, ev);
        setTimeout(() => {
          for (let i = 0; i < watch.length; i++) {
            let now; try { now = watch[i].get(); } catch (er) { continue; }
            if (before[i] !== now) { try { watch[i].save(now); } catch (er) {} }
          }
        }, 40);
        return r;
      };
    }
  },

  /* ---------------- 实时通道 ---------------- */
  onMetrics(m) {
    NasDeck.latest = {
      cpu: m.cpu, mem: m.mem, net: m.net, disk: m.disk,
      temp: m.temp, down: m.down || 0, up: m.up || 0
    };
    CUR.cpu = m.cpu; CUR.mem = m.mem; CUR.net = m.net; CUR.disk = m.disk;
    updateWidgets();
    if (W('dashboard')) refreshDashboardLive();
  },
  tickMetrics() {
    if (!NasDeck.latest) return;
    const L = NasDeck.latest;
    ['cpu', 'mem', 'net', 'disk'].forEach(k => {
      METRIC[k].push(L[k]);
      if (METRIC[k].length > 60) METRIC[k].shift();
      CUR[k] = L[k];
    });
    updateWidgets(); tick();
    if (W('dashboard')) refreshDashboardLive();
  },
  tickDownloads() { /* 下载进度由 SSE 推送，此处不再生成模拟进度 */ },
  connect() {
    if (this.es) { try { this.es.close(); } catch (e) {} }
    const u = this.base + '/api/events?token=' + encodeURIComponent(this.token);
    const es = new EventSource(u); this.es = es;
    es.addEventListener('metrics', ev => { try { NasDeck.onMetrics(JSON.parse(ev.data)); } catch (e) {} });
    es.addEventListener('downloads', ev => {
      try { NasDeck.fillDLS(JSON.parse(ev.data)); if (W('download')) rerender('download'); } catch (e) {}
    });
    es.addEventListener('log', ev => {
      try { LOGS.push(JSON.parse(ev.data)); if (W('logs')) rerender('logs'); } catch (e) {}
    });
    es.addEventListener('noti', ev => {
      try { NOTIS.unshift(JSON.parse(ev.data)); renderNoti(); renderTray(); } catch (e) {}
    });
    es.addEventListener('bin', ev => {
      try { NasDeck.fillBIN(JSON.parse(ev.data)); if (W('trash')) rerender('trash'); } catch (e) {}
    });
    es.addEventListener('docker', ev => {
      try {
        const r = JSON.parse(ev.data);
        NasDeck.real.dockerAvailable = r.available; NasDeck.real.dockerMessage = r.message || '';
        NasDeck.fill(CONTAINERS, r.containers || []);
        if (W('container')) rerender('container');
      } catch (e) {}
    });
    es.onerror = () => { /* EventSource 自动重连 */ };
  },

  install() {
    if (this.installed) return;
    this.installed = true;
    this.hydrate(this.boot);
    this.patchRenderers();
    this.patchFs();
    this.patchTerminal();
    this.patchActions();
    this.wrapActions();

    // 顶栏 / 终端提示符改为真实主机，替换演示设备名与假启动横幅
    const s = this.boot.server;
    const tn = document.querySelector('.tb-name');
    if (tn) tn.textContent = s.hostname + ' · NasDeck Web';
    const safe = (S.user + '@' + s.hostname).replace(/["\\]/g, '');
    const sty = document.createElement('style');
    sty.textContent = '.term .cmd::before{content:"' + safe + ':~$ " !important;color:#3aa8e0}'
      + '.wlabel,.card.stat .foot{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '#desk-icons .di{width:84px}#desk-icons .di span{white-space:nowrap;font-size:10.5px}';
    document.head.appendChild(sty);
    TERM_LINES.length = 0;
    tpush('out', s.hostname + ' · ' + s.osType + ' ' + s.release + ' · ' + s.arch);
    tpush('out', 'NasDeck Web 真实终端 · ' + s.cores + ' 核 · ' + fmtSize(s.totalMem) + ' 内存 · 输入 help 查看说明');
    tpush('out', '');
    window.__NasDeck_LOGIN__ = () => NasDeck.login();
    // Windows 原生界面层（服务 / 防火墙 / VSS / WSL 容器 / 监测 …）
    try { if (typeof NasDeck_WIN_INSTALL === 'function') NasDeck_WIN_INSTALL(); }
    catch (e) { console.error('[NasDeck_WIN_INSTALL]', e); }
  },

  async login() {
    const u = $('#lg-user').value.trim(), p = $('#lg-pass').value;
    const err = $('#lg-err'), btn = $('#lg-go');
    if (!u) { err.textContent = '请输入用户名'; return; }
    if (!p) { err.textContent = '请输入密码'; return; }
    err.textContent = ''; btn.textContent = '正在验证…'; btn.disabled = true;
    try {
      const r = await NasDeck.post('/api/auth/login', { user: u, pass: p });
      if (!r.ok) throw new Error(r.error || '登录失败');
      NasDeck.token = r.token; NasDeck.saveToken(r.token);
      if (!await NasDeck.loadBoot()) throw new Error('无法读取系统数据');
      NasDeck.install();
      S.user = r.user; S.logged = true;
      const av = document.querySelector('#tb-user .tb-avatar');
      if (av) av.textContent = (r.user || 'A').slice(0, 1).toUpperCase();
      enterDesktop();
      NasDeck.connect();
    } catch (e) {
      err.textContent = e.message;
    } finally {
      btn.textContent = '登 录'; btn.disabled = false;
    }
  }
};
window.NasDeck = NasDeck;

async function NasDeck_BOOT() {
  await NasDeck.probe();
  if (NasDeck.mode === 'live') {
    // 无论是否已有会话，都必须接管登录按钮，否则会回落到 demo 登录
    window.__NasDeck_LOGIN__ = () => NasDeck.login();
    NasDeck.token = NasDeck.readToken();
    if (NasDeck.token) {
      const s = await NasDeck.session();
      if (s && await NasDeck.loadBoot()) { NasDeck.install(); NasDeck.autoLogin = true; }
      else NasDeck.clearToken();
    }
  }
  nasdeckInit();
  if (NasDeck.autoLogin) {
    setTimeout(() => {
      S.user = NasDeck.boot.user; S.logged = true;
      const av = document.querySelector('#tb-user .tb-avatar');
      if (av) av.textContent = (S.user || 'A').slice(0, 1).toUpperCase();
      enterDesktop();
      NasDeck.connect();
    }, 1280);
  }
}
//__NasDeck_BRIDGE_END__
