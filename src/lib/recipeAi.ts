// KI-Rezeptergänzung: Prompt bauen und Antwort auslesen (Anleitung + fehlende Mengen).
// Wird von der Cloudflare-Funktion (functions/api/recipe-instructions.ts) und den Tests genutzt.

export type AiIngredient = { id: string; name: string; quantity: number | null; unit: string | null; is_optional: boolean }
export type AiRecipe = { title: string; description: string | null; servings: number; prep_minutes: number | null; cook_minutes: number | null }
export type AiQuantity = { id: string; quantity: number; unit: string | null }
export type AiTimes = { prepMinutes: number | null; cookMinutes: number | null }
export type AiHistamine = { score: number | null; note: string | null }

const keyOf = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()
const amount = (i: AiIngredient) => (i.quantity !== null ? String(i.quantity).replace('.', ',') + (i.unit ? ' ' + i.unit : '') + ' ' : '') + i.name

export function buildRecipeMessages(recipe: AiRecipe, ingredients: AiIngredient[]) {
  const missing = ingredients.filter(i => i.quantity === null)
  const list = ingredients.map(i => '- ' + amount(i) + (i.quantity === null ? ' (Menge fehlt)' : '') + (i.is_optional ? ' (optional)' : '')).join('\n')
  const times = [recipe.prep_minutes ? 'Vorbereitung ca. ' + recipe.prep_minutes + ' Min.' : '', recipe.cook_minutes ? 'Kochzeit ca. ' + recipe.cook_minutes + ' Min.' : ''].filter(Boolean).join(', ')
  const servings = String(recipe.servings).replace('.', ',')
  const user = [
    'Rezept: ' + recipe.title,
    recipe.description ? 'Beschreibung: ' + recipe.description : '',
    'Portionen: ' + servings,
    times,
    'Zutaten:', list || '- (keine Zutaten hinterlegt)',
    '',
    missing.length
      ? 'Ergänze zuerst übliche Mengen für ' + servings + ' Portionen für jede Zutat mit „(Menge fehlt)“. Verwende als Einheit nur g, ml, Stk, EL, TL, Bund oder Prise.'
      : 'Alle Mengen sind vorhanden.',
    'Schreibe dann eine Schritt-für-Schritt-Kochanleitung mit 4 bis 10 Schritten. Verwende nur die genannten Zutaten; Salz, Pfeffer, Öl und Wasser sind erlaubt. Füge keine Tomaten und keine Sahne hinzu. Nenne Mengen und realistische Garzeiten.',
    'Temperaturen in °C nur für den Backofen; auf dem Herd schreibe Hitzestufen wie „mittlere Hitze“ oder „hohe Hitze“.',
    'Gib außerdem eine realistische Zeit an: Vorbereitung (Waschen, Schneiden) und Kochen (Garzeit am Herd/im Ofen) in Minuten, passend zu deinen Schritten.',
    'Bewerte zuletzt, wie histaminarm das Gericht ist: 1 = sehr histaminreich, 10 = praktisch histaminfrei. Achte auf histaminreiche Lebensmittel und Histaminliberatoren (z. B. gereifter Käse, Tomaten, Spinat, Aubergine, Avocado, Fermentiertes, Essig, Hefeextrakt, geräuchertes oder gepökeltes Fleisch, nicht ganz frischer Fisch, Zitrusfrüchte, Nüsse, Schokolade, Alkohol) und auf lange Lager- oder Garzeiten. Nenne in einem kurzen Satz die Zutaten, die den Wert drücken.',
    '',
    'Antworte genau in diesem Format, ohne Einleitung und ohne Schlusswort:',
    'MENGEN:',
    missing.length ? missing.map(i => '- ' + i.name + ' | Zahl | Einheit').join('\n') : '- keine',
    'ZEIT: Vorbereitung Zahl Min | Kochen Zahl Min',
    'HISTAMIN: Zahl von 1 bis 10 | kurze Begründung',
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

export function parseRecipeAnswer(text: string, ingredients: AiIngredient[]): { steps: string[]; quantities: AiQuantity[]; times: AiTimes; histamine: AiHistamine } {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim()
  const lines = clean.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const mengenAt = lines.findIndex(line => /^(mengen|zutaten)\s*:?\s*$/i.test(line))
  const schritteAt = lines.findIndex(line => /^(schritte|anleitung|zubereitung)\s*:?\s*$/i.test(line))
  const quantityLines = mengenAt >= 0 ? lines.slice(mengenAt + 1, schritteAt > mengenAt ? schritteAt : undefined) : []
  const stepLines = (schritteAt >= 0 ? lines.slice(schritteAt + 1) : mengenAt >= 0 ? [] : lines).filter(line => !/^(zeit|histamin)/i.test(line))
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
  return { steps: stepsOf(stepLines), quantities, times: parseTimes(lines), histamine: parseHistamine(lines) }
}
