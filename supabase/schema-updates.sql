-- DEPRECATED: included in supabase/migrations/20240615000000_initial_schema.sql.
-- Optional schema updates for Us.exe features
-- Run in Supabase SQL Editor

-- Jam sessions: one active session per type (meet / teleparty / spotify)
alter table public.link_drops
  add column if not exists session_type text;

-- Partner names in header (optional — else shows "Partner" + your email local-part)
alter table public.couples
  add column if not exists partner_1_name text,
  add column if not exists partner_2_name text;

-- Example: UPDATE public.couples SET partner_1_name = 'Alex', partner_2_name = 'Sam' WHERE id = 'your-couple-uuid';

-- Photo storage: allow authenticated couple members to upload/read (adjust to your RLS setup)
-- Storage → memories bucket → Policies:
-- INSERT: authenticated AND (storage.foldername(name))[1] = couple_id from get_my_couple_id()
-- SELECT: same

-- Realtime (if not already on)
alter publication supabase_realtime add table public.link_drops;
alter publication supabase_realtime add table public.photo_wall;
alter publication supabase_realtime add table public.date_diary;
