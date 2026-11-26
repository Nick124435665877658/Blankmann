// Schnellauswahl (0.3.60, Nick 26.11.2026): Frühstück aus Brot, Aufstrich, Aufschnitt, Käse … zusammenstellen
// und für „Einzelne Nahrungsmittel für die Woche“ Gruppen Obst & Gemüse, Snacks, Getränke, Frühstück.
// Antippen markiert (mehrere möglich), Menge wird vorgeschlagen, ein Knopf trägt alles ein.
// Die Gruppen sind nur eine Ansicht – die Katalog-Gruppen (Einkaufsliste) bleiben unverändert.

export type QuickFood = { id: string; name: string; category: string; default_unit?: string | null; typical_package_quantity?: number | null; typical_package_unit?: string | null }
export type QuickItem<F extends QuickFood = QuickFood> = { food: F; quantity: number | null; unit: string | null }
export type QuickSection<F extends QuickFood = QuickFood> = { label: string; items: QuickItem<F>[] }
export type QuickGroup<F extends QuickFood = QuickFood> = { key: string; label: string; sections: QuickSection<F>[] }

const key = (value: string) => value.toLocaleLowerCase('de-DE').trim()

// Frühstück für 2 Personen (ein Frühstück): Mengen, die man dafür ungefähr braucht.
const BREAKFAST: { label: string; items: [string, number | null, string | null][] }[] = [
  { label: 'Brot & Brötchen', items: [['Brötchen', 4, 'Stk'], ['Kartoffelbrötchen', 4, 'Stk'], ['Walnussbrötchen', 4, 'Stk'], ['Laugenbrezeln', 2, 'Stk'], ['Croissant', 2, 'Stk'], ['Franzbrötchen', 2, 'Stk'], ['Brot', 200, 'g'], ['Toastbrot', 100, 'g']] },
  { label: 'Aufstrich', items: [['Butter', 20, 'g'], ['Erdbeerkonfitüre', 40, 'g'], ['Kirschkonfitüre', 40, 'g'], ['Konfitüre Aprikose', 40, 'g'], ['Pflaumenmus', 40, 'g'], ['Honig', 30, 'g'], ['Nuss-Nougat-Creme', 30, 'g'], ['Frischkäse', 50, 'g'], ['Hummus', 80, 'g']] },
  { label: 'Aufschnitt', items: [['Salami', 60, 'g'], ['Kochschinken', 60, 'g'], ['Putenbrust-Aufschnitt', 60, 'g'], ['Bierschinken', 60, 'g'], ['Fleischwurst', 60, 'g'], ['Leberwurst', 40, 'g'], ['Vegetarischer Aufschnitt', 60, 'g']] },
  { label: 'Käse', items: [['Gouda', 60, 'g'], ['Butterkäse', 60, 'g'], ['Maasdamer', 60, 'g'], ['Emmentaler', 60, 'g'], ['Camembert', 60, 'g'], ['Ziegenfrischkäse', 50, 'g']] },
  { label: 'Dazu', items: [['Eier', 4, 'Stk'], ['Naturjoghurt', 250, 'g'], ['Griechischer Joghurt', 250, 'g'], ['Quark', 250, 'g'], ['Müsli', 100, 'g'], ['Haferflocken', 100, 'g'], ['Milch', 300, 'ml'], ['Kaffee', 30, 'g'], ['Tee', 2, 'Beutel'], ['Orangensaft', 400, 'ml'], ['Apfelsaft', 400, 'ml'], ['Apfel', 2, 'Stk'], ['Banane', 2, 'Stk']] },
]

const SNACKS = ['Kartoffelchips', 'Salzstangen', 'Erdnussflips', 'Popcorn', 'Cracker', 'Reiswaffeln', 'Laugenbrezeln', 'Gummibärchen', 'Mamba Kaubonbons', 'Saure Drachenzungen', 'Kinder Bueno White',
  'Vollmilchschokolade', 'Zartbitterschokolade', 'Schokolade weiß', 'Butterkekse', 'Oreo-Kekse', 'Lotus-Kekse', 'Schokoladen-Cookies', 'Spekulatius', 'Cantuccini', 'Dominosteine', 'Müsliriegel',
  'Studentenfutter', 'Erdnüsse', 'Cashewkerne', 'Haselnüsse', 'Macadamianüsse', 'Walnüsse', 'Mandeln', 'Nüsse', 'Bananenchips']
