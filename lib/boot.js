'use strict';
/* ==================================================================
 * lib/boot.js — NasDeck WinNAS 渐进式启动编排器（零第三方依赖）
 *
 * 设计目标（用户明确要求）：
 *  1. 后端启动后「第一部分」只负责撑起前端面板：HTTP / 静态页 / 鉴权 /
 *     基础 API / SSE 通道。这部分由 server.js 在 listen() 之前同步完成，
 *     编排器只把它作为第 1 个阶段如实上报，不阻塞。
 *  2. 之后「先检查和启动环境」，再「按顺序逐级启动内部功能」（docker 等）。
 *     所有阶段串行、阶段之间让出事件循环，绝不同时把 WMI / 索引 /
 *     WSL / 磁盘扫描一起打满。
 *  3. 稳定 / 安全 / 数据安全优先：
 *     - 环境与数据阶段只做只读检查，不改写、不删除任何既有数据；
 *     - 单个阶段失败或超时不阻断后续阶段，也不让进程退出；
 *     - 重的、可省的功能登记为「按需启动」，开机不跑；
 *     - 核心阶段（前端 / 环境 / 数据）一就绪就 coreReady，用户即可进系统，
 *       剩余功能继续在后台逐级上线并可视化。
 *  4. 全程可观测：阶段状态、子步骤、耗时、日志、整体百分比，
 *     既能被 /api/boot/status 轮询（启动屏无需登录），也能经 SSE 推送。
 * ================================================================== */
const { EventEmitter } = require('events');

const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms | 0)));
const yieldLoop = () => new Promise(r => setImmediate(r));
const TERMINAL = new Set(['done', 'warn', 'skipped', 'error', 'timeout']);

class SkipStage extends Error {}
class TimeoutStage extends Error {}

