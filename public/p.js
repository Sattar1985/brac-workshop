/* صفحة المشارك — لا تطلب أي بيانات شخصية */
(function () {
  const $ = (id) => document.getElementById(id);
  const view = $('view');
  $('logo').innerHTML = EMBLEM;

  // معرّف مجهول عشوائي محفوظ في الهاتف فقط (لمنع تكرار الإجابة)
  const safeLS = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } },
  };
  let pid = safeLS.get('brac_pid');
  if (!pid) {
    pid = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    safeLS.set('brac_pid', pid);
  }

  const ICON = {
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    yes: '<svg viewBox="0 0 24 24"><path d="M4 12.5l5.5 5.5L20 6.5"/></svg>',
    no: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    hourglass: '<svg viewBox="0 0 24 24"><path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/></svg>',
  };

  let state = null;        // آخر حالة من الخادم
  let rendered = '';       // مفتاح آخر عرض لتجنب إعادة الرسم
  let editing = false;     // وضع تعديل الإجابة
  let draft = null;        // الإجابة المختارة حالياً

  const ansKey = (qid) => 'brac_ans_' + qid;
  const getMine = (qid) => { const v = safeLS.get(ansKey(qid)); try { return v ? JSON.parse(v) : null; } catch (_) { return null; } };

  /* ---------------------- الاتصال ---------------------- */
  connectEvents('/api/events?role=p&pid=' + encodeURIComponent(pid), (s) => {
    state = s;
    $('wTitle').textContent = s.config.title;
    $('wSub').textContent = s.config.subtitle;
    render();
  }, (ok) => $('net').classList.toggle('off', !ok));

  /* ---------------------- العرض ---------------------- */
  function render() {
    const q = state && state.active;
    const mine = q ? getMine(q.id) : null;
    const mode = !q ? 'wait' : (mine && !editing) ? 'done' : !q.open ? 'closed' : 'form';
    const key = [q ? q.id : '-', mode, q ? q.open : '', q ? q.text : '', q ? q.options.join('|') : ''].join('#');
    if (key === rendered) return;
    rendered = key;

    if (mode === 'wait') return showWait();
    if (mode === 'closed') return showClosed();
    if (mode === 'done') return showDone(q, mine);
    showForm(q, mine);
  }

  function showWait() {
    editing = false; draft = null;
    view.innerHTML = `<div class="card wait"><div class="pulse">${ICON.hourglass}</div>
      <h2>بانتظار السؤال التالي…</h2><p>ستظهر الأسئلة هنا تلقائياً، لا حاجة لتحديث الصفحة.</p></div>`;
  }

  function showClosed() {
    view.innerHTML = `<div class="card done closed"><div class="tick">${ICON.hourglass.replace('<svg', '<svg').replace('stroke-width', 'stroke-width')}</div>
      <h2>أُغلق استقبال الإجابات</h2><p>انتظر السؤال التالي على الشاشة.</p></div>`;
  }

  function mineText(q, mine) {
    if (q.type === 'choice') return mine.map((i) => q.options[i]).filter(Boolean).join(' • ');
    if (q.type === 'tf') return mine === 'true' ? 'صح' : 'خطأ';
    if (q.type === 'word') return mine.join(' • ');
    return mine;
  }

  function showDone(q, mine) {
    view.innerHTML = `<div class="card done"><div class="tick">${ICON.check}</div>
      <h2>تم استلام إجابتك</h2><p>شكراً لمشاركتك، تابع النتائج على الشاشة الكبيرة.</p>
      <div class="mine">${esc(mineText(q, mine))}</div>
      ${q.open ? '<button class="linkbtn" id="edit">تعديل إجابتي</button>' : ''}</div>`;
    const b = $('edit');
    if (b) b.onclick = () => { editing = true; draft = mine; rendered = ''; render(); };
  }

  function showForm(q, mine) {
    draft = mine !== null && mine !== undefined ? mine : (q.type === 'choice' ? [] : q.type === 'word' ? [''] : '');
    const labels = { choice: q.multi ? 'اختر أكثر من إجابة' : 'اختر إجابة واحدة', tf: 'صح أو خطأ', word: 'اكتب كلمة', text: 'اكتب إجابتك' };
    let body = '';

    if (q.type === 'choice') {
      body = '<div class="opts">' + q.options.map((o, i) =>
        `<button type="button" class="opt ${q.multi ? 'multi' : ''}" data-i="${i}"><span class="mark">${ICON.check}</span><span>${esc(o)}</span></button>`).join('') + '</div>';
    } else if (q.type === 'tf') {
      body = `<div class="tf">
        <button type="button" class="tfbtn yes" data-v="true">${ICON.yes}<span>صح</span></button>
        <button type="button" class="tfbtn no" data-v="false">${ICON.no}<span>خطأ</span></button></div>`;
    } else if (q.type === 'word') {
      body = `<div class="words" id="words"></div>${q.maxWords > 1 ? '<button type="button" class="addw" id="addw">+ إضافة كلمة أخرى</button>' : ''}`;
    } else {
      body = `<textarea class="field" id="txt" maxlength="400" placeholder="اكتب هنا…"></textarea><div class="counter"><span id="cnt">0</span> / 400</div>`;
    }

    view.innerHTML = `<div class="card"><span class="qtype">${TYPE_LABEL[q.type]}</span>
      <h1 class="qtext">${esc(q.text)}</h1>
      ${q.type === 'word' && q.maxWords > 1 ? `<p class="hint">يمكنك كتابة حتى ${q.maxWords} كلمات</p>` : ''}
      ${q.type === 'choice' ? `<p class="hint">${labels.choice}</p>` : ''}
      ${body}
      <div id="err" class="err" hidden></div>
      <button class="send" id="send" disabled>إرسال الإجابة</button></div>`;

    const send = $('send');
    const refresh = () => { send.disabled = !valid(q); };

    if (q.type === 'choice') {
      const btns = [...view.querySelectorAll('.opt')];
      const paint = () => btns.forEach((b) => b.classList.toggle('sel', draft.includes(+b.dataset.i)));
      btns.forEach((b) => b.onclick = () => {
        const i = +b.dataset.i;
        if (q.multi) draft = draft.includes(i) ? draft.filter((x) => x !== i) : [...draft, i];
        else draft = [i];
        paint(); refresh();
      });
      paint();
    } else if (q.type === 'tf') {
      const btns = [...view.querySelectorAll('.tfbtn')];
      const paint = () => btns.forEach((b) => b.classList.toggle('sel', b.dataset.v === draft));
      btns.forEach((b) => b.onclick = () => { draft = b.dataset.v; paint(); refresh(); });
      paint();
    } else if (q.type === 'word') {
      const box = $('words');
      const addInput = (val) => {
        const inp = document.createElement('input');
        inp.className = 'field'; inp.maxLength = 30; inp.placeholder = 'اكتب كلمة…'; inp.value = val || '';
        inp.autocomplete = 'off';
        inp.oninput = () => { draft = [...box.querySelectorAll('input')].map((i) => i.value); refresh(); };
        box.appendChild(inp);
        return inp;
      };
      (Array.isArray(draft) && draft.length ? draft : ['']).forEach((w) => addInput(w));
      draft = [...box.querySelectorAll('input')].map((i) => i.value);
      const add = $('addw');
      if (add) add.onclick = () => {
        if (box.children.length < q.maxWords) addInput('').focus();
        if (box.children.length >= q.maxWords) add.hidden = true;
      };
      if (add && box.children.length >= q.maxWords) add.hidden = true;
    } else {
      const t = $('txt');
      t.value = draft || '';
      $('cnt').textContent = t.value.length;
      t.oninput = () => { draft = t.value; $('cnt').textContent = t.value.length; refresh(); };
    }
    refresh();

    send.onclick = async () => {
      send.disabled = true;
      send.textContent = 'جارٍ الإرسال…';
      const err = $('err'); err.hidden = true;
      try {
        let value = draft;
        if (q.type === 'word') value = draft.map((w) => w.trim()).filter(Boolean);
        if (q.type === 'text') value = draft.trim();
        await postJson('/api/answer', { pid, qid: q.id, value });
        safeLS.set(ansKey(q.id), JSON.stringify(value));
        if (navigator.vibrate) navigator.vibrate(40);
        editing = false; rendered = ''; render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        err.textContent = e.message || 'تعذّر الإرسال، حاول مرة أخرى';
        err.hidden = false;
        send.disabled = false;
        send.textContent = 'إرسال الإجابة';
        if (e.code === 'closed' || e.code === 'inactive') { rendered = ''; }
      }
    };
  }

  function valid(q) {
    if (q.type === 'choice') return Array.isArray(draft) && draft.length > 0;
    if (q.type === 'tf') return draft === 'true' || draft === 'false';
    if (q.type === 'word') return Array.isArray(draft) && draft.some((w) => w.trim());
    return typeof draft === 'string' && draft.trim().length > 0;
  }
})();
