# Milon

*Kleine Lasten, täglich getragen, werden zu großer Kraft.* – benannt nach Milon von Kroton, der der Sage nach jeden Tag
ein Kalb trug, bis es ein ausgewachsener Stier war.

Statische Web-App (PWA, HTML/CSS/Vanilla JS, kein Build, kein Backend) für das eigene Training. Offline-fähig,
für iPhone und iPad gemacht, auch am Laptop nutzbar.

Alle **Inhalte und Verläufe liegen nicht in diesem Repository**, sondern in einem privaten Daten-Repository.
Die App liest und schreibt sie über die GitHub-API mit einem persönlichen Token, den man pro Gerät einmal in der App einträgt.
Hier liegt nur der Programmcode.

## Bereiche (schwarze Pille unten mittig)

| Bereich | Inhalt |
|---|---|
| **Heute** | Kopf (KW · Planwoche · Phase, Datum, auf dem iPad „Daten von …“), **Einschätzung** (Tagesampel aus `health/daily.json`) mit *Letzte Woche* (Headline + ✓/✗/→) und Link *Ganze Auswertung*, **Steht heute an** (Plan-Einheiten, nächster Gym-Split an den Gym-Tagen, Dehnen des Tages inkl. Nachholen – direkt startbar), **Körper** (8 Kacheln: Wert, Abweichung vom 28-Tage-Schnitt, Verlauf; „G“ = von Garmin berechnet; antippen = Detailseite 2 Wochen / 1 Monat / 6 Monate), **Diese Woche** (Stunden erledigt/geplant, Sportarten, Wochenleiste mit Punkten), **Wettkämpfe** (nächste 2 + Saisonziel), **Belastung** (Fitness · Ermüdung · Form aus `daily.json → load`, Detailseite `#/belastung` mit Verlauf, Zielkorridor aus `history.json → load.corr_lo/corr_hi` und Info); auf dem iPad zusätzlich Wochenstunden 12 Wochen und Kalender Gym & Dehnen |
| **Training** | Gemeinsamer Kalender (5 Wochen, blätterbar: Gym, Dehnen, Wettkampf), Dehn- und Gym-Streak nebeneinander, darunter **Gym** (Wochenziel mit Aussetzen/Abhaken/Erfassen, Splits, letzte Einheiten, Progression pro Übung) und **Dehnen** (Einheit des Tages, Wochen-Routine, Rhythmus, alle Routinen). Erfassen-Ansicht und Dehn-Player sind eigene Vollbild-Ansichten |
| **Werte** | Leistungs- und Körperwerte mit Stand-Datum und Verlauf |

Unterseiten: `#/auswertung` (bisherige Karte *Trainingswoche*: Stunden → Erkenntnisse → Zahlen, blätterbar, Vorschau *Nächste Woche*),
`#/koerper/<id>` (Detail einer Kachel). Gym erfassen: Satz per Haken (mit Uhrzeit), Leiste unten mit offenen Sätzen, Restpause
und flüssig laufendem Balken; die erste Eingabe ersetzt die alte Zahl, „Jetzt dran“-Fokus, Bildschirm bleibt an, danach Abschluss-Übersicht.
Vorbelegt: Gewicht vom letzten Mal, Wiederholungen = **Ziel aus dem Plan** (`reps`, Begründung `repsWhy` unter „Warum …?“).

Einstellungen (Zahnrad oben rechts): Übergangszeiten, Töne, Sprachansage, **Gym-Tage** (Standard Mo/Mi/Fr), **Darstellung**
(App hell/dunkel/automatisch, Erfassen hell/schwarz – unabhängig), **Garmin & Plan jetzt abrufen** (startet den Workflow
„Tagesdaten“ im Daten-Repository; Token braucht dafür zusätzlich *Actions: Read and write*), Synchronisierung,
Backup, Einheit nachtragen.

## Design

Druck-Look (Entwurf „D“): Papier, Kacheln mit 1 px Rand, dünne Tintenlinien, keine Schatten/Verläufe. Schriften selbst gehostet
in `fonts/` (Newsreader, IBM Plex Sans, IBM Plex Mono; SIL Open Font License, Lizenzen liegen daneben). Regeln: `CLAUDE.md`.
Layout: iPhone eine Spalte, iPad hochkant 2 Spalten, iPad quer (ab 1180 px) Raster mit 4 Spalten.
Sportarten als Punkte mit Symbol (gefüllt = erledigt, Ring = offen). Beim Erfassen (Dehn-Player, Gym) lässt sich ein
**schwarzes Layout** per Mond-Knopf einschalten; der Rest der App bleibt hell.

