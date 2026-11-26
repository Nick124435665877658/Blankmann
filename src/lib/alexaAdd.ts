// Alexa: Vorrat per Sprache erfassen und ansagen (0.3.61, Nick 26.11.2026).
// „… ich habe sechs Eier gekauft“ → fehlende Angaben werden erfragt, bis alles befüllt ist: Menge, Einheit,
// (nur bei Neuem) Kategorie, Lagerort und Haltbarkeit. Unbekanntes wird erst nach „Ja“ neu angelegt.
// Der Entwurf wandert in den Alexa-Sitzungsdaten mit; gespeichert wird erst, wenn nichts mehr fehlt.
// Ohne Browser/Datenbank testbar (scripts/check-alexa.ts).
import { guessCategory, storageFor } from './categories.ts'
import { baseKey, fromBase, sameKind, splitOrganic, toBase } from './kitchen.ts'
import { bestBeforeFor } from './shelfLife.ts'
import { fold, more, num, plain, round, sameName, speakAmount, total, unitIds, unitKey } from './alexaText.ts'
import type { AlexaBackend, AlexaPantryRow, AlexaResponse } from './alexaSkill.ts'

export const places = ['Kühlschrank', 'Gefrierfach', 'Vorratsschrank', 'Keller']
export type AlexaFood = { id: string; name: string; category: string | null; default_unit: string | null }
export type AlexaNewItem = { food_id: string | null; name: string; category: string; quantity: number; unit: string; storage_location: string; best_before: string | null; is_organic: boolean }

export type Draft = {
  name: string; food_id: string | null; create: boolean; organic: boolean
  quantity: number | null; unit: string | null; category: string | null; place: string | null
  best_before: string | null; date_done: boolean; similar: string[]
}
export type AddStep = 'name' | 'amount' | 'unit' | 'category' | 'place' | 'date'
export type AddPending = { ask: 'add'; step: AddStep; draft: Draft; noSuggestion?: boolean }
export type ListPending = { ask: 'list'; place: string | null; offset: number }
// Was in einer Antwort auf eine Rückfrage stecken kann – egal, welchen Intent Alexa erkannt hat.
export type Answer = { yes: boolean; no: boolean; skip: boolean; fresh: boolean; number: number | null; unit: string | null; names: string[]; text: string; date: string | null }
export type AddContext = { backend: AlexaBackend; pantry: AlexaPantryRow[]; today: string }

