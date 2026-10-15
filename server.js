'use strict';
/**
 * خادم التفاعل المباشر لورشة BRAC
 * - بدون أي مكتبات خارجية (Node.js فقط)
 * - تحديث لحظي عبر Server-Sent Events
 * - حفظ تلقائي في data.json
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const PIN = String(process.env.PIN || '2026');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUB = path.join(__dirname, 'public');

const TYPES = ['choice', 'tf', 'word', 'text'];
const TYPE_AR = { choice: 'اختيار من متعدد', tf: 'صح / خطأ', word: 'كلمة', text: 'نص' };
const uid = (n = 5) => crypto.randomBytes(n).toString('hex');

/* ------------------------------------------------------------------ */
/* الحالة                                                              */
/* ------------------------------------------------------------------ */
function samples() {
  const mk = (o) => Object.assign({ id: uid(), options: [], multi: false, maxWords: 3, open: true, showResults: true, hiddenWords: [], createdAt: Date.now() }, o);
  return [
    mk({ type: 'word', text: 'اذكر كلمة تصف أبرز أثر للتغير المناخي على الزراعة في محافظتك', maxWords: 3 }),
    mk({ type: 'choice', text: 'ما أكثر المخاطر المناخية تأثيراً على الإنتاج الزراعي في محافظتك؟', multi: false,
      options: ['شحّ المياه وانخفاض الإطلاقات', 'ملوحة التربة والمياه', 'ارتفاع درجات الحرارة', 'العواصف الغبارية', 'التصحر وتدهور الأراضي'] }),
    mk({ type: 'tf', text: 'اعتماد أنظمة الري الحديثة (التنقيط والرش) يقلل استهلاك المياه في الزراعة' }),
    mk({ type: 'text', text: 'ما الإجراء التكيفي الذي تقترح إدراجه بالأولوية في خطة التكيف المحلية لمحافظتك؟' }),
  ];
}

function freshState() {
  return {
    config: {
      title: 'ورشة إعداد خطة التكيف المحلية',
      subtitle: 'محافظتا ذي قار والقادسية · مشروع بناء مرونة القطاع الزراعي (BRAC)',
      venue: 'البصرة · 17 – 18 تشرين الأول 2026',
      baseUrl: '',
    },
    questions: samples(),
    activeId: null,
    answers: {},
    seen: {},
  };
}

let state = freshState();
try {
  if (fs.existsSync(DATA_FILE)) {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    state = Object.assign(freshState(), saved);
    state.config = Object.assign(freshState().config, saved.config || {});
  }
} catch (e) {
  console.error('تعذّر قراءة data.json، سيتم البدء ببيانات جديدة:', e.message);
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('فشل الحفظ:', e.message);
  }
}

/* ------------------------------------------------------------------ */
/* أدوات                                                               */
/* ------------------------------------------------------------------ */
const clean = (s, max) =>
  String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F‎‏‪-‮]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

const normWord = (s) => {
  let k = s.normalize('NFKC').replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();
  // توحيد "الملوحة" و"ملوحة" في نفس الكلمة
  if (k.startsWith('ال') && k.length >= 5 && !k.includes(' ')) k = k.slice(2);
  return k;
};

function lanUrls() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b)).map((ip) => `http://${ip}:${PORT}/`);
}

const getQ = (id) => state.questions.find((q) => q.id === id);

/* ------------------------------------------------------------------ */
/* النتائج                                                             */
/* ------------------------------------------------------------------ */
function results(q, forHost) {
  const entries = Object.values(state.answers[q.id] || {});
  const out = { total: entries.length };
  if (q.type === 'choice') {
    out.counts = q.options.map(() => 0);
    entries.forEach((a) => (a.value || []).forEach((i) => { if (out.counts[i] !== undefined) out.counts[i]++; }));
  } else if (q.type === 'tf') {
    out.counts = [0, 0];
    entries.forEach((a) => { if (a.value === 'true') out.counts[0]++; else if (a.value === 'false') out.counts[1]++; });
  } else if (q.type === 'word') {
    const map = new Map();
    entries.forEach((a) => {
      const seen = new Set();
      (a.value || []).forEach((w) => {
        const k = normWord(w);
        if (!k || seen.has(k)) return;
        seen.add(k);
        const m = map.get(k) || { key: k, n: 0, forms: {} };
        m.n++;
        m.forms[w] = (m.forms[w] || 0) + 1;
        map.set(k, m);
      });
    });
    const hidden = new Set(q.hiddenWords || []);
    out.words = [...map.values()]
      .map((m) => ({ key: m.key, w: Object.entries(m.forms).sort((a, b) => b[1] - a[1])[0][0], n: m.n, hidden: hidden.has(m.key) }))
      .filter((x) => forHost || !x.hidden)
      .sort((a, b) => b.n - a.n);
  } else if (q.type === 'text') {
    out.notes = Object.values(state.answers[q.id] || {})
      .filter((a) => forHost || !a.hidden)
      .sort((a, b) => b.ts - a.ts)
      .map((a) => ({ id: a.id, text: a.value, ts: a.ts, hidden: !!a.hidden }));
  }
  return out;
}

