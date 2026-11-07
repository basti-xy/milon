# Milon – Funktionsliste

Bei jedem größeren Umbau vorher durchgehen und am Ende abhaken. Stand: v31 (schwarzes Layout beim Erfassen, Wiederholungsziele, Sport-Symbole).
✓ = im Browser angesehen bzw. bedient (390 × 844, 820 × 1180, 1376 × 1032) · ◐ = Logik unverändert übernommen, nur neu gestaltet – am Gerät prüfen.

## Dehnen
- [x] ✓ Einheit des Tages mit Start (Heute „Steht heute an“ und Training → Dehnen)
- [x] ✓ Pausentag, „Heute erledigt“, „Von gestern nachholen“ (fester Rhythmus, Nachholen am Folgetag)
- [x] ✓ Optionale Zusatz-Routine an bestimmten Plan-Tagen
- [x] ◐ Wochen-Routine am festen Wochentag, eigene Wochen-Streak, Cool-down nach der Einheit
- [x] ✓ Streak mit Joker (1 pro Woche), Rekord; Rhythmus-Kalender mit erledigt / nachgeholt / Pause / Joker / verpasst
- [x] ✓ Liste aller Routinen, Übersicht einer Routine
- [x] ◐ Player: Ring, Schritte, Pause (Ring antippen), Zurück, Überspringen, Abbrechen mit Rückfrage, Fortschrittsbalken
- [x] ◐ Wake Lock im Player
- [x] ◐ Ansagen als WAV-Aufnahmen, Pieptöne, Ton-Schalter, `audioSession` einmal beim Start, Rückfall Browser-Stimme
- [x] ◐ Abschluss-Seite (Streak +1, Rekord, Meilenstein, Cool-down)
- [x] ◐ Tastatur im Player (Leertaste, Pfeile, Enter, Esc)

## Gym
- [x] ◐ Wochenziel mit Punkten, Aussetzen (Grund) und Zurücknehmen, Abhaken, Erfassen
- [x] ✓ Gym-Streak (Wochen, Joker pro Monat) – als Kachel auf Training und 12-Wochen-Raster
- [x] ◐ Splits, nächster Split, letzte Einheiten (bearbeiten, löschen)
- [x] ◐ Übungen mit Verlauf und Progressionshinweis „Mehr Gewicht probieren“, Übungsseite
- [x] ◐ Erfassen: Vorbelegung, Entwurf, Haken mit Uhrzeit, Satz hinzufügen/entfernen, Fokus „Jetzt dran“, Leiste „Noch x von y Sätzen“, Pausenbalken
- [x] ◐ Erste Eingabe ersetzt die alte Zahl (iOS), Wake Lock beim Erfassen, Entwurf beim Sperren des Bildschirms
- [x] ◐ Abschluss-Übersicht
- [x] ✓ Wiederholungsziel aus dem Plan (`reps`) vorbelegt statt der Zahl vom letzten Mal, groß „Ziel“, „Warum …?“ (`repsWhy`)
- [x] ✓ Schwarzes Layout (Mond-Knopf) beim Erfassen, im Player und auf den Abschluss-Seiten; Rest bleibt hell

## Training & Auswertung
- [x] ◐ Auswertung (früher Karte Trainingswoche): Stunden, Erkenntnisse, Zahlen, blätterbar (Pfeile, Wischen, Balken)
- [x] ✓ Vorschau „Nächste Woche“ mit Abweichungen vom Original-Plan
- [x] ◐ Gemeinsamer Kalender Gym / Dehnen / Wettkampf, 5 Wochen, blätterbar

## Heute (neu)
- [x] ✓ Kopf mit KW · Planwoche · Phase, Datum, „Daten von …“ (iPad)
- [x] ✓ Einschätzung (Ampel), Letzte Woche mit ✓ / ✗ / →, Link Ganze Auswertung
- [x] ✓ Steht heute an: Plan-Einheiten (Details aufklappbar), Gym an den Gym-Tagen, Dehnen – direkt startbar
- [x] ✓ 8 Kacheln mit Abweichung vom 28-Tage-Schnitt, Verlauf, HRV-Normalbereich, „G“ für Garmin-Schätzwerte
- [x] ✓ Detailseite je Kachel: 2 Wochen / 1 Monat / 6 Monate
- [x] ✓ Sport-Punkte mit Symbolen (erledigt gefüllt, offen als Ring), Legende
- [x] ✓ Wochen-Routine als eigener Punkt in Wochenleiste und Kalender (erledigt; Ring am festen Wochentag, solange in der Woche offen)
- [x] ✓ Diese Woche: Stunden, Sportarten, Wochenleiste (gefüllt = erledigt, Ring = offen), 12 Wochen (iPad)
- [x] ✓ Wettkämpfe: nächste 2 + Saisonziel, Tage bis dahin
- [x] ✓ Ohne Tagesdaten: Hinweis statt Fehler

## Werte
- [x] ✓ Gruppen, Verlauf als Linie, PR-Verbesserung, Trendpfeile (iPad 2 Spalten)

## Einstellungen & Daten
- [x] ✓ Übergangszeiten, Töne, Sprachansage, Testknöpfe, Auto-Weiter, Zurücksetzen
- [x] ✓ Gym-Tage (neu, Standard Mo/Mi/Fr)
- [x] ✓ Darstellung der App: Hell / Dunkel / Automatisch – unabhängig von „Beim Erfassen: Hell / Schwarz“
- [x] ◐ „Garmin & Plan jetzt abrufen“: startet den Workflow Tagesdaten, zeigt Fortschritt, lädt danach neu; Hinweis bei fehlender Token-Berechtigung (mit echter GitHub-Antwort am Gerät prüfen)
- [x] ◐ Einheit nachtragen, Verlauf mit Löschen
- [x] ◐ Backup speichern / einspielen, Erinnerung
- [x] ◐ Sync verbinden, abgleichen, trennen; Status-Punkt am Zahnrad
- [x] ◐ Über Milon
- [x] ◐ Einrichtung beim ersten Start, Offline-Betrieb (Service Worker), Warnung bei blockiertem Speicher, Migration `dehnapp.*` → `milon.*`
