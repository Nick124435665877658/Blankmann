// KI-Rezeptergänzung: Prompt bauen und Antwort auslesen (Anleitung, fehlende Mengen, Zeiten, Histamin
// und – wenn gewünscht – zusätzliche Zutaten/Gewürze, gekennzeichnet als Grundausstattung).
// Wird von der Cloudflare-Funktion (functions/api/recipe-instructions.ts) und den Tests genutzt.
import { matchRecipeGroup, recipeGroups } from './recipeGroups.ts'

export type AiIngredient = { id: string; name: string; quantity: number | null; unit: string | null; is_optional: boolean }
export type AiRecipe = { title: string; description: string | null; servings: number; prep_minutes: number | null; cook_minutes: number | null; source_type?: string | null }
// Thermomix-Rezepte (aus Cookidoo): Mengen der vorhandenen Zutaten sind fest – die KI darf nur ergänzen.
export const isThermomix = (recipe: { source_type?: string | null }) => recipe.source_type === 'cookidoo'
export type AiQuantity = { id: string; quantity: number; unit: string | null }
export type AiTimes = { prepMinutes: number | null; cookMinutes: number | null }
export type AiHistamine = { score: number | null; note: string | null }
export type AiAddition = { name: string; quantity: number | null; unit: string | null; staple: boolean }

// Gluten und Hefe (Nick, 22.11.2026): senken den Histaminwert zusätzlich – als Hauptzutat je −2, in kleinen Mengen −1,
// zusammen höchstens −4, der Wert bleibt mindestens 1. Die App rechnet das fest nach der KI-Bewertung ein (gleiche Regel
// wie bei der einmaligen Neubewertung am 22.11.2026). Hafer zählt nicht mit; Reis, Mais, Buchweizen, Kartoffel & Co. sind glutenfrei.
type PenaltyIngredient = { name: string; quantity: number | null; unit: string | null; is_optional?: boolean }
const glutenFree = /glutenfrei|glasnudel|reisnudel|zucchininudel|reispapier|maisgriess|polenta|buchweizen|reismehl|maismehl|kartoffelmehl|mandelmehl|kokosmehl|kichererbsenmehl|johannisbrot|tapioka|staerke|brotgewuerz|hirse|quinoa|amaranth/
const glutenWords = /weizen|dinkel|roggen|gerste|graupen|gruenkern|emmer|einkorn|kamut|seitan|mehl|griess|semmel|brot|broetchen|toast|ciabatta|baguette|brez|laugen|nudel|spaghetti|penne|rigatoni|makkaroni|macaroni|lasagne|tagliatelle|fusilli|farfalle|spaetzle|maultasch|gnocchi|couscous|bulgur|udon|ramen|\bmie\b|teig|keks|cookie|biskuit|cantuccini|spekulatius|oreo|lotus|zwieback|waffel|oblate|dominostein|tortilla|wrap|\bmalz|bier\b|soja ?sauce|sojasosse/
const yeastSmall = /hefeflocken|hefeextrakt/
// Ungefähres Gewicht in g, um Hauptzutat (ab 50 g im Rezept) und kleine Menge zu unterscheiden.
function approxGrams(i: PenaltyIngredient): number | null {
  if (i.quantity === null || !(i.quantity > 0)) return null
  const u = keyOf(i.unit ?? '')
  if (u === 'g' || u === 'ml') return i.quantity
  if (u === 'kg' || u === 'l') return i.quantity * 1000
  if (u === 'el') return i.quantity * 10
  if (u === 'tl') return i.quantity * 3
  if (u === 'prise' || u === 'messerspitze' || u === 'tropfen' || u === 'spritzer') return i.quantity * 0.5
  if (/scheibe/.test(u)) return i.quantity * 30
  if (/blatt/.test(u)) return i.quantity * 2
  if (/pck|packung|beutel|dose|glas|rolle/.test(u)) return i.quantity * 250
  return i.quantity * 60 // Stk, Brötchen, Brezen …
}
export function glutenYeastPenalty(ingredients: PenaltyIngredient[]): { penalty: number; gluten: number; yeast: number; glutenNames: string[]; yeastNames: string[] } {
  const used = ingredients.filter(i => !i.is_optional)
  const glutenItems = used.filter(i => { const k = keyOf(i.name); return glutenWords.test(k) && !glutenFree.test(k) })
  const yeastItems = used.filter(i => /hefe/.test(keyOf(i.name)))
  const glutenGrams = glutenItems.reduce((sum, i) => sum + (approxGrams(i) ?? 0), 0)
  const gluten = glutenItems.length === 0 ? 0 : glutenGrams >= 50 ? 2 : 1
  const leavening = yeastItems.filter(i => !yeastSmall.test(keyOf(i.name)))
  const flakeGrams = yeastItems.filter(i => yeastSmall.test(keyOf(i.name))).reduce((sum, i) => sum + (approxGrams(i) ?? 0), 0)
  const yeast = leavening.length ? 2 : yeastItems.length === 0 ? 0 : flakeGrams >= 20 ? 2 : 1
  return { penalty: Math.min(4, gluten + yeast), gluten, yeast, glutenNames: glutenItems.map(i => i.name), yeastNames: yeastItems.map(i => i.name) }
}
export function applyGlutenYeast(histamine: AiHistamine, ingredients: PenaltyIngredient[]): AiHistamine {
  if (histamine.score === null) return histamine
  const p = glutenYeastPenalty(ingredients)
  if (!p.penalty) return histamine
  const parts = [p.gluten ? 'Gluten (' + [...new Set(p.glutenNames)].slice(0, 3).join(', ') + ')' : '', p.yeast ? 'Hefe' : ''].filter(Boolean).join(' und ')
  const note = [histamine.note, parts + ' ' + (p.gluten && p.yeast ? 'senken' : 'senkt') + ' den Wert zusätzlich um ' + p.penalty + '.'].filter(Boolean).join(' ').slice(0, 300)
  return { score: Math.max(1, histamine.score - p.penalty), note }
}
// Haushaltsregeln aus den Einstellungen (Standard wie in household_settings: alles an).
export type AiRules = { tomatoFree: boolean; creamFree: boolean; histamineLow: boolean; vegetableRich: boolean; notes: string | null }
export const defaultRules: AiRules = { tomatoFree: true, creamFree: true, histamineLow: true, vegetableRich: true, notes: null }
export type AiOptions = { addIngredients?: boolean; rules?: AiRules }

