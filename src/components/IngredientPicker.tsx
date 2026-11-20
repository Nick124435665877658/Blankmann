import { useState } from 'react'
import { Search } from 'lucide-react'
import { baseKey } from '../lib/kitchen'

type PickerFood = { id: string; name: string; category: string; default_unit: string | null; is_staple?: boolean | null }
type PickerIngredient = { food_item_id: string | null; quantity: number | null; unit: string | null; ai_added?: boolean | null }
type Pick = { quantity: string; unit: string; ai: boolean }

// Zutatenauswahl für „Rezept anlegen“ und „Rezept bearbeiten“: Suchfeld, ausgewählte Zutaten stehen oben.
// Formularfelder wie bisher: food_ids (angehakt), quantity_<id>, unit_<id>. Angehakte bleiben beim Suchen erhalten.
export default function IngredientPicker({ foods, initial, title, hint }: { foods: PickerFood[]; initial: PickerIngredient[]; title: string; hint: string }) {
  const [picked, setPicked] = useState<Map<string, Pick>>(() => new Map(initial.filter(i => i.food_item_id).map(i => [i.food_item_id as string, {
    quantity: i.quantity === null || i.quantity === undefined ? '' : String(Number(i.quantity)), unit: i.unit ?? '', ai: Boolean(i.ai_added),
  }])))
  const [search, setSearch] = useState('')
  const [justPicked, setJustPicked] = useState<string | null>(null)
  const set = (food: PickerFood, patch: Partial<Pick> | null) => setPicked(current => {
    const next = new Map(current)
    if (patch === null) next.delete(food.id)
    else next.set(food.id, { ...(next.get(food.id) ?? { quantity: '', unit: food.default_unit ?? '', ai: false }), ...patch })
    return next
  })
  const query = baseKey(search)
  const matches = (food: PickerFood) => !query || baseKey(food.name).includes(query) || baseKey(food.category).includes(query)
  const selected = foods.filter(food => picked.has(food.id))
  const others = foods.filter(food => !picked.has(food.id) && matches(food))
  // Ausgewählte Zutat: mit Menge und Einheit. Nach dem Anhaken springt der Cursor direkt in „Menge“.
  const selectedRow = (food: PickerFood) => {
    const pick = picked.get(food.id)!
    return <div className="ingredient-edit-row picked" key={food.id}>
      <label className="ingredient-check"><input type="checkbox" name="food_ids" value={food.id} checked onChange={() => set(food, null)} />
        <span>{food.name}{pick.ai && <span className="ai-tag" title="Von der KI ergänzt">KI</span>}{food.is_staple && <span className="staple-tag">Grundausstattung</span>}</span></label>
      <input name={'quantity_' + food.id} type="number" min="0" step="0.1" placeholder="Menge" aria-label={'Menge ' + food.name} value={pick.quantity} autoFocus={justPicked === food.id} onChange={e => set(food, { quantity: e.target.value })} />
      <input name={'unit_' + food.id} placeholder="Einheit" aria-label={'Einheit ' + food.name} value={pick.unit} onChange={e => set(food, { unit: e.target.value })} />
    </div>
  }
  const otherRow = (food: PickerFood) => <label className="ingredient-check picker-option" key={food.id}>
    <input type="checkbox" checked={false} onChange={() => { set(food, {}); setJustPicked(food.id) }} />
    <span>{food.name}{food.is_staple && <span className="staple-tag">Grundausstattung</span>}</span><small className="muted">{food.category}</small>
  </label>
  return <div className="ingredient-picker">
    <b>{title}</b><small>{hint}</small>
    {selected.length > 0 && <div className="picker-selected"><span className="eyebrow">AUSGEWÄHLT ({selected.length})</span>{selected.map(selectedRow)}</div>}
    <label className="picker-search"><Search size={15} /><input type="search" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} placeholder="Nahrungsmittel suchen …" aria-label="Nahrungsmittel suchen" /></label>
    {others.length ? <div className="picker-options">{others.map(otherRow)}</div> : <small className="muted">{query ? 'Nichts gefunden für „' + search + '“ – neue Nahrungsmittel unter „Nahrungsmittel“ anlegen.' : 'Alle Nahrungsmittel sind ausgewählt.'}</small>}
  </div>
}
