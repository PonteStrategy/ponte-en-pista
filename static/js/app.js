/* SPDX-License-Identifier: AGPL-3.0-or-later
   Ponte en Pista · web cidadá. JavaScript sen dependencias nin paso de build. */
'use strict';
const PEP = window.PEP = { S: { tenant: null, token: null, user: null, lang: 'gl', meta: null }, views: {}, actions: {} };
const S = PEP.S;

/* ---------- plantillas con escape automático ---------- */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = s => new Raw(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const html = (strs, ...vals) => raw(strs.reduce((o, s, i) => o + s + (i < vals.length ? ins(vals[i]) : ''), ''));
const ins = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(ins).join('') : (v === false || v == null) ? '' : esc(v);
PEP.html = html; PEP.raw = raw; PEP.esc = esc;

/* ---------- iconas ---------- */
const P = {
  padel: '<circle cx="9" cy="9" r="6"/><path d="M13.5 13.5 20 20"/><path d="M6 7h6M6 10h6"/>', pavillon: '<path d="M3 20V9l9-5 9 5v11z"/><path d="M9 20v-6h6v6"/>',
  fronton: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 16h18M12 4v12"/>', futbol: '<circle cx="12" cy="12" r="9"/><path d="m12 8 3.5 2.5-1.3 4h-4.4l-1.3-4z"/>',
  tenis: '<circle cx="12" cy="12" r="9"/><path d="M5 5c4 3 4 11 0 14M19 5c-4 3-4 11 0 14"/>', polideportiva: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M12 5v14"/>',
  other: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', door: '<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="14.5" cy="12.5" r=".8"/>',
  staff: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/>', key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 3.5-7 8-7s8 2.5 8 7"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v5M12 18v.5"/>', check: '<path d="m4 12 5 5L20 6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  light: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>', wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r=".8"/>',
  down: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>', print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4"/>', cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5"/>', home: '<path d="M3 11 12 3l9 8M5 10v10h14V10"/>', chart: '<path d="M4 20V4M4 20h16M8 16v-5M13 16V8M18 16v-3"/>',
};
const ico = (n, cls = '') => raw(`<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[n] || P.other}</svg>`);
PEP.ico = ico;

/* ---------- i18n e formatos ---------- */
const t = (k, p) => {
  const e = PEP.I18N[k];
  let s = e ? (e[S.lang === 'es' ? 1 : 0] || e[0]) : k;
  if (p) s = s.replace(/\{(\w+)\}/g, (m, n) => p[n] ?? '');
  return s;
};
PEP.t = t;
const TZ = 'Europe/Madrid';
const loc = () => (S.lang === 'gl' && Intl.DateTimeFormat.supportedLocalesOf(['gl-ES']).length) ? 'gl-ES' : 'es-ES';
const F = PEP.F = {
  hm: ts => new Intl.DateTimeFormat(loc(), { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(ts * 1000),
  day: ts => new Intl.DateTimeFormat(loc(), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(ts * 1000),
  dayS: ts => new Intl.DateTimeFormat(loc(), { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(ts * 1000),
  dm: ts => new Intl.DateTimeFormat(loc(), { timeZone: TZ, day: 'numeric', month: 'short' }).format(ts * 1000),
  wd: ts => new Intl.DateTimeFormat(loc(), { timeZone: TZ, weekday: 'short' }).format(ts * 1000),
  dt: ts => `${F.dayS(ts)}, ${F.hm(ts)}`,
  range: (a, b) => `${F.hm(a)}–${F.hm(b)}`,
  money: n => n ? new Intl.NumberFormat(loc(), { style: 'currency', currency: 'EUR' }).format(n) : t('free'),
  ymd: ts => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(ts * 1000),
  ago: (ts, now) => { const d = now - ts; if (d < 90) return t('now_'); if (d < 3600) return Math.round(d / 60) + ' min'; if (d < 86400) return Math.round(d / 3600) + ' h'; return Math.round(d / 86400) + ' d'; },
};
PEP.nowTs = () => (S.meta ? S.meta.now : Math.floor(Date.now() / 1000));

/* ---------- API ---------- */
async function api(method, path, body) {
  const h = { 'X-Tenant': S.tenant };
  if (S.token) h.Authorization = 'Bearer ' + S.token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  let r;
  try { r = await fetch('/api' + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (e) { const er = new Error('network'); er.offline = true; throw er; }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    const d = (data && data.detail) || {};
    const er = new Error(typeof d === 'string' ? d : d.code || 'error');
    er.status = r.status; er.detail = d; er.code = typeof d === 'string' ? d : d.code;
    if (r.status === 401 && S.token && !path.startsWith('/auth')) { setSession(null, null); }
    throw er;
  }
  return data;
}
PEP.api = api;
PEP.get = p => api('GET', p); PEP.post = (p, b = {}) => api('POST', p, b); PEP.patch = (p, b) => api('PATCH', p, b); PEP.put = (p, b) => api('PUT', p, b); PEP.del = p => api('DELETE', p);
PEP.download = async (path, name) => {
  const r = await fetch('/api' + path, { headers: { 'X-Tenant': S.tenant, Authorization: 'Bearer ' + S.token } });
  const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

function setSession(token, user) {
  S.token = token; S.user = user;
  try { token ? localStorage.setItem('pep.token.' + S.tenant, token) : localStorage.removeItem('pep.token.' + S.tenant); } catch (e) { }
}
PEP.setSession = setSession;

/* ---------- UI utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
PEP.$ = $; PEP.$$ = $$;
PEP.toast = (msg, bad) => {
  const d = document.createElement('div'); d.className = 'toast' + (bad ? ' bad' : ''); d.textContent = msg;
  $('#toasts').append(d); setTimeout(() => d.remove(), 5200);
};
PEP.errText = e => {
  if (e.offline) return t('err.offline');
  const k = 'err.' + e.code; return PEP.I18N[k] ? t(k, e.detail) : (e.code || e.message);
};
PEP.fail = e => { console.error(e); PEP.toast(PEP.errText(e), true); };

PEP.modal = function (title, bodyHtml, buttons = [{ label: t('close'), value: null }]) {
  return new Promise(res => {
    const d = document.createElement('dialog');
    d.setAttribute('aria-labelledby', 'dlg-t');
    d.innerHTML = `<div class="dh"><h2 id="dlg-t" style="margin:0">${esc(title)}</h2><button class="btn sec sm" data-v="__x" aria-label="${esc(t('close'))}">${ico('x')}</button></div><div class="db">${bodyHtml}</div><div class="df">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-v="${i}" ${b.id ? `id="${b.id}"` : ''}>${esc(b.label)}</button>`).join('')}</div>`;
    document.body.append(d);
    const done = v => { d.close(); d.remove(); res(v); };
    d.addEventListener('click', async e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      if (b.dataset.v === '__x') return done(null);
      const btn = buttons[+b.dataset.v];
      if (btn.onClick) { const ok = await btn.onClick(d, b); if (ok === false) return; }
      done(btn.value === undefined ? true : btn.value);
    });
    d.addEventListener('cancel', () => { d.remove(); res(null); });
    d.showModal();
    const f = d.querySelector('input,select,textarea'); if (f) f.focus();
    d.update = () => { };
  });
};
PEP.confirm = (title, msg, ok = t('accept'), danger) => PEP.modal(title, `<p>${msg instanceof Raw ? msg : esc(msg)}</p>`, [{ label: t('cancel_btn'), value: false, cls: 'sec' }, { label: ok, value: true, cls: danger ? 'danger' : '' }]);

/* violacións de regras -> texto */
PEP.vText = v => {
  let s = t('v.' + v.code, v.params || {});
  if (v.until && ['max_pending', 'max_week', 'max_day', 'cooldown', 'ban', 'beyond_window'].includes(v.code)) s += ' ' + t('v.until', { when: F.dt(v.until) });
  return s;
};

/* chips de estado */
PEP.statusChip = r => {
  const past = r.end <= PEP.nowTs();
  const m = { confirmed: past ? ['info', 'st.done'] : ['info', 'st.confirmed'], attended: ['ok', past ? 'st.done' : 'st.attended'], no_show: ['bad', 'st.no_show'], cancelled: ['bad', 'st.cancelled'] }[r.status] || ['', r.status];
  return html`<span class="chip ${m[0]}">${t(m[1])}</span>`;
};
PEP.accessLabel = m => ({ staff: 'am.staff', door: 'am.door', keybox: 'am.keybox' }[m] ? t({ staff: 'am.staff', door: 'am.door', keybox: 'am.keybox' }[m]) : m);
PEP.sportIcon = s => ico(P[s] ? s : 'other');

/* ---------- aplicación do concello (tema) ---------- */
function applyTheme() {
  const c = S.meta.config;
  document.documentElement.style.setProperty('--brand', c.color || '#102F61');
  document.documentElement.style.setProperty('--accent', c.accent || '#2F80ED');
  document.documentElement.lang = S.lang;
  document.title = 'Ponte en Pista · ' + c.short;
  const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.content = c.color;
}

/* ---------- cabeceira ---------- */
function renderHeader() {
  const u = S.user, c = S.meta.config, role = u && u.role;
  const links = [['#/', 'nav.facilities']];
  if (u && role === 'citizen') links.push(['#/mine', 'nav.mine']);
  if (role === 'manager') links.push(['#/admin', 'nav.admin']);
  if (role === 'validator' || role === 'manager') links.push(['#/validar', 'nav.validate']);
  if (role === 'tech') links.push(['#/asistencia', 'nav.tech']);
  links.push(['#/formacion', 'nav.learn'], ['#/demo', 'nav.demo']);
  const cur = location.hash.replace(/\?.*/, '') || '#/';
  const isCur = h => (h === '#/' ? cur === '#/' || cur.startsWith('#/f/') : cur.startsWith(h));
  $('#hdr').innerHTML = `<div class="top-in">
    <a class="brand" href="#/"><span class="logo" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24"><rect x="2" y="9" width="20" height="3" rx="1.5" fill="${esc(c.color)}"/><path d="M5 9c0-3 3-5 7-5s7 2 7 5" fill="none" stroke="${esc(c.accent)}" stroke-width="2.4"/><path d="M6 12v8M18 12v8" stroke="${esc(c.color)}" stroke-width="2.4"/></svg></span><span>Ponte en Pista<small>${esc(c.name)}</small></span></a>
    <nav class="main" aria-label="${esc(t('nav.label'))}">${links.map(([h, k]) => `<a href="${h}" ${isCur(h) ? 'aria-current="page"' : ''}>${esc(t(k))}</a>`).join('')}</nav>
    <div class="tools">
      ${u ? `<a href="#/avisos" class="btn sec sm" style="color:#fff;border-color:rgba(255,255,255,.45)" aria-label="${esc(t('nav.notifs'))}">${ico('bell').s}<span id="nbadge"></span></a>` : ''}
      <label class="sr" for="tsel">${esc(t('tenant'))}</label>
      <select id="tsel">${S.meta.tenants.map(x => `<option value="${x.id}" ${x.id === S.tenant ? 'selected' : ''}>${esc(x.short)}</option>`).join('')}</select>
      <label class="sr" for="lsel">${esc(t('lang'))}</label>
      <select id="lsel"><option value="gl" ${S.lang === 'gl' ? 'selected' : ''}>Galego</option><option value="es" ${S.lang === 'es' ? 'selected' : ''}>Castellano</option></select>
      ${u ? `<a class="btn sec sm" style="color:#fff;border-color:rgba(255,255,255,.45)" href="#/profile">${ico('user').s} ${esc(u.name)}</a><button id="logout">${esc(t('logout'))}</button>`
      : `<a class="btn sm" style="background:#fff;color:${esc(c.color)};border-color:#fff" href="#/login">${esc(t('login'))}</a>`}
    </div></div>`;
  const ts = $('#tsel'); ts.onchange = () => switchTenant(ts.value);
  const ls = $('#lsel'); ls.onchange = () => { S.lang = ls.value; try { localStorage.setItem('pep.lang', S.lang); } catch (e) { } renderAll(); };
  const lo = $('#logout'); if (lo) lo.onclick = async () => { try { await PEP.post('/auth/logout'); } catch (e) { } setSession(null, null); location.hash = '#/'; renderAll(); };
}
function renderDemoStrip() {
  const m = S.meta, off = m.clock_offset;
  $('#demostrip').innerHTML = `<span><b>DEMO</b> · ${esc(t('demo.strip'))}</span><span>${ico('clock').s} ${esc(F.dayS(m.now))} ${esc(F.hm(m.now))}${off ? ' ' + esc(t('demo.shifted')) : ''}</span><button data-act="clock-reset" ${off ? '' : 'hidden'}>${esc(t('demo.reset_clock'))}</button><a href="#/demo" style="color:inherit">${esc(t('nav.demo'))}</a>`;
}
async function refreshBadge() {
  if (!S.user) return;
  try {
    const n = await PEP.get('/me/notifications'); const unread = n.filter(x => !x.read).length;
    const b = $('#nbadge'); if (b) b.innerHTML = unread ? `<span class="badge-n">${unread}</span>` : '';
  } catch (e) { }
}

/* ---------- router ---------- */
const routes = [];
PEP.route = (re, fn) => routes.push([re, fn]);
let navSeq = 0;
async function render() {
  const seq = ++navSeq;
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = hash.split('?');
  PEP.query = Object.fromEntries(new URLSearchParams(qs || ''));
  const main = $('#main');
  $$('dialog').forEach(d => { try { d.close(); } catch (e) { } d.remove(); });
  window.scrollTo(0, 0);
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      main.innerHTML = `<p class="muted" role="status">${esc(t('loading'))}</p>`;
      PEP.cleanup && PEP.cleanup(); PEP.cleanup = null;
      try { const out = await fn(...m.slice(1)); if (seq !== navSeq) return; if (out != null) main.innerHTML = out.toString(); }
      catch (e) { if (seq !== navSeq) return; console.error(e); main.innerHTML = `<div class="alert bad" role="alert">${ico('alert').s}<div><b>${esc(PEP.errText(e))}</b><p class="small">${e.status === 401 ? `<a href="#/login?next=${encodeURIComponent(path)}">${esc(t('login'))}</a>` : ''}</p></div></div>`; }
      renderHeader(); const h1 = main.querySelector('h1'); if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
      return;
    }
  }
  main.innerHTML = `<h1>404</h1><p><a href="#/">${esc(t('nav.facilities'))}</a></p>`;
}
PEP.refresh = render;
PEP.go = h => { if (location.hash === h) render(); else location.hash = h; };
window.addEventListener('hashchange', render);

/* ---------- accións por delegación ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = PEP.actions[el.dataset.act]; if (!fn) return;
  e.preventDefault();
  try { await fn(el, e); } catch (er) { PEP.fail(er); }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const fn = PEP.actions[f.dataset.form]; if (!fn) return;
  const btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
  try { await fn(f, Object.fromEntries(new FormData(f))); } catch (er) { PEP.fail(er); } finally { if (btn) btn.disabled = false; }
});
PEP.actions['clock-reset'] = async () => { await PEP.post('/demo/clock', { reset: true }); await reloadMeta(); render(); };

/* ---------- arranque ---------- */
async function reloadMeta() {
  S.meta = await PEP.get('/meta');
  applyTheme(); renderDemoStrip();
}
PEP.reloadMeta = reloadMeta;
async function switchTenant(id) {
  S.tenant = id; try { localStorage.setItem('pep.tenant', id); } catch (e) { }
  S.token = null; S.user = null;
  try { S.token = localStorage.getItem('pep.token.' + id); } catch (e) { }
  await reloadMeta();
  if (!localStorage.getItem('pep.lang')) S.lang = S.meta.config.default_lang;
  await loadUser(); renderAll();
}
async function loadUser() {
  if (!S.token) { S.user = null; return; }
  try { S.user = await PEP.get('/me'); } catch (e) { S.user = null; if (!e.offline) { S.token = null; } }
}
PEP.loadUser = loadUser;
function renderAll() { applyTheme(); renderDemoStrip(); renderHeader(); render(); refreshBadge(); }
PEP.renderAll = renderAll;
PEP.afterLogin = async (token, user) => {
  setSession(token, user); await loadUser();
  const next = PEP.query && PEP.query.next;
  renderHeader(); refreshBadge();
  location.hash = next ? '#' + next : (user.role === 'manager' ? '#/admin' : user.role === 'validator' ? '#/validar' : user.role === 'tech' ? '#/asistencia' : '#/mine');
};

async function boot() {
  const q = new URLSearchParams(location.search);
  let tn = q.get('t') || localStorage.getItem('pep.tenant') || 'vilaverde';
  S.tenant = tn;
  try { S.token = localStorage.getItem('pep.token.' + tn); } catch (e) { }
  try { await reloadMeta(); } catch (e) { S.tenant = 'vilaverde'; await reloadMeta(); }
  S.lang = localStorage.getItem('pep.lang') || S.meta.config.default_lang || 'gl';
  await loadUser();
  renderAll();
  setInterval(async () => { try { S.meta = await PEP.get('/meta'); renderDemoStrip(); } catch (e) { } refreshBadge(); }, 20000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
}
PEP.boot = boot;
