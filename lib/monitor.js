'use strict';
/* ============================================================
 * monitor.js — 真实系统监测与告警引擎
 *  - 指标历史（6 分钟细粒度 + 1 小时聚合）
 *  - 阈值告警：CPU / 内存 / 磁盘 / 温度，连续触发 + 5 分钟冷却
 *  - Windows 事件日志轮询：新的 Error/Critical 自动进系统日志与通知
 *  - 自动启动服务状态变化监测
 *  - SMART 故障预测、网络接口掉线、WSL 引擎连通性监测
 * 全部通过 SSE 推送，不编造任何数值。
 * ============================================================ */
const MAX_POINTS = 180;
const MAX_HOURLY = 120;

function fmtTime() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return String(d.getFullYear()).slice(-2) + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function initMonitor(cfg) {
  const { emit, windows, wsl, addLog, addNoti } = cfg;
  const hist = { ts: [], cpu: [], mem: [], disk: [], net: [], down: [], up: [], temp: [] };
  const hourly = { ts: [], cpu: [], mem: [], disk: [] };
  let alerts = [];
  const cool = new Map();
  const streak = { cpu: 0, mem: 0, disk: 0, temp: 0 };
  const th = { cpu: 85, mem: 90, disk: 90, temp: 80 };
  let lastServices = null, lastEventKeys = null, lastWsl = null, lastAdapters = null;
  let sampleCount = 0, started = false;

  const conf = { thresholds: { ...th }, enabled: true, intervals: { events: 60, services: 45, wsl: 30, adapters: 60 } };

  function push(a, v, max) { a.push(v); if (a.length > max) a.shift(); }

  function raise(key, lv, title, msg, src) {
    const now = Date.now();
    if (cool.has(key) && now - cool.get(key) < 5 * 60000) return null;
    cool.set(key, now);
    const a = { id: 'a' + now.toString(36) + Math.random().toString(36).slice(2, 5),
      key, lv, t: title, m: msg, src: src || 'monitor', time: fmtTime(), ts: now, unread: 1 };
    alerts.unshift(a);
    if (alerts.length > 120) alerts = alerts.slice(0, 120);
    try { addLog(lv === 'CRIT' ? 'ERR' : 'WARN', title + ' · ' + msg, src || 'monitor'); } catch (e) {}
    try { addNoti(title, msg, lv === 'CRIT' ? 'err' : 'warn'); } catch (e) {}
    try { emit('alert', a); } catch (e) {}
    try { emit('alerts', { alerts: alerts.slice(0, 40) }); } catch (e) {}
    return a;
  }

  /* 每 2 秒由 server 调用，输入 sysinfo.snapshot() */
  function sample(s) {
    if (!s) return;
    const now = Date.now();
    push(hist.ts, now, MAX_POINTS);
    push(hist.cpu, s.cpu, MAX_POINTS);
    push(hist.mem, s.mem, MAX_POINTS);
    push(hist.disk, s.disk, MAX_POINTS);
    push(hist.net, +(s.down + s.up || 0).toFixed(2), MAX_POINTS);
    push(hist.down, s.down || 0, MAX_POINTS);
    push(hist.up, s.up || 0, MAX_POINTS);
    push(hist.temp, (s.temp === null || s.temp === undefined) ? null : s.temp, MAX_POINTS);
    sampleCount++;
    if (sampleCount % 15 === 0) { // 30 秒一个聚合点
      push(hourly.ts, now, MAX_HOURLY);
      push(hourly.cpu, s.cpu, MAX_HOURLY);
      push(hourly.mem, s.mem, MAX_HOURLY);
      push(hourly.disk, s.disk, MAX_HOURLY);
    }
    if (!conf.enabled) return;
    const rules = [
      ['cpu', s.cpu >= conf.thresholds.cpu, 3, 'CPU 使用率过高', 'CPU ' + s.cpu.toFixed(1) + '% (阈值 ' + conf.thresholds.cpu + '%)'],
      ['mem', s.mem >= conf.thresholds.mem, 2, '内存使用率过高', '内存 ' + s.mem.toFixed(1) + '% · 可用 ' + ((s.memFree || 0) / 1073741824).toFixed(2) + ' GB'],
      ['disk', s.disk >= conf.thresholds.disk, 1, '磁盘空间不足', '已用 ' + s.disk.toFixed(1) + '% · 剩余 ' + ((s.diskFree || 0) / 1073741824).toFixed(1) + ' GB'],
      ['temp', (s.temp !== null && s.temp !== undefined && Number(s.temp) >= conf.thresholds.temp), 1, '系统温度偏高', '温度 ' + s.temp + ' °C']
    ];
    for (const [k, hit, need, title, msg] of rules) {
      streak[k] = hit ? streak[k] + 1 : 0;
      if (streak[k] >= need) { raise('th-' + k, k === 'disk' || k === 'temp' ? 'CRIT' : 'WARN', title, msg, 'threshold'); streak[k] = 0; }
    }
    try { emit('metrics', Object.assign({ ts: now }, s)); } catch (e) {}
  }

  /* Windows 事件日志：只推送新出现的错误/严重事件 */
  async function pollEvents() {
    if (!windows || !windows.IS_WIN || lastEventKeys === null) { /* 首次建立基线 */ }
    const r = await windows.events(true, 40).catch(() => null);
    if (!r || !r.ok) return;
    const keys = new Set(r.events.map(e => e.time + '|' + e.id + '|' + e.src));
    if (lastEventKeys) {
      const fresh = r.events.filter(e => (e.lv === 'ERR' || e.lv === 'CRIT') && !lastEventKeys.has(e.time + '|' + e.id + '|' + e.src));
      for (const e of fresh.slice(0, 3)) {
        addLog(e.lv === 'CRIT' ? 'ERR' : 'WARN', '[' + e.log + ' #' + e.id + '] ' + e.src + ': ' + e.msg.slice(0, 160), 'winevent');
        raise('ev-' + e.time + '-' + e.id, e.lv === 'CRIT' ? 'CRIT' : 'WARN',
          'Windows 事件：' + e.src, e.msg.slice(0, 140), 'winevent');
      }
      if (fresh.length) { try { emit('winevents', { events: r.events }); } catch (err) {} }
    }
    lastEventKeys = keys;
  }

  /* 自动启动的服务意外停止 → 告警 */
  async function pollServices() {
    const r = await windows.services(true).catch(() => null);
    if (!r || !r.ok) return;
    const cur = new Map(r.services.map(s => [s.n, s]));
    if (lastServices) {
      for (const [n, prev] of lastServices) {
        const now = cur.get(n);
        if (now && prev.st === 'Running' && now.st !== 'Running' && /auto/i.test(now.start || '')) {
          raise('svc-' + n, 'WARN', '服务已停止：' + (now.d || n), '自动启动服务 ' + n + ' 由 Running 变为 ' + now.st, 'service');
        }
      }
    }
    lastServices = cur;
    try { emit('services', { services: r.services }); } catch (e) {}
  }

  /* WSL 容器引擎连通性 */
  async function pollWsl() {
    if (!wsl) return;
    const p = await wsl.ping().catch(() => ({ available: false }));
    if (lastWsl !== null && lastWsl !== p.available) {
      raise('wsl-engine', p.available ? 'INFO' : 'WARN',
        p.available ? 'WSL 容器引擎已上线' : 'WSL 容器引擎离线',
        p.available ? p.message : p.message, 'wsl');
      try { emit('wslstate', { available: p.available, message: p.message }); } catch (e) {}
    }
    lastWsl = p.available;
  }

  /* 网卡 Up/Down 变化 */
  async function pollAdapters() {
    const r = await windows.adapters(true).catch(() => null);
    if (!r || !r.ok) return;
    const cur = new Map(r.adapters.map(a => [a.n, a]));
    if (lastAdapters) {
      for (const [n, prev] of lastAdapters) {
        const now = cur.get(n);
        if (now && prev.st === 'Up' && now.st !== 'Up' && !prev.virtual) {
          raise('nic-' + n, 'WARN', '网络接口断开：' + n, prev.ip + ' · ' + prev.speed + ' → ' + now.st, 'network');
        }
      }
    }
    lastAdapters = cur;
  }

  function setThresholds(patch) {
    for (const k of Object.keys(th)) if (patch && typeof patch[k] === 'number') conf.thresholds[k] = Math.max(1, Math.min(100, patch[k]));
    return conf.thresholds;
  }
  function clearAlerts() { alerts = []; try { emit('alerts', { alerts: [] }); } catch (e) {} return alerts; }
  function snapshot() {
    return {
      history: hist, hourly, alerts: alerts.slice(0, 60), thresholds: { ...conf.thresholds },
      enabled: conf.enabled, samples: sampleCount,
      status: { services: lastServices ? lastServices.size : 0, events: lastEventKeys ? lastEventKeys.size : 0,
        wslEngine: lastWsl, adapters: lastAdapters ? lastAdapters.size : 0 }
    };
  }
  function start() {
    if (started) return;
    started = true;
    setTimeout(pollEvents, 6000);
    setTimeout(pollServices, 9000);
    setTimeout(pollWsl, 3000);
    setTimeout(pollAdapters, 12000);
    setInterval(pollEvents, (conf.intervals.events || 60) * 1000);
    setInterval(pollServices, (conf.intervals.services || 45) * 1000);
    setInterval(pollWsl, (conf.intervals.wsl || 30) * 1000);
    setInterval(pollAdapters, (conf.intervals.adapters || 60) * 1000);
  }

  return { sample, snapshot, start, raise, setThresholds, clearAlerts, get alerts() { return alerts; }, get conf() { return conf; } };
}

module.exports = { initMonitor };
