'use strict';
/* ==================================================================
 * plugins.js — NasDeck 插件中心（后端）
 *
 * 设计原则：
 *   · 项目自带功能全部登记为「内置插件」，不再读取 Windows 已安装软件；
 *   · 用户按规范写一个 .js 文件即可上传，文件落在 data/plugins/ 下；
 *   · 后端只负责存储 / 校验 / 元数据解析，绝不在服务端执行插件代码，
 *     插件由前端在浏览器里按需装载（本地工具，插件由用户自己编写）；
 *   · 不拉起任何外部进程，不触碰注册表。
 * ================================================================== */
const fs = require('fs');
const path = require('path');

/* 内置插件 = 这个项目的功能。id 与底座 APPS 一致，点「打开」直接开对应窗口。 */
const BUILTIN = [
  ['filestation', '文件总管', 'File Station', '文件', 'folder', '浏览、上传、共享 Windows 本机磁盘与「我的空间」'],
  ['storage', '存储与快照总管', 'Storage & Snapshots', '存储', 'database', '本机磁盘、容量与版本快照'],
  ['dashboard', '资源监控', 'Resource Monitor', '系统', 'activity', 'CPU / 内存 / 网络 / 磁盘实时状态'],
  ['controlpanel', '控制台', 'Control Panel', '系统', 'sliders', '系统、网络、权限与区域设置'],
  ['container', '容器工作台', '容器工作台', '应用', 'box', 'Docker 容器、镜像、创建容器与 WSL 引擎'],
  ['trash', '资源回收站', 'Recycle Bin', '文件', 'trash', 'Windows 回收站真实项目 / 还原 / 永久删除'],
  ['network', '网络与虚拟交换机', 'Network & Virtual Switch', '网络', 'lan', '真实网卡启用、DNS、DHCP 操作'],
  ['qufirewall', 'QuFirewall', 'QuFirewall', '安全性', 'shield', 'Windows 防火墙规则与配置文件'],
  ['remotelink', '远程联机', 'Remote Access', '网络', 'cloud', '本机 IPv4、监听端口与联机地址'],
  ['logs', '系统日志', 'System Logs', '系统', 'list', '后端真实事件日志'],
  ['terminal', '终端机', 'Terminal', '系统', 'terminal', 'Windows 本机命令行控制台'],
  ['hbs', 'BackupDeck 备份同步', 'BackupDeck', '存储', 'refresh', 'robocopy 真实备份任务'],
  ['download', 'Download Station', 'Download Station', '应用', 'download', 'BT / HTTP 下载任务'],
  ['photodeck', 'PhotoDeck', 'PhotoDeck', '多媒体', 'image', '本机照片库'],
  ['music', 'MusicDeck', 'MusicDeck', '多媒体', 'music', '本机音乐库'],
  ['video', 'VideoDeck', 'VideoDeck', '多媒体', 'film', '本机影音库'],
  ['settings', '系统设置', 'System Settings', '系统', 'settings', '外观、壁纸、主题与个人化'],
  ['about', '关于本机', 'About This NAS', '系统', 'info', '运行平台与版本信息'],
  ['help', '帮助中心', 'Help Center', '系统', 'help', '常见问题与线上支持']
].map(x => ({
  id: x[0], name: x[1], en: x[2], category: x[3], icon: x[4], description: x[5],
  version: '2.4.0', author: 'NasDeck 内置', builtin: true, source: 'builtin', enabled: true
}));

const MAX_SIZE = 512 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9_\-]{0,47}$/;

function safeId(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function parseManifest(src) {
  const m = /\/\*\s*NasDeck-PLUGIN\s*([\s\S]*?)\*\//.exec(src);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1].trim());
    return (j && typeof j === 'object') ? j : null;
  } catch (e) { return null; }
}

const TEMPLATE = `/*NasDeck-PLUGIN
{
  "name": "我的插件",
  "version": "1.0.0",
  "description": "一句话说明这个插件做什么",
  "icon": "box",
  "author": "你的名字",
  "category": "应用"
}
*/
/* 插件规范：
   1. 单文件 .js，保存为 英文小写id.js（例如 my-tool.js）后在插件中心上传；
   2. 文件头的 NasDeck-PLUGIN 注释块是 JSON 元数据，格式见本文件最上方；
   3. 调用 NasDeck.registerPlugin(obj) 注册，obj.render() 返回窗口里的 HTML；
   4. 可用 NasDeck.get('/api/...') / NasDeck.post('/api/...', {...}) 调用后端真实接口；
   5. 可用 esc / glyph / toast / rerender 等底座全局函数；
   6. 插件在浏览器本地执行，只在你自己上传时生效，不读取也不上传任何数据。 */
NasDeck.registerPlugin({
  render: function () {
    return '<div class="app"><div class="card">' +
      '<div class="section-title">Hello · 我的插件</div>' +
      '<p class="desc">这是插件窗口。把 render() 返回的 HTML 换成你的功能即可。</p>' +
      '<button class="btn sm primary" data-act="plg-hello">点我测试</button>' +
      '</div></div>';
  },
  actions: {
    'plg-hello': function () { toast('插件正常', '插件动作已被触发', 'ok'); }
  }
});
`;

