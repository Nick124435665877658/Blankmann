// Tests für Preisschätzung und Vorrat. Aufruf: npm run test:kitchen
import { recipeMatches } from '../src/lib/recipeSearch.ts'
import { breakfastSections, weekAmount, weekGroups } from '../src/lib/quickPicks.ts'
import { applyGlutenYeast, buildHistamineMessages, buildRecipeMessages, glutenYeastPenalty, parseHistamine, parseHistamineBatch, parseRecipeAnswer } from '../src/lib/recipeAi.ts'
import { groupForMeal, matchRecipeGroup } from '../src/lib/recipeGroups.ts'
import { compareMatches, matchRecipeToPantry } from '../src/lib/pantryMatch.ts'
import { rankFoods } from '../src/lib/foodSearch.ts'
import { bestBeforeFor } from '../src/lib/shelfLife.ts'
import { weekExpiries } from '../src/lib/expiry.ts'
import { cookidooImageFrom } from '../src/lib/cookidooImage.ts'
import { buildPantryIdeasMessages, parsePantryIdeas } from '../src/lib/pantryIdeas.ts'
import { defaultRules } from '../src/lib/recipeAi.ts'
import { canSplitToOne, estimateCost, estimateRecipeCost, instructionSteps, manualPriceRow, niceAmount, pantryAmountFromReceipt, planPantryAddition, planPantryDeduction, recipeNeeds, splitOrganic, splitToOne, type FoodRef, type PantryRow, type PriceRow } from '../src/lib/kitchen.ts'

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

console.log('\n7b) Preis ohne Packungsgröße (EDEKA-Eier 3,99 ohne Stückzahl, Nick 23.11.2026)')
{
  const eggs = (edekaPack: number | null): PriceRow[] => [
    { food_item_id: 'eier', price_eur: 2.49, package_quantity: 10, package_unit: 'Stück', unit_price_eur: 0.25, unit_label: '€/Stück', observed_at: '2026-06-30', retailer_code: 'discounter', is_organic: false },
    { food_item_id: 'eier', price_eur: 3.99, package_quantity: edekaPack, package_unit: edekaPack ? 'Stk' : null, unit_price_eur: null, unit_label: null, observed_at: '2026-11-22', retailer_code: 'edeka', is_organic: false },
    { food_item_id: 'eier', price_eur: 3.29, package_quantity: 6, package_unit: 'Stk', unit_price_eur: null, unit_label: null, observed_at: '2026-11-18', retailer_code: 'penny', is_organic: true },
  ]
  const eggFoods: FoodRef[] = [{ id: 'eier', name: 'Eier', normalized_name: 'eier' }]
  const without = estimateCost({ name: 'Eier', food_item_id: 'eier', quantity: 2, unit: 'Stk' }, eggFoods, eggs(null))
  expect(near(without.cost, 0.5) && without.markets === 1, '2 Eier: EDEKA ohne Packungsgröße fällt raus → 0,50 € (vorher 4,24 €)')
  expect(without.hint.includes('1 Preis ohne Packungsgröße nicht eingerechnet'), 'Hinweis „1 Preis ohne Packungsgröße nicht eingerechnet“')
  const ten = estimateCost({ name: 'Eier', food_item_id: 'eier', quantity: 2, unit: 'Stk' }, eggFoods, eggs(10))
  expect(near(ten.cost, (0.5 + 0.798) / 2) && ten.markets === 2, '2 Eier mit EDEKA als 10er: Ø (0,50 + 0,80) = 0,65 €')
  const only = estimateCost({ name: 'Gurke', food_item_id: 'gurke', quantity: 2, unit: 'Stk' }, [{ id: 'gurke', name: 'Gurke', normalized_name: 'gurke' }], [{ food_item_id: 'gurke', price_eur: 0.69, package_quantity: null, package_unit: null, unit_price_eur: null, unit_label: null, observed_at: '2026-11-20', retailer_code: 'penny', is_organic: false }])
  expect(near(only.cost, 1.38) && only.basis === 'exact' && only.hint.includes('Packungsgröße fehlt'), 'Einziger Preis ohne Packungsgröße zählt weiter als Stückpreis (2 Gurken 1,38 €), mit Hinweis')
}

