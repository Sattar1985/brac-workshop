/* شاشة العرض الكبيرة */
(function () {
  const $ = (id) => document.getElementById(id);
  const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
  $('emblem').innerHTML = EMBLEM;

  let state = null;
  let builtKey = '';     // مفتاح بنية النتائج الحالية
  let qrFor = '';
  let lastCount = 0;

  connectEvents('/api/events?role=screen', (s) => { state = s; render(); }, (ok) => { $('offline').hidden = ok; });

  /* رابط المشاركة الذي يُحوَّل إلى باركود */
  function participantUrl() {
    const cfg = (state.config.baseUrl || '').trim();
    if (cfg) return cfg.replace(/\/+$/, '') + '/';
    const h = location.hostname;
    if ((h === 'localhost' || h === '127.0.0.1' || h === '[::1]') && state.urls && state.urls[0]) return state.urls[0];
    return location.origin + '/';
  }

  function drawQR() {
    const url = participantUrl();
    if (url === qrFor) return;
    qrFor = url;
    const svg = qrSvg(url);
    $('qrBig').innerHTML = svg;
    $('qrSmall').innerHTML = svg;
    const shown = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    $('urlBig').textContent = shown;
    $('urlSmall').textContent = shown;
  }

  function render() {
    const c = state.config;
    $('title').textContent = c.title;
    $('subtitle').textContent = c.subtitle;
    $('venue').textContent = c.venue || '';
    $('sJoined').textContent = fmtNum(state.joined);
    $('sOnline').textContent = fmtNum(state.online);
    drawQR();

    const q = state.active;
    const main = $('main');
    main.className = q ? 'live' : 'idle';
    if (!q) { builtKey = ''; return; }

    $('qType').textContent = TYPE_LABEL[q.type] + (q.type === 'choice' && q.multi ? ' (أكثر من إجابة)' : '');
    const st = $('qStatus');
    st.textContent = q.open ? 'الاستقبال مفتوح' : 'تم إغلاق الاستقبال';
    st.classList.toggle('closed', !q.open);
    const qt = $('qText');
    qt.textContent = q.text;
    qt.classList.toggle('long', q.text.length > 90);

    const r = state.results || { total: 0 };
    const cnt = $('cnt');
    cnt.textContent = fmtNum(r.total);
    if (r.total !== lastCount) { cnt.classList.add('bump'); setTimeout(() => cnt.classList.remove('bump'), 250); lastCount = r.total; }

    renderResults(q, r);
  }

  function ensure(key, build) {
    if (builtKey !== key) { builtKey = key; $('results').innerHTML = ''; build($('results')); }
  }

  function renderResults(q, r) {
    if (r.hidden) {
      ensure('hidden', (box) => { box.innerHTML = '<div class="waiting hide-state"><b id="hb">0</b><span>إجابة وصلت</span><span>ستظهر النتائج عند الإعلان عنها</span></div>'; });
      $('hb').textContent = fmtNum(r.total);
      return;
    }
    if (q.type === 'choice') return renderBars(q, r);
    if (q.type === 'tf') return renderTF(q, r);
    if (q.type === 'word') return renderCloud(q, r);
    return renderNotes(q, r);
  }

  const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

  function renderBars(q, r) {
    ensure('bars:' + q.id + ':' + q.options.join('|'), (box) => {
      box.innerHTML = '<div class="bars">' + q.options.map((o, i) =>
        `<div class="bar" data-i="${i}" style="--c:${COLORS[i % COLORS.length]}"><div class="lab"><span>${esc(o)}</span><b><span class="pc">0%</span><small class="v">0</small></b></div><div class="track"><div class="fill"></div></div></div>`).join('') + '</div>';
    });
    const total = r.counts.reduce((a, b) => a + b, 0);
    const base = q.multi ? r.total : total;       // النسبة من عدد المشاركين في الاختيار المتعدد
    const max = Math.max(...r.counts);
    document.querySelectorAll('#results .bar').forEach((el) => {
      const i = +el.dataset.i, n = r.counts[i];
      el.querySelector('.v').textContent = fmtNum(n);
      el.querySelector('.pc').textContent = pct(n, base) + '%';
      el.querySelector('.fill').style.width = (base ? (n / base) * 100 : 0) + '%';
      el.classList.toggle('lead', max > 0 && n === max);
    });
  }

  function renderTF(q, r) {
    ensure('tf:' + q.id, (box) => {
      const ic = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
      box.innerHTML = `<div class="tfwrap">
        <div class="tfcard yes"><div class="fillbg"></div>${ic('M4 12.5l5.5 5.5L20 6.5')}<div class="big">صح</div><div class="pct">0%</div><div class="n">0</div></div>
        <div class="tfcard no"><div class="fillbg"></div>${ic('M6 6l12 12M18 6L6 18')}<div class="big">خطأ</div><div class="pct">0%</div><div class="n">0</div></div></div>`;
    });
    const total = r.counts[0] + r.counts[1];
    document.querySelectorAll('#results .tfcard').forEach((el, i) => {
      const n = r.counts[i], p = pct(n, total);
      el.querySelector('.pct').textContent = p + '%';
      el.querySelector('.n').textContent = fmtNum(n) + ' إجابة';
      el.querySelector('.fillbg').style.height = p + '%';
      el.classList.toggle('lead', total > 0 && n === Math.max(r.counts[0], r.counts[1]) && r.counts[0] !== r.counts[1]);
    });
  }

  function renderCloud(q, r) {
    ensure('cloud:' + q.id, (box) => { box.innerHTML = '<div class="cloud" id="cloud"></div>'; });
    const cloud = $('cloud');
    const words = r.words || [];
    if (!words.length) {
      cloud.innerHTML = '<div class="waiting"><span>بانتظار الكلمات الأولى…</span></div>';
      return;
    }
    const empty = cloud.querySelector('.waiting');
    if (empty) empty.remove();

    const max = words[0].n, min = words[words.length - 1].n;
    const count = words.length;
    const top = count <= 6 ? 7.2 : count <= 15 ? 5.8 : count <= 35 ? 4.4 : 3.4;
    const low = count <= 15 ? 2.2 : count <= 35 ? 1.7 : 1.3;
    const existing = new Map([...cloud.children].map((el) => [el.dataset.k, el]));
    const keep = new Set();

    // ترتيب شبه عشوائي ثابت ليبدو كسحابة
    const ordered = words.slice().sort((a, b) => hashStr(a.key) - hashStr(b.key));
    ordered.forEach((w, idx) => {
      keep.add(w.key);
      const t = max === min ? 1 : (w.n - min) / (max - min);
      const size = low + (top - low) * Math.pow(t, 0.75);
      let el = existing.get(w.key);
      if (!el) { el = document.createElement('span'); el.className = 'word'; el.dataset.k = w.key; }
      el.textContent = w.w;
      el.style.fontSize = size.toFixed(2) + 'rem';
      el.style.setProperty('--c', COLORS[hashStr(w.key) % COLORS.length]);
      el.style.order = idx;
      if (!el.parentNode) cloud.appendChild(el);
    });
    existing.forEach((el, k) => { if (!keep.has(k)) el.remove(); });
  }

  function renderNotes(q, r) {
    ensure('notes:' + q.id, (box) => { box.innerHTML = '<div class="notes" id="notes"></div>'; });
    const wrap = $('notes');
    const notes = (r.notes || []).slice(0, 60);
    if (!notes.length) {
      wrap.className = 'notes';
      wrap.innerHTML = '<div class="waiting"><span>بانتظار الإجابات الأولى…</span></div>';
      return;
    }
    const empty = wrap.querySelector('.waiting');
    if (empty) empty.remove();
    wrap.className = 'notes ' + (notes.length <= 6 ? 'n-few' : notes.length <= 16 ? 'n-mid' : 'n-many');

    const existing = new Map([...wrap.children].map((el) => [el.dataset.k, el]));
    const keep = new Set();
    let prev = null;
    notes.forEach((n) => {                      // الأحدث أولاً
      keep.add(n.id);
      let el = existing.get(n.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'note';
        el.dataset.k = n.id;
        el.textContent = n.text;
        el.style.setProperty('--c', COLORS[hashStr(n.id) % COLORS.length]);
      } else if (el.textContent !== n.text) el.textContent = n.text;
      const anchor = prev ? prev.nextSibling : wrap.firstChild;
      if (el !== anchor) wrap.insertBefore(el, anchor);
      prev = el;
    });
    existing.forEach((el, k) => { if (!keep.has(k)) el.remove(); });
  }
})();
