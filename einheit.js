'use strict';

/* =========================================================================
   Milon – Einheit erfassen (Wunsch des Nutzers 15.11.2026)
   Antippen einer Einheit (Heute → Steht heute an, Ganze Auswertung) öffnet ein Fenster: Kohlenhydrate (Flaschen-Knöpfe,
   Gummibärchen), Getränk, Verträglichkeit, „Wie lief’s?“, Belastungsempfinden 1–10 (optional).
   Ablage: einheiten.json im Daten-Repository (Abgleich wie gym.json: pro Eintrag gewinnt das neueste updatedAt).
   Eintrag-ID: a-<Garmin-ID> (Aufzeichnung) oder p-<Datum>-<Plan-uid> (geplante Einheit, noch ohne Aufzeichnung).
   Die Auswertung (build_db.py) ordnet Plan-Einträge danach der Garmin-Aufzeichnung zu.
   Flaschen: feste Flaschen aus den Einstellungen (milon-settings.json → bottles, für alle Geräte) + zuletzt benutzte Mengen.
   ========================================================================= */
const UNIT_LOG_PATH = 'einheiten.json';
const UNIT_KEYS = { entries: 'milon.units.entries.v1', deleted: 'milon.units.deleted.v1' };
const GUMMY_CARBS_PER_100G = 77;   // Gummibärchen: 100 g Produkt ≈ 77 g Kohlenhydrate (Angabe des Nutzers 15.11.2026)
const FLUID_STEPS = [250, 500, 750];   // Getränk-Knöpfe in ml (Angabe des Nutzers 15.11.2026)
const GUT_OPTIONS = [['gut', 'gut'], ['grenzwertig', 'grenzwertig'], ['probleme', 'Probleme']];

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
const unitHasData = (e) => !!e && (e.carbs_g != null || e.fluid_ml != null || e.gut || (e.note || '').trim() || e.rpe != null);
/** Knopf für eine Einheit (Zeilen in Heute und Auswertung). */
function unitBtnHtml(it) {
  const e = unitEntryFor(it);
  const done = unitHasData(e);
  return `<button class="btn btn-sm u-btn ${done ? 'is-done' : ''}" data-act="u-open" data-u="${esc(JSON.stringify(it))}" aria-label="${esc(`${it.title}: ${done ? 'Erfasstes ansehen' : 'Verpflegung und Notiz erfassen'}`)}">${done ? '✓ Erfasst' : 'Erfassen'}</button>`;
}

/* ---------- Flaschen ---------- */
const getBottles = () => (Array.isArray(cfg.bottles) ? cfg.bottles.filter((b) => b && Number(b.g) > 0) : []);
/** Zuletzt benutzte Mengen (Flaschen und freie Eingaben), ohne die festen Flaschen, höchstens 3. */
function recentAmounts() {
  const fixed = new Set(getBottles().map((b) => Number(b.g)));
  const out = [];
  const list = getUnitEntries().slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  for (const e of list) for (const p of (e.carbs_parts || []).slice().reverse()) {
    const g = Number(p.g);
    if ((p.kind === 'flasche' || p.kind === 'frei') && g > 0 && !fixed.has(g) && !out.includes(g)) out.push(g);
    if (out.length >= 3) return out;
  }
  return out;
}
function bottlesSettingsHtml() {
  const list = getBottles();
  return `<div class="set-row is-wrap">
    <div class="set-text"><div class="set-label">Flaschen</div><div class="set-hint">Schnellknöpfe beim Erfassen einer Einheit (Kohlenhydrate je Flasche). Gilt für alle Geräte${GHSync.getConfig() ? '' : ' (nach dem Verbinden)'}</div></div>
    <ul class="u-bottles">${list.map((b, i) => `<li><span>${esc(b.label || 'Flasche')}</span><span class="m">${esc(String(b.g))} g</span><button class="icon-btn sm" data-act="u-bottle-del" data-i="${i}" aria-label="${esc(`${b.label || 'Flasche'} entfernen`)}">×</button></li>`).join('') || '<li class="muted small">Noch keine Flaschen.</li>'}</ul>
    <div class="form-row u-bottle-add"><input id="u-b-label" type="text" placeholder="Name, z. B. Flasche" maxlength="30"><input id="u-b-g" type="number" inputmode="numeric" min="1" max="1000" placeholder="g KH"><button class="btn btn-sm" data-act="u-bottle-add">Hinzufügen</button></div>
  </div>`;
}
function saveBottles(list) {
  saveSetting('bottles', list);
  saveSetting('bottlesUpdatedAt', new Date().toISOString());   // milon-settings.json, neueste Änderung gewinnt
  scheduleSync(1500);
}
/** Aktionen aus den Einstellungen (data-act="u-…" im Seiteninhalt). */
function handleUnitAction(act, el) {
  if (act === 'u-open') { try { openUnitSheet(JSON.parse(el.dataset.u)); } catch { /* defekte Daten am Knopf */ } return true; }
  if (act === 'u-bottle-del') { const l = getBottles(); l.splice(Number(el.dataset.i), 1); saveBottles(l); renderSettings(); return true; }
  if (act === 'u-bottle-add') {
    const g = Math.round(Number(document.getElementById('u-b-g')?.value));
    const label = (document.getElementById('u-b-label')?.value || '').trim() || 'Flasche';
    if (!(g > 0 && g <= 1000)) { toast('Bitte Kohlenhydrate der Flasche in g eingeben (1–1000).'); return true; }
    saveBottles([...getBottles(), { label, g }]);
    renderSettings();
    return true;
  }
  return false;
}