## Code

| Datei | Inhalt |
|---|---|
| `index.html`, `styles.css` | Gerüst und Design (Farben als CSS-Variablen, siehe `CLAUDE.md`) |
| `app.js` | Router, Navigation, Dehnen (Streak, Player, Ansagen), Trainingswoche, Einstellungen, Sync, Backup |
| `heute.js` | Heute, Auswertung, Körper-Details, Training (Kalender, Streaks) – liest `health/daily.json` und `health/history.json` |
| `gym.js` | Gym: Pläne, Protokoll mit Sync, Erfassen, Progression, Gym-Streak |
| `werte.js` | Werte |
| `push.js` | Push-Mitteilungen (Anmeldung in `push/abos.json` des Daten-Repos) und Zahl am App-Icon (offene Gym- und Dehn-Einheiten) |
| `sync.js` | `GHSync`: Lesen/Schreiben einer Datei im Daten-Repository mit Konflikt-Wiederholung |
| `sw.js` | Service Worker (Network-first, offline aus dem Cache; zeigt Push-Mitteilungen und setzt die Zahl am Icon) |
| `fonts/` | Schriften (woff2, lateinisch) |

Nach jeder Änderung die Versionen hochzählen: `?v=…` in `index.html` und `CACHE` in `sw.js`.
localStorage-Schlüssel heißen `milon.*` (früher `dehnapp.*`, beim Start einmalig übernommen – die alten bleiben vorerst als Rückfall).
Schlüssel nur mit Migration umbenennen; Dateinamen im Daten-Repository (`dehn.json` usw. – benannt nach dem Bereich Dehnen) bleiben.
Tagesdaten-Zwischenspeicher: `milon.health.cache.v1` (daily.json), `milon.health.history.v1` (history.json) – offline gilt der letzte Stand.

## Daten-Repository (privat)

| Datei | von Hand | App schreibt | Inhalt |
|---|---|---|---|
| `dehn-routines.json` | ✓ | | Dehn-Routinen, Zyklus, Rollen |
| `dehn.json` | | ✓ | Dehn-Verlauf (Sync + Merge, Löschmarkierungen) |
| `dehn-audio/` | Generator | | Sprachansagen als WAV-Bausteine plus `index.json` (Text → Datei) |
| `gym-plans.json` | ✓ | | Gym-Pläne: Splits mit Übungen (`id`, `block`, `sets`, `reps` = Wiederholungsziel, `repsWhy`, `kg`, `stepKg` …) und `settings.weeklyTarget` |
| `gym.json` | | ✓ | Gym-Protokoll (Merge pro Einheit: neueste Bearbeitung gewinnt, Löschmarkierungen). Sätze mit `at` (Uhrzeit des Abhakens); ausgesetzte Einheiten mit `skipped: true` und `reason` |
| `training/weekly.json` | Auswertung | | Trainingswoche (Stunden, Erkenntnisse, Sportarten, Erholung) und `next` = Vorschau auf die nächste Woche aus dem Trainingsplan (Einheiten pro Tag, Abweichungen vom Original) – App liest nur |
| `health/daily.json`, `health/history.json` | GitHub Action | | Tagesdaten für *Heute*: Einschätzung, 8 Kacheln, Woche, Wettkämpfe; Verläufe der letzten 400 Tage. Aufbau im README des Daten-Repositorys – App liest nur |
| `training/values.json` | ✓ | | Werte: `groups[].items[]` mit `unit`, `kind` (`number`/`pace`/`time`), `better`, `entries[]` (`date`, optional `event` = Wettkampf/Einheit und `note`); Gruppe mit `pr: true` = Bestwerte (Verbesserung statt Trendpfeil). Linie mit echten Werten, waagerecht nach Datum |

