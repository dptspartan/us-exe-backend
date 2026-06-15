-- DEPRECATED: use supabase/migrations/20240615000000_initial_schema.sql (supabase db push).
-- Run this in Supabase SQL Editor if partner updates don't appear live.
-- Dashboard: Database → Replication should also show these tables enabled.

-- 1. Add tables to the realtime publication (Postgres changes)
alter publication supabase_realtime add table public.moods;
alter publication supabase_realtime add table public.todos;
alter publication supabase_realtime add table public.sticky_notes;
alter publication supabase_realtime add table public.photo_wall;
alter publication supabase_realtime add table public.link_drops;
alter publication supabase_realtime add table public.flip_letters;

-- If you get "already member of publication", that table is already enabled — skip that line.

-- 2. Example RLS: allow partners to read/write rows for their couple
-- (Adjust if you already have policies.)

-- create or replace function public.get_my_couple_id()
-- returns uuid
-- language sql stable security definer set search_path = public
-- as $$
--   select id from public.couples
--   where auth.uid() = partner_1_id or auth.uid() = partner_2_id
--   limit 1;
-- $$;

-- create policy "couple members select moods" on public.moods for select
--   using (couple_id = public.get_my_couple_id());
-- create policy "couple members upsert moods" on public.moods for all
--   using (couple_id = public.get_my_couple_id());
