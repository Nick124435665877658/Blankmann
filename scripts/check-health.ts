// Tests für den Gesundheitswert (0.3.57). Aufruf: npm run test:health
// Fixtures: echte Nährwerte (BLS 4.0) der Haushalts-Nahrungsmittel und 30 echte Rezepte aus BLANKMANN.
import { readFileSync } from 'node:fs'
import { formatScore, gramsOf, nutriToScore, recipeHealth, weekHealth, type HealthFood, type HealthIngredient } from '../src/lib/health.ts'

let failed = 0
const expect = (condition: boolean, message: string) => {
  if (condition) console.log('  ok     ' + message)
  else { failed++; console.log('  FEHLER ' + message) }
}
const foods: HealthFood[] = JSON.parse(readFileSync(new URL('./fixtures/health-foods.json', import.meta.url), 'utf8'))
const byName = new Map(foods.map(f => [f.name, f]))
const food = (name: string) => { const f = byName.get(name); if (!f) throw new Error('Nahrungsmittel fehlt: ' + name); return f }
const ing = (name: string, quantity: number | null, unit: string | null): HealthIngredient => ({ name, quantity, unit, food: food(name) })

console.log('\n1) Mengen in Gramm')
const g = (name: string, q: number, u: string) => gramsOf(ing(name, q, u))?.grams ?? -1
expect(g('Eier', 3, 'Stk') === 174, '3 Eier = 174 g')
expect(g('Salz', 1, 'TL') === 5, '1 TL Salz = 5 g')
expect(g('Olivenöl', 2, 'EL') === 20, '2 EL Olivenöl = 20 g')
expect(g('Knoblauch', 2, 'Zehe') === 8, '2 Zehen Knoblauch = 8 g')
expect(g('Gemüsebrühe', 1, 'Würfel') === 10 && gramsOf(ing('Gemüsebrühe', 1, 'Würfel'))?.water === 500, '1 Brühwürfel = 10 g Pulver + 0,5 l Wasser')
expect(Math.abs(g('Hühnerbrühe', 750, 'g') - 15) < 0.01, '750 g Hühnerbrühe = fertige Brühe (15 g Pulver), nicht 750 g Pulver')
expect(Math.abs(g('Brühe', 400, 'ml') - 8) < 0.01, '400 ml Brühe = 8 g Pulver')
expect(g('Kichererbsen', 1, 'Dose') === 240, '1 Dose Kichererbsen = 240 g abgetropft')
expect(g('Tomaten stückig (Dose)', 1, 'Dose') === 400, '1 Dose Tomaten = 400 g')
expect(g('Hefe (frisch)', 0.5, 'Würfel') === 21, '½ Würfel Hefe = 21 g')
expect(g('Petersilie', 1, 'Bund') === 30, '1 Bund Petersilie = 30 g')
expect(g('Zwiebeln', 1, '') === 100, '1 Zwiebel ohne Einheit = 100 g')
expect(gramsOf(ing('Salz', null, null)) === null, 'ohne Menge: nicht mitgerechnet')
expect(gramsOf(ing('Nudeln', 100, 'g'))?.water === 120, '100 g Nudeln nehmen 120 g Wasser auf')

console.log('\n2) Umrechnung Nutri-Score-Punkte → 0–10')
expect(nutriToScore(-10) === 10 && nutriToScore(0) === 8 && nutriToScore(10) === 4.5 && nutriToScore(40) === 0, 'Eckpunkte stimmen')
expect(Math.abs(nutriToScore(6) - 5.75) < 1e-9, 'dazwischen linear (6 Punkte = 5,75)')
expect(formatScore(5.5) === '5,5' && formatScore(7) === '7,0', 'Anzeige mit Komma und einer Nachkommastelle')

