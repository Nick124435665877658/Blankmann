import { CookingPot } from 'lucide-react'
import { isThermomix } from '../lib/recipeAi'
import { formatScore, healthClass } from '../lib/health'

// Eine Rezeptzeile wie in der Rezeptliste: Foto, Abzeichen (Thermomix, Histamin, Bewertung) und Eckdaten.
// 0.3.56 (Nick, ruhigere Optik): Abzeichen dezent und kurz („TM“, „★ 9,5“); farbig nur Histamin, wenn es kritisch ist.
// 0.3.57: Gesundheitswert „♥ 6,4“ (fest berechnet) und Histamin mit Nachkommastelle; rot nur, wenn kritisch.
// Wird in der Rezeptliste und in der Rezept-Auswahl im Wochenplan genutzt, damit beide dieselben Infos zeigen.
export type SummaryRecipe = {
  title: string
  description: string | null
  source_type?: string | null
  servings: number
  prep_minutes: number | null
  cook_minutes: number | null
  histamine_score?: number | null
  histamine_note?: string | null
  rating?: number | null
  category?: string | null
  recipe_ingredients?: unknown[]
}

export const recipeMinutes = (recipe: { prep_minutes: number | null; cook_minutes: number | null }) =>
  recipe.prep_minutes || recipe.cook_minutes ? Number(recipe.prep_minutes || 0) + Number(recipe.cook_minutes || 0) : null

export const recipeListName = (recipe: { description: string | null; source_type?: string | null }) =>
  (isThermomix(recipe) ? recipe.description?.replace(/^Thermomix · /, '') : recipe.description) || 'Eigenes Rezept'

const histamineClass = (score: number) => 'badge histamine h' + (score >= 7 ? 'good' : score >= 4 ? 'mid' : 'bad')

export default function RecipeSummary({ recipe, photoUrl, costText, health = null }: { recipe: SummaryRecipe; photoUrl?: string; costText: string; health?: number | null }) {
  const minutes = recipeMinutes(recipe)
  // Bei Thermomix-Rezepten mit Gruppe ist die Cookidoo-Liste doppelt – dann nur Gruppe als Abzeichen.
  const info = [isThermomix(recipe) && recipe.category ? '' : recipeListName(recipe), recipe.servings + ' Portionen', (recipe.recipe_ingredients || []).length + ' Zutaten', minutes ? '⏱ ' + minutes + ' Min' : '', costText].filter(Boolean).join(' · ')
  return <>
    {photoUrl ? <img className="recipe-thumb" src={photoUrl} alt={'Foto von ' + recipe.title} loading="lazy" decoding="async" referrerPolicy="no-referrer"/> : <div className="pantry-icon"><CookingPot size={18}/></div>}
    <div className="pantry-name">
      <b>{recipe.title}</b>
      <span className="recipe-badges">
        {recipe.category && <span className="badge group" title="Gruppe">{recipe.category}</span>}
        {isThermomix(recipe) && <span className="badge thermomix" title="Thermomix-Rezept aus Cookidoo" aria-label="Thermomix">TM</span>}
        {health !== null ? <span className={'badge health h' + healthClass(health)} title="Gesundheitswert (Nährwerte nach BLS 4.0, Nutri-Score und DGE)">♥ {formatScore(health)}/10</span> : null}
        {recipe.histamine_score ? <span className={histamineClass(Number(recipe.histamine_score))} title={recipe.histamine_note || 'KI-Schätzung'}>Histamin {formatScore(Number(recipe.histamine_score))}/10</span> : null}
        {recipe.rating != null ? <span className="badge rating" title="Bewertung von 10">★ {String(Number(recipe.rating)).replace('.', ',')}</span> : null}
      </span>
      <small>{info}</small>
    </div>
  </>
}
