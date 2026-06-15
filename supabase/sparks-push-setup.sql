-- Required for push when app is closed. Run in Supabase SQL Editor.

create table if not exists public.user_push_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text,
  updated_at timestamptz not null default now()
);

alter table public.user_push_tokens enable row level security;

drop policy if exists "users manage own push token" on public.user_push_tokens;
create policy "users manage own push token"
  on public.user_push_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Realtime (skip if already added):
-- alter publication supabase_realtime add table public.sparks;

-- ========== EDGE FUNCTION (required for force-stopped app) ==========
--   supabase functions deploy send-spark-push --no-verify-jwt
--
-- ========== DATABASE WEBHOOK (do this in Dashboard — most reliable) ==========
--   Database → Webhooks → Create hook
--   Name: spark-push
--   Table: public.sparks
--   Events: Insert
--   Type: Supabase Edge Function
--   Function: send-spark-push
--   OR HTTP POST to:
--   https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-spark-push
--   Header: Authorization: Bearer YOUR_SERVICE_ROLE_KEY
--   Body: { "record": { ... } }  (use "Record" template)
--
-- ========== ANDROID FCM (Expo — required for preview APK push tokens) ==========
--   expo.dev → us-exe-mobile → Credentials → Android → FCM V1 (Firebase service account JSON)
--   Then: npm run eas:preview:android  (both phones reinstall)
--   See us-exe-mobile/PUSH_SETUP.md
--
-- ========== VERIFY ==========
--   1. Both users open app → Table Editor → user_push_tokens (2 rows)
--   2. Sender sends buzz → Edge Function logs show ok (not "no push token")
--   3. Receiver force-stopped → notification appears
