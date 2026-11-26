'use strict';

/* =========================================================================
   Milon – Kleidung nach Wetter: Rechenlogik (ohne Oberfläche, auch in Node testbar)
   Alle Zahlen (Stufen, Zu-/Abschläge, Grenzen) kommen aus der Modelldatei im Daten-Repository
   (kleidung-modell.json → modell), nie aus dem Code. Sportarten im Modell: 'rad' | 'lauf'.
   Kleidungs-Temperatur = Temperatur + Summe der Zu-/Abschläge (Intensität, Dauer, Wind, Nässe, Licht;
   Rad mit Abfahrten/Pausen zusätzlich modell.abfahrtenPausenRad; im Rechner zusätzlich persönlicher Ausgleich).
   Die gefühlte Temperatur wird gespeichert, fließt aber nicht ein (enthält den Wind schon).
   ========================================================================= */
const KL_SPORT = { run: 'lauf', bike: 'rad' };
const KL_FACTORS = ['intensity', 'duration', 'wind', 'wet', 'light'];

/** Wind-Stufe aus Mittelwind und Böen (km/h); null, wenn beides fehlt. */
function klWindStufe(wind, gust, m) {
  const r = m.windStufe;
  const w = wind == null || wind === '' ? null : Number(wind);
  const g = gust == null || gust === '' ? null : Number(gust);
  if (w == null && g == null) return null;
  if ((w != null && w > r.stark.mittelUeber) || (g != null && g >= r.stark.boeenAb)) return 'stark';
  if ((w != null && w >= r.mittel.mittelAb) || (g != null && g >= r.mittel.boeenAb)) return 'mittel';
  return 'schwach';
}
/** Nässe aus dem stärksten Niederschlag während der Einheit (mm/h). */
function klNaesse(precip, m) {
  if (precip == null) return null;
  const z = m.wetterZuordnung;
  return precip >= z.regenAbMmH ? 'regen' : precip >= z.feuchtAbMmH ? 'feucht' : 'trocken';
}
/** Licht aus Anteil Dunkelheit (0–1) und Sonnenscheindauer (s pro Stunde). */
function klLicht(sunS, darkShare, m) {
  const z = m.wetterZuordnung;
  if (darkShare != null && darkShare >= z.dunkelAbAnteil) return 'dunkel';
  if (sunS == null) return null;
  return sunS >= z.sonneAbSonnenscheinSProStunde ? 'sonne' : 'bewoelkt';
}
/** Dauer-Stufe aus Minuten: erste Stufe bei < Grenze, danach ≤ Grenze, sonst die letzte. */
function klDauer(sport, min, m) {
  const opts = m.zuAbschlaege.duration[sport];
  const g = m.dauerGrenzenMin[sport];
  if (!opts || !g || min == null || !(min > 0)) return null;
  if (min < g[0]) return opts[0].wert;
  for (let i = 1; i < g.length; i++) if (min <= g[i]) return opts[i].wert;
  return opts[opts.length - 1].wert;
}
/** Intensität aus Sekunden je Pulszone [z1..z5]. */
function klIntensitaet(zones, m) {
  if (!Array.isArray(zones) || zones.length < 5) return null;
  const tot = zones.reduce((a, b) => a + (Number(b) || 0), 0);
  if (!(tot > 0)) return null;
  const r = m.intensitaetAusZonen;
  if (((Number(zones[3]) || 0) + (Number(zones[4]) || 0)) / tot >= r.intervalleAbAnteilZ4Z5) return 'intervalle';
  if ((Number(zones[2]) || 0) / tot >= r.tempoAbAnteilZ3) return 'tempo';
  return 'locker';
}
const klOption = (m, factor, sport, wert) => (m.zuAbschlaege[factor]?.[sport] || []).find((o) => o.wert === wert) || null;

/**
 * Kleidungs-Temperatur. c = { sport: 'rad'|'lauf', temp, intensity, duration, wind, wet, light, descents, ausgleich? }
 * Gibt { kt, parts: [{ factor, label, grad }] } zurück oder null ohne Temperatur.
 */
function klKleidungsTemp(c, m) {
  if (c == null || c.temp == null || c.temp === '' || !Number.isFinite(Number(c.temp))) return null;
  let kt = Number(c.temp);
  const parts = [];
  for (const f of KL_FACTORS) {
    const o = klOption(m, f, c.sport, c[f]);
    if (!o) continue;
    kt += o.grad;
    if (o.grad) parts.push({ factor: f, label: o.label, grad: o.grad });
  }
  if (c.sport === 'rad' && c.descents) { kt += m.abfahrtenPausenRad; parts.push({ factor: 'descents', label: 'Abfahrten/Pausen', grad: m.abfahrtenPausenRad }); }
  if (c.ausgleich) { kt += Number(c.ausgleich); parts.push({ factor: 'ausgleich', label: 'persönlicher Ausgleich', grad: Number(c.ausgleich) }); }
  return { kt: Math.round(kt * 10) / 10, parts };
}
/** Stufe zur Kleidungs-Temperatur: { idx, label } (idx 0 = wärmste Stufe). */
function klStufe(sport, kt, m) {
  const s = m.stufen[sport];
  if (!s || kt == null) return null;
  for (let i = 0; i < s.untergrenzen.length; i++) {
    const u = s.untergrenzen[i];
    if (u == null || kt >= u) return { idx: i, label: s.labels[i] };
  }
  return null;
}

