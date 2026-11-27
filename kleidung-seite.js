'use strict';

/* =========================================================================
   Milon – „Was ziehe ich an?“ (#/kleidung, Wunsch des Nutzers 26.11.2026)
   Rechner: Sport, Temperatur, Intensität, Dauer, Wind, Nässe, Licht, Rad Abfahrten/Pausen, persönlicher Ausgleich (−4…+4,
   nur hier, nie gespeichert) → Kleidungs-Temperatur und Stufe, Empfehlung je Kategorie mit Herkunft (Eigene Regel, Erprobt,
   Vorschlag), ähnliche Einheiten, Hinweise. #/kleidung/plan/<uid>: vorbelegt mit der Vorhersage für eine Plan-Einheit
   (health/einheit-wetter.json → plan, Action „Tagesdaten“).
   Tabelle: alle Stufen × Kategorien je Sportart; Antippen einer Zelle öffnet die eigene Regel (kleidung-regeln.json).
   Logik: kleidung-logik.js · Abschnitt im Fenster „Einheit erfassen“: kleidung.js.
   ========================================================================= */
const KL_RULES_PATH = 'kleidung-regeln.json';
const KL_RULES_KEY = 'milon.kleidung.regeln.v1';
const KL_SRC_LABEL = { eigeneRegel: 'Eigene Regel', erprobt: 'Erprobt', vorschlag: 'Vorschlag' };
let klCalc = null;        // Zustand des Rechners (bleibt beim Wechsel der Seite erhalten)
let klView = 'rechner';   // 'rechner' | 'tabelle'
let klTabSport = 'lauf';

/* ---------- Eigene Regeln (kleidung-regeln.json, schreibt Milon) ---------- */
const klRules = () => { const r = store.get(KL_RULES_KEY, []); return Array.isArray(r) ? r : []; };
function mergeKlRules(a, b) {
  const byId = new Map();
  for (const r of [...(a?.rules || []), ...(b?.rules || [])]) {
    if (!r?.id) continue;
    const cur = byId.get(r.id);
    if (!cur || String(r.updatedAt || '') > String(cur.updatedAt || '')) byId.set(r.id, r);
  }
  return { app: 'milon-kleidung-regeln', version: 1, info: b?.info || a?.info, rules: [...byId.values()].sort((x, y) => x.id.localeCompare(y.id)) };
}
const klRulesKey = (s) => JSON.stringify((s?.rules || []).map((r) => `${r.id}@${r.updatedAt}`).sort());
/** Von syncUnitLog (einheit.js) aufgerufen. */
async function syncKleidungRegeln() {
  const local = { app: 'milon-kleidung-regeln', version: 1, rules: klRules() };
  const res = await GHSync.syncFile(KL_RULES_PATH, { local, merge: mergeKlRules, equals: (x, y) => klRulesKey(x) === klRulesKey(y), message: 'Milon: Kleidungs-Regeln' });
  const merged = mergeKlRules(local, res.data);
  store.set(KL_RULES_KEY, merged.rules);
  if (klRulesKey(merged) !== klRulesKey(res.data)) sync.again = true;
}
function saveKlRule(sport, idx, cat, text) {
  const M = klModel().modell;
  const id = klRuleId(sport, idx, cat);
  const rule = { id, sport, stufe: idx, stufeLabel: M.stufen[sport].labels[idx], cat, text: String(text || '').trim(), updatedAt: new Date().toISOString() };
  store.set(KL_RULES_KEY, [...klRules().filter((r) => r.id !== id), rule]);   // leerer Text = Regel entfernt (bleibt als Markierung)
  scheduleSync(800);
}

/* ---------- Kachel und Links ---------- */
function klTileHtml() {
  if (typeof klModel !== 'function' || !klModel()) return '';
  return `<a class="tile st-tile" href="#/kleidung">
    <div class="sec-head"><span class="k">Was ziehe ich an?</span><span class="m small muted">›</span></div>
    <p class="small muted" style="margin:6px 0 0">Kleidung nach Wetter für Rad und Laufen – Rechner und Tabelle.</p>
  </a>`;
}
/** Link „Kleidung“ an einer offenen Plan-Einheit (Heute → Steht heute an). */
function klPlanLinkHtml(it) {
  if (typeof klModel !== 'function' || !klModel() || it.done || !KL_SPORT[it.sport] || !it.uid) return '';
  return `<a class="btn btn-ghost btn-sm kl-plan-link" href="#/kleidung/plan/${encodeURIComponent(it.uid)}" aria-label="${esc(`Was anziehen: ${it.title}`)}">Kleidung</a>`;
}

