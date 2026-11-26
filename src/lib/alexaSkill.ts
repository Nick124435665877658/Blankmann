// Alexa-Skill „Blankmann“ (0.3.54, Nick 23.11.2026): Verbrauch per Sprache vom Vorrat abziehen.
// „Alexa, sag Blankmann, ich habe drei Eier verbraucht“ → Eier 10 → 7, Alexa: „Okay, Eier minus 3. Noch 7 da. Noch was?“
// Regeln (Nick): mehrere Einträge desselben Lebensmittels → frühestes MHD zuerst, ohne Rückfrage; bei 0 Sicherheitsabfrage
// wie in der App („Sicher, dass du das Element … löschen willst?“); „Wie viele … hab ich noch?“; „Rückgängig“; „Noch was?“.
// 0.3.61 (Nick 26.11.2026): Vorrat erfassen („ich habe sechs Eier gekauft“, mit Rückfragen) und ansagen → alexaAdd.ts.
// 0.3.62: „setz Milch auf die Einkaufsliste“ → alexaShop.ts.
// Ohne Browser/Datenbank testbar: die Datenbank kommt als `AlexaBackend` herein (scripts/check-alexa.ts).
import { fromBase, sameKind, splitOrganic, toBase } from './kitchen.ts'
import { addDays, beginAdd, continueAdd, listStock, parsePlace, type AddContext, type AddPending, type AlexaFood, type AlexaNewItem, type Answer, type ListPending } from './alexaAdd.ts'
import { askShop, shopAdd, type AlexaShopItem, type AlexaShopResult } from './alexaShop.ts'
import { fold, keys, more, num, plain, readFood, round, sameName, slotValues, speakAmount, splitFoodPhrase, spokenAmount, spokenUnit, stem, total, unitLabel, SORRY, sorry } from './alexaText.ts'
export { speakAmount, splitFoodPhrase, SORRY, sorry }

export type AlexaPantryRow = { id: string; name: string; quantity: number | string | null; unit: string | null; best_before: string | null; food_item_id: string | null; food_name: string | null; is_organic?: boolean | null; storage_location?: string | null }
export type AlexaContext = { status: 'linked'; pantry: AlexaPantryRow[]; can_undo?: boolean } | { status: 'pending'; code: string } | { status: 'wrong_app' }
export type AlexaBackend = {
  context(): Promise<AlexaContext>
  apply(label: string, updates: { id: string; quantity: number }[]): Promise<void>
  remove(label: string, ids: string[]): Promise<void>
  undo(): Promise<{ ok: boolean; label?: string }>
  foods(): Promise<AlexaFood[]>
  add(label: string, item: AlexaNewItem): Promise<void>
  shop(label: string, item: AlexaShopItem): Promise<AlexaShopResult>
}

export type Slot = { name?: string; value?: string; resolutions?: { resolutionsPerAuthority?: { status?: { code?: string }; values?: { value?: { name?: string; id?: string } }[] }[] } }
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

const HELP = 'Sag zum Beispiel: ich habe drei Eier verbraucht. Oder: ich habe sechs Eier gekauft. Oder: Vorrat erfassen. Oder: was ist im Kühlschrank. Oder: wie viele Eier habe ich noch. Oder: setz Milch auf die Einkaufsliste. Oder: rückgängig.'

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

type Pending =
  | { ask: 'amount'; food: string[] }
  | { ask: 'which'; amount: number | null; unit: string | null; names: string[] }
  | { ask: 'delete'; ids: string[]; name: string }
  | { ask: 'offer'; names: string[] }   // „nicht gefunden – soll ich es eintragen?“
  | AddPending
  | ListPending

const offer = (text: string, names: string[]) => plain(text + ' Soll ich es eintragen?', { reprompt: 'Soll ich es in den Vorrat eintragen? Sag ja oder nein.', attributes: { pending: { ask: 'offer', names } satisfies Pending } })

