// Cloudflare Pages Function: Endpunkt des Alexa-Skills „Blankmann“ (0.3.54, Nick 23.11.2026).
// POST /api/alexa  – Anfragen von Alexa (in der Alexa-Entwicklerkonsole als HTTPS-Endpunkt eingetragen).
// GET  /api/alexa  – Verbindungstest (keine Daten): { ok, rpc, version }.
// Sicherheit: Zugriff auf den Vorrat nur über die Datenbank-Funktionen alexa_* (Supabase). Ausweis ist die
// Alexa-Nutzerkennung, die nur Amazon und der Skill kennen (gespeichert wird nur ihr SHA-256-Wert), dazu muss
// die Skill-ID passen. Verbunden wird nur über einen Code, den Nick/Sophia angemeldet in der App eingeben.
// Anfragen älter als 150 Sekunden werden abgelehnt. Keine Geheimnisse im Code: nur der öffentliche Supabase-Schlüssel.
import { alexaIds, checkEnvelope, handleAlexa, sorry, type AlexaBackend, type AlexaContext, type AlexaRequest } from '../../src/lib/alexaSkill'
import type { AlexaFood } from '../../src/lib/alexaAdd'

type Env = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }
type Context = { request: Request; env: Env }

const SUPABASE_URL = 'https://rrjsolyytdktfmrykdca.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_v66KgLKqMrY-UknWgXR-7Q_lDGBHTvF'
const VERSION = '0.3.61'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })

function rpcCaller(env: Env) {
  const url = env.VITE_SUPABASE_URL || SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY
  return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const response = await fetch(url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(args) })
    const text = await response.text()
    if (!response.ok) throw new Error('Supabase ' + name + ' ' + response.status + ': ' + text.slice(0, 300))
    return (text ? JSON.parse(text) : null) as T
  }
}

function supabaseBackend(env: Env, user: string, app: string): AlexaBackend {
  const rpc = rpcCaller(env)
  return {
    context: () => rpc<AlexaContext>('alexa_context', { p_user: user, p_app: app }),
    apply: async (label, updates) => { await rpc('alexa_apply', { p_user: user, p_app: app, p_label: label, p_updates: updates }) },
    remove: async (label, ids) => { await rpc('alexa_delete', { p_user: user, p_app: app, p_label: label, p_ids: ids }) },
    undo: () => rpc<{ ok: boolean; label?: string }>('alexa_undo', { p_user: user, p_app: app }),
    foods: () => rpc<AlexaFood[]>('alexa_foods', { p_user: user, p_app: app }),
    add: async (label, item) => { await rpc('alexa_add', { p_user: user, p_app: app, p_label: label, p_item: item }) },
  }
}

export const onRequestPost = async ({ request, env }: Context): Promise<Response> => {
  let body: AlexaRequest
  try { body = (await request.json()) as AlexaRequest } catch { return json({ error: 'Keine Alexa-Anfrage' }, 400) }
  const problem = checkEnvelope(body)
  if (problem) return json({ error: problem }, 400)
  const { user, app } = alexaIds(body)
  try {
    return json(await handleAlexa(body, supabaseBackend(env, user, app)))
  } catch (error) {
    console.error('alexa', body.request?.type, body.request?.intent?.name, error instanceof Error ? error.message : error)
    return json(sorry())
  }
}

export const onRequestGet = async ({ env }: Context): Promise<Response> => {
  try {
    const result = await rpcCaller(env)<string>('alexa_ping', {})
    return json({ ok: result === 'ok', rpc: result, version: VERSION })
  } catch (error) {
    return json({ ok: false, rpc: error instanceof Error ? error.message : 'Fehler', version: VERSION }, 502)
  }
}
