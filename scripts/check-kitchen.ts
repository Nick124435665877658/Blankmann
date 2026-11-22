// Tests für Preisschätzung und Vorrat. Aufruf: npm run test:kitchen
import { applyGlutenYeast, buildRecipeMessages, glutenYeastPenalty, parseRecipeAnswer } from '../src/lib/recipeAi.ts'
import { groupForMeal, matchRecipeGroup } from '../src/lib/recipeGroups.ts'
import { canSplitToOne, estimateCost, estimateRecipeCost, instructionSteps, manualPriceRow, pantryAmountFromReceipt, planPantryAddition, planPantryDeduction, recipeNeeds, splitOrganic, splitToOne, type FoodRef, type PantryRow, type PriceRow } from '../src/lib/kitchen.ts'

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
  const spoon = estimateCost({ name: 'Butter', food_item_id: 'butter', quantity: 2, unit: 'EL' }, foods, prices)
  expect(spoon.basis === 'exact' && near(spoon.cost, 0.092), '2 EL Butter ≈ 20 g → 0,09 € (statt ganzer Packung)')
  const odd = estimateCost({ name: 'Butter', food_item_id: 'butter', quantity: 2, unit: 'Zehe' }, foods, prices)
  expect(odd.basis === 'package', 'Zehe nicht in g umrechenbar → Packung angesetzt und markiert')
  const spice: PriceRow[] = [{ food_item_id: 'salz', price_eur: 0.69, package_quantity: 68, package_unit: 'g', unit_price_eur: 10.1471, unit_label: '€/kg', observed_at: '2026-11-21' }]
  expect(near(estimateCost({ name: 'Salz', food_item_id: 'salz', quantity: 1, unit: 'TL' }, foods, spice).cost, 0.03), '1 TL Gewürz ≈ 3 g aus 68 g für 0,69 € = 0,03 €')
  expect(near(estimateCost({ name: 'Salz', food_item_id: 'salz', quantity: 1, unit: 'Prise' }, foods, spice).cost, 0.005), '1 Prise ≈ 0,5 g → fast 0 €')
  expect(near(estimateCost({ name: 'Salz', food_item_id: 'salz', quantity: 2, unit: 'Messerspitze' }, foods, spice).cost, 0.006), '2 Messerspitzen ≈ 0,6 g')
  const liquid: PriceRow[] = [{ food_item_id: 'milch', price_eur: 2.59, package_quantity: 750, package_unit: 'ml', unit_price_eur: 3.4533, unit_label: '€/l', observed_at: '2026-11-21' }]
  expect(near(estimateCost({ name: 'Milch', food_item_id: 'milch', quantity: 150, unit: 'g' }, foods, liquid).cost, 0.518), '150 g Wein (Cookidoo in g) aus 0,75 l für 2,59 € = 0,52 € (g ≈ ml)')
  expect(near(estimateCost({ name: 'Milch', food_item_id: 'milch', quantity: 1, unit: 'EL' }, foods, liquid).cost, 0.052), '1 EL Flüssigkeit ≈ 15 ml')
  const unitOnly: PriceRow[] = [{ food_item_id: 'milch', price_eur: 1.09, package_quantity: null, package_unit: null, unit_price_eur: 1.09, unit_label: '€/l', observed_at: '2026-06-01' }]
  expect(near(estimateCost({ name: 'Milch', food_item_id: 'milch', quantity: 200, unit: 'g' }, foods, unitOnly).cost, 0.218), '200 g bei Literpreis 1,09 €/l = 0,22 €')
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
  const scored = parseRecipeAnswer(['MENGEN:', '- keine', 'ZEIT: Vorbereitung 10 Min | Kochen 20 Min', 'HISTAMIN: 4 | Feta ist gereift und histaminreich.', 'SCHRITTE:', '1. Nudeln kochen.', '2. Feta zerbröseln.'].join('\n'), ingredients)
  expect(scored.histamine.score === 4 && scored.histamine.note === 'Feta ist gereift und histaminreich.' && scored.steps.length === 2, 'Histaminwert „4 | Begründung“ gelesen, nicht als Schritt gezählt')
  expect(parseRecipeAnswer('HISTAMIN: 8/10\n1. a\n2. b', ingredients).histamine.score === 8, 'Histaminwert „8/10“ gelesen')
  expect(parseRecipeAnswer('HISTAMIN: 12\n1. a\n2. b', ingredients).histamine.score === null, 'ungültiger Histaminwert (12) wird verworfen')
  expect(prompt.includes('HISTAMIN: Zahl von 1 bis 10'), 'Prompt fragt den Histaminwert ab')
  expect(!prompt.includes('ERGÄNZT:') && prompt.includes('Verwende nur die genannten Zutaten'), 'Ohne „Zutaten ergänzen“: KI nutzt nur vorhandene Zutaten, kein ERGÄNZT-Abschnitt')
  const addPrompt = buildRecipeMessages({ title: 'Kartoffel-Feta-Pfanne', description: null, servings: 2, prep_minutes: 10, cook_minutes: 25 }, ingredients, { addIngredients: true, rules: { tomatoFree: true, creamFree: true, histamineLow: true, vegetableRich: false, notes: 'Kein Koriander' } })[1].content
  expect(addPrompt.includes('ERGÄNZT:') && addPrompt.includes('Grundausstattung ja') && addPrompt.includes('Keine Tomaten') && addPrompt.includes('Kein Koriander'), 'Mit „Zutaten ergänzen“: ERGÄNZT-Abschnitt, Grundausstattung und Haushaltsregeln im Prompt')
  const added = parseRecipeAnswer(['MENGEN:', '- Kartoffeln | 500 | g', 'ERGÄNZT:', '- Salz | 1 | TL | Grundausstattung ja', '- Olivenöl | 2 | EL | ja', '- Zwiebel | 1 | Stk | nein', '- Paprikapulver | 1 | TL | ja', '- Kartoffel | 200 | g | nein', '- Tomatenmark | 1 | EL | nein', '- Sahne | 100 | ml | nein', '- Parmesan | 30 | g | nein', '- keine', 'ZEIT: Vorbereitung 10 Min | Kochen 20 Min', 'HISTAMIN: 6 | Feta', 'SCHRITTE:', '1. Zwiebel würfeln.', '2. Alles braten.'].join('\n'), [...ingredients, { id: 'i5', name: 'Paprika', quantity: 1, unit: 'Stk', is_optional: false }])
  expect(added.additions.map(a => a.name).join(',') === 'Salz,Olivenöl,Zwiebel,Paprikapulver', 'Ergänzt: Salz, Olivenöl, Zwiebel, Paprikapulver – nicht „Kartoffel“ (schon da), nicht Tomatenmark/Sahne/Parmesan (Haushaltsregeln)')
  expect(added.additions[0].staple && added.additions[1].staple && !added.additions[2].staple && added.additions[0].unit === 'TL' && added.additions[1].quantity === 2, 'Salz und Öl als Grundausstattung, Zwiebel nicht; Menge und Einheit gelesen')
  expect(added.quantities.some(q => q.id === 'i1' && q.quantity === 500) && added.steps.length === 2 && added.histamine.score === 6, 'Mengen, Schritte und Histamin weiterhin richtig gelesen, Ergänzungen nicht als Mengen gezählt')
  const plain = parseRecipeAnswer('1. Wasser kochen.\n2. Nudeln 9 Minuten garen.\n3. Abgießen.', ingredients)
  expect(plain.steps.length === 3, 'Antwort ohne Abschnitte → Schritte gelesen')
  const tmPrompt = buildRecipeMessages({ title: 'Weiße Bolognese', description: 'Thermomix · Hauptgerichte', servings: 4, prep_minutes: 20, cook_minutes: 25, source_type: 'cookidoo' }, ingredients, { addIngredients: true })[1].content
  expect(tmPrompt.includes('Thermomix-Rezept aus Cookidoo') && tmPrompt.includes('Ändere sie nicht') && tmPrompt.includes('ohne Thermomix') && tmPrompt.includes('Varoma'), 'Thermomix-Rezept: Prompt verbietet Mengenänderungen und Thermomix-Angaben in der Anleitung')
  expect(!prompt.includes('Thermomix-Rezept'), 'Eigene Rezepte bekommen den Thermomix-Hinweis nicht')
  const tmAnswer = parseRecipeAnswer(['MENGEN:', '- Zucchini | 3 | Stk', '- Kartoffeln | 400 | g', 'ERGÄNZT:', '- Salz | 1 | TL | ja', 'SCHRITTE:', '1. Kartoffeln kochen.', '2. Zucchini braten.'].join('\n'), ingredients)
  expect(!tmAnswer.quantities.some(q => q.id === 'i2') && tmAnswer.quantities.some(q => q.id === 'i1' && q.quantity === 400) && tmAnswer.additions.length === 1, 'Thermomix-Regel: vorhandene Menge (Zucchini 1 Stk) bleibt, fehlende Menge und neue Zutat werden ergänzt')
  expect(plain.steps.length === 3 && plain.quantities.length === 0 && plain.additions.length === 0, 'Antwort ohne Abschnitte → nur Schritte')
}

