-- 0.3.61 (Nick, 26.11.2026): Alexa kann den Vorrat erfassen („ich habe sechs Eier gekauft“) und ansagen.
-- Neu: alexa_foods (Katalog zum Abgleichen), alexa_add (Vorratseintrag, bei Bedarf neues Nahrungsmittel).
-- Geändert: alexa_context liefert zusätzlich den Lagerort; alexa_undo nimmt auch Neu-Eingetragenes zurück.
-- Gleiches Sicherheitsmodell wie bisher (verbundene Alexa-Kennung, nur eigener Haushalt). Nicht-destruktiv.

create or replace function public.alexa_context(p_user text, p_app text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
  v_link public.alexa_links;
  v_req public.alexa_link_requests;
  v_code text;
begin
  perform private.alexa_check(p_user, p_app);
  v_hash := private.alexa_hash(p_user);
  select * into v_link from public.alexa_links where user_hash = v_hash;
  if found then
    if v_link.app_id <> p_app then return jsonb_build_object('status', 'wrong_app'); end if;
    update public.alexa_links set last_used_at = now() where id = v_link.id;
    return jsonb_build_object(
      'status', 'linked',
      'pantry', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'quantity', p.quantity, 'unit', p.unit, 'best_before', p.best_before,
                                            'food_item_id', p.food_item_id, 'food_name', f.name, 'is_organic', p.is_organic,
                                            'storage_location', p.storage_location)
                         order by p.best_before nulls last, p.created_at)
        from public.pantry_items p left join public.household_foods f on f.id = p.food_item_id
        where p.household_id = v_link.household_id), '[]'::jsonb),
      'can_undo', exists(select 1 from public.alexa_changes c where c.household_id = v_link.household_id and c.undone_at is null and c.created_at > now() - interval '24 hours'));
  end if;
  delete from public.alexa_link_requests where expires_at < now();
  select * into v_req from public.alexa_link_requests where user_hash = v_hash;
  if found then
    update public.alexa_link_requests set app_id = p_app where id = v_req.id;
    return jsonb_build_object('status', 'pending', 'code', v_req.code);
  end if;
  -- höchstens 20 offene Anfragen; die älteste fällt raus
  delete from public.alexa_link_requests where id in (
    select id from public.alexa_link_requests order by created_at desc offset 19);
  loop
    v_code := (1000 + floor(random() * 9000))::int::text;
    exit when not exists (select 1 from public.alexa_link_requests where code = v_code);
  end loop;
  insert into public.alexa_link_requests(user_hash, app_id, code) values (v_hash, p_app, v_code);
  return jsonb_build_object('status', 'pending', 'code', v_code);
end $$;

-- Katalog des Haushalts (nur Name, Gruppe, Standardeinheit).
create function public.alexa_foods(p_user text, p_app text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_link public.alexa_links;
begin
  v_link := private.alexa_link(p_user, p_app);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'category', f.category, 'default_unit', f.default_unit) order by f.name)
    from public.household_foods f where f.household_id = v_link.household_id), '[]'::jsonb);
end $$;

