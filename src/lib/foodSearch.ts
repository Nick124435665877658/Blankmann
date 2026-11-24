// Suche im Nahrungsmittel-Katalog (0.3.52, Nick 23.11.2026): beste Treffer zuerst, ä/ae/a egal, Groß/klein egal.
// Reihenfolge: genau → Name beginnt so → ein Wort beginnt so → kommt vor → alle Suchwörter kommen vor → Gruppe passt.
export const fold = (value: string, umlaut: 'ae' | 'a') => value.toLocaleLowerCase('de-DE')
  .replace(/ä/g, umlaut === 'ae' ? 'ae' : 'a').replace(/ö/g, umlaut === 'ae' ? 'oe' : 'o').replace(/ü/g, umlaut === 'ae' ? 'ue' : 'u').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, ' ').trim()

export type SearchableFood = { id: string; name: string; category?: string | null }

function score(name: string, category: string, query: string): number {
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.split(' ').some(word => word.startsWith(query))) return 2
  if (name.includes(query)) return 3
  const parts = query.split(' ').filter(Boolean)
  if (parts.length > 1 && parts.every(part => name.includes(part))) return 4
  if (category && category.startsWith(query)) return 5
  return -1
}

export function rankFoods<T extends SearchableFood>(foods: T[], query: string, limit = 40): T[] {
  const sortedByName = (list: T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  if (!query.trim()) return sortedByName(foods).slice(0, limit)
  const queries = [fold(query, 'ae'), fold(query, 'a')]
  const scored: { food: T; score: number; length: number }[] = []
  for (const food of foods) {
    let best = -1
    for (const variant of ['ae', 'a'] as const) {
      const name = fold(food.name, variant), category = fold(food.category ?? '', variant)
      for (const q of queries) { const s = score(name, category, q); if (s >= 0 && (best < 0 || s < best)) best = s }
    }
    if (best >= 0) scored.push({ food, score: best, length: food.name.length })
  }
  return scored.sort((a, b) => a.score - b.score || a.length - b.length || a.food.name.localeCompare(b.food.name, 'de')).slice(0, limit).map(entry => entry.food)
}
