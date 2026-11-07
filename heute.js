'use strict';

/* =========================================================================
   Milon – Heute (Startseite), Auswertung, Körper-Details, Training
   Tagesdaten kommen aus health/daily.json und health/history.json im privaten Daten-Repository
   (erzeugt jeden Morgen von einer GitHub Action). Im Code steht nichts Persönliches.
   Garmin-Schätzwerte (Body Battery, Stress, Schlafscore, Normalbereich der HRV) tragen ein „G“.
   ========================================================================= */

const HEALTH_PATH = 'health/daily.json';
const HISTORY_PATH = 'health/history.json';
const HEALTH_KEY = 'milon.health.cache.v1';
const HISTORY_KEY = 'milon.health.history.v1';
const DAY_MS = 86400000;
const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const SPORT_SHORT = { swim: 'Schw', bike: 'Rad', run: 'Lauf' };
const SPORT_NAME = { swim: 'Schwimmen', bike: 'Rad', run: 'Laufen', strength: 'Kraft', race: 'Wettkampf', stretch: 'Dehnen' };

/* ---------- Daten ---------- */
const healthData = () => { const d = store.get(HEALTH_KEY, null); return d && Array.isArray(d.metrics) ? d : null; };
const historyData = () => { const d = store.get(HISTORY_KEY, null); return d && Array.isArray(d.dates) ? d : null; };

async function loadHealth() {
  const c = GHSync.getConfig();
  if (!c || navigator.onLine === false) return;
  let changed = false;
  for (const [path, key, ok] of [[HEALTH_PATH, HEALTH_KEY, (d) => Array.isArray(d?.metrics)], [HISTORY_PATH, HISTORY_KEY, (d) => Array.isArray(d?.dates)]]) {
    try {
      const r = await GHSync.readFile(c, path);
      if (!r || !ok(r.data)) continue;
      if (JSON.stringify(r.data) !== JSON.stringify(store.get(key, null))) { store.set(key, r.data); changed = true; }
    } catch { /* offline oder Datei fehlt – letzter Stand bleibt */ }
  }
  if (changed && ['home', 'koerper', 'training', 'belastung'].includes(currentRoute().name)) rerenderCurrent();
}

/* ---------- Jetzt abrufen: startet den Workflow „Tagesdaten“ im Daten-Repository ----------
   Holt dort neue Garmin-Daten und den Trainingsplan-Kalender und baut health/daily.json neu – also mehr als ein Abgleich.
   Braucht im Token zusätzlich „Actions: Read and write“. Ablauf: workflow_dispatch → Lauf beobachten → Tagesdaten neu laden. */
const HEALTH_WORKFLOW = 'taeglich.yml';
const refresh = { status: 'idle', message: '', url: '', startedAt: 0 };
function refreshStatusHtml() {
  const icon = { running: '…', done: '✓', error: '!' }[refresh.status] || '';
  if (refresh.status === 'idle') return '';
  return `<p class="small ${refresh.status === 'error' ? 'warn' : refresh.status === 'done' ? 'ok' : 'muted'}" id="refresh-msg">${icon} ${esc(refresh.message)}${refresh.url ? ` <a href="${esc(refresh.url)}" target="_blank" rel="noopener">Auf GitHub ansehen</a>` : ''}</p>`;
}
function setRefresh(status, message, url = refresh.url) {
  Object.assign(refresh, { status, message, url });
  const box = document.getElementById('refresh-status');
  if (box) box.innerHTML = refreshStatusHtml();
  const btn = document.querySelector('[data-act="h-refresh"]');
  if (btn) btn.disabled = status === 'running';
}
async function refreshHealthNow() {
  const c = GHSync.getConfig();
  if (!c || refresh.status === 'running') return;
  if (navigator.onLine === false) { setRefresh('error', 'Offline – ohne Internet kann der Abruf nicht starten.', ''); return; }
  const startedAt = Date.now();
  refresh.startedAt = startedAt;
  setRefresh('running', 'Abruf wird auf GitHub gestartet …', '');
  try {
    await GHSync.repoApi(c, 'POST', `/actions/workflows/${HEALTH_WORKFLOW}/dispatches`, { ref: c.branch || 'main', inputs: { days: '3' } });
  } catch (e) {
    const noRight = e.status === 403 || e.status === 404;
    setRefresh('error', noRight
      ? 'Dem Token fehlt die Berechtigung „Actions: Read and write“ für das Daten-Repository. Auf GitHub beim Token ergänzen, dann erneut versuchen.'
      : (e.message || 'Start fehlgeschlagen.'), '');
    return;
  }
  setRefresh('running', 'Garmin-Daten und Trainingsplan werden abgerufen … (ca. 1 Minute)');
  const deadline = startedAt + 5 * 60 * 1000;
  while (Date.now() < deadline && refresh.startedAt === startedAt) {
    await new Promise((r) => setTimeout(r, 6000));
    let wf = null;
    try {
      const r = await GHSync.repoApi(c, 'GET', `/actions/workflows/${HEALTH_WORKFLOW}/runs?event=workflow_dispatch&per_page=5`);
      wf = (r?.workflow_runs || []).find((x) => Date.parse(x.created_at) >= startedAt - 60000) || null;
    } catch { continue; } // kurz kein Netz – weiter warten
    if (!wf) continue;
    if (wf.status !== 'completed') { setRefresh('running', wf.status === 'queued' ? 'Wartet auf GitHub …' : 'Garmin-Daten und Trainingsplan werden abgerufen …', wf.html_url); continue; }
    if (wf.conclusion === 'success') {
      await loadHealth();
      const d = healthData();
      const t = d?.updated ? new Date(d.updated).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
      setRefresh('done', `Fertig – Tagesdaten${t ? ` von ${t} Uhr` : ''} geladen.`, '');
    } else {
      await loadHealth(); // Kalender oder Teilergebnisse können trotzdem neu sein
      setRefresh('error', 'Der Abruf ist fehlgeschlagen (meist Garmin: Schlüssel abgelaufen oder Dienst nicht erreichbar).', wf.html_url);
    }
    return;
  }
  if (refresh.startedAt === startedAt) setRefresh('error', 'Keine Rückmeldung von GitHub – später unter „Jetzt abgleichen“ erneut laden.', refresh.url);
}

