import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { manualPriceRow } from '../lib/kitchen'
import { localISO } from '../lib/dates'

// Fehlender Preis: von Hand eintragen. Wird wie ein Bon-Preis in household_food_prices gespeichert (Quelle „Manuell“).
export default function ManualPriceForm({ householdId, foodId, foodName, defaultQuantity, defaultUnit, onSaved, onError }: {
  householdId: string; foodId: string | null; foodName: string; defaultQuantity: number | null; defaultUnit: string | null
  onSaved: () => Promise<void>; onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!foodId) return <small className="muted">Nicht im Nahrungsmittel-Katalog – dort anlegen, dann Preis eintragen.</small>
  if (!open) return <button type="button" className="text-link" onClick={() => setOpen(true)}>Preis eintragen</button>
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase || !foodId) return
    const form = new FormData(e.currentTarget)
    const price = Number(String(form.get('price') || '').replace(',', '.'))
    const quantityText = String(form.get('quantity') || '').replace(',', '.').trim()
    const quantity = quantityText ? Number(quantityText) : null
    const unit = String(form.get('unit') || '').trim() || null
    if (!Number.isFinite(price) || price <= 0) { onError('Bitte einen Preis über 0 € eintragen.'); return }
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) { onError('Bitte eine gültige Menge eintragen oder das Feld leer lassen.'); return }
    setBusy(true)
    const { error } = await supabase.from('household_food_prices').insert({
      household_id: householdId, food_item_id: foodId, retailer_code: 'other', price_type: 'regular', source_name: 'Manuell',
      observed_at: localISO(), notes: 'Von Hand eingetragen', ...manualPriceRow(price, quantity, unit),
    })
    setBusy(false)
    if (error) { onError('Preis für ' + foodName + ' konnte nicht gespeichert werden: ' + error.message); return }
    setOpen(false)
    await onSaved()
  }
  return <form className="manual-price-form" onSubmit={save} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6 }}>
    <input name="price" inputMode="decimal" placeholder="Preis €" aria-label={'Preis für ' + foodName} required style={{ width: 80 }} />
    <span className="muted" style={{ fontSize: 10 }}>für</span>
    <input name="quantity" inputMode="decimal" placeholder="Menge" defaultValue={defaultQuantity ?? ''} aria-label="Packungsmenge" style={{ width: 70 }} />
    <input name="unit" placeholder="g, Stk …" defaultValue={defaultUnit ?? ''} aria-label="Einheit" style={{ width: 70 }} />
    <button className="button button-dark button-small" disabled={busy}>{busy ? '…' : 'Speichern'}</button>
    <button type="button" className="button button-light button-small" onClick={() => setOpen(false)}>Abbrechen</button>
  </form>
}