function ruleLines(rules: AiRules) {
  return [
    rules.tomatoFree ? 'Keine Tomaten und keine Tomatenprodukte (auch kein Tomatenmark, Ketchup, passierte Tomaten).' : '',
    rules.creamFree ? 'Keine Sahne (auch keine Kochsahne, kein Schmand, keine Crème fraîche).' : '',
    rules.histamineLow ? 'Histaminarm: keine histaminreichen Zutaten oder Histaminliberatoren ergänzen (z. B. gereifter Käse, Spinat, Aubergine, Avocado, Essig, Sojasauce, Hefeextrakt, Zitrusfrüchte, Nüsse, Wein, Wurst, Räucherfisch).' : '',
    rules.vegetableRich ? 'Gemüse darf gern einen großen Teil ausmachen.' : '',
    rules.notes ? 'Weitere Hinweise des Haushalts: ' + rules.notes.slice(0, 300) : '',
  ].filter(Boolean)
}
// Sicherheitsnetz: Ergänzungen, die gegen die Haushaltsregeln verstoßen, werden verworfen.
function forbidden(name: string, rules: AiRules) {
  const n = keyOf(name)
  return (rules.tomatoFree && /tomat|ketchup/.test(n))
    || (rules.creamFree && /sahne|schmand|creme fraiche|schlagrahm/.test(n))
    || (rules.histamineLow && /parmesan|gouda|bergkaese|emmentaler|cheddar|spinat|aubergine|avocado|essig|soja ?sauce|sojasosse|hefeextrakt|zitrone|limette|orange|wein|walnuss|haselnuss|cashew|erdnuss|salami|schinken|thunfisch|sardelle|sauerkraut|hartkaese|camembert|brie/.test(n))
}

const keyOf = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()
const amount = (i: AiIngredient) => (i.quantity !== null ? String(i.quantity).replace('.', ',') + (i.unit ? ' ' + i.unit : '') + ' ' : '') + i.name

