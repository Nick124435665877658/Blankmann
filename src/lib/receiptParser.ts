// Auswertung von OCR-Text/Wortpositionen eines Kassenbons.
// Aus ReceiptScanner.tsx ausgelagert, damit der Parser ohne Browser testbar ist (scripts/check-receipt-parser.ts).

export type Food = { id: string; name: string; normalized_name: string; category: string; default_unit: string | null }
export type Line = { id: string; name: string; price: string; foodId: string; quantity: string; unit: string; selected: boolean }
export type OCRWord = { text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

export const normalize = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]+/g,' ').replace(/\s+/g,' ').trim()
export function editDistance(a:string,b:string){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const current=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=current}}return row[b.length]}
export function likelyFood(name:string,foods:Food[]){const n=normalize(name);const exact=foods.find(f=>normalize(f.name)===n||normalize(f.normalized_name)===n);if(exact)return exact;return foods.find(f=>{const target=normalize(f.name);if(!target||Math.abs(target.length-n.length)>2)return false;return editDistance(n,target)<=Math.max(1,Math.floor(Math.min(n.length,target.length)*0.16))})}

const toNumber = (value: string) => Number(value.replace(',', '.'))
const formatPrice = (value: number) => value.toFixed(2).replace('.', ',')
// OCR liest Preise oft als „2, 38“ oder „16, 84“ – das Leerzeichen nach dem Komma entfernen.
const tidyPrices = (value: string) => value.replace(/(\d[,.])\s+(\d{2})(?!\d)/g, '$1$2')
const lastPrice = (value: string) => { const all = [...value.matchAll(/(-?\d{1,4}[,.]\d{2})/g)]; return all.length ? all[all.length - 1][1] : null }
const isTotalText = (value: string) => /^(summe|gesamtsumme|gesamtbetrag|endsumme|zu zahlen|total)\b/.test(normalize(value))
// „2 Stk x 0,39“, „2Stkx 0,39“ oder (bei verlorener Menge) „Stk x 0,59“: reine Mengenzeile ohne Artikelnamen.
const qtyLineRe = /^(\d+(?:[,.]\d+)?)?\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})(?:\s*[A-Z*]){0,2}$/i

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
  for (const row of groupRows(words)) {
    const rowText = rowTextOf(rowWordsOf(row))
    if (isTotalText(rowText)) { const price = lastPrice(rowText); if (price) return toNumber(price) }
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = tidyPrices(raw.replace(/\s+/g, ' ').trim())
    if (isTotalText(line)) { const price = lastPrice(line); if (price) return toNumber(price) }
  }
  return null
}

// Summenkontrolle: Summe aller erkannten Preise (auch Pfand und Rabatte) gegen die SUMME auf dem Bon.
export function checkReceiptTotal(lines: Line[], total: number | null) {
  const itemsTotal = Math.round(lines.reduce((sum, line) => sum + (toNumber(line.price) || 0), 0) * 100) / 100
  const diff = total === null ? null : Math.round((itemsTotal - total) * 100) / 100
  return { total, itemsTotal, diff, ok: diff !== null && Math.abs(diff) < 0.005 }
}