const DRIED_FRUIT = ['Datteln', 'Rosinen', 'Cranberrys', 'Trockenpflaumen']
const NOT_FRESH = /saft|orangeat|suppengem/i
const NOT_DRINKS = ['Marsala', 'Sake', 'Wermut', 'Cognac', 'Rum', 'Eierlikör', 'Espresso']
const EXTRA_DRINKS = ['Milch', 'Tee']
const FRUIT_PIECES = /^(apfel|banane|birne|orange|mandarine|kiwi|nektarine|pfirsich)$/i

const isMass = (unit: string | null | undefined) => /^(g|kg|ml|l)$/i.test((unit ?? '').trim())

// Menge für die Woche: übliche Packung; Obst, das stückweise gekauft wird, gleich 6 Stück.
export function weekAmount(food: QuickFood): { quantity: number | null; unit: string | null } {
  const q = food.typical_package_quantity == null ? null : Number(food.typical_package_quantity)
  const unit = food.typical_package_unit ?? food.default_unit ?? null
  if (food.category === 'Obst' && FRUIT_PIECES.test(food.name) && (!q || (q <= 1 && !isMass(unit)))) return { quantity: 6, unit: 'Stk' }
  return { quantity: q && q > 0 ? q : 1, unit: q && q > 0 ? unit : (food.default_unit ?? 'Stk') }
}

function byNames<F extends QuickFood>(foods: F[], names: string[]): F[] {
  const map = new Map(foods.map(f => [key(f.name), f]))
  return names.map(n => map.get(key(n))).filter((f): f is F => Boolean(f))
}

export function breakfastSections<F extends QuickFood>(foods: F[]): QuickSection<F>[] {
  const map = new Map(foods.map(f => [key(f.name), f]))
  return BREAKFAST.map(section => ({
    label: section.label,
    items: section.items.flatMap(([name, quantity, unit]) => { const food = map.get(key(name)); return food ? [{ food, quantity, unit }] : [] }),
  })).filter(s => s.items.length)
}

export function weekGroups<F extends QuickFood>(foods: F[]): QuickGroup<F>[] {
  const sorted = [...foods].sort((a, b) => a.name.localeCompare(b.name, 'de-DE'))
  const fresh = (category: string) => sorted.filter(f => f.category === category && !NOT_FRESH.test(f.name) && !DRIED_FRUIT.includes(f.name)).map(food => ({ food, ...weekAmount(food) }))
  const snackFoods = [...byNames(foods, SNACKS), ...sorted.filter(f => f.category === 'Snacks')]
  const snacks = [...new Map(snackFoods.map(f => [f.id, f])).values()].map(food => ({ food, ...weekAmount(food) }))
  const dried = byNames(foods, DRIED_FRUIT).map(food => ({ food, ...weekAmount(food) }))
  const drinkFoods = [...sorted.filter(f => f.category === 'Getränke' && !NOT_DRINKS.includes(f.name)), ...byNames(foods, EXTRA_DRINKS)]
  const drinks = [...new Map(drinkFoods.map(f => [f.id, f])).values()].map(food => ({ food, ...weekAmount(food) }))
  // Frühstück für die Woche: gleiche Auswahl, aber in Packungen
  const breakfast = breakfastSections(foods).map(s => ({ label: s.label, items: s.items.map(i => ({ food: i.food, ...weekAmount(i.food) })) }))
  return ([
    { key: 'fruitveg', label: 'Obst & Gemüse', sections: [{ label: 'Obst', items: fresh('Obst') }, { label: 'Gemüse', items: fresh('Gemüse') }] },
    { key: 'snacks', label: 'Snacks', sections: [{ label: 'Snacks', items: snacks }, { label: 'Trockenobst', items: dried }] },
    { key: 'drinks', label: 'Getränke', sections: [{ label: 'Getränke', items: drinks }] },
    { key: 'breakfast', label: 'Frühstück', sections: breakfast },
  ] as QuickGroup<F>[]).map(g => ({ ...g, sections: g.sections.filter(s => s.items.length) })).filter(g => g.sections.length)
}
