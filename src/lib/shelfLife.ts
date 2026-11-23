// Automatisches MHD für frisches Obst und Gemüse beim Bon (0.3.53, Nick 23.11.2026).
// Nicks Regel: Gemüse Bondatum + 10 Tage, Kartoffeln/Zwiebeln/Schalotten + 20, Obst + 7 –
// mit Claudes Ausnahmen (von Nick übernommen): Empfindliches kürzer, Lagerfähiges länger.
// Getrocknetes/Verarbeitetes (Rosinen, Säfte, Mais, Maronen …) bekommt kein automatisches MHD.
const fold = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')

const NONE = /(rosinen|dattel|trockenpflaume|cranberr|orangeat|saft|getrocknet|mais\b|maronen|konserve|dose|glas)/
const FRESH_HERBS = /^(petersilie|glatte petersilie|krause petersilie|basilikum|schnittlauch|dill|koriander|minze|rosmarin|thymian|zitronenthymian|salbei|zitronenmelisse|kresse|frankfurter gruene kraeuter|kraeuter)( frisch)?$/
// Reihenfolge zählt: speziellere Regeln zuerst (Süßkartoffel vor Kartoffel, Frühlingszwiebel vor Zwiebel, Petersilienwurzel vor Petersilie).
const RULES: [RegExp, number][] = [
  [/(suesskartoffel|fruehlingszwiebel|lauchzwiebel|kohlrabi|staudensellerie|salatgurke)/, 10],
  [/(petersilienwurzel|pastinake|karotte|moehre|rote bete|knollensellerie|^sellerie$|weisskohl|rotkohl|rosenkohl|wirsing|chinakohl|spitzkohl|^kohl$|apfel|aepfel)/, 21],
  [/(erdbeer|himbeer|heidelbeer|blaubeer|brombeer|johannisbeer|stachelbeer|^beeren$)/, 3],
  [/(salat|spinat|rucola|rauke|pilz|champignon|shiitake|seitling|spargel|zuckerschote|pak choi|mangold|sprossen)/, 4],
  [/(banane|avocado|mango)/, 5],
  [/(orange|zitrone|limette|mandarine|clementine|grapefruit)/, 14],
  [/(kartoffel|zwiebel|schalotte)/, 20],
  [/(knoblauch|kuerbis)/, 30],
]

export function shelfLifeDays(name: string, category: string | null | undefined): number | null {
  const key = fold(name).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const group = category ?? ''
  const isHerb = group === 'Kräuter & Gewürze' && FRESH_HERBS.test(key) && !/(gemahlen|getrocknet|pulver)/.test(key)
  if (group !== 'Gemüse' && group !== 'Obst' && !isHerb) return null
  if (NONE.test(key)) return null
  if (isHerb) return 4
  for (const [pattern, days] of RULES) if (pattern.test(key)) return days
  return group === 'Obst' ? 7 : 10
}

// Bondatum (JJJJ-MM-TT) + Haltbarkeit → MHD (JJJJ-MM-TT), ohne Zeitzonen-Verschiebung.
export function bestBeforeFor(name: string, category: string | null | undefined, purchaseDate: string): string | null {
  const days = shelfLifeDays(name, category)
  if (days === null || !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) return null
  const [y, m, d] = purchaseDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}
