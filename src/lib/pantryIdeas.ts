// „Was kochen?“ – KI-Ideen aus dem Vorrat (0.3.50, Nick 23.11.2026): Prompt und Auswertung der Antwort.
// Regeln (Nick): hauptsächlich aus dem Vorrat, bald Ablaufendes zuerst, höchstens 2–3 fehlende Zutaten,
// Haushaltsregeln (histaminarm, tomatenfrei …) und Gluten/Hefe-Regel wie bei den Rezepten. Nur auf Knopfdruck.
import { applyHistamineRules } from './histamineRules.ts'
import { forbidden, parseHistamine, parseNumber, parseTimes, ruleLines, stepsOf, unitAliases, type AiHistamine, type AiRules } from './recipeAi.ts'
import { matchRecipeGroup, recipeGroups } from './recipeGroups.ts'

export type IdeaPantryItem = { name: string; quantity: number | string | null; unit: string | null; best_before: string | null }
export type IdeaIngredient = { name: string; quantity: number | null; unit: string | null }
export type PantryIdea = { title: string; description: string | null; group: string | null; servings: number; prepMinutes: number | null; cookMinutes: number | null; histamine: AiHistamine; ingredients: IdeaIngredient[]; steps: string[] }

const keyOf = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()
const cap = (value: string) => value ? value.charAt(0).toLocaleUpperCase('de-DE') + value.slice(1) : value
const amountText = (item: IdeaPantryItem) => {
  const q = item.quantity === null || item.quantity === '' ? null : Number(item.quantity)
  return q !== null && Number.isFinite(q) ? String(Math.round(q * 100) / 100).replace('.', ',') + (item.unit ? ' ' + item.unit : '') : ''
}

