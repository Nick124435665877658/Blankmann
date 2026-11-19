// Auswertung von OCR-Text/Wortpositionen eines Kassenbons.
// Aus ReceiptScanner.tsx ausgelagert, damit der Parser ohne Browser testbar ist (scripts/check-receipt-parser.ts).

export type Food = { id: string; name: string; normalized_name: string; category: string; default_unit: string | null }
// review: warum eine Zeile geprüft werden sollte. note: Hinweis, der in der Prüfliste unter der Zeile steht.
export type LineReview = 'price-missing' | 'doubtful' | 'second-run' | 'derived' | 'corrected'
export type Line = { id: string; name: string; price: string; foodId: string; quantity: string; unit: string; selected: boolean; review?: LineReview; note?: string; ocrPrice?: string }
export type OCRWord = { text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

export const normalize = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9-]+/g,' ').replace(/\s+/g,' ').trim()
export function editDistance(a:string,b:string){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const current=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=current}}return row[b.length]}
export function likelyFood(name:string,foods:Food[]){const n=normalize(name);const exact=foods.find(f=>normalize(f.name)===n||normalize(f.normalized_name)===n);if(exact)return exact;return foods.find(f=>{const target=normalize(f.name);if(!target||Math.abs(target.length-n.length)>2)return false;return editDistance(n,target)<=Math.max(1,Math.floor(Math.min(n.length,target.length)*0.16))})}

const toNumber = (value: string) => Number(value.replace(',', '.'))
const formatPrice = (value: number) => value.toFixed(2).replace('.', ',')
const round2 = (value: number) => Math.round(value * 100) / 100
// OCR liest Preise oft als „2, 38“ oder „16, 84“ – das Leerzeichen nach dem Komma entfernen.
const tidyPrices = (value: string) => value.replace(/(\d[,.])\s+(\d{2})(?!\d)/g, '$1$2')
const lastPrice = (value: string) => { const all = [...value.matchAll(/(-?\d{1,4}[,.]\d{2})/g)]; return all.length ? all[all.length - 1][1] : null }
const isTotalText = (value: string) => /^(summe|gesamtsumme|gesamtbetrag|endsumme|zu zahlen|total)\b/.test(normalize(value))
const lettersOf = (value: string) => (value.match(/\p{L}/gu) || []).length

type Row = { y: number; words: OCRWord[] }
function groupRows(words: OCRWord[]): Row[] {
  const sorted = [...words].filter(w => w.text.trim()).sort((a, b) => ((a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1)) || a.bbox.x0 - b.bbox.x0)
  const rows: Row[] = []
  for (const word of sorted) {
    const y = (word.bbox.y0 + word.bbox.y1) / 2
    let row = rows.find(r => Math.abs(r.y - y) <= Math.max(10, (word.bbox.y1 - word.bbox.y0) * 0.55))
    if (!row) { row = { y, words: [] }; rows.push(row) }
    row.words.push(word)
    row.y = row.words.reduce((s, w) => s + (w.bbox.y0 + w.bbox.y1) / 2, 0) / row.words.length
  }
  rows.sort((a, b) => a.y - b.y)
  return rows
}
// Zerrissene Preise wie „2,“ + „38“ wieder zu „2,38“ zusammenfügen.
function mergeSplitPrices(rowWords: OCRWord[]): OCRWord[] {
  const merged: OCRWord[] = []
  for (let i = 0; i < rowWords.length; i++) {
    const word = rowWords[i]
    const next = rowWords[i + 1]
    if (next && /^-?\d{1,4}[,.]$/.test(word.text.trim()) && /^\d{2}$/.test(next.text.trim())) {
      merged.push({
        text: word.text.trim() + next.text.trim(),
        confidence: Math.min(word.confidence ?? 0, next.confidence ?? 0),
        bbox: { x0: word.bbox.x0, y0: Math.min(word.bbox.y0, next.bbox.y0), x1: next.bbox.x1, y1: Math.max(word.bbox.y1, next.bbox.y1) },
      })
      i++
    } else merged.push(word)
  }
  return merged
}
const rowWordsOf = (row: Row) => mergeSplitPrices([...row.words].sort((a, b) => a.bbox.x0 - b.bbox.x0))
const rowTextOf = (rowWords: OCRWord[]) => tidyPrices(rowWords.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim())

