// Feste Histamin-Regel (0.3.59, Nick 25.11.2026): Lebensmittel, die Histamin freisetzen, den Abbau bremsen oder selbst
// histaminreich sind, deckeln den KI-Histaminwert – die KI schätzt weiter, übersieht so etwas aber manchmal
// (Beispiel: „Lachs mit Erdbeertopping“ 9,5 mit „Erdbeeren histaminarm“).
// Liste nach TUM Klinikum rechts der Isar, „Histaminintoleranz – essen und trinken“ (2023).
// Deckel statt Abzug, damit nichts doppelt zählt, wenn die KI es schon gesehen hat:
//   1 kritische Hauptzutat (ab 30 g je Portion) → höchstens 6,0 · 2 → 4,5 · 3 und mehr → 3,0
//   nur kleine Mengen (3–30 g je Portion, oder ohne Mengenangabe) → höchstens 8,0 · unter 3 g je Portion zählt nicht.
// Brühwürfel zählen nicht (Nick). Danach rechnet applyGlutenYeast Gluten und Hefe ab wie bisher.
import { gramsOf, type HealthFood } from './health.ts'
import { applyGlutenYeast, type AiHistamine, type PenaltyIngredient } from './recipeAi.ts'

type Why = 'frei' | 'abbau' | 'reich'
const WHY: Record<Why, string> = { frei: 'setzt Histamin frei', abbau: 'bremst den Histamin-Abbau', reich: 'histaminreich' }
type Rule = { label: string; why: Why; test: RegExp; not?: RegExp }

// Reihenfolge zählt: die erste passende Regel gewinnt (Erdbeerkonfitüre → Erdbeeren, nicht Marmelade).
export const HISTAMINE_RULES: Rule[] = [
  { label: 'Erdbeeren', why: 'frei', test: /erdbeer/ },
  { label: 'Zitrusfrüchte', why: 'frei', test: /zitron|limett|orange|mandarin|grapefruit|pampelmuse|clementin|pomelo|yuzu/, not: /zitronengras|zitronenmelisse|zitronenthymian|kaffir|limettenblaett|orangenlimonade/ },
  { label: 'Tomaten', why: 'frei', test: /tomat|ketchup/ },
  { label: 'Meeresfrüchte', why: 'frei', test: /garnel|krabbe|shrimp|scampi|muschel|tintenfisch|calamar|hummer|langust|meeresfruecht|krebs/ },
  { label: 'Alkohol', why: 'frei', test: /wein\b|rotwein|weisswein|gluehwein|sekt|prosecco|champagner|bier\b|likoer|\brum\b|cognac|weinbrand|aperol|marsala|wermut|\bsake\b|cidre|schnaps|wodka|vodka|whisk|\bgin\b|amaretto|portwein|sherry|grappa|kirschwasser|obstler/, not: /malzbier|alkoholfrei|essig|weinstein|weintraub|traubensaft/ },
  { label: 'Glutamat', why: 'frei', test: /glutamat|mononatrium/ },
  { label: 'Banane', why: 'abbau', test: /banan/ },
  { label: 'Ananas', why: 'abbau', test: /ananas/ },
  { label: 'Papaya', why: 'abbau', test: /papaya/ },
  { label: 'Cashew-/Walnüsse', why: 'abbau', test: /cashew|walnu/ },
  { label: 'Kakao/Schokolade', why: 'abbau', test: /kakao|schoko|kuvert|nougat|nutella|mokkabohne|dominostein|oreo|brownie/ },
  { label: 'Kiwi', why: 'reich', test: /kiwi/ },
  { label: 'Himbeeren', why: 'reich', test: /himbeer/ },
  { label: 'Nüsse', why: 'reich', test: /haselnu|erdnu|mandel|pistazi|macadamia|pekan|paranu|nuesse|\bnuss\b/, not: /muskat|kokos/ },
  { label: 'Spinat', why: 'reich', test: /spinat/ },
  { label: 'Sauerkraut', why: 'reich', test: /sauerkraut/ },
  { label: 'gereifter Käse', why: 'reich', test: /parmesan|parmigiano|grana padano|pecorino|emmentaler|bergkaese|appenzeller|gruyere|comte|cheddar|gouda|camembert|\bbrie\b|tilsiter|edamer|chester|harzer|gorgonzola|blauschimmel|roquefort|schmelzkaese|provolone|fontina|taleggio|scamorza|raclette|manchego/ },
  { label: 'Wurst/Geräuchertes', why: 'reich', test: /speck|bacon|schinken|salami|kasseler|wurst|wuerst|chorizo|pancetta|mortadella|raeucher|geraeuchert|pastrami|bresaola|cabanossi|kabanos|leberkaese/, not: /paprikapulver|rauchsalz/ },
  { label: 'Thunfisch/Makrele/Fischkonserven', why: 'reich', test: /thunfisch|makrele|hering|sardell|sardine|anchovi|matjes|fischkonserve|fischsauce|fischsosse/ },
  { label: 'Soja', why: 'reich', test: /soja|tofu|tempeh|\bmiso\b|edamame|tamari|natto/ },
  { label: 'Fermentierte Würzsaucen', why: 'reich', test: /gochujang|worcester|kimchi/ },
  { label: 'Rotweinessig/Balsamico', why: 'reich', test: /rotweinessig|balsamico|aceto/ },
  { label: 'Hefeextrakt', why: 'reich', test: /hefeextrakt/ },
  { label: 'Marmelade/Nougat/Marzipan', why: 'reich', test: /konfituere|marmelade|\bgelee\b|marzipan/ },
  { label: 'Algen', why: 'reich', test: /\bnori|algen|wakame|kombu|spirulina/ },
  { label: 'Sprossen/Keime', why: 'reich', test: /sprossen|keimling|weizenkeim/ },
  { label: 'Eingelegtes', why: 'reich', test: /gewuerzgurke|essiggurke|cornichon|\boliven\b|kapern|eingelegt/ },
  { label: 'Schwarzer/grüner Tee', why: 'reich', test: /schwarztee|gruentee|schwarzer tee|gruener tee|matcha|brennnessel|^tee$/ },
]

