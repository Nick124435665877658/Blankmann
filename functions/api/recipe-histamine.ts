// Cloudflare Pages Function: POST /api/recipe-histamine  { recipeIds: string[] (1–4) }
// 0.3.57 (Nick 24.11.2026): schätzt nur den Histaminwert neu – mit einer Nachkommastelle, mehrere Rezepte je Anfrage
// (spart KI-Kontingent). Gluten und Hefe rechnet die App wie immer fest ein (applyGlutenYeast).
// Antwort: { results: [{ id, score, note }], model } – gespeichert wird in der App (von Hand gesetzte Werte bleiben).
// Sicherheit: Rezepte werden mit dem Login des Nutzers aus Supabase geladen (Zeilenschutz/RLS).
import { applyGlutenYeast, buildHistamineMessages, parseHistamineBatch, type PenaltyIngredient } from '../../src/lib/recipeAi'

type AiBinding = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> }
type Env = { AI?: AiBinding; VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }
type Context = { request: Request; env: Env }
type RecipeRow = { id: string; title: string; recipe_ingredients: PenaltyIngredient[] }

const SUPABASE_URL = 'https://rrjsolyytdktfmrykdca.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_v66KgLKqMrY-UknWgXR-7Q_lDGBHTvF'
const MODELS: { id: string; input: (messages: { role: string; content: string }[]) => Record<string, unknown> }[] = [
  { id: '@cf/google/gemma-4-26b-a4b-it', input: messages => ({ messages, max_completion_tokens: 500, temperature: 0.2 }) },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', input: messages => ({ messages, max_tokens: 500, temperature: 0.2 }) },
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
  let ids: string[] = []
  try { const body = (await request.json()) as { recipeIds?: unknown }; ids = Array.isArray(body.recipeIds) ? body.recipeIds.map(String) : [] } catch { /* leerer Body */ }
  ids = [...new Set(ids)].filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 4)
  if (!ids.length) return json({ error: 'Keine gültigen Rezepte.' }, 400)

  const url = env.VITE_SUPABASE_URL || SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY
  const select = 'id,title,recipe_ingredients(name,quantity,unit,is_optional)'
  const loaded = await fetch(url + '/rest/v1/recipes?id=in.(' + ids.join(',') + ')&select=' + encodeURIComponent(select), { headers: { apikey: key, Authorization: 'Bearer ' + token } })
  if (loaded.status === 401 || loaded.status === 403) return json({ error: 'Anmeldung abgelaufen – bitte neu anmelden.' }, 401)
  if (!loaded.ok) return json({ error: 'Rezepte konnten nicht geladen werden (' + loaded.status + ').' }, 502)
  const recipes = ((await loaded.json()) as RecipeRow[]).filter(r => ids.includes(r.id))
  if (!recipes.length) return json({ error: 'Rezepte nicht gefunden oder kein Zugriff.' }, 404)

  const messages = buildHistamineMessages(recipes.map(r => ({ title: r.title, ingredients: r.recipe_ingredients ?? [] })))
  let lastError = ''
  for (const model of MODELS) {
    try {
      const scores = parseHistamineBatch(textOf(await env.AI.run(model.id, model.input(messages))), recipes.length)
      if (!scores.some(s => s.score !== null)) { lastError = 'leere Antwort'; continue }
      const results = recipes.map((r, n) => ({ id: r.id, ...applyGlutenYeast(scores[n], r.recipe_ingredients ?? []) }))
      return json({ results, model: model.id })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  const quota = /429|3040|4006|limit|neurons|quota/i.test(lastError)
  return json({ error: quota ? 'Das kostenlose KI-Tageskontingent ist aufgebraucht. Ab 1 Uhr nachts (00:00 UTC) geht es wieder.' : 'Die KI konnte den Histaminwert nicht schätzen: ' + lastError }, quota ? 429 : 502)
}
