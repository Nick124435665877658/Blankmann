// Schnellauswahl zum Antippen (0.3.60, Nick 26.11.2026): Frühstück zusammenstellen bzw. Obst & Gemüse, Snacks,
// Getränke, Frühstück für die Woche. Antippen markiert (mehrere), Menge ist vorgeschlagen und änderbar,
// ein Knopf trägt alles auf einmal ein.
import { useState, type KeyboardEvent } from 'react'
import { Check, Plus, X } from 'lucide-react'
import type { QuickFood, QuickGroup, QuickItem } from '../lib/quickPicks'

type Picked<F extends QuickFood> = { food: F; quantity: string; unit: string }
type Props<F extends QuickFood> = {
  groups: QuickGroup<F>[]
  title?: string
  hint?: string
  busy?: boolean
  submitLabel: (count: number) => string
  onSubmit: (items: QuickItem<F>[]) => Promise<boolean>
}

const amountText = (n: number | null) => n === null ? '' : String(n).replace('.', ',')
const stopEnter = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.preventDefault() }

export default function QuickPick<F extends QuickFood>({ groups, title, hint, busy = false, submitLabel, onSubmit }: Props<F>) {
  const single = groups.length === 1
  const [active, setActive] = useState<string | null>(single ? groups[0]?.key ?? null : null)
  const [picked, setPicked] = useState<Picked<F>[]>([])
  const [error, setError] = useState('')
  const current = groups.find(g => g.key === active) ?? null
  const isPicked = (food: F) => picked.some(p => p.food.id === food.id)
  const toggle = (item: QuickItem<F>) => setPicked(list => list.some(p => p.food.id === item.food.id) ? list.filter(p => p.food.id !== item.food.id) : [...list, { food: item.food, quantity: amountText(item.quantity), unit: item.unit ?? '' }])
  const update = (id: string, patch: Partial<Picked<F>>) => setPicked(list => list.map(p => p.food.id === id ? { ...p, ...patch } : p))

  const submit = async () => {
    const items: QuickItem<F>[] = []
    for (const p of picked) {
      const text = p.quantity.replace(',', '.').trim()
      const quantity = text ? Number(text) : null
      if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) { setError('Bitte bei „' + p.food.name + '“ eine gültige Menge eintragen oder das Feld leer lassen.'); return }
      items.push({ food: p.food, quantity, unit: p.unit.trim() || p.food.default_unit || null })
    }
    setError('')
    if (await onSubmit(items)) setPicked([])
  }

  return <div className="quick-pick">
    {(title || hint) && <div className="quick-pick-head">{title && <b>{title}</b>}{hint && <small className="muted">{hint}</small>}</div>}
    {!single && <div className="group-chips quick-pick-chips" role="group" aria-label="Gruppe wählen">{groups.map(g => {
      const count = g.sections.reduce((n, s) => n + s.items.filter(i => isPicked(i.food)).length, 0)
      return <button type="button" key={g.key} className={'group-chip' + (active === g.key ? ' active' : '')} aria-pressed={active === g.key} onClick={() => setActive(active === g.key ? null : g.key)}>{g.label}{count ? <small>✓ {count}</small> : null}</button>
    })}</div>}
    {current && current.sections.map(section => <div className="quick-pick-section" key={section.label}>
      {(current.sections.length > 1 || single) && <small className="quick-pick-label">{section.label}</small>}
      <div className="quick-pick-tiles">{section.items.map(item => {
        const on = isPicked(item.food)
        return <button type="button" key={item.food.id} className={'quick-tile' + (on ? ' selected' : '')} aria-pressed={on} onClick={() => toggle(item)}>{on && <Check size={13} />}<span>{item.food.name}</span></button>
      })}</div>
    </div>)}
    {picked.length > 0 && <div className="quick-pick-picked">
      <small className="quick-pick-label">Ausgewählt ({picked.length}) – Menge bei Bedarf ändern</small>
      {picked.map(p => <div className="quick-pick-row" key={p.food.id}>
        <span className="quick-pick-name">{p.food.name}</span>
        <input aria-label={'Menge ' + p.food.name} inputMode="decimal" value={p.quantity} onKeyDown={stopEnter} onChange={e => update(p.food.id, { quantity: e.target.value })} placeholder="Menge" />
        <input aria-label={'Einheit ' + p.food.name} value={p.unit} onKeyDown={stopEnter} onChange={e => update(p.food.id, { unit: e.target.value })} placeholder="Einheit" />
        <button type="button" className="icon-button" aria-label={p.food.name + ' abwählen'} onClick={() => setPicked(list => list.filter(x => x.food.id !== p.food.id))}><X size={14} /></button>
      </div>)}
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="quick-pick-actions">
        <button type="button" className="button button-dark" disabled={busy} onClick={() => void submit()}><Plus size={16} /> {submitLabel(picked.length)}</button>
        <button type="button" className="button button-light" onClick={() => { setPicked([]); setError('') }}>Auswahl leeren</button>
      </div>
    </div>}
  </div>
}