export function buildRecipeMessages(recipe: AiRecipe, ingredients: AiIngredient[], options: AiOptions = {}) {
  const rules = options.rules ?? defaultRules
  const add = Boolean(options.addIngredients)
  const missing = ingredients.filter(i => i.quantity === null)
  const list = ingredients.map(i => '- ' + amount(i) + (i.quantity === null ? ' (Menge fehlt)' : '') + (i.is_optional ? ' (optional)' : '')).join('\n')
  const times = [recipe.prep_minutes ? 'Vorbereitung ca. ' + recipe.prep_minutes + ' Min.' : '', recipe.cook_minutes ? 'Kochzeit ca. ' + recipe.cook_minutes + ' Min.' : ''].filter(Boolean).join(', ')
  const servings = String(recipe.servings).replace('.', ',')
  const thermomix = isThermomix(recipe)
  const user = [
    'Rezept: ' + recipe.title,
    recipe.description ? 'Beschreibung: ' + recipe.description : '',
    'Portionen: ' + servings,
    times,
    'Zutaten:', list || '- (keine Zutaten hinterlegt)',
    '',
    thermomix ? 'Das ist ein Thermomix-Rezept aus Cookidoo. Die Mengen der aufgeführten Zutaten sind fest: Ändere sie nicht und nenne sie in den Schritten genau so. Du darfst nur fehlende Mengen ergänzen und zusätzliche Zutaten oder Gewürze hinzufügen. Verwende alle aufgeführten Zutaten.' : '',
    missing.length
      ? 'Ergänze zuerst übliche Mengen für ' + servings + ' Portionen für jede Zutat mit „(Menge fehlt)“. Verwende als Einheit nur g, ml, Stk, EL, TL, Bund oder Prise.'
      : 'Alle Mengen sind vorhanden.',
    add
      ? 'Ergänze danach fehlende Zutaten und Gewürze, die für ein gutes, alltagstaugliches Ergebnis nötig sind (höchstens 8), z. B. Salz, Pfeffer, Öl, Kräuter, Gewürze, Zwiebel oder Knoblauch – nur, was wirklich fehlt. Jede Zutat, die du in den Schritten zusätzlich verwendest, muss unter ERGÄNZT stehen (Wasser nicht). Markiere Salz, Pfeffer, Öl, Gewürze, Brühe und ähnliche Vorräte, die man meist zu Hause hat, mit „Grundausstattung ja“, alles andere mit „nein“.'
      : 'Verwende nur die genannten Zutaten; Salz, Pfeffer, Öl und Wasser sind erlaubt.',
    // Bei Thermomix-Rezepten gelten die Haushaltsregeln nur für ergänzte Zutaten – das Original bleibt vollständig.
    ...(thermomix && ruleLines(rules).length ? ['Für Zutaten, die du ergänzt, gilt:', ...ruleLines(rules)] : ruleLines(rules)),
    'Schreibe dann eine Schritt-für-Schritt-Kochanleitung mit 4 bis 10 Schritten. Nenne Mengen und realistische Garzeiten.',
    thermomix ? 'Schreibe die Anleitung ohne Thermomix – ganz normal mit Herd, Backofen, Topf, Pfanne, Schüssel, Schneebesen, Handrührgerät oder Pürierstab. Keine Thermomix-Angaben wie Stufe, Linkslauf, Varoma, Mixtopf oder Sanftrührstufe.' : '',
    'Temperaturen in °C nur für den Backofen; auf dem Herd schreibe Hitzestufen wie „mittlere Hitze“ oder „hohe Hitze“.',
    'Gib außerdem eine realistische Zeit an: Vorbereitung (Waschen, Schneiden) und Kochen (Garzeit am Herd/im Ofen) in Minuten, passend zu deinen Schritten.',
    'Bewerte zuletzt, wie histaminarm das Gericht ist: 1 = sehr histaminreich, 10 = praktisch histaminfrei. Achte auf histaminreiche Lebensmittel und Histaminliberatoren (z. B. gereifter Käse, Tomaten, Spinat, Aubergine, Avocado, Fermentiertes, Essig, Hefeextrakt, geräuchertes oder gepökeltes Fleisch, nicht ganz frischer Fisch, Zitrusfrüchte, Nüsse, Schokolade, Alkohol) und auf lange Lager- oder Garzeiten. Gluten (Weizen, Dinkel, Roggen, Gerste) und Hefe lass bei deiner Zahl außen vor – die rechnet die App selbst ein. Nenne in einem kurzen Satz die Zutaten, die den Wert drücken.',
    'Ordne das Rezept genau einer Gruppe zu: ' + recipeGroups.join(', ') + '.',
    '',
    'Antworte genau in diesem Format, ohne Einleitung und ohne Schlusswort:',
    'MENGEN:',
    missing.length ? missing.map(i => '- ' + i.name + ' | Zahl | Einheit').join('\n') : '- keine',
    ...(add ? ['ERGÄNZT:', '- Name | Zahl | Einheit | Grundausstattung ja/nein', '(eine Zeile je zusätzlicher Zutat, oder „- keine“)'] : []),
    'ZEIT: Vorbereitung Zahl Min | Kochen Zahl Min',
    'HISTAMIN: Zahl von 1 bis 10 | kurze Begründung',
    'GRUPPE: eine der genannten Gruppen',
    'SCHRITTE:',
    '1. …',
    '2. …',
  ].filter(line => line !== '').join('\n')
  return [
    { role: 'system', content: 'Du bist eine erfahrene Köchin und schreibst klare, alltagstaugliche Rezepte auf Deutsch.' },
    { role: 'user', content: user },
  ]
}

