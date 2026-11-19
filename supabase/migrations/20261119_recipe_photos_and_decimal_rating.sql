-- Bereits in Supabase (Projekt FoodPlanner) eingespielt am 19.11.2026. Nur zur Dokumentation im Repo.
-- Rezeptfotos (privater Speicher, Ordner = household_id) und Bewertung mit einer Nachkommastelle (z. B. 6,7).
alter table public.recipes add column if not exists photo_path text;
alter table public.recipes alter column rating type numeric(3,1) using rating::numeric;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy recipe_photos_select_household on storage.objects for select to authenticated
  using (bucket_id = 'recipe-photos' and private.is_household_member(((storage.foldername(name))[1])::uuid));
create policy recipe_photos_insert_household on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-photos' and private.is_household_member(((storage.foldername(name))[1])::uuid));
create policy recipe_photos_update_household on storage.objects for update to authenticated
  using (bucket_id = 'recipe-photos' and private.is_household_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'recipe-photos' and private.is_household_member(((storage.foldername(name))[1])::uuid));
create policy recipe_photos_delete_household on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-photos' and private.is_household_member(((storage.foldername(name))[1])::uuid));
