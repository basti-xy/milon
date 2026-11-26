'use strict';

/* =========================================================================
   Milon – Kleidung nach Wetter (Wunsch des Nutzers 26.11.2026)
   Abschnitt „Kleidung“ im Fenster „Einheit erfassen“ (einheit.js), nur Rad und Laufen draußen.
   Gespeichert im selben Eintrag wie Verpflegung/Gefühl: einheiten.json → entries[].clothing
     { sport: 'rad'|'lauf', temp, feelsLike, windKmh, gustKmh, wind, wet, light, intensity, duration, descents,
       clothes: { <kategorie>: ['Teil (Marke)', …] }, ratings: { <körperbereich>: 'passt' | … }, note, wxSrc }
   Modell und Vorschläge: kleidung-modell.json im Daten-Repository (nicht im Code). Wetter und Pulszonen je Garmin-Einheit:
   health/einheit-wetter.json (Action „Tagesdaten“, training/wetter.py; Open-Meteo, Ort auf 0,1° gerundet).
   Rechenlogik: kleidung-logik.js.
   ========================================================================= */
const KL_MODEL_PATH = 'kleidung-modell.json';
const KL_WX_PATH = 'health/einheit-wetter.json';
const KL_KEYS = { model: 'milon.kleidung.modell.v1', wx: 'milon.kleidung.wetter.v1' };

const klModel = () => { const d = store.get(KL_KEYS.model, null); return d?.modell?.stufen ? d : null; };
const klWx = () => store.get(KL_KEYS.wx, null)?.items || {};

/** Modell und Wetterdaten aus dem Daten-Repository holen (in syncUnitLog); offline bleibt der letzte Stand. */
async function loadKleidung() {
  const c = GHSync.getConfig();
  if (!c || navigator.onLine === false) return;
  for (const [path, key, ok] of [[KL_MODEL_PATH, KL_KEYS.model, (d) => d?.modell?.stufen], [KL_WX_PATH, KL_KEYS.wx, (d) => d?.items]]) {
    try {
      const r = await GHSync.readFile(c, path);
      if (r && ok(r.data)) store.set(key, r.data);
    } catch { /* Datei fehlt oder offline */ }
  }
}

/** Alle bisher verwendeten Kleidungsnamen (sportartübergreifend), für die Autovervollständigung. */
function klAllNames() {
  const seen = new Map();
  for (const e of getUnitEntries()) for (const list of Object.values(e.clothing?.clothes || {})) {
    for (const n of list || []) { const k = String(n).trim().toLowerCase(); if (k && !seen.has(k)) seen.set(k, String(n).trim()); }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'de'));
}
const klShort = (label) => String(label).replace(/\s*\(.*\)\s*$/, '');
const KL_RATE_SHORT = { 'zu kalt': 'zu kalt', 'etwas kalt': 'kühl', passt: 'passt', 'etwas warm': 'warm', 'zu warm': 'zu warm' };   // kurz für die Handybreite, voller Text im title

/** Soll der Abschnitt erscheinen? Rad/Laufen, Modell geladen, nicht als Einheit drinnen (Zwift, Laufband) bekannt. */
function klApplies(it, old) {
  if (old?.clothing) return !!klModel();
  if (!KL_SPORT[it.sport] || !klModel()) return false;
  const w = it.activityId ? klWx()[String(it.activityId)] : null;
  return !(w && w.outdoor === false);
}

/** Anfangszustand: gespeicherte Kleidung oder Vorbelegung aus Garmin (Dauer, Pulszonen) und Open-Meteo. */
function klInitialState(it, old) {
  const M = klModel().modell;
  if (old?.clothing) return { ...structuredClone(old.clothing), _windManual: true, _src: old.clothing.wxSrc || 'nutzer', _edited: false };
  const sport = KL_SPORT[it.sport];
  const w = it.activityId ? klWx()[String(it.activityId)] : null;
  const wx = w?.wx || null;
  const r = (v) => (v == null ? null : Math.round(v));
  const st = {
    sport, temp: r(wx?.temp), feelsLike: r(wx?.feels), windKmh: r(wx?.wind), gustKmh: r(wx?.gust),
    wind: wx ? klWindStufe(wx.wind, wx.gust, M) : null, wet: wx ? klNaesse(wx.precip_max, M) : null,
    light: wx ? klLicht(wx.sun_s, wx.dark_share, M) : null,
    intensity: klIntensitaet(w?.zones, M), duration: klDauer(sport, w?.min, M), descents: false,
    clothes: {}, ratings: {}, note: '', _windManual: false, _src: wx ? 'open-meteo' : 'nutzer', _edited: false,
  };
  // ohne Daten: mittlere bzw. neutrale Stufen
  const first = (f) => M.zuAbschlaege[f][sport].find((o) => o.grad === 0)?.wert || M.zuAbschlaege[f][sport][0].wert;
  for (const f of ['wind', 'wet', 'light', 'intensity', 'duration']) if (!st[f]) st[f] = first(f);
  return st;
}

