// Wochenplan-Meldungen (0.3.53, Nick 23.11.2026): Was läuft in der geplanten Woche ab – und ist es schon eingeplant?
// „Eingeplant“ = ein Gericht (Zutat passt über Katalog-ID oder Namen) oder ein einzelnes Lebensmittel derselben Sorte
// liegt in dieser Woche an einem Tag bis einschließlich zum MHD (und nicht in der Vergangenheit). „Ganze Woche“-Einträge zählen auch.
import { baseKey } from './kitchen.ts'

export type ExpiryPantry = { id: string; name: string; quantity: number | string | null; best_before: string | null; food_item_id: string | null }
export type ExpiryMeal = { meal_date: string; meal_type: string; recipe_id: string | null; food_item_id: string | null; custom_title: string | null }
export type ExpiryIngredient = { food_item_id: string | null; name: string }
export type ExpiryNotice = { item: ExpiryPantry; date: string; expired: boolean; planned: { date: string; title: string } | null }

export function weekExpiries(pantry: ExpiryPantry[], meals: ExpiryMeal[], ingredientsOf: (recipeId: string) => ExpiryIngredient[], weekEnd: string, today: string): ExpiryNotice[] {
  const notices: ExpiryNotice[] = []
  for (const item of pantry) {
    if (!item.best_before || item.best_before > weekEnd) continue
    if (item.quantity !== null && item.quantity !== '' && Number(item.quantity) <= 0) continue
    const expired = item.best_before < today
    const key = baseKey(item.name)
    const uses = (meal: ExpiryMeal) => {
      if (item.food_item_id && meal.food_item_id === item.food_item_id) return true
      if (meal.food_item_id && !item.food_item_id && meal.custom_title && baseKey(meal.custom_title) === key) return true
      return Boolean(meal.recipe_id && ingredientsOf(meal.recipe_id).some(i => (item.food_item_id && i.food_item_id === item.food_item_id) || baseKey(i.name) === key))
    }
    const planned = expired ? undefined : meals
      .filter(m => (m.meal_type === 'week' || (m.meal_date >= today && m.meal_date <= item.best_before!)) && uses(m))
      .sort((a, b) => a.meal_date.localeCompare(b.meal_date))[0]
    notices.push({ item, date: item.best_before, expired, planned: planned ? { date: planned.meal_date, title: planned.custom_title || 'Gericht' } : null })
  }
  return notices.sort((a, b) => a.date.localeCompare(b.date) || a.item.name.localeCompare(b.item.name, 'de'))
}