console.log('\n6) Bio-Status')
{
  const cases: [string, string, boolean][] = [
    ['BIO EIER 6ER', 'EIER 6ER', true], ['Bio Zucchini', 'Zucchini', true], ['Bio-Eier', 'Eier', true], ['Eier bio', 'Eier', true],
    ['BIOMILCH', 'MILCH', true], ['Biojoghurt', 'Joghurt', true], ['Demeter Möhren', 'Möhren', true], ['Öko Äpfel', 'Äpfel', true],
    ['Eier', 'Eier', false], ['Biotin Kapseln', 'Biotin Kapseln', false], ['Bio', 'Bio', false], ['Brombeeren', 'Brombeeren', false],
  ]
  for (const [input, base, organic] of cases) {
    const r = splitOrganic(input)
    expect(r.base === base && r.organic === organic, '„' + input + '“ → „' + r.base + '“' + (r.organic ? ' + Bio' : ' (kein Bio)'))
  }
  const eggs: PriceRow[] = [
    { food_item_id: 'ei', price_eur: 2.49, package_quantity: 10, package_unit: 'Stk', unit_price_eur: null, unit_label: null, observed_at: '2026-06-30', retailer_code: 'discounter', is_organic: false },
    { food_item_id: 'ei', price_eur: 3.29, package_quantity: 6, package_unit: 'Stk', unit_price_eur: null, unit_label: null, observed_at: '2026-11-18', retailer_code: 'penny', is_organic: true },
  ]
  const normal = estimateCost({ name: 'Eier', food_item_id: null, quantity: 2, unit: 'Stk' }, foods, eggs)
  expect(near(normal.cost, 0.498) && !normal.organic, 'Bio bevorzugen aus → normaler Preis: 2 Eier = 0,50 €')
  const bio = estimateCost({ name: 'Eier', food_item_id: null, quantity: 2, unit: 'Stk' }, foods, eggs, { preferOrganic: true })
  expect(near(bio.cost, 1.097) && bio.organic, 'Bio bevorzugen an → Bio-Preis: 2 Eier = 1,10 €')
  const onlyBio = estimateCost({ name: 'Eier', food_item_id: null, quantity: 2, unit: 'Stk' }, foods, [eggs[1]])
  expect(near(onlyBio.cost, 1.097), 'Nur Bio-Preis vorhanden → wird auch ohne „Bio bevorzugen“ genutzt')
  const bioName = estimateCost({ name: 'Bio Eier', food_item_id: null, quantity: 2, unit: 'Stk' }, foods, eggs)
  expect(bioName.foodId === 'ei', '„Bio Eier“ findet das Nahrungsmittel „Eier“')
  const pantry: PantryRow[] = [
    { id: 'p1', name: 'Bio Eier', quantity: 4, unit: 'Stk', food_item_id: null, is_organic: true },
    { id: 'p2', name: 'Eier', quantity: 3, unit: 'Stk', food_item_id: 'ei', is_organic: false },
  ]
  const cooked = planPantryDeduction([{ name: 'Eier', foodId: 'ei', quantity: 6, unit: 'Stk' }], pantry)
  expect(cooked.used.length === 1 && cooked.deletes.length + cooked.updates.length === 2, 'Rezept „6 Eier“: Bio- und normale Eier aus dem Vorrat zählen beide')
  const addBio = planPantryAddition(pantry, { name: 'Eier', foodId: 'ei', quantity: 6, unit: 'Stk', organic: true })
  expect(addBio.update?.id === 'p1' && addBio.update.quantity === 10, 'Bon „Bio Eier“ stockt die Bio-Zeile im Vorrat auf')
  const addNormal = planPantryAddition([pantry[0]], { name: 'Eier', foodId: 'ei', quantity: 6, unit: 'Stk', organic: false })
  expect(Boolean(addNormal.insert) && addNormal.insert?.is_organic === false, 'Normale Eier bekommen eine eigene Vorratszeile neben den Bio-Eiern')
}

