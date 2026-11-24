'use strict';
/* ============================================================================
 * lib/v15.js — NasDeck v15 后端能力（零第三方依赖）
 *
 *  需求 1  镜像仓库：增删查 + docker login / logout（凭据交给 WSL 内的
 *          docker CLI 管理，本项目不落盘密码，只记录用户名与登录状态）
 *  需求 2  镜像更新检测：本地 RepoDigests vs 远端 manifest digest，
 *          离线 / 未登录一律如实返回 unknown，绝不编造「有更新」
 *  需求 3  容器重构：inspect → 可编辑配置 → 保留旧容器备份后重建，失败回滚
 *  需求 6  文件预览 / 编辑：BOM + 严格 UTF-8 探测 + GBK/Big5/UTF-16 解码，
 *          保存时保持原编码或明确提示转存 UTF-8；Office 内置在线文档查看
 *  需求 7  分享加密：显式 encrypted 开关，落地页密码校验（后端已有 verifyPw）
 *
 * 设计原则：所有失败都如实回传 error；不触碰真实容器除非用户明确点击。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const TEXT_EXT = /\.(txt|md|log|json|js|ts|css|html?|xml|ya?ml|ini|cfg|conf|csv|srt|vtt|lrc|ass|bat|ps1|sh|py|java|c|cpp|h|go|rs|sql|properties|gitignore|env)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i;
const AUD_EXT = /\.(mp3|wav|flac|m4a|aac|ogg|wma|ape)$/i;
const VID_EXT = /\.(mp4|mkv|webm|mov|avi|wmv|flv|m4v|ts)$/i;
const OFFICE_EXT = /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i;

/* ---------- 编码探测：先看 BOM，再用严格 UTF-8 试探，最后回退 GBK ---------- */
function decodeText(buf) {
  const b = buf;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
    return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'UTF-8 (BOM)', bom: 'utf8' };
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe)
    return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16 LE (BOM)', bom: 'utf16le' };
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    const swap = Buffer.from(b.subarray(2));
    for (let i = 0; i + 1 < swap.length; i += 2) { const t = swap[i]; swap[i] = swap[i + 1]; swap[i + 1] = t; }
    return { text: new TextDecoder('utf-16le').decode(swap), encoding: 'UTF-16 BE (BOM)', bom: 'utf16be' };
  }
  /* 严格 UTF-8：中文 GBK 字节几乎不可能通过，能过就是真 UTF-8 */
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'UTF-8', bom: '' };
  } catch (e) { /* 落到下方 */ }
  /* 纯 ASCII 之外的 ANSI 中文：GBK 优先（大陆），Big5 备选 */
  for (const enc of ['gbk', 'gb18030', 'big5']) {
    try {
      const t = new TextDecoder(enc, { fatal: true }).decode(b);
      if (t.indexOf('\ufffd') < 0) return { text: t, encoding: enc.toUpperCase(), bom: '' };
    } catch (e) {}
  }
  try { return { text: new TextDecoder('gbk').decode(b), encoding: 'GBK (宽松)', bom: '' }; }
  catch (e) { return { text: b.toString('utf8'), encoding: 'UTF-8 (容错)', bom: '' }; }
}
function encodeText(text, enc) {
  const t = String(text == null ? '' : text);
  if (/utf-16le/i.test(enc || '')) {
    const body = Buffer.from(t, 'utf16le');
    return Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
  }
  /* Node 内置 TextDecoder 支持 GBK 但无 GBK 编码器：转存 UTF-8 并如实告知 */
  return Buffer.from(t, 'utf8');
}