/** Karte in den Einstellungen. */
function refreshCardHtml() {
  if (!GHSync.getConfig()) return '';
  const d = healthData();
  const t = d?.updated ? new Date(d.updated).toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'noch keine';
  return `<section class="card">
    <h2 class="card-title">Tagesdaten abrufen</h2>
    <p class="small muted">Startet auf GitHub den Abruf <strong>neuer Garmin-Daten</strong> (Schlaf, HRV, Ruhepuls, Aktivitäten) und des
      <strong>Trainingsplan-Kalenders</strong> und baut daraus die Tagesdaten für „Heute“ neu. Das ist mehr als „Jetzt abgleichen“,
      das nur die Dateien zwischen Gerät und GitHub austauscht. Läuft sonst automatisch jeden Morgen; dauert etwa 1 Minute.</p>
    <ul class="status-list small"><li><span class="muted">Tagesdaten</span><strong>${esc(t)}</strong></li></ul>
    <div id="refresh-status">${refreshStatusHtml()}</div>
    <div class="btn-row"><button class="btn btn-secondary" data-act="h-refresh" ${refresh.status === 'running' ? 'disabled' : ''}>Garmin & Plan jetzt abrufen</button></div>
    <p class="small muted">Braucht im Token zusätzlich die Berechtigung „Actions: Read and write“.</p>
  </section>`;
}

