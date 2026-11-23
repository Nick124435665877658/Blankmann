-- 0.3.54: „Rückgängig“ nimmt immer die neueste Änderung zuerst – auch bei mehreren Änderungen in derselben Transaktion
-- (now() ist innerhalb einer Transaktion gleich, clock_timestamp() nicht). Nicht-destruktiv.
alter table public.alexa_changes alter column created_at set default clock_timestamp();
