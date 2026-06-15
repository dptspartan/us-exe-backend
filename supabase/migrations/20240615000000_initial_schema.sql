-- Us.exe — full database schema, RLS, storage, and realtime.
-- Apply to a fresh Supabase project via: supabase db push
-- Idempotent guards (if not exists) allow partial re-runs on dev databases.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helper functions (security definer — used by RLS policies)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_couple_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.couples
  where auth.uid() in (partner_1_id, partner_2_id)
  limit 1;
$$;

create or replace function public.get_my_partner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() = partner_1_id then partner_2_id
    when auth.uid() = partner_2_id then partner_1_id
    else null
  end
  from public.couples
  where auth.uid() in (partner_1_id, partner_2_id)
  limit 1;
$$;

create or replace function public.couple_owns_date_diary(p_date_diary_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.date_diary d
    where d.id = p_date_diary_id
      and d.couple_id = public.get_my_couple_id()
  );
$$;

grant execute on function public.get_my_couple_id() to authenticated;
grant execute on function public.get_my_partner_id() to authenticated;
grant execute on function public.couple_owns_date_diary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------
create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  partner_1_id uuid not null references auth.users (id) on delete cascade,
  partner_2_id uuid not null references auth.users (id) on delete cascade,
  partner_1_name text,
  partner_2_name text,
  created_at timestamptz not null default now(),
  constraint couples_distinct_partners check (partner_1_id <> partner_2_id),
  constraint couples_partner_1_unique unique (partner_1_id),
  constraint couples_partner_2_unique unique (partner_2_id)
);

create table if not exists public.moods (
  user_id uuid primary key references auth.users (id) on delete cascade,
  couple_id uuid not null references public.couples (id) on delete cascade,
  mood_type text not null,
  updated_at timestamptz not null default now()
);

create index if not exists moods_couple_id_idx on public.moods (couple_id);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  task text not null,
  is_completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists todos_couple_id_idx on public.todos (couple_id);

create table if not exists public.sticky_notes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  is_cleared boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists sticky_notes_couple_id_idx on public.sticky_notes (couple_id);