console.log('\n3) Echte Rezepte')
type Row = { title: string; servings: number; ingredients: HealthIngredient[] }
const rows: Row[] = readFileSync(new URL('./fixtures/health-recipes.txt', import.meta.url), 'utf8').trim().split('\n').map(line => {
  const [title, servings, list] = line.split('|')
  return { title, servings: Number(servings), ingredients: list.split(';').map(part => {
    const optional = part.startsWith('?'); const [name, q, u] = (optional ? part.slice(1) : part).split('~')
    return { ...ing(name, q ? Number(q) : null, u || null), is_optional: optional }
  }) }
})
const results = new Map(rows.map(r => [r.title, recipeHealth(r.ingredients, r.servings)]))
for (const [title, h] of results) console.log('   ' + (h.score === null ? '  –' : formatScore(h.score).padStart(4)) + '  ' + title.padEnd(30) + ' ' + Math.round(h.portion.kcal) + ' kcal, Salz ' + h.portion.salt.toFixed(1) + ' g, Gemüse ' + Math.round(h.groups.vegFruit) + ' g · + ' + h.good.join(', ') + ' · − ' + h.bad.join(', '))
const score = (title: string) => { const s = results.get(title)?.score; if (s === null || s === undefined) throw new Error('kein Wert: ' + title); return s }
expect([...results.values()].every(h => h.coverage >= 0.95 && h.score !== null), 'alle Testrezepte haben Nährwerte (≥ 95 % der Menge)')
expect(score('Brokkoli-Apfel-Suppe') >= 7, 'Brokkoli-Apfel-Suppe ist gesund (≥ 7)')
expect(score('Chicken Saag') >= 7, 'Chicken Saag (viel Spinat, mageres Huhn) ≥ 7')
expect(score('Blumenkohl mit Erdnuss-Curry') >= 7, 'Blumenkohl-Erdnuss-Curry ≥ 7')
expect(score('Möhren-Kichererbsen-Suppe') >= 7, 'Möhren-Kichererbsen-Suppe ≥ 7')
expect(score('Karamellsauce') <= 1.5, 'Karamellsauce ≤ 1,5')
expect(score('Franzbrötchen') <= 3, 'Franzbrötchen ≤ 3')
expect(score('Rigatoni Quattro Formaggi') <= 4.5, 'Rigatoni Quattro Formaggi ≤ 4,5')
expect(score('Hot Aperol') <= 4.5 && results.get('Hot Aperol')!.bad.includes('Alkohol'), 'Hot Aperol: Abzug für Alkohol')
expect(score('Currywurstsuppe') < score('Grünes Thai-Curry'), 'Currywurstsuppe schlechter als Thai-Curry')
expect(score('Linsensuppe') < score('Dal Makhani'), 'Linsensuppe mit Speck/Würstchen schlechter als Dal')
expect(results.get('Currywurstsuppe')!.bad.some(t => /Wurst/.test(t)), 'Currywurstsuppe: Begründung „Wurst/Speck“')
expect(results.get('Lachs mit Zitronenrisotto')!.good.includes('Fisch'), 'Lachs-Risotto: Begründung „Fisch“')
expect(results.get('Dal Makhani')!.good.includes('Hülsenfrüchte'), 'Dal: Begründung „Hülsenfrüchte“')
expect(results.get('Japanische Ramen Nudelsuppe')!.portion.salt < 8, 'Ramen: Salz realistisch (Brühe als Flüssigkeit gerechnet)')
const scores = [...results.values()].map(h => h.score ?? 0)
expect(Math.max(...scores) - Math.min(...scores) >= 6, 'Werte nutzen die Skala (Spanne ≥ 6 Punkte)')

console.log('\n4) Fehlende Nährwerte')
const unknown = recipeHealth([{ name: 'Geheimzutat', quantity: 500, unit: 'g', food: { name: 'Geheimzutat' } }, ing('Zucchini', 200, 'g')], 2)
expect(unknown.score === null && unknown.missing.includes('Geheimzutat'), 'unter 70 % bekannter Menge: kein Wert, fehlende Zutat genannt')
const optional = recipeHealth([{ ...ing('Zucker', 500, 'g'), is_optional: true }, ing('Zucchini', 400, 'g')], 2)
expect((optional.score ?? 0) >= 8, 'optionale Zutaten zählen nicht')

console.log('\n5) Wochencheck')
const week = weekHealth([
  { health: results.get('Lachs mit Zitronenrisotto')!, portions: 2 },
  { health: results.get('Malzbiergulasch mit Breznknö')!, portions: 2 },
  { health: results.get('Dal Makhani')!, portions: 2 },
  { health: null, portions: 2 },
], 2)
expect(week.scored === 3 && week.avg !== null, 'Ø aus den 3 Rezepten mit Wert')
expect(week.fishMeals === 1, 'Fisch: 1× pro Person')
expect(Math.abs(week.meat - (187.5 + 45)) < 1, 'Fleisch je Person ≈ 233 g (Gulasch + Speck)')
expect(week.legumes > 50, 'Hülsenfrüchte je Person gezählt (gegart)')

console.log(failed ? '\n' + failed + ' FEHLER' : '\nAlle Tests bestanden.')
if (failed) process.exit(1)
