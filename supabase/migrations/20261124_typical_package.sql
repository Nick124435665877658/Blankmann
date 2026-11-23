-- 0.3.55 (Nick, 24.11.2026): übliche Packungsgröße je Nahrungsmittel (z. B. Butter 250 g).
-- Beim Bon vorgeschlagen, wenn auf dem Bon keine Menge steht und die zuletzt gekaufte Packung fehlt oder nicht passt.
-- Nicht-destruktiv: nur zwei neue, leere Spalten.
alter table public.household_foods
  add column typical_package_quantity numeric check (typical_package_quantity is null or typical_package_quantity > 0),
  add column typical_package_unit text;
