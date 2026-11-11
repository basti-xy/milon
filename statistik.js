'use strict';

/* =========================================================================
   Milon – Jahre & Statistik (#/statistik, Kachel im Training-Tab)
   Daten: health/stats.json (erzeugt im Daten-Repository von training/build_stats.py):
   days = Tagesreihen (km, Stunden, Einheiten, TSS je Sportart, Gym/Dehnen, Schlaf, Gewicht), years = Jahresübersichten.
   Gruppiert wird automatisch nach Zeitraum (1 Monat = Tage, 12 Wochen bis 1 Jahr = Wochen, 2 Jahre/Alles = Monate).
   ========================================================================= */
const STATS_PATH = 'health/stats.json';
const STATS_KEY = 'milon.health.stats.v1';
const ST_METRICS = [
  { id: 'km', label: 'Kilometer', unit: 'km', sports: ['swim', 'bike', 'run'], agg: 'sum', dec: 0 },
  { id: 'h', label: 'Stunden', unit: 'h', sports: ['swim', 'bike', 'run', 'other'], agg: 'sum', dec: 1 },
  { id: 'n', label: 'Einheiten', unit: '', sports: ['swim', 'bike', 'run', 'gym', 'dehn'], agg: 'sum', dec: 0 },
  { id: 'tss', label: 'TSS', unit: '', sports: ['swim', 'bike', 'run'], agg: 'sum', dec: 0 },
  { id: 'sleep_h', label: 'Schlaf', unit: 'h', sports: null, agg: 'mean', dec: 1 },
  { id: 'weight', label: 'Gewicht', unit: 'kg', sports: null, agg: 'mean', dec: 1 },
];
const ST_RANGES = [
  { id: '1m', label: '1 Monat', days: 30, group: 'day' }, { id: '12w', label: '12 Wochen', days: 84, group: 'week' },
  { id: '6m', label: '6 Monate', days: 182, group: 'week' }, { id: '1y', label: '1 Jahr', days: 365, group: 'week' },
  { id: '2y', label: '2 Jahre', days: 730, group: 'month' }, { id: 'all', label: 'Alles', days: 0, group: 'month' },
];
const ST_SPORT_LABEL = { all: 'Alle', swim: 'Schwimmen', bike: 'Rad', run: 'Laufen', other: 'Sonstiges', gym: 'Gym', dehn: 'Dehnen' };
const ST_SPORT_CLASS = { swim: 's-swim', bike: 's-bike', run: 's-run', other: 's-other', gym: 's-strength', dehn: 's-stretch' };
const ST_MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
let stMetric = 'km', stSport = 'all', stRange = '1y', stYear = null, stSel = null;

const statsData = () => { const d = store.get(STATS_KEY, null); return d && d.days && Array.isArray(d.days.dates) ? d : null; };
async function loadStats() {
  const c = GHSync.getConfig();
  if (!c || navigator.onLine === false) return false;
  try {
    const r = await GHSync.readFile(c, STATS_PATH);
    if (!r || !r.data?.days?.dates) return false;
    if (JSON.stringify(r.data) === JSON.stringify(store.get(STATS_KEY, null))) return false;
    store.set(STATS_KEY, r.data);
    return true;
  } catch { return false; }
}
const stFmt = (v, dec = 0) => (v == null ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }));

