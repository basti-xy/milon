# Milon – Hinweise für die Entwicklung

Öffentliches Repo `basti-xy/milon` (lokaler Ordner hieß früher `dehn-app`), GitHub Pages: https://basti-xy.github.io/milon/
**Hier liegt nur Code. Nichts Persönliches** (Übungsnamen, Trainingsdaten, Wettkämpfe, Werte, Namen, E-Mail) –
alles Inhaltliche liegt im privaten Repo `app-daten`. Vor jedem Push öffentliche Dateien auf persönliche Begriffe prüfen.

## Regeln
- Vanilla JS, kein Framework, kein Build. Offline-fähig.
- Mobile first (iPhone/iPad, Safe Areas), auch Tablet/Laptop. Offline-fähig (sw.js, Network-first).
- Nach jeder Änderung `?v=…` in `index.html` und `CACHE` in `sw.js` hochzählen; neue Dateien in `ASSETS` von `sw.js`.
- localStorage-Schlüssel heißen `milon.*`. Die alten `dehnapp.*` werden in `app.js` (`migrateStorageKeys`) beim Start
  einmalig kopiert und bleiben vorerst als Rückfall stehen; Ansage-Cache `dehn-ansagen-v1` → `milon-ansagen-v1` (`migrateVoiceCache`).
  Schlüssel **nur mit Migration** umbenennen. Dateinamen in app-daten (`dehn.json`, `dehn-routines.json`, `dehn-audio/`, `gym.json` …)
  **nie umbenennen** – sonst gehen Daten verloren (ältere Geräte würden die alte Datei neu anlegen). Gemeinsamer Token-Schlüssel aller eigenen Apps: `ghsync.config.v1`.
- Lokal testen: `py -m http.server 8010` im Ordner. Echte Daten zum Testen nur nach `.local/` kopieren (gitignored) und danach löschen.
- Kleine Commits, README aktualisieren. Commits laufen unter der GitHub-noreply-Adresse (lokale git config).

## Design (Entwurf „D“, Druck-Look – ersetzt das frühere dunkle Design)
Vorlage: `app-daten/milon-design/D-iPhone.html` und `D-iPad.html` (privat, enthält Beispielwerte – nie hierher kopieren).
- Farben nur über CSS-Variablen in `styles.css`: Papier `--paper` #eeeae1, Kachel `--tile` #f7f4ee, Rand `--line` #d6cfc2,
  Haarlinie `--hair` #e2dbcf, Tinte `--ink` #1e1c19, Text 2 `--text-2` #625c53, Text 3 `--text-3` #8f877b (nur Linien/Symbole –
  für kleinen Text zu wenig Kontrast), gut `--good` #4e7a45, schlecht `--bad` #a9443a.
- Sportarten gedämpft: Schwimmen `--sport-swim` #3d6e8f, Rad `--sport-bike` #4e7a45, Laufen `--sport-run` #a9443a,
  Gym/Kraft `--sport-strength` #6a5a8c, Dehnen `--sport-stretch` #2f7f78, Wettkampf `--sport-race` #a57a1e (als Text `--race-text` #8a6516).
  Punkte: `.sdot.s-<sport>`, in Leisten `.dots i.s-<sport>` (Klasse `o` = Ring/offen). Text-Kontrast ≥ 4,5 : 1 auf `--tile` prüfen.
- Schriften selbst gehostet (`fonts/`, in `sw.js` ASSETS): Newsreader (Überschriften, große Zahlen, `lining-nums tabular-nums`),
  IBM Plex Sans (Text; Labels `.k` in Kapitälchen-Stil, 10,5 px, Sperrung .12em), IBM Plex Mono (kleine Zahlen). Kein Google-Fonts-CDN.
- Kacheln Radius 14 px, 1 px Rand, keine Schatten, keine Verläufe, kein Blur, kein Leuchten, keine Emojis.
  Papierkörnung: kleine gekachelte SVG-Rauschfläche in `body::before` (auf dem iPad auf Performance achten, sonst PNG).
- Alle Knöpfe gleich: Umriss 1,5 px Tinte, Pille, ≥ 44 px hoch – nichts gefüllt Schwarzes, nichts sticht heraus.
  Navigation: schwarze Pille unten mittig (Heute · Training · Werte), Einstellungen über das Zahnrad oben rechts.
- Sport-Punkte mit Symbol (Wellen, Rad, Schuh, Hantel, Figur, Fahne) als CSS-Maske (`--ico` je `.s-<sport>` in `styles.css`):
  gefüllter Kreis = erledigt, Ring (`o`) = offen/geplant. Wochen-Routine eigener Punkt `.s-weekly` (`--sport-weekly`, `weeklyDot()` in `heute.js`). Gilt für `.sdot`, `.tw-dot`, `.dots i`, `.h-leg i`.
