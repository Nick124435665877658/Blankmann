-- Sammelliste 20.11.2026 (2. Runde): KI-ergänzte Zutaten, Grundausstattung, Netto. Rein ergänzend, nichts wird gelöscht.

-- Zutaten, die die KI ins Rezept geschrieben hat (Kennzeichen „KI“; lassen sich beim Bearbeiten entfernen).
alter table public.recipe_ingredients add column if not exists ai_added boolean not null default false;

-- Grundausstattung (Salz, Pfeffer, Öl, Gewürze …): Kennzeichen am Nahrungsmittel. Steht trotzdem auf der Einkaufsliste,
-- dort wird wie immer der Vorrat abgezogen.
alter table public.household_foods add column if not exists is_staple boolean not null default false;
update public.household_foods set is_staple = true
where lower(name) in ('salz','pfeffer','olivenöl','rapsöl','sonnenblumenöl','zucker','curry','kreuzkümmel','muskat','oregano','paprikapulver','zimt','mehl','gemüsebrühe','speisestärke','backpulver');

-- Netto (Netto Marken-Discount) als Supermarkt (Nick, 20.11.2026).
insert into public.price_retailers (code, name, region_status, region_note)
values ('netto', 'Netto', 'available', 'Netto Marken-Discount (Nick, 20.11.2026)')
on conflict (code) do nothing;
