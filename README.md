# Us.exe backend (Supabase)

Database schema, RLS, storage policies, realtime, and Edge Functions shared by **us-exe-web** and **us-exe-mobile**.

## Layout

```
supabase/
  config.toml
  seed.sql
  migrations/
    20240615000000_initial_schema.sql   # full schema + RLS + storage + realtime
  functions/
    send-spark-push/                    # Expo push on sparks INSERT
    send-sticky-note-push/              # Expo push on sticky_notes INSERT
```

Legacy one-off SQL files (`realtime-setup.sql`, `schema-updates.sql`, etc.) are superseded by the migration above. Keep them only as historical notes.

---

## Option A — Clone your existing Supabase project (fastest for same account)

Supabase can duplicate a **paid** project from a backup:

1. Dashboard → **Project Settings** → **Database** → **Backups**
2. Choose a backup → **Restore to a new project**

This copies schema, data, auth users, roles, and indexes. It does **not** copy edge functions, database webhooks, storage files, or API keys — you redeploy those manually.

Docs: [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)

Use this when you want a full copy including live data. Use Option B when you want schema-as-code for a **new empty** project (different couple / different account).

---

## Option B — Reuse this repo on a new Supabase project (recommended)

### 1. Install CLI and link

```bash
cd us-exe-backend
npm i -g supabase   # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref YOUR_NEW_PROJECT_REF
```

Project ref is in the dashboard URL: `https://supabase.com/dashboard/project/<project-ref>`.

### 2. Push schema

```bash
supabase db push
```

This applies `migrations/20240615000000_initial_schema.sql` (tables, RLS, `memories` bucket, realtime publication).

### 3. Provision the couple (no sign-up in the app)

1. **Authentication → Users** — create two users (disable sign-ups in Auth settings).
2. **SQL Editor** — pair them:

```sql
insert into public.couples (partner_1_id, partner_2_id, partner_1_name, partner_2_name)
values (
  'PARTNER_1_AUTH_USER_UUID',
  'PARTNER_2_AUTH_USER_UUID',
  'Name One',
  'Name Two'
);
```

### 4. Deploy edge functions

```bash
supabase functions deploy send-spark-push
supabase functions deploy send-sticky-note-push
```

Optional secret for Expo push reliability:

```bash
supabase secrets set EXPO_ACCESS_TOKEN=your_expo_token
```

### 5. Database webhooks (Dashboard)

| Name | Table | Event | Function |
|------|-------|-------|----------|
| spark-push | `public.sparks` | Insert | `send-spark-push` |
| sticky-note-push | `public.sticky_notes` | Insert | `send-sticky-note-push` |

Details: `../us-exe-mobile/PUSH_SETUP.md`

### 6. Point clients at the new project

| App | Env vars |
|-----|----------|
| Web (`../us-exe-web`) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Mobile (`../us-exe-mobile`) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |

---

## Option C — Pull schema from an existing live project

If your current Supabase already has the correct schema and you want to refresh migrations from production:

```bash
supabase link --project-ref YOUR_EXISTING_PROJECT_REF
supabase db pull
```

Review generated files under `supabase/migrations/`, then commit. Use when the live DB drifted ahead of this repo.

---

## Tables

| Table | Purpose |
|-------|---------|
| `couples` | Links two `auth.users` |
| `moods` | Per-user mood + theme sync |
| `todos` | Shared task list |
| `sticky_notes` | Partner notes tray |
| `photo_wall` | Metadata for `memories` storage |
| `link_drops` | Jam sessions (Meet / Teleparty / Spotify) |
| `dynamic_triggers` | Co-op trigger button configs |
| `flip_letters` | Flip letter module |
| `date_diary` | Date planner entries |
| `date_diary_notes` | Per-partner reflections |
| `date_diary_photos` | Links photos to dates |
| `sparks` | Mobile buzz / hugs (realtime + push) |
| `user_push_tokens` | Expo push tokens (mobile) |

Storage bucket: **`memories`** (private, couple-scoped paths `{couple_id}/...`).

RLS helper: `get_my_couple_id()` — all couple-scoped rows are isolated to the logged-in pair.
