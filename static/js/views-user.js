/* SPDX-License-Identifier: AGPL-3.0-or-later */
'use strict';
(() => {
const { S, html, raw, esc, ico, t, F, $, $$ } = PEP;
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
PEP.ls = { get: lsGet, set: lsSet };

/* ---------- cámara + lector QR (BarcodeDetector) ---------- */
PEP.camera = {
  supported: () => 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia,
  async start(video, onText) {
    if (!this.supported()) throw new Error('no_camera');
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream; await video.play();
    let on = true, last = '';
    const loop = async () => { if (!on) return; try { const r = await det.detect(video); if (r[0] && r[0].rawValue !== last) { last = r[0].rawValue; onText(last); setTimeout(() => last = '', 2500); } } catch (e) { } setTimeout(loop, 300); };
    loop();
    return () => { on = false; stream.getTracks().forEach(x => x.stop()); video.srcObject = null; };
  }
};

/* ---------- As miñas reservas ---------- */
function resCard(r, linkedNames) {
  const f = r.facility;
  return html`<article class="card flat" aria-labelledby="r${r.id}"><div class="row sp"><div><h3 id="r${r.id}" style="margin:0"><a href="#/r/${r.id}" style="color:inherit">${f.name}</a></h3><span>${F.day(r.start)} · ${F.range(r.start, r.end)}</span></div>
    <div class="row">${PEP.statusChip(r)}${r.seasonal ? html`<span class="chip">${t('season')}</span>` : ''}${r.holder && linkedNames ? html`<span class="chip">${r.holder.name}</span>` : ''}</div></div>
    <div class="row mt"><span class="chip">${ico(f.access_mode === 'door' ? 'door' : 'staff')} ${PEP.accessLabel(f.access_mode)}</span><span class="chip">${F.money(r.price)} ${r.price ? (r.paid ? '· ' + t('paid') : '· ' + t('unpaid')) : ''}</span><span class="chip">${t('ch.' + r.channel)}</span>
    <a class="btn sm" style="margin-left:auto" href="#/r/${r.id}">${r.status === 'confirmed' || r.status === 'attended' ? t('open_qr') : t('see')}</a></div></article>`;
}
PEP.route(/^\/mine$/, async () => {
  if (!S.user) { const e = new Error('login_required'); e.status = 401; e.code = 'login_required'; throw e; }
  const tab = PEP.query.tab || 'up';
  let items;
  try {
    const r = await PEP.get('/reservations'); items = r.items;
    lsSet('pep.cache.' + S.tenant + '.list', { user: S.user.id, items });
  } catch (e) {
    if (!e.offline) throw e;
    const c = lsGet('pep.cache.' + S.tenant + '.list'); items = c ? c.items : [];
    PEP.toast(t('offline_cache'), true);
  }
  const now = PEP.nowTs();
  const up = items.filter(r => r.status === 'confirmed' && r.end > now).sort((a, b) => a.start - b.start);
  const hist = items.filter(r => !up.includes(r));
  const lk = new Set(items.map(r => r.holder && r.holder.id)); const multi = lk.size > 1;
  const wl = await PEP.get('/waitlist').catch(() => []);
  const feed = `${location.origin}/api/ical/${S.user.cal_token}.ics?t=${S.tenant}`;
  const list = tab === 'up' ? up : hist;
  return html`
  <h1>${t('nav.mine')}</h1>
  <div class="tabs"><a href="#/mine" ${tab === 'up' ? 'aria-current="page"' : ''}>${t('upcoming')} (${up.length})</a><a href="#/mine?tab=hist" ${tab === 'hist' ? 'aria-current="page"' : ''}>${t('history')}</a></div>
  <div class="grid g2">${list.length ? list.map(r => resCard(r, multi)) : html`<p class="muted">${tab === 'up' ? t('no_upcoming') : t('no_history')} ${tab === 'up' ? html`<a href="#/">${t('book_now')}</a>` : ''}</p>`}</div>
  ${wl.length ? html`<h2 class="mt">${t('waitlist_title')}</h2><ul>${wl.map(w => html`<li>${w.facility} · ${F.dt(w.start)}</li>`)}</ul>` : ''}
  <div class="card flat mt"><h3>${ico('cal')} ${t('cal_sub')}</h3><p class="small">${t('cal_sub_hint')}</p><div class="row"><input readonly value="${feed}" aria-label="${t('cal_sub')}" style="flex:1;min-width:240px" id="feed"><button class="btn sec sm" data-act="copy" data-from="feed">${t('copy')}</button></div></div>`;
});
PEP.actions.copy = async el => { const i = $('#' + el.dataset.from); i.select(); try { await navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand('copy'); } PEP.toast(t('copied')); };

/* ---------- detalle de reserva ---------- */
const PH = ['consult', 'ident', 'book', 'confirm', 'entry', 'use', 'exit', 'close'];
function timeline(r, now) {
  const st = r.status; let done = 3, cur = 4, bad = -1, allBad = false;
  if (st === 'cancelled') { bad = 4; allBad = true; }
  else if (st === 'no_show') { bad = 4; }
  else if (st === 'attended') { if (now >= r.end) { done = 7; cur = -1; } else { done = 4; cur = 5; } }
  else if (now >= r.end) { done = 3; cur = -1; }
  return html`<ol class="timeline" aria-label="${t('track')}" style="list-style:none;padding:0">${PH.map((p, i) => {
    const c = allBad ? (i <= 3 ? 'done' : 'bad') : i === bad ? 'bad' : i <= done ? 'done' : i === cur ? 'now' : '';
    return html`<li class="st ${c}" ${i === cur ? 'aria-current="step"' : ''}>${i + 1}. ${t('ph.' + p)}${c === 'bad' ? ' ✕' : c === 'done' ? ' ✓' : ''}</li>`;
  })}</ol>`;
}

PEP.route(/^\/r\/(\d+)$/, async id => {
  if (!S.user) { const e = new Error('login_required'); e.status = 401; throw e; }
  const key = `pep.cache.${S.tenant}.r${id}`;
  let r, qrd, offline = false;
  try {
    r = await PEP.get('/reservations/' + id);
    if (r.qr) qrd = await PEP.get(`/reservations/${id}/qr`);
    lsSet(key, { r, qrd });
  } catch (e) { if (!e.offline) throw e; const c = lsGet(key); if (!c) throw e; r = c.r; qrd = c.qrd; offline = true; }
  const f = r.facility_full, now = PEP.nowTs();
  const live = r.status === 'confirmed' || r.status === 'attended';
  const door = f.access_mode === 'door';
  if (qrd) localStorage.setItem('pep.lastqr', JSON.stringify({ text: qrd.text, res: r.id, fid: f.id, ts: Date.now() }));
  const mine = (await PEP.get('/me/access').catch(() => [])).filter(a => a.reservation_id === r.id);
  PEP.cleanup = () => { clearInterval(PEP._openT); };
  return html`
  <p class="small"><a href="#/mine">← ${t('nav.mine')}</a></p>
  ${PEP.query.new ? html`<div class="alert ok mb" role="status">${ico('check')}<div><b>${t('booked_ok')}</b> ${t('booked_ok2')}</div></div>` : ''}
  ${offline ? html`<div class="alert warn mb">${ico('wifi')}<div>${t('offline_cache')}</div></div>` : ''}
  <div class="row sp"><div><h1 style="margin:0">${f.name}</h1><p style="margin:0;font-size:1.1rem">${F.day(r.start)} · <b>${F.range(r.start, r.end)}</b></p></div>
    <div class="row">${PEP.statusChip(r)}${r.seasonal ? html`<span class="chip">${t('season')}</span>` : ''}<span class="chip">${F.money(r.price)} · ${t('tariff.' + r.tariff)}${r.price ? ' · ' + (r.paid ? t('paid') : t('unpaid')) : ''}</span><span class="chip">${t('ch.' + r.channel)}</span></div></div>
  ${r.holder && r.holder.id !== S.user.id ? html`<p class="muted">${t('holder')}: <b>${r.holder.name}</b></p>` : ''}
  <h2 class="mt">${t('track')}</h2>${timeline(r, now)}
  ${r.status === 'cancelled' ? html`<div class="alert bad">${ico('x')}<div>${t('cancelled_note')}${r.late_cancel ? ' ' + t('late_cancel_note') : ''}</div></div>` : ''}
  ${r.status === 'no_show' ? html`<div class="alert bad">${ico('alert')}<div>${t('no_show_note')}</div></div>` : ''}
  <div class="grid g2 mt">
    ${live && qrd ? html`<section class="card" aria-labelledby="qr-t"><h2 id="qr-t">${ico('qr')} ${t('your_access')}</h2>
      <div class="center"><div class="qrbox" role="img" aria-label="${t('qr_alt')}">${raw(qrd.svg)}</div>
      <p class="mt" style="margin-bottom:0">${t('alt_code')}</p><div class="bigcode" aria-label="${r.code.split('').join(' ')}">${r.code.slice(0, 3)} ${r.code.slice(3)}</div></div>
      <p class="hint center">${t('qr_note')} ${raw('<span class="chip ok">' + esc(t('saved_offline')) + '</span>')}</p>
      <div class="row" style="justify-content:center">
        ${door && r.can_cancel ? html`<button class="btn green" data-act="open-door" data-id="${r.id}" data-dev="${r.facility.device_id}">${ico('door')} ${t('open_door')}</button>` : door ? html`<button class="btn green" data-act="open-door" data-id="${r.id}" data-dev="${r.facility.device_id}">${ico('door')} ${t('open_door')}</button>` : ''}
        ${door ? html`<button class="btn sec" data-act="to-reader" data-dev="${r.facility.device_id}">${ico('qr')} ${t('to_reader')}</button>` : ''}
        <button class="btn sec" data-act="print">${ico('print')} ${t('print_qr')}</button></div>
      <div id="opening" class="mt" aria-live="polite"></div>
      <details class="mt"><summary>${t('qr_text')}</summary><p class="small mono" style="word-break:break-all" id="qrtext">${qrd.text}</p><button class="btn sec sm" data-act="copy" data-from="qrtextin">${t('copy')}</button><input id="qrtextin" value="${qrd.text}" class="sr" aria-hidden="true" tabindex="-1"></details>
    </section>` : ''}
    <section class="card" aria-labelledby="do-t"><h2 id="do-t">${t('actions')}</h2><div class="col">
      ${live ? html`<a class="btn sec" href="#" data-act="ics" data-id="${r.id}">${ico('cal')} ${t('add_cal')}</a>` : ''}
      ${r.status === 'confirmed' ? html`<button class="btn sec" data-act="change" data-id="${r.id}" data-fid="${f.id}" ${r.can_change ? '' : 'disabled'}>${ico('clock')} ${t('change_slot')}</button>${r.can_change ? '' : html`<span class="hint">${t('change_deadline', { n: r.cancel_hours })}</span>`}
        <button class="btn danger" data-act="cancel" data-id="${r.id}" data-late="${r.start - now < r.cancel_hours * 3600 ? 1 : 0}" ${r.can_cancel ? '' : 'disabled'}>${ico('x')} ${t('cancel_booking')}</button>` : ''}
      ${live ? html`<button class="btn sec" data-act="problem" data-id="${r.id}" data-door="${door ? 1 : 0}">${ico('alert')} ${t('have_problem')}</button>` : ''}
      ${r.status === 'confirmed' ? html`<button class="btn sec sm" data-act="jump" data-id="${r.id}" title="${t('demo_only')}">${ico('clock')} ${t('jump')} <span class="chip warn">DEMO</span></button>` : ''}
    </div>
    <h3 class="mt">${t('how_enter')}</h3><p class="small">${t('am.' + f.access_mode + '.how')}</p>
    ${door ? html`<p class="small"><a href="#/door/${r.facility.device_id}" target="_blank" rel="noopener">${ico('door')} ${t('open_sim')} ↗</a></p>` : ''}
    ${mine.length ? html`<h3>${t('your_access_log')}</h3><ul class="log">${mine.map(a => html`<li>${F.hm(a.ts)} · ${t('med.' + a.medium)} · ${a.result === 'ok' ? '✓' : '✕ ' + t('dr.' + a.reason)}</li>`)}</ul>` : ''}
    </section></div>
  <div class="print-only"><h1>${S.meta.config.name}</h1><h2>${f.name} · ${F.day(r.start)} ${F.range(r.start, r.end)}</h2>${qrd ? html`<div class="qrbox">${raw(qrd.svg)}</div><div class="bigcode">${r.code.slice(0, 3)} ${r.code.slice(3)}</div>` : ''}<p>${r.holder ? r.holder.name : ''} · ${t('am.' + f.access_mode + '.how')}</p></div>`;
});

Object.assign(PEP.actions, {
  print: () => window.print(),
  ics: async el => PEP.download(`/reservations/${el.dataset.id}/ics`, `reserva-${el.dataset.id}.ics`),
  'to-reader': el => { const q = lsGet('pep.lastqr'); localStorage.setItem('pep.nfc', JSON.stringify({ ...q, ts: Date.now(), n: Math.random() })); window.open('#/door/' + el.dataset.dev, 'pep-door', 'width=1100,height=900'); PEP.toast(t('sent_reader')); },
  jump: async el => { await PEP.post('/demo/jump/' + el.dataset.id); await PEP.reloadMeta(); PEP.toast(t('jumped')); PEP.refresh(); },
  cancel: async el => {
    const late = el.dataset.late === '1';
    if (!await PEP.confirm(t('cancel_booking'), late ? t('cancel_late_warn') : t('cancel_confirm'), t('yes_cancel'), true)) return;
    const r = await PEP.post(`/reservations/${el.dataset.id}/cancel`); PEP.toast(t('cancelled_ok') + (r.late ? ' ' + t('late_cancel_note') : '')); PEP.refresh();
  },
  change: async el => {
    const id = el.dataset.id, fid = el.dataset.fid;
    const av = await PEP.get(`/facilities/${fid}/slots?days=14`);
    const free = av.days.flatMap(d => d.slots.filter(s => s.state === 'free'));
    const d = PEP.dlg(async () => ({ title: t('change_slot'), body: `<p>${esc(t('change_hint'))}</p><label for="ns">${esc(t('new_slot'))}</label><select id="ns">${free.map(s => `<option value="${s.start}">${esc(F.dt(s.start))}–${esc(F.hm(s.end))}</option>`).join('')}</select><div id="cerr" class="mt"></div>`, buttons: [{ label: t('cancel_btn'), cls: 'sec', onClick: a => a.close(null) }, { label: t('confirm'), onClick: async a => {
      try { await PEP.patch('/reservations/' + id, { start: +a.el.querySelector('#ns').value }); a.close(true); PEP.toast(t('changed_ok')); PEP.refresh(); }
      catch (e) { if (e.detail && e.detail.violations) a.el.querySelector('#cerr').innerHTML = e.detail.violations.map(v => `<div class="alert bad">${esc(PEP.vText(v))}</div>`).join(''); else throw e; } } }] }));
    return d.result;
  },
  problem: async el => {
    const door = el.dataset.door === '1';
    const cats = [['dirty', 'pr.dirty'], ['material', 'pr.material'], ...(door ? [['cannot_enter', 'pr.cannot_enter'], ['reader', 'pr.reader'], ['lock', 'pr.lock']] : [['cannot_enter', 'pr.cannot_enter']]), ['other', 'pr.other']];
    const d = PEP.dlg(async () => ({ title: t('have_problem'), body: `<p class="hint">${esc(t('problem_hint'))}</p><fieldset style="border:0;padding:0"><legend class="sr">${esc(t('have_problem'))}</legend>${cats.map(([k, l], i) => `<label class="check" style="margin:.4rem 0"><input type="radio" name="cat" value="${k}" ${i === 0 ? 'checked' : ''}> ${esc(t(l))}</label>`).join('')}</fieldset><label for="ptx" class="mt">${esc(t('details'))}</label><textarea id="ptx" rows="3"></textarea>`,
      buttons: [{ label: t('cancel_btn'), cls: 'sec', onClick: a => a.close(null) }, { label: t('send'), onClick: async a => {
        const cat = a.el.querySelector('input[name=cat]:checked').value; const i = await PEP.post('/incidents', { reservation_id: +el.dataset.id, category: cat, text: a.el.querySelector('#ptx').value });
        a.close(i); PEP.toast(t(i.queue === 'technical' ? 'incident_tech' : 'incident_op')); } }] }));
    return d.result;
  },
  'open-door': async el => {
    const box = $('#opening'); clearInterval(PEP._openT);
    try {
      const r = await PEP.post(`/reservations/${el.dataset.id}/open`);
      const end = Date.now() + r.ttl * 1000; const dev = el.dataset.dev;
      const tick = async () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000)); let st = null;
        try { st = await PEP.get('/door/' + dev); } catch (e) { }
        if (st && !st.locked) { clearInterval(PEP._openT); box.innerHTML = `<div class="alert ok">${ico('check').s}<div><b>${esc(t('door_open'))}</b> ${esc(t('entry'))} ${esc(F.hm(st.now))}</div></div>`; return; }
        if (left <= 0) { clearInterval(PEP._openT); box.innerHTML = `<div class="alert warn">${ico('clock').s}<div>${esc(t('press_expired'))}</div></div>`; return; }
        box.innerHTML = `<div class="alert info" role="status">${ico('door').s}<div><b>${esc(t('press_now'))}</b><br>${esc(t('press_left', { n: left }))}<div class="bar mt" aria-hidden="true"><i style="width:${left / r.ttl * 100}%"></i></div></div></div>`;
      };
      tick(); PEP._openT = setInterval(tick, 1000);
    } catch (e) {
      const k = e.detail && e.detail.code; box.innerHTML = `<div class="alert bad" role="alert">${ico('alert').s}<div>${esc(t('open_err.' + k) === 'open_err.' + k ? PEP.errText(e) : t('open_err.' + k))}</div></div>`;
    }
  },
});

