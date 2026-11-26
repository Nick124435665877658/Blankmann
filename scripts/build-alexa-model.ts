// Baut das Interaktionsmodell (de-DE) des Alexa-Skills „Blankmann“ (0.3.54, Vorrat erfassen/ansagen 0.3.61).
// Aufruf: node --experimental-strip-types scripts/build-alexa-model.ts → alexa/interaction-model-de-DE.json
// Die Datei wird in der Alexa-Entwicklerkonsole unter „Interaktionsmodell → JSON-Editor“ eingefügt.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const lines = readFileSync(new URL('alexa/lebensmittel.txt', root), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
const clean = (value: string) => value.replace(/[^\p{L}\p{N} '.]+/gu, ' ').replace(/\s+/g, ' ').trim()
const seen = new Set<string>()
const foods = lines.map(line => {
  const [name, ...synonyms] = line.split('|').map(clean).filter(Boolean)
  const syn = synonyms.filter(s => !seen.has(s.toLowerCase()) && s.toLowerCase() !== name.toLowerCase())
  seen.add(name.toLowerCase()); syn.forEach(s => seen.add(s.toLowerCase()))
  return { id: name, name: { value: name, ...(syn.length ? { synonyms: syn } : {}) } }
}).filter((value, index, all) => all.findIndex(v => v.id.toLowerCase() === value.id.toLowerCase()) === index)

const units: [string, string, string[]][] = [
  ['g', 'Gramm', []], ['kg', 'Kilo', ['Kilogramm', 'Kilos']], ['ml', 'Milliliter', []], ['l', 'Liter', []],
  ['Stk', 'Stück', ['Stücke']], ['Packung', 'Packung', ['Packungen', 'Päckchen', 'Pack']], ['Dose', 'Dose', ['Dosen']],
  ['Becher', 'Becher', []], ['Glas', 'Glas', ['Gläser']], ['Flasche', 'Flasche', ['Flaschen']], ['Bund', 'Bund', []],
  ['EL', 'Esslöffel', []], ['TL', 'Teelöffel', []], ['Scheibe', 'Scheibe', ['Scheiben']], ['Tüte', 'Tüte', ['Tüten']], ['Beutel', 'Beutel', []],
]

const subjects = ['ich habe', 'ich hab', 'wir haben']
const verbs = ['verbraucht', 'verwendet', 'genommen', 'gebraucht', 'benutzt', 'aufgebraucht', 'gegessen', 'verkocht']
const verbrauch = [
  ...subjects.flatMap(s => verbs.flatMap(v => [`${s} {menge} {lebensmittel} ${v}`, `${s} {menge} {einheit} {lebensmittel} ${v}`])),
  ...subjects.flatMap(s => ['verbraucht', 'verwendet', 'aufgebraucht'].map(v => `${s} {lebensmittel} ${v}`)),
  ...verbs.flatMap(v => [`{menge} {lebensmittel} ${v}`, `{menge} {einheit} {lebensmittel} ${v}`]),
  'zieh {menge} {lebensmittel} ab', 'zieh {menge} {einheit} {lebensmittel} ab', 'zieh {menge} {lebensmittel} vom vorrat ab', 'zieh {menge} {einheit} {lebensmittel} vom vorrat ab',
  'minus {menge} {lebensmittel}', 'minus {menge} {einheit} {lebensmittel}', '{lebensmittel} minus {menge}', '{lebensmittel} minus {menge} {einheit}',
  'nimm {menge} {lebensmittel} raus', 'nimm {menge} {einheit} {lebensmittel} raus', 'ich möchte {menge} {lebensmittel} abziehen', 'ich möchte {menge} {einheit} {lebensmittel} abziehen',
]
const articles = ['ein', 'eine', 'einen']
const eins = [
  ...subjects.flatMap(s => articles.flatMap(a => ['verbraucht', 'verwendet', 'genommen', 'gebraucht', 'benutzt', 'gegessen'].map(v => `${s} ${a} {lebensmittel} ${v}`))),
  ...subjects.flatMap(s => ['eine', 'einen', 'ein'].flatMap(a => ['verbraucht', 'verwendet', 'aufgebraucht'].map(v => `${s} ${a} {einheit} {lebensmittel} ${v}`))),
  ...articles.flatMap(a => [`${a} {lebensmittel} verbraucht`, `${a} {einheit} {lebensmittel} verbraucht`]),
]
const bestand = [
  'wie viel {lebensmittel} habe ich noch', 'wie viele {lebensmittel} habe ich noch', 'wie viel {lebensmittel} hab ich noch', 'wie viele {lebensmittel} hab ich noch',
  'wie viel {lebensmittel} haben wir noch', 'wie viele {lebensmittel} haben wir noch', 'wie viel {lebensmittel} ist noch da', 'wie viele {lebensmittel} sind noch da',
  'haben wir noch {lebensmittel}', 'habe ich noch {lebensmittel}', 'hab ich noch {lebensmittel}', 'ist noch {lebensmittel} da', 'sind noch {lebensmittel} da',
  'was ist noch an {lebensmittel} da', 'was haben wir noch an {lebensmittel}', 'wie viel {lebensmittel} ist im vorrat', 'wie viele {lebensmittel} sind im vorrat',
]
const rueckgaengig = ['rückgängig', 'mach das rückgängig', 'mach es rückgängig', 'das rückgängig machen', 'nimm das zurück', 'das war falsch', 'letzte änderung rückgängig', 'letzte änderung zurücknehmen', 'das stimmt nicht', 'stopp das war falsch', 'mach die letzte änderung rückgängig']
const menge = ['{menge}', '{menge} {einheit}', 'nur {menge}', 'nur {menge} {einheit}', 'es waren {menge}', 'es waren {menge} {einheit}', 'ungefähr {menge}', 'ungefähr {menge} {einheit}']
const lebensmittel = ['{lebensmittel}', 'die {lebensmittel}', 'den {lebensmittel}', 'das {lebensmittel}', 'ich meine {lebensmittel}', 'ich meine die {lebensmittel}', 'ich meine den {lebensmittel}', 'ich meine das {lebensmittel}']

// ---------------------------------------------------------------- Vorrat erfassen und ansagen (0.3.61)
const angabe = ['{menge} {lebensmittel}', '{menge} {einheit} {lebensmittel}']
const angabeEins = articles.flatMap(a => [`${a} {lebensmittel}`, `${a} {einheit} {lebensmittel}`])
// {M} = Mengenteil: einmal mit Zahl (HinzufuegenIntent), einmal mit „ein/eine“ (HinzufuegenEinsIntent)
const hinzuSaetze = [
  'leg {M} in den vorrat', 'leg {M} in den {lagerort}', 'leg {M} ins {lagerort}', 'füge {M} hinzu', 'trag {M} ein', 'pack {M} dazu',
  'ich habe {M} gekauft', 'ich hab {M} gekauft', 'wir haben {M} gekauft', 'ich habe {M} eingekauft', 'wir haben {M} eingekauft',
  'ich habe {M} da', 'wir haben {M} da', 'ich habe {M} im vorrat', 'wir haben {M} im vorrat', 'ich habe {M} zu hause', 'ich habe {M} im {lagerort}',
  'neu im vorrat {M}', '{M} dazu', '{M} hinzufügen', '{M} in den {lagerort}', '{M} ins {lagerort}',
]
const hinzu = hinzuSaetze.flatMap(s => ['{menge} {lebensmittel}', '{menge} {einheit} {lebensmittel}', '{lebensmittel}'].map(m => s.replace('{M}', m)))
const hinzuEins = hinzuSaetze.flatMap(s => articles.flatMap(a => [`${a} {lebensmittel}`, `${a} {einheit} {lebensmittel}`].map(m => s.replace('{M}', m))))
const erfassen = ['vorrat erfassen', 'ich will meinen vorrat erfassen', 'ich möchte meinen vorrat erfassen', 'ich will meinen vorrat eintragen', 'vorrat eintragen', 'inventur', 'wir machen inventur', 'ich möchte etwas eintragen', 'etwas eintragen', 'ich will etwas hinzufügen', 'etwas hinzufügen', 'ich möchte etwas anlegen', 'neues lebensmittel anlegen', 'ich habe eingekauft', 'ich war einkaufen', 'einkauf eintragen']
const ansage = [
  'was habe ich im vorrat', 'was haben wir im vorrat', 'was ist im vorrat', 'was habe ich da', 'was haben wir da', 'was ist alles da', 'was habe ich zu hause', 'lies meinen vorrat vor', 'sag mir meinen vorrat', 'was für einen vorrat habe ich',
  'was ist im {lagerort}', 'was habe ich im {lagerort}', 'was haben wir im {lagerort}', 'was liegt im {lagerort}', 'was ist in der {lagerort}', 'lies den {lagerort} vor',
]
const lagerort = ['{lagerort}', 'in den {lagerort}', 'ins {lagerort}', 'in die {lagerort}', 'in der {lagerort}', 'im {lagerort}']
const kategorie = ['{kategorie}', 'kategorie {kategorie}', 'unter {kategorie}', 'zu {kategorie}', 'bei {kategorie}', 'nimm {kategorie}']
const datum = ['{datum}', 'bis {datum}', 'bis zum {datum}', 'am {datum}', 'haltbar bis {datum}', 'mindestens haltbar bis {datum}', 'hält bis {datum}', 'läuft am {datum} ab']
const tage = ['in {menge} tagen', '{menge} tage', 'noch {menge} tage', 'hält {menge} tage', 'hält noch {menge} tage']
const wochen = ['in {menge} wochen', '{menge} wochen', 'noch {menge} wochen', 'hält {menge} wochen', 'hält noch {menge} wochen']
const ohne = ['ohne', 'ohne datum', 'kein datum', 'ohne haltbarkeit', 'weiß ich nicht', 'keine ahnung', 'überspringen', 'egal', 'unbegrenzt']
const neu = ['neu', 'neu anlegen', 'leg es neu an', 'als neues anlegen']
const mengeEins = ['ein {einheit}', 'eine {einheit}', 'einen {einheit}', 'nur ein {einheit}', 'nur eine {einheit}']
const orte: [string, string[]][] = [
  ['Kühlschrank', ['Kühli']], ['Gefrierfach', ['Gefrierschrank', 'Tiefkühlfach', 'Tiefkühlschrank', 'Gefriertruhe', 'Truhe', 'Tiefkühler', 'Froster', 'Eisfach']],
  ['Vorratsschrank', ['Schrank', 'Speisekammer', 'Regal', 'Vorratsregal']], ['Keller', ['Vorratskeller']],
]
const kategorien: [string, string[]][] = [
  ['Gemüse', []], ['Obst', ['Früchte']], ['Kräuter und Gewürze', ['Gewürze', 'Kräuter']], ['Fleisch und Fisch', ['Fleisch', 'Fisch', 'Wurst']],
  ['Milchprodukte und Eier', ['Milchprodukte', 'Molkerei']], ['Getreide und Backwaren', ['Getreide', 'Backwaren', 'Brot', 'Nudeln']],
  ['Hülsenfrüchte und Konserven', ['Konserven', 'Hülsenfrüchte', 'Dosen']], ['Öle und Saucen', ['Öle', 'Öl', 'Saucen', 'Soßen']],
  ['Nüsse und Saaten', ['Nüsse', 'Saaten']], ['Backen und Süßes', ['Backen', 'Süßes', 'Süßigkeiten']], ['Snacks', ['Knabbersachen']],
  ['Getränke', []], ['Tiefkühl', ['Tiefkühlware']], ['Sonstiges', ['Anderes']],
]
const values = (list: [string, string[]][]) => list.map(([value, synonyms]) => ({ id: value, name: { value, ...(synonyms.length ? { synonyms } : {}) } }))

const slot = (name: string, type: string) => ({ name, type })
const amountSlots = [slot('menge', 'AMAZON.NUMBER'), slot('einheit', 'EINHEIT'), slot('lebensmittel', 'LEBENSMITTEL')]
const oneSlots = [slot('einheit', 'EINHEIT'), slot('lebensmittel', 'LEBENSMITTEL')]
const model = {
  interactionModel: {
    languageModel: {
      invocationName: 'blankmann',
      intents: [
        { name: 'AMAZON.CancelIntent', samples: [] },
        { name: 'AMAZON.HelpIntent', samples: ['was kann ich sagen', 'hilfe'] },
        { name: 'AMAZON.StopIntent', samples: ['fertig', 'das wars', 'das war alles', 'nichts mehr'] },
        { name: 'AMAZON.NavigateHomeIntent', samples: [] },
        { name: 'AMAZON.FallbackIntent', samples: [] },
        { name: 'AMAZON.YesIntent', samples: [] },
        { name: 'AMAZON.NoIntent', samples: [] },
        { name: 'AMAZON.NextIntent', samples: ['weiter', 'mehr'] },
        { name: 'VerbrauchIntent', slots: [slot('menge', 'AMAZON.NUMBER'), slot('einheit', 'EINHEIT'), slot('lebensmittel', 'LEBENSMITTEL')], samples: [...new Set(verbrauch)] },
        { name: 'EinsIntent', slots: [slot('einheit', 'EINHEIT'), slot('lebensmittel', 'LEBENSMITTEL')], samples: [...new Set(eins)] },
        { name: 'BestandIntent', slots: [slot('lebensmittel', 'LEBENSMITTEL')], samples: bestand },
        { name: 'RueckgaengigIntent', samples: rueckgaengig },
        { name: 'MengeIntent', slots: [slot('menge', 'AMAZON.NUMBER'), slot('einheit', 'EINHEIT')], samples: menge },
        { name: 'LebensmittelIntent', slots: [slot('lebensmittel', 'LEBENSMITTEL')], samples: lebensmittel },
        { name: 'AngabeIntent', slots: amountSlots, samples: angabe },
        { name: 'AngabeEinsIntent', slots: oneSlots, samples: angabeEins },
        { name: 'HinzufuegenIntent', slots: [...amountSlots, slot('lagerort', 'LAGERORT')], samples: [...new Set(hinzu)] },
        { name: 'HinzufuegenEinsIntent', slots: [...oneSlots, slot('lagerort', 'LAGERORT')], samples: [...new Set(hinzuEins)] },
        { name: 'ErfassenIntent', samples: erfassen },
        { name: 'VorratAnsageIntent', slots: [slot('lagerort', 'LAGERORT')], samples: ansage },
        { name: 'LagerortIntent', slots: [slot('lagerort', 'LAGERORT')], samples: lagerort },
        { name: 'KategorieIntent', slots: [slot('kategorie', 'KATEGORIE')], samples: kategorie },
        { name: 'DatumIntent', slots: [slot('datum', 'AMAZON.DATE')], samples: datum },
        { name: 'TageIntent', slots: [slot('menge', 'AMAZON.NUMBER')], samples: tage },
        { name: 'WochenIntent', slots: [slot('menge', 'AMAZON.NUMBER')], samples: wochen },
        { name: 'OhneIntent', samples: ohne },
        { name: 'NeuIntent', samples: neu },
        { name: 'MengeEinsIntent', slots: [slot('einheit', 'EINHEIT')], samples: mengeEins },
      ],
      types: [
        { name: 'LEBENSMITTEL', values: foods },
        { name: 'EINHEIT', values: units.map(([id, value, synonyms]) => ({ id, name: { value, ...(synonyms.length ? { synonyms } : {}) } })) },
        { name: 'LAGERORT', values: values(orte) },
        { name: 'KATEGORIE', values: values(kategorien) },
      ],
    },
  },
}
// Alexa erlaubt dieselbe Beispielsprache nur einmal im ganzen Modell.
const all = model.interactionModel.languageModel.intents.flatMap(i => i.samples)
const dupes = all.filter((s, i) => all.indexOf(s) !== i)
if (dupes.length) { console.error('Doppelte Beispiele: ' + dupes.join(', ')); process.exit(1) }
writeFileSync(new URL('alexa/interaction-model-de-DE.json', root), JSON.stringify(model, null, 2) + '\n')
console.log('alexa/interaction-model-de-DE.json: ' + foods.length + ' Lebensmittel, ' + all.length + ' Beispielsätze')