console.log('\n7c) Mengen anzeigen (Komma, kaufgerecht, kg/l)')
{
  const cases: [number | string | null, string | null, string, boolean?][] = [
    [0.67, 'TL', '¾ TL'], [1.5, 'EL', '1½ EL'], [516.67, 'g', '520 g', true], [516.67, 'g', '517 g'], [125, 'g', '125 g'], [2500, 'g', '2,5 kg'], [1000, 'g', '1 kg'],
    ['0.33', 'l', '0,33 l'], [1250, 'ml', '1,25 l'], [10, 'Stk', '10 Stk'], [4, 'Packungen', '4 Packungen'], [2.33, 'Stk', '2¼ Stk'], [0.1, 'Prise', '0,1 Prise'], [null, 'g', ''],
  ]
  for (const [q, u, want, shop] of cases) expect(niceAmount(q, u, { shop }) === want, `${q} ${u}${shop ? ' (Einkauf)' : ''} → „${want}“ (ist „${niceAmount(q, u, { shop })}“)`)
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

console.log('\n11) Was kochen? – Rezepte gegen den Vorrat')
{
  const foods = [{ id: 'salz', name: 'Salz', is_staple: true }, { id: 'kart', name: 'Kartoffeln' }, { id: 'eier', name: 'Eier' }, { id: 'spinat', name: 'Rahmspinat' }, { id: 'milch', name: 'Milch' }, { id: 'butter', name: 'Butter' }, { id: 'feta', name: 'Feta' }]
  const pantry = [
    { food_item_id: 'kart', name: 'Kartoffeln', quantity: 2500, unit: 'g', best_before: null },
    { food_item_id: 'eier', name: 'Eier', quantity: 10, unit: 'Stk', best_before: '2026-12-02' },
    { food_item_id: 'spinat', name: 'Rahmspinat', quantity: 150, unit: 'g', best_before: '2026-11-24' },
    { food_item_id: 'milch', name: 'Milch', quantity: 1, unit: 'l', best_before: '2026-11-25' },
    { food_item_id: 'butter', name: 'Butter', quantity: null, unit: null, best_before: null },
  ]
  const recipe = [
    { food_item_id: 'kart', name: 'Kartoffeln', quantity: 400, unit: 'g' },
    { food_item_id: 'eier', name: 'Eier', quantity: 2, unit: 'Stk' },
    { food_item_id: 'spinat', name: 'Rahmspinat', quantity: 200, unit: 'g' },
    { food_item_id: 'salz', name: 'Salz', quantity: 1, unit: 'Prise' },
    { food_item_id: 'milch', name: 'Milch', quantity: 150, unit: 'g' },
    { food_item_id: 'butter', name: 'Butter', quantity: 2, unit: 'EL' },
    { food_item_id: 'feta', name: 'Feta', quantity: 100, unit: 'g', is_optional: true },
  ]
  const m = matchRecipeToPantry(recipe, pantry, foods, '2026-11-26')
  expect(m.total === 6 && m.have === 5, 'Kartoffelpüree: 5 von 6 da (Feta optional zählt nicht, Salz = Grundausstattung)')
  expect(m.missing.length === 1 && m.missing[0].name === 'Rahmspinat' && m.missing[0].short && m.missing[0].quantity === 50, 'Rahmspinat: 150 g da, 200 g nötig → fehlt 50 g')
  expect(m.expiringUsed.includes('Milch') && !m.expiringUsed.includes('Rahmspinat'), 'Bald ablaufend genutzt: Milch (150 g ≈ 150 ml reicht); Rahmspinat reicht nicht → zählt nicht')
  const full = matchRecipeToPantry(recipe.filter(r => r.name !== 'Rahmspinat'), pantry, foods, '2026-11-26')
  expect(full.complete && full.share === 1, 'Ohne Rahmspinat: alles da')
  const byName = matchRecipeToPantry([{ food_item_id: null, name: 'Eier', quantity: 3, unit: 'Stk' }], pantry, foods, '2026-11-26')
  expect(byName.complete, 'Zutat ohne Katalog-Zuordnung wird über den Namen gefunden')
  const sorted = [{ match: m, rating: 9, title: 'B' }, { match: full, rating: 5, title: 'A' }].sort(compareMatches)
  expect(sorted[0].title === 'A', 'Sortierung: komplett machbar vor besser bewertet')
}

console.log('\n12) Was kochen? – KI-Ideen auswerten')
{
  const answer = ['Hier sind Ideen:', '**GERICHT:** Kartoffel-Mozzarella-Auflauf', 'GRUPPE: Hauptgericht', 'BESCHREIBUNG: Cremiger Auflauf.', 'PORTIONEN: 2', 'ZEIT: Vorbereitung 15 Min | Kochen 35 Min', 'HISTAMIN: 7 | Mozzarella ist frisch', 'ZUTATEN:', '- Kartoffeln | 600 | g', '- Mozzarella | 125 | g', '- Mehl | 2 | EL', 'SCHRITTE:', '1. Kartoffeln schneiden.', '2. Schichten und bei 200 °C backen.', '---', 'GERICHT: Tomatensuppe', 'GRUPPE: Suppe & Eintopf', 'ZUTATEN:', '- Tomaten | 500 | g', '- Zwiebeln | 1 | Stk', 'SCHRITTE:', '1. Kochen.', '2. Pürieren.', '---', 'GERICHT: Kartoffelrösti', 'GRUPPE: Beilage', 'HISTAMIN: 9', 'ZUTATEN:', '- Kartoffeln | 400 | g', '- Öl | 2 | EL', 'SCHRITTE:', '1. Reiben.', '2. Braten.'].join('\n')
  const ideas = parsePantryIdeas(answer, { ...defaultRules, tomatoFree: true })
  expect(ideas.length === 2 && ideas[0].title === 'Kartoffel-Mozzarella-Auflauf' && ideas[1].title === 'Kartoffelrösti', '2 Ideen erkannt, Tomatensuppe wegen „tomatenfrei“ verworfen')
  expect(ideas[0].group === 'Hauptgericht' && ideas[0].prepMinutes === 15 && ideas[0].cookMinutes === 35 && ideas[0].ingredients.length === 3 && ideas[0].steps.length === 2, 'Gruppe, Zeiten, Zutaten und Schritte gelesen')
  expect(ideas[0].histamine.score === 6, 'Gluten (2 EL Mehl) senkt Histamin 7 → 6')
  const msgs = buildPantryIdeasMessages([{ name: 'Mozzarella', quantity: 125, unit: 'g', best_before: '2026-11-25' }, { name: 'Kartoffeln', quantity: 2500, unit: 'g', best_before: null }], ['Salz'], defaultRules, '2026-11-26', 4)
  expect(msgs[1].content.includes('- ! Mozzarella (125 g)') && msgs[1].content.includes('höchstens 2 Zutaten') && msgs[1].content.includes('Keine Tomaten'), 'Prompt: bald Ablaufendes markiert, höchstens 2 fehlende, Haushaltsregeln')
}

console.log('\n13) Nahrungsmittel suchen + Cookidoo-Bild finden')
{
  const foods = ['Kartoffeln', 'Süßkartoffeln', 'Kartoffel-Gnocchi', 'Käse', 'Frischkäse', 'Mandeln gehobelt', 'Mohn', 'Zwiebeln', 'Rote Zwiebeln'].map((name, i) => ({ id: 'f' + i, name, category: i === 6 ? 'Nüsse & Saaten' : 'Test' }))
  const names = (q: string) => rankFoods(foods, q).map(f => f.name)
  expect(names('kart')[0] === 'Kartoffeln' && names('kart').includes('Süßkartoffeln'), '„kart“ → Kartoffeln zuerst, Süßkartoffeln auch')
  expect(names('kaese')[0] === 'Käse' && names('kase')[0] === 'Käse' && names('Käse')[0] === 'Käse', 'ä/ae/a egal: „kaese“, „kase“, „Käse“ → Käse')
  expect(names('zwiebel')[0] === 'Zwiebeln' && names('zwiebel')[1] === 'Rote Zwiebeln', 'Wortanfang zählt: Zwiebeln vor Rote Zwiebeln')
  expect(names('mandeln geh')[0] === 'Mandeln gehobelt', 'Mehrere Suchwörter')
  expect(names('nüsse')[0] === 'Mohn', 'Gruppe als letzter Treffer (Mohn in „Nüsse & Saaten“)')
  expect(names('').length === 9 && names('')[0] === 'Frischkäse', 'Leere Suche → alphabetisch')
  const html = '<html><head><meta property="og:image" content="https://assets.tmecosys.com/image/upload/t_web_rdp_recipe_584x480/img/recipe/ras/Assets/0CE9/Derivates/F094.jpg"/></head></html>'
  expect(cookidooImageFrom(html) === 'https://assets.tmecosys.com/image/upload/t_web_rdp_recipe_584x480/img/recipe/ras/Assets/0CE9/Derivates/F094.jpg', 'og:image von assets.tmecosys.com erkannt')
  expect(cookidooImageFrom('<meta property="og:image" content="https://evil.example/x.jpg">') === null, 'fremde Bild-Hosts werden abgelehnt')
  expect(cookidooImageFrom('<img src="https://assets.tmecosys.com/image/upload/a/b.jpg">') === 'https://assets.tmecosys.com/image/upload/a/b.jpg', 'ohne og:image: erstes Bild von assets.tmecosys.com')
}

console.log('\n14) Automatisches MHD für Obst und Gemüse (Bon)')
{
  const cases: [string, string, string | null][] = [
    ['Zucchini', 'Gemüse', '2026-12-03'], ['Kartoffeln', 'Gemüse', '2026-12-13'], ['Rote Zwiebeln', 'Gemüse', '2026-12-13'], ['Schalotten', 'Gemüse', '2026-12-13'],
    ['Süßkartoffeln', 'Gemüse', '2026-12-03'], ['Frühlingszwiebeln', 'Gemüse', '2026-12-03'], ['Feldsalat', 'Gemüse', '2026-11-27'], ['Champignons', 'Gemüse', '2026-11-27'],
    ['Salatgurke', 'Gemüse', '2026-12-03'], ['Karotten', 'Gemüse', '2026-12-14'], ['Rotkohl', 'Gemüse', '2026-12-14'], ['Blumenkohl', 'Gemüse', '2026-12-03'], ['Kohlrabi', 'Gemüse', '2026-12-03'],
    ['Knoblauch', 'Gemüse', '2026-12-23'], ['Hokkaido-Kürbis', 'Gemüse', '2026-12-23'], ['Petersilienwurzel', 'Gemüse', '2026-12-14'], ['Mais', 'Gemüse', null], ['Maronen', 'Gemüse', null],
    ['Apfel', 'Obst', '2026-12-14'], ['Banane', 'Obst', '2026-11-28'], ['Himbeeren', 'Obst', '2026-11-26'], ['Zitrone', 'Obst', '2026-12-07'], ['Birne', 'Obst', '2026-11-30'],
    ['Zitronensaft', 'Obst', null], ['Rosinen', 'Obst', null], ['Datteln', 'Obst', null],
    ['Petersilie', 'Kräuter & Gewürze', '2026-11-27'], ['Basilikum', 'Kräuter & Gewürze', '2026-11-27'], ['Koriander gemahlen', 'Kräuter & Gewürze', null], ['Thymian getrocknet', 'Kräuter & Gewürze', null], ['Zimt', 'Kräuter & Gewürze', null],
    ['Milch', 'Milchprodukte & Eier', null], ['Rahmspinat', 'Tiefkühl', null],
  ]
  const wrong = cases.filter(([name, group, want]) => bestBeforeFor(name, group, '2026-11-23') !== want).map(([name, group, want]) => name + ' (' + bestBeforeFor(name, group, '2026-11-23') + ' statt ' + want + ')')
  expect(!wrong.length, cases.length + ' Fälle ab Bon 23.11.2026 richtig' + (wrong.length ? ': ' + wrong.join(', ') : ''))
  expect(bestBeforeFor('Kartoffeln', 'Gemüse', '2026-12-25') === '2027-01-14', 'Jahreswechsel: 25.12. + 20 = 14.01.2027')
}

console.log('\n15) Wochenplan: Was läuft diese Woche ab?')
{
  const pantry = [
    { id: 'p1', name: 'Mozzarella', quantity: 125, best_before: '2026-11-25', food_item_id: 'mozz' },
    { id: 'p2', name: 'Milch', quantity: 1, best_before: '2026-11-27', food_item_id: 'milch' },
    { id: 'p3', name: 'Quark', quantity: 500, best_before: '2026-11-22', food_item_id: 'quark' },
    { id: 'p4', name: 'Kartoffeln', quantity: 2500, best_before: '2026-12-13', food_item_id: 'kart' },
    { id: 'p5', name: 'Spinat', quantity: 0, best_before: '2026-11-24', food_item_id: 'spinat' },
    { id: 'p6', name: 'Banane', quantity: 6, best_before: '2026-11-28', food_item_id: 'banane' },
  ]
  const meals = [
    { meal_date: '2026-11-24', meal_type: 'dinner', recipe_id: 'r1', food_item_id: null, custom_title: 'Ofengemüse mit Mozzarella' },
    { meal_date: '2026-11-28', meal_type: 'dinner', recipe_id: 'r2', food_item_id: null, custom_title: 'Milchreis' },
    { meal_date: '2026-11-23', meal_type: 'week', recipe_id: null, food_item_id: 'banane', custom_title: 'Banane' },
  ]
  const ingredients: Record<string, { food_item_id: string | null; name: string }[]> = { r1: [{ food_item_id: 'mozz', name: 'Mozzarella' }], r2: [{ food_item_id: null, name: 'Milch' }] }
  const n = weekExpiries(pantry, meals, id => ingredients[id] ?? [], '2026-11-29', '2026-11-23')
  expect(n.map(x => x.item.name).join(',') === 'Quark,Mozzarella,Milch,Banane', 'Reihenfolge nach MHD; Kartoffeln (nach der Woche) und leerer Spinat fehlen')
  expect(n[0].expired && !n[0].planned, 'Quark: abgelaufen')
  expect(n[1].planned?.title === 'Ofengemüse mit Mozzarella', 'Mozzarella: eingeplant am 24.11. (vor dem MHD)')
  expect(!n[2].planned, 'Milch: Milchreis erst am 28.11., MHD 27.11. → nicht rechtzeitig eingeplant')
  expect(n[3].planned?.title === 'Banane', 'Banane: über „Für die ganze Woche“ eingeplant')
}

console.log('\n16) Histamin mit Nachkommastelle (0.3.57)')
{
  expect(parseHistamine(['HISTAMIN: 6,5 | Tomaten']).score === 6.5, '„6,5“ gelesen')
  expect(parseHistamine(['HISTAMIN: 7.25/10 – wenig kritisch']).score === 7.3, '„7.25/10“ → 7,3')
  expect(parseHistamine(['**HISTAMIN:** 8 | frisch']).score === 8, 'Markdown-Fett und ganze Zahl gelesen')
  expect(parseHistamine(['HISTAMIN: 10,5']).score === null && parseHistamine(['HISTAMIN: 0,5']).score === null, 'außerhalb 1–10 verworfen')
  const batch = parseHistamineBatch('R1: 6,5 | Tomaten als Hauptzutat\nR2: 9.0 | unkritisch\n**R3:** 3,2 – Salami und Parmesan\nR3: 8 | doppelt', 3)
  expect(batch[0].score === 6.5 && batch[0].note === 'Tomaten als Hauptzutat' && batch[1].score === 9 && batch[2].score === 3.2, 'Sammelantwort R1–R3 gelesen, erste Zeile je Rezept zählt')
  expect(parseHistamineBatch('R2: 7,5', 2)[0].score === null, 'fehlende Zeile → kein Wert')
  const scaled = applyGlutenYeast({ score: 6.5, note: null }, [{ name: 'Weizenmehl', quantity: 2, unit: 'EL' }])
  expect(scaled.score === 5.5, 'Gluten-Abzug bleibt bei einer Nachkommastelle (6,5 − 1 = 5,5)')
  const prompt = buildHistamineMessages([{ title: 'Tomatensuppe', ingredients: [{ name: 'Tomaten', quantity: 800, unit: 'g' }, { name: 'Sahne', quantity: null, unit: null, is_optional: true }] }])[1].content
  expect(prompt.includes('R1: Tomatensuppe') && prompt.includes('- 800 g Tomaten') && !prompt.includes('Sahne') && /Nachkommastelle/.test(prompt), 'Sammel-Prompt mit Zutaten (ohne optionale) und Nachkommastelle')
  const full = buildRecipeMessages({ title: 'X', description: null, servings: 2, prep_minutes: null, cook_minutes: null }, [])[1].content
  expect(/mit einer Nachkommastelle/.test(full) && /Orientierung: 9–10/.test(full), 'Rezept-Prompt fragt Nachkommastelle mit Skala ab')
}

console.log('\n17) Rezeptsuche (0.3.58)')
{
  const r = { title: 'Gnocchi mit Lachs und Spinat', description: 'Thermomix · Hauptgerichte', category: 'Hauptgericht', recipe_ingredients: [{ name: 'Lachsfilet' }, { name: 'Frischkäse' }, { name: 'Kartoffel-Gnocchi' }] }
  expect(recipeMatches(r, '') && recipeMatches(r, '   '), 'leere Suche zeigt alles')
  expect(recipeMatches(r, 'gnocchi') && recipeMatches(r, 'GNOCCHI'), 'Name, Groß/klein egal')
  expect(recipeMatches(r, 'lachsfilet') && recipeMatches(r, 'frischkäse'), 'Zutaten werden durchsucht')
  expect(recipeMatches(r, 'frischkaese') && recipeMatches(r, 'frischkase'), 'ä/ae/a egal')
  expect(recipeMatches(r, 'lachs spinat') && !recipeMatches(r, 'lachs reis'), 'mehrere Wörter müssen alle passen')
  expect(recipeMatches(r, 'hauptger') && recipeMatches(r, 'thermomix'), 'Gruppe und Liste durchsucht (auch „Thermomix“)')
  expect(!recipeMatches(r, 'kuchen'), 'kein Treffer bei fremdem Wort')
  expect(recipeMatches({ title: 'Möhren-Kichererbsen-Suppe' }, 'mohren') && recipeMatches({ title: 'Möhren-Kichererbsen-Suppe' }, 'moehren suppe'), 'Umlaut im Titel, Bindestrich trennt Wörter')
}

console.log('\n18) Schnellauswahl Frühstück / Woche (0.3.60)')
{
  let n = 0
  const f = (name: string, category: string, q: number | null = null, u: string | null = null) => ({ id: 'q' + (n++), name, category, default_unit: null, typical_package_quantity: q, typical_package_unit: u })
  const foods = [f('Brötchen', 'Getreide & Backwaren', 300, 'g'), f('Salami', 'Fleisch & Fisch', 100, 'g'), f('Gouda', 'Milchprodukte & Eier', 400, 'g'), f('Erdbeerkonfitüre', 'Backen & Süßes', 450, 'g'), f('Eier', 'Milchprodukte & Eier', 10, 'Stk'),
    f('Apfel', 'Obst', 1, 'Stk'), f('Banane', 'Obst', 1, 'Stk'), f('Zitronensaft', 'Obst', 200, 'ml'), f('Orangeat', 'Obst', 100, 'g'), f('Rosinen', 'Obst', 250, 'g'), f('Zucchini', 'Gemüse', 2, 'Stk'), f('Suppengemüse', 'Gemüse', 1, 'Bund'),
    f('KARTOFFELCHIPS', 'Snacks', 175, 'g'), f('Gummibärchen', 'Snacks', 200, 'g'), f('Vollmilchschokolade', 'Backen & Süßes', 100, 'g'), f('Erdnüsse', 'Nüsse & Saaten', 150, 'g'),
    f('Orangensaft', 'Getränke', 1, 'l'), f('Marsala', 'Getränke', 750, 'ml'), f('Milch', 'Milchprodukte & Eier', 1, 'l'), f('Mehl', 'Getreide & Backwaren', 1, 'kg')]
  const b = breakfastSections(foods)
  const label = (sections: { label: string; items: { food: { name: string } }[] }[]) => sections.map(s => s.label + ':' + s.items.map(i => i.food.name).join('+')).join(' | ')
  expect(label(b) === 'Brot & Brötchen:Brötchen | Aufstrich:Erdbeerkonfitüre | Aufschnitt:Salami | Käse:Gouda | Dazu:Eier+Milch+Orangensaft+Apfel+Banane', 'Frühstück: Gruppen nur mit vorhandenen Nahrungsmitteln (' + label(b) + ')')
  const salami = b.find(s => s.label === 'Aufschnitt')!.items[0]
  expect(salami.quantity === 60 && salami.unit === 'g' && b[0].items[0].quantity === 4 && b[0].items[0].unit === 'Stk', 'Frühstücksmengen für 2 Personen (Salami 60 g, 4 Brötchen)')
  const w = weekGroups(foods)
  expect(w.map(g => g.label).join(',') === 'Obst & Gemüse,Snacks,Getränke,Frühstück', 'Wochen-Gruppen: Obst & Gemüse, Snacks, Getränke, Frühstück')
  expect(label(w[0].sections) === 'Obst:Apfel+Banane | Gemüse:Zucchini', 'Obst & Gemüse ohne Säfte, Orangeat, Trockenobst, Suppengemüse')
  expect(label(w[1].sections) === 'Snacks:KARTOFFELCHIPS+Gummibärchen+Vollmilchschokolade+Erdnüsse | Trockenobst:Rosinen', 'Snacks quer durch den Katalog (Schokolade, Nüsse), Trockenobst bei Snacks (Nick)')
  expect(label(w[2].sections) === 'Getränke:Orangensaft+Milch', 'Getränke ohne Koch-Wein (Marsala), mit Milch')
  expect(weekAmount(foods[5]).quantity === 6 && weekAmount(foods[5]).unit === 'Stk' && weekAmount(foods[12]).quantity === 175 && weekAmount(foods[12]).unit === 'g', 'Wochenmenge: übliche Packung, Stück-Obst 6 Stk')
  expect(w[3].sections.find(s => s.label === 'Aufschnitt')!.items[0].quantity === 100, 'Frühstück in der Wochenliste: in Packungen (Salami 100 g)')
}

console.log(failed ? '\n' + failed + ' Prüfung(en) fehlgeschlagen' : '\nAlle Prüfungen bestanden')
process.exit(failed ? 1 : 0)