// Endsumme des Bons (Zeile „SUMME …“), oder null wenn sie nicht gelesen werden konnte.
export function findReceiptTotal(text: string, words: OCRWord[] = []): number | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = tidyPrices(raw.replace(/\s+/g, ' ').trim())
    if (isTotalText(line)) { const price = lastPrice(line); if (price) return toNumber(price) }
  }
  for (const row of groupRows(words)) {
    const rowText = rowTextOf(rowWordsOf(row))
    if (isTotalText(rowText)) { const price = lastPrice(rowText); if (price) return toNumber(price) }
  }
  return null
}

// Summenkontrolle: Summe aller erkannten Preise (auch Pfand und Rabatte) gegen die SUMME auf dem Bon.
export function checkReceiptTotal(lines: Line[], total: number | null) {
  const itemsTotal = round2(lines.reduce((sum, line) => sum + (toNumber(line.price) || 0), 0))
  const diff = total === null ? null : round2(itemsTotal - total)
  return { total, itemsTotal, diff, ok: diff !== null && Math.abs(diff) < 0.005 }
}

const isNoise=(value:string)=>/^(summe|gesamt|zwischensumme|bar|ec|visa|mastercard|gegeben|geg|rueckgeld|wechselgeld|mwst|ust|steuer|netto|brutto|rabatt|ersparnis|kartenzahlung|kundennummer|kundenbeleg|girocard|contactless|datum|uhrzeit|beleg|trace|bon|kasse|bedienung|artikel|anzahl|eur|pfand|cent|betrag|zu zahlen|summe eur)\b/i.test(normalize(value))
const cleanName=(raw:string)=>{
  // Dezimalangaben wie „3,5%“ im Namen behalten (§ als Platzhalter für das Komma).
  let name=raw.replace(/(\d)[,.](\d)/g,'$1§$2').replace(/[|_]+/g,' ').replace(/[“”„"'´]/g,' ').replace(/[^\p{L}\p{N}\s%§-]/gu,' ').replace(/§/g,',').replace(/\s+/g,' ').trim()
  name=name.replace(/\bkokosmi\s+lc\s+dad\s+ight(?:\s+.*)?$/i,'Kokosmilch Light')
  name=name.replace(/\bkokosmilch\s+d[a4]d?\s*l?i[gq]ht\b/i,'Kokosmilch Light')
  // Penny-/OCR-spezifische Korrekturen: nur eindeutige Artikelstämme normalisieren.
  if(/^bio\s+zucch/i.test(name)) name='Bio Zucchini'
  else if(/^bio\s+eier/i.test(name)||/^bid\s+eier/i.test(name)) name='Bio Eier'
  else if(/^milprima/i.test(name)) name='Milprima Butter'
  else if(/^kartof.*chips/i.test(name)||/^kartoffel.*chips/i.test(name)) name='Kartoffelchips'
  else if(/^knorr\s+krauter/i.test(normalize(name))) name='Knorr Kräuter'
  else if(/^meersalz/i.test(name)) name='Meersalz Grob'
  return name.replace(/^[-\s]+|[-\s]+$/g,'')
}
// Ein Artikelname braucht mindestens ein echtes Wort (4+ Buchstaben) und darf nicht überwiegend aus Zeichenmüll bestehen.
const looksLikeName = (raw: string) => {
  const name = cleanName(raw)
  const words = name.split(' ').filter(Boolean)
  return words.length > 0 && words.length <= 6 && words.some(w => lettersOf(w) >= 4) &&
    lettersOf(name) / Math.max(1, name.replace(/\s/g, '').length) >= 0.6 && !isNoise(name)
}

// Preiszeile zerlegen: „Name … 1,29 B“ → Name, Preis, Rest. Der Rest darf nur kurz sein (Steuerklasse A/B, Sternchen).
type PriceRow = { left: string; price: string; tax: boolean }
function splitPriceRow(row: string): PriceRow | null {
  const matches = [...row.matchAll(/-?\d{1,4}[,.]\d{2}(?!\d)/g)]
  if (!matches.length) return null
  const match = matches[matches.length - 1]
  const tail = row.slice((match.index ?? 0) + match[0].length)
  if (tail.trim().length > 6 || /\d[,.]\d/.test(tail)) return null
  // Steuerklasse direkt hinter dem Preis, auch verstümmelt: „B“, „.B“, „8B“, „A x“, „1,92B“ – oder B als „6“/„8“ gelesen.
  const tax = /^[\s.,:;|]*\d?[AB]\b/i.test(tail) || /^[\s.,:;]*[68]\s*$/.test(tail) || /^\s*[12*]\s*[x*]?\s*$/.test(tail)
  return { left: row.slice(0, match.index).trim(), price: match[0], tax }
}
// Mengenzeile, auch verstümmelt: „2 Stk x 0,39“, „2Stkx 0,39“, „Stk x 0,59“, „2 Stle x 1,19“, „2 Ste % 119“.
const qtyRowRe = /^(?:(\d{1,2})\s*)?(?:[A-Za-zÄÖÜäöü]{1,5}\.?\s*)?[xX×%]\s*(\d{1,4}[,.]\d{2}|\d{3})(?!\d)/
const unitFromQtyRow = (value: string) => /^\d{3}$/.test(value) ? value[0] + ',' + value.slice(1) : value
// Name vorne, unlesbarer Preis hinten: „Miiprima BUIIER 1,7 B“, „Walnussbrötchen BE A0-B“, „Kartoffelbratch. 0, {8 b“.
function splitGarbledPrice(row: string, taxMode: boolean): { name: string; garbage: string } | null {
  const tokens = row.split(' ').filter(Boolean)
  let cut = tokens.findIndex(t => /\d/.test(t))
  if (cut < 0) cut = tokens.length
  while (cut > 0 && (tokens[cut - 1].length <= 2 || !/\p{L}{2}/u.test(tokens[cut - 1]))) cut--
  const name = tokens.slice(0, cut).join(' ')
  const garbage = tokens.slice(cut).join(' ')
  if (!garbage || !looksLikeName(name)) return null
  const garbledPrice = /\d\s*[,.]/.test(garbage) || (taxMode && /(?:^|[^A-Za-z])[AB]$/.test(garbage))
  return garbledPrice ? { name, garbage } : null
}

// Ganzzahliger Prozentrabatt („25%“), nicht Fettangaben wie „3,5%“.
const percentRe = /(?:^|[^\d,.])(\d{1,2})\s*%/
// Ziffern, die OCR auf Thermobons häufig verwechselt (für die Prüfung von Rabattbeträgen).
const confusable: Record<string, string> = { '0': '689', '1': '47', '2': '7', '3': '58', '4': '1', '5': '369', '6': '058', '7': '12', '8': '0369', '9': '058' }
function oneDigitVariants(value: string): string[] {
  const variants: string[] = []
  for (let i = 0; i < value.length; i++) for (const digit of confusable[value[i]] ?? '') variants.push(value.slice(0, i) + digit + value.slice(i + 1))
  return variants
}

export function parseReceipt(text:string, foods:Food[], words:OCRWord[] = []):Line[] {
  // Tesseract liefert den Text bereits zeilenweise. Wortpositionen nur nutzen, wenn der Text keine Zeilenstruktur hat.
  const textRows = text.split(/\r?\n/).map(raw => tidyPrices(raw.replace(/\s+/g, ' ').trim()))
  const priceRows = (rows: string[]) => rows.filter(r => splitPriceRow(r)).length
  let rows = textRows
  if (words.length && priceRows(textRows) < 3) {
    const wordRows = groupRows(words).map(row => rowTextOf(rowWordsOf(row)))
    if (priceRows(wordRows) > priceRows(textRows)) rows = wordRows
  }
  // Alles ab der SUMME-Zeile (Zahlung, Datum, Belegnummer …) enthält keine Artikel.
  const totalIndex = rows.findIndex(r => isTotalText(r) && lastPrice(r) !== null)
  const body = totalIndex >= 0 ? rows.slice(0, totalIndex) : rows
  // Bons mit Steuerklasse (… 1,29 B): Zeilen ohne A/B sind Mengen- oder Zusatzzeilen, keine eigenen Artikel.
  const named = body.map(r => splitPriceRow(r)).filter((p): p is PriceRow => Boolean(p && lettersOf(p.left) >= 3 && !isNoise(p.left)))
  const taxMode = named.length >= 3 && named.filter(p => p.tax).length / named.length >= 0.6
  // Kopfbereich (Markt, Adresse, USt-ID) überspringen: Artikel beginnen mit der ersten Artikelzeile.
  const isItemStart = (row: string) => {
    const priced = splitPriceRow(row)
    if (priced) return lettersOf(priced.left) >= 3 && !isNoise(priced.left) && !qtyRowRe.test(row) && !/^(pfand|leergut)/.test(normalize(row))
    return Boolean(splitGarbledPrice(row, taxMode))
  }
  const start = body.findIndex(isItemStart)
  const region = start >= 0 ? body.slice(start) : body

  const found: Line[] = []
  const previousLine = () => found[found.length - 1]
  const push = (line: Omit<Line, 'id' | 'foodId'> & { foodId?: string }) => {
    const matched = line.name ? likelyFood(line.name, foods) : undefined
    found.push({ ...line, id: crypto.randomUUID(), name: matched?.name ?? line.name, foodId: line.foodId ?? matched?.id ?? '' })
  }
  const add = (rawName: string, rawPrice: string, rawQuantity = '', rawUnit = '') => {
    const name = cleanName(rawName.replace(/^\d+\s*[xX×]\s*/, '').replace(/\s+\*$/, ''))
    const letters = lettersOf(name)
    if (name.length < 3 || isNoise(name) || letters < 3 || letters / Math.max(1, name.length) < 0.35) return
    // Reste von Mengenzeilen („2 Stk x“, „Stk x“) sind keine Artikel.
    if (/^(?:\d+\s*)?(?:stk|stueck|stück)?\s*[x×]?$/i.test(name)) return
    const price = toNumber(rawPrice)
    if (!Number.isFinite(price) || price <= 0 || price > 500) return
    const norm = normalize(name)
    const likely = likelyFood(name, foods) ?? foods.find(f => {
      const foodName = normalize(f.name), tokens = norm.split(' ').filter(t => t.length > 3)
      return foodName.length > 4 && (norm.includes(foodName) || foodName.includes(norm) || tokens.filter(t => foodName.split(' ').includes(t)).length >= 2)
    })
    const pack = name.match(/(?:^|\s)(\d+(?:[,.]\d+)?)\s*(kg|g|mg|l|ml|stk|stück)\b/i)
    push({ name: likely?.name ?? name, foodId: likely?.id ?? '', price: formatPrice(price), quantity: rawQuantity || pack?.[1]?.replace('.', ',') || '', unit: rawUnit || pack?.[2]?.toLowerCase() || '', selected: true })
  }
  // „2 Stk x 0,39“ unter einem Artikel mit 0,78: Menge nur setzen, wenn die Rechnung aufgeht.
  // Fehlt der Preis des Artikels (unleserlich), ergibt er sich aus Menge × Einzelpreis.
  const applyQuantity = (qtyText: string, unitText: string) => {
    const previous = previousLine()
    const unit = toNumber(unitText)
    if (!previous || !Number.isFinite(unit) || unit <= 0) return false
    if (!previous.price) {
      const qty = toNumber(qtyText)
      if (previous.review !== 'price-missing' || !Number.isInteger(qty) || qty < 2 || qty > 20) return false
      previous.price = formatPrice(qty * unit); previous.quantity = qtyText; previous.unit = 'stk'; previous.selected = true
      previous.review = 'corrected'; previous.note = 'Preis unleserlich, aus der Mengenzeile berechnet: ' + qtyText + ' × ' + formatPrice(unit) + ' – bitte prüfen'
      return true
    }
    const total = toNumber(previous.price)
    const qty = qtyText ? toNumber(qtyText) : Math.round(total / unit)
    if (!Number.isFinite(qty) || qty < 1 || Math.abs(qty * unit - total) > 0.011) return false
    previous.quantity = String(qty).replace('.', ','); previous.unit = 'stk'
    return true
  }
  // „Knorr 25% 0,50“ ohne Minuszeichen ist trotzdem ein Rabatt – aber nur, wenn der Betrag zu 25 % des Artikels davor passt
  // (sonst ist es ein Artikel wie „Joghurt 10%“).
  const looksLikePercentDiscount = (left: string, price: string) => {
    const percent = left.match(percentRe), previous = previousLine()
    if (!percent || !previous?.price) return false
    const expected = formatPrice(Math.round(toNumber(previous.price) * Number(percent[1])) / 100)
    const amount = formatPrice(Math.abs(toNumber(price)))
    return amount === expected || oneDigitVariants(amount).includes(expected)
  }
  // Rabattzeile mindert den Preis des Artikels davor. Bei „25%“ wird der Betrag gegengerechnet.
  const applyDiscount = (amountText: string, label: string) => {
    const previous = previousLine()
    if (!previous || !previous.price) return
    let amount = Math.abs(toNumber(amountText))
    const percent = label.match(percentRe)
    if (percent) {
      const expected = Math.round(toNumber(previous.price) * Number(percent[1])) / 100
      if (Math.abs(expected - amount) > 0.005 && oneDigitVariants(formatPrice(amount)).includes(formatPrice(expected))) {
        previous.review = 'corrected'
        previous.note = 'Rabatt ' + percent[1] + ' %: gelesen −' + formatPrice(amount) + ', berechnet −' + formatPrice(expected) + ' – bitte prüfen'
        amount = expected
      }
    }
    const next = round2(toNumber(previous.price) - amount)
    if (next > 0) previous.price = formatPrice(next)
  }
  // Pfand ist kein Lebensmittel: eigene Zeile, standardmäßig nicht übernommen, zählt aber für die Summenkontrolle.
  const addDeposit = (rawPrice: string) => {
    const price = toNumber(rawPrice)
    if (!Number.isFinite(price) || price === 0 || Math.abs(price) > 50) return
    push({ name: 'Pfand', foodId: '', price: formatPrice(price), quantity: '', unit: '', selected: false })
  }
  const reviewLine = (name: string, review: LineReview, note: string, ocrPrice?: string) =>
    push({ name: cleanName(name), price: '', quantity: '', unit: '', selected: false, review, note, ocrPrice })

  let pendingText = '', pendingQuantity = ''
  // Reine Namenszeile ohne nachfolgende Preiszeile: sichtbar lassen statt still zu verlieren.
  const flushPending = () => {
    if (pendingText && looksLikeName(pendingText)) reviewLine(pendingText, 'price-missing', 'Kein Preis gelesen – bitte mit dem Bon vergleichen')
    pendingText = ''
  }
  for (const row of region) {
    if (!row) continue
    if (/^(pfand|leergut)/.test(normalize(row))) { flushPending(); const deposit = lastPrice(row); if (deposit) addDeposit(deposit); continue }
    const qtyRow = row.match(qtyRowRe)
    const priced = splitPriceRow(row)
    if (qtyRow && !(taxMode && priced?.tax)) {
      flushPending()
      const qtyText = (qtyRow[1] ?? '').replace('.', ',')
      // Penny/REWE drucken die Menge unter den Artikel; andere Märkte davor – die Rechnung entscheidet.
      if (!applyQuantity(qtyText, unitFromQtyRow(qtyRow[2])) && qtyText && !taxMode) pendingQuantity = qtyText
      continue
    }
    if (priced) {
      const { left, price } = priced
      const hasName = lettersOf(left) >= 2
      if (!hasName) {
        // Preis in eigener Zeile: gehört zum Namen aus der Zeile davor.
        if (pendingText && toNumber(price) > 0 && !isNoise(pendingText)) add(pendingText, price, pendingQuantity, pendingQuantity ? 'stk' : '')
        pendingText = ''; pendingQuantity = ''
        continue
      }
      flushPending()
      if (isNoise(left) || /\b(mwst|kartenzahlung|summe|gesamt)\b/i.test(left)) continue
      if (toNumber(price) < 0 || /rabatt|nachlass/i.test(left) || looksLikePercentDiscount(left, price)) { applyDiscount(price, left); continue }
      const inlineQty = left.match(/^(.+?)\s+(\d+(?:[,.]\d+)?)\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})$/i)
      if (inlineQty) { add(inlineQty[1], price, inlineQty[2], 'stk'); pendingQuantity = ''; continue }
      if (taxMode && !priced.tax) {
        reviewLine(left, 'doubtful', 'Gelesen: „' + row + '“ – vermutlich keine eigene Position (ohne Steuerklasse A/B)', formatPrice(toNumber(price)))
        continue
      }
      add(left, price, pendingQuantity, pendingQuantity ? 'stk' : '')
      pendingQuantity = ''
      continue
    }
    const garbled = splitGarbledPrice(row, taxMode)
    if (garbled) {
      flushPending()
      reviewLine(garbled.name, 'price-missing', 'Preis unleserlich (gelesen: „' + garbled.garbage + '“) – bitte vom Bon abtippen')
      continue
    }
    const namedQuantity = row.match(/^(.+?)\s+(\d+(?:[,.]\d+)?)\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})$/i)
    if (namedQuantity) { flushPending(); pendingText = cleanName(namedQuantity[1]); pendingQuantity = namedQuantity[2].replace('.', ','); continue }
    if (!isNoise(row) && /\p{L}/u.test(row)) {
      flushPending()
      // Namenszeile merken: der Preis kann in der nächsten Zeile stehen.
      pendingText = cleanName(row)
    }
  }
  flushPending()
  return found
}