export function parseReceipt(text:string, foods:Food[], words:OCRWord[] = []):Line[] {
  const found:Line[]=[]
  // Mengen und Rabatte gehören zur Zeile davor – aber nur zu einer Zeile desselben Durchgangs (Wortpositionen oder Text).
  let pathStart=0
  const previousLine=()=>found.length>pathStart?found[found.length-1]:undefined
  const isNoise=(value:string)=>/^(summe|gesamt|zwischensumme|bar|ec|visa|mastercard|gegeben|geg|rueckgeld|wechselgeld|mwst|ust|steuer|netto|brutto|rabatt|ersparnis|kartenzahlung|kundennummer|kundenbeleg|girocard|contactless|datum|uhrzeit|beleg|trace|bon|kasse|bedienung|artikel|anzahl|eur|pfand|cent|betrag|zu zahlen|summe eur)\b/i.test(normalize(value))
  const cleanName=(raw:string)=>{
    let name=raw.replace(/[|_]+/g,' ').replace(/[“”„"'´]/g,' ').replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/\s+/g,' ').trim()
    name=name.replace(/\bkokosmi\s+lc\s+dad\s+ight(?:\s+.*)?$/i,'Kokosmilch Light')
    name=name.replace(/\bkokosmilch\s+d[a4]d?\s*l?i[gq]ht\b/i,'Kokosmilch Light')
    // Penny-/OCR-spezifische Korrekturen: nur eindeutige Artikelstämme normalisieren.
    if(/^bio\s+zucch/i.test(name)) name='Bio Zucchini'
    else if(/^bio\s+eier/i.test(name)||/^bid\s+eier/i.test(name)) name='Bio Eier'
    else if(/^milprima/i.test(name)) name='Milprima Butter'
    else if(/^kartof.*chips/i.test(name)||/^kartoffel.*chips/i.test(name)) name='Kartoffelchips'
    else if(/^knorr\s+krauter/i.test(normalize(name))) name='Knorr Kräuter'
    else if(/^knorr\s*26/i.test(name)) name='Knorr 26 %'
    else if(/^meersalz/i.test(name)) name='Meersalz Grob'
    return name
  }
  const add=(rawName:string, rawPrice:string, rawQuantity='', rawUnit='')=>{
    const name=cleanName(rawName.replace(/^\d+\s*[xX×]\s*/,'').replace(/\s+\*$/,''))
    const letters=(name.match(/[\p{L}]/gu)||[]).length
    if(name.length<3 || isNoise(name) || letters<3 || letters/Math.max(1,name.length)<0.35) return
    // Reste von Mengenzeilen („2 Stk x“, „Stk x“) sind keine Artikel.
    if(/^(?:\d+\s*)?(?:stk|stueck|stück)?\s*[x×]?$/i.test(name)) return
    // Only create a receipt position when this OCR row contains a real, parsed price.
    // Catalog matches are labels for detected receipt lines, never a source of new lines.
    if(!rawPrice) return
    const price=Number(rawPrice.replace(',','.'))
    if(!Number.isFinite(price)||price<=0||price>500) return
    const norm=normalize(name)
    const exact=likelyFood(name,foods)
    const likely=exact ?? foods.find(f=>{
      const foodName=normalize(f.name),tokens=norm.split(' ').filter(t=>t.length>3)
      return foodName.length>4&&(norm.includes(foodName)||foodName.includes(norm)||tokens.filter(t=>foodName.split(' ').includes(t)).length>=2)
    })
    const pack=name.match(/(?:^|\s)(\d+(?:[,.]\d+)?)\s*(kg|g|mg|l|ml|stk|stück)\b/i)
    found.push({id:crypto.randomUUID(),name:likely?.name??name,price:Number.isFinite(price)?price.toFixed(2).replace('.',','):'',foodId:likely?.id??'',quantity:rawQuantity||pack?.[1]?.replace('.',',')||'',unit:rawUnit||pack?.[2]?.toLowerCase()||'',selected:Number.isFinite(price)})
  }
  // „2 Stk x 0,39“ unter einem Artikel mit 0,78: Menge nur setzen, wenn die Rechnung aufgeht.
  const applyQuantity=(qty:string,unitPrice:string)=>{
    const previous=previousLine()
    if(!previous||!previous.price)return false
    const q=toNumber(qty),u=toNumber(unitPrice)
    if(!Number.isFinite(q)||!Number.isFinite(u)||q<=0)return false
    if(Math.abs(q*u-toNumber(previous.price))>0.011)return false
    previous.quantity=qty.replace('.',',');previous.unit='stk'
    return true
  }
  // Rabattzeile (negativer Betrag) mindert den Preis des Artikels davor.
  const applyDiscount=(amount:number)=>{
    const previous=previousLine()
    if(!previous||!previous.price)return false
    const next=toNumber(previous.price)+amount
    if(!(next>0))return false
    previous.price=formatPrice(next)
    return true
  }
  // Pfand ist kein Lebensmittel: eigene Zeile, standardmäßig nicht übernommen, zählt aber für die Summenkontrolle.
  const addDeposit=(rawPrice:string)=>{
    const price=toNumber(rawPrice)
    if(!Number.isFinite(price)||price===0||Math.abs(price)>50)return
    found.push({id:crypto.randomUUID(),name:'Pfand',price:formatPrice(price),foodId:'',quantity:'',unit:'',selected:false})
  }
  if(words.length){
    const rows=groupRows(words)
    // Alles ab der SUMME-Zeile (Zahlung, Datum, Belegnummer …) enthält keine Artikel.
    const totalIndex=rows.findIndex(row=>{const t=rowTextOf(rowWordsOf(row));return isTotalText(t)&&lastPrice(t)!==null})
    for(const row of totalIndex>=0?rows.slice(0,totalIndex):rows){
      const rowWords=rowWordsOf(row)
      const rowText=rowTextOf(rowWords)
      const qtyRow=rowText.match(qtyLineRe)
      if(qtyRow){if(qtyRow[1])applyQuantity(qtyRow[1],qtyRow[2]);continue}
      if(/^(pfand|leergut)/i.test(normalize(rowText))){const deposit=lastPrice(rowText);if(deposit)addDeposit(deposit);continue}
      const qtyPrice=rowText.match(/(.+?)\s+(\d+(?:[,.]\d+)?)\s*[x×]\s*(\d{1,4}[,.]\d{2})\s+(-?\d{1,4}[,.]\d{2})$/i)
      if(qtyPrice){add(qtyPrice[1],qtyPrice[4],qtyPrice[2],'stk');continue}
      const total=[...rowText.matchAll(/(-?\d{1,4}[,.]\d{2})/g)].pop()
      if(!total){
        // A name-only OCR row with its own word geometry is a real review candidate,
        // unlike a catalog word found somewhere in the whole OCR document.
        const candidate=cleanName(rowText)
        const letters=(candidate.match(/[\p{L}]/gu)||[]).length
        const confidence=rowWords.reduce((sum,w)=>sum+(w.confidence??0),0)/Math.max(1,rowWords.length)
        const matched=likelyFood(candidate,foods)
        const wordsCount=candidate.split(/\s+/).filter(Boolean).length
        const readable=letters/Math.max(1,candidate.length)>=0.62
        // Prüfzeilen nur behalten, wenn sie plausibel lesbar oder einem Katalogartikel zuordenbar sind.
        // Das verhindert, dass Fragmente aus mehreren OCR-Läufen als Dutzende Phantomartikel erscheinen.
        if(!isNoise(candidate)&&candidate.length>=5&&letters>=4&&wordsCount<=6&&
          (Boolean(matched)||(confidence>=60&&readable&&wordsCount<=4))){
          found.push({id:crypto.randomUUID(),name:matched?.name??candidate,price:'',foodId:matched?.id??'',quantity:'',unit:'',selected:false})
        }
        continue
      }
      const amount=total[1],amountIndex=rowText.lastIndexOf(amount),leftText=rowText.slice(0,amountIndex).trim()
      const qtyOnly=leftText.match(/(?:^|\s)(\d+(?:[,.]\d+)?)\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})$/i)
      if(qtyOnly){
        const previous=previousLine()
        if(previous){previous.quantity=qtyOnly[1].replace('.',',');previous.unit='stk';previous.price=amount.replace('.',',')}
        continue
      }
      if(toNumber(amount)<0){applyDiscount(toNumber(amount));continue}
      if(/rabatt|\d+%/i.test(leftText))continue
      const amountWord=rowWords.find(w=>w.text.includes(amount))
      const name=rowWords.filter(w=>!amountWord||w.bbox.x0<amountWord.bbox.x0).map(w=>w.text).join(' ').trim()||leftText
      if(name&&!isNoise(name))add(name,amount)
      else if(found.length&&toNumber(amount)>0){
        const previous=previousLine()
        if(previous&&!previous.price)previous.price=amount.replace('.',',')
      }
    }
  }
  pathStart=found.length
  const textLines=text.split(/\r?\n/).map(raw=>tidyPrices(raw.replace(/\s+/g,' ').trim()))
  const totalLineIndex=textLines.findIndex(line=>isTotalText(line)&&lastPrice(line)!==null)
  const itemLines=totalLineIndex>=0?textLines.slice(0,totalLineIndex):textLines
  let pendingText='',pendingQuantity=''
  for(const line of itemLines){
    if(!line)continue
    const qtyLine=line.match(qtyLineRe)
    if(qtyLine){
      // Penny/REWE drucken die Menge unter den Artikel; andere Märkte davor – die Rechnung entscheidet.
      if(qtyLine[1]&&!applyQuantity(qtyLine[1],qtyLine[2]))pendingQuantity=qtyLine[1].replace('.',',')
      continue
    }
    const namedQuantity=line.match(/^(.+?)\s+(\d+(?:[,.]\d+)?)\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})$/i)
    if(namedQuantity){pendingText=cleanName(namedQuantity[1]);pendingQuantity=namedQuantity[2].replace('.',',');continue}
    if(/^(pfand|leergut)/i.test(normalize(line))){const deposit=lastPrice(line);if(deposit)addDeposit(deposit);pendingText='';pendingQuantity='';continue}
    const match=line.match(/(.+?)\s+(-?\d{1,4}[,.]\d{2})(?:\s*[A-Z*]){0,2}\s*$/i)
    if(match){
      let name=match[1].trim()
      const inlineQty=name.match(/^(.+?)\s+(\d+(?:[,.]\d+)?)\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})$/i)
      if(inlineQty){add(inlineQty[1],match[2],inlineQty[2],'stk');pendingText='';pendingQuantity='';continue}
      const qty=name.match(/(\d+(?:[,.]\d+)?)\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})$/i)
      if(qty){
        const productName=name.slice(0,qty.index).trim()
        if(productName)add(productName,match[2],qty[1],'stk')
        else{const previous=previousLine();if(previous){previous.quantity=qty[1];previous.unit='stk';previous.price=match[2].replace('.',',')}}
        pendingText='';pendingQuantity='';continue
      }
      if(toNumber(match[2])<0){applyDiscount(toNumber(match[2]));pendingText='';pendingQuantity='';continue}
      if(/rabatt|pfand|summe|gesamt|mwst|kartenzahlung/i.test(name))continue
      if(!name||/^[\s|:;.-]*$/.test(name))name=pendingText
      if(name&&!isNoise(name))add(name,match[2],pendingQuantity,pendingQuantity?'stk':'')
      pendingText='';pendingQuantity=''
      continue
    }
    const priceOnly=line.match(/^[-|:; ]*(-?\d{1,4}[,.]\d{2})\s*(?:[A-Z*])?$/i)
    if(priceOnly&&pendingText){
      if(toNumber(priceOnly[1])>0&&!isNoise(pendingText))add(pendingText,priceOnly[1],pendingQuantity,pendingQuantity?'stk':'')
      pendingText='';pendingQuantity=''
      continue
    }
    if(!isNoise(line)&&/[\p{L}]/u.test(line)){
      // Keep a name-only line as context for a following price-only OCR line.
      // It is deliberately NOT emitted as an item unless a price is found.
      pendingText=cleanName(line)
    }
  }
  const pennyAliases:[RegExp,string][]=[
    [/^(?:bio\s+)?zucch/i,'Bio Zucchini'],
    [/^(?:bio\s+)?(?:bid|bio)\s+eier/i,'Bio Eier'],
    [/^milprima/i,'Milprima Butter'],
    [/^(?:kartof|kartoffel).*chips/i,'Kartoffelchips'],
    [/^meersalz/i,'Meersalz Grob'],
    [/^knorr\s+kra[u]?ter/i,'Knorr Kräuter'],
    [/^knorr\s*26/i,'Knorr 26 %'],
    [/^kokosmi/i,'Kokosmilch Light'],
  ]
  for(const raw of itemLines){
    const candidate=cleanName(raw.replace(/\d{1,4}[,.]\d{2}/g,' ').replace(/[^\p{L}\s-]/gu,' ').replace(/\s+/g,' ').trim())
    const alias=pennyAliases.find(([pattern])=>pattern.test(candidate))
    if(alias&&!found.some(line=>normalize(line.name)===normalize(alias[1]))){
      const matched=likelyFood(alias[1],foods)
      found.push({id:crypto.randomUUID(),name:matched?.name??alias[1],price:'',foodId:matched?.id??'',quantity:'',unit:'',selected:false})
    }
  }
  const unique:Line[]=[]
  for(const line of found){
    const key=normalize(line.name),existing=unique.findIndex(other=>normalize(other.name)===key)
    if(existing<0)unique.push(line)
    else if(!unique[existing].price&&line.price)unique[existing]=line
    else if(unique[existing].price&&line.price&&unique[existing].price===line.price){
      if(line.quantity){unique[existing].quantity=line.quantity;unique[existing].unit=line.unit}
    }else if(unique[existing].price&&line.price&&unique[existing].price!==line.price)unique.push(line)
  }
  return unique
}
