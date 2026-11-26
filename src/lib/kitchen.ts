// Küchenlogik ohne Browser/Datenbank: Einheiten, Preisschätzung, Vorrat ergänzen und abziehen.
// Testbar mit: npm run test:kitchen (scripts/check-kitchen.ts)

export type PriceRow = { food_item_id: string; price_eur: number; package_quantity: number | null; package_unit: string | null; unit_price_eur: number | null; unit_label: string | null; observed_at: string; retailer_code?: string | null; is_organic?: boolean | null }
export type FoodRef = { id: string; name: string; normalized_name: string; default_unit: string | null; is_staple?: boolean | null; category?: string | null }
export type IngredientRef = { name: string; food_item_id: string | null; quantity: number | null; unit: string | null; is_optional?: boolean; ai_added?: boolean | null; aisle?: string | null }
export type PantryRow = { id: string; name: string; quantity: number | null; unit: string | null; food_item_id?: string | null; best_before?: string | null; is_organic?: boolean | null }

const keyOf = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()
const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits

// ---------------------------------------------------------------- Bio
// „Bio“ ist kein eigenes Nahrungsmittel, sondern ein Merkmal: „BIO EIER 6ER“ → Grundname „EIER 6ER“ + Bio.
// Erkannt werden „Bio“/„Öko“ als eigenes Wort, mit Bindestrich („Bio-Eier“), als Vorsilbe („Biomilch“)
// und die Bio-Siegel Bioland, Demeter und Naturland.
const organicWord = /^(?:bio|oeko|öko|biologisch|oekologisch|ökologisch|bioland|demeter|naturland)$/i
const organicCompoundExceptions = /^(?:biotin|biotta|biologie|bioethanol)/i
export function splitOrganic(name: string): { base: string; organic: boolean } {
  let organic = false
  const words = name.trim().split(/\s+/).flatMap(word => {
    const hyphen = word.match(/^(bio|öko|oeko)-(.+)$/i)
    if (hyphen) { organic = true; return [hyphen[2]] }
    if (organicWord.test(word.replace(/[.,:;]+$/, ''))) { organic = true; return [] }
    const compound = word.match(/^(bio)(\p{L}{4,})$/iu)
    if (compound && !organicCompoundExceptions.test(word)) { organic = true; const rest = compound[2]; return [word === word.toUpperCase() ? rest : rest.charAt(0).toUpperCase() + rest.slice(1)] }
    return [word]
  })
  const base = words.join(' ').replace(/^[-–\s]+|[-–\s]+$/g, '').trim()
  return base ? { base, organic } : { base: name.trim(), organic: false }
}
// Schlüssel zum Vergleichen von Namen: ohne Bio, ohne Groß/Klein, Umlaute ausgeschrieben.
export const baseKey = (name: string) => keyOf(splitOrganic(name).base)

