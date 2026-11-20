import { normalize } from './receiptParser'

// Kategorie für neu angelegte Nahrungsmittel (Bon, KI). Reihenfolge zählt: „Paprikapulver“ ist ein Gewürz, kein Gemüse.
const categories: [string, RegExp][] = [
  ['Kräuter & Gewürze', /salz|pfeffer|paprikapulver|curry|kreuzkuemmel|kurkuma|muskat|oregano|thymian|rosmarin|basilikum|petersilie|schnittlauch|dill|koriander|zimt|ingwer|chili|majoran|lorbeer|gewuerz|kraeuter|kuemmel|vanille/],
  ['Fleisch & Fisch', /huhn|haehnchen|pute|rind|schwein|hack|lachs|fisch|wurst|schinken/],
  ['Milchprodukte & Eier', /milch|joghurt|quark|kaese|butter|\b(?:ei|eier)\b|skyr|mozzarella|feta/],
  ['Hülsenfrüchte & Konserven', /bohne|linse|kichererbse|dose|mais/],
  ['Gemüse', /paprika|gurke|zucchini|kartoffel|tomate|brokkoli|salat|karotte|moehre|zwiebel|knoblauch|lauch|pilz|champignon|kuerbis|sellerie|erbse/],
  ['Obst', /apfel|banane|traube|beere|orange|zitrone|birne/],
  ['Getreide & Backwaren', /brot|broetchen|toast|mehl|reis|nudel|pasta|wrap|hafer|couscous|bulgur|quinoa/],
  ['Öle & Saucen', /oel|essig|sauce|sosse|pesto|bruehe|fond|senf/],
  ['Backen & Süßes', /schokolade|keks|zucker|honig|marmelade|backpulver|staerke/],
]
export function guessCategory(name: string, staple = false) {
  const n = normalize(name)
  const found = categories.find(([, re]) => re.test(n))?.[0]
  return found ?? (staple ? 'Kräuter & Gewürze' : 'Sonstiges')
}