export function buildPantryIdeasMessages(pantry: IdeaPantryItem[], staples: string[], rules: AiRules, soon: string, count = 4) {
  const sorted = [...pantry].sort((a, b) => (a.best_before ?? '9999') < (b.best_before ?? '9999') ? -1 : 1)
  const stock = sorted.slice(0, 80).map(item => {
    const expiring = Boolean(item.best_before && item.best_before <= soon)
    const amount = amountText(item)
    return '- ' + (expiring ? '! ' : '') + item.name.slice(0, 60) + (amount ? ' (' + amount + ')' : '')
  })
  const system = 'Du bist eine erfahrene Hausköchin. Du schlägst alltagstaugliche Gerichte für zwei Personen vor und antwortest nur auf Deutsch und genau im verlangten Format, ohne Einleitung.'
  const user = [
    'Schlage ' + count + ' verschiedene Gerichte vor, die man hauptsächlich aus diesem Vorrat kochen kann. Mit „!“ markierte Zutaten laufen bald ab – nutze sie bevorzugt.',
    'Vorrat:', ...stock,
    staples.length ? 'Immer vorhanden (Grundausstattung): ' + staples.slice(0, 60).join(', ') + '.' : '',
    'Regeln:',
    '- Pro Gericht höchstens 2 Zutaten, die weder im Vorrat noch in der Grundausstattung stehen.',
    '- Mengen für 2 Portionen, realistisch und in g, ml, Stk, EL, TL oder Prise.',
    '- Zubereitung am Herd oder im Backofen, kein Thermomix. Am Herd Hitzestufen statt °C, °C nur für den Backofen.',
    ...ruleLines(rules).map(line => '- ' + line),
    '- Histaminwert von 1 (sehr histaminreich) bis 10 (histaminarm) mit einer Nachkommastelle (z. B. 6,5). Gluten und Hefe lass bei deiner Zahl außen vor – die rechnet die App selbst ein.',
    '- Ordne jedes Gericht genau einer Gruppe zu: ' + recipeGroups.join(', ') + '.',
    'Format – für jedes Gericht genau so, Gerichte getrennt durch eine Zeile mit ---:',
    'GERICHT: Name des Gerichts',
    'GRUPPE: eine der genannten Gruppen',
    'BESCHREIBUNG: ein kurzer Satz',
    'PORTIONEN: 2',
    'ZEIT: Vorbereitung 10 Min | Kochen 20 Min',
    'HISTAMIN: 7 | kurze Begründung',
    'ZUTATEN:',
    '- Name | Menge | Einheit',
    'SCHRITTE:',
    '1. erster Schritt',
    '2. zweiter Schritt',
  ].filter(Boolean).join('\n')
  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

const header = /^(gericht|gruppe|beschreibung|portionen|zeit|histamin|zutaten|schritte|anleitung|zubereitung)\w*\s*:/i

function parseBlock(block: string, rules: AiRules): PantryIdea | null {
  const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const value = (re: RegExp) => (lines.find(line => re.test(line)) ?? '').replace(re, '').trim()
  const title = cap(value(/^gericht\w*\s*:\s*/i).replace(/^["„“]|["“”]$/g, '')).slice(0, 80)
  if (!title) return null
  const ingredientsAt = lines.findIndex(line => /^zutaten\s*:?\s*$/i.test(line))
  const stepsAt = lines.findIndex(line => /^(schritte|anleitung|zubereitung)\s*:?\s*$/i.test(line))
  if (ingredientsAt < 0 || stepsAt < 0) return null
  const ingredientLines = lines.slice(ingredientsAt + 1, stepsAt > ingredientsAt ? stepsAt : undefined).filter(line => !header.test(line))
  const ingredients: IdeaIngredient[] = []
  for (const raw of ingredientLines) {
    const parts = raw.replace(/^[-*•]\s*/, '').split('|').map(part => part.trim())
    const name = cap(parts[0].replace(/\(.*?\)/g, '').replace(/[.:;]+$/, '').trim()).slice(0, 40)
    if (!name || name.length < 2) continue
    if (forbidden(name, rules)) return null // verstößt gegen die Haushaltsregeln → ganzes Gericht verwerfen
    const quantity = parts[1] ? parseNumber(parts[1]) : null
    const unitRaw = (parts[2] ?? '').replace(/[.()]/g, '').trim()
    const unit = unitAliases[keyOf(unitRaw)] ?? (unitRaw && unitRaw.length <= 12 ? unitRaw : null)
    if (!ingredients.some(i => keyOf(i.name) === keyOf(name))) ingredients.push({ name, quantity: quantity === null ? null : Math.round(quantity * 100) / 100, unit })
  }
  const steps = stepsOf(lines.slice(stepsAt + 1).filter(line => !header.test(line)))
  if (ingredients.length < 2 || steps.length < 2) return null
  const servingsRaw = Number(value(/^portionen\w*\s*:\s*/i).match(/\d{1,2}/)?.[0] ?? 2)
  const servings = servingsRaw >= 1 && servingsRaw <= 12 ? servingsRaw : 2
  const times = parseTimes(lines)
  const histamine = applyHistamineRules(parseHistamine(lines), ingredients, servings)
  return { title, description: value(/^beschreibung\w*\s*:\s*/i).slice(0, 200) || null, group: matchRecipeGroup(value(/^gruppe\w*\s*:\s*/i).split('|')[0]), servings, prepMinutes: times.prepMinutes, cookMinutes: times.cookMinutes, histamine, ingredients, steps }
}

export function parsePantryIdeas(text: string, rules: AiRules): PantryIdea[] {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim()
  const blocks = clean.split(/^\s*-{3,}\s*$/m).flatMap(part => part.split(/(?=^\s*gericht\w*\s*:)/im))
  const ideas: PantryIdea[] = []
  for (const block of blocks) {
    const idea = parseBlock(block, rules)
    if (idea && !ideas.some(i => keyOf(i.title) === keyOf(idea.title))) ideas.push(idea)
  }
  return ideas.slice(0, 6)
}
