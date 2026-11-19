-- Bereits in Supabase (Projekt FoodPlanner) eingespielt am 19.11.2026. Nur zur Dokumentation im Repo.
-- Abhaken von Einkaufsartikeln, die aus dem Wochenplan berechnet werden (Rezepte, einzelne Nahrungsmittel).
-- Eigene Tabelle, damit die bestehende Einkaufsliste (shopping_list_items) und ältere App-Versionen unverändert bleiben.
create table if not exists public.shopping_plan_checks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null,
  item_key text not null,
  checked boolean not null default true,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (household_id, week_start, item_key)
);

alter table public.shopping_plan_checks enable row level security;
create policy shopping_plan_checks_member_access on public.shopping_plan_checks
  for all using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));

revoke all on public.shopping_plan_checks from anon;
grant select, insert, update, delete on public.shopping_plan_checks to authenticated;

alter publication supabase_realtime add table public.shopping_plan_checks;
