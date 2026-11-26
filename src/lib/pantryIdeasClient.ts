// „Was kochen?“ (0.3.50): KI-Ideen holen und auf Wunsch als Rezept speichern.
import { supabase } from './supabase'
import { baseKey } from './kitchen'
import { guessCategory } from './categories'
import type { IdeaCourse, PantryIdea } from './pantryIdeas'
import { HISTAMINE_VERSION } from './recipeAi'

export async function fetchPantryIdeas(householdId: string, accessToken: string, courses: IdeaCourse[]): Promise<PantryIdea[]> {
  const response = await fetch('/api/pantry-ideas', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify({ householdId, courses }) })
  const body = (await response.json().catch(() => ({}))) as { ideas?: PantryIdea[]; error?: string }
  if (!response.ok || !body.ideas) throw new Error(body.error || 'Die KI-Ideen konnten nicht geladen werden (' + response.status + ').')
  return body.ideas
}

// 0.3.52: Bild-Adressen von Cookidoo-Rezeptseiten (höchstens 8 je Aufruf); images[id] = null → kein Bild gefunden.
export async function fetchCookidooImages(recipeIds: string[], accessToken: string): Promise<{ images: Record<string, string | null>; blocked: number }> {
  const response = await fetch('/api/cookidoo-image', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify({ recipeIds }) })
  const body = (await response.json().catch(() => ({}))) as { images?: Record<string, string | null>; blocked?: number; error?: string }
  if (!response.ok || !body.images) throw new Error(body.error || 'Cookidoo-Bilder konnten nicht geladen werden (' + response.status + ').')
  return { images: body.images, blocked: body.blocked ?? 0 }
}

type FoodRow = { id: string; name: string; normalized_name: string; category: string }

// Legt das Gericht in der Rezeptliste an; Zutaten werden dem Katalog zugeordnet, Unbekanntes wird angelegt (wie bei KI-Ergänzungen).
export async function saveIdeaAsRecipe(idea: PantryIdea, householdId: string, userId: string): Promise<string> {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  const created = await supabase.from('recipes').insert({
    household_id: householdId, title: idea.title, description: idea.description, source_type: 'manual', servings: idea.servings,
    prep_minutes: idea.prepMinutes, cook_minutes: idea.cookMinutes, instructions: idea.steps, notes: 'KI-Idee aus dem Vorrat („Was kochen?“)',
    category: idea.group, histamine_score: idea.histamine.score, histamine_note: idea.histamine.note, histamine_version: idea.histamine.score === null ? null : HISTAMINE_VERSION, created_by: userId,
  }).select('id').single()
  if (created.error || !created.data) throw new Error('Rezept konnte nicht gespeichert werden: ' + (created.error?.message ?? 'unbekannter Fehler'))
  const recipeId = (created.data as { id: string }).id
  const foodRows = await supabase.from('household_foods').select('id,name,normalized_name,category').eq('household_id', householdId)
  if (foodRows.error) throw new Error('Nahrungsmittel konnten nicht geladen werden: ' + foodRows.error.message)
  const foods = (foodRows.data ?? []) as FoodRow[]
  for (const item of idea.ingredients) {
    let food = foods.find(f => baseKey(f.name) === baseKey(item.name) || baseKey(f.normalized_name) === baseKey(item.name))
    if (!food) {
      const normalized = item.name.toLocaleLowerCase('de-DE').trim()
      const inserted = await supabase.from('household_foods').insert({ household_id: householdId, name: item.name, normalized_name: normalized, category: guessCategory(item.name), default_unit: item.unit, notes: 'Von der KI für eine Rezeptidee angelegt', source_name: 'KI' }).select('id,name,normalized_name,category').single()
      if (inserted.error) {
        const again = await supabase.from('household_foods').select('id,name,normalized_name,category').eq('household_id', householdId).eq('normalized_name', normalized).maybeSingle()
        if (again.error || !again.data) throw new Error('„' + item.name + '“ konnte nicht im Nahrungsmittel-Katalog angelegt werden: ' + inserted.error.message)
        food = again.data as FoodRow
      } else food = inserted.data as FoodRow
      foods.push(food)
    }
    const row = await supabase.from('recipe_ingredients').insert({ household_id: householdId, recipe_id: recipeId, food_item_id: food.id, name: food.name, normalized_name: food.normalized_name, quantity: item.quantity, unit: item.unit, aisle: food.category, is_optional: false, source_text: item.name, ai_added: true })
    if (row.error) throw new Error('Zutat „' + food.name + '“ konnte nicht gespeichert werden: ' + row.error.message)
  }
  return recipeId
}
