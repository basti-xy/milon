'use strict';

/* =========================================================================
   Milon – Push-Mitteilungen und Zahl am App-Icon
   - Zahl am Icon = offene Gym- und Dehn-Einheiten von heute (wie „Steht heute an“, ohne Plan-Einheiten).
     Setzt die App selbst (beim Öffnen, nach dem Erfassen) – ohne GitHub. iOS/iPadOS zeigt sie nur mit Erlaubnis für Mitteilungen.
   - Mitteilung „Heute steht an“ schickt die GitHub Action „Tagesdaten“ im Daten-Repository (geplante Läufe am Vormittag,
     einmal pro Tag). Jedes Gerät meldet sich hier an: Abo landet in push/abos.json (privat). Der Service Worker (sw.js)
     zeigt die Mitteilung und setzt die Zahl.
   - Der Schlüssel hier ist der ÖFFENTLICHE Teil (darf im Code stehen); der private liegt nur als Secret bei GitHub.
   ========================================================================= */

const PUSH_PUBLIC_KEY = 'BEbYQNcxKGlJc7LqWM3L3pQAtJdlv-z6J3m8cyDpUNo7JdOSPp8pz3SJXhlfD5IdfWUEQl3f1KBbfREaRv2gJkA';
const PUSH_ABOS_PATH = 'push/abos.json';
const PUSH_DEVICE_KEY = 'milon.push.device.v1';   // { id, name, endpoint } dieses Geräts
const push = { status: 'idle', message: '' };

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isAppleMobile = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushDevice = () => { const d = store.get(PUSH_DEVICE_KEY, null); return d && d.id ? d : null; };
const notifGranted = () => 'Notification' in window && Notification.permission === 'granted';

function defaultDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  return 'Computer';
}
function b64urlToBytes(s) {
  const b = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/* ---------- Zahl am Icon ---------- */
/** Offene Einheiten heute, die in Milon erfasst werden: Gym (an Gym-Tagen bis zum Wochenziel) + Dehnen. */
function trackedOpenCount(now = new Date()) {
  if (!DATA) return 0;
  let n = 0;
  const hist = getHistory();
  const s = computeStreak(hist, now);
  if (s.owed) n++;                                                         // gestern verpasst, heute nachholbar
  if (s.expectedToday && s.expectedToday !== 'pause' && s.todayStatus !== 'done') n++;
  const role = weeklyRole();
  if (role && now.getDay() === role.weekday && !computeWeekly(hist, now).doneToday) n++;
  if (typeof gymPlans === 'function' && gymPlans()) {
    const list = getGymSessions();
    const wc = weekCounts(weekKey(now), list);
    const today = wc.all.filter((x) => x.date === dayKey(now));
    const next = nextSplit(list);
    if (next && !today.length && (savedDraft(next.id) || (wc.n < wc.target && gymDays().includes(now.getDay())))) n++;
  }
  return n;
}
let badgeTimer = null;
/** Zahl am App-Icon neu setzen (gebündelt, weil beim Abgleich mehrere Speicherungen kurz hintereinander kommen). */
function queueBadge() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(updateAppBadge, 300);
}
function updateAppBadge() {
  if (!('setAppBadge' in navigator) || !notifGranted()) return;
  try {
    const n = trackedOpenCount();
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  } catch { /* Zahl ist nur Komfort */ }
}

/* ---------- Anmelden / Abmelden ---------- */
/** Abo dieses Geräts in push/abos.json eintragen (entry) oder entfernen (null). Pro Gerät eine Zeile nach id. */
async function saveAbo(id, entry) {
  const c = GHSync.getConfig();
  if (!c) throw new Error('Erst die Synchronisierung mit GitHub verbinden.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await GHSync.readFile(c, PUSH_ABOS_PATH);
    const devices = (Array.isArray(r?.data?.devices) ? r.data.devices : []).filter((d) => d.id !== id);
    if (entry) devices.push(entry);
    try {
      await GHSync.writeFile(c, PUSH_ABOS_PATH, { hint: 'Schreibt Milon (Einstellungen → Mitteilungen). Nicht von Hand ändern.', devices }, r?.sha,
        entry ? `Mitteilungen: ${entry.name} angemeldet` : 'Mitteilungen: Gerät abgemeldet');
      return;
    } catch (e) {
      if (e?.code === 'conflict' && attempt < 2) continue;
      throw e;
    }
  }
}
function aboEntry(dev, sub) {
  const j = sub.toJSON();
  return { id: dev.id, name: dev.name, endpoint: j.endpoint, keys: j.keys,
    gymDays: Array.isArray(cfg.gymDays) ? cfg.gymDays : APP_DEFAULTS.gymDays, updated: new Date().toISOString() };
}
async function enablePush() {
  // requestPermission muss direkt aus dem Tipp kommen (iOS), also vor allem anderen
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Mitteilungen wurden nicht erlaubt. Ändern unter iOS-Einstellungen → Mitteilungen → Milon.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(PUSH_PUBLIC_KEY) });
  const dev = pushDevice() || { id: genId(), name: defaultDeviceName() };
  await saveAbo(dev.id, aboEntry(dev, sub));
  store.set(PUSH_DEVICE_KEY, { ...dev, endpoint: sub.endpoint });
  updateAppBadge();
}
async function disablePush() {
  const dev = pushDevice();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch { /* Abo war schon weg */ }
  if (dev) await saveAbo(dev.id, null);
  store.remove(PUSH_DEVICE_KEY);
  if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});
}
/** Beim Start: Abo noch gültig? Apple kann es erneuern – dann neue Adresse eintragen. */
async function checkPushSubscription() {
  const dev = pushDevice();
  if (!dev || !pushSupported() || !notifGranted() || !GHSync.getConfig() || navigator.onLine === false) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(PUSH_PUBLIC_KEY) });
    if (sub.endpoint !== dev.endpoint) {
      await saveAbo(dev.id, aboEntry(dev, sub));
      store.set(PUSH_DEVICE_KEY, { ...dev, endpoint: sub.endpoint });
    }
  } catch { /* nächster Start versucht es erneut */ }
}
/** Gym-Tage sind eine Einstellung pro Gerät → im Abo mitführen, damit die Action richtig zählt. */
async function pushGymDaysChanged() {
  const dev = pushDevice();
  if (!dev || !notifGranted() || !GHSync.getConfig()) return;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) await saveAbo(dev.id, aboEntry(dev, sub));
  } catch { /* beim nächsten Anmelden */ }
}
async function testPush() {
  const c = GHSync.getConfig();
  const dev = pushDevice();
  await GHSync.repoApi(c, 'POST', `/actions/workflows/${HEALTH_WORKFLOW}/dispatches`, { ref: c.branch || 'main', inputs: { days: '3', push: `test:${dev.id}` } });
}

