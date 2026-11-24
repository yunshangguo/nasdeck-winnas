'use strict';
/* ============================================================
 * store.js — JSON 文件持久化（原子写，零依赖）
 * ============================================================ */
const fs = require('fs');
const path = require('path');

function loadJson(file, def) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const v = JSON.parse(raw);
    return (v && typeof v === 'object') ? v : def;
  } catch (e) { return typeof def === 'function' ? def() : def; }
}

function saveJson(file, obj) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  try { fs.unlinkSync(file); } catch (e) {}
  fs.renameSync(tmp, file);
  return obj;
}

class Store {
  constructor(dir, name, defaults) {
    this.file = path.join(dir, name + '.json');
    this.data = Object.assign({}, typeof defaults === 'function' ? defaults() : (defaults || {}), loadJson(this.file, {}));
    this._pending = null;
  }
  all() { return this.data; }
  get(k, d) { return this.data[k] === undefined ? d : this.data[k]; }
  set(k, v) { this.data[k] = v; this.save(); return v; }
  patch(o) { Object.assign(this.data, o); this.save(); return this.data; }
  save() {
    if (this._pending) return;
    this._pending = true;
    setImmediate(() => {
      this._pending = false;
      try { saveJson(this.file, this.data); } catch (e) { console.error('[STORE]', this.file, e.message); }
    });
  }
  saveNow() { try { saveJson(this.file, this.data); } catch (e) { console.error('[STORE]', e.message); } }
}

module.exports = { loadJson, saveJson, Store };
