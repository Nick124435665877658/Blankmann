import { createClient } from '@supabase/supabase-js'

// Öffentliche Verbindungsdaten (Publishable Key – darf im Browser stehen, siehe .env.example).
// Build-Variablen aus Cloudflare haben Vorrang; die Rückfallwerte sorgen dafür, dass die App
// auch dann funktioniert, wenn das Pages-Projekt seine Konfiguration aus wrangler.toml bezieht.
const FALLBACK_URL = 'https://rrjsolyytdktfmrykdca.supabase.co'
const FALLBACK_KEY = 'sb_publishable_v66KgLKqMrY-UknWgXR-7Q_lDGBHTvF'
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || FALLBACK_URL
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || FALLBACK_KEY

export const isSupabaseConfigured = Boolean(url && key)
export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
