-- Bereits in Supabase (Projekt FoodPlanner) eingespielt am 19.11.2026. Nur zur Dokumentation im Repo.
-- Histaminwert (KI-Schätzung, 1 = histaminreich … 10 = kein Histamin) mit kurzer Begründung
-- und eigene Bewertung (1 = schlecht … 10 = gut). Rein ergänzend.
alter table public.recipes
  add column if not exists histamine_score smallint check (histamine_score between 1 and 10),
  add column if not exists histamine_note text,
  add column if not exists rating smallint check (rating between 1 and 10);