// ---------------------------------------------------------------------------
// Mehrere OCR-Durchläufe zusammenführen und mit der Bon-Summe abgleichen.

const clone = (line: Line): Line => ({ ...line })
const priced = (line: Line) => Boolean(line.price) && Number.isFinite(toNumber(line.price))
const similarity = (a: Line, b: Line) => {
  const na = normalize(a.name), nb = normalize(b.name)
  if (!na || !nb) return 0
  return 1 - editDistance(na, nb) / Math.max(na.length, nb.length)
}
// Zeilen zweier Durchläufe in Bon-Reihenfolge einander zuordnen (wie ein Textvergleich), statt nur über den Namen.
function alignRuns(a: Line[], b: Line[]): [number, number][] {
  const score = (i: number, j: number) => {
    const s = similarity(a[i], b[j])
    const samePrice = priced(a[i]) && priced(b[j]) && a[i].price === b[j].price
    if (s >= 0.45 || (samePrice && s >= 0.3)) return s + (samePrice ? 0.3 : 0)
    return -1
  }
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const m = score(i - 1, j - 1)
    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], m > 0 ? dp[i - 1][j - 1] + m : -Infinity)
  }
  const pairs: [number, number][] = []
  for (let i = a.length, j = b.length; i > 0 && j > 0;) {
    const m = score(i - 1, j - 1)
    if (m > 0 && dp[i][j] === dp[i - 1][j - 1] + m) { pairs.unshift([i - 1, j - 1]); i--; j-- }
    else if (dp[i][j] === dp[i - 1][j]) i--
    else j--
  }
  return pairs
}

