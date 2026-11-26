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

if (typeof module !== 'undefined') module.exports = { KL_SPORT, klWindStufe, klNaesse, klLicht, klDauer, klIntensitaet, klKleidungsTemp, klStufe };
