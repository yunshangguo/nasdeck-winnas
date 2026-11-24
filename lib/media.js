'use strict';
/* ============================================================
 * media.js —— 真实媒体库引擎（零第三方依赖）
 *
 * 用户第 3 轮需求 5：PhotoDeck / MusicDeck / VideoDeck 可以选择
 * 媒体文件夹；选定后读取该文件夹内的媒体文件以及真实的元数据、封面、
 * 字幕、歌词。所有信息都从 Windows 本机磁盘解析，读不到就是 N/A，
 * 绝不编造时长 / 分辨率 / 艺术家。
 *
 * 解析范围：
 *   图片  JPEG SOF 尺寸 + EXIF(IFD0/ExifIFD：相机、拍摄时间、方向)
 *         PNG IHDR 尺寸
 *   音频  ID3v2.2/2.3/2.4 文本帧 + APIC 内嵌封面 + USLT 内嵌歌词 + TLEN
 *         ID3v1 兜底；同名 .lrc 歌词；同目录 cover/folder/<album>.jpg
 *   视频  MP4 mvhd 真实时长；同名/同目录 .srt/.ass/.ssa/.vtt/.sub 字幕；
 *         同名或 poster/folder/cover 封面
 *
 * 导出 initMedia(dataDir, sharesRoot)，接口与旧 lib/services.js 保持兼容：
 *   scan() / setRoots() / roots；另增 rootsByKind / setKindRoots() /
 *   browse() / detail()。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { typeOf } = require('./files');

const SUB_EXTS = ['srt', 'ass', 'ssa', 'vtt', 'sub', 'smi'];
const LRC_EXTS = ['lrc', 'txt'];
const ART_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];

function fileUrl(abs) { return '/api/media/file?path=' + encodeURIComponent(abs); }
function fmtSize(n) {
  return n > 1073741824 ? (n / 1073741824).toFixed(1) + ' GB'
    : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB'
      : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
}
function dateStr(ms) {
  try { return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '/'); } catch (e) { return 'N/A'; }
}
function safeRead(file, len) {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(len);
    const n = fs.readSync(fd, b, 0, len, 0);
    fs.closeSync(fd);
    return b.slice(0, n);
  } catch (e) { return Buffer.alloc(0); }
}
function tailRead(file, len) {
  try {
    const st = fs.statSync(file);
    if (st.size <= len) return fs.readFileSync(file);
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, st.size - len);
    fs.closeSync(fd);
    return b;
  } catch (e) { return Buffer.alloc(0); }
}
function cstr(buf, start) {
  let i = start;
  while (i < buf.length && buf[i] !== 0) i++;
  return { s: buf.slice(start, i).toString('latin1'), end: i + 1 };
}

/* ---------------- 图片：尺寸 + EXIF ---------------- */
function jpegInfo(buf) {
  const out = { format: 'JPEG', width: null, height: null, camera: null, model: null, dateTaken: null, orientation: null };
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return out;
  let i = 2;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    let m = buf[i + 1];
    while (m === 0xFF && i + 2 < buf.length) { i++; m = buf[i + 1]; }
    if (m === 0xD9 || m === 0xDA) break;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) break;
    const seg = buf.slice(i + 4, i + 2 + len);
    if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB)) {
      if (seg.length >= 5) { out.height = seg.readUInt16BE(1); out.width = seg.readUInt16BE(3); }
    } else if (m === 0xE1 && seg.length > 10 && seg.slice(0, 6).toString('latin1') === 'Exif\0\0') {
      try { parseExif(seg.slice(6), out); } catch (e) { /* EXIF 损坏不影响尺寸 */ }
    }
    i += 2 + len;
  }
  return out;
}
function parseExif(tiff, out) {
  const le = tiff[0] === 0x49;
  const rd16 = b => le ? b.readUInt16LE(0) : b.readUInt16BE(0);
  if (tiff.length < 8 || rd16(tiff.slice(2, 4)) !== 42) return;
  const ifd0 = le ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  function readIFD(off, target) {
    if (off + 2 > tiff.length) return null;
    const n = le ? tiff.readUInt16LE(off) : tiff.readUInt16BE(off);
    let exifOff = null;
    for (let k = 0; k < n && off + 2 + k * 12 + 12 <= tiff.length; k++) {
      const p = off + 2 + k * 12;
      const tag = le ? tiff.readUInt16LE(p) : tiff.readUInt16BE(p);
      const typ = le ? tiff.readUInt16LE(p + 2) : tiff.readUInt16BE(p + 2);
      const cnt = le ? tiff.readUInt32LE(p + 4) : tiff.readUInt32BE(p + 4);
      const vo = le ? tiff.readUInt32LE(p + 8) : tiff.readUInt32BE(p + 8);
      const valAt = cnt * (typ === 3 ? 2 : typ === 4 || typ === 9 ? 4 : 1) <= 4 ? p + 8 : vo;
      if (valAt + 1 > tiff.length) continue;
      if (tag === 0x010F) target.camera = tiff.slice(valAt, Math.min(valAt + cnt, tiff.length)).toString('latin1').replace(/\0/g, '').trim() || null;
      else if (tag === 0x0110) target.model = tiff.slice(valAt, Math.min(valAt + cnt, tiff.length)).toString('latin1').replace(/\0/g, '').trim() || null;
      else if (tag === 0x0132) target.dateTaken = tiff.slice(valAt, Math.min(valAt + cnt, tiff.length)).toString('latin1').replace(/\0/g, '').trim() || null;
      else if (tag === 0x0112) { try { target.orientation = le ? tiff.readUInt16LE(valAt) : tiff.readUInt16BE(valAt); } catch (e) {} }
      else if (tag === 0x8769) exifOff = vo;
    }
    return exifOff;
  }
  const sub = readIFD(ifd0, out);
  if (sub) {
    const d = {};
    readIFD(sub, d);
    if (d.dateTaken) out.dateTaken = d.dateTaken;   /* DateTimeOriginal 优先 */
  }
}
function pngInfo(buf) {
  const out = { format: 'PNG', width: null, height: null, camera: null, model: null, dateTaken: null, orientation: null };
  if (buf.length >= 24 && buf.slice(1, 4).toString('latin1') === 'PNG') {
    out.width = buf.readUInt32BE(16); out.height = buf.readUInt32BE(20);
  }
  return out;
}