/** Tagesreihe eines Werts (je Sportart oder ohne Sportart). */
function stSeries(d, metric, sport) {
  const m = ST_METRICS.find((x) => x.id === metric);
  if (!m.sports) return { [metric]: d.days[metric] || [] };
  const sports = sport === 'all' ? m.sports : [sport];
  const out = {};
  for (const s of sports) out[s] = d.days[`${s}_${metric}`] || [];
  return out;
}
/** Gruppenschlüssel und Beschriftung je Tag. */
function stGroupKey(k, group) {
  if (group === 'day') return k;
  if (group === 'month') return k.slice(0, 7);
  const dt = parseDay(k); const wd = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - wd);
  return dayKey(dt);   // Montag der Woche
}
function stGroupLabel(key, group, long = false) {
  if (group === 'day') return dateShort(key);
  if (group === 'month') { const [y, mo] = key.split('-'); return `${ST_MON[Number(mo) - 1]} ${long ? y : y.slice(2)}`; }
  const dt = parseDay(key); return `KW ${isoWeek(dt)}${long ? ` ${dt.getFullYear()}` : ''}`;
}
/** Werte nach Gruppen zusammenfassen: Summe (km, h, Einheiten, TSS) oder Mittel (Schlaf, Gewicht). */
function stAggregate(d, metric, sport, range) {
  const m = ST_METRICS.find((x) => x.id === metric);
  const r = ST_RANGES.find((x) => x.id === range);
  const dates = d.days.dates;
  const from = r.days ? Math.max(0, dates.length - r.days) : 0;
  const ser = stSeries(d, metric, sport);
  const keys = [], idx = new Map();
  const acc = {};
  for (const s of Object.keys(ser)) acc[s] = [];
  const cnt = [];
  for (let i = from; i < dates.length; i++) {
    const g = stGroupKey(dates[i], r.group);
    if (!idx.has(g)) { idx.set(g, keys.length); keys.push(g); for (const s of Object.keys(ser)) acc[s].push(m.agg === 'sum' ? 0 : null); cnt.push({}); }
    const j = idx.get(g);
    for (const s of Object.keys(ser)) {
      const v = ser[s][i];
      if (v == null) continue;
      if (m.agg === 'sum') acc[s][j] += v;
      else { acc[s][j] = (acc[s][j] || 0) + v; cnt[j][s] = (cnt[j][s] || 0) + 1; }
    }
  }
  if (m.agg === 'mean') for (const s of Object.keys(acc)) acc[s] = acc[s].map((v, j) => (v == null ? null : v / cnt[j][s]));
  return { keys, series: acc, group: r.group, m };
}

/* ---------- Diagramme ---------- */
function stBarsSvg(agg) {
  const { keys, series, m } = agg;
  const n = keys.length;
  if (!n) return '';
  const sports = Object.keys(series);
  const tot = keys.map((_, j) => sports.reduce((a, s) => a + (series[s][j] || 0), 0));
  const W = 100, H = 120;
  if (m.agg === 'mean') {   // Linie mit Punkten (Schlaf, Gewicht)
    const vals = series[sports[0]];
    const nums = vals.filter((v) => v != null);
    if (nums.length < 1) return '';
    let lo = Math.min(...nums), hi = Math.max(...nums);
    const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
    const y = (v) => (H - ((v - lo) / (hi - lo)) * H);
    const x = (j) => (n === 1 ? W / 2 : (j / (n - 1)) * W);
    const pts = vals.map((v, j) => (v == null ? null : `${x(j).toFixed(2)},${y(v).toFixed(2)}`)).filter(Boolean);
    const ticks = stTicks(lo, hi);
    return stPlot(`${ticks.map((t) => `<line x1="0" x2="${W}" y1="${y(t).toFixed(2)}" y2="${y(t).toFixed(2)}" class="ld-grid" vector-effect="non-scaling-stroke"/>`).join('')}
      ${pts.length > 1 ? `<polyline points="${pts.join(' ')}" class="ld-line l-ctl" vector-effect="non-scaling-stroke"/>` : ''}
      ${vals.map((v, j) => (v == null ? '' : `<line x1="${x(j).toFixed(2)}" x2="${x(j).toFixed(2)}" y1="${y(v).toFixed(2)}" y2="${y(v).toFixed(2)}" class="ld-dot l-ctl" vector-effect="non-scaling-stroke"/>`)).join('')}
      ${stHitRects(n, W, H)}`, ticks, y, H, m);
  }
  const hi = Math.max(1, ...tot) * 1.08;
  const y = (v) => H - (v / hi) * H;
  const bw = W / n;
  let out = '';
  const ticks = stTicks(0, hi);
  out += ticks.filter((t) => t > 0).map((t) => `<line x1="0" x2="${W}" y1="${y(t).toFixed(2)}" y2="${y(t).toFixed(2)}" class="ld-grid" vector-effect="non-scaling-stroke"/>`).join('');
  keys.forEach((_, j) => {
    let base = 0;
    for (const s of sports) {
      const v = series[s][j] || 0;
      if (!v) continue;
      out += `<rect x="${(j * bw + bw * 0.12).toFixed(2)}" y="${y(base + v).toFixed(2)}" width="${(bw * 0.76).toFixed(2)}" height="${(y(base) - y(base + v)).toFixed(2)}" class="st-bar ${ST_SPORT_CLASS[s] || ''}${stSel === j ? ' is-sel' : ''}"/>`;
      base += v;
    }
  });
  out += stHitRects(n, W, H);
  return stPlot(out, ticks, y, H, m);
}
function stHitRects(n, W, H) {   // unsichtbare Flächen zum Antippen je Gruppe
  const bw = W / n;
  return Array.from({ length: n }, (_, j) => `<rect x="${(j * bw).toFixed(2)}" y="0" width="${bw.toFixed(2)}" height="${H}" class="st-hit" data-act="st-sel" data-i="${j}"/>`).join('');
}
function stTicks(lo, hi) {
  const span = hi - lo;
  const raw = span / 3;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * p).find((s) => s >= raw) || p * 10;
  const out = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}