/* ---------- avisos ---------- */
PEP.route(/^\/avisos$/, async () => {
  if (!S.user) { const e = new Error('login_required'); e.status = 401; throw e; }
  const ns = await PEP.get('/me/notifications');
  await PEP.post('/me/notifications/read'); setTimeout(() => { const b = $('#nbadge'); if (b) b.innerHTML = ''; }, 50);
  return html`<h1>${t('nav.notifs')}</h1><div class="alert info mb">${ico('info')}<div>${t('notif_note')}</div></div>
  ${ns.length ? html`<ul class="col" style="list-style:none;padding:0">${ns.map(n => { const p = JSON.parse(n.params || '{}'); return html`<li class="card flat" style="${n.read ? '' : 'border-color:var(--accent)'}"><div class="row sp"><b>${t('n.' + n.kind + '.t')}</b><span class="small muted">${F.dt(n.ts)}</span></div><p style="margin:.2rem 0">${t('n.' + n.kind, { ...p, when: p.start ? F.dt(p.start) : '', s: p.status ? t('inc.' + p.status) : '', c: p.category ? t('pr.' + p.category) : '' })}</p><span class="small muted">${n.channel.split(',').map(c => t('chan.' + c)).join(' · ')}</span></li>`; })}</ul>` : html`<p class="muted">${t('no_notifs')}</p>`}`;
});

