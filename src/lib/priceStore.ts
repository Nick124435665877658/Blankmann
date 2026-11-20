import { supabase } from './supabase'
import { manualPriceRow, splitToOne, canSplitToOne } from './kitchen'

// Genau ein Preis je Nahrungsmittel + Supermarkt + Bio/normal (eindeutiger Index household_food_prices_one_per_market).
// Neuer Preis überschreibt den alten; gleicher Preis aktualisiert nur Datum und Quelle.
export type MarketPrice = {
  householdId: string; foodId: string; retailerCode: string; organic: boolean
  price: number; quantity: number | null; unit: string | null
  splitToOne?: boolean // „Auf 1 Stk runterrechnen“ (nur bei Stückzahl > 1)
  sourceName: string; observedAt: string; notes: string | null
}
export function marketPriceRow(input: MarketPrice) {
  const split = input.splitToOne && canSplitToOne(input.quantity, input.unit) ? splitToOne(input.price, input.quantity!, input.unit) : null
  const amounts = split ? manualPriceRow(split.price, split.quantity, split.unit) : manualPriceRow(input.price, input.quantity, input.unit)
  return {
    household_id: input.householdId, food_item_id: input.foodId, retailer_code: input.retailerCode || 'other', is_organic: input.organic,
    ...amounts, price_type: 'regular', source_name: input.sourceName, source_url: null, observed_at: input.observedAt, notes: input.notes,
  }
}
export async function saveMarketPrice(input: MarketPrice) {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  const { error } = await supabase.from('household_food_prices').upsert(marketPriceRow(input), { onConflict: 'household_id,food_item_id,retailer_code,is_organic' })
  if (error) throw error
}