function initPlugins(dataDir) {
  const root = path.join(dataDir, 'plugins');
  try { fs.mkdirSync(root, { recursive: true }); } catch (e) {}
  const stateFile = path.join(root, 'state.json');
  let state = { disabled: {} };
  try {
    const j = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (j && typeof j === 'object') state = { disabled: (j.disabled && typeof j.disabled === 'object') ? j.disabled : {} };
  } catch (e) { /* 首次运行 / 文件损坏：用空状态，不写盘 */ }
  function saveState() {
    try { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8'); } catch (e) {}
  }
  const builtinIds = new Set(BUILTIN.map(p => p.id));

  function custom() {
    let files = [];
    try { files = fs.readdirSync(root).filter(f => /\.js$/.test(f)); } catch (e) { return []; }
    return files.map(f => {
      const id = f.slice(0, -3);
      let src = '', size = 0, mtime = 0;
      try {
        const st = fs.statSync(path.join(root, f));
        size = st.size; mtime = st.mtimeMs;
        src = fs.readFileSync(path.join(root, f), 'utf8');
      } catch (e) {}
      const mf = parseManifest(src) || {};
      return {
        id, name: String(mf.name || id).slice(0, 60), en: String(mf.en || id).slice(0, 60),
        version: String(mf.version || '1.0.0').slice(0, 24),
        description: String(mf.description || '（未提供描述）').slice(0, 240),
        icon: String(mf.icon || 'box').replace(/[^a-z0-9_\-]/gi, '').slice(0, 24) || 'box',
        author: String(mf.author || 'N/A').slice(0, 60),
        category: String(mf.category || '应用').slice(0, 24),
        builtin: false, source: 'uploaded',
        enabled: !state.disabled[id],
        manifestOk: !!parseManifest(src),
        hasRegister: /NasDeck\s*\.\s*registerPlugin\s*\(/.test(src),
        size, mtime, filename: f
      };
    });
  }

  function list() {
    const bs = BUILTIN.map(p => Object.assign({}, p, { enabled: !state.disabled[p.id] }));
    return {
      ok: true,
      plugins: bs.concat(custom()),
      dir: root,
      counts: { builtin: bs.length, uploaded: custom().length, enabled: bs.filter(x => x.enabled).length },
      template: TEMPLATE
    };
  }

  function upload(o) {
    o = o || {};
    const src = String(o.content || '');
    if (!src) throw new Error('插件内容为空');
    if (Buffer.byteLength(src, 'utf8') > MAX_SIZE) throw new Error('插件文件超过 512 KB 上限');
    if (!/NasDeck\s*\.\s*registerPlugin\s*\(/.test(src)) throw new Error('插件缺少 NasDeck.registerPlugin(...) 注册调用');
    let id = safeId(o.id || o.filename || '');
    if (o.filename) id = safeId(String(o.filename).replace(/\.js$/i, ''));
    if (!id || !ID_RE.test(id)) throw new Error('插件 ID 非法（只允许小写字母、数字、_ 和 -，最长 48 字符）');
    if (builtinIds.has(id)) id = 'usr_' + id;
    if (!ID_RE.test(id)) throw new Error('插件 ID 非法');
    const mf = parseManifest(src);
    const file = path.join(root, id + '.js');
    fs.writeFileSync(file, src, 'utf8');
    delete state.disabled[id];
    saveState();
    return { ok: true, id, filename: id + '.js', manifestOk: !!mf, size: Buffer.byteLength(src, 'utf8') };
  }

  function toggle(id, enabled) {
    id = safeId(id);
    if (!id || !ID_RE.test(id)) throw new Error('插件 ID 非法');
    if (enabled) delete state.disabled[id]; else state.disabled[id] = true;
    saveState();
    return { ok: true, id, enabled: !!enabled };
  }

  function remove(id) {
    id = safeId(id);
    if (!id || !ID_RE.test(id) || builtinIds.has(id)) throw new Error('内置插件不可删除');
    const file = path.join(root, id + '.js');
    if (!fs.existsSync(file)) throw new Error('插件不存在：' + id);
    fs.unlinkSync(file);
    delete state.disabled[id];
    saveState();
    return { ok: true, id };
  }

  function content(id) {
    id = safeId(id);
    if (!id || !ID_RE.test(id)) throw new Error('插件 ID 非法');
    const file = path.join(root, id + '.js');
    if (!fs.existsSync(file)) throw new Error('插件不存在：' + id);
    return { ok: true, id, code: fs.readFileSync(file, 'utf8') };
  }

  return { list, upload, toggle, remove, content, template: () => TEMPLATE, get dir() { return root; } };
}

module.exports = { initPlugins, BUILTIN, TEMPLATE };