console.log('\n7) Mittelwert über Supermärkte')
{
  const butter: PriceRow[] = [
    { food_item_id: 'butter', price_eur: 1.75, package_quantity: 250, package_unit: 'g', unit_price_eur: 7, unit_label: '€/kg', observed_at: '2026-11-20', retailer_code: 'aldi_nord', is_organic: false },
    { food_item_id: 'butter', price_eur: 1.50, package_quantity: 250, package_unit: 'g', unit_price_eur: 6, unit_label: '€/kg', observed_at: '2026-11-10', retailer_code: 'aldi_nord', is_organic: false },
    { food_item_id: 'butter', price_eur: 1.99, package_quantity: 250, package_unit: 'g', unit_price_eur: null, unit_label: null, observed_at: '2026-11-15', retailer_code: 'lidl', is_organic: false },
    { food_item_id: 'butter', price_eur: 3.98, package_quantity: 500, package_unit: 'g', unit_price_eur: null, unit_label: null, observed_at: '2026-11-12', retailer_code: 'penny', is_organic: false },
  ]
  const line = estimateCost({ name: 'Butter', food_item_id: 'butter', quantity: 250, unit: 'g' }, foods, butter)
  expect(near(line.cost, (1.75 + 1.99 + 1.99) / 3) && line.markets === 3, '250 g Butter: Ø aus ALDI Nord (neuester 1,75 €), Lidl 1,99 €, Penny 3,98 €/500 g = 1,91 €')
  expect(line.hint.includes('Ø aus 3 Märkten'), 'Hinweis „Ø aus 3 Märkten“')
  const single = estimateCost({ name: 'Butter', food_item_id: 'butter', quantity: 250, unit: 'g' }, foods, butter.slice(0, 2))
  expect(near(single.cost, 1.75) && single.markets === 1 && !single.hint, 'Nur ein Markt → dessen neuester Preis, kein Ø-Hinweis')
}