-- Neuer Vorratseintrag. Ohne food_id: gleichnamiges Nahrungsmittel nehmen, sonst neu anlegen.
create function public.alexa_add(p_user text, p_app text, p_label text, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.alexa_links;
  v_food public.household_foods;
  v_created uuid;
  v_id uuid;
  v_name text := btrim(coalesce(p_item->>'name', ''));
  v_category text := p_item->>'category';
  v_unit text := btrim(coalesce(p_item->>'unit', ''));
  v_place text := p_item->>'storage_location';
  v_quantity numeric := (p_item->>'quantity')::numeric;
  v_before date := (p_item->>'best_before')::date;
begin
  v_link := private.alexa_link(p_user, p_app);
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Ungültiger Name'; end if;
  if v_quantity is null or v_quantity <= 0 or v_quantity > 1000000 then raise exception 'Ungültige Menge'; end if;
  if length(v_unit) < 1 or length(v_unit) > 20 then raise exception 'Ungültige Einheit'; end if;
  if v_place is null or v_place not in ('Kühlschrank', 'Gefrierfach', 'Vorratsschrank', 'Keller') then raise exception 'Ungültiger Lagerort'; end if;
  if p_item->>'food_id' is null and (v_category is null or v_category not in ('Gemüse', 'Obst', 'Kräuter & Gewürze', 'Fleisch & Fisch', 'Milchprodukte & Eier', 'Getreide & Backwaren',
      'Hülsenfrüchte & Konserven', 'Öle & Saucen', 'Nüsse & Saaten', 'Backen & Süßes', 'Snacks', 'Getränke', 'Tiefkühl', 'Sonstiges')) then raise exception 'Ungültige Kategorie'; end if;

  if p_item->>'food_id' is not null then
    select * into v_food from public.household_foods where id = (p_item->>'food_id')::uuid and household_id = v_link.household_id;
    if not found then raise exception 'Nahrungsmittel nicht gefunden'; end if;
  else
    insert into public.household_foods(household_id, name, normalized_name, category, default_unit, source_name, created_by)
      values (v_link.household_id, v_name, lower(v_name), v_category, v_unit, 'Alexa', v_link.created_by)
      on conflict (household_id, normalized_name) do nothing
      returning * into v_food;
    if found then
      v_created := v_food.id;
    else
      select * into v_food from public.household_foods where household_id = v_link.household_id and normalized_name = lower(v_name);
    end if;
  end if;

  insert into public.pantry_items(household_id, name, food_item_id, quantity, unit, storage_location, best_before, is_organic)
    values (v_link.household_id, v_food.name, v_food.id, v_quantity, v_unit, v_place, v_before, coalesce((p_item->>'is_organic')::boolean, false))
    returning id into v_id;
  insert into public.alexa_changes(household_id, link_id, label, rows)
    values (v_link.household_id, v_link.id, left(coalesce(nullif(p_label, ''), 'Eingetragen'), 120),
            jsonb_build_array(jsonb_build_object('id', v_id, 'added', true, 'deleted', false, 'created_food', v_created)));
  delete from public.alexa_changes where household_id = v_link.household_id and created_at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.alexa_undo(p_user text, p_app text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.alexa_links;
  v_change public.alexa_changes;
  v_food uuid;
  r jsonb;
begin
  v_link := private.alexa_link(p_user, p_app);
  select * into v_change from public.alexa_changes
    where household_id = v_link.household_id and undone_at is null and created_at > now() - interval '24 hours'
    order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false); end if;
  for r in select value from jsonb_array_elements(v_change.rows) loop
    if coalesce((r->>'added')::boolean, false) then
      delete from public.pantry_items where id = (r->>'id')::uuid and household_id = v_link.household_id;
      -- Ein dabei neu angelegtes Nahrungsmittel verschwindet nur, wenn es nirgends sonst benutzt wird.
      v_food := (r->>'created_food')::uuid;
      if v_food is not null then
        delete from public.household_foods f where f.id = v_food and f.household_id = v_link.household_id
          and not exists (select 1 from public.pantry_items x where x.food_item_id = f.id)
          and not exists (select 1 from public.recipe_ingredients x where x.food_item_id = f.id)
          and not exists (select 1 from public.meal_plan_entries x where x.food_item_id = f.id)
          and not exists (select 1 from public.household_food_prices x where x.food_item_id = f.id);
      end if;
    elsif (r->>'deleted')::boolean then
      if not exists (select 1 from public.pantry_items where id = (r->>'id')::uuid) then
        insert into public.pantry_items select * from jsonb_populate_record(null::public.pantry_items, r->'before');
      end if;
    else
      update public.pantry_items set quantity = (r->'before'->>'quantity')::numeric, updated_at = now()
        where id = (r->>'id')::uuid and household_id = v_link.household_id;
    end if;
  end loop;
  update public.alexa_changes set undone_at = now() where id = v_change.id;
  return jsonb_build_object('ok', true, 'label', v_change.label);
end $$;

revoke all on function public.alexa_foods(text, text), public.alexa_add(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.alexa_foods(text, text), public.alexa_add(text, text, text, jsonb) to anon, authenticated;
