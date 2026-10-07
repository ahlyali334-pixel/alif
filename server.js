'use strict';
// Portfolio backend: Node.js (>=22.13) + built-in SQLite. No npm packages needed.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---- config (.env is optional) ----
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const PORT = Number(process.env.PORT) || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PW = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PUBLIC = path.join(__dirname, 'public');

// ---- database ----
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'portfolio.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS projects(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_en TEXT NOT NULL, title_ar TEXT DEFAULT '',
  desc_en TEXT DEFAULT '', desc_ar TEXT DEFAULT '',
  tags TEXT DEFAULT '', category TEXT DEFAULT 'code', link TEXT DEFAULT '',
  likes INTEGER DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_likes(project_id INTEGER, ip TEXT, PRIMARY KEY(project_id, ip));
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, message TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS guestbook(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, message TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS counters(k TEXT PRIMARY KEY, v INTEGER DEFAULT 0);
`);
if (db.prepare('SELECT COUNT(*) c FROM projects').get().c === 0) {
  const ins = db.prepare('INSERT INTO projects(title_en,title_ar,desc_en,desc_ar,tags,category,created) VALUES(?,?,?,?,?,?,?)');
  const now = Date.now();
  ins.run('Raspberry Pi Projects', 'مشاريع Raspberry Pi', 'IoT projects using sensors and automation.', 'مشاريع IoT بتستخدم سنسورات وأتمتة.', 'Raspberry Pi,Sensors,Automation', 'iot', now);
  ins.run('Network Configuration & Troubleshooting', 'إعداد الشبكات وحل أعطالها', 'Setting up networks and diagnosing and fixing connectivity issues.', 'إعداد الشبكات وتشخيص مشاكل الاتصال وحلها.', 'CCNA,Troubleshooting', 'net', now + 1);
  ins.run('Web & Desktop Applications', 'تطبيقات ويب وديسكتوب', 'Applications built with C, C++, Python and Java.', 'تطبيقات مبنية بـ C وC++ وPython وJava.', 'C,C++,Python,Java', 'code', now + 2);
}

// ---- helpers ----
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const ipOf = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 20000) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('bad json'), { code: 400 })); } });
    req.on('error', reject);
  });
}
// simple in-memory rate limit: max `n` hits per `ms` per ip+bucket
const hits = new Map();
function limited(req, bucket, n, ms) {
  const k = bucket + ':' + ipOf(req), now = Date.now();
  const arr = (hits.get(k) || []).filter(t => now - t < ms);
  arr.push(now); hits.set(k, arr);
  return arr.length > n;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

// admin tokens: "<expiry>.<hmac>"
const sign = exp => crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
function makeToken() { const exp = Date.now() + 8 * 3600e3; return exp + '.' + sign(exp); }
function isAdmin(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const safeUrl = u => (/^https?:\/\/[^\s]+$/i.test(u) ? u.slice(0, 300) : '');
const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e);
const counter = k => db.prepare('SELECT v FROM counters WHERE k=?').get(k)?.v || 0;
function projectFields(b) {
  const category = ['iot', 'net', 'code'].includes(b.category) ? b.category : 'code';
  return [clean(b.title_en, 120), clean(b.title_ar, 120), clean(b.desc_en, 400), clean(b.desc_ar, 400),
    clean(b.tags, 120), category, safeUrl(clean(b.link, 300))];
}

// ---- API ----
async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  let r;

  if (m === 'GET' && p === '/api/projects')
    return send(res, 200, db.prepare('SELECT * FROM projects ORDER BY created').all());

  if ((r = p.match(/^\/api\/projects\/(\d+)\/like$/)) && m === 'POST') {
    if (limited(req, 'like', 30, 60e3)) return send(res, 429, { error: 'rate_limited' });
    const id = Number(r[1]);
    if (!db.prepare('SELECT 1 FROM projects WHERE id=?').get(id)) return send(res, 404, { error: 'not_found' });
    const added = db.prepare('INSERT OR IGNORE INTO project_likes(project_id,ip) VALUES(?,?)').run(id, sha(ipOf(req) + SECRET)).changes;
    if (added) db.prepare('UPDATE projects SET likes=likes+1 WHERE id=?').run(id);
    return send(res, 200, { likes: db.prepare('SELECT likes FROM projects WHERE id=?').get(id).likes, already: !added });
  }

  if (m === 'POST' && p === '/api/visit') {
    db.prepare('INSERT INTO counters(k,v) VALUES(?,1) ON CONFLICT(k) DO UPDATE SET v=v+1').run('visits');
    return send(res, 200, { visits: counter('visits') });
  }
  if (m === 'GET' && p === '/api/stats') return send(res, 200, { visits: counter('visits') });

  if (m === 'POST' && p === '/api/contact') {
    if (limited(req, 'contact', 3, 10 * 60e3)) return send(res, 429, { error: 'rate_limited' });
    const b = await readJson(req);
    if (b.website) return send(res, 200, { ok: true }); // honeypot: bots fill this
    const name = clean(b.name, 80), email = clean(b.email, 200), message = clean(b.message, 3000);
    if (!name || !validEmail(email) || message.length < 5) return send(res, 400, { error: 'invalid' });
    db.prepare('INSERT INTO messages(name,email,message,created) VALUES(?,?,?,?)').run(name, email, message, Date.now());
    return send(res, 201, { ok: true });
  }

  if (p === '/api/guestbook') {
    if (m === 'GET') return send(res, 200, db.prepare('SELECT id,name,message,created FROM guestbook ORDER BY id DESC LIMIT 50').all());
    if (m === 'POST') {
      if (limited(req, 'guest', 3, 10 * 60e3)) return send(res, 429, { error: 'rate_limited' });
      const b = await readJson(req);
      if (b.website) return send(res, 200, { ok: true });
      const name = clean(b.name, 60), message = clean(b.message, 400);
      if (!name || message.length < 2) return send(res, 400, { error: 'invalid' });
      const info = db.prepare('INSERT INTO guestbook(name,message,created) VALUES(?,?,?)').run(name, message, Date.now());
      return send(res, 201, { id: Number(info.lastInsertRowid), name, message, created: Date.now() });
    }
  }

  // ---- admin ----
  if (m === 'POST' && p === '/api/admin/login') {
    if (limited(req, 'login', 5, 10 * 60e3)) return send(res, 429, { error: 'rate_limited' });
    const b = await readJson(req);
    if (!ADMIN_PW) return send(res, 503, { error: 'admin_disabled' });
    const ok = crypto.timingSafeEqual(Buffer.from(sha(b.password)), Buffer.from(sha(ADMIN_PW)));
    return ok ? send(res, 200, { token: makeToken() }) : send(res, 401, { error: 'wrong_password' });
  }
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
    if (m === 'GET' && p === '/api/admin/overview') return send(res, 200, {
      visits: counter('visits'),
      messages: db.prepare('SELECT * FROM messages ORDER BY id DESC').all(),
      guestbook: db.prepare('SELECT * FROM guestbook ORDER BY id DESC').all(),
      projects: db.prepare('SELECT * FROM projects ORDER BY created').all()
    });
    if (m === 'POST' && p === '/api/admin/projects') {
      const f = projectFields(await readJson(req));
      if (!f[0]) return send(res, 400, { error: 'title_required' });
      const info = db.prepare('INSERT INTO projects(title_en,title_ar,desc_en,desc_ar,tags,category,link,created) VALUES(?,?,?,?,?,?,?,?)').run(...f, Date.now());
      return send(res, 201, { id: Number(info.lastInsertRowid) });
    }
    if ((r = p.match(/^\/api\/admin\/(messages|guestbook|projects)\/(\d+)$/))) {
      const table = r[1], id = Number(r[2]);
      if (m === 'DELETE') { db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id); return send(res, 200, { ok: true }); }
      if (m === 'PUT' && table === 'projects') {
        const f = projectFields(await readJson(req));
        if (!f[0]) return send(res, 400, { error: 'title_required' });
        db.prepare('UPDATE projects SET title_en=?,title_ar=?,desc_en=?,desc_ar=?,tags=?,category=?,link=? WHERE id=?').run(...f, id);
        return send(res, 200, { ok: true });
      }
    }
  }
  send(res, 404, { error: 'not_found' });
}

// ---- static files ----
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/admin') rel = '/admin.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else { res.writeHead(405); res.end(); }
  } catch (e) {
    if (!res.headersSent) send(res, e.code === 413 || e.code === 400 ? e.code : 500, { error: e.code ? e.message : 'server_error' });
    if (!e.code) console.error(e);
  }
}).listen(PORT, () => {
  console.log(`Portfolio running on http://localhost:${PORT}`);
  if (!ADMIN_PW) console.log('NOTE: ADMIN_PASSWORD is not set, so the admin panel is disabled.');
});