console.log('\n8) Auf 1 Stk runterrechnen')
{
  expect(canSplitToOne(2, 'Stk') && canSplitToOne(3, null) && canSplitToOne(2, 'Dose'), '2 Stk, 3 (ohne Einheit), 2 Dosen → Häkchen möglich')
  expect(!canSplitToOne(1, 'Stk') && !canSplitToOne(500, 'g') && !canSplitToOne(2, 'kg') && !canSplitToOne(null, 'Stk'), '1 Stk, 500 g, 2 kg, Menge offen → kein Häkchen')
  const one = splitToOne(3, 2, 'Stk')
  expect(one.price === 1.5 && one.quantity === 1 && one.unit === 'Stk', '2 Stk für 3,00 € → 1 Stk für 1,50 €')
  const third = splitToOne(1, 3, null)
  expect(third.price === 0.33 && third.unit === 'Stk', '3 für 1,00 € → 1 Stk für 0,33 €')
}

console.log('\n9) Histamin: Gluten und Hefe (Nick, 22.11.2026)')
{
  const ing = (name: string, quantity: number | null, unit: string | null, is_optional = false) => ({ name, quantity, unit, is_optional })
  const bread = glutenYeastPenalty([ing('Weizenmehl', 500, 'g'), ing('Hefe (frisch)', 21, 'g'), ing('Milch', 250, 'g'), ing('Salz', 1, 'TL')])
  expect(bread.gluten === 2 && bread.yeast === 2 && bread.penalty === 4, 'Hefeteig mit 500 g Weizenmehl → Gluten −2, Hefe −2, zusammen −4')
  const binding = glutenYeastPenalty([ing('Weizenmehl', 2, 'EL'), ing('Hähnchenbrustfilet', 400, 'g')])
  expect(binding.gluten === 1 && binding.yeast === 0 && binding.penalty === 1, '2 EL Mehl zum Binden → nur −1')
  const pasta = glutenYeastPenalty([ing('Spaghetti', 250, 'g'), ing('Sojasauce', 1, 'EL')])
  expect(pasta.gluten === 2 && pasta.penalty === 2, '250 g Spaghetti → −2 (Sojasauce zählt mit)')
  const free = glutenYeastPenalty([ing('Reismehl', 200, 'g'), ing('Buchweizenmehl', 100, 'g'), ing('Glutenfreie Mehlmischung', 300, 'g'), ing('Speisestärke', 20, 'g'), ing('Haferflocken', 100, 'g'), ing('Brotgewürz', 1, 'TL'), ing('Glasnudeln', 100, 'g')])
  expect(free.penalty === 0, 'Reis-/Buchweizenmehl, glutenfreie Mischung, Stärke, Hafer, Brotgewürz, Glasnudeln → kein Abzug')
  expect(glutenYeastPenalty([ing('Butterschmalz', 40, 'g'), ing('Schweineschmalz', 20, 'g')]).penalty === 0 && glutenYeastPenalty([ing('Malzbier', 330, 'ml')]).gluten === 2, 'Butter-/Schweineschmalz ist kein Malz, Malzbier schon')
  const flakes = glutenYeastPenalty([ing('Hefeflocken', 1, 'EL'), ing('Kartoffeln', 800, 'g')])
  expect(flakes.yeast === 1 && flakes.penalty === 1, '1 EL Hefeflocken → Hefe nur −1')
  const optional = glutenYeastPenalty([ing('Paniermehl', 50, 'g', true), ing('Kartoffeln', 800, 'g')])
  expect(optional.penalty === 0, 'Optionale Zutaten zählen nicht')
  const rolls = glutenYeastPenalty([ing('Brötchen', 4, 'Stk')])
  expect(rolls.gluten === 2, '4 Brötchen (Stk) → Hauptzutat')
  const applied = applyGlutenYeast({ score: 9, note: 'Milchprodukte frisch.' }, [ing('Weizenmehl', 500, 'g'), ing('Trockenhefe', 1, 'Pck')])
  expect(applied.score === 5 && /Gluten \(Weizenmehl\) und Hefe senken den Wert zusätzlich um 4/.test(applied.note ?? ''), '9 → 5 mit Begründung in der Notiz')
  expect(applyGlutenYeast({ score: 3, note: null }, [ing('Dinkelmehl', 400, 'g'), ing('Hefe (frisch)', 42, 'g')]).score === 1, 'Wert bleibt mindestens 1')
  expect(applyGlutenYeast({ score: 8, note: 'x' }, [ing('Kartoffeln', 500, 'g')]).score === 8, 'Ohne Gluten/Hefe unverändert')
  expect(applyGlutenYeast({ score: null, note: null }, [ing('Weizenmehl', 500, 'g')]).score === null, 'Ohne KI-Wert kein Wert')
  const prompt = buildRecipeMessages({ title: 'Brot', description: null, servings: 1, prep_minutes: null, cook_minutes: null }, [])[1].content
  expect(/Gluten .* Hefe lass bei deiner Zahl außen vor/.test(prompt), 'Prompt: KI bewertet nur Histamin, Gluten/Hefe rechnet die App')
}

