'use strict';

/* =========================================================================
   Milon – Einheit erfassen (Wunsch des Nutzers 15.11.2026)
   Antippen einer Einheit (Heute → Steht heute an, Ganze Auswertung) öffnet ein Fenster: Kohlenhydrate (Scoop-Knöpfe für den
   Carb-Mix mit Natrium, Gummibärchen), Getränk, Verträglichkeit, „Wie lief’s?“, Belastungsempfinden 1–10 (optional).
   Ablage: einheiten.json im Daten-Repository (Abgleich wie gym.json: pro Eintrag gewinnt das neueste updatedAt).
   Eintrag-ID: a-<Garmin-ID> (Aufzeichnung) oder p-<Datum>-<Plan-uid> (geplante Einheit, noch ohne Aufzeichnung).
   Die Auswertung (build_db.py) ordnet Plan-Einträge danach der Garmin-Aufzeichnung zu.
   Carb-Mix (Wunsch des Nutzers 18.11.2026, ersetzt die Flaschen-Knöpfe): Scoop-Größe, Kohlenhydrate und Natrium je Gramm Pulver
   stehen nur im privaten Daten-Repository (verpflegung.json → mix, mit Quelle), nicht im Code. Milon lädt die Datei beim Abgleich.
   ========================================================================= */
const UNIT_LOG_PATH = 'einheiten.json';   // Eintrag je Einheit, seit v43 auch Kleidung (clothing, siehe kleidung.js)
const UNIT_KEYS = { entries: 'milon.units.entries.v1', deleted: 'milon.units.deleted.v1' };
const GUMMY_CARBS_PER_100G = 77;   // Gummibärchen: 100 g Produkt ≈ 77 g Kohlenhydrate (Angabe des Nutzers 15.11.2026)
const FLUID_STEPS = [250, 500, 750];   // Getränk-Knöpfe in ml (Angabe des Nutzers 15.11.2026)
const MIX_PATH = 'verpflegung.json';
const MIX_KEY = 'milon.units.mix.v1';
const GUT_OPTIONS = [['gut', 'gut'], ['grenzwertig', 'grenzwertig'], ['probleme', 'Probleme']];
/* Belastungsempfinden – feste Bedeutung jeder Zahl, damit alle Einheiten mit demselben Maßstab bewertet werden
   (Wunsch des Nutzers 17.11.2026). Grundlage: Borg-CR10-Skala in der Form von Foster et al. (2001, „Session-RPE“):
   1, 2, 3, 4, 5, 7, 10 nach Foster; Texte für 6, 8, 9 und die Ausdauer-Beispiele (Sprechtest, Bereiche) eigene Ergänzung.
   Bewertet wird die ganze Einheit, nicht der härteste Moment (Foster: ca. 30 min danach). Gleiche Tabelle in
   app-daten/training/ERKENNTNISSE.md – bei Änderungen beide anpassen. */
const RPE_SCALE = {
  1: ['Sehr, sehr leicht', 'Ausrollen, wie Spazierengehen'],
  2: ['Leicht', 'Ganz locker, man könnte ewig weitermachen'],
  3: ['Moderat', 'Lockerer Grundlagenbereich, ganze Sätze gehen problemlos'],
  4: ['Etwas fordernd', 'Lange Grundlage oder oberer Grundlagenbereich, Sätze gehen noch'],
  5: ['Fordernd', 'Tempobereich, nur noch kurze Sätze'],
  6: ['Fordernd+', 'Zwischen Tempo und Schwelle, Konzentration nötig'],
  7: ['Sehr fordernd', 'Schwellenbereich, nur noch einzelne Wörter'],
  8: ['Sehr hart', 'Harte Intervalle, am Ende nur mit Überwindung'],
  9: ['Extrem hart', 'Fast am Limit, kaum länger durchzuhalten'],
  10: ['Maximal', 'Mehr ging nicht, wie ein Wettkampf-Endspurt'],
};
const RPE_MARKS = { 1: 'sehr leicht', 3: 'moderat', 5: 'fordernd', 7: 'sehr fordernd', 10: 'maximal' };   // Kurzwörter unter der Reihe
const rpeText = (n) => (RPE_SCALE[n] ? `${n} – ${RPE_SCALE[n][0]}: ${RPE_SCALE[n][1]}` : 'Zahl antippen – die Bedeutung erscheint hier.');

