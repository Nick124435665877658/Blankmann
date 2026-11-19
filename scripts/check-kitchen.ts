// Tests für Preisschätzung und Vorrat. Aufruf: npm run test:kitchen
import { buildRecipeMessages, parseRecipeAnswer } from '../src/lib/recipeAi.ts'
import { estimateCost, estimateRecipeCost, instructionSteps, manualPriceRow, pantryAmountFromReceipt, planPantryAddition, planPantryDeduction, recipeNeeds, type FoodRef, type PantryRow, type PriceRow } from '../src/lib/kitchen.ts'

let failed = 0
const expect = (condition: boolean, message: string) => {
  if (condition) console.log('  ok     ' + message)
  else { failed++; console.log('  FEHLER ' + message) }
}
const near = (a: number | null | undefined, b: number) => a !== null && a !== undefined && Math.abs(a - b) < 0.005

const foods: FoodRef[] = [
  { id: 'butter', name: 'Butter', normalized_name: 'butter', default_unit: 'g' },
  { id: 'kartoffel', name: 'Kartoffeln', normalized_name: 'kartoffeln', default_unit: 'g' },
  { id: 'ei', name: 'Eier', normalized_name: 'eier', default_unit: 'Stk' },
  { id: 'milch', name: 'Milch', normalized_name: 'milch', default_unit: 'ml' },
  { id: 'petersilie', name: 'Petersilie', normalized_name: 'petersilie', default_unit: null },
  { id: 'salz', name: 'Salz', normalized_name: 'salz', default_unit: 'g' },
]
const prices: PriceRow[] = [
  { food_item_id: 'butter', price_eur: 1.15, package_quantity: 250, package_unit: 'g', unit_price_eur: 4.6, unit_label: '€/kg', observed_at: '2026-11-18' },
  { food_item_id: 'butter', price_eur: 2.49, package_quantity: 250, package_unit: 'g', unit_price_eur: null, unit_label: null, observed_at: '2026-06-01' },
  { food_item_id: 'kartoffel', price_eur: 2.99, package_quantity: 2.5, package_unit: 'kg', unit_price_eur: null, unit_label: null, observed_at: '2026-06-01' },
  { food_item_id: 'ei', price_eur: 3.29, package_quantity: 10, package_unit: 'Stk', unit_price_eur: null, unit_label: null, observed_at: '2026-11-18' },
  { food_item_id: 'milch', price_eur: 1.09, package_quantity: null, package_unit: null, unit_price_eur: 1.09, unit_label: '€/l', observed_at: '2026-06-01' },
  { food_item_id: 'petersilie', price_eur: 0.99, package_quantity: 1, package_unit: 'Bund', unit_price_eur: null, unit_label: null, observed_at: '2026-06-01' },
]

console.log('\n1) Preisschätzung')
expect(near(estimateCost({ name: 'Butter', food_item_id: 'butter', quantity: 50, unit: 'g' }, foods, prices).cost, 0.23), '50 g Butter aus 250 g für 1,15 € (neuester Preis vom Bon) = 0,23 €')
expect(near(estimateCost({ name: 'Kartoffeln', food_item_id: 'kartoffel', quantity: 500, unit: 'g' }, foods, prices).cost, 0.598), '500 g Kartoffeln aus 2,5 kg für 2,99 € = 0,60 €')
expect(near(estimateCost({ name: 'Eier', food_item_id: 'ei', quantity: 3, unit: 'Stück' }, foods, prices).cost, 0.987), '3 Eier aus 10er-Packung 3,29 € = 0,99 €')
expect(near(estimateCost({ name: 'Milch', food_item_id: 'milch', quantity: 200, unit: 'ml' }, foods, prices).cost, 0.218), '200 ml Milch bei 1,09 €/l = 0,22 €')
expect(near(estimateCost({ name: 'Petersilie', food_item_id: 'petersilie', quantity: 1, unit: 'Bund' }, foods, prices).cost, 0.99), '1 Bund Petersilie = 0,99 €')
{
  const open = estimateCost({ name: 'Butter', food_item_id: 'butter', quantity: null, unit: 'g' }, foods, prices)
  expect(open.basis === 'package' && near(open.cost, 1.15), 'Menge offen → eine Packung angesetzt und markiert')
  const odd = estimateCost({ name: 'Butter', food_item_id: 'butter', quantity: 2, unit: 'EL' }, foods, prices)
  expect(odd.basis === 'package', 'EL nicht in g umrechenbar → Packung angesetzt und markiert')
  const missing = estimateCost({ name: 'Salz', food_item_id: 'salz', quantity: 5, unit: 'g' }, foods, prices)
  expect(missing.basis === 'missing' && missing.cost === null, 'Salz ohne Preis → „Preis fehlt“')
  const byName = estimateCost({ name: 'eier', food_item_id: null, quantity: 2, unit: 'Stk' }, foods, prices)
  expect(byName.foodId === 'ei' && near(byName.cost, 0.658), 'Zutat ohne Katalog-Verknüpfung wird über den Namen gefunden')
}
{
  const recipe = { servings: 2, recipe_ingredients: [
    { name: 'Kartoffeln', food_item_id: 'kartoffel', quantity: 500, unit: 'g' },
    { name: 'Butter', food_item_id: 'butter', quantity: 20, unit: 'g' },
    { name: 'Salz', food_item_id: 'salz', quantity: 2, unit: 'g' },
    { name: 'Petersilie', food_item_id: 'petersilie', quantity: 1, unit: 'Bund', is_optional: true },
  ] }
  const two = estimateRecipeCost(recipe, 2, foods, prices)
  const four = estimateRecipeCost(recipe, 4, foods, prices)
  expect(near(two.total, 0.69), 'Rezept für 2 Portionen ≈ 0,69 € (optionale Zutaten nicht gezählt)')
  expect(near(four.total, 1.38), 'Rezept für 4 Portionen = doppelte Mengen ≈ 1,38 €')
  expect(two.missing.length === 1 && two.missing[0].name === 'Salz', 'fehlender Preis (Salz) wird aufgelistet')
}
{
  const row = manualPriceRow(1.99, 500, 'g')
  expect(row.price_eur === 1.99 && row.unit_price_eur === 3.98 && row.unit_label === '€/kg', 'Manueller Preis 1,99 € für 500 g → 3,98 €/kg')
  const piece = manualPriceRow(0.5, 1, 'Stk')
  expect(piece.unit_price_eur === null && piece.package_unit === 'Stk', 'Manueller Stückpreis ohne €/kg')
}

