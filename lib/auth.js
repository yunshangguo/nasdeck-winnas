'use strict';
/* ============================================================
 * auth.js — 用户、scrypt 密码、session（同时支持 Cookie 与 X-NasDeck-Token）
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadJson, saveJson } = require('./store');

const TTL = 12 * 60 * 60 * 1000;

function hash(pass, salt) { return crypto.scryptSync(String(pass), salt, 64).toString('hex'); }
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const seg of raw.split(';')) {
    const i = seg.indexOf('=');
    if (i > 0) out[seg.slice(0, i).trim()] = decodeURIComponent(seg.slice(i + 1).trim());
  }
  return out;
}

function initAuth(dataDir) {
  const file = path.join(dataDir, 'users.json');
  let users = loadJson(file, []);
  if (!Array.isArray(users)) users = [];
  if (!users.length) {
    const salt = crypto.randomBytes(16).toString('hex');
    const pass = process.env.NasDeck_PASSWORD || 'admin';
    users = [{
      id: 'u1', username: process.env.NasDeck_USER || 'admin', role: 'admin',
      salt, hash: hash(pass, salt), created: new Date().toISOString()
    }];
    saveJson(file, users);
    console.log('[AUTH] 首次运行，已创建管理员账户  ' + users[0].username + ' / ' + pass);
    console.log('[AUTH] 登录后请到「控制台 → 用户」修改密码，或用环境变量 NasDeck_PASSWORD 指定。');
  }
  const persist = () => saveJson(file, users);
  const sessions = new Map();

  function sidFrom(req) {
    const h = req.headers['x-nasdeck-token'];
    if (h) return String(h);
    return parseCookies(req)['nasdeck_sid'] || null;
  }
  function getSession(req) {
    const sid = sidFrom(req);
    if (!sid) return null;
    const s = sessions.get(sid);
    if (!s) return null;
    if (Date.now() > s.expire) { sessions.delete(sid); return null; }
    s.expire = Date.now() + TTL; // 滑动续期
    return s;
  }
  function login(username, password) {
    const u = users.find(x => x.username === String(username || '').trim());
    if (!u || !safeEq(hash(String(password || ''), u.salt), u.hash)) return null;
    const sid = crypto.randomBytes(24).toString('hex');
    const s = {
      sid, user: u.username, role: u.role, id: u.id,
      cwd: process.env.NasDeck_CWD || (process.platform === 'win32' ? process.cwd() : process.env.HOME || '/'),
      expire: Date.now() + TTL
    };
    sessions.set(sid, s);
    return s;
  }
  function logout(req) {
    const sid = sidFrom(req);
    if (sid) sessions.delete(sid);
  }
  function cookie(sid) {
    return 'nasdeck_sid=' + encodeURIComponent(sid) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(TTL / 1000);
  }
  function clearCookie() { return 'nasdeck_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'; }

  function changePassword(username, oldPass, newPass) {
    const u = users.find(x => x.username === username);
    if (!u) throw new Error('用户不存在');
    if (!safeEq(hash(String(oldPass || ''), u.salt), u.hash)) throw new Error('原密码不正确');
    if (!newPass || String(newPass).length < 3) throw new Error('新密码至少 3 位');
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hash(newPass, u.salt);
    persist();
    sessions.clear(); // 改密后所有既有会话失效，需重新登录
    return true;
  }
  function listUsers() {
    return users.map(u => ({ id: u.id, username: u.username, role: u.role, created: u.created }));
  }
  function addUser(username, password, role) {
    username = String(username || '').trim();
    if (!username) throw new Error('用户名不能为空');
    if (users.some(u => u.username === username)) throw new Error('用户名已存在');
    const salt = crypto.randomBytes(16).toString('hex');
    users.push({ id: 'u' + Date.now().toString(36), username, role: role === 'admin' ? 'admin' : 'user', salt, hash: hash(String(password || '123456'), salt), created: new Date().toISOString() });
    persist();
    return listUsers();
  }
  function delUser(username) {
    if (username === 'admin') throw new Error('不能删除内置管理员');
    const before = users.length;
    users = users.filter(u => u.username !== username);
    if (users.length === before) throw new Error('用户不存在');
    persist();
    return listUsers();
  }
  function setCwd(req, cwd) {
    const s = getSession(req);
    if (s && cwd) s.cwd = cwd;
    return s ? s.cwd : null;
  }

  /* 桌面版「后端设置窗口」用：运行时改名 / 改密，原地持久化到 users.json。
     不落明文密码、不重启进程；改成功后清空所有既有会话（安全优先，
     主窗口会要求重新登录一次）。users.json 已存在时不会重新播种，
     所以必须显式更新这里的用户数组，而不是只改环境变量。 */
  function reconfigureAdmin(opts) {
    opts = opts || {};
    const u = users.find(x => x.role === 'admin') || users[0];
    if (!u) throw new Error('用户库为空，无法更新管理员');
    let changed = false;
    if (opts.username !== undefined && opts.username !== null) {
      const name = String(opts.username).trim();
      if (!name) throw new Error('用户名不能为空');
      if (users.some(x => x !== u && x.username === name)) throw new Error('用户名已存在');
      if (name !== u.username) { u.username = name; changed = true; }
    }
    if (opts.password !== undefined && opts.password !== null && String(opts.password) !== '') {
      const pass = String(opts.password);
      if (pass.length < 3) throw new Error('新密码至少 3 位');
      u.salt = crypto.randomBytes(16).toString('hex');
      u.hash = hash(pass, u.salt);
      changed = true;
    }
    if (changed) { persist(); sessions.clear(); }
    return { username: u.username, changed, sessionsCleared: changed };
  }

  /* 纯校验：只比对 scrypt 哈希，不创建 session。
     WebDAV Basic 认证每个请求都会调用，若走 login() 会不断往 sessions Map
     里塞对象（12 小时 TTL + 滑动续期），长时间运行会持续占内存。 */
  function verify(username, password) {
    const u = users.find(x => x.username === String(username || '').trim());
    return !!u && safeEq(hash(String(password || ''), u.salt), u.hash);
  }

  return {
    getSession, login, logout, cookie, clearCookie, changePassword,
    listUsers, addUser, delUser, setCwd, reconfigureAdmin, verify,
    get sessionCount() { return sessions.size; }
  };
}

module.exports = { initAuth };
