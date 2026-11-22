-- Sammelliste 22.11.2026 (2. Runde): Rezept-Gruppen (Hauptgericht, Beilage, Suppe & Eintopf …) zum Filtern. Rein ergänzend.
-- Eine Gruppe je Rezept; die Liste der Gruppen steht in src/lib/recipeGroups.ts (bewusst ohne CHECK, damit sie wachsen kann).
alter table public.recipes add column if not exists category text;
create index if not exists recipes_household_category_idx on public.recipes (household_id, category);
