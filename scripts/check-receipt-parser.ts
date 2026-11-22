// Regressionstest für den Bon-Parser. Aufruf: npm run test:receipt
// Referenzbon: Penny München, 18.11.2026, SUMME 16,84 EUR (Artikel + Rabatt + Pfand).
import { readFileSync } from 'node:fs'
import { checkReceiptTotal, combineReceiptRuns, findReceiptDiscount, findReceiptTotal, isNonFoodName, knownPacks, parseReceipt, prefillPackage, wordFoodMatch, type Line, type OCRWord } from '../src/lib/receiptParser.ts'

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

// 6) Netto Marken-Discount München, 20.11.2026 (Foto von Nick): SUMME [10] 18,52, „10% auf Alles“ −1,76, bezahlt 16,76.
// Besonderheiten: Steuerklasse als Ziffer gelesen („2,490“), Mengenzeile VOR dem Artikel, EW-Pfand, Rabatt nach der Summe.
{
  const nettoText = (mode: string) => readFileSync(new URL('./fixtures/browser-netto-' + mode + '.txt', import.meta.url), 'utf8')
  const modes = ['psm6', 'psm4', '80-psm6', '80-psm4']
  const runs = modes.map(mode => ({ label: mode, lines: parseReceipt(nettoText(mode), []) }))
  console.log('\n6a) Netto: Bon-Summe und Rabatt')
  for (const mode of modes) expect(findReceiptTotal(nettoText(mode)) === 18.52, 'Lauf ' + mode + ': Zwischensumme 18,52 gelesen (auch „1 SUMME [10] 18.52“ mit Störzeichen und Punkt)')
  const discount = findReceiptDiscount(nettoText('psm4'))
  expect(discount?.amount === 1.76, 'Rabatt „10% auf Alles“ −1,76 erkannt (nur Hinweis, Preise ohne Rabatt)')
  for (const run of runs) expect(!find(run.lines, /auf alles|kartenz|unne|summe/i), 'Lauf ' + run.label + ': keine Artikel aus Rabatt-, Summen- oder Zahlungszeilen')
  console.log('\n6b) Netto: einzelner Lauf (Lichtausgleich 80 %, PSM 4)')
  {
    const lines = runs[3].lines
    const check = show(lines, 18.52)
    expect(check.ok, 'Summenkontrolle stimmt (18,52)')
    expect(find(lines, /albi/i)?.price === '2,49', 'Albi 2,49 („2,490“ = 2,49 + Steuerklasse A)')
    expect(find(lines, /bueno/i)?.price === '2,49' && find(lines, /drachen/i)?.price === '1,39' && find(lines, /eier/i)?.price === '3,19', 'Kinder Bueno 2,49, Drachenzungen 1,39, Bio Eier 3,19 („2,498“, „1,398“, „3,198“)')
    expect(find(lines, /gerolst/i)?.price === '2,18' && find(lines, /gerolst/i)?.quantity === '2', 'Gerolsteiner 2,18, Menge 2 (Mengenzeile „2 x 1,09“ steht davor)')
    expect(!find(lines, /albi/i)?.quantity, 'Albi bekommt nicht die Menge des nächsten Artikels')
    expect(find(lines, /spezi/i)?.quantity === '2', 'Spezi Menge 2 (2 × 0,95), nicht 0,33 aus „0,33L“')
    expect(lines.filter(l => l.name === 'Pfand' && l.price === '0,50' && !l.selected).length === 2, 'zweimal Pfand 0,50, nicht angehakt')
    expect(Boolean(find(lines, /eier/i)?.organic), 'Bio Eier als Bio erkannt')
    expect(!find(lines, /^\d|^[^\p{L}]/u), 'keine Störzeichen am Namensanfang („3 Saure …“, „8 Gerolsteiner“)')
    expect(!find(lines, /^\d*\s*[xX]\b|\b2\s*x\b/), 'keine Mengenzeilen als Artikel („oA 2 X 1,09“)')
  }
  console.log('\n6c) Netto: alle vier Läufe kombiniert (wie in der App)')
  {
    const combined = combineReceiptRuns(runs, 18.52)
    console.log('    ' + combined.summary)
    const lines = combined.lines
    const check = show(lines, 18.52)
    expect(check.ok, 'Summenkontrolle stimmt (18,52)')
    expect(lines.filter(l => l.selected).length === 8, '8 Artikel angehakt (10 Positionen minus 2 × Pfand)')
    expect(find(lines, /gerolst/i)?.name.includes('Medium') === true, 'Name per Mehrheit der Läufe: „Gerolsteiner Medium“')
    expect(find(lines, /pink|guanabana/i)?.price === '2,89', 'pink Guanabana 2,89')
  }
}