function createBoot(opts) {
  opts = opts || {};
  const bus = new EventEmitter();
  bus.setMaxListeners(0);

  const gapMs = Number(opts.gapMs != null ? opts.gapMs : 320);
  const startedAt = Date.now();
  const stages = [];
  const logs = [];
  const onDemand = [];
  let phase = 'waiting';        // waiting → booting → core-ready → ready / degraded
  let running = false;
  let finished = false;
  let currentId = null;
  let coreReady = false;
  let updatedAt = startedAt;
  let seq = 0;

  const safeText = v => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, 400);

  function log(level, msg, stage) {
    const e = {
      id: ++seq,
      t: new Date().toISOString(),
      level: String(level || 'INFO').toUpperCase(),
      stage: stage || '-',
      msg: safeText(msg)
    };
    logs.push(e);
    if (logs.length > 400) logs.shift();
    return e;
  }

  function normalize(s) {
    if (!s || !s.id || typeof s.run !== 'function') throw new Error('boot.define: 阶段需要 id 与 run()');
    return {
      id: String(s.id),
      name: String(s.name || s.id),
      desc: String(s.desc || ''),
      group: String(s.group || '功能'),
      core: !!s.core,
      critical: !!s.critical,
      optional: s.optional !== false,
      weight: Number(s.weight || 1),
      timeoutMs: Number(s.timeoutMs || 30000),
      status: 'pending',
      progress: 0,
      start: 0,
      end: 0,
      ms: 0,
      detail: '',
      message: '',
      steps: [],
      run: s.run,
      _skip: false,
      _running: false
    };
  }

  function define(list) {
    (Array.isArray(list) ? list : [list]).forEach(s => {
      const n = normalize(s);
      if (stages.some(x => x.id === n.id)) throw new Error('boot.define: 阶段 id 重复 ' + n.id);
      stages.push(n);
    });
    return api;
  }

  function addOnDemand(list) {
    (Array.isArray(list) ? list : [list]).forEach(x => {
      if (!x || !x.id) return;
      const i = onDemand.findIndex(y => y.id === x.id);
      const item = {
        id: String(x.id), name: String(x.name || x.id), desc: String(x.desc || ''),
        cost: String(x.cost || '按需'), status: 'idle', message: '', ts: 0,
        run: typeof x.run === 'function' ? x.run : null
      };
      if (i >= 0) onDemand[i] = item; else onDemand.push(item);
    });
    return api;
  }

  function overall() {
    const total = stages.reduce((a, s) => a + s.weight, 0) || 1;
    const got = stages.reduce((a, s) => a + s.weight * (Number(s.progress) || 0) / 100, 0);
    return Math.min(100, Math.round(got / total * 1000) / 10);
  }

  function status() {
    const counts = { total: stages.length, done: 0, running: 0, pending: 0, skipped: 0, warn: 0, error: 0 };
    stages.forEach(s => { if (Object.prototype.hasOwnProperty.call(counts, s.status)) counts[s.status]++; });
    return {
      ok: true,
      service: 'NasDeck WinNAS Boot Orchestrator',
      version: '2.3.0',
      phase, running, finished, coreReady,
      startedAt, updatedAt, elapsed: Date.now() - startedAt,
      overall: overall(),
      current: currentId,
      counts,
      stages: stages.map(s => ({
        id: s.id, name: s.name, desc: s.desc, group: s.group,
        core: s.core, critical: s.critical, optional: s.optional, weight: s.weight,
        status: s.status, progress: Number(s.progress) || 0,
        start: s.start, end: s.end, ms: s.ms,
        detail: s.detail, message: s.message,
        steps: s.steps.slice(-12)
      })),
      log: logs.slice(-120),
      onDemand: onDemand.map(x => ({
        id: x.id, name: x.name, desc: x.desc, cost: x.cost,
        status: x.status, message: x.message, ts: x.ts
      })),
      safety: {
        staged: true,
        serial: true,
        readOnlyChecks: ['environment', 'storage'],
        noDataRewrite: true,
        noDataDelete: true,
        failureTolerant: true,
        note: '环境与数据阶段只做只读校验；单个阶段失败/超时不阻断系统；重功能按需启动，开机不跑全盘索引、硬件深采、媒体扫描与 BT 引擎。'
      },
      server: {
        node: process.version, platform: process.platform, arch: process.arch,
        pid: process.pid, uptimeSec: Math.round(process.uptime()),
        rssMB: Math.round(process.memoryUsage().rss / 1048576)
      }
    };
  }

  function changed(reason, stage) {
    updatedAt = Date.now();
    const snap = status();
    try { bus.emit('change', snap, reason || '', stage || null); } catch (e) {}
    if (opts.emit) { try { opts.emit('boot', { reason: reason || '', stage: stage || null, status: snap }); } catch (e) {} }
    if (opts.onLog) {
      // 日志由 log() 单独推，避免每次进度变化重复推送
    }
    return snap;
  }

  function logAndPush(level, msg, stage) {
    const e = log(level, msg, stage);
    if (opts.emit) { try { opts.emit('bootlog', e); } catch (err) {} }
    changed('log', stage);
  }

  function ctxFor(s) {
    return {
      stage: s.id,
      log: (lv, msg) => logAndPush(lv, msg, s.id),
      step(label, pct, detail) {
        s.steps.push({ t: Date.now(), label: safeText(label), pct: Number(pct) || 0, detail: safeText(detail || '') });
        if (s.steps.length > 40) s.steps.shift();
        s.progress = Math.max(0, Math.min(99, Number(pct) || 0));
        s.detail = safeText(label);
        changed('step', s.id);
      },
      detail(text) { s.detail = safeText(text); changed('detail', s.id); },
      skip(reason) { throw new SkipStage(reason || '用户跳过'); },
      checkSkip() { if (s._skip) throw new SkipStage('启动过程中被跳过'); },
      async sleep(ms) { await sleep(ms); this.checkSkip(); },
      async yield() { await yieldLoop(); this.checkSkip(); }
    };
  }

  async function runStage(s) {
    if (s._running) return;
    if (TERMINAL.has(s.status)) return;
    s._running = true;
    s.status = 'running';
    s.start = Date.now();
    s.progress = 2;
    s.detail = '准备中';
    s.message = '';
    currentId = s.id;
    logAndPush('INFO', '开始阶段：' + s.name + (s.desc ? ' · ' + s.desc : ''), s.id);
    changed('stage-start', s.id);

    const ctx = ctxFor(s);
    let timeoutHandle = null;
    const timer = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new TimeoutStage('阶段超过 ' + Math.round(s.timeoutMs / 1000) + ' 秒，转入后台继续执行')), s.timeoutMs);
    });

    try {
      const value = await Promise.race([
        Promise.resolve().then(() => s.run(ctx)),
        timer
      ]);
      s.status = 'done';
      s.progress = 100;
      s.detail = s.detail || '已完成';
      if (value && typeof value === 'object') {
        if (value.message) s.message = safeText(value.message);
        if (value.detail) s.detail = safeText(value.detail);
        if (value.warn) s.status = 'warn';
        if (value.progress != null) s.progress = Math.max(0, Math.min(100, Number(value.progress) || 0));
      }
      /* 阶段进入终态即代表「启动流程这一步已处理完」，进度必须走满，
         否则整体百分比永远差几个点，用户会误以为卡住。功能是否成功由
         status=warn / timeout 与 message 单独表达。 */
      logAndPush(s.status === 'warn' ? 'WARN' : 'INFO',
        '阶段完成：' + s.name + (s.message ? ' · ' + s.message : '') + ' (' + (Date.now() - s.start) + 'ms)', s.id);
    } catch (e) {
      if (e instanceof SkipStage) {
        s.status = 'skipped';
        s.progress = 100;
        s.message = safeText(e.message);
        s.detail = '已跳过';
        logAndPush('WARN', '阶段跳过：' + s.name + ' · ' + s.message, s.id);
      } else if (e instanceof TimeoutStage) {
        s.status = 'timeout';
        s.progress = 100;
        s.message = safeText(e.message);
        s.detail = '后台继续执行';
        logAndPush('WARN', '阶段超时（不阻断）：' + s.name + ' · ' + s.message, s.id);
      } else {
        s.status = s.critical ? 'error' : 'warn';
        s.progress = 100;
        s.message = safeText(e && e.message || e);
        s.detail = s.critical ? '核心阶段异常（系统继续启动）' : '可选阶段异常（已跳过，不影响使用）';
        logAndPush('ERR', '阶段异常：' + s.name + ' · ' + s.message + ' · 继续启动后续阶段', s.id);
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      s.end = Date.now();
      s.ms = s.end - s.start;
      s._running = false;
      currentId = null;
      changed('stage-end', s.id);
    }
  }

  function maybeCore() {
    if (coreReady) return;
    const cores = stages.filter(s => s.core);
    if (!cores.length) return;
    if (!cores.every(s => TERMINAL.has(s.status))) return;
    coreReady = true;
    if (phase === 'booting' || phase === 'waiting') phase = 'core-ready';
    logAndPush('INFO', '核心能力已就绪：前端面板 / 环境 / 数据。现在即可进入系统，其余功能继续逐级上线。', 'core');
    try { bus.emit('core', status()); } catch (e) {}
    changed('core-ready', 'core');
  }

  async function start() {
    if (running || finished) return status();
    running = true;
    phase = 'booting';
    logAndPush('INFO', '启动编排器开始工作 · 共 ' + stages.length + ' 个阶段 · 串行执行，阶段间隔 ' + gapMs + 'ms', 'boot');
    changed('start', 'boot');
    (async () => {
      for (const s of stages) {
        if (s._skip && s.status === 'pending') {
          s.status = 'skipped'; s.progress = 100; s.message = '启动前已跳过'; s.detail = '已跳过';
          s.start = s.end = Date.now();
          changed('skip', s.id);
          maybeCore();
          continue;
        }
        await runStage(s);
        maybeCore();
        // 阶段之间主动让出事件循环并留出系统喘息时间，避免一次性打满 CPU / IO
        await yieldLoop();
        await sleep(gapMs);
      }
      running = false;
      finished = true;
      const bad = stages.filter(s => s.status === 'error').length;
      phase = bad ? 'degraded' : 'ready';
      logAndPush(bad ? 'WARN' : 'INFO',
        bad ? ('启动完成（降级）：' + bad + ' 个核心阶段异常，但系统仍可用，可在启动中心重试。')
            : '启动完成：全部阶段已处理，系统可用。', 'boot');
      try { bus.emit('finished', status()); } catch (e) {}
      changed('finished', 'boot');
    })().catch(e => {
      running = false; finished = true; phase = 'degraded';
      logAndPush('ERR', '启动链异常（不退出进程）：' + (e && e.message || e), 'boot');
      changed('error', 'boot');
    });
    return status();
  }

  function skip(id) {
    const s = stages.find(x => x.id === id);
    if (!s) return { ok: false, error: '未知阶段 ' + id };
    if (TERMINAL.has(s.status)) return { ok: false, error: '阶段已结束：' + s.status };
    s._skip = true;
    if (s.status === 'pending') {
      s.status = 'skipped'; s.progress = 100; s.message = '用户跳过'; s.detail = '已跳过';
      s.start = s.end = Date.now();
      logAndPush('WARN', '用户跳过阶段：' + s.name, s.id);
      changed('skip', s.id);
      maybeCore();
    } else {
      logAndPush('WARN', '用户请求跳过运行中的阶段：' + s.name + '（将在下一个检查点生效）', s.id);
    }
    return { ok: true, id, status: s.status };
  }

  async function retry(id) {
    const s = stages.find(x => x.id === id);
    if (!s) return { ok: false, error: '未知阶段 ' + id };
    if (s._running) return { ok: false, error: '阶段正在执行中' };
    s._skip = false;
    s.status = 'pending'; s.progress = 0; s.start = 0; s.end = 0; s.ms = 0;
    s.message = ''; s.detail = ''; s.steps = [];
    logAndPush('INFO', '手动重跑阶段：' + s.name, s.id);
    changed('retry', s.id);
    await runStage(s);
    return { ok: true, id, status: s.status, message: s.message };
  }

  async function startOnDemand(id) {
    const x = onDemand.find(y => y.id === id);
    if (!x) return { ok: false, error: '未知按需功能 ' + id };
    if (x.status === 'running') return { ok: false, error: '该功能正在启动中' };
    x.status = 'running'; x.ts = Date.now(); x.message = '';
    logAndPush('INFO', '按需启动：' + x.name + ' · ' + x.desc, 'on-demand');
    changed('on-demand', 'on-demand');
    try {
      const r = x.run ? await x.run() : null;
      x.status = 'done';
      x.message = safeText(r && r.message || '已启动');
      logAndPush('INFO', '按需功能完成：' + x.name + ' · ' + x.message, 'on-demand');
      changed('on-demand', 'on-demand');
      return { ok: true, id, message: x.message, data: r && r.data || null };
    } catch (e) {
      x.status = 'error';
      x.message = safeText(e && e.message || e);
      logAndPush('ERR', '按需功能失败：' + x.name + ' · ' + x.message, 'on-demand');
      changed('on-demand', 'on-demand');
      return { ok: false, id, error: x.message };
    }
  }

  const api = {
    define, addOnDemand, status, start, skip, retry, startOnDemand,
    get bus() { return bus; },
    get phase() { return phase; },
    get coreReady() { return coreReady; },
    log: (lv, msg, stage) => logAndPush(lv, msg, stage),
    rawLog: log
  };
  return api;
}

module.exports = { createBoot };
