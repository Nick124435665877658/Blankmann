-- 0.3.57 (Nick, 24.11.2026): Gesundheitswert für Rezepte + Histamin mit einer Nachkommastelle.
-- Nicht-destruktiv: Histamin-Spalte wird von ganzen Zahlen auf eine Nachkommastelle erweitert (Werte bleiben),
-- neue leere Spalten für Nährwerte je Nahrungsmittel (pro 100 g, Quelle Bundeslebensmittelschlüssel 4.0) und Stückgewicht.

alter table public.recipes alter column histamine_score type numeric(3,1) using histamine_score::numeric(3,1);
-- 1 = alte KI-Schätzung (ganze Zahl), 2 = neue KI-Schätzung mit Nachkommastelle. Von Hand gesetzte Werte erkennt die App
-- weiter an histamine_note = 'Von Hand gesetzt' und überschreibt sie nie.
alter table public.recipes add column histamine_version smallint;
update public.recipes set histamine_version = 1 where histamine_score is not null and histamine_version is null;

alter table public.household_foods
  add column nutr_kcal numeric check (nutr_kcal is null or nutr_kcal >= 0),
  add column nutr_protein numeric check (nutr_protein is null or nutr_protein >= 0),
  add column nutr_fat numeric check (nutr_fat is null or nutr_fat >= 0),
  add column nutr_sat_fat numeric check (nutr_sat_fat is null or nutr_sat_fat >= 0),
  add column nutr_carbs numeric check (nutr_carbs is null or nutr_carbs >= 0),
  add column nutr_sugar numeric check (nutr_sugar is null or nutr_sugar >= 0),
  add column nutr_fiber numeric check (nutr_fiber is null or nutr_fiber >= 0),
  add column nutr_salt numeric check (nutr_salt is null or nutr_salt >= 0),
  add column nutrition_source text,
  add column grams_per_piece numeric check (grams_per_piece is null or grams_per_piece > 0);