async function deduct(backend: AlexaBackend, pantry: AlexaPantryRow[], food: string[], amount: number | null, unit: string | null): Promise<AlexaResponse> {
  const match = matchPantry(food, pantry)
  const said = food[food.length - 1] ?? 'Das'
  if (match.status === 'none') return offer(said + ' habe ich im Vorrat nicht gefunden.', food)
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
  if (match.status === 'none') return offer(said + ' ist gerade nicht im Vorrat.', food)
  if (match.status === 'many') {
    const parts = match.names.map(name => { const m = matchPantry([name], pantry); return m.status === 'one' ? name + ': ' + total(m.rows) : name })
    return more('Im Vorrat: ' + parts.join(', ') + '.')
  }
  return more(match.name + ': noch ' + total(match.rows) + ' da.')
}
type Mode = 'add' | 'shop' | 'use' | undefined
// Ein bloßes „sechs Eier“ meint, was zuletzt dran war: „add“ = eintragen, „shop“ = Einkaufsliste, sonst verbraucht.
export async function handleAlexa(body: AlexaRequest, backend: AlexaBackend): Promise<AlexaResponse> {
  const state: { mode: Mode } = { mode: body.session?.attributes?.mode as Mode }
  const result = await route(body, backend, state)
  if (state.mode && result.response.outputSpeech && !result.response.shouldEndSession) {
    result.sessionAttributes = { ...result.sessionAttributes, mode: state.mode }
    const reprompt = result.response.reprompt?.outputSpeech
    if (reprompt?.text.startsWith('Noch was?')) {
      if (state.mode === 'add') reprompt.text = 'Noch was? Sag zum Beispiel: sechs Eier. Oder: fertig.'
      if (state.mode === 'shop') reprompt.text = 'Noch was für die Einkaufsliste? Sag zum Beispiel: Brot. Oder: fertig.'
    }
  }
  return result
}

const today = (timestamp: string | undefined) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp ? new Date(timestamp) : new Date())
// Neue Befehle brechen eine angefangene Eintragung ab (mit Hinweis), alles andere ist eine Antwort auf die Rückfrage.
const commands = ['VerbrauchIntent', 'EinsIntent', 'BestandIntent', 'RueckgaengigIntent', 'HinzufuegenIntent', 'HinzufuegenEinsIntent', 'ErfassenIntent', 'VorratAnsageIntent', 'EinkaufIntent', 'EinkaufEinsIntent', 'EinkaufStartIntent']

function readAnswer(intent: string, slots: Record<string, Slot>): Answer {
  const food = readFood(slots.lebensmittel)
  const text = [slots.lagerort, slots.kategorie, slots.lebensmittel].flatMap(s => { const v = slotValues(s); return [v.resolved, v.value] }).filter(Boolean).join(' ')
  const said = fold(slotValues(slots.lebensmittel).value)
  const one = intent === 'AngabeEinsIntent' || intent === 'MengeEinsIntent' || food.one
  let number = spokenAmount(slots.menge) ?? (one ? 1 : null)
  const days = intent === 'TageIntent' ? 1 : intent === 'WochenIntent' ? 7 : 0
  if (days) number = spokenAmount(slots.menge)
  return {
    yes: intent === 'AMAZON.YesIntent', no: intent === 'AMAZON.NoIntent',
    skip: intent === 'OhneIntent' || /^(ohne|egal|weiss( ich)? nicht|keine ahnung|uberspringen|kein datum)/.test(said),
    fresh: intent === 'NeuIntent' || /^(neu|neu anlegen)$/.test(said),
    number, unit: spokenUnit(slots.einheit) ?? food.unit, names: food.names, text, date: slots.datum?.value ?? null,
  }
}