console.log('\n2) Bon → Vorrat')
expect(JSON.stringify(pantryAmountFromReceipt({ quantity: 2, unit: 'stk' }, { package_quantity: 250, package_unit: 'g' })) === '{"quantity":500,"unit":"g"}', '2 Stk Butter mit bekannter 250-g-Packung → 500 g')
expect(JSON.stringify(pantryAmountFromReceipt({ quantity: null, unit: null }, { package_quantity: 10, package_unit: 'Stk' })) === '{"quantity":10,"unit":"Stk"}', 'Eier ohne Menge, 10er-Packung → 10 Stk')
expect(JSON.stringify(pantryAmountFromReceipt({ quantity: 2, unit: 'stk' }, { package_quantity: 1, package_unit: 'Stk' })) === '{"quantity":2,"unit":"Stk"}', '2 Brötchen (Stückpreis) → 2 Stk')
expect(JSON.stringify(pantryAmountFromReceipt({ quantity: null, unit: null }, { package_quantity: 1, package_unit: 'kg' })) === '{"quantity":1,"unit":"kg"}', 'ohne Menge, Packung 1 kg → 1 kg')
expect(JSON.stringify(pantryAmountFromReceipt({ quantity: null, unit: null })) === '{"quantity":1,"unit":"Stk"}', 'ganz ohne Angaben → 1 Stk')
{
  const pantry: PantryRow[] = [{ id: 'p1', name: 'Butter', quantity: 100, unit: 'g', food_item_id: 'butter' }]
  const add = planPantryAddition(pantry, { name: 'Butter', foodId: 'butter', quantity: 0.25, unit: 'kg' })
  expect(add.update?.id === 'p1' && add.update.quantity === 350, 'vorhandene 100 g + 0,25 kg = 350 g (gleiche Zeile)')
  const fresh = planPantryAddition(pantry, { name: 'Milch', foodId: 'milch', quantity: 1, unit: 'l' })
  expect(Boolean(fresh.insert) && fresh.insert?.name === 'Milch', 'neues Nahrungsmittel → neue Vorratszeile')
}

console.log('\n3) „Gekocht“ → Vorrat abziehen')
{
  const pantry: PantryRow[] = [
    { id: 'k1', name: 'Kartoffeln', quantity: 2, unit: 'kg', food_item_id: 'kartoffel', best_before: '2026-12-01' },
    { id: 'b1', name: 'Butter', quantity: 15, unit: 'g', food_item_id: 'butter', best_before: '2026-11-20' },
    { id: 'b2', name: 'Butter', quantity: 250, unit: 'g', food_item_id: 'butter', best_before: '2026-12-20' },
    { id: 'e1', name: 'Eier', quantity: null, unit: null, food_item_id: 'ei' },
  ]
  const recipe = { servings: 2, recipe_ingredients: [
    { name: 'Kartoffeln', food_item_id: 'kartoffel', quantity: 500, unit: 'g' },
    { name: 'Butter', food_item_id: 'butter', quantity: 20, unit: 'g' },
    { name: 'Eier', food_item_id: 'ei', quantity: 2, unit: 'Stk' },
    { name: 'Milch', food_item_id: 'milch', quantity: 100, unit: 'ml' },
  ] }
  const plan = planPantryDeduction(recipeNeeds(recipe, 2), pantry)
  expect(plan.updates.some(u => u.id === 'k1' && u.quantity === 1.5), '2 kg − 500 g Kartoffeln → 1,5 kg Rest bleibt')
  expect(plan.deletes.includes('b1') && plan.updates.some(u => u.id === 'b2' && u.quantity === 245), 'Butter: ältere 15 g aufgebraucht (gelöscht), von 250 g bleiben 245 g')
  expect(plan.unconvertible.some(s => s.startsWith('Eier')), 'Eier im Vorrat ohne Menge → nicht abgezogen, gemeldet')
  expect(plan.missing.some(s => s.startsWith('Milch')), 'Milch nicht im Vorrat → gemeldet')
  const double = planPantryDeduction(recipeNeeds(recipe, 4), [{ id: 'k1', name: 'Kartoffeln', quantity: 0.8, unit: 'kg', food_item_id: 'kartoffel' }])
  expect(double.deletes.includes('k1') && double.partial.some(s => s.startsWith('Kartoffeln')), '4 Portionen brauchen 1 kg, nur 0,8 kg da → aufgebraucht und als „nur teilweise“ gemeldet')
}

