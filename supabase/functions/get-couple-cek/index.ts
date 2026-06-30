// Returns couple content encryption key (CEK) to authenticated couple members.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { cekToB64, randomCek, unwrapCek, wrapCek } from './crypto.ts';

const rateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimit.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

async function getCoupleIdForUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('couples')
    .select('id')
    .or(`partner_1_id.eq.${userId},partner_2_id.eq.${userId}`)
    .maybeSingle();
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
      },
    });
  }

  const masterKey = Deno.env.get('E2EE_MASTER_KEY');
  if (!masterKey) {
    return json({ error: 'E2EE not configured' }, 503);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: 'Missing Supabase env' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.id) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const userId = userData.user.id;
  if (!checkRateLimit(userId)) {
    return json({ error: 'Rate limited' }, 429);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const coupleId = await getCoupleIdForUser(admin, userId);
  if (!coupleId) {
    return json({ error: 'Not paired' }, 404);
  }

  const body = await req.json().catch(() => ({})) as { action?: string };

  if (body.action === 'complete_migration') {
    const { error: upErr } = await admin
      .from('couple_e2ee_keys')
      .update({ e2ee_migration_version: 1, updated_at: new Date().toISOString() })
      .eq('couple_id', coupleId);
    if (upErr) return json({ error: 'Failed to mark migration' }, 500);
    await admin.from('couples').update({ e2ee_migration_version: 1 }).eq('id', coupleId);
    return json({ ok: true, migration_version: 1 });
  }

  const { data: existing } = await admin
    .from('couple_e2ee_keys')
    .select('e2ee_cek_wrap, e2ee_migration_version')
    .eq('couple_id', coupleId)
    .maybeSingle();

  if (existing?.e2ee_cek_wrap) {
    try {
      const cek = await unwrapCek(existing.e2ee_cek_wrap, masterKey);
      return json({
        cek: cekToB64(cek),
        couple_id: coupleId,
        migration_version: existing.e2ee_migration_version ?? 0,
      });
    } catch {
      return json({ error: 'Key unwrap failed' }, 500);
    }
  }

  const cek = randomCek();
  const wrap = await wrapCek(cek, masterKey);

  const { error: insertErr } = await admin.from('couple_e2ee_keys').insert({
    couple_id: coupleId,
    e2ee_cek_wrap: wrap,
    e2ee_enabled: true,
    e2ee_migration_version: 0,
  });

  if (insertErr) {
    if (insertErr.code === '23505') {
      const { data: winner } = await admin
        .from('couple_e2ee_keys')
        .select('e2ee_cek_wrap, e2ee_migration_version')
        .eq('couple_id', coupleId)
        .single();
      if (winner?.e2ee_cek_wrap) {
        const wonCek = await unwrapCek(winner.e2ee_cek_wrap, masterKey);
        return json({
          cek: cekToB64(wonCek),
          couple_id: coupleId,
          migration_version: winner.e2ee_migration_version ?? 0,
        });
      }
    }
    console.error('[get-couple-cek] insert failed', insertErr.message);
    return json({ error: 'Failed to provision key' }, 500);
  }

  await admin.from('couples').update({ e2ee_enabled: true }).eq('id', coupleId);

  return json({
    cek: cekToB64(cek),
    couple_id: coupleId,
    migration_version: 0,
  });
});
