-- 0.3.54 (Nick, 23.11.2026): Alexa-Skill „Blankmann“ – Verbrauch per Sprache vom Vorrat abziehen.
-- Ablauf Verbinden: Alexa nennt einen 4-stelligen Code (alexa_context legt eine Anfrage an, 10 Min gültig),
-- Nick/Sophia geben ihn angemeldet in der App ein (alexa_confirm_code) → Alexa-Konto gehört zum Haushalt.
-- Sicherheit: Die Alexa-Nutzerkennung (nur Amazon und der Skill kennen sie) ist der Ausweis; gespeichert wird nur
-- ihr SHA-256-Wert. Dazu muss die Skill-ID passen. Zugriff auf Vorrat nur über diese Funktionen und nur auf den
-- eigenen Haushalt. Jede Änderung wird mit dem vorherigen Stand gemerkt (alexa_changes) → „Rückgängig“.
-- Nicht-destruktiv: nur neue Tabellen und Funktionen.

create table public.alexa_link_requests (
  id uuid primary key default gen_random_uuid(),
  user_hash text not null unique,
  app_id text not null,
  code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index alexa_link_requests_code on public.alexa_link_requests(code);

create table public.alexa_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_hash text not null unique,
  app_id text not null,
  label text not null default 'Alexa',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index alexa_links_household on public.alexa_links(household_id);

create table public.alexa_changes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  link_id uuid references public.alexa_links(id) on delete set null,
  label text not null,
  rows jsonb not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
create index alexa_changes_household on public.alexa_changes(household_id, created_at desc);

alter table public.alexa_link_requests enable row level security;
alter table public.alexa_links enable row level security;
alter table public.alexa_changes enable row level security;
-- Anfragen: kein direkter Zugriff (nur über Funktionen). Verbindungen: Mitglieder sehen und trennen.
create policy alexa_links_select on public.alexa_links for select to authenticated using (private.is_household_member(household_id));
create policy alexa_links_delete on public.alexa_links for delete to authenticated using (private.is_household_member(household_id));
create policy alexa_changes_select on public.alexa_changes for select to authenticated using (private.is_household_member(household_id));

-- ---------------------------------------------------------------- Hilfsfunktionen (nicht über die API erreichbar)
create function private.alexa_hash(p_user text) returns text
language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(p_user, 'UTF8')), 'hex') $$;

