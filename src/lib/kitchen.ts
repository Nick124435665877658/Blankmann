// Küchenlogik ohne Browser/Datenbank: Einheiten, Preisschätzung, Vorrat ergänzen und abziehen.
// Testbar mit: npm run test:kitchen (scripts/check-kitchen.ts)

export type PriceRow = { food_item_id: string; price_eur: number; package_quantity: number | null; package_unit: string | null; unit_price_eur: number | null; unit_label: string | null; observed_at: string }
export type FoodRef = { id: string; name: string; normalized_name: string; default_unit: string | null }
export type IngredientRef = { name: string; food_item_id: string | null; quantity: number | null; unit: string | null; is_optional?: boolean }
export type PantryRow = { id: string; name: string; quantity: number | null; unit: string | null; food_item_id?: string | null; best_before?: string | null }

const keyOf = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()
const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits

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
export function formatAmount(quantity: number | null, unit: string | null) {
  if (quantity === null) return 'Menge offen'
  return String(round(quantity, 2)).replace('.', ',') + (unit ? ' ' + unit : '')
}

// ---------------------------------------------------------------- Preise
export function findFood(ref: { food_item_id: string | null; name: string }, foods: FoodRef[]) {
  if (ref.food_item_id) { const byId = foods.find(f => f.id === ref.food_item_id); if (byId) return byId }
  const key = keyOf(ref.name)
  return foods.find(f => keyOf(f.normalized_name) === key || keyOf(f.name) === key)
}
// Preise kommen sortiert (neueste zuerst). Der neueste Preis eines Nahrungsmittels gilt.
export const latestPrice = (foodId: string, prices: PriceRow[]) => prices.find(p => p.food_item_id === foodId)

export type CostBasis = 'exact' | 'package' | 'missing'
export type CostLine = { name: string; foodId: string | null; quantity: number | null; unit: string | null; cost: number | null; basis: CostBasis; hint: string }

// Geschätzter Einkaufswert einer Menge eines Nahrungsmittels.
// exact: Menge lässt sich mit dem Preis verrechnen. package: ganze Packung angesetzt (Menge offen oder Einheit passt nicht). missing: kein Preis.
export function estimateCost(ref: { name: string; food_item_id: string | null; quantity: number | null; unit: string | null }, foods: FoodRef[], prices: PriceRow[]): CostLine {
  const food = findFood(ref, foods)
  const base = { name: ref.name, foodId: food?.id ?? null, quantity: ref.quantity, unit: ref.unit }
  const price = food ? latestPrice(food.id, prices) : undefined
  if (!price) return { ...base, cost: null, basis: 'missing', hint: 'Preis fehlt' }
  const packagePrice = Number(price.price_eur)
  if (ref.quantity === null || !(ref.quantity > 0)) return { ...base, cost: packagePrice, basis: 'package', hint: 'Menge offen – eine Packung angesetzt' }
  const need = toBase(ref.quantity, ref.unit)
  if (price.package_quantity && price.package_quantity > 0) {
    const pack = toBase(Number(price.package_quantity), price.package_unit)
    if (pack.base === need.base && pack.quantity > 0) return { ...base, cost: packagePrice * need.quantity / pack.quantity, basis: 'exact', hint: '' }
  }
  if (price.unit_price_eur && price.unit_label) {
    const perBase = /kg/i.test(price.unit_label) ? { base: 'g', per: 1000 } : /\bl\b|liter/i.test(price.unit_label) ? { base: 'ml', per: 1000 } : null
    if (perBase && perBase.base === need.base) return { ...base, cost: Number(price.unit_price_eur) * need.quantity / perBase.per, basis: 'exact', hint: '' }
  }
  if (need.base === 'stk' && (!price.package_quantity || normalizeUnit(price.package_unit).base === 'stk')) {
    return { ...base, cost: packagePrice / Number(price.package_quantity || 1) * need.quantity, basis: 'exact', hint: '' }
  }
  return { ...base, cost: packagePrice, basis: 'package', hint: 'Einheit passt nicht zum Preis – eine Packung angesetzt' }
}

export type RecipeCost = { total: number; lines: CostLine[]; missing: CostLine[]; approximate: boolean }
export function estimateRecipeCost(recipe: { servings: number; recipe_ingredients?: IngredientRef[] }, servings: number, foods: FoodRef[], prices: PriceRow[]): RecipeCost {
  const factor = Number(servings || recipe.servings || 1) / Math.max(1, Number(recipe.servings || 1))
  const lines = (recipe.recipe_ingredients ?? []).filter(i => !i.is_optional).map(i =>
    estimateCost({ name: i.name, food_item_id: i.food_item_id, quantity: i.quantity === null ? null : Number(i.quantity) * factor, unit: i.unit }, foods, prices))
  const total = lines.reduce((sum, line) => sum + (line.cost ?? 0), 0)
  return { total: round(total, 2), lines, missing: lines.filter(l => l.basis === 'missing'), approximate: lines.some(l => l.basis !== 'exact') }
}

// Manuell eingegebener Preis → Datensatz für household_food_prices (€/kg bzw. €/l zusätzlich, wenn möglich).
export function manualPriceRow(price: number, quantity: number | null, unit: string | null) {
  const pack = quantity && quantity > 0 ? toBase(quantity, unit) : null
  const unitPrice = pack && pack.quantity > 0 && (pack.base === 'g' || pack.base === 'ml') ? round(price / pack.quantity * 1000, 4) : null
  return { price_eur: round(price, 2), package_quantity: quantity && quantity > 0 ? quantity : null, package_unit: unit || null, unit_price_eur: unitPrice, unit_label: unitPrice === null ? null : pack!.base === 'g' ? '€/kg' : '€/l' }
}

// ---------------------------------------------------------------- Vorrat
const matchesFood = (row: PantryRow, need: { name: string; foodId: string | null }) =>
  (need.foodId && row.food_item_id === need.foodId) || keyOf(row.name) === keyOf(need.name)

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
export function planPantryAddition(pantry: PantryRow[], item: { name: string; foodId: string | null; quantity: number; unit: string | null }) {
  const row = pantry.find(r => matchesFood(r, item) && r.quantity !== null && sameKind(r.unit, item.unit))
  if (row) return { update: { id: row.id, quantity: round(Number(row.quantity) + fromBase(toBase(item.quantity, item.unit).quantity, row.unit)) } }
  return { insert: { name: item.name, food_item_id: item.foodId, quantity: round(item.quantity), unit: item.unit } }
}

export type Need = { name: string; foodId: string | null; quantity: number | null; unit: string | null }
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
  return (recipe.recipe_ingredients ?? []).filter(i => !i.is_optional).map(i => ({ name: i.name, foodId: i.food_item_id, quantity: i.quantity === null ? null : round(Number(i.quantity) * factor), unit: i.unit }))
}

// Platzhaltertexte aus dem Import gelten nicht als Anleitung.
export function instructionSteps(value: unknown): string[] {
  const steps = Array.isArray(value) ? value.map(step => typeof step === 'string' ? step : typeof step === 'object' && step && 'text' in step ? String((step as { text: unknown }).text) : '').map(s => s.trim()).filter(Boolean) : []
  if (steps.length === 1 && /^zubereitung und genaue mengen noch ergänzen/i.test(steps[0])) return []
  return steps
}
