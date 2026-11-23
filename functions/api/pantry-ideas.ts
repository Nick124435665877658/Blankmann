// Cloudflare Pages Function: POST /api/pantry-ideas  { householdId }
// „Was kochen?“ (0.3.50): Workers AI (Gratis-Kontingent) schlägt Gerichte vor, die hauptsächlich aus dem Vorrat bestehen.
// Antwort: { ideas, model } – gespeichert wird erst, wenn Nick/Sophia „Als Rezept speichern“ tippen (in der App).
// Sicherheit: Vorrat, Grundausstattung und Haushaltsregeln werden mit dem Login des Nutzers aus Supabase geladen
// (Zeilenschutz/RLS) – es gehen keine beliebigen Texte vom Browser an die KI.
import { defaultRules, type AiRules } from '../../src/lib/recipeAi'
import { buildPantryIdeasMessages, parsePantryIdeas, type IdeaPantryItem } from '../../src/lib/pantryIdeas'

type AiBinding = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> }
type Env = { AI?: AiBinding; VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }
type Context = { request: Request; env: Env }
type SettingsRow = { histamine_low_enabled?: boolean; tomato_free_enabled?: boolean; cream_free_enabled?: boolean; vegetable_rich_enabled?: boolean; dietary_notes?: string | null }

const SUPABASE_URL = 'https://rrjsolyytdktfmrykdca.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_v66KgLKqMrY-UknWgXR-7Q_lDGBHTvF'
const MODELS: { id: string; input: (messages: { role: string; content: string }[]) => Record<string, unknown> }[] = [
  { id: '@cf/google/gemma-4-26b-a4b-it', input: messages => ({ messages, max_completion_tokens: 2600, temperature: 0.7 }) },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', input: messages => ({ messages, max_tokens: 2600, temperature: 0.7 }) },
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

const berlinDate = (offsetDays: number) => { const d = new Date(Date.now() + offsetDays * 86400000); const parts = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d); const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''; return get('year') + '-' + get('month') + '-' + get('day') }

export const onRequestPost = async ({ request, env }: Context): Promise<Response> => {
  if (!env.AI) return json({ error: 'Die KI ist noch nicht verbunden: Im Cloudflare-Pages-Projekt fehlt die Workers-AI-Bindung mit dem Namen „AI“.' }, 503)
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Bitte zuerst anmelden.' }, 401)
  let householdId = ''
  try { householdId = String(((await request.json()) as { householdId?: unknown }).householdId ?? '') } catch { /* leerer Body */ }
  if (!/^[0-9a-f-]{36}$/i.test(householdId)) return json({ error: 'Ungültiger Haushalt.' }, 400)

  const url = env.VITE_SUPABASE_URL || SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY
  const headers = { apikey: key, Authorization: 'Bearer ' + token }
  const get = (path: string) => fetch(url + '/rest/v1/' + path, { headers })
  const [pantryRes, staplesRes, prefsRes] = await Promise.all([
    get('pantry_items?household_id=eq.' + householdId + '&select=name,quantity,unit,best_before&order=best_before.asc.nullslast'),
    get('household_foods?household_id=eq.' + householdId + '&is_staple=eq.true&select=name&order=name'),
    get('household_settings?household_id=eq.' + householdId + '&select=histamine_low_enabled,tomato_free_enabled,cream_free_enabled,vegetable_rich_enabled,dietary_notes'),
  ])
  if (pantryRes.status === 401 || pantryRes.status === 403) return json({ error: 'Anmeldung abgelaufen – bitte neu anmelden.' }, 401)
  if (!pantryRes.ok) return json({ error: 'Vorrat konnte nicht geladen werden (' + pantryRes.status + ').' }, 502)
  const pantry = ((await pantryRes.json()) as IdeaPantryItem[]).filter(item => item.quantity === null || Number(item.quantity) > 0)
  if (!pantry.length) return json({ error: 'Der Vorrat ist leer – trag erst ein, was ihr da habt.' }, 400)
  const staples = staplesRes.ok ? ((await staplesRes.json()) as { name: string }[]).map(row => row.name) : []
  let rules: AiRules = defaultRules
  try {
    const row = prefsRes.ok ? ((await prefsRes.json()) as SettingsRow[])[0] : undefined
    if (row) rules = { tomatoFree: row.tomato_free_enabled ?? true, creamFree: row.cream_free_enabled ?? true, histamineLow: row.histamine_low_enabled ?? true, vegetableRich: row.vegetable_rich_enabled ?? true, notes: row.dietary_notes ?? null }
  } catch { /* Standardregeln */ }

  const messages = buildPantryIdeasMessages(pantry, staples, rules, berlinDate(3), 4)
  let lastError = ''
  for (const model of MODELS) {
    try {
      const ideas = parsePantryIdeas(textOf(await env.AI.run(model.id, model.input(messages))), rules)
      if (ideas.length) return json({ ideas, model: model.id })
      lastError = 'keine verwertbaren Vorschläge'
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  const quota = /429|3040|4006|limit|neurons|quota/i.test(lastError)
  return json({ error: quota ? 'Das kostenlose KI-Tageskontingent ist aufgebraucht. Ab 1 Uhr nachts (00:00 UTC) geht es wieder.' : 'Die KI konnte gerade keine Ideen liefern: ' + lastError }, quota ? 429 : 502)
}