function stPlot(inner, ticks, y, H, m) {
  const labels = ticks.map((t) => `<span style="top:${((y(t) / H) * 100).toFixed(1)}%">${stFmt(t, t % 1 ? 1 : 0)}</span>`).join('');
  return `<div class="ld-plot st-plot"><svg class="ld-chart is-big" viewBox="0 0 100 ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(m.label)}">${inner}</svg><div class="ld-y" aria-hidden="true">${labels}</div></div>`;
}

/** Jahresvergleich: aufsummiert über das Jahr, je Jahr eine Linie (laufendes Jahr kräftig). */
function stCumSvg(d, metric, sport) {
  const ser = stSeries(d, metric, sport);
  const dates = d.days.dates;
  const byYear = {};
  dates.forEach((k, i) => {
    const y = k.slice(0, 4);
    const doy = Math.round((parseDay(k) - new Date(Number(y), 0, 1)) / 86400000);
    const v = Object.values(ser).reduce((a, arr) => a + (arr[i] || 0), 0);
    (byYear[y] ||= []).push([doy, v]);
  });
  const lines = Object.entries(byYear).map(([y, arr]) => { let c = 0; return { y, pts: arr.map(([x, v]) => [x, (c += v)]) }; })
    .filter((l) => l.pts[l.pts.length - 1][1] > 0);
  if (!lines.length) return { svg: '', rows: [] };
  const W = 100, H = 120;
  const hi = Math.max(...lines.map((l) => l.pts[l.pts.length - 1][1])) * 1.05;
  const y = (v) => H - (v / hi) * H;
  const x = (doy) => (doy / 365) * W;
  const cur = String(new Date().getFullYear());
  const ticks = stTicks(0, hi);
  let inner = ticks.filter((t) => t > 0).map((t) => `<line x1="0" x2="${W}" y1="${y(t).toFixed(2)}" y2="${y(t).toFixed(2)}" class="ld-grid" vector-effect="non-scaling-stroke"/>`).join('');
  const n = lines.length;
  lines.forEach((l, k) => {
    const pts = l.pts.filter((_, i) => i % 3 === 0 || i === l.pts.length - 1).map(([a, b]) => `${x(a).toFixed(2)},${y(b).toFixed(2)}`).join(' ');
    inner += `<polyline points="${pts}" class="st-cum ${l.y === cur ? 'is-cur' : ''}" style="opacity:${l.y === cur ? 1 : 0.35 + 0.5 * (k / Math.max(1, n - 1))}" vector-effect="non-scaling-stroke"/>`;
  });
  const m = ST_METRICS.find((z) => z.id === metric);
  // gleicher Tag des Jahres wie heute: Vergleich bis heute
  const today = new Date();
  const doyNow = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(today.getFullYear(), 0, 1)) / 86400000);
  const rows = lines.map((l) => {
    const upto = l.pts.filter(([a]) => a <= doyNow).pop();
    return { y: l.y, total: l.pts[l.pts.length - 1][1], upto: upto ? upto[1] : 0 };
  }).reverse();
  inner += `<line x1="${x(doyNow).toFixed(2)}" x2="${x(doyNow).toFixed(2)}" y1="0" y2="${H}" class="ld-zero" vector-effect="non-scaling-stroke"/>`;
  return { svg: stPlot(inner, ticks, y, H, m), rows };
}

