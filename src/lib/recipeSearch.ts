// Suche in der Rezeptliste und in der Rezept-Auswahl im Wochenplan (0.3.58, Nick 24.11.2026).
// Sucht in Name, Cookidoo-Liste, Gruppe und Zutaten; Groß/klein und ä/ae/a egal; mehrere Wörter müssen alle passen („lachs reis“).
import { fold } from './foodSearch.ts'

export type SearchableRecipe = { title: string; description?: string | null; category?: string | null; recipe_ingredients?: { name: string }[] }

export function recipeMatches(recipe: SearchableRecipe, query: string): boolean {
  const words = query.split(/\s+/).map(w => w.trim()).filter(w => fold(w, 'ae'))
  if (!words.length) return true
  const texts = [recipe.title, recipe.description ?? '', recipe.category ?? '', ...(recipe.recipe_ingredients ?? []).map(i => i.name)]
  const hayAe = ' ' + texts.map(t => fold(t, 'ae')).join(' ') + ' '
  const hayA = ' ' + texts.map(t => fold(t, 'a')).join(' ') + ' '
  return words.every(word => {
    const ae = fold(word, 'ae'), a = fold(word, 'a')
    return hayAe.includes(ae) || hayA.includes(a)
  })
}
