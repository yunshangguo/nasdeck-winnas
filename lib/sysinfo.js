'use strict';
/* ============================================================
 * sysinfo.js — 真实主机信息采集（Windows 优先，Linux 兼容）
 * 全部来自 os / fs.statfsSync / 系统性能计数器，不编造数据
 * ============================================================ */
const os = require('os');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

let prevCpu = null;
let netPrev = null;
const state = {
  down: 0, up: 0, netOk: false, temp: null, procs: [],
  netUpdated: 0, procUpdated: 0, tempUpdated: 0
};

function cpuTimes() {
  const c = os.cpus() || [];
  let idle = 0, total = 0;
  for (const x of c) {
    const t = x.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total, cores: c.length };
}
function cpuUsage() {
  const s = cpuTimes();
  if (!prevCpu || s.total === prevCpu.total) { prevCpu = s; return 0; }
  const di = s.idle - prevCpu.idle, dt = s.total - prevCpu.total;
  prevCpu = s;
  if (dt <= 0) return 0;
  return Math.max(0, Math.min(100, 100 * (1 - di / dt)));
}
function memInfo() {
  const total = os.totalmem(), free = os.freemem(), used = total - free;
  return { total, free, used, pct: total ? (used / total) * 100 : 0 };
}
function drives() {
  const out = [];
  const add = (label, mount) => {
    try {
      const st = fs.statfsSync(mount);
      const bs = st.bsize || 4096;
      const total = Number(st.blocks) * bs;
      const free = Number(st.bavail) * bs;
      if (!total) return;
      out.push({ name: label, mount, total, free, used: total - free, pct: (total - free) / total * 100 });
    } catch (e) {}
  };
  if (process.platform === 'win32') {
    for (let i = 65; i <= 90; i++) {
      const L = String.fromCharCode(i);
      add(L + ':', L + ':\\');
    }
  } else {
    add('/', '/');
    for (const m of ['/mnt', '/media', '/home', '/volume1']) add(m, m);
  }
  return out;
}
function diskSummary() {
  const d = drives();
  const total = d.reduce((a, x) => a + x.total, 0);
  const used = d.reduce((a, x) => a + x.used, 0);
  return { count: d.length, total, used, free: total - used, pct: total ? used / total * 100 : 0 };
}
function interfaces() {
  const out = [];
  const all = os.networkInterfaces();
  for (const name of Object.keys(all)) {
    for (const a of all[name] || []) {
      out.push({ name, mac: a.mac, ip: a.address, cidr: a.cidr, family: a.family, internal: a.internal,
        speed: a.speed === undefined ? null : a.speed });
    }
  }
  return out;
}