const keyOf = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()
export function histamineRuleFor(name: string, foodName?: string | null): Rule | null {
  const keys = [keyOf(name), keyOf(foodName ?? '')].filter(Boolean)
  return HISTAMINE_RULES.find(rule => keys.some(k => rule.test.test(k) && !rule.not?.test(k))) ?? null
}

export type RuleIngredient = PenaltyIngredient & { food?: HealthFood | null }
export type HistamineCheck = { cap: number | null; main: string[]; small: string[] }
const MAIN_GRAMS = 30, MIN_GRAMS = 3

export function histamineCheck(ingredients: RuleIngredient[], servings: number): HistamineCheck {
  const portions = Math.max(1, Number(servings) || 1)
  const perGroup = new Map<Rule, number | null>() // Gramm je Portion; null = ohne Mengenangabe
  for (const ing of ingredients) {
    if (ing.is_optional) continue
    const rule = histamineRuleFor(ing.name, ing.food?.name)
    if (!rule) continue
    const amount = gramsOf({ name: ing.name, quantity: ing.quantity, unit: ing.unit, food: ing.food ?? null })
    const grams = amount ? amount.grams / portions : null
    const before = perGroup.get(rule)
    perGroup.set(rule, before === undefined ? grams : grams === null ? before : (before ?? 0) + grams)
  }
  const main: string[] = [], small: string[] = []
  for (const [rule, grams] of perGroup) {
    const text = rule.label + ' (' + WHY[rule.why] + ')'
    if (grams !== null && grams >= MAIN_GRAMS) main.push(text)
    else if (grams === null || grams >= MIN_GRAMS) small.push(text)
  }
  const cap = main.length >= 3 ? 3 : main.length === 2 ? 4.5 : main.length === 1 ? 6 : small.length ? 8 : null
  return { cap, main, small }
}

const one = (n: number) => n.toFixed(1).replace('.', ',')
// KI-Wert → Deckel für kritische Zutaten → Gluten/Hefe abziehen (nie unter 1).
export function applyHistamineRules(histamine: AiHistamine, ingredients: RuleIngredient[], servings: number): AiHistamine {
  if (histamine.score === null) return histamine
  const check = histamineCheck(ingredients, servings)
  let capped = histamine
  if (check.cap !== null && histamine.score > check.cap) {
    const parts = [check.main.length ? 'Hauptzutat: ' + check.main.join(', ') : '', !check.main.length && check.small.length ? 'in kleiner Menge: ' + check.small.join(', ') : ''].filter(Boolean)
    const rule = 'Feste Regel – ' + parts.join('; ') + ' → höchstens ' + one(check.cap) + '.'
    capped = { score: check.cap, note: (rule + (histamine.note ? ' KI-Einschätzung: ' + histamine.note.trim() : '')).slice(0, 480) }
  }
  return applyGlutenYeast(capped, ingredients)
}
