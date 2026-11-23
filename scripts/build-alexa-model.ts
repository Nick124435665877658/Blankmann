// Baut das Interaktionsmodell (de-DE) des Alexa-Skills „Blankmann“ (0.3.54).
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
  '{menge} {lebensmittel}', '{menge} {einheit} {lebensmittel}',
  'zieh {menge} {lebensmittel} ab', 'zieh {menge} {einheit} {lebensmittel} ab', 'zieh {menge} {lebensmittel} vom vorrat ab', 'zieh {menge} {einheit} {lebensmittel} vom vorrat ab',
  'minus {menge} {lebensmittel}', 'minus {menge} {einheit} {lebensmittel}', '{lebensmittel} minus {menge}', '{lebensmittel} minus {menge} {einheit}',
  'nimm {menge} {lebensmittel} raus', 'nimm {menge} {einheit} {lebensmittel} raus', 'ich möchte {menge} {lebensmittel} abziehen', 'ich möchte {menge} {einheit} {lebensmittel} abziehen',
]
const articles = ['ein', 'eine', 'einen']
const eins = [
  ...subjects.flatMap(s => articles.flatMap(a => ['verbraucht', 'verwendet', 'genommen', 'gebraucht', 'benutzt', 'gegessen'].map(v => `${s} ${a} {lebensmittel} ${v}`))),
  ...subjects.flatMap(s => ['eine', 'einen', 'ein'].flatMap(a => ['verbraucht', 'verwendet', 'aufgebraucht'].map(v => `${s} ${a} {einheit} {lebensmittel} ${v}`))),
  ...articles.flatMap(a => [`${a} {lebensmittel} verbraucht`, `${a} {einheit} {lebensmittel} verbraucht`, `${a} {lebensmittel}`, `${a} {einheit} {lebensmittel}`]),
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

const slot = (name: string, type: string) => ({ name, type })
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
        { name: 'VerbrauchIntent', slots: [slot('menge', 'AMAZON.NUMBER'), slot('einheit', 'EINHEIT'), slot('lebensmittel', 'LEBENSMITTEL')], samples: [...new Set(verbrauch)] },
        { name: 'EinsIntent', slots: [slot('einheit', 'EINHEIT'), slot('lebensmittel', 'LEBENSMITTEL')], samples: [...new Set(eins)] },
        { name: 'BestandIntent', slots: [slot('lebensmittel', 'LEBENSMITTEL')], samples: bestand },
        { name: 'RueckgaengigIntent', samples: rueckgaengig },
        { name: 'MengeIntent', slots: [slot('menge', 'AMAZON.NUMBER'), slot('einheit', 'EINHEIT')], samples: menge },
        { name: 'LebensmittelIntent', slots: [slot('lebensmittel', 'LEBENSMITTEL')], samples: lebensmittel },
      ],
      types: [
        { name: 'LEBENSMITTEL', values: foods },
        { name: 'EINHEIT', values: units.map(([id, value, synonyms]) => ({ id, name: { value, ...(synonyms.length ? { synonyms } : {}) } })) },
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
