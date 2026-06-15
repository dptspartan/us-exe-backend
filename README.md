# Us.exe backend (Supabase)

Database SQL, RLS setup, and Edge Functions shared by **us-exe-web** and **us-exe-mobile**.

## Layout

```
supabase/
  schema-updates.sql          # optional column / realtime tweaks
  realtime-setup.sql          # publication setup
  sparks-push-setup.sql       # push tokens table + sparks webhook
  sticky-notes-push-setup.sql # sticky_notes webhook
  functions/
    send-spark-push/          # Expo push on spark INSERT
    send-sticky-note-push/    # Expo push on sticky note INSERT
```

## Setup

1. Run the SQL scripts in the [Supabase SQL Editor](https://supabase.com/dashboard) in this order (skip any you have already applied):
   - `realtime-setup.sql`
   - `schema-updates.sql`
   - `sparks-push-setup.sql`
   - `sticky-notes-push-setup.sql`

2. Deploy edge functions (Dashboard → Edge Functions, or Supabase CLI):

   ```bash
   supabase functions deploy send-spark-push
   supabase functions deploy send-sticky-note-push
   ```

3. Create **Database Webhooks** (Insert) pointing to those functions — see `../us-exe-mobile/PUSH_SETUP.md`.

## Clients

| App | Folder | Env keys |
|-----|--------|----------|
| Web | `../us-exe-web` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Mobile | `../us-exe-mobile` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |

Both use the same Supabase project.
