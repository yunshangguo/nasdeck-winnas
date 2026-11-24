'use strict';
/* ============================================================
 * wsl.js — WSL 容器引擎层（容器工作台 的真实后端）
 *
 * 设计：直接访问 WSL 发行版内 dockerd 暴露的 Docker Engine HTTP API
 * （本机 127.0.0.1:2375，Windows localhost forwarding），零第三方依赖。
 * 不使用 Docker Desktop，不需要 npm 包。
 *
 * 说明：
 *  - 常规读写只用 TCP/HTTP，不启动 wsl.exe，毫秒级响应。
 *  - 只有「WSL 状态查询 / 启动引擎 / 管理发行版」这几个显式动作
 *    才会调用 wsl.exe（用户在界面上主动点击时）。
 *  - 引擎不可达时如实返回 available:false，绝不编造容器数据。
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const DEFAULT = { host: '127.0.0.1', port: 2375, distro: 'Debian', socket: '' };

/* wsl.exe 的绝对路径：服务/后台进程常被裁剪 PATH，靠 'wsl.exe' 会 ENOENT。
   32 位进程访问 System32 会被重定向，故额外尝试 Sysnative。 */
function resolveWslExe() {
  const sr = process.env.SystemRoot || 'C:\\Windows';
  for (const p of [path.join(sr, 'System32', 'wsl.exe'), path.join(sr, 'Sysnative', 'wsl.exe')]) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return 'wsl.exe';
}
const WSL_EXE = resolveWslExe();

