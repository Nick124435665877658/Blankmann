import { normalize } from './receiptParser'

// Nahrungsmittel-Gruppen in der Reihenfolge der Auswahllisten (Anlegen, Gruppe ändern).
export const foodCategories = [
  'Gemüse', 'Obst', 'Kräuter & Gewürze', 'Fleisch & Fisch', 'Milchprodukte & Eier', 'Getreide & Backwaren', 'Hülsenfrüchte & Konserven',
  'Öle & Saucen', 'Nüsse & Saaten', 'Backen & Süßes', 'Snacks', 'Getränke', 'Tiefkühl', 'Sonstiges',
]

// Kategorie für neu angelegte Nahrungsmittel (Bon, KI). Reihenfolge zählt: „TK Erbsen“ ist Tiefkühl, „Kartoffelchips“ ein Snack,
// „Paprikapulver“ ein Gewürz, „Orangensaft“ ein Getränk – jeweils vor Gemüse/Obst prüfen.
const categories: [string, RegExp][] = [
  ['Tiefkühl', /\btk\b|tiefkuehl|tiefgekuehl|tiefgefror|gefroren|\biglo\b|frosta|pizza|pommes|fischstaebchen|eiscreme|speiseeis|\beis\b|kroketten|rahmspinat/],
  ['Snacks', /chips|flips|bonbon|gummi|riegel|bueno|haribo|salzstange|popcorn|nachos|cracker|lakritz|drachenzungen|snack|pringles|mamba|maoam|kaubonbon/],
  ['Kräuter & Gewürze', /salz|pfeffer|paprikapulver|curry|kreuzkuemmel|kurkuma|muskat|oregano|thymian|rosmarin|basilikum|petersilie|schnittlauch|dill|koriander|zimt|ingwer|chili|majoran|lorbeer|gewuerz|kraeuter|kuemmel|vanille/],
  ['Getränke', /saft|nektar|mineralwasser|\bwasser\b|sprudel|limo|cola|spezi|mezzo|schorle|eistee|gerolsteiner|\bbier\b/],
  ['Fleisch & Fisch', /huhn|haehnchen|pute|rind|schwein|hack|lachs|fisch|wurst|schinken/],
  ['Milchprodukte & Eier', /milch|joghurt|quark|kaese|butter|\b(?:ei|eier)\b|skyr|mozzarella|feta/],
  ['Hülsenfrüchte & Konserven', /bohne|linse|kichererbse|dose|mais/],
  ['Gemüse', /paprika|gurke|zucchini|kartoffel|tomate|brokkoli|salat|karotte|moehre|zwiebel|knoblauch|lauch|pilz|champignon|kuerbis|sellerie|erbse/],
  ['Obst', /apfel|banane|traube|beere|orange|zitrone|birne/],
  ['Getreide & Backwaren', /brot|broetchen|toast|mehl|reis|nudel|pasta|wrap|hafer|couscous|bulgur|quinoa|gnocchi/],
  ['Öle & Saucen', /oel|essig|sauce|sosse|pesto|bruehe|fond|senf/],
  ['Backen & Süßes', /schokolade|keks|zucker|honig|marmelade|backpulver|staerke/],
]
export function guessCategory(name: string, staple = false) {
  const n = normalize(name)
  const found = categories.find(([, re]) => re.test(n))?.[0]
  return found ?? (staple ? 'Kräuter & Gewürze' : 'Sonstiges')
}
// Lagerort im Vorrat für Ware vom Bon.
export const storageFor = (category: string) =>
  category === 'Tiefkühl' ? 'Gefrierfach' : category === 'Milchprodukte & Eier' || category === 'Fleisch & Fisch' ? 'Kühlschrank' : 'Vorratsschrank'
// Einkaufsliste: Tiefkühl zuletzt (bleibt kalt), sonst alphabetisch.
export const compareAisles = (a: string, b: string) => Number(a === 'Tiefkühl') - Number(b === 'Tiefkühl') || a.localeCompare(b, 'de-DE')