/* ---------- Einstellungen ---------- */
function pushCardHtml() {
  const dev = pushDevice();
  const on = !!dev && notifGranted();
  let body;
  if (!pushSupported()) {
    body = `<p class="small muted">${isAppleMobile() && !isStandalone()
      ? 'Mitteilungen gehen nur in der App vom Home-Bildschirm (Teilen → „Zum Home-Bildschirm“) und ab iOS 16.4.'
      : 'Dieser Browser unterstützt keine Push-Mitteilungen.'}</p>`;
  } else if (!GHSync.getConfig()) {
    body = '<p class="small muted">Erst unten die Synchronisierung mit GitHub verbinden – dort meldet sich das Gerät an.</p>';
  } else if (on) {
    body = `<ul class="status-list small"><li><span class="muted">Dieses Gerät</span><strong>${esc(dev.name)} · angemeldet</strong></li></ul>
      <div class="btn-row"><button class="btn btn-secondary" data-act="push-test" ${push.status === 'busy' ? 'disabled' : ''}>Test-Mitteilung senden</button>
      <button class="btn btn-secondary" data-act="push-off" ${push.status === 'busy' ? 'disabled' : ''}>Abmelden</button></div>`;
  } else {
    body = `<div class="btn-row"><button class="btn btn-secondary" data-act="push-on" ${push.status === 'busy' ? 'disabled' : ''}>Mitteilungen erlauben</button></div>
      ${'Notification' in window && Notification.permission === 'denied' ? '<p class="small warn">Mitteilungen sind für Milon gesperrt – in den iOS-Einstellungen → Mitteilungen → Milon erlauben.</p>' : ''}`;
  }
  return `<section class="card" id="push-card">
    <h2 class="card-title">Mitteilungen</h2>
    <p class="small muted">Jeden Vormittag nach dem Abruf (ca. 8:30, sonst nach dem Lauf um 11:40) eine Mitteilung, was heute ansteht.
      Die <strong>Zahl am App-Icon</strong> zeigt offene Gym- und Dehn-Einheiten und geht nach dem Erfassen sofort runter.
      Geschickt wird von der GitHub Action, verschlüsselt – Apple stellt nur zu.</p>
    ${body}
    ${push.message ? `<p class="small ${push.status === 'error' ? 'warn' : 'muted'}">${esc(push.message)}</p>` : ''}
  </section>`;
}
function rerenderPushCard() {
  const el = document.getElementById('push-card');
  if (el) el.outerHTML = pushCardHtml();
}
async function handlePushAction(act) {
  if (push.status === 'busy') return;
  const steps = {
    'push-on': [enablePush, 'Angemeldet. Die erste Mitteilung kommt am nächsten Vormittag – oder jetzt mit „Test-Mitteilung senden“.'],
    'push-off': [disablePush, 'Abgemeldet.'],
    'push-test': [testPush, 'Test gestartet – die Mitteilung kommt in 1–2 Minuten (GitHub ruft dafür auch Garmin und den Plan ab).'],
  };
  const [fn, okText] = steps[act] || [];
  if (!fn) return;
  Object.assign(push, { status: 'busy', message: act === 'push-on' ? 'Melde an …' : '' });
  rerenderPushCard();
  try {
    await fn();
    Object.assign(push, { status: 'idle', message: okText });
  } catch (e) {
    const msg = e?.status === 403 || e?.status === 404
      ? 'GitHub hat abgelehnt – braucht im Token „Actions: Read and write“ (für den Test) bzw. „Contents: Read and write“.'
      : e?.message || 'Hat nicht geklappt.';
    Object.assign(push, { status: 'error', message: msg });
  }
  rerenderPushCard();
}