/* ---------- Seite ---------- */
function renderStatistik() {
  const d = statsData();
  if (!d) {
    app.innerHTML = `<div class="page">${topbar({ backHref: '#/training', title: 'Jahre & Statistik' })}
      <section class="card"><p class="small muted">Noch keine Statistik geladen (<code>health/stats.json</code> im Daten-Repository).</p></section></div>`;
    loadStats().then((ok) => { if (ok && currentRoute().name === 'statistik') renderStatistik(); });
    return;
  }
  const m = ST_METRICS.find((x) => x.id === stMetric);
  if (m.sports && stSport !== 'all' && !m.sports.includes(stSport)) stSport = 'all';
  const agg = stAggregate(d, stMetric, m.sports ? stSport : null, stRange);
  const sports = Object.keys(agg.series);
  const total = sports.map((s) => ({ s, v: agg.series[s].reduce((a, v) => a + (v || 0), 0) }));
  const means = m.agg === 'mean' ? agg.series[sports[0]].filter((v) => v != null) : null;
  if (stSel != null && stSel >= agg.keys.length) stSel = null;
  const sel = stSel != null ? stSel : null;
  const selText = sel != null
    ? `${stGroupLabel(agg.keys[sel], agg.group, true)}: ${m.agg === 'mean' ? `${stFmt(agg.series[sports[0]][sel], m.dec)} ${m.unit}`
      : sports.map((s) => `${sports.length > 1 ? `${ST_SPORT_LABEL[s]} ` : ''}${stFmt(agg.series[s][sel], m.dec)}${m.unit ? ` ${m.unit}` : ''}`).join(' · ')}`
    : 'Balken antippen für den Wert.';
  const years = (d.years || []).slice().reverse();
  if (!stYear || !years.find((y) => String(y.year) === String(stYear))) stYear = years[0]?.year;
  const yr = years.find((y) => String(y.year) === String(stYear));
  const cum = m.agg === 'sum' ? stCumSvg(d, stMetric, m.sports ? stSport : null) : null;
  const seg = (items, cur, act) => `<div class="seg st-seg" role="tablist">${items.map(([id, l]) => `<button role="tab" class="${String(id) === String(cur) ? 'is-on' : ''}" aria-selected="${String(id) === String(cur)}" data-act="${act}" data-v="${esc(String(id))}">${esc(l)}</button>`).join('')}</div>`;
  const first = agg.keys[0], last = agg.keys[agg.keys.length - 1];
  app.innerHTML = `<div class="page page-mid">
    ${topbar({ backHref: '#/training', title: 'Jahre & Statistik' })}
    <div class="ld-ctrl st-ctrl">
      ${seg(ST_METRICS.map((x) => [x.id, x.label]), stMetric, 'st-metric')}
      ${m.sports ? seg([['all', 'Alle'], ...m.sports.map((s) => [s, ST_SPORT_LABEL[s]])], stSport, 'st-sport') : ''}
      ${seg(ST_RANGES.map((x) => [x.id, x.label]), stRange, 'st-range')}
    </div>
    <section class="tile ld-detail">
      ${m.sports && sports.length > 1 ? `<div class="ld-legend">${sports.map((s) => `<span><i class="st-key ${ST_SPORT_CLASS[s]}"></i>${esc(ST_SPORT_LABEL[s])}</span>`).join('')}</div>` : ''}
      ${stBarsSvg(agg) || '<p class="small muted">Keine Werte in diesem Zeitraum.</p>'}
      <div class="m small muted ld-axis"><span>${first ? esc(stGroupLabel(first, agg.group, true)) : ''}</span><span>${{ day: 'pro Tag', week: 'pro Woche', month: 'pro Monat' }[agg.group]}</span><span>${last ? esc(stGroupLabel(last, agg.group, true)) : ''}</span></div>
      <p class="small st-sel">${esc(selText)}</p>
      <div class="kd-stats">
        ${m.agg === 'sum' ? `<div><span class="k">Summe</span><strong>${stFmt(total.reduce((a, x) => a + x.v, 0), m.dec)}</strong></div>
          <div><span class="k">Ø pro ${{ day: 'Tag', week: 'Woche', month: 'Monat' }[agg.group]}</span><strong>${stFmt(total.reduce((a, x) => a + x.v, 0) / Math.max(1, agg.keys.length), m.dec)}</strong></div>
          <div><span class="k">Höchster</span><strong>${stFmt(Math.max(0, ...agg.keys.map((_, j) => sports.reduce((a, s) => a + (agg.series[s][j] || 0), 0))), m.dec)}</strong></div>`
        : `<div><span class="k">Ø</span><strong>${stFmt(means.length ? means.reduce((a, v) => a + v, 0) / means.length : null, m.dec)}</strong></div>
          <div><span class="k">Min</span><strong>${stFmt(means.length ? Math.min(...means) : null, m.dec)}</strong></div>
          <div><span class="k">Max</span><strong>${stFmt(means.length ? Math.max(...means) : null, m.dec)}</strong></div>`}
      </div>
      ${m.sports && sports.length > 1 && m.agg === 'sum' ? `<ul class="kd-list" style="margin-top:10px">${total.map((x) => `<li><span>${esc(ST_SPORT_LABEL[x.s])}</span><span>${stFmt(x.v, m.dec)}${m.unit ? ` ${m.unit}` : ''}</span></li>`).join('')}</ul>` : ''}
    </section>
    ${cum && cum.svg ? `<h2 class="section-title">Jahresvergleich</h2>
    <section class="tile ld-detail">
      <div class="ld-legend"><span><i class="st-key st-key-cur"></i>${new Date().getFullYear()}</span><span><i class="st-key st-key-old"></i>Vorjahre</span><span class="muted">${esc(m.label)}${stSport !== 'all' && m.sports ? ` · ${esc(ST_SPORT_LABEL[stSport])}` : ''}, aufsummiert</span></div>
      ${cum.svg}
      <div class="m small muted ld-axis"><span>Jan</span><span>Jul</span><span>Dez</span></div>
      <ul class="kd-list" style="margin-top:10px">${cum.rows.map((r) => `<li><span>${esc(r.y)}</span><span>bis heute ${stFmt(r.upto, m.dec)}${m.unit ? ` ${m.unit}` : ''} · Jahr ${stFmt(r.total, m.dec)}</span></li>`).join('')}</ul>
    </section>` : ''}
    ${yr ? `<h2 class="section-title">Jahresübersicht</h2>
    <div class="ld-ctrl st-ctrl">${seg(years.map((y) => [y.year, String(y.year)]), stYear, 'st-year')}</div>
    ${stYearHtml(d, yr)}` : ''}
    <p class="footnote">${esc(d.src?.activities || '')}. Schlaf: ${esc(d.src?.sleep_h || '')}. Stand ${esc(dateShort(d.updated))}.</p>
  </div>`;
}