/* ---------- perfil ---------- */
PEP.route(/^\/profile$/, async () => {
  if (!S.user) { const e = new Error('login_required'); e.status = 401; throw e; }
  const u = await PEP.get('/me'); S.user = u;
  const [linked, inc, acc] = await Promise.all([PEP.get('/me/linked'), PEP.get('/incidents'), PEP.get('/me/access')]);
  const isC = u.role === 'citizen';
  return html`
  <h1>${t('profile')}</h1>
  <div class="grid g2">
    <section class="card"><h2>${t('your_data')}</h2>
      <table><tbody><tr><th>${t('name')}</th><td>${u.name} ${u.surname}</td></tr><tr><th>${t('email')}</th><td>${u.email || '–'}</td></tr><tr><th>${t('phone')}</th><td>${u.phone || '–'}</td></tr><tr><th>${t('role')}</th><td>${t('role.' + u.role)}</td></tr>
      <tr><th>${t('identity')}</th><td>${u.level >= 2 ? html`<span class="chip ok">${t('lvl.2')}</span> ${u.id_method ? t('via.' + u.id_method) : ''}` : html`<span class="chip warn">${t('lvl.1')}</span> <button class="btn sec sm" data-act="accredit">${t('accredit.btn')}</button>`}</td></tr>
      <tr><th>${t('padron')}</th><td>${u.empadronado ? html`<span class="chip ok">${t('verified_town')}</span>` : html`<span class="chip">${t('not_padron')}</span>`} <span class="hint">${t('padron_hint')}</span></td></tr>
      <tr><th>${t('norms')}</th><td>${u.norms_ok ? html`<span class="chip ok">v${u.norms_accepted} ${t('accepted')}</span>` : html`<span class="chip bad">${t('norms_pending', { v: u.norms_current })}</span> <button class="btn sm" data-act="accept-norms">${t('accept_norms_btn')}</button>`}</td></tr></tbody></table></section>
    <section class="card"><h2>${t('notif_prefs')}</h2>
      <label class="check"><input type="checkbox" data-act="pref" data-k="notif_email" ${u.notif_email ? 'checked' : ''}> ${t('pref_email')}</label>
      <label class="check"><input type="checkbox" data-act="pref" data-k="notif_push" ${u.notif_push ? 'checked' : ''}> ${t('pref_push')} <span class="chip">${t('optional')}</span></label>
      <label class="check"><input type="checkbox" data-act="pref" data-k="passkey" ${u.passkey ? 'checked' : ''}> ${t('pref_passkey')} <span class="chip warn">${t('simulated')}</span></label>
      <p class="hint">${t('pref_hint')}</p></section>
    ${isC ? html`<section class="card"><h2>${t('linked')}</h2><p class="hint">${t('linked_hint')}</p>
      ${linked.map(m => html`<div class="row sp" style="border-bottom:1px solid var(--line);padding:.4rem 0"><span><b>${m.name} ${m.surname}</b> · ${m.age} ${t('years')}</span>${m.age >= 14 ? html`<label class="check"><input type="checkbox" data-act="authorise" data-id="${m.id}" ${m.authorised ? 'checked' : ''}> ${t('authorised')}</label>` : html`<span class="chip ok">${t('via_tutor')}</span>`}</div>`)}
      ${u.level >= 2 ? html`<form data-form="addminor" class="row mt"><input name="name" placeholder="${t('name')}" required aria-label="${t('name')}" style="flex:1;min-width:120px"><input name="birth_year" type="number" min="2009" max="2026" placeholder="${t('birth_year')}" required aria-label="${t('birth_year')}" style="width:8rem"><button class="btn sm" type="submit">${ico('plus')} ${t('add_minor')}</button></form>` : html`<p class="alert warn">${t('minor_need_l2')}</p>`}</section>` : ''}
    <section class="card"><h2>${t('my_incidents')}</h2>${inc.length ? html`<ul class="log">${inc.slice(0, 8).map(i => html`<li>${F.dt(i.ts)} · ${i.facility} · ${t('pr.' + i.category)} <span class="chip ${i.status === 'closed' ? 'ok' : 'warn'}">${t('inc.' + i.status)}</span>${i.notes.map(n => html`<br><span class="small muted">↳ ${n.by}: ${n.text}</span>`)}</li>`)}</ul>` : html`<p class="muted">${t('no_incidents')}</p>`}</section>
    <section class="card"><h2>${t('my_access')}</h2>${acc.length ? html`<ul class="log">${acc.slice(0, 8).map(a => html`<li>${F.dt(a.ts)} · ${a.facility} · ${t('med.' + a.medium)} ${a.result === 'ok' ? '✓' : '✕ ' + t('dr.' + a.reason)}</li>`)}</ul>` : html`<p class="muted">${t('no_access')}</p>`}</section>
    <section class="card"><h2>${ico('book')} ${t('privacy')}</h2><p class="small">${S.meta.config['legal_' + S.lang]}</p><p class="small muted">${t('retention', { n: S.meta.config.retention_days })}</p>
      <div class="row"><button class="btn sec" data-act="export-me">${ico('down')} ${t('export_data')}</button>${isC ? html`<button class="btn danger" data-act="delete-me">${t('delete_account')}</button>` : ''}</div></section>
  </div>`;
});
Object.assign(PEP.actions, {
  accredit: async () => { if (await PEP.accreditDialog()) PEP.refresh(); },
  'accept-norms': async () => { await PEP.post('/me/norms'); PEP.refresh(); },
  pref: async el => { S.user = await PEP.patch('/me', { [el.dataset.k]: el.checked }); PEP.toast(t('saved')); },
  authorise: async el => { await PEP.post(`/me/linked/${el.dataset.id}/authorise`, { authorised: el.checked }); PEP.toast(t('saved')); },
  addminor: async (f, d) => { await PEP.post('/me/linked', { name: d.name, birth_year: +d.birth_year }); PEP.refresh(); },
  'export-me': async () => { const d = await PEP.get('/me/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'os-meus-datos.json'; a.click(); },
  'delete-me': async () => { if (!await PEP.confirm(t('delete_account'), t('delete_confirm'), t('delete_account'), true)) return; await PEP.del('/me'); PEP.setSession(null, null); location.hash = '#/'; PEP.renderAll(); },
});

/* ---------- formación ---------- */
PEP.route(/^\/formacion$/, async () => {
  const cs = await PEP.get('/courses');
  return html`<h1>${t('nav.learn')}</h1><p class="muted">${t('learn_hint')}</p>
  <div class="grid g3">${cs.map(c => html`<a class="card click" href="#/formacion/${c.id}"><span class="chip info">${t('aud.' + c.audience)}</span><h3 class="mt">${c.title[S.lang]}</h3><p class="small muted">${c.steps.length} ${t('steps')} · ${c.minutes} min ${c.progress ? html`· <span class="chip ok">${t('done')} ${c.progress.score}/${c.quiz.length}</span>` : ''}</p></a>`)}</div>`;
});
PEP.route(/^\/formacion\/(\w+)$/, async id => {
  const cs = await PEP.get('/courses'); const c = cs.find(x => x.id === id); if (!c) throw new Error('not_found');
  window._course = c;
  return html`<p class="small"><a href="#/formacion">← ${t('nav.learn')}</a></p><h1>${c.title[S.lang]}</h1>
  <div class="card"><ol style="padding-left:1.2rem">${c.steps.map((s, i) => html`<li style="margin:.6rem 0"><b>${t('step')} ${i + 1}.</b> ${s[S.lang]}</li>`)}</ol></div>
  <h2 class="mt">${t('quiz')}</h2>
  <form data-form="quiz" class="card col">${c.quiz.map((q, i) => html`<fieldset style="border:0;padding:0"><legend><b>${i + 1}. ${q.q[S.lang]}</b></legend>${q.options[S.lang].map((o, j) => html`<label class="check" style="margin:.3rem 0"><input type="radio" name="q${i}" value="${j}" required> ${o}</label>`)}</fieldset>`)}
    <div><button class="btn" type="submit">${t('check_answers')}</button></div><div id="quizres" aria-live="polite"></div></form>`;
});
PEP.actions.quiz = async (f, d) => {
  const c = window._course; let ok = 0;
  c.quiz.forEach((q, i) => { if (+d['q' + i] === q.answer) ok++; });
  $('#quizres').innerHTML = `<div class="alert ${ok === c.quiz.length ? 'ok' : 'warn'}">${t('quiz_score', { a: ok, b: c.quiz.length })}</div>`;
  if (S.user) await PEP.post(`/courses/${c.id}/done`, { score: ok }).catch(() => { });
};

/* ---------- porta simulada ---------- */
PEP.route(/^\/door\/([\w-]+)$/, async dev => {
  const st = await PEP.get('/door/' + dev);
  let keys = '';
  const lcd = (msg, cls = '') => { const e = $('#lcd'); if (e) { e.className = 'lcd ' + cls; e.innerHTML = msg; } };
  let stopCam = null, lcdT = null;
  const flash = (msg, cls) => { lcd(msg, cls); clearTimeout(lcdT); lcdT = setTimeout(() => lcd(esc(t('door.ready')) + '<br><small>' + esc(t('door.ready2')) + '</small>', 'wait'), 4500); };
  const result = r => {
    if (r.ok) flash(`${esc(t('door.ok'))}<br><small>${r.who ? esc(r.who) + ' · ' : ''}${r.start ? esc(F.range(r.start, r.end)) : ''}${r.offline ? ' · ' + esc(t('door.offline_ok')) : ''}${r.reason === 'maintenance' ? esc(t('med.maintenance')) : ''}</small>`, '');
    else flash(`${esc(t('door.denied'))}<br><small>${esc(t('dr.' + r.reason))}</small>`, 'bad');
    poll();
  };
  const doScan = async (text, kind) => { try { result(await PEP.post(`/door/${dev}/scan`, { text, kind })); } catch (e) { PEP.fail(e); } };
  const poll = async () => {
    let s; try { s = await PEP.get('/door/' + dev); } catch (e) { return; }
    if (!$('#lcd')) return;
    const set = (id, on) => { const e = $(id); if (e) e.classList.toggle('on', !!on); };
    set('#led-lock', !s.locked); set('#led-light', s.light); set('#led-net', s.online); set('#led-sensor', !s.door_closed);
    $('#doorgfx').classList.toggle('open', !s.locked || !s.door_closed);
    $('#netbtn').textContent = s.online ? t('door.go_offline') : t('door.go_online');
    $('#sensorbtn').textContent = s.door_closed ? t('door.push') : t('door.close');
    $('#pbtn').dataset.armed = s.armed ? '1' : '0';
    $('#armed').innerHTML = s.armed ? `<span class="chip warn">${esc(t('door.armed', { n: s.armed_left }))}</span>` : '';
    $('#info').innerHTML = `<tr><th>${esc(t('door.fac'))}</th><td>${esc(s.facility.name)}</td></tr><tr><th>${esc(t('door.cache'))}</th><td>${s.cache}</td></tr><tr><th>${esc(t('door.revoked'))}</th><td>${s.revoked}${s.pending ? ' (+' + s.pending + ' ' + esc(t('door.pending')) + ')' : ''}</td></tr><tr><th>${esc(t('door.locallog'))}</th><td>${s.local_log}</td></tr><tr><th>${esc(t('door.pub'))}</th><td class="mono small">${esc(s.pubkey.slice(0, 16))}…</td></tr><tr><th>FW</th><td>${esc(s.fw)}</td></tr>`;
    const items = [...s.local_log.map(l => ({ ...l, off: true })), ...s.log];
    $('#dlog').innerHTML = items.slice(0, 14).map(l => `<li>${esc(F.hm(l.ts))} · ${esc(t('med.' + l.medium))} · ${l.result === 'ok' ? '✓' : '✕ ' + esc(t('dr.' + l.reason))} ${l.who ? '· ' + esc(l.who) : ''}${l.off ? ' <span class="chip warn">' + esc(t('door.local')) + '</span>' : ''}</li>`).join('') || `<li class="muted">${esc(t('door.no_log'))}</li>`;
    try { const m = await PEP.get(`/door/${dev}/mqtt`); $('#mqtt').innerHTML = m.slice(0, 14).map(x => `<div>${esc(F.hm(x.ts))} <b>${esc(x.topic.replace(/^pista\/[^/]+\//, ''))}</b> ${esc(x.payload)}</div>`).join('') || esc(t('door.no_log')); } catch (e) { }
    const nfc = lsGet('pep.nfc'); const nb = $('#nfc');
    if (nb) { if (nfc && Date.now() - nfc.ts < 180000) { nb.classList.remove('hide'); nb.dataset.text = nfc.text; } else nb.classList.add('hide'); }
  };
  PEP.actions['d-nfc'] = el => doScan(el.dataset.text, 'qr');
  PEP.actions['d-read'] = () => { const v = $('#qrin').value.trim(); if (v) doScan(v, 'qr'); $('#qrin').value = ''; };
  PEP.actions['d-key'] = el => {
    const k = el.dataset.k;
    if (k === 'C') keys = ''; else if (k === 'OK') { if (keys) doScan(keys, 'code'); keys = ''; } else if (keys.length < 6) keys += k;
    if (k !== 'OK') lcd(`${esc(t('door.code'))}<br><b style="font-size:1.6rem;letter-spacing:.3em">${'•'.repeat(keys.length) || '&nbsp;'}</b>`, 'wait');
  };
  PEP.actions['d-press'] = async () => { try { const r = await PEP.post(`/door/${dev}/button`); r.ok ? flash(`${esc(t('door.ok'))}<br><small>${esc(t('med.button'))}</small>`, '') : flash(`${esc(t('door.denied'))}<br><small>${esc(t('dr.' + r.reason))}</small>`, 'bad'); poll(); } catch (e) { PEP.fail(e); } };
  PEP.actions['d-net'] = async () => { const s = await PEP.get('/door/' + dev); await PEP.post(`/door/${dev}/online`, { online: !s.online }); poll(); };
  PEP.actions['d-sensor'] = async () => { const s = await PEP.get('/door/' + dev); await PEP.post(`/door/${dev}/sensor`, { closed: !s.door_closed }); poll(); };
  PEP.actions['d-remote'] = async () => { const r = await PEP.post(`/devices/${dev}/remote-open`); r.ok ? PEP.toast(t('door.remote_ok')) : PEP.toast(t('open_err.' + r.reason), true); poll(); };
  PEP.actions['d-cam'] = async el => {
    const v = $('#cam');
    if (stopCam) { stopCam(); stopCam = null; v.classList.add('hide'); return; }
    try { v.classList.remove('hide'); stopCam = await PEP.camera.start(v, txt => doScan(txt, 'qr')); } catch (e) { v.classList.add('hide'); PEP.toast(t(PEP.camera.supported() ? 'cam_denied' : 'cam_unsupported'), true); }
  };
  const timer = setInterval(poll, 1200);
  PEP.cleanup = () => { clearInterval(timer); clearTimeout(lcdT); if (stopCam) stopCam(); };
  setTimeout(poll, 50);
  const canRemote = S.user && S.user.role === 'manager';
  return html`
  <p class="small"><a href="#/demo">← ${t('nav.demo')}</a></p>
  <h1>${t('door.title')} · ${st.facility.name}</h1><p class="muted">${t('door.sub')}</p>
  <div class="door">
    <section class="panel" aria-label="${t('door.title')}">
      <div class="lcd wait" id="lcd" role="status" aria-live="polite">${t('door.ready')}<br><small>${t('door.ready2')}</small></div>
      <div class="leds"><span class="led green" id="led-lock"><i></i>${t('door.lock')}</span><span class="led amber" id="led-light"><i></i>${t('door.light')}</span><span class="led green on" id="led-net"><i></i>${t('door.net')}</span><span class="led red" id="led-sensor"><i></i>${t('door.sensor')}</span></div>
      <div class="field"><label for="qrin" style="color:#c9d6ea">${t('door.reader')}</label><div class="row"><input id="qrin" placeholder="PEP1.…" style="flex:1;min-width:150px;background:#0e1522;color:#e8eef8;border-color:#46546b"><button class="btn sm" data-act="d-read">${t('door.read')}</button><button class="btn sec sm" data-act="d-cam" style="color:#9CC3F8;border-color:#9CC3F8">${ico('qr')} ${t('door.camera')}</button></div></div>
      <video class="cam hide" id="cam" muted playsinline aria-label="${t('door.camera')}"></video>
      <button class="btn green hide" id="nfc" data-act="d-nfc" style="width:100%">${ico('qr')} ${t('door.nfc')}</button>
      <div class="keypad" role="group" aria-label="${t('door.keypad')}">${raw(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map(k => `<button data-act="d-key" data-k="${k}" aria-label="${k === 'C' ? t('door.clear') : k === 'OK' ? 'OK' : k}">${k}</button>`).join(''))}</div>
      <div class="row sp"><div class="center"><button class="pulsador" id="pbtn" data-act="d-press" aria-label="${t('door.pulsador')}">${t('door.pulsador_s')}</button><div class="small" style="color:#c9d6ea">${t('door.pulsador')}</div></div><div id="armed" aria-live="polite"></div>
        <div class="col" style="gap:.4rem"><button class="btn sec sm" id="sensorbtn" data-act="d-sensor" style="color:#9CC3F8;border-color:#9CC3F8"></button><button class="btn sec sm" id="netbtn" data-act="d-net" style="color:#ffc24a;border-color:#ffc24a"></button>${canRemote ? html`<button class="btn sm" data-act="d-remote">${t('door.remote')}</button>` : ''}</div></div>
      <div class="doorgfx" id="doorgfx"><div class="leaf"></div><span class="lbl">${t('door.gfx')}</span></div>
    </section>
    <section class="col">
      <div class="card flat"><h2>${t('door.state')}</h2><table><tbody id="info"></tbody></table></div>
      <div class="card flat"><h2>${t('door.events')}</h2><ul class="log" id="dlog"></ul></div>
      <div class="card flat"><h2>${t('door.mqtt')}</h2><p class="hint">${t('door.mqtt_hint', { b: S.meta.mqtt ? t('door.mqtt_on') : t('door.mqtt_off') })}</p><div class="mqtt" id="mqtt"></div></div>
      <div class="card flat"><h2>${t('door.demonstrates')}</h2><ul class="small" style="padding-left:1.1rem"><li>${t('dm.1')}</li><li>${t('dm.2')}</li><li>${t('dm.3')}</li><li>${t('dm.4')}</li></ul></div>
    </section></div>`;
});
})();