// ---------------------------------------------------------------- Gesprochenes deuten
export function parsePlace(text: string): string | null {
  const t = fold(text)
  if (/gefrier|tiefkuhl|\btk\b|froster|eisfach|truhe/.test(t)) return 'Gefrierfach'
  if (/kuhl/.test(t)) return 'Kühlschrank'
  if (/keller/.test(t)) return 'Keller'
  if (/vorrat|schrank|speise|regal/.test(t)) return 'Vorratsschrank'
  return null
}
const categoryWords: [RegExp, string][] = [
  [/tiefkuhl|\btk\b|gefroren/, 'Tiefkühl'], [/hulsen|konserve|dosen/, 'Hülsenfrüchte & Konserven'], [/gemuse/, 'Gemüse'], [/obst|frucht/, 'Obst'],
  [/krauter|gewurz/, 'Kräuter & Gewürze'], [/fleisch|fisch|wurst/, 'Fleisch & Fisch'], [/milch|molkerei|\beier\b|kase/, 'Milchprodukte & Eier'],
  [/getreide|backwaren|brot|nudel/, 'Getreide & Backwaren'], [/\bole?\b|sauce|sosse|essig/, 'Öle & Saucen'], [/nuss|saat|samen|kerne/, 'Nüsse & Saaten'],
  [/backen|suss/, 'Backen & Süßes'], [/snack|knabber/, 'Snacks'], [/getrank/, 'Getränke'], [/sonstig|andere/, 'Sonstiges'],
]
export function parseCategory(text: string): string | null {
  const t = fold(text)
  return t ? categoryWords.find(([re]) => re.test(t))?.[1] ?? null : null
}

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
export const addDays = (date: string, days: number) => { const [y, m, d] = date.split('-').map(Number); return iso(y, m, d + days) }
// AMAZON.DATE liefert „2026-12-10“, „2026-12“ (Monat), „2026-W50“ (Woche) oder „2027“. Zeiträume → letzter Tag.
export function parseDate(raw: string | null | undefined, today: string): string | null {
  const value = (raw ?? '').trim().replace(/^XXXX/, today.slice(0, 4))
  let date: string | null = null
  let m: RegExpMatchArray | null
  if ((m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/))) date = iso(+m[1], +m[2], +m[3])
  else if ((m = value.match(/^(\d{4})-(\d{2})$/))) date = iso(+m[1], +m[2] + 1, 0)
  else if ((m = value.match(/^(\d{4})-W(\d{1,2})(-WE)?$/))) {
    const jan4 = new Date(Date.UTC(+m[1], 0, 4))
    const monday = 4 - ((jan4.getUTCDay() + 6) % 7)
    date = iso(+m[1], 1, monday + (+m[2] - 1) * 7 + 6)
  } else if ((m = value.match(/^(\d{4})$/))) date = iso(+m[1], 12, 31)
  if (!date) return null
  // „zehnter Januar“ im November meint das nächste Jahr.
  return date < addDays(today, -30) ? iso(+date.slice(0, 4) + 1, +date.slice(5, 7), +date.slice(8, 10)) : date
}
const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
export const speakDate = (date: string, today: string) =>
  Number(date.slice(8, 10)) + '. ' + months[Number(date.slice(5, 7)) - 1] + (date.slice(0, 4) === today.slice(0, 4) ? '' : ' ' + date.slice(0, 4))

// „rote linsen“ → „Rote Linsen“
const titleCase = (value: string) => value.trim().split(/\s+/).map((w, i) => i && /^(und|mit|aus|in|im|von|vom|ohne|für|der|die|das)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toLocaleUpperCase('de-DE') + w.slice(1)).join(' ')

// Katalog: nur gleicher Name (Einzahl/Mehrzahl egal) gilt als bekannt – „Milch“ ist nicht „Kokosmilch“.
export function matchFood(names: string[], foods: AlexaFood[]): { food: AlexaFood | null; similar: string[] } {
  const queries = names.map(n => splitOrganic(n).base).filter(Boolean)
  for (const q of queries) {
    const exact = foods.find(f => fold(f.name) === fold(q)) ?? foods.find(f => sameName(f.name, q))
    if (exact) return { food: exact, similar: [] }
  }
  const words = queries.map(fold).filter(q => q.length >= 4)
  const similar = foods.filter(f => words.some(q => fold(f.name).split(' ').some(w => w.startsWith(q) || w.endsWith(q)))).map(f => f.name)
  return { food: null, similar: similar.sort((a, b) => a.length - b.length).slice(0, 2) }
}