// ---------------------------------------------------------------- Einheiten
// Grundeinheiten: g (Masse), ml (Volumen), stk (Stück). Andere Einheiten (Bund, EL, Kopf …) bleiben eigene Einheiten.
const units: Record<string, { base: string; factor: number }> = {
  mg: { base: 'g', factor: 0.001 }, g: { base: 'g', factor: 1 }, gr: { base: 'g', factor: 1 }, gramm: { base: 'g', factor: 1 }, kg: { base: 'g', factor: 1000 }, kilo: { base: 'g', factor: 1000 }, kilogramm: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 }, cl: { base: 'ml', factor: 10 }, dl: { base: 'ml', factor: 100 }, l: { base: 'ml', factor: 1000 }, liter: { base: 'ml', factor: 1000 },
  '': { base: 'stk', factor: 1 }, stk: { base: 'stk', factor: 1 }, st: { base: 'stk', factor: 1 }, stueck: { base: 'stk', factor: 1 }, stuck: { base: 'stk', factor: 1 }, x: { base: 'stk', factor: 1 },
  el: { base: 'el', factor: 1 }, essloeffel: { base: 'el', factor: 1 }, tl: { base: 'tl', factor: 1 }, teeloeffel: { base: 'tl', factor: 1 },
  bund: { base: 'bund', factor: 1 }, kopf: { base: 'kopf', factor: 1 }, 'kleiner kopf': { base: 'kopf', factor: 1 }, knolle: { base: 'knolle', factor: 1 },
  packung: { base: 'packung', factor: 1 }, pck: { base: 'packung', factor: 1 }, pk: { base: 'packung', factor: 1 }, dose: { base: 'dose', factor: 1 }, zehe: { base: 'zehe', factor: 1 }, prise: { base: 'prise', factor: 1 },
}
export function normalizeUnit(unit: string | null | undefined) {
  const key = keyOf(unit ?? '').replace(/^liter bruehe$/, 'liter')
  return units[key] ?? { base: key, factor: 1 }
}
export const toBase = (quantity: number, unit: string | null | undefined) => { const u = normalizeUnit(unit); return { quantity: quantity * u.factor, base: u.base } }
export const fromBase = (quantity: number, unit: string | null | undefined) => quantity / normalizeUnit(unit).factor
export const sameKind = (a: string | null | undefined, b: string | null | undefined) => normalizeUnit(a).base === normalizeUnit(b).base
// Mengen anzeigen (0.3.49, Nick): Komma statt Punkt, große g/ml-Mengen als kg/l, Löffel/Stück in Vierteln (¼ ½ ¾).
// shop: kaufgerecht runden (ab 100 g/ml auf 10). Rezepte bleiben genau (125 g bleibt 125 g).
const quarters: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' }
export function niceAmount(quantity: number | string | null | undefined, unit: string | null | undefined, options: { shop?: boolean } = {}): string {
  if (quantity === null || quantity === undefined || quantity === '' || !Number.isFinite(Number(quantity))) return ''
  const q = Number(quantity), u = (unit ?? '').trim(), key = keyOf(u)
  const num = (n: number, digits: number) => n.toLocaleString('de-DE', { maximumFractionDigits: digits })
  const withUnit = (text: string, label = u) => label ? text + ' ' + label : text
  if (key === 'g' || key === 'gramm' || key === 'ml') {
    if (q >= 1000) return withUnit(num(q / 1000, 2), key === 'ml' ? 'l' : 'kg')
    if (options.shop && q >= 100) return withUnit(num(Math.round(q / 10) * 10, 0))
    return withUnit(num(q >= 10 ? Math.round(q) : q, 1))
  }
  if (key === 'kg' || key === 'l' || key === 'liter') return withUnit(num(q, 2))
  if (q >= 10) return withUnit(num(q, 1))
  const whole = Math.floor(q), rest = Math.round((q - whole) * 4) / 4
  if (rest === 1) return withUnit(String(whole + 1))
  if (rest === 0) return withUnit(whole ? String(whole) : num(q, 2))
  return withUnit((whole ? String(whole) : '') + quarters[String(rest)])
}

export function formatAmount(quantity: number | null, unit: string | null) {
  if (quantity === null) return 'Menge offen'
  return String(round(quantity, 2)).replace('.', ',') + (unit ? ' ' + unit : '')
}

// ---------------------------------------------------------------- Preise
export function findFood(ref: { food_item_id: string | null; name: string }, foods: FoodRef[]) {
  if (ref.food_item_id) { const byId = foods.find(f => f.id === ref.food_item_id); if (byId) return byId }
  const key = keyOf(ref.name), base = baseKey(ref.name)
  return foods.find(f => keyOf(f.normalized_name) === key || keyOf(f.name) === key) ?? foods.find(f => baseKey(f.name) === base || baseKey(f.normalized_name) === base)
}
export type PriceOptions = { preferOrganic?: boolean }
// Preise eines Nahrungsmittels für die Schätzung: je Supermarkt (und Bio/normal) der neueste Eintrag.
// „Bio bevorzugen“ an → Bio-Preise, sonst normale; fehlt die gewünschte Sorte, zählt die andere.
export function pricesForFood(foodId: string, prices: PriceRow[], options: PriceOptions = {}) {
  const newest = new Map<string, PriceRow>()
  for (const row of prices) {
    if (row.food_item_id !== foodId) continue
    const key = (row.retailer_code ?? '') + '|' + (row.is_organic ? 'bio' : 'normal')
    const known = newest.get(key)
    if (!known || String(row.observed_at) > String(known.observed_at)) newest.set(key, row)
  }
  const all = [...newest.values()]
  const organic = all.filter(r => r.is_organic), regular = all.filter(r => !r.is_organic)
  const wanted = options.preferOrganic ? organic : regular
  return wanted.length ? wanted : options.preferOrganic ? regular : organic
}

