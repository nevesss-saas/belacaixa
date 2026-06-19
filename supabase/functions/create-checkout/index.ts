// BelaCaixa — cria a sessão de Checkout da Stripe (assinatura)
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  httpClient: Stripe.createFetchHttpClient(),
});
const PRICES = JSON.parse(Deno.env.get('STRIPE_PRICES') || '{}');
const SITE = Deno.env.get('SITE_URL') || 'https://belacaixa.vercel.app';
const SB_URL = Deno.env.get('SUPABASE_URL') as string;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') as string;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') || '';
    const supa = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return json({ error: 'not_authenticated' }, 401);

    const { plan, returnTo } = await req.json();
    const priceId = PRICES[plan];
    if (!priceId) return json({ error: 'invalid_plan' }, 400);

    // reaproveita o customer da Stripe, se já existir
    const admin = createClient(SB_URL, SERVICE);
    const { data: sub } = await admin.from('subscriptions').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
    let customer = sub?.stripe_customer_id as string | undefined;
    if (!customer) {
      const c = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
      customer = c.id;
    }

    const base = (typeof returnTo === 'string' && returnTo.startsWith('http')) ? returnTo : SITE;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { user_id: user.id } },
      allow_promotion_codes: true,
      locale: 'pt-BR',
      success_url: `${base}?assinatura=sucesso`,
      cancel_url: `${base}?assinatura=cancelada`,
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