function ps(cmd, cb) {
  const full = 'powershell -NoProfile -NonInteractive -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
    cmd.replace(/"/g, '\\"') + '"';
  cp.exec(full, { timeout: 9000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
    if (err) { cb(err); return; }
    try { cb(null, JSON.parse(String(stdout).trim() || 'null')); }
    catch (e) { cb(e); }
  });
}
function sampleNetwork() {
  if (process.platform !== 'win32') {
    try {
      const txt = fs.readFileSync('/proc/net/dev', 'utf8');
      let rx = 0, tx = 0;
      for (const l of txt.split('\n').slice(2)) {
        const m = l.match(/^\s*([\w.\-]+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
        if (m && m[1] !== 'lo') { rx += +m[2]; tx += +m[3]; }
      }
      const now = Date.now(), cur = { rx, tx, t: now };
      if (netPrev) {
        const dt = (now - netPrev.t) / 1000;
        if (dt > 0) { state.down = Math.max(0, (rx - netPrev.rx) / dt / 1048576); state.up = Math.max(0, (tx - netPrev.tx) / dt / 1048576); state.netOk = true; }
      }
      netPrev = cur; state.netUpdated = now;
    } catch (e) { state.netOk = false; }
    return;
  }
  ps('Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress', (err, rows) => {
    if (err || !rows) { state.netOk = false; return; }
    const arr = Array.isArray(rows) ? rows : [rows];
    let rx = 0, tx = 0;
    for (const r of arr) { rx += Number(r.ReceivedBytes || 0); tx += Number(r.SentBytes || 0); }
    const now = Date.now(), cur = { rx, tx, t: now };
    if (netPrev && now > netPrev.t) {
      const dt = (now - netPrev.t) / 1000;
      state.down = Math.max(0, (rx - netPrev.rx) / dt / 1048576);
      state.up = Math.max(0, (tx - netPrev.tx) / dt / 1048576);
      state.netOk = true;
    }
    netPrev = cur; state.netUpdated = now;
  });
}
function sampleProcesses() {
  if (process.platform !== 'win32') {
    try {
      const dirs = fs.readdirSync('/proc').filter(x => /^\d+$/.test(x));
      state.procs = dirs.slice(0, 40).map(pid => {
        try {
          const st = fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(' ');
          return { name: st[1].replace(/[()]/g, ''), pid: +pid, mem: 0, cpu: 0 };
        } catch (e) { return null; }
      }).filter(Boolean);
      state.procUpdated = Date.now();
    } catch (e) {}
    return;
  }
  ps('Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 30 ProcessName,Id,WorkingSet64,CPU | ConvertTo-Json -Compress', (err, rows) => {
    if (err || !rows) return;
    const arr = Array.isArray(rows) ? rows : [rows];
    state.procs = arr.map(r => ({ name: String(r.ProcessName || ''), pid: Number(r.Id || 0), mem: Number(r.WorkingSet64 || 0), cpu: Number(r.CPU || 0) }));
    state.procUpdated = Date.now();
  });
}
function sampleTemp() {
  if (process.platform !== 'win32') {
    try {
      for (const z of fs.readdirSync('/sys/class/thermal')) {
        if (!z.startsWith('thermal_zone')) continue;
        const v = +fs.readFileSync('/sys/class/thermal/' + z + '/temp', 'utf8');
        if (!Number.isNaN(v)) { state.temp = Math.round(v / 1000); break; }
      }
    } catch (e) {}
    state.tempUpdated = Date.now();
    return;
  }
  ps('(Get-CimInstance -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty CurrentTemperature)', (err, v) => {
    if (!err && typeof v === 'number' && v > 0) state.temp = Math.round(v / 10 - 273.15);
    state.tempUpdated = Date.now();
  });
}

function info() {
  const c = os.cpus() || [{}];
  return {
    hostname: os.hostname(), platform: process.platform, arch: os.arch(),
    release: os.release(), osType: os.type(), node: process.version,
    cpuModel: c[0].model || 'Unknown', cores: c.length,
    totalMem: os.totalmem(), uptime: os.uptime(),
    home: os.homedir(), tmp: os.tmpdir(),
    loadavg: os.loadavg ? os.loadavg() : null
  };
}
function snapshot() {
  const mem = memInfo(), disk = diskSummary();
  return {
    ts: Date.now(),
    cpu: +cpuUsage().toFixed(1),
    mem: +mem.pct.toFixed(1), memUsed: mem.used, memTotal: mem.total, memFree: mem.free,
    net: +(state.down + state.up).toFixed(2), down: +state.down.toFixed(2), up: +state.up.toFixed(2),
    netOk: state.netOk,
    disk: +disk.pct.toFixed(1), diskUsed: disk.used, diskTotal: disk.total, diskFree: disk.free,
    temp: state.temp, uptime: os.uptime(), cores: (os.cpus() || []).length
  };
}
function start(emit) {
  sampleNetwork(); sampleProcesses(); sampleTemp();
  setInterval(sampleNetwork, 4000);
  setInterval(sampleProcesses, 12000);
  setInterval(sampleTemp, 30000);
  setInterval(() => { try { emit('metrics', snapshot()); } catch (e) {} }, 2000);
}

module.exports = { info, snapshot, drives, diskSummary, interfaces, start, get processes() { return state.procs; }, state };
