// Gemeinsame Helfer des Alexa-Skills: Namen vergleichen, Mengen sprechen, Slots lesen, Antworten bauen.
import { fromBase, normalizeUnit, sameKind, splitOrganic, toBase } from './kitchen.ts'
import type { AlexaPantryRow, AlexaResponse, Slot } from './alexaSkill.ts'

// ---------------------------------------------------------------- Lebensmittel finden
export const fold = (value: string) => splitOrganic(value).base.toLocaleLowerCase('de-DE')
  .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()
// Einzahl/Mehrzahl gleich behandeln: Eier/Ei, Kartoffeln/Kartoffel, Tomaten/Tomate, Äpfel/Apfel, Champignons/Champignon.
// Jeder Name hat zwei Schlüssel: so wie geschrieben und mit gekürzter Endung; passt einer, passt der Name.
const stemWord = (word: string) => word.length > 3 ? word.replace(/(en|er|n|e|s)$/, '') : word.replace(/er$/, '')
export const keys = (value: string) => { const words = fold(value).split(' ').filter(Boolean); return [...new Set([words.join(' '), words.map(stemWord).join(' ')])].filter(Boolean) }
export const stem = (value: string) => keys(value).slice(-1)[0] ?? ''
export const sameName = (a: string, b: string) => { const kb = keys(b); return keys(a).some(k => kb.includes(k)) }

// ---------------------------------------------------------------- Mengen sprechen
export const num = (value: number | string | null | undefined) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
export const round = (value: number) => Math.round(value * 1000) / 1000
const spokenNumber = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const unitWords: Record<string, [string, string]> = {
  g: ['Gramm', 'Gramm'], ml: ['Milliliter', 'Milliliter'], stk: ['', ''], packung: ['Packung', 'Packungen'], dose: ['Dose', 'Dosen'],
  bund: ['Bund', 'Bund'], el: ['Esslöffel', 'Esslöffel'], tl: ['Teelöffel', 'Teelöffel'], kopf: ['Kopf', 'Köpfe'], knolle: ['Knolle', 'Knollen'],
  zehe: ['Zehe', 'Zehen'], prise: ['Prise', 'Prisen'], becher: ['Becher', 'Becher'], glas: ['Glas', 'Gläser'], flasche: ['Flasche', 'Flaschen'],
  scheibe: ['Scheibe', 'Scheiben'], tuete: ['Tüte', 'Tüten'], beutel: ['Beutel', 'Beutel'],
}
// 750 g → „750 Gramm“, 1250 g → „1,25 Kilo“, 3 Stk → „3“, 2 Packung → „2 Packungen“.
export function speakAmount(quantity: number, unit: string | null | undefined): string {
  const base = normalizeUnit(unit).base
  const q = round(fromBase(toBase(quantity, unit).quantity, base === 'g' || base === 'ml' ? base : unit))
  if (base === 'g' && q >= 1000) return spokenNumber(q / 1000) + ' Kilo'
  if (base === 'ml' && q >= 1000) return spokenNumber(q / 1000) + ' Liter'
  const words = unitWords[base]
  const word = words ? words[q === 1 ? 0 : 1] : (unit ?? '').trim()
  return spokenNumber(q) + (word ? ' ' + word : '')
}
export const unitLabel = (unit: string | null | undefined) => { const base = normalizeUnit(unit).base; return base === 'stk' ? 'Stück' : unitWords[base]?.[1] || (unit ?? '').trim() || 'Stück' }

// ---------------------------------------------------------------- Antworten
export const plain = (text: string, options: { end?: boolean; reprompt?: string; attributes?: Record<string, unknown> } = {}): AlexaResponse => ({
  version: '1.0',
  sessionAttributes: options.attributes ?? {},
  response: {
    outputSpeech: { type: 'PlainText', text },
    ...(options.end ? {} : { reprompt: { outputSpeech: { type: 'PlainText', text: options.reprompt ?? 'Noch was?' } } }),
    shouldEndSession: Boolean(options.end),
  },
})
export const more = (text: string, attributes?: Record<string, unknown>) => plain(text + ' Noch was?', { reprompt: 'Noch was? Sag zum Beispiel: drei Eier verbraucht. Oder: nein.', attributes })
export const SORRY = 'Da hat gerade etwas nicht geklappt. Versuch es bitte gleich noch mal.'
export const sorry = (): AlexaResponse => plain(SORRY, { end: true })

