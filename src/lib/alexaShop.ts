// Alexa: etwas auf die Einkaufsliste setzen (0.3.62, Nick 26.11.2026).
// „… setz zwei Liter Milch auf die Einkaufsliste“ – ohne Rückfragen; die Menge ist freiwillig.
// Gespeichert wird wie ein eigener Artikel aus der App. Ohne Browser/Datenbank testbar (scripts/check-alexa.ts).
import { guessCategory } from './categories.ts'
import { splitOrganic } from './kitchen.ts'
import { matchFood, titleCase } from './alexaAdd.ts'
import { fold, more, plain, speakAmount } from './alexaText.ts'
import type { AlexaBackend, AlexaResponse } from './alexaSkill.ts'

export type AlexaShopItem = { name: string; quantity: number | null; unit: string | null; aisle: string }
export type AlexaShopResult = { status: 'added' | 'merged' | 'exists'; quantity: number | string | null; unit: string | null }

// Haushaltsartikel, die sonst falsch einsortiert würden („Zahnpasta“ → Nudeln).
const nonFood = /papier|kuchenrolle|spul|waschmittel|zahn|mullbeutel|mulltute|folie|seife|shampoo|duschgel|taschentuch|schwamm|schwamme|reiniger|\bdeo|windel|batterie/

export const askShop = () => plain('Was soll auf die Einkaufsliste?', { reprompt: 'Sag zum Beispiel: Milch. Oder: zwei Packungen Nudeln. Oder: fertig.' })

export async function shopAdd(names: string[], given: { quantity: number | null; unit: string | null }, backend: AlexaBackend): Promise<AlexaResponse> {
  if (!names.length) return askShop()
  const { food } = matchFood(names, await backend.foods())
  const spoken = splitOrganic(names[names.length - 1]).base
  const base = food?.name ?? titleCase(spoken)
  const organic = names.some(n => splitOrganic(n).organic)
  const name = organic ? 'Bio ' + base : base
  const quantity = given.quantity ?? (given.unit ? 1 : null)
  const usual = food?.default_unit === 'g' || food?.default_unit === 'ml' ? food.default_unit : null
  const unit = given.unit ?? (quantity === null ? null : quantity < 20 ? 'Stk' : usual)
  const aisle = food?.category || (nonFood.test(fold(base)) ? 'Sonstiges' : guessCategory(base))
  const said = (q: number | null, u: string | null) => (q === null ? '' : speakAmount(q, u) + ' ') + name
  const label = said(quantity, unit) + ' auf der Einkaufsliste'
  const result = await backend.shop(label, { name, quantity, unit, aisle })
  if (result.status === 'exists') return more(name + ' ist schon auf der Einkaufsliste.')
  if (result.status === 'merged') return more('Okay, jetzt ' + said(result.quantity === null ? null : Number(result.quantity), result.unit) + ' auf der Einkaufsliste.')
  return more('Okay, ' + said(quantity, unit) + ' auf die Einkaufsliste gesetzt.')
}
