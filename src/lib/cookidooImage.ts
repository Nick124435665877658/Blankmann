// 0.3.52: Rezeptbild auf einer Cookidoo-Rezeptseite finden (nur verlinkt, nicht kopiert).
// Bild-Adresse aus der Seite: zuerst og:image, sonst das erste große Bild von assets.tmecosys.com.
export function cookidooImageFrom(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  const candidates = [og?.[1], html.match(/https:\/\/assets\.tmecosys\.com\/image\/upload\/[^"'\s)<>]+?\.(?:jpe?g|png|webp)/i)?.[0]]
  for (const raw of candidates) {
    if (!raw) continue
    const url = raw.replace(/&amp;/g, '&').trim()
    try { const parsed = new URL(url); if (parsed.protocol === 'https:' && parsed.hostname === 'assets.tmecosys.com') return parsed.toString() } catch { /* weiter */ }
  }
  return null
}
