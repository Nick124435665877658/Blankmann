import { supabase } from './supabase'
import { baseKey } from './kitchen'
import { guessCategory } from './categories'

type Addition = { name: string; quantity: number | null; unit: string | null; staple: boolean }
export type AiResult = { steps: number; quantities: number; times: number; histamine: number | null; added: string[] }

// Ruft die KI-Funktion auf und speichert das Ergebnis:
// Anleitung (ersetzt die bisherige nur, wenn replaceSteps) und Mengen nur für Zutaten, die noch keine Menge haben.
// Von Hand eingetragene Mengen werden nie überschrieben.
// addIngredients (Standard: bei neuer Anleitung): zusätzliche Zutaten/Gewürze der KI ins Rezept schreiben – gekennzeichnet
// als „KI“, beim Bearbeiten wieder entfernbar. Unbekannte Zutaten kommen in den Nahrungsmittel-Katalog (Quelle „KI“),
// Salz, Öl, Gewürze & Co. als Grundausstattung.
export async function completeRecipeWithAi(recipeId: string, householdId: string, accessToken: string, replaceSteps: boolean, addIngredients = replaceSteps): Promise<AiResult> {
  if (!supabase) throw new Error('Keine Datenbankverbindung.')
  const response = await fetch('/api/recipe-instructions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify({ recipeId, addIngredients }) })
  const body = await response.json().catch(() => null) as { steps?: string[]; quantities?: { id: string; quantity: number; unit: string | null }[]; times?: { prepMinutes: number | null; cookMinutes: number | null }; histamine?: { score: number | null; note: string | null }; additions?: Addition[]; error?: string } | null
  if (!response.ok || !body?.steps?.length) throw new Error(body?.error || 'Die KI-Funktion ist nicht erreichbar (' + response.status + ').')
  let steps = 0
  if (replaceSteps) {
    const { error } = await supabase.from('recipes').update({ instructions: body.steps, updated_at: new Date().toISOString() }).eq('id', recipeId).eq('household_id', householdId)
    if (error) throw new Error('Anleitung konnte nicht gespeichert werden: ' + error.message)
    steps = body.steps.length
  }
  let quantities = 0
  for (const q of body.quantities ?? []) {
    const { data, error } = await supabase.from('recipe_ingredients').update({ quantity: q.quantity, unit: q.unit }).eq('id', q.id).eq('recipe_id', recipeId).eq('household_id', householdId).is('quantity', null).select('id')
    if (error) throw new Error('Mengen konnten nicht gespeichert werden: ' + error.message)
    quantities += (data ?? []).length
  }
  // Kochzeiten nur eintragen, wo noch keine stehen.
  let times = 0
  for (const [column, value] of [['prep_minutes', body.times?.prepMinutes], ['cook_minutes', body.times?.cookMinutes]] as const) {
    if (value === null || value === undefined) continue
    const { data, error } = await supabase.from('recipes').update({ [column]: value }).eq('id', recipeId).eq('household_id', householdId).is(column, null).select('id')
    if (error) throw new Error('Kochzeit konnte nicht gespeichert werden: ' + error.message)
    times += (data ?? []).length
  }
  // Histaminwert: bei neuer Anleitung oder neuen Zutaten neu bewerten (außer von Hand gesetzt), sonst nur eintragen, wo noch keiner steht.
  let histamine: number | null = null
  if (body.histamine?.score) {
    let query = supabase.from('recipes').update({ histamine_score: body.histamine.score, histamine_note: body.histamine.note }).eq('id', recipeId).eq('household_id', householdId)
    if (!replaceSteps && !(addIngredients && body.additions?.length)) query = query.is('histamine_score', null)
    // Von Hand gesetzte Histaminwerte überschreibt die KI nie.
    else query = query.or('histamine_note.is.null,histamine_note.neq."Von Hand gesetzt"')
    const { data, error } = await query.select('id')
    if (error) throw new Error('Histaminwert konnte nicht gespeichert werden: ' + error.message)
    if ((data ?? []).length) histamine = body.histamine.score
  }
  const added = addIngredients && body.additions?.length ? await saveAdditions(recipeId, householdId, body.additions) : []
  return { steps, quantities, times, histamine, added }
}

async function saveAdditions(recipeId: string, householdId: string, additions: Addition[]): Promise<string[]> {
  if (!supabase) return []
  const [foodRows, ingredientRows] = await Promise.all([
    supabase.from('household_foods').select('id,name,normalized_name,category').eq('household_id', householdId),
    supabase.from('recipe_ingredients').select('id,name,food_item_id').eq('recipe_id', recipeId).eq('household_id', householdId),
  ])
  if (foodRows.error) throw new Error('Nahrungsmittel konnten nicht geladen werden: ' + foodRows.error.message)
  if (ingredientRows.error) throw new Error('Zutaten konnten nicht geladen werden: ' + ingredientRows.error.message)
  const foods = (foodRows.data ?? []) as { id: string; name: string; normalized_name: string; category: string }[]
  const existing = (ingredientRows.data ?? []) as { id: string; name: string; food_item_id: string | null }[]
  const added: string[] = []
  for (const item of additions) {
    let food = foods.find(f => baseKey(f.name) === baseKey(item.name) || baseKey(f.normalized_name) === baseKey(item.name))
    if (!food) {
      const normalized = item.name.toLocaleLowerCase('de-DE').trim()
      const created = await supabase.from('household_foods').insert({ household_id: householdId, name: item.name, normalized_name: normalized, category: guessCategory(item.name, item.staple), default_unit: item.unit, notes: 'Von der KI für ein Rezept ergänzt', source_name: 'KI', is_staple: item.staple }).select('id,name,normalized_name,category').single()
      if (created.error) {
        // Gleicher Name in anderer Schreibweise schon im Katalog → diesen nehmen.
        const again = await supabase.from('household_foods').select('id,name,normalized_name,category').eq('household_id', householdId).eq('normalized_name', normalized).maybeSingle()
        if (again.error || !again.data) throw new Error('„' + item.name + '“ konnte nicht im Nahrungsmittel-Katalog angelegt werden: ' + created.error.message)
        food = again.data as typeof foods[number]
      } else food = created.data as typeof foods[number]
      foods.push(food)
    }
    if (existing.some(i => i.food_item_id === food!.id || baseKey(i.name) === baseKey(food!.name))) continue
    const inserted = await supabase.from('recipe_ingredients').insert({ household_id: householdId, recipe_id: recipeId, food_item_id: food.id, name: food.name, normalized_name: food.normalized_name, quantity: item.quantity, unit: item.unit, aisle: food.category, is_optional: false, source_text: 'KI ergänzt', ai_added: true }).select('id,name,food_item_id').single()
    if (inserted.error) throw new Error('Zutat „' + food.name + '“ konnte nicht ergänzt werden: ' + inserted.error.message)
    existing.push(inserted.data as typeof existing[number])
    added.push(food.name)
  }
  return added
}
