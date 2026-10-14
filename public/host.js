/* لوحة تحكم المقدّم */
(function () {
  const $ = (id) => document.getElementById(id);
  const safe = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
  };
  $('gEmb').innerHTML = EMBLEM;
  $('hEmb').innerHTML = EMBLEM;

  let pin = safe.get('brac_pin') || '';
  let state = null;
  let editId = null;       // السؤال قيد التعديل
  let qType = 'choice';

  /* ---------------------- الدخول ---------------------- */
  const act = (body) => postJson('/api/host', body, { 'x-pin': pin });
  async function tryLogin(p) {
    pin = p;
    try { await act({ action: 'ping' }); } catch (e) { pin = ''; throw e; }
    safe.set('brac_pin', pin);
    $('gate').hidden = true;
    $('app').hidden = false;
    $('btnCsv').href = '/api/export.csv?pin=' + encodeURIComponent(pin);
    connectEvents('/api/events?role=host&pin=' + encodeURIComponent(pin), (s) => { state = s; render(); });
  }
  $('gateForm').onsubmit = async (e) => {
    e.preventDefault();
    $('gerr').hidden = true;
    try { await tryLogin($('pin').value.trim()); } catch (err) { $('gerr').textContent = err.message; $('gerr').hidden = false; }
  };
  if (pin) tryLogin(pin).catch(() => { safe.del('brac_pin'); });

  /* ---------------------- أدوات ---------------------- */
  let toastT;
  function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2400);
  }
  async function run(body, okMsg) {
    try { const r = await act(body); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); throw e; }
  }

  /* ---------------------- العرض ---------------------- */
  function render() {
    $('hTitle').textContent = state.config.title;
    $('hOnline').textContent = fmtNum(state.online);
    $('hJoined').textContent = fmtNum(state.joined);
    renderLive();
    renderList();
  }

  function renderLive() {
    const q = state.questions.find((x) => x.id === state.activeId);
    $('liveEmpty').hidden = !!q;
    $('liveBox').hidden = !q;
    if (!q) return;
    const r = state.results || { total: 0 };
    $('lTag').textContent = TYPE_LABEL[q.type];
    const st = $('lState');
    st.textContent = q.open ? 'الاستقبال مفتوح' : 'الاستقبال مغلق';
    st.classList.toggle('closed', !q.open);
    $('lText').textContent = q.text;
    $('lCount').textContent = fmtNum(r.total);
    $('bOpen').textContent = q.open ? '⏸ إيقاف استقبال الإجابات' : '▶ فتح استقبال الإجابات';
    $('bOpen').classList.toggle('on', !q.open);
    $('bShow').textContent = q.showResults ? '🙈 إخفاء النتائج عن الشاشة' : '👁 إظهار النتائج على الشاشة';
    $('bShow').classList.toggle('on', !q.showResults);
    const idx = state.questions.findIndex((x) => x.id === q.id);
    $('bNext').textContent = idx < state.questions.length - 1 ? '⏭ السؤال التالي' : '⏭ إنهاء الأسئلة';

    $('bOpen').onclick = () => run({ action: 'setOpen', id: q.id, value: !q.open });
    $('bShow').onclick = () => run({ action: 'setShow', id: q.id, value: !q.showResults });
    $('bNext').onclick = () => run({ action: 'next' });
    $('bStop').onclick = () => run({ action: 'activate', id: null });
    $('bClear').onclick = () => { if (confirm('حذف جميع إجابات هذا السؤال؟')) run({ action: 'clearAnswers', id: q.id }, 'تم مسح الإجابات'); };

    renderMod(q, r);
  }

  function renderMod(q, r) {
    const box = $('mod');
    if (q.type === 'text') {
      const notes = r.notes || [];
      box.innerHTML = '<h3>مراجعة الإجابات (يمكنك إخفاء أي إجابة غير مناسبة عن الشاشة)</h3>' +
        (notes.length ? notes.map((n) => `<div class="mrow ${n.hidden ? 'hid' : ''}"><span>${esc(n.text)}</span><button data-a="${n.id}" data-h="${n.hidden ? 0 : 1}">${n.hidden ? 'إظهار' : 'إخفاء'}</button></div>`).join('') : '<p class="note">لم تصل إجابات بعد.</p>');
      box.querySelectorAll('button').forEach((b) => b.onclick = () => run({ action: 'hideAnswer', qid: q.id, aid: b.dataset.a, value: b.dataset.h === '1' }));
    } else if (q.type === 'word') {
      const words = r.words || [];
      box.innerHTML = '<h3>الكلمات الواردة (اضغط ✕ لإخفاء كلمة عن الشاشة)</h3>' +
        (words.length ? '<div class="wchips">' + words.map((w) => `<span class="wchip ${w.hidden ? 'hid' : ''}">${esc(w.w)} <em>×${w.n}</em><button data-k="${esc(w.key)}" data-h="${w.hidden ? 0 : 1}" title="${w.hidden ? 'إظهار' : 'إخفاء'}">${w.hidden ? '↺' : '✕'}</button></span>`).join('') + '</div>' : '<p class="note">لم تصل كلمات بعد.</p>');
      box.querySelectorAll('button').forEach((b) => b.onclick = () => run({ action: 'hideWord', qid: q.id, key: b.dataset.k, value: b.dataset.h === '1' }));
    } else {
      const labels = q.type === 'tf' ? ['صح', 'خطأ'] : q.options;
      const counts = r.counts || [];
      box.innerHTML = '<h3>ملخص النتائج</h3>' + (counts.length ? '<div class="mini">' + labels.map((l, i) => `<div><span>${esc(l)}</span><b>${fmtNum(counts[i] || 0)}</b></div>`).join('') + '</div>' : '<p class="note">النتائج مخفية عن الشاشة، ويمكنك إظهارها بالزر أعلاه.</p>');
    }
  }

  function renderList() {
    const list = $('qlist');
    $('qempty').hidden = state.questions.length > 0;
    list.innerHTML = state.questions.map((q, i) => {
      const active = q.id === state.activeId;
      const extra = q.type === 'choice' ? ` · ${q.options.length} خيارات${q.multi ? ' (متعدد)' : ''}` : q.type === 'word' ? ` · حتى ${q.maxWords} كلمات` : '';
      return `<div class="qcard ${active ? 'active' : ''}" data-id="${q.id}">
        <div class="qno">${i + 1}</div>
        <div class="qbody"><b>${esc(q.text)}</b><small><span class="tg">${TYPE_LABEL[q.type]}</span>${fmtNum(q.count)} إجابة${extra}</small></div>
        <div class="qacts">
          ${active ? '<button class="btn on" disabled>✓ معروض الآن</button>' : '<button class="btn primary" data-a="show">▶ عرض على الشاشة</button>'}
          <button class="btn" data-a="edit">✎ تعديل</button>
          <button class="btn" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn" data-a="down" ${i === state.questions.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn warn" data-a="del">🗑 حذف</button>
        </div></div>`;
    }).join('');
  }

  $('qlist').onclick = (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const id = b.closest('.qcard').dataset.id;
    const a = b.dataset.a;
    if (a === 'show') run({ action: 'activate', id });
    else if (a === 'edit') openQ(state.questions.find((q) => q.id === id));
    else if (a === 'up') run({ action: 'move', id, dir: -1 });
    else if (a === 'down') run({ action: 'move', id, dir: 1 });
    else if (a === 'del') { if (confirm('حذف هذا السؤال وإجاباته نهائياً؟')) run({ action: 'deleteQuestion', id }, 'تم الحذف'); }
  };

  /* ---------------------- نافذة السؤال ---------------------- */
  const dlgQ = $('dlgQ');
  function setType(t) {
    qType = t;
    document.querySelectorAll('#dqTypes button').forEach((b) => b.classList.toggle('sel', b.dataset.t === t));
    $('dqChoice').hidden = t !== 'choice';
    $('dqWord').hidden = t !== 'word';
  }
  document.querySelectorAll('#dqTypes button').forEach((b) => b.onclick = () => { if (!editId) setType(b.dataset.t); });

  function addOptRow(val) {
    const rows = $('dqOpts');
    if (rows.children.length >= 8) return;
    const d = document.createElement('div');
    d.className = 'orow';
    d.innerHTML = `<input maxlength="120" placeholder="الخيار ${rows.children.length + 1}"><button type="button" title="حذف الخيار">✕</button>`;
    d.querySelector('input').value = val || '';
    d.querySelector('button').onclick = () => { if (rows.children.length > 2) d.remove(); };
    rows.appendChild(d);
  }
  $('dqAddOpt').onclick = () => { addOptRow(''); const ins = $('dqOpts').querySelectorAll('input'); ins[ins.length - 1].focus(); };

  function openQ(q) {
    editId = q ? q.id : null;
    $('dqTitle').textContent = q ? 'تعديل السؤال' : 'سؤال جديد';
    $('dqErr').hidden = true;
    $('dqText').value = q ? q.text : '';
    $('dqOpts').innerHTML = '';
    const opts = q && q.type === 'choice' ? q.options : ['', '', ''];
    opts.forEach((o) => addOptRow(o));
    $('dqMulti').checked = q ? !!q.multi : false;
    $('dqMax').value = q ? q.maxWords : 3;
    setType(q ? q.type : 'choice');
    document.querySelectorAll('#dqTypes button').forEach((b) => (b.disabled = !!q && b.dataset.t !== q.type));
    dlgQ.showModal();
    $('dqText').focus();
  }
  $('btnNew').onclick = () => openQ(null);
  $('dqCancel').onclick = () => dlgQ.close();

  $('formQ').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      action: editId ? 'updateQuestion' : 'addQuestion',
      id: editId, type: qType, text: $('dqText').value,
      options: [...$('dqOpts').querySelectorAll('input')].map((i) => i.value),
      multi: $('dqMulti').checked, maxWords: +$('dqMax').value,
    };
    try {
      const r = await act(body);
      dlgQ.close();
      toast(editId ? 'تم تحديث السؤال' : 'تمت إضافة السؤال');
      if (!editId && r.id && !state.activeId && confirm('هل تريد عرض هذا السؤال على الشاشة الآن؟')) run({ action: 'activate', id: r.id });
    } catch (err) { $('dqErr').textContent = err.message; $('dqErr').hidden = false; }
  };

  /* ---------------------- الإعدادات ---------------------- */
  const dlgS = $('dlgS');
  $('btnSettings').onclick = () => {
    const c = state.config;
    $('sTitle').value = c.title; $('sSub').value = c.subtitle; $('sVenue').value = c.venue || ''; $('sUrl').value = c.baseUrl || '';
    $('sErr').hidden = true;
    $('sUrls').innerHTML = (state.urls || []).map((u) => `<button type="button" data-u="${esc(u)}">${esc(u)}</button>`).join('');
    $('sUrls').querySelectorAll('button').forEach((b) => b.onclick = () => { $('sUrl').value = b.dataset.u; });
    dlgS.showModal();
  };
  $('sCancel').onclick = () => dlgS.close();
  $('formS').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await act({ action: 'setConfig', title: $('sTitle').value, subtitle: $('sSub').value, venue: $('sVenue').value, baseUrl: $('sUrl').value });
      dlgS.close(); toast('تم حفظ الإعدادات');
    } catch (err) { $('sErr').textContent = err.message; $('sErr').hidden = false; }
  };
  $('sSamples').onclick = () => { run({ action: 'loadSamples' }, 'تمت إضافة الأسئلة النموذجية'); dlgS.close(); };
  $('sResetAns').onclick = () => { if (confirm('حذف جميع الإجابات لكل الأسئلة؟ لا يمكن التراجع.')) { run({ action: 'resetAnswers' }, 'تم حذف الإجابات'); dlgS.close(); } };
  $('sResetAll').onclick = () => { if (confirm('حذف كل الأسئلة والإجابات؟ لا يمكن التراجع.')) { run({ action: 'resetAll' }, 'تمت إعادة الضبط'); dlgS.close(); } };
})();