function getUnitEntries() { const s = store.get(UNIT_KEYS.entries, []); return Array.isArray(s) ? s.filter((x) => x && x.id) : []; }
function getUnitDeleted() { const d = store.get(UNIT_KEYS.deleted, []); return Array.isArray(d) ? d : []; }
const unitSnapshot = () => ({ app: 'milon-einheiten', version: 1, entries: getUnitEntries(), deleted: getUnitDeleted() });
function mergeUnits(a, b) {
  const deleted = [...new Set([...(a?.deleted || []), ...(b?.deleted || [])])].sort();
  const gone = new Set(deleted);
  const byId = new Map();
  for (const e of [...(a?.entries || []), ...(b?.entries || [])]) {
    if (!e?.id || gone.has(e.id)) continue;
    const cur = byId.get(e.id);
    if (!cur || String(e.updatedAt || '') > String(cur.updatedAt || '')) byId.set(e.id, e);
  }
  const entries = [...byId.values()].sort((x, y) => String(x.date).localeCompare(String(y.date)) || String(x.createdAt).localeCompare(String(y.createdAt)));
  return { app: 'milon-einheiten', version: 1, entries, deleted };
}
const unitKey = (s) => JSON.stringify([(s?.entries || []).map((x) => `${x.id}@${x.updatedAt}`).sort(), [...(s?.deleted || [])].sort()]);
/** Von runSync() (app.js) aufgerufen. true = lokal hat sich etwas geändert. */
async function syncUnitLog() {
  await loadMix();
  if (typeof loadKleidung === 'function') await loadKleidung();   // kleidung.js: Modell + Wetter je Einheit
  if (typeof syncKleidungRegeln === 'function') { try { await syncKleidungRegeln(); } catch { sync.again = true; } }   // kleidung-seite.js
  const before = unitKey(unitSnapshot());
  const res = await GHSync.syncFile(UNIT_LOG_PATH, {
    local: unitSnapshot(), merge: mergeUnits, equals: (x, y) => unitKey(x) === unitKey(y),
    message: `Milon: ${getUnitEntries().length} erfasste Einheiten`,
  });
  const merged = mergeUnits(unitSnapshot(), res.data);
  store.set(UNIT_KEYS.entries, merged.entries);
  store.set(UNIT_KEYS.deleted, merged.deleted);
  if (unitKey(merged) !== unitKey(res.data)) sync.again = true;
  return unitKey(merged) !== before;
}

/* ---------- Zuordnung Einheit ↔ Eintrag ---------- */
/** item: { date, sport, title, activityId?, planUid? } */
const unitIds = (it) => [it.activityId ? `a-${it.activityId}` : null, it.planUid ? `p-${it.date}-${it.planUid}` : null].filter(Boolean);
function unitEntryFor(it) {
  const ids = unitIds(it);
  const list = getUnitEntries();
  const byIds = list.find((e) => ids.includes(e.id));
  if (byIds) return byIds;
  if (it.activityId) { const byAid = list.find((e) => String(e.activityId) === String(it.activityId)); if (byAid) return byAid; }
  if (it.planUid) return list.find((e) => e.planUid === it.planUid && e.date === it.date) || null;
  return null;
}
const unitHasData = (e) => !!e && (!!e.clothing || e.carbs_g != null || e.sodium_mg != null || e.fluid_ml != null || e.gut || (e.note || '').trim() || e.rpe != null);
/** Knopf für eine Einheit (Zeilen in Heute und Auswertung). */
function unitBtnHtml(it) {
  const e = unitEntryFor(it);
  const done = unitHasData(e);
  return `<button class="btn btn-sm u-btn ${done ? 'is-done' : ''}" data-act="u-open" data-u="${esc(JSON.stringify(it))}" aria-label="${esc(`${it.title}: ${done ? 'Erfasstes ansehen' : 'Verpflegung und Notiz erfassen'}`)}">${done ? '✓ Erfasst' : 'Erfassen'}</button>`;
}

