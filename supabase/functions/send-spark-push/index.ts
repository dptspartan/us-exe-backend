// Sends Expo push when a spark is created. Uses "default" sound for reliable delivery.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const SPARKS_CHANNEL = 'partner-sparks';
const BUZZ_CHANNEL = 'spark-buzz';

type SparkType = 'buzz' | 'love_you' | 'need_hugs' | 'hug_returned';

type SparkRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  type: SparkType;
};

type InvokePayload = { spark_id: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function partnerDisplayName(
  supabase: ReturnType<typeof createClient>,
  coupleId: string | null,
  senderId: string
): Promise<string> {
  if (!coupleId) return 'Your partner';
  const { data } = await supabase.from('couples').select('*').eq('id', coupleId).maybeSingle();
  if (!data) return 'Your partner';
  const row = data as Record<string, string>;
  if (row.partner_1_id === senderId) {
    return row.partner_1_name || 'Your partner';
  }
  return row.partner_2_name || 'Your partner';
}

function notificationCopy(type: SparkType, name: string) {
  switch (type) {
    case 'buzz':
      return {
        title: name,
        body: 'I miss you 💫',
        channelId: BUZZ_CHANNEL,
        priority: 'high' as const,
      };
    case 'love_you':
      return {
        title: name,
        body: 'I love you! 💕',
        channelId: SPARKS_CHANNEL,
        priority: 'high' as const,
      };
    case 'need_hugs':
      return {
        title: `${name} needs a hug`,
        body: 'Open Us.exe — they are waiting',
        channelId: SPARKS_CHANNEL,
        priority: 'high' as const,
      };
    case 'hug_returned':
      return {
        title: name,
        body: 'Sent you a hug back 🫂',
        channelId: SPARKS_CHANNEL,
        priority: 'high' as const,
      };
    default:
      return null;
  }
}

async function sendExpoPush(
  token: string,
  message: Record<string, unknown>,
  expoToken: string | undefined
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (expoToken) headers.Authorization = `Bearer ${expoToken}`;

  const payload = { to: token, sound: 'default', ...message };

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify([payload]),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[send-spark-push] Expo HTTP error', data);
    return { ok: false, data };
  }
  const tickets = (data as { data?: Array<{ status?: string; message?: string; details?: unknown }> })?.data ?? [];
  const failed = tickets.filter((t) => t.status === 'error');
  if (failed.length) {
    console.error('[send-spark-push] Expo ticket errors', failed);
    return { ok: false, tickets: failed };
  }
  return { ok: true, tickets };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');

  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Missing Supabase env' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  let spark: SparkRow | null = null;

  try {
    const body = await req.json();
    if (body?.record?.id) {
      spark = body.record as SparkRow;
    } else if (body?.spark_id) {
      const { data, error } = await supabase
        .from('sparks')
        .select('id, sender_id, receiver_id, type')
        .eq('id', (body as InvokePayload).spark_id)
        .single();
      if (error) throw error;
      spark = data as SparkRow;
    }
  } catch (e) {
    console.error('[send-spark-push] parse/load', e);
    return json({ error: 'Invalid payload' }, 400);
  }

  if (!spark?.receiver_id || !spark.type) {
    return json({ error: 'No spark' }, 400);
  }

  const { data: tokenRow, error: tokenErr } = await supabase
    .from('user_push_tokens')
    .select('expo_push_token')
    .eq('user_id', spark.receiver_id)
    .maybeSingle();

  if (tokenErr) {
    console.error('[send-spark-push] token lookup', tokenErr.message);
    return json({ error: tokenErr.message }, 500);
  }

  const pushToken = tokenRow?.expo_push_token as string | undefined;
  if (!pushToken) {
    return json({ skipped: true, reason: 'receiver has no push token' });
  }

  const { data: couple } = await supabase
    .from('couples')
    .select('id')
    .or(`partner_1_id.eq.${spark.sender_id},partner_2_id.eq.${spark.sender_id}`)
    .maybeSingle();

  const partnerName = await partnerDisplayName(
    supabase,
    (couple as { id?: string } | null)?.id ?? null,
    spark.sender_id
  );

  const copy = notificationCopy(spark.type, partnerName);
  if (!copy) return json({ skipped: true });

  const { channelId, ...rest } = copy;

  const expoMessage: Record<string, unknown> = {
    ...rest,
    channelId,
    data: {
      screen: 'sparks',
      sparkType: spark.type,
      sparkId: spark.id,
    },
  };

  const result = await sendExpoPush(pushToken, expoMessage, expoAccessToken);
  return json({
    ok: (result as { ok?: boolean }).ok !== false,
    sparkType: spark.type,
    pushTokenPrefix: pushToken.slice(0, 22),
    expo: result,
  });
});
