// Regressionstest für den Bon-Parser. Aufruf: npm run test:receipt
// Referenzbon: Penny München, 18.11.2026, SUMME 16,84 EUR (Artikel + Rabatt + Pfand).
import { readFileSync } from 'node:fs'
import { checkReceiptTotal, combineReceiptRuns, findReceiptTotal, parseReceipt, type Line, type OCRWord } from '../src/lib/receiptParser.ts'

let failed = 0
const expect = (condition: boolean, message: string) => {
  if (condition) console.log('  ok     ' + message)
  else { failed++; console.log('  FEHLER ' + message) }
}
const find = (lines: Line[], pattern: RegExp) => lines.find(line => pattern.test(line.name))
const show = (lines: Line[], total: number | null) => {
  for (const line of lines) console.log('   ', line.name.padEnd(24), (line.price || '-').padStart(6), line.quantity ? 'Menge ' + line.quantity : '', line.selected ? '' : '(nicht angehakt)', line.note ? '⚠ ' + line.note : '')
  const check = checkReceiptTotal(lines, total)
  console.log('    Summe erkannt', check.itemsTotal.toFixed(2), '| Bon', total === null ? 'nicht gelesen' : total.toFixed(2), '| Abweichung', check.diff === null ? '-' : check.diff.toFixed(2))
  return check
}
function requiredItems(lines: Line[]) {
  expect(find(lines, /zucchini/i)?.price === '1,59', 'Zucchini 1,59')
  expect(find(lines, /eier/i)?.price === '3,29', 'Eier 3,29')
  expect(find(lines, /butter|miiprima/i)?.price === '1,15', 'Butter 1,15')
  expect(find(lines, /chips/i)?.price === '0,99', 'Kartoffelchips 0,99')
}

// 1) Idealer Text, abgetippt vom Bon
const rows: [string, string][] = [
  ['PENNY-MARKT GmbH', ''], ['Konrad-Celtis-Str. 33a', ''], ['81369 München', ''], ['UID Nr.: DE202748117', ''], ['', 'EUR'],
  ['Kartoffelbrötch.', '0,78 B'], ['2 Stk x', '0,39'], ['Walnussbrötchen', '1,10 B'], ['2 Stk x', '0,55'],
  ['Germknödelberlin', '0,99 B'], ['Franzbrötchen', '0,75 B'], ['Bio Zucchini', '1,59 B'], ['BIO EIER 6ER', '3,29 B'],
  ['Milprima BUTTER', '1,15 B'], ['Meersalz Grob', '1,29 B'], ['Knorr Kräuter', '1,99 B'], ['Knorr 25%', '-0,50 B'],
  ['Kokosmilch light', '2,38 B'], ['2 Stk x', '1,19'], ['KARTOFFELCHIPS', '0,99 B'], ['MEZZO MIX DS', '0,79 A'],
  ['PFAND 0,25 EURO', '0,25 A *'], ['SUMME', 'EUR 16,84'], ['Geg. EC-Cash', 'EUR 16,84'], ['** Kundenbeleg **', ''],
  ['Datum:', '18.11.2026'], ['Uhrzeit:', '09:57:14 Uhr'], ['Beleg-Nr.', '7578'], ['Trace-Nr.', '753006'],
  ['Kartenzahlung', ''], ['Contactless', ''], ['girocard', ''],
]
const idealText = rows.map(([l, r]) => (l + ' ' + r).trim()).join('\n')
const idealWords: OCRWord[] = []
rows.forEach(([l, r], i) => {
  const y0 = 100 + i * 40, y1 = y0 + 28
  l.split(' ').filter(Boolean).forEach((t, k) => idealWords.push({ text: t, confidence: 95, bbox: { x0: 50 + k * 90, y0, x1: 50 + k * 90 + 80, y1 } }))
  r.split(' ').filter(Boolean).forEach((t, k) => idealWords.push({ text: t, confidence: 95, bbox: { x0: 900 + k * 60, y0, x1: 900 + k * 60 + 50, y1 } }))
})
for (const [title, words] of [['1a) Idealer Bontext, mit Wortpositionen', idealWords], ['1b) Idealer Bontext, nur Text', [] as OCRWord[]]] as const) {
  console.log('\n' + title)
  const lines = parseReceipt(idealText, [], [...words])
  const total = findReceiptTotal(idealText, [...words])
  const check = show(lines, total)
  expect(total === 16.84, 'Bon-Summe 16,84 gelesen')
  expect(check.ok, 'Summenkontrolle stimmt')
  requiredItems(lines)
  expect(find(lines, /kartoffelbr/i)?.quantity === '2', 'Kartoffelbrötchen: Menge 2')
  expect(find(lines, /walnuss/i)?.quantity === '2', 'Walnussbrötchen: Menge 2')
  expect(find(lines, /kokosmilch/i)?.quantity === '2', 'Kokosmilch: Menge 2')
  expect(!find(lines, /germkn/i)?.quantity, 'Germknödel: keine Menge (früher fälschlich 2)')
  expect(!find(lines, /chips/i)?.quantity, 'Chips: keine Menge (früher fälschlich 2)')
  expect(find(lines, /knorr kr/i)?.price === '1,49', 'Knorr Kräuter 1,99 minus Rabatt 0,50 = 1,49')
  expect(find(lines, /pfand/i)?.price === '0,25' && find(lines, /pfand/i)?.selected === false, 'Pfand 0,25 als eigene, nicht angehakte Zeile')
  expect(!find(lines, /stk|cash|geg/i), 'keine Phantomartikel (Mengen-/Zahlungszeilen)')
}

