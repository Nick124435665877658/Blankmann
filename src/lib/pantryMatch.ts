// „Was kochen?“ (0.3.50, Nick 23.11.2026): eigene Rezepte gegen den Vorrat abgleichen.
// Regeln (Nick): Grundausstattung (Salz, Öl, Gewürze …) zählt als vorhanden; wo die Einheiten zusammenpassen,
// wird geprüft, ob die Menge reicht (g ≈ ml und Löffel werden wie bei der Preisschätzung umgerechnet).
// Optionale Zutaten zählen nicht. Bald Ablaufendes (MHD bis `soon`) wird gemerkt und bevorzugt.
import { approxAmount, baseKey, toBase } from './kitchen.ts'

export type MatchFood = { id: string; name: string; is_staple?: boolean | null }
export type MatchPantry = { food_item_id: string | null; name: string; quantity: number | string | null; unit: string | null; best_before: string | null }
export type MatchIngredient = { food_item_id: string | null; name: string; quantity: number | string | null; unit: string | null; is_optional?: boolean | null }
export type MissingLine = { name: string; foodId: string | null; quantity: number | null; unit: string | null; short: boolean }
export type RecipeMatch = { have: number; total: number; share: number; complete: boolean; missing: MissingLine[]; expiringUsed: string[] }

const num = (value: number | string | null | undefined) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
const round = (value: number) => Math.round(value * 100) / 100

export function matchRecipeToPantry(ingredients: MatchIngredient[], pantry: MatchPantry[], foods: MatchFood[], soon: string): RecipeMatch {
  const stapleIds = new Set(foods.filter(f => f.is_staple).map(f => f.id))
  const stapleKeys = new Set(foods.filter(f => f.is_staple).map(f => baseKey(f.name)))
  const lines = ingredients.filter(i => !i.is_optional)
  const missing: MissingLine[] = []
  const expiring = new Set<string>()
  let have = 0
  for (const line of lines) {
    const key = baseKey(line.name)
    if ((line.food_item_id && stapleIds.has(line.food_item_id)) || stapleKeys.has(key)) { have++; continue }
    const stock = pantry.filter(p => ((line.food_item_id && p.food_item_id === line.food_item_id) || baseKey(p.name) === key) && (num(p.quantity) === null || num(p.quantity)! > 0))
    const need = num(line.quantity)
    if (!stock.length) { missing.push({ name: line.name, foodId: line.food_item_id, quantity: need, unit: line.unit, short: false }); continue }
    // Menge prüfen: Vorrat je Grundeinheit aufsummieren, Bedarf in diese Einheit umrechnen.
    if (need !== null && need > 0) {
      const totals = new Map<string, number>()
      for (const p of stock) { const q = num(p.quantity); if (q === null) continue; const b = toBase(q, p.unit); totals.set(b.base, (totals.get(b.base) ?? 0) + b.quantity) }
      const untracked = stock.some(p => num(p.quantity) === null)
      let enough = true
      let shortInRecipeUnit: number | null = null
      for (const [base, total] of totals) {
        const needed = approxAmount(need, line.unit, base)
        if (needed === null || needed <= 0) continue
        enough = total + 1e-9 >= needed
        if (enough) break
        shortInRecipeUnit = (needed - total) * (need / needed)
      }
      if (!enough && !untracked && shortInRecipeUnit !== null) {
        missing.push({ name: line.name, foodId: line.food_item_id, quantity: round(shortInRecipeUnit), unit: line.unit, short: true })
        continue
      }
    }
    have++
    for (const p of stock) if (p.best_before && p.best_before <= soon) expiring.add(p.name)
  }
  const total = lines.length
  return { have, total, share: total ? have / total : 0, complete: total > 0 && missing.length === 0, missing, expiringUsed: [...expiring] }
}

// Reihenfolge: am meisten da → nutzt bald Ablaufendes → eigene Bewertung → Titel.
export function compareMatches(a: { match: RecipeMatch; rating: number | null; title: string }, b: { match: RecipeMatch; rating: number | null; title: string }) {
  return b.match.share - a.match.share
    || a.match.missing.length - b.match.missing.length
    || b.match.expiringUsed.length - a.match.expiringUsed.length
    || (b.rating ?? -1) - (a.rating ?? -1)
    || a.title.localeCompare(b.title, 'de')
}