// Slots lesen: erkannter Katalogname (Auflösung) zuerst, sonst das Gesprochene.
export function slotValues(slot: Slot | undefined): { value: string; id: string | null; resolved: string | null } {
  const authority = slot?.resolutions?.resolutionsPerAuthority?.find(a => a.status?.code === 'ER_SUCCESS_MATCH')
  const hit = authority?.values?.[0]?.value
  return { value: (slot?.value ?? '').trim(), id: hit?.id ?? null, resolved: hit?.name ?? null }
}
export function spokenAmount(slot: Slot | undefined): number | null {
  const raw = slotValues(slot).value.replace(',', '.')
  const n = Number(raw)
  return raw && Number.isFinite(n) && n > 0 && n <= 100000 ? n : null
}
export const unitIds: Record<string, string> = { gramm: 'g', g: 'g', kilo: 'kg', kilogramm: 'kg', kg: 'kg', milliliter: 'ml', ml: 'ml', liter: 'l', l: 'l', stueck: 'Stk', stuck: 'Stk', stk: 'Stk',
  packung: 'Packung', packungen: 'Packung', paeckchen: 'Packung', packchen: 'Packung', pack: 'Packung', dose: 'Dose', dosen: 'Dose', becher: 'Becher', glas: 'Glas', glaeser: 'Glas', glaser: 'Glas',
  flasche: 'Flasche', flaschen: 'Flasche', bund: 'Bund', essloeffel: 'EL', essloffel: 'EL', teeloeffel: 'TL', teeloffel: 'TL', scheibe: 'Scheibe', scheiben: 'Scheibe', tuete: 'Tüte', tueten: 'Tüte', tute: 'Tüte', beutel: 'Beutel' }
export function spokenUnit(slot: Slot | undefined): string | null {
  const s = slotValues(slot)
  if (s.id) return s.id
  const key = s.value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z]+/g, '')
  return key ? unitIds[key] ?? s.value : null
}
// Alexa schreibt manchmal alles ins Lebensmittel-Feld: „ein Ei“ → 1 + „Ei“, „Packung Mehl“ → Packung + „Mehl“, „die Eier“ → „Eier“.
export const unitKey = (word: string) => word.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z]+/g, '')
export function splitFoodPhrase(value: string): { food: string; one: boolean; unit: string | null } {
  let words = value.trim().split(/\s+/).filter(Boolean)
  let one = false
  let unit: string | null = null
  if (words.length > 1 && /^(ein|eine|einen|einem|einer)$/i.test(words[0])) { one = true; words = words.slice(1) }
  else if (words.length > 1 && /^(die|den|das|der|dem|etwas|von|vom)$/i.test(words[0])) words = words.slice(1)
  if (words.length > 1 && unitIds[unitKey(words[0])]) { unit = unitIds[unitKey(words[0])]; words = words.slice(1) }
  if (words.length > 1 && /^(von|vom)$/i.test(words[0])) words = words.slice(1)
  return { food: words.join(' '), one, unit }
}
export function readFood(slot: Slot | undefined): { names: string[]; one: boolean; unit: string | null } {
  const s = slotValues(slot)
  const raw = s.value === '?' ? '' : s.value
  const split = splitFoodPhrase(raw)
  const names = [s.resolved, s.id, raw, split.food].filter((v): v is string => Boolean(v && v.trim()))
  return { names: [...new Set(names)], one: split.one, unit: split.unit }
}

// Summe in der Einheit des ersten Eintrags; ohne Menge eingetragene Einträge werden genannt.
export function total(rows: AlexaPantryRow[]): string {
  const tracked = rows.filter(r => num(r.quantity) !== null)
  if (!tracked.length) return 'etwas, aber ohne Menge eingetragen'
  const unit = tracked[0].unit
  const same = tracked.filter(r => sameKind(r.unit, unit))
  const sum = same.reduce((s, r) => s + toBase(num(r.quantity)!, r.unit).quantity, 0)
  const text = speakAmount(fromBase(sum, unit), unit)
  return rows.length > tracked.length ? text + ' und noch etwas ohne Menge' : text
}