create function private.alexa_check(p_user text, p_app text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_user is null or p_user not like 'amzn1.ask.account.%' or length(p_user) > 600
     or p_app is null or p_app not like 'amzn1.ask.skill.%' or length(p_app) > 200 then
    raise exception 'Ungültige Alexa-Anfrage';
  end if;
end $$;

create function private.alexa_link(p_user text, p_app text) returns public.alexa_links
language plpgsql security definer set search_path = '' as $$
declare v public.alexa_links;
begin
  perform private.alexa_check(p_user, p_app);
  select * into v from public.alexa_links where user_hash = private.alexa_hash(p_user) and app_id = p_app;
  if not found then raise exception 'Alexa ist nicht verbunden'; end if;
  return v;
end $$;

revoke all on function private.alexa_hash(text), private.alexa_check(text, text), private.alexa_link(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- Für den Skill (Cloudflare-Funktion /api/alexa)
-- Stand holen: verbunden → Vorrat des Haushalts (mit Katalognamen); nicht verbunden → Code zum Verbinden.
create function public.alexa_context(p_user text, p_app text) returns jsonb
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
                                            'food_item_id', p.food_item_id, 'food_name', f.name, 'is_organic', p.is_organic)
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

-- Mengen setzen (z. B. Eier 10 → 7). Vorheriger Stand wird für „Rückgängig“ gemerkt.
create function public.alexa_apply(p_user text, p_app text, p_label text, p_updates jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.alexa_links;
  v_rows jsonb := '[]'::jsonb;
  v_item public.pantry_items;
  v_quantity numeric;
  r jsonb;
begin
  v_link := private.alexa_link(p_user, p_app);
  if jsonb_typeof(p_updates) is distinct from 'array' or jsonb_array_length(p_updates) = 0 or jsonb_array_length(p_updates) > 20 then
    raise exception 'Ungültige Änderung';
  end if;
  for r in select value from jsonb_array_elements(p_updates) loop
    v_quantity := (r->>'quantity')::numeric;
    if v_quantity is null or v_quantity < 0 or v_quantity > 1000000 then raise exception 'Ungültige Menge'; end if;
    select * into v_item from public.pantry_items where id = (r->>'id')::uuid and household_id = v_link.household_id for update;
    if not found then raise exception 'Vorratsartikel nicht gefunden'; end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('id', v_item.id, 'deleted', false, 'before', to_jsonb(v_item)));
    update public.pantry_items set quantity = v_quantity, updated_at = now() where id = v_item.id;
  end loop;
  insert into public.alexa_changes(household_id, link_id, label, rows) values (v_link.household_id, v_link.id, left(coalesce(nullif(p_label, ''), 'Änderung'), 120), v_rows);
  delete from public.alexa_changes where household_id = v_link.household_id and created_at < now() - interval '30 days';
  return jsonb_build_object('ok', true);
end $$;

-- Löschen (nur nach „Ja“ auf die Sicherheitsabfrage). Ganze Zeile wird für „Rückgängig“ gemerkt.
create function public.alexa_delete(p_user text, p_app text, p_label text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.alexa_links;
  v_rows jsonb := '[]'::jsonb;
  v_item public.pantry_items;
begin
  v_link := private.alexa_link(p_user, p_app);
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 20 then raise exception 'Ungültige Änderung'; end if;
  for v_item in select * from public.pantry_items where id = any(p_ids) and household_id = v_link.household_id for update loop
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('id', v_item.id, 'deleted', true, 'before', to_jsonb(v_item)));
    delete from public.pantry_items where id = v_item.id;
  end loop;
  if jsonb_array_length(v_rows) = 0 then raise exception 'Vorratsartikel nicht gefunden'; end if;
  insert into public.alexa_changes(household_id, link_id, label, rows) values (v_link.household_id, v_link.id, left(coalesce(nullif(p_label, ''), 'Gelöscht'), 120), v_rows);
  return jsonb_build_object('ok', true);
end $$;

-- Letzte Alexa-Änderung des Haushalts (höchstens 24 h alt) zurücknehmen: Mengen zurück, Gelöschtes wieder anlegen.
create function public.alexa_undo(p_user text, p_app text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.alexa_links;
  v_change public.alexa_changes;
  r jsonb;
begin
  v_link := private.alexa_link(p_user, p_app);
  select * into v_change from public.alexa_changes
    where household_id = v_link.household_id and undone_at is null and created_at > now() - interval '24 hours'
    order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false); end if;
  for r in select value from jsonb_array_elements(v_change.rows) loop
    if (r->>'deleted')::boolean then
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

-- Verbindungstest für GET /api/alexa (keine Daten).
create function public.alexa_ping() returns text language sql stable set search_path = '' as $$ select 'ok'::text $$;

-- ---------------------------------------------------------------- Für die App (angemeldet)
-- Code eingeben → Alexa-Konto mit dem Haushalt verbinden.
create function public.alexa_confirm_code(p_household uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_req public.alexa_link_requests;
  v_name text;
begin
  if v_uid is null then raise exception 'Bitte zuerst anmelden.'; end if;
  if not private.is_household_member(p_household) then raise exception 'Kein Zugriff auf diesen Haushalt.'; end if;
  delete from public.alexa_link_requests where expires_at < now();
  select * into v_req from public.alexa_link_requests where code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g') for update;
  if not found then raise exception 'Code unbekannt oder abgelaufen – sag nochmal „Alexa, öffne Blankmann“ für einen neuen Code.'; end if;
  select display_name into v_name from public.profiles where id = v_uid;
  insert into public.alexa_links(household_id, user_hash, app_id, created_by, label)
    values (p_household, v_req.user_hash, v_req.app_id, v_uid, 'Alexa' || coalesce(' (verbunden von ' || nullif(v_name, '') || ')', ''))
    on conflict (user_hash) do update set household_id = excluded.household_id, app_id = excluded.app_id, created_by = excluded.created_by,
      label = excluded.label, created_at = now(), last_used_at = null;
  delete from public.alexa_link_requests where id = v_req.id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.alexa_context(text, text), public.alexa_apply(text, text, text, jsonb), public.alexa_delete(text, text, text, uuid[]),
  public.alexa_undo(text, text), public.alexa_ping(), public.alexa_confirm_code(uuid, text) from public, anon, authenticated;
grant execute on function public.alexa_context(text, text), public.alexa_apply(text, text, text, jsonb), public.alexa_delete(text, text, text, uuid[]),
  public.alexa_undo(text, text), public.alexa_ping() to anon, authenticated;
grant execute on function public.alexa_confirm_code(uuid, text) to authenticated;