Die Ansagen werden wie die Countdown-Töne über Web Audio abgespielt. Auf iPhone/iPad gibt es im Player einen
Ton-Schalter: *Ton an* = hörbar auch im Stummmodus (ein Video im Bild-in-Bild hält dabei an), *Ton aus* = die App
gibt keinen Ton aus und das Video läuft ungestört weiter.

Token: *Settings → Developer settings → Fine-grained tokens*. Bei *Repository access* nur das Daten-Repository auswählen,
bei *Contents* **Read and write** setzen. Der Token wird nur im Browser des Geräts gespeichert und nur an `api.github.com` gesendet.
Er gilt für alle eigenen Apps unter derselben `*.github.io`-Adresse.

## Routinen-Datei (Dehnen)

- `settings`: `transitionSeconds`, `sideSwitchSeconds`, `defaultSecondsPerRep`, `defaultRestBetweenSetsSeconds`, `autoAdvanceRepExercises`
- `rotation.cycle`: fester Zyklus aus Routinen-IDs und `"pause"`
- `roles.weekly`: `{ routine, weekday (0 = Sonntag), hint, cooldown }`, eine Routine mit eigener Wochen-Streak und Hinweis an ihrem Wochentag
- `roles.extra`: `{ routine, onPlanDays }`, optionales Extra, das an bestimmten Plan-Tagen vorgeschlagen wird
- `routines[].exercises[]`: `type` (`time`/`reps`), `seconds`, `reps`, `secondsPerRep`, `perSide`, `alternating`, `sets`,
  `restSeconds`, `phase`, `cue`, `important`, `benefit`, `note`, `repsRange`, `secondsRange`, optional `image`, `say`

Änderungen direkt im Daten-Repository bearbeiten. Die App holt sie beim nächsten Öffnen oder über *Jetzt abgleichen*.
Offline nutzt sie die zuletzt geladene Version.

## Streaks

- **Dehnen:** fester Kalender – der Zyklus läuft ab der ersten Einheit Tag für Tag weiter und verschiebt sich nie.
  Geplante Einheit erledigt = +1, geplanter Pausentag zählt automatisch mit. Eine verpasste Einheit kann am Folgetag
  nachgeholt werden und zählt dann für den verpassten Tag (an einem Dehntag ist dessen eigene Einheit zusätzlich fällig).
  Nicht nachgeholt: ein Joker pro Kalenderwoche fängt den Tag ab, danach beginnt die Streak neu. Die Wochen-Routine hat eine eigene Wochen-Streak.
- **Gym:** Wochen (Mo–So) in Folge mit mindestens `weeklyTarget` Einheiten (abgehakt oder ausführlich). Die laufende Woche
  bleibt offen. Ein Joker pro Kalendermonat (Monat des Donnerstags der Woche) fängt eine verpasste Woche ab, die Streak
  bleibt dann stehen; die zweite verpasste Woche im selben Monat setzt sie auf 0. **Aussetzen** (z. B. Tag nach einem
  Wettkampf): zählt nicht als Einheit, senkt aber das Wochenziel dieser Woche um 1 (mindestens 1) und schiebt die
  Split-Reihenfolge weiter; lässt sich in „Letzte Einheiten“ zurücknehmen.
- **Progression:** Haben beim letzten Mal alle Sätze das obere Ende der Wiederholungsspanne erreicht, zeigt die App
  „+`stepKg` kg probieren“ (bei Körpergewicht: mehr Wdh./Zusatzgewicht, bei Zeit: +5 s). Aufwärmsätze zählen nicht.

## Lokal starten

`py -m http.server 8010` im Ordner, dann `http://localhost:8010`. Eine lokale `routines.json` wird als Rückfall genutzt.
Für Tests mit echten Daten Kopien in `.local/` legen – `routines.json`, Backups und `.local/` sind per `.gitignore`
ausgeschlossen.

## Bedienung

Tippen auf den Ring = Pause. Tastatur: **Leertaste** Pause, **→** überspringen, **←** zurück, **Enter** „Fertig“, **Esc** abbrechen.
Auswertung: Pfeile, Wischen oder Tippen auf einen Wochenbalken blättert durch ältere Wochen. Bei der neuesten Woche steht
darunter die Vorschau *Nächste Woche* (geplante Stunden je Sportart, Einheiten pro Tag zum Aufklappen, Markierung
verschoben / geändert / neu / entfällt).