const pubQ = (q) => ({ id: q.id, type: q.type, text: q.text, options: q.options, multi: q.multi, maxWords: q.maxWords, open: q.open });

/* ------------------------------------------------------------------ */
/* البث اللحظي (SSE)                                                   */
/* ------------------------------------------------------------------ */
const clients = new Set();

function payload(role) {
  const q = getQ(state.activeId) || null;
  const online = new Set([...clients].filter((c) => c.role === 'p').map((c) => c.pid)).size;
  const p = {
    config: state.config,
    online,
    joined: Object.keys(state.seen).length,
    active: q ? pubQ(q) : null,
  };
  if (role === 'p') return p;
  p.urls = lanUrls();
  if (q) {
    const total = Object.keys(state.answers[q.id] || {}).length;
    p.showResults = q.showResults;
    p.results = role === 'host' || q.showResults ? results(q, role === 'host') : { total, hidden: true };
  }
  if (role === 'host') {
    p.questions = state.questions.map((x) => Object.assign({}, x, { count: Object.keys(state.answers[x.id] || {}).length }));
    p.activeId = state.activeId;
  }
  return p;
}

function sendAll() {
  const cache = {};
  for (const c of clients) {
    const data = (cache[c.role] = cache[c.role] || JSON.stringify(payload(c.role)));
    try { c.res.write('data: ' + data + '\n\n'); } catch (_) { /* ignore */ }
  }
}

let pendingBroadcast = false;
function changed() {
  save();
  if (pendingBroadcast) return;
  pendingBroadcast = true;
  setTimeout(() => { pendingBroadcast = false; sendAll(); }, 180);
}

setInterval(() => { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch (_) { /* ignore */ } } }, 20000);

/* ------------------------------------------------------------------ */
/* إجراءات المقدّم                                                     */
/* ------------------------------------------------------------------ */
function parseQuestion(b) {
  const type = TYPES.includes(b.type) ? b.type : null;
  if (!type) throw new Error('نوع السؤال غير صحيح');
  const text = clean(b.text, 300);
  if (!text) throw new Error('نص السؤال مطلوب');
  const q = { type, text, options: [], multi: false, maxWords: 3 };
  if (type === 'choice') {
    q.options = (Array.isArray(b.options) ? b.options : []).map((o) => clean(o, 120)).filter(Boolean).slice(0, 8);
    if (q.options.length < 2) throw new Error('أضف خيارين على الأقل');
    q.multi = !!b.multi;
  }
  if (type === 'word') q.maxWords = Math.min(5, Math.max(1, parseInt(b.maxWords, 10) || 3));
  return q;
}