// 2) Echte OCR-Ergebnisse (Tesseract 5.3 auf dem Foto nach Lichtausgleich)
for (const mode of ['psm6', 'psm4']) {
  console.log('\n2) Echte OCR nach Lichtausgleich, ' + mode.toUpperCase())
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/penny-lichtausgleich-' + mode + '.json', import.meta.url), 'utf8')) as { text: string; words: OCRWord[] }
  const lines = parseReceipt(fixture.text, [], fixture.words)
  const total = findReceiptTotal(fixture.text, fixture.words)
  const check = show(lines, total)
  expect(total === 16.84, 'Bon-Summe 16,84 gelesen')
  expect(check.ok, 'Summenkontrolle stimmt')
  if (mode === 'psm6') requiredItems(lines)
  expect(!find(lines, /^\d*\s*stk/i), 'keine Phantomartikel aus Mengenzeilen')
}

// 3) Fehlgeschlagener Lauf aus der App (Diagnosefeld „Kontrast · PSM 6“): darf nicht still als „fertig“ gelten
const failingRun = `PR A CLR
:      NEN
|              PENNY-MARKT GmbH
|           Konrad-Celtis-Str. 33a
ng              81369 München
Lo            UID Nr.: DE202748117
                                                     EUR
Kartoffelbratch.                0,78 B
|       2 Stk x Sl), 39
Walnussbr&tchen        1,10 B
2 Stk x SS, 55        A
Germknödelber lin      A       0,99 B
~ Franzbrotchen     ©     0,75 B
Bio Zucchini       7” hg) 22 B
|      ~ BID EIERWEER. "SESE 2292
-  MiTprima MEUTTER SHEEN Sia 8
Meersalz Grob       Bly. 1.29
|     Knorr Kräuter      % 1,99 B
Knorr 26% ~~      ER LF a
%    Kokosmi lc Dad ight      ce    x “a  4,30 C
i            2 Stigags 4 1h (EA      nn       n       :
© KARTOFREECHIPS SF U:
2 MEZZ0 Da. | EE
“PFAND OBES EURO 2) WN EEE`
console.log('\n3) Fehlgeschlagener App-Lauf (schlechte Bildaufbereitung)')
{
  const lines = parseReceipt(failingRun, [], [])
  const total = findReceiptTotal(failingRun, [])
  const check = show(lines, total)
  expect(!check.ok, 'wird NICHT als stimmig gemeldet (Nutzer bekommt Warnung)')
  expect(!find(lines, /^\d*\s*stk/i), 'keine Phantomartikel aus Mengenzeilen')
}

