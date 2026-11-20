-- Sammelliste 20.11.2026 (Punkte 6–8): ALDI Süd, ein Preis je Nahrungsmittel + Supermarkt + Bio/normal, Bio-Status.
-- Rein ergänzend bis auf das von Nick freigegebene Aufräumen (doppelte Bon-Preise, „BIO EIER“ → „Eier“).

-- Bio-Status: kein eigenes Nahrungsmittel, sondern ein Merkmal am Preis und am Vorrat.
alter table public.household_food_prices add column if not exists is_organic boolean not null default false;
alter table public.pantry_items add column if not exists is_organic boolean not null default false;
-- Einstellung „Bio bevorzugen“ (für den ganzen Haushalt): Einkaufsliste/Budget rechnen dann mit Bio-Preisen.
alter table public.household_settings add column if not exists prefer_organic boolean not null default false;

-- ALDI Süd auswählbar (Nick, 20.11.2026).
update public.price_retailers set region_status = 'available', region_note = 'Auswählbar (Nick, 20.11.2026)' where code = 'aldi_sued';

-- „BIO EIER“ mit „Eier“ zusammenführen: Preise werden Bio-Preise von „Eier“, Vorrat/Plan zeigen auf „Eier“.
do $$
declare bio record; base_id uuid;
begin
  for bio in select id, household_id from public.household_foods where normalized_name = 'bio eier' loop
    select id into base_id from public.household_foods where household_id = bio.household_id and normalized_name = 'eier' limit 1;
    if base_id is null then
      update public.household_foods set name = 'Eier', normalized_name = 'eier' where id = bio.id;
      update public.household_food_prices set is_organic = true where food_item_id = bio.id;
    else
      update public.household_food_prices set food_item_id = base_id, is_organic = true where food_item_id = bio.id;
      update public.pantry_items set food_item_id = base_id, is_organic = true where food_item_id = bio.id;
      update public.meal_plan_entries set food_item_id = base_id where food_item_id = bio.id;
      update public.recipe_ingredients set food_item_id = base_id where food_item_id = bio.id;
      delete from public.household_foods where id = bio.id;
    end if;
  end loop;
end $$;

-- Doppelte Preise je Nahrungsmittel + Supermarkt + Bio/normal: der neueste bleibt.
delete from public.household_food_prices p
using (
  select id, row_number() over (partition by household_id, food_item_id, retailer_code, is_organic order by observed_at desc, created_at desc) as n
  from public.household_food_prices
) ranked
where p.id = ranked.id and ranked.n > 1;

-- Ab jetzt genau ein Preis je Nahrungsmittel + Supermarkt + Bio/normal (Bon und „Preis eintragen“ überschreiben ihn).
create unique index if not exists household_food_prices_one_per_market
  on public.household_food_prices (household_id, food_item_id, retailer_code, is_organic);
