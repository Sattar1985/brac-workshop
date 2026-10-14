/* أدوات مشتركة بين الصفحات الثلاث */
const TYPE_LABEL = { choice: 'اختيار من متعدد', tf: 'صح / خطأ', word: 'كلمة', text: 'نص' };

const EMBLEM = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="30" fill="#0f4d34" stroke="#e2a93b" stroke-width="2"/>
  <path d="M32 50V22" stroke="#e2a93b" stroke-width="2.6" stroke-linecap="round"/>
  <g fill="#e2a93b">
    <ellipse cx="32" cy="15" rx="3" ry="5.2"/>
    <ellipse cx="26" cy="22" rx="2.8" ry="5" transform="rotate(-35 26 22)"/><ellipse cx="38" cy="22" rx="2.8" ry="5" transform="rotate(35 38 22)"/>
    <ellipse cx="25.5" cy="30" rx="2.8" ry="5" transform="rotate(-35 25.5 30)"/><ellipse cx="38.5" cy="30" rx="2.8" ry="5" transform="rotate(35 38.5 30)"/>
  </g>
  <path d="M14 50c6-3 10-3 18 0s12 3 18 0" fill="none" stroke="#6ec3e6" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M16 56c6-3 10-3 16 0s10 3 16 0" fill="none" stroke="#6ec3e6" stroke-width="2" stroke-linecap="round" opacity=".6"/>
</svg>`;

/* باركود (QR) كـ SVG — يعتمد على مكتبة qrcode.js المحلية */
function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const m = 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
  const s = n + m * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="باركود المشاركة"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#0a2a1c"/></svg>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const fmtNum = (n) => Number(n).toLocaleString('en-US');

/* اتصال SSE مع إعادة محاولة تلقائية وإشعار بالحالة */
function connectEvents(url, onData, onStatus) {
  let es;
  function open() {
    es = new EventSource(url);
    es.onopen = () => onStatus && onStatus(true);
    es.onmessage = (e) => { try { onData(JSON.parse(e.data)); } catch (_) { /* ignore */ } };
    es.onerror = () => {
      onStatus && onStatus(false);
      if (es.readyState === 2) { setTimeout(open, 2000); }
    };
  }
  open();
}

async function postJson(url, body, headers) {
  const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch (_) { /* ignore */ }
  if (!r.ok) { const e = new Error(j.error || 'حدث خطأ'); e.code = j.code; e.status = r.status; throw e; }
  return j;
}