async function route(body: AlexaRequest, backend: AlexaBackend, state: { mode: Mode }): Promise<AlexaResponse> {
  const type = body.request?.type
  if (type === 'SessionEndedRequest') return { version: '1.0', response: {} }
  const intent = type === 'IntentRequest' ? body.request?.intent?.name ?? '' : ''
  const slots = body.request?.intent?.slots ?? {}
  let pending = (body.session?.attributes?.pending ?? null) as Pending | null
  const unsaved = pending?.ask === 'add' ? pending.draft.name + ' habe ich nicht gespeichert.' : ''
  if (intent === 'AMAZON.StopIntent' || (intent === 'AMAZON.CancelIntent' && !unsaved) || (intent === 'AMAZON.NoIntent' && !['delete', 'add', 'offer'].includes(pending?.ask ?? ''))) {
    return plain('Alles klar. ' + (unsaved ? unsaved + ' ' : '') + 'Guten Appetit!', { end: true })
  }
  if (intent === 'AMAZON.CancelIntent') return more('Okay, ' + unsaved)
  if (intent === 'AMAZON.HelpIntent') return plain(HELP + ' Was möchtest du?', { reprompt: 'Was möchtest du?', attributes: pending ? { pending } : {} })
  if (type !== 'LaunchRequest' && type !== 'IntentRequest') return { version: '1.0', response: {} }

  const context = await backend.context()
  if (context.status === 'pending') return pairing(context.code)
  if (context.status === 'wrong_app') return plain('Dieses Alexa-Konto ist mit einem anderen Blankmann-Skill verbunden. Trenne es in der App unter Einstellungen und verbinde es neu.', { end: true })
  const pantry = context.pantry
  const adding: AddContext = { backend, pantry, today: today(body.request?.timestamp) }

  if (type === 'LaunchRequest') return plain('Hallo! Was hast du verbraucht?', { reprompt: 'Sag zum Beispiel: drei Eier verbraucht. Oder: Vorrat erfassen.' })

  if (pending?.ask === 'add') {
    // „pack es in den Keller“ ist eine Antwort, keine neue Eintragung.
    const onlyPronoun = intent.startsWith('Hinzufuegen') && readFood(slots.lebensmittel).names.every(n => /^(es|das|die|den|ihn|sie)$/i.test(n))
    if (!commands.includes(intent) || onlyPronoun) {
      const answer = readAnswer(intent, slots)
      if (onlyPronoun) answer.names = []
      // „in fünf Tagen“ / „zwei Wochen“ als Antwort auf die Haltbarkeit
      if (pending.step === 'date' && (intent === 'TageIntent' || intent === 'WochenIntent') && answer.number !== null) answer.date = addDays(adding.today, answer.number * (intent === 'TageIntent' ? 1 : 7))
      return continueAdd(pending, answer, adding)
    }
    pending = null
    const next = await route({ ...body, session: { ...body.session, attributes: {} } }, backend, state)
    const speech = next.response.outputSpeech
    if (speech?.type === 'PlainText') speech.text = unsaved + ' ' + speech.text
    return next
  }

  const place = parsePlace(slotValues(slots.lagerort).resolved ?? slotValues(slots.lagerort).value)
  const food = readFood(slots.lebensmittel)
  const add = (names: string[], quantity: number | null, unit: string | null) => { state.mode = 'add'; return beginAdd(names, { quantity, unit, place }, adding) }
  const take = (names: string[], quantity: number | null, unit: string | null) => { state.mode = 'use'; return deduct(backend, pantry, names, quantity, unit) }
  const shop = (names: string[], quantity: number | null, unit: string | null) => { state.mode = 'shop'; return shopAdd(names, { quantity, unit }, backend) }
  const bare = (names: string[], quantity: number | null, unit: string | null) => state.mode === 'add' ? add(names, quantity, unit) : state.mode === 'shop' ? shop(names, quantity, unit) : take(names, quantity, unit)
  const amount = spokenAmount(slots.menge) ?? (food.one ? 1 : null)
  const unit = spokenUnit(slots.einheit) ?? food.unit

  switch (intent) {
    case 'VerbrauchIntent': return take(food.names, amount, unit)
    case 'EinsIntent': return take(food.names, 1, unit)
    // Ohne Verb („sechs Eier“): je nachdem, was zuletzt dran war.
    case 'AngabeIntent': return bare(food.names, amount, unit)
    case 'AngabeEinsIntent': return bare(food.names, 1, unit)
    case 'EinkaufIntent': return shop(food.names, amount, unit)
    case 'EinkaufEinsIntent': return shop(food.names, 1, unit)
    case 'EinkaufStartIntent': state.mode = 'shop'; return askShop()
    case 'HinzufuegenIntent': return add(food.names, amount, unit)
    case 'HinzufuegenEinsIntent': return add(food.names, 1, unit)
    case 'ErfassenIntent':
      state.mode = 'add'
      return plain('Okay. Nenn mir, was du da hast, eins nach dem anderen. Zum Beispiel: sechs Eier. Wenn du durch bist, sag: fertig.', { reprompt: 'Sag zum Beispiel: sechs Eier. Oder: fertig.' })
    case 'BestandIntent':
      return food.names.length ? stock(pantry, food.names) : plain('Welches Lebensmittel meinst du?', { reprompt: 'Sag zum Beispiel: wie viele Eier habe ich noch.' })
    case 'VorratAnsageIntent': return listStock(pantry, place)
    case 'LagerortIntent': return listStock(pantry, place)
    case 'AMAZON.NextIntent':
      if (pending?.ask === 'list') return listStock(pantry, pending.place, pending.offset, true)
      return plain('Was möchtest du?', { reprompt: 'Was möchtest du?' })
    case 'MengeIntent':
    case 'MengeEinsIntent': {
      const count = intent === 'MengeEinsIntent' ? 1 : spokenAmount(slots.menge)
      if (pending?.ask === 'amount' && count !== null) return take(pending.food, count, spokenUnit(slots.einheit))
      if (pending?.ask === 'which') return plain('Welches meinst du: ' + pending.names.join(' oder ') + '?', { reprompt: 'Sag zum Beispiel: ' + pending.names[0] + '.', attributes: { pending } })
      if (state.mode === 'shop') return plain('Wovon? Sag zum Beispiel: zwei Liter Milch.', { reprompt: 'Was soll auf die Einkaufsliste?' })
      return state.mode === 'add'
        ? plain('Wovon? Sag zum Beispiel: sechs Eier.', { reprompt: 'Was hast du da?' })
        : plain('Wovon? Sag zum Beispiel: drei Eier verbraucht.', { reprompt: 'Was hast du verbraucht?' })
    }
    case 'LebensmittelIntent': {
      if (pending?.ask === 'which') {
        const chosen = pending.names.find(n => food.names.some(f => sameName(f, n))) ?? pending.names.find(n => food.names.some(f => stem(f).length >= 3 && (stem(n).includes(stem(f)) || stem(f).includes(stem(n)))))
        if (!chosen) return plain('Das habe ich nicht verstanden. Meinst du ' + pending.names.join(' oder ') + '?', { reprompt: 'Welches meinst du?', attributes: { pending } })
        return take([chosen], pending.amount, pending.unit)
      }
      if (pending?.ask === 'list') {
        const said = fold(food.names[food.names.length - 1] ?? '')
        if (/^alle/.test(said)) return listStock(pantry, null, 0, true)
        const where = parsePlace(said)
        if (where) return listStock(pantry, where)
      }
      if (!food.names.length) return plain('Was meinst du?', { reprompt: 'Was möchtest du?' })
      return bare(food.names, food.one ? 1 : null, food.unit)
    }
    case 'AMAZON.YesIntent':
      if (pending?.ask === 'delete') {
        await backend.remove(pending.name + ' gelöscht', pending.ids)
        return more('Erledigt, ' + pending.name + ' aus dem Vorrat gelöscht.')
      }
      if (pending?.ask === 'offer') return add(pending.names, null, null)
      return plain('Was möchtest du?', { reprompt: 'Sag zum Beispiel: drei Eier verbraucht.' })
    case 'AMAZON.NoIntent':
      if (pending?.ask === 'offer') return more('Okay.')
      return more('Okay, ' + (pending as { name: string }).name + ' bleibt mit null im Vorrat.')
    case 'RueckgaengigIntent': {
      const result = await backend.undo()
      return more(result.ok ? 'Rückgängig gemacht: ' + (result.label ?? 'die letzte Änderung') + '.' : 'Es gibt nichts, was ich rückgängig machen kann.')
    }
    case 'AMAZON.FallbackIntent':
    case 'AMAZON.NavigateHomeIntent':
    default:
      if (pending?.ask === 'delete') return plain('Das habe ich nicht verstanden. Sicher, dass du das Element ' + pending.name + ' löschen willst? Sag ja oder nein.', { reprompt: 'Sag ja oder nein.', attributes: { pending } })
      if (pending?.ask === 'which') return plain('Das habe ich nicht verstanden. Meinst du ' + pending.names.join(' oder ') + '?', { reprompt: 'Welches meinst du?', attributes: { pending } })
      if (pending?.ask === 'amount') return plain('Das habe ich nicht verstanden. Wie viel hast du verbraucht?', { reprompt: 'Sag zum Beispiel: zwei.', attributes: { pending } })
      if (pending?.ask === 'offer') return plain('Das habe ich nicht verstanden. Soll ich es eintragen?', { reprompt: 'Sag ja oder nein.', attributes: { pending } })
      return plain('Das habe ich nicht verstanden. ' + HELP, { reprompt: 'Was möchtest du?', attributes: pending ? { pending } : {} })
  }
}