export type CostBasis = 'exact' | 'package' | 'missing'
export type CostLine = { name: string; foodId: string | null; quantity: number | null; unit: string | null; cost: number | null; basis: CostBasis; hint: string; markets: number; organic: boolean }

// Ungefähre Umrechnung nur für die Preisschätzung (nicht für Vorrat oder Einkaufsliste):
// Löffel, Prise, Messerspitze und Spritzer → g bzw. ml; g ↔ ml im Verhältnis 1 : 1 (Cookidoo gibt Flüssigkeiten oft in g an).
// Werte sind Durchschnitte: 1 TL ≈ 3 g / 5 ml, 1 EL ≈ 10 g / 15 ml, 1 Prise ≈ 0,5 g, 1 Messerspitze ≈ 0,3 g, 1 Spritzer ≈ 2 ml.
const approxGrams: Record<string, number> = { tl: 3, el: 10, prise: 0.5, messerspitze: 0.3, spritzer: 2 }
const approxMl: Record<string, number> = { tl: 5, el: 15, prise: 0.5, messerspitze: 0.3, spritzer: 2 }
export function approxAmount(quantity: number, unit: string | null | undefined, target: string): number | null {
  const need = toBase(quantity, unit)
  if (need.base === target) return need.quantity
  if ((need.base === 'g' && target === 'ml') || (need.base === 'ml' && target === 'g')) return need.quantity
  const per = target === 'g' ? approxGrams[need.base] : target === 'ml' ? approxMl[need.base] : undefined
  return per ? need.quantity * per : null
}

// Kosten einer Menge mit genau einem Preis-Eintrag.
// assumed: Preis ohne Packungsgröße wird als Stückpreis gerechnet (z. B. „Gurke 0,69“ vom Bon) – zählt nur, wenn kein genauerer Preis da ist.
function costWithPrice(ref: { quantity: number | null; unit: string | null }, price: PriceRow): { cost: number; basis: 'exact' | 'package'; hint: string; assumed?: boolean } {
  const packagePrice = Number(price.price_eur)
  if (ref.quantity === null || !(ref.quantity > 0)) return { cost: packagePrice, basis: 'package', hint: 'Menge offen – eine Packung angesetzt' }
  const need = toBase(ref.quantity, ref.unit)
  if (price.package_quantity && price.package_quantity > 0) {
    const pack = toBase(Number(price.package_quantity), price.package_unit)
    const amount = pack.quantity > 0 ? approxAmount(ref.quantity, ref.unit, pack.base) : null
    if (amount !== null) return { cost: packagePrice * amount / pack.quantity, basis: 'exact', hint: '' }
  }
  if (price.unit_price_eur && price.unit_label) {
    const perBase = /kg/i.test(price.unit_label) ? { base: 'g', per: 1000 } : /\bl\b|liter/i.test(price.unit_label) ? { base: 'ml', per: 1000 } : null
    const amount = perBase ? approxAmount(ref.quantity, ref.unit, perBase.base) : null
    if (perBase && amount !== null) return { cost: Number(price.unit_price_eur) * amount / perBase.per, basis: 'exact', hint: '' }
  }
  if (need.base === 'stk' && (!price.package_quantity || normalizeUnit(price.package_unit).base === 'stk')) {
    const assumed = !(Number(price.package_quantity) > 0)
    return { cost: packagePrice / Number(price.package_quantity || 1) * need.quantity, basis: 'exact', hint: assumed ? 'Packungsgröße fehlt – als Stückpreis gerechnet' : '', assumed }
  }
  return { cost: packagePrice, basis: 'package', hint: 'Einheit passt nicht zum Preis – eine Packung angesetzt' }
}