/* ---------- Rechner ---------- */
function klUnits() { return getUnitEntries().filter((e) => e.clothing).map((e) => ({ date: e.date, title: e.title, clothing: e.clothing })); }
function klDefaultCalc(sport = 'lauf') {
  const M = klModel().modell;
  const neutral = (f) => M.zuAbschlaege[f][sport].find((o) => o.grad === 0)?.wert || M.zuAbschlaege[f][sport][0].wert;
  return { sport, temp: null, feelsLike: null, windKmh: null, gustKmh: null, wind: neutral('wind'), wet: neutral('wet'), light: neutral('light'),
    intensity: neutral('intensity'), duration: neutral('duration'), descents: false, ausgleich: 0, _windManual: false, _plan: null };
}
function klCalcFromPlan(uid) {
  const p = store.get(KL_KEYS.wx, null)?.plan?.[uid];
  if (!p) return null;
  const M = klModel().modell;
  const sport = KL_SPORT[p.sport];
  const c = klDefaultCalc(sport);
  const wx = p.wx;
  const r = (v) => (v == null ? null : Math.round(v));
  Object.assign(c, {
    temp: r(wx?.temp), feelsLike: r(wx?.feels), windKmh: r(wx?.wind), gustKmh: r(wx?.gust),
    wind: (wx && klWindStufe(wx.wind, wx.gust, M)) || c.wind, wet: (wx && klNaesse(wx.precip_max, M)) || c.wet,
    light: (wx && klLicht(wx.sun_s, wx.dark_share, M)) || c.light, intensity: p.intensity || c.intensity,
    duration: klDauer(sport, p.min, M) || c.duration,
    _plan: { title: p.title, date: p.date, time: p.time, hasWx: !!wx, keptFrom: wx?.kept ? (String(wx.src || '').match(/Stand (\d{4}-\d{2}-\d{2})/)?.[1] || '') : '' },
  });
  return c;
}

function renderKleidung(arg = '', arg2 = '') {
  if (typeof klModel !== 'function' || !klModel()) {
    app.innerHTML = `<div class="page">${topbar({ backHref: '#/training', title: 'Was ziehe ich an?' })}
      <section class="card"><p class="small muted">Das Kleidungs-Modell wird beim nächsten Abgleich geladen (<code>kleidung-modell.json</code> im Daten-Repository).</p></section></div>`;
    return;
  }
  if (arg === 'plan' && arg2) { const c = klCalcFromPlan(arg2); if (c) { klCalc = c; klView = 'rechner'; } }
  if (!klCalc) klCalc = klDefaultCalc();
  const tabs = [['rechner', 'Rechner'], ['tabelle', 'Tabelle']];
  app.innerHTML = `<div class="page page-kleidung">
    ${topbar({ backHref: arg === 'plan' ? '#/' : '#/training', title: 'Was ziehe ich an?' })}
    <div class="seg kl-tabs" role="tablist">${tabs.map(([v, l]) => `<button type="button" role="tab" data-klp-view="${v}" class="${klView === v ? 'is-on' : ''}" aria-selected="${klView === v}">${l}</button>`).join('')}</div>
    <div id="klp-main">${klView === 'rechner' ? klRechnerHtml() : klTabelleHtml()}</div>
  </div>`;
  klBindPage();
}