function klSegHtml(st, f, title) {
  const M = klModel().modell;
  return `<div class="kl-seg-row"><span class="small">${esc(title)}</span>
    <div class="seg kl-seg" role="radiogroup" aria-label="${esc(title)}">${M.zuAbschlaege[f][st.sport].map((o) => `<button type="button" role="radio" data-kl-seg="${f}" data-v="${esc(o.wert)}" class="${st[f] === o.wert ? 'is-on' : ''}" aria-checked="${st[f] === o.wert}">${esc(klShort(o.label))}</button>`).join('')}</div></div>`;
}
function klChipsHtml(st, cat) {
  return (st.clothes[cat] || []).map((n, i) => `<span class="kl-chip">${esc(n)}<button type="button" data-kl-del="${esc(cat)}" data-i="${i}" aria-label="${esc(`${n} entfernen`)}">×</button></span>`).join('');
}

/** HTML des Abschnitts (oder ''), state in st. */
function klSectionHtml(it, old, st) {
  if (!st) return '';
  const M = klModel().modell;
  const cats = M.kategorien[st.sport] || [];
  const areas = M.koerperbereiche.filter((a) => cats.some((c) => c.koerperbereich === a.key));
  return `<details class="u-field kl" ${old?.clothing ? 'open' : ''}>
    <summary><span class="k">Kleidung</span><span class="small muted kl-sum" id="kl-sum"></span></summary>
    <div class="kl-body">
      <p class="kl-result" id="kl-result"></p>
      <div class="kl-wx">
        <label>Temperatur <span><input id="kl-temp" type="number" inputmode="decimal" step="1" value="${st.temp ?? ''}"> °C</span></label>
        <label>gefühlt <span><input id="kl-feels" type="number" inputmode="decimal" step="1" value="${st.feelsLike ?? ''}"> °C</span></label>
        <label>Wind <span><input id="kl-wind" type="number" inputmode="numeric" min="0" step="1" value="${st.windKmh ?? ''}"> km/h</span></label>
        <label>Böen <span><input id="kl-gust" type="number" inputmode="numeric" min="0" step="1" value="${st.gustKmh ?? ''}"> km/h</span></label>
      </div>
      <p class="small muted" id="kl-src"></p>
      ${klSegHtml(st, 'wind', 'Wind')}${klSegHtml(st, 'wet', 'Nässe')}${klSegHtml(st, 'light', 'Licht')}
      ${klSegHtml(st, 'intensity', 'Intensität')}${klSegHtml(st, 'duration', 'Dauer')}
      ${st.sport === 'rad' ? `<label class="kl-check"><input type="checkbox" id="kl-desc" ${st.descents ? 'checked' : ''}> Abfahrten / Pausen</label>` : ''}
      <div class="kl-cats">${cats.map((c) => `<div class="kl-cat">
        <div class="small kl-cat-name">${esc(c.name)}</div>
        <div class="kl-chips" data-kl-chips="${esc(c.key)}">${klChipsHtml(st, c.key)}</div>
        <div class="kl-add"><input type="text" list="kl-names" data-kl-add="${esc(c.key)}" placeholder="Teil (Marke)" maxlength="80" autocomplete="off"><button type="button" class="btn btn-ghost btn-sm" data-kl-plus="${esc(c.key)}" aria-label="${esc(`${c.name}: hinzufügen`)}">+</button></div>
      </div>`).join('')}</div>
      <datalist id="kl-names">${klAllNames().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      <div class="kl-rate"><div class="small kl-rate-title">Wie hat es gepasst?</div>${areas.map((a) => `<div class="kl-rate-row"><span class="small">${esc(a.name)}</span>
        <div class="kl-rate-btns" role="radiogroup" aria-label="${esc(a.name)}">${M.bewertungen.map((b) => `<button type="button" role="radio" data-kl-rate="${esc(a.key)}" data-v="${esc(b)}" class="${st.ratings[a.key] === b ? 'is-on' : ''}" aria-checked="${st.ratings[a.key] === b}" title="${esc(b)}">${esc(KL_RATE_SHORT[b] || b)}</button>`).join('')}</div></div>`).join('')}</div>
      <textarea id="kl-note" rows="2" maxlength="1000" placeholder="Notiz zur Kleidung, z. B. was gefehlt hat">${esc(st.note || '')}</textarea>
    </div>
  </details>`;
}