// Geschätzter Einkaufswert einer Menge eines Nahrungsmittels: Mittelwert über die Supermärkte (je Markt ein Preis).
// exact: Menge lässt sich mit dem Preis verrechnen. package: ganze Packung angesetzt (Menge offen oder Einheit passt nicht). missing: kein Preis.
export function estimateCost(ref: { name: string; food_item_id: string | null; quantity: number | null; unit: string | null }, foods: FoodRef[], prices: PriceRow[], options: PriceOptions = {}): CostLine {
  const food = findFood(ref, foods)
  const base = { name: ref.name, foodId: food?.id ?? null, quantity: ref.quantity, unit: ref.unit }
  const rows = food ? pricesForFood(food.id, prices, options) : []
  if (!rows.length) return { ...base, cost: null, basis: 'missing', hint: 'Preis fehlt', markets: 0, organic: false }
  const results = rows.map(row => costWithPrice(ref, row))
  // Stückpreise ohne Packungsgröße (z. B. Eier 3,99 vom Bon ohne Stückzahl) fallen raus, sobald ein genauerer Preis da ist.
  const exactAll = results.filter(r => r.basis === 'exact')
  const sure = exactAll.filter(r => !r.assumed)
  const exact = sure.length ? sure : exactAll
  const skipped = exactAll.length - exact.length
  const used = exact.length ? exact : results
  const cost = used.reduce((sum, r) => sum + r.cost, 0) / used.length
  const organic = Boolean(rows[0].is_organic)
  const hint = [exact.length ? (used.some(r => r.assumed) ? used.find(r => r.assumed)!.hint : '') : used[0].hint, used.length > 1 ? 'Ø aus ' + used.length + ' Märkten' : '', skipped ? skipped + (skipped === 1 ? ' Preis' : ' Preise') + ' ohne Packungsgröße nicht eingerechnet' : '', organic ? 'Bio-Preis' : ''].filter(Boolean).join(' · ')
  return { ...base, cost, basis: exact.length ? 'exact' : 'package', hint, markets: used.length, organic }
}

export type RecipeCost = { total: number; lines: CostLine[]; missing: CostLine[]; approximate: boolean }
export function estimateRecipeCost(recipe: { servings: number; recipe_ingredients?: IngredientRef[] }, servings: number, foods: FoodRef[], prices: PriceRow[], options: PriceOptions = {}): RecipeCost {
  const factor = Number(servings || recipe.servings || 1) / Math.max(1, Number(recipe.servings || 1))
  const lines = (recipe.recipe_ingredients ?? []).filter(i => !i.is_optional).map(i =>
    estimateCost({ name: i.name, food_item_id: i.food_item_id, quantity: i.quantity === null ? null : Number(i.quantity) * factor, unit: i.unit }, foods, prices, options))
  const total = lines.reduce((sum, line) => sum + (line.cost ?? 0), 0)
  return { total: round(total, 2), lines, missing: lines.filter(l => l.basis === 'missing'), approximate: lines.some(l => l.basis !== 'exact') }
}

// Manuell eingegebener Preis → Datensatz für household_food_prices (€/kg bzw. €/l zusätzlich, wenn möglich).
export function manualPriceRow(price: number, quantity: number | null, unit: string | null) {
  const pack = quantity && quantity > 0 ? toBase(quantity, unit) : null
  const unitPrice = pack && pack.quantity > 0 && (pack.base === 'g' || pack.base === 'ml') ? round(price / pack.quantity * 1000, 4) : null
  return { price_eur: round(price, 2), package_quantity: quantity && quantity > 0 ? quantity : null, package_unit: unit || null, unit_price_eur: unitPrice, unit_label: unitPrice === null ? null : pack!.base === 'g' ? '€/kg' : '€/l' }
}

