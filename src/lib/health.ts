// Gesundheitswert für Rezepte (0.3.57, Nick 24.11.2026): fest berechnet, ohne KI.
// Grundlage: Nährwerte je 100 g aus dem Bundeslebensmittelschlüssel (BLS 4.0) pro Nahrungsmittel,
// Bewertung wie der Nutri-Score (Stand 2023) je 100 g des fertigen Gerichts, dazu Zu- und Abschläge
// nach den DGE-Empfehlungen 2024 je Portion. Ergebnis 0–10 mit einer Nachkommastelle (z. B. 5,5/10).

export type HealthFood = {
  name: string
  nutr_kcal?: number | null; nutr_protein?: number | null; nutr_fat?: number | null; nutr_sat_fat?: number | null
  nutr_carbs?: number | null; nutr_sugar?: number | null; nutr_fiber?: number | null; nutr_salt?: number | null
  nutrition_source?: string | null; grams_per_piece?: number | null
  typical_package_quantity?: number | null; typical_package_unit?: string | null
}
export type HealthIngredient = { name: string; quantity: number | null; unit: string | null; is_optional?: boolean | null; food?: HealthFood | null }
export type Nutrients = { kcal: number; protein: number; fat: number; satFat: number; carbs: number; sugar: number; fiber: number; salt: number }
export type Groups = { vegFruit: number; legumes: number; fish: number; redMeat: number; processedMeat: number; poultry: number; wholeGrain: number; refinedGrain: number; nuts: number; alcohol: number }
export type Reason = { text: string; weight: number }
export type HealthResult = {
  score: number | null
  portion: Nutrients & { grams: number }
  groups: Groups // Gramm je Portion (Hülsenfrüchte gegart gerechnet)
  good: string[]
  bad: string[]
  coverage: number // Anteil (0–1) der Zutatenmenge mit bekannten Nährwerten
  nutriPoints: number | null
  missing: string[]
}

const keyOf = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()
const num = (v: unknown) => { const n = Number(v); return v === null || v === undefined || !Number.isFinite(n) ? 0 : n }
export const formatScore = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',')
export const healthClass = (score: number) => score >= 7 ? 'good' : score >= 4 ? 'mid' : 'bad'
const gText = (g: number) => (g >= 100 ? String(Math.round(g / 10) * 10) : String(Math.round(g))) + ' g'

const codeOf = (food: HealthFood) => (food.nutrition_source ?? '').match(/\b([A-Z][0-9][0-9A-Z][0-9]{4})\b/)?.[1] ?? ''
const blsName = (food: HealthFood) => keyOf(food.nutrition_source ?? '')
const hasNutrition = (food: HealthFood | null | undefined): food is HealthFood => Boolean(food && food.nutr_kcal !== null && food.nutr_kcal !== undefined)
const isBroth = (food: HealthFood) => /^R8[12]/.test(codeOf(food)) // Brühwürfel/-pulver
const massUnit = (unit: string | null | undefined, quantity: number | null | undefined) => {
  const u = keyOf(unit ?? ''); const q = num(quantity)
  if (!(q > 0)) return null
  return u === 'g' || u === 'ml' ? q : u === 'kg' || u === 'l' ? q * 1000 : null
}

// Wasser, das trockene Zutaten beim Kochen aufnehmen (Anteil der Trockenmasse) – nur Masse, keine Nährwerte.
export function cookWater(food: HealthFood) {
  const c = codeOf(food); const n = keyOf(food.name)
  if (/milchreis/.test(n)) return 0
  if (c === 'E401000' || c === 'E432000') return 1.2 // Nudeln
  if (c === 'C352000' || c === 'C351000') return 1.5 // Reis
  if (c === 'C119100' || c === 'C119200') return 1.3 // Bulgur, Couscous
  if (c === 'C118000' || c === 'C335000') return 1.5 // Quinoa, Amaranth
  if (c === 'H725100' || c === 'H730000' || c === 'H770100' || c === 'H739400') return 1.4 // getrocknete Linsen/Bohnen
  return 0
}