/** Bindet die Ereignisse; gibt { value() } zurück (null, wenn nichts zur Kleidung eingetragen ist). */
function klBind(root, st) {
  const M = klModel().modell;
  const $ = (id) => root.querySelector(`#${id}`);
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const draw = () => {
    const r = klKleidungsTemp(st, M);
    const s = r ? klStufe(st.sport, r.kt, M) : null;
    $('kl-result').innerHTML = r
      ? `Kleidungs-Temperatur <strong>${esc(klNum(r.kt))} °C</strong> · Stufe <strong>${esc(s?.label || '–')}</strong>${r.parts.length ? `<span class="small muted"> (${r.parts.map((p) => `${p.grad > 0 ? '+' : '−'}${Math.abs(p.grad)} ${klShort(p.label)}`).map(esc).join(', ')})</span>` : ''}`
      : '<span class="muted">Temperatur eintragen</span>';
    const n = Object.values(st.clothes).reduce((a, l) => a + l.length, 0);
    $('kl-sum').textContent = [r ? `${klNum(st.temp)} °C` : '', n ? `${n} Teile` : ''].filter(Boolean).join(' · ');
    $('kl-src').textContent = st._src === 'open-meteo' && !st._edited ? 'Wetter vorbelegt: Open-Meteo (Modellwerte zur Startzeit, Ort auf ca. 10 km gerundet) – bitte prüfen.'
      : st._src === 'import' ? 'Aus dem früheren Kleidungs-Tool übernommen.' : '';
  };
  const setSeg = (f, v) => {
    st[f] = v;
    root.querySelectorAll(`[data-kl-seg="${f}"]`).forEach((b) => { const on = b.dataset.v === v; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
  };
  const addItem = (cat) => {
    const inp = root.querySelector(`[data-kl-add="${CSS.escape(cat)}"]`);
    const name = inp.value.trim();
    if (!name) return;
    const list = st.clothes[cat] || (st.clothes[cat] = []);
    if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) list.push(name);
    inp.value = '';
    root.querySelector(`[data-kl-chips="${CSS.escape(cat)}"]`).innerHTML = klChipsHtml(st, cat);
    draw();
  };
  const onWx = () => {
    st.temp = num($('kl-temp').value); st.feelsLike = num($('kl-feels').value);
    st.windKmh = num($('kl-wind').value); st.gustKmh = num($('kl-gust').value);
    st._edited = true;
    if (!st._windManual) { const w = klWindStufe(st.windKmh, st.gustKmh, M); if (w) setSeg('wind', w); }
    draw();
  };
  for (const id of ['kl-temp', 'kl-feels', 'kl-wind', 'kl-gust']) $(id).addEventListener('input', onWx);
  $('kl-note').addEventListener('input', (e) => { st.note = e.target.value; });
  $('kl-desc')?.addEventListener('change', (e) => { st.descents = e.target.checked; draw(); });
  root.querySelectorAll('[data-kl-add]').forEach((inp) => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addItem(inp.dataset.klAdd); }   // Enter speichert nicht das ganze Fenster
  }));
  root.querySelector('.kl').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.klSeg) { if (b.dataset.klSeg === 'wind') st._windManual = true; st._edited = true; setSeg(b.dataset.klSeg, b.dataset.v); draw(); }
    else if (b.dataset.klRate) {
      const a = b.dataset.klRate;
      st.ratings[a] = st.ratings[a] === b.dataset.v ? undefined : b.dataset.v;
      if (!st.ratings[a]) delete st.ratings[a];
      root.querySelectorAll(`[data-kl-rate="${a}"]`).forEach((x) => { const on = x.dataset.v === st.ratings[a]; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', String(on)); });
    } else if (b.dataset.klPlus) addItem(b.dataset.klPlus);
    else if (b.dataset.klDel) {
      const cat = b.dataset.klDel;
      (st.clothes[cat] || []).splice(Number(b.dataset.i), 1);
      if (!st.clothes[cat]?.length) delete st.clothes[cat];
      root.querySelector(`[data-kl-chips="${CSS.escape(cat)}"]`).innerHTML = klChipsHtml(st, cat);
      draw();
    }
  });
  draw();
  return {
    value() {
      // noch nicht hinzugefügte Eingaben mitnehmen (Name getippt, aber „+“ vergessen)
      root.querySelectorAll('[data-kl-add]').forEach((inp) => { if (inp.value.trim()) addItem(inp.dataset.klAdd); });
      const clothes = Object.fromEntries(Object.entries(st.clothes).filter(([, l]) => l.length));
      const has = Object.keys(clothes).length || Object.keys(st.ratings).length || (st.note || '').trim();
      if (!has) return null;
      return {
        sport: st.sport, temp: st.temp, feelsLike: st.feelsLike, windKmh: st.windKmh, gustKmh: st.gustKmh,
        wind: st.wind, wet: st.wet, light: st.light, intensity: st.intensity, duration: st.duration, descents: !!st.descents,
        clothes, ratings: { ...st.ratings }, note: (st.note || '').trim(),
        wxSrc: st._edited ? 'nutzer' : st._src,
      };
    },
  };
}
const klNum = (v) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: 1 }).replace('-', '−');