/* wsl.exe 经管道输出可能是 UTF-8 或 UTF-16LE（无 BOM），必须按字节特征判定。 */
function decodeWsl(out) {
  if (out == null) return '';
  const b = Buffer.isBuffer(out) ? out : Buffer.from(String(out), 'utf8');
  try {
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return b.slice(2).toString('utf16le');
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return b.slice(3).toString('utf8');
    /* wsl --status 常返回 UTF-16LE 但首字节是中文（不是 ASCII），
       只看「奇数位为 0 的比例」会漏判，导致中文状态被按 UTF-8 解成乱码。
       这里改成看偶数长度 + 奇数位零比例，并允许 buffer 末尾多一个字节。 */
    if (b.length >= 4) {
      const n = Math.min(b.length - (b.length % 2), 400);
      let oddZero = 0, pairs = 0;
      for (let i = 0; i + 1 < n; i += 2) { pairs++; if (b[i + 1] === 0) oddZero++; }
      if (pairs && oddZero / pairs >= 0.6) return b.slice(0, n).toString('utf16le');
    }
    let t = b.toString('utf8');
    if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
    return t;
  } catch (e) { return String(out); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* 自动识别本机已有的 WSL Docker 管理器配置（纯文件读取） */
function autoConfig() {
  const candidates = [
    'D:\\WslDockerManager\\config.json',
    path.join(process.env.USERPROFILE || '', 'WslDockerManager', 'config.json'),
    path.join(process.env.LOCALAPPDATA || '', 'Docker', 'config.json')
  ];
  for (const f of candidates) {
    try {
      const c = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (c.dockerHost || c.dockerPort) return {
        host: c.dockerHost || DEFAULT.host,
        port: Number(c.dockerPort) || DEFAULT.port,
        distro: c.distro || DEFAULT.distro,
        source: f
      };
    } catch (e) {}
  }
  return { ...DEFAULT, source: 'default' };
}

function initWsl(custom) {
  const cfg = Object.assign(autoConfig(), custom || {});
  let endpoint = { ...cfg };
  const listeners = new Set();

  /* ---------------- WSL 会话保活 + Docker 引擎看门狗 ----------------
     真实问题：WSL2 在没有活动会话时会按 vmIdleTimeout 自动终止发行版，
     dockerd 随之退出、127.0.0.1:2375 掉线，于是 容器工作台 一直
     显示「引擎未运行」，按钮看起来「控制不了真实 Docker」。
     解法：持有一个常驻 WSL 会话（发行版内 sh + sleep 循环）阻止休眠，
     并用看门狗在引擎掉线时自动拉起 dockerd。这是本机已有的
     D:\WslDockerManager「WSL keep-alive 保活进程」同一套做法。 */
  let keepChild = null, keepOn = false, keepTimer = null, engineBusy = null;
  const ka = {
    on: false, pid: null, alive: false, online: false, version: null,
    startedAt: null, lastCheck: null, lastAction: '未启用', restarts: 0, busy: false
  };

  function spawnKeepSession() {
    if (keepChild && !keepChild.killed) return;
    try {
      keepChild = cp.spawn(WSL_EXE,
        ['-d', endpoint.distro || 'Debian', '--', 'sh', '-c', 'while :; do sleep 30; done'],
        { windowsHide: true, stdio: 'ignore' });
      ka.pid = keepChild.pid || null;
      ka.alive = !!ka.pid;
      ka.lastAction = '常驻 WSL 会话已启动 · ' + (endpoint.distro || 'Debian');
      keepChild.on('error', e => { ka.alive = false; ka.lastAction = '保活会话出错：' + e.message; });
      keepChild.on('exit', () => {
        keepChild = null; ka.alive = false; ka.pid = null;
        if (keepOn) setTimeout(() => { if (keepOn) spawnKeepSession(); }, 2000);
      });
    } catch (e) {
      ka.alive = false;
      ka.lastAction = '保活会话无法启动：' + e.message;
    }
  }
  function stopKeepSession() {
    keepOn = false; ka.on = false;
    if (keepTimer) { clearInterval(keepTimer); keepTimer = null; }
    if (keepChild) { try { keepChild.kill(); } catch (e) {} keepChild = null; }
    ka.alive = false; ka.pid = null;
    ka.lastAction = '保活已关闭（WSL 可能在空闲后自动休眠）';
  }

  /* 确保引擎在线：带并发锁，避免看门狗与用户点击重复拉起 dockerd */
  function ensureEngine(force) {
    if (engineBusy) return engineBusy;
    engineBusy = (async () => {
      const p = await ping();
      ka.online = p.available; ka.version = p.version; ka.lastCheck = Date.now();
      if (p.available && !force) return { ok: true, message: '引擎已在线 · ' + (p.version || 'N/A'), version: p.version };
      ka.busy = true;
      const r = await engineStart();
      ka.busy = false;
      ka.online = !!r.ok; ka.version = r.version || ka.version; ka.lastCheck = Date.now();
      ka.lastAction = r.message || '引擎启动流程结束';
      if (r.ok) ka.restarts++;
      return r;
    })();
    return engineBusy.finally(() => { engineBusy = null; });
  }

  function startWatchdog() {
    if (keepTimer) return;
    keepTimer = setInterval(async () => {
      if (!keepOn) return;
      try {
        const p = await ping(1500);
        ka.online = p.available; ka.version = p.version; ka.lastCheck = Date.now();
        if (!p.available) {
          ka.lastAction = '检测到引擎掉线，正在自动拉起 dockerd…';
          await ensureEngine(false);
        }
      } catch (e) { /* 看门狗异常不影响主服务 */ }
    }, 10000);
    if (keepTimer.unref) keepTimer.unref();
  }

  /* 立即开启保活；引擎启动放在后台，HTTP 请求可以马上返回，前端轮询状态 */
  function keepAliveStart() {
    keepOn = true; ka.on = true; ka.startedAt = ka.startedAt || Date.now();
    spawnKeepSession();
    startWatchdog();
    /* 等常驻会话先把发行版唤醒，再启动 dockerd，避免两个 wsl.exe 冷启动互相抢 */
    setTimeout(() => ensureEngine(false).catch(e => { ka.lastAction = '引擎启动失败：' + e.message; }), 2500);
    return keepAliveStatus();
  }
  function keepAliveStop() { stopKeepSession(); return keepAliveStatus(); }
  async function keepAliveStatus() {
    /* 状态查询做一次快速探测（最多 1.5 秒），保证前端看到的是实时真实值 */
    const p = await ping(1500);
    ka.online = p.available; ka.version = p.version; ka.lastCheck = Date.now();
    return {
      ok: true, ...ka, endpoint: { ...endpoint },
      distro: endpoint.distro, busy: !!engineBusy,
      message: p.available ? ('Docker Engine 在线 · ' + (p.version || 'N/A')) : (p.message || '引擎未运行（N/A）')
    };
  }
  /* 服务退出时释放常驻会话，避免残留 wsl.exe */
  process.once('exit', () => { try { if (keepChild && !keepChild.killed) keepChild.kill(); } catch (e) {} });

  function setEndpoint(o) {
    if (!o) o = {};
    /* 显式指定 socket 走命名管道；显式指定 host/port 则切回 TCP。
       这样 /api/wsl/endpoint 与自动发现都能正确切换数据源。 */
    if (Object.prototype.hasOwnProperty.call(o, 'socket')) endpoint.socket = String(o.socket || '');
    else if (o.host || o.port) endpoint.socket = '';
    if (o.host && /^[\w.\-]{1,120}$/.test(o.host)) endpoint.host = o.host;
    if (o.port) endpoint.port = Math.max(1, Math.min(65535, Number(o.port) || 2375));
    if (o.distro) endpoint.distro = String(o.distro).replace(/[^\w.\- ]/g, '').slice(0, 60);
    return { ...endpoint };
  }

  /* Docker Engine HTTP API 请求。
     同时保留原始 Buffer：/containers/{id}/logs 返回的是 multiplexed
     stream（每帧 8 字节二进制头），按 utf8 直接转字符串会损坏内容。 */
  function req(method, api, body, timeout) {
    return new Promise(resolve => {
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const headers = { 'Content-Type': 'application/json' };
      if (payload) headers['Content-Length'] = payload.length;
      /* 命中 Docker Desktop 命名管道时 endpoint.socket 有值，后续所有
         请求都必须走同一条管道，否则会「探测显示在线，却读不到容器」。 */
      const target = endpoint.socket
        ? { socketPath: endpoint.socket }
        : { host: endpoint.host, port: endpoint.port };
      const r = http.request(Object.assign({
        path: api, method, headers, timeout: timeout || 8000, agent: false
      }, target), res => {
        const bufs = [];
        res.on('data', d => bufs.push(d));
        res.on('end', () => {
          const buf = Buffer.concat(bufs);
          const raw = buf.toString('utf8');
          let data = raw;
          try { data = JSON.parse(raw); } catch (e) {}
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, code: res.statusCode, data, raw, buf });
        });
      });
      r.on('timeout', () => { try { r.destroy(); } catch (e) {} resolve({ ok: false, code: 0, data: null, error: '连接超时' }); });
      r.on('error', e => resolve({ ok: false, code: 0, data: null, error: e.code === 'ECONNREFUSED' ? '引擎未运行（连接被拒绝）' : e.message }));
      if (payload) r.write(payload);
      r.end();
    });
  }

  /* 引擎连通性：只做 TCP HTTP，不碰 wsl.exe */
  async function ping(ms) {
    const r = await req('GET', '/version', undefined, ms || 3500);
    if (!r.ok) return { available: false, message: r.error || ('HTTP ' + r.code), version: null };
    const d = r.data || {};
    return {
      available: true,
      version: d.Version || '', apiVersion: d.ApiVersion || '', kernel: d.KernelVersion || '',
      os: d.Os || 'linux', arch: d.Arch || '', message: 'WSL Docker Engine 已连线'
    };
  }

  async function info() {
    const r = await req('GET', '/info', undefined, 6000);
    return r.ok && r.data ? {
      ok: true, containers: r.data.Containers, running: r.data.ContainersRunning,
      paused: r.data.ContainersPaused, stopped: r.data.ContainersStopped,
      images: r.data.Images, ncpu: r.data.NCPU, memTotal: r.data.MemTotal,
      os: r.data.OperatingSystem, kernel: r.data.KernelVersion,
      driver: r.data.Driver, rootDir: r.data.DockerRootDir,
      serverVersion: r.data.ServerVersion
    } : { ok: false, error: r.error || ('HTTP ' + r.code) };
  }

  function portText(ports) {
    if (!Array.isArray(ports) || !ports.length) return 'N/A';
    return ports.slice(0, 3).map(p =>
      (p.PublicPort ? p.IP + ':' + p.PublicPort + '→' : '') + p.PrivatePort + '/' + (p.Type || 'tcp')
    ).join(', ').slice(0, 64);
  }
  function sizeText(n) {
    n = Number(n) || 0;
    return n > 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : (n / 1048576).toFixed(1) + ' MB';
  }

  async function containers() {
    const r = await req('GET', '/containers/json?all=1', undefined, 8000);
    if (!r.ok || !Array.isArray(r.data)) return { available: false, containers: [], message: r.error || ('HTTP ' + r.code) };
    const list = r.data.map(x => ({
      id: String(x.Id || '').slice(0, 12), fullId: x.Id || '',
      n: (x.Names && x.Names[0] ? x.Names[0].replace(/^\//, '') : String(x.Id || '').slice(0, 12)),
      img: x.Image || '', st: x.State === 'running' ? 1 : 0,
      state: x.State || '', status: x.Status || '',
      port: portText(x.Ports), created: x.Created || 0,
      cpu: 'N/A', mem: 'N/A'
    }));
    return { available: true, containers: list, message: '' };
  }

  async function images() {
    const r = await req('GET', '/images/json', undefined, 8000);
    if (!r.ok || !Array.isArray(r.data)) return [];
    return r.data.map(x => {
      const tag = (x.RepoTags && x.RepoTags[0]) || '<none>:<none>';
      const i = tag.lastIndexOf(':');
      return {
        id: String(x.Id || '').replace('sha256:', '').slice(0, 12),
        repo: i > 0 ? tag.slice(0, i) : tag, tag: i > 0 ? tag.slice(i + 1) : '',
        size: sizeText(x.Size), created: x.Created ? new Date(x.Created * 1000).toISOString().slice(0, 10) : '',
        containers: x.Containers || 0
      };
    });
  }

  /* 读取镜像元数据：给「建立容器」窗口提供 ExposedPorts / Env / Volumes /
     Cmd / Entrypoint / Labels 等真实值，避免让用户凭空猜端口和挂载点。 */
  async function imageInspect(image) {
    const name = String(image || '').trim();
    if (!/^[A-Za-z0-9._\-\/:]{1,160}$/.test(name)) throw new Error('非法镜像名');
    const r = await req('GET', '/images/' + encodeURIComponent(name) + '/json', undefined, 10000);
    if (!r.ok || !r.data || typeof r.data !== 'object') {
      return { ok: false, error: (r.data && r.data.message) || ('读取镜像元数据失败 HTTP ' + r.code) };
    }
    const d = r.data, cfg = d.Config || {};
    return {
      ok: true,
      id: String(d.Id || '').replace('sha256:', '').slice(0, 12),
      created: d.Created || '', architecture: d.Architecture || 'N/A', os: d.Os || 'N/A',
      size: Number(d.Size || 0), sizeText: sizeText(Number(d.Size || 0)),
      author: d.Author || 'N/A', dockerVersion: d.DockerVersion || 'N/A',
      digest: (Array.isArray(d.RepoDigests) ? d.RepoDigests[0] : '') || 'N/A',
      exposedPorts: Object.keys(cfg.ExposedPorts || {}),
      volumes: Object.keys(cfg.Volumes || {}),
      env: Array.isArray(cfg.Env) ? cfg.Env : [],
      cmd: Array.isArray(cfg.Cmd) ? cfg.Cmd : [],
      entrypoint: Array.isArray(cfg.Entrypoint) ? cfg.Entrypoint : [],
      workingDir: cfg.WorkingDir || '', user: cfg.User || '',
      labels: cfg.Labels || {}
    };
  }

  async function networks() {
    const r = await req('GET', '/networks', undefined, 6000);
    return r.ok && Array.isArray(r.data) ? r.data.map(x => ({ n: x.Name, driver: x.Driver, scope: x.Scope, id: String(x.Id || '').slice(0, 12) })) : [];
  }

  async function volumes() {
    const r = await req('GET', '/volumes', undefined, 6000);
    return r.ok && r.data && Array.isArray(r.data.Volumes) ? r.data.Volumes.map(x => ({ n: x.Name, driver: x.Driver, mount: x.Mountpoint })) : [];
  }

  /* Docker 非 TTY 日志是 multiplexed stream：
       每帧 = 8 字节头 [stream_type(1|2), 0,0,0, length(4, big-endian)] + payload
     过去整段按 utf8 输出再删控制字符，头部长度字节会变成行首乱码
     （实测 jackett 日志出现 "Q11-12 ..." / ":11-12 ..." / "$11-13 ..."），
     而且会丢掉真实内容。这里按帧解析；TTY 容器（无帧头）自动回退。 */
  function parseDockerStream(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) return '';
    const parts = [];
    let off = 0;
    while (off + 8 <= buf.length) {
      const type = buf[off];
      if ((type !== 1 && type !== 2) || buf[off + 1] !== 0 || buf[off + 2] !== 0 || buf[off + 3] !== 0) break;
      const len = buf.readUInt32BE(off + 4);
      if (!len || off + 8 + len > buf.length) break;
      parts.push(buf.slice(off + 8, off + 8 + len).toString('utf8'));
      off += 8 + len;
    }
    if (!parts.length) {
      return buf.toString('utf8').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/\r/g, '');
    }
    return parts.join('').replace(/\r/g, '');
  }

  /* 容器动作 —— 真实调用 Docker Engine */
  const ACTIONS = {
    start: ['POST', id => '/containers/' + id + '/start'],
    stop: ['POST', id => '/containers/' + id + '/stop'],
    restart: ['POST', id => '/containers/' + id + '/restart'],
    pause: ['POST', id => '/containers/' + id + '/pause'],
    unpause: ['POST', id => '/containers/' + id + '/unpause'],
    remove: ['DELETE', id => '/containers/' + id + '?force=1'],
    logs: ['GET', id => '/containers/' + id + '/logs?stdout=1&stderr=1&tail=120'],
    inspect: ['GET', id => '/containers/' + id + '/json'],
    stats: ['GET', id => '/containers/' + id + '/stats?stream=false&one-shot=true']
  };
  async function action(id, act) {
    if (!/^[A-Za-z0-9_.\-]{1,80}$/.test(String(id || ''))) throw new Error('非法容器 ID');
    if (!ACTIONS[act]) throw new Error('不支持的操作: ' + act);
    const [method, mk] = ACTIONS[act];
    const r = await req(method, mk(id), undefined, act === 'logs' ? 12000 : 20000);
    let out = '';
    if (act === 'logs') {
      out = parseDockerStream(r.buf).slice(0, 12000);
    } else if (act === 'inspect' || act === 'stats') {
      out = typeof r.data === 'object' ? JSON.stringify(r.data, null, 2).slice(0, 12000) : String(r.raw || '').slice(0, 12000);
    }
    return { ok: r.ok, out, code: r.code, error: r.ok ? '' : (r.data && r.data.message) || r.error || ('HTTP ' + r.code) };
  }

  /* 建立容器：完整的 Docker create 参数。
     前端「建立容器」窗口会传结构化字段（资源 / 端口 / 环境 / 映射 / 网络 /
     重启策略），这里逐项校验后组装成 Docker Engine 的 ContainerConfig，
     任何非法值都直接丢弃而不是透传，避免把任意对象塞进 Engine API。 */
  function str(v, max) { return String(v === undefined || v === null ? '' : v).slice(0, max || 300); }
  function toList(v, max) {
    const arr = Array.isArray(v) ? v : String(v || '').split(/[\n,]/);
    return arr.map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, max || 32).map(x => x.slice(0, 500));
  }
  /* Cmd / Entrypoint 在界面上提示「多个参数用空格分隔」，必须按空格切成数组，
     否则 Docker 会把 "nginx -g daemon off" 当成一个可执行文件名而启动失败。 */
  function toWords(v, max) {
    const arr = Array.isArray(v) ? v : String(v || '').trim().split(/\s+/);
    return arr.map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, max || 40).map(x => x.slice(0, 500));
  }
  function num(v, lo, hi) {
    const n = Number(v);
    return isFinite(n) && n >= lo && n <= hi ? n : 0;
  }
  async function create(o) {
    o = o || {};
    const image = str(o.image, 160).trim();
    const name = str(o.name, 90).trim();
    if (!/^[A-Za-z0-9._\-\/:]{1,160}$/.test(image)) throw new Error('非法镜像名');
    if (name && !/^[A-Za-z0-9][A-Za-z0-9_.\-]{0,80}$/.test(name)) throw new Error('非法容器名');

    const body = { Image: image }, hc = {};

    /* 命令 / 入口 / 工作目录 / 用户 / 主机名 / 交互 */
    const cmd = toWords(o.cmd, 40);
    if (cmd.length) body.Cmd = cmd;
    const ep = toWords(o.entrypoint, 20);
    if (ep.length) body.Entrypoint = ep;
    if (str(o.workdir)) body.WorkingDir = str(o.workdir, 300);
    if (str(o.user)) body.User = str(o.user, 120);
    if (str(o.hostname)) body.Hostname = str(o.hostname, 120).replace(/[^A-Za-z0-9.\-]/g, '');
    if (o.tty) { body.Tty = true; body.OpenStdin = true; }

    /* 环境变量 / 标签：只接受 KEY=VALUE */
    const env = toList(o.env, 128).filter(x => /^[A-Za-z_][A-Za-z0-9_]*=/.test(x));
    if (env.length) body.Env = env;
    const labels = {};
    toList(o.labels, 64).forEach(x => { const i = x.indexOf('='); if (i > 0) labels[x.slice(0, i)] = x.slice(i + 1); });
    if (Object.keys(labels).length) body.Labels = labels;

    /* CPU / 内存资源限制 */
    const cpus = num(o.cpus, 0.01, 256);
    if (cpus) hc.NanoCpus = Math.round(cpus * 1e9);
    const shares = num(o.cpuShares, 2, 262144);
    if (shares) hc.CpuShares = Math.round(shares);
    const memMb = num(o.memoryMb, 1, 1048576);
    if (memMb) hc.Memory = Math.round(memMb * 1048576);
    const swapMb = num(o.memorySwapMb, 1, 2097152);
    if (swapMb) hc.MemorySwap = Math.round(swapMb * 1048576);

    /* 端口映射：支持结构化对象或 "8080:80/tcp" 文本 */
    const pb = {};
    const rawPorts = Array.isArray(o.ports) ? o.ports : toList(o.ports, 32);
    for (const raw of rawPorts) {
      let hostIp = '', hp = '', cp = '', proto = 'tcp';
      if (raw && typeof raw === 'object') {
        hostIp = str(raw.hostIp, 80);
        hp = str(raw.host === undefined ? raw.hostPort : raw.host, 8).trim();
        cp = str(raw.container === undefined ? raw.containerPort : raw.container, 8).trim();
        proto = str(raw.proto, 6).toLowerCase() === 'udp' ? 'udp' : 'tcp';
      } else {
        const m = /^(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(\d{1,5}):(\d{1,5})(?:\/(tcp|udp))?$/.exec(String(raw).trim());
        if (!m) continue;
        hostIp = m[1] || ''; hp = m[2]; cp = m[3]; proto = m[4] || 'tcp';
      }
      if (!/^\d{1,5}$/.test(cp) || (hp && !/^\d{1,5}$/.test(hp))) continue;
      const key = cp + '/' + proto;
      if (!pb[key]) pb[key] = [];
      const b = { HostPort: hp || '' };
      if (hostIp) b.HostIp = hostIp;
      pb[key].push(b);
    }
    if (Object.keys(pb).length) {
      hc.PortBindings = pb;
      body.ExposedPorts = {};
      Object.keys(pb).forEach(k => { body.ExposedPorts[k] = {}; });
    }

    /* 文件 / 文件夹映射：bind（宿主路径）与 volume（具名卷）都支持 */
    const binds = [], mounts = [];
    const rawMounts = Array.isArray(o.mounts) ? o.mounts : toList(o.mounts, 32);
    for (const raw of rawMounts) {
      let src = '', dst = '', type = 'bind', ro = false;
      if (raw && typeof raw === 'object') {
        src = str(raw.source === undefined ? raw.host : raw.source, 400).trim();
        dst = str(raw.target === undefined ? raw.container : raw.target, 400).trim();
        type = str(raw.type, 10) === 'volume' ? 'volume' : 'bind';
        ro = !!(raw.readOnly || raw.ro);
      } else {
        const s = String(raw).trim();
        const m = /^(.+?):(\/[A-Za-z0-9._\-\/]{1,300})(:ro)?$/.exec(s);
        if (!m) continue;
        src = m[1]; dst = m[2]; ro = !!m[3];
      }
      if (!dst || /[\r\n\0]/.test(src + dst)) continue;
      if (type === 'volume' || /^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,127}$/.test(src)) {
        mounts.push({ Type: type, Source: src, Target: dst, ReadOnly: ro });
      } else {
        binds.push(src + ':' + dst + (ro ? ':ro' : ''));
      }
    }
    if (binds.length) hc.Binds = binds;
    if (mounts.length) hc.Mounts = mounts;

    /* 网络 / DNS / hosts */
    const netMode = str(o.network, 80).trim();
    if (netMode && /^[A-Za-z0-9_.\-]{1,80}$/.test(netMode)) hc.NetworkMode = netMode;
    const dns = toList(o.dns, 8).filter(x => /^[\d.A-Fa-f:]{3,45}$/.test(x));
    if (dns.length) hc.Dns = dns;
    const hosts = toList(o.extraHosts, 32);
    if (hosts.length) hc.ExtraHosts = hosts;

    /* 重启策略 */
    const rp = str(o.restart, 20);
    const allowed = ['no', 'always', 'unless-stopped', 'on-failure'];
    hc.RestartPolicy = { Name: allowed.indexOf(rp) >= 0 ? rp : 'unless-stopped' };
    if (hc.RestartPolicy.Name === 'on-failure') {
      hc.RestartPolicy.MaximumRetryCount = Math.round(num(o.restartRetries, 0, 1000));
    }
    if (o.privileged) hc.Privileged = true;
    if (o.autoRemove) hc.AutoRemove = true;

    body.HostConfig = hc;
    const api = '/containers/create' + (name ? '?name=' + encodeURIComponent(name) : '');
    const cr = await req('POST', api, body, 30000);
    if (!cr.ok) {
      return { ok: false, created: false, error: (cr.data && cr.data.message) || ('创建失败 HTTP ' + cr.code), config: body };
    }
    const id = String(cr.data.Id || '');
    if (o.start === false) {
      return { ok: true, created: true, started: false, id: id.slice(0, 12), fullId: id, config: body };
    }
    const st = await req('POST', '/containers/' + encodeURIComponent(id) + '/start', undefined, 20000);
    return {
      ok: !!st.ok, created: true, started: !!st.ok, id: id.slice(0, 12), fullId: id, config: body,
      error: st.ok ? '' : ((st.data && st.data.message) || ('容器已创建但启动失败 HTTP ' + st.code))
    };
  }

  async function pull(image) {
    if (!/^[A-Za-z0-9._\-\/:]{1,160}$/.test(String(image || ''))) throw new Error('非法镜像名');
    const r = await req('POST', '/images/create?fromImage=' + encodeURIComponent(image), undefined, 180000);
    return { ok: r.ok, out: String(r.raw || '').slice(-4000), error: r.ok ? '' : (r.data && r.data.message) || r.error };
  }

  async function snapshot() {
    const p = await ping();
    if (!p.available) return {
      available: false, message: p.message, containers: [], images: [],
      networks: [], volumes: [], info: null, endpoint: { ...endpoint }
    };
    const [c, i, n, v, inf] = await Promise.all([containers(), images(), networks(), volumes(), info()]);
    return {
      available: true, message: p.message, version: p.version, apiVersion: p.apiVersion,
      kernel: p.kernel, containers: c.containers, images: i,
      networks: n, volumes: v, info: inf, endpoint: { ...endpoint }
    };
  }

  /* ---------------- 显式 WSL 动作（只在用户点击时执行） ---------------- */
  function wslExec(args, timeout) {
    return new Promise(resolve => {
      cp.execFile(WSL_EXE, args, { timeout: timeout || 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: 'buffer' },
        (err, stdout, stderr) => {
          resolve({
            ok: !err,
            out: decodeWsl(stdout).trim(),
            err: decodeWsl(stderr).trim() || (err && err.message) || ''
          });
        });
    });
  }

  async function wslStatus() {
    const [list, status, ver] = await Promise.all([
      wslExec(['-l', '-v'], 18000),
      wslExec(['--status'], 12000),
      wslExec(['--version'], 10000)
    ]);
    const lines = (list.out || '').split(/\r?\n/).filter(l => l.trim());
    const distros = lines.slice(1).map(l => {
      const parts = l.trim().replace(/\s+/g, ' ').split(' ');
      const star = parts[0] === '*';
      const name = star ? (parts[1] || '') : parts[0];
      const state = parts[star ? 2 : 1] || '';
      const ver = parts[star ? 3 : 2] || '';
      return name ? { name, state, version: ver, isDefault: star } : null;
    }).filter(Boolean);
    const p = await ping();
    return {
      ok: list.ok || status.ok || ver.ok,
      listOutput: list.out || list.err, statusOutput: status.out || status.err,
      versionOutput: ver.out || ver.err, distros,
      engine: p, endpoint: { ...endpoint },
      message: p.available ? 'WSL 与 Docker 引擎均可用' : 'WSL 可用，但 Docker 引擎未连线（需在 WSL 发行版内启动 dockerd）'
    };
  }

  async function distroAction(name, act) {
    if (!/^[\w.\- ]{1,60}$/.test(String(name || ''))) throw new Error('非法发行版名称');
    const args = act === 'terminate' ? ['--terminate', name]
      : act === 'shutdown' ? ['--shutdown']
        : act === 'start' ? ['-d', name, '--', 'true'] : null;
    if (!args) throw new Error('不支持的操作');
    const r = await wslExec(args, 30000);
    return { ok: r.ok, out: r.out || r.err, error: r.ok ? '' : r.err };
  }

  /* ---------------- WSL 发行版枚举 ----------------
     四路探测，任何一路成功都返回真实结果：
       1) PowerShell 读 HKCU:\...\Lxss 注册表（最完整）
       2) reg.exe query（备用）
       3) 文件系统扫描 ext4.vhdx / D:\WSL 等目录（兜底）
       4) wsl -l -v 补真实运行状态
     读不到的字段一律 N/A，绝不编造。                                  */
  function psExec(script, timeout) {
    return new Promise(resolve => {
      const b64 = Buffer.from(script, 'utf16le').toString('base64');
      cp.execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
        { timeout: timeout || 12000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: 'buffer' },
        (err, stdout, stderr) => resolve({
          ok: !err,
          out: decodeWsl(stdout).trim(),
          err: decodeWsl(stderr).trim() || (err && err.message) || ''
        }));
    });
  }
  async function registryDistros() {
    /* 1) PowerShell —— 不依赖 reg.exe，输出结构化 JSON */
    const ps = [
      "$ErrorActionPreference='SilentlyContinue'",
      "$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'",
      "$def=(Get-ItemProperty $k).DefaultDistribution",
      "$r=@(Get-ChildItem $k | ForEach-Object {",
      "  $p=Get-ItemProperty $_.PSPath",
      "  if($p.DistributionName){[pscustomobject]@{",
      "    name=$p.DistributionName; version=[int]$p.Version;",
      "    basePath=$p.BasePath; guid=$_.PSChildName;",
      "    state=$(if([int]$p.State -eq 1){'Running'}else{'Stopped'});",
      "    isDefault=($_.PSChildName -eq $def)",
      "  }}",
      "})",
      "if($r.Count){$r | ConvertTo-Json -Compress}else{'[]'}"
    ].join('\n');
    try {
      const r = await psExec(ps, 12000);
      if (r.ok) {
        const t = r.out.indexOf('[') >= 0 ? r.out.slice(r.out.indexOf('[')) : r.out;
        const j = JSON.parse(t);
        const arr = Array.isArray(j) ? j : [j];
        if (arr.length && arr[0].name) return { list: arr, source: 'PowerShell 注册表' };
      }
    } catch (e) {}

    /* 2) reg.exe —— 用户本机后端可用；沙箱策略拦截时静默跳过 */
    try {
      const r = await new Promise(resolve => {
        cp.execFile('reg.exe',
          ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss', '/s'],
          { timeout: 9000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: 'buffer' },
          (err, stdout) => resolve({ ok: !err, out: decodeWsl(stdout) }));
      });
      if (r.ok) {
        let cur = null;
        const list = [];
        for (const line of r.out.split(/\r?\n/)) {
          const t = line.trim();
          if (/^HKEY_/i.test(t)) {
            if (cur && cur.name) list.push(cur);
            cur = /\{[0-9a-f-]{36}\}/i.test(t)
              ? { name: '', version: 2, state: 'N/A', basePath: '', guid: (t.match(/\{[0-9a-f-]{36}\}/i) || [''])[0] }
              : null;
            continue;
          }
          if (!cur) continue;
          const m = /^(\w+)\s+REG_\w+\s+(.+)$/i.exec(t);
          if (!m) continue;
          const k = m[1].toLowerCase(), v = m[2].trim();
          if (k === 'distributionname') cur.name = v;
          else if (k === 'basepath') cur.basePath = v;
          else if (k === 'version') cur.version = parseInt(v, 16) || parseInt(v, 10) || 2;
          else if (k === 'state') cur.state = (parseInt(v, 16) || 0) === 1 ? 'Running' : 'Stopped';
        }
        if (cur && cur.name) list.push(cur);
        if (list.length) return { list, source: 'reg.exe 注册表' };
      }
    } catch (e) {}

    /* 3) 文件系统兜底：扫常见 WSL 安装位置与 Store 包内的 ext4.vhdx */
    const found = [];
    const roots = [
      'D:\\WSL', 'C:\\WSL', 'D:\\Wsl',
      path.join(process.env.LOCALAPPDATA || '', 'Packages'),
      path.join(process.env.USERPROFILE || '', 'WSL')
    ];
    for (const root of roots) {
      try {
        if (!fs.existsSync(root)) continue;
        for (const e of fs.readdirSync(root, { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          const nm = e.name;
          if (!/^(Debian|Ubuntu|Alpine|Kali|Fedora|Arch|openSUSE|OracleLinux|SLES|docker-desktop)/i.test(nm)) continue;
          const dir = path.join(root, nm);
          const hasVhdx = ['ext4.vhdx', 'system.vhd', 'rootfs'].some(f => {
            try { return fs.existsSync(path.join(dir, f)); } catch (err) { return false; }
          });
          if (hasVhdx || /^D:\\WSL/i.test(root)) {
            if (!found.some(x => x.name === nm)) found.push({
              name: nm, version: 2, state: 'N/A', basePath: dir, guid: '', isDefault: false
            });
          }
        }
      } catch (e) {}
    }
    /* 配置文件里指定的发行版也算一个已知实体 */
    try {
      const nm = endpoint.distro;
      if (nm && !found.some(x => x.name === nm)) found.push({
        name: nm, version: 2, state: 'N/A', basePath: '', guid: '', isDefault: true
      });
    } catch (e) {}
    return { list: found, source: found.length ? '文件系统扫描' : 'N/A' };
  }

  async function distros() {
    const reg = await registryDistros();
    const out = {
      ok: false, distros: reg.list.map(d => Object.assign({
        version: 2, state: 'N/A', basePath: '', isDefault: false
      }, d)), source: reg.source, message: 'N/A'
    };
    /* 用 wsl -l -v 补真实运行状态（后端跑在用户本机时可用） */
    try {
      const lv = await wslExec(['-l', '-v'], 15000);
      if (lv.ok && lv.out) {
        const map = {};
        for (const line of lv.out.split(/\r?\n/)) {
          const p = line.trim().replace(/\s+/g, ' ').split(' ');
          const star = p[0] === '*';
          const name = star ? (p[1] || '') : p[0];
          if (!name || /^(NAME|Windows|适用于|NAME\s+STATE)/i.test(name)) continue;
          map[name] = { state: p[star ? 2 : 1] || 'N/A', version: p[star ? 3 : 2] || 'N/A', isDefault: star };
        }
        out.distros.forEach(d => { if (map[d.name]) Object.assign(d, map[d.name]); });
        Object.keys(map).forEach(n => {
          if (!out.distros.some(d => d.name === n)) out.distros.push({
            name: n, version: map[n].version, state: map[n].state,
            basePath: '', isDefault: map[n].isDefault
          });
        });
        out.source += ' + wsl -l -v';
      }
    } catch (e) {}
    out.ok = out.distros.length > 0;
    out.message = out.ok
      ? ('检测到 ' + out.distros.length + ' 个 WSL 发行版（' + out.source + '）')
      : '未检测到 WSL 发行版（N/A）：请确认已安装 WSL2 并至少导入一个发行版';
    return out;
  }

  /* ---------------- 在 WSL 发行版内执行任意命令 ---------------- */
  async function distroExec(distro, cmd, opts) {
    const d = /^[\w.\- ]{1,60}$/.test(String(distro || '')) ? String(distro) : (endpoint.distro || 'Debian');
    const c = String(cmd || '').slice(0, 4000).trim();
    if (!c) throw new Error('命令为空');
    const o = opts || {};
    const args = ['-d', d].concat(o.root ? ['-u', 'root'] : []).concat(['--', 'sh', '-c', c]);
    const r = await wslExec(args, Math.min(Math.max(Number(o.timeout) || 30000, 1000), 120000));
    return {
      ok: r.ok, out: r.out, err: r.ok ? '' : (r.err || '命令执行失败'),
      distro: d, cmd: c, source: 'wsl.exe -d ' + d
    };
  }

  /* ---------------- 本机 WSL Docker 管理器（D:\WslDockerManager） ---------------- */
  async function managerStatus() {
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync('D:\\WslDockerManager\\config.json', 'utf8')); } catch (e) {}
    const port = Number(cfg && cfg.port) || 5050;
    const alive = await new Promise(resolve => {
      const rq = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2500 }, res => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => resolve({ ok: res.statusCode === 200, body: d.slice(0, 500) }));
      });
      rq.on('error', () => resolve({ ok: false, body: '' }));
      rq.on('timeout', () => { try { rq.destroy(); } catch (e) {} resolve({ ok: false, body: '' }); });
    });
    let logTail = '';
    try {
      const b = fs.readFileSync('D:\\WslDockerManager\\wsl-docker.log');
      logTail = b.slice(-6000).toString('utf8').split(/\r?\n/).slice(-14).join('\n');
    } catch (e) {}
    return {
      available: alive.ok, port, health: alive.body, logTail,
      config: cfg ? { distro: cfg.distro, dockerHost: cfg.dockerHost, dockerPort: cfg.dockerPort, autostartContainers: cfg.autostartContainers } : null,
      restartScript: 'D:\\WslDockerManager\\restart-backend.bat',
      message: alive.ok ? ('WSL Docker 管理器在线（端口 ' + port + '）') : ('管理器未运行（端口 ' + port + ' 无响应，N/A）')
    };
  }

  /* 停止 / 重启 dockerd（真实作用于 WSL 内 systemd 服务，不伪造结果） */
  async function engineStop() {
    const r = await wslRoot(['sh', '-c',
      'systemctl stop docker 2>/dev/null || service docker stop 2>/dev/null || pkill -x dockerd 2>/dev/null; sleep 1; echo done'], 30000);
    const p = await ping(1500);
    ka.online = p.available; ka.lastCheck = Date.now();
    ka.lastAction = r.ok ? '已停止 WSL 内 dockerd' : ('停止失败：' + (r.err || 'N/A'));
    return { ok: !!r.ok, out: r.out || r.err || 'N/A', message: ka.lastAction };
  }
  async function engineRestart() {
    const r = await engineStart();
    ka.online = !!r.ok; ka.version = r.version || null; ka.lastCheck = Date.now();
    ka.lastAction = r.message || '引擎重启流程结束';
    return r;
  }

  /* ---------------- 真实 Docker Engine 自动发现 ----------------
     依次探测：config.json 指定端口 / 2375 / 2376 / 2377 / 5050 代理 /
     Docker Desktop 命名管道。只有 /version 返回 Docker 版本才算命中，
     绝不把「端口通」误判成「Docker 可用」。 */
  function probeHttp(opts, ms) {
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      const rq = http.get(Object.assign({ path: '/version', timeout: ms || 1500, agent: false }, opts), res => {
        const bufs = [];
        res.on('data', d => bufs.push(d));
        res.on('end', () => {
          let j = null;
          try { j = JSON.parse(Buffer.concat(bufs).toString('utf8')); } catch (e) {}
          const ok = res.statusCode >= 200 && res.statusCode < 300 && !!j && !!(j.Version || j.ApiVersion);
          finish({ ok, code: res.statusCode, version: (j && j.Version) || null, apiVersion: (j && j.ApiVersion) || null });
        });
      });
      rq.on('error', e => finish({ ok: false, error: e.code === 'ECONNREFUSED' ? '端口未监听' : e.message }));
      rq.on('timeout', () => { try { rq.destroy(); } catch (e) {} finish({ ok: false, error: '连接超时' }); });
    });
  }

  async function discover() {
    /* 每轮都重新判定数据源，避免上一次的命名管道模式残留 */
    endpoint.socket = '';
    const cfg = autoConfig();
    const ports = [...new Set([endpoint.port, cfg.port, 2375, 2376, 2377, 5050])]
      .map(x => Number(x)).filter(x => x > 0 && x < 65536);
    const tried = [];
    for (const port of ports) {
      const r = await probeHttp({ host: '127.0.0.1', port });
      tried.push({ host: '127.0.0.1', port, ok: !!r.ok, version: r.version || null, error: r.ok ? null : (r.error || 'N/A') });
      if (r.ok) {
        setEndpoint({ host: '127.0.0.1', port });
        return {
          found: true, endpoint: { ...endpoint }, tried,
          message: '已发现真实 Docker Engine 127.0.0.1:' + port + ' · ' + (r.version || 'N/A')
        };
      }
    }
    /* Docker Desktop / Engine 的 Windows 命名管道 */
    const np = await probeHttp({ socketPath: '\\\\.\\pipe\\docker_engine' }, 1800);
    tried.push({ host: 'npipe:////./pipe/docker_engine', port: 0, ok: !!np.ok, version: np.version || null, error: np.ok ? null : (np.error || 'N/A') });
    if (np.ok) {
      /* 命中 Docker Desktop 命名管道：把后续所有 Engine 请求也切到管道，
         否则「端点探测显示在线」，容器/镜像却仍去连 2375 而全部为空。 */
      setEndpoint({ socket: '\\\\.\\pipe\\docker_engine' });
      return {
        found: true, endpoint: { ...endpoint }, tried, viaPipe: true,
        message: '已发现 Docker Desktop 命名管道 · ' + (np.version || 'N/A')
      };
    }
    return {
      found: false, endpoint: { ...endpoint }, tried,
      message: '未发现运行中的 Docker Engine（' + tried.length + ' 个端点均无响应）'
    };
  }

  /* 一键：先发现，未命中则尝试在 WSL 内启动 dockerd，再复查 */
  async function autoStart() {
    const steps = [];
    let d = await discover();
    steps.push('自动发现：' + d.message);
    if (d.found) return { ok: true, discovered: d, steps, message: d.message, endpoint: d.endpoint };
    const r = await engineStart();
    steps.push('启动引擎：' + r.message);
    d = await discover();
    steps.push('复查：' + d.message);
    return {
      ok: d.found, discovered: d, engine: r, steps,
      endpoint: d.endpoint,
      message: d.found ? ('Docker 引擎已上线：' + d.message) : ('引擎仍未上线（N/A）：' + r.message)
    };
  }

  /* ---------------- 可靠的 dockerd 启动（移植自本机已验证的 WslDockerManager） ---------------- */
  async function tcpUp(ms) {
    if (endpoint.socket) {
      const r = await req('GET', '/_ping', undefined, ms || 2500);
      return !!r.ok;
    }
    return new Promise(resolve => {
      const rq = http.get({ host: endpoint.host, port: endpoint.port, path: '/_ping', timeout: ms || 2500 }, res => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      rq.on('error', () => resolve(false));
      rq.on('timeout', () => { try { rq.destroy(); } catch (e) {} resolve(false); });
    });
  }
  async function wslRoot(args, timeout) {
    return wslExec(['-d', endpoint.distro || 'Debian', '-u', 'root', '--'].concat(args), timeout || 30000);
  }
  async function engineStart() {
    const steps = [];
    const d = endpoint.distro || 'Debian';
    /* 1) 唤醒发行版（休眠/wsl --shutdown 后的冷启动）。
          本机负载高时 WSL2 冷启动可能超过 30 秒，过去 30s 超时后直接放弃，
          要等看门狗下一轮才重试，整体拖到 90 秒。这里给 60 秒并重试一次。 */
    let wake = await wslRoot(['echo', '__nasdeck_wsl_up__'], 60000);
    if (!wake.ok) { await sleep(2000); wake = await wslRoot(['echo', '__nasdeck_wsl_up__'], 60000); }
    steps.push('唤醒发行版 ' + d + ': ' + (wake.ok ? 'OK' : (wake.err || '失败')));
    if (!wake.ok) return { ok: false, steps, out: steps.join('\n'), message: 'WSL 发行版无法启动：' + (wake.err || 'N/A') };

    /* 2) 幂等写 systemd drop-in，让 docker 绑定 2375 且崩溃自动恢复 */
    const override = '[Service]\\nExecStart=\\nExecStart=/usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:' +
      endpoint.port + ' --containerd=/run/containerd/containerd.sock\\nRestart=always\\nRestartSec=2\\n';
    const wr = await wslRoot(['sh', '-c',
      "mkdir -p /etc/systemd/system/docker.service.d && printf '%b' '" + override + "' > /etc/systemd/system/docker.service.d/nasdeck-override.conf"], 45000);
    steps.push('写入 systemd override: ' + (wr.ok ? 'OK' : (wr.err || '跳过')));
    const sd = await wslRoot(['sh', '-c', '[ -d /run/systemd/system ] && echo yes || echo no'], 30000);
    const usesSystemd = /yes/.test(sd.out);
    steps.push('init 系统: ' + (usesSystemd ? 'systemd' : 'SysV / 非 systemd'));

    /* 3) 按 init 类型启动 docker */
    if (usesSystemd) {
      const st = await wslRoot(['sh', '-c', 'systemctl daemon-reload; systemctl enable docker >/dev/null 2>&1; systemctl restart docker; sleep 3; systemctl is-active docker 2>/dev/null || true'], 60000);
      steps.push('systemctl restart docker: ' + (st.out || st.err || 'N/A'));
    } else {
      const st = await wslRoot(['sh', '-c', 'service docker start 2>&1 | head -20'], 45000);
      steps.push('service docker start: ' + (st.out || st.err || 'N/A'));
    }

    /* 4) 等待端口真正可用；不行则 nohup 直接拉起带 TCP 监听的 dockerd */
    for (let i = 0; i < 6; i++) {
      if (await tcpUp(2000)) break;
      await sleep(1500);
    }
    let up = await tcpUp(2500);
    if (!up) {
      const dr = await wslRoot(['sh', '-c',
        'pkill -x dockerd 2>/dev/null; sleep 2; nohup dockerd -H fd:// -H tcp://127.0.0.1:' +
        endpoint.port + ' --iptables=false >/var/log/nasdeck-dockerd-tcp.log 2>&1 & echo started'], 30000);
      steps.push('nohup dockerd 兜底: ' + (dr.out || dr.err || 'N/A'));
      for (let i = 0; i < 8; i++) { await sleep(1500); if (await tcpUp(2000)) { up = true; break; } }
    }
    const p = await ping();
    return {
      ok: p.available, steps, out: steps.join('\n'),
      version: p.version || null,
      message: p.available
        ? ('WSL Docker 引擎已启动 · ' + (p.version || '') + ' · 端点 ' + endpoint.host + ':' + endpoint.port)
        : ('引擎仍未连线（N/A）：' + (p.message || 'N/A') + '。可尝试运行 D:\\WslDockerManager\\restart-backend.bat')
    };
  }

  return {
    get endpoint() { return { ...endpoint }; },
    setEndpoint, autoConfig, ping, info, containers, images, networks, volumes,
    imageInspect, action, create, pull, snapshot, wslStatus, distroAction, engineStart,
    engineStop, engineRestart, keepAliveStart, keepAliveStop, keepAliveStatus,
    ensureEngine, req,
    distros, distroExec, managerStatus, tcpUp, wslExec, discover, autoStart, probeHttp,
    get wslExe() { return WSL_EXE; }
  };
}

module.exports = { initWsl, autoConfig };
