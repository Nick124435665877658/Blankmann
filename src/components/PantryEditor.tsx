// Vorrat-Eintrag bearbeiten (0.3.53, Nick): Menge mit − / + oder eintippen, MHD und Lagerort ändern.
// Menge 0 → Eintrag löschen (mit der üblichen Sicherheitsabfrage in App.tsx).
// 0.3.56 (Nick): Löschen sitzt nur noch hier (nicht mehr als Mülleimer in jeder Vorrat-Zeile).
import { useState } from 'react'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { pantryStep } from '../lib/kitchen'

export type PantryChanges = { quantity: number | null; best_before: string | null; storage_location: string }
type Item = { id: string; name: string; quantity: number | string | null; unit: string | null; best_before: string | null; storage_location: string | null }
const places = ['Kühlschrank', 'Gefrierfach', 'Vorratsschrank']
const show = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',')

export default function PantryEditor({ item, busy, onSave, onDelete, onCancel }: { item: Item; busy: boolean; onSave: (changes: PantryChanges) => void; onDelete: () => void; onCancel: () => void }) {
  const start = item.quantity === null || item.quantity === '' ? null : Number(item.quantity)
  const [text, setText] = useState(start === null ? '' : show(start))
  const [bestBefore, setBestBefore] = useState(item.best_before ?? '')
  const [place, setPlace] = useState(item.storage_location || 'Vorratsschrank')
  const value = text.trim() === '' ? null : Number(text.replace(',', '.'))
  const valid = value === null || (Number.isFinite(value) && value >= 0)
  const step = pantryStep(item.unit, value ?? start)
  const nudge = (direction: 1 | -1) => { const next = Math.max(0, Math.round(((value ?? 0) + direction * step) * 1000) / 1000); setText(show(next)) }
  const toZero = value === 0
  return <form className="pantry-editor" onSubmit={e => { e.preventDefault(); if (valid) onSave({ quantity: value, best_before: bestBefore || null, storage_location: place }) }}>
    <div className="pantry-editor-amount">
      <button type="button" className="step" aria-label="Weniger" onClick={() => nudge(-1)} disabled={(value ?? 0) <= 0}><Minus size={16} /></button>
      <input id={'pantry-qty-' + item.id} inputMode="decimal" aria-label={'Menge ' + item.name} value={text} onChange={e => setText(e.target.value)} placeholder="Menge" autoFocus />
      <span className="unit">{item.unit || ''}</span>
      <button type="button" className="step" aria-label="Mehr" onClick={() => nudge(1)}><Plus size={16} /></button>
    </div>
    <label>MHD<input id={'pantry-mhd-' + item.id} type="date" value={bestBefore} onChange={e => setBestBefore(e.target.value)} /></label>
    <label>Lagerort<select id={'pantry-place-' + item.id} value={place} onChange={e => setPlace(e.target.value)}>{[...new Set([...places, place])].map(p => <option key={p} value={p}>{p}</option>)}</select></label>
    <div className="pantry-editor-actions">
      <button className={'button ' + (toZero ? 'button-danger' : 'button-dark')} disabled={busy || !valid}>{toZero ? 'Aufgebraucht – löschen' : 'Übernehmen'}</button>
      <button type="button" className="button button-light" onClick={onCancel}>Abbrechen</button>
      {!toZero && <button type="button" className="text-link pantry-delete" onClick={onDelete} disabled={busy}><Trash2 size={14} /> Löschen</button>}
    </div>
    {!valid && <small className="error-text">Bitte eine Zahl ab 0 eintragen.</small>}
  </form>
}