// ---------------------------------------------------------------- Entwurf
export function startDraft(names: string[], given: { quantity: number | null; unit: string | null; place: string | null }, foods: AlexaFood[]): Draft {
  const { food, similar } = matchFood(names, foods)
  const spoken = splitOrganic(names[names.length - 1] ?? '').base
  return {
    name: food?.name ?? titleCase(spoken), food_id: food?.id ?? null, create: false, organic: names.some(n => splitOrganic(n).organic),
    quantity: given.quantity, unit: given.unit, category: food ? food.category || 'Sonstiges' : null, place: given.place,
    best_before: null, date_done: false, similar,
  }
}
const suggestedCategory = (draft: Draft) => guessCategory(draft.name)
// Vorschlag für den Lagerort: dort, wo das Lebensmittel schon liegt, sonst passend zur Kategorie.
function suggestedPlace(draft: Draft, pantry: AlexaPantryRow[]): string {
  const row = pantry.find(r => r.storage_location && (draft.food_id ? r.food_item_id === draft.food_id : baseKey(r.name) === baseKey(draft.name)))
  return row?.storage_location ?? storageFor(draft.category ?? 'Sonstiges')
}
// Nächste fehlende Angabe. Was sich sicher ableiten lässt (Einheit, MHD bei frischem Obst/Gemüse), wird gesetzt.
function nextStep(draft: Draft, foods: AlexaFood[] | null, today: string): AddStep | null {
  if (!draft.food_id && !draft.create) return 'name'
  if (draft.quantity === null) return 'amount'
  if (!draft.unit) {
    const usual = foods?.find(f => f.id === draft.food_id)?.default_unit?.trim()
    if (draft.quantity < 20) draft.unit = 'Stk'
    else if (usual === 'g' || usual === 'ml') draft.unit = usual
    else return 'unit'
  }
  if (!draft.category) return 'category'
  if (!draft.place) return 'place'
  if (!draft.date_done) {
    const auto = draft.place === 'Gefrierfach' ? null : bestBeforeFor(draft.name, draft.category, today)
    if (!auto) return 'date'
    draft.best_before = auto
    draft.date_done = true
  }
  return null
}

export function question(pending: AddPending, pantry: AlexaPantryRow[]): { text: string; reprompt: string } {
  const { step, draft, noSuggestion } = pending
  const name = draft.name
  const both = (text: string, reprompt = text) => ({ text, reprompt })
  switch (step) {
    case 'name':
      return draft.similar.length
        ? both(name + ' kenne ich noch nicht. Ähnlich ist ' + draft.similar.join(' oder ') + '. Sag den Namen, oder: neu anlegen.')
        : both(name + ' kenne ich noch nicht. Soll ich es neu anlegen?', 'Soll ich ' + name + ' neu anlegen? Sag ja oder nein.')
    case 'amount': return both(name + ': wie viel?', name + ': wie viel? Sag zum Beispiel: zwei, oder: fünfhundert Gramm.')
    case 'unit': return both(name + ': ' + speakAmount(draft.quantity!, 'Stk') + ' was? Gramm, Milliliter oder Stück?')
    case 'category': {
      const guess = suggestedCategory(draft)
      const some = 'Gemüse, Obst, Milchprodukte, Getreide, Konserven, Gewürze, Snacks, Getränke, Tiefkühl oder Sonstiges'
      return guess !== 'Sonstiges' && !noSuggestion
        ? both(name + ': welche Kategorie? Ich schlage ' + guess + ' vor. Passt das?', 'Passt ' + guess + '? Sag ja, oder nenn eine andere Kategorie.')
        : both(name + ': welche Kategorie? Zum Beispiel ' + some + '.')
    }
    case 'place': {
      const guess = suggestedPlace(draft, pantry)
      return noSuggestion
        ? both(name + ': wohin? Kühlschrank, Gefrierfach, Vorratsschrank oder Keller?')
        : both(name + ': wohin? Ich schlage ' + guess + ' vor. Passt das?', 'Passt ' + guess + '? Sag ja, oder: Kühlschrank, Gefrierfach, Vorratsschrank, Keller.')
    }
    case 'date': return both(name + ': bis wann haltbar? Sag ein Datum, oder: ohne.', 'Sag zum Beispiel: zehnter Dezember, in fünf Tagen, oder: ohne.')
  }
}

const ask = (pending: AddPending, pantry: AlexaPantryRow[], prefix = ''): AlexaResponse => {
  const q = question(pending, pantry)
  return plain(prefix + q.text, { reprompt: q.reprompt, attributes: { pending } })
}

// Speichern: gleiche Zeile (Lebensmittel, Bio, Einheit, Ort, MHD) wird aufgestockt, sonst entsteht ein neuer Eintrag.
async function save(draft: Draft, { backend, pantry, today }: AddContext): Promise<AlexaResponse> {
  const quantity = draft.quantity!, unit = draft.unit!
  const mine = draft.food_id ? pantry.filter(r => r.food_item_id === draft.food_id) : []
  const label = draft.name + ' plus ' + speakAmount(quantity, unit)
  const same = mine.find(r => num(r.quantity) !== null && sameKind(r.unit, unit) && Boolean(r.is_organic) === draft.organic
    && r.storage_location === draft.place && (r.best_before ?? null) === draft.best_before)
  if (same) {
    await backend.apply(label, [{ id: same.id, quantity: round(num(same.quantity)! + fromBase(toBase(quantity, unit).quantity, same.unit)) }])
  } else {
    await backend.add(label, { food_id: draft.food_id, name: draft.name, category: draft.category!, quantity, unit, storage_location: draft.place!, best_before: draft.best_before, is_organic: draft.organic })
  }
  let text = 'Okay, ' + (draft.organic ? 'Bio ' : '') + label + ', ' + draft.place
  text += draft.best_before ? ', haltbar bis ' + speakDate(draft.best_before, today) + '.' : ', ohne Haltbarkeitsdatum.'
  if (!draft.food_id) text += ' Neu angelegt unter ' + draft.category + '.'
  const counted = mine.filter(r => num(r.quantity) !== null && sameKind(r.unit, unit))
  const before = counted.reduce((s, r) => s + toBase(num(r.quantity)!, r.unit).quantity, 0)
  if (before > 0) text += ' Insgesamt jetzt ' + speakAmount(fromBase(before + toBase(quantity, unit).quantity, unit), unit) + '.'
  return more(text)
}

export async function advance(draft: Draft, context: AddContext, foods: AlexaFood[] | null): Promise<AlexaResponse> {
  // Der Katalog wird nur gebraucht, um bei großen Zahlen ohne Einheit die übliche Einheit zu kennen.
  const catalog = foods ?? (draft.food_id && !draft.unit && (draft.quantity ?? 0) >= 20 ? await context.backend.foods() : null)
  const step = nextStep(draft, catalog, context.today)
  return step ? ask({ ask: 'add', step, draft }, context.pantry) : save(draft, context)
}

export async function beginAdd(names: string[], given: { quantity: number | null; unit: string | null; place: string | null }, context: AddContext): Promise<AlexaResponse> {
  if (!names.length) return plain('Was möchtest du eintragen? Sag zum Beispiel: sechs Eier.', { reprompt: 'Sag zum Beispiel: ich habe sechs Eier gekauft.' })
  const foods = await context.backend.foods()
  return advance(startDraft(names, given, foods), context, foods)
}

// Antwort auf eine Rückfrage verarbeiten.
export async function continueAdd(pending: AddPending, answer: Answer, context: AddContext): Promise<AlexaResponse> {
  const draft: Draft = { ...pending.draft }
  const { step } = pending
  const again = (prefix = 'Das habe ich nicht verstanden. ', noSuggestion = pending.noSuggestion) => ask({ ...pending, noSuggestion }, context.pantry, prefix)
  // „Gramm“ oder „ein Kilo“ kommt manchmal als „Lebensmittel“ an.
  const word = answer.names[answer.names.length - 1] ?? answer.text
  const unit = answer.unit ?? unitIds[unitKey(word)] ?? null
  // Wird bei der Menge ein anderes Lebensmittel genannt („sechs Eier“ auf „Mehl: wie viel?“), zählt das nicht.
  const otherFood = answer.names.length > 0 && !unitIds[unitKey(word)] && !answer.names.some(n => sameName(n, draft.name))
  switch (step) {
    case 'name': {
      if (answer.yes || answer.fresh) { draft.create = true; break }
      if (answer.no) return more('Okay, ich lege ' + draft.name + ' nicht an.')
      if (!answer.names.length) return again()
      const foods = await context.backend.foods()
      const next = startDraft(answer.names, { quantity: draft.quantity, unit: draft.unit, place: draft.place }, foods)
      next.organic = next.organic || draft.organic
      return advance(next, context, foods)
    }
    case 'amount': {
      if (otherFood) return again('Erst noch das hier. ')
      if (answer.number === null) return again()
      draft.quantity = answer.number
      draft.unit = unit ?? draft.unit
      break
    }
    case 'unit': {
      if (!unit) return again()
      draft.unit = unit
      if (answer.number !== null) draft.quantity = answer.number
      break
    }
    case 'category': {
      const guess = suggestedCategory(draft)
      const said = answer.number === null ? parseCategory(answer.text) : null
      if (said) draft.category = said
      else if (answer.yes && !pending.noSuggestion && guess !== 'Sonstiges') draft.category = guess
      else if (answer.skip) draft.category = guess
      else if (answer.no) return again('', true)
      else return again()
      break
    }
    case 'place': {
      const guess = suggestedPlace(draft, context.pantry)
      const said = parsePlace(answer.text)
      if (said) draft.place = said
      else if ((answer.yes && !pending.noSuggestion) || answer.skip) draft.place = guess
      else if (answer.no) return again('', true)
      else return again()
      break
    }
    case 'date': {
      const date = parseDate(answer.date, context.today)
      if (date) draft.best_before = date
      else if (!answer.skip && !answer.no) return again()
      draft.date_done = true
      break
    }
  }
  return advance(draft, context, null)
}

// ---------------------------------------------------------------- Vorrat ansagen
const PAGE = 10
const inPlace: Record<string, string> = { 'Kühlschrank': 'Im Kühlschrank', 'Gefrierfach': 'Im Gefrierfach', 'Vorratsschrank': 'Im Vorratsschrank', 'Keller': 'Im Keller' }
export function listStock(pantry: AlexaPantryRow[], place: string | null, offset = 0, everything = false): AlexaResponse {
  const groups = new Map<string, { place: string; name: string; rows: AlexaPantryRow[] }>()
  for (const row of pantry) {
    const where = row.storage_location || 'Vorratsschrank'
    if ((place && where !== place) || num(row.quantity) === 0) continue
    const name = (row.food_name || splitOrganic(row.name).base || row.name).trim()
    const key = where + '|' + baseKey(name)
    const group = groups.get(key) ?? { place: where, name, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  const order = (where: string) => places.indexOf(where) < 0 ? places.length : places.indexOf(where)
  const items = [...groups.values()].sort((a, b) => order(a.place) - order(b.place) || a.name.localeCompare(b.name, 'de-DE'))
  if (!items.length) return more(place ? (inPlace[place] ?? place) + ' ist nichts eingetragen.' : 'Dein Vorrat ist leer.')
  if (!place && !everything && !offset && items.length > PAGE) {
    const counts = [...new Set(items.map(i => i.place))].map(where => items.filter(i => i.place === where).length + ' ' + (inPlace[where] ?? where).replace(/^Im /, 'im '))
    return plain('Du hast ' + items.length + ' Sachen: ' + counts.join(', ') + '. Welchen Ort soll ich vorlesen? Oder: alles.', { reprompt: 'Sag zum Beispiel: Kühlschrank. Oder: alles.', attributes: { pending: { ask: 'list', place: null, offset: 0 } satisfies ListPending } })
  }
  const page = items.slice(offset, offset + PAGE)
  const text = [...new Set(page.map(i => i.place))].map(where => (inPlace[where] ?? where) + ': ' + page.filter(i => i.place === where)
    .map(i => i.rows.every(r => num(r.quantity) === null) ? i.name : i.name + ' ' + total(i.rows)).join(', ') + '.').join(' ')
  const rest = items.length - offset - page.length
  if (rest <= 0) return more(text)
  return plain(text + ' Noch ' + rest + ' weitere. Sag weiter, oder: fertig.', { reprompt: 'Sag weiter, oder: fertig.', attributes: { pending: { ask: 'list', place, offset: offset + PAGE } satisfies ListPending } })
}
