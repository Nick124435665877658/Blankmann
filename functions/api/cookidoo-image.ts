// Cloudflare Pages Function: POST /api/cookidoo-image  { recipeIds: string[] (höchstens 8) }
// 0.3.52 (Nick, 23.11.2026): Rezeptbild der öffentlichen Cookidoo-Seite finden (og:image). Das Bild wird nur verlinkt,
// nicht kopiert – es bleibt auf Cookidoos Server (assets.tmecosys.com). Speichern (recipes.image_url) macht die App.
// Sicherheit: Rezepte werden mit dem Login des Nutzers geladen (Zeilenschutz/RLS); abgerufen werden nur Cookidoo-Rezeptseiten
// aus dem eigenen Rezept (source_url), angenommen werden nur Bilder von assets.tmecosys.com.
import { cookidooImageFrom } from '../../src/lib/cookidooImage'

type Env = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }
type Context = { request: Request; env: Env }

const SUPABASE_URL = 'https://rrjsolyytdktfmrykdca.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_v66KgLKqMrY-UknWgXR-7Q_lDGBHTvF'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
const recipePage = /^https:\/\/cookidoo\.(de|at|ch)\/recipes\/recipe\/[a-z-]+\/r\d+$/i

export const onRequestPost = async ({ request, env }: Context): Promise<Response> => {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Bitte zuerst anmelden.' }, 401)
  let ids: string[] = []
  try { const body = (await request.json()) as { recipeIds?: unknown }; ids = Array.isArray(body.recipeIds) ? body.recipeIds.map(String).filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 8) : [] } catch { /* leerer Body */ }
  if (!ids.length) return json({ error: 'Keine Rezepte angegeben.' }, 400)
  const url = env.VITE_SUPABASE_URL || SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY
  const loaded = await fetch(url + '/rest/v1/recipes?id=in.(' + ids.join(',') + ')&select=id,source_type,source_url', { headers: { apikey: key, Authorization: 'Bearer ' + token } })
  if (loaded.status === 401 || loaded.status === 403) return json({ error: 'Anmeldung abgelaufen – bitte neu anmelden.' }, 401)
  if (!loaded.ok) return json({ error: 'Rezepte konnten nicht geladen werden (' + loaded.status + ').' }, 502)
  const recipes = (await loaded.json()) as { id: string; source_type: string | null; source_url: string | null }[]
  const images: Record<string, string | null> = {}
  let blocked = 0
  await Promise.all(recipes.map(async recipe => {
    const page = recipe.source_url ?? ''
    if (recipe.source_type !== 'cookidoo' || !recipePage.test(page)) { images[recipe.id] = null; return }
    try {
      const response = await fetch(page, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'de-DE,de;q=0.9' }, redirect: 'follow' })
      if (response.status === 403 || response.status === 429 || response.status >= 500) { blocked++; return } // nicht als „kein Bild“ merken
      if (!response.ok) { images[recipe.id] = null; return }
      images[recipe.id] = cookidooImageFrom((await response.text()).slice(0, 400000))
    } catch { blocked++ }
  }))
  return json({ images, blocked })
}
