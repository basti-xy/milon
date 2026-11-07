'use strict';

/* =========================================================================
   Milon – Belastung (Trainingslast): Fitness · Ermüdung · Form
   Daten: health/daily.json → load (heute) und health/history.json → load (Tagesreihen, Vorschau, Vergleich).
   Berechnet im Daten-Repository (training/load.py) aus Watt, Pace und Puls – keine Garmin-Werte, daher kein „G“.
   Kachel auf „Heute“ (loadTileHtml) und Detailseite #/belastung mit den Reitern Verlauf und Info.
   ========================================================================= */

const LOAD_RANGES = [{ days: 14, label: '2 Wochen' }, { days: 30, label: '1 Monat' }, { days: 182, label: '6 Monate' }, { days: 0, label: 'Saison' }];
let loadDays = 30;
let loadTab = 'verlauf';
let loadSport = 'all';
const LOAD_SPORTS = [['all', 'Gesamt'], ['bike', 'Rad'], ['run', 'Laufen'], ['swim', 'Schwimmen']];
const ZONE_GOOD = new Set(['frisch', 'neutral']);
const ZONE_BAD = new Set(['sehr_hoch']);

const loadToday = () => healthData()?.load || null;
const loadHistory = () => { const h = historyData()?.load; return h && Array.isArray(h.dates) && h.dates.length ? h : null; };
const fmtLoad = (v) => (v == null ? '–' : Math.round(v).toLocaleString('de-DE'));
const fmtSigned = (v) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v))}`);
const zoneClass = (z) => (ZONE_BAD.has(z) ? 'bad' : ZONE_GOOD.has(z) ? 'ok' : '');
/** Kleines Linienmuster als Legende vor einem Label. */
const legendLine = (kind) => `<svg class="ld-key ld-${kind}" viewBox="0 0 18 6" aria-hidden="true"><line x1="1" y1="3" x2="17" y2="3"/></svg>`;

/* ---------- Diagramm: mehrere Linien, eine y-Achse ---------- */
function loadChartSvg({ dates, lines, bars = null, zones = null, freshBand = null, yMin, yMax, h = 120, cls = 'ld-chart', label = '', ticks = [] }) {
  const n = dates.length;
  if (n < 2) return '';
  const W = 100;
  const y = (v) => (h - ((v - yMin) / (yMax - yMin)) * h);
  const x = (i) => (i / (n - 1)) * W;
  const yf = (v) => y(Math.max(yMin, Math.min(yMax, v))).toFixed(2);
  let out = '';
  if (zones) {   // zarte Hintergrundbänder je Zone (nur im Form-Diagramm)
    let lo = yMin;
    for (const z of zones) {
      const hi = z.max == null ? yMax : Math.min(yMax, z.max);
      if (hi > lo) out += `<rect x="0" y="${yf(hi)}" width="${W}" height="${(y(lo) - y(hi)).toFixed(2)}" class="ld-zone z-${esc(z.id)}"/>`;
      lo = Math.max(lo, hi);
    }
  }
  if (freshBand) out += `<rect x="0" y="${yf(freshBand[1])}" width="${W}" height="${(y(freshBand[0]) - y(freshBand[1])).toFixed(2)}" class="ld-fresh"/>`;
  for (const t of ticks) if (t !== 0 && t > yMin && t < yMax) out += `<line x1="0" x2="${W}" y1="${yf(t)}" y2="${yf(t)}" class="ld-grid" vector-effect="non-scaling-stroke"/>`;
  if (yMin < 0 && yMax > 0) out += `<line x1="0" x2="${W}" y1="${yf(0)}" y2="${yf(0)}" class="ld-zero" vector-effect="non-scaling-stroke"/>`;
  if (bars) {
    const bw = W / n;
    bars.values.forEach((v, i) => {
      if (v == null) return;
      const top = Math.min(y(0), y(v)), hh = Math.abs(y(v) - y(0));
      out += `<rect x="${(i * bw + bw * 0.12).toFixed(2)}" y="${top.toFixed(2)}" width="${(bw * 0.76).toFixed(2)}" height="${Math.max(0.3, hh).toFixed(2)}" class="ld-bar ${v < -30 ? 'is-bad' : v >= 5 && v <= 25 ? 'is-good' : ''}"/>`;
    });
  }
  for (const ln of lines) {
    const segs = []; let cur = [];
    ln.values.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(`${x(i).toFixed(2)},${yf(v)}`); });
    if (cur.length) segs.push(cur);
    out += segs.filter((s) => s.length > 1).map((s) => `<polyline points="${s.join(' ')}" class="ld-line ${ln.cls}" vector-effect="non-scaling-stroke"/>`).join('');
    if (ln.dot) {
      const i = ln.values.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0).pop();
      // Punkt als Linie der Länge 0 mit runden Enden: bleibt rund, obwohl das Diagramm in die Breite gezogen wird
      if (i != null && i >= 0) out += `<line x1="${x(i).toFixed(2)}" x2="${x(i).toFixed(2)}" y1="${yf(ln.values[i])}" y2="${yf(ln.values[i])}" class="ld-dot ${ln.cls}" vector-effect="non-scaling-stroke"/>`;
    }
  }
  // y-Achse als HTML-Beschriftung (Text im gestreckten SVG würde verzerrt)
  const labels = ticks.filter((t) => t >= yMin && t <= yMax)
    .map((t) => `<span style="top:${((y(t) / h) * 100).toFixed(1)}%">${t > 0 && zones ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}</span>`).join('');
  return `<div class="ld-plot"><svg class="${cls}" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${out}</svg>${labels ? `<div class="ld-y" aria-hidden="true">${labels}</div>` : ''}</div>`;
}
/** Runde Achsengrenzen und Beschriftung in Zehner-/Zwanziger-Schritten. */
function loadAxis(vals, { min = null, max = null, step = 20 } = {}) {
  const v = vals.filter((x) => x != null);
  let lo = Math.floor((Math.min(...v) - 5) / step) * step, hi = Math.ceil((Math.max(...v) + 5) / step) * step;
  if (min != null) lo = Math.min(lo, min);
  if (max != null) hi = Math.max(hi, max);
  const ticks = [];
  for (let t = lo; t <= hi; t += step) ticks.push(t);
  return { yMin: lo, yMax: hi, ticks };
}

/** Werte der letzten `days` Tage (0 = Saison ab Woche 1 des Plans). */
function loadSlice(h, days) {
  let from = 0;
  if (days > 0) from = Math.max(0, h.dates.length - days);
  else {
    const start = healthData()?.season_start;
    const i = start ? h.dates.findIndex((d) => d >= start) : -1;
    from = i >= 0 ? i : Math.max(0, h.dates.length - 182);
  }
  const pick = (arr) => (arr || []).slice(from);
  return { dates: h.dates.slice(from), ctl: pick(h.ctl), atl: pick(h.atl), tsb: pick(h.tsb), cmp_ctl: pick(h.cmp_ctl), cmp_tsb: pick(h.cmp_tsb),
    ctl_bike: pick(h.ctl_bike), ctl_run: pick(h.ctl_run), ctl_swim: pick(h.ctl_swim) };
}

/* ---------- Kachel „Belastung“ auf Heute ---------- */
function loadTileHtml() {
  const t = loadToday();
  const h = loadHistory();
  if (!t) return '';
  const s = h ? loadSlice(h, 84) : null;
  const ax = s ? loadAxis([...s.ctl, ...s.atl, ...s.tsb, 0], { min: -30, max: 130, step: 50 }) : null;
  const chart = s ? loadChartSvg({
    dates: s.dates, yMin: ax.yMin, yMax: ax.yMax, ticks: ax.ticks.filter((t) => t % 50 === 0), h: 70, freshBand: [5, 25], label: 'Fitness, Ermüdung und Form, 12 Wochen',
    lines: [{ values: s.atl, cls: 'l-atl' }, { values: s.tsb, cls: 'l-tsb', dot: true }, { values: s.ctl, cls: 'l-ctl', dot: true }],
  }) : '';
  const pulse = t.pulse_share_6w != null && t.pulse_share_6w >= 0.5;
  return `<a class="tile ld-tile span-2" href="#/belastung">
    <div class="sec-head"><span class="k">Belastung</span><span class="m small muted">12 Wochen ›</span></div>
    <div class="ld-nums">
      <div>${legendLine('ctl')}<span class="k">Fitness</span><strong>${fmtLoad(t.ctl)}</strong><small>${fmtSigned(t.ramp7)} / 7 Tage</small></div>
      <div>${legendLine('atl')}<span class="k">Ermüdung</span><strong>${fmtLoad(t.atl)}</strong><small>&nbsp;</small></div>
      <div>${legendLine('tsb')}<span class="k">Form</span><strong>${fmtSigned(t.tsb)}</strong><small class="${zoneClass(t.zone)}">${esc(t.zone_label || '')}</small></div>
    </div>
    ${chart}
    <div class="ld-foot">berechnet aus Watt, Pace und Puls${pulse ? ` · ${Math.round(t.pulse_share_6w * 100)} % nur aus Puls geschätzt` : ''}</div>
  </a>`;
}

/* ---------- Detailseite #/belastung ---------- */
function renderBelastung() {
  const t = loadToday();
  const h = loadHistory();
  if (!t || !h) {
    app.innerHTML = `<div class="page">${topbar({ backHref: '#/', title: 'Belastung' })}
      <section class="card"><p class="small muted">Noch keine Trainingslast in den Tagesdaten.</p></section></div>`;
    return;
  }
  app.innerHTML = `<div class="page">
    ${topbar({ backHref: '#/', title: 'Belastung' })}
    <div class="seg ld-tabs" role="tablist">${[['verlauf', 'Verlauf'], ['info', 'Info']].map(([id, l]) => `<button role="tab" class="${loadTab === id ? 'is-on' : ''}" aria-selected="${loadTab === id}" data-act="h-ld-tab" data-v="${id}">${l}</button>`).join('')}</div>
    <div id="ld-body">${loadTab === 'info' ? loadInfoHtml() : loadVerlaufHtml(t, h)}</div>
  </div>`;
}

function loadVerlaufHtml(t, h) {
  const s = loadSlice(h, loadDays);
  const pv = h.preview && loadDays !== 14 ? h.preview : null;
  // Vorschau hinter den Verlauf hängen (gestrichelt), so weit wie der gewählte Zeitraum nach vorn reicht
  const ahead = pv ? pv.dates.slice(0, Math.max(14, Math.round(s.dates.length / 2))) : [];
  const dates = s.dates.concat(ahead);
  const pad = (arr, len) => arr.concat(Array(len).fill(null));
  const fut = (arr) => Array(s.dates.length - 1).fill(null).concat([arr === 'ctl' ? s.ctl[s.ctl.length - 1] : s.atl[s.atl.length - 1]], (pv?.[arr] || []).slice(0, ahead.length));
  const sportKey = loadSport === 'all' ? 'ctl' : `ctl_${loadSport}`;
  const fit = s[sportKey] || s.ctl;
  const showAtl = loadSport === 'all';
  const lines = [
    ...(s.cmp_ctl.some((v) => v != null) && loadSport === 'all' ? [{ values: s.cmp_ctl.concat((pv?.cmp_ctl || []).slice(0, ahead.length), Array(Math.max(0, ahead.length - (pv?.cmp_ctl || []).length)).fill(null)), cls: 'l-cmp' }] : []),
    ...(showAtl ? [{ values: pad(s.atl, ahead.length), cls: 'l-atl' }] : []),
    ...(ahead.length && loadSport === 'all' ? [{ values: fut('ctl'), cls: 'l-ctl l-pv' }] : []),
    { values: pad(fit, ahead.length), cls: 'l-ctl', dot: true },
  ];
  const ax = loadAxis(lines.flatMap((l) => l.values), { step: 20 });
  if (ax.yMin < 0) { ax.yMin = 0; ax.ticks = ax.ticks.filter((t) => t >= 0); }
  const top = loadChartSvg({ dates, lines, yMin: ax.yMin, yMax: ax.yMax, ticks: ax.ticks, h: 110, cls: 'ld-chart is-big', label: 'Fitness und Ermüdung' });
  const tsbAll = pad(s.tsb, ahead.length);
  const tsbPv = ahead.length ? Array(s.dates.length).fill(null).concat((pv.tsb || []).slice(0, ahead.length)) : null;
  const tv = [...s.tsb, ...(tsbPv || [])].filter((v) => v != null);
  const fx = loadAxis(tv, { min: -30, max: 30, step: 10 });
  const form = loadChartSvg({
    dates, yMin: fx.yMin, yMax: fx.yMax, ticks: [-30, 0, 25].filter((x) => x >= fx.yMin && x <= fx.yMax), h: 60, zones: t.zones, label: 'Form',
    bars: { values: tsbAll },
    lines: [...(s.cmp_tsb.some((v) => v != null) ? [{ values: s.cmp_tsb.concat((pv?.cmp_tsb || []).slice(0, ahead.length), Array(Math.max(0, ahead.length - (pv?.cmp_tsb || []).length)).fill(null)), cls: 'l-cmp' }] : []), ...(tsbPv ? [{ values: tsbPv, cls: 'l-tsb l-pv' }] : [])],
  });
  const first = dates[0], last = dates[dates.length - 1];
  const cm = t.compare;
  const th = t.thresholds || {};
  const est = t.estimates;
  const srcText = (src) => {
    const m = /^values\.json (\d{4})-(\d{2})-(\d{2})$/.exec(src || '');
    if (m) return `seit ${m[3]}.${m[2]}.${m[1]}`;
    return ({ 'values.json ohne Datum': 'eingetragen', 'Schätzung (thresholds.json)': 'Schätzung', 'Garmin-Einstellung (NP/IF)': 'damals in Garmin eingestellt' })[src]
      || String(src || '').replace('vorläufig aus Becken-Einheiten', 'vorläufig, aus dem Training');
  };
  const thRow = (label, v, unit, src) => `<li><span>${label}</span><span>${v != null ? `${esc(String(v))}${unit}` : '–'} <small class="muted">${esc(srcText(src))}</small></span></li>`;
  return `
    <div class="ld-today">
      <div><span class="k">Fitness</span><strong>${fmtLoad(t.ctl)}</strong><small>${fmtSigned(t.ramp7)} in 7 Tagen</small></div>
      <div><span class="k">Ermüdung</span><strong>${fmtLoad(t.atl)}</strong></div>
      <div><span class="k">Form</span><strong>${fmtSigned(t.tsb)}</strong><small class="${zoneClass(t.zone)}">${esc(t.zone_label || '')}</small></div>
    </div>
    <div class="ld-ctrl">
      <div class="seg" role="tablist">${LOAD_RANGES.map((r) => `<button role="tab" class="${r.days === loadDays ? 'is-on' : ''}" aria-selected="${r.days === loadDays}" data-act="h-ld-range" data-days="${r.days}">${r.label}</button>`).join('')}</div>
      <div class="seg" role="tablist">${LOAD_SPORTS.map(([id, l]) => `<button role="tab" class="${id === loadSport ? 'is-on' : ''}" aria-selected="${id === loadSport}" data-act="h-ld-sport" data-v="${id}">${l}</button>`).join('')}</div>
    </div>
    <section class="tile ld-detail">
      <div class="ld-legend">
        <span>${legendLine('ctl')}Fitness${loadSport !== 'all' ? ` ${esc(LOAD_SPORTS.find((x) => x[0] === loadSport)[1])}` : ''}</span>
        ${showAtl ? `<span>${legendLine('atl')}Ermüdung</span>` : ''}
        ${ahead.length && loadSport === 'all' ? `<span>${legendLine('pv')}Vorschau aus dem Plan</span>` : ''}
        ${cm && loadSport === 'all' ? `<span>${legendLine('cmp')}${esc(cm.name)}</span>` : ''}
      </div>
      ${top}
      <div class="k ld-sub">Form (Fitness − Ermüdung)</div>
      ${form}
      <div class="m small muted ld-axis"><span>${esc(dateShort(first))}</span>${ahead.length ? `<span>heute</span>` : ''}<span>${esc(dateShort(last))}</span></div>
      ${loadSport !== 'all' ? '<p class="small muted">Je Sportart nur Fitness – Form und Ermüdung gibt es nur gesamt.</p>' : ''}
    </section>
    ${cm ? `<p class="small muted ld-note">${esc(cm.name)} bei gleich vielen Tagen bis zum Rennen (${t.goal ? `${esc(String(t.goal.days))} Tage bis ${esc(t.goal.name)}` : ''}): Fitness ${fmtLoad(cm.ctl)}, Form ${fmtSigned(cm.tsb)}.</p>` : ''}
    ${ahead.length ? '<p class="small muted ld-note">Gestrichelt: Schätzung aus dem Plan (Dauer der geplanten Einheiten × typische Last der letzten Wochen).</p>' : ''}
    <section class="tile ld-thr">
      <div class="k">Genutzte Schwellen</div>
      <ul class="kd-list">
        ${thRow('FTP', th.ftp?.value != null ? Math.round(th.ftp.value) : null, ' W', th.ftp?.src)}
        ${thRow('Schwellenpace', th.run_pace?.value, ' /km', th.run_pace?.src)}
        ${thRow('CSS', th.css?.value, ' /100 m', th.css?.src)}
        ${thRow('Schwellenpuls Rad', th.lthr_bike?.value != null ? Math.round(th.lthr_bike.value) : null, ' bpm', th.lthr_bike?.src)}
        ${thRow('Schwellenpuls Laufen', th.lthr_run?.value != null ? Math.round(th.lthr_run.value) : null, ' bpm', th.lthr_run?.src)}
      </ul>
      ${est ? `<p class="small muted" style="margin:8px 0 0">Schätzung aus dem Training (${esc(est.week)}): FTP ${esc(String(est.ftp?.value ?? '–'))} W${est.ftp?.low ? ` (${esc(String(est.ftp.low))}–${esc(String(est.ftp.high))})` : ''} · Schwellenpace ${esc(est.run_pace?.value || '–')}${est.run_pace?.low ? ` (${esc(est.run_pace.low)}–${esc(est.run_pace.high)})` : ''}${est.css ? ` · CSS ${esc(est.css)} (vorläufig)` : ''}.</p>` : ''}
    </section>
    <p class="footnote">Berechnet aus Watt, Pace und Puls – ${t.pulse_share_6w != null ? `${Math.round(t.pulse_share_6w * 100)} % der Last der letzten 6 Wochen nur aus Puls geschätzt.` : ''}</p>`;
}

function loadInfoHtml() {
  const rows = (r) => r.map(([a, b, c]) => `<tr><th scope="row">${a}</th><td>${b}</td>${c != null ? `<td>${c}</td>` : ''}</tr>`).join('');
  return `<section class="card ld-info">
    <p><strong>Fitness</strong> zeigt, wie viel Belastung dein Körper gewohnt ist. <strong>Form</strong> zeigt, wie frisch du gerade im Vergleich dazu
      bist. Beides ist ein Rechenmodell aus der Trainingslast (TSS) – keine Messung.</p>
    <div class="ld-table"><table>
      <thead><tr><th>Wert</th><th>Was er ist</th><th>Faustregel</th></tr></thead>
      <tbody>${rows([
        ['Fitness (CTL)', 'Durchschnittliche Trainingslast (TSS) pro Tag der letzten ~6 Wochen, neuere Tage zählen stärker', '80 ≈ 80 TSS am Tag ≈ 560 TSS pro Woche. Steigt langsam, fällt langsam'],
        ['Ermüdung (ATL)', 'Dasselbe für die letzten ~7 Tage', 'Reagiert schnell: eine harte Woche treibt sie hoch, zwei lockere Tage senken sie'],
        ['Form (TSB)', 'Fitness minus Ermüdung', 'Negativ = du trainierst mehr, als du gewohnt bist. Positiv = du bist erholt'],
      ])}</tbody>
    </table></div>
    <p class="ld-quote">Bild dafür: Fitness ist der Kontostand, Ermüdung das, was du diese Woche ausgegeben hast. Form zeigt, ob du gerade über
      deine Verhältnisse lebst.</p>
    <div class="ld-table"><table>
      <thead><tr><th>Form (TSB)</th><th>Bedeutung</th></tr></thead>
      <tbody>${rows([
        ['unter −30', 'Sehr hohe Last, auf Dauer Überlastungsrisiko. Im Trainingslager oder auf einer Radtour okay, wenn danach Erholung kommt', null],
        ['−30 bis −10', 'Normaler Trainingsbereich, hier wird Fitness aufgebaut', null],
        ['−10 bis +5', 'Neutral', null],
        ['+5 bis +25', 'Frisch, so will man an einen Wettkampf gehen', null],
        ['über +25', 'Sehr erholt. Hält das lange an, sinkt die Fitness', null],
      ])}</tbody>
    </table></div>
    <p>Das sind übliche Richtwerte, deine eigenen Grenzen zeigt erst dein Verlauf. Wichtig ist auch die <strong>Anstiegsrate</strong>: Wie
      schnell steigt die Fitness pro Woche? Etwa 3–6 Punkte pro Woche lassen sich auf Dauer halten; deutlich mehr über mehrere
      Wochen ist das typische Verletzungsmuster.</p>
    <p><strong>Was das Modell nicht weiß:</strong> Schlaf, Stress, Hitze und Krankheit – dafür gibt es Ruhepuls und HRV; ist die Form
      positiv, aber die HRV schlecht, gilt die HRV. 100 TSS Laufen belasten den Körper mehr als 100 TSS Rad – deshalb gibt es
      die Fitness auch je Sportart. Und stimmt eine Schwelle (FTP, Schwellenpace) nicht, verschiebt sich alles.
      Aussagekräftig ist der <strong>Verlauf</strong>, nicht ein einzelner Tageswert.</p>
  </section>`;
}

function handleLoadAction(act, el) {
  if (act === 'h-ld-tab') loadTab = el.dataset.v === 'info' ? 'info' : 'verlauf';
  else if (act === 'h-ld-range') loadDays = Number(el.dataset.days) || 0;
  else if (act === 'h-ld-sport') loadSport = el.dataset.v || 'all';
  else return false;
  const y = window.scrollY;
  renderBelastung();
  window.scrollTo(0, y);
  return true;
}
