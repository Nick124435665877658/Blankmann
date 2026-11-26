// Tests für den Alexa-Skill (0.3.54, Vorrat erfassen/ansagen 0.3.61). Aufruf: npm run test:alexa
// Die Datenbank wird im Speicher nachgebaut (gleiche Regeln wie die Funktionen alexa_* in Supabase).
import type { AlexaFood, AlexaNewItem } from '../src/lib/alexaAdd.ts'
import { parseCategory, parseDate, parsePlace } from '../src/lib/alexaAdd.ts'
import { checkEnvelope, handleAlexa, matchPantry, speakAmount, splitFoodPhrase, type AlexaBackend, type AlexaPantryRow, type AlexaRequest, type AlexaResponse } from '../src/lib/alexaSkill.ts'

let failed = 0
const expect = (condition: boolean, message: string, detail?: unknown) => {
  if (condition) console.log('  ok     ' + message)
  else { failed++; console.log('  FEHLER ' + message + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')) }
}

const USER = 'amzn1.ask.account.AMATESTUSER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const APP = 'amzn1.ask.skill.12345678-aaaa-bbbb-cccc-1234567890ab'
const row = (id: string, name: string, quantity: number | null, unit: string | null, food_name: string | null = null, best_before: string | null = null, food_item_id: string | null = null): AlexaPantryRow =>
  ({ id, name, quantity, unit, best_before, food_item_id: food_item_id ?? (food_name ? 'f-' + food_name : null), food_name, is_organic: false })

function fakeBackend(start: AlexaPantryRow[], status: 'linked' | 'pending' = 'linked', catalog: AlexaFood[] = []) {
  let pantry = start.map(r => ({ ...r }))
  const log: { label: string; before: AlexaPantryRow[]; deleted: boolean; added?: string }[] = []
  const added: AlexaNewItem[] = []
  const calls: string[] = []
  const backend: AlexaBackend = {
    async context() { calls.push('context'); return status === 'pending' ? { status: 'pending', code: '4711' } : { status: 'linked', pantry: pantry.map(r => ({ ...r })) } },
    async apply(label, updates) {
      calls.push('apply:' + label)
      const before = updates.map(u => ({ ...pantry.find(r => r.id === u.id)! }))
      for (const u of updates) { const r = pantry.find(p => p.id === u.id); if (!r || u.quantity < 0) throw new Error('ungültig'); r.quantity = u.quantity }
      log.push({ label, before, deleted: false })
    },
    async remove(label, ids) {
      calls.push('remove:' + label)
      const before = pantry.filter(r => ids.includes(r.id)).map(r => ({ ...r }))
      pantry = pantry.filter(r => !ids.includes(r.id))
      log.push({ label, before, deleted: true })
    },
    async undo() {
      calls.push('undo')
      const last = log.pop()
      if (!last) return { ok: false }
      if (last.added) pantry = pantry.filter(r => r.id !== last.added)
      for (const b of last.before) {
        if (last.deleted) pantry.push(b)
        else { const r = pantry.find(p => p.id === b.id); if (r) r.quantity = b.quantity }
      }
      return { ok: true, label: last.label }
    },
    async foods() { calls.push('foods'); return catalog },
    async add(label, item) {
      calls.push('add:' + label)
      const id = 'neu-' + added.push(item)
      pantry.push({ id, name: item.name, quantity: item.quantity, unit: item.unit, best_before: item.best_before, food_item_id: item.food_id ?? 'f-' + item.name, food_name: item.name, is_organic: item.is_organic, storage_location: item.storage_location })
      log.push({ label, before: [], deleted: false, added: id })
    },
  }
  return { backend, get pantry() { return pantry }, calls, added }
}

const now = new Date().toISOString()
const slot = (name: string, value?: string, resolved?: { name: string; id?: string }) => ({ name, value, ...(resolved ? { resolutions: { resolutionsPerAuthority: [{ status: { code: 'ER_SUCCESS_MATCH' }, values: [{ value: { name: resolved.name, id: resolved.id ?? resolved.name } }] }] } } : {}) })
function intent(name: string, slots: Record<string, ReturnType<typeof slot>> = {}, attributes: Record<string, unknown> = {}): AlexaRequest {
  return { version: '1.0', session: { new: false, attributes, application: { applicationId: APP }, user: { userId: USER } }, context: { System: { application: { applicationId: APP }, user: { userId: USER } } }, request: { type: 'IntentRequest', timestamp: now, intent: { name, slots } } }
}
const launch = (): AlexaRequest => ({ version: '1.0', session: { new: true, application: { applicationId: APP }, user: { userId: USER } }, request: { type: 'LaunchRequest', timestamp: now } })
const speech = (r: AlexaResponse) => { const o = r.response.outputSpeech; return !o ? '' : o.type === 'PlainText' ? o.text : o.ssml }
const used = (menge: string | undefined, food: string, einheit?: { value: string; id: string }, resolvedFood?: string) =>
  intent('VerbrauchIntent', { menge: slot('menge', menge), lebensmittel: slot('lebensmittel', food, resolvedFood ? { name: resolvedFood } : undefined), einheit: einheit ? slot('einheit', einheit.value, { name: einheit.value, id: einheit.id }) : slot('einheit') })

const pantry = () => [
  row('eier-alt', 'Eier', 2, 'Stk', 'Eier', '2026-11-25'),
  row('eier-neu', 'Bio Eier', 10, 'Stk', 'Eier', '2026-12-05'),
  row('butter', 'Dt Markenbutter', 750, 'g', 'Butter'),
  row('mehl', 'Weizenmehl Type 405', 1, 'kg', 'Mehl'),
  row('milch', 'Milch', 1000, 'ml', 'Milch'),
  row('kokosmilch', 'Kokosmilch', 400, 'ml', 'Kokosmilch'),
  row('paprika-rot', 'Paprika rot', 2, 'Stk', 'Paprika rot'),
  row('paprika-gelb', 'Paprika gelb', 1, 'Stk', 'Paprika gelb'),
  row('staerke', 'Feine Speisestärke', 1, 'Stk', 'Speisestärke'),
  row('kartoffeln', 'Kartoffeln', null, null, 'Kartoffeln', '2026-12-11'),
  row('champignons', 'Champignons', 250, 'g', 'Champignons'),
  row('zitrone', 'Zitrone', 3, 'Stk', 'Zitrone'),
]

console.log('1. Anfrage prüfen')
expect(checkEnvelope(launch()) === null, 'gültige Anfrage')
expect(checkEnvelope({ ...launch(), request: { type: 'LaunchRequest', timestamp: new Date(Date.now() - 200_000).toISOString() } }) === 'Zeitstempel ungültig', 'alte Anfrage (über 150 s) abgelehnt')
expect(checkEnvelope({ ...launch(), session: { application: { applicationId: APP }, user: { userId: 'hacker' } } }) === 'Nutzerkennung fehlt', 'falsche Nutzerkennung abgelehnt')
expect(checkEnvelope({ ...launch(), session: { application: { applicationId: 'x' }, user: { userId: USER } } }) === 'Skill-Kennung fehlt', 'falsche Skill-Kennung abgelehnt')
expect(checkEnvelope({} as AlexaRequest) !== null, 'leere Anfrage abgelehnt')

console.log('2. Lebensmittel finden')
const m = (said: string[]) => matchPantry(said, pantry())
const one = (said: string[], name: string) => { const r = m(said); return r.status === 'one' && r.name === name }
expect(one(['Eier'], 'Eier'), 'Eier → Eier')
expect(one(['ei'], 'Eier'), 'Ei (Einzahl) → Eier')
{ const r = m(['eier']); expect(r.status === 'one' && r.rows[0].id === 'eier-alt' && r.rows.length === 2, 'Bio und normal zusammen, frühestes MHD zuerst', r) }
expect(one(['butter'], 'Butter'), 'Butter → „Dt Markenbutter“ über den Katalognamen')
expect(one(['milch'], 'Milch'), 'Milch → Milch (nicht Kokosmilch)')
expect(one(['kokosmilch'], 'Kokosmilch'), 'Kokosmilch → Kokosmilch')
expect(m(['paprika']).status === 'many', 'Paprika → Rückfrage rot oder gelb')
expect(one(['paprika rot'], 'Paprika rot'), 'Paprika rot → Paprika rot')
expect(one(['champignon'], 'Champignons'), 'Champignon (Einzahl) → Champignons')
expect(one(['kartoffel'], 'Kartoffeln'), 'Kartoffel → Kartoffeln')
expect(one(['zitronen'], 'Zitrone'), 'Zitronen → Zitrone')
expect(m(['banane']).status === 'none', 'Banane → nicht im Vorrat')
expect(m(['ei']).status === 'one' && m(['reis']).status === 'none', 'kurzes „Ei“ trifft nicht „Weizenmehl“ o. ä.; Reis nicht da')
expect(one(['Speisestärke'], 'Speisestärke'), 'Speisestärke → „Feine Speisestärke“')
{ const only = matchPantry(['milch'], [row('k', 'Kokosmilch', 400, 'ml', 'Kokosmilch')]); expect(only.status === 'one' && only.name === 'Kokosmilch', 'nur Kokosmilch da → Milch nimmt Kokosmilch (Alexa sagt den Namen, Rückgängig möglich)') }

console.log('3. Mengen sprechen')
expect(speakAmount(3, 'Stk') === '3', '3 Stk → „3“')
expect(speakAmount(550, 'g') === '550 Gramm', '550 g → „550 Gramm“')
expect(speakAmount(1250, 'g') === '1,25 Kilo', '1250 g → „1,25 Kilo“')
expect(speakAmount(0.75, 'kg') === '750 Gramm', '0,75 kg → „750 Gramm“')
expect(speakAmount(1, 'Packung ') === '1 Packung' && speakAmount(2, 'Packung') === '2 Packungen', 'Packung/Packungen')
expect(speakAmount(1.5, 'l') === '1,5 Liter', '1,5 l → „1,5 Liter“')

console.log('4. Verbinden')
{
  const db = fakeBackend(pantry(), 'pending')
  const r = await handleAlexa(launch(), db.backend)
  expect(speech(r).includes('<say-as interpret-as="digits">4711</say-as>') && r.response.shouldEndSession === true, 'nicht verbunden → Code 4 7 1 1 wird angesagt', speech(r))
  expect(r.response.card?.content.includes('4711') === true, 'Code steht auch in der Alexa-App (Karte)')
  const r2 = await handleAlexa(used('3', 'eier'), db.backend)
  expect(speech(r2).includes('4711') && !db.calls.some(c => c.startsWith('apply')), 'ohne Verbindung wird nichts abgezogen')
}

console.log('5. Abziehen')
{
  const db = fakeBackend(pantry())
  const hello = await handleAlexa(launch(), db.backend)
  expect(speech(hello) === 'Hallo! Was hast du verbraucht?' && hello.response.shouldEndSession === false, 'Öffnen: „Hallo! Was hast du verbraucht?“')
  const r = await handleAlexa(used('3', 'eier'), db.backend)
  expect(db.pantry.find(p => p.id === 'eier-alt') === undefined || db.pantry.find(p => p.id === 'eier-alt')!.quantity === 0, 'frühestes MHD zuerst: alte Eier 2 → 0')
  expect(db.pantry.find(p => p.id === 'eier-neu')!.quantity === 9, 'dann neue Eier 10 → 9')
  expect(speech(r).startsWith('Okay, Eier minus 3. Noch 9 da, ein Eintrag ist jetzt leer. Sicher, dass du das Element Eier löschen willst?'), 'Antwort nennt Rest und fragt nach dem leeren Eintrag', speech(r))
  const pending = r.sessionAttributes
  const yes = await handleAlexa(intent('AMAZON.YesIntent', {}, pending), db.backend)
  expect(!db.pantry.some(p => p.id === 'eier-alt') && db.pantry.some(p => p.id === 'eier-neu'), 'Ja → nur der leere Eintrag wird gelöscht')
  expect(speech(yes) === 'Erledigt, Eier aus dem Vorrat gelöscht. Noch was?', 'Bestätigung + „Noch was?“', speech(yes))
  const undo = await handleAlexa(intent('RueckgaengigIntent'), db.backend)
  expect(db.pantry.some(p => p.id === 'eier-alt') && speech(undo).includes('Rückgängig gemacht: Eier gelöscht'), 'Rückgängig holt den gelöschten Eintrag zurück', speech(undo))
  const undo2 = await handleAlexa(intent('RueckgaengigIntent'), db.backend)
  expect(db.pantry.find(p => p.id === 'eier-neu')!.quantity === 10 && db.pantry.find(p => p.id === 'eier-alt')!.quantity === 2, 'zweimal Rückgängig → Eier wieder 2 + 10', speech(undo2))
  const undo3 = await handleAlexa(intent('RueckgaengigIntent'), db.backend)
  expect(speech(undo3).startsWith('Es gibt nichts'), 'nichts mehr zum Rückgängigmachen')
}
{
  const db = fakeBackend(pantry())
  const r = await handleAlexa(used('200', 'butter', { value: 'gramm', id: 'g' }), db.backend)
  expect(db.pantry.find(p => p.id === 'butter')!.quantity === 550 && speech(r) === 'Okay, Butter minus 200 Gramm. Noch 550 Gramm da. Noch was?', '200 Gramm Butter: 750 → 550', speech(r))
  const r2 = await handleAlexa(used('300', 'mehl', { value: 'gramm', id: 'g' }), db.backend)
  expect(db.pantry.find(p => p.id === 'mehl')!.quantity === 0.7 && speech(r2).includes('Noch 700 Gramm da'), '300 g Mehl von 1 kg → 0,7 kg („700 Gramm“)', speech(r2))
  const r3 = await handleAlexa(used('1', 'butter', { value: 'kilo', id: 'kg' }), db.backend)
  expect(db.pantry.find(p => p.id === 'butter')!.quantity === 0 && speech(r3).startsWith('Du hattest nur 550 Gramm Butter. Ich habe alles abgezogen. Sicher, dass du das Element Butter löschen willst?'), 'zu viel: alles abgezogen, dann Sicherheitsabfrage', speech(r3))
  const no = await handleAlexa(intent('AMAZON.NoIntent', {}, r3.sessionAttributes), db.backend)
  expect(db.pantry.some(p => p.id === 'butter') && speech(no) === 'Okay, Butter bleibt mit null im Vorrat. Noch was?', 'Nein → bleibt mit 0 im Vorrat', speech(no))
  const again = await handleAlexa(used('100', 'butter', { value: 'gramm', id: 'g' }), db.backend)
  expect(speech(again).startsWith('Butter ist laut Vorrat schon leer.'), 'bei 0 nochmal abziehen → nichts mehr da', speech(again))
  const done = await handleAlexa(intent('AMAZON.NoIntent'), db.backend)
  expect(done.response.shouldEndSession === true && speech(done) === 'Alles klar. Guten Appetit!', '„Noch was?“ → Nein beendet')
}
{
  const db = fakeBackend(pantry())
  const r = await handleAlexa(used('2', 'paprika'), db.backend)
  expect(speech(r) === 'Meinst du Paprika rot oder Paprika gelb?' && !db.calls.some(c => c.startsWith('apply')), 'mehrdeutig → Rückfrage, noch nichts abgezogen', speech(r))
  const r2 = await handleAlexa(intent('LebensmittelIntent', { lebensmittel: slot('lebensmittel', 'paprika rot') }, r.sessionAttributes), db.backend)
  expect(db.pantry.find(p => p.id === 'paprika-rot')!.quantity === 0 && db.pantry.find(p => p.id === 'paprika-gelb')!.quantity === 1, 'Antwort „Paprika rot“ → 2 rote abgezogen', speech(r2))
  const r3 = await handleAlexa(used(undefined, 'milch'), db.backend)
  expect(speech(r3) === 'Wie viel Milch hast du verbraucht?', 'ohne Menge → Rückfrage', speech(r3))
  const r4 = await handleAlexa(intent('MengeIntent', { menge: slot('menge', '250'), einheit: slot('einheit', 'milliliter', { name: 'Milliliter', id: 'ml' }) }, r3.sessionAttributes), db.backend)
  expect(db.pantry.find(p => p.id === 'milch')!.quantity === 750 && db.pantry.find(p => p.id === 'kokosmilch')!.quantity === 400, 'Antwort „250 Milliliter“ → Milch 1000 → 750, Kokosmilch bleibt', speech(r4))
  const r5 = await handleAlexa(used('50', 'speisestärke', { value: 'gramm', id: 'g' }), db.backend)
  expect(speech(r5).startsWith('Speisestärke ist in Stück eingetragen, nicht in Gramm.') && db.pantry.find(p => p.id === 'staerke')!.quantity === 1, 'Einheit passt nicht → Hinweis, nichts geändert', speech(r5))
  const r6 = await handleAlexa(used('3', 'kartoffeln'), db.backend)
  expect(speech(r6).startsWith('Bei Kartoffeln ist keine Menge eingetragen.'), 'ohne Menge im Vorrat → Hinweis', speech(r6))
  const r7 = await handleAlexa(used('2', 'bananen'), db.backend)
  expect(speech(r7) === 'bananen habe ich im Vorrat nicht gefunden. Soll ich es eintragen?', 'nicht im Vorrat → Angebot zum Eintragen', speech(r7))
  const r8 = await handleAlexa(intent('EinsIntent', { lebensmittel: slot('lebensmittel', 'zitrone') }), db.backend)
  expect(db.pantry.find(p => p.id === 'zitrone')!.quantity === 2 && speech(r8) === 'Okay, Zitrone minus 1. Noch 2 da. Noch was?', '„eine Zitrone“ → minus 1', speech(r8))
  const r9 = await handleAlexa(used('100', 'champignon', { value: 'gramm', id: 'g' }, 'Champignons'), db.backend)
  expect(db.pantry.find(p => p.id === 'champignons')!.quantity === 150, 'Katalog-Auflösung „Champignons“ wird genutzt', speech(r9))
}

console.log('5b. Alles im Lebensmittel-Feld')
{
  const a = splitFoodPhrase('ein Ei'), b = splitFoodPhrase('Packung Mehl'), c = splitFoodPhrase('die Eier'), d = splitFoodPhrase('Eier'), e = splitFoodPhrase('eine Dose von Tomaten')
  expect(a.one && a.food === 'Ei' && b.unit === 'Packung' && b.food === 'Mehl' && c.food === 'Eier' && !c.one && d.food === 'Eier' && e.one && e.unit === 'Dose' && e.food === 'Tomaten', '„ein Ei“, „Packung Mehl“, „die Eier“, „eine Dose von Tomaten“ werden zerlegt', [a, b, c, e])
  const db = fakeBackend(pantry())
  const r = await handleAlexa(used(undefined, 'ein ei'), db.backend)
  expect(db.pantry.find(p => p.id === 'eier-alt')!.quantity === 1 && speech(r).startsWith('Okay, Eier minus 1.'), 'Verbrauch mit „ein Ei“ im Lebensmittel-Feld → minus 1', speech(r))
}

console.log('6. Nachfragen, Hilfe, Ende')
{
  const db = fakeBackend(pantry())
  const s = await handleAlexa(intent('BestandIntent', { lebensmittel: slot('lebensmittel', 'eier') }), db.backend)
  expect(speech(s) === 'Eier: noch 12 da. Noch was?', 'Wie viele Eier? → 12 (2 + 10)', speech(s))
  const s2 = await handleAlexa(intent('BestandIntent', { lebensmittel: slot('lebensmittel', 'kartoffeln') }), db.backend)
  expect(speech(s2).includes('ohne Menge'), 'Kartoffeln ohne Menge', speech(s2))
  const s3 = await handleAlexa(intent('BestandIntent', { lebensmittel: slot('lebensmittel', 'paprika') }), db.backend)
  expect(speech(s3) === 'Im Vorrat: Paprika rot: 2, Paprika gelb: 1. Noch was?', 'Paprika → beide genannt', speech(s3))
  const h = await handleAlexa(intent('AMAZON.HelpIntent'), db.backend)
  expect(speech(h).startsWith('Sag zum Beispiel') && h.response.shouldEndSession === false, 'Hilfe')
  const before = db.calls.length
  const stop = await handleAlexa(intent('AMAZON.StopIntent'), db.backend)
  expect(stop.response.shouldEndSession === true && db.calls.length === before, 'Stopp beendet ohne Datenbank')
  const ended = await handleAlexa({ ...intent('x'), request: { type: 'SessionEndedRequest', timestamp: now } }, db.backend)
  expect(ended.response.outputSpeech === undefined, 'Sitzungsende → leere Antwort')
  const fb = await handleAlexa(intent('AMAZON.FallbackIntent'), db.backend)
  expect(speech(fb).startsWith('Das habe ich nicht verstanden.'), 'nicht verstanden → Hilfe')
  const fb2 = await handleAlexa(intent('AMAZON.FallbackIntent', {}, { pending: { ask: 'delete', ids: ['x'], name: 'Eier' } }), db.backend)
  expect(speech(fb2).includes('Sicher, dass du das Element Eier löschen willst?') && (fb2.sessionAttributes?.pending as { ask: string }).ask === 'delete', 'bei offener Löschfrage wird nachgefragt, nichts gelöscht')
}

const food = (name: string, category: string, default_unit: string | null = null): AlexaFood => ({ id: 'f-' + name, name, category, default_unit })
const catalog = [food('Eier', 'Milchprodukte & Eier'), food('Milch', 'Milchprodukte & Eier', 'ml'), food('Mehl', 'Getreide & Backwaren', 'g'), food('Banane', 'Obst'), food('Kokosmilch', 'Hülsenfrüchte & Konserven'), food('Paprika rot', 'Gemüse'), food('Paprika gelb', 'Gemüse')]
const at = '2026-11-26T09:00:00Z'
const stamped = (r: AlexaRequest): AlexaRequest => ({ ...r, request: { ...r.request, timestamp: at } })
// Ein Gespräch: die Sitzungsdaten der letzten Antwort gehen in die nächste Anfrage.
function talk(db: ReturnType<typeof fakeBackend>) {
  let attributes: Record<string, unknown> = {}
  let last: AlexaResponse
  const say = async (name: string, slots: Record<string, ReturnType<typeof slot>> = {}) => {
    last = await handleAlexa(stamped(intent(name, slots, attributes)), db.backend)
    attributes = last.sessionAttributes ?? {}
    return speech(last)
  }
  // Getter erst hier definieren: Object.assign würde nur den Anfangswert kopieren.
  return Object.defineProperties(say, { last: { get: () => last }, attributes: { get: () => attributes } }) as typeof say & { readonly last: AlexaResponse; readonly attributes: Record<string, unknown> }
}
const what = (name: string, menge?: string, einheit?: string, lagerort?: string) => ({
  lebensmittel: slot('lebensmittel', name), menge: slot('menge', menge),
  einheit: einheit ? slot('einheit', einheit, { name: einheit, id: einheit }) : slot('einheit'), lagerort: slot('lagerort', lagerort),
})
const text = (t: string) => ({ lebensmittel: slot('lebensmittel', t) })

console.log('7. Eintragen: bekanntes Lebensmittel, fehlende Angaben werden erfragt')
{
  const db = fakeBackend([], 'linked', catalog)
  const say = talk(db)
  let a = await say('HinzufuegenIntent', what('eier'))
  expect(a === 'Eier: wie viel?', 'ohne Menge → Rückfrage', a)
  a = await say('MengeIntent', { menge: slot('menge', '6') })
  expect(a === 'Eier: wohin? Ich schlage Kühlschrank vor. Passt das?', 'Lagerort mit Vorschlag', a)
  a = await say('AMAZON.YesIntent')
  expect(a === 'Eier: bis wann haltbar? Sag ein Datum, oder: ohne.' && db.added.length === 0, 'Haltbarkeit; noch nichts gespeichert', a)
  a = await say('DatumIntent', { datum: slot('datum', '2026-12-10') })
  expect(a === 'Okay, Eier plus 6, Kühlschrank, haltbar bis 10. Dezember. Noch was?', 'gespeichert und bestätigt', a)
  const item = db.added[0]
  expect(item.food_id === 'f-Eier' && item.quantity === 6 && item.unit === 'Stk' && item.storage_location === 'Kühlschrank' && item.best_before === '2026-12-10' && item.category === 'Milchprodukte & Eier', 'alle Felder befüllt', item)
  a = await say('RueckgaengigIntent')
  expect(db.pantry.length === 0 && a.startsWith('Rückgängig gemacht: Eier plus 6.'), 'Rückgängig nimmt den Eintrag zurück', a)
}

console.log('8. Eintragen: Unbekanntes wird nach Ja neu angelegt')
{
  const db = fakeBackend([], 'linked', catalog)
  const say = talk(db)
  let a = await say('HinzufuegenIntent', what('hafer drink'))
  expect(a === 'Hafer Drink kenne ich noch nicht. Soll ich es neu anlegen?', 'unbekannt → erst fragen', a)
  a = await say('AMAZON.YesIntent')
  expect(a === 'Hafer Drink: wie viel?', 'Menge', a)
  a = await say('MengeIntent', { menge: slot('menge', '2'), einheit: slot('einheit', 'packungen', { name: 'Packung', id: 'Packung' }) })
  expect(a.startsWith('Hafer Drink: welche Kategorie?'), 'Kategorie', a)
  a = await say('KategorieIntent', { kategorie: slot('kategorie', 'getränke', { name: 'Getränke' }) })
  expect(a.startsWith('Hafer Drink: wohin? Ich schlage Vorratsschrank vor.'), 'Lagerort', a)
  a = await say('AMAZON.NoIntent')
  expect(a === 'Hafer Drink: wohin? Kühlschrank, Gefrierfach, Vorratsschrank oder Keller?', 'Nein zum Vorschlag → Auswahl, Gespräch bleibt offen', a)
  a = await say('LagerortIntent', { lagerort: slot('lagerort', 'keller', { name: 'Keller' }) })
  expect(a.startsWith('Hafer Drink: bis wann haltbar?'), 'Haltbarkeit', a)
  a = await say('OhneIntent')
  expect(a === 'Okay, Hafer Drink plus 2 Packungen, Keller, ohne Haltbarkeitsdatum. Neu angelegt unter Getränke. Noch was?', 'gespeichert', a)
  const item = db.added[0]
  expect(item.food_id === null && item.category === 'Getränke' && item.unit === 'Packung' && item.storage_location === 'Keller' && item.best_before === null, 'neues Nahrungsmittel mit Kategorie', item)
}
{
  const db = fakeBackend([], 'linked', catalog)
  const say = talk(db)
  await say('HinzufuegenIntent', what('quittengelee'))
  const a = await say('AMAZON.NoIntent')
  expect(a === 'Okay, ich lege Quittengelee nicht an. Noch was?' && db.added.length === 0 && say.last.response.shouldEndSession === false, 'Nein → nichts angelegt', a)
}
{
  const db = fakeBackend([], 'linked', catalog)
  const say = talk(db)
  let a = await say('HinzufuegenIntent', what('paprika', '2'))
  expect(a === 'Paprika kenne ich noch nicht. Ähnlich ist Paprika rot oder Paprika gelb. Sag den Namen, oder: neu anlegen.', 'ähnliche Namen werden angeboten', a)
  a = await say('LebensmittelIntent', text('paprika rot'))
  expect(a.startsWith('Paprika rot: wohin?'), 'Auswahl übernimmt Menge 2', a)
}

console.log('9. Automatisches MHD, große Zahlen, alles in einem Satz')
{
  const db = fakeBackend([], 'linked', catalog)
  const say = talk(db)
  let a = await say('HinzufuegenIntent', what('bananen', '5', undefined, 'vorratsschrank'))
  expect(a === 'Okay, Banane plus 5, Vorratsschrank, haltbar bis 1. Dezember. Noch was?', 'Obst: MHD automatisch (+5 Tage), keine Rückfrage', a)
  a = await say('HinzufuegenIntent', what('mehl', '500', undefined, 'schrank'))
  expect(a.startsWith('Mehl: bis wann haltbar?'), '„500 Mehl“ → Einheit g aus dem Katalog', a)
  a = await say('WochenIntent', { menge: slot('menge', '2') })
  expect(a === 'Okay, Mehl plus 500 Gramm, Vorratsschrank, haltbar bis 10. Dezember. Noch was?', '„in zwei Wochen“', a)
  a = await say('HinzufuegenIntent', what('reispapier', '30'))
  await say('AMAZON.YesIntent')
  expect(say.attributes.pending !== undefined && (say.attributes.pending as { step: string }).step === 'unit', 'große Zahl ohne Einheit und ohne Katalog → Einheit erfragen', say.attributes.pending)
}

{
  // „Gramm“ / „ein Kilo“ erkennt Alexa manchmal als Lebensmittel – als Antwort zählt es trotzdem als Einheit.
  const db = fakeBackend([], 'linked', [food('Salz', 'Kräuter & Gewürze')])
  const say = talk(db)
  await say('HinzufuegenIntent', what('salz', '500'))
  const a = await say('LebensmittelIntent', text('gramm'))
  expect(a.startsWith('Salz: wohin?') && (say.attributes.pending as { draft: { unit: string } }).draft.unit === 'g', 'Antwort „Gramm“', a)
  await say('HinzufuegenIntent', what('salz'))
  const b = await say('AngabeEinsIntent', text('kilo'))
  const d = (say.attributes.pending as { draft: { quantity: number; unit: string } }).draft
  expect(d.quantity === 1 && d.unit === 'kg', 'Antwort „ein Kilo“', [b, d])
}

{
  const db = fakeBackend([], 'linked', catalog)
  const say = talk(db)
  await say('HinzufuegenIntent', what('mehl'))
  let a = await say('AngabeIntent', what('eier', '6'))
  expect(a === 'Erst noch das hier. Mehl: wie viel?', 'anderes Lebensmittel bei der Mengenfrage wird nicht als Menge übernommen', a)
  a = await say('AngabeIntent', what('mehl', '500', 'g'))
  expect(a.startsWith('Mehl: wohin?'), 'Name wiederholen ist erlaubt', a)
  a = await say('HinzufuegenIntent', what('es', undefined, undefined, 'keller'))
  expect(a.startsWith('Mehl: bis wann haltbar?') && (say.attributes.pending as { draft: { place: string } }).draft.place === 'Keller', '„pack es in den Keller“ beantwortet die Ortsfrage', a)
}

console.log('10. Gleiche Zeile aufstocken, Gesamtmenge nennen')
{
  const start = [{ ...row('e1', 'Eier', 4, 'Stk', 'Eier', '2026-12-10'), storage_location: 'Kühlschrank' }]
  const db = fakeBackend(start, 'linked', catalog)
  const say = talk(db)
  await say('HinzufuegenIntent', what('eier', '6'))
  await say('AMAZON.YesIntent')
  const a = await say('DatumIntent', { datum: slot('datum', '2026-12-10') })
  expect(db.pantry.length === 1 && db.pantry[0].quantity === 10 && db.added.length === 0 && a.includes('Insgesamt jetzt 10.'), 'gleicher Ort und MHD → 4 + 6', a)
}

console.log('11. Erfassen-Modus: „sechs Eier“ ohne Verb')
{
  const db = fakeBackend(pantry(), 'linked', catalog)
  const say = talk(db)
  let a = await say('ErfassenIntent')
  expect(a.startsWith('Okay. Nenn mir, was du da hast'), 'Start', a)
  a = await say('AngabeIntent', what('bananen', '3'))
  expect(a.startsWith('Banane: wohin?') && !db.calls.some(c => c.startsWith('apply')), 'im Erfassen-Modus wird eingetragen, nicht abgezogen', a)
  a = await say('AMAZON.YesIntent')
  expect(say.last.response.reprompt?.outputSpeech.text === 'Noch was? Sag zum Beispiel: sechs Eier. Oder: fertig.', 'Nachfrage passt zum Modus', say.last.response.reprompt)
  a = await say('VerbrauchIntent', what('zitrone', '1'))
  expect(a.startsWith('Okay, Zitrone minus 1.'), '„verbraucht“ zieht weiter ab', a)
  a = await say('AngabeIntent', what('zitrone', '1'))
  expect(a.startsWith('Okay, Zitrone minus 1.'), 'danach gilt „eine Zitrone“ wieder als verbraucht', a)
  const fresh = fakeBackend(pantry(), 'linked', catalog)
  const b = await talk(fresh)('AngabeIntent', what('zitrone', '1'))
  expect(b.startsWith('Okay, Zitrone minus 1.'), 'ohne Erfassen-Modus wie bisher: abziehen', b)
}

console.log('12. Abbrechen und Zwischenfragen')
{
  const db = fakeBackend(pantry(), 'linked', catalog)
  const say = talk(db)
  await say('HinzufuegenIntent', what('eier', '6'))
  let a = await say('BestandIntent', text('zitrone'))
  expect(a.startsWith('Eier habe ich nicht gespeichert. Zitrone: noch 3 da.') && db.added.length === 0, 'Zwischenfrage: Entwurf wird verworfen und das gesagt', a)
  await say('HinzufuegenIntent', what('eier', '6'))
  a = await say('AMAZON.CancelIntent')
  expect(a === 'Okay, Eier habe ich nicht gespeichert. Noch was?' && db.added.length === 0, 'Abbrechen', a)
  await say('HinzufuegenIntent', what('eier', '6'))
  a = await say('AMAZON.StopIntent')
  expect(a === 'Alles klar. Eier habe ich nicht gespeichert. Guten Appetit!' && say.last.response.shouldEndSession === true, 'Stopp', a)
  await say('HinzufuegenIntent', what('eier', '6'))
  a = await say('AMAZON.FallbackIntent')
  expect(a.startsWith('Das habe ich nicht verstanden. Eier: wohin?'), 'nicht verstanden → Frage wiederholen', a)
}
{
  const db = fakeBackend(pantry(), 'linked', catalog)
  const say = talk(db)
  await say('BestandIntent', text('bananen'))
  const a = await say('AMAZON.YesIntent')
  expect(a === 'Banane: wie viel?', '„nicht im Vorrat – eintragen?“ → Ja startet die Eintragung', a)
}

console.log('13. Vorrat ansagen')
{
  const placed = (id: string, name: string, quantity: number | null, unit: string | null, where: string) => ({ ...row(id, name, quantity, unit, name), storage_location: where })
  const db = fakeBackend([placed('1', 'Milch', 1000, 'ml', 'Kühlschrank'), placed('2', 'Eier', 6, 'Stk', 'Kühlschrank'), placed('3', 'Reis', null, null, 'Vorratsschrank'), placed('4', 'Butter', 0, 'g', 'Kühlschrank')])
  const a = await talk(db)('VorratAnsageIntent')
  expect(a === 'Im Kühlschrank: Eier 6, Milch 1 Liter. Im Vorratsschrank: Reis. Noch was?', 'wenig → alles nach Orten, Leeres fehlt', a)
  const b = await talk(db)('VorratAnsageIntent', { lagerort: slot('lagerort', 'keller') })
  expect(b === 'Im Keller ist nichts eingetragen. Noch was?', 'leerer Ort', b)
  const many = fakeBackend(Array.from({ length: 23 }, (_, i) => placed('m' + i, 'Ding' + String.fromCharCode(65 + i), 1, 'Stk', i < 13 ? 'Kühlschrank' : 'Keller')))
  const say = talk(many)
  let c = await say('VorratAnsageIntent')
  expect(c === 'Du hast 23 Sachen: 13 im Kühlschrank, 10 im Keller. Welchen Ort soll ich vorlesen? Oder: alles.', 'viel → erst Übersicht', c)
  c = await say('LagerortIntent', { lagerort: slot('lagerort', 'kühlschrank') })
  expect(c.includes('DingA 1') && c.endsWith('Noch 3 weitere. Sag weiter, oder: fertig.'), 'je 10', c)
  c = await say('AMAZON.NextIntent')
  expect(c === 'Im Kühlschrank: DingK 1, DingL 1, DingM 1. Noch was?', 'weiter', c)
}

console.log('14. Deuten von Datum, Ort, Kategorie')
{
  const d = (raw: string) => parseDate(raw, '2026-11-26')
  expect(d('2026-12') === '2026-12-31' && d('2026-W50') === '2026-12-13' && d('2027') === '2027-12-31' && d('2026-01-10') === '2027-01-10' && d('quatsch') === null, 'Monat, Woche, Jahr, vergangenes Datum → nächstes Jahr', [d('2026-12'), d('2026-W50'), d('2026-01-10')])
  expect(parsePlace('tiefkühlfach') === 'Gefrierfach' && parsePlace('kühlschrank') === 'Kühlschrank' && parsePlace('speisekammer') === 'Vorratsschrank' && parsePlace('balkon') === null, 'Lagerorte')
  expect(parseCategory('Milchprodukte und Eier') === 'Milchprodukte & Eier' && parseCategory('Hülsenfrüchte und Konserven') === 'Hülsenfrüchte & Konserven' && parseCategory('Süßes') === 'Backen & Süßes' && parseCategory('Öle') === 'Öle & Saucen' && parseCategory('Backwaren') === 'Getreide & Backwaren', 'Kategorien')
}

console.log('15. Sprachmodell passt zum Code')
{
  const { readFileSync } = await import('node:fs')
  const model = JSON.parse(readFileSync(new URL('../alexa/interaction-model-de-DE.json', import.meta.url), 'utf8')).interactionModel.languageModel
  const code = readFileSync(new URL('../src/lib/alexaSkill.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/lib/alexaAdd.ts', import.meta.url), 'utf8')
  // KategorieIntent und DatumIntent sind reine Antworten: der Code liest ihre Slots.
  const missing = (model.intents as { name: string }[]).map(i => i.name).filter(n => !n.startsWith('AMAZON.') && !['KategorieIntent', 'DatumIntent'].includes(n) && !code.includes("'" + n + "'"))
  expect(missing.length === 0, 'jeder eigene Intent wird behandelt', missing)
  const types = new Set((model.types as { name: string }[]).map(t => t.name))
  const unknown = (model.intents as { slots?: { type: string }[] }[]).flatMap(i => i.slots ?? []).filter(s => !s.type.startsWith('AMAZON.') && !types.has(s.type))
  expect(unknown.length === 0, 'alle Slot-Typen vorhanden', unknown)
}

console.log(failed ? '\n' + failed + ' Prüfung(en) fehlgeschlagen' : '\nAlle Prüfungen bestanden')
process.exit(failed ? 1 : 0)