function stYearHtml(d, y) {
  const s = y.sports;
  // Monate: Stunden je Sportart aus den Tagesreihen
  const months = Array.from({ length: 12 }, () => ({ swim: 0, bike: 0, run: 0, other: 0 }));
  d.days.dates.forEach((k, i) => {
    if (k.slice(0, 4) !== String(y.year)) return;
    const mo = Number(k.slice(5, 7)) - 1;
    for (const sp of ['swim', 'bike', 'run', 'other']) months[mo][sp] += d.days[`${sp}_h`][i] || 0;
  });
  const mx = Math.max(1, ...months.map((x) => x.swim + x.bike + x.run + x.other));
  const bars = months.map((x, i) => {
    let base = 0;
    const segs = ['swim', 'bike', 'run', 'other'].map((sp) => { const hgt = (x[sp] / mx) * 100; const r = hgt ? `<i class="${ST_SPORT_CLASS[sp]}" style="height:${hgt.toFixed(1)}%;bottom:${base.toFixed(1)}%"></i>` : ''; base += hgt; return r; }).join('');
    return `<div class="st-mo"><div class="st-mo-bar">${segs}</div><span>${ST_MON[i].slice(0, 1)}</span></div>`;
  }).join('');
  const row = (label, val) => `<li><span>${esc(label)}</span><span>${val}</span></li>`;
  const lg = y.longest || {};
  return `<section class="tile ld-detail">
    <div class="kd-stats st-year-stats">
      <div><span class="k">Stunden</span><strong>${stFmt(y.hours)}</strong></div>
      <div><span class="k">Einheiten</span><strong>${stFmt(y.units)}</strong></div>
      <div><span class="k">TSS</span><strong>${stFmt(y.tss)}</strong></div>
    </div>
    ${y.complete ? '' : `<p class="small muted" style="margin:6px 0 0">Laufendes Jahr, Stand ${esc(dateShort(d.updated))}.</p>`}
    <div class="st-months" aria-label="Stunden pro Monat">${bars}</div>
    <ul class="kd-list">
      ${['swim', 'bike', 'run'].map((sp) => row(ST_SPORT_LABEL[sp], `${stFmt(s[sp].km)} km · ${stFmt(s[sp].h, 1)} h · ${s[sp].n}×`)).join('')}
      ${y.other_n ? row('Sonstiges', `${stFmt(y.other_h, 1)} h · ${y.other_n}×`) : ''}
      ${y.gym_n || y.dehn_n ? row('Gym · Dehnen (Milon)', `${y.gym_n}× · ${y.dehn_n}×`) : ''}
      ${y.elev_m ? row('Höhenmeter Rad + Laufen', `${stFmt(y.elev_m)} m`) : ''}
    </ul>
  </section>
  <section class="tile ld-detail">
    <div class="k">Höhepunkte</div>
    <ul class="kd-list">
      ${lg.bike ? row('Längste Radfahrt', `${stFmt(lg.bike.km)} km · ${esc(dateShort(lg.bike.date))}`) : ''}
      ${lg.run ? row('Längster Lauf', `${stFmt(lg.run.km, 1)} km · ${esc(dateShort(lg.run.date))}`) : ''}
      ${lg.swim ? row('Längstes Schwimmen', `${stFmt(lg.swim.km, 1)} km · ${esc(dateShort(lg.swim.date))}`) : ''}
      ${y.biggest_week ? row('Größte Woche', `${stFmt(y.biggest_week.h, 1)} h · ${esc(y.biggest_week.week.replace(/^(\d+)-W0?/, 'KW ').replace(/$/, ''))}`) : ''}
      ${y.peak_ctl ? row('Höchste Fitness', `${stFmt(y.peak_ctl.ctl)} · ${esc(dateShort(y.peak_ctl.date))}`) : ''}
    </ul>
  </section>
  ${y.races?.length ? `<section class="tile ld-detail"><div class="k">Wettkämpfe</div><ul class="st-races">${y.races.map((r) => `<li>
      <span class="m small muted">${esc(dateShort(r.date))}</span><strong>${esc(r.name)}</strong>
      ${r.prs?.length ? `<span class="st-pr">Bestzeit ${esc(r.prs.join(' · '))}</span>` : ''}
      ${r.note ? `<span class="small muted">${esc(r.note)}</span>` : ''}</li>`).join('')}</ul></section>` : ''}
  ${y.prs?.length ? `<section class="tile ld-detail"><div class="k">Bestzeiten und Bestwerte</div><ul class="kd-list">${y.prs.map((p) => row(`${p.item} · ${dateShort(p.date)}`, `${esc(String(p.value))}${p.unit && p.unit !== 'h' && p.unit !== 'min' ? ` ${esc(p.unit)}` : ''}`)).join('')}</ul></section>` : ''}
  <p class="small muted" style="margin:8px 2px">Daten ${esc(String(y.year))}: ${esc(y.note || '')}</p>`;
}