// Summe weicht ab: Zeilen markieren, bei denen eine einzige falsch gelesene Ziffer genau die Differenz erklären würde.
// Es wird nichts geändert – nur gezeigt, wo man zuerst nachsehen sollte (höchstens 4 Zeilen, sonst kein Hinweis).
function markSuspects(lines: Line[], diff: number) {
  const candidates = (allDigits: boolean) => {
    const found: { line: Line; guess: string }[] = []
    for (const line of lines) {
      if (!priced(line) || line.name === 'Pfand' || line.note) continue
      const target = formatPrice(round2(toNumber(line.price) - diff))
      const variants = allDigits
        ? [...line.price].flatMap((ch, i) => /\d/.test(ch) ? '0123456789'.split('').filter(d => d !== ch).map(d => line.price.slice(0, i) + d + line.price.slice(i + 1)) : [])
        : oneDigitVariants(line.price)
      if (toNumber(target) > 0 && variants.includes(target)) found.push({ line, guess: target })
    }
    return found
  }
  let suspects = candidates(false)
  if (!suspects.length || suspects.length > 4) suspects = candidates(true)
  if (!suspects.length || suspects.length > 4) return
  for (const { line, guess } of suspects) line.note = 'Könnte die Summen-Differenz erklären: vielleicht ' + guess + ' statt ' + line.price + ' – bitte mit dem Bon vergleichen'
}