// 4) Echte Browser-Läufe aus der App (tesseract.js, 19.11.2026): schlechter gelesen als lokal
const browserText = (mode: string) => readFileSync(new URL('./fixtures/browser-penny-' + mode + '.txt', import.meta.url), 'utf8')
const browserRuns = ['psm6', 'psm4'].map(mode => ({ label: mode, lines: parseReceipt(browserText(mode), []) }))
console.log('\n4a) Browser PSM6 allein')
{
  const lines = browserRuns[0].lines
  show(lines, 16.84)
  expect(find(lines, /knorr kr/i)?.price === '1,49', 'Rabatt „-0,90“ über 25 % von 1,99 auf -0,50 korrigiert → Knorr 1,49')
  expect(Boolean(find(lines, /knorr kr/i)?.note), 'Korrektur ist in der Zeile vermerkt')
  expect(find(lines, /miiprima|butter/i)?.review === 'price-missing', 'Butter mit unleserlichem Preis „1,7“ bleibt als Prüfzeile sichtbar')
  expect(!find(lines, /ze sue/i)?.selected && !find(lines, /ze sue/i)?.price, '„Ze SUE 0,99“ (Mengenzeile ohne A/B) zählt nicht als Artikel')
  expect(find(lines, /kokos/i)?.quantity === '2', 'verstümmelte Mengenzeile „2 Stle x 1,19“ → Kokosmilch Menge 2')
}
console.log('\n4b) Browser PSM4 allein')
{
  const lines = browserRuns[1].lines
  show(lines, 16.84)
  expect(find(lines, /kartoffelbr/i)?.price === '0,78', 'unleserlicher Preis „0, {8“ aus Mengenzeile 2 × 0,39 = 0,78 berechnet')
  expect(find(lines, /walnuss/i)?.review === 'price-missing', 'Walnussbrötchen mit Preis „BE A0-B“ bleibt als Prüfzeile sichtbar')
  expect(!find(lines, /vase/i), '„VASE x 120,55“ (Mengenzeile) wird kein Artikel')
  expect(find(lines, /kokos/i)?.price === '2,38', 'Kokosmilch „2,38 8B“ gelesen')
  expect(!find(lines, /germkn/i)?.quantity, 'Germknödel: keine fremde Menge')
}
console.log('\n4c) Browser PSM6 + PSM4 kombiniert (wie in der App)')
{
  const combined = combineReceiptRuns(browserRuns, 16.84)
  console.log('    ' + combined.summary)
  const lines = combined.lines
  const check = show(lines, 16.84)
  expect(check.ok, 'Summenkontrolle stimmt')
  requiredItems(lines)
  expect(find(lines, /miiprima|butter/i)?.review === 'derived', 'Butter-Preis als „aus Bon-Summe berechnet“ markiert')
  expect(lines.filter(l => /kartoffelbr/i.test(l.name)).length === 1 && lines.filter(l => /eier|eigen/i.test(l.name)).length === 1, 'keine doppelten Zeilen aus zwei Durchläufen')
  expect(!lines.some(l => /vase|ze sue/i.test(l.name) && l.selected), 'keine Phantomartikel angehakt')
}
console.log('\n4d) Zweiter Durchlauf liest den Butterpreis: wird übernommen statt berechnet')
{
  const fixed = browserText('psm4').replace('Miiprima BUIIER                1,7 B', 'Miiprima BUIIER                1,15 B')
  const combined = combineReceiptRuns([browserRuns[0], { label: 'psm4-fix', lines: parseReceipt(fixed, []) }], 16.84)
  console.log('    ' + combined.summary)
  const lines = combined.lines
  const check = show(lines, 16.84)
  expect(check.ok, 'Summenkontrolle stimmt')
  expect(find(lines, /miiprima|butter/i)?.price === '1,15' && find(lines, /miiprima|butter/i)?.review !== 'derived', 'Butter 1,15 aus dem zweiten Durchlauf, nicht berechnet')
  expect(!find(lines, /ze sue/i), 'Summe stimmt → unsichere Zusatzzeile „Ze SUE“ entfernt')
}
console.log('\n5) Sonderfälle')
{
  const text = ['Milch 3,5% 1,09 B', 'Joghurt 10% 1,29 B', 'Knorr Kräuter 1,99 B', 'Knorr 25% 0,50 B', 'Brot 2,49 B', 'SUMME EUR 6,36'].join('\n')
  const lines = parseReceipt(text, [])
  const check = show(lines, findReceiptTotal(text))
  expect(find(lines, /milch/i)?.price === '1,09', 'Fettangabe „3,5%“ ist kein Rabatt')
  expect(find(lines, /joghurt/i)?.price === '1,29', '„Joghurt 10%“ ist kein Rabatt (Betrag passt nicht zu 10 %)')
  expect(find(lines, /knorr/i)?.price === '1,49', 'Rabatt ohne Minuszeichen „Knorr 25% 0,50“ erkannt')
  expect(check.ok, 'Summenkontrolle stimmt')
}

console.log(failed ? '\n' + failed + ' Prüfung(en) fehlgeschlagen' : '\nAlle Prüfungen bestanden')
process.exit(failed ? 1 : 0)
