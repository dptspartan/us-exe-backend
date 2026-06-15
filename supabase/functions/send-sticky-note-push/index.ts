// Expo push when a partner pins a sticky note (webhook on sticky_notes INSERT).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const NOTES_CHANNEL = 'partner-notes';

type NoteRow = {
  id: string;
  couple_id: string;
  author_id: string;
  content?: string | null;
};

type InvokePayload = { note_id: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function partnerDisplayName(
  supabase: ReturnType<typeof createClient>,
  coupleId: string,
  authorId: string
): Promise<string> {
  const { data } = await supabase.from('couples').select('*').eq('id', coupleId).maybeSingle();
  if (!data) return 'Your partner';
  const row = data as Record<string, string>;
  if (row.partner_1_id === authorId) return row.partner_1_name || 'Your partner';
  return row.partner_2_name || 'Your partner';
}

function receiverIdFromCouple(couple: Record<string, string>, authorId: string): string | null {
  if (couple.partner_1_id === authorId) return couple.partner_2_id ?? null;
  if (couple.partner_2_id === authorId) return couple.partner_1_id ?? null;
  return null;
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

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify([{ to: token, sound: 'default', ...message }]),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[send-sticky-note-push] Expo HTTP error', data);
    return { ok: false, data };
  }
  const tickets = (data as { data?: Array<{ status?: string; message?: string }> })?.data ?? [];
  const failed = tickets.filter((t) => t.status === 'error');
  if (failed.length) {
    console.error('[send-sticky-note-push] Expo ticket errors', failed);
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

  let note: NoteRow | null = null;

  try {
    const body = await req.json();
    if (body?.record?.id) {
      note = body.record as NoteRow;
    } else if (body?.note_id) {
      const { data, error } = await supabase
        .from('sticky_notes')
        .select('id, couple_id, author_id, content')
        .eq('id', (body as InvokePayload).note_id)
        .single();
      if (error) throw error;
      note = data as NoteRow;
    }
  } catch (e) {
    console.error('[send-sticky-note-push] parse/load', e);
    return json({ error: 'Invalid payload' }, 400);
  }

  if (!note?.couple_id || !note.author_id) {
    return json({ error: 'No note' }, 400);
  }

  const { data: couple, error: coupleErr } = await supabase
    .from('couples')
    .select('partner_1_id, partner_2_id')
    .eq('id', note.couple_id)
    .maybeSingle();

  if (coupleErr || !couple) {
    console.error('[send-sticky-note-push] couple lookup', coupleErr?.message);
    return json({ error: 'Couple not found' }, 404);
  }

  const receiverId = receiverIdFromCouple(couple as Record<string, string>, note.author_id);
  if (!receiverId) {
    return json({ error: 'No receiver' }, 400);
  }

  const { data: tokenRow, error: tokenErr } = await supabase
    .from('user_push_tokens')
    .select('expo_push_token')
    .eq('user_id', receiverId)
    .maybeSingle();

  if (tokenErr) {
    console.error('[send-sticky-note-push] token lookup', tokenErr.message);
    return json({ error: tokenErr.message }, 500);
  }

  const pushToken = tokenRow?.expo_push_token as string | undefined;
  if (!pushToken) {
    return json({ skipped: true, reason: 'receiver has no push token' });
  }

  const partnerName = await partnerDisplayName(supabase, note.couple_id, note.author_id);

  const expoMessage: Record<string, unknown> = {
    title: `${partnerName} left a note for you`,
    channelId: NOTES_CHANNEL,
    priority: 'high',
    data: {
      screen: 'notes',
      type: 'sticky_note',
      noteId: note.id,
    },
  };

  const result = await sendExpoPush(pushToken, expoMessage, expoAccessToken);
  return json({
    ok: (result as { ok?: boolean }).ok !== false,
    noteId: note.id,
    pushTokenPrefix: pushToken.slice(0, 22),
    expo: result,
  });
});
