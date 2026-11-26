# Alexa-Skill „Blankmann“ einrichten (einmalig, ca. 10 Minuten)

Am besten am Computer. Kostenlos, keine Kreditkarte nötig. Der Skill bleibt privat (Entwicklungsmodus) und läuft nur auf deinem Amazon-Konto.

1. **Konsole öffnen:** https://developer.amazon.com/alexa/console/ask – mit **demselben Amazon-Konto** anmelden, auf dem dein Echo läuft. Beim ersten Mal fragt Amazon nach ein paar Angaben für das (kostenlose) Entwicklerkonto.
2. **Skill anlegen:** „Create Skill“ (Skill erstellen)
   - Name: `Blankmann`
   - Primary locale / Sprache: **German (DE)**
   - Experience / Typ: **Other** → Model: **Custom**
   - Hosting: **Provision your own** (eigene Bereitstellung)
   - Weiter → Template: **Start from scratch** → „Create Skill“
3. **Sprachmodell einfügen:** links „Interaction Model“ → **JSON Editor** → Datei `interaction-model-de-DE.json` hineinziehen (oder Inhalt komplett ersetzen) → **Save** → oben **Build skill**. Warten bis „Build successful“.
   - Falls Amazon den Aufrufnamen „blankmann“ ablehnt: links „Invocations → Skill Invocation Name“ auf `blankmann küche` ändern, speichern, neu bauen. Dann heißt es „Alexa, sag Blankmann Küche …“.
4. **Endpunkt eintragen:** links **Endpoint** → **HTTPS** wählen
   - Default Region: `https://blankmann.pages.dev/api/alexa`
   - Zertifikat: **„My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority“**
   - **Save**, danach **noch einmal „Build skill“** (sonst gilt die Änderung nicht)
5. **Testen einschalten:** oben Reiter **Test** → Auswahl „Off“ auf **Development** stellen.
6. **Verbinden:** im Test-Fenster `öffne blankmann` tippen (oder zum Echo sagen: „Alexa, öffne Blankmann“). Alexa nennt einen **4-stelligen Code**. In der BLANKMANN-App: **Einstellungen → Alexa → Code eingeben → Verbinden**.
7. **Loslegen:** „Alexa, sag Blankmann, ich habe drei Eier verbraucht.“

## Was Alexa versteht
- „… ich habe drei Eier verbraucht“ · „… zweihundert Gramm Mehl verbraucht“ · „… ich habe eine Zwiebel verwendet“
- „… wie viele Eier habe ich noch?“
- **Eintragen:** „… ich habe sechs Eier gekauft“ · „… leg 500 Gramm Mehl in den Vorratsschrank“ · „… füge Hafermilch hinzu“
- **Mehreres am Stück:** „… Vorrat erfassen“, dann einfach „sechs Eier“, „zwei Packungen Nudeln“, zum Schluss „fertig“.
- Alexa fragt nach, bis alles befüllt ist: Menge, bei Neuem die Kategorie, Lagerort, Haltbarkeit („ohne“ geht). Unbekanntes wird erst nach „ja“ neu angelegt. Bei frischem Obst und Gemüse setzt sie das MHD selbst.
- Eintragen legt immer **dazu**, ersetzt nichts.
- **Ansagen:** „… was ist im Vorrat?“ · „… was ist im Kühlschrank?“ (lange Listen mit „weiter“)
- **Einkaufsliste:** „… setz Milch auf die Einkaufsliste“ · „… zwei Liter Milch auf die Einkaufsliste“ · „… Einkaufsliste“ (dann eins nach dem anderen, zum Schluss „fertig“). Immer „Blankmann“ dazusagen, sonst landet es auf Amazons eigener Liste.
- „… rückgängig“ (nimmt die letzte Alexa-Änderung zurück, bis 24 Stunden)
- Nach jeder Änderung fragt Alexa „Noch was?“ – einfach weitermachen oder „nein“ sagen.
- Mehrere Einträge (z. B. zwei Packungen Eier): das früheste MHD wird zuerst verbraucht.
- Wird etwas leer: „Sicher, dass du das Element … löschen willst?“ – „ja“ löscht, „nein“ lässt es mit 0 stehen.

## Nach Änderungen am Sprachmodell
`alexa/interaction-model-de-DE.json` in der Konsole unter „Interaction Model → JSON Editor“ ersetzen → **Save** → **Build skill**.

## Wenn etwas nicht klappt
- „Es gab ein Problem mit der Antwort des angeforderten Skills“: im Test-Fenster unten „JSON Output“ ansehen und Claude ein Foto schicken.
- Neue Lebensmittel funktionieren auch ohne Änderung am Sprachmodell. Wenn Alexa ein Wort schlecht versteht: in `alexa/lebensmittel.txt` ergänzen, `node --experimental-strip-types scripts/build-alexa-model.ts` ausführen, JSON neu einfügen und „Build skill“.
- Sophia mit eigenem Amazon-Konto: Skill in der Konsole unter „Distribution → Availability → Beta Test“ für ihre E-Mail freigeben, dann verbindet sie sich mit eigenem Code.