function klRechnerHtml() {
  const c = klCalc;
  const plan = c._plan;
  return `${plan ? `<p class="small muted kl-plan-note">${esc(`${plan.title} · ${dateShort(plan.date)} ${plan.time}`)} – ${plan.hasWx ? `Wetter: Open-Meteo-Vorhersage${plan.keptFrom ? ` vom ${dateShort(plan.keptFrom)} (neuer Abruf ohne Antwort)` : ''} (Modellwerte, Ort auf ca. 10 km gerundet), bitte prüfen.` : 'keine Vorhersage vorhanden, bitte Wetter eintragen.'}</p>` : ''}
  <section class="card kl kl-calc">
    <div class="seg kl-seg" role="radiogroup" aria-label="Sportart">${[['lauf', 'Laufen'], ['rad', 'Rad']].map(([v, l]) => `<button type="button" role="radio" data-klp-sport="${v}" class="${c.sport === v ? 'is-on' : ''}" aria-checked="${c.sport === v}">${l}</button>`).join('')}</div>
    <div class="kl-wx">
      <label>Temperatur <span><input id="klp-temp" type="number" inputmode="decimal" step="1" value="${c.temp ?? ''}"> °C</span></label>
      <label>gefühlt <span><input id="klp-feels" type="number" inputmode="decimal" step="1" value="${c.feelsLike ?? ''}"> °C</span></label>
      <label>Wind <span><input id="klp-wind" type="number" inputmode="numeric" min="0" step="1" value="${c.windKmh ?? ''}"> km/h</span></label>
      <label>Böen <span><input id="klp-gust" type="number" inputmode="numeric" min="0" step="1" value="${c.gustKmh ?? ''}"> km/h</span></label>
    </div>
    <p class="small muted">Gefühlte Temperatur nur zur Info – sie enthält den Wind schon und fließt nicht in die Rechnung.</p>
    ${klSegHtml(c, 'intensity', 'Intensität')}${klSegHtml(c, 'duration', 'Dauer')}
    ${klSegHtml(c, 'wind', 'Wind')}${klSegHtml(c, 'wet', 'Nässe')}${klSegHtml(c, 'light', 'Licht')}
    ${c.sport === 'rad' ? `<label class="kl-check"><input type="checkbox" id="klp-desc" ${c.descents ? 'checked' : ''}> Abfahrten / Pausen</label>` : ''}
    <div class="kl-seg-row"><span class="small">Persönlicher Ausgleich <span class="muted">(nur hier, z. B. wenn du heute leicht frierst)</span></span>
      <div class="kl-step"><button type="button" class="btn btn-ghost btn-sm" data-klp-aus="-1" aria-label="kälter">−</button>
        <strong id="klp-aus">${klSigned(c.ausgleich)} °C</strong>
        <button type="button" class="btn btn-ghost btn-sm" data-klp-aus="1" aria-label="wärmer">+</button></div></div>
  </section>
  <div id="klp-out">${klOutHtml()}</div>`;
}
const klSigned = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '±0');

function klOutHtml() {
  const D = klModel();
  const M = D.modell;
  const c = klCalc;
  const r = klKleidungsTemp(c, M);
  if (!r) return '<section class="card"><p class="small muted">Temperatur eintragen – dann kommen Stufe und Empfehlung.</p></section>';
  const s = klStufe(c.sport, r.kt, M);
  const units = klUnits();
  const rec = klEmpfehlung(c.sport, s.idx, units, klRules(), M, D.vorschlaege);
  const sim = klAehnlich(c.sport, r.kt, units, M);
  const hints = klHinweise(c, M);
  const catName = (k) => (M.kategorien[c.sport] || []).find((x) => x.key === k)?.name || k;
  const areaName = (k) => M.koerperbereiche.find((x) => x.key === k)?.name || k;
  return `<section class="card kl-out-head">
      <div class="k">Kleidungs-Temperatur</div>
      <div class="kl-big">${esc(klNum(r.kt))} °C</div>
      <div>Stufe <strong>${esc(s.label)}</strong></div>
      ${r.parts.length ? `<p class="small muted" style="margin:4px 0 0">${esc(`${klNum(Number(c.temp))} °C`)} ${r.parts.map((p) => `${p.grad > 0 ? '+' : '−'} ${Math.abs(p.grad)} ${esc(klShort(p.label))}`).join(' ')}</p>` : ''}
    </section>
    <section class="card">
      <div class="k">Empfehlung</div>
      <div class="kl-recs">${rec.map((x) => `<div class="kl-rec">
        <div class="small kl-cat-name">${esc(x.name)}</div>
        <div><span class="kl-badge b-${x.src}">${KL_SRC_LABEL[x.src]}</span> ${esc(x.text)}${x.src === 'erprobt' && x.options[0]?.count > 1 ? ` <span class="small muted">(${x.options[0].count}×)</span>` : ''}</div>
        ${x.options.length > 1 || (x.src === 'eigeneRegel' && x.options.length) ? `<div class="small">${x.options.slice(x.src === 'erprobt' ? 1 : 0).map((o) => `oder ${esc(o.text)}${o.count > 1 ? ` (${o.count}×)` : ''}`).join(' · ')}${x.src === 'eigeneRegel' ? ' <span class="muted">(erprobt)</span>' : ''}</div>` : ''}
        ${x.off.map((o) => `<div class="small kl-off">${esc(o.text)} – <span class="${o.rating.includes('kalt') ? 'kl-cold' : 'kl-warm'}">${esc(o.rating)}</span> (${esc(dateShort(o.date))})</div>`).join('')}
        ${x.tipp ? `<div class="small kl-tipp">Tipp: zuletzt „${esc(x.tipp.rating)}“ – ${x.tipp.idx === s.idx ? 'Vorschlag dieser Stufe' : `Vorschlag der Stufe ${esc(x.tipp.label)}`}: ${esc(x.tipp.text || '–')}</div>` : ''}
      </div>`).join('')}</div>
    </section>
    ${hints.length ? `<section class="card"><div class="k">Hinweise</div><ul class="kl-hints">${hints.map(([, t]) => `<li class="small">${esc(t)}</li>`).join('')}</ul></section>` : ''}
    <section class="card">
      <div class="k">Ähnliche Einheiten</div>
      ${sim.length ? sim.map(({ u, s: us }) => `<details class="kl-sim">
        <summary><span>${esc(dateShort(u.date))} · ${esc(u.title || '')}</span><span class="small muted">${esc(klNum(u.clothing.temp))} °C → ${esc(klNum(us.kt))} °C</span></summary>
        <ul class="small">${Object.entries(u.clothing.clothes || {}).map(([k, l]) => `<li><span class="muted">${esc(catName(k))}:</span> ${esc(l.join(' + '))}</li>`).join('')}</ul>
        ${Object.keys(u.clothing.ratings || {}).length ? `<p class="small">${Object.entries(u.clothing.ratings).map(([a, v]) => `${esc(areaName(a))} <span class="${v === 'passt' ? '' : v.includes('kalt') ? 'kl-cold' : 'kl-warm'}">${esc(v)}</span>`).join(' · ')}</p>` : ''}
        ${u.clothing.note ? `<p class="small muted">${esc(u.clothing.note)}</p>` : ''}
      </details>`).join('') : '<p class="small muted">Noch keine Einheit mit ähnlicher Kleidungs-Temperatur.</p>'}
    </section>`;
}

