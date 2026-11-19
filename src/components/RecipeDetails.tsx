import { useMemo, useState } from 'react'
import { BookOpen, Check, ChefHat, LoaderCircle, Sparkles, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { estimateRecipeCost, formatAmount, instructionSteps, planPantryDeduction, recipeNeeds, type DeductionPlan, type FoodRef, type IngredientRef, type PantryRow, type PriceRow } from '../lib/kitchen'
import ManualPriceForm from './ManualPriceForm'
import { completeRecipeWithAi } from '../lib/recipeAiClient'

export type DetailsRecipe = { id: string; title: string; description: string | null; servings: number; prep_minutes: number | null; cook_minutes: number | null; instructions?: unknown; recipe_ingredients?: IngredientRef[] }
export type DetailsMeal = { id: string; servings: number; cooked_at: string | null; meal_date: string }

const euro = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n)

// Rezept öffnen: Zutaten mit geschätztem Einkaufswert, KI-Kochanleitung und „Gekocht“ (zieht die Zutaten vom Vorrat ab).
export default function RecipeDetails({ recipe, meal, foods, prices, pantry, householdId, accessToken, onChanged, onClose, onNotice, onError }: {
  recipe: DetailsRecipe; meal: DetailsMeal | null; foods: FoodRef[]; prices: PriceRow[]; pantry: PantryRow[]; householdId: string; accessToken: string
  onChanged: () => Promise<void>; onClose: () => void; onNotice: (message: string) => void; onError: (message: string) => void
}) {
  const servings = Number(meal?.servings || recipe.servings || 2)
  const cost = useMemo(() => estimateRecipeCost(recipe, servings, foods, prices), [recipe, servings, foods, prices])
  const steps = instructionSteps(recipe.instructions)
  const [busy, setBusy] = useState<'' | 'ai' | 'save' | 'cook'>('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [cooked, setCooked] = useState<DeductionPlan | null>(null)

  async function saveSteps(next: string[]) {
    if (!supabase) return false
    const { error } = await supabase.from('recipes').update({ instructions: next, updated_at: new Date().toISOString() }).eq('id', recipe.id).eq('household_id', householdId)
    if (error) { onError('Anleitung konnte nicht gespeichert werden: ' + error.message); return false }
    await onChanged()
    return true
  }
  const missingQuantities = (recipe.recipe_ingredients ?? []).filter(i => i.quantity === null).length
  const missingTimes = recipe.prep_minutes === null || recipe.cook_minutes === null
  const timeText = [recipe.prep_minutes !== null ? 'Vorbereitung ' + recipe.prep_minutes + ' Min' : '', recipe.cook_minutes !== null ? 'Kochen ' + recipe.cook_minutes + ' Min' : ''].filter(Boolean).join(' · ')
  // KI: Anleitung erzeugen und fehlende Mengen ergänzen. Vorhandene Anleitung nur nach Rückfrage ersetzen.
  async function generate(replaceSteps: boolean) {
    if (replaceSteps && steps.length && !window.confirm('Sicher, dass du die bisherige Anleitung von „' + recipe.title + '“ durch eine neue KI-Anleitung ersetzen willst?')) return
    setBusy('ai')
    try {
      const result = await completeRecipeWithAi(recipe.id, householdId, accessToken, replaceSteps)
      await onChanged()
      onNotice('KI für „' + recipe.title + '“: ' + ([result.steps ? 'Anleitung mit ' + result.steps + ' Schritten erstellt' : '', result.quantities ? result.quantities + ' fehlende Mengen ergänzt' : '', result.times ? 'Kochzeit eingetragen' : ''].filter(Boolean).join(', ') || 'nichts mehr zu ergänzen') + '. Du kannst alles bearbeiten.')
    } catch (error) { onError(error instanceof Error ? error.message : 'Die KI konnte das Rezept nicht ergänzen.') }
    finally { setBusy('') }
  }
  async function saveEdit() {
    const next = draft.split(/\r?\n/).map(line => line.replace(/^\s*\d{1,2}\s*[.)]\s*/, '').trim()).filter(Boolean)
    setBusy('save')
    if (await saveSteps(next)) { setEditing(false); onNotice('Anleitung gespeichert.') }
    setBusy('')
  }
  async function markCooked() {
    if (!supabase) return
    if (!window.confirm('„' + recipe.title + '“ als gekocht markieren? Die Zutaten für ' + String(servings).replace('.', ',') + ' Portionen werden vom Vorrat abgezogen; ein Rest bleibt im Vorrat.')) return
    setBusy('cook')
    const plan = planPantryDeduction(recipeNeeds(recipe, servings), pantry)
    try {
      for (const update of plan.updates) {
        const { error } = await supabase.from('pantry_items').update({ quantity: update.quantity, updated_at: new Date().toISOString() }).eq('id', update.id).eq('household_id', householdId)
        if (error) throw error
      }
      if (plan.deletes.length) {
        const { error } = await supabase.from('pantry_items').delete().in('id', plan.deletes).eq('household_id', householdId)
        if (error) throw error
      }
      if (meal) {
        const { error } = await supabase.from('meal_plan_entries').update({ cooked_at: new Date().toISOString() }).eq('id', meal.id).eq('household_id', householdId)
        if (error) throw error
      }
      setCooked(plan)
      onNotice('„' + recipe.title + '“ als gekocht markiert, Vorrat aktualisiert.')
      await onChanged()
    } catch (error) { onError('Vorrat konnte nicht vollständig aktualisiert werden: ' + (error instanceof Error ? error.message : String(error))) }
    finally { setBusy('') }
  }

  const missingFoods = cost.lines.filter(line => line.basis === 'missing')
  return <div className="panel recipe-details">
    <div className="panel-head"><div><span className="eyebrow">{meal ? 'GEPLANTES GERICHT · ' + new Date(meal.meal_date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' }) : 'REZEPT'}</span><h2>{recipe.title}</h2><small className="muted">{String(servings).replace('.', ',')} Portionen · geschätzter Einkaufswert ≈ {euro(cost.total)}{missingFoods.length ? ' · ' + missingFoods.length + ' Preis(e) fehlen' : ''}{cost.approximate && !missingFoods.length ? ' · teils Packungspreise' : ''}{timeText ? ' · ⏱ ' + timeText : ''}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="Schließen"><X size={18} /></button></div>

    <span className="eyebrow">ZUTATEN & EINKAUFSWERT</span>
    {cost.lines.length ? cost.lines.map((line, index) => <div className="cost-line" key={line.name + index}>
      <div><b>{line.name}</b><small>{formatAmount(line.quantity, line.unit)}{line.hint && line.basis !== 'missing' ? ' · ' + line.hint : ''}</small>
        {line.basis === 'missing' && <ManualPriceForm householdId={householdId} foodId={line.foodId} foodName={line.name} defaultQuantity={line.quantity} defaultUnit={line.unit} onSaved={onChanged} onError={onError} />}</div>
      <strong>{line.cost === null ? 'Preis fehlt' : '≈ ' + euro(line.cost)}</strong>
    </div>) : <p className="muted">Für dieses Rezept sind noch keine Zutaten hinterlegt.</p>}

    <div style={{ marginTop: 18 }}><span className="eyebrow">KOCHANLEITUNG</span></div>
    {editing ? <div className="instructions-edit">
      <textarea value={draft} onChange={e => setDraft(e.target.value)} aria-label="Anleitung bearbeiten, ein Schritt pro Zeile" />
      <small className="muted">Ein Schritt pro Zeile.</small>
      <div className="details-actions"><button type="button" className="button button-dark" disabled={busy !== ''} onClick={saveEdit}>Anleitung speichern</button><button type="button" className="button button-light" onClick={() => setEditing(false)}>Abbrechen</button></div>
    </div> : steps.length ? <ol className="recipe-steps">{steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      : <p className="muted">Noch keine Anleitung. Die KI erstellt sie aus den Zutaten und ergänzt fehlende Mengen – kostenlos über Cloudflare. Von dir eingetragene Mengen bleiben unverändert.</p>}
    {!editing && <div className="details-actions">
      {(!steps.length || missingQuantities > 0 || missingTimes) && <button type="button" className="button button-dark" disabled={busy !== ''} onClick={() => generate(!steps.length)}>{busy === 'ai' ? <LoaderCircle size={16} /> : <Sparkles size={16} />} {busy === 'ai' ? 'KI schreibt …' : 'Mit KI ergänzen: ' + [!steps.length ? 'Anleitung' : '', missingQuantities ? missingQuantities + ' Mengen' : '', missingTimes ? 'Kochzeit' : ''].filter(Boolean).join(' + ')}</button>}
      {steps.length > 0 && <button type="button" className="button button-light" disabled={busy !== ''} onClick={() => generate(true)}><Sparkles size={16} /> Anleitung neu erzeugen</button>}
      <button type="button" className="button button-light" disabled={busy !== ''} onClick={() => { setDraft(steps.map((s, i) => (i + 1) + '. ' + s).join('\n')); setEditing(true) }}><BookOpen size={16} /> {steps.length ? 'Bearbeiten' : 'Selbst schreiben'}</button>
    </div>}

    <div style={{ marginTop: 18 }}><span className="eyebrow">GEKOCHT?</span></div>
    {meal?.cooked_at && !cooked ? <div className="alert success"><Check size={16} />Schon als gekocht markiert am {new Date(meal.cooked_at).toLocaleDateString('de-DE')} – der Vorrat wurde bereits abgezogen.</div>
      : cooked ? <div className="notice-card"><Check size={18} /><span>
        {cooked.used.length ? 'Vom Vorrat abgezogen: ' + cooked.used.join(', ') + '. ' : ''}
        {cooked.partial.length ? 'Nur teilweise im Vorrat: ' + cooked.partial.join(', ') + '. ' : ''}
        {cooked.missing.length ? 'Nicht im Vorrat: ' + cooked.missing.join(', ') + '. ' : ''}
        {cooked.unconvertible.length ? 'Im Vorrat, aber Menge/Einheit nicht verrechenbar (bitte im Vorrat selbst anpassen): ' + cooked.unconvertible.join(', ') + '.' : ''}
      </span></div>
      : <button type="button" className="button button-dark" disabled={busy !== ''} onClick={markCooked}><ChefHat size={16} /> {busy === 'cook' ? 'Vorrat wird aktualisiert …' : 'Gekocht – Zutaten vom Vorrat abziehen'}</button>}
  </div>
}