const unitAliases: Record<string, string> = { gramm: 'g', gr: 'g', g: 'g', kilogramm: 'kg', kg: 'kg', milliliter: 'ml', ml: 'ml', liter: 'l', l: 'l', stueck: 'Stk', stuck: 'Stk', stk: 'Stk', st: 'Stk', essloeffel: 'EL', el: 'EL', teeloeffel: 'TL', tl: 'TL', bund: 'Bund', prise: 'Prise', prisen: 'Prise', zehe: 'Zehe', zehen: 'Zehe' }
function parseNumber(value: string): number | null {
  const v = value.trim().replace('½', '.5').replace('¼', '.25').replace('¾', '.75').replace(',', '.')
  const fraction = v.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (fraction) return Number(fraction[1]) / Number(fraction[2])
  const range = v.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/)
  if (range) return (Number(range[1]) + Number(range[2])) / 2
  const n = Number(v.replace(/^\./, '0.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

function stepsOf(lines: string[]): string[] {
  const numbered = lines.map(line => line.match(/^(?:schritt\s*)?\d{1,2}\s*[.):-]\s*(.+)$/i)?.[1]?.trim()).filter((s): s is string => Boolean(s))
  const steps = numbered.length >= 2 ? numbered : lines.filter(line => !/^#|^(zutaten|anleitung|zubereitung|mengen|schritte)\s*:?$/i.test(line)).map(line => line.replace(/^[-*•]\s*/, ''))
  return steps.filter(step => step && step !== '…').slice(0, 15).map(step => step.slice(0, 600))
}

// Antwort der KI → Schritte + Mengen für die Zutaten, denen bisher eine Menge fehlt.
function parseTimes(lines: string[]): AiTimes {
  const line = lines.find(l => /^zeit\b/i.test(l)) ?? lines.find(l => /vorbereitung/i.test(l) && /(kochen|garen|kochzeit|backen)/i.test(l)) ?? ''
  const minutes = (re: RegExp) => { const m = line.match(re); const n = m ? Number(m[1]) : NaN; return Number.isInteger(n) && n >= 0 && n <= 600 ? n : null }
  return { prepMinutes: minutes(/vorbereit\w*\D{0,12}?(\d{1,3})/i), cookMinutes: minutes(/(?:kochen|kochzeit|garen|garzeit|backen|backzeit)\D{0,12}?(\d{1,3})/i) }
}

function parseHistamine(lines: string[]): AiHistamine {
  const line = lines.find(l => /^histamin/i.test(l)) ?? ''
  const match = line.match(/^histamin\w*\s*:?\s*(\d{1,2})\s*(?:\/\s*10)?\s*(?:[|–—:-]\s*(.*))?$/i)
  const score = match ? Number(match[1]) : NaN
  if (!Number.isInteger(score) || score < 1 || score > 10) return { score: null, note: null }
  return { score, note: (match?.[2] ?? '').trim().slice(0, 240) || null }
}

const additionsHeader = /^(?:erg(?:ä|ae)nzt|erg(?:ä|ae)nzte zutaten|zus(?:ä|ae)tzliche zutaten)\s*:?\s*$/i
const isHeader = (line: string) => /^(mengen|zutaten|schritte|anleitung|zubereitung)\s*:?\s*$/i.test(line) || additionsHeader.test(line) || /^(zeit|histamin|gruppe)\w*\s*:/i.test(line)
const cap = (value: string) => value ? value.charAt(0).toLocaleUpperCase('de-DE') + value.slice(1) : value

function parseGroup(lines: string[]): string | null {
  const line = lines.find(l => /^gruppe\w*\s*:/i.test(l)) ?? ''
  return matchRecipeGroup(line.replace(/^gruppe\w*\s*:\s*/i, '').split('|')[0])
}

export function parseRecipeAnswer(text: string, ingredients: AiIngredient[], rules: AiRules = defaultRules): { steps: string[]; quantities: AiQuantity[]; times: AiTimes; histamine: AiHistamine; additions: AiAddition[]; group: string | null } {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim()
  const lines = clean.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const mengenAt = lines.findIndex(line => /^(mengen|zutaten)\s*:?\s*$/i.test(line))
  const schritteAt = lines.findIndex(line => /^(schritte|anleitung|zubereitung)\s*:?\s*$/i.test(line))
  const additionsAt = lines.findIndex(line => additionsHeader.test(line))
  const sectionAfter = (at: number) => { if (at < 0) return []; const rest = lines.slice(at + 1); const end = rest.findIndex(isHeader); return end < 0 ? rest : rest.slice(0, end) }
  const quantityLines = sectionAfter(mengenAt)
  const additionLines = sectionAfter(additionsAt)
  const stepLines = (schritteAt >= 0 ? lines.slice(schritteAt + 1) : mengenAt >= 0 || additionsAt >= 0 ? [] : lines).filter(line => !/^(zeit|histamin|gruppe)/i.test(line))
  const missing = ingredients.filter(i => i.quantity === null)
  const quantities: AiQuantity[] = []
  for (const raw of quantityLines) {
    const parts = raw.replace(/^[-*•]\s*/, '').split('|').map(part => part.trim())
    if (parts.length < 2) continue
    const quantity = parseNumber(parts[1])
    if (quantity === null) continue
    const name = keyOf(parts[0])
    const match = missing.find(i => keyOf(i.name) === name) ?? missing.find(i => name && (keyOf(i.name).includes(name) || name.includes(keyOf(i.name))))
    if (!match || quantities.some(q => q.id === match.id)) continue
    const unitRaw = (parts[2] ?? '').replace(/[.()]/g, '').trim()
    const unit = unitAliases[keyOf(unitRaw)] ?? (unitRaw && unitRaw.length <= 12 ? unitRaw : match.unit)
    quantities.push({ id: match.id, quantity: Math.round(quantity * 100) / 100, unit: unit || null })
  }
  // Zusätzliche Zutaten: nur neue (nicht schon im Rezept), höchstens 8, Haushaltsregeln als Sicherheitsnetz.
  const additions: AiAddition[] = []
  const known = ingredients.map(i => keyOf(i.name))
  for (const raw of additionLines) {
    const parts = raw.replace(/^[-*•]\s*/, '').split('|').map(part => part.trim())
    const name = cap(parts[0].replace(/\(.*?\)/g, '').replace(/[.:;]+$/, '').trim()).slice(0, 40)
    const key = keyOf(name)
    if (!key || /^(keine?|name|nichts)$/.test(key) || key.length < 2) continue
    // Schon im Rezept (auch Einzahl/Mehrzahl: Zwiebel/Zwiebeln, Ei/Eier) → nicht doppelt ergänzen.
    if (known.some(k => k === key || (k.startsWith(key) && /^(n|e|en|s|er|r)$/.test(k.slice(key.length))) || (key.startsWith(k) && /^(n|e|en|s|er|r)$/.test(key.slice(k.length))))) continue
    if (additions.some(a => keyOf(a.name) === key) || forbidden(name, rules)) continue
    const quantity = parts[1] ? parseNumber(parts[1]) : null
    const unitRaw = (parts[2] ?? '').replace(/[.()]/g, '').trim()
    const unit = unitAliases[keyOf(unitRaw)] ?? (unitRaw && unitRaw.length <= 12 && !/^(ja|nein)$/i.test(unitRaw) ? unitRaw : null)
    const staple = /\bja\b|grundausstattung/i.test(parts[3] ?? '') && !/\bnein\b/i.test(parts[3] ?? '')
    additions.push({ name, quantity: quantity === null ? null : Math.round(quantity * 100) / 100, unit, staple })
    if (additions.length >= 8) break
  }
  return { steps: stepsOf(stepLines), quantities, times: parseTimes(lines), histamine: parseHistamine(lines), additions, group: parseGroup(lines) }
}
