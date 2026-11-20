-- Sammelliste 20.11.2026 (3. Runde), von Nick freigegeben:
-- 1) Gruppen im Nahrungsmittel-Katalog korrigieren (neu: Snacks, Tiefkühl).
-- 2) Doppelte Nahrungsmittel zusammenführen („nur für die einzelnen Supermärkte unterscheiden“):
--    Rezepte, Preise, Vorrat und Wochenplan zeigen auf den bleibenden Eintrag, der doppelte wird gelöscht.
--    Preise bleiben je Supermarkt (+ Bio/normal) getrennt; gibt es beim selben Markt zwei, bleibt der neueste.

-- 1) Gruppen
update public.household_foods set category = c.category
from (values
  ('Kartoffelbrötchen', 'Getreide & Backwaren'), ('KARTOFFELCHIPS', 'Snacks'), ('Kinder Bueno White', 'Snacks'),
  ('Mamba Kaubonbons', 'Snacks'), ('Saure Drachenzungen', 'Snacks'), ('Rahmspinat', 'Tiefkühl'),
  ('Kokosmilch light', 'Hülsenfrüchte & Konserven'), ('Brühe', 'Hülsenfrüchte & Konserven'),
  ('Germknödelberliner', 'Getreide & Backwaren'), ('Germkntdelberliner', 'Getreide & Backwaren'),
  ('Knorr Krauter', 'Kräuter & Gewürze'), ('Meersalz', 'Kräuter & Gewürze'),
  ('MEZZO MIX', 'Getränke'), ('Paulaner Spezi', 'Getränke'), ('Saft', 'Getränke'), ('Kartoffel-Gnocchi', 'Getreide & Backwaren')
) as c(name, category)
where household_foods.name = c.name;
update public.household_foods set is_staple = true where name = 'Meersalz';

-- 2) Doppelte zusammenführen (bleibt ← entfällt)
do $$
declare pair record; keep_food record; drop_food record;
begin
  for pair in select * from (values
    ('Zwiebeln', 'Zwiebel'), ('Süßkartoffeln', 'Süßkartoffel'), ('Muskatnuss', 'Muskat'),
    ('Gemüsebrühe', 'Brühe'), ('Germknödelberliner', 'Germkntdelberliner')
  ) as p(keep_name, drop_name) loop
    for drop_food in select * from public.household_foods where name = pair.drop_name loop
      select * into keep_food from public.household_foods where household_id = drop_food.household_id and name = pair.keep_name limit 1;
      if keep_food.id is null then continue; end if;
      -- Preis-Konflikt (gleicher Markt, gleiche Sorte): den älteren der beiden löschen.
      delete from public.household_food_prices old_price
      using public.household_food_prices k, public.household_food_prices d
      where k.food_item_id = keep_food.id and d.food_item_id = drop_food.id
        and k.retailer_code = d.retailer_code and k.is_organic = d.is_organic
        and old_price.id = case when (d.observed_at, d.created_at) > (k.observed_at, k.created_at) then k.id else d.id end;
      update public.household_food_prices set food_item_id = keep_food.id where food_item_id = drop_food.id;
      update public.recipe_ingredients set food_item_id = keep_food.id, name = keep_food.name, normalized_name = keep_food.normalized_name, aisle = keep_food.category
        where food_item_id = drop_food.id;
      update public.pantry_items set food_item_id = keep_food.id where food_item_id = drop_food.id;
      update public.meal_plan_entries set food_item_id = keep_food.id where food_item_id = drop_food.id;
      update public.household_foods set is_staple = keep_food.is_staple or drop_food.is_staple where id = keep_food.id;
      delete from public.household_foods where id = drop_food.id;
    end loop;
  end loop;
end $$;

-- Gespeicherte Gruppe an den Rezept-Zutaten an den Katalog angleichen (die Einkaufsliste nutzt ohnehin die aktuelle Gruppe).
update public.recipe_ingredients r set aisle = f.category
from public.household_foods f
where r.food_item_id = f.id and r.aisle is distinct from f.category;