function hostAction(b) {
  switch (b.action) {
    case 'ping':
      return;
    case 'addQuestion': {
      const q = Object.assign({ id: uid(), open: true, showResults: true, hiddenWords: [], createdAt: Date.now() }, parseQuestion(b));
      state.questions.push(q);
      return { id: q.id };
    }
    case 'updateQuestion': {
      const q = getQ(b.id);
      if (!q) throw new Error('السؤال غير موجود');
      const n = parseQuestion(Object.assign({ type: q.type }, b));
      const structural = q.type === 'choice' && (n.options.length !== q.options.length || n.multi !== q.multi);
      Object.assign(q, n);
      if (structural) delete state.answers[q.id];
      return;
    }
    case 'deleteQuestion':
      state.questions = state.questions.filter((q) => q.id !== b.id);
      delete state.answers[b.id];
      if (state.activeId === b.id) state.activeId = null;
      return;
    case 'move': {
      const i = state.questions.findIndex((q) => q.id === b.id);
      const j = i + (b.dir < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= state.questions.length) return;
      [state.questions[i], state.questions[j]] = [state.questions[j], state.questions[i]];
      return;
    }
    case 'activate': {
      if (b.id === null) { state.activeId = null; return; }
      const q = getQ(b.id);
      if (!q) throw new Error('السؤال غير موجود');
      state.activeId = q.id;
      q.open = true;
      return;
    }
    case 'next': {
      const i = state.questions.findIndex((q) => q.id === state.activeId);
      const q = state.questions[i + 1];
      if (!q) { state.activeId = null; return; }
      state.activeId = q.id;
      q.open = true;
      return;
    }
    case 'setOpen': { const q = getQ(b.id); if (q) q.open = !!b.value; return; }
    case 'setShow': { const q = getQ(b.id); if (q) q.showResults = !!b.value; return; }
    case 'clearAnswers': delete state.answers[b.id]; return;
    case 'hideAnswer': {
      const a = Object.values(state.answers[b.qid] || {}).find((x) => x.id === b.aid);
      if (a) a.hidden = !!b.value;
      return;
    }
    case 'hideWord': {
      const q = getQ(b.qid);
      if (!q) return;
      const s = new Set(q.hiddenWords || []);
      if (b.value) s.add(b.key); else s.delete(b.key);
      q.hiddenWords = [...s];
      return;
    }
    case 'setConfig': {
      const c = state.config;
      if (b.title !== undefined) c.title = clean(b.title, 120);
      if (b.subtitle !== undefined) c.subtitle = clean(b.subtitle, 200);
      if (b.venue !== undefined) c.venue = clean(b.venue, 120);
      if (b.baseUrl !== undefined) {
        const u = clean(b.baseUrl, 200);
        if (u && !/^https?:\/\//i.test(u)) throw new Error('الرابط يجب أن يبدأ بـ http:// أو https://');
        c.baseUrl = u;
      }
      return;
    }
    case 'resetAnswers': state.answers = {}; state.seen = {}; return;
    case 'resetAll': { const cfg = state.config; state = freshState(); state.config = cfg; state.questions = []; return; }
    case 'loadSamples': state.questions.push(...samples()); return;
    default: throw new Error('إجراء غير معروف');
  }
}

/* ------------------------------------------------------------------ */
/* استقبال إجابات المشاركين                                            */
/* ------------------------------------------------------------------ */
function submitAnswer(b) {
  const pid = clean(b.pid, 40);
  if (!/^[a-zA-Z0-9_-]{6,40}$/.test(pid)) throw new Error('معرّف غير صالح');
  const q = getQ(b.qid);
  if (!q || q.id !== state.activeId) { const e = new Error('هذا السؤال لم يعد معروضاً'); e.code = 'inactive'; throw e; }
  if (!q.open) { const e = new Error('تم إغلاق استقبال الإجابات'); e.code = 'closed'; throw e; }

  let value;
  if (q.type === 'choice') {
    let arr = Array.isArray(b.value) ? b.value : [b.value];
    arr = [...new Set(arr.map((x) => parseInt(x, 10)).filter((x) => x >= 0 && x < q.options.length))];
    if (!arr.length) throw new Error('اختر إجابة');
    if (!q.multi) arr = arr.slice(0, 1);
    value = arr.sort((a, c) => a - c);
  } else if (q.type === 'tf') {
    if (b.value !== 'true' && b.value !== 'false') throw new Error('اختر صح أو خطأ');
    value = b.value;
  } else if (q.type === 'word') {
    const arr = (Array.isArray(b.value) ? b.value : [b.value]).map((w) => clean(w, 30).replace(/\s+/g, ' ')).filter(Boolean).slice(0, q.maxWords);
    if (!arr.length) throw new Error('اكتب كلمة واحدة على الأقل');
    value = arr;
  } else {
    value = clean(b.value, 400);
    if (!value) throw new Error('اكتب إجابتك');
  }

  const bucket = (state.answers[q.id] = state.answers[q.id] || {});
  const prev = bucket[pid];
  if (prev && (prev.edits || 0) >= 20) throw new Error('تجاوزت عدد التعديلات المسموح');
  bucket[pid] = { id: prev ? prev.id : uid(4), value, ts: Date.now(), edits: prev ? (prev.edits || 0) + 1 : 0, hidden: prev ? prev.hidden : false };
  state.seen[pid] = 1;
}

/* ------------------------------------------------------------------ */
/* تصدير CSV                                                           */
/* ------------------------------------------------------------------ */
function exportCsv() {
  const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const fmt = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Baghdad', hour12: false });
  const rows = [['رقم السؤال', 'نوع السؤال', 'نص السؤال', 'الإجابة', 'وقت الإجابة', 'مخفية عن الشاشة']];
  state.questions.forEach((q, i) => {
    Object.values(state.answers[q.id] || {}).sort((a, b) => a.ts - b.ts).forEach((a) => {
      let v = a.value;
      if (q.type === 'choice') v = a.value.map((k) => q.options[k]).join(' | ');
      else if (q.type === 'tf') v = a.value === 'true' ? 'صح' : 'خطأ';
      else if (q.type === 'word') v = a.value.join(' | ');
      rows.push([i + 1, TYPE_AR[q.type], q.text, v, fmt(a.ts), a.hidden ? 'نعم' : '']);
    });
  });
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
const ROUTES = { '/': '/index.html', '/screen': '/screen.html', '/host': '/host.html' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 20000) { reject(new Error('الطلب كبير جداً')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (_) { reject(new Error('بيانات غير صالحة')); } });
  });
}

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    if (p === '/api/events') {
      const role = ['p', 'screen', 'host'].includes(url.searchParams.get('role')) ? url.searchParams.get('role') : 'p';
      if (role === 'host' && url.searchParams.get('pin') !== PIN) return json(res, 401, { error: 'رمز الدخول غير صحيح' });
      const pid = clean(url.searchParams.get('pid') || '', 40);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      const c = { res, role, pid: pid || uid(3) };
      clients.add(c);
      if (role === 'p' && /^[a-zA-Z0-9_-]{6,40}$/.test(pid) && !state.seen[pid]) { state.seen[pid] = 1; save(); }
      res.write('data: ' + JSON.stringify(payload(role)) + '\n\n');
      req.on('close', () => { clients.delete(c); changed(); });
      changed();
      return;
    }

    if (p === '/api/answer' && req.method === 'POST') {
      const b = await readBody(req);
      try { submitAnswer(b); } catch (e) { return json(res, 400, { error: e.message, code: e.code || 'invalid' }); }
      changed();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/host' && req.method === 'POST') {
      if (req.headers['x-pin'] !== PIN) return json(res, 401, { error: 'رمز الدخول غير صحيح' });
      const b = await readBody(req);
      let r;
      try { r = hostAction(b); } catch (e) { return json(res, 400, { error: e.message }); }
      changed();
      return json(res, 200, Object.assign({ ok: true }, r || {}));
    }

    if (p === '/api/export.csv') {
      if (url.searchParams.get('pin') !== PIN) { res.writeHead(401); return res.end('رمز الدخول غير صحيح'); }
      const name = 'brac-workshop-' + new Date().toISOString().slice(0, 10) + '.csv';
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });
      return res.end(exportCsv());
    }

    // ملفات ثابتة
    const rel = ROUTES[p] || p;
    const file = path.normalize(path.join(PUB, rel));
    if (!file.startsWith(PUB + path.sep) && file !== PUB) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('الصفحة غير موجودة'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const urls = lanUrls();
  console.log('\n====================================================');
  console.log('  ورشة BRAC — منصة التفاعل المباشر تعمل الآن');
  console.log('====================================================');
  console.log('  شاشة العرض   : http://localhost:' + PORT + '/screen');
  console.log('  لوحة المقدّم : http://localhost:' + PORT + '/host     (الرمز: ' + PIN + ')');
  if (urls.length) {
    console.log('  رابط المشاركين (للهواتف على نفس الشبكة):');
    urls.forEach((u) => console.log('     ' + u));
  } else {
    console.log('  تنبيه: لم يتم العثور على شبكة. اتصل بشبكة Wi-Fi أو فعّل نقطة الاتصال (Hotspot).');
  }
  console.log('====================================================\n');
});

process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });
