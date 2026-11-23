// Alexa-Skill „Blankmann“ (0.3.54, Nick 23.11.2026): Verbrauch per Sprache vom Vorrat abziehen.
// „Alexa, sag Blankmann, ich habe drei Eier verbraucht“ → Eier 10 → 7, Alexa: „Okay, Eier minus 3. Noch 7 da. Noch was?“
// Regeln (Nick): mehrere Einträge desselben Lebensmittels → frühestes MHD zuerst, ohne Rückfrage; bei 0 Sicherheitsabfrage
// wie in der App („Sicher, dass du das Element … löschen willst?“); „Wie viele … hab ich noch?“; „Rückgängig“; „Noch was?“.
// Ohne Browser/Datenbank testbar: die Datenbank kommt als `AlexaBackend` herein (scripts/check-alexa.ts).
import { fromBase, normalizeUnit, sameKind, splitOrganic, toBase } from './kitchen.ts'

export type AlexaPantryRow = { id: string; name: string; quantity: number | string | null; unit: string | null; best_before: string | null; food_item_id: string | null; food_name: string | null; is_organic?: boolean | null }
export type AlexaContext = { status: 'linked'; pantry: AlexaPantryRow[]; can_undo?: boolean } | { status: 'pending'; code: string } | { status: 'wrong_app' }
export type AlexaBackend = {
  context(): Promise<AlexaContext>
  apply(label: string, updates: { id: string; quantity: number }[]): Promise<void>
  remove(label: string, ids: string[]): Promise<void>
  undo(): Promise<{ ok: boolean; label?: string }>
}

type Slot = { name?: string; value?: string; resolutions?: { resolutionsPerAuthority?: { status?: { code?: string }; values?: { value?: { name?: string; id?: string } }[] }[] } }
export type AlexaRequest = {
  version?: string
  session?: { new?: boolean; attributes?: Record<string, unknown>; application?: { applicationId?: string }; user?: { userId?: string } }
  context?: { System?: { application?: { applicationId?: string }; user?: { userId?: string } } }
  request?: { type?: string; timestamp?: string; intent?: { name?: string; slots?: Record<string, Slot> } }
}
export type AlexaResponse = {
  version: '1.0'
  sessionAttributes?: Record<string, unknown>
  response: {
    outputSpeech?: { type: 'PlainText'; text: string } | { type: 'SSML'; ssml: string }
    reprompt?: { outputSpeech: { type: 'PlainText'; text: string } }
    card?: { type: 'Simple'; title: string; content: string }
    shouldEndSession?: boolean
  }
}

// ---------------------------------------------------------------- Prüfen der Anfrage
// Alexa schickt Nutzer- und Skill-Kennung mit; Anfragen älter als 150 Sekunden werden abgelehnt (Schutz gegen Wiederholung).
export function alexaIds(body: AlexaRequest) {
  return {
    user: body.session?.user?.userId ?? body.context?.System?.user?.userId ?? '',
    app: body.session?.application?.applicationId ?? body.context?.System?.application?.applicationId ?? '',
  }
}
export function checkEnvelope(body: AlexaRequest, now = Date.now()): string | null {
  if (!body || typeof body !== 'object' || !body.request?.type) return 'Keine Alexa-Anfrage'
  const { user, app } = alexaIds(body)
  if (!/^amzn1\.ask\.account\.[A-Za-z0-9._-]{10,580}$/.test(user)) return 'Nutzerkennung fehlt'
  if (!/^amzn1\.ask\.skill\.[A-Za-z0-9._-]{10,180}$/.test(app)) return 'Skill-Kennung fehlt'
  const time = Date.parse(body.request.timestamp ?? '')
  if (!Number.isFinite(time) || Math.abs(now - time) > 150_000) return 'Zeitstempel ungültig'
  return null
}

// ---------------------------------------------------------------- Lebensmittel finden
const fold = (value: string) => splitOrganic(value).base.toLocaleLowerCase('de-DE')
  .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()
// Einzahl/Mehrzahl gleich behandeln: Eier/Ei, Kartoffeln/Kartoffel, Tomaten/Tomate, Äpfel/Apfel, Champignons/Champignon.
// Jeder Name hat zwei Schlüssel: so wie geschrieben und mit gekürzter Endung; passt einer, passt der Name.
const stemWord = (word: string) => word.length > 3 ? word.replace(/(en|er|n|e|s)$/, '') : word.replace(/er$/, '')
const keys = (value: string) => { const words = fold(value).split(' ').filter(Boolean); return [...new Set([words.join(' '), words.map(stemWord).join(' ')])].filter(Boolean) }
const stem = (value: string) => keys(value).slice(-1)[0] ?? ''
const sameName = (a: string, b: string) => { const kb = keys(b); return keys(a).some(k => kb.includes(k)) }

type Candidate = { row: AlexaPantryRow; score: number }
// 0 = gleicher Name (Katalog- oder Vorratsname), 1 = zusammengesetztes Wort endet so („Markenbutter“, „Kokosmilch“),
// 2 = ein Wort beginnt so („Paprika rot“). Kurze Wörter (unter 4 Buchstaben, z. B. „Ei“) nur bei gleichem Namen.
function scoreName(name: string | null, query: string): number {
  if (!name || !query) return -1
  if (sameName(name, query)) return 0
  let best = -1
  for (const n of keys(name)) for (const q of keys(query)) {
    if (q.length < 4) continue
    const words = n.split(' ')
    const score = words.some(w => w.length > q.length && w.endsWith(q)) ? 1
      : (!q.includes(' ') && words.some(w => w.startsWith(q))) || (q.includes(' ') && n.startsWith(q + ' ')) ? 2 : -1
    if (score >= 0 && (best < 0 || score < best)) best = score
  }
  return best
}
export const displayName = (row: AlexaPantryRow) => (row.food_name || splitOrganic(row.name).base || row.name).trim()
const identity = (row: AlexaPantryRow) => row.food_item_id ?? 'name:' + stem(row.name)

export type FoodMatch = { status: 'none' } | { status: 'one'; name: string; rows: AlexaPantryRow[] } | { status: 'many'; names: string[] }
export function matchPantry(spoken: string[], pantry: AlexaPantryRow[]): FoodMatch {
  const queries = [...new Set(spoken.map(s => s.trim()).filter(Boolean))]
  let best: Candidate[] = []
  for (const row of pantry) {
    const scores = queries.flatMap(q => [scoreName(row.food_name, q), scoreName(row.name, q)]).filter(s => s >= 0)
    if (!scores.length) continue
    const score = Math.min(...scores)
    if (!best.length || score < best[0].score) best = [{ row, score }]
    else if (score === best[0].score) best.push({ row, score })
  }
  if (!best.length) return { status: 'none' }
  // Bio und normal (und mehrere Packungen) zählen als dasselbe Lebensmittel.
  const groups = new Map<string, AlexaPantryRow[]>()
  for (const { row } of best) {
    const key = identity(row)
    const byName = [...groups.keys()].find(k => sameName(displayName(groups.get(k)![0]), displayName(row)))
    const target = groups.has(key) ? key : byName ?? key
    groups.set(target, [...(groups.get(target) ?? []), row])
  }
  if (groups.size > 1) return { status: 'many', names: [...groups.values()].map(rows => displayName(rows[0])).slice(0, 3) }
  const rows = [...groups.values()][0]
  const byExpiry = [...pantry.filter(r => rows.some(x => identity(x) === identity(r)) || rows.includes(r))]
    .sort((a, b) => (a.best_before ?? '9999').localeCompare(b.best_before ?? '9999'))
  return { status: 'one', name: displayName(rows[0]), rows: byExpiry }
}

// ---------------------------------------------------------------- Mengen sprechen
const num = (value: number | string | null | undefined) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
const round = (value: number) => Math.round(value * 1000) / 1000
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
const unitLabel = (unit: string | null | undefined) => { const base = normalizeUnit(unit).base; return base === 'stk' ? 'Stück' : unitWords[base]?.[1] || (unit ?? '').trim() || 'Stück' }

// ---------------------------------------------------------------- Abziehen planen
export type Deduction =
  | { status: 'ok'; name: string; updates: { id: string; quantity: number }[]; taken: number; unit: string | null; left: number; leftUnit: string | null; short: boolean; emptied: string[] }
  | { status: 'no_amount'; name: string }   // nur ohne Menge eingetragen
  | { status: 'unit'; name: string; pantryUnit: string | null; spokenUnit: string | null }
export function planDeduction(name: string, rows: AlexaPantryRow[], amount: number, spokenUnit: string | null): Deduction {
  const tracked = rows.filter(r => num(r.quantity) !== null)
  if (!tracked.length) return { status: 'no_amount', name }
  const unit = spokenUnit ?? tracked[0].unit
  const usable = tracked.filter(r => sameKind(r.unit, unit))
  if (!usable.length) return { status: 'unit', name, pantryUnit: tracked[0].unit, spokenUnit: unit }
  let open = toBase(amount, unit).quantity
  const updates: { id: string; quantity: number }[] = []
  const emptied: string[] = []
  let leftBase = 0
  for (const row of usable) {
    const available = toBase(num(row.quantity)!, row.unit).quantity
    const take = Math.min(Math.max(available, 0), open)
    open -= take
    const after = available - take
    leftBase += after
    if (take > 1e-9) updates.push({ id: row.id, quantity: round(fromBase(after, row.unit)) })
    if (after <= 1e-6 && (take > 1e-9 || available <= 1e-6)) emptied.push(row.id)
  }
  const takenBase = toBase(amount, unit).quantity - Math.max(open, 0)
  const leftUnit = usable[0].unit
  return { status: 'ok', name, updates, taken: round(fromBase(takenBase, unit)), unit, left: round(fromBase(leftBase, leftUnit)), leftUnit, short: open > 1e-9, emptied }
}

// ---------------------------------------------------------------- Antworten
const plain = (text: string, options: { end?: boolean; reprompt?: string; attributes?: Record<string, unknown> } = {}): AlexaResponse => ({
  version: '1.0',
  sessionAttributes: options.attributes ?? {},
  response: {
    outputSpeech: { type: 'PlainText', text },
    ...(options.end ? {} : { reprompt: { outputSpeech: { type: 'PlainText', text: options.reprompt ?? 'Noch was?' } } }),
    shouldEndSession: Boolean(options.end),
  },
})
const more = (text: string, attributes?: Record<string, unknown>) => plain(text + ' Noch was?', { reprompt: 'Noch was? Sag zum Beispiel: drei Eier verbraucht. Oder: nein.', attributes })
export const SORRY = 'Da hat gerade etwas nicht geklappt. Versuch es bitte gleich noch mal.'
export const sorry = (): AlexaResponse => plain(SORRY, { end: true })
const HELP = 'Sag zum Beispiel: ich habe drei Eier verbraucht. Oder: zweihundert Gramm Mehl verbraucht. Oder: wie viele Eier habe ich noch. Oder: rückgängig.'

function pairing(code: string): AlexaResponse {
  const digits = '<say-as interpret-as="digits">' + code + '</say-as>'
  return {
    version: '1.0',
    sessionAttributes: {},
    response: {
      outputSpeech: { type: 'SSML', ssml: '<speak>Hallo! Dieses Alexa-Konto ist noch nicht mit Blankmann verbunden. Öffne in der App die Einstellungen, tippe bei Alexa auf Verbinden und gib diesen Code ein: ' + digits + '. Noch mal: ' + digits + '. Der Code gilt zehn Minuten.</speak>' },
      card: { type: 'Simple', title: 'Blankmann verbinden', content: 'Code: ' + code + '\nIn der BLANKMANN-App unter Einstellungen → Alexa eingeben. Gilt 10 Minuten.' },
      shouldEndSession: true,
    },
  }
}

// Slots lesen: erkannter Katalogname (Auflösung) zuerst, sonst das Gesprochene.
function slotValues(slot: Slot | undefined): { value: string; id: string | null; resolved: string | null } {
  const authority = slot?.resolutions?.resolutionsPerAuthority?.find(a => a.status?.code === 'ER_SUCCESS_MATCH')
  const hit = authority?.values?.[0]?.value
  return { value: (slot?.value ?? '').trim(), id: hit?.id ?? null, resolved: hit?.name ?? null }
}
function spokenAmount(slot: Slot | undefined): number | null {
  const raw = slotValues(slot).value.replace(',', '.')
  const n = Number(raw)
  return raw && Number.isFinite(n) && n > 0 && n <= 100000 ? n : null
}
const unitIds: Record<string, string> = { gramm: 'g', g: 'g', kilo: 'kg', kilogramm: 'kg', kg: 'kg', milliliter: 'ml', ml: 'ml', liter: 'l', l: 'l', stueck: 'Stk', stuck: 'Stk', stk: 'Stk',
  packung: 'Packung', packungen: 'Packung', paeckchen: 'Packung', packchen: 'Packung', pack: 'Packung', dose: 'Dose', dosen: 'Dose', becher: 'Becher', glas: 'Glas', glaeser: 'Glas', glaser: 'Glas',
  flasche: 'Flasche', flaschen: 'Flasche', bund: 'Bund', essloeffel: 'EL', essloffel: 'EL', teeloeffel: 'TL', teeloffel: 'TL', scheibe: 'Scheibe', scheiben: 'Scheibe', tuete: 'Tüte', tueten: 'Tüte', tute: 'Tüte', beutel: 'Beutel' }
function spokenUnit(slot: Slot | undefined): string | null {
  const s = slotValues(slot)
  if (s.id) return s.id
  const key = s.value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z]+/g, '')
  return key ? unitIds[key] ?? s.value : null
}
// Alexa schreibt manchmal alles ins Lebensmittel-Feld: „ein Ei“ → 1 + „Ei“, „Packung Mehl“ → Packung + „Mehl“, „die Eier“ → „Eier“.
const unitKey = (word: string) => word.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z]+/g, '')
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
function readFood(slot: Slot | undefined): { names: string[]; one: boolean; unit: string | null } {
  const s = slotValues(slot)
  const raw = s.value === '?' ? '' : s.value
  const split = splitFoodPhrase(raw)
  const names = [s.resolved, s.id, raw, split.food].filter((v): v is string => Boolean(v && v.trim()))
  return { names: [...new Set(names)], one: split.one, unit: split.unit }
}

type Pending =
  | { ask: 'amount'; food: string[] }
  | { ask: 'which'; amount: number | null; unit: string | null; names: string[] }
  | { ask: 'delete'; ids: string[]; name: string }

async function deduct(backend: AlexaBackend, pantry: AlexaPantryRow[], food: string[], amount: number | null, unit: string | null): Promise<AlexaResponse> {
  const match = matchPantry(food, pantry)
  const said = food[food.length - 1] ?? 'Das'
  if (match.status === 'none') return more(said + ' habe ich im Vorrat nicht gefunden.')
  if (match.status === 'many') {
    const list = match.names.length === 2 ? match.names.join(' oder ') : match.names.slice(0, -1).join(', ') + ' oder ' + match.names[match.names.length - 1]
    return plain('Meinst du ' + list + '?', { reprompt: 'Welches meinst du: ' + list + '?', attributes: { pending: { ask: 'which', amount, unit, names: match.names } satisfies Pending } })
  }
  if (amount === null) return plain('Wie viel ' + match.name + ' hast du verbraucht?', { reprompt: 'Sag zum Beispiel: zwei. Oder: zweihundert Gramm.', attributes: { pending: { ask: 'amount', food: [match.name] } satisfies Pending } })
  const plan = planDeduction(match.name, match.rows, amount, unit)
  if (plan.status === 'no_amount') return more('Bei ' + match.name + ' ist keine Menge eingetragen. Trag sie in der App ein, dann kann ich abziehen.')
  if (plan.status === 'unit') return more(match.name + ' ist in ' + unitLabel(plan.pantryUnit) + ' eingetragen, nicht in ' + unitLabel(plan.spokenUnit) + '. Sag die Menge bitte in ' + unitLabel(plan.pantryUnit) + '.')
  if (plan.taken <= 1e-9) {
    const question = 'Sicher, dass du das Element ' + match.name + ' löschen willst?'
    if (!plan.emptied.length) return more(match.name + ' ist laut Vorrat schon leer.')
    return plain(match.name + ' ist laut Vorrat schon leer. ' + question, { reprompt: question + ' Sag ja oder nein.', attributes: { pending: { ask: 'delete', ids: plan.emptied, name: match.name } satisfies Pending } })
  }
  const label = match.name + ' minus ' + speakAmount(plan.taken, plan.unit)
  if (plan.updates.length) await backend.apply(label, plan.updates)
  const intro = plan.short
    ? 'Du hattest nur ' + speakAmount(plan.taken, plan.unit) + ' ' + match.name + '. Ich habe alles abgezogen.'
    : 'Okay, ' + label + '.'
  if (plan.emptied.length) {
    const why = plan.left <= 1e-6 ? (plan.short ? '' : ' Damit ist alles aufgebraucht.') : ' Noch ' + speakAmount(plan.left, plan.leftUnit) + ' da, ein Eintrag ist jetzt leer.'
    const question = 'Sicher, dass du das Element ' + match.name + ' löschen willst?'
    return plain(intro + why + ' ' + question, { reprompt: question + ' Sag ja oder nein.', attributes: { pending: { ask: 'delete', ids: plan.emptied, name: match.name } satisfies Pending } })
  }
  return more(intro + ' Noch ' + speakAmount(plan.left, plan.leftUnit) + ' da.')
}

function stock(pantry: AlexaPantryRow[], food: string[]): AlexaResponse {
  const match = matchPantry(food, pantry)
  const said = food[food.length - 1] ?? 'Das'
  if (match.status === 'none') return more(said + ' ist gerade nicht im Vorrat.')
  if (match.status === 'many') {
    const parts = match.names.map(name => { const m = matchPantry([name], pantry); return m.status === 'one' ? name + ': ' + total(m.rows) : name })
    return more('Im Vorrat: ' + parts.join(', ') + '.')
  }
  return more(match.name + ': noch ' + total(match.rows) + ' da.')
}
// Summe in der Einheit des ersten Eintrags; ohne Menge eingetragene Einträge werden genannt.
function total(rows: AlexaPantryRow[]): string {
  const tracked = rows.filter(r => num(r.quantity) !== null)
  if (!tracked.length) return 'etwas, aber ohne Menge eingetragen'
  const unit = tracked[0].unit
  const same = tracked.filter(r => sameKind(r.unit, unit))
  const sum = same.reduce((s, r) => s + toBase(num(r.quantity)!, r.unit).quantity, 0)
  const text = speakAmount(fromBase(sum, unit), unit)
  return rows.length > tracked.length ? text + ' und noch etwas ohne Menge' : text
}

export async function handleAlexa(body: AlexaRequest, backend: AlexaBackend): Promise<AlexaResponse> {
  const type = body.request?.type
  if (type === 'SessionEndedRequest') return { version: '1.0', response: {} }
  const intent = type === 'IntentRequest' ? body.request?.intent?.name ?? '' : ''
  const slots = body.request?.intent?.slots ?? {}
  const pending = (body.session?.attributes?.pending ?? null) as Pending | null
  if (intent === 'AMAZON.StopIntent' || intent === 'AMAZON.CancelIntent' || (intent === 'AMAZON.NoIntent' && pending?.ask !== 'delete')) return plain('Alles klar. Guten Appetit!', { end: true })
  if (intent === 'AMAZON.HelpIntent') return plain(HELP + ' Was möchtest du?', { reprompt: 'Was hast du verbraucht?' })
  if (type !== 'LaunchRequest' && type !== 'IntentRequest') return { version: '1.0', response: {} }

  const context = await backend.context()
  if (context.status === 'pending') return pairing(context.code)
  if (context.status === 'wrong_app') return plain('Dieses Alexa-Konto ist mit einem anderen Blankmann-Skill verbunden. Trenne es in der App unter Einstellungen und verbinde es neu.', { end: true })
  const pantry = context.pantry

  if (type === 'LaunchRequest') return plain('Hallo! Was hast du verbraucht?', { reprompt: 'Sag zum Beispiel: drei Eier verbraucht.' })
  switch (intent) {
    case 'VerbrauchIntent': {
      const food = readFood(slots.lebensmittel)
      return deduct(backend, pantry, food.names, spokenAmount(slots.menge) ?? (food.one ? 1 : null), spokenUnit(slots.einheit) ?? food.unit)
    }
    case 'EinsIntent': {
      const food = readFood(slots.lebensmittel)
      return deduct(backend, pantry, food.names, 1, spokenUnit(slots.einheit) ?? food.unit)
    }
    case 'BestandIntent': {
      const food = readFood(slots.lebensmittel)
      return food.names.length ? stock(pantry, food.names) : plain('Welches Lebensmittel meinst du?', { reprompt: 'Sag zum Beispiel: wie viele Eier habe ich noch.' })
    }
    case 'MengeIntent': {
      const amount = spokenAmount(slots.menge)
      if (pending?.ask === 'amount' && amount !== null) return deduct(backend, pantry, pending.food, amount, spokenUnit(slots.einheit))
      if (pending?.ask === 'which') return plain('Welches meinst du: ' + pending.names.join(' oder ') + '?', { reprompt: 'Sag zum Beispiel: ' + pending.names[0] + '.', attributes: { pending } })
      return plain('Wovon? Sag zum Beispiel: drei Eier verbraucht.', { reprompt: 'Was hast du verbraucht?' })
    }
    case 'LebensmittelIntent': {
      const read = readFood(slots.lebensmittel)
      const food = read.names
      if (pending?.ask === 'which') {
        const chosen = pending.names.find(n => food.some(f => sameName(f, n))) ?? pending.names.find(n => food.some(f => stem(f).length >= 3 && (stem(n).includes(stem(f)) || stem(f).includes(stem(n)))))
        if (!chosen) return plain('Das habe ich nicht verstanden. Meinst du ' + pending.names.join(' oder ') + '?', { reprompt: 'Welches meinst du?', attributes: { pending } })
        return deduct(backend, pantry, [chosen], pending.amount, pending.unit)
      }
      return food.length ? deduct(backend, pantry, food, read.one ? 1 : null, read.unit) : plain('Was hast du verbraucht?', { reprompt: 'Sag zum Beispiel: drei Eier verbraucht.' })
    }
    case 'AMAZON.YesIntent':
      if (pending?.ask === 'delete') {
        await backend.remove(pending.name + ' gelöscht', pending.ids)
        return more('Erledigt, ' + pending.name + ' aus dem Vorrat gelöscht.')
      }
      return plain('Was hast du verbraucht?', { reprompt: 'Sag zum Beispiel: drei Eier verbraucht.' })
    case 'AMAZON.NoIntent':
      return more('Okay, ' + (pending as { name: string }).name + ' bleibt mit null im Vorrat.')
    case 'RueckgaengigIntent': {
      const result = await backend.undo()
      return more(result.ok ? 'Rückgängig gemacht: ' + (result.label ?? 'die letzte Änderung') + '.' : 'Es gibt nichts, was ich rückgängig machen kann.')
    }
    case 'AMAZON.FallbackIntent':
    case 'AMAZON.NavigateHomeIntent':
    default:
      if (pending) return plain('Das habe ich nicht verstanden. ' + (pending.ask === 'delete' ? 'Sicher, dass du das Element ' + pending.name + ' löschen willst? Sag ja oder nein.' : pending.ask === 'which' ? 'Meinst du ' + pending.names.join(' oder ') + '?' : 'Wie viel hast du verbraucht?'), { reprompt: 'Sag ja oder nein.', attributes: { pending } })
      return plain('Das habe ich nicht verstanden. ' + HELP, { reprompt: 'Was hast du verbraucht?' })
  }
}