console.log('\n4) Anleitung')
expect(instructionSteps(['Zubereitung und genaue Mengen noch ergänzen – bisherige Unterhaltung enthält nicht alle Details.']).length === 0, 'Import-Platzhalter zählt nicht als Anleitung')
expect(instructionSteps(['Wasser kochen.', ' Nudeln garen. ', '']).length === 2, 'echte Schritte werden übernommen')

console.log('\n5) KI-Antwort auslesen (Anleitung + fehlende Mengen)')
{
  const ingredients = [
    { id: 'i1', name: 'Kartoffeln', quantity: null, unit: 'g', is_optional: false },
    { id: 'i2', name: 'Zucchini', quantity: 1, unit: 'Stk', is_optional: false },
    { id: 'i3', name: 'Feta', quantity: null, unit: null, is_optional: false },
    { id: 'i4', name: 'Petersilie', quantity: null, unit: 'Bund', is_optional: true },
  ]
  const prompt = buildRecipeMessages({ title: 'Kartoffel-Feta-Pfanne', description: null, servings: 2, prep_minutes: 10, cook_minutes: 25 }, ingredients)[1].content
  expect(prompt.includes('Kartoffeln (Menge fehlt)') && !prompt.includes('Zucchini (Menge fehlt)'), 'Prompt fragt nur fehlende Mengen ab (Zucchini hat schon 1 Stk)')
  const answer = ['**MENGEN:**', '- Kartoffeln | 500 | Gramm', '- Feta | 1/2 | Stück', '- Petersilie | ½ | Bund', '- Zucchini | 3 | Stk', '', '**SCHRITTE:**', '1. Kartoffeln schälen und würfeln.', '2. In Öl 15 Minuten braten.', '3. Zucchini dazugeben, 5 Minuten mitbraten.', '4. Feta zerbröseln und darüber streuen.'].join('\n')
  const parsed = parseRecipeAnswer(answer, ingredients)
  expect(parsed.steps.length === 4 && parsed.steps[0] === 'Kartoffeln schälen und würfeln.', '4 Schritte ohne Nummern gelesen')
  expect(parsed.quantities.some(q => q.id === 'i1' && q.quantity === 500 && q.unit === 'g'), 'Kartoffeln 500 „Gramm“ → 500 g')
  expect(parsed.quantities.some(q => q.id === 'i3' && q.quantity === 0.5 && q.unit === 'Stk'), 'Feta „1/2 Stück“ → 0,5 Stk')
  expect(parsed.quantities.some(q => q.id === 'i4' && q.quantity === 0.5 && q.unit === 'Bund'), 'Petersilie „½ Bund“ → 0,5 Bund')
  expect(!parsed.quantities.some(q => q.id === 'i2'), 'vorhandene Menge (Zucchini) wird nie überschrieben')
  const timed = parseRecipeAnswer(['MENGEN:', '- keine', 'ZEIT: Vorbereitung 15 Min | Kochen 25 Min', 'SCHRITTE:', '1. Kartoffeln würfeln.', '2. 25 Minuten braten.'].join('\n'), ingredients)
  expect(timed.times.prepMinutes === 15 && timed.times.cookMinutes === 25 && timed.steps.length === 2, 'Zeitzeile „Vorbereitung 15 Min | Kochen 25 Min“ gelesen, nicht als Schritt gezählt')
  expect(prompt.includes('ZEIT: Vorbereitung') && prompt.includes('nur für den Backofen'), 'Prompt fragt realistische Zeiten ab und verbietet °C-Angaben am Herd')
  const plain = parseRecipeAnswer('1. Wasser kochen.\n2. Nudeln 9 Minuten garen.\n3. Abgießen.', ingredients)
  expect(plain.steps.length === 3 && plain.quantities.length === 0, 'Antwort ohne Abschnitte → nur Schritte')
}

console.log(failed ? '\n' + failed + ' Prüfung(en) fehlgeschlagen' : '\nAlle Prüfungen bestanden')
process.exit(failed ? 1 : 0)
