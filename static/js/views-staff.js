/* SPDX-License-Identifier: AGPL-3.0-or-later */
'use strict';
(() => {
const { S, html, raw, esc, ico, t, F, $, $$ } = PEP;
const guard = roles => { if (!S.user) { const e = new Error('login_required'); e.status = 401; e.code = 'login_required'; throw e; } if (!roles.includes(S.user.role)) { const e = new Error('forbidden'); e.status = 403; e.code = 'forbidden'; throw e; } };
const ls = PEP.ls;

/* =========================================================== VALIDADOR */
let valOffline = false;
PEP.route(/^\/validar$/, async () => {
  guard(['validator', 'manager']);
  const facs = await PEP.get('/validator/facilities');
  const fid = +(PEP.query.f || facs[0].id);
  valOffline = ls.get('pep.val.offline', false);
  let day = null;
  const ck = `pep.val.day.${S.tenant}.${fid}`;
  if (!valOffline) { try { day = await PEP.get('/validator/day?facility_id=' + fid); ls.set(ck, day); } catch (e) { if (!e.offline) throw e; valOffline = true; } }
  if (valOffline) day = ls.get(ck, { items: [], now: PEP.nowTs() });
  const q = ls.get('pep.val.queue', []);
  const items = day.items.map(i => { const loc = q.find(x => x.reservation_id === i.id); return loc ? { ...i, status: 'attended', entered_at: loc.ts, local: true } : i; });
  PEP.cleanup = () => { if (PEP._vcam) { PEP._vcam(); PEP._vcam = null; } };
  window._val = { fid, items, day };
  return html`
  <h1>${t('val.title')}</h1><p class="muted">${t('val.sub')}</p>
  <div class="row sp mb"><div class="row"><label for="vf" class="sr">${t('facility')}</label><select id="vf" data-act="val-fac" style="min-width:14rem">${facs.map(f => html`<option value="${f.id}" ${f.id === fid ? 'selected' : ''}>${f.name}</option>`)}</select></div>
    <label class="check"><input type="checkbox" id="voff" data-act="val-off" ${valOffline ? 'checked' : ''}> ${t('val.simoff')}</label></div>
  ${valOffline ? html`<div class="alert warn mb">${ico('wifi')}<div><b>${t('val.offline')}</b> ${t('val.offline2')} ${q.length ? html`<b>${t('val.queued', { n: q.length })}</b>` : ''}</div></div>` : ''}
  <div class="grid g2"><section class="card"><h2>${ico('qr')} ${t('val.scan')}</h2>
    <div class="row"><input id="vqr" placeholder="PEP1.… / 123456" aria-label="${t('val.scan')}" style="flex:1;min-width:150px" ${valOffline ? 'disabled' : ''}><button class="btn" data-act="val-scan" ${valOffline ? 'disabled' : ''}>${t('door.read')}</button><button class="btn sec" data-act="val-cam" ${valOffline ? 'disabled' : ''}>${ico('qr')} ${t('door.camera')}</button></div>
    <video class="cam hide mt" id="vcam" muted playsinline></video><p class="hint">${t('val.scan_hint')}</p><div id="vres" class="mt" aria-live="assertive"></div></section>
  <section class="card"><div class="row sp"><h2 style="margin:0">${t('val.today')} · ${F.dayS(day.now)}</h2><input id="vsearch" placeholder="${t('val.search')}" aria-label="${t('val.search')}" style="max-width:14rem"></div>
    <div class="tablewrap mt"><table><thead><tr><th>${t('time')}</th><th>${t('person')}</th><th>${t('status')}</th><th></th></tr></thead><tbody id="vlist">${raw(valRows(items))}</tbody></table></div>
    ${valOffline ? '' : q.length ? html`<button class="btn mt" data-act="val-sync">${t('val.sync', { n: q.length })}</button>` : ''}</section></div>`;
});
function valRows(items) {
  if (!items.length) return `<tr><td colspan="4" class="muted">${esc(t('val.none'))}</td></tr>`;
  return items.map(i => `<tr data-name="${esc(i.name.toLowerCase())}"><td>${esc(F.range(i.start, i.end))}</td><td><b>${esc(i.name)}</b>${i.seasonal ? ' <span class="chip">' + esc(t('season')) + '</span>' : ''}<br><span class="hint">${esc(t('tariff.' + i.tariff))}${i.paid ? '' : ' · ' + esc(t('unpaid'))}</span></td>
    <td>${i.status === 'attended' ? `<span class="chip ok">${esc(t('val.entered', { h: F.hm(i.entered_at) }))}${i.local ? ' · ' + esc(t('door.local')) : ''}</span>` : i.status === 'no_show' ? `<span class="chip bad">${esc(t('st.no_show'))}</span>` : `<span class="chip warn">${esc(t('val.pending'))}</span>`}</td>
    <td>${i.status !== 'attended' ? `<button class="btn sec sm" data-act="val-check" data-id="${i.id}">${esc(t('val.mark'))}</button>` : ''}</td></tr>`).join('');
}
document.addEventListener('input', e => { if (e.target.id === 'vsearch') { const q = e.target.value.toLowerCase(); $$('#vlist tr').forEach(r => r.classList.toggle('hide', !!q && !(r.dataset.name || '').includes(q))); } });
const vres = (ok, main, sub) => { $('#vres').innerHTML = `<div class="vres ${ok ? 'ok' : 'bad'}" role="alert">${ok ? '✓' : '✕'} ${esc(main)}${sub ? `<br><small>${esc(sub)}</small>` : ''}</div>`; };
async function doVal(text) {
  const kind = /^\d{3}\s?\d{3}$/.test(text.trim()) ? 'code' : 'qr';
  const r = await PEP.post('/validator/scan?facility_id=' + window._val.fid, { text, kind });
  if (r.ok) vres(true, t('val.ok', { n: r.who ? r.who.name : '' }), `${r.facility} · ${F.range(r.start, r.end)}`); else vres(false, t('dr.' + r.reason), r.who ? r.who.name : '');
  PEP.refresh();
}
Object.assign(PEP.actions, {
  'val-fac': el => PEP.go('#/validar?f=' + el.value),
  'val-off': el => { ls.set('pep.val.offline', el.checked); PEP.refresh(); },
  'val-scan': async () => { const v = $('#vqr').value.trim(); if (v) { $('#vqr').value = ''; await doVal(v); } },
  'val-cam': async () => {
    const v = $('#vcam'); if (PEP._vcam) { PEP._vcam(); PEP._vcam = null; v.classList.add('hide'); return; }
    try { v.classList.remove('hide'); PEP._vcam = await PEP.camera.start(v, txt => doVal(txt)); } catch (e) { v.classList.add('hide'); PEP.toast(t(PEP.camera.supported() ? 'cam_denied' : 'cam_unsupported'), true); }
  },
  'val-check': async el => {
    const id = +el.dataset.id; const it = { reservation_id: id, ts: PEP.nowTs() };
    if (valOffline) { const q = ls.get('pep.val.queue', []); q.push({ ...it, offline: true }); ls.set('pep.val.queue', q); PEP.toast(t('val.queued_one')); }
    else { await PEP.post('/validator/checkin?facility_id=' + window._val.fid, { items: [it] }); PEP.toast(t('val.marked')); }
    PEP.refresh();
  },
  'val-sync': async () => { const q = ls.get('pep.val.queue', []); const r = await PEP.post('/validator/checkin?facility_id=' + window._val.fid, { items: q }); ls.set('pep.val.queue', []); PEP.toast(t('val.synced', { n: r.synced })); PEP.refresh(); },
});
// ao desactivar o modo sen conexión sincroniza automaticamente
const _vo = PEP.actions['val-off'];
PEP.actions['val-off'] = async el => { ls.set('pep.val.offline', el.checked); if (!el.checked) { const q = ls.get('pep.val.queue', []); if (q.length) { try { const r = await PEP.post('/validator/checkin?facility_id=' + window._val.fid, { items: q }); ls.set('pep.val.queue', []); PEP.toast(t('val.synced', { n: r.synced })); } catch (e) { } } } PEP.refresh(); };

/* =========================================================== INCIDENCIAS (xestión e asistencia) */
async function incidentsView(queueLabel) {
  const inc = await PEP.get('/incidents');
  const open = inc.filter(i => i.status !== 'closed');
  return html`<div class="tablewrap"><table><thead><tr><th>${t('date')}</th><th>${t('facility')}</th><th>${t('category')}</th><th>${t('queue')}</th><th>${t('status')}</th><th></th></tr></thead><tbody>
    ${inc.map(i => html`<tr><td>${F.dt(i.ts)}</td><td>${i.facility}</td><td><b>${t('pr.' + i.category)}</b><br><span class="small">${i.text || ''}</span>${i.who ? html`<br><span class="hint">${i.who}</span>` : ''}${i.notes.map(n => html`<br><span class="small muted">↳ ${n.by}: ${n.text}</span>`)}</td>
      <td><span class="chip ${i.queue === 'technical' ? 'info' : ''}">${t('q.' + i.queue)}</span></td><td><span class="chip ${i.status === 'closed' ? 'ok' : i.status === 'progress' ? 'info' : 'warn'}">${t('inc.' + i.status)}</span></td>
      <td><button class="btn sec sm" data-act="inc-edit" data-id="${i.id}" data-queue="${i.queue}" data-status="${i.status}">${t('manage')}</button></td></tr>`)}
    ${inc.length ? '' : html`<tr><td colspan="6" class="muted">${t('no_incidents')}</td></tr>`}</tbody></table></div><p class="hint">${open.length} ${t('open_n')}</p>`;
}
PEP.actions['inc-edit'] = async el => {
  const id = el.dataset.id; const mgr = S.user.role === 'manager';
  const d = PEP.dlg(async () => ({ title: t('manage'), body: `<div class="field"><label for="is">${esc(t('status'))}</label><select id="is">${['open', 'progress', 'closed'].map(s => `<option value="${s}" ${el.dataset.status === s ? 'selected' : ''}>${esc(t('inc.' + s))}</option>`).join('')}</select></div>
    ${mgr ? `<div class="field"><label for="iq">${esc(t('queue'))}</label><select id="iq">${['operational', 'technical'].map(s => `<option value="${s}" ${el.dataset.queue === s ? 'selected' : ''}>${esc(t('q.' + s))}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label for="in">${esc(t('note'))}</label><textarea id="in" rows="3"></textarea></div>`,
    buttons: [{ label: t('cancel_btn'), cls: 'sec', onClick: a => a.close(null) }, { label: t('save'), onClick: async a => { await PEP.patch('/incidents/' + id, { status: a.el.querySelector('#is').value, queue: mgr ? a.el.querySelector('#iq').value : undefined, note: a.el.querySelector('#in').value || undefined }); a.close(true); PEP.refresh(); } }] }));
};

/* =========================================================== DISPOSITIVOS */
async function devicesView() {
  const ds = await PEP.get('/devices');
  return html`<div class="tablewrap"><table><thead><tr><th>${t('door.fac')}</th><th>ID</th><th>${t('door.net')}</th><th>${t('door.lock')}</th><th>${t('door.cache')}</th><th>${t('door.revoked')}</th><th>FW</th><th></th></tr></thead><tbody>
  ${ds.map(d => html`<tr><td>${d.facility}</td><td class="mono small">${d.id}</td><td><span class="chip ${d.online ? 'ok' : 'bad'}">${d.online ? t('online') : t('offline')}</span></td><td>${d.locked ? t('locked') : t('unlocked')}</td><td>${d.cache}</td><td>${d.revoked}${d.pending ? ' (+' + d.pending + ')' : ''}</td><td>${d.fw}</td>
  <td class="row"><a class="btn sec sm" href="#/door/${d.id}" target="_blank" rel="noopener">${t('open_sim')}</a>${S.user.role === 'manager' ? html`<button class="btn sm" data-act="remote-open" data-dev="${d.id}" ${d.online ? '' : 'disabled'}>${t('door.remote')}</button>` : ''}</td></tr>`)}</tbody></table></div>`;
}
PEP.actions['remote-open'] = async el => { const r = await PEP.post(`/devices/${el.dataset.dev}/remote-open`); r.ok ? PEP.toast(t('door.remote_ok')) : PEP.toast(t('open_err.' + r.reason), true); };

PEP.route(/^\/asistencia$/, async () => {
  guard(['tech', 'manager']);
  return html`<h1>${t('nav.tech')}</h1><p class="muted">${t('tech.sub')}</p><h2>${t('tech.tickets')}</h2>${await incidentsView()}<h2 class="mt">${t('tech.devices')}</h2>${await devicesView()}`;
});

/* =========================================================== ADMIN */
const TABS = ['resumo', 'reservas', 'persoas', 'instalacions', 'regras', 'tempadas', 'normas', 'accesos', 'incidencias', 'dispositivos', 'datos', 'concello'];
const bar = (v, cls = '') => html`<div class="bar ${cls}" role="img" aria-label="${Math.round(v * 100)}%"><i style="width:${Math.min(100, v * 100)}%"></i></div>`;
const heat = (f, max) => {
  const hrs = []; for (let h = 8; h < 24; h++) hrs.push(h);
  const cells = []; for (let d = 0; d < 7; d++) { cells.push(`<div class="l">${esc(['L', 'M', 'X', 'J', 'V', 'S', 'D'][d])}</div>`); for (const h of hrs) { const n = f.heat[`${d}-${h}`] || 0; const a = max ? n / max : 0; cells.push(`<div title="${n}" style="background:rgba(47,128,237,${(0.08 + a * .9).toFixed(2)});color:${a > .55 ? '#fff' : 'var(--ink)'}">${n || ''}</div>`); } }
  return raw(`<div class="heat" role="img" aria-label="${esc(t('adm.heat'))}"><div class="l"></div>${hrs.map(h => `<div class="l">${h}</div>`).join('')}${cells.join('')}</div>`);
};

PEP.route(/^\/admin(?:\/(\w+))?$/, async tab => {
  guard(['manager']);
  tab = tab || 'resumo';
  const tabs = html`<div class="tabs" role="navigation" aria-label="${t('nav.admin')}">${TABS.map(x => html`<a href="#/admin/${x}" ${x === tab ? 'aria-current="page"' : ''}>${t('tab.' + x)}</a>`)}</div>`;
  const body = await (ADMIN[tab] || ADMIN.resumo)();
  return html`<h1>${t('nav.admin')}</h1>${tabs}${body}`;
});

const ADMIN = {};
ADMIN.resumo = async () => {
  const days = +(PEP.query.days || 30);
  const s = await PEP.get('/stats?days=' + days);
  const fs = s.facilities.filter(f => !f.parent_id || true);
  const sel = fs.find(f => f.id === +PEP.query.f) || fs[0];
  const max = Math.max(1, ...Object.values(sel.heat));
  const tot = s.facilities.reduce((a, f) => a + f.booked, 0), slots = s.facilities.reduce((a, f) => a + f.slots, 0);
  const ch = s.channels, chT = Object.values(ch).reduce((a, b) => a + b, 0) || 1;
  const openInc = Object.entries(s.incidents).filter(([k]) => !k.endsWith('closed')).reduce((a, [, v]) => a + v, 0);
  const noShow = s.facilities.reduce((a, f) => a + f.no_show, 0);
  return html`
  <div class="row sp mb"><p class="muted" style="margin:0">${t('adm.period', { n: days })}</p><div class="row"><a class="chip ${days === 7 ? 'info' : ''}" href="#/admin?days=7">7 ${t('days')}</a><a class="chip ${days === 30 ? 'info' : ''}" href="#/admin?days=30">30 ${t('days')}</a><a class="chip ${days === 56 ? 'info' : ''}" href="#/admin?days=56">56 ${t('days')}</a></div></div>
  <div class="grid g4"><div class="card"><div class="stat">${Math.round(tot / (slots || 1) * 100)}%<small>${t('adm.occ')}</small></div></div><div class="card"><div class="stat">${noShow}<small>${t('adm.noshow')}</small></div></div><div class="card"><div class="stat">${openInc}<small>${t('adm.openinc')}</small></div></div><div class="card"><div class="stat">${Object.values(s.access).reduce((a, b) => a + b, 0)}<small>${t('adm.access')} · ${s.denied} ${t('adm.denied')}</small></div></div></div>
  <div class="grid g2 mt"><section class="card"><h2>${t('adm.byfac')}</h2>${fs.map(f => html`<div style="margin:.6rem 0"><div class="row sp"><a href="#/admin?f=${f.id}&days=${days}">${f.name}</a><span class="small">${Math.round(f.occupancy * 100)}% · ${t('adm.week')} ${Math.round(f.week_occupancy * 100)}% · ${f.no_show} ${t('adm.noshow_s')}</span></div>${bar(f.occupancy)}</div>`)}</section>
  <section class="card"><h2>${t('adm.channels')}</h2>${['web', 'phone', 'office'].map(c => html`<div style="margin:.6rem 0"><div class="row sp"><span>${t('ch.' + c)}</span><span class="small">${ch[c] || 0} · ${Math.round((ch[c] || 0) / chT * 100)}%</span></div>${bar((ch[c] || 0) / chT, c === 'web' ? '' : 'green')}</div>`)}
    <h3 class="mt">${t('adm.access_by')}</h3><p class="small">${Object.entries(s.access).map(([k, v]) => html`<span class="chip" style="margin:.1rem">${t('med.' + k)}: ${v}</span>`)}</p></section></div>
  <section class="card mt"><div class="row sp"><h2 style="margin:0">${t('adm.heat')} · ${sel.name}</h2></div><p class="hint">${t('adm.heat_hint')}</p><div class="tablewrap">${heat(sel, max)}</div></section>
  <p class="mt"><a class="btn sec" href="#/admin/datos">${ico('down')} ${t('adm.export')}</a></p>`;
};

ADMIN.reservas = async () => {
  const q = PEP.query; const fs = await PEP.get('/facilities');
  const now = PEP.nowTs();
  const from = q.range === 'past' ? now - 14 * 86400 : now - 3600; const to = q.range === 'past' ? now : now + 14 * 86400;
  let path = `/reservations?scope=all&date_from=${from}&date_to=${to}&limit=300`;
  if (q.f) path += '&facility_id=' + q.f; if (q.status) path += '&status=' + q.status; if (q.ch) path += '&channel=' + q.ch;
  const r = (await PEP.get(path)).items.sort((a, b) => a.start - b.start);
  const opt = (v, cur, l) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
  return html`<div class="row sp mb"><form class="row" data-form="resfilter"><label class="sr" for="rf">${t('facility')}</label><select id="rf" name="f"><option value="">${t('all_fac')}</option>${raw(fs.map(f => opt(f.id, q.f, f.name)).join(''))}</select>
    <label class="sr" for="rs">${t('status')}</label><select id="rs" name="status"><option value="">${t('all_status')}</option>${raw(['confirmed', 'attended', 'no_show', 'cancelled'].map(s => opt(s, q.status, t('st.' + s))).join(''))}</select>
    <label class="sr" for="rc">${t('channel')}</label><select id="rc" name="ch"><option value="">${t('all_channels')}</option>${raw(['web', 'phone', 'office'].map(s => opt(s, q.ch, t('ch.' + s))).join(''))}</select>
    <select name="range" aria-label="${t('period')}">${raw(opt('next', q.range || 'next', t('next14')) + opt('past', q.range, t('past14')))}</select><button class="btn sm" type="submit">${t('filter')}</button></form>
    <button class="btn" data-act="assisted">${ico('phone')} ${t('assisted_new')}</button></div>
  <div class="tablewrap"><table><thead><tr><th>${t('date')}</th><th>${t('facility')}</th><th>${t('person')}</th><th>${t('channel')}</th><th>${t('status')}</th><th>${t('tariff')}</th><th></th></tr></thead><tbody>
  ${r.map(x => html`<tr><td>${F.dayS(x.start)}<br>${F.range(x.start, x.end)}</td><td>${x.facility.name}</td><td>${x.holder.name}${x.seasonal ? html` <span class="chip">${t('season')}</span>` : ''}</td><td>${t('ch.' + x.channel)}</td><td>${PEP.statusChip(x)}</td>
   <td>${F.money(x.price)}${x.price ? html`<br>${x.paid ? html`<span class="chip ok">${t('paid')}</span>` : html`<button class="btn sec sm" data-act="mark-paid" data-id="${x.id}">${t('mark_paid')}</button>`}` : ''}</td>
   <td class="row"><a class="btn sec sm" href="#/r/${x.id}">${t('see')}</a>${x.status === 'confirmed' && x.start > now ? html`<button class="btn danger sm" data-act="cancel-adm" data-id="${x.id}">${t('cancel_btn2')}</button>` : ''}</td></tr>`)}
  ${r.length ? '' : html`<tr><td colspan="7" class="muted">${t('no_results')}</td></tr>`}</tbody></table></div>`;
};
Object.assign(PEP.actions, {
  resfilter: (f, d) => { const p = new URLSearchParams(Object.entries(d).filter(([, v]) => v)); PEP.go('#/admin/reservas' + (p.toString() ? '?' + p : '')); },
  'mark-paid': async el => { await PEP.post(`/reservations/${el.dataset.id}/paid`); PEP.refresh(); },
  'cancel-adm': async el => { if (!await PEP.confirm(t('cancel_booking'), t('cancel_adm_confirm'), t('yes_cancel'), true)) return; await PEP.post(`/reservations/${el.dataset.id}/cancel`); PEP.toast(t('cancelled_ok')); PEP.refresh(); },
});

/* ----- reserva asistida (teléfono/oficina) ----- */
PEP.actions.assisted = async () => {
  const st = { q: '', users: [], holder: null, facs: await PEP.get('/facilities'), fid: null, slots: [], start: null, channel: 'phone', delivery: 'print', norms: true, override: false, reason: '', chk: null, nu: false, done: null };
  st.facs = st.facs.filter(f => f.status === 'open');
  const d = PEP.dlg(async api => {
    if (st.done) { const r = st.done; const qd = await PEP.get(`/reservations/${r.id}/qr`);
      return { title: t('as.done'), body: `<div class="alert ok">${ico('check').s}<div>${esc(t('as.done_body', { n: r.holder.name }))}</div></div><div class="center mt"><div class="qrbox">${qd.svg}</div><div class="bigcode">${r.code.slice(0, 3)} ${r.code.slice(3)}</div><p>${esc(r.facility.name)} · ${esc(F.day(r.start))} ${esc(F.range(r.start, r.end))}</p></div>`,
        buttons: [{ label: t('print_qr'), onClick: () => { PEP.toast(t('printing')); setTimeout(() => window.print(), 100); } }, { label: t('close'), cls: 'sec', onClick: a => { a.close(true); PEP.refresh(); } }] }; }
    if (!st.holder) {
      if (st.nu) return { title: t('as.new_person'), body: `<form id="nuf" class="col"><div class="grid g2"><div><label for="nn">${esc(t('name'))}</label><input id="nn" name="name" required></div><div><label for="ns">${esc(t('surname'))}</label><input id="ns" name="surname"></div></div><div class="grid g2"><div><label for="ne">${esc(t('email'))}</label><input id="ne" name="email" type="email"></div><div><label for="np">${esc(t('phone'))}</label><input id="np" name="phone"></div></div><div><label for="nb">${esc(t('birth_year'))}</label><input id="nb" name="birth_year" type="number" value="1970"></div>
        <label class="check"><input type="checkbox" name="doc_checked" checked> ${esc(t('as.doc_ok'))}</label><label class="check"><input type="checkbox" name="empadronado"> ${esc(t('as.padron_ok'))}</label><label class="check"><input type="checkbox" name="reduced"> ${esc(t('as.reduced'))}</label></form>`,
        buttons: [{ label: t('back'), cls: 'sec', onClick: a => { st.nu = false; a.render(); } }, { label: t('as.create'), onClick: async a => { const f = a.el.querySelector('#nuf'); if (!f.reportValidity()) return; const fd = Object.fromEntries(new FormData(f)); st.holder = await PEP.post('/users', { ...fd, birth_year: +fd.birth_year, doc_checked: !!fd.doc_checked, empadronado: !!fd.empadronado, reduced: !!fd.reduced }); a.render(); } }] };
      st.users = await PEP.get('/users?q=' + encodeURIComponent(st.q));
      return { title: t('as.step1'), body: `<p class="hint">${esc(t('as.step1_hint'))}</p><input id="uq" data-dc="uq" value="${esc(st.q)}" placeholder="${esc(t('as.search'))}" aria-label="${esc(t('as.search'))}"><div class="col mt">${st.users.slice(0, 8).map(u => `<button class="btn sec" style="justify-content:flex-start" data-da="pick" data-id="${u.id}">${esc(u.name + ' ' + u.surname)} <span class="chip">${esc(t('lvl.' + (u.level >= 2 ? 2 : 1)))}</span>${u.empadronado ? ' <span class="chip ok">' + esc(t('verified_town')) + '</span>' : ''}${u.minor ? ' <span class="chip">' + esc(t('minor')) + '</span>' : ''}</button>`).join('')}</div>`,
        buttons: [{ label: t('close'), cls: 'sec', onClick: a => a.close(null) }, { label: t('as.new_person'), onClick: a => { st.nu = true; a.render(); } }] };
    }
    if (st.fid && !st.slots.length) { const av = await PEP.get(`/facilities/${st.fid}/slots?days=14`); st.slots = av.days.flatMap(x => x.slots.filter(s => s.state === 'free' || s.state === 'resident_only')); }
    if (st.start) st.chk = await PEP.get(`/rules/check?facility_id=${st.fid}&start=${st.start}&holder_id=${st.holder.id}`);
    const v = st.chk ? st.chk.violations.filter(x => x.code !== 'norms_not_accepted' || !st.norms) : [];
    const soft = v.length && !v.some(x => ['not_a_slot', 'past', 'taken', 'facility_closed'].includes(x.code));
    const can = st.start && (v.length === 0 || (soft && st.override && st.reason.trim().length > 2));
    return { title: t('as.title'), body: `<div class="alert info">${ico('user').s}<div><b>${esc(st.holder.name + ' ' + st.holder.surname)}</b> · ${esc(t('lvl.' + (st.holder.level >= 2 ? 2 : 1)))} <button class="btn sec sm" data-da="chg">${esc(t('as.change_person'))}</button></div></div>
      <div class="grid g2 mt"><div class="field"><label for="af">${esc(t('facility'))}</label><select id="af" data-dc="fac"><option value="">–</option>${st.facs.map(f => `<option value="${f.id}" ${f.id === st.fid ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="as">${esc(t('slot'))}</label><select id="as" data-dc="slot" ${st.fid ? '' : 'disabled'}><option value="">–</option>${st.slots.map(s => `<option value="${s.start}" ${s.start === st.start ? 'selected' : ''}>${esc(F.dt(s.start))}–${esc(F.hm(s.end))}</option>`).join('')}</select></div></div>
      <div class="grid g2"><div class="field"><label for="ac">${esc(t('channel'))}</label><select id="ac" data-dc="chan"><option value="phone" ${st.channel === 'phone' ? 'selected' : ''}>${esc(t('ch.phone'))}</option><option value="office" ${st.channel === 'office' ? 'selected' : ''}>${esc(t('ch.office'))}</option></select></div>
      <div class="field"><label for="ad">${esc(t('as.delivery'))}</label><select id="ad" data-dc="deliv">${['print', 'email', 'sms'].map(x => `<option value="${x}" ${st.delivery === x ? 'selected' : ''}>${esc(t('as.d.' + x))}</option>`).join('')}</select></div></div>
      ${st.chk ? `<p class="small"><b>${esc(t('tariff'))}:</b> ${esc(F.money(st.chk.tariff.price))} · ${esc(t('tariff.' + st.chk.tariff.name))}</p>` : ''}
      <label class="check"><input type="checkbox" data-dc="norms" ${st.norms ? 'checked' : ''}> ${esc(t('as.norms'))}</label>
      ${v.map(x => `<div class="alert bad mt">${ico('alert').s}<div>${esc(PEP.vText(x))}</div></div>`).join('')}
      ${soft ? `<div class="card flat mt"><label class="check"><input type="checkbox" data-dc="ovr" ${st.override ? 'checked' : ''}> ${esc(t('as.override'))}</label>${st.override ? `<label for="ar" class="mt">${esc(t('as.reason'))}</label><input id="ar" data-dc="reason" value="${esc(st.reason)}" required>` : ''}</div>` : ''}`,
      buttons: [{ label: t('cancel_btn'), cls: 'sec', onClick: a => a.close(null) }, { label: t('confirm_booking'), disabled: !can, onClick: async a => {
        st.done = await PEP.post('/reservations', { facility_id: st.fid, start: st.start, holder_id: st.holder.id, channel: st.channel, accept_norms: st.norms, override: st.override, reason: st.reason, delivery: st.delivery }); a.render(); } }] };
  });
  d.handlers.uq = async (el, a) => { st.q = el.value; const pos = el.selectionStart; await a.render(); const i = a.el.querySelector('#uq'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } };
  d.handlers.pick = async (el, a) => { st.holder = st.users.find(u => u.id === +el.dataset.id); a.render(); };
  d.handlers.chg = async (el, a) => { st.holder = null; st.fid = null; st.start = null; st.slots = []; st.chk = null; a.render(); };
  d.handlers.fac = async (el, a) => { st.fid = +el.value || null; st.slots = []; st.start = null; st.chk = null; a.render(); };
  d.handlers.slot = async (el, a) => { st.start = +el.value || null; st.chk = null; a.render(); };
  d.handlers.chan = (el) => { st.channel = el.value; }; d.handlers.deliv = el => { st.delivery = el.value; };
  d.handlers.norms = async (el, a) => { st.norms = el.checked; a.render(); }; d.handlers.ovr = async (el, a) => { st.override = el.checked; a.render(); };
  d.handlers.reason = (el, a) => { st.reason = el.value; const b = a.el.querySelectorAll('.df .btn'); b[b.length - 1].disabled = !(st.override && st.reason.trim().length > 2); };
  return d.result;
};

/* ----- persoas ----- */
ADMIN.persoas = async () => {
  const q = PEP.query.q || ''; const us = await PEP.get('/users?q=' + encodeURIComponent(q));
  return html`<div class="row sp mb"><form class="row" data-form="usearch"><label class="sr" for="uq2">${t('as.search')}</label><input id="uq2" name="q" value="${q}" placeholder="${t('as.search')}" style="min-width:16rem"><button class="btn sm" type="submit">${t('filter')}</button></form><button class="btn" data-act="newperson">${ico('plus')} ${t('as.new_person')}</button></div>
  <p class="hint">${t('padron_hint')}</p><div class="tablewrap"><table><thead><tr><th>${t('person')}</th><th>${t('identity')}</th><th>${t('padron')}</th><th>${t('reduced')}</th><th>Club</th></tr></thead><tbody>
  ${us.map(u => html`<tr><td><b>${u.name} ${u.surname}</b>${u.minor ? html` <span class="chip">${t('minor')}</span>` : ''}<br><span class="hint">${u.email || ''}</span></td><td>${u.level >= 2 ? html`<span class="chip ok">${t('lvl.2')}</span> ${u.id_method ? t('via.' + u.id_method) : ''}` : html`<span class="chip warn">${t('lvl.1')}</span> <button class="btn sec sm" data-act="user-l2" data-id="${u.id}">${t('as.doc_ok')}</button>`}</td>
  ${['empadronado', 'reduced', 'club'].map(k => html`<td><label class="check"><input type="checkbox" data-act="user-flag" data-id="${u.id}" data-k="${k}" ${u[k] ? 'checked' : ''} aria-label="${k}"></label></td>`)}</tr>`)}</tbody></table></div>`;
};
Object.assign(PEP.actions, {
  usearch: (f, d) => PEP.go('#/admin/persoas' + (d.q ? '?q=' + encodeURIComponent(d.q) : '')),
  'user-flag': async el => { await PEP.patch('/users/' + el.dataset.id, { [el.dataset.k]: el.checked }); PEP.toast(t('saved')); },
  'user-l2': async el => { await PEP.patch('/users/' + el.dataset.id, { level: 2 }); PEP.refresh(); },
  newperson: async () => { PEP.actions.assisted(); },
});

/* ----- instalacións ----- */
ADMIN.instalacions = async () => {
  const fs = await PEP.get('/facilities');
  return html`<div class="row sp mb"><p class="muted" style="margin:0">${t('fac.hint')}</p><div class="row"><button class="btn" data-act="fac-edit" data-id="new">${ico('plus')} ${t('fac.new')}</button></div></div>
  <div class="tablewrap"><table><thead><tr><th>${t('facility')}</th><th>${t('access')}</th><th>${t('door.fac') && t('hours')}</th><th>${t('prices')}</th><th>${t('status')}</th><th></th></tr></thead><tbody>
  ${fs.map(f => html`<tr><td><b>${f.name}</b>${f.parent_id ? html` <span class="chip">${t('part')}</span>` : ''}<br><span class="hint">${t('sport.' + f.sport)} · ${f.slot_minutes} min</span></td><td>${PEP.accessLabel(f.access_mode)}${f.device_id ? html`<br><span class="hint mono">${f.device_id}</span>` : ''}</td>
   <td class="small">${f.schedule.winter[0] ? f.schedule.winter[0].join('–') : '–'} / ${f.schedule.winter[5] ? f.schedule.winter[5].join('–') : '–'}</td><td class="small">${Object.entries(f.prices).map(([k, v]) => html`${t('tariff.' + k)}: ${F.money(v)}<br>`)}</td>
   <td>${f.status === 'open' ? html`<span class="chip ok">${t('open')}</span>` : html`<span class="chip bad">${t('closed')}</span><br><span class="hint">${f.closed_reason || ''}</span>`}</td>
   <td class="row"><button class="btn sec sm" data-act="fac-edit" data-id="${f.id}">${t('edit')}</button>${f.status === 'open' ? html`<button class="btn danger sm" data-act="fac-close" data-id="${f.id}">${t('fac.close')}</button>` : html`<button class="btn sm" data-act="fac-reopen" data-id="${f.id}">${t('fac.reopen')}</button>`}</td></tr>`)}</tbody></table></div>`;
};
const RULE_KEYS = ['window_days', 'padron_early_days', 'max_pending', 'max_week', 'max_day', 'cooldown_hours', 'cancel_hours', 'strike_threshold', 'ban_days'];
PEP.actions['fac-edit'] = async el => {
  const isNew = el.dataset.id === 'new'; const f = isNew ? { name: '', sport: 'padel', description: '', access_mode: 'staff', slot_minutes: 60, min_level: 1, allow_minors: 0, light_auto: 0, prices: { general: 0 }, rules: {}, schedule: { winter: { 0: ['09:00', '22:00'], 5: ['10:00', '21:00'] }, summer: { 0: ['09:00', '22:00'], 5: ['10:00', '21:00'] } }, closed_dates: [], accessibility: '', norms: '' } : await PEP.get('/facilities/' + el.dataset.id);
  const g = (s, d) => (f.schedule[s] && f.schedule[s][d]) || ['', ''];
  const inp = (id, label, val, type = 'text', extra = '') => `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" value="${esc(val ?? '')}" ${extra}></div>`;
  const d = PEP.dlg(async () => ({ title: isNew ? t('fac.new') : f.name, body: `
    <div class="grid g2">${inp('fn', t('name'), f.name, 'text', 'required')}<div class="field"><label for="fs">${esc(t('sport'))}</label><select id="fs">${['padel', 'pavillon', 'fronton', 'futbol', 'tenis', 'polideportiva', 'other'].map(s => `<option value="${s}" ${f.sport === s ? 'selected' : ''}>${esc(t('sport.' + s))}</option>`).join('')}</select></div></div>
    ${inp('fd', t('description'), f.description)}
    <div class="grid g3"><div class="field"><label for="fm">${esc(t('access'))}</label><select id="fm"><option value="staff" ${f.access_mode === 'staff' ? 'selected' : ''}>${esc(t('am.staff'))}</option><option value="door" ${f.access_mode === 'door' ? 'selected' : ''}>${esc(t('am.door'))}</option><option value="keybox" disabled>${esc(t('am.keybox'))} (${esc(t('roadmap'))})</option></select></div>
    ${inp('fsl', t('slot_min'), f.slot_minutes, 'number', 'min="30" step="15"')}<div class="field"><label for="fl">${esc(t('min_level'))}</label><select id="fl"><option value="1" ${f.min_level == 1 ? 'selected' : ''}>${esc(t('lvl.1'))}</option><option value="2" ${f.min_level == 2 ? 'selected' : ''}>${esc(t('lvl.2'))}</option></select></div></div>
    <div class="row"><label class="check"><input type="checkbox" id="fam" ${f.allow_minors ? 'checked' : ''}> ${esc(t('allow_minors'))}</label><label class="check"><input type="checkbox" id="fla" ${f.light_auto ? 'checked' : ''}> ${esc(t('light_auto'))}</label></div>
    <h3 class="mt">${esc(t('prices'))} (€)</h3><div class="grid g4">${['general', 'padron', 'reduced', 'club'].map(k => inp('fp-' + k, t('tariff.' + k), f.prices[k] ?? '', 'number', 'min="0" step="0.5"')).join('')}</div>
    <h3 class="mt">${esc(t('schedule'))}</h3><p class="hint">${esc(t('schedule_hint'))}</p>
    ${['winter', 'summer'].map(s => `<div class="row" style="margin:.3rem 0"><b style="min-width:6rem">${esc(t('season_' + s))}</b><span>${esc(t('weekdays'))}</span><input type="time" id="sc-${s}-w0" value="${g(s, 0)[0]}" aria-label="${esc(t('open'))}" style="width:8rem"><input type="time" id="sc-${s}-w1" value="${g(s, 0)[1]}" aria-label="${esc(t('close'))}" style="width:8rem"><span>${esc(t('weekend'))}</span><input type="time" id="sc-${s}-e0" value="${g(s, 5)[0]}" style="width:8rem" aria-label="${esc(t('open'))}"><input type="time" id="sc-${s}-e1" value="${g(s, 5)[1]}" style="width:8rem" aria-label="${esc(t('close'))}"></div>`).join('')}
    <div class="field mt"><label for="fcd">${esc(t('closed_dates'))}</label><textarea id="fcd" rows="2" placeholder="2026-12-24">${esc((f.closed_dates || []).join('\n'))}</textarea></div>
    <h3>${esc(t('rule_overrides'))}</h3><p class="hint">${esc(t('rule_overrides_hint'))}</p><div class="grid g4">${RULE_KEYS.map(k => inp('fr-' + k, t('rk.' + k), f.rules[k] ?? '', 'number', `placeholder="${f.effective_rules ? f.effective_rules[k] : ''}"`)).join('')}</div>
    ${inp('fa', t('accessibility'), f.accessibility)}${inp('fno', t('norms'), f.norms)}`,
    buttons: [{ label: t('cancel_btn'), cls: 'sec', onClick: a => a.close(null) }, { label: t('save'), onClick: async a => {
      const q = id => a.el.querySelector('#' + id); const nv = id => q(id).value === '' ? null : +q(id).value;
      const prices = {}; ['general', 'padron', 'reduced', 'club'].forEach(k => { if (q('fp-' + k).value !== '') prices[k] = +q('fp-' + k).value; }); if (!('general' in prices)) prices.general = 0;
      const sch = {}; ['winter', 'summer'].forEach(s => { const w = [q(`sc-${s}-w0`).value, q(`sc-${s}-w1`).value], e = [q(`sc-${s}-e0`).value, q(`sc-${s}-e1`).value]; sch[s] = {}; for (let i = 0; i < 7; i++) { const x = i < 5 ? w : e; if (x[0] && x[1]) sch[s][i] = x; } });
      const rules = {}; RULE_KEYS.forEach(k => { const v = nv('fr-' + k); if (v !== null) rules[k] = v; });
      const body = { name: q('fn').value, sport: q('fs').value, description: q('fd').value, access_mode: q('fm').value, slot_minutes: +q('fsl').value, min_level: +q('fl').value, allow_minors: q('fam').checked, light_auto: q('fla').checked, prices, schedule: sch, rules, closed_dates: q('fcd').value.split(/\s+/).filter(Boolean), accessibility: q('fa').value, norms: q('fno').value };
      if (!body.name) return PEP.toast(t('name'), true);
      isNew ? await PEP.post('/facilities', body) : await PEP.put('/facilities/' + f.id, body); a.close(true); PEP.toast(t('saved')); PEP.refresh(); } }] }));
};
PEP.actions['fac-close'] = async el => {
  const reason = prompt(t('fac.close_reason'), t('fac.close_default')); if (reason === null) return;
  const r = await PEP.post(`/facilities/${el.dataset.id}/close`, { reason }); PEP.toast(t('fac.closed_n', { n: r.cancelled })); PEP.refresh();
};
PEP.actions['fac-reopen'] = async el => { await PEP.post(`/facilities/${el.dataset.id}/reopen`); PEP.refresh(); };

/* ----- regras do concello ----- */
ADMIN.regras = async () => {
  const tn = await PEP.get('/tenant'); const r = tn.rules;
  return html`<p class="muted">${t('rules_intro')}</p>
  <form data-form="rules" class="card"><div class="grid g3">${RULE_KEYS.map(k => html`<div class="field"><label for="k-${k}">${t('rk.' + k)}</label><input id="k-${k}" name="${k}" type="number" min="0" value="${r[k]}"><span class="hint">${t('rkh.' + k)}</span></div>`)}</div>
  <label class="check"><input type="checkbox" name="no_consecutive" ${r.no_consecutive ? 'checked' : ''}> ${t('rk.no_consecutive')}</label><div class="mt"><button class="btn" type="submit">${t('save')}</button></div></form>
  <p class="hint mt">${t('rules_note')}</p>`;
};
PEP.actions.rules = async (f, d) => { const o = {}; RULE_KEYS.forEach(k => o[k] = +d[k]); o.no_consecutive = !!d.no_consecutive; await PEP.put('/tenant', { config: {}, rules: o }); PEP.toast(t('saved')); };

/* ----- tempadas ----- */
ADMIN.tempadas = async () => {
  const [ss, fs, us] = await Promise.all([PEP.get('/seasons'), PEP.get('/facilities'), PEP.get('/users?q=')]);
  const clubs = us.filter(u => u.club);
  return html`<p class="muted">${t('season_hint')}</p>
  <form data-form="season" class="card"><div class="grid g3"><div class="field"><label for="sf">${t('facility')}</label><select id="sf" name="facility_id">${fs.map(f => html`<option value="${f.id}">${f.name}</option>`)}</select></div>
  <div class="field"><label for="su">${t('season_club')}</label><select id="su" name="user_id">${clubs.map(c => html`<option value="${c.id}">${c.name} ${c.surname}</option>`)}</select></div>
  <div class="field"><label for="sw">${t('weekday')}</label><select id="sw" name="weekday">${[0, 1, 2, 3, 4, 5, 6].map(i => html`<option value="${i}">${t('wd.' + i)}</option>`)}</select></div>
  <div class="field"><label for="sh">${t('start_time')}</label><input id="sh" name="start_hm" type="time" value="20:00" required></div>
  <div class="field"><label for="sd1">${t('date_from')}</label><input id="sd1" name="date_from" type="date" value="${F.ymd(S.meta.now)}" required></div>
  <div class="field"><label for="sd2">${t('date_to')}</label><input id="sd2" name="date_to" type="date" value="${F.ymd(S.meta.now + 60 * 86400)}" required></div></div>
  <div class="field"><label for="sl">${t('label')}</label><input id="sl" name="label"></div><button class="btn" type="submit">${t('season_create')}</button></form>
  <h2 class="mt">${t('tab.tempadas')}</h2><div class="tablewrap"><table><thead><tr><th>${t('facility')}</th><th>${t('person')}</th><th>${t('weekday')}</th><th>${t('time')}</th><th>${t('period')}</th><th>${t('label')}</th></tr></thead><tbody>${ss.map(s => html`<tr><td>${s.facility}</td><td>${s.uname} ${s.usurname}</td><td>${t('wd.' + s.weekday)}</td><td>${s.start_hm}</td><td>${s.date_from} → ${s.date_to}</td><td>${s.label}</td></tr>`)}</tbody></table></div>`;
};
PEP.actions.season = async (f, d) => { const r = await PEP.post('/seasons', { ...d, facility_id: +d.facility_id, user_id: +d.user_id, weekday: +d.weekday }); PEP.toast(t('season_done', { a: r.created, b: r.skipped.length })); PEP.refresh(); };

/* ----- normas ----- */
ADMIN.normas = async () => {
  const ns = await PEP.get('/norms');
  return html`<p class="muted">${t('norms_hint')}</p><div class="tablewrap"><table><thead><tr><th>v</th><th>${t('date')}</th><th>${t('text')}</th><th>${t('accepted')}</th></tr></thead><tbody>${ns.map(n => html`<tr><td><b>${n.version}</b></td><td>${F.dayS(n.ts)}</td><td class="small">${S.lang === 'es' ? n.text_es : n.text_gl}</td><td>${n.accepted}</td></tr>`)}</tbody></table></div>
  <form data-form="norm" class="card mt"><h3>${t('norms_new')}</h3><div class="field"><label for="ng">Galego</label><textarea id="ng" name="text_gl" rows="3" required></textarea></div><div class="field"><label for="ne2">Castellano</label><textarea id="ne2" name="text_es" rows="3" required></textarea></div><button class="btn" type="submit">${t('norms_publish')}</button><p class="hint">${t('norms_publish_hint')}</p></form>`;
};
PEP.actions.norm = async (f, d) => { const r = await PEP.post('/norms', d); PEP.toast(t('norms_published', { v: r.version })); await PEP.reloadMeta(); PEP.refresh(); };

/* ----- accesos / incidencias / dispositivos ----- */
ADMIN.accesos = async () => {
  const fid = PEP.query.f; const [a, fs] = await Promise.all([PEP.get('/access?limit=150' + (fid ? '&facility_id=' + fid : '')), PEP.get('/facilities')]);
  return html`<form class="row mb" data-form="accfilter"><label class="sr" for="af2">${t('facility')}</label><select id="af2" name="f"><option value="">${t('all_fac')}</option>${fs.map(f => html`<option value="${f.id}" ${String(f.id) === fid ? 'selected' : ''}>${f.name}</option>`)}</select><button class="btn sm" type="submit">${t('filter')}</button></form>
  <div class="tablewrap"><table><thead><tr><th>${t('date')}</th><th>${t('facility')}</th><th>${t('person')}</th><th>${t('medium')}</th><th>${t('result')}</th><th>${t('actor')}</th></tr></thead><tbody>${a.map(x => html`<tr><td>${F.dt(x.ts)}</td><td>${x.facility}</td><td>${x.who || '–'}</td><td>${t('med.' + x.medium)}</td><td>${x.result === 'ok' ? html`<span class="chip ok">✓ ${x.reason && x.reason !== 'ok' ? t('dr.' + x.reason) : ''}</span>` : html`<span class="chip bad">✕ ${t('dr.' + x.reason)}</span>`}</td><td class="small">${x.actor}</td></tr>`)}</tbody></table></div>`;
};
PEP.actions.accfilter = (f, d) => PEP.go('#/admin/accesos' + (d.f ? '?f=' + d.f : ''));
ADMIN.incidencias = async () => html`<p class="muted">${t('inc_hint')}</p>${await incidentsView()}`;
ADMIN.dispositivos = async () => html`<p class="muted">${t('dev_hint')}</p>${await devicesView()}`;

/* ----- datos ----- */
ADMIN.datos = async () => {
  const au = await PEP.get('/audit');
  const kinds = ['reservations', 'access', 'facilities', 'users', 'incidents'];
  return html`<div class="grid g2"><section class="card"><h2>${ico('down')} ${t('export_title')}</h2><p class="small">${t('export_hint')}</p>${kinds.map(k => html`<div class="row" style="margin:.3rem 0"><b style="min-width:7rem">${t('exp.' + k)}</b><button class="btn sec sm" data-act="export" data-k="${k}" data-f="csv">CSV</button><button class="btn sec sm" data-act="export" data-k="${k}" data-f="json">JSON</button></div>`)}</section>
  <section class="card"><h2>${t('import_title')}</h2><p class="small">${t('import_hint')}</p><form data-form="import"><textarea name="csv" rows="6" class="mono" aria-label="CSV">name,sport,access_mode,slot_minutes,open,close,price_general,price_padron,min_level\nPista de tenis,tenis,door,60,09:00,21:00,3,1.5,2\nSala polivalente,other,staff,60,10:00,20:00,0,,1</textarea><button class="btn mt" type="submit">${t('import_btn')}</button></form></section></div>
  <section class="card mt"><h2>${t('audit_title')}</h2><div class="tablewrap"><table><thead><tr><th>${t('date')}</th><th>${t('actor')}</th><th>${t('action')}</th><th>${t('details')}</th></tr></thead><tbody>${au.map(a => html`<tr><td>${F.dt(a.ts)}</td><td>${a.name || ''} ${a.surname || ''}</td><td class="mono small">${a.action}</td><td class="mono small">${a.detail}</td></tr>`)}</tbody></table></div></section>`;
};
Object.assign(PEP.actions, {
  export: el => PEP.download(`/export/${el.dataset.k}.${el.dataset.f}`, `${el.dataset.k}.${el.dataset.f}`),
  import: async (f, d) => { const r = await PEP.post('/import/facilities', { csv: d.csv }); PEP.toast(t('imported', { n: r.imported })); PEP.refresh(); },
});

/* ----- concello (configuración propia) ----- */
ADMIN.concello = async () => {
  const c = (await PEP.get('/tenant')).config; const m = S.meta;
  return html`<p class="muted">${t('tenant_hint')}</p>
  <form data-form="tenant" class="card"><div class="grid g2"><div class="field"><label for="tn">${t('name')}</label><input id="tn" name="name" value="${c.name}" required></div><div class="field"><label for="ts">${t('short')}</label><input id="ts" name="short" value="${c.short}"></div>
  <div class="field"><label for="tc">${t('color')}</label><input id="tc" name="color" type="color" value="${c.color}"></div><div class="field"><label for="ta">${t('accent')}</label><input id="ta" name="accent" type="color" value="${c.accent}"></div>
  <div class="field"><label for="te">${t('email')}</label><input id="te" name="email" value="${c.email}"></div><div class="field"><label for="tp">${t('phone')}</label><input id="tp" name="phone" value="${c.phone}"></div>
  <div class="field"><label for="td">${t('domain')}</label><input id="td" name="domain" value="${c.domain}"></div><div class="field"><label for="tl">${t('default_lang')}</label><select id="tl" name="default_lang"><option value="gl" ${c.default_lang === 'gl' ? 'selected' : ''}>Galego</option><option value="es" ${c.default_lang === 'es' ? 'selected' : ''}>Castellano</option></select></div>
  <div class="field"><label for="tr">${t('retention')}</label><input id="tr" name="retention_days" type="number" value="${c.retention_days}"></div><div class="field"><label for="th">${t('holidays')}</label><input id="th" name="holidays" value="${c.holidays.join(', ')}"><span class="hint">YYYY-MM-DD</span></div></div>
  <div class="field"><label for="tlg">${t('legal')} (Galego)</label><textarea id="tlg" name="legal_gl" rows="3">${c.legal_gl}</textarea></div><div class="field"><label for="tle">${t('legal')} (Castellano)</label><textarea id="tle" name="legal_es" rows="3">${c.legal_es}</textarea></div><button class="btn" type="submit">${t('save')}</button></form>
  <section class="card flat mt"><h3>${t('multi_title')}</h3><p class="small">${t('multi_body')}</p><p class="small"><b>${t('pubkey')}:</b> <span class="mono" style="word-break:break-all">${m.pubkey}</span></p></section>`;
};
PEP.actions.tenant = async (f, d) => { const cfg = { ...d, retention_days: +d.retention_days, holidays: d.holidays.split(/[\s,]+/).filter(Boolean) }; await PEP.put('/tenant', { config: cfg }); await PEP.reloadMeta(); PEP.renderAll(); PEP.toast(t('saved')); };

/* =========================================================== GUÍA DE DEMO */
PEP.route(/^\/demo$/, async () => {
  const [ps, ds] = await Promise.all([PEP.get('/auth/personas'), PEP.get('/facilities')]);
  const doors = ds.filter(f => f.device_id);
  const cit = ps.filter(p => p.role === 'citizen'); const staff = ps.filter(p => p.role !== 'citizen');
  const step = (n, title, body, links) => html`<li class="card flat" style="margin:.6rem 0"><div class="row sp"><div><b>${n}. ${title}</b><p class="small" style="margin:.2rem 0">${body}</p></div><div class="row">${links}</div></li>`;
  return html`<h1>${t('demo.title')}</h1><p class="muted" style="max-width:70ch">${t('demo.intro')}</p>
  <div class="grid g2">
  <section class="card"><h2>${t('demo.script')}</h2><ol style="list-style:none;padding:0;margin:0">
    ${step(1, t('ds.1.t'), t('ds.1.b'), html`<a class="btn sm" href="#/">${t('go')}</a>`)}
    ${step(2, t('ds.2.t'), t('ds.2.b'), html`<a class="btn sm" href="#/login">${t('go')}</a>`)}
    ${step(3, t('ds.3.t'), t('ds.3.b'), html`<a class="btn sm" href="#/f/2">${t('go')}</a>`)}
    ${step(4, t('ds.4.t'), t('ds.4.b'), html`<a class="btn sm" href="#/mine">${t('go')}</a>`)}
    ${step(5, t('ds.5.t'), t('ds.5.b'), html`<a class="btn sm" href="#/validar">${t('go')}</a>`)}
    ${step(6, t('ds.6.t'), t('ds.6.b'), html`<a class="btn sm" href="#/admin/reservas">${t('go')}</a>`)}
    ${step(7, t('ds.7.t'), t('ds.7.b'), doors.slice(0, 1).map(f => html`<a class="btn sm" href="#/door/${f.device_id}" target="_blank" rel="noopener">${t('open_sim')}</a>`))}
    ${step(8, t('ds.8.t'), t('ds.8.b'), html`<a class="btn sm" href="#/formacion">${t('go')}</a>`)}
    ${step(9, t('ds.9.t'), t('ds.9.b'), html`<a class="btn sm" href="#/admin">${t('go')}</a>`)}</ol></section>
  <div class="col">
    <section class="card"><h2>${t('demo.roles')}</h2><p class="hint">${t('demo.roles_hint')}</p><h3>${t('role.citizen')}</h3><div>${cit.map(p => html`<button class="btn sec sm" data-act="login-demo2" data-id="${p.id}" style="margin:.15rem">${p.name}${p.minor ? ' (' + t('minor') + ')' : ''} · ${t('lvl.' + (p.level >= 2 ? 2 : 1))}</button>`)}</div>
      <h3 class="mt">${t('demo.staff')}</h3><div>${staff.map(p => html`<button class="btn sec sm" data-act="login-demo2" data-id="${p.id}" style="margin:.15rem">${p.name} · ${t('role.' + p.role)}</button>`)}</div></section>
    <section class="card"><h2>${ico('clock')} ${t('demo.clock')}</h2><p class="hint">${t('demo.clock_hint')}</p><div class="row"><button class="btn sec sm" data-act="clock-add" data-m="60">+1 h</button><button class="btn sec sm" data-act="clock-add" data-m="1440">+1 ${t('day')}</button><button class="btn sec sm" data-act="clock-add" data-m="-60">−1 h</button><button class="btn sec sm" data-act="clock-reset">${t('demo.reset_clock')}</button></div>
      <h3 class="mt">${t('demo.data')}</h3><button class="btn danger sm" data-act="reset-data">${t('demo.reset_data')}</button></section>
    <section class="card"><h2>${t('demo.links')}</h2><ul class="small" style="padding-left:1.1rem"><li><a href="/api/docs" target="_blank" rel="noopener">${t('demo.api')} (OpenAPI)</a></li>${doors.map(f => html`<li><a href="#/door/${f.device_id}" target="_blank" rel="noopener">${t('demo.sim')}: ${f.name} (<span class="mono">${f.device_id}</span>)</a></li>`)}<li>${t('demo.mqtt_topics')} <span class="mono">pista/${S.tenant}/&lt;porta&gt;/{cache,revoke,cmd,events,status}</span></li></ul></section>
  </div></div>
  <section class="card mt"><h2>${t('demo.real_title')}</h2><div class="tablewrap"><table><thead><tr><th>${t('demo.item')}</th><th>${t('demo.in_demo')}</th><th>${t('demo.in_prod')}</th></tr></thead><tbody>
   ${['clave', 'cert', 'otp', 'passkey', 'mail', 'door', 'odoo', 'pay'].map(k => html`<tr><td><b>${t('rv.' + k + '.0')}</b></td><td>${t('rv.' + k + '.1')}</td><td>${t('rv.' + k + '.2')}</td></tr>`)}</tbody></table></div></section>`;
});
Object.assign(PEP.actions, {
  'login-demo2': async el => { const r = await PEP.post('/auth/demo', { user_id: +el.dataset.id }); PEP.setSession(r.token, r.user); await PEP.loadUser(); PEP.renderAll(); PEP.toast(t('logged_as', { n: r.user.name })); },
  'clock-add': async el => { await PEP.post('/demo/clock', { add_minutes: +el.dataset.m }); await PEP.reloadMeta(); PEP.refresh(); },
  'reset-data': async () => { if (!await PEP.confirm(t('demo.reset_data'), t('demo.reset_confirm'), t('demo.reset_data'), true)) return; await PEP.post('/demo/reset'); PEP.setSession(null, null); await PEP.reloadMeta(); PEP.renderAll(); PEP.toast(t('demo.reset_done')); },
});
})();