function handleStatsAction(act, el) {
  if (act === 'st-metric') { stMetric = el.dataset.v; stSel = null; }
  else if (act === 'st-sport') { stSport = el.dataset.v; stSel = null; }
  else if (act === 'st-range') { stRange = el.dataset.v; stSel = null; }
  else if (act === 'st-year') stYear = el.dataset.v;
  else if (act === 'st-sel') { const i = Number(el.dataset.i); stSel = stSel === i ? null : i; }
  else return false;
  const y = window.scrollY;
  renderStatistik();
  window.scrollTo(0, y);
  return true;
}

/** Kachel im Training-Tab. */
function statsTileHtml() {
  const d = statsData();
  const y = d?.years?.[d.years.length - 1];
  return `<a class="tile st-tile" href="#/statistik">
    <div class="sec-head"><span class="k">Jahre & Statistik</span><span class="m small muted">›</span></div>
    ${y ? `<p class="small" style="margin:6px 0 0">${y.year} bisher: ${stFmt(y.sports.swim.km)} km Schwimmen · ${stFmt(y.sports.bike.km)} km Rad · ${stFmt(y.sports.run.km)} km Laufen · ${stFmt(y.hours)} h</p>`
    : '<p class="small muted" style="margin:6px 0 0">Kilometer, Stunden und Jahresübersichten.</p>'}
  </a>`;
}
