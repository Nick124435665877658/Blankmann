import { useState, type FormEvent } from 'react'
import { canSplitToOne, splitOrganic } from '../lib/kitchen'
import { localISO } from '../lib/dates'
import { saveMarketPrice } from '../lib/priceStore'
import { retailerName, selectableRetailers } from '../lib/retailers'
import FoodPicker from './FoodPicker'
import type { SearchableFood } from '../lib/foodSearch'

// Fehlender Preis: von Hand eintragen – mit Supermarkt und Bio/normal. Ein Preis je Nahrungsmittel + Markt + Bio/normal
// (ein vorhandener wird überschrieben). Quelle „Manuell“.
export default function ManualPriceForm({ householdId, foodId: givenFoodId, foodName, defaultQuantity, defaultUnit, defaultOrganic = false, foods, onSaved, onError }: {
  householdId: string; foodId: string | null; foodName: string; foods?: SearchableFood[]; defaultQuantity: number | null; defaultUnit: string | null; defaultOrganic?: boolean
  onSaved: () => Promise<void>; onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [quantityText, setQuantityText] = useState(defaultQuantity === null ? '' : String(defaultQuantity).replace('.', ','))
  const [unit, setUnit] = useState(defaultUnit ?? '')
  const [splitOne, setSplitOne] = useState(false)
  // 0.3.52: Ohne Katalog-Zuordnung kann man das Nahrungsmittel hier per Suche wählen.
  const [chosenId, setChosenId] = useState('')
  const foodId = givenFoodId ?? (chosenId || null)
  if (!givenFoodId && !foods) return <small className="muted">Nicht im Nahrungsmittel-Katalog – dort anlegen, dann Preis eintragen.</small>
  if (!foodId) return <div className="price-food-pick"><small className="muted">Nicht zugeordnet – Nahrungsmittel aus dem Katalog wählen:</small><FoodPicker foods={foods ?? []} value={chosenId} onChange={id => { setChosenId(id); setOpen(true) }} placeholder={foodName} ariaLabel={'Nahrungsmittel für ' + foodName + ' wählen'} /></div>
  if (!open) return <button type="button" className="text-link" onClick={() => setOpen(true)}>Preis eintragen</button>
  const quantityValue = quantityText.trim() ? Number(quantityText.replace(',', '.')) : null
  const canSplit = canSplitToOne(quantityValue, unit.trim() || null)
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!foodId) return
    const form = new FormData(e.currentTarget)
    const price = Number(String(form.get('price') || '').replace(',', '.'))
    const quantity = quantityValue
    const retailer = String(form.get('retailer') || 'other')
    const organic = form.get('organic') === 'on' || splitOrganic(foodName).organic
    if (!Number.isFinite(price) || price <= 0) { onError('Bitte einen Preis über 0 € eintragen.'); return }
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) { onError('Bitte eine gültige Menge eintragen oder das Feld leer lassen.'); return }
    setBusy(true)
    try {
      await saveMarketPrice({ householdId, foodId, retailerCode: retailer, organic, price, quantity, unit: unit.trim() || null, splitToOne: splitOne && canSplit, sourceName: 'Manuell', observedAt: localISO(), notes: 'Von Hand eingetragen (' + retailerName(retailer) + ')' })
    } catch (error) {
      setBusy(false)
      onError('Preis für ' + foodName + ' konnte nicht gespeichert werden: ' + (error instanceof Error ? error.message : String(error)))
      return
    }
    setBusy(false)
    setOpen(false)
    await onSaved()
  }
  return <form className="manual-price-form" onSubmit={save} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6 }}>
    <input name="price" inputMode="decimal" placeholder="Preis €" aria-label={'Preis für ' + foodName} required style={{ width: 80 }} />
    <span className="muted" style={{ fontSize: 10 }}>für</span>
    <input name="quantity" inputMode="decimal" placeholder="Menge" value={quantityText} onChange={e => setQuantityText(e.target.value)} aria-label="Packungsmenge" style={{ width: 70 }} />
    <input name="unit" placeholder="g, Stk …" value={unit} onChange={e => setUnit(e.target.value)} aria-label="Einheit" style={{ width: 70 }} />
    <select name="retailer" defaultValue="other" aria-label="Supermarkt">{selectableRetailers.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
    <label className="inline-check"><input type="checkbox" name="organic" defaultChecked={defaultOrganic || splitOrganic(foodName).organic} /> Bio</label>
    {canSplit && <label className="inline-check"><input type="checkbox" checked={splitOne} onChange={e => setSplitOne(e.target.checked)} /> Auf 1 {unit.trim() || 'Stk'} runterrechnen</label>}
    <button className="button button-dark button-small" disabled={busy}>{busy ? '…' : 'Speichern'}</button>
    <button type="button" className="button button-light button-small" onClick={() => setOpen(false)}>Abbrechen</button>
  </form>
}