/* ---------- Formatierung ---------- */
const fmtHM = (h) => { if (h == null) return '–'; const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${pad2(Math.abs(m % 60))}`; };
const fmtInt = (n) => (n == null ? '–' : Math.round(n).toLocaleString('de-DE'));
const fmtDec = (n, d = 1) => (n == null ? '–' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: d }));
const metricDecimals = (id) => (id === 'rhr' || id === 'resp' ? 1 : 0);
function fmtMetric(m, v) {
  if (v == null) return '–';
  if (m.id === 'sleep') return fmtHM(v);
  if (m.id === 'steps') return fmtInt(v);
  return fmtDec(v, metricDecimals(m.id));
}
/** Pfeil + Abweichung, grün = besser, rot = schlechter (Richtung je Wert). */
function deltaHtml(m) {
  if (m.delta == null || m.avg28 == null) return '';
  const thr = m.id === 'sleep' ? 5 / 60 : m.id === 'steps' ? 250 : m.id === 'rhr' || m.id === 'resp' ? 0.5 : 1;
  if (Math.abs(m.delta) < thr) return '<span>→</span>';
  const up = m.delta > 0;
  const good = m.better === 'none' ? null : (m.better === 'up') === up;
  const cls = good == null ? '' : good ? 'ok' : 'bad';
  const val = m.id === 'sleep' ? fmtHM(Math.abs(m.delta)) : m.id === 'steps' ? fmtInt(Math.abs(m.delta)) : fmtDec(Math.abs(m.delta), metricDecimals(m.id));
  return `<span class="${cls}">${up ? '↑' : '↓'} ${esc(val)}</span>`;
}
/** Erster Satz einer Erkenntnis (die ganze steht in der Auswertung). */
function firstSentence(t) {
  const m = String(t || '').match(/^(.{20,}?[.!?])\s+[A-ZÄÖÜ„(]/);
  const s = m ? m[1] : String(t || '');
  return s.length > 140 ? `${s.slice(0, 137).replace(/\s+\S*$/, '')} …` : s;
}
const gBadge = (title = 'von Garmin berechnet') => `<span class="g-badge" title="${esc(title)}">G</span>`;
const dateLong = (d) => d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const dateShort = (k) => { const d = parseDay(k); return `${WD_SHORT[(d.getDay() + 6) % 7]} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.`; };
const daysUntil = (k, now = new Date()) => Math.round((parseDay(k) - parseDay(dayKey(now))) / DAY_MS);

/* ---------- kleine Diagramme (SVG, dünne Tintenlinien) ---------- */
function lineSvg(values, { gray = false, band = null, h = 28, cls = '', label = '' } = {}) {
  const v = values.map((x) => (Number.isFinite(x) ? x : null));
  const nums = v.filter((x) => x != null).concat(band ? [band.low, band.high].filter(Number.isFinite) : []);
  if (v.filter((x) => x != null).length < 2) return '';
  const lo = Math.min(...nums), hi = Math.max(...nums), span = hi - lo || 1;
  const y = (x) => (h - 2 - ((x - lo) / span) * (h - 4)).toFixed(1);
  const x = (i) => (v.length === 1 ? 50 : (i / (v.length - 1)) * 100).toFixed(1);
  const segs = []; let cur = [];
  v.forEach((val, i) => { if (val == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(`${x(i)},${y(val)}`); });
  if (cur.length) segs.push(cur);
  const stroke = gray ? 'var(--text-3)' : 'var(--ink)';
  const bandRect = band && Number.isFinite(band.low) && Number.isFinite(band.high)
    ? `<rect x="0" y="${y(band.high)}" width="100" height="${(y(band.low) - y(band.high)).toFixed(1)}" fill="var(--band)"/>` : '';
  return `<svg class="${cls}" viewBox="0 0 100 ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${bandRect}${segs.map((s) => s.length > 1
    ? `<polyline fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${s.join(' ')}"/>`
    : `<circle cx="${s[0].split(',')[0]}" cy="${s[0].split(',')[1]}" r=".9" fill="${stroke}"/>`).join('')}</svg>`;
}

/* =========================================================================
   Heute
   ========================================================================= */
function renderHeute() {
  const now = new Date();
  const d = healthData();
  const hist = getHistory();
  const s = computeStreak(hist, now);
  const a = computeWeekly(hist, now);
  const wk = d?.week && d.week.from === dayKey(weekStart(now)) ? d.week : null;
  const p = wk?.plan;
  const kicker = [`KW ${isoWeek(now)}`, p?.week ? `Planwoche ${p.week}${p.of ? ` von ${p.of}` : ''}` : '', p?.phase || ''].filter(Boolean).join(' · ');
  const upd = d?.updated ? new Date(d.updated) : null;
  const stale = !upd || now - upd > DAY_MS || (d.data_date && d.data_date < dayKey(now));
  const warns = (d?.warnings || []).filter((w) => w.id !== 'stale' || d.data_date !== dayKey(now));
  app.innerHTML = `<div class="page page-wide">
    <header class="h-head">
      <div>
        <div class="k">${esc(kicker)}</div>
        <h1 class="h-date">${esc(dateLong(now))}</h1>
      </div>
      <div class="head-right">
        ${upd ? `<span class="h-stamp ${stale ? 'is-old' : ''}" title="Tagesdaten vom ${esc(upd.toLocaleString('de-DE'))}"><i></i>Daten von ${esc(upd.toDateString() === now.toDateString() ? upd.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : dateShort(dayKey(upd)))}</span>` : ''}
        <a class="icon-btn has-dot" href="#/settings" aria-label="Einstellungen">${ICONS.settings}${GHSync.getConfig() ? `<i id="sync-dot" class="sync-dot s-${sync.status}" title="${esc(syncTitle())}"></i>` : ''}</a>
      </div>
    </header>
    ${storageOk ? '' : '<section class="card warn-card"><strong>Speichern nicht möglich.</strong> Dieser Browser blockiert den lokalen Speicher (z. B. privates Fenster). Streak und Verlauf gehen beim Schließen verloren.</section>'}
    <div class="h-grid">
      ${warns.length ? `<div class="h-warns" style="display:grid;gap:8px">${warns.map((w) => `<div class="h-warn lv-${esc(w.level)}">${esc(w.text)}</div>`).join('')}</div>` : ''}
      ${assessHtml(d)}
      ${todoHtml(d, s, a, now)}
      ${metricsHtml(d)}
      ${loadTileHtml()}
      ${weekCardHtml(d, wk, s, now)}
      ${racesHtml(d, now)}
      <section class="tile gcal-card" id="h-cal">${gcalHtml(now, 0, { compact: true })}</section>
    </div>
    ${backupReminderHtml(hist, now)}
  </div>`;
}

/* ---------- Einschätzung + letzte Woche ---------- */
const AMP_LABEL = { green: 'Grünes Licht', yellow: 'Vorsicht', red: 'Rot – zurücknehmen', none: 'Keine Messwerte' };
function assessHtml(d) {
  const t = trainingData();
  const w = t?.weeks?.[0];
  const pick = (type) => (w?.insights || []).find((i) => i.type === type);
  const ins = ['good', 'bad', 'next'].map(pick).filter(Boolean);
  const kw = w ? Number(w.week.split('-W')[1]) : null;
  const delta = w?.hours_prev4 ? Math.round((w.hours / w.hours_prev4 - 1) * 100) : null;
  const a = d?.assessment;
  return `<section class="tile h-assess span-2">
    <div class="sec-head"><span class="k">Einschätzung heute</span>${a ? `<span class="amp lv-${esc(a.level)}"><i></i>${esc(AMP_LABEL[a.level] || '')}</span>` : ''}</div>
    ${a ? `<p class="h-assess-text">${esc(a.text)}</p>${a.garmin_note ? `<p class="h-gnote">${gBadge()} ${esc(a.garmin_note)}</p>` : ''}`
      : `<p class="h-assess-text">Noch keine Tagesdaten.</p><p class="small muted">${GHSync.getConfig() ? 'Die Datei <code>health/daily.json</code> fehlt im Daten-Repository oder wurde noch nicht geladen.' : 'Verbinde zuerst die Synchronisierung in den Einstellungen.'}</p>`}
    ${w ? `<hr class="rule">
      <div class="sec-head"><span class="k">Letzte Woche · KW ${kw}</span><span class="m small muted">${fmtHM(w.hours)} h${delta ? ` · ${delta > 0 ? '+' : '−'}${Math.abs(delta)} %` : ''}</span></div>
      ${w.headline ? `<p class="h-headline">${esc(w.headline)}</p>` : ''}
      ${ins.length ? `<ul class="h-ins cols">${ins.map((i) => `<li class="t-${esc(i.type)}"><span class="mk">${INSIGHT_MARK[i.type]}</span><span>${esc(firstSentence(i.text))}</span></li>`).join('')}</ul>` : ''}
      <a class="link" href="#/auswertung">Ganze Auswertung</a>` : ''}
  </section>`;
}

/* ---------- Steht heute an ---------- */
const gymDays = () => (Array.isArray(cfg.gymDays) ? cfg.gymDays : [1, 3, 5]); // getDay(): 0 = So, 1 = Mo …
function todoHtml(d, s, a, now) {
  const tKey = dayKey(now);
  const rows = [];
  let openMin = 0;
  // 1. Einheiten aus dem Trainingsplan (Kraft aus dem Plan zählt nicht – Gym kommt aus Milon)
  const day = d?.week?.days?.find((x) => x.date === tKey);
  for (const it of (day?.planned || []).filter((x) => x.sport !== 'strength')) {
    if (!it.done && it.min) openMin += it.min;
    const title = `${SPORT_NAME[it.sport] || 'Einheit'} · ${it.title}`;
    rows.push(`<div class="h-row ${it.done ? 'is-done' : ''}">
      <span class="sdot s-${esc(it.sport)}" aria-hidden="true"></span>
      <div class="h-row-main">${it.desc ? `<details><summary><div class="h-row-title">${esc(title)}</div><div class="h-row-sub">${[it.min ? `${fmtHM(it.min / 60)} h` : '', it.time && it.time !== '00:00' ? it.time : '', 'aus dem Plan · Details'].filter(Boolean).join(' · ')}</div></summary><p class="h-row-desc">${esc(it.desc)}</p></details>`
        : `<div class="h-row-title">${esc(title)}</div><div class="h-row-sub">${it.min ? `${fmtHM(it.min / 60)} h · ` : ''}aus dem Plan</div>`}</div>
    </div>`);
  }
  // 2. Gym (nächster Split) an den Gym-Tagen, solange das Wochenziel offen ist – oder wenn heute erledigt
  if (typeof gymPlans === 'function' && gymPlans()) {
    const list = getGymSessions();
    const wc = weekCounts(weekKey(now), list);
    const today = wc.all.filter((x) => x.date === tKey);
    const doneToday = today.find((x) => !isSkip(x));
    const next = nextSplit(list);
    const draft = next && savedDraft(next.id);
    if (doneToday) {
      rows.push(`<div class="h-row is-done"><span class="sdot s-strength" aria-hidden="true"></span>
        <div class="h-row-main"><div class="h-row-title">Gym · ${esc(splitById(doneToday.splitId)?.name || doneToday.splitName || '')}</div><div class="h-row-sub">diese Woche ${wc.n} von ${wc.target}</div></div></div>`);
    } else if (next && !today.length && (draft || (wc.n < wc.target && gymDays().includes(now.getDay())))) {
      const n = next.exercises.filter((e) => !COLLAPSED_BLOCKS.includes(e.block) && e.block !== 'warmup').length;
      openMin += 60;
      rows.push(`<div class="h-row"><span class="sdot s-strength" aria-hidden="true"></span>
        <div class="h-row-main"><div class="h-row-title">Gym · ${esc(next.name)}</div><div class="h-row-sub">${n} Übungen · diese Woche ${wc.n} von ${wc.target}${draft ? ' · begonnen' : ''}</div></div>
        <a class="btn" href="#/gym/log/${encodeURIComponent(next.id)}">${draft ? 'Fortsetzen' : 'Erfassen'}</a></div>`);
    }
  }
  // 3. Dehnen (fester Rhythmus aus app.js: nachholen, Einheit des Tages, Wochen-Routine, Zusatz)
  rows.push(...dehnRows(s, a, now, (m) => { openMin += m; }));
  return `<section class="tile h-todo span-2">
    <div class="h-todo-head"><span class="k">Steht heute an</span>${openMin ? `<span class="m small muted">~${fmtHM(openMin / 60)} h</span>` : ''}</div>
    ${rows.join('') || '<div class="h-empty">Heute steht nichts an.</div>'}
  </section>`;
}
function dehnRow(r, label, btn, { done = false, sub = '' } = {}) {
  return `<div class="h-row ${done ? 'is-done' : ''}"><span class="sdot s-stretch" aria-hidden="true"></span>
    <div class="h-row-main"><div class="h-row-title">${esc(label)}</div><div class="h-row-sub">${esc(sub || `${r.exercises.length} Übungen · ${Math.max(1, Math.round(totalDuration(r) / 60))} min`)}</div></div>
    ${btn && !done ? `<a class="btn" href="#/routine/${encodeURIComponent(r.id)}">${esc(btn)}</a>` : ''}</div>`;
}
function dehnRows(s, a, now, addMin) {
  const out = [];
  const tKey = dayKey(now);
  const expected = s.expectedToday;
  const serie = s.current ? ` · Serie ${s.current}` : '';
  const owedR = s.owed ? routineById(s.owed) : null;
  if (owedR) {
    addMin(totalDuration(owedR) / 60);
    out.push(dehnRow(owedR, `Dehnen · ${shortName(owedR)} nachholen`, 'Nachholen', { sub: `von gestern · zählt ohne Joker${serie}` }));
  }
  if (s.todayStatus === 'done' && !(s.madeUpToday && expected === 'pause')) {
    const r = routineById(expected);
    if (r) out.push(dehnRow(r, `Dehnen · ${shortName(r)}`, null, { done: true, sub: `erledigt${serie} · morgen ${planName(nextExpected(s))}` }));
  } else if (s.madeUpToday && expected === 'pause') {
    const r = routineById(s.madeUpToday);
    if (r) out.push(dehnRow(r, `Dehnen · ${shortName(r)}`, null, { done: true, sub: `nachgeholt${serie} · morgen ${planName(nextExpected(s))}` }));
  } else if (expected === 'pause') {
    if (!owedR) out.push(`<div class="h-row"><span class="sdot s-stretch" aria-hidden="true"></span><div class="h-row-main"><div class="h-row-title">Dehnen · Pause</div><div class="h-row-sub">zählt automatisch${serie} · morgen ${esc(planName(nextExpected(s)))}</div></div></div>`);
  } else {
    const r = routineById(expected);
    if (r) { addMin(totalDuration(r) / 60); out.push(dehnRow(r, `Dehnen · ${shortName(r)}`, 'Start', { sub: `${r.exercises.length} Übungen · ${Math.max(1, Math.round(totalDuration(r) / 60))} min${serie}` })); }
  }
  const role = weeklyRole();
  const weeklyR = role ? routineById(role.routine) : null;
  if (weeklyR && now.getDay() === role.weekday) {
    if (!a.doneToday) addMin(totalDuration(weeklyR) / 60);
    out.push(dehnRow(weeklyR, `Dehnen · ${shortName(weeklyR)}`, 'Start', { done: a.doneToday, sub: `Wochen-Routine${role.hint ? ` · ${role.hint}` : ''} · ${a.current} ${plural(a.current, 'Woche', 'Wochen')}` }));
  }
  const ex = extraRole();
  const extra = ex ? routineById(ex.routine) : null;
  const todaysPlan = s.doneToday || expected;
  if (extra && (ex.onPlanDays || []).includes(todaysPlan) && !getHistory().some((h) => h.routineId === extra.id && h.date === tKey)) {
    out.push(dehnRow(extra, `Optional · ${shortName(extra)}`, 'Start'));
  }
  return out;
}

/* ---------- Körper: 8 Kacheln ---------- */
function metricsHtml(d) {
  if (!d?.metrics?.length) return '';
  return `<div class="h-metrics-head"><span class="k">Körper · heute und 28 Tage</span><span class="h-legend">${gBadge()} = von Garmin berechnet</span></div>
    <div class="h-metrics">${d.metrics.map(metricTileHtml).join('')}</div>`;
}
function metricTileHtml(m) {
  const g = m.garmin_estimate ? gBadge() : '';
  const avg = m.avg28 != null ? `Ø ${m.id === 'sleep' ? fmtHM(m.avg28) : m.id === 'steps' ? fmtInt(m.avg28) : fmtDec(m.avg28, 1)}` : '';
  if (m.id === 'steps') {
    const s7 = m.series7 || [];
    const max = Math.max(1, ...s7.map((x) => x.value || 0));
    const last = s7[s7.length - 1];
    return `<a class="tile mt" href="#/koerper/steps">
      <div class="mt-lab"><span class="k">Schritte · 7 Tage</span>${g}</div>
      <div class="mt-vr"><div class="mt-val">${fmtInt(m.value)}<small> Ø/Tag</small></div><div class="mt-d">${last?.value != null ? `gestern ${fmtInt(last.value)}` : avg}</div></div>
      <div class="mt-bars" role="img" aria-label="Schritte der letzten 7 Tage">${s7.map((x, i) => `<i class="${i === s7.length - 1 ? 'is-last' : ''}" style="height:${Math.max(2, Math.round(((x.value || 0) / max) * 100))}%"></i>`).join('')}</div>
      <div class="mt-days">${s7.map((x) => `<span>${WD_SHORT[(parseDay(x.date).getDay() + 6) % 7]}</span>`).join('')}</div>
    </a>`;
  }
  const band = m.id === 'hrv' && m.band ? { low: m.band.low, high: m.band.high } : null;
  return `<a class="tile mt" href="#/koerper/${encodeURIComponent(m.id)}">
    <div class="mt-lab"><span class="k">${esc(m.label)}</span>${g}</div>
    <div class="mt-vr"><div class="mt-val">${esc(fmtMetric(m, m.value))}${m.unit ? `<small> ${esc(m.unit)}</small>` : ''}</div><div class="mt-d">${deltaHtml(m)}${avg ? ` · ${avg}` : ''}</div></div>
    ${lineSvg(m.series28 || [], { gray: m.garmin_estimate, band, label: `${m.label} 28 Tage` })}
  </a>`;
}

/* ---------- Diese Woche ---------- */
/** Punkte je Tag: Sportarten aus dem Plan (gefüllt = erledigt, Ring = offen), Gym und Dehnen aus Milon. */
function dayDots(k, d, s, now) {
  const tKey = dayKey(now);
  const dots = [];
  const day = d?.week?.days?.find((x) => x.date === k);
  for (const p of (day?.planned || []).filter((x) => x.sport !== 'strength')) dots.push({ c: p.sport, o: !p.done });
  for (const x of (day?.done || []).filter((x) => !x.planned && ['swim', 'bike', 'run'].includes(x.sport))) dots.push({ c: x.sport, o: false });
  const sessions = typeof getGymSessions === 'function' ? getGymSessions().filter((x) => x.date === k && !isSkip(x)) : [];
  if (sessions.length) dots.push({ c: 'strength', o: false });
  else if (k >= tKey && typeof gymPlans === 'function' && gymPlans() && gymDays().includes(parseDay(k).getDay())) {
    const wc = weekCounts(weekKey(parseDay(k)), getGymSessions());
    if (wc.n < wc.target && weekKey(parseDay(k)) === weekKey(now)) dots.push({ c: 'strength', o: true });
  }
  const st = s.days.get(k);
  const dehnDone = getHistory().some((h) => h.date === k && h.routineId !== WEEKLY_ID());
  if (dehnDone || st === 'done' || st === 'late') dots.push({ c: 'stretch', o: false });
  else if (k >= tKey && s.startKey && s.planOn(k) !== 'pause') dots.push({ c: 'stretch', o: true });
  else if (k === tKey && s.owed) dots.push({ c: 'stretch', o: true });
  const wd = weeklyDot(k, tKey);
  if (wd) dots.push(wd);
  return dots;
}
/** Wochen-Routine (roles.weekly): eigener Punkt – erledigt an jedem Tag mit Eintrag, geplant (Ring) am festen Wochentag,
    solange sie in dieser Woche noch nicht gemacht ist. */
function weeklyDot(k, tKey, hist = getHistory()) {
  const role = weeklyRole();
  if (!role || !routineById(role.routine)) return null;
  if (hist.some((h) => h.date === k && h.routineId === role.routine)) return { c: 'weekly', o: false };
  const day = parseDay(k);
  if (k < tKey || day.getDay() !== Number(role.weekday)) return null;
  const wk = weekKey(day);
  return hist.some((h) => h.routineId === role.routine && weekKey(parseDay(h.date)) === wk) ? null : { c: 'weekly', o: true };
}
const weeklyLegend = () => (weeklyRole() && routineById(WEEKLY_ID()) ? `<span><i class="s-weekly"></i>${esc(weeklyName())}</span>` : '');
const dotsHtml = (dots) => `<span class="dots">${dots.map((x) => `<i class="s-${esc(x.c)} ${x.o ? 'o' : ''}"></i>`).join('')}</span>`;

function weekCardHtml(d, wk, s, now) {
  const mon = weekStart(now);
  const tKey = dayKey(now);
  const done = wk ? wk.done_total_h : 0;
  const planned = wk ? wk.planned_total_h : 0;
  const pct = planned ? Math.round((done / planned) * 100) : null;
  const bar = wk && planned ? ['swim', 'bike', 'run'].map((k) => `<i class="s-${k}" style="width:${Math.min(100, ((wk.done_h[k] || 0) / planned) * 100).toFixed(1)}%"></i>`).join('') : '';
  // Gym (Milon) und Dehnen (fester Rhythmus) der laufenden Woche
  let gym = '';
  if (typeof gymPlans === 'function' && gymPlans()) { const wc = weekCounts(weekKey(now), getGymSessions()); gym = `Gym ${wc.n} von ${wc.target}`; }
  let dPlan = 0, dDone = 0;
  for (let i = 0; i < 7; i++) {
    const k = dayKey(addDays(mon, i));
    if (s.startKey && k >= s.startKey && s.planOn(k) !== 'pause') dPlan++;
    const st = s.days.get(k);
    if (st === 'done' || st === 'late') dDone++;
  }
  const w12 = (d?.weeks12 || []);
  const max12 = Math.max(1, ...w12.map((x) => x.hours || 0));
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(mon, i);
    const k = dayKey(day);
    return `<div class="${k === tKey ? 't' : k > tKey ? 'f' : ''}"><small>${WD_SHORT[i]}</small><b>${day.getDate()}</b>${dotsHtml(dayDots(k, d, s, now))}</div>`;
  }).join('');
  return `<section class="tile h-week span-2">
    <div class="sec-head"><span class="k">Diese Woche</span><span class="m small muted">${pct != null ? `${pct} %` : ''}</span></div>
    <div class="h-week-top">
      <div class="h-hours">${fmtHM(done)}<span>${planned ? ` von ${fmtHM(planned)} h geplant` : ' h'}</span></div>
      ${w12.length ? `<div class="h-12w" role="img" aria-label="Trainingsstunden der letzten 12 Wochen">${w12.map((x) => `<i class="${x.current ? 'is-now' : ''}" style="height:${Math.max(3, Math.round((x.hours / max12) * 100))}%" title="KW ${Number(x.week.split('-W')[1])}: ${fmtHM(x.hours)} h"></i>`).join('')}</div>` : ''}
    </div>
    ${bar ? `<div class="h-sbar">${bar}</div>` : ''}
    <div class="h-sums">${['swim', 'bike', 'run'].map((k) => `<span>${SPORT_SHORT[k]} ${fmtHM(wk?.done_h?.[k] || 0)}</span>`).join('')}${gym ? `<span>${gym}</span>` : ''}${dPlan ? `<span class="x-stretch">Dehnen ${dDone} von ${dPlan}</span>` : ''}</div>
    <div class="wk">${days}</div>
    <div class="h-leg"><span><i class="s-swim"></i>Schwimmen</span><span><i class="s-bike"></i>Rad</span><span><i class="s-run"></i>Laufen</span><span><i class="s-strength"></i>Gym</span><span><i class="s-stretch"></i>Dehnen</span>${weeklyLegend()}<span>gefüllt = erledigt · Ring = offen</span></div>
  </section>`;
}

/* ---------- Wettkämpfe ---------- */
function racesHtml(d, now) {
  const list = (d?.races?.list || []).filter((r) => daysUntil(r.date, now) >= 0);
  if (!list.length) return '';
  const firstRace = list.find((r) => r.kind === 'race');
  return `<section class="tile h-races">
    <div class="h-todo-head"><span class="k">Wettkämpfe</span></div>
    ${list.map((r) => `<div class="h-race">
      <div style="flex:1;min-width:0">
        ${r === firstRace ? '<div class="k is-next">Nächster</div>' : r.kind === 'season_goal' ? '<div class="k">Saisonziel</div>' : ''}
        <div class="h-race-name">${esc(r.name)}${r.distance && r.kind !== 'season_goal' ? ` · ${esc(r.distance)}` : ''}</div>
        <div class="h-race-sub">${esc(dateShort(r.date))}${r.goal ? ` · Ziel ${esc(r.goal)}` : ''}</div>
      </div>
      <div><div class="h-race-n">${daysUntil(r.date, now)}</div><div class="m small muted" style="text-align:right;font-size:10.5px">Tage</div></div>
    </div>`).join('')}
  </section>`;
}

/* ---------- Kalender Gym & Dehnen & Wettkampf (5 Wochen, blätterbar) ---------- */
let gcalOffset = 0; // 0 = die letzten 5 Wochen bis zur laufenden, 1 = 5 Wochen davor …
function gcalHtml(now, offset = 0, { compact = false } = {}) {
  const hist = getHistory();
  const s = computeStreak(hist, now);
  const tKey = dayKey(now);
  const start = addDays(weekStart(now), -28 - offset * 35);
  const raceDays = new Set((healthData()?.races?.list || []).map((r) => r.date));
  for (const day of healthData()?.week?.days || []) if ((day.planned || []).some((p) => p.sport === 'race')) raceDays.add(day.date);
  const cells = [];
  for (let i = 0; i < 35; i++) {
    const day = addDays(start, i);
    const k = dayKey(day);
    const dots = [];
    const gym = typeof getGymSessions === 'function' ? getGymSessions().filter((x) => x.date === k && !isSkip(x)) : [];
    if (gym.length) dots.push({ c: 'strength' });
    else if (k >= tKey && typeof gymPlans === 'function' && gymPlans() && gymDays().includes(day.getDay()) && weekKey(day) === weekKey(now)) {
      const wc = weekCounts(weekKey(now), getGymSessions());
      if (wc.n < wc.target) dots.push({ c: 'strength', o: true });
    }
    const st = s.days.get(k);
    if (hist.some((h) => h.date === k && h.routineId !== WEEKLY_ID()) || st === 'done' || st === 'late') dots.push({ c: 'stretch' });
    else if (k >= tKey && s.startKey && s.planOn(k) !== 'pause') dots.push({ c: 'stretch', o: true });
    const wd = weeklyDot(k, tKey, hist);
    if (wd) dots.push(wd);
    if (raceDays.has(k)) dots.push({ c: 'race', o: k > tKey });
    const first = i === 0 || day.getDate() === 1;
    cells.push(`<div class="c ${k === tKey ? 't' : k > tKey ? 'f' : ''}" title="${esc(fmtDate(k))}"><b>${first && !compact ? `${day.getDate()}.${day.getMonth() + 1}.` : day.getDate()}</b>${dotsHtml(dots)}</div>`);
  }
  const end = addDays(start, 34);
  const range = `${start.getDate()}.${start.getMonth() + 1}. – ${end.getDate()}.${end.getMonth() + 1}.`;
  return `<div class="sec-head"><span class="k">Gym & Dehnen</span>
      ${compact ? '<span class="m small muted">5 Wochen</span>' : `<span class="gcal-nav"><button class="icon-btn sm" data-act="h-cal-prev" aria-label="Frühere Wochen">${ICONS.back}</button><span class="m small muted">${esc(range)}</span><button class="icon-btn sm" data-act="h-cal-next" aria-label="Spätere Wochen" ${offset === 0 ? 'disabled' : ''}>${ICONS.chevron}</button></span>`}</div>
    <div class="gcal">${WD_SHORT.map((x) => `<div class="h">${x}</div>`).join('')}${cells.join('')}</div>
    <div class="h-leg"><span><i class="s-strength"></i>Gym</span><span><i class="s-stretch"></i>Dehnen</span>${weeklyLegend()}<span><i class="s-race"></i>Wettkampf</span><span><i class="o"></i>geplant</span></div>`;
}

/* =========================================================================
   Ganze Auswertung (bisherige Karte Trainingswoche: Stunden → Erkenntnisse → Zahlen, blätterbar, Vorschau)
   ========================================================================= */
function renderAuswertung() {
  app.innerHTML = `<div class="page">
    ${topbar({ backHref: '#/', title: 'Auswertung' })}
    ${trainingHtml() || '<section class="card"><p class="small muted">Noch keine Wochenauswertung (training/weekly.json).</p></section>'}
  </div>`;
}

/* =========================================================================
   Körper – Detailseite einer Kachel (2 Wochen / 1 Monat / 6 Monate)
   ========================================================================= */
const KD_RANGES = [{ days: 14, label: '2 Wochen' }, { days: 30, label: '1 Monat' }, { days: 182, label: '6 Monate' }];
let kdDays = 30;
const KD_NOTES = {
  hrv: 'HRV-Nachtwert (Messwert, Durchschnitt der Nacht). Das graue Band ist dein persönlicher Normalbereich – von Garmin berechnet.',
  rhr: 'Ruhepuls des Tages (Messwert).',
  sleep: 'Schlafdauer der Nacht (Messwert), dem Aufwachtag zugeordnet.',
  sleep_score: 'Schlafscore – von Garmin berechnet. Nur ergänzend, keine Schlussfolgerung allein darauf.',
  body_battery: 'Body Battery, Tageshöchstwert (meist morgens) – von Garmin berechnet.',
  stress: 'Stress, Durchschnitt des ganzen Tages – von Garmin berechnet.',
  steps: 'Schritte pro Tag (Messwert). Tage unter 500 Schritten gelten als „Uhr nicht getragen“.',
  resp: 'Atemfrequenz im Schlaf (Messwert).',
};
function renderKoerper(id) {
  const d = healthData();
  const m = d?.metrics?.find((x) => x.id === id);
  const h = historyData();
  if (!m) { redirect('#/'); return; }
  const dates = h?.dates || [];
  const all = h?.metrics?.[id] || [];
  const n = Math.min(kdDays, dates.length);
  const ds = dates.slice(-n);
  const tKey = todayKey();
  // Schritte: heutiger Tag ist noch nicht voll, unter 500 = Uhr nicht getragen
  let vs = all.slice(-n).map((v, i) => (id === 'steps' && v != null && (v < 500 || ds[i] >= tKey) ? null : v));
  const bandLo = id === 'hrv' ? (h?.metrics?.hrv_band_low || []).slice(-n) : null;
  const bandHi = id === 'hrv' ? (h?.metrics?.hrv_band_high || []).slice(-n) : null;
  const nums = vs.filter((v) => v != null);
  const avg = nums.length ? nums.reduce((x, y) => x + y, 0) / nums.length : null;
  const fmt = (v) => fmtMetric(m, v);
  const chart = kdChartSvg(m, vs, bandLo, bandHi, avg);
  const last = ds.map((k, i) => ({ k, v: vs[i] })).filter((x) => x.v != null).slice(-7).reverse();
  app.innerHTML = `<div class="page">
    ${topbar({ backHref: '#/', title: '' })}
    <div class="k">${esc(m.label)} ${m.garmin_estimate ? gBadge() : ''}</div>
    <div class="kd-val" style="margin-top:6px">${esc(fmtMetric(m, m.value))}${m.unit ? `<small> ${esc(m.unit)}</small>` : id === 'steps' ? '<small> Ø/Tag (7 Tage)</small>' : ''}</div>
    <div class="mt-d" style="margin:4px 0 14px">${m.date ? esc(dateShort(m.date)) : ''} ${deltaHtml(m)}${m.avg28 != null ? ` · Ø 28 Tage ${esc(fmt(m.avg28))}` : ''}</div>
    <div class="seg" role="tablist">${KD_RANGES.map((r) => `<button role="tab" class="${r.days === kdDays ? 'is-on' : ''}" aria-selected="${r.days === kdDays}" data-act="h-kd-range" data-days="${r.days}">${r.label}</button>`).join('')}</div>
    <section class="tile" style="padding:12px 14px;margin-top:12px">
      ${chart || '<p class="small muted">Für diesen Zeitraum gibt es noch zu wenige Werte.</p>'}
      ${ds.length ? `<div class="m small muted" style="display:flex;justify-content:space-between;margin-top:4px"><span>${esc(dateShort(ds[0]))}</span><span>${esc(dateShort(ds[ds.length - 1]))}</span></div>` : ''}
      <div class="kd-stats">
        <div><span class="k">Ø</span><strong>${esc(fmt(avg))}</strong></div>
        <div><span class="k">Min</span><strong>${esc(fmt(nums.length ? Math.min(...nums) : null))}</strong></div>
        <div><span class="k">Max</span><strong>${esc(fmt(nums.length ? Math.max(...nums) : null))}</strong></div>
      </div>
    </section>
    <p class="small muted" style="margin:12px 2px">${esc(KD_NOTES[id] || '')}</p>
    ${last.length ? `<section class="tile" style="padding:6px 14px"><ul class="kd-list">${last.map((x) => `<li><span>${esc(dateShort(x.k))}</span><span>${esc(fmt(x.v))}${m.unit ? ` ${esc(m.unit)}` : ''}</span></li>`).join('')}</ul></section>` : ''}
    <p class="footnote"><a class="link" href="#/werte">Alle Werte</a></p>
  </div>`;
}
function kdChartSvg(m, vs, lo, hi, avg) {
  const nums = vs.filter((v) => v != null);
  if (nums.length < 2) return '';
  const W = 100, H = 60;
  const bandVals = [...(lo || []), ...(hi || [])].filter((v) => v != null);
  const all = nums.concat(bandVals);
  let mn = Math.min(...all), mx = Math.max(...all);
  const pad = (mx - mn) * 0.08 || 1; mn -= pad; mx += pad;
  const y = (v) => (H - ((v - mn) / (mx - mn)) * H).toFixed(2);
  const x = (i) => ((i / Math.max(1, vs.length - 1)) * W).toFixed(2);
  const stroke = m.garmin_estimate ? 'var(--text-3)' : 'var(--ink)';
  let band = '';
  if (lo && hi) {
    const up = [], dn = [];
    lo.forEach((l, i) => { if (l != null && hi[i] != null) { up.push(`${x(i)},${y(hi[i])}`); dn.unshift(`${x(i)},${y(l)}`); } });
    if (up.length > 1) band = `<polygon points="${up.concat(dn).join(' ')}" fill="var(--band)"/>`;
  }
  if (m.id === 'steps') {
    const bw = W / vs.length;
    return `<svg class="kd-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(m.label)}">
      ${vs.map((v, i) => v == null ? '' : `<rect x="${(i * bw + bw * 0.15).toFixed(2)}" y="${y(v)}" width="${(bw * 0.7).toFixed(2)}" height="${(H - y(v)).toFixed(2)}" fill="var(--bar)"/>`).join('')}
      ${avg != null ? `<line x1="0" x2="${W}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ''}</svg>`;
  }
  const segs = []; let cur = [];
  vs.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(`${x(i)},${y(v)}`); });
  if (cur.length) segs.push(cur);
  return `<svg class="kd-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(m.label)}">
    ${band}
    ${avg != null ? `<line x1="0" x2="${W}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--text-2)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ''}
    ${segs.map((s) => `<polyline fill="none" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${s.join(' ')}"/>`).join('')}
  </svg>`;
}

/* =========================================================================
   Training: gemeinsamer Kalender, beide Streaks, Gym und Dehnen untereinander
   ========================================================================= */
function renderTraining() {
  const now = new Date();
  const hist = getHistory();
  const s = computeStreak(hist, now);
  const a = computeWeekly(hist, now);
  const hasGym = typeof gymPlans === 'function' && gymPlans();
  const gst = hasGym ? computeGymStreak(getGymSessions(), now, weeklyTarget()) : null;
  app.innerHTML = `<div class="page page-mid">
    ${pageHead({ title: 'Training', now })}
    <section class="tile gcal-card" id="tr-cal" style="margin-bottom:12px">${gcalHtml(now, gcalOffset)}</section>
    <div class="tr-streaks">
      <section class="tile tr-streak">
        <span class="k">Dehn-Streak</span>
        <div class="num">${s.current}<small> ${plural(s.current, 'Tag', 'Tage')}</small></div>
        <div class="sub">Rekord ${s.best} · Joker ${s.jokerUsedThisWeek ? 'diese Woche weg' : 'frei'}</div>
        <div class="sub">${esc(streakMessage(s))}</div>
      </section>
      ${gst ? `<section class="tile tr-streak">
        <span class="k">Gym-Streak</span>
        <div class="num">${gst.current}<small> ${plural(gst.current, 'Woche', 'Wochen')}</small></div>
        <div class="sub">Rekord ${gst.best} · Joker ${gst.jokerUsedThisMonth ? 'diesen Monat weg' : 'frei'}</div>
        <div class="sub">Wochenziel ${weeklyTarget()} · Gym-Tage ${esc(gymDays().map((x) => WD_SHORT[(x + 6) % 7]).join(', '))}</div>
      </section>` : ''}
    </div>
    <div class="tr-cols">
      <div>
        <h2 class="section-title">Gym</h2>
        ${hasGym ? `${gymWeekHtml(now)}${gymSectionsHtml(now)}
          <details class="benefit" style="margin-bottom:12px"><summary>Gym-Wochen (12 Wochen)</summary>${gymStreakHtml(now)}</details>`
          : '<section class="card"><p class="small muted">Noch keine Gym-Pläne (gym-plans.json im Daten-Repository).</p></section>'}
      </div>
      <div>
        <h2 class="section-title">Dehnen</h2>
        ${todayHtml(s, a, now)}
        ${weeklyHtml(a, now)}
        <details class="benefit" style="margin-bottom:12px"><summary>Dehn-Rhythmus (5 Wochen)</summary><section class="card" style="margin-top:8px">${calendarHtml(s, a, now)}</section></details>
        <div class="routine-list">${DATA.routines.map(routineRowHtml).join('')}</div>
      </div>
    </div>
  </div>`;
}

/* ---------- Aktionen (data-act="h-…") ---------- */
function handleHeuteAction(act, el) {
  if (handleLoadAction(act, el)) return; // belastung.js
  if (act === 'h-refresh') { refreshHealthNow(); return; }
  if (act === 'h-kd-range') { kdDays = Number(el.dataset.days) || 30; renderKoerper(currentRoute().arg); return; }
  if (act === 'h-cal-prev' || act === 'h-cal-next') {
    gcalOffset = Math.max(0, gcalOffset + (act === 'h-cal-prev' ? 1 : -1));
    const box = document.getElementById('tr-cal');
    if (box) box.innerHTML = gcalHtml(new Date(), gcalOffset);
  }
}