- Dunkel: `body.is-dark` überschreibt die Variablen (echtes Schwarz, Sportfarben aufgehellt). Zwei **unabhängige** Einstellungen
  (Wunsch des Nutzers – App kann hell bleiben, während das Erfassen schwarz ist): `captureDark` für Erfassen (Dehn-Player,
  Gym erfassen/bearbeiten, Abschluss-Seiten; Mond/Sonne-Knopf `themeBtnHtml()` dort und in den Einstellungen) und `appTheme`
  (`light` | `dark` | `auto` = wie das Gerät) für alle übrigen Seiten. Logik in `applyTheme()` (`app.js`).
- Diagramme selbst als SVG: dünne Tintenlinien (1,3 px, `vector-effect: non-scaling-stroke`), Garmin-Schätzwerte grau, „G“-Kästchen.
- Layout: iPhone (ab 375 px) eine Spalte, ab 768 px 2 Spalten, ab 1180 px (iPad 13″ quer) 4 Spalten. Testen bei 390 × 844,
  820 × 1180, 1376 × 1032. Safe Areas beachten.
- Tagesdaten aus `health/daily.json` / `history.json` über `GHSync.readFile`, Cache `milon.health.cache.v1` / `milon.health.history.v1`.
  Garmin-Schätzwerte (Body Battery, Stress, Schlafscore, HRV-Normalbereich) immer als „von Garmin berechnet“ kennzeichnen.

## Aufbau
`app.js` (Router, Navigation, Dehnen, Player, Ansagen, Trainingswoche, Einstellungen, Sync, Backup) ·
`heute.js` (Heute, Auswertung, Körper-Details, Training, „Garmin & Plan jetzt abrufen“ per `workflow_dispatch` des Workflows `taeglich.yml` – Token braucht dafür Actions: Read and write) · `gym.js` (Gym) · `werte.js` (Werte) · `sync.js` (GHSync) ·
`audio-test/` (Testseite für Audio auf dem iPad). Funktionsliste zum Abhaken bei Umbauten: `FUNKTIONEN.md`.
Sync-Muster: `GHSync.syncFile(path, { local, merge, equals })` + Löschmarkierungen; Merge pro Eintrag nach `id`
(Gym: neueste `updatedAt` gewinnt). Unterseiten mit Eingaben nicht durch `rerenderCurrent()` neu zeichnen.

## Ton auf iPhone/iPad – Erfahrungen (wichtig!)
Ziel war: Ansagen hörbar **und** ein Video aus einer anderen App im Bild-in-Bild läuft weiter, auch im Stummmodus.
Ergebnis nach vielen Tests auf dem echten iPad: **Für Web-Apps nicht möglich.** Safari setzt nie `mixWithOthers`.

| Technik | Video (andere App) | Stummmodus |
|---|---|---|
| `speechSynthesis` | stoppt bei jeder Ansage, läuft nicht von selbst weiter | hörbar (schaltet die Seite auf „Medienwiedergabe“) |
| Web Audio ohne `audioSession` | läuft weiter (mischt sich) | **stumm** |
| `navigator.audioSession.type = 'ambient'` / `'transient'` | läuft weiter, Lautstärke unverändert (`transient` = in WebKit auch Ambient) | stumm |
| `'playback'` (einmal beim Start gesetzt) | **pausiert** | hörbar, Medienlautstärke |
| `transient-solo`, `play-and-record` | unterbrechen laut WebKit-Quellcode ebenfalls | – |

- `audioSession.type` **nur einmal beim Start setzen, bevor ein Ton läuft.** Umstellen vor jeder Ansage hat jeglichen Ton abgewürgt.
- „Erste Ansage per `speechSynthesis`, Rest per Web Audio“ hat nicht funktioniert (kein Ton im Stummmodus, Video stoppte trotzdem).
- Umgesetzte Lösung: Ansagen sind **vorab erzeugte WAV-Bausteine** (in app-daten/`dehn-audio/`, Windows-Stimme Katja),
  abgespielt über Web Audio wie die Pieptöne; auf Apple-WebKit `audioSession.type = 'playback'` einmal in `init()`.
  Im Player **Ton-Schalter**: *Ton an* = hörbar im Stummmodus, Video pausiert; *Ton aus* = kein AudioContext, Video läuft ungestört.
- AudioContext nach 1,5 s Ruhe `suspend()`, vor dem nächsten Ton `resume()`; Zustand `interrupted` beachten.
- Ein Video im **selben** Kontext (z. B. eigener Player in der App) würde mit `playback` parallel laufen – nicht umgesetzt.
- Testseite `audio-test/` probiert alle Kombinationen auf dem Gerät durch. Der Claude-Browser kann Service Worker nur über
  Vorschau-Server zuverlässig laden – Audio-Verhalten lässt sich dort nicht prüfen, nur am echten Gerät.
