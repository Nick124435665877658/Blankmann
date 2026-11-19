// Datum als JJJJ-MM-TT in deutscher Ortszeit (nicht UTC): sonst gilt zwischen 0 und 1 bzw. 2 Uhr nachts noch der Vortag.
export const localISO = (date: Date = new Date()) =>
  date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
