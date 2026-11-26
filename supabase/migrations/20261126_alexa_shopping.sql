-- 0.3.62 (Nick, 26.11.2026): Alexa kann etwas auf die Einkaufsliste setzen („setz Milch auf die Einkaufsliste“).
-- Neu: alexa_shop_add. Geändert: alexa_undo nimmt auch Einkaufslisten-Einträge zurück.
-- Gleiches Sicherheitsmodell wie bisher (verbundene Alexa-Kennung, nur eigener Haushalt). Nicht-destruktiv.

create function public.alexa_shop_add(p_user text, p_app text, p_label text, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.alexa_links;
  v_list uuid;
  v_row public.shopping_list_items;
  v_change jsonb;
  v_status text;
  v_name text := btrim(coalesce(p_item->>'name', ''));
  v_unit text := nullif(btrim(coalesce(p_item->>'unit', '')), '');
  v_aisle text := coalesce(nullif(p_item->>'aisle', ''), 'Sonstiges');
  v_quantity numeric := (p_item->>'quantity')::numeric;
begin
  v_link := private.alexa_link(p_user, p_app);
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Ungültiger Name'; end if;
  if v_quantity is not null and (v_quantity <= 0 or v_quantity > 1000000) then raise exception 'Ungültige Menge'; end if;
  if length(coalesce(v_unit, '')) > 20 then raise exception 'Ungültige Einheit'; end if;
  if length(v_aisle) > 40 then raise exception 'Ungültige Gruppe'; end if;

  select id into v_list from public.shopping_lists where household_id = v_link.household_id and status = 'open' order by created_at desc limit 1;
  if v_list is null then
    insert into public.shopping_lists(household_id, title, status) values (v_link.household_id, 'Wocheneinkauf', 'open') returning id into v_list;
  end if;

  -- Gleicher Artikel schon da? Offene Zeile zuerst, sonst eine abgehakte wieder öffnen.
  select * into v_row from public.shopping_list_items s
    where s.shopping_list_id = v_list and s.household_id = v_link.household_id and lower(btrim(s.name)) = lower(v_name)
      and (v_quantity is null or (s.quantity is null and s.unit is null) or lower(coalesce(s.unit, '')) = lower(coalesce(v_unit, '')))
    order by s.checked, s.created_at desc limit 1 for update;

  if v_row.id is null then
    insert into public.shopping_list_items(household_id, shopping_list_id, name, normalized_name, quantity, unit, aisle, checked)
      values (v_link.household_id, v_list, v_name, lower(v_name), v_quantity, v_unit, v_aisle, false)
      returning * into v_row;
    v_status := 'added';
    v_change := jsonb_build_object('id', v_row.id, 'shopping', true, 'added', true, 'deleted', false);
  elsif v_quantity is null and not v_row.checked then
    return jsonb_build_object('ok', true, 'status', 'exists', 'quantity', v_row.quantity, 'unit', v_row.unit);
  else
    v_change := jsonb_build_object('id', v_row.id, 'shopping', true, 'added', false, 'deleted', false,
                                   'before', jsonb_build_object('quantity', v_row.quantity, 'unit', v_row.unit, 'checked', v_row.checked));
    v_status := case when v_row.checked or v_row.quantity is null then 'added' else 'merged' end;
    update public.shopping_list_items s set
        quantity = case when v_status = 'merged' then s.quantity + v_quantity else v_quantity end,
        unit = case when v_status = 'merged' then s.unit else v_unit end,
        checked = false, updated_at = now()
      where s.id = v_row.id
      returning * into v_row;
  end if;

  insert into public.alexa_changes(household_id, link_id, label, rows)
    values (v_link.household_id, v_link.id, left(coalesce(nullif(p_label, ''), 'Einkaufsliste'), 120), jsonb_build_array(v_change));
  delete from public.alexa_changes where household_id = v_link.household_id and created_at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'status', v_status, 'quantity', v_row.quantity, 'unit', v_row.unit);
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
    if coalesce((r->>'shopping')::boolean, false) then
      if coalesce((r->>'added')::boolean, false) then
        delete from public.shopping_list_items where id = (r->>'id')::uuid and household_id = v_link.household_id;
      else
        update public.shopping_list_items set quantity = (r->'before'->>'quantity')::numeric, unit = r->'before'->>'unit',
            checked = (r->'before'->>'checked')::boolean, updated_at = now()
          where id = (r->>'id')::uuid and household_id = v_link.household_id;
      end if;
    elsif coalesce((r->>'added')::boolean, false) then
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

revoke all on function public.alexa_shop_add(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.alexa_shop_add(text, text, text, jsonb) to anon, authenticated;
