'use strict';
/* NasDeck WinNAS · 后端设置窗口逻辑
   全部数据来自桌面主进程（Electron IPC）与真实后端 /api/boot/status、/api/health。
   没有连接主进程时明确显示 N/A，绝不填充任何模拟数据。 */
(function () {
  var D = window.nasdeckDesktop || null;
  var S = { settings: null, status: null, boot: null, meta: null, logs: [] };
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function setStatus(txt, kind) {
    var e = $('status'); e.textContent = txt; e.className = kind || '';
  }
  function notice(id, html, on) {
    var e = $(id);
    if (!e) return;
    var cls = id === 'errmsg' ? 'err' : (id === 'okmsg' ? 'ok' : 'warn');
    e.innerHTML = html || '';
    e.className = 'notice ' + cls + (on ? ' show' : '');
  }
  function num(v, suffix) { return (v === undefined || v === null || v === '') ? 'N/A' : String(v) + (suffix || ''); }
  function dur(sec) {
    if (sec === undefined || sec === null) return 'N/A';
    sec = Number(sec) || 0;
    if (sec < 60) return sec + ' 秒';
    if (sec < 3600) return Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒';
    return Math.floor(sec / 3600) + ' 小时 ' + Math.floor((sec % 3600) / 60) + ' 分';
  }
  var STATUS_TEXT = {
    pending: '等待中', running: '进行中', done: '已完成', skipped: '已跳过',
    warn: '有提示', error: '失败', timeout: '后台继续'
  };
  var STATUS_ICON = { done: '✓', running: '›', warn: '!', error: '×', timeout: '…', skipped: '–', pending: '·' };

  /* ---------------- 表单 ---------------- */
  function fillForm(st, meta) {
    if (!st) return;
    $('port').value = st.port || 5080;
    $('host').value = st.host || '127.0.0.1';
    $('username').value = st.username || 'admin';
    $('dataDir').value = st.dataDir || ((meta && meta.baseDir ? meta.baseDir + '\\data' : ''));
    $('winnasHome').value = st.winnasHome || '';
    $('bootGapMs').value = (st.bootGapMs === undefined ? 320 : st.bootGapMs);
    $('wslAutostart').checked = st.wslAutostart !== false;
    $('autoOpenSettings').checked = st.autoOpenSettings !== false;
    $('minimizeToTray').checked = st.minimizeToTray !== false;
    $('startWithWindows').checked = !!st.startWithWindows;
  }

  /* ---------------- 状态渲染 ---------------- */
  function render(p) {
    if (!p) return;
    if (p.status) S.status = p.status;
    if (p.boot) S.boot = p.boot;
    if (p.meta) S.meta = p.meta;
    if (p.logs) S.logs = p.logs;
    var st = S.status, boot = S.boot, meta = S.meta, health = p.health;

    var online = !!(st && st.ok !== false && st.listening) || !!(health && health.ok);
    var busy = !!(boot && !boot.finished);
    var badge = $('badge');
    if (!st) { badge.textContent = 'N/A'; badge.className = 'badge off'; }
    else if (!online) { badge.textContent = '后端离线'; badge.className = 'badge off'; }
    else if (busy) { badge.textContent = '分级启动中'; badge.className = 'badge busy'; }
    else { badge.textContent = '后端在线'; badge.className = 'badge'; }
    $('dot').style.background = online ? '#4ad0a0' : (st ? '#e8a34a' : '#8fa6b8');

    $('addr').textContent = st ? (st.address || 'N/A') : 'N/A';
    $('kv-up').textContent = st ? dur(st.uptimeSec) : 'N/A';
    $('kv-pid').textContent = st ? num(st.pid) : 'N/A';
    $('kv-routes').textContent = st ? (num(st.routes) + ' / ' + num(st.sseClients)) : 'N/A';
    $('kv-admin').textContent = st ? ((st.users && st.users[0]) || 'N/A') : 'N/A';
    $('kv-engine').textContent = st && st.winnas ? (st.winnas.available ? ('v' + st.winnas.version + ' · ' + st.winnas.modules + ' 模块') : 'N/A') : 'N/A';
    $('kv-docker').textContent = st && st.wsl ? (st.wsl.available ? ('在线 · ' + st.wsl.containers + ' 容器') : '未在线（N/A）') : 'N/A';

    var pct = boot && typeof boot.overall === 'number' ? Math.max(0, Math.min(100, boot.overall)) : null;
    $('pct').textContent = pct === null ? 'N/A' : pct.toFixed(0) + '%';
    $('pbar').style.width = (pct === null ? 0 : pct) + '%';

    var stages = boot && boot.stages ? boot.stages : [];
    $('mini-stages').innerHTML = stages.length ? stages.map(function (s) {
      return '<div class="stage ' + esc(s.status) + '"><div class="n" title="' + esc(s.name) + '">' + esc(s.name) +
        '</div><div class="s">' + esc(STATUS_TEXT[s.status] || s.status) + ' · ' + (s.progress || 0).toFixed(0) + '%</div></div>';
    }).join('') : '<div class="stage"><div class="n">等待阶段数据</div><div class="s">N/A</div></div>';

    $('stage-list').innerHTML = stages.length ? stages.map(function (s) {
      return '<div class="sl"><div class="ic ' + esc(s.status) + '">' + (STATUS_ICON[s.status] || '·') + '</div>' +
        '<div class="tx"><b>' + esc(s.name) + '</b> <span style="color:#7c8b9c">' + esc(STATUS_TEXT[s.status] || s.status) + '</span>' +
        '<p>' + esc(s.message || '') + '</p></div>' +
        '<div class="ms">' + (s.ms ? s.ms + 'ms' : '—') + '</div></div>';
    }).join('') : '<div class="sl"><div class="tx"><p>暂无阶段数据（N/A）</p></div></div>';

    if (meta) {
      $('first-run').className = 'notice warn' + (meta.firstRun ? ' show' : '');
      $('kv-appdir').textContent = meta.appDir || 'N/A';
      $('kv-appdir').title = meta.appDir || '';
      $('kv-settingspath').textContent = meta.settingsPath || 'N/A';
      $('kv-settingspath').title = meta.settingsPath || '';
      $('kv-runtime').textContent = (meta.electron || 'N/A') + ' / ' + (meta.node || 'N/A');
      $('kv-packaged').textContent = meta.packaged ? '是（exe）' : '否（开发态）';
      $('kv-home').textContent = (meta.winnas && meta.winnas.home) || 'N/A（未找到）';
      $('kv-home').title = (meta.winnas && meta.winnas.home) || '';
      $('kv-priv').textContent = st ? (st.admin ? '管理员' : '普通用户') : 'N/A';
      if (meta.backendError) notice('errmsg', '<b>后端启动异常</b><br>' + esc(String(meta.backendError).slice(0, 400)), true);
      if (meta.portShifted) setStatus('注意：端口 ' + meta.portPreferred + ' 被占用，本次临时使用 ' + (st ? st.port : '?') + '（设置未被改写）', 'err');
      else if (online) setStatus('后端在线 · 所有设置修改即时热生效，不会关闭任何窗口', 'ok');
    }
  }

  function renderLogs() {
    var lines = S.logs || [];
    if (!lines.length) { $('logs').textContent = '暂无后端输出（N/A）'; return; }
    $('logs').innerHTML = lines.map(function (l) {
      var lv = l.level === 'error' ? 'e' : (l.level === 'warn' ? 'w' : '');
      return '<span class="' + lv + '">' + esc(l.text) + '</span>';
    }).join('\n');
    $('logs').scrollTop = $('logs').scrollHeight;
  }

  /* ---------------- 操作 ---------------- */
  async function refresh() {
    if (!D) return;
    try { render(await D.getStatus()); } catch (e) { setStatus('读取后端状态失败：' + e.message, 'err'); }
  }
  async function refreshLogs() {
    if (!D) return;
    try { var r = await D.getLogs(); if (r && r.ok) { S.logs = r.lines || []; renderLogs(); } } catch (e) {}
  }
  async function save() {
    if (!D) { setStatus('未连接桌面主进程（N/A）', 'err'); return; }
    notice('errmsg', '', false); notice('okmsg', '', false);
    var pwd = $('password').value, pwd2 = $('password2').value;
    if (pwd !== pwd2) { notice('errmsg', '两次输入的新密码不一致。', true); return; }
    if (pwd && pwd.length < 3) { notice('errmsg', '新密码至少需要 3 位。', true); return; }
    if ($('host').value === '0.0.0.0' && !S.meta) {
      // meta 缺失时不阻断，只是提示
    }
    var data = {
      port: Number($('port').value) || 5080,
      host: $('host').value,
      username: $('username').value.trim() || 'admin',
      password: pwd,
      dataDir: $('dataDir').value.trim(),
      winnasHome: $('winnasHome').value.trim(),
      bootGapMs: Number($('bootGapMs').value) || 0,
      wslAutostart: $('wslAutostart').checked,
      autoOpenSettings: $('autoOpenSettings').checked,
      minimizeToTray: $('minimizeToTray').checked,
      startWithWindows: $('startWithWindows').checked
    };
    setStatus('正在保存并热应用…', '');
    $('save').disabled = true;
    try {
      var r = await D.saveSettings(data);
      if (r.status) S.status = r.status;
      if (r.meta) S.meta = r.meta;
      var errs = (r.applied && r.applied.errors) || [];
      if (errs.length) {
        notice('errmsg', '<b>部分设置未生效</b><br>' + errs.map(esc).join('<br>'), true);
        setStatus('保存完成，但有 ' + errs.length + ' 项需要检查', 'err');
      } else {
        var parts = ['已保存并热应用'];
        if (r.applied && r.applied.portChanged) parts.push('端口已切换，前端页面已自动重载');
        if (r.sessionsCleared) parts.push('会话已失效，前端窗口需重新登录');
        if (r.needsRestart) parts.push(r.restartReason + '：请点「重启应用」');
        notice('okmsg', '<b>' + esc(parts[0]) + '</b>' +
          (parts.length > 1 ? '<br>' + parts.slice(1).map(esc).join('<br>') : ''), true);
        setStatus(parts.join(' · '), 'ok');
      }
      $('password').value = ''; $('password2').value = '';
      render({ status: r.status, meta: r.meta });
      await refresh();
    } catch (e) {
      notice('errmsg', '保存失败：' + esc(e.message), true);
      setStatus('保存失败：' + e.message, 'err');
    } finally { $('save').disabled = false; }
  }

  /* ---------------- 事件绑定 ---------------- */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.onclick = function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('on'); });
      document.querySelectorAll('.view').forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on');
      var v = $('view-' + t.getAttribute('data-view')); if (v) v.classList.add('on');
      if (t.getAttribute('data-view') === 'log') renderLogs();
    };
  });
  $('save').onclick = save;
  $('open-main').onclick = function () { if (D) D.openMain(); };
  $('reload').onclick = function () { if (D) { D.reloadMain(); setStatus('已请求重载前端界面', 'ok'); } };
  $('open-data').onclick = function () { if (D) D.openDataDir(); };
  $('restart').onclick = function () {
    if (!D) return;
    if (window.confirm('重启应用会短暂关闭两个窗口并重新加载后端（不会删除或迁移任何数据）。继续？')) D.restartApp();
  };
  $('pick-engine').onclick = async function () {
    if (!D) return; var r = await D.pickDir(); if (r && r.ok && r.path) $('winnasHome').value = r.path;
  };
  $('pick-data').onclick = async function () {
    if (!D) return; var r = await D.pickDir(); if (r && r.ok && r.path) $('dataDir').value = r.path;
  };
  $('refresh-status').onclick = refresh;
  $('refresh-logs').onclick = refreshLogs;

  /* ---------------- 初始化 ---------------- */
  (async function init() {
    if (!D) {
      setStatus('未连接桌面主进程（N/A）：本窗口需要从桌面 exe 启动', 'err');
      $('badge').textContent = 'N/A'; $('badge').className = 'badge off';
      $('logs').textContent = '未连接桌面主进程（N/A）';
      return;
    }
    try {
      var r = await D.getSettings();
      if (r && r.ok) {
        S.settings = r.settings; S.status = r.status; S.meta = r.meta;
        fillForm(r.settings, r.meta);
        render({ status: r.status, meta: r.meta });
      }
      await refresh();
      await refreshLogs();
      D.onStatus(function (p) {
        render(p);
        if (p && p.logs) renderLogs();
      });
    } catch (e) { setStatus('初始化失败：' + e.message, 'err'); }
  })();
})();