/* ---------- Carb-Mix (Scoops) ---------- */
function getMix() {
  const m = store.get(MIX_KEY, null)?.mix;
  return m && Number(m.scoop_g) > 0 && Number(m.carbs_per_g) > 0 ? m : null;
}
/** verpflegung.json aus dem Daten-Repository holen (in syncUnitLog); offline bleibt der letzte Stand. */
async function loadMix() {
  const c = GHSync.getConfig();
  if (!c || navigator.onLine === false) return;
  try {
    const r = await GHSync.readFile(c, MIX_PATH);
    if (r?.data?.mix) store.set(MIX_KEY, r.data);
  } catch { /* Datei fehlt oder offline */ }
}
/** Kohlenhydrate und Natrium für eine Anzahl Scoops (gerundet). */
function scoopValues(scoops, m = getMix()) {
  const powder = scoops * Number(m.scoop_g);
  return { g: Math.round(powder * Number(m.carbs_per_g)), na_mg: Math.round(powder * (Number(m.sodium_mg_per_g) || 0)) };
}
const fmtScoops = (x) => { const w = Math.floor(x + 1e-9); const h = x - w >= 0.25; return `${w || ''}${h ? '½' : ''}` || '0'; };
/** Aktionen im Seiteninhalt (data-act="u-…"). */
function handleUnitAction(act, el) {
  if (act === 'u-open') { try { openUnitSheet(JSON.parse(el.dataset.u)); } catch { /* defekte Daten am Knopf */ } return true; }
  return false;
}

