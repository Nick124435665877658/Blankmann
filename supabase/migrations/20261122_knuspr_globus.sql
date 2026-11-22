-- Sammelliste 22.11.2026: Knuspr und Globus als eigene Märkte (Nick, 22.11.2026). Rein ergänzend, nichts wird gelöscht.

insert into public.price_retailers (code, name, region_status, region_note)
values
  ('globus', 'Globus', 'available', 'Online-Sortiment produkte.globus.de (Nick, 22.11.2026)'),
  ('knuspr', 'Knuspr', 'online_only', 'Online-Supermarkt knuspr.de (Nick, 22.11.2026)')
on conflict (code) do nothing;

-- Die am 21.11.2026 online recherchierten Referenzpreise standen unter „Anderer Markt“; der Shop steht in source_name.
-- Nur diese Zeilen werden dem richtigen Markt zugeordnet – von Hand eingetragene Preise unter „Anderer Markt“ bleiben.
update public.household_food_prices set retailer_code = 'knuspr'
where retailer_code = 'other' and price_type = 'reference' and source_name like 'Knuspr Online-Shop%';

update public.household_food_prices set retailer_code = 'globus'
where retailer_code = 'other' and price_type = 'reference' and source_name like 'Globus Online-Sortiment%';