function spoon(food: HealthFood | null | undefined, name: string): [number, number] {
  const c = food ? codeOf(food) : ''; const n = keyOf(name); const src = food ? blsName(food) : ''
  if (/^R11/.test(c) || /salz/.test(n)) return [5, 15]
  if (/^S11|^R45/.test(c) || /zucker/.test(n)) return [4, 12]
  if (/^S1[2-6]/.test(c) || /honig|sirup|konfituere|marmelade/.test(n)) return [7, 20]
  if (/^Q[1-35]/.test(c) || /oel$/.test(n)) return [4, 10]
  if (/^Q/.test(c)) return [5, 12]
  if (/^C[24]|^S71|^B82|^R48|^K51/.test(c) || /mehl|staerke|kakao|paniermehl/.test(n)) return [3, 9]
  if (/^C/.test(c)) return [4, 10]
  if (/^H[1-4]/.test(c)) return [3.5, 10]
  if (/pfeffer schwarz/.test(src) || /^R2/.test(c)) return [2, 6]
  if (/petersilienblatt/.test(src) || /^G0[6-9]/.test(c)) return [1, 3]
  if (/^R42/.test(c) || /backpulver|natron|hefe/.test(n)) return [4, 12]
  return [5, 15]
}

const pieceDefault = (n: string) => /\bei(er)?\b/.test(n) ? 58 : /zwiebel/.test(n) ? 100 : /kartoffel/.test(n) ? 150 : /knoblauch/.test(n) ? 4 : /paprika/.test(n) ? 160 : /zitrone/.test(n) ? 80 : /limette/.test(n) ? 60 : /tomate/.test(n) ? 100 : /apfel/.test(n) ? 150 : 60
const packDefault = (n: string) => /vanill/.test(n) ? 8 : /backpulver/.test(n) ? 15 : /trockenhefe/.test(n) ? 7 : /puddingpulver/.test(n) ? 37 : /sahnesteif/.test(n) ? 8 : /gelatine/.test(n) ? 9 : /goetterspeise/.test(n) ? 100 : 200
const packageGrams = (food: HealthFood | null | undefined) => food ? massUnit(food.typical_package_unit, food.typical_package_quantity) : null

// Grammzahl einer Zutatenzeile (+ Wasser, das als Masse dazukommt). null = keine Menge angegeben.
export function gramsOf(ing: HealthIngredient): { grams: number; water: number } | null {
  const q = num(ing.quantity)
  if (!(q > 0)) return null
  const food = ing.food ?? null
  const u = keyOf(ing.unit ?? '')
  const n = keyOf(food?.name ?? ing.name)
  const direct = massUnit(ing.unit, q)
  if (food && hasNutrition(food) && isBroth(food)) {
    // Brühwürfel/-pulver: 1 Würfel (10 g) bzw. 1 TL (5 g) für 0,5 l bzw. 0,25 l; „1 l Brühe“ = 20 g Pulver + Wasser
    // Mengen ab 50 g/ml sind fertige Brühe (z. B. „750 g Hühnerbrühe“), kleinere sind Pulver
    if (direct !== null && (direct >= 50 || /^(ml|l)$/.test(u))) return { grams: direct * 0.02, water: direct * 0.98 }
    const powder = /^w(ue|u)rfel|^stk|^stueck|^$/.test(u) ? q * 10 : u === 'tl' ? q * 5 : u === 'el' ? q * 15 : direct ?? q * 10
    return { grams: powder, water: powder * 50 }
  }
  let grams: number
  if (direct !== null) grams = direct
  else if (u === 'tl' || u === 'teeloeffel') grams = q * spoon(food, ing.name)[0]
  else if (u === 'el' || u === 'essloeffel') grams = q * spoon(food, ing.name)[1]
  else if (/^(prise|prisen)$/.test(u)) grams = q * 0.5
  else if (/^(msp|messerspitze)/.test(u)) grams = q * 0.3
  else if (/^(spritzer|tropfen)/.test(u)) grams = q * 1
  else if (/^schuss/.test(u)) grams = q * 10
  else if (/^zehe/.test(u)) grams = q * 4
  else if (/^w(ue|u)rfel/.test(u)) grams = q * (/hefe/.test(n) ? 42 : num(food?.grams_per_piece) || 15)
  else if (/^bund/.test(u)) grams = q * (/fruehlingszwiebel|lauchzwiebel/.test(n) ? 120 : /radieschen/.test(n) ? 200 : /suppengemuese/.test(n) ? 500 : 30)
  else if (/^(staengel|stange)/.test(u)) grams = q * (/zitronengras/.test(n) ? 20 : /sellerie|lauch/.test(n) ? 40 : 3)
  else if (/^zweig/.test(u)) grams = q * 1.5
  else if (/^blatt|^blaetter/.test(u)) grams = q * (/lorbeer/.test(n) ? 0.2 : /salat/.test(n) ? 15 : /gelatine/.test(n) ? 1.7 : /nori/.test(n) ? 3 : /kaffir/.test(n) ? 0.5 : 0.5)
  else if (/^scheibe/.test(u)) grams = q * (/toast/.test(n) ? 25 : /brot/.test(n) ? 45 : /ingwer/.test(n) ? 3 : /zitrone|limette/.test(n) ? 10 : /speck|schinken|bacon/.test(n) ? 15 : 25)
  else if (/^(dose|glas|becher|pck|packung|paeckchen|tuetchen|beutel|tuete|netz|schale|kugel)/.test(u)) {
    const pack = packageGrams(food)
    const isCan = /^(dose|glas)/.test(u)
    const base = pack ?? (isCan ? (/^glas/.test(u) ? 350 : 400) : /^kugel/.test(u) ? 125 : packDefault(n))
    // Dosen mit Hülsenfrüchten: BLS-Werte gelten abgetropft (400 g Dose ≈ 240 g)
    grams = q * (isCan && /^H7\d{2}902$/.test(food ? codeOf(food) : '') ? base * 0.6 : base)
  } else if (/^(knolle)/.test(u)) grams = q * 50
  else if (/kopf/.test(u)) grams = q * (/klein/.test(u) ? 300 : 500)
  else if (/^streifen/.test(u)) grams = q * 2
  else if (/^(tasse)/.test(u)) grams = q * 150
  else if (/^(handvoll)/.test(u)) grams = q * 30
  else if (/^cm$/.test(u)) grams = q * 5
  else grams = q * (num(food?.grams_per_piece) || pieceDefault(n)) // Stk oder ohne Einheit
  return { grams, water: food ? grams * cookWater(food) : 0 }
}