export type CombinedReceipt = { lines: Line[]; summary: string }

export function combineReceiptRuns(runs: { label: string; lines: Line[] }[], total: number | null): CombinedReceipt {
  const usable = runs.filter(run => run.lines.length)
  if (!usable.length) return { lines: [], summary: 'keine Artikelzeilen erkannt' }
  const pricedCount = (lines: Line[]) => lines.filter(priced).length
  const finish = (lines: Line[], summary: string): CombinedReceipt => {
    const check = checkReceiptTotal(lines, total)
    const derived = lines.some(line => line.review === 'derived')
    if (check.ok && !derived) {
      // Summe stimmt: unsichere Zusatzzeilen waren keine Positionen.
      lines = lines.filter(line => line.review !== 'doubtful' && line.review !== 'second-run')
      for (const line of lines) if (line.review === 'price-missing') line.note = 'Die Bon-Summe stimmt bereits ohne diese Zeile – vermutlich doppelt gelesen oder kein Artikel'
    } else if (!check.ok && check.diff !== null) markSuspects(lines, check.diff)
    return { lines, summary }
  }

  // 1) Ein einzelner Durchlauf trifft die Bon-Summe exakt: den nehmen.
  if (total !== null) {
    const exact = usable.filter(run => checkReceiptTotal(run.lines, total).ok).sort((a, b) => pricedCount(b.lines) - pricedCount(a.lines))[0]
    if (exact) return finish(exact.lines.map(clone), 'Summe stimmt im Lauf ' + exact.label)
  }

  // 2) Bester Durchlauf als Grundlage, die anderen Zeile für Zeile abgleichen.
  const ordered = [...usable].sort((a, b) => pricedCount(b.lines) - pricedCount(a.lines))
  const lines = ordered[0].lines.map(clone)
  const alternatives = new Map<Line, Set<string>>()
  for (const other of ordered.slice(1)) {
    const pairs = alignRuns(lines, other.lines)
    const baseLines = [...lines]
    const matchedOther = new Set(pairs.map(([, j]) => j))
    for (const [i, j] of pairs) {
      const base = lines[i], line = other.lines[j]
      if (!priced(line) || line.review === 'doubtful') continue
      if (!priced(base) && (base.review === 'price-missing' || !base.review)) {
        base.price = line.price; base.selected = true; base.review = undefined
        base.note = 'Preis aus dem zweiten Lesedurchgang übernommen'
        if (line.quantity && !base.quantity) { base.quantity = line.quantity; base.unit = line.unit }
      } else if (priced(base) && base.price !== line.price && base.review !== 'doubtful') {
        const set = alternatives.get(base) ?? new Set<string>()
        set.add(line.price); alternatives.set(base, set)
      }
    }
    // Nur im anderen Durchlauf gelesene Positionen: als Prüfzeile an passender Stelle einfügen, nicht doppelt zählen.
    let insertAt = 0
    other.lines.forEach((line, j) => {
      const pair = pairs.find(([, pj]) => pj === j)
      if (pair) { insertAt = lines.indexOf(baseLines[pair[0]]) + 1; return }
      if (matchedOther.has(j) || !priced(line) || line.review === 'doubtful' || line.name === 'Pfand') return
      lines.splice(insertAt, 0, { ...line, id: crypto.randomUUID(), price: '', selected: false, review: 'second-run', ocrPrice: line.price, note: 'Nur im zweiten Lesedurchgang gelesen (' + line.price + ') – bitte prüfen' })
      insertAt++
    })
  }
  if (total === null) return finish(lines, 'Bon-Summe nicht lesbar, Durchläufe abgeglichen')
  if (checkReceiptTotal(lines, total).ok) return finish(lines, 'Summe stimmt nach Abgleich der Lesedurchgänge')

  // 3) Abweichende Preise / unsichere Zusatzzeilen so wählen, dass die Bon-Summe genau aufgeht.
  type Choice = { line: Line; options: { price: string; include: boolean }[] }
  const choices: Choice[] = []
  for (const [line, set] of alternatives) choices.push({ line, options: [{ price: line.price, include: true }, ...[...set].map(price => ({ price, include: true }))] })
  for (const line of lines) if ((line.review === 'doubtful' || line.review === 'second-run') && line.ocrPrice) choices.push({ line, options: [{ price: '', include: false }, { price: line.ocrPrice, include: true }] })
  const base = checkReceiptTotal(lines, total).itemsTotal
  if (choices.length && choices.length <= 12) {
    let best: { picks: number[]; changes: number }[] = []
    const picks = new Array<number>(choices.length).fill(0)
    const visit = (k: number, sum: number, changes: number) => {
      if (k === choices.length) {
        if (Math.abs(round2(sum) - total) < 0.005) {
          if (!best.length || changes < best[0].changes) best = [{ picks: [...picks], changes }]
          else if (changes === best[0].changes) best.push({ picks: [...picks], changes })
        }
        return
      }
      const choice = choices[k], current = toNumber(choice.line.price) || 0
      choice.options.forEach((option, index) => {
        picks[k] = index
        visit(k + 1, sum - current + (toNumber(option.price) || 0), changes + (index ? 1 : 0))
      })
    }
    visit(0, base, 0)
    if (best.length === 1 && best[0].changes > 0) {
      best[0].picks.forEach((index, k) => {
        if (!index) return
        const { line, options } = choices[k]
        line.price = options[index].price; line.selected = true; line.review = 'corrected'
        line.note = 'Durch die Bon-Summe bestätigt (anderer Lesedurchgang) – bitte prüfen'
      })
      return finish(lines, 'Summe stimmt nach Abgleich der Lesedurchgänge')
    }
  }

  // 4) Genau eine Position ohne lesbaren Preis: Preis = Bon-Summe minus alle anderen.
  const missing = lines.filter(line => line.review === 'price-missing' && !priced(line))
  if (missing.length === 1) {
    const derived = round2(total - base)
    if (derived >= 0.01 && derived <= 100) {
      const line = missing[0]
      line.price = formatPrice(derived); line.selected = true; line.review = 'derived'
      line.note = 'Preis unleserlich – aus der Bon-Summe berechnet. Bitte mit dem Bon vergleichen'
      return finish(lines, 'Summe stimmt, ein Preis aus der Bon-Summe berechnet')
    }
  }
  return finish(lines, 'Summe weicht ab – Positionen mit Hinweis prüfen')
}