create table if not exists public.photo_wall (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  uploaded_by uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  caption text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists photo_wall_couple_id_idx on public.photo_wall (couple_id);

create table if not exists public.link_drops (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  creator_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  url text not null,
  is_open boolean not null default true,
  session_type text,
  created_at timestamptz not null default now()
);

create index if not exists link_drops_couple_id_idx on public.link_drops (couple_id);
create index if not exists link_drops_couple_open_idx on public.link_drops (couple_id, is_open);

create table if not exists public.dynamic_triggers (
  couple_id uuid not null references public.couples (id) on delete cascade,
  creator_id uuid not null references auth.users (id) on delete cascade,
  trigger_type text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (couple_id, creator_id)
);

create table if not exists public.flip_letters (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now(),
  constraint flip_letters_couple_author_unique unique (couple_id, author_id)
);

create index if not exists flip_letters_couple_id_idx on public.flip_letters (couple_id);

create table if not exists public.date_diary (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  title text not null,
  scheduled_date date not null,
  location text,
  is_completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists date_diary_couple_id_idx on public.date_diary (couple_id);

create table if not exists public.date_diary_notes (
  id uuid primary key default gen_random_uuid(),
  date_diary_id uuid not null references public.date_diary (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  notes text not null default '',
  rating smallint,
  created_at timestamptz not null default now(),
  constraint date_diary_notes_date_user_unique unique (date_diary_id, user_id)
);

create index if not exists date_diary_notes_date_id_idx on public.date_diary_notes (date_diary_id);

create table if not exists public.date_diary_photos (
  id uuid primary key default gen_random_uuid(),
  date_diary_id uuid not null references public.date_diary (id) on delete cascade,
  photo_id uuid not null references public.photo_wall (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint date_diary_photos_unique unique (date_diary_id, photo_id)
);

create index if not exists date_diary_photos_date_id_idx on public.date_diary_photos (date_diary_id);

-- Mobile-only: partner sparks / buzz / hugs
create table if not exists public.sparks (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('buzz', 'love_you', 'need_hugs', 'hug_returned')),
  expires_at timestamptz,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  constraint sparks_distinct_users check (sender_id <> receiver_id)
);

create index if not exists sparks_receiver_created_idx on public.sparks (receiver_id, created_at desc);
create index if not exists sparks_receiver_type_resolved_idx on public.sparks (receiver_id, type, resolved);

-- Mobile push tokens (Expo)
create table if not exists public.user_push_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  expo_push_token text not null,
  platform text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.couples enable row level security;
alter table public.moods enable row level security;
alter table public.todos enable row level security;
alter table public.sticky_notes enable row level security;
alter table public.photo_wall enable row level security;
alter table public.link_drops enable row level security;
alter table public.dynamic_triggers enable row level security;
alter table public.flip_letters enable row level security;
alter table public.date_diary enable row level security;
alter table public.date_diary_notes enable row level security;
alter table public.date_diary_photos enable row level security;
alter table public.sparks enable row level security;
alter table public.user_push_tokens enable row level security;

-- couples: read own row only (rows are provisioned manually in dashboard)
drop policy if exists "couple members read couples" on public.couples;
create policy "couple members read couples"
  on public.couples
  for select
  to authenticated
  using (auth.uid() in (partner_1_id, partner_2_id));

-- Generic couple-scoped CRUD macro pattern
drop policy if exists "couple members select moods" on public.moods;
create policy "couple members select moods"
  on public.moods for select to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members insert moods" on public.moods;
create policy "couple members insert moods"
  on public.moods for insert to authenticated
  with check (couple_id = public.get_my_couple_id() and user_id = auth.uid());

drop policy if exists "couple members update moods" on public.moods;
create policy "couple members update moods"
  on public.moods for update to authenticated
  using (couple_id = public.get_my_couple_id() and user_id = auth.uid())
  with check (couple_id = public.get_my_couple_id() and user_id = auth.uid());

drop policy if exists "couple members delete moods" on public.moods;
create policy "couple members delete moods"
  on public.moods for delete to authenticated
  using (couple_id = public.get_my_couple_id() and user_id = auth.uid());

drop policy if exists "couple members select todos" on public.todos;
create policy "couple members select todos"
  on public.todos for select to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members insert todos" on public.todos;
create policy "couple members insert todos"
  on public.todos for insert to authenticated
  with check (couple_id = public.get_my_couple_id());

drop policy if exists "couple members update todos" on public.todos;
create policy "couple members update todos"
  on public.todos for update to authenticated
  using (couple_id = public.get_my_couple_id())
  with check (couple_id = public.get_my_couple_id());

drop policy if exists "couple members delete todos" on public.todos;
create policy "couple members delete todos"
  on public.todos for delete to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members select sticky_notes" on public.sticky_notes;
create policy "couple members select sticky_notes"
  on public.sticky_notes for select to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members insert sticky_notes" on public.sticky_notes;
create policy "couple members insert sticky_notes"
  on public.sticky_notes for insert to authenticated
  with check (couple_id = public.get_my_couple_id() and author_id = auth.uid());

drop policy if exists "couple members update sticky_notes" on public.sticky_notes;
create policy "couple members update sticky_notes"
  on public.sticky_notes for update to authenticated
  using (couple_id = public.get_my_couple_id())
  with check (couple_id = public.get_my_couple_id());

drop policy if exists "couple members delete sticky_notes" on public.sticky_notes;
create policy "couple members delete sticky_notes"
  on public.sticky_notes for delete to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members select photo_wall" on public.photo_wall;
create policy "couple members select photo_wall"
  on public.photo_wall for select to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members insert photo_wall" on public.photo_wall;
create policy "couple members insert photo_wall"
  on public.photo_wall for insert to authenticated
  with check (couple_id = public.get_my_couple_id() and uploaded_by = auth.uid());

drop policy if exists "couple members update photo_wall" on public.photo_wall;
create policy "couple members update photo_wall"
  on public.photo_wall for update to authenticated
  using (couple_id = public.get_my_couple_id())
  with check (couple_id = public.get_my_couple_id());

drop policy if exists "couple members delete photo_wall" on public.photo_wall;
create policy "couple members delete photo_wall"
  on public.photo_wall for delete to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members select link_drops" on public.link_drops;
create policy "couple members select link_drops"
  on public.link_drops for select to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members insert link_drops" on public.link_drops;
create policy "couple members insert link_drops"
  on public.link_drops for insert to authenticated
  with check (couple_id = public.get_my_couple_id() and creator_id = auth.uid());

drop policy if exists "couple members update link_drops" on public.link_drops;
create policy "couple members update link_drops"
  on public.link_drops for update to authenticated
  using (couple_id = public.get_my_couple_id())
  with check (couple_id = public.get_my_couple_id());

drop policy if exists "couple members delete link_drops" on public.link_drops;
create policy "couple members delete link_drops"
  on public.link_drops for delete to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members select dynamic_triggers" on public.dynamic_triggers;
create policy "couple members select dynamic_triggers"
  on public.dynamic_triggers for select to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members insert dynamic_triggers" on public.dynamic_triggers;
create policy "couple members insert dynamic_triggers"
  on public.dynamic_triggers for insert to authenticated
  with check (couple_id = public.get_my_couple_id() and creator_id = auth.uid());

drop policy if exists "couple members update dynamic_triggers" on public.dynamic_triggers;
create policy "couple members update dynamic_triggers"
  on public.dynamic_triggers for update to authenticated
  using (couple_id = public.get_my_couple_id() and creator_id = auth.uid())
  with check (couple_id = public.get_my_couple_id() and creator_id = auth.uid());

drop policy if exists "couple members delete dynamic_triggers" on public.dynamic_triggers;
create policy "couple members delete dynamic_triggers"
  on public.dynamic_triggers for delete to authenticated
  using (couple_id = public.get_my_couple_id() and creator_id = auth.uid());

drop policy if exists "couple members select flip_letters" on public.flip_letters;
create policy "couple members select flip_letters"
  on public.flip_letters for select to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members insert flip_letters" on public.flip_letters;
create policy "couple members insert flip_letters"
  on public.flip_letters for insert to authenticated
  with check (couple_id = public.get_my_couple_id() and author_id = auth.uid());

drop policy if exists "couple members update flip_letters" on public.flip_letters;
create policy "couple members update flip_letters"
  on public.flip_letters for update to authenticated
  using (couple_id = public.get_my_couple_id() and author_id = auth.uid())
  with check (couple_id = public.get_my_couple_id() and author_id = auth.uid());

drop policy if exists "couple members delete flip_letters" on public.flip_letters;
create policy "couple members delete flip_letters"
  on public.flip_letters for delete to authenticated
  using (couple_id = public.get_my_couple_id() and author_id = auth.uid());

drop policy if exists "couple members select date_diary" on public.date_diary;
create policy "couple members select date_diary"
  on public.date_diary for select to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members insert date_diary" on public.date_diary;
create policy "couple members insert date_diary"
  on public.date_diary for insert to authenticated
  with check (couple_id = public.get_my_couple_id());

drop policy if exists "couple members update date_diary" on public.date_diary;
create policy "couple members update date_diary"
  on public.date_diary for update to authenticated
  using (couple_id = public.get_my_couple_id())
  with check (couple_id = public.get_my_couple_id());

drop policy if exists "couple members delete date_diary" on public.date_diary;
create policy "couple members delete date_diary"
  on public.date_diary for delete to authenticated
  using (couple_id = public.get_my_couple_id());

drop policy if exists "couple members select date_diary_notes" on public.date_diary_notes;
create policy "couple members select date_diary_notes"
  on public.date_diary_notes for select to authenticated
  using (public.couple_owns_date_diary(date_diary_id));

drop policy if exists "couple members insert date_diary_notes" on public.date_diary_notes;
create policy "couple members insert date_diary_notes"
  on public.date_diary_notes for insert to authenticated
  with check (public.couple_owns_date_diary(date_diary_id) and user_id = auth.uid());

drop policy if exists "couple members update date_diary_notes" on public.date_diary_notes;
create policy "couple members update date_diary_notes"
  on public.date_diary_notes for update to authenticated
  using (public.couple_owns_date_diary(date_diary_id) and user_id = auth.uid())
  with check (public.couple_owns_date_diary(date_diary_id) and user_id = auth.uid());

drop policy if exists "couple members delete date_diary_notes" on public.date_diary_notes;
create policy "couple members delete date_diary_notes"
  on public.date_diary_notes for delete to authenticated
  using (public.couple_owns_date_diary(date_diary_id) and user_id = auth.uid());

drop policy if exists "couple members select date_diary_photos" on public.date_diary_photos;
create policy "couple members select date_diary_photos"
  on public.date_diary_photos for select to authenticated
  using (public.couple_owns_date_diary(date_diary_id));

drop policy if exists "couple members insert date_diary_photos" on public.date_diary_photos;
create policy "couple members insert date_diary_photos"
  on public.date_diary_photos for insert to authenticated
  with check (public.couple_owns_date_diary(date_diary_id));

drop policy if exists "couple members delete date_diary_photos" on public.date_diary_photos;
create policy "couple members delete date_diary_photos"
  on public.date_diary_photos for delete to authenticated
  using (public.couple_owns_date_diary(date_diary_id));

drop policy if exists "partners select sparks" on public.sparks;
create policy "partners select sparks"
  on public.sparks for select to authenticated
  using (auth.uid() in (sender_id, receiver_id));

drop policy if exists "partners insert sparks" on public.sparks;
create policy "partners insert sparks"
  on public.sparks for insert to authenticated
  with check (
    auth.uid() = sender_id
    and receiver_id = public.get_my_partner_id()
  );

drop policy if exists "partners update sparks" on public.sparks;
create policy "partners update sparks"
  on public.sparks for update to authenticated
  using (auth.uid() in (sender_id, receiver_id))
  with check (auth.uid() in (sender_id, receiver_id));

drop policy if exists "users manage own push token" on public.user_push_tokens;
create policy "users manage own push token"
  on public.user_push_tokens
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage: private "memories" bucket (photo wall)
-- Paths: {couple_id}/{timestamp}.{ext}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memories',
  'memories',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "couple members read memories" on storage.objects;
create policy "couple members read memories"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'memories'
    and (storage.foldername(name))[1] = public.get_my_couple_id()::text
  );

drop policy if exists "couple members upload memories" on storage.objects;
create policy "couple members upload memories"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'memories'
    and (storage.foldername(name))[1] = public.get_my_couple_id()::text
  );

drop policy if exists "couple members update memories" on storage.objects;
create policy "couple members update memories"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'memories'
    and (storage.foldername(name))[1] = public.get_my_couple_id()::text
  )
  with check (
    bucket_id = 'memories'
    and (storage.foldername(name))[1] = public.get_my_couple_id()::text
  );

drop policy if exists "couple members delete memories" on storage.objects;
create policy "couple members delete memories"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'memories'
    and (storage.foldername(name))[1] = public.get_my_couple_id()::text
  );

-- ---------------------------------------------------------------------------
-- Realtime publication (postgres_changes)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'moods',
    'todos',
    'sticky_notes',
    'photo_wall',
    'link_drops',
    'flip_letters',
    'date_diary',
    'sparks'
  ]
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
