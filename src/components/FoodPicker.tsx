// Nahrungsmittel aus dem Katalog suchen und wählen (0.3.52, Nick): ersetzt lange Auswahllisten.
// Antippen → tippen → passende Einträge (beste zuerst) → wählen. Pfeiltasten/Enter/Esc gehen auch.
// Modi: gesteuert (value/onChange, z. B. Bon-Prüfliste) oder im Formular (name → verstecktes Feld mit dem Namen bzw. der ID).
// allowFree: freier Text erlaubt (Vorrat ergänzen) – das Textfeld selbst trägt dann den Namen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { rankFoods, type SearchableFood } from '../lib/foodSearch'

type Props = {
  foods: SearchableFood[]
  value?: string
  onChange?: (id: string, food: SearchableFood | null) => void
  emptyLabel?: string
  placeholder?: string
  name?: string
  submit?: 'name' | 'id'
  allowFree?: boolean
  required?: boolean
  autoFocus?: boolean
  ariaLabel?: string
}

export default function FoodPicker({ foods, value, onChange, emptyLabel, placeholder, name, submit = 'name', allowFree = false, required = false, autoFocus = false, ariaLabel = 'Nahrungsmittel suchen' }: Props) {
  const [inner, setInner] = useState('')
  const selectedId = value ?? inner
  const selected = foods.find(f => f.id === selectedId) ?? null
  const [text, setText] = useState(selected?.name ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [typed, setTyped] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const list = useRef<HTMLUListElement | null>(null)

  // Auswahl von außen geändert (z. B. Vorschlag der Bon-Erkennung) → Text anpassen, solange nicht getippt wird.
  useEffect(() => { if (!open && !allowFree) setText(selected?.name ?? '') }, [selected?.name, open, allowFree])

  const matches = useMemo(() => rankFoods(foods, typed ? text : '', 40), [foods, text, typed])
  const options: { id: string; label: string; hint?: string; food: SearchableFood | null }[] = [
    ...(emptyLabel ? [{ id: '', label: emptyLabel, food: null }] : []),
    ...matches.map(f => ({ id: f.id, label: f.name, hint: f.category ?? undefined, food: f })),
  ]

  const choose = (option: { id: string; food: SearchableFood | null }) => {
    if (value === undefined) setInner(option.id)
    onChange?.(option.id, option.food)
    setText(option.food?.name ?? (allowFree ? text : ''))
    setOpen(false); setTyped(false)
  }
  const close = () => { setOpen(false); setTyped(false); if (!allowFree) setText(selected?.name ?? '') }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(event.target as Node)) close() }
    document.addEventListener('mousedown', onDown); document.addEventListener('touchstart', onDown)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown) }
  })
  useEffect(() => { list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active])

  return <div className={'food-picker' + (open ? ' open' : '')} ref={box}>
    <input
      type="text" role="combobox" aria-expanded={open} aria-autocomplete="list" aria-label={ariaLabel} autoComplete="off" autoFocus={autoFocus}
      name={allowFree ? name : undefined} required={allowFree && required}
      value={text} placeholder={placeholder ?? (emptyLabel && !selected ? emptyLabel : 'Nahrungsmittel suchen …')}
      onFocus={e => { setOpen(true); setActive(0); e.currentTarget.select() }}
      onChange={e => { setText(e.target.value); setTyped(true); setOpen(true); setActive(0); if (allowFree && value === undefined) setInner('') }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, options.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
        else if (e.key === 'Enter' && open && options[active] && (typed || !allowFree)) { e.preventDefault(); choose(options[active]) }
        else if (e.key === 'Escape') { close() }
      }}
    />
    {!allowFree && name && <input type="hidden" name={name} value={submit === 'id' ? selectedId : selected?.name ?? ''} />}
    {open && <ul className="food-picker-list" role="listbox" ref={list}>
      {options.length ? options.map((option, index) => <li key={option.id || 'leer'} role="option" aria-selected={option.id === selectedId} data-active={index === active}
        onMouseDown={e => e.preventDefault()} onClick={() => choose(option)} onMouseEnter={() => setActive(index)}>
        <span>{option.label}</span>{option.hint && <small>{option.hint}</small>}
      </li>) : <li className="food-picker-empty">{allowFree ? 'Nicht im Katalog – wird so eingetragen.' : 'Nichts gefunden.'}</li>}
    </ul>}
  </div>
}