function groupsOf(food: HealthFood): (keyof Groups)[] {
  const c = codeOf(food); const n = keyOf(food.name); const src = blsName(food)
  const out: (keyof Groups)[] = []
  const drink = /saft|sirup|drink|getraenk/.test(src)
  if (((c[0] === 'G' || /^K7/.test(c) || /^R161/.test(c)) && !drink) || ((c[0] === 'F') && !drink) || /rahmspinat|allerlei|gemuesemischung/.test(n)) out.push('vegFruit')
  if ((/^H7/.test(c) || (/^H8/.test(c) && !/drink|milch|kaese/.test(src)) || /tempeh|tofu/.test(n))) out.push('legumes')
  if (/^H(1[0-3]|17|19|21|25|3[12]|4[1-8])/.test(c)) out.push('nuts')
  if (c[0] === 'T') out.push('fish')
  if (c[0] === 'W') out.push('processedMeat')
  if ((c[0] === 'U' && !/^U9/.test(c)) || /^V2/.test(c)) out.push('redMeat')
  if (/^V[4-6]/.test(c)) out.push('poultry')
  if (/^P/.test(c) && !/alkoholfrei/.test(src)) out.push('alcohol')
  const whole = /vollkorn|ganzes korn|unpoliert|hafer flocken|quinoa|amaranth|buchweizen|bulgur/.test(src)
  if (whole) out.push('wholeGrain')
  else if ((c[0] === 'C' && /mehl|griess|reis|couscous/.test(src)) || /^E4/.test(c) || /^B[1-7]/.test(c) || /spaetzle/.test(n)) out.push('refinedGrain')
  return out
}

// Nutri-Score 2023 (allgemeine Lebensmittel), je 100 g
const steps = (value: number, limits: number[]) => limits.filter(l => value > l).length
const energyPts = (kj: number) => steps(kj, [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350])
const satPts = (g: number) => steps(g, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
const sugarPts = (g: number) => steps(g, [3.4, 6.8, 10, 14, 17, 20, 24, 27, 31, 34, 37, 41, 44, 48, 51])
const saltPts = (g: number) => steps(g, Array.from({ length: 20 }, (_, i) => Math.round((i + 1) * 0.2 * 10) / 10))
const fiberPts = (g: number) => steps(g, [3.0, 4.1, 5.2, 6.3, 7.4])
const proteinPts = (g: number) => steps(g, [2.4, 4.8, 7.2, 9.6, 12, 14, 17])
const fvlPts = (pct: number) => pct > 80 ? 5 : pct > 60 ? 2 : pct > 40 ? 1 : 0
const knots: [number, number][] = [[-8, 10], [0, 8], [2, 7], [10, 4.5], [18, 2], [30, 0]]
export function nutriToScore(points: number) {
  if (points <= knots[0][0]) return knots[0][1]
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1], [x1, y1] = knots[i]
    if (points <= x1) return y0 + (y1 - y0) * (points - x0) / (x1 - x0)
  }
  return 0
}

