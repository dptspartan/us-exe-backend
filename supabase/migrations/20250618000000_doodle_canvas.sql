-- Shared doodle canvas (one row per couple) + saved doodle snapshots on photo_wall

create table if not exists public.doodle_canvas (
  couple_id uuid primary key references public.couples (id) on delete cascade,
  strokes jsonb not null default '[]'::jsonb,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.doodle_canvas enable row level security;

drop policy if exists "couple members select doodle_canvas" on public.doodle_canvas;
create policy "couple members select doodle_canvas"
  on public.doodle_canvas for select to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members insert doodle_canvas" on public.doodle_canvas;
create policy "couple members insert doodle_canvas"
  on public.doodle_canvas for insert to authenticated
  with check (couple_id = public.get_my_couple_id() and updated_by = auth.uid());

drop policy if exists "couple members update doodle_canvas" on public.doodle_canvas;
create policy "couple members update doodle_canvas"
  on public.doodle_canvas for update to authenticated
  using (couple_id = public.get_my_couple_id())
  with check (couple_id = public.get_my_couple_id() and updated_by = auth.uid());

-- Distinguish camera photos from saved doodle snapshots on the polaroid wall
alter table public.photo_wall
  add column if not exists source_type text not null default 'photo';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'photo_wall_source_type_check'
  ) then
    alter table public.photo_wall
      add constraint photo_wall_source_type_check
      check (source_type in ('photo', 'doodle'));
  end if;
end $$;

-- Realtime publication
do $$
declare
  t text;
begin
  foreach t in array array['doodle_canvas']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