// „Auf 1 Stk runterrechnen“: nur bei Stückzahlen über 1 (Stk, Packung, Dose …), nicht bei g/ml.
export function canSplitToOne(quantity: number | null, unit: string | null) {
  if (quantity === null || !(quantity > 1)) return false
  const base = normalizeUnit(unit).base
  return base !== 'g' && base !== 'ml'
}
// 2 Stk für 3,00 € → 1 Stk für 1,50 €. Ohne Einheit gilt „Stk“.
export function splitToOne(price: number, quantity: number, unit: string | null) {
  return { price: round(price / quantity, 2), quantity: 1, unit: unit || 'Stk' }
}

// ---------------------------------------------------------------- Vorrat
// Bio und normal zählen als dasselbe Nahrungsmittel („Bio Eier“ deckt „Eier“).
const matchesFood = (row: PantryRow, need: { name: string; foodId: string | null }) =>
  Boolean(need.foodId && row.food_item_id === need.foodId) || keyOf(row.name) === keyOf(need.name) || baseKey(row.name) === baseKey(need.name)

// Menge, die ein Bon-Artikel dem Vorrat hinzufügt. „2 Stk“ Butter mit bekannter Packung 250 g → 500 g.
export function pantryAmountFromReceipt(line: { quantity: number | null; unit: string | null }, packageInfo?: { package_quantity: number | null; package_unit: string | null }) {
  const pq = packageInfo?.package_quantity && Number(packageInfo.package_quantity) > 0 ? Number(packageInfo.package_quantity) : null
  const pu = packageInfo?.package_unit || 'Stk'
  if (line.quantity && line.quantity > 0) {
    // „2 Stk“ auf dem Bon = 2 Packungen; mit bekannter Packungsgröße in deren Einheit umrechnen.
    if (normalizeUnit(line.unit).base === 'stk' && pq) return { quantity: round(line.quantity * pq), unit: pu }
    return { quantity: line.quantity, unit: line.unit || 'Stk' }
  }
  if (pq) return { quantity: pq, unit: pu }
  return { quantity: 1, unit: 'Stk' }
}

// Bon-Artikel in den Vorrat: passende Zeile (gleiches Nahrungsmittel, umrechenbare Einheit) aufstocken, sonst neu anlegen.
// Bio und normal bekommen getrennte Vorratszeilen (Anzeige „Bio“), beim Kochen zählen beide.
export function planPantryAddition(pantry: PantryRow[], item: { name: string; foodId: string | null; quantity: number; unit: string | null; organic?: boolean }) {
  const row = pantry.find(r => matchesFood(r, item) && Boolean(r.is_organic) === Boolean(item.organic) && r.quantity !== null && sameKind(r.unit, item.unit))
  if (row) return { update: { id: row.id, quantity: round(Number(row.quantity) + fromBase(toBase(item.quantity, item.unit).quantity, row.unit)) } }
  return { insert: { name: item.name, food_item_id: item.foodId, quantity: round(item.quantity), unit: item.unit, is_organic: Boolean(item.organic) } }
}

