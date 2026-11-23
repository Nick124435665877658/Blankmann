-- 0.3.52 (Nick, 23.11.2026): Bilder für Cookidoo-Rezepte. Rein ergänzend.
-- image_url = verlinktes Rezeptbild (nur assets.tmecosys.com, wird nicht kopiert); '' = auf der Rezeptseite kein Bild gefunden.
-- Ein eigenes Foto (photo_path) hat immer Vorrang.
alter table public.recipes add column if not exists image_url text;
