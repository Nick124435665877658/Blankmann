-- Bereits in Supabase (Projekt FoodPlanner) eingespielt am 19.11.2026. Nur zur Dokumentation im Repo.
-- Einzelne Nahrungsmittel im Wochenplan, „Gekocht“-Markierung und Vorrat-Verknüpfung.
-- Rein ergänzend: bestehende Daten und die laufende App bleiben unverändert nutzbar.
alter table public.meal_plan_entries
  add column if not exists food_item_id uuid references public.household_foods(id) on delete set null,
  add column if not exists quantity numeric check (quantity is null or quantity > 0),
  add column if not exists unit text,
  add column if not exists cooked_at timestamptz;

-- Zusätzlich zu Frühstück/Mittag/Abend: Einträge für die ganze Woche.
alter table public.meal_plan_entries drop constraint if exists meal_plan_entries_meal_type_check;
alter table public.meal_plan_entries add constraint meal_plan_entries_meal_type_check
  check (meal_type = any (array['breakfast'::text, 'lunch'::text, 'dinner'::text, 'week'::text]));

alter table public.pantry_items
  add column if not exists food_item_id uuid references public.household_foods(id) on delete set null;

create index if not exists meal_plan_entries_food_item_id_idx on public.meal_plan_entries(food_item_id);
create index if not exists pantry_items_food_item_id_idx on public.pantry_items(food_item_id);