/* ---------- Empfehlung: Eigene Regel > Erprobt > Vorschlag (Reihenfolge aus modell.vorrang) ---------- */
const klRuleId = (sport, idx, cat) => `${sport}-${idx}-${cat}`;
/** Stufe einer gespeicherten Einheit (Kleidung c) oder null. */
function klUnitStufe(c, m) {
  const r = klKleidungsTemp(c, m);
  return r ? { kt: r.kt, ...klStufe(c.sport, r.kt, m) } : null;
}
/**
 * „Erprobt“ nach modell.erprobtLogik: alle Einheiten derselben Sportart in derselben Stufe mit Eintrag in der Kategorie.
 * Gleiche Teile (ohne Groß-/Kleinschreibung) zusammenfassen, neueste Bewertung zählt, Anzahl zählen.
 * ok = passt/ohne Bewertung (Optionen), off = zu kalt/zu warm (markiert darunter);
 * tipp, wenn nur off: Vorschlag der kälteren (zu kalt) bzw. wärmeren (zu warm) Stufe, bei „etwas …“ derselben Stufe.
 * units = [{ date, title, clothing }]
 */
function klErprobt(sport, idx, cat, units, m, vorschlaege) {
  const area = (m.kategorien[sport] || []).find((c) => c.key === cat)?.koerperbereich || null;
  const groups = new Map();
  for (const u of [...units].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const c = u.clothing;
    if (!c || c.sport !== sport) continue;
    const items = (c.clothes?.[cat] || []).map((x) => String(x).trim()).filter(Boolean);
    if (!items.length || klUnitStufe(c, m)?.idx !== idx) continue;
    const key = items.map((x) => x.toLowerCase()).sort().join(' + ');
    const g = groups.get(key) || { text: '', count: 0, rating: null, date: '' };
    g.count += 1;
    g.date = u.date; g.text = items.join(' + '); g.rating = area ? (c.ratings?.[area] || null) : null;   // neueste zählt
    groups.set(key, g);
  }
  const all = [...groups.values()].sort((a, b) => b.count - a.count || b.date.localeCompare(a.date));
  const ok = all.filter((g) => !g.rating || g.rating === 'passt');
  const off = all.filter((g) => g.rating && g.rating !== 'passt');
  let tipp = null;
  if (!ok.length && off.length) {
    const last = [...off].sort((a, b) => b.date.localeCompare(a.date))[0];
    const n = m.stufen[sport].labels.length;
    const shift = last.rating === 'zu kalt' ? 1 : last.rating === 'zu warm' ? -1 : 0;   // idx 0 = wärmste Stufe
    const ti = Math.max(0, Math.min(n - 1, idx + shift));
    tipp = { rating: last.rating, idx: ti, label: m.stufen[sport].labels[ti], text: vorschlaege?.[sport]?.[cat]?.[ti] ?? null };
  }
  return { ok, off, tipp };
}
/** Empfehlung je Kategorie: { cat, name, src: 'eigeneRegel'|'erprobt'|'vorschlag', text, options, off, tipp } */
function klEmpfehlung(sport, idx, units, rules, m, vorschlaege) {
  return (m.kategorien[sport] || []).map((c) => {
    const rule = (rules || []).find((r) => r.id === klRuleId(sport, idx, c.key) && String(r.text || '').trim());
    const e = klErprobt(sport, idx, c.key, units, m, vorschlaege);
    const vor = vorschlaege?.[sport]?.[c.key]?.[idx] ?? '–';
    const cand = { eigeneRegel: rule ? { text: rule.text } : null, erprobt: e.ok.length ? { text: e.ok[0].text } : null, vorschlag: { text: vor } };
    const src = (m.vorrang || ['eigeneRegel', 'erprobt', 'vorschlag']).find((k) => cand[k]) || 'vorschlag';
    return { cat: c.key, name: c.name, src, text: cand[src].text, options: e.ok, off: e.off, tipp: src === 'vorschlag' ? e.tipp : null, vorschlag: vor };
  });
}
/** Ähnliche Einheiten: gleiche Sportart, Kleidungs-Temperatur höchstens modell.aehnlichBisGrad entfernt; nächste zuerst. */
function klAehnlich(sport, kt, units, m, max = 5) {
  const lim = m.aehnlichBisGrad ?? 2;
  return units.filter((u) => u.clothing?.sport === sport)
    .map((u) => ({ u, s: klUnitStufe(u.clothing, m) }))
    .filter((x) => x.s && Math.abs(x.s.kt - kt) <= lim)
    .sort((a, b) => Math.abs(a.s.kt - kt) - Math.abs(b.s.kt - kt) || String(b.u.date).localeCompare(String(a.u.date)))
    .slice(0, max);
}
/** Hinweise (Regen, Dunkelheit, Intervalle, Glätte, lange Einheiten) – Texte aus modell.hinweise. */
function klHinweise(c, m) {
  const h = m.hinweise;
  if (!h) return [];
  const out = [];
  const t = c.temp == null || c.temp === '' ? null : Number(c.temp);
  if (c.wet === 'regen') out.push(['regen', h.texte.regen]);
  if (c.light === 'dunkel') out.push(['dunkel', h.texte.dunkel]);
  if (c.intensity === 'intervalle') out.push(['intervalle', h.texte.intervalle]);
  if (t != null && ((t <= h.glaetteBisTemp && c.wet && c.wet !== 'trocken') || t <= 0)) out.push(['glaette', h.texte.glaette]);
  if ((h.langeDauer?.[c.sport] || []).includes(c.duration)) out.push(['lang', h.texte.lang]);
  return out.filter((x) => x[1]);
}

if (typeof module !== 'undefined') {
  module.exports = { KL_SPORT, klWindStufe, klNaesse, klLicht, klDauer, klIntensitaet, klKleidungsTemp, klStufe,
    klRuleId, klUnitStufe, klErprobt, klEmpfehlung, klAehnlich, klHinweise };
}
