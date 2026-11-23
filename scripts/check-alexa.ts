// Tests für den Alexa-Skill (0.3.54). Aufruf: npm run test:alexa
// Die Datenbank wird im Speicher nachgebaut (gleiche Regeln wie die Funktionen alexa_* in Supabase).
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

function fakeBackend(start: AlexaPantryRow[], status: 'linked' | 'pending' = 'linked') {
  let pantry = start.map(r => ({ ...r }))
  const log: { label: string; before: AlexaPantryRow[]; deleted: boolean }[] = []
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
      for (const b of last.before) {
        if (last.deleted) pantry.push(b)
        else { const r = pantry.find(p => p.id === b.id); if (r) r.quantity = b.quantity }
      }
      return { ok: true, label: last.label }
    },
  }
  return { backend, get pantry() { return pantry }, calls }
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
  expect(speech(r7) === 'bananen habe ich im Vorrat nicht gefunden. Noch was?', 'nicht im Vorrat → Hinweis', speech(r7))
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

console.log(failed ? '\n' + failed + ' Prüfung(en) fehlgeschlagen' : '\nAlle Prüfungen bestanden')
process.exit(failed ? 1 : 0)
