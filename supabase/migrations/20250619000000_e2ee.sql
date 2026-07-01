-- E2EE: couple content encryption key escrow (service-role only) + photo metadata

create table if not exists public.couple_e2ee_keys (
  couple_id uuid primary key references public.couples (id) on delete cascade,
  e2ee_cek_wrap text not null,
  e2ee_enabled boolean not null default false,
  e2ee_migration_version int not null default 0,
  e2ee_migration_state jsonb,
  updated_at timestamptz not null default now()
);

alter table public.couple_e2ee_keys enable row level security;
-- No policies for authenticated — only service role (edge functions) access.

alter table public.couples add column if not exists e2ee_enabled boolean not null default false;
alter table public.couples add column if not exists e2ee_migration_version int not null default 0;

alter table public.photo_wall add column if not exists encryption_meta jsonb;
