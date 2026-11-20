// Supermärkte: Code (wie in household_food_prices.retailer_code / price_retailers.code) → Anzeigename.
// Reihenfolge = Reihenfolge in Auswahllisten und Karten.
export const retailers: Record<string, string> = {
  aldi_nord: 'ALDI Nord', aldi_sued: 'ALDI Süd', lidl: 'Lidl', rewe: 'REWE', kaufland: 'Kaufland', edeka: 'EDEKA', penny: 'Penny', netto: 'Netto', other: 'Anderer Markt',
}
// Für Bon und „Preis eintragen“ auswählbar.
export const selectableRetailers = Object.entries(retailers)
// Karten im Tab „Preise“ (ohne „Anderer Markt“).
export const retailerCards = selectableRetailers.filter(([code]) => code !== 'other')
// Ältere, online recherchierte Referenzpreise ohne festen Markt.
const extraNames: Record<string, string> = { discounter: 'Discounter (Referenz)' }
export const retailerName = (code: string | null | undefined) =>
  !code ? 'Supermarkt' : retailers[code] ?? extraNames[code] ?? code.replace(/_/g, ' ')
