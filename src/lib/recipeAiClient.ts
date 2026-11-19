import { supabase } from './supabase'

// Ruft die KI-Funktion auf und speichert das Ergebnis:
// Anleitung (ersetzt die bisherige nur, wenn replaceSteps) und Mengen nur für Zutaten, die noch keine Menge haben.
// Von Hand eingetragene Mengen werden nie überschrieben.
export async function completeRecipeWithAi(recipeId: string, householdId: string, accessToken: string, replaceSteps: boolean): Promise<{ steps: number; quantities: number }> {
  if (!supabase) throw new Error('Keine Datenbankverbindung.')
  const response = await fetch('/api/recipe-instructions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken }, body: JSON.stringify({ recipeId }) })
  const body = await response.json().catch(() => null) as { steps?: string[]; quantities?: { id: string; quantity: number; unit: string | null }[]; error?: string } | null
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
  return { steps, quantities }
}