/* ---------- Fenster ---------- */
function openUnitSheet(it) {
  const old = unitEntryFor(it);
  const st = {
    carbs: old?.carbs_g ?? null, parts: Array.isArray(old?.carbs_parts) ? old.carbs_parts.slice() : [], manual: false,
    fluid: old?.fluid_ml ?? null, gut: old?.gut || null, note: old?.note || '', rpe: old?.rpe ?? null,
  };
  const sportName = (typeof SPORT_NAME !== 'undefined' && SPORT_NAME[it.sport]) || 'Einheit';
  const partsText = () => st.parts.map((p) => (p.kind === 'gummi' ? `Gummibärchen ${p.product_g} g (≈ ${p.g} g)` : `${p.label || (p.kind === 'frei' ? 'frei' : 'Flasche')} ${p.g} g`)).join(' + ')
    + (st.manual ? ' · von Hand geändert' : '');
  const amountBtn = (g, label) => `<button type="button" class="u-chip" data-u-carbs="${g}" data-u-label="${esc(label)}">${esc(label)} <span class="m">${g} g</span></button>`;
  const recent = recentAmounts();
  modalRoot.innerHTML = `<div class="modal-backdrop u-backdrop">
    <form class="modal u-sheet" role="dialog" aria-modal="true" aria-labelledby="u-title" novalidate>
      <div class="u-head"><div><div class="k">${esc(sportName)} · ${esc(dateShort(it.date))}</div><h2 id="u-title">${esc(it.title || sportName)}</h2></div>
        <button type="button" class="icon-btn sm" data-u-close aria-label="Schließen">×</button></div>
      <fieldset class="u-field"><legend class="k">Kohlenhydrate</legend>
        <div class="u-inrow"><input id="u-carbs" type="number" inputmode="numeric" min="0" max="2000" placeholder="0" value="${st.carbs ?? ''}"><span class="u-unit">g</span>
          <button type="button" class="btn btn-ghost btn-sm" data-u-carbs-reset ${st.carbs == null ? 'hidden' : ''}>Leeren</button></div>
        <div class="u-chips">${getBottles().map((b) => amountBtn(b.g, b.label || 'Flasche')).join('')}${recent.map((g) => amountBtn(g, 'zuletzt')).join('')}
          ${!getBottles().length ? '<span class="small muted">Flaschen legst du in den Einstellungen an.</span>' : ''}</div>
        <div class="u-inrow u-gummy"><span class="small">Gummibärchen</span><input id="u-gummy" type="number" inputmode="numeric" min="0" max="1000" placeholder="g Produkt"><button type="button" class="btn btn-sm" data-u-gummy>+ hinzufügen</button></div>
        <p class="small muted u-parts" id="u-parts">${esc(partsText())}</p>
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
      <fieldset class="u-field"><legend class="k">Belastungsempfinden <span class="muted">(optional, 1 = sehr leicht, 10 = maximal)</span></legend>
        <div class="u-rpe" role="radiogroup">${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<button type="button" role="radio" data-u-rpe="${n}" class="${st.rpe === n ? 'is-on' : ''}" aria-checked="${st.rpe === n}">${n}</button>`).join('')}</div>
      </fieldset>
      <div class="modal-actions ${old ? 'u-three' : ''}">
        ${old ? '<button type="button" class="btn btn-ghost" data-u-delete>Löschen</button>' : ''}
        <button type="button" class="btn btn-ghost" data-u-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">Speichern</button>
      </div>
    </form>
  </div>`;
  const root = modalRoot.querySelector('.u-backdrop');
  const form = root.querySelector('form');
  const $ = (id) => root.querySelector(`#${id}`);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const close = () => { modalRoot.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const syncCarbs = () => {
    $('u-carbs').value = st.carbs ?? '';
    $('u-parts').textContent = partsText();
    root.querySelector('[data-u-carbs-reset]').hidden = st.carbs == null;
  };
  const addCarbs = (part) => { st.parts.push(part); st.carbs = (Number(st.carbs) || 0) + part.g; syncCarbs(); };
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
    if (t.dataset.uCarbs) { const g = Number(t.dataset.uCarbs); addCarbs({ kind: t.dataset.uLabel === 'zuletzt' ? 'frei' : 'flasche', g, label: t.dataset.uLabel === 'zuletzt' ? undefined : t.dataset.uLabel }); return; }
    if (t.hasAttribute('data-u-carbs-reset')) { st.carbs = null; st.parts = []; st.manual = false; syncCarbs(); return; }
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
      carbs_g: st.carbs, carbs_parts: st.parts, fluid_ml: st.fluid, gut: st.gut, note: st.note.trim(), rpe: st.rpe,
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