/* ---------- Tabelle ---------- */
function klTabelleHtml() {
  const D = klModel();
  const M = D.modell;
  const sport = klTabSport;
  const rules = klRules();
  const cur = klCalc && klCalc.sport === sport ? klKleidungsTemp(klCalc, M) : null;
  const curIdx = cur ? klStufe(sport, cur.kt, M)?.idx : null;
  return `<div class="seg kl-seg" role="radiogroup" aria-label="Sportart">${[['lauf', 'Laufen'], ['rad', 'Rad']].map(([v, l]) => `<button type="button" role="radio" data-klp-tabsport="${v}" class="${sport === v ? 'is-on' : ''}" aria-checked="${sport === v}">${l}</button>`).join('')}</div>
    <p class="small muted">Vorschläge je Stufe. Antippen öffnet die eigene Regel für diese Zelle.</p>
    ${M.stufen[sport].labels.map((label, i) => `<section class="card kl-stufe ${i === curIdx ? 'is-current' : ''}">
      <div class="k">${esc(label)}${i === curIdx ? ' · Rechner' : ''}</div>
      ${(M.kategorien[sport] || []).map((c) => {
        const rule = rules.find((r) => r.id === klRuleId(sport, i, c.key) && r.text);
        return `<button type="button" class="kl-cell" data-klp-cell="${i}" data-cat="${esc(c.key)}">
          <span class="small muted">${esc(c.name)}</span>
          <span>${rule ? `<span class="kl-badge b-eigeneRegel">Eigene Regel</span> ${esc(rule.text)}` : esc(D.vorschlaege[sport]?.[c.key]?.[i] ?? '–')}</span></button>`;
      }).join('')}
    </section>`).join('')}`;
}
function klRuleModal(sport, idx, cat) {
  const D = klModel();
  const M = D.modell;
  const id = klRuleId(sport, idx, cat);
  const rule = klRules().find((r) => r.id === id && r.text);
  const vor = D.vorschlaege[sport]?.[cat]?.[idx] ?? '–';
  const catName = (M.kategorien[sport] || []).find((c) => c.key === cat)?.name || cat;
  modalRoot.innerHTML = `<div class="modal-backdrop">
    <form class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title" novalidate>
      <h2 id="m-title">Eigene Regel</h2>
      <p class="small muted">${esc(`${sport === 'rad' ? 'Rad' : 'Laufen'} · ${M.stufen[sport].labels[idx]} · ${catName}`)}</p>
      <p class="small">Vorschlag: ${esc(vor)}</p>
      <textarea id="klr-text" rows="3" maxlength="300" placeholder="Was du in dieser Stufe trägst">${esc(rule?.text || '')}</textarea>
      <div class="modal-actions ${rule ? 'u-three' : ''}">
        ${rule ? '<button type="button" class="btn btn-ghost" data-klr="del">Entfernen</button>' : ''}
        <button type="button" class="btn btn-ghost" data-klr="cancel">Abbrechen</button>
        <button type="submit" class="btn btn-primary">Speichern</button>
      </div>
    </form>
  </div>`;
  const root = modalRoot.querySelector('.modal-backdrop');
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const close = () => { modalRoot.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const done = (text) => { saveKlRule(sport, idx, cat, text); close(); klRedrawMain(); toast(text ? 'Regel gespeichert.' : 'Regel entfernt.'); };
  root.addEventListener('click', (e) => {
    if (e.target === root) { close(); return; }
    const b = e.target.closest('[data-klr]');
    if (b?.dataset.klr === 'cancel') close();
    else if (b?.dataset.klr === 'del') done('');
  });
  root.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(root.querySelector('#klr-text').value.trim()); });
  document.addEventListener('keydown', onKey, true);
  root.querySelector('#klr-text').focus();
}