function initV15(ctx) {
  const { wsl, settings, winnas, nasResolve, addLog, requestBase, streamFile } = ctx;

  /* ================= 需求 1：镜像仓库 ================= */
  const REG_KEY = 'dockerRegistries';
  function registries() {
    const v = settings.get(REG_KEY, []);
    return Array.isArray(v) ? v : [];
  }
  function saveRegs(list) { settings.set(REG_KEY, list.slice(0, 40)); return list; }
  function registryShape(x) {
    return {
      id: String(x.id || ''), name: String(x.name || ''), url: String(x.url || ''),
      username: String(x.username || ''), insecure: !!x.insecure,
      mirror: !!x.mirror, loggedIn: !!x.loggedIn, loginAt: x.loginAt || 0,
      note: String(x.note || '')
    };
  }
  function addRegistry(o) {
    o = o || {};
    const url = String(o.url || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const name = String(o.name || '').trim().slice(0, 40);
    if (!name) throw new Error('请填写仓库名称');
    if (!/^[A-Za-z0-9._\-:]+(\/[A-Za-z0-9._\-/]+)?$/.test(url) || url.length > 200) throw new Error('仓库地址不合法');
    const list = registries().filter(x => x.url !== url);
    const id = 'rg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    list.push({ id, name, url, username: String(o.username || '').slice(0, 80),
      insecure: !!o.insecure, mirror: !!o.mirror, loggedIn: false, loginAt: 0,
      note: String(o.note || '').slice(0, 120) });
    saveRegs(list);
    addLog('INFO', '添加镜像仓库 ' + name + ' (' + url + ')', 'docker');
    return registryShape(list[list.length - 1]);
  }
  function removeRegistry(id) {
    const list = registries();
    const hit = list.filter(x => x.id === id)[0];
    if (!hit) throw new Error('仓库不存在');
    /* 登出再删除，避免 WSL ~/.docker/config.json 里留下孤儿凭据 */
    try { dockerLogout(hit); } catch (e) {}
    saveRegs(list.filter(x => x.id !== id));
    addLog('INFO', '移除镜像仓库 ' + hit.name, 'docker');
    return { removed: id };
  }
  function dockerDistCmd(cmd) {
    /* 真实调用 dockerd 所在 WSL 发行版。
       受控终端/未安装 WSL/WSL 冷启动失败时，wsl.exe 会被安全策略拦下并抛
       spawn EPERM。这里统一翻译成「可读中文原因 + ok:false」，绝不把异常
       裸抛给前端（用户点「登录/测试」看到的应该是原因，不是 EPERM）。 */
    const ep = wsl.endpoint || {};
    let p;
    try { p = wsl.distroExec(ep.distro || 'debian13', cmd, { timeout: 60000 }); }
    catch (e) { return { ok: false, out: '', err: cliReason(e) }; }
    return Promise.resolve(p).then(function (r) {
      if (r && r.ok === false && /EPERM|EACCES|spawn/i.test(String(r.err || r.error || '')))
        return Object.assign({}, r, { err: cliReason(r.err || r.error) });
      return r;
    }).catch(function (e) { return { ok: false, out: '', err: cliReason(e) }; });
  }
  function cliReason(e) {
    const m = String((e && (e.message || e.err || e.error)) || e || '');
    if (/EPERM|EACCES|spawn|blacklist|安全策略/i.test(m))
      return 'WSL docker CLI 不可用（本机安全策略禁止启动 wsl.exe，或 WSL 未安装 / 未启动）';
    return m || 'WSL docker CLI 未返回成功';
  }
  function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
  async function loginRegistry(o) {
    o = o || {};
    const id = String(o.id || ''), user = String(o.username || '').trim(), pw = String(o.password || '');
    const list = registries();
    const hit = list.filter(x => x.id === id)[0] || list.filter(x => x.url === String(o.url || ''))[0];
    if (!hit) throw new Error('仓库不存在');
    if (!user) throw new Error('请填写用户名');
    if (!pw) throw new Error('请填写密码或访问令牌');
    /* --password-stdin：密码不出现在 docker 命令行参数里，也不写入本项目磁盘 */
    const cmd = 'printf %s ' + shq(pw) + ' | docker login ' + shq(hit.url) +
      ' -u ' + shq(user) + ' --password-stdin' + (hit.insecure ? '' : '');
    const r = await dockerDistCmd(cmd);
    if (!r.ok) throw new Error('登录失败：' + (r.err || r.out || 'WSL docker CLI 未返回成功'));
    hit.username = user; hit.loggedIn = true; hit.loginAt = Date.now();
    saveRegs(list);
    addLog('INFO', '登录镜像仓库 ' + hit.name + ' (' + user + ')', 'docker');
    return { ok: true, registry: registryShape(hit), out: String(r.out || '').slice(-500) };
  }
  async function logoutRegistry(o) {
    const list = registries();
    const hit = list.filter(x => x.id === String((o || {}).id || ''))[0];
    if (!hit) throw new Error('仓库不存在');
    const r = await dockerLogout(hit);
    hit.loggedIn = false; saveRegs(list);
    return { ok: !!r.ok, out: String(r.out || r.err || '').slice(-300), registry: registryShape(hit) };
  }
  async function dockerLogout(hit) {
    try { return await dockerDistCmd('docker logout ' + shq(hit.url)); }
    catch (e) { return { ok: false, err: e.message }; }
  }
  async function testRegistry(o) {
    const hit = registries().filter(x => x.id === String((o || {}).id || ''))[0];
    if (!hit) throw new Error('仓库不存在');
    const r = await dockerDistCmd('docker info --format ' + shq('{{json .RegistryConfig.IndexConfigs}}') +
      ' 2>/dev/null | head -c 2000; echo; docker pull --help >/dev/null 2>&1 && echo CLI_OK');
    return { ok: !!r.ok, out: String(r.out || r.err || '').slice(0, 1200), url: hit.url };
  }

  /* ================= 需求 2：镜像更新检测 =================
     本地 RepoDigests 与远端 manifest digest 对比。两条路径：
       a) WSL docker CLI（能读到已登录凭据，最真实）
       b) Engine /distribution/<name>/json（公开仓库，纯 HTTP）
     两者都拿不到 → unknown，不编造。 */
  let updCache = { at: 0, items: [], checking: null };
  const UPD_TTL = 60000;
  function parseDigest(s) {
    const m = /sha256:([a-f0-9]{12,64})/i.exec(String(s || ''));
    return m ? m[1].toLowerCase() : '';
  }
  async function digestsFor(image) {
    const local = [], remote = [];
    const errors = [];
    try {
      const r = await wsl.req('GET', '/images/' + encodeURIComponent(image) + '/json', undefined, 10000);
      if (r.ok && r.data && Array.isArray(r.data.RepoDigests)) {
        r.data.RepoDigests.forEach(d => { const x = parseDigest(d); if (x) local.push(x); });
      } else errors.push('本地镜像元数据: ' + ((r.data && r.data.message) || ('HTTP ' + r.code)));
    } catch (e) { errors.push('本地镜像元数据: ' + e.message); }
    /* a) WSL docker manifest inspect */
    try {
      const r = await dockerDistCmd('docker manifest inspect ' + shq(image) + ' --verbose 2>&1 | head -c 4000');
      if (r.ok) {
        const m = /"digest"\s*:\s*"sha256:([a-f0-9]{12,64})"/i.exec(String(r.out || ''));
        if (m) remote.push(m[1].toLowerCase());
        else {
          const m2 = /sha256:([a-f0-9]{12,64})/i.exec(String(r.out || ''));
          if (m2) remote.push(m2[1].toLowerCase());
        }
        if (!remote.length) errors.push('docker manifest inspect 未返回 digest');
      } else errors.push('远端 manifest: ' + (r.err || 'WSL CLI 不可用'));
    } catch (e) { errors.push('远端 manifest: ' + e.message); }
    /* b) Engine distribution API（公开仓库兜底） */
    if (!remote.length) {
      try {
        const r = await wsl.req('GET', '/distribution/' + encodeURIComponent(image) + '/json', undefined, 12000);
        const d = r.ok && r.data && (r.data.Descriptor || {}).digest;
        if (d && parseDigest(d)) remote.push(parseDigest(d));
        else errors.push('Engine distribution: ' + ((r.data && r.data.message) || ('HTTP ' + r.code)));
      } catch (e) { errors.push('Engine distribution: ' + e.message); }
    }
    return { local, remote, errors };
  }
  async function checkUpdates(force) {
    if (!force && updCache.items.length && Date.now() - updCache.at < UPD_TTL) return updCache.items;
    if (updCache.checking) return updCache.checking;
    updCache.checking = (async () => {
      let cts = [];
      try { const r = await wsl.containers(); cts = r.containers || []; } catch (e) {}
      const items = [];
      for (const c of cts) {
        const image = String(c.img || '');
        const base = { id: c.id, name: c.n, image, status: 'unknown', local: '', remote: '', reason: '' };
        if (!image || /<none>|N\/A/i.test(image)) { base.reason = '容器没有可用的镜像名'; items.push(base); continue; }
        const d = await digestsFor(image);
        base.local = d.local[0] || ''; base.remote = d.remote[0] || '';
        if (!d.remote.length) { base.reason = d.errors.slice(-2).join(' / ') || '无法读取远端 manifest'; }
        else if (!d.local.length) { base.reason = '本地镜像没有 RepoDigests，无法比对'; }
        else if (d.local.indexOf(d.remote[0]) >= 0) { base.status = 'up-to-date'; }
        else { base.status = 'update'; }
        items.push(base);
      }
      updCache = { at: Date.now(), items, checking: null };
      return items;
    })();
    try { return await updCache.checking; }
    finally { updCache.checking = null; }
  }
  /* 点击「有更新」标签：pull 最新镜像 → 用原配置重建容器 */
  async function updateContainer(o) {
    const id = String((o || {}).id || '');
    if (!/^[A-Za-z0-9_.\-]{1,80}$/.test(id)) throw new Error('非法容器 ID');
    const ins = await wsl.req('GET', '/containers/' + encodeURIComponent(id) + '/json', undefined, 12000);
    if (!ins.ok || !ins.data) throw new Error('读取容器配置失败：' + ((ins.data && ins.data.message) || ('HTTP ' + ins.code)));
    const image = String(ins.data.Config.Image || ins.data.Image || '');
    if (!image) throw new Error('容器没有镜像信息');
    const pull = await wsl.pull(image);
    if (!pull.ok) throw new Error('拉取最新镜像失败：' + (pull.error || 'N/A'));
    const rr = await recreateContainer({ id, config: {} });
    return Object.assign({}, rr, { image, pulled: true });
  }

  /* ================= 需求 3：容器重构（可改设置，保留旧容器备份） ================= */
  async function inspectContainer(id) {
    if (!/^[A-Za-z0-9_.\-]{1,80}$/.test(String(id || ''))) throw new Error('非法容器 ID');
    const r = await wsl.req('GET', '/containers/' + encodeURIComponent(id) + '/json', undefined, 12000);
    if (!r.ok || !r.data) throw new Error('读取容器配置失败：' + ((r.data && r.data.message) || ('HTTP ' + r.code)));
    const d = r.data, cfg = d.Config || {}, hc = d.HostConfig || {};
    return {
      id, name: String(d.Name || '').replace(/^\//, ''), image: String(cfg.Image || d.Image || ''),
      cmd: (cfg.Cmd || []).join(' '), entrypoint: (cfg.Entrypoint || []).join(' '),
      env: (cfg.Env || []).join('\n'), workdir: cfg.WorkingDir || '', user: cfg.User || '',
      hostname: cfg.Hostname || '', labels: Object.keys(cfg.Labels || {}).map(k => k + '=' + cfg.Labels[k]).join('\n'),
      ports: Object.keys(hc.PortBindings || {}).map(k =>
        k + ':' + (hc.PortBindings[k] || []).map(x => x.HostPort || '').join(',')).join('\n'),
      binds: (hc.Binds || []).join('\n'), restart: String((hc.RestartPolicy || {}).Name || ''),
      network: hc.NetworkMode || '', memory: hc.Memory ? Math.round(hc.Memory / 1048576) : 0,
      cpus: hc.NanoCpus ? hc.NanoCpus / 1e9 : 0, privileged: !!hc.Privileged,
      raw: { Config: cfg, HostConfig: hc }
    };
  }
  function lines(v) { return String(v || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean); }
  function recreateBody(orig, patch) {
    const p = patch || {}, cfg = orig.raw.Config || {}, hc = orig.raw.HostConfig || {};
    const body = {
      Image: String(p.image || orig.image),
      Cmd: p.cmd !== undefined ? lines(p.cmd) : (cfg.Cmd || []),
      Entrypoint: p.entrypoint !== undefined ? lines(p.entrypoint) : (cfg.Entrypoint || []),
      Env: p.env !== undefined ? lines(p.env) : (cfg.Env || []),
      WorkingDir: p.workdir !== undefined ? String(p.workdir) : (cfg.WorkingDir || ''),
      User: p.user !== undefined ? String(p.user) : (cfg.User || ''),
      Hostname: p.hostname !== undefined ? String(p.hostname) : (cfg.Hostname || ''),
      ExposedPorts: cfg.ExposedPorts || {}, Labels: cfg.Labels || {},
      Tty: !!cfg.Tty, OpenStdin: !!cfg.OpenStdin,
      HostConfig: Object.assign({}, hc)
    };
    const H = body.HostConfig;
    if (p.restart !== undefined) H.RestartPolicy = { Name: String(p.restart || 'no'), MaximumRetryCount: 0 };
    if (p.memory !== undefined) H.Memory = Math.max(0, Number(p.memory) || 0) * 1048576;
    if (p.cpus !== undefined) H.NanoCpus = Math.round(Math.max(0, Number(p.cpus) || 0) * 1e9);
    if (p.privileged !== undefined) H.Privileged = !!p.privileged;
    if (p.network !== undefined) H.NetworkMode = String(p.network || 'bridge');
    if (p.binds !== undefined) H.Binds = lines(p.binds);
    if (p.ports !== undefined) {
      const pb = {}, exp = {};
      lines(p.ports).forEach(function (s) {
        const a = s.split(':');
        if (a.length < 2) return;
        const container = a[0].replace(/\/tcp$|\/udp$/, ''), host = a[a.length - 1];
        const key = /udp$/i.test(a[0]) ? container + '/udp' : container + '/tcp';
        exp[key] = {}; pb[key] = [{ HostPort: String(host) }];
      });
      if (Object.keys(pb).length) { H.PortBindings = pb; body.ExposedPorts = exp; }
    }
    return body;
  }
  async function recreateContainer(o) {
    o = o || {};
    const id = String(o.id || '');
    if (!/^[A-Za-z0-9_.\-]{1,80}$/.test(id)) throw new Error('非法容器 ID');
    const orig = await inspectContainer(id);
    const name = String((o.config && o.config.name) || orig.name || ('nasdeck-' + id.slice(0, 8)));
    if (!/^[A-Za-z0-9][A-Za-z0-9_.\-]{0,80}$/.test(name)) throw new Error('非法容器名');
    const body = recreateBody(orig, o.config);
    const bak = name + '-bak-' + Date.now().toString(36);
    const steps = [];
    /* 1) 停旧容器（保留，不删除 —— 数据安全优先） */
    const st = await wsl.req('POST', '/containers/' + encodeURIComponent(id) + '/stop', undefined, 25000);
    steps.push('stop: ' + (st.ok ? 'ok' : 'HTTP ' + st.code));
    /* 2) 旧容器改名让出名字；失败立即终止，不动旧容器 */
    const rn = await wsl.req('POST', '/containers/' + encodeURIComponent(id) + '/rename?name=' + encodeURIComponent(bak), undefined, 15000);
    if (!rn.ok) {
      await wsl.req('POST', '/containers/' + encodeURIComponent(id) + '/start', undefined, 15000);
      throw new Error('重命名旧容器失败（已恢复启动）：' + ((rn.data && rn.data.message) || ('HTTP ' + rn.code)));
    }
    steps.push('backup: ' + bak);
    /* 3) 用可编辑配置建新容器 */
    const cr = await wsl.req('POST', '/containers/create?name=' + encodeURIComponent(name), body, 30000);
    if (!cr.ok || !cr.data || !cr.data.Id) {
      await wsl.req('POST', '/containers/' + encodeURIComponent(id) + '/rename?name=' + encodeURIComponent(name), undefined, 15000);
      await wsl.req('POST', '/containers/' + encodeURIComponent(id) + '/start', undefined, 15000);
      throw new Error('创建新容器失败（已回滚旧容器）：' + ((cr.data && cr.data.message) || ('HTTP ' + cr.code)));
    }
    const newId = String(cr.data.Id);
    steps.push('create: ' + newId.slice(0, 12));
    /* 4) 启动新容器；失败删除新容器并回滚 */
    const go = await wsl.req('POST', '/containers/' + encodeURIComponent(newId) + '/start', undefined, 25000);
    if (!go.ok) {
      await wsl.req('DELETE', '/containers/' + encodeURIComponent(newId) + '?force=1', undefined, 15000);
      await wsl.req('POST', '/containers/' + encodeURIComponent(id) + '/rename?name=' + encodeURIComponent(name), undefined, 15000);
      await wsl.req('POST', '/containers/' + encodeURIComponent(id) + '/start', undefined, 15000);
      throw new Error('启动新容器失败（已回滚旧容器）：' + ((go.data && go.data.message) || ('HTTP ' + go.code)));
    }
    steps.push('start: ok');
    try { updCache = { at: 0, items: [], checking: null }; } catch (e) {}
    addLog('INFO', '重构容器 ' + name + ' · 旧容器保留为 ' + bak, 'docker');
    return { ok: true, id: newId.slice(0, 12), name, backup: bak, backupId: id, steps, config: o.config || {} };
  }

  /* ================= 需求 6：文件预览 / 编辑 ================= */
  function fileUrl(vp, name, token) {
    return '/api/files/open?path=' + encodeURIComponent(vp) + '&name=' + encodeURIComponent(name) +
      '&token=' + encodeURIComponent(token || '');
  }
  function previewFile(c) {
    const vp = String(c.query.path || '/'), name = String(c.query.name || '');
    const abs = nasResolve(vp, name);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('文件不存在');
    const ext = path.extname(abs), st = fs.statSync(abs);
    const info = { ok: true, name: path.basename(abs), ext, size: st.st_size, mtime: st.mtimeMs, path: vp };
    if (IMG_EXT.test(ext) || AUD_EXT.test(ext) || VID_EXT.test(ext) || /\.pdf$/i.test(ext)) {
      info.kind = IMG_EXT.test(ext) ? 'image' : (AUD_EXT.test(ext) ? 'audio' : (VID_EXT.test(ext) ? 'video' : 'pdf'));
      info.url = fileUrl(vp, name, c.query.token);
      return info;
    }
    if (OFFICE_EXT.test(ext)) {
      info.kind = 'office';
      info.officeExt = ext.toLowerCase();
      try {
        const x = winnas.vpath(vp);
        const r = winnas.officePreview(x.root, path.join(x.sub, name).replace(/\\/g, '/'));
        if (r && typeof r.then === 'function') return Promise.resolve(r).then(h => Object.assign(info, { office: h })).catch(e => Object.assign(info, { officeError: e.message }));
        return Object.assign(info, { office: r });
      } catch (e) { info.officeError = e.message; }
      return info;
    }
    if (TEXT_EXT.test(ext) || st.st_size <= 1024 * 1024) {
      if (st.st_size > 4 * 1024 * 1024) { info.kind = 'binary'; info.reason = '文件超过 4 MB，不载入编辑器'; return info; }
      const d = decodeText(fs.readFileSync(abs));
      info.kind = 'text'; info.text = d.text; info.encoding = d.encoding; info.bom = d.bom;
      info.lang = /\.(json|js|ts|css|html?|xml|md|py|sh|bat|sql|ya?ml)$/i.test(ext) ? ext.slice(1).toLowerCase() : '';
      return info;
    }
    info.kind = 'binary'; info.reason = '此类型请在文件总管下载后用本机程序打开';
    return info;
  }
  function saveFile(c) {
    const vp = String((c.body || {}).path || '/'), name = String((c.body || {}).name || '');
    const abs = nasResolve(vp, name);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('文件不存在');
    const before = fs.readFileSync(abs), old = decodeText(before);
    /* 版本快照：与 /api/nas/write 一致，保存前留一份 */
    let snapshot = false;
    try { const x = winnas.vpath(vp); winnas.writeFile(x.root, path.join(x.sub, name).replace(/\\/g, '/'), String((c.body || {}).content || '')); snapshot = true; }
    catch (e) { /* 引擎不可用时退回直接写，仍保持编码 */ }
    if (!snapshot) fs.writeFileSync(abs, encodeText((c.body || {}).content, old.encoding));
    const changed = /GBK|BIG5|GB18030/i.test(old.encoding);
    addLog('INFO', '保存文件 ' + name + '（原编码 ' + old.encoding + (changed ? ' → UTF-8' : '') + '）', 'files');
    return { ok: true, path: abs, encoding: changed ? 'UTF-8' : old.encoding,
      encodingChanged: changed, fromEncoding: old.encoding, snapshot };
  }

  /* ================= 需求 7：分享加密开关 ================= */
  function shareEncryptArgs(body) {
    const b = body || {};
    const encrypted = b.encrypted === true || b.encrypted === 1 || b.encrypted === '1';
    const password = encrypted ? String(b.password || '').trim() : '';
    if (encrypted && !password) throw new Error('已开启加密访问，请填写访问密码');
    if (encrypted && password.length > 128) throw new Error('访问密码过长');
    return { encrypted, password };
  }

  return {
    registries, registryShape, addRegistry, removeRegistry, loginRegistry, logoutRegistry, testRegistry,
    checkUpdates, updateContainer, inspectContainer, recreateContainer, recreateBody,
    previewFile, saveFile, shareEncryptArgs, decodeText, encodeText,
    _updCache: () => updCache
  };
}

module.exports = { initV15, decodeText, encodeText };
