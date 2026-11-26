import { useMemo, useState } from 'react'
import { BookOpen, Check, ChefHat, ExternalLink, LoaderCircle, Sparkles, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { estimateRecipeCost, formatAmount, instructionSteps, planCooking, recipeNeeds, type DeductionPlan, type FoodRef, type IngredientRef, type PantryRow, type PriceRow } from '../lib/kitchen'
import ManualPriceForm from './ManualPriceForm'
import { completeRecipeWithAi } from '../lib/recipeAiClient'
import { isThermomix } from '../lib/recipeAi'
import { formatScore, healthClass, type HealthResult } from '../lib/health'

export type DetailsRecipe = { id: string; title: string; description: string | null; source_type?: string | null; source_url?: string | null; servings: number; prep_minutes: number | null; cook_minutes: number | null; instructions?: unknown; histamine_score?: number | null; histamine_note?: string | null; rating?: number | null; photo_path?: string | null; recipe_ingredients?: IngredientRef[] }
export type DetailsMeal = { id: string; servings: number; cooked_at: string | null; meal_date: string }

const euro = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n)

// Rezept öffnen: Zutaten mit geschätztem Einkaufswert, KI-Kochanleitung und „Gekocht“ (zieht die Zutaten vom Vorrat ab).
export default function RecipeDetails({ photoUrl, recipe, health = null, meal, foods, prices, preferOrganic = false, pantry, householdId, accessToken, onChanged, onClose, onNotice, onError }: {
  photoUrl: string | null; recipe: DetailsRecipe; health?: HealthResult | null; meal: DetailsMeal | null; foods: FoodRef[]; prices: PriceRow[]; preferOrganic?: boolean; pantry: PantryRow[]; householdId: string; accessToken: string
  onChanged: () => Promise<void>; onClose: () => void; onNotice: (message: string) => void; onError: (message: string) => void
}) {
  const servings = Number(meal?.servings || recipe.servings || 2)
  const cost = useMemo(() => estimateRecipeCost(recipe, servings, foods, prices, { preferOrganic }), [recipe, servings, foods, prices, preferOrganic])
  const steps = instructionSteps(recipe.instructions)
  const [busy, setBusy] = useState<'' | 'ai' | 'add' | 'save' | 'cook'>('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [cooked, setCooked] = useState<(DeductionPlan & { kept: string[] }) | null>(null)

  async function saveSteps(next: string[]) {
    if (!supabase) return false
    const { error } = await supabase.from('recipes').update({ instructions: next, updated_at: new Date().toISOString() }).eq('id', recipe.id).eq('household_id', householdId)
    if (error) { onError('Anleitung konnte nicht gespeichert werden: ' + error.message); return false }
    await onChanged()
    return true
  }
  const missingQuantities = (recipe.recipe_ingredients ?? []).filter(i => i.quantity === null).length
  const missingTimes = recipe.prep_minutes === null || recipe.cook_minutes === null
  const missingHistamine = !recipe.histamine_score
  async function setRating(value: number | null) {
    if (!supabase) return
    const { error } = await supabase.from('recipes').update({ rating: value }).eq('id', recipe.id).eq('household_id', householdId)
    if (error) { onError('Bewertung konnte nicht gespeichert werden: ' + error.message); return }
    onNotice(value === null ? 'Bewertung entfernt.' : 'Bewertung ' + String(value).replace('.', ',') + '/10 gespeichert.')
    await onChanged()
  }
  const timeText = [recipe.prep_minutes !== null ? 'Vorbereitung ' + recipe.prep_minutes + ' Min' : '', recipe.cook_minutes !== null ? 'Kochen ' + recipe.cook_minutes + ' Min' : ''].filter(Boolean).join(' · ')
  // KI: Anleitung erzeugen und fehlende Mengen ergänzen. Vorhandene Anleitung nur nach Rückfrage ersetzen.
  // addIngredients: KI darf Zutaten/Gewürze ergänzen (bei neuer Anleitung immer, sonst über „KI: Zutaten & Gewürze ergänzen“).
  async function generate(replaceSteps: boolean, addIngredients = replaceSteps) {
    if (replaceSteps && steps.length && !window.confirm('Sicher, dass du die bisherige Anleitung von „' + recipe.title + '“ durch eine neue KI-Anleitung ersetzen willst?')) return
    setBusy(replaceSteps || !addIngredients ? 'ai' : 'add')
    try {
      const result = await completeRecipeWithAi(recipe.id, householdId, accessToken, replaceSteps, addIngredients)
      await onChanged()
      const parts = [result.steps ? 'Anleitung mit ' + result.steps + ' Schritten erstellt' : '', result.added.length ? result.added.length + ' Zutat(en) ergänzt: ' + result.added.join(', ') : '', result.quantities ? result.quantities + ' fehlende Mengen ergänzt' : '', result.times ? 'Kochzeit eingetragen' : '', result.histamine ? 'Histaminwert ' + formatScore(result.histamine) + '/10' : ''].filter(Boolean)
      const none = addIngredients && !replaceSteps && !result.added.length ? 'keine weiteren Zutaten nötig' : 'nichts mehr zu ergänzen'
      onNotice('KI für „' + recipe.title + '“: ' + (parts.join(', ') || none) + '.' + (result.added.length ? ' Ergänzte Zutaten sind mit „KI“ markiert und lassen sich unter Rezepte → Bearbeiten wieder entfernen.' + (!replaceSteps && steps.length ? ' Mit „Anleitung neu erzeugen“ kommen sie auch in die Anleitung.' : '') : ' Du kannst alles bearbeiten.'))
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
    if (!window.confirm('„' + recipe.title + '“ als gekocht markieren? Die Zutaten für ' + String(servings).replace('.', ',') + ' Portionen werden vom Vorrat abgezogen; ein Rest bleibt im Vorrat. Gewürze, Kräuter, Öle, Saucen und Grundausstattung werden nicht abgezogen.')) return
    setBusy('cook')
    const plan = planCooking(recipeNeeds(recipe, servings), pantry, foods)
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
  // Kennzeichen je Zutat (gleiche Reihenfolge wie cost.lines: alle nicht optionalen Zutaten).
  const shownIngredients = (recipe.recipe_ingredients ?? []).filter(i => !i.is_optional)
  const isStaple = (foodId: string | null) => Boolean(foodId && foods.find(f => f.id === foodId)?.is_staple)
  const thermomix = isThermomix(recipe)
  return <div className="panel recipe-details">
    <div className="panel-head"><div><span className="eyebrow">{meal ? 'GEPLANTES GERICHT · ' + new Date(meal.meal_date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' }) : 'REZEPT'}</span><h2>{recipe.title}{thermomix && <span className="badge thermomix" title="Thermomix-Rezept aus Cookidoo">Thermomix</span>}</h2><small className="muted">{String(servings).replace('.', ',')} Portionen · geschätzter Einkaufswert ≈ {euro(cost.total)}{missingFoods.length ? ' · ' + missingFoods.length + ' Preis(e) fehlen' : ''}{cost.approximate && !missingFoods.length ? ' · teils Packungspreise' : ''}{timeText ? ' · ⏱ ' + timeText : ''}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="Schließen"><X size={18} /></button></div>

    {thermomix && <div className="thermomix-note"><span>Thermomix-Rezept aus Cookidoo{recipe.description?.startsWith('Thermomix · ') ? ' (' + recipe.description.slice(12) + ')' : ''} – Zutaten und Mengen wie im Original. Die KI ändert keine Mengen, sie ergänzt nur, und schreibt die Anleitung für Herd und Ofen.</span>{recipe.source_url && <a className="button button-light button-small" href={recipe.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> In Cookidoo öffnen</a>}</div>}
    {photoUrl && <img className="recipe-photo" src={photoUrl} alt={'Foto von ' + recipe.title} decoding="async" referrerPolicy="no-referrer" />}
    <div className="recipe-scores">
      {health && <HealthBlock health={health} />}
      <div><span className="eyebrow">HISTAMIN</span>{recipe.histamine_score
        ? <p><span className={'badge histamine h' + (Number(recipe.histamine_score) >= 7 ? 'good' : Number(recipe.histamine_score) >= 4 ? 'mid' : 'bad')}>{formatScore(Number(recipe.histamine_score))}/10</span> <small className="muted">{recipe.histamine_note || ''} {recipe.histamine_note === 'Von Hand gesetzt' ? '' : '(KI-Schätzung, keine medizinische Beratung – 1 = histaminreich, 10 = kein Histamin)'}</small></p>
        : <p className="muted">Noch kein Wert – „Mit KI ergänzen“ vergibt ihn.</p>}</div>
      <div><span className="eyebrow">EURE BEWERTUNG</span>
        <form className="rating-form" onSubmit={e => { e.preventDefault(); const text = String(new FormData(e.currentTarget).get('rating') || '').replace(',', '.').trim(); const value = Number(text); if (!text || !(value >= 1 && value <= 10)) { onError('Bitte eine Bewertung zwischen 1 und 10 eintragen, z. B. 6,7.'); return } void setRating(Math.round(value * 10) / 10) }}>
          <input name="rating" inputMode="decimal" placeholder="z. B. 6,7" defaultValue={recipe.rating != null ? String(Number(recipe.rating)).replace('.', ',') : ''} aria-label="Eigene Bewertung von 1 bis 10" />
          <span className="muted">/ 10</span>
          <button className="button button-dark button-small">Speichern</button>
          {recipe.rating != null && <button type="button" className="text-link" onClick={() => setRating(null)}>Entfernen</button>}
        </form>
        <small className="muted">1 = schlecht, 10 = super – Kommazahlen wie 6,7 sind möglich.</small></div>
    </div>

    <span className="eyebrow">ZUTATEN & EINKAUFSWERT</span>
    {cost.lines.length ? cost.lines.map((line, index) => <div className="cost-line" key={line.name + index}>
      <div><b>{line.name}{shownIngredients[index]?.ai_added && <span className="ai-tag" title="Von der KI ergänzt – unter Rezepte → Bearbeiten entfernbar">KI</span>}{isStaple(line.foodId) && <span className="staple-tag">Grundausstattung</span>}</b><small>{formatAmount(line.quantity, line.unit)}{line.hint && line.basis !== 'missing' ? ' · ' + line.hint : ''}</small>
        {line.basis === 'missing' && <ManualPriceForm foods={foods} householdId={householdId} foodId={line.foodId} foodName={line.name} defaultQuantity={line.quantity} defaultUnit={line.unit} defaultOrganic={preferOrganic} onSaved={onChanged} onError={onError} />}</div>
      <strong>{line.cost === null ? 'Preis fehlt' : '≈ ' + euro(line.cost)}</strong>
    </div>) : <p className="muted">Für dieses Rezept sind noch keine Zutaten hinterlegt.</p>}

    <div style={{ marginTop: 18 }}><span className="eyebrow">KOCHANLEITUNG</span></div>
    {editing ? <div className="instructions-edit">
      <textarea value={draft} onChange={e => setDraft(e.target.value)} aria-label="Anleitung bearbeiten, ein Schritt pro Zeile" />
      <small className="muted">Ein Schritt pro Zeile.</small>
      <div className="details-actions"><button type="button" className="button button-dark" disabled={busy !== ''} onClick={saveEdit}>Anleitung speichern</button><button type="button" className="button button-light" onClick={() => setEditing(false)}>Abbrechen</button></div>
    </div> : steps.length ? <ol className="recipe-steps">{steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      : <p className="muted">{thermomix ? 'Noch keine Anleitung. Die KI schreibt sie ganz normal für Herd und Ofen (ohne Thermomix) – die Mengen aus Cookidoo bleiben unverändert. Die Original-Zubereitung findest du unter „In Cookidoo öffnen“.' : 'Noch keine Anleitung. Die KI erstellt sie aus den Zutaten und ergänzt fehlende Mengen – kostenlos über Cloudflare. Von dir eingetragene Mengen bleiben unverändert.'}</p>}
    {!editing && <div className="details-actions">
      {(!steps.length || missingQuantities > 0 || missingTimes || missingHistamine) && <button type="button" className="button button-dark" disabled={busy !== ''} onClick={() => generate(!steps.length)}>{busy === 'ai' ? <LoaderCircle size={16} /> : <Sparkles size={16} />} {busy === 'ai' ? 'KI schreibt …' : 'Mit KI ergänzen: ' + [!steps.length ? 'Anleitung' : '', missingQuantities ? missingQuantities + ' Mengen' : '', missingTimes ? 'Kochzeit' : '', missingHistamine ? 'Histaminwert' : ''].filter(Boolean).join(' + ')}</button>}
      <button type="button" className="button button-light" disabled={busy !== ''} onClick={() => generate(false, true)}>{busy === 'add' ? <LoaderCircle size={16} /> : <Sparkles size={16} />} {busy === 'add' ? 'KI sucht Zutaten …' : 'KI: Zutaten & Gewürze ergänzen'}</button>
      {steps.length > 0 && <button type="button" className="button button-light" disabled={busy !== ''} onClick={() => generate(true)}><Sparkles size={16} /> Anleitung neu erzeugen</button>}
      <button type="button" className="button button-light" disabled={busy !== ''} onClick={() => { setDraft(steps.map((s, i) => (i + 1) + '. ' + s).join('\n')); setEditing(true) }}><BookOpen size={16} /> {steps.length ? 'Bearbeiten' : 'Selbst schreiben'}</button>
    </div>}

    <div style={{ marginTop: 18 }}><span className="eyebrow">GEKOCHT?</span></div>
    {meal?.cooked_at && !cooked ? <div className="alert success"><Check size={16} />Schon als gekocht markiert am {new Date(meal.cooked_at).toLocaleDateString('de-DE')} – der Vorrat wurde bereits abgezogen.</div>
      : cooked ? <div className="notice-card"><Check size={18} /><span>
        {cooked.used.length ? 'Vom Vorrat abgezogen: ' + cooked.used.join(', ') + '. ' : ''}
        {cooked.partial.length ? 'Nur teilweise im Vorrat: ' + cooked.partial.join(', ') + '. ' : ''}
        {cooked.missing.length ? 'Nicht im Vorrat: ' + cooked.missing.join(', ') + '. ' : ''}
        {cooked.unconvertible.length ? 'Im Vorrat, aber Menge/Einheit nicht verrechenbar (bitte im Vorrat selbst anpassen): ' + cooked.unconvertible.join(', ') + '. ' : ''}
        {cooked.kept.length ? 'Bewusst nicht abgezogen (Gewürze, Öle, Saucen, Grundausstattung): ' + cooked.kept.join(', ') + '.' : ''}
      </span></div>
      : <button type="button" className="button button-dark" disabled={busy !== ''} onClick={markCooked}><ChefHat size={16} /> {busy === 'cook' ? 'Vorrat wird aktualisiert …' : 'Gekocht – Zutaten vom Vorrat abziehen'}</button>}
  </div>
}

// 0.3.57 (Nick 24.11.2026): Gesundheitswert mit Begründung und Nährwerten je Portion.
const one = (n: number) => (Math.round(n * 10) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
function HealthBlock({ health }: { health: HealthResult }) {
  const p = health.portion
  return <div className="health-block"><span className="eyebrow">GESUNDHEIT</span>
    {health.score !== null ? <>
      <p><span className={'badge health h' + healthClass(health.score)}>{formatScore(health.score)}/10</span> <small className="muted">je Portion ≈ {Math.round(p.grams)} g</small></p>
      {(health.good.length > 0 || health.bad.length > 0) && <ul className="health-reasons">
        {health.good.map(text => <li className="good" key={'g' + text}>+ {text}</li>)}
        {health.bad.map(text => <li className="bad" key={'b' + text}>− {text}</li>)}
      </ul>}
      <dl className="health-nutrients">
        <div><dt>Energie</dt><dd>{Math.round(p.kcal)} kcal</dd></div>
        <div><dt>Eiweiß</dt><dd>{one(p.protein)} g</dd></div>
        <div><dt>Fett</dt><dd>{one(p.fat)} g <small>ges. {one(p.satFat)} g</small></dd></div>
        <div><dt>Kohlenhydrate</dt><dd>{one(p.carbs)} g <small>Zucker {one(p.sugar)} g</small></dd></div>
        <div><dt>Ballaststoffe</dt><dd>{one(p.fiber)} g</dd></div>
        <div><dt>Salz</dt><dd>{one(p.salt)} g</dd></div>
      </dl>
      <small className="muted">Berechnet aus euren Zutaten und Mengen mit Nährwerten des Bundeslebensmittelschlüssels (BLS 4.0), bewertet wie der Nutri-Score plus DGE-Empfehlungen 2024 – Richtwert, keine medizinische Beratung.{health.coverage < 0.99 ? ' ' + Math.round(health.coverage * 100) + ' % der Zutatenmenge haben Nährwerte.' : ''}</small>
    </> : <p className="muted">Noch kein Wert – zu wenige Zutaten mit Mengen und Nährwerten{health.missing.length ? ' (fehlen: ' + health.missing.slice(0, 4).join(', ') + ')' : ''}.</p>}
  </div>
}
