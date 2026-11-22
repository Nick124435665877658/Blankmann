// Rezept-Gruppen (Nick, 22.11.2026): eine Gruppe je Rezept, nach der Rezeptliste und Wochenplan filtern.
// Die KI ordnet neue Rezepte ein; von Hand unter „Bearbeiten“ änderbar.
export const recipeGroups = [
  'Hauptgericht', 'Beilage', 'Suppe & Eintopf', 'Salat', 'Frühstück & Müsli', 'Brot & Brötchen', 'Kuchen & Torten',
  'Gebäck & Plätzchen', 'Dessert & Eis', 'Snack', 'Sauce & Dip', 'Aufstrich', 'Getränk',
] as const
export type RecipeGroup = typeof recipeGroups[number]

// Vorauswahl im Wochenplan je Mahlzeit (Frühstück → Frühstück & Müsli, Mittag/Abend → Hauptgericht).
export const groupForMeal = (mealType: string): RecipeGroup => mealType === 'breakfast' ? 'Frühstück & Müsli' : 'Hauptgericht'

const keyOf = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()
// Stichworte je Gruppe, damit auch „Suppe“, „Desserts“ oder „Brot“ aus der KI-Antwort richtig zugeordnet werden.
const groupWords: [RecipeGroup, RegExp][] = [
  ['Hauptgericht', /hauptgericht|hauptspeise|hauptgang/],
  ['Beilage', /beilage/],
  ['Suppe & Eintopf', /suppe|eintopf/],
  ['Salat', /salat/],
  ['Frühstück & Müsli', /fruehstueck|muesli/],
  ['Brot & Brötchen', /brot|broetchen/],
  ['Kuchen & Torten', /kuchen|torte/],
  ['Gebäck & Plätzchen', /gebaeck|plaetzchen|kekse?\b/],
  ['Dessert & Eis', /dessert|nachspeise|nachtisch|\beis\b/],
  ['Snack', /snack/],
  ['Sauce & Dip', /sauce|sosse|dip\b|dips\b/],
  ['Aufstrich', /aufstrich|marmelade|konfituere/],
  ['Getränk', /getraenk|drink/],
]
// KI-Antwort oder freie Eingabe → eine der festen Gruppen (oder null, wenn nichts passt).
export function matchRecipeGroup(value: string | null | undefined): RecipeGroup | null {
  const key = keyOf(value ?? '')
  if (!key) return null
  const exact = recipeGroups.find(group => keyOf(group) === key)
  if (exact) return exact
  return groupWords.find(([, words]) => words.test(key))?.[0] ?? null
}