export type Need = { name: string; foodId: string | null; quantity: number | null; unit: string | null; aisle?: string | null }
export type DeductionPlan = {
  updates: { id: string; quantity: number }[]
  deletes: string[]
  used: string[]        // vollständig aus dem Vorrat genommen
  partial: string[]     // nur teilweise im Vorrat
  missing: string[]     // gar nicht im Vorrat
  unconvertible: string[] // im Vorrat, aber Einheit/Menge nicht verrechenbar
}
// „Gekocht“: Zutaten vom Vorrat abziehen. Älteste Mindesthaltbarkeit zuerst. Ein Rest bleibt im Vorrat.
export function planPantryDeduction(needs: Need[], pantry: PantryRow[]): DeductionPlan {
  const left = new Map(pantry.map(row => [row.id, row.quantity === null ? null : Number(row.quantity)]))
  const plan: DeductionPlan = { updates: [], deletes: [], used: [], partial: [], missing: [], unconvertible: [] }
  for (const need of needs) {
    const label = need.name + (need.quantity !== null ? ' (' + formatAmount(need.quantity, need.unit) + ')' : '')
    const rows = pantry.filter(row => matchesFood(row, need)).sort((a, b) => (a.best_before ?? '9999').localeCompare(b.best_before ?? '9999'))
    if (!rows.length) { plan.missing.push(label); continue }
    const convertible = rows.filter(row => left.get(row.id) !== null && sameKind(row.unit, need.unit))
    if (need.quantity === null || !convertible.length) { plan.unconvertible.push(label); continue }
    let open = toBase(need.quantity, need.unit).quantity
    for (const row of convertible) {
      if (open <= 1e-9) break
      const available = toBase(left.get(row.id) ?? 0, row.unit).quantity
      const take = Math.min(available, open)
      open -= take
      left.set(row.id, fromBase(available - take, row.unit))
    }
    if (open > 1e-9) plan.partial.push(label); else plan.used.push(label)
  }
  for (const row of pantry) {
    const before = row.quantity === null ? null : Number(row.quantity)
    const after = left.get(row.id)
    if (before === null || after === null || after === undefined || Math.abs(after - before) < 1e-9) continue
    if (after <= 1e-6) plan.deletes.push(row.id)
    else plan.updates.push({ id: row.id, quantity: round(after) })
  }
  return plan
}

// Bedarf eines Rezepts für eine Portionenzahl (optionale Zutaten ausgenommen).
export function recipeNeeds(recipe: { servings: number; recipe_ingredients?: IngredientRef[] }, servings: number): Need[] {
  const factor = Number(servings || recipe.servings || 1) / Math.max(1, Number(recipe.servings || 1))
  return (recipe.recipe_ingredients ?? []).filter(i => !i.is_optional).map(i => ({ name: i.name, foodId: i.food_item_id, quantity: i.quantity === null ? null : round(Number(i.quantity) * factor), unit: i.unit, ...(i.aisle ? { aisle: i.aisle } : {}) }))
}

// 0.3.62 (Nick 26.11.2026): Beim Kochen bleiben Grundausstattung, Kräuter & Gewürze und Öle & Saucen unberührt –
// davon ist nach einem Rezept fast immer noch etwas da. Gruppe zuerst aus dem Katalog, sonst die der Zutat.
export const untouchedCategories = ['Kräuter & Gewürze', 'Öle & Saucen']
export function planCooking(needs: Need[], pantry: PantryRow[], foods: FoodRef[]): DeductionPlan & { kept: string[] } {
  const foodFor = (need: Need) => foods.find(f => f.id === need.foodId) ?? foods.find(f => baseKey(f.name) === baseKey(need.name))
  const isKept = (need: Need) => {
    const food = foodFor(need)
    return Boolean(food?.is_staple) || untouchedCategories.includes(food?.category || need.aisle || '')
  }
  return { ...planPantryDeduction(needs.filter(need => !isKept(need)), pantry), kept: needs.filter(isKept).map(need => need.name) }
}

// Platzhaltertexte aus dem Import gelten nicht als Anleitung.
export function instructionSteps(value: unknown): string[] {
  const steps = Array.isArray(value) ? value.map(step => typeof step === 'string' ? step : typeof step === 'object' && step && 'text' in step ? String((step as { text: unknown }).text) : '').map(s => s.trim()).filter(Boolean) : []
  if (steps.length === 1 && /^zubereitung und genaue mengen noch ergänzen/i.test(steps[0])) return []
  return steps
}

// Vorrat bearbeiten (0.3.53, Nick): Schrittweite für − / + – Stück/Packung 1, g/ml 50 (ab 1 kg / 1 l: 100), kg/l 0,1.
export function pantryStep(unit: string | null | undefined, quantity: number | null | undefined): number {
  const key = keyOf(unit ?? '')
  if (key === 'g' || key === 'gramm' || key === 'ml') return (quantity ?? 0) >= 1000 ? 100 : 50
  if (key === 'kg' || key === 'l' || key === 'liter') return 0.1
  return 1
}