/* ---------------- 音频：ID3v2 / ID3v1 ---------------- */
function decodeID3Text(b) {
  if (!b || !b.length) return '';
  const enc = b[0], rest = b.slice(1);
  let s = '';
  try {
    if (enc === 0) s = rest.toString('latin1');
    else if (enc === 3) s = rest.toString('utf8');
    else if (enc === 1 || enc === 2) {
      const x = rest.length % 2 ? rest.slice(0, -1) : rest;
      if (enc === 2) { const sw = Buffer.from(x); sw.swap16(); s = sw.toString('utf16le'); }
      else s = x.toString('utf16le');
      if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    } else s = rest.toString('latin1');
  } catch (e) { s = rest.toString('latin1'); }
  return s.replace(/\0+$/, '').replace(/^\s+|\s+$/g, '');
}
function id3v2(buf, artDir) {
  const out = { title: null, artist: null, album: null, year: null, genre: null, track: null, durMs: null, lyrics: null, cover: null };
  if (buf.length < 10 || buf.slice(0, 3).toString('latin1') !== 'ID3') return out;
  const ver = buf[3];
  const sync = v => ((v[0] & 0x7f) << 21) | ((v[1] & 0x7f) << 14) | ((v[2] & 0x7f) << 7) | (v[3] & 0x7f);
  let size = sync(buf.slice(6, 10));
  if (size <= 0 || size > buf.length) size = buf.length - 10;
  const body = buf.slice(10, 10 + size);
  let i = 0;
  const idLen = ver === 2 ? 3 : 4, headLen = ver === 2 ? 6 : 10;
  while (i + headLen <= body.length) {
    const id = body.slice(i, i + idLen).toString('latin1');
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let flen;
    if (ver === 2) flen = body.readUIntBE(i + 3, 3);
    else flen = ver >= 4 ? sync(body.slice(i + 4, i + 8)) : body.readUInt32BE(i + 4);
    if (flen <= 0 || flen > body.length - i - headLen) break;
    const d = body.slice(i + headLen, i + headLen + flen);
    const key = ver === 2 ? ({ TT2: 'title', TP1: 'artist', TAL: 'album', TYE: 'year', TCO: 'genre', TRK: 'track', TLE: 'durMs', ULT: 'lyrics', PIC: 'cover' }[id]) :
      ({ TIT2: 'title', TPE1: 'artist', TALB: 'album', TYER: 'year', TDRC: 'year', TCON: 'genre', TRCK: 'track', TLEN: 'durMs', USLT: 'lyrics', APIC: 'cover' }[id]);
    if (key && d.length) {
      try {
        if (key === 'cover') {
          const art = extractArt(d, artDir);
          if (art) out.cover = art;
        } else if (key === 'lyrics') {
          const t = extractUSLT(d);
          if (t) out.lyrics = t;
        } else if (key === 'durMs') {
          const n = Number(decodeID3Text(d).replace(/[^0-9]/g, ''));
          if (n > 0) out.durMs = n;
        } else {
          const t = decodeID3Text(d);
          if (t && !out[key]) out[key] = t;
        }
      } catch (e) { /* 单个坏帧不影响其它帧 */ }
    }
    i += headLen + flen;
  }
  return out;
}
function extractArt(d, artDir) {
  /* APIC/PIC：encoding(1) + mime\0 + picType(1) + desc + 图片数据。
     直接找 JPEG/PNG magic，绕开 desc 的编码差异，最稳。 */
  const mime = cstr(d, 1);
  let start = -1, ext = 'jpg';
  const jpg = d.indexOf(Buffer.from([0xFF, 0xD8, 0xFF]), mime.end + 1);
  const png = d.indexOf(Buffer.from([0x89, 0x50, 0x4E, 0x47]), mime.end + 1);
  if (jpg >= 0) { start = jpg; ext = 'jpg'; }
  else if (png >= 0) { start = png; ext = 'png'; }
  if (start < 0) {
    const t = d.slice(mime.end + 1).toString('latin1').toLowerCase();
    if (t.indexOf('png') === 0) ext = 'png';
    start = mime.end + 1;
  }
  const raw = d.slice(start);
  if (raw.length < 64) return null;
  const name = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 24) + '.' + ext;
  const full = path.join(artDir, name);
  try { if (!fs.existsSync(full)) fs.writeFileSync(full, raw); } catch (e) { return null; }
  return { url: fileUrl(full), path: full, source: 'ID3 内嵌封面' };
}
function extractUSLT(d) {
  if (d.length < 5) return null;
  const enc = d[0];
  let i = 4; /* encoding + lang(3) */
  if (enc === 1 || enc === 2) {
    while (i + 1 < d.length && !(d[i] === 0 && d[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < d.length && d[i] !== 0) i++;
    i++;
  }
  if (i >= d.length) return null;
  const t = decodeID3Text(Buffer.concat([Buffer.from([enc]), d.slice(i)]));
  return t && t.length > 2 ? t.slice(0, 20000) : null;
}
function id3v1(buf) {
  const out = { title: null, artist: null, album: null, year: null, track: null };
  if (buf.length < 128) return out;
  const t = buf.slice(buf.length - 128);
  if (t.slice(0, 3).toString('latin1') !== 'TAG') return out;
  const s = (a, b) => t.slice(a, b).toString('latin1').replace(/\0/g, '').trim() || null;
  out.title = s(3, 33); out.artist = s(33, 63); out.album = s(63, 93); out.year = s(93, 97);
  return out;
}

/* ---------------- 视频：MP4 mvhd 时长 ---------------- */
function mp4Duration(buf) {
  let at = buf.indexOf(Buffer.from('mvhd'));
  if (at < 0 || at + 20 > buf.length) return null;
  const p = at + 4;                 /* version(1)+flags(3) 之后 */
  const ver = buf[p];
  let timescale, dur;
  try {
    /* mvhd(v0): version+flags(4) creation(4) modification(4) timescale(4) duration(4)
       mvhd(v1): version+flags(4) creation(8) modification(8) timescale(4) duration(8) */
    if (ver === 1) { timescale = buf.readUInt32BE(p + 20); dur = Number(buf.readBigUInt64BE(p + 24)); }
    else { timescale = buf.readUInt32BE(p + 12); dur = buf.readUInt32BE(p + 16); }
  } catch (e) { return null; }
  if (!timescale || !dur || dur === 0xFFFFFFFF) return null;
  return Math.round(dur / timescale);
}
function durText(sec) {
  if (sec === null || sec === undefined || !isFinite(sec) || sec <= 0) return 'N/A';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ':' + String(s).padStart(2, '0');
}

/* ---------------- 同目录附属文件 ---------------- */
function siblings(dir, base, name, exts) {
  const hits = [];
  const all = (() => { try { return fs.readdirSync(dir); } catch (e) { return []; } })();
  const lower = all.map(x => ({ n: x, l: x.toLowerCase() }));
  const exact = name.replace(/\.[^.]+$/, '').toLowerCase();
  exts.forEach(function (ext) {
    lower.forEach(function (x) {
      if (!x.l.endsWith('.' + ext)) return;
      const stem = x.l.slice(0, -(ext.length + 1));
      if (stem === exact || stem === base.toLowerCase()) {
        if (!hits.some(h => h.n === x.n)) hits.push({ n: x.n, full: path.join(dir, x.n), ext });
      }
    });
  });
  return hits;
}
function commonArt(dir, base) {
  const names = ['cover', 'folder', 'poster', 'front', 'album', 'thumb'];
  const tryOne = n => {
    for (const e of ART_EXTS) {
      const f = path.join(dir, n + '.' + e);
      if (fs.existsSync(f)) return f;
    }
    return null;
  };
  let f = null;
  for (const n of names) { f = tryOne(n); if (f) return f; }
  f = tryOne(base);
  return f;
}
function artRec(full, source) {
  return full ? { url: fileUrl(full), path: full, source: source } : null;
}

/* ---------------- 单文件探测 ---------------- */
function probe(full, st, kind, artDir) {
  const name = path.basename(full), dir = path.dirname(full);
  const base = name.replace(/\.[^.]+$/, '');
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  const rec = {
    n: name, path: full, url: fileUrl(full), kind: kind,
    sz: st.size, szText: fmtSize(st.size), d: dateStr(st.mtimeMs),
    pl: path.basename(dir), ext: ext,
    title: base, artist: null, album: null, year: null, genre: null, track: null,
    width: null, height: null, camera: null, model: null, dateTaken: null, orientation: null,
    dur: null, durText: 'N/A',
    cover: null, lyrics: null, lyricsUrl: null, lyricsSource: null,
    subtitles: [], meta: {}
  };

  if (kind === 'photo') {
    const b = safeRead(full, 256 * 1024);
    const info = /\.png$/i.test(name) ? pngInfo(b) : jpegInfo(b);
    rec.width = info.width; rec.height = info.height;
    rec.camera = info.camera; rec.model = info.model;
    rec.dateTaken = info.dateTaken; rec.orientation = info.orientation;
    rec.cover = { url: rec.url, path: full, source: '原图' };
    rec.meta = {
      '格式': info.format, '尺寸': info.width && info.height ? info.width + ' × ' + info.height : 'N/A',
      '相机': info.camera || 'N/A', '型号': info.model || 'N/A',
      '拍摄时间': info.dateTaken || 'N/A', '方向': info.orientation || 'N/A'
    };
  } else if (kind === 'music') {
    const head = safeRead(full, 512 * 1024);
    let id = id3v2(head, artDir);
    if (!id.title && !id.artist) {
      const v1 = id3v1(tailRead(full, 128));
      id = Object.assign({}, id, {
        title: id.title || v1.title, artist: id.artist || v1.artist,
        album: id.album || v1.album, year: id.year || v1.year
      });
    }
    /* 文件名 "艺术家 - 标题" 只作为最后的兜底，且不冒充元数据来源 */
    const parts = base.split(/\s+[-–]\s+/);
    rec.title = id.title || (parts.length > 1 ? parts.slice(1).join(' - ') : base);
    rec.artist = id.artist || (parts.length > 1 ? parts[0] : null);
    rec.album = id.album || path.basename(dir);
    rec.year = id.year; rec.genre = id.genre; rec.track = id.track;
    if (id.durMs) { rec.dur = Math.round(id.durMs / 1000); rec.durText = durText(rec.dur); }
    rec.lyrics = id.lyrics;
    if (id.lyrics) rec.lyricsSource = 'ID3 USLT 内嵌歌词';
    const lrc = siblings(dir, base, name, LRC_EXTS).filter(x => x.ext === 'lrc')[0];
    if (lrc) {
      rec.lyricsUrl = fileUrl(lrc.full);
      rec.lyricsSource = rec.lyrics ? rec.lyricsSource : '同名 .lrc 歌词';
    }
    if (id.cover) rec.cover = id.cover;
    else {
      const own = siblings(dir, base, name, ART_EXTS)[0];
      const f = own ? own.full : commonArt(dir, base);
      if (f) rec.cover = artRec(f, own ? '同名封面图' : '专辑/目录封面图');
    }
    rec.meta = {
      '标题': rec.title, '艺术家': rec.artist || 'N/A', '专辑': rec.album || 'N/A',
      '年份': rec.year || 'N/A', '曲风': rec.genre || 'N/A', '轨号': rec.track || 'N/A',
      '时长': rec.durText, '格式': ext.toUpperCase(), '标签来源': (id.title || id.artist) ? 'ID3 标签' : '文件名 / 目录名'
    };
  } else {
    const head = safeRead(full, 1024 * 1024);
    if (/\.(mp4|m4v|mov)$/i.test(name)) {
      const sec = mp4Duration(head);
      if (sec) { rec.dur = sec; rec.durText = durText(sec); }
    }
    rec.subtitles = siblings(dir, base, name, SUB_EXTS).map(function (x) {
      const m = /\.([a-zA-Z]{2,3})\.[^.]+$/i.exec(x.n);
      return { n: x.n, url: fileUrl(x.full), path: x.full, ext: x.ext, lang: m ? m[1] : '默认' };
    });
    const own = siblings(dir, base, name, ART_EXTS)[0];
    const f = own ? own.full : commonArt(dir, base);
    if (f) rec.cover = artRec(f, own ? '同名封面图' : '目录封面图');
    rec.title = base; rec.year = String(new Date(st.mtimeMs).getFullYear());
    rec.genre = path.basename(dir);
    rec.meta = {
      '标题': base, '年份': rec.year, '分类': rec.genre,
      '时长': rec.durText, '格式': ext.toUpperCase(),
      '字幕': rec.subtitles.length ? rec.subtitles.map(s => s.n).join('、') : 'N/A',
      '封面': rec.cover ? rec.cover.source : 'N/A'
    };
  }
  return rec;
}

/* ---------------- 主体 ---------------- */
function initMedia(dataDir, sharesRoot) {
  const artDir = path.join(dataDir, 'media-art');
  try { fs.mkdirSync(artDir, { recursive: true }); } catch (e) {}
  const home = os.homedir();
  const defs = {
    photo: [path.join(home, 'Pictures'), path.join(sharesRoot, 'Multimedia', 'Photos')].filter(fs.existsSync),
    music: [path.join(home, 'Music'), path.join(sharesRoot, 'Multimedia', 'Music')].filter(fs.existsSync),
    video: [path.join(home, 'Videos'), path.join(sharesRoot, 'Multimedia', 'Video')].filter(fs.existsSync)
  };
  let byKind = { photo: defs.photo.slice(), music: defs.music.slice(), video: defs.video.slice() };
  const exists = p => { try { return fs.existsSync(p); } catch (e) { return false; } };

  function setRoots(r) {
    if (Array.isArray(r) && r.length) {
      const a = r.filter(exists);
      byKind = { photo: a.slice(), music: a.slice(), video: a.slice() };
    } else byKind = { photo: defs.photo.slice(), music: defs.music.slice(), video: defs.video.slice() };
    return byKind;
  }
  function setKindRoots(kind, arr) {
    if (!byKind[kind]) return byKind;
    byKind[kind] = (Array.isArray(arr) ? arr : []).filter(exists);
    return byKind;
  }
  function allRoots() {
    const seen = new Set(), out = [];
    ['photo', 'music', 'video'].forEach(k => (byKind[k] || []).forEach(p => {
      if (!seen.has(p.toLowerCase())) { seen.add(p.toLowerCase()); out.push(p); }
    }));
    return out;
  }

  const want = { photo: 'img', music: 'aud', video: 'vid' };
  function scanKind(kind, max) {
    const out = [], seen = new Set();
    const walk = (dir, depth) => {
      if (depth > 4 || out.length >= max) return;
      let list;
      try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const d of list) {
        if (out.length >= max) break;
        if (d.name.startsWith('.') || d.name === 'node_modules') continue;
        const full = path.join(dir, d.name);
        if (d.isDirectory()) { walk(full, depth + 1); continue; }
        if (typeOf(d.name, false) !== want[kind]) continue;
        const key = full.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
        let st; try { st = fs.statSync(full); } catch (e) { continue; }
        try { out.push(probe(full, st, kind, artDir)); } catch (e) { /* 单文件解析失败跳过，不伪造 */ }
      }
    };
    (byKind[kind] || []).forEach(r => walk(r, 0));
    return out;
  }
  function scan(max = 600) {
    const photos = scanKind('photo', max), songs = scanKind('music', max), movies = scanKind('video', max);
    const cnt = a => a.length;
    return {
      photos, songs, movies,
      roots: allRoots(), rootsByKind: JSON.parse(JSON.stringify(byKind)),
      scanned: photos.length + songs.length + movies.length,
      stats: {
        photo: { items: cnt(photos), covers: photos.filter(x => x.cover).length, exif: photos.filter(x => x.dateTaken || x.camera).length },
        music: { items: cnt(songs), covers: songs.filter(x => x.cover).length, lyrics: songs.filter(x => x.lyrics || x.lyricsUrl).length, id3: songs.filter(x => x.meta && x.meta['标签来源'] === 'ID3 标签').length },
        video: { items: cnt(movies), covers: movies.filter(x => x.cover).length, subtitles: movies.filter(x => x.subtitles.length).length, duration: movies.filter(x => x.dur).length }
      }
    };
  }

  /* 目录浏览：供「选择媒体文件夹」逐级挑选本机目录 */
  function browse(input) {
    const raw = String(input || '').trim();
    if (!raw || raw === '/' || raw === '__root__') {
      const drives = [];
      if (process.platform === 'win32') {
        for (let i = 65; i <= 90; i++) {
          const L = String.fromCharCode(i), r = L + ':\\';
          try { if (fs.existsSync(r)) drives.push({ n: L + ':\\', p: r, media: 0 }); } catch (e) {}
        }
      } else drives.push({ n: '/', p: '/', media: 0 });
      return { path: '__root__', parent: null, label: '此电脑', dirs: drives, mediaCount: 0 };
    }
    if (!path.isAbsolute(raw) || !exists(raw)) return { error: '目录不存在或不是绝对路径：' + raw };
    let st; try { st = fs.statSync(raw); } catch (e) { return { error: '目录不可读' }; }
    if (!st.isDirectory()) return { error: '不是文件夹' };
    let list; try { list = fs.readdirSync(raw, { withFileTypes: true }); } catch (e) { return { error: '目录不可读（权限限制）' }; }
    const dirs = [], exts = /\.(jpg|jpeg|png|gif|webp|bmp|mp3|m4a|wav|flac|ogg|aac|wma|mp4|mkv|webm|avi|mov|wmv|flv|m4v|ts|rmvb)$/i;
    let mediaCount = 0;
    for (const d of list) {
      try {
        if (d.isDirectory()) {
          if (d.name.startsWith('.') || d.name === 'node_modules' || d.name === '$RECYCLE.BIN') continue;
          dirs.push({ n: d.name, p: path.join(raw, d.name), media: 0 });
        } else if (exts.test(d.name)) mediaCount++;
      } catch (e) {}
    }
    dirs.sort((a, b) => a.n.localeCompare(b.n, 'zh-CN'));
    const parent = path.dirname(raw);
    return {
      path: raw, label: raw, mediaCount: mediaCount, dirs,
      parent: (parent && parent !== raw && exists(parent)) ? parent : '__root__'
    };
  }

  /* 单文件完整详情：把歌词 / 字幕正文一起读出，弹窗一次展示 */
  function detail(p) {
    const abs = String(p || '');
    if (!abs || !path.isAbsolute(abs) || !exists(abs)) return { error: '文件不存在' };
    let st; try { st = fs.statSync(abs); } catch (e) { return { error: '文件不可读' }; }
    const t = typeOf(abs, false);
    const kind = t === 'img' ? 'photo' : t === 'aud' ? 'music' : t === 'vid' ? 'video' : null;
    if (!kind) return { error: '不是受支持的媒体文件' };
    const rec = probe(abs, st, kind, artDir);
    const readText = f => {
      if (!f) return null;
      try { return fs.readFileSync(f, 'utf8').slice(0, 20000); } catch (e) { return null; }
    };
    if (rec.lyricsUrl) {
      const f = rec.subtitles.length ? null : siblings(path.dirname(abs), path.basename(abs).replace(/\.[^.]+$/, ''), path.basename(abs), ['lrc'])[0];
      if (f) rec.lyricsText = readText(f.full);
    }
    if (rec.subtitles.length) rec.subtitlesText = readText(rec.subtitles[0].path);
    return { ok: true, item: rec, text: { lyrics: rec.lyricsText || rec.lyrics || null, subtitle: rec.subtitlesText || null } };
  }

  return {
    scan, setRoots, setKindRoots, browse, detail, fileUrl,
    get roots() { return allRoots(); },
    get rootsByKind() { return JSON.parse(JSON.stringify(byKind)); }
  };
}

module.exports = { initMedia };
