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
