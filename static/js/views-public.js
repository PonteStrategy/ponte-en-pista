/* SPDX-License-Identifier: AGPL-3.0-or-later */
'use strict';
(() => {
const { S, html, raw, esc, ico, t, F, $, $$ } = PEP;

/* ---------- diálogo con estado ---------- */
PEP.dlg = function (renderFn) {
  const d = document.createElement('dialog'); document.body.append(d);
  const api = { el: d, handlers: {}, close(v) { d.close(); d.remove(); if (api._res) api._res(v); } };
  api.result = new Promise(r => { api._res = r; });
  api.render = async () => {
    const o = await renderFn(api);
    d.setAttribute('aria-labelledby', 'dlg-t');
    d.innerHTML = `<div class="dh"><h2 id="dlg-t" style="margin:0">${esc(o.title)}</h2><button class="btn sec sm" data-d="__x" aria-label="${esc(t('close'))}">${ico('x').s}</button></div><div class="db">${o.body}</div><div class="df">${(o.buttons || []).map((b, i) => `<button class="btn ${b.cls || ''}" data-d="${i}" ${b.disabled ? 'disabled' : ''}>${esc(b.label)}</button>`).join('')}</div>`;
    api.buttons = o.buttons || [];
  };
  d.addEventListener('click', async e => {
    const b = e.target.closest('[data-d]'); const a = e.target.closest('[data-da]');
    try {
      if (b) { if (b.dataset.d === '__x') return api.close(null); const bt = api.buttons[+b.dataset.d]; if (bt && bt.onClick) await bt.onClick(api); }
      else if (a && api.handlers[a.dataset.da]) { e.preventDefault(); await api.handlers[a.dataset.da](a, api); }
    } catch (er) { PEP.fail(er); }
  });
  d.addEventListener('change', async e => { const a = e.target.closest('[data-dc]'); if (a && api.handlers[a.dataset.dc]) { try { await api.handlers[a.dataset.dc](a, api); } catch (er) { PEP.fail(er); } } });
  d.addEventListener('cancel', () => { d.remove(); api._res(null); });
  api.render().then(() => { d.showModal(); const f = d.querySelector('select,input,button.btn:not(.sec)'); if (f) f.focus(); });
  return api;
};

/* ---------- catálogo ---------- */
function freeLine(f) {
  if (f.status !== 'open') return html`<span class="chip bad">${ico('alert')} ${t('closed')}${f.closed_reason ? ': ' + f.closed_reason : ''}</span>`;
  if (!f.next_free) return html`<span class="chip warn">${t('full_week')}</span>`;
  const now = S.meta.now, d0 = n => F.ymd(n);
  const when = d0(f.next_free) === d0(now) ? t('today') : d0(f.next_free) === d0(now + 86400) ? t('tomorrow') : F.dayS(f.next_free);
  return html`<span class="chip ok">${ico('check')} ${t('free_from', { when, time: F.hm(f.next_free) })}</span>`;
}
const levelChip = l => l >= 2 ? html`<span class="chip info" title="${t('lvl.2.long')}">${t('lvl.2')}</span>` : html`<span class="chip">${t('lvl.1')}</span>`;
const priceChip = f => {
  if (f.tariff) return html`<span class="chip">${F.money(f.tariff.price)} · ${t('tariff.' + f.tariff.name)}</span>`;
  const g = f.prices.general || 0; return html`<span class="chip">${g ? t('from_price', { p: F.money(Math.min(...Object.values(f.prices))) }) : t('free')}</span>`;
};

PEP.route(/^\/$/, async () => {
  const fs = await PEP.get('/facilities');
  const top = fs.filter(f => !f.parent_id);
  const sports = [...new Set(top.map(f => f.sport))];
  const sel = PEP.query.sport || '';
  const list = top.filter(f => !sel || f.sport === sel);
  const c = S.meta.config;
  return html`
  <section class="hero" aria-labelledby="hero-t">
    <div><h1 id="hero-t">${t('hero.title')}</h1><p>${t('hero.sub', { name: c.name })}</p>
      <div class="row"><a class="btn" style="background:#fff;color:var(--brand);border-color:#fff" href="#/demo">${t('hero.cta_demo')}</a>
      ${!S.user ? html`<a class="btn sec" style="color:#fff;border-color:#fff" href="#/login">${t('login')}</a>` : ''}</div></div>
    <div class="steps"><div>${ico('cal')} ${t('hero.s1')}</div><div>${ico('qr')} ${t('hero.s2')}</div><div>${ico('door')} ${t('hero.s3')}</div></div>
  </section>
  <div class="row sp mb"><h2 style="margin:0">${t('facilities')}</h2>
    <div class="row" role="group" aria-label="${t('filter_sport')}"><a class="chip ${sel ? '' : 'info'}" href="#/">${t('all')}</a>${sports.map(s => html`<a class="chip ${sel === s ? 'info' : ''}" href="#/?sport=${s}">${t('sport.' + s)}</a>`)}</div></div>
  <div class="grid g3">${list.map(f => html`
    <article class="card flat" aria-labelledby="f${f.id}">
      <div class="row" style="gap:.5rem;margin-bottom:.4rem"><span class="logo" style="background:var(--signal-soft);color:var(--signal-ink)">${PEP.sportIcon(f.sport)}</span>
        <div><h3 id="f${f.id}" style="margin:0"><a href="#/f/${f.id}" style="color:inherit;text-decoration:none">${f.name}</a></h3><span class="small muted">${f.description}</span></div></div>
      <div class="row" style="margin:.5rem 0">${freeLine(f)}</div>
      <div class="row" style="gap:.35rem"><span class="chip">${ico(f.access_mode === 'door' ? 'door' : 'staff')} ${PEP.accessLabel(f.access_mode)}</span>${levelChip(f.min_level)}${priceChip(f)}</div>
      ${f.parts.length ? html`<p class="small mt">${t('parts')}: ${fs.filter(x => f.parts.includes(x.id)).map(x => html`<a href="#/f/${x.id}">${x.name.replace(/^.*· /, '')}</a> `)}</p>` : ''}
      <div class="mt"><a class="btn sm" href="#/f/${f.id}">${t('see_slots')}</a></div>
    </article>`)}</div>`;
});

/* ---------- instalación ---------- */
PEP.route(/^\/f\/(\d+)$/, async id => {
  const w = +(PEP.query.w || 0);
  const f = await PEP.get('/facilities/' + id);
  const start = S.meta.now + w * 7 * 86400;
  const [av, rec, all] = await Promise.all([PEP.get(`/facilities/${id}/slots?start=${start}&days=7`), PEP.get('/stats/recommend?facility_id=' + id), PEP.get('/facilities')]);
  const days = av.days;
  const times = [...new Set(days.flatMap(d => d.slots.map(s => F.hm(s.start))))].sort();
  const cell = (d, hm) => {
    const s = d.slots.find(x => F.hm(x.start) === hm);
    if (!s) return `<div class="slot none" aria-hidden="true">·</div>`;
    const lbl = `${F.day(s.start)}, ${F.range(s.start, s.end)}`;
    const txt = { free: t('slot.free'), taken: t('slot.taken'), mine: t('slot.mine'), past: '–', beyond: '·', closed: t('closed'), resident_only: t('slot.res') }[s.state];
    const dis = !['free', 'mine', 'taken'].includes(s.state) || (s.state === 'taken' && s.season);
    return `<button class="slot ${s.state}" ${dis ? 'aria-disabled="true"' : ''} data-act="slot" data-fid="${f.id}" data-start="${s.start}" data-state="${s.state}" ${s.reservation_id ? `data-rid="${s.reservation_id}"` : ''} aria-label="${esc(lbl + ': ' + t('slotl.' + s.state))}" title="${esc(lbl)}">${esc(txt)}</button>`;
  };
  const parent = f.parent_id ? all.find(x => x.id === f.parent_id) : f;
  const family = [parent, ...all.filter(x => x.parent_id === parent.id)];
  const r = f.effective_rules;
  const hrs = f.schedule.winter;
  const sch = [0, 1, 2, 3, 4, 5, 6].map(i => hrs[i] ? hrs[i].join('–') : t('closed'));
  const prices = Object.entries(f.prices);
  return html`
  <p class="small"><a href="#/">← ${t('facilities')}</a></p>
  <div class="row sp"><div class="row"><span class="logo" style="background:var(--signal-soft);color:var(--signal-ink);width:48px;height:48px">${PEP.sportIcon(f.sport)}</span>
    <div><h1 style="margin:0">${f.name}</h1><p class="muted" style="margin:0">${f.description}</p></div></div>
    <div class="row">${freeLine(f)}<span class="chip">${ico(f.access_mode === 'door' ? 'door' : 'staff')} ${PEP.accessLabel(f.access_mode)}</span>${levelChip(f.min_level)}</div></div>
  ${family.length > 1 ? html`<div class="tabs mt" role="tablist">${family.map(x => html`<a href="#/f/${x.id}" ${x.id === f.id ? 'aria-current="page"' : ''}>${x.id === parent.id ? t('whole') : x.name.replace(/^.*· /, '')}</a>`)}</div>` : ''}
  <div class="grid mt" style="grid-template-columns:minmax(0,2fr) minmax(260px,1fr);align-items:start">
    <section aria-labelledby="cal-t"><div class="card">
      <div class="row sp"><h2 id="cal-t" style="margin:0">${t('slots')}</h2>
        <div class="row"><a class="btn sec sm" href="#/f/${id}?w=${Math.max(0, w - 1)}" ${w === 0 ? 'aria-disabled="true"' : ''}>← ${t('prev')}</a><span class="small muted">${F.dm(days[0].ts)} – ${F.dm(days[6].ts)}</span><a class="btn sec sm" href="#/f/${id}?w=${Math.min(2, w + 1)}">${t('next')} →</a></div></div>
      <div class="legend" aria-hidden="false"><span><i style="background:var(--green-soft);border-color:var(--green)"></i>${t('slotl.free')}</span><span><i style="background:repeating-linear-gradient(45deg,var(--paper),var(--paper) 3px,var(--line) 3px,var(--line) 4px)"></i>${t('slotl.taken')}</span><span><i style="background:var(--accent)"></i>${t('slotl.mine')}</span><span><i style="background:var(--amber-soft);border-color:var(--amber)"></i>${t('slotl.resident_only')}</span></div>
      ${f.status !== 'open' ? html`<div class="alert bad" role="alert">${ico('alert')}<div><b>${t('closed')}</b> ${f.closed_reason || ''}<br><span class="small">${t('closed_hint')}</span></div></div>` : ''}
      <div class="tablewrap"><div class="cal" role="group" aria-label="${t('slots')}">
        <div></div>${raw(days.map(d => `<div class="hd ${F.ymd(d.ts) === F.ymd(S.meta.now) ? 'today' : ''}">${esc(F.wd(d.ts))}<br>${esc(F.dm(d.ts))}</div>`).join(''))}
        ${raw(times.map(hm => `<div class="hr">${hm}</div>${days.map(d => cell(d, hm)).join('')}`).join(''))}
      </div></div>
      <p class="hint mt">${t('window_note', { g: r.window_days - r.padron_early_days, r: r.window_days })}</p>
    </div></section>
    <aside class="col">
      <div class="card flat"><h3>${ico('clock')} ${t('suggest')}</h3><p class="hint">${t('suggest_hint')}</p>
        ${rec.items.length ? html`<ul style="padding-left:1.1rem;margin:0">${rec.items.map(i => html`<li><button class="btn sec sm" style="margin:.15rem 0" data-act="slot" data-fid="${f.id}" data-start="${i.start}" data-state="free">${F.dt(i.start)}</button> <span class="hint">${t('demand')} ${Math.round(i.demand * 100)}%</span></li>`)}</ul>` : html`<p class="muted">${t('no_free')}</p>`}</div>
      <div class="card flat"><h3>${t('sheet')}</h3>
        <p class="small"><b>${t('hours')}:</b> ${sch.map((s, i) => html`<span style="white-space:nowrap">${F.wd(1700000000 + 0) && ['L', 'M', 'X', 'J', 'V', 'S', 'D'][i]}: ${s}</span> `)}</p>
        <p class="small"><b>${t('access')}:</b> ${t('am.' + f.access_mode + '.long')}</p>
        <p class="small"><b>${t('prices')}:</b></p>
        <table><tbody>${prices.map(([k, v]) => html`<tr><td>${t('tariff.' + k)}</td><td class="right">${F.money(v)}</td></tr>`)}</tbody></table>
        <p class="small"><b>${t('accessibility')}:</b> ${f.accessibility || '–'}</p>
        <p class="small"><b>${t('norms')}:</b> ${f.norms || '–'}</p></div>
      <div class="card flat"><h3>${t('rules_title')}</h3><p class="hint">${t('rules_hint')}</p>
        <ul class="small" style="padding-left:1.1rem;margin:0"><li>${t('rl.window', { n: r.window_days })}</li><li>${t('rl.early', { n: r.padron_early_days })}</li><li>${t('rl.pending', { n: r.max_pending })}</li><li>${t('rl.week', { n: r.max_week })}</li><li>${t('rl.day', { n: r.max_day })}</li>${r.cooldown_hours ? html`<li>${t('rl.cooldown', { n: r.cooldown_hours })}</li>` : ''}<li>${t('rl.cancel', { n: r.cancel_hours })}</li><li>${t('rl.strike', { n: r.strike_threshold, d: r.ban_days })}</li></ul></div>
    </aside></div>`;
});

/* ---------- acreditar identidade ---------- */
async function accreditDialog() {
  const d = PEP.dlg(async () => ({ title: t('accredit.title'), body: `<p>${esc(t('accredit.body'))}</p><div class="col"><button class="btn" data-da="m" data-m="clave">Cl@ve (${esc(t('simulated'))})</button><button class="btn sec" data-da="m" data-m="certificado">${esc(t('cert'))} (${esc(t('simulated'))})</button><p class="hint">${esc(t('accredit.presencial'))}</p></div>`, buttons: [{ label: t('close'), cls: 'sec', onClick: a => a.close(null) }] }));
  d.handlers.m = async el => { S.user = await PEP.post('/me/accredit', { method: el.dataset.m }); PEP.toast(t('accredit.done')); d.close(true); };
  return d.result;
}
PEP.accreditDialog = accreditDialog;

/* ---------- flujo de reserva ---------- */
async function reserveFlow(fid, start) {
  if (!S.user) {
    const ok = await PEP.confirm(t('login_needed'), t('login_needed_body'), t('login'));
    if (ok) location.hash = `#/login?next=${encodeURIComponent('/f/' + fid)}`;
    return;
  }
  if (S.user.role !== 'citizen' && S.user.role !== 'manager') return PEP.toast(t('role_no_book'), true);
  const linked = S.user.role === 'citizen' ? await PEP.get('/me/linked') : [];
  let holder = S.user.id, chk = null, accept = { n: false, p: false, push: false }, busy = false;
  const fac = await PEP.get('/facilities/' + fid);
  const d = PEP.dlg(async api => {
    chk = await PEP.get(`/rules/check?facility_id=${fid}&start=${start}&holder_id=${holder}`);
    const v = chk.violations, codes = v.map(x => x.code), L = chk.limits;
    let norms = '';
    if (codes.includes('norms_not_accepted')) {
      const ns = await PEP.get('/norms'); const cur = ns[0];
      norms = `<div class="card flat" style="margin-top:.75rem"><h3>${esc(t('norms_title', { v: cur.version }))}</h3><p class="small">${esc(S.lang === 'es' ? cur.text_es : cur.text_gl)}</p><p class="small muted">${esc(S.meta.config['legal_' + S.lang] || '')}</p>
      <label class="check"><input type="checkbox" data-dc="acc" data-k="n" ${accept.n ? 'checked' : ''}> ${esc(t('accept_norms'))}</label>
      <label class="check"><input type="checkbox" data-dc="acc" data-k="p" ${accept.p ? 'checked' : ''}> ${esc(t('accept_privacy'))}</label>
      <label class="check"><input type="checkbox" data-dc="acc" data-k="push" ${accept.push ? 'checked' : ''}> ${esc(t('accept_push'))} <span class="chip">${esc(t('optional'))}</span></label></div>`;
    }
    const hard = v.filter(x => !['norms_not_accepted', 'level_required'].includes(x.code));
    const buttons = [{ label: t('cancel_btn'), cls: 'sec', onClick: a => a.close(null) }];
    if (codes.includes('norms_not_accepted')) buttons.push({ label: t('accept_and_continue'), disabled: !(accept.n && accept.p), onClick: async a => { await PEP.post('/me/norms'); if (accept.push) await PEP.patch('/me', { notif_push: true }); await a.render(); } });
    else if (codes.includes('level_required')) buttons.push({ label: t('accredit.btn'), onClick: async a => { if (await accreditDialog()) { S.user = await PEP.get('/me'); await a.render(); } } });
    else if (codes.includes('taken') && !hard.some(x => x.code !== 'taken')) buttons.push({ label: t('waitlist'), onClick: async a => { const r = await PEP.post('/waitlist', { facility_id: fid, start }); PEP.toast(t('waitlist_ok', { n: r.position })); a.close(null); } });
    else buttons.push({ label: t('confirm_booking'), disabled: v.length > 0, onClick: async a => {
      try { const r = await PEP.post('/reservations', { facility_id: fid, start, holder_id: holder }); a.close(r); location.hash = '#/r/' + r.id + '?new=1'; }
      catch (e) { if (e.detail && e.detail.violations) { await a.render(); } else throw e; } } });
    return { title: t('book_title'), buttons, body: `
      <div class="card flat"><b>${esc(fac.name)}</b><br>${esc(F.day(start))} · ${esc(F.range(start, chk.end))}</div>
      ${linked.length ? `<div class="field mt"><label for="holder">${esc(t('book_for'))}</label><select id="holder" data-dc="holder"><option value="${S.user.id}">${esc(S.user.name)} (${esc(t('me'))})</option>${linked.map(m => `<option value="${m.id}" ${holder === m.id ? 'selected' : ''}>${esc(m.name)} (${m.age} ${esc(t('years'))})</option>`).join('')}</select></div>` : ''}
      <p class="mt"><b>${esc(t('tariff'))}:</b> <span class="chip info">${esc(F.money(chk.tariff.price))} · ${esc(t('tariff.' + chk.tariff.name))}</span> ${chk.tariff.price ? `<span class="hint">${esc(t('pay_note'))}</span>` : ''}</p>
      <p class="small"><b>${esc(t('your_limits'))}:</b> ${esc(t('lim.week', { a: Math.max(0, L.max_week - L.week), b: L.max_week }))} · ${esc(t('lim.pending', { a: L.pending, b: L.max_pending }))} · ${esc(t('lim.day', { a: L.day, b: L.max_day }))}</p>
      ${hard.map(x => `<div class="alert bad" role="alert">${ico('alert').s}<div>${esc(PEP.vText(x))}</div></div>`).join('')}
      ${codes.includes('level_required') ? `<div class="alert warn" role="alert">${ico('info').s}<div>${esc(t('v.level_required', { level: 2 }))}</div></div>` : ''}
      ${v.length === 0 ? `<div class="alert ok">${ico('check').s}<div>${esc(t('rules_ok'))}</div></div>` : ''}${norms}` };
  });
  d.handlers.holder = async (el, api) => { holder = +el.value; await api.render(); };
  d.handlers.acc = async (el, api) => { accept[el.dataset.k] = el.checked; const b = api.el.querySelectorAll('.df .btn'); const last = b[b.length - 1]; if (last) last.disabled = !(accept.n && accept.p); };
  return d.result;
}

PEP.actions.slot = async el => {
  const { fid, start, state, rid } = el.dataset;
  if (state === 'mine') return PEP.go('#/r/' + rid);
  if (state === 'taken') { if (!S.user) return reserveFlow(+fid, +start); return reserveFlow(+fid, +start); }
  if (state !== 'free') return;
  await reserveFlow(+fid, +start);
};

/* ---------- login ---------- */
PEP.route(/^\/login$/, async () => {
  const ps = await PEP.get('/auth/personas');
  const cit = ps.filter(p => p.role === 'citizen');
  const verified = cit.filter(p => !p.minor && p.level >= 2);
  const lvl1 = cit.filter(p => p.level < 2 || p.minor);
  const staff = ps.filter(p => p.role !== 'citizen');
  const pbtn = (p, act) => html`<button class="btn sec sm" data-act="${act}" data-id="${p.id}" style="margin:.15rem">${p.name} ${p.minor ? html`<span class="chip">${t('minor')}</span>` : ''}</button>`;
  return html`
  <h1>${t('login')}</h1>
  <div class="alert warn mb">${ico('info')}<div><b>${t('demo_login_title')}</b> ${t('demo_login_body')}</div></div>
  <div class="grid g2">
    <section class="card" aria-labelledby="l1"><h2 id="l1">${t('lvl.2')}</h2><p class="muted small">${t('login.l2_hint')}</p>
      <h3>Cl@ve <span class="chip warn">${t('simulated')}</span></h3><p class="hint">${t('login.clave_hint')}</p><div>${verified.map(p => pbtn(p, 'login-clave'))}</div>
      <h3 class="mt">${t('cert')} <span class="chip warn">${t('simulated')}</span></h3><p class="hint">${t('login.cert_hint')}</p><div>${verified.map(p => pbtn(p, 'login-cert'))}</div></section>
    <section class="card" aria-labelledby="l2"><h2 id="l2">${t('lvl.1')}</h2><p class="muted small">${t('login.l1_hint')}</p>
      <form data-form="register" class="col" id="regform"><div class="grid g2"><div><label for="rn">${t('name')}</label><input id="rn" name="name" required autocomplete="given-name"></div><div><label for="rs">${t('surname')}</label><input id="rs" name="surname" autocomplete="family-name"></div></div>
      <div class="grid g2"><div><label for="re">${t('email')}</label><input id="re" name="email" type="email" required autocomplete="email"></div><div><label for="rp">${t('phone')}</label><input id="rp" name="phone" type="tel" required autocomplete="tel"></div></div>
      <div><label for="rb">${t('birth_year')}</label><input id="rb" name="birth_year" type="number" min="1920" max="2012" value="1990" required></div>
      <button class="btn" type="submit">${t('register')}</button></form>
      <div id="verify" class="hide mt"><div class="alert info">${ico('info')}<div>${t('code_sent')} <b class="mono">123456</b> <span class="hint">(${t('demo')})</span></div></div>
      <form data-form="verify" class="row mt"><input name="code" inputmode="numeric" maxlength="6" required aria-label="${t('code')}" style="max-width:10rem" placeholder="123456"><input type="hidden" name="user_id"><button class="btn" type="submit">${t('verify')}</button></form></div>
      <h3 class="mt">${t('existing_l1')}</h3><div>${lvl1.map(p => pbtn(p, 'login-demo'))}</div></section>
    <section class="card" aria-labelledby="l3"><h2 id="l3">${t('staff_login')}</h2><p class="muted small">${t('staff_hint')}</p>
      <form data-form="pwd" class="col"><div><label for="pe">${t('email')}</label><input id="pe" name="email" type="email" required autocomplete="username" value=""></div>
      <div class="grid g2"><div><label for="pw">${t('password')}</label><input id="pw" name="password" type="password" required autocomplete="current-password"></div><div><label for="pc">${t('code2fa')}</label><input id="pc" name="code" inputmode="numeric" maxlength="6" placeholder="123456"></div></div>
      <button class="btn" type="submit">${t('login')}</button></form>
      <p class="hint mt">${t('staff_demo')}</p><div>${staff.map(p => html`<button class="btn sec sm" data-act="login-staff" data-id="${p.id}" style="margin:.15rem">${p.name} · ${t('role.' + p.role)}</button>`)}</div></section>
    <section class="card flat"><h2>${ico('user')} ${t('presencial_title')}</h2><p>${t('presencial_body')}</p><p class="hint">${t('passkey_note')}</p></section>
  </div>`;
});
const login = async (path, id, qs = '') => { const r = await PEP.post(path + qs, { user_id: +id }); await PEP.afterLogin(r.token, r.user); };
Object.assign(PEP.actions, {
  'login-clave': el => login('/auth/clave', el.dataset.id, '?method=clave'),
  'login-cert': el => login('/auth/clave', el.dataset.id, '?method=certificado'),
  'login-demo': el => login('/auth/demo', el.dataset.id),
  'login-staff': async el => {
    const email = { 6: 'carmen@vilaverde.example', 7: 'jose@vilaverde.example', 8: 'soporte@ponte.example' }; // atallo de demo
    const r = await PEP.post('/auth/demo', { user_id: +el.dataset.id }); await PEP.afterLogin(r.token, r.user);
  },
  register: async (f, d) => { const r = await PEP.post('/auth/register', { ...d, birth_year: +d.birth_year }); f.classList.add('hide'); const v = $('#verify'); v.classList.remove('hide'); v.querySelector('[name=user_id]').value = r.user_id; v.querySelector('[name=code]').focus(); },
  verify: async (f, d) => { const r = await PEP.post('/auth/verify', { user_id: +d.user_id, code: d.code }); await PEP.afterLogin(r.token, r.user); },
  pwd: async (f, d) => { const r = await PEP.post('/auth/password', d); await PEP.afterLogin(r.token, r.user); },
});
})();