const zero = (): Nutrients => ({ kcal: 0, protein: 0, fat: 0, satFat: 0, carbs: 0, sugar: 0, fiber: 0, salt: 0 })
const zeroGroups = (): Groups => ({ vegFruit: 0, legumes: 0, fish: 0, redMeat: 0, processedMeat: 0, poultry: 0, wholeGrain: 0, refinedGrain: 0, nuts: 0, alcohol: 0 })
export const MIN_COVERAGE = 0.7

export function recipeHealth(ingredients: HealthIngredient[], servings: number): HealthResult {
  const portions = Math.max(1, num(servings) || 1)
  const total = zero(); const groups = zeroGroups()
  let known = 0, unknown = 0, water = 0, fvl = 0
  const missing: string[] = []
  for (const ing of ingredients) {
    if (ing.is_optional) continue
    const amount = gramsOf(ing)
    if (!amount) continue
    const food = ing.food
    if (!hasNutrition(food)) { unknown += amount.grams; if (amount.grams >= 5) missing.push(ing.name); continue }
    const g = amount.grams, f = g / 100
    known += g; water += amount.water
    total.kcal += num(food.nutr_kcal) * f; total.protein += num(food.nutr_protein) * f; total.fat += num(food.nutr_fat) * f
    total.satFat += num(food.nutr_sat_fat) * f; total.carbs += num(food.nutr_carbs) * f; total.sugar += num(food.nutr_sugar) * f
    total.fiber += num(food.nutr_fiber) * f; total.salt += num(food.nutr_salt) * f
    const eaten = g + amount.water
    for (const key of groupsOf(food)) {
      const value = key === 'legumes' ? eaten : g
      groups[key] += value
      if (key === 'vegFruit' || key === 'legumes') fvl += eaten
    }
  }
  const coverage = known + unknown > 0 ? known / (known + unknown) : 0
  const mass = known + water
  const per = (v: number) => mass > 0 ? v / mass * 100 : 0
  const portion = { ...Object.fromEntries(Object.entries(total).map(([k, v]) => [k, v / portions])) as Nutrients, grams: mass / portions }
  const perPortion = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v / portions])) as Groups
  if (!mass || coverage < MIN_COVERAGE) return { score: null, portion, groups: perPortion, good: [], bad: [], coverage, nutriPoints: null, missing }

  const kj = per(total.kcal) * 4.184
  const pts = { energy: energyPts(kj), sat: satPts(per(total.satFat)), sugar: sugarPts(per(total.sugar)), salt: saltPts(per(total.salt)), fiber: fiberPts(per(total.fiber)), protein: proteinPts(per(total.protein)), fvl: fvlPts(per(fvl)) }
  const negative = pts.energy + pts.sat + pts.sugar + pts.salt
  const proteinCounts = negative < 11 || pts.fvl === 5
  const nutriPoints = negative - (pts.fiber + pts.fvl + (proteinCounts ? pts.protein : 0))
  let score = nutriToScore(nutriPoints)

  const good: Reason[] = [], bad: Reason[] = []
  const add = (list: Reason[], delta: number, text: string) => { score += delta; list.push({ text, weight: Math.abs(delta) }) }
  const pg = perPortion
  if (pg.vegFruit >= 200) add(good, 0.6, 'viel Gemüse/Obst (' + gText(pg.vegFruit) + ')')
  else if (pg.vegFruit >= 120) add(good, 0.3, 'Gemüse/Obst (' + gText(pg.vegFruit) + ')')
  if (pg.legumes >= 40) add(good, 0.5, 'Hülsenfrüchte')
  if (pg.fish >= 80) add(good, 0.4, 'Fisch')
  if (pg.wholeGrain >= 40) add(good, 0.4, 'Vollkorn')
  if (pg.nuts >= 15) add(good, 0.2, 'Nüsse/Samen')
  if (pg.processedMeat >= 60) add(bad, -1.5, 'Wurst/Speck (' + gText(pg.processedMeat) + ')')
  else if (pg.processedMeat >= 20) add(bad, -1, 'Wurst/Speck')
  if (pg.redMeat >= 180) add(bad, -1, 'viel rotes Fleisch (' + gText(pg.redMeat) + ')')
  else if (pg.redMeat >= 100) add(bad, -0.5, 'rotes Fleisch (' + gText(pg.redMeat) + ')')
  if (portion.kcal > 1100) add(bad, -1, 'sehr viele kcal (' + Math.round(portion.kcal) + ')')
  else if (portion.kcal > 800) add(bad, -0.5, 'viele kcal (' + Math.round(portion.kcal) + ')')
  // DGE: gesättigte Fette < 10 % der Energie (≈ 22 g am Tag), Salz ≤ 6 g am Tag
  if (portion.satFat > 22) add(bad, -1, 'sehr viele gesättigte Fette (' + Math.round(portion.satFat) + ' g/Portion)')
  else if (portion.satFat > 15) add(bad, -0.5, 'viele gesättigte Fette (' + Math.round(portion.satFat) + ' g/Portion)')
  const saltText = portion.salt.toFixed(1).replace('.', ',') + ' g/Portion'
  if (portion.salt > 5) add(bad, -1, 'sehr viel Salz (' + saltText + ')')
  else if (portion.salt > 3.5) add(bad, -0.5, 'viel Salz (' + saltText + ')')
  // Getränke mit Alkohol (Wein, Sekt, Likör ≥ 30 % des Gerichts) – beim Schmoren verkocht der Alkohol größtenteils
  if (mass > 0 && groups.alcohol / mass >= 0.3) add(bad, -2, 'Alkohol')
  if (pg.refinedGrain >= 60 && pg.wholeGrain < 20) add(bad, -0.2, 'Weißmehl/weißer Reis statt Vollkorn')
  // Begründungen aus dem Nutri-Score (verändern den Wert nicht zusätzlich)
  const note = (list: Reason[], points: number, text: string) => list.push({ text, weight: points * 0.25 })
  if (pts.salt >= 6 && portion.salt <= 3.5) note(bad, pts.salt - 3, 'salzig (' + saltText + ')')
  if (pts.sugar >= 5) note(bad, pts.sugar - 2, 'viel Zucker (' + Math.round(portion.sugar) + ' g/Portion)')
  if (pts.sat >= 5 && portion.satFat <= 15) note(bad, pts.sat - 2, 'viele gesättigte Fette')
  if (pts.energy >= 5) note(bad, pts.energy - 3, 'sehr energiedicht')
  if (pts.fiber >= 3) note(good, pts.fiber, 'viele Ballaststoffe')
  if (proteinCounts && pts.protein >= 5) note(good, pts.protein - 3, 'viel Eiweiß')
  if (pts.salt <= 1 && pts.sugar <= 1) note(good, 1, 'wenig Salz und Zucker')
  else if (pts.salt <= 1) note(good, 0.8, 'wenig Salz')
  score = Math.max(0, Math.min(10, Math.round(score * 10) / 10))
  const top = (list: Reason[]) => [...list].sort((a, b) => b.weight - a.weight).slice(0, 3).map(r => r.text)
  return { score, portion, groups: perPortion, good: top(good), bad: top(bad), coverage, nutriPoints, missing }
}

// Wochencheck nach DGE 2024, je Person aus den geplanten Mahlzeiten.
export type WeekMeal = { health: HealthResult | null; portions: number }
export type WeekHealth = { avg: number | null; scored: number; meat: number; redMeat: number; fishMeals: number; legumes: number; persons: number }
export const WEEK_GOALS = { meatMax: 300, fishMin: 1, fishMax: 2, legumesMin: 125 }
export function weekHealth(meals: WeekMeal[], persons = 2): WeekHealth {
  const p = Math.max(1, persons)
  let sum = 0, scored = 0, meat = 0, red = 0, fish = 0, legumes = 0
  for (const m of meals) {
    if (!m.health) continue
    const portions = Math.max(0, num(m.portions))
    if (m.health.score !== null) { sum += m.health.score; scored++ }
    const g = m.health.groups
    meat += (g.redMeat + g.processedMeat + g.poultry) * portions
    red += (g.redMeat + g.processedMeat) * portions
    legumes += g.legumes * portions
    if (g.fish >= 50) fish += portions
  }
  return { avg: scored ? Math.round(sum / scored * 10) / 10 : null, scored, meat: meat / p, redMeat: red / p, fishMeals: fish / p, legumes: legumes / p, persons: p }
}