/* ---------- Fenster ---------- */
function openUnitSheet(it) {
  const old = unitEntryFor(it);
  const st = {
    carbs: old?.carbs_g ?? null, parts: Array.isArray(old?.carbs_parts) ? old.carbs_parts.slice() : [], manual: false,
    fluid: old?.fluid_ml ?? null, gut: old?.gut || null, note: old?.note || '', rpe: old?.rpe ?? null, sodium: old?.sodium_mg ?? null,
  };
  const sportName = (typeof SPORT_NAME !== 'undefined' && SPORT_NAME[it.sport]) || 'Einheit';
  const mix = getMix();
  // Kleidung (kleidung.js): nur Rad/Laufen draußen
  const klSt = typeof klApplies === 'function' && klApplies(it, old) ? klInitialState(it, old) : null;
  const partText = (p) => {
    if (p.kind === 'gummi') return `Gummibärchen ${p.product_g} g (≈ ${p.g} g)`;
    if (p.kind === 'scoop') return `${fmtScoops(p.scoops)} Scoop${p.scoops > 1 ? 's' : ''} ${p.label || 'Carb-Mix'} (≈ ${p.g} g)`;
    return `${p.label || (p.kind === 'frei' ? 'frei' : 'Flasche')} ${p.g} g`;
  };
  const partsText = () => st.parts.map(partText).join(' + ') + (st.manual ? ' · von Hand geändert' : '');
  const sodiumText = () => (st.sodium != null ? `Natrium: ${st.sodium} mg` : '');
  const scoopBtn = (n) => `<button type="button" class="u-chip" data-u-scoop="${n}">+${fmtScoops(n)} Scoop <span class="m">${scoopValues(n, mix).g} g</span></button>`;
  modalRoot.innerHTML = `<div class="modal-backdrop u-backdrop">
    <form class="modal u-sheet" role="dialog" aria-modal="true" aria-labelledby="u-title" novalidate>
      <div class="u-head"><div><div class="k">${esc(sportName)} · ${esc(dateShort(it.date))}</div><h2 id="u-title">${esc(it.title || sportName)}</h2></div>
        <button type="button" class="icon-btn sm" data-u-close aria-label="Schließen">×</button></div>
      <fieldset class="u-field"><legend class="k">Kohlenhydrate</legend>
        <div class="u-inrow"><input id="u-carbs" type="number" inputmode="numeric" min="0" max="2000" placeholder="0" value="${st.carbs ?? ''}"><span class="u-unit">g</span>
          <button type="button" class="btn btn-ghost btn-sm" data-u-carbs-reset ${st.carbs == null ? 'hidden' : ''}>Leeren</button></div>
        <div class="u-chips">${mix ? `<span class="small u-mixname">${esc(mix.name || 'Carb-Mix')}</span>${scoopBtn(1)}${scoopBtn(0.5)}`
          : '<span class="small muted">Scoop-Knöpfe erscheinen nach dem nächsten Abgleich (Carb-Mix aus dem Daten-Repository).</span>'}</div>
        <div class="u-inrow u-gummy"><span class="small">Gummibärchen</span><input id="u-gummy" type="number" inputmode="numeric" min="0" max="1000" placeholder="g Produkt"><button type="button" class="btn btn-sm" data-u-gummy>+ hinzufügen</button></div>
        <p class="small muted u-parts" id="u-parts">${esc(partsText())}</p>
        <p class="small u-sodium" id="u-sodium">${esc(sodiumText())}</p>
      </fieldset>
      <fieldset class="u-field"><legend class="k">Getränk</legend>
        <div class="u-inrow"><input id="u-fluid" type="number" inputmode="numeric" min="0" max="10000" step="50" placeholder="0" value="${st.fluid ?? ''}"><span class="u-unit">ml</span>
          ${FLUID_STEPS.map((ml) => `<button type="button" class="u-chip" data-u-fluid="${ml}">+${ml}</button>`).join('')}</div>
      </fieldset>
      <fieldset class="u-field"><legend class="k">Verträglichkeit</legend>
        <div class="seg u-seg" role="radiogroup">${GUT_OPTIONS.map(([v, l]) => `<button type="button" role="radio" data-u-gut="${v}" class="${st.gut === v ? 'is-on' : ''}" aria-checked="${st.gut === v}">${l}</button>`).join('')}</div>
      </fieldset>
      <fieldset class="u-field"><legend class="k">Wie lief’s?</legend>
        <textarea id="u-note" rows="3" maxlength="2000" placeholder="Gefühl, Beine, Bauch, Wetter …">${esc(st.note)}</textarea>
      </fieldset>
      <fieldset class="u-field"><legend class="k">Belastungsempfinden <span class="muted">(optional)</span></legend>
        <p class="u-rpe-hint muted">Ganze Einheit bewerten, nicht den härtesten Moment.</p>
        <div class="u-rpe" role="radiogroup">${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<button type="button" role="radio" data-u-rpe="${n}" class="${st.rpe === n ? 'is-on' : ''}" aria-checked="${st.rpe === n}" aria-label="${n} – ${RPE_SCALE[n][0]}">${n}</button>`).join('')}</div>
        <div class="u-rpe-marks" aria-hidden="true">${Object.entries(RPE_MARKS).map(([n, w]) => `<span style="grid-column:${n}" class="m${n}">${w}</span>`).join('')}</div>
        <p class="u-rpe-desc ${st.rpe ? '' : 'muted'}" aria-live="polite">${esc(rpeText(st.rpe))}</p>
      </fieldset>
      ${klSt ? klSectionHtml(it, old, klSt) : ''}
      <div class="modal-actions ${old ? 'u-three' : ''}">
        ${old ? '<button type="button" class="btn btn-ghost" data-u-delete>Löschen</button>' : ''}
        <button type="button" class="btn btn-ghost" data-u-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">Speichern</button>
      </div>
    </form>
  </div>`;
  const root = modalRoot.querySelector('.u-backdrop');
  const form = root.querySelector('form');
  const kl = klSt ? klBind(root, klSt) : null;
  const $ = (id) => root.querySelector(`#${id}`);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const close = () => { modalRoot.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const syncCarbs = () => {
    $('u-carbs').value = st.carbs ?? '';
    $('u-parts').textContent = partsText();
    $('u-sodium').textContent = sodiumText();
    root.querySelector('[data-u-carbs-reset]').hidden = st.carbs == null && st.sodium == null;
  };
  const addCarbs = (part) => { st.parts.push(part); st.carbs = (Number(st.carbs) || 0) + part.g; syncCarbs(); };
  /** Scoops sammeln sich in einem Teil (1 + ½ = 1½ Scoops), Kohlenhydrate und Natrium aus der Summe neu gerechnet. */
  const addScoops = (n) => {
    let p = st.parts.find((x) => x.kind === 'scoop');
    const prev = p ? { g: p.g, na_mg: p.na_mg || 0 } : { g: 0, na_mg: 0 };
    if (!p) { p = { kind: 'scoop', scoops: 0, label: mix.name || 'Carb-Mix', mix: mix.id || null }; st.parts.push(p); }
    p.scoops += n;
    Object.assign(p, scoopValues(p.scoops, mix));
    st.carbs = (Number(st.carbs) || 0) + p.g - prev.g;
    st.sodium = (Number(st.sodium) || 0) + p.na_mg - prev.na_mg;
    syncCarbs();
  };
  $('u-carbs').addEventListener('input', (e) => {
    const v = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)));
    st.carbs = Number.isFinite(v) ? v : null;
    st.manual = st.parts.length > 0;
    $('u-parts').textContent = partsText();
  });
  $('u-fluid').addEventListener('input', (e) => { st.fluid = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))); });
  $('u-note').addEventListener('input', (e) => { st.note = e.target.value; });
  root.addEventListener('click', async (e) => {
    if (e.target === root) { close(); return; }
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-u-close')) { close(); return; }
    if (t.dataset.uScoop && mix) { addScoops(Number(t.dataset.uScoop)); return; }
    if (t.hasAttribute('data-u-carbs-reset')) { st.carbs = null; st.sodium = null; st.parts = []; st.manual = false; syncCarbs(); return; }
    if (t.hasAttribute('data-u-gummy')) {
      const pg = Math.round(Number($('u-gummy').value));
      if (!(pg > 0 && pg <= 1000)) { $('u-gummy').focus(); toast('Gummibärchen: Produktmenge in g eingeben.'); return; }
      addCarbs({ kind: 'gummi', product_g: pg, g: Math.round((pg * GUMMY_CARBS_PER_100G) / 100) });
      $('u-gummy').value = '';
      return;
    }
    if (t.dataset.uFluid) { st.fluid = (Number(st.fluid) || 0) + Number(t.dataset.uFluid); $('u-fluid').value = st.fluid; return; }
    if (t.dataset.uGut) {
      st.gut = st.gut === t.dataset.uGut ? null : t.dataset.uGut;
      root.querySelectorAll('[data-u-gut]').forEach((b) => { b.classList.toggle('is-on', b.dataset.uGut === st.gut); b.setAttribute('aria-checked', String(b.dataset.uGut === st.gut)); });
      return;
    }
    if (t.dataset.uRpe) {
      const n = Number(t.dataset.uRpe);
      st.rpe = st.rpe === n ? null : n;
      root.querySelectorAll('[data-u-rpe]').forEach((b) => { const on = Number(b.dataset.uRpe) === st.rpe; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
      const d = root.querySelector('.u-rpe-desc');
      d.textContent = rpeText(st.rpe);
      d.classList.toggle('muted', !st.rpe);
      return;
    }
    if (t.hasAttribute('data-u-delete')) {
      close();
      if (await confirmModal({ title: 'Eintrag löschen?', text: 'Verpflegung, Verträglichkeit und Notiz zu dieser Einheit werden entfernt.', ok: 'Löschen', danger: true })) {
        store.set(UNIT_KEYS.entries, getUnitEntries().filter((x) => x.id !== old.id));
        store.set(UNIT_KEYS.deleted, [...new Set([...getUnitDeleted(), old.id])]);
        scheduleSync(400);
        rerenderCurrent();
      } else openUnitSheet(it);
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const now = new Date().toISOString();
    const entry = {
      id: old?.id || unitIds(it)[0], date: it.date, sport: it.sport, title: it.title || '',
      activityId: it.activityId ? String(it.activityId) : (old?.activityId || null), planUid: it.planUid || old?.planUid || null,
      carbs_g: st.carbs, carbs_parts: st.parts, sodium_mg: st.sodium, fluid_ml: st.fluid,
      clothing: kl ? kl.value() : (old?.clothing ?? null), gut: st.gut, note: st.note.trim(), rpe: st.rpe,
      createdAt: old?.createdAt || now, updatedAt: now,
    };
    if (!entry.id) { toast('Diese Einheit lässt sich noch nicht zuordnen.'); return; }
    // Nach dem Löschen neu erfasst: eigene ID, sonst würde die Löschmarkierung (auch von anderen Geräten) den Eintrag verstecken
    if (!old && getUnitDeleted().includes(entry.id)) entry.id = `${entry.id}-${Date.now().toString(36)}`;
    store.set(UNIT_KEYS.entries, [...getUnitEntries().filter((x) => x.id !== entry.id), entry]);
    scheduleSync(400);
    close();
    toast('Gespeichert.');
    rerenderCurrent();
  });
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => $('u-carbs')?.focus({ preventScroll: true }), 50);
}

// „Einheiten der Woche“ in der Auswertung: Auf-/Zuklappen merken, damit es nach dem Speichern offen bleibt
document.addEventListener('toggle', (e) => {
  if (e.target?.classList?.contains('tw-units')) trainingUnitsOpen = e.target.open;
}, true);
