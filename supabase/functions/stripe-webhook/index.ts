// BelaCaixa — recebe eventos da Stripe e atualiza o status da assinatura
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const WH = Deno.env.get('STRIPE_WEBHOOK_SECRET') as string;
const admin = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);

const planOf = (price: any) => price?.lookup_key || price?.nickname || price?.id || null;

async function upsert(userId: string, fields: Record<string, unknown>) {
  await admin.from('subscriptions').upsert({ user_id: userId, ...fields, updated_at: new Date().toISOString() });
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, WH, undefined, cryptoProvider);
  } catch (e) {
    return new Response(`Webhook Error: ${(e as Error).message}`, { status: 400 });
  }
  try {
    const type = event.type;
    if (type === 'checkout.session.completed') {
      const s: any = event.data.object;
      const userId = s.client_reference_id;
      const subId = s.subscription as string | null;
      let status = 'active', plan: string | null = null, periodEnd: string | null = null, customerId = s.customer;
      if (subId) {
        const sub: any = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price'] });
        status = sub.status;
        plan = planOf(sub.items.data[0]?.price);
        periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
        customerId = sub.customer;
      }
      if (userId) await upsert(userId, { status, plan, stripe_customer_id: customerId, stripe_subscription_id: subId, current_period_end: periodEnd });
    } else if (type === 'customer.subscription.created' || type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
      const sub: any = event.data.object;
      const userId = sub.metadata?.user_id;
      const plan = planOf(sub.items?.data?.[0]?.price);
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
      const status = type === 'customer.subscription.deleted' ? 'canceled' : sub.status;
      if (userId) {
        await upsert(userId, { status, plan, stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, current_period_end: periodEnd });
      } else {
        await admin.from('subscriptions').update({ status, plan, current_period_end: periodEnd, updated_at: new Date().toISOString() }).eq('stripe_subscription_id', sub.id);
      }
    }
    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response('handler_error: ' + ((e as Error)?.message || e), { status: 500 });
  }
});
