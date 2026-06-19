-- ============================================================
-- BelaCaixa — Esquema multi-tenant (Supabase / Postgres)
-- Modelo: 1 linha por usuária (tenant). Todos os dados do
-- negócio ficam num documento JSON (coluna data), isolados
-- por Row Level Security: cada uma só vê/edita a PRÓPRIA linha
-- (user_id = auth.uid()). Simples, seguro e escalável p/ MVP.
-- ============================================================

-- limpeza de um modelo anterior (caso exista)
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.appointments  cascade;
drop table if exists public.assets         cascade;
drop table if exists public.transactions   cascade;
drop table if exists public.services       cascade;
drop table if exists public.inventory      cascade;
drop table if exists public.clients        cascade;
drop table if exists public.profiles       cascade;
drop table if exists public.market_offers  cascade;

-- ---------- estado do tenant ----------
create table if not exists public.tenant_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- ISOLAMENTO (RLS) ----------
alter table public.tenant_state enable row level security;

drop policy if exists ts_sel on public.tenant_state;
drop policy if exists ts_ins on public.tenant_state;
drop policy if exists ts_upd on public.tenant_state;
drop policy if exists ts_del on public.tenant_state;

create policy ts_sel on public.tenant_state
  for select using (auth.uid() = user_id);
create policy ts_ins on public.tenant_state
  for insert with check (auth.uid() = user_id);
create policy ts_upd on public.tenant_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy ts_del on public.tenant_state
  for delete using (auth.uid() = user_id);

-- ============================================================
-- ASSINATURAS (status vindo do Stripe via webhook)
-- A usuária só LÊ a própria; quem ESCREVE é o webhook (service_role,
-- que ignora RLS). Por isso não há policy de insert/update p/ usuária.
-- ============================================================
create table if not exists public.subscriptions (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  status                  text not null default 'inactive',  -- active|trialing|past_due|canceled|inactive
  plan                    text,                              -- ex.: silver_mensal
  stripe_customer_id      text,
  stripe_subscription_id  text,
  current_period_end      timestamptz,
  updated_at              timestamptz not null default now()
);
create index if not exists idx_subs_stripe_sub  on public.subscriptions(stripe_subscription_id);
create index if not exists idx_subs_stripe_cust on public.subscriptions(stripe_customer_id);

alter table public.subscriptions enable row level security;
drop policy if exists subs_sel on public.subscriptions;
create policy subs_sel on public.subscriptions
  for select using (auth.uid() = user_id);
