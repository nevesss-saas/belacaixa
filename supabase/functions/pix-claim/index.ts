// BelaCaixa — libera acesso via Pix manual (confiança), com vencimento.
// O dono concilia os comprovantes e pode revogar quem não pagou.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const SB_URL = Deno.env.get('SUPABASE_URL') as string;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') as string;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
const ALLOWED = ['silver_mensal', 'silver_anual', 'gold_mensal', 'gold_anual'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') || '';
    const supa = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return json({ error: 'not_authenticated' }, 401);

    const { plan } = await req.json();
    if (!ALLOWED.includes(plan)) return json({ error: 'invalid_plan' }, 400);

    const days = String(plan).endsWith('_anual') ? 365 : 30;
    const periodEnd = new Date(Date.now() + days * 86400000).toISOString();
    const admin = createClient(SB_URL, SERVICE);
    await admin.from('subscriptions').upsert({
      user_id: user.id, status: 'pix', plan,
      stripe_subscription_id: null, current_period_end: periodEnd,
      updated_at: new Date().toISOString(),
    });
    return json({ ok: true, current_period_end: periodEnd });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
