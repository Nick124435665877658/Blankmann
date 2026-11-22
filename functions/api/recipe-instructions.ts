// Cloudflare Pages Function: POST /api/recipe-instructions  { recipeId, addIngredients? }
// Ergänzt mit Cloudflare Workers AI (Gratis-Kontingent) die Kochanleitung, fehlende Zutatenmengen, Zeiten, Histaminwert
// und – mit addIngredients – zusätzliche Zutaten/Gewürze (Haushaltsregeln aus den Einstellungen gelten).
// Antwort: { steps, quantities, times, histamine, additions, group, model } – gespeichert wird in der App.
// Histamin: Gluten und Hefe rechnet die App fest ein (applyGlutenYeast), die KI bewertet nur das Histamin.
// Die Workers-AI-Bindung „AI“ kommt aus wrangler.toml (Produktion und Vorschau) – kein Klick im Dashboard nötig.
// Sicherheit: Das Rezept wird mit dem Login des Nutzers aus Supabase geladen (Zeilenschutz/RLS) –
// nur Haushaltsmitglieder können ihre eigenen Rezepte ergänzen lassen, beliebige Texte gehen nicht an die KI.
import { applyGlutenYeast, buildRecipeMessages, defaultRules, parseRecipeAnswer, type AiIngredient, type AiRecipe, type AiRules } from '../../src/lib/recipeAi'

type AiBinding = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> }
type Env = { AI?: AiBinding; VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }
type Context = { request: Request; env: Env }
type RecipeRow = AiRecipe & { household_id: string; recipe_ingredients: AiIngredient[] }
type SettingsRow = { histamine_low_enabled?: boolean; tomato_free_enabled?: boolean; cream_free_enabled?: boolean; vegetable_rich_enabled?: boolean; dietary_notes?: string | null }

// Öffentliche Werte (stehen auch in .env.example); Pages-Umgebungsvariablen haben Vorrang.
const SUPABASE_URL = 'https://rrjsolyytdktfmrykdca.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_v66KgLKqMrY-UknWgXR-7Q_lDGBHTvF'
// Beide Modelle sind im kostenlosen Workers-Plan nutzbar; das zweite springt ein, wenn das erste ausfällt.
const MODELS: { id: string; input: (messages: { role: string; content: string }[]) => Record<string, unknown> }[] = [
  { id: '@cf/google/gemma-4-26b-a4b-it', input: messages => ({ messages, max_completion_tokens: 1600, temperature: 0.4 }) },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', input: messages => ({ messages, max_tokens: 1600, temperature: 0.4 }) },
]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })

function textOf(output: unknown): string {
  if (typeof output === 'string') return output
  if (!output || typeof output !== 'object') return ''
  const o = output as { response?: unknown; result?: { response?: unknown }; choices?: { message?: { content?: unknown }; text?: unknown }[] }
  if (typeof o.response === 'string') return o.response
  if (typeof o.result?.response === 'string') return o.result.response
  const choice = o.choices?.[0]
  if (typeof choice?.message?.content === 'string') return choice.message.content
  if (typeof choice?.text === 'string') return choice.text
  return ''
}

export const onRequestPost = async ({ request, env }: Context): Promise<Response> => {
  if (!env.AI) return json({ error: 'Die KI ist noch nicht verbunden: Im Cloudflare-Pages-Projekt fehlt die Workers-AI-Bindung mit dem Namen „AI“.' }, 503)
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Bitte zuerst anmelden.' }, 401)
  let recipeId = ''
  let addIngredients = false
  try { const body = (await request.json()) as { recipeId?: unknown; addIngredients?: unknown }; recipeId = String(body.recipeId ?? ''); addIngredients = body.addIngredients === true } catch { /* leerer Body */ }
  if (!/^[0-9a-f-]{36}$/i.test(recipeId)) return json({ error: 'Ungültiges Rezept.' }, 400)

  const url = env.VITE_SUPABASE_URL || SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY
  const select = 'household_id,title,description,servings,prep_minutes,cook_minutes,source_type,recipe_ingredients(id,name,quantity,unit,is_optional)'
  const loaded = await fetch(url + '/rest/v1/recipes?id=eq.' + recipeId + '&select=' + encodeURIComponent(select), { headers: { apikey: key, Authorization: 'Bearer ' + token } })
  if (loaded.status === 401 || loaded.status === 403) return json({ error: 'Anmeldung abgelaufen – bitte neu anmelden.' }, 401)
  if (!loaded.ok) return json({ error: 'Rezept konnte nicht geladen werden (' + loaded.status + ').' }, 502)
  const recipe = ((await loaded.json()) as RecipeRow[])[0]
  if (!recipe) return json({ error: 'Rezept nicht gefunden oder kein Zugriff.' }, 404)

  // Haushaltsregeln (tomatenfrei, ohne Sahne, histaminarm …) – ebenfalls mit dem Login des Nutzers geladen.
  let rules: AiRules = defaultRules
  try {
    const prefs = await fetch(url + '/rest/v1/household_settings?household_id=eq.' + recipe.household_id + '&select=histamine_low_enabled,tomato_free_enabled,cream_free_enabled,vegetable_rich_enabled,dietary_notes', { headers: { apikey: key, Authorization: 'Bearer ' + token } })
    const row = prefs.ok ? ((await prefs.json()) as SettingsRow[])[0] : undefined
    if (row) rules = { tomatoFree: row.tomato_free_enabled ?? true, creamFree: row.cream_free_enabled ?? true, histamineLow: row.histamine_low_enabled ?? true, vegetableRich: row.vegetable_rich_enabled ?? true, notes: row.dietary_notes ?? null }
  } catch { /* Standardregeln */ }

  const ingredients = recipe.recipe_ingredients ?? []
  const messages = buildRecipeMessages(recipe, ingredients, { addIngredients, rules })
  let lastError = ''
  for (const model of MODELS) {
    try {
      const result = parseRecipeAnswer(textOf(await env.AI.run(model.id, model.input(messages))), ingredients, rules)
      if (!addIngredients) result.additions = []
      // Vorhandene Mengen bleiben unangetastet (bei Thermomix-Rezepten ausdrücklich): nur Zutaten ohne Menge bekommen eine.
      result.quantities = result.quantities.filter(q => ingredients.find(i => i.id === q.id)?.quantity === null)
      // Gluten und Hefe (Nick, 22.11.2026) – mit den von der KI ergänzten Mengen und Zutaten.
      const withQuantities = ingredients.map(i => { const q = result.quantities.find(x => x.id === i.id); return q ? { ...i, quantity: q.quantity, unit: q.unit } : i })
      result.histamine = applyGlutenYeast(result.histamine, [...withQuantities, ...result.additions.map(a => ({ name: a.name, quantity: a.quantity, unit: a.unit }))])
      if (result.steps.length >= 2) return json({ ...result, model: model.id })
      lastError = 'leere Antwort'
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  const quota = /429|3040|4006|limit|neurons|quota/i.test(lastError)
  return json({ error: quota ? 'Das kostenlose KI-Tageskontingent ist aufgebraucht. Ab 1 Uhr nachts (00:00 UTC) geht es wieder.' : 'Die KI konnte das Rezept nicht ergänzen: ' + lastError }, quota ? 429 : 502)
}