// 7) EDEKA München (Passauer Str.), 22.11.2026 (Foto von Nick): SUMME 15,66, „Posten: 10“.
// Besonderheiten: Kopf mit Adresse/Telefon/www über der Spaltenzeile „EUR“, Papiertragetasche, Menge in derselben Zeile
// („G&G Mandeln g 1,25 € x 4  5,00 A“), Markenkürzel vorne („Hartk.“, „Paul.“, „Thann.“), „Blaumohn“ statt „Mohn“.
{
  const edekaText = (mode: string) => readFileSync(new URL('./fixtures/browser-edeka-' + mode + '.txt', import.meta.url), 'utf8')
  const modes = ['psm6', 'psm4', '80-psm6', '80-psm4']
  const foods = ['Mandeln', 'Mandeln gehobelt', 'Mandeln gemahlen', 'Mohn', 'Nelken', 'Eier', 'Paulaner Spezi', 'Milch', 'Kokosmilch'].map((name, i) => ({ id: 'f' + i, name, normalized_name: name.toLowerCase(), category: 'Test', default_unit: null }))
  const foodOf = (lines: Line[], pattern: RegExp) => foods.find(f => f.id === find(lines, pattern)?.foodId)?.name
  const runs = modes.map(mode => ({ label: mode, lines: parseReceipt(edekaText(mode), foods) }))
  console.log('\n7a) EDEKA: einzelne Läufe')
  for (const mode of ['psm4', '80-psm4']) expect(findReceiptTotal(edekaText(mode)) === 15.66, 'Lauf ' + mode + ': Bon-Summe 15,66 gelesen')
  for (const run of runs) {
    expect(!find(run.lines, /sabisz|passauer|edeka|foal|posten|cash|rib1/i), 'Lauf ' + run.label + ': keine Kopf-, Posten- oder Zahlungszeilen als Artikel')
    expect(!find(run.lines, /\b1,25\b|\bx 4\b/), 'Lauf ' + run.label + ': „1,25 € x 4“ nicht im Namen')
  }
  console.log('\n7b) EDEKA: alle vier Läufe kombiniert (wie in der App)')
  {
    const combined = combineReceiptRuns(runs, 15.66)
    console.log('    ' + combined.summary)
    const lines = combined.lines
    const check = show(lines, 15.66)
    expect(check.ok, 'Summenkontrolle stimmt (15,66)')
    expect(lines.length === 7, '7 Positionen, keine Prüfzeilen aus Kopf oder Fuß')
    const bag = find(lines, /tragetasche/i)
    expect(bag?.price === '0,25' && bag.selected === false && !bag.foodId, 'Papiertragetasche 0,25 (über anderen Lauf korrigiert), nicht angehakt, kein Nahrungsmittel')
    expect(find(lines, /pfand/i)?.price === '0,25' && find(lines, /pfand/i)?.selected === false, 'Pfand 0,25 nicht angehakt')
    expect(lines.filter(l => l.selected).length === 5, '5 Lebensmittel angehakt (Mandeln, Mohn, Nelken, Spezi, Eier)')
    const almonds = lines.find(l => /mandeln/i.test(l.name))
    expect(almonds?.price === '5,00' && almonds.quantity === '4', 'Mandeln 5,00 mit Menge 4 (1,25 € × 4)')
    expect(foodOf(lines, /mandeln/i) === 'Mandeln', 'Mandeln dem Katalog zugeordnet („g“ allein entscheidet nicht über gehobelt/gemahlen)')
    expect(foodOf(lines, /mohn/i) === 'Mohn' && find(lines, /mohn/i)?.price === '2,59', '„Herz. Blaumohn“ → Mohn, 2,59')
    expect(foodOf(lines, /nelken/i) === 'Nelken', '„Hartk. Nelken“ → Nelken')
    expect(foodOf(lines, /spezi/i) === 'Paulaner Spezi' && find(lines, /spezi/i)?.price === '1,29', '„Paul. Spezi 0,33l DS“ → Paulaner Spezi, 1,29')
    expect(foodOf(lines, /eier/i) === 'Eier' && find(lines, /eier/i)?.price === '3,99', '„Thann. H&H Eier“ → Eier, 3,99')
  }
  console.log('\n7c) Wort-Zuordnung')
  expect(wordFoodMatch('Kokosmilch light', foods)?.name === 'Kokosmilch', 'Kokosmilch bleibt Kokosmilch (nicht Milch)')
  expect(wordFoodMatch('Mandeln gehobelt 100g', foods)?.name === 'Mandeln gehobelt', 'längerer Katalogname gewinnt: Mandeln gehobelt')
  expect(wordFoodMatch('Paul Spezi', foods)?.name === 'Paulaner Spezi', 'Markenkürzel: Paul. Spezi → Paulaner Spezi')
  expect(!wordFoodMatch('Reisnudeln', [{ id: 'r', name: 'Reis', normalized_name: 'reis', category: 'Test', default_unit: null }]), 'Reisnudeln ≠ Reis (Wortanfang zählt nicht)')
  expect(isNonFoodName('Papiertragetasche') && isNonFoodName('Tragetüte') && !isNonFoodName('Teebeutel') && !isNonFoodName('Taschenkrebs'), 'Taschen/Tüten erkannt, Teebeutel und Taschenkrebs nicht')
}