console.log('\n10) Rezept-Gruppen')
{
  expect(matchRecipeGroup('Hauptgericht') === 'Hauptgericht' && matchRecipeGroup('Suppe') === 'Suppe & Eintopf' && matchRecipeGroup('Desserts') === 'Dessert & Eis', 'Gruppen aus KI-Antworten erkennen (genau und per Stichwort)')
  expect(matchRecipeGroup('Brot') === 'Brot & Brötchen' && matchRecipeGroup('Plätzchen') === 'Gebäck & Plätzchen' && matchRecipeGroup('Getränke') === 'Getränk', 'Brot, Plätzchen, Getränke')
  expect(matchRecipeGroup('Irgendwas') === null && matchRecipeGroup('') === null, 'Unbekannt → keine Gruppe')
  expect(groupForMeal('breakfast') === 'Frühstück & Müsli' && groupForMeal('lunch') === 'Hauptgericht' && groupForMeal('dinner') === 'Hauptgericht', 'Vorwahl im Wochenplan nach Mahlzeit')
  const answer = 'MENGEN:\n- keine\nZEIT: Vorbereitung 10 Min | Kochen 20 Min\nHISTAMIN: 8 | frisch\nGRUPPE: Suppe & Eintopf\nSCHRITTE:\n1. Gemüse schneiden.\n2. Kochen.'
  const parsed = parseRecipeAnswer(answer, [])
  expect(parsed.group === 'Suppe & Eintopf' && parsed.steps.length === 2 && parsed.histamine.score === 8, 'GRUPPE-Zeile wird gelesen und nicht als Schritt gezählt')
  const prompt = buildRecipeMessages({ title: 'Suppe', description: null, servings: 2, prep_minutes: null, cook_minutes: null }, [])[1].content
  expect(/GRUPPE:/.test(prompt) && /Hauptgericht, Beilage, Suppe & Eintopf/.test(prompt), 'Prompt fragt nach genau einer Gruppe aus der Liste')
}

console.log(failed ? '\n' + failed + ' Prüfung(en) fehlgeschlagen' : '\nAlle Prüfungen bestanden')
process.exit(failed ? 1 : 0)