/* ---------- Ereignisse ---------- */
function klRedrawMain() {
  const box = document.getElementById('klp-main');
  if (!box) return;
  box.innerHTML = klView === 'rechner' ? klRechnerHtml() : klTabelleHtml();
}
function klBindPage() {
  const page = app.querySelector('.page-kleidung');
  if (!page) return;
  const M = klModel().modell;
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const out = () => { const o = document.getElementById('klp-out'); if (o) o.innerHTML = klOutHtml(); };
  const setSeg = (f, v) => {
    klCalc[f] = v;
    page.querySelectorAll(`[data-kl-seg="${f}"]`).forEach((b) => { const on = b.dataset.v === v; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
  };
  page.addEventListener('input', (e) => {
    const id = e.target.id;
    if (!['klp-temp', 'klp-feels', 'klp-wind', 'klp-gust'].includes(id)) return;
    const key = { 'klp-temp': 'temp', 'klp-feels': 'feelsLike', 'klp-wind': 'windKmh', 'klp-gust': 'gustKmh' }[id];
    klCalc[key] = num(e.target.value);
    if ((key === 'windKmh' || key === 'gustKmh') && !klCalc._windManual) { const w = klWindStufe(klCalc.windKmh, klCalc.gustKmh, M); if (w) setSeg('wind', w); }
    out();
  });
  page.addEventListener('change', (e) => { if (e.target.id === 'klp-desc') { klCalc.descents = e.target.checked; out(); } });
  page.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.klpView) { klView = b.dataset.klpView; page.querySelectorAll('[data-klp-view]').forEach((x) => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', String(on)); }); klRedrawMain(); }
    else if (b.dataset.klpSport) {
      if (klCalc.sport === b.dataset.klpSport) return;
      const keep = { temp: klCalc.temp, feelsLike: klCalc.feelsLike, windKmh: klCalc.windKmh, gustKmh: klCalc.gustKmh, ausgleich: klCalc.ausgleich, _plan: klCalc._plan };
      const n = klDefaultCalc(b.dataset.klpSport);
      // gleiche Stufen-Werte übernehmen, wenn es sie in der anderen Sportart gibt
      for (const f of ['wind', 'wet', 'light', 'intensity']) if (M.zuAbschlaege[f][n.sport].some((o) => o.wert === klCalc[f])) n[f] = klCalc[f];
      klCalc = { ...n, ...keep };
      if (klCalc.windKmh != null || klCalc.gustKmh != null) klCalc.wind = klWindStufe(klCalc.windKmh, klCalc.gustKmh, M) || klCalc.wind;
      klRedrawMain();
    } else if (b.dataset.klSeg) { if (b.dataset.klSeg === 'wind') klCalc._windManual = true; setSeg(b.dataset.klSeg, b.dataset.v); out(); }
    else if (b.dataset.klpAus) {
      klCalc.ausgleich = Math.max(-4, Math.min(4, (klCalc.ausgleich || 0) + Number(b.dataset.klpAus)));
      document.getElementById('klp-aus').textContent = `${klSigned(klCalc.ausgleich)} °C`;
      out();
    } else if (b.dataset.klpTabsport) { klTabSport = b.dataset.klpTabsport; klRedrawMain(); }
    else if (b.dataset.klpCell != null) klRuleModal(klTabSport, Number(b.dataset.klpCell), b.dataset.cat);
  });
}