// 8) Packung vorbelegen (Nick, 23.11.2026): Bon ohne Stückzahl → zuletzt gekaufte Packung, sichtbar und änderbar.
console.log('\n8) Leere Menge mit der letzten Packung vorbelegen')
{
  const packs = knownPacks([
    { food_item_id: 'eier', package_quantity: '10.000', package_unit: 'Stück', observed_at: '2026-06-30' },
    { food_item_id: 'eier', package_quantity: 6, package_unit: 'Stk', observed_at: '2026-11-18' },
    { food_item_id: 'eier', package_quantity: 10, package_unit: 'Stk', observed_at: '2026-11-22' },
    { food_item_id: 'mandeln', package_quantity: 100, package_unit: 'g ', observed_at: '2026-11-21' },
    { food_item_id: 'kaputt', package_quantity: null, package_unit: null, observed_at: '2026-11-21' },
  ])
  expect(JSON.stringify(packs.get('eier')) === '{"quantity":10,"unit":"Stk"}', 'Eier: neueste Packung (EDEKA 10 Stk vom 22.11.)')
  expect(packs.get('mandeln')?.unit === 'g' && !packs.has('kaputt'), 'Leerzeichen entfernt, Zeilen ohne Packung ignoriert')
  const line: Line = { id: '1', name: 'Eier', price: '3,99', foodId: 'eier', quantity: '', unit: '', selected: true }
  const filled = prefillPackage(line, packs)
  expect(filled.quantity === '10' && filled.unit === 'Stk' && filled.packPrefilled === true, 'Eier 3,99 ohne Menge → 10 Stk vorgeschlagen')
  expect(prefillPackage({ ...line, quantity: '6', unit: 'Stk' }, packs).quantity === '6', 'Von Hand eingetragene Menge bleibt')
  const switched = prefillPackage({ ...filled, foodId: 'mandeln' }, packs)
  expect(switched.quantity === '100' && switched.unit === 'g', 'Anderes Nahrungsmittel gewählt → vorgeschlagene Menge wechselt mit')
  const none = prefillPackage({ ...filled, foodId: 'unbekannt' }, packs)
  expect(none.quantity === '' && !none.packPrefilled, 'Ohne bekannte Packung bleibt die Menge leer')
  expect(prefillPackage({ ...line, foodId: '' }, packs).quantity === '', 'Ohne Zuordnung (z. B. Pfand, Tasche) nichts vorbelegt')
}

console.log(failed ? '\n' + failed + ' Prüfung(en) fehlgeschlagen' : '\nAlle Prüfungen bestanden')
process.exit(failed ? 1 : 0)
