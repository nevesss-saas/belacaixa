/* ============================================================
   BelaCaixa — App (vanilla JS, zero dependências, offline)
   ============================================================ */
'use strict';
const STORE = 'belacaixa_v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------------- utils ---------------- */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = n => BRL.format(Math.round((n + Number.EPSILON) * 100) / 100);
const fmtK = n => n >= 1000 ? 'R$ ' + (n / 1000).toFixed(1).replace('.', ',') + 'k' : fmt(n);
const uid = () => Math.random().toString(36).slice(2, 9);
/* ---- fuso horário do negócio (padrão: Brasília) ----
   Antes o "dia" era calculado em UTC, então às 21h de Brasília já virava
   o dia seguinte. Agora tudo se baseia no fuso configurado pelo salão. */
const DEFAULT_TZ = 'America/Sao_Paulo';
function bizTZ() {
  try { return (state && state.business && state.business.timezone) || DEFAULT_TZ; }
  catch (_) { return DEFAULT_TZ; }
}
// formata um Date como YYYY-MM-DD no fuso do negócio (robusto a qualquer locale)
function isoInTZ(d, tz) {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz || bizTZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = t => p.find(x => x.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch (_) { return d.toISOString().slice(0, 10); }
}
// soma dias a uma data ISO (âncora meio-dia UTC evita saltos de horário de verão)
function addDaysISO(iso, delta) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
// "hoje" (YYYY-MM-DD) no fuso do negócio — não em UTC
const todayISO = () => isoInTZ(new Date());
// hora atual HH:MM no fuso do negócio
function nowHHMM() {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: bizTZ(), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
  catch (_) { return new Date().toTimeString().slice(0, 5); }
}
// data + hora atuais no fuso, pra mostrar ao usuário (ex.: "sex, 04/07/2026 20:11")
function nowLabelTZ() { return fmtDateFull(todayISO()) + ' ' + nowHHMM(); }
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthKey = d => d.slice(0, 7);
const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}`; };
const fmtDateFull = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const dayName = iso => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][new Date(iso + 'T12:00').getDay()];
const initials = n => n.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const AVCOLORS = ['#f43f8e', '#9b5de5', '#00b389', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#06b6d4'];
const AVCOLORS_MASC = ['#1d4ed8', '#1e3a8a', '#00b389', '#f59e0b', '#3b82f6', '#0891b2', '#334155', '#06b6d4'];
const avColor = s => { const a = document.documentElement.dataset.theme === 'masc' ? AVCOLORS_MASC : AVCOLORS; return a[[...s].reduce((x, c) => x + c.charCodeAt(0), 0) % a.length]; };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let state = null;          // carregado da nuvem após login
let sb = null;             // cliente Supabase
let currentUser = null;    // usuária logada
let demoMode = false;      // demonstração navegável (sem login, sem nuvem)
let lastCloudStamp = null; // updatedAt que sabemos estar salvo na nuvem (trava otimista)
let rtChannel = null;      // canal Supabase Realtime da linha do tenant (reservas ao vivo)
const ADMIN_EMAIL = 'celula.ruach18@gmail.com';   // administrador que vê o painel
const isAdmin = () => !demoMode && !!currentUser && (currentUser.email || '').toLowerCase() === ADMIN_EMAIL;

/* ============================================================
   NUVEM (Supabase) — auth + persistência isolada por tenant
   ============================================================ */
function initSb() {
  const c = window.BELACAIXA_CFG || {};
  if (!window.supabase || !c.url || !c.anon) { console.warn('Supabase indisponível'); return false; }
  sb = window.supabase.createClient(c.url, c.anon, { auth: { persistSession: true, autoRefreshToken: true } });
  return true;
}
async function cloudLoad() {
  if (!sb || !currentUser) return;
  const { data: row, error } = await sb.from('tenant_state').select('data').eq('user_id', currentUser.id).maybeSingle();
  if (error) { console.error(error); toast('Não consegui carregar seus dados.', 'warn'); }
  if (row && row.data && row.data.v === 1) { state = row.data; lastCloudStamp = state.updatedAt != null ? state.updatedAt : null; }
  else { state = starterState(); lastCloudStamp = null; await cloudSaveNow(); }
}
function save() { cloudSaveNow(); }   // mesma assinatura usada no app inteiro (fire-and-forget)

// Mescla no estado local só as RESERVAS DO LINK pendentes que ainda não temos —
// é o que o book-hold adiciona. Nunca perde uma reserva que chegou pela nuvem, e
// NÃO re-adiciona atendimentos normais que o dono possa ter apagado localmente.
function mergeRemoteLinkHolds(remote) {
  if (!state || !remote || !Array.isArray(remote.appointments)) return [];
  const have = new Set((state.appointments || []).map(a => a && a.id));
  const add = remote.appointments.filter(a => a && a.pending && a.source === 'link' && !have.has(a.id));
  if (add.length) state.appointments = (state.appointments || []).concat(add);
  return add;
}
// Puxa o estado mais novo da nuvem e mescla as reservas do link (usado no conflito de gravação).
async function pullAndMergeRemote() {
  try {
    const { data: row, error } = await sb.from('tenant_state').select('data').eq('user_id', currentUser.id).maybeSingle();
    if (error || !row || !row.data) return false;
    const remote = row.data;
    const added = mergeRemoteLinkHolds(remote);
    lastCloudStamp = remote.updatedAt != null ? remote.updatedAt : lastCloudStamp;
    if (added.length && !document.querySelector('.modal-bg')) render();
    return true;
  } catch (e) { console.error('pull error', e); return false; }
}
async function cloudSaveNow() {
  if (demoMode) return;                        // demonstração nunca persiste na nuvem
  if (!sb || !currentUser || !state) return;

  // 1ª gravação (linha ainda não existe / não sabemos o que há na nuvem): upsert simples
  if (lastCloudStamp == null) {
    state.updatedAt = Date.now();
    try {
      const { error } = await sb.from('tenant_state').upsert({ user_id: currentUser.id, data: state, updated_at: new Date().toISOString() });
      if (error) { console.error('save error', error); return; }
      lastCloudStamp = state.updatedAt;
    } catch (e) { console.error('save error', e); }
    return;
  }

  // Gravação com TRAVA OTIMISTA: só escreve se a nuvem ainda está no stamp que conhecemos.
  // Se uma reserva do link entrou no meio, puxa+mescla e tenta de novo (não perde a reserva).
  for (let attempt = 0; attempt < 4; attempt++) {
    const guard = String(lastCloudStamp);
    state.updatedAt = Date.now();
    let upd, error;
    try {
      ({ data: upd, error } = await sb.from('tenant_state')
        .update({ data: state, updated_at: new Date().toISOString() })
        .eq('user_id', currentUser.id).eq('data->>updatedAt', guard)
        .select('user_id'));
    } catch (e) { console.error('save error', e); return; }
    if (error) { console.error('save error', error); return; }
    if (upd && upd.length) { lastCloudStamp = state.updatedAt; return; }
    // conflito: a nuvem mudou desde o último load/save → puxa, mescla reservas do link e re-tenta
    if (!(await pullAndMergeRemote())) return;   // sem ler o novo estado, melhor não sobrescrever
  }
  console.warn('cloudSaveNow: conflito persistente após 4 tentativas.');
}

/* ---- Realtime: a linha do tenant muda (ex.: reserva pelo link) → reflete na hora ---- */
function onTenantRemoteChange(remote) {
  if (!remote || !state) return;
  if (remote.updatedAt != null && remote.updatedAt === state.updatedAt) { lastCloudStamp = remote.updatedAt; return; }  // eco da própria gravação
  lastCloudStamp = remote.updatedAt != null ? remote.updatedAt : lastCloudStamp;
  const added = mergeRemoteLinkHolds(remote);
  if (!added.length) return;
  toast('🔔 Nova reserva pelo link! Confira na agenda.', 'ok', 6500, { label: 'Ver agenda', onClick: () => setView('agenda') });
  if (!document.querySelector('.modal-bg')) render();   // não interrompe se um modal estiver aberto
}
function subscribeTenantRealtime() {
  if (!sb || !currentUser) return;
  unsubscribeTenantRealtime();
  try {
    rtChannel = sb.channel('tenant-' + currentUser.id)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tenant_state', filter: 'user_id=eq.' + currentUser.id },
        (payload) => onTenantRemoteChange(payload && payload.new && payload.new.data))
      .subscribe();
  } catch (e) { console.warn('realtime indisponível', e); }
}
function unsubscribeTenantRealtime() {
  if (rtChannel && sb) { try { sb.removeChannel(rtChannel); } catch (e) {} }
  rtChannel = null;
}
// estado inicial de uma conta NOVA: 100% zerado, pronto para o dono preencher.
// NADA de demonstração — sem serviços, estoque, clientes, caixa, agenda, bens nem
// investimentos. Só ficam os padrões estruturais (fuso, expediente e o tema escolhido
// antes de logar) pra o app funcionar já na primeira tela.
function starterState() {
  return {
    v: 1,
    business: {
      name: 'Meu Negócio',
      theme: (typeof savedThemePref === 'function' && savedThemePref()) || 'fem',
      timezone: DEFAULT_TZ,
      reserveTarget: 0,
      monthlyGoal: 0,
      hours: { open: '09:00', close: '19:00', days: [1, 2, 3, 4, 5, 6], slot: 30 },
    },
    security: { pinHash: '' },
    clients: [], services: [], inventory: [], transactions: [],
    appointments: [], assets: [], investments: [], patHist: [], chat: [],
  };
}

/* ============================================================
   SEED (dados de demonstração)
   ============================================================ */
function seed() {
  const now = new Date();
  const inv = [
    { id: 'i_algodao', name: 'Algodão', category: 'Descartável', qty: 14, unit: 'pct', min: 6, cost: 9.9, supplier: 'Bella Distribuidora', use: 0.25 },
    { id: 'i_acetona', name: 'Acetona', category: 'Químico', qty: 1.2, unit: 'L', min: 2, cost: 18.5, supplier: 'Nails Supply', use: 0.04 },
    { id: 'i_esmalte', name: 'Esmalte (sortido)', category: 'Esmaltaria', qty: 22, unit: 'un', min: 12, cost: 6.5, supplier: 'Bella Distribuidora', use: 0.05 },
    { id: 'i_base', name: 'Base / Top Coat', category: 'Esmaltaria', qty: 5, unit: 'un', min: 6, cost: 14.0, supplier: 'Glam Cosméticos', use: 0.06 },
    { id: 'i_gel', name: 'Gel construtor', category: 'Alongamento', qty: 3, unit: 'pote', min: 4, cost: 39.9, supplier: 'Nails Supply', use: 0.08 },
    { id: 'i_lixa', name: 'Lixa descartável', category: 'Descartável', qty: 40, unit: 'un', min: 20, cost: 1.2, supplier: 'Bella Distribuidora', use: 0.5 },
    { id: 'i_cuticula', name: 'Removedor de cutícula', category: 'Químico', qty: 7, unit: 'un', min: 4, cost: 11.0, supplier: 'Glam Cosméticos', use: 0.03 },
    { id: 'i_alcool', name: 'Álcool 70%', category: 'Higiene', qty: 4, unit: 'L', min: 3, cost: 12.0, supplier: 'Nails Supply', use: 0.05 },
    { id: 'i_toalha', name: 'Toalha descartável', category: 'Descartável', qty: 9, unit: 'pct', min: 8, cost: 16.0, supplier: 'Bella Distribuidora', use: 0.2 },
  ];
  const services = [
    { id: 's_mao', name: 'Manicure', price: 45, dur: 45, mat: [['i_algodao', .25], ['i_acetona', .04], ['i_esmalte', .05], ['i_cuticula', .03]] },
    { id: 's_pe', name: 'Pedicure', price: 55, dur: 50, mat: [['i_algodao', .25], ['i_lixa', .5], ['i_esmalte', .05], ['i_cuticula', .03]] },
    { id: 's_gel', name: 'Esmaltação em gel', price: 75, dur: 60, mat: [['i_base', .06], ['i_esmalte', .05], ['i_alcool', .03]] },
    { id: 's_along', name: 'Alongamento em gel', price: 140, dur: 120, mat: [['i_gel', .08], ['i_base', .06], ['i_lixa', .5]] },
    { id: 's_spa', name: 'Spa dos pés', price: 90, dur: 70, mat: [['i_toalha', .2], ['i_lixa', .5], ['i_alcool', .05]] },
  ];
  const names = ['Ana Beatriz Lima', 'Camila Souza', 'Fernanda Rocha', 'Juliana Alves', 'Patrícia Gomes', 'Renata Dias', 'Tatiane Melo', 'Vanessa Cardoso', 'Bruna Castro', 'Larissa Pinto'];
  const clients = names.map((n, idx) => ({
    id: 'c_' + idx, name: n, phone: `(11) 9${(40000000 + idx * 137711).toString().slice(0, 4)}-${(1000 + idx * 311).toString().slice(0, 4)}`,
    notes: '', createdAt: todayISO()
  }));

  const tx = [];
  // saldo inicial
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  tx.push({ id: uid(), type: 'in', category: 'Outros', amount: 3200, desc: 'Saldo inicial do caixa', date: start.toISOString().slice(0, 10) });
  const outCats = [['Aluguel', 1200, 1200], ['Energia / Água', 180, 320], ['Marketing', 120, 480], ['Matéria-prima', 350, 720], ['Manutenção', 0, 260]];
  // 6 meses
  for (let m = 5; m >= 0; m--) {
    const dRef = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const y = dRef.getFullYear(), mo = dRef.getMonth();
    const partial = m === 0; // mês atual = parcial
    const days = partial ? now.getDate() : new Date(y, mo + 1, 0).getDate();
    const seasonal = 1 + (mo % 3) * 0.06; // leve sazonalidade
    const atendN = Math.round((days / 30) * (52 + m * 2) * seasonal);
    for (let k = 0; k < atendN; k++) {
      const sv = services[Math.floor(Math.random() * services.length)];
      const cl = clients[Math.floor(Math.random() * clients.length)];
      const day = 1 + Math.floor(Math.random() * days);
      tx.push({ id: uid(), type: 'in', category: 'Atendimentos', amount: sv.price + (Math.random() < .25 ? 10 : 0), desc: sv.name + ' — ' + cl.name.split(' ')[0], date: `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, clientId: cl.id });
    }
    // venda de produtos
    if (Math.random() < .8) tx.push({ id: uid(), type: 'in', category: 'Venda de produtos', amount: 60 + Math.round(Math.random() * 180), desc: 'Venda de esmaltes/kits', date: `${y}-${String(mo + 1).padStart(2, '0')}-10` });
    // saídas
    outCats.forEach(([cat, lo, hi]) => {
      if (partial && Math.random() < .4) return;
      const v = lo + Math.round(Math.random() * (hi - lo));
      if (v > 0) tx.push({ id: uid(), type: 'out', category: cat, amount: v, desc: cat, date: `${y}-${String(mo + 1).padStart(2, '0')}-05` });
    });
  }

  // agendamentos: hoje + próximos dias
  const appts = [];
  const mk = (offset, time, sid, cid, status) => {
    const d = new Date(now); d.setDate(d.getDate() + offset);
    const sv = services.find(s => s.id === sid), cl = clients.find(c => c.id === cid);
    return { id: uid(), date: d.toISOString().slice(0, 10), time, serviceId: sid, serviceName: sv.name, clientId: cid, clientName: cl.name, price: sv.price, status };
  };
  appts.push(mk(0, '09:00', 's_mao', 'c_0', 'agendado'));
  appts.push(mk(0, '10:30', 's_gel', 'c_3', 'agendado'));
  appts.push(mk(0, '14:00', 's_along', 'c_5', 'agendado'));
  appts.push(mk(1, '09:30', 's_pe', 'c_2', 'agendado'));
  appts.push(mk(1, '11:00', 's_mao', 'c_7', 'agendado'));
  appts.push(mk(2, '15:00', 's_spa', 'c_1', 'agendado'));
  appts.push(mk(3, '10:00', 's_gel', 'c_4', 'agendado'));

  const assets = [
    { id: uid(), name: 'Cadeira de manicure profissional', category: 'Mobiliário', value: 1800, acquiredAt: '2024-08-10' },
    { id: uid(), name: 'Autoclave de esterilização', category: 'Equipamento', value: 2200, acquiredAt: '2024-11-02' },
    { id: uid(), name: 'Cabine de fluxo / exaustor', category: 'Equipamento', value: 1400, acquiredAt: '2025-02-15' },
    { id: uid(), name: 'Kit de cadeira do cliente + apoio', category: 'Mobiliário', value: 900, acquiredAt: '2024-09-01' },
    { id: uid(), name: 'Cabine UV/LED + acessórios', category: 'Equipamento', value: 650, acquiredAt: '2025-04-20' },
  ];

  const investments = [
    { id: uid(), name: 'Tesouro Selic 2029', place: 'Tesouro Direto', value: 3200, rate: 10.5, updatedAt: isoInTZ(new Date(now.getFullYear(), now.getMonth() - 1, 12)) },
    { id: uid(), name: 'CDB liquidez diária', place: 'Nubank', value: 1500, rate: 11, updatedAt: isoInTZ(new Date(now.getFullYear(), now.getMonth() - 1, 12)) },
  ];

  // histórico de patrimônio (6 meses)
  const patHist = [];
  for (let m = 5; m >= 0; m--) {
    const dRef = new Date(now.getFullYear(), now.getMonth() - m, 1);
    patHist.push({ month: dRef.toISOString().slice(0, 7), value: 0 }); // calculado depois
  }

  return {
    v: 1,
    business: { name: 'Nails e Pedicure', theme: 'fem', timezone: DEFAULT_TZ, reserveTarget: 5000, monthlyGoal: 8000, hours: { open: '09:00', close: '19:00', days: [1, 2, 3, 4, 5, 6], slot: 30 } },
    security: { pinHash: '' },
    clients, services, inventory: inv, transactions: tx, appointments: appts, assets, investments,
    patHist, chat: []
  };
}

/* ============================================================
   SELECTORS / CÁLCULOS
   ============================================================ */
const sumIn = (tx) => tx.filter(t => t.type === 'in').reduce((a, t) => a + t.amount, 0);
const sumOut = (tx) => tx.filter(t => t.type === 'out').reduce((a, t) => a + t.amount, 0);
const balance = () => sumIn(state.transactions) - sumOut(state.transactions);
const txOfMonth = (mk) => state.transactions.filter(t => monthKey(t.date) === mk);
const curMonthKey = () => todayISO().slice(0, 7);
function prevMonthKey() { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); }

function monthStats(mk) {
  const t = txOfMonth(mk); const i = sumIn(t), o = sumOut(t);
  return { in: i, out: o, profit: i - o, margin: i ? (i - o) / i * 100 : 0 };
}
function last6Months() {
  const arr = []; const now = new Date();
  for (let m = 5; m >= 0; m--) { const d = new Date(now.getFullYear(), now.getMonth() - m, 1); arr.push({ key: d.toISOString().slice(0, 7), label: MONTHS[d.getMonth()] }); }
  return arr;
}
const assetsTotal = () => state.assets.reduce((a, x) => a + x.value, 0);
const investTotal = () => (state.investments || []).reduce((a, x) => a + (+x.value || 0), 0);
const patrimonioTotal = () => assetsTotal() + investTotal() + Math.max(0, balance());
/* investimento "vencido" = atualizado num mês anterior ao atual (nudge de atualização mensal) */
function investStale(iso) { return String(iso || '').slice(0, 7) < todayISO().slice(0, 7); }
/* Renda passiva estimada — cada investimento rende ~taxa% ao ano.
   É PROJEÇÃO (faz o patrimônio crescer); só vira dinheiro no caixa quando o dono resgata. */
const DEFAULT_INVEST_RATE = 10.5;   // ≈ Tesouro Selic / CDB 100% CDI
function investRate(v) {
  const r = (v && v.rate != null && isFinite(+v.rate)) ? +v.rate : DEFAULT_INVEST_RATE;
  return Math.max(0, Math.min(200, r));
}
function investMonthly(v) { return (+v.value || 0) * investRate(v) / 100 / 12; }
function investMonthlyTotal() { return (state.investments || []).reduce((a, v) => a + investMonthly(v), 0); }
function investMonthsSince(iso) {
  const p = String(iso || '').split('-'); if (p.length !== 3) return 0;
  const t = todayISO().split('-');
  const m = (+t[0] - +p[0]) * 12 + (+t[1] - +p[1]);
  return m > 0 ? m : 0;
}
/* valor projetado hoje = valor conhecido rendendo a taxa desde a última atualização (juros compostos mensais) */
function investProjected(v) {
  const m = investMonthsSince(v && v.updatedAt);
  const r = investRate(v) / 100 / 12;
  return (+v.value || 0) * Math.pow(1 + r, m);
}
const freeCash = () => Math.max(0, balance() - state.business.reserveTarget);
const lowStock = () => state.inventory.filter(i => i.qty <= i.min);
const todaysAppts = () => state.appointments.filter(a => a.date === todayISO() && a.status === 'agendado').sort((a, b) => a.time.localeCompare(b.time));
const upcomingAppts = () => state.appointments.filter(a => a.status === 'agendado' && a.date >= todayISO()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

function expenseByCategory(mk) {
  const map = {};
  txOfMonth(mk).filter(t => t.type === 'out').forEach(t => map[t.category] = (map[t.category] || 0) + t.amount);
  return Object.entries(map).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value);
}
function clientStats(id) {
  const t = state.transactions.filter(x => x.clientId === id && x.type === 'in');
  const total = t.reduce((a, x) => a + x.amount, 0);
  const last = t.map(x => x.date).sort().slice(-1)[0];
  return { visits: t.length, total, last };
}
// estimativa de consumo diário de um item (com base no nº médio de atendimentos/dia)
function dailyServices() {
  const ms = monthStats(curMonthKey()); const day = Math.max(1, +todayISO().slice(8, 10));
  const cnt = txOfMonth(curMonthKey()).filter(t => t.category === 'Atendimentos').length;
  return Math.max(1, cnt / day);
}
function daysToDeplete(item) {
  const perDay = item.use * dailyServices();
  if (perDay <= 0) return 999;
  return Math.floor(item.qty / perDay);
}
// lista de compras sugerida p/ os itens no/abaixo do mínimo (qtd sugerida ao custo atual)
function pedidoItens() {
  return lowStock().map(it => {
    const price = it.cost;
    const qty = Math.max(it.min, Math.ceil(it.min * 2 - it.qty));
    return { it, price, qty, sub: +(qty * price).toFixed(2) };
  });
}
function pedidoTotal() { return pedidoItens().reduce((s, r) => s + r.sub, 0); }

/* ============================================================
   IA — INSIGHTS / ASSISTENTE / INVESTIMENTOS
   ============================================================ */
function getInsights() {
  const out = [];
  const cur = monthStats(curMonthKey()), prev = monthStats(prevMonthKey());
  // lucro
  if (prev.profit !== 0) {
    const diff = cur.profit - prev.profit;
    const pct = prev.profit ? Math.round(diff / Math.abs(prev.profit) * 100) : 0;
    out.push({
      tone: diff >= 0 ? 'green' : 'amber', ico: diff >= 0 ? '📈' : '📉',
      title: diff >= 0 ? `Lucro crescendo ${pct}%` : `Lucro caiu ${Math.abs(pct)}%`,
      text: `Seu lucro líquido este mês está em ${fmt(cur.profit)} (mês passado: ${fmt(prev.profit)}).`
    });
  }
  // estoque
  const low = lowStock();
  if (low.length) {
    const it = low[0];
    out.push({
      tone: 'amber', ico: '📦', title: `${low.length} item(ns) acabando`,
      text: `${it.name} está em ${it.qty} ${it.unit} (mín. ${it.min}). Já está na sua lista de compras.`,
      act: 'go-estoque', actLabel: 'Ver estoque & compras'
    });
  }
  // caixa livre
  const fc = freeCash();
  if (fc > 300) out.push({ tone: 'blue', ico: '💡', title: `Você tem ${fmt(fc)} de caixa livre`, text: `Acima da sua reserva de ${fmt(state.business.reserveTarget)}. Veja sugestões de onde aplicar.`, act: 'go-patrimonio', actLabel: 'Ver investimentos' });
  // meta
  const goal = state.business.monthlyGoal;
  if (goal) { const pct = Math.round(cur.in / goal * 100); out.push({ tone: pct >= 100 ? 'green' : 'violet', ico: '🎯', title: `Meta do mês: ${pct}%`, text: `Você faturou ${fmt(cur.in)} de uma meta de ${fmt(goal)}.` }); }
  return out;
}

function investmentSuggestions() {
  const bal = balance(), reserve = state.business.reserveTarget, fc = freeCash();
  const list = [];
  if (bal < reserve) {
    list.push({ ico: '🛟', tone: 'amber', title: 'Complete sua reserva de emergência', alloc: reserve - bal, detail: `Sua reserva ideal é ${fmt(reserve)} (cobre imprevistos). Faltam ${fmt(reserve - bal)}. Priorize isso antes de investir.`, ret: 'Segurança do negócio' });
    return { fc, list };
  }
  // distribui o caixa livre
  const a1 = Math.round(fc * 0.45), a2 = Math.round(fc * 0.35), a3 = fc - a1 - a2;
  list.push({ ico: '🏦', tone: 'green', title: 'Reserva rendendo (CDB liquidez diária)', alloc: a1, detail: 'Dinheiro que você pode resgatar a qualquer momento, rendendo ~100% do CDI.', ret: `≈ ${fmt(a1 * 0.011)} /mês` });
  list.push({ ico: '📊', tone: 'blue', title: 'Tesouro / CDB de prazo médio', alloc: a2, detail: 'Para objetivos de 6–12 meses (ex.: nova cadeira, reforma). Rende um pouco mais.', ret: `≈ ${fmt(a2 * 0.013)} /mês` });
  list.push({ ico: '✨', tone: 'violet', title: 'Reinvestir no negócio', alloc: a3, detail: 'Marketing local, curso de nail art ou novo equipamento — costuma ter o melhor retorno pra microempresa.', ret: 'Mais clientes / ticket maior' });
  return { fc, list };
}

// parceria de investimento (link global da empresa; vazio = só conteúdo educativo)
function investPartner() {
  try {
    const p = (window.BELACAIXA_CFG && window.BELACAIXA_CFG.invest) || {};
    if (!p.partnerUrl) return null;
    return { name: p.partnerName || 'nosso parceiro', url: p.partnerUrl, bonus: p.partnerBonus || '' };
  } catch (_) { return null; }
}
// bancos/corretoras com passo a passo próprio pra comprar Tesouro Selic / CDB de liquidez diária
const INVEST_BANKS = [
  { id: 'nubank', name: 'Nubank', color: '#820ad1', tag: 'Nu', steps: [
      'Abra o app do <b>Nubank</b> e toque em <b>Investimentos</b> (ícone de gráfico).',
      'Escolha <b>Tesouro Direto</b> → <b>Tesouro Selic</b> (o de vencimento mais próximo).',
      'Digite o valor (a partir de ~R$ 30) e confirme com a sua senha.'],
    tip: 'Pra guardar com resgate na hora também dá pra usar as <b>Caixinhas</b> rendendo 100% do CDI.' },
  { id: 'inter', name: 'Inter', color: '#ff7a00', tag: 'in', steps: [
      'No app do <b>Inter</b>, toque em <b>Investimentos</b>.',
      'Vá em <b>Tesouro Direto</b> → <b>Tesouro Selic</b>.',
      'Informe o valor e confirme.'],
    tip: 'Na mesma tela de renda fixa aparecem <b>CDBs 100% do CDI com liquidez diária</b>.' },
  { id: 'c6', name: 'C6 Bank', color: '#242424', tag: 'C6', steps: [
      'No app do <b>C6</b>, abra <b>Investimentos</b>.',
      'Toque em <b>Tesouro Direto</b> → <b>Tesouro Selic</b>.',
      'Digite o valor e confirme.'],
    tip: 'Veja também os <b>CDBs do C6</b> com liquidez diária.' },
  { id: 'picpay', name: 'PicPay', color: '#11c76f', tag: 'Pp', steps: [
      'No <b>PicPay</b>, toque em <b>Cofrinhos</b> (guarda rendendo 100% do CDI, saca quando quiser).',
      'Ou entre em <b>Investimentos</b> pra ver CDBs e Tesouro.',
      'Escolha, digite o valor e confirme.'],
    tip: 'O <b>Cofrinho</b> é o jeito mais simples de começar: rende todo dia e resgata na hora.' },
  { id: 'mercadopago', name: 'Mercado Pago', color: '#00b1ea', tag: 'MP', steps: [
      'No app, toque em <b>Investimentos</b> ou <b>Fazer render</b>.',
      'Ative o <b>rendimento da conta</b> (100% do CDI) ou escolha um <b>CDB</b>.',
      'Confirme o valor.'],
    tip: 'O próprio saldo da conta já pode render 100% do CDI com liquidez diária.' },
  { id: 'itau', name: 'Itaú', color: '#ec7000', tag: 'It', steps: [
      'No app <b>Itaú</b>, vá em <b>Investimentos</b>.',
      'Escolha <b>Tesouro Direto</b> → <b>Tesouro Selic</b> (ou um <b>CDB</b> de liquidez diária).',
      'Digite o valor e confirme.'],
    tip: '' },
  { id: 'bb', name: 'Banco do Brasil', color: '#f9d616', tagDark: true, tag: 'BB', steps: [
      'No app <b>BB</b>, toque em <b>Investimentos</b>.',
      'Vá em <b>Tesouro Direto</b> → <b>Tesouro Selic</b>.',
      'Informe o valor e confirme.'],
    tip: '' },
  { id: 'bradesco', name: 'Bradesco', color: '#cc092f', tag: 'Br', steps: [
      'No app <b>Bradesco</b>, abra <b>Investimentos</b>.',
      'Escolha <b>Tesouro Direto</b> ou um <b>CDB</b> com liquidez diária.',
      'Confirme o valor.'],
    tip: '' },
  { id: 'caixa', name: 'Caixa', color: '#0070af', tag: 'CX', steps: [
      'No app <b>Caixa</b>, vá em <b>Investimentos</b>.',
      'Escolha <b>Tesouro Direto</b> → <b>Tesouro Selic</b>.',
      'Confirme o valor.'],
    tip: '' },
  { id: 'corretora', name: 'XP / Rico', color: '#0f0f0f', tag: 'XP', steps: [
      'No app da corretora, abra <b>Renda Fixa</b> ou <b>Tesouro Direto</b>.',
      'Selecione <b>Tesouro Selic</b> ou um <b>CDB 100% do CDI, liquidez diária</b>.',
      'Digite o valor e confirme.'],
    tip: 'Corretoras costumam ter a maior variedade de CDBs.' },
];
function bankChipsHTML() {
  return INVEST_BANKS.map(b => `<button type="button" class="bank-chip" data-bank="${b.id}">
    <span class="bk-ico" style="background:${b.color}${b.tagDark ? ';color:#222' : ''}">${b.tag}</span>
    <span class="bk-name">${esc(b.name)}</span></button>`).join('');
}
function renderBankSteps(id) {
  const b = INVEST_BANKS.find(x => x.id === id), el = $('#bankSteps');
  if (!b || !el) return;
  el.innerHTML = `<div class="bank-steps"><h4>📈 Passo a passo no ${esc(b.name)}</h4>
    <ol>${b.steps.map(s => `<li>${s}</li>`).join('')}</ol>
    ${b.tip ? `<p class="bank-tip">💡 ${b.tip}</p>` : ''}
    <p class="muted" style="font-size:11.5px;margin:8px 2px 0">Os menus podem mudar de nome com atualizações do app — a ideia é sempre <b>Investimentos → Tesouro Selic / CDB de liquidez diária</b>.</p></div>`;
}
// passo a passo educativo por banco (+ CTA de parceria, se configurado no config.js)
function modalComoInvestir() {
  const fc = freeCash(), bal = balance(), reserve = state.business.reserveTarget;
  const temReserva = bal >= reserve;
  const intro = temReserva
    ? `Você tem <b>${fmt(fc)}</b> de caixa livre acima da sua reserva. Dá pra começar com segurança 👇`
    : `Dica: monte primeiro sua <b>reserva de emergência</b> (você tem ${fmt(Math.max(0, bal))} de ${fmt(reserve)}). Guarde-a no mesmo lugar seguro abaixo — depois invista o resto.`;
  const p = investPartner();
  const partnerBanner = p
    ? `<a class="invest-partner-banner" href="${esc(p.url)}" target="_blank" rel="noopener nofollow sponsored">
        <span class="ipb-star">⭐</span>
        <span class="ipb-txt"><b>Recomendado — abrir conta no ${esc(p.name)}</b><small>Link de indicação · sem custo a mais pra você${p.bonus ? ' · ' + esc(p.bonus) : ''}</small></span>
        <span class="ipb-go">Abrir →</span></a>`
    : '';
  openModal('Comece a investir com segurança', `
    <p style="margin-top:0">${intro}</p>
    ${partnerBanner}
    <label style="font-weight:700;display:block;margin:4px 2px 2px">🏦 Escolha o seu banco pra ver o passo a passo</label>
    <div class="bank-scroll" id="bankScroll">${bankChipsHTML()}</div>
    <div id="bankSteps"><p class="muted" style="font-size:13px;margin:4px 2px 0">👆 Toque no seu banco acima pra ver como investir nele.</p></div>
    <div class="invest-why"><b>🛟 Comece pela reserva de emergência</b> (3–6 meses de custos), depois o resto. <b>Por que Tesouro Selic / CDB de liquidez diária?</b> São dos investimentos <b>mais seguros</b> do Brasil (o Tesouro é do governo; o CDB tem garantia do FGC até R$ 250 mil), rendem mais que a poupança e você saca quando precisar.</div>
    <p class="muted" style="font-size:11.5px;margin-bottom:0">⚠️ Conteúdo <b>educativo</b>, não é recomendação de investimento. Invista de acordo com o seu perfil e objetivos.</p>
  `, `<button class="btn btn-ghost" data-close>Fechar</button>`);
  const scroll = $('#bankScroll');
  if (scroll) scroll.querySelectorAll('[data-bank]').forEach(ch => ch.onclick = () => {
    scroll.querySelectorAll('[data-bank]').forEach(x => x.classList.remove('on'));
    ch.classList.add('on');
    renderBankSteps(ch.dataset.bank);
  });
}

function assistantReply(qRaw) {
  const q = qRaw.toLowerCase();
  const cur = monthStats(curMonthKey()), prev = monthStats(prevMonthKey());
  const has = (...k) => k.some(x => q.includes(x));
  if (has('lucro', 'ganhando', 'sobrou', 'líquido', 'liquido')) {
    const d = cur.profit - prev.profit;
    return `No mês atual você teve <b>${fmt(cur.in)}</b> de entradas e <b>${fmt(cur.out)}</b> de saídas, com lucro líquido de <b>${fmt(cur.profit)}</b> (margem de ${cur.margin.toFixed(0)}%). ${d >= 0 ? 'Está <b>melhor</b>' : 'Está <b>abaixo</b>'} do mês passado (${fmt(prev.profit)}). ${cur.margin < 25 ? 'Dica: sua margem está apertada — reveja gastos com matéria-prima e tente subir o ticket médio.' : 'Ótima margem, continue assim!'}`;
  }
  if (has('caixa', 'saldo', 'dinheiro', 'conta')) {
    return `Seu saldo em caixa hoje é <b>${fmt(balance())}</b>. Sua reserva de emergência alvo é ${fmt(state.business.reserveTarget)}, então você tem <b>${fmt(freeCash())}</b> de caixa livre. ${freeCash() > 300 ? 'Dá pra investir uma parte 😉 — veja a aba Patrimônio.' : 'Por enquanto, foco em fortalecer a reserva.'}`;
  }
  if (has('investir', 'investimento', 'aplicar', 'render')) {
    const s = investmentSuggestions();
    if (!s.list.length) return 'Ainda não há caixa livre suficiente para investir. Vamos primeiro fechar mais alguns atendimentos! 💪';
    return `Com base no seu caixa livre de <b>${fmt(s.fc)}</b>, sugiro:<ul>${s.list.map(x => `<li><b>${esc(x.title)}</b>: ${fmt(x.alloc)} — ${esc(x.ret)}</li>`).join('')}</ul>Na aba <b>Patrimônio</b> tem um <b>passo a passo</b> pra você investir com segurança (Tesouro Selic / CDB de liquidez diária) — é só clicar em "Comece a investir". 🌱`;
  }
  if (has('comprar', 'estoque', 'repor', 'acabando', 'falta', 'promo')) {
    const low = lowStock();
    if (!low.length) return 'Seu estoque está saudável ✅ Nenhum item abaixo do mínimo agora. Eu te aviso assim que algo começar a acabar.';
    const lines = low.map(it => `<li><b>${esc(it.name)}</b> (${it.qty} ${it.unit}, mín ${it.min})</li>`);
    return `Você precisa repor <b>${low.length}</b> item(ns):<ul>${lines.join('')}</ul>Eles já entraram sozinhos na sua <b>lista de compras</b> — toque no ⚠️ no topo ou vá em <b>Estoque & Compras → 🛒 Lista de compras</b>.`;
  }
  if (has('cliente', 'fiel', 'melhor cliente', 'frequente')) {
    const ranked = state.clients.map(c => ({ c, s: clientStats(c.id) })).sort((a, b) => b.s.total - a.s.total).slice(0, 3);
    return `Suas clientes que mais gastam:<ul>${ranked.map(r => `<li><b>${esc(r.c.name)}</b> — ${fmt(r.s.total)} em ${r.s.visits} visitas</li>`).join('')}</ul>Que tal um mimo de fidelidade pra elas?`;
  }
  if (has('agenda', 'hoje', 'horário', 'horario', 'atendimento')) {
    const t = todaysAppts();
    if (!t.length) return 'Você não tem atendimentos marcados para hoje. Bom momento pra divulgar um horário vago nas redes! 📣';
    return `Hoje você tem <b>${t.length}</b> atendimento(s):<ul>${t.map(a => `<li>${a.time} — ${esc(a.clientName)} (${esc(a.serviceName)}, ${fmt(a.price)})</li>`).join('')}</ul>`;
  }
  if (has('meta', 'objetivo', 'faturamento')) {
    const g = state.business.monthlyGoal;
    if (!g) return 'Você ainda não definiu sua meta de faturamento mensal. Toque em <b>Configurações do negócio</b> pra definir — aí eu acompanho seu progresso com você. 🎯';
    const pct = Math.round(cur.in / g * 100);
    return `Sua meta é faturar <b>${fmt(g)}</b>/mês. Você já está em <b>${fmt(cur.in)}</b> (${pct}%). ${pct >= 100 ? 'Meta batida! 🎉' : `Faltam ${fmt(g - cur.in)} — cerca de ${Math.ceil((g - cur.in) / 60)} atendimentos.`}`;
  }
  if (has('oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'ajuda', 'pode')) {
    return 'Oi! 💖 Sou a sua assistente BelaCaixa. Posso te dizer como está seu <b>lucro</b>, seu <b>caixa</b>, o que <b>comprar</b>, onde <b>investir</b>, suas <b>clientes</b> e sua <b>agenda</b>. É só perguntar!';
  }
  return `Entendi! 🤔 Posso te ajudar com: <b>lucro</b>, <b>caixa/saldo</b>, <b>investimentos</b>, <b>estoque/compras</b>, <b>clientes</b>, <b>agenda</b> e <b>metas</b>. Tente perguntar, por exemplo: "como está meu lucro?" ou "o que preciso comprar?".`;
}

/* ============================================================
   CHARTS (SVG próprios)
   ============================================================ */
function svgCashflow(data) {
  const W = 720, H = 240, pad = 34, bw = 18, gap = 10;
  const max = Math.max(1, ...data.map(d => Math.max(d.in, d.out)));
  const innerH = H - pad - 24;
  const step = (W - pad) / data.length;
  let bars = '', labels = '', grid = '';
  for (let g = 0; g <= 4; g++) { const y = pad + innerH - (innerH * g / 4); grid += `<line x1="${pad}" y1="${y}" x2="${W}" y2="${y}" stroke="#eee4ec"/><text x="0" y="${y + 4}" font-size="10" fill="#8c8398">${fmtK(max * g / 4)}</text>`; }
  data.forEach((d, i) => {
    const x = pad + i * step + step / 2;
    const hIn = innerH * d.in / max, hOut = innerH * d.out / max;
    const yIn = pad + innerH - hIn, yOut = pad + innerH - hOut;
    bars += `<rect x="${x - bw - gap / 2}" y="${yIn}" width="${bw}" height="${hIn}" rx="5" fill="url(#gIn)"><title>${d.label}: entradas ${fmt(d.in)}</title></rect>`;
    bars += `<rect x="${x + gap / 2}" y="${yOut}" width="${bw}" height="${hOut}" rx="5" fill="url(#gOut)"><title>${d.label}: saídas ${fmt(d.out)}</title></rect>`;
    labels += `<text x="${x}" y="${H - 6}" font-size="11" fill="#5b5168" text-anchor="middle">${d.label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2dd4a7"/><stop offset="1" stop-color="#00b389"/></linearGradient>
    <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffa1bb"/><stop offset="1" stop-color="#f0476a"/></linearGradient></defs>
    ${grid}${bars}${labels}</svg>`;
}

function svgDonut(data) {
  const COLORS = document.documentElement.dataset.theme === 'masc' ? ['#1d4ed8', '#0891b2', '#00b389', '#f59e0b', '#3b82f6', '#6366f1', '#06b6d4'] : ['#f43f8e', '#9b5de5', '#00b389', '#f59e0b', '#3b82f6', '#ec4899', '#06b6d4'];
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const R = 64, C = 2 * Math.PI * R; let off = 0; let segs = '';
  data.forEach((d, i) => {
    const frac = d.value / total; const len = frac * C;
    segs += `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"><title>${d.label}: ${fmt(d.value)} (${Math.round(frac * 100)}%)</title></circle>`;
    off += len;
  });
  const leg = data.map((d, i) => `<div><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(d.label)} · <b>${Math.round(d.value / total * 100)}%</b></div>`).join('');
  return `<div class="row" style="gap:24px;align-items:center;flex-wrap:wrap;justify-content:center">
    <svg viewBox="0 0 180 180" width="180" height="180">${segs}
      <text x="90" y="84" text-anchor="middle" font-size="12" fill="#8c8398">Saídas</text>
      <text x="90" y="104" text-anchor="middle" font-size="17" font-weight="800" fill="#241b2e" font-family="Poppins">${fmtK(total)}</text>
    </svg><div class="legend" style="flex-direction:column;gap:8px">${leg}</div></div>`;
}

function svgLine(points) {
  const W = 720, H = 220, pad = 40;
  const max = Math.max(...points.map(p => p.value)) * 1.1, min = Math.min(...points.map(p => p.value)) * 0.9;
  const innerH = H - pad - 24, innerW = W - pad - 10;
  const X = i => pad + innerW * i / (points.length - 1);
  const Y = v => pad + innerH - innerH * (v - min) / (max - min || 1);
  let grid = '';
  for (let g = 0; g <= 4; g++) { const y = pad + innerH - innerH * g / 4; grid += `<line x1="${pad}" y1="${y}" x2="${W}" y2="${y}" stroke="#eee4ec"/><text x="2" y="${y + 4}" font-size="10" fill="#8c8398">${fmtK(min + (max - min) * g / 4)}</text>`; }
  const line = points.map((p, i) => `${X(i)},${Y(p.value)}`).join(' ');
  const area = `${pad},${pad + innerH} ${line} ${X(points.length - 1)},${pad + innerH}`;
  // cor de acento segue o tema (roxo no rosé / azul no masculino) — atributos SVG não aceitam var()
  const acc = document.documentElement.dataset.theme === 'masc' ? '#1d4ed8' : '#9b5de5';
  const dots = points.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.value)}" r="4.5" fill="#fff" stroke="${acc}" stroke-width="2.5"><title>${p.label}: ${fmt(p.value)}</title></circle>`).join('');
  const labels = points.map((p, i) => `<text x="${X(i)}" y="${H - 6}" font-size="11" fill="#5b5168" text-anchor="middle">${p.label}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%"><defs><linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${acc}" stop-opacity=".28"/><stop offset="1" stop-color="${acc}" stop-opacity="0"/></linearGradient></defs>
    ${grid}<polygon points="${area}" fill="url(#gArea)"/><polyline points="${line}" fill="none" stroke="${acc}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}

function patrimonioSeries() {
  // valor acumulado de caixa (líquido por mês acumulado) + ativos, ao longo de 6 meses
  const months = last6Months();
  const at = assetsTotal();
  let running = 0; const all = [...state.transactions].sort((a, b) => a.date.localeCompare(b.date));
  return months.map(m => {
    const upto = all.filter(t => t.date.slice(0, 7) <= m.key);
    const cash = sumIn(upto) - sumOut(upto);
    return { label: m.label, value: Math.max(0, cash) + at };
  });
}

/* ============================================================
   UI HELPERS — toast / modal
   ============================================================ */
function toast(msg, type = 'info', dur = 3200, action = null) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'ok' ? 'ok' : type === 'warn' ? 'warn' : 'info');
  el.innerHTML = `<span>${type === 'ok' ? '✅' : type === 'warn' ? '⚠️' : '💡'}</span><span>${msg}</span>`;
  const kill = () => { el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); };
  if (action && action.label) {
    const btn = document.createElement('button');
    btn.className = 'toast-act'; btn.textContent = action.label;
    btn.onclick = () => { kill(); try { action.onClick(); } catch (e) {} };
    el.appendChild(btn);
  }
  $('#toastRoot').appendChild(el);
  setTimeout(kill, dur);
}
// Ícone da marca (monograma BelaCaixa) que SEGUE O TEMA (rosa/azul). Usado no lugar
// do emoji de unha 💅. Os data-fem/data-masc deixam o applyTheme trocar a cor ao vivo.
function brandIco(px) {
  px = px || 40;
  const v = { fem: 'logo-icon.png?v=20260706g', masc: 'logo-icon-masc.png?v=20260706i', pet: 'logo-icon-pet.png?v=20260708a', ink: 'logo-icon-ink.png?v=20260708c' };
  const cur = v[document.documentElement.dataset.theme] || v.fem;
  return `<img class="brand-ico" src="${cur}" data-fem="${v.fem}" data-masc="${v.masc}" data-pet="${v.pet}" data-ink="${v.ink}" alt="BelaCaixa" style="width:${px}px;height:${px}px;object-fit:contain;display:inline-block;vertical-align:middle">`;
}
function openModal(title, body, foot) {
  $('#modalRoot').innerHTML = `<div class="modal-bg" data-close-bg>
    <div class="modal"><div class="modal-head"><h3>${title}</h3><button class="modal-x" data-close>×</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div></div>`;
  hardenModalInputs($('#modalRoot'));
  $('[data-close-bg]').addEventListener('click', e => { if (e.target.matches('[data-close-bg]')) closeModal(); });
  $('[data-close]').addEventListener('click', closeModal);
}
// PRIVACIDADE ENTRE CONTAS: impede o autofill do navegador de sugerir/preencher
// nesses campos valores que o dono digitou em OUTRA conta no mesmo aparelho.
// Isso NÃO é dado do servidor (o banco isola por RLS) — é a memória de formulário
// do próprio navegador. As sugestões corretas do app usam <datalist>, que continua
// funcionando normalmente com autocomplete desligado.
function hardenModalInputs(root) {
  if (!root) return;
  root.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.type === 'password') return;             // senha/PIN cuidam do próprio autocomplete
    if (!el.hasAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
    // token aleatório + name único derrotam a heurística do Chrome que ignora "off" em campos de nome
    if (!el.getAttribute('name')) el.setAttribute('name', 'f_' + Math.random().toString(36).slice(2, 9));
    el.setAttribute('data-lpignore', 'true');       // pede pro LastPass/1Password não injetar
    el.setAttribute('data-form-type', 'other');
  });
}
function closeModal() { $('#modalRoot').innerHTML = ''; }

/* ============================================================
   VIEWS
   ============================================================ */
let currentView = 'dashboard';
const VIEWS = {};

/* ---------- DASHBOARD ---------- */
VIEWS.dashboard = {
  title: 'Painel', subtitle: 'Visão geral do seu negócio',
  html() {
    const cur = monthStats(curMonthKey()), prev = monthStats(prevMonthKey());
    const delta = (a, b) => { if (!b) return ''; const p = Math.round((a - b) / Math.abs(b) * 100); const up = p >= 0; return `<span class="kpi-delta ${up ? 'delta-up' : 'delta-down'}">${up ? '▲' : '▼'} ${Math.abs(p)}% vs mês ant.</span>`; };
    const months = last6Months().map(m => ({ label: m.label, ...monthStats(m.key) }));
    const ins = getInsights().slice(0, 4);
    const low = lowStock();
    const tod = todaysAppts();
    return `
    <div class="section-head"><div></div><button class="btn btn-primary" data-act="new-atendimento">＋ Registrar atendimento</button></div>
    <div class="grid cols-4">
      ${kpi('💵', 'Saldo em caixa', fmt(balance()), '', 'var(--grad)')}
      ${kpi('⬆️', 'Entradas (mês)', fmt(cur.in), delta(cur.in, prev.in), '#e2f8f1', '#00b389')}
      ${kpi('⬇️', 'Saídas (mês)', fmt(cur.out), delta(cur.out, prev.out), '#fde7ec', '#f0476a')}
      ${kpi('💎', 'Lucro líquido (mês)', fmt(cur.profit), delta(cur.profit, prev.profit), 'var(--tint)', 'var(--violet)')}
    </div>

    <div class="grid cols-2 mt">
      <div class="card">
        <div class="section-head"><div><h2>Fluxo de caixa</h2><span class="sh-sub">Entradas vs saídas — últimos 6 meses</span></div></div>
        ${svgCashflow(months)}
        <div class="legend"><div><i style="background:#00b389"></i>Entradas</div><div><i style="background:#f0476a"></i>Saídas</div></div>
      </div>
      <div class="card">
        <div class="section-head"><div><h2>Para onde vai o dinheiro</h2><span class="sh-sub">Saídas do mês por categoria</span></div></div>
        ${expenseByCategory(curMonthKey()).length ? svgDonut(expenseByCategory(curMonthKey())) : `<div class="empty"><span class="e-ico">🫧</span>Sem saídas registradas neste mês.</div>`}
      </div>
    </div>

    <div class="grid cols-2 mt">
      <div class="card">
        <div class="section-head"><h2>🤖 Insights inteligentes</h2></div>
        <div class="grid" style="gap:12px">${ins.map(insightCard).join('')}</div>
      </div>
      <div class="grid" style="align-content:start">
        <div class="card">
          <div class="section-head"><h2>📅 Atendimentos de hoje</h2><span class="badge b-violet">${tod.length}</span></div>
          ${tod.length ? tod.map(a => `<div class="kv"><span><b style="font-family:var(--display)">${a.time}</b> · ${esc(a.clientName)} <span class="tag-cat">${esc(a.serviceName)}</span></span><b>${fmt(a.price)}</b></div>`).join('') : `<div class="empty" style="padding:18px"><span class="e-ico">🌤️</span>Nenhum atendimento hoje.</div>`}
        </div>
        <div class="card">
          <div class="section-head"><h2>📦 Alertas de estoque</h2><span class="badge ${low.length ? 'b-amber' : 'b-green'}">${low.length || 'OK'}</span></div>
          ${low.length ? low.slice(0, 4).map(stockRow).join('') : `<div class="empty" style="padding:18px"><span class="e-ico">✅</span>Estoque saudável!</div>`}
        </div>
      </div>
    </div>`;
  }
};
function kpi(ico, label, value, delta = '', icoBg = 'var(--tint)', icoColor = 'var(--violet)') {
  const bg = icoBg; const col = icoBg.includes('grad') ? '#fff' : icoColor;
  return `<div class="kpi"><div class="kpi-ico" style="background:${bg};color:${col}">${ico}</div><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${delta}</div>`;
}
function insightCard(i) {
  return `<div class="insight tone-${i.tone}"><div class="ins-ico" style="background:${{ green: '#e2f8f1', amber: '#fef3df', violet: 'var(--tint)', blue: '#e6effd' }[i.tone]}">${i.ico}</div>
    <div style="flex:1"><h4>${esc(i.title)}</h4><p>${esc(i.text)}</p>${i.act ? `<button class="btn btn-soft btn-sm" style="margin-top:8px" data-act="${i.act}">${esc(i.actLabel)} →</button>` : ''}</div></div>`;
}
function stockRow(it) {
  const pct = clamp(it.qty / (it.min * 2) * 100, 4, 100);
  return `<div style="margin-bottom:12px"><div class="row between" style="margin-bottom:6px"><span>${esc(it.name)} <span class="muted">· ${it.qty} ${it.unit}</span></span></div><div class="bar warn"><i style="width:${pct}%"></i></div></div>`;
}

/* ---------- FINANCEIRO ---------- */
let finFilter = { range: 'all', type: 'all' };
// rótulo humano do período selecionado
function finRangeLabel(r) {
  const map = { all: 'Tudo', day: 'Hoje', week: 'Últimos 7 dias', fortnight: 'Últimos 15 dias', month: 'Este mês' };
  if (map[r]) return map[r];
  if (/^\d{4}-\d{2}$/.test(r)) return MONTHS[+r.slice(5) - 1] + '/' + r.slice(2, 4);
  return 'Tudo';
}
// um lançamento (data ISO) cai no período do filtro?
function finInRange(dateISO) {
  const r = finFilter.range;
  if (r === 'all') return true;
  const hoje = todayISO();
  if (r === 'day') return dateISO === hoje;
  if (r === 'month') return monthKey(dateISO) === curMonthKey();
  if (r === 'week' || r === 'fortnight') {
    const n = r === 'week' ? 7 : 15;
    const start = addDaysISO(hoje, -(n - 1));                 // início: N-1 dias antes de hoje
    return dateISO >= start && dateISO <= hoje;               // datas YYYY-MM-DD comparam certo como texto
  }
  if (/^\d{4}-\d{2}$/.test(r)) return monthKey(dateISO) === r;   // mês específico
  return true;
}
VIEWS.financeiro = {
  title: 'Fluxo de caixa', subtitle: 'Entradas, saídas e lucro líquido',
  html() {
    const cur = monthStats(curMonthKey());
    let list = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).filter(t => finInRange(t.date));
    if (finFilter.type !== 'all') list = list.filter(t => t.type === finFilter.type);
    const mesesEspecificos = [...new Set(state.transactions.map(t => monthKey(t.date)))].sort().reverse();
    const rl = finRangeLabel(finFilter.range);
    const fIn = sumIn(list), fOut = sumOut(list);
    return `
    <div class="section-head">
      <div class="row wrap">
        <div class="seg" id="typeSeg">
          <button data-type="all" class="${finFilter.type === 'all' ? 'on' : ''}">Tudo</button>
          <button data-type="in" class="${finFilter.type === 'in' ? 'on' : ''}">Entradas</button>
          <button data-type="out" class="${finFilter.type === 'out' ? 'on' : ''}">Saídas</button>
        </div>
        <select id="rangeSel" style="width:auto">
          <optgroup label="Período">
            <option value="all"${finFilter.range === 'all' ? ' selected' : ''}>Tudo</option>
            <option value="day"${finFilter.range === 'day' ? ' selected' : ''}>Hoje (diário)</option>
            <option value="week"${finFilter.range === 'week' ? ' selected' : ''}>Últimos 7 dias (semanal)</option>
            <option value="fortnight"${finFilter.range === 'fortnight' ? ' selected' : ''}>Últimos 15 dias (quinzenal)</option>
            <option value="month"${finFilter.range === 'month' ? ' selected' : ''}>Este mês (mensal)</option>
          </optgroup>
          ${mesesEspecificos.length ? `<optgroup label="Por mês">${mesesEspecificos.map(m => `<option value="${m}"${finFilter.range === m ? ' selected' : ''}>${MONTHS[+m.slice(5) - 1] + '/' + m.slice(2, 4)}</option>`).join('')}</optgroup>` : ''}
        </select>
      </div>
      <div class="row"><button class="btn btn-outline" data-act="new-saida">－ Saída</button><button class="btn btn-primary" data-act="new-entrada">＋ Entrada</button></div>
    </div>

    <div class="grid cols-3">
      ${kpi('⬆️', 'Entradas · ' + rl, fmt(fIn), '', '#e2f8f1', '#00b389')}
      ${kpi('⬇️', 'Saídas · ' + rl, fmt(fOut), '', '#fde7ec', '#f0476a')}
      ${kpi('💎', 'Resultado · ' + rl, fmt(fIn - fOut), `<span class="kpi-delta ${fIn - fOut >= 0 ? 'delta-up' : 'delta-down'}">margem ${fIn ? Math.round((fIn - fOut) / fIn * 100) : 0}%</span>`, 'var(--tint)', 'var(--violet)')}
    </div>

    <div class="card mt">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Cliente</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${list.length ? list.map(txRow).join('') : `<tr><td colspan="6"><div class="empty"><span class="e-ico">🧾</span>Nenhum lançamento neste filtro.</div></td></tr>`}</tbody>
      </table></div>
    </div>`;
  },
  init() {
    $$('#typeSeg button').forEach(b => b.onclick = () => { finFilter.type = b.dataset.type; render(); });
    $('#rangeSel').onchange = e => { finFilter.range = e.target.value; render(); };
  }
};
function txRow(t) {
  const cli = t.clientId ? state.clients.find(c => c.id === t.clientId) : null;
  const payTag = t.pay ? `<span class="pay-ic" title="${PAY_LABEL[t.pay] || ''}">${payIcon(t.pay)}</span>` : '';
  const feeTag = t.feeAdded ? ` <span class="muted" style="font-size:11px">(+${t.feePct}% maq.)</span>` : '';
  return `<tr><td class="muted">${fmtDateFull(t.date)}</td><td>${payTag}${esc(t.desc)}${feeTag}</td><td><span class="tag-cat">${esc(t.category)}</span></td><td>${cli ? esc(cli.name.split(' ')[0]) : '—'}</td>
    <td class="num ${t.type === 'in' ? 't-in' : 't-out'}">${t.type === 'in' ? '+' : '−'} ${fmt(t.amount)}</td>
    <td class="num" style="white-space:nowrap"><button class="modal-x" data-act="edit-tx" data-id="${t.id}" title="Editar lançamento">✏️</button><button class="modal-x" data-act="del-tx" data-id="${t.id}" title="Excluir">🗑️</button></td></tr>`;
}

/* ---------- CLIENTES ---------- */
VIEWS.clientes = {
  title: 'Clientes', subtitle: 'Cadastro automático e histórico',
  html() {
    const rows = state.clients.map(c => ({ c, s: clientStats(c.id) })).sort((a, b) => b.s.total - a.s.total);
    const total = state.clients.length;
    const recorrentes = rows.filter(r => r.s.visits >= 3).length;
    const ticket = rows.length ? rows.reduce((a, r) => a + r.s.total, 0) / Math.max(1, rows.reduce((a, r) => a + r.s.visits, 0)) : 0;
    return `
    <div class="section-head"><div class="grid cols-3" style="flex:1;max-width:560px">
      ${miniStat('👥', 'Clientes', total)}
      ${miniStat('💖', 'Recorrentes', recorrentes)}
      ${miniStat('🎟️', 'Ticket médio', fmt(ticket))}
    </div><button class="btn btn-primary" data-act="new-cliente">＋ Novo cliente</button></div>

    <div class="card mt">
      <p class="muted" style="margin-bottom:14px">💡 Toda vez que você registra um atendimento com um nome novo, a cliente é <b>cadastrada automaticamente</b> aqui.</p>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Cliente</th><th>Telefone</th><th class="num">Visitas</th><th class="num">Total gasto</th><th>Última visita</th><th></th></tr></thead>
        <tbody>${rows.map(({ c, s }) => `<tr>
          <td><div class="row" style="gap:10px"><span class="cli-av" style="background:${avColor(c.name)}">${initials(c.name)}</span><b>${esc(c.name)}</b>${s.visits >= 3 ? '<span class="badge b-violet">fiel</span>' : ''}</div></td>
          <td class="muted">${esc(c.phone || '—')}</td>
          <td class="num">${s.visits}</td><td class="num">${fmt(s.total)}</td>
          <td class="muted">${s.last ? fmtDateFull(s.last) : '—'}</td>
          <td class="num" style="white-space:nowrap"><button class="modal-x" data-act="edit-cliente" data-id="${c.id}" title="Editar cliente">✏️</button><button class="modal-x" data-act="del-cliente" data-id="${c.id}" title="Excluir">🗑️</button></td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }
};
function miniStat(ico, label, val) { return `<div class="kpi" style="padding:14px"><div class="row" style="gap:10px"><span style="font-size:20px">${ico}</span><div><div class="kpi-label" style="margin:0">${label}</div><div class="kpi-value" style="font-size:20px">${val}</div></div></div></div>`; }

/* ---------- AGENDA ---------- */
VIEWS.agenda = {
  title: 'Agenda', subtitle: 'Atendimentos — ao concluir, entra no caixa',
  html() {
    const up = upcomingAppts();
    const byDate = {};
    up.forEach(a => (byDate[a.date] = byDate[a.date] || []).push(a));
    const concluded = state.appointments.filter(a => a.status === 'concluido').length;
    const nextSlot = suggestSlot();
    // aviso do SILVER: agendamento automático liberado só no 1º mês, contando os dias
    const sa = silverAgendaInfo();
    let silverBanner = '';
    if (sa && sa.active) {
      silverBanner = `<div class="venc-bar tone-amber" style="margin-bottom:12px"><span>📅 <b>Agendamento automático liberado no seu SILVER</b> — dia ${sa.dayNum} de ${SILVER_AGENDA_DAYS}${sa.daysLeft > 0 ? ` · faltam ${sa.daysLeft} dia(s); depois disso, só no GOLD.` : ` · é o último dia! Depois, só no GOLD.`}</span><button class="btn btn-soft btn-sm" data-act="go-gold" style="margin-left:auto">Virar GOLD</button></div>`;
    } else if (silverActive()) {
      silverBanner = `<div class="venc-bar tone-amber" style="margin-bottom:12px"><span>🔒 <b>Seu mês de agendamento automático no SILVER terminou.</b> Pra continuar recebendo agendamentos pelo WhatsApp, mude para o GOLD.</span><button class="btn btn-soft btn-sm" data-act="go-gold" style="margin-left:auto">Virar GOLD</button></div>`;
    }
    return `
    ${silverBanner}
    <div class="section-head">
      <div class="grid cols-3" style="flex:1;max-width:560px">
        ${miniStat('📅', 'Agendados', up.length)}
        ${miniStat('✅', 'Concluídos', concluded)}
        ${miniStat('⏰', 'Próximo horário livre', nextSlot.label)}
      </div>
      <div class="row" style="gap:8px">
        <button class="btn btn-outline" data-act="link-agenda">${autoAgendaOk() ? '🔗' : '🔒'} Link de agendamento</button>
        <button class="btn btn-primary" data-act="new-agenda">＋ Agendar</button>
      </div>
    </div>

    <div class="insight tone-violet mt" style="max-width:none"><div class="ins-ico" style="background:var(--tint)">🤖</div>
      <div><h4>Sugestão automática de horário</h4><p>O próximo encaixe livre é <b>${nextSlot.full}</b>. Quer agendar agora?</p>
      <button class="btn btn-soft btn-sm" style="margin-top:8px" data-act="new-agenda">Usar este horário →</button></div></div>

    ${Object.keys(byDate).length ? Object.entries(byDate).map(([date, list]) => `
      <div class="card mt">
        <div class="section-head"><h2>${date === todayISO() ? '🔆 Hoje' : dayName(date) + ', ' + fmtDateFull(date)}</h2><span class="muted">${list.length} atend.</span></div>
        ${list.sort((a, b) => a.time.localeCompare(b.time)).map(apptRow).join('')}
      </div>`).join('') : `<div class="card mt"><div class="empty"><span class="e-ico">📭</span>Nenhum atendimento agendado. Que tal divulgar seus horários?</div></div>`}`;
  },
  init() {
    // agendamento automático é do GOLD: sem ele, o convite aparece toda vez que a agenda abre
    if (!autoAgendaOk()) modalGoldAgenda();
  }
};
function waPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11 && !d.startsWith('55')) d = '55' + d;   // adiciona DDI do Brasil
  return d;
}
function waLink(phone, text) {
  return 'https://wa.me/' + waPhone(phone) + '?text=' + encodeURIComponent(text);
}
function apptRow(a) {
  const cli = (state.clients || []).find(c => c.id === a.clientId);
  const phone = (cli && cli.phone) ? cli.phone : (a.phone || '');
  const first = (a.clientName || '').split(' ')[0];
  const biz = (state.business && state.business.name) || 'nosso espaço';
  const dataBR = a.date.split('-').reverse().join('/');
  // pedido feito pelo link público, ainda aguardando você aceitar (horário já travado pras outras)
  if (a.pending && a.source === 'link') {
    return `<div class="row between appt-row" style="padding:12px;border-bottom:1px dashed var(--line);background:#faf6ff;border-radius:12px;margin-bottom:6px">
      <div class="row" style="gap:12px"><span class="cli-av" style="background:${avColor(a.clientName)}">${initials(a.clientName)}</span>
        <div><b>${a.time}</b> · ${esc(a.clientName)} <span class="tag-cat" style="background:var(--tint);color:#7c3aed">⏳ pedido pelo link</span><div class="muted" style="font-size:13px">${esc(a.serviceName)} · ${fmt(a.price)}${a.phone ? ' · 📞 ' + esc(a.phone) : ''}</div></div></div>
      <div class="row appt-acts">
        <button class="btn btn-sm btn-primary" data-act="accept-appt" data-id="${a.id}">✅ Aceitar</button>
        <button class="modal-x" data-act="cancel-appt" data-id="${a.id}" title="Recusar">×</button>
      </div></div>`;
  }
  const msgConfirmar = `Oi ${first}! ✨ Passando pra confirmar seu horário na ${biz}: ${a.serviceName} no dia ${dataBR} às ${a.time}. Posso confirmar? 😊`;
  const msgLembrar = `Oi ${first}! 💜 Lembrete do seu horário na ${biz}: ${a.serviceName} dia ${dataBR} às ${a.time}. Te espero! ✨`;
  const noTel = phone ? '' : ' title="Cliente sem telefone — o WhatsApp vai abrir pra você escolher o contato"';
  return `<div class="row between appt-row" style="padding:12px 0;border-bottom:1px dashed var(--line)">
    <div class="row" style="gap:12px"><span class="cli-av" style="background:${avColor(a.clientName)}">${initials(a.clientName)}</span>
      <div><b>${a.time}</b> · ${esc(a.clientName)}${phone ? '' : ' <span class="tag-cat" style="background:#fff1dc;color:#b9770f">sem tel.</span>'}<div class="muted" style="font-size:13px">${esc(a.serviceName)} · ${fmt(a.price)}</div></div></div>
    <div class="row appt-acts">
      <a class="btn btn-sm btn-wa" href="${waLink(phone, msgConfirmar)}" target="_blank" rel="noopener"${noTel}>✅ Confirmar</a>
      <a class="btn btn-sm btn-wa-soft" href="${waLink(phone, msgLembrar)}" target="_blank" rel="noopener"${noTel}>🔔 Lembrar</a>
      <button class="btn btn-soft btn-sm" data-act="edit-appt" data-id="${a.id}" title="Remarcar horário">✏️</button>
      <button class="btn btn-soft btn-sm" data-act="done-appt" data-id="${a.id}">✓ Concluir</button>
      <button class="modal-x" data-act="cancel-appt" data-id="${a.id}" title="Cancelar">×</button>
    </div></div>`;
}
function suggestSlot() {
  const h = bizHours();
  const open = hhmmToMin(h.open), close = hhmmToMin(h.close), step = h.slot || 30;
  const base = todayISO();
  for (let off = 0; off < 14; off++) {
    const iso = addDaysISO(base, off);
    const dow = new Date(iso + 'T12:00:00Z').getUTCDay();            // dia da semana da data (sem viés de fuso)
    if (!h.days.includes(dow)) continue;                              // pula dia sem atendimento
    const nowM = off === 0 ? hhmmToMin(nowHHMM()) : -1;
    const taken = state.appointments.filter(a => a.date === iso && a.status === 'agendado').map(a => hhmmToMin(a.time));
    for (let t = open; t + 60 <= close; t += step) {
      if (taken.includes(t) || t <= nowM) continue;
      if (inLunch(iso, t, 60)) continue;                                // pula o horário de almoço
      const s = minToHHMM(t);
      return { iso, time: s, label: (off === 0 ? 'Hoje ' : dayName(iso) + ' ') + s, full: (off === 0 ? 'hoje' : dayName(iso) + ' (' + fmtDate(iso) + ')') + ' às ' + s };
    }
  }
  return { iso: todayISO(), time: h.open, label: '—', full: 'em breve às ' + h.open };
}

/* ---------- ESTOQUE & COMPRAS ---------- */
VIEWS.estoque = {
  title: 'Estoque & Compras', subtitle: 'Alertas de reposição e lista de compras automática',
  html() {
    const low = lowStock();
    const inv = [...state.inventory].sort((a, b) => daysToDeplete(a) - daysToDeplete(b));
    return `
    <div class="section-head"><div class="grid cols-3" style="flex:1;max-width:600px">
      ${miniStat('📦', 'Itens', state.inventory.length)}
      ${miniStat('⚠️', 'Precisam repor', low.length)}
      ${miniStat('🛒', 'Na lista de compras', (state.shoppingList || []).length)}
    </div><div class="row"><button class="btn btn-outline" data-act="new-item">＋ Item</button><button class="btn btn-primary" data-act="gerar-pedido">🛒 Lista de compras</button></div></div>

    ${low.length ? `<div class="insight tone-amber mt" style="max-width:none"><div class="ins-ico" style="background:#fef3df">🛒</div>
      <div style="flex:1">
        <div class="row between" style="align-items:baseline"><h4>Repor ${low.length} item(ns)</h4><b style="font-family:var(--display);color:var(--violet)">${fmt(pedidoTotal())}</b></div>
        <p>Estão no/abaixo do mínimo e <b>já entraram sozinhos</b> na sua lista de compras. Clique num item pra repor, ou abra a lista.</p>
        <div class="repor-chips">${low.map(it => `<button class="repor-chip ${it.qty <= 0 ? 'is-zero' : ''}" data-act="repor-item" data-id="${it.id}" title="Repor ${esc(it.name)}">${it.qty <= 0 ? '🚨' : '📦'} ${esc(it.name)} · <b>${it.qty}</b>/${it.min} ${esc(it.unit)}</button>`).join('')}</div>
        <button class="btn btn-primary btn-sm" style="margin-top:12px" data-act="gerar-pedido">🛒 Ver lista de compras (~${fmt(pedidoTotal())}) →</button>
      </div></div>` : ''}

    <div class="card mt">
      <div class="section-head"><h2>📦 Meu estoque</h2></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="num">Qtd</th><th>Status</th><th class="num">Dura ~</th><th></th></tr></thead>
      <tbody>${inv.map(it => {
      const d = daysToDeplete(it); const st = it.qty <= it.min ? ['b-red', 'Repor'] : it.qty <= it.min * 1.4 ? ['b-amber', 'Atenção'] : ['b-green', 'OK'];
      return `<tr><td><b>${esc(it.name)}</b><div class="muted" style="font-size:12.5px">${esc(it.category)} · ${esc(it.supplier)}</div></td>
        <td class="num">${it.qty} ${it.unit}</td><td><span class="badge ${st[0]}">${st[1]}</span></td>
        <td class="num">${d > 60 ? '60+' : d} d</td>
        <td class="num"><div class="row" style="gap:6px;justify-content:flex-end">
          <button class="btn btn-soft btn-sm" data-act="repor-item" data-id="${it.id}">Repor</button>
          <button class="ib ib-edit ib-sm" data-act="edit-item" data-id="${it.id}" title="Editar item">✏️</button>
          <button class="ib ib-ghost ib-sm" data-act="del-item" data-id="${it.id}" title="Excluir item">🗑️</button>
        </div></td></tr>`;
    }).join('')}</tbody></table></div>
    </div>`;
  }
};

/* ---------- PATRIMÔNIO ---------- */
VIEWS.patrimonio = {
  title: 'Patrimônio', subtitle: 'Bens, crescimento e onde investir',
  html() {
    const inv = investmentSuggestions();
    const series = patrimonioSeries();
    const growth = series.length > 1 ? Math.round((series.at(-1).value - series[0].value) / (series[0].value || 1) * 100) : 0;
    return `
    <div class="grid cols-4">
      ${kpi('🏛️', 'Patrimônio total', fmt(patrimonioTotal()), `<span class="kpi-delta ${growth >= 0 ? 'delta-up' : 'delta-down'}">${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)}% em 6m</span>`, 'var(--grad)')}
      ${kpi('📈', 'Investimentos', fmt(investTotal()), '', '#e6effd', '#3b82f6')}
      ${kpi('🪑', 'Bens & equipamentos', fmt(assetsTotal()), '', 'var(--tint)', 'var(--violet)')}
      ${kpi('💵', 'Em caixa', fmt(Math.max(0, balance())), '', '#e2f8f1', '#00b389')}
    </div>

    <div class="grid cols-2 mt">
      <div class="card"><div class="section-head"><div><h2>Evolução do patrimônio</h2><span class="sh-sub">Caixa + bens nos últimos 6 meses</span></div></div>${svgLine(series)}</div>
      <div class="card">
        <div class="section-head"><div><h2>🤖 Sugestões de investimento</h2><span class="sh-sub">Com base no seu caixa livre de ${fmt(inv.fc)}</span></div></div>
        ${inv.list.length ? inv.list.map(s => `<div class="insight tone-${s.tone}" style="margin-bottom:10px"><div class="ins-ico" style="background:${{ green: '#e2f8f1', amber: '#fef3df', violet: 'var(--tint)', blue: '#e6effd' }[s.tone]}">${s.ico}</div>
          <div style="flex:1"><div class="row between"><h4>${esc(s.title)}</h4><b style="font-family:var(--display);color:var(--violet)">${fmt(s.alloc)}</b></div><p>${esc(s.detail)}</p><span class="badge b-green" style="margin-top:6px">Retorno: ${esc(s.ret)}</span></div></div>`).join('') : `<div class="empty"><span class="e-ico">🌱</span>Fortaleça o caixa para liberar sugestões de investimento.</div>`}
      </div>
    </div>

    <div class="card mt invest-card">
      <div class="section-head"><div><h2>🌱 Comece a investir com segurança</h2><span class="sh-sub">Passo a passo simples pra fazer seu caixa livre render</span></div></div>
      <div class="row between wrap" style="gap:14px;align-items:center">
        <p style="flex:1;min-width:220px;margin:0;color:var(--ink-2)">Reserva de emergência primeiro, depois <b>Tesouro Selic</b> ou <b>CDB de liquidez diária</b> — seguros, rendem mais que a poupança e você saca quando quiser. Te mostro o caminho em 3 passos.</p>
        <button class="btn btn-primary" data-act="como-investir">Ver o passo a passo →</button>
      </div>
    </div>

    <div class="card mt">
      <div class="section-head">
        <div><h2>📈 Meus investimentos</h2><span class="sh-sub">Registre quanto você já aplicou e atualize o valor todo mês</span></div>
        <button class="btn btn-outline btn-sm" data-act="new-invest">＋ Registrar investimento</button>
      </div>
      ${(state.investments && state.investments.length) ? `
      <div class="insight tone-green" style="max-width:none;margin-bottom:12px"><div class="ins-ico" style="background:#e2f8f1">📈</div>
        <div style="flex:1"><div class="row between" style="align-items:baseline"><h4>Renda passiva estimada</h4><b style="font-family:var(--display);color:#00b389">${fmt(investMonthlyTotal())}/mês</b></div>
        <p>Seus investimentos rendem cerca de <b>${fmt(investMonthlyTotal())}/mês</b> (≈ ${fmt(investMonthlyTotal() * 12)}/ano) na taxa que você definiu — o valor cresce sozinho no patrimônio. Quando você <b>sacar</b> de verdade, toque em 💵 pra lançar a entrada no caixa.</p></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Investimento</th><th>Onde / tipo</th><th>Atualizado</th><th class="num">Valor atual</th><th></th></tr></thead>
      <tbody>${state.investments.map(v => `<tr>
        <td><b>${esc(v.name)}</b><br><span class="muted" style="font-size:12px">rende ≈ ${fmt(investMonthly(v))}/mês · ${investRate(v).toLocaleString('pt-BR')}% a.a.</span></td>
        <td>${v.place ? `<span class="tag-cat">${esc(v.place)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="muted">${fmtDateFull(v.updatedAt)}${investStale(v.updatedAt) ? ' <span class="badge b-amber" title="Atualize o valor deste mês">atualize</span>' : ''}</td>
        <td class="num"><b>${fmt(+v.value || 0)}</b></td>
        <td class="num" style="white-space:nowrap"><button class="modal-x" data-act="edit-invest" data-id="${v.id}" title="Atualizar valor">✏️</button> <button class="modal-x" data-act="resgatar-invest" data-id="${v.id}" title="Resgatar / receber rendimento no caixa">💵</button> <button class="modal-x" data-act="del-invest" data-id="${v.id}" title="Remover">🗑️</button></td>
      </tr>`).join('')}
      <tr><td colspan="3" class="num" style="font-weight:700">Total investido</td><td class="num" style="font-weight:800;color:var(--violet)">${fmt(investTotal())}</td><td></td></tr>
      </tbody></table></div>` : `<div class="empty"><span class="e-ico">🌱</span>Nenhum investimento registrado ainda. Toque em <b>Registrar investimento</b> pra lançar o valor que você já aplicou (Tesouro, CDB…) e atualize todo mês pra ver seu patrimônio crescer.</div>`}
    </div>

    <div class="card mt">
      <div class="section-head"><h2>🪑 Bens do negócio</h2><button class="btn btn-outline btn-sm" data-act="new-asset">＋ Adicionar bem</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bem</th><th>Categoria</th><th>Adquirido em</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${state.assets.map(a => `<tr><td><b>${esc(a.name)}</b></td><td><span class="tag-cat">${esc(a.category)}</span></td><td class="muted">${fmtDateFull(a.acquiredAt)}</td><td class="num">${fmt(a.value)}</td><td class="num"><button class="modal-x" data-act="del-asset" data-id="${a.id}">🗑️</button></td></tr>`).join('')}</tbody></table></div>
    </div>`;
  }
};

/* ---------- ASSISTENTE ---------- */
VIEWS.assistente = {
  title: 'Assistente IA', subtitle: 'Pergunte sobre seu negócio em português',
  html() {
    if (!state.chat.length) state.chat.push({ role: 'bot', text: assistantReply('oi') });
    const sugg = ['Como está meu lucro?', 'Quanto tenho em caixa?', 'Posso investir?', 'O que preciso comprar?', 'Quais minhas melhores clientes?', 'Tenho atendimentos hoje?'];
    return `<div class="card chat">
      <div class="chat-log" id="chatLog">${state.chat.map(m => `<div class="msg ${m.role === 'bot' ? 'bot' : 'me'}">${m.text}</div>`).join('')}</div>
      <div class="chat-suggest">${sugg.map(s => `<button class="chip" data-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div class="chat-input"><input class="input" id="chatInput" placeholder="Pergunte algo… ex.: como está meu lucro?" autocomplete="off"/><button class="btn btn-primary" id="chatSend">Enviar</button></div>
    </div>`;
  },
  init() {
    const log = $('#chatLog'); log.scrollTop = log.scrollHeight;
    const send = () => {
      const inp = $('#chatInput'); const q = inp.value.trim(); if (!q) return;
      state.chat.push({ role: 'me', text: esc(q) });
      state.chat.push({ role: 'bot', text: assistantReply(q) });
      save(); render(); setTimeout(() => { const l = $('#chatLog'); l.scrollTop = l.scrollHeight; }, 30);
    };
    $('#chatSend').onclick = send;
    $('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    $('#chatInput').focus();
    $$('[data-ask]').forEach(b => b.onclick = () => { $('#chatInput').value = b.dataset.ask; send(); });
  }
};

/* ---------- SERVIÇOS ---------- */
function svcMatsHTML(s) {
  const rows = (s.mat || []).map(([id, q]) => {
    const it = (state.inventory || []).find(i => i.id === id);
    if (!it) return '';
    const unit = it.unit ? ' ' + esc(it.unit) : '';
    return `<div class="svc-mat"><span class="svc-mat-name">${esc(it.name)}</span><span class="svc-mat-qty">${q}${unit}</span></div>`;
  }).filter(Boolean).join('');
  return rows
    ? `<div class="svc-recipe"><div class="svc-recipe-head">📦 Baixa no estoque</div>${rows}</div>`
    : '<div class="svc-recipe"><div class="svc-mat svc-mat-none">Sem baixa de estoque</div></div>';
}
VIEWS.servicos = {
  title: 'Catálogo de serviços', subtitle: 'Cadastre seus serviços e ajuste os preços quando quiser',
  html() {
    const list = state.services || [];
    const cards = list.map(s => `
      <div class="svc-card">
        <div class="svc-top">
          <div class="svc-info">
            <div class="svc-name">${esc(s.name)}</div>
            <div class="svc-meta">${s.dur ? `⏱️ ${s.dur} min` : 'Sem duração definida'}</div>
          </div>
          <div class="svc-price">${fmt(s.price)}</div>
          <div class="svc-actions">
            <button class="ib ib-edit" data-act="edit-servico" data-id="${s.id}" title="Editar serviço">✏️</button>
            <button class="ib ib-ghost" data-act="del-servico" data-id="${s.id}" title="Excluir serviço">🗑️</button>
          </div>
        </div>
        ${svcMatsHTML(s)}
      </div>`).join('');
    return `
      <div class="section-head">
        <div><h2>Seus serviços</h2><span class="sh-sub">${list.length} serviço(s) cadastrado(s)</span></div>
        <button class="btn btn-primary" data-act="new-servico">＋ Adicionar serviço</button>
      </div>
      <div class="svc-list">${cards || `<div class="empty"><span class="e-ico">${brandIco(46)}</span>Nenhum serviço ainda. Clique em “Adicionar serviço” pra começar.</div>`}</div>`;
  }
};

/* ---------- ADMIN (administrador) ---------- */
VIEWS.admin = {
  title: '🛡️ Administrador', subtitle: 'Área exclusiva do administrador — visão geral de todos os clientes',
  html() {
    return `<div id="adminRoot"><div class="empty"><span class="e-ico">⏳</span>Carregando dados do sistema…</div></div>`;
  },
  init() { loadAdminStats(); }
};
const PLAN_LABEL = { silver_mensal: 'Silver mensal', silver_anual: 'Silver anual', gold_mensal: 'Gold mensal', gold_anual: 'Gold anual' };
const PLAN_OPTS = ['silver_mensal', 'silver_anual', 'gold_mensal', 'gold_anual'];
function planChipAdm(plan) {
  if (!plan || plan === '—') return '<span class="pchip pchip-none">Sem plano</span>';
  const tier = String(plan).split('_')[0];
  return `<span class="pchip pchip-${tier}">${PLAN_LABEL[plan] || esc(plan)}</span>`;
}
function vencChip(c) {
  if (!c.current_period_end) return '';
  const end = new Date(c.current_period_end);
  const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
  return `<span class="pipe-venc ${days <= 5 ? 'venc-soon' : ''}">⏳ ${days > 0 ? days + 'd' : 'vencido'} · ${end.toLocaleDateString('pt-BR')}</span>`;
}
function statusDot(c) {
  const s = c.active ? 'on' : (c.status === 'canceled' ? 'off' : 'idle');
  return `<span class="sdot sdot-${s}"></span>`;
}
function pipeCard(c, kind) {
  const nome = esc(c.business_name || c.email || '—');
  const da = `data-uid="${esc(c.user_id || '')}" data-email="${esc(c.email || '')}" data-plan="${esc(c.plan || '')}" data-nome="${nome}"`;
  const ib = (act, cls, ico, title) => `<button class="ib ${cls}" data-cli-action="${act}" ${da} title="${title}" aria-label="${title}">${ico}</button>`;
  let actions;
  if (kind === 'active') {
    actions = ib('edit', 'ib-edit', '✏️', 'Editar plano/validade') + ib('revoke', 'ib-danger', '🚫', 'Revogar acesso');
  } else if (kind === 'inactive') {
    // inativo (inclui teste expirado): liberar, editar, REVOGAR (corta e mantém cortado)
    // ou EXCLUIR o cliente por completo (some do pipeline)
    actions = ib('activate', 'ib-ok', '✅', 'Liberar acesso') + ib('edit', 'ib-edit', '✏️', 'Editar') + ib('revoke', 'ib-ghost', '🚫', 'Revogar acesso') + ib('purge', 'ib-danger', '🗑️', 'Excluir cliente (apaga conta e dados)');
  } else {
    // em teste (24h): agora também dá pra REVOGAR o acesso na hora (corta o teste)
    const canDel = c.status && c.status !== 'sem assinatura';
    actions = ib('activate', 'ib-ok', '✅', 'Liberar acesso') + ib('edit', 'ib-edit', '✏️', 'Editar') + ib('revoke', 'ib-danger', '🚫', 'Revogar acesso (corta o teste)') + (canDel ? ib('delete', 'ib-ghost', '🗑️', 'Excluir assinatura') : '');
  }
  return `<div class="pipe-card">
    <div class="pipe-card-top"><b>${nome}</b>${statusDot(c)}</div>
    <div class="pipe-card-mail">${esc(c.email || '')}</div>
    <div class="pipe-card-meta">${planChipAdm(c.plan)} ${vencChip(c)}</div>
    <div class="pipe-actions">${actions}</div>
  </div>`;
}
function pixCard(p) {
  return `<div class="pipe-card pipe-card-pix">
    <div class="pipe-card-top"><b>${esc(p.business_name || '—')}</b><span class="tkt">${esc(p.ticket_code || '')}</span></div>
    <div class="pipe-card-mail">${esc(p.email || '')}</div>
    <div class="pipe-card-meta">${planChipAdm(p.plan)} <span class="pipe-venc">${p.amount_cents != null ? fmt(p.amount_cents / 100) : ''} · ${new Date(p.created_at).toLocaleDateString('pt-BR')}</span></div>
    <div class="pipe-actions">
      <button class="ib ib-ok" data-pix-approve="${esc(p.id)}" title="Liberar acesso (comprovante conferido)">✓</button>
      <button class="ib ib-danger" data-pix-reject="${esc(p.id)}" title="Recusar ticket">✕</button>
    </div>
  </div>`;
}
function pipeCol(icon, title, cls, cards, emptyMsg) {
  return `<div class="pipe-col ${cls}">
    <div class="pipe-col-head"><span class="pipe-col-ic">${icon}</span><span class="pipe-col-t">${title}</span><span class="pipe-col-n">${cards.length}</span></div>
    <div class="pipe-col-body">${cards.length ? cards.join('') : `<div class="pipe-empty">${emptyMsg}</div>`}</div>
  </div>`;
}
function adminHTML(d) {
  const planos = Object.entries(d.byPlan || {}).map(([k, n]) => `${PLAN_LABEL[k] || k}: <b>${n}</b>`).join(' · ') || '—';
  const clients = d.clients || [];
  const pend = d.pixPending || [];
  const trial = clients.filter(c => c.stage === 'trial');
  const active = clients.filter(c => c.stage === 'active');
  const inactive = clients.filter(c => c.stage === 'inactive');
  const inactiveUids = inactive.map(c => c.user_id).filter(Boolean);
  const clearBtn = inactiveUids.length
    ? `<button class="btn btn-danger btn-sm" data-act="clear-inactive" data-uids='${esc(JSON.stringify(inactiveUids))}'>🧹 Limpar inativos (${inactiveUids.length})</button>`
    : '';
  const board = `
    <div class="pipe">
      ${pipeCol('🎟️', 'Pix a validar', 'col-pix', pend.map(pixCard), 'Nenhum Pix aguardando')}
      ${pipeCol('🎁', 'Em teste (24h)', 'col-trial', trial.map(c => pipeCard(c, 'trial')), 'Ninguém em teste')}
      ${pipeCol('✅', 'Ativos', 'col-active', active.map(c => pipeCard(c, 'active')), 'Nenhum ativo ainda')}
      ${pipeCol('⛔', 'Inativos', 'col-inactive', inactive.map(c => pipeCard(c, 'inactive')), 'Ninguém inativo')}
    </div>`;
  return `
    <div class="grid cols-4">
      ${kpi('👥', 'Usuários cadastrados', d.totalUsers, '', 'linear-gradient(135deg,#3b82f6,#06b6d4)')}
      ${kpi('✅', 'Assinaturas ativas', d.activeCount, '', '#e2f8f1', '#00b389')}
      ${kpi('💳', 'Cartão · 📲 Pix', d.cardCount + ' · ' + d.pixCount, '', 'var(--tint)', 'var(--violet)')}
      ${kpi('💰', 'Receita mensal (MRR)', fmt(d.mrr), `<span class="kpi-delta">≈ ${fmt(d.arr)}/ano</span>`, 'var(--grad)')}
    </div>
    <div class="card mt">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div><b>Distribuição por plano:</b> ${planos}</div>
        <div class="row" style="gap:8px;flex-wrap:wrap">${clearBtn}<button class="btn btn-soft btn-sm" data-act="admin-refresh">🔄 Atualizar</button></div>
      </div>
    </div>
    <div class="pipe-head"><h3 class="pipe-title">📊 Pipeline de clientes</h3>
      <span class="pipe-legend">✓ liberar Pix · ✅ ativar · ✏️ editar · 🚫 revogar · 🗑️ excluir</span></div>
    ${board}
    <p class="adm-foot">💡 Pix só libera depois que você confere o comprovante no WhatsApp e clica em <b>✓</b>. Cartão libera sozinho. Atualizado em ${new Date(d.generatedAt).toLocaleString('pt-BR')}.</p>`;
}
async function loadAdminStats() {
  const root = $('#adminRoot'); if (!root) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(window.BELACAIXA_CFG.url + '/functions/v1/admin-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token, apikey: window.BELACAIXA_CFG.anon },
      body: JSON.stringify({})
    });
    const j = await res.json();
    if (!res.ok) { root.innerHTML = `<div class="empty"><span class="e-ico">🔒</span>${esc(j.error || 'Sem acesso a esta área.')}</div>`; return; }
    root.innerHTML = adminHTML(j);
    const rb = root.querySelector('[data-act="admin-refresh"]');
    if (rb) rb.onclick = () => { root.innerHTML = '<div class="empty"><span class="e-ico">⏳</span>Atualizando…</div>'; loadAdminStats(); };
    const cb = root.querySelector('[data-act="clear-inactive"]');
    if (cb) cb.onclick = () => bulkPurgeInactive(cb.dataset.uids);
    root.querySelectorAll('[data-pix-approve]').forEach(b => b.onclick = () => { b.disabled = true; b.textContent = '…'; approvePix(b.dataset.pixApprove, 'approve'); });
    root.querySelectorAll('[data-pix-reject]').forEach(b => b.onclick = () => { if (confirm('Recusar este ticket de Pix? O cliente não terá acesso.')) { b.disabled = true; approvePix(b.dataset.pixReject, 'reject'); } });
    root.querySelectorAll('[data-cli-action]').forEach(b => b.onclick = () => {
      const uid = b.dataset.uid, email = b.dataset.email, plan = b.dataset.plan, nome = b.dataset.nome, act = b.dataset.cliAction;
      if (act === 'revoke') { if (confirm('Revogar o acesso de ' + (nome || email) + '? Ele perde o acesso na hora.')) adminAction(uid, 'revoke'); }
      else if (act === 'delete') { if (confirm('Excluir a assinatura de ' + (nome || email) + '? (a conta continua, só zera a assinatura)')) adminAction(uid, 'delete'); }
      else if (act === 'purge') { if (confirm('EXCLUIR DEFINITIVAMENTE ' + (nome || email) + '?\n\nIsso apaga a CONTA, os DADOS e a assinatura. O cliente some do pipeline e NÃO dá pra desfazer.')) adminAction(uid, 'purge'); }
      else modalEditClient(uid, email, plan, nome, act);
    });
  } catch (e) {
    root.innerHTML = '<div class="empty"><span class="e-ico">⚠️</span>Erro ao carregar os dados. Tente novamente.</div>';
  }
}
async function approvePix(id, action) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(window.BELACAIXA_CFG.url + '/functions/v1/pix-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token, apikey: window.BELACAIXA_CFG.anon },
      body: JSON.stringify({ id, action })
    });
    const j = await res.json();
    if (j.ok) { toast(action === 'reject' ? 'Ticket recusado.' : 'Acesso liberado por Pix! 🎉', 'ok'); }
    else { toast('Não consegui processar. ' + (j.error || ''), 'warn'); }
  } catch (e) { toast('Erro ao processar o ticket.', 'warn'); }
  loadAdminStats();
}
async function adminAction(uid, action, extra, silent) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(window.BELACAIXA_CFG.url + '/functions/v1/admin-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token, apikey: window.BELACAIXA_CFG.anon },
      body: JSON.stringify({ user_id: uid, action, ...(extra || {}) })
    });
    const j = await res.json();
    if (j.ok) {
      if (!silent) {
        toast(action === 'revoke' ? 'Acesso revogado.' : action === 'delete' ? 'Assinatura excluída.' : action === 'purge' ? 'Cliente excluído. 🗑️' : 'Acesso liberado! 🎉', 'ok');
        loadAdminStats();
      }
      return true;
    }
    if (!silent) toast('Não consegui. ' + (j.error || ''), 'warn');
  } catch (e) { if (!silent) toast('Erro na ação.', 'warn'); }
  return false;
}
// exclui TODOS os inativos de uma vez (cada um: conta + dados + assinatura)
async function bulkPurgeInactive(uidsJson) {
  let uids = [];
  try { uids = JSON.parse(uidsJson || '[]'); } catch (e) { uids = []; }
  if (!uids.length) return toast('Nenhum inativo pra excluir.', 'info');
  if (!confirm('EXCLUIR DEFINITIVAMENTE ' + uids.length + ' cliente(s) inativo(s)?\n\nApaga a CONTA, os DADOS e a assinatura de cada um. NÃO dá pra desfazer.')) return;
  const root = $('#adminRoot');
  if (root) root.innerHTML = '<div class="empty"><span class="e-ico">⏳</span>Excluindo inativos…</div>';
  let ok = 0, fail = 0;
  for (const uid of uids) { if (await adminAction(uid, 'purge', null, true)) ok++; else fail++; }
  toast('Inativos excluídos: ' + ok + (fail ? ' · falhas: ' + fail : '') + ' 🧹', fail ? 'warn' : 'ok');
  loadAdminStats();
}
function modalEditClient(uid, email, plan, nome, mode) {
  const cur = PLAN_OPTS.includes(plan) ? plan : 'silver_mensal';
  const title = (mode === 'activate' ? '✅ Liberar acesso' : '✏️ Editar acesso');
  openModal(title + (nome ? ' — ' + esc(nome) : ''), `
    <p class="muted" style="margin:-4px 0 12px">${esc(email || '')}</p>
    <div class="field"><label>Plano</label><select id="ad_plan">
      ${PLAN_OPTS.map(p => `<option value="${p}" ${p === cur ? 'selected' : ''}>${PLAN_LABEL[p]}</option>`).join('')}
    </select></div>
    <div class="field"><label>Liberar acesso por (dias a partir de hoje)</label><input class="input" id="ad_days" type="number" min="1" value="${cur.endsWith('_anual') ? 365 : 30}"/></div>
    <p class="muted" style="font-size:12.5px">Acesso manual (tipo Pix), com vencimento. Dá pra editar ou revogar depois.</p>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="ad_save">💾 Salvar acesso</button>`);
  const ps = $('#ad_plan'), ds = $('#ad_days');
  if (ps) ps.onchange = () => { if (ds) ds.value = ps.value.endsWith('_anual') ? 365 : 30; };
  $('#ad_save').onclick = async () => {
    const p = $('#ad_plan').value; const days = parseInt($('#ad_days').value, 10);
    if (!(days > 0)) return toast('Informe uma quantidade de dias válida.', 'warn');
    $('#ad_save').disabled = true;
    const ok = await adminAction(uid, 'activate', { plan: p, days });
    if (ok) closeModal();
  };
}

/* ============================================================
   RENDER / ROUTER
   ============================================================ */
/* ============================================================
   PRIVACIDADE — olho + PIN de 6 dígitos
   Tranca só a INTERFACE das 3 telas de dinheiro (Painel, Fluxo de
   caixa e Patrimônio). Não é criptografia dos dados — é pra esconder
   os valores de quem usa o sistema junto (ex.: secretária).
   O PIN é guardado com hash SHA-256 + sal; nunca em texto puro.
   ============================================================ */
const PROTECTED_VIEWS = ['dashboard', 'financeiro', 'patrimonio'];
let privacyUnlocked = false;   // por sessão — recarregar/re-logar volta a trancar
const pinIsSet = () => !!(state && state.security && state.security.pinHash);
const viewIsLocked = (view) => pinIsSet() && PROTECTED_VIEWS.includes(view) && !privacyUnlocked;

async function hashPin(pin) {
  const data = new TextEncoder().encode('belacaixa::pin::v1|' + String(pin));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function verifyPin(pin) {
  if (!pinIsSet()) return false;
  return (await hashPin(pin)) === state.security.pinHash;
}
const onlyPin = (el) => { if (el) el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, '').slice(0, 6); }); };

function lockScreenHTML(v) {
  return `<div class="lock-screen">
    <div class="lock-card">
      <div class="lock-emoji">🔒</div>
      <h2>${esc(v.title)} protegido</h2>
      <p>Esta tela mostra informações de dinheiro. Digite o seu PIN de 6 dígitos para ver.</p>
      <input class="input pin-input" id="lockPin" type="password" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="off"/>
      <div id="lockErr" class="pin-err"></div>
      <button class="btn btn-primary" id="lockGo" style="width:100%">👁 Ver com PIN</button>
      <button class="btn btn-ghost btn-sm" id="lockForgot" style="margin-top:8px">Esqueci meu PIN</button>
    </div>
  </div>`;
}
function bindLockScreen() {
  const inp = $('#lockPin'), go = $('#lockGo'), err = $('#lockErr');
  if (!inp) return;
  setTimeout(() => inp.focus(), 50);
  inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); if (err) err.textContent = ''; });
  const tryUnlock = async () => {
    const pin = inp.value.replace(/\D/g, '');
    if (pin.length !== 6) { err.textContent = 'Digite os 6 dígitos do PIN.'; return; }
    if (await verifyPin(pin)) { privacyUnlocked = true; render(); toast('Desbloqueado 👁', 'ok'); }
    else { err.textContent = 'PIN incorreto. Tente de novo.'; inp.value = ''; inp.focus(); }
  };
  go.onclick = tryUnlock;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
  $('#lockForgot').onclick = modalPinForgot;
}
function updatePrivacyEye() {
  const eye = $('#privacyEye'); if (!eye) return;
  const showable = pinIsSet() && PROTECTED_VIEWS.includes(currentView) && privacyUnlocked;
  eye.hidden = !showable;
  eye.onclick = () => { privacyUnlocked = false; render(); toast('Valores ocultados 🔒', 'info'); };
}

const THEME_KEY = 'belacaixa_theme', THEME_CHOSEN_KEY = 'belacaixa_theme_chosen';
const VALID_THEMES = ['fem', 'masc', 'pet', 'ink'];   // rosa / azul / verde / preto
const THEME_COLOR = { fem: '#f43f8e', masc: '#1d4ed8', pet: '#16a34a', ink: '#111827' };
function savedThemePref() { try { const t = localStorage.getItem(THEME_KEY); return VALID_THEMES.includes(t) ? t : null; } catch (e) { return null; } }
function themeChosen() { try { return !!localStorage.getItem(THEME_CHOSEN_KEY); } catch (e) { return false; } }
function applyTheme(force) {
  let t = force || (state && state.business && state.business.theme) || 'fem';
  if (!VALID_THEMES.includes(t)) t = 'fem';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); if (!force) localStorage.setItem(THEME_CHOSEN_KEY, '1'); } catch (e) {}
  // logo conforme a cor: rosa (data-fem) / azul (data-masc) / verde (data-pet) / preto (data-ink);
  // cai no data-fem se a variante da cor não existir
  document.querySelectorAll('img[data-fem][data-masc]').forEach(img => {
    const want = img.dataset[t] || img.dataset.fem;
    if (img.getAttribute('src') !== want) img.setAttribute('src', want);
  });
  // termo do negócio (in-app) conforme o SEGMENTO — escalável por kind, independente da cor
  document.querySelectorAll('[data-seg-term]').forEach(el => {
    const want = segWord(el.dataset.segTerm);
    if (want && el.textContent !== want) el.textContent = want;
  });
  // spans FIXOS da landing (pré-login, sem segmento): trocam salão↔barbearia pela cor
  const _seg = segmentKey();
  document.querySelectorAll('[data-term-fem][data-term-masc]').forEach(el => {
    const want = _seg === 'barbearia' ? el.dataset.termMasc : el.dataset.termFem;
    if (el.textContent !== want) el.textContent = want;
  });
  document.querySelectorAll('.tsw[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  // PWA: a cor da barra do sistema (app instalado) acompanha o tema (rosa/azul/verde)
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', THEME_COLOR[t] || THEME_COLOR.fem);
}
// SEGMENTOS (ramos) que o BelaCaixa atende. Cada um define as PALAVRAS do negócio,
// um ícone, a cor sugerida e um catálogo modelo opcional. O segmento é INDEPENDENTE
// da cor: o dono escolhe o ramo (o app se adapta) e ainda pode trocar rosa/azul.
const SEGMENTS = {
  salao: {
    key: 'salao', label: 'Salão · Nails · Sobrancelha', icon: '💅', theme: 'fem', color: '#f43f8e',
    svg: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="9.2" y="2" width="5.6" height="3.2" rx="1" fill="#f43f8e"/><rect x="8.4" y="5.4" width="7.2" height="3.6" rx="1" fill="#f9a8cf"/><path d="M8.2 9h7.6a1 1 0 0 1 1 1v9.5A1.5 1.5 0 0 1 15.3 21H8.7a1.5 1.5 0 0 1-1.5-1.5V10a1 1 0 0 1 1-1z" fill="#f43f8e"/><rect x="8.9" y="12.4" width="6.2" height="3.4" rx="1" fill="#fff" opacity=".5"/></svg>',
    defName: 'Meu salão', bare: 'salão', namePh: 'Ex.: Studio Bella Unhas',
    terms: { the: 'do salão', poss: 'seu salão' },
    catalog: [
      { name: 'Corte feminino', price: 70, dur: 60 },
      { name: 'Escova', price: 50, dur: 45 },
      { name: 'Manicure', price: 35, dur: 40 },
      { name: 'Pedicure', price: 40, dur: 45 },
      { name: 'Coloração', price: 150, dur: 120 },
    ],
  },
  barbearia: {
    key: 'barbearia', label: 'Barbearia', icon: '💈', theme: 'masc', color: '#1d4ed8',
    svg: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
    defName: 'Minha barbearia', bare: 'barbearia', namePh: 'Ex.: Barbearia do João',
    terms: { the: 'da barbearia', poss: 'sua barbearia' },
    catalog: [
      { name: 'Corte masculino', price: 45, dur: 40 },
      { name: 'Barba', price: 35, dur: 30 },
      { name: 'Corte + barba', price: 70, dur: 60 },
      { name: 'Sobrancelha', price: 20, dur: 15 },
      { name: 'Pezinho', price: 20, dur: 15 },
    ],
  },
  petshop: {
    key: 'petshop', label: 'Petshop · Banho e tosa', icon: '🐾', theme: 'pet', color: '#16a34a',
    svg: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="#16a34a"><ellipse cx="6" cy="11" rx="2.1" ry="2.7"/><ellipse cx="18" cy="11" rx="2.1" ry="2.7"/><ellipse cx="9.6" cy="6.7" rx="2" ry="2.6"/><ellipse cx="14.4" cy="6.7" rx="2" ry="2.6"/><path d="M12 12.4c-2.7 0-5 1.9-5 4.2 0 1.8 1.5 2.8 3.1 2.8 .95 0 1.4-.35 1.9-.35s.95 .35 1.9 .35c1.6 0 3.1-1 3.1-2.8 0-2.3-2.3-4.2-5-4.2z"/></svg>',
    defName: 'Meu petshop', bare: 'petshop', namePh: 'Ex.: Pet Amore Banho e Tosa',
    terms: { the: 'do petshop', poss: 'seu petshop' },
    catalog: [
      { name: 'Banho (porte pequeno)', price: 50, dur: 60 },
      { name: 'Banho (porte grande)', price: 80, dur: 90 },
      { name: 'Tosa higiênica', price: 45, dur: 45 },
      { name: 'Tosa completa', price: 90, dur: 90 },
      { name: 'Banho + tosa', price: 120, dur: 120 },
      { name: 'Corte de unhas', price: 25, dur: 20 },
    ],
  },
  tattoo: {
    key: 'tattoo', label: 'Tatuagem · Ink · Piercing', icon: '🖤', theme: 'ink', color: '#111827',
    svg: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="#111827"><path d="M12 2.4c-.42 0-.8.22-1.01.58C9.17 6.1 5.3 10.4 5.3 14.4a6.7 6.7 0 0 0 13.4 0c0-4-3.87-8.3-5.69-11.42A1.16 1.16 0 0 0 12 2.4z"/><circle cx="12" cy="14.6" r="2.3" fill="#fff" opacity=".28"/></svg>',
    defName: 'Meu estúdio', bare: 'estúdio', namePh: 'Ex.: Black Rose Tattoo Studio',
    terms: { the: 'do estúdio', poss: 'seu estúdio' },
    catalog: [
      { name: 'Tatuagem pequena', price: 200, dur: 60 },
      { name: 'Tatuagem média', price: 450, dur: 120 },
      { name: 'Tatuagem grande (sessão)', price: 800, dur: 240 },
      { name: 'Piercing', price: 120, dur: 30 },
      { name: 'Retoque', price: 100, dur: 45 },
    ],
  },
};
const SEGMENT_ORDER = ['salao', 'barbearia', 'petshop', 'tattoo'];
// Segmento atual. Contas com `segment` gravado usam ele; contas antigas/landing
// (sem segment) caem no fallback pela cor (azul=barbearia, rosa=salão) — assim nada
// muda pra quem já usava e a landing pré-login continua igual.
function segmentKey() {
  const s = state && state.business && state.business.segment;
  if (s && SEGMENTS[s]) return s;
  const masc = (state && state.business && state.business.theme === 'masc') ||
               (!(state && state.business) && document.documentElement.dataset.theme === 'masc');
  return masc ? 'barbearia' : 'salao';
}
function curSegment() { return SEGMENTS[segmentKey()]; }
// Termo do negócio conforme o SEGMENTO, ESCALÁVEL por tipo de palavra (kind):
//   term('the')  → "do salão" / "da barbearia" / "do petshop" / "do estúdio"
//   term('poss') → "seu salão" / "sua barbearia" / "seu petshop" / "seu estúdio"
// Cada ramo define seu `terms` em SEGMENTS. Adicionar um novo ramo NÃO exige mexer aqui.
// Retorna um <span> que o applyTheme mantém sincronizado quando o segmento muda.
function segWord(kind) {
  const s = curSegment();
  return (s.terms && s.terms[kind]) || (SEGMENTS.salao.terms && SEGMENTS.salao.terms[kind]) || '';
}
function term(kind) {
  return `<span data-seg-term="${kind}">${segWord(kind)}</span>`;
}
// versão texto-puro (sem HTML) p/ nome padrão de negócio embutido em links/tokens
function bizWordPlain(cap) {
  const s = curSegment();
  return cap ? s.defName : s.bare;
}
function render() {
  applyTheme();
  const novos = syncShoppingList();   // itens que chegaram no mínimo entram sozinhos na lista de compras
  if (novos.length) toast(novos.length === 1 ? novos[0] + ' entrou na lista de compras — está acabando' : novos.length + ' materiais entraram na lista de compras', 'warn');
  const v = VIEWS[currentView];
  $('#viewTitle').textContent = v.title;
  $('#viewSubtitle').textContent = v.subtitle;
  if (viewIsLocked(currentView)) {
    $('#viewRoot').innerHTML = lockScreenHTML(v);
    bindLockScreen();
  } else {
    $('#viewRoot').innerHTML = v.html();
    const _vb = (typeof vencBannerHTML === 'function') ? vencBannerHTML() : '';
    if (_vb) $('#viewRoot').insertAdjacentHTML('afterbegin', _vb);
    const _nb = notifBarHTML();   // banner grande: só enquanto houver aviso NÃO lido
    if (_nb) $('#viewRoot').insertAdjacentHTML('afterbegin', _nb);
    v.init && v.init();
  }
  updatePrivacyEye();
  $$('#navMenu .nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
  $('#bizName').textContent = state.business.name;
  updateStockBadge();
  updateNotifBell();
}
/* ---------- CENTRAL DE AVISOS ----------
   Junta num lugar só tudo que pede atenção: materiais acabando (principal),
   pedidos do link aguardando, aniversariantes do dia e vencimento do plano.
   Aviso NÃO LIDO = banner grande no topo; leu tudo → banner some e fica só
   o sininho 🔔 minimizado. Aviso novo faz o banner voltar sozinho.
   O "lido" fica salvo por aviso na conta (state.notifRead = [keys]). */
function buildNotifs() {
  const out = [];
  if (!state) return out;
  lowStock().forEach(it => out.push({ key: 'low_' + it.id, grp: '📦 Materiais acabando', text: `<b>${esc(it.name)}</b> — restam ${it.qty} ${esc(it.unit)} (mínimo ${it.min})`, act: 'gerar-pedido', actLabel: '🛒 Ver lista de compras' }));
  (state.appointments || []).filter(a => a && a.pending && a.source === 'link' && a.status === 'agendado')
    .forEach(a => out.push({ key: 'hold_' + a.id, grp: '📅 Agenda', text: `⏳ <b>${esc(a.clientName)}</b> pediu <b>${esc(a.serviceName)}</b> pelo link — ${a.date.split('-').reverse().join('/')} às ${a.time}`, act: 'go-agenda', actLabel: 'Ver agenda' }));
  const v = (typeof vencInfo === 'function' && !isAdmin()) ? vencInfo() : null;
  if (v && !v.recorrente && v.days >= 0 && v.days <= 10) out.push({ key: 'venc_' + v.end.toISOString().slice(0, 10), grp: '💳 Assinatura', text: `⏳ Seu acesso vence em <b>${v.days} dia(s)</b> (${v.end.toLocaleDateString('pt-BR')})`, act: 'assinar', actLabel: 'Renovar' });
  return out;
}
function unreadNotifs() {
  const read = (state && Array.isArray(state.notifRead)) ? state.notifRead : [];
  return buildNotifs().filter(n => !read.includes(n.key));
}
function notifBarHTML() {
  const un = unreadNotifs(); if (!un.length) return '';
  const porGrupo = {};
  un.forEach(n => porGrupo[n.grp] = (porGrupo[n.grp] || 0) + 1);
  const resumo = Object.entries(porGrupo).map(([g, n]) => `${g}: <b>${n}</b>`).join(' · ');
  return `<div class="notif-bar" id="notifBar">
    <span style="font-size:24px">🔔</span>
    <div style="flex:1;min-width:0"><b>${un.length} aviso(s) novo(s) no ${term('poss')}</b>
      <div class="muted" style="font-size:13px;margin-top:2px">${resumo}</div></div>
    <button class="btn btn-primary btn-sm" data-act="central-avisos">Ver avisos →</button>
  </div>`;
}
function modalCentralAvisos() {
  const list = buildNotifs();
  if (!list.length) { toast('Nenhum aviso por aqui — tudo em dia ✅', 'ok'); return; }
  const grupos = {};
  list.forEach(n => (grupos[n.grp] = grupos[n.grp] || []).push(n));
  openModal('🔔 Central de avisos', `
    <p class="muted" style="margin-bottom:12px">Tudo que precisa da sua atenção, num lugar só. Ao abrir aqui, os avisos ficam <b>lidos</b> e o banner do topo some — aviso novo faz ele voltar.</p>
    ${Object.entries(grupos).map(([g, ns]) => `
      <div class="notif-grp">
        <div class="notif-grp-head">${g} · ${ns.length}</div>
        ${ns.map(n => `<div class="notif-item">${n.text}</div>`).join('')}
        <button class="btn btn-soft btn-sm" data-act="${ns[0].act}" style="margin-top:6px">${ns[0].actLabel} →</button>
      </div>`).join('')}
  `, `<button class="btn btn-primary" data-close>Entendi ✔</button>`);
  // abrir a central = ler tudo: banner some, sininho continua no lugar
  state.notifRead = list.map(n => n.key); save();
  const bar = document.getElementById('notifBar'); if (bar) bar.remove();
  updateNotifBell();
}
// sininho 🔔 no TOPO (minimizado): mostra o total de avisos; vermelho = tem não lido
function updateNotifBell() {
  const btn = $('#notifBell'); if (!btn) return;
  const all = buildNotifs(), un = unreadNotifs();
  btn.hidden = all.length === 0;
  const b = $('#notifBellN'); if (b) { b.textContent = all.length; b.classList.toggle('is-read', un.length === 0); }
  btn.title = un.length ? un.length + ' aviso(s) novo(s) — abrir central de avisos' : all.length + ' aviso(s), tudo lido — abrir central';
  btn.onclick = modalCentralAvisos;
}
// selo vermelho no menu 📦 Estoque com o nº de itens a repor (sempre visível)
function updateStockBadge() {
  const btn = document.querySelector('#navMenu .nav-item[data-view="estoque"]');
  if (!btn) return;
  const n = (state && Array.isArray(state.inventory)) ? lowStock().length : 0;
  let badge = btn.querySelector('.ni-badge');
  if (n > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'ni-badge'; btn.appendChild(badge); }
    badge.textContent = n;
    badge.title = n + ' item(ns) precisam repor';
  } else if (badge) { badge.remove(); }
}
function setView(v) { currentView = v; $('.sidebar')?.classList.remove('open'); render(); window.scrollTo(0, 0); }

/* ============================================================
   MODAIS (formulários)
   ============================================================ */
// Formas de pagamento (com ícone representando cada uma). credito/debito são "cartão"
// e liberam o campo de taxa da maquininha.
const PAY_OPTS = [
  { id: 'pix', label: 'Pix', svg: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2.6 6.9 7.7l2.5 2.5a3.7 3.7 0 0 1 5.2 0l2.5-2.5L12 2.6zM4.7 9.9l-2.1 2.1 2.1 2.1 2.5-2.1-2.5-2.1zm14.6 0-2.5 2.1 2.5 2.1 2.1-2.1-2.1-2.1zM12 13.8a2.2 2.2 0 0 1-1.6-.6l-2.5 2.5L12 20.8l4.1-5.1-2.5-2.5a2.2 2.2 0 0 1-1.6.6z" fill="#32BCAD"/></svg>' },
  { id: 'dinheiro', label: 'Dinheiro', svg: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="2.3" y="6" width="19.4" height="12" rx="2" fill="#2ca05a"/><circle cx="12" cy="12" r="3" fill="#eafff2"/><circle cx="5.4" cy="12" r="1" fill="#eafff2"/><circle cx="18.6" cy="12" r="1" fill="#eafff2"/></svg>' },
  { id: 'credito', label: 'Crédito', card: true, svg: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="2.3" y="5.4" width="19.4" height="13.2" rx="2.4" fill="#3b82f6"/><rect x="2.3" y="8.2" width="19.4" height="2.7" fill="#1e40af"/><rect x="5" y="14" width="5.5" height="2" rx="1" fill="#dbeafe"/></svg>' },
  { id: 'debito', label: 'Débito', card: true, svg: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="2.3" y="5.4" width="19.4" height="13.2" rx="2.4" fill="#8b5cf6"/><rect x="2.3" y="8.2" width="19.4" height="2.7" fill="#6d28d9"/><rect x="5" y="14" width="5.5" height="2" rx="1" fill="#ede9fe"/></svg>' },
];
const PAY_LABEL = { pix: 'Pix', dinheiro: 'Dinheiro', credito: 'Crédito', debito: 'Débito' };
function payIcon(id) { const p = PAY_OPTS.find(x => x.id === id); return p ? p.svg : ''; }
function modalAtendimento() {
  const servopts = state.services.map(s => `<option value="${esc(s.name)}">${fmt(s.price)}</option>`).join('');
  const clopts = state.clients.map(c => `<option value="${esc(c.name)}">`).join('');
  const first = state.services[0];
  openModal('Registrar atendimento', `
    <div class="field"><label>Serviço</label><input class="input" id="f_serv" list="servdl" placeholder="Escolha ou digite um serviço" value="${first ? esc(first.name) : ''}"/><datalist id="servdl">${servopts}</datalist><span class="muted" style="font-size:12.5px">Escolha da lista ou digite um serviço novo ✍️ — o valor você ajusta abaixo</span></div>
    <div class="field"><label>Cliente</label><input class="input" id="f_cli" list="clidl" placeholder="Nome da cliente"/><datalist id="clidl">${clopts}</datalist><span class="muted" style="font-size:12.5px">Cliente nova é cadastrada automaticamente ✨</span></div>
    <div class="field-row"><div class="field"><label>Valor (R$)</label><input class="input" id="f_val" type="number" step="0.01"/></div><div class="field"><label>Data</label><input class="input" id="f_date" type="date" value="${todayISO()}"/></div></div>
    <div class="field"><label>Forma de pagamento</label>
      <div class="pay-opts" id="f_pay">${PAY_OPTS.map(p => `<button type="button" class="pay-opt${p.id === 'pix' ? ' on' : ''}" data-pay="${p.id}">${p.svg}<span>${p.label}</span></button>`).join('')}</div>
    </div>
    <div class="field" id="pay_fee_box" style="display:none">
      <label>Taxa da maquininha (%) <span class="muted" style="font-weight:400">— o que sua maquininha cobra nessa forma</span></label>
      <input class="input" id="pay_fee" type="number" step="0.01" min="0" placeholder="Ex.: 3,5"/>
      <label class="row" style="gap:8px;font-size:14px;margin-top:8px"><input type="checkbox" id="pay_fee_add" style="width:auto"/> Somar a taxa ao valor (repassar ao cliente)</label>
      <div id="pay_fee_calc" class="muted" style="font-size:12.5px;margin-top:6px"></div>
    </div>
    <label class="row" style="gap:8px;font-size:14px"><input type="checkbox" id="f_baixa" checked style="width:auto"/> Dar baixa no material usado (serviços conhecidos)</label>
    <div id="f_baixa_info" class="baixa-info"></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="f_save">Registrar</button>`);
  const findServ = () => state.services.find(s => s.name.toLowerCase() === $('#f_serv').value.trim().toLowerCase());
  const baixaInfo = () => {
    const box = $('#f_baixa_info'); if (!box) return;
    const s = findServ();
    const parts = (s && s.mat || []).map(([id, q]) => { const it = state.inventory.find(i => i.id === id); return it ? `${q}${it.unit ? ' ' + esc(it.unit) : ''} de ${esc(it.name)}` : ''; }).filter(Boolean);
    box.innerHTML = parts.length ? `📉 Vai baixar do estoque: <b>${parts.join(', ')}</b>` : '';
  };
  const svc0 = findServ(); if (svc0) $('#f_val').value = svc0.price;
  baixaInfo();
  // ----- forma de pagamento + taxa da maquininha (só cartão) -----
  let payMethod = 'pix';
  const payFeeCalc = () => {
    const box = $('#pay_fee_calc'); if (!box) return;
    const val = parseFloat($('#f_val').value) || 0;
    const fee = parseFloat($('#pay_fee').value) || 0;
    if (!fee) { box.innerHTML = ''; return; }
    const feeAmt = val * fee / 100;
    box.innerHTML = $('#pay_fee_add').checked
      ? `➕ Total com a taxa: <b>${fmt(val + feeAmt)}</b> <span class="muted">(${fmt(val)} + ${fee}%)</span>`
      : `💳 A maquininha desconta ~${fmt(feeAmt)} — você recebe <b>${fmt(val - feeAmt)}</b>`;
  };
  const selPay = (id) => {
    payMethod = id;
    $('#f_pay').querySelectorAll('.pay-opt').forEach(b => b.classList.toggle('on', b.dataset.pay === id));
    const isCard = (id === 'credito' || id === 'debito');
    $('#pay_fee_box').style.display = isCard ? '' : 'none';
    if (isCard) { const def = (state.business.cardFees || {})[id]; $('#pay_fee').value = (def != null ? def : ''); payFeeCalc(); }
  };
  $('#f_pay').querySelectorAll('.pay-opt').forEach(b => b.onclick = () => selPay(b.dataset.pay));
  $('#pay_fee').oninput = payFeeCalc;
  $('#pay_fee_add').onchange = payFeeCalc;
  $('#f_serv').oninput = () => { const s = findServ(); if (s) $('#f_val').value = s.price; baixaInfo(); payFeeCalc(); };
  $('#f_val').oninput = payFeeCalc;
  $('#f_save').onclick = () => {
    const servName = $('#f_serv').value.trim();
    const name = $('#f_cli').value.trim(); const val = parseFloat($('#f_val').value);
    if (!servName) return toast('Informe o serviço.', 'warn');
    if (!name || !(val >= 0)) return toast('Preencha cliente e valor.', 'warn');
    let cli = findClientByContact(name, '');
    if (!cli) { cli = { id: 'c_' + uid(), name, phone: '', notes: '', createdAt: todayISO() }; state.clients.push(cli); toast(`Cliente "${name}" cadastrada automaticamente 💖`, 'ok'); }
    const service = findServ();
    // cartão: lembra o % da maquininha e, se marcado, soma a taxa ao valor (repassa ao cliente)
    let amount = val; const extra = { pay: payMethod };
    if (payMethod === 'credito' || payMethod === 'debito') {
      const fee = parseFloat($('#pay_fee').value) || 0;
      if (fee > 0) {
        state.business.cardFees = state.business.cardFees || {};
        state.business.cardFees[payMethod] = fee;         // vira o padrão da próxima vez
        extra.feePct = fee;
        if ($('#pay_fee_add').checked) { amount = +(val + val * fee / 100).toFixed(2); extra.feeAdded = true; }
      }
    }
    state.transactions.push({ id: uid(), type: 'in', category: 'Atendimentos', amount, desc: servName + ' — ' + name.split(' ')[0], date: $('#f_date').value, clientId: cli.id, ...extra });
    if (service && $('#f_baixa').checked) deduct(service);
    save(); closeModal(); render();
    toast('Atendimento registrado! ' + fmt(amount) + ' no caixa · ' + PAY_LABEL[payMethod] + '.', 'ok');
  };
}
function deduct(service) {
  const hitMin = [];
  (service.mat || []).forEach(([id, q]) => {
    const it = state.inventory.find(i => i.id === id);
    if (!it) return;
    const before = it.qty;
    it.qty = Math.max(0, +(it.qty - q).toFixed(2));
    const cruzouMin = before > it.min && it.qty <= it.min;      // caiu no/abaixo do mínimo agora
    const zerouAgora = before > 0 && it.qty <= 0;               // esgotou nesta baixa (mesmo se já estava baixo)
    if (cruzouMin || zerouAgora) hitMin.push(it);
  });
  if (hitMin.length) {
    const parts = hitMin.map(it => it.qty <= 0 ? `${esc(it.name)} (zerou!)` : `${esc(it.name)} (${it.qty} ${esc(it.unit)}, mín ${it.min})`);
    const um = hitMin.length === 1 ? hitMin[0] : null;
    const act = { label: um ? 'Repor' : 'Ver lista', onClick: () => um ? modalRepor(um.id) : modalListaCompras() };
    toast('Estoque no limite — hora de repor 📦: ' + parts.join(' · '), 'warn', 6500, act);
  }
}
function modalServico(id) {
  const s = id ? state.services.find(x => x.id === id) : null;
  const inv = state.inventory || [];
  let mats = s && Array.isArray(s.mat) ? s.mat.map(m => [m[0], m[1]]) : [];   // cópia editável da receita
  const invOpts = sel => inv.map(i => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)}${i.unit ? ' (' + esc(i.unit) + ')' : ''}</option>`).join('');
  openModal(s ? '✏️ Editar serviço' : `${brandIco(22)} Novo serviço`, `
    <div class="field"><label>Nome do serviço</label><input class="input" id="sv_name" placeholder="Ex.: Alongamento em gel" value="${s ? esc(s.name) : ''}"/></div>
    <div class="field-row">
      <div class="field"><label>Valor (R$)</label><input class="input" id="sv_price" type="number" step="0.01" min="0" value="${s ? s.price : ''}" placeholder="0,00"/></div>
      <div class="field"><label>Duração (min)</label><input class="input" id="sv_dur" type="number" min="0" step="5" value="${s && s.dur ? s.dur : ''}" placeholder="60"/></div>
    </div>
    <div class="field">
      <label>📦 Materiais consumidos por aplicação</label>
      <div id="sv_mats" class="sv-mats"></div>
      <button type="button" class="btn btn-soft btn-sm" id="sv_addmat" style="margin-top:8px">➕ Adicionar material</button>
      <p class="muted" style="font-size:12px;margin-top:8px">Coloque só o que é gasto <b>a cada atendimento</b> (gel, silicone pad, unha postiça…). Sempre que este serviço for registrado, o estoque baixa sozinho. 💡 Esmalte, que rende vários atendimentos, não precisa entrar aqui.</p>
    </div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="sv_save">${s ? 'Salvar' : 'Adicionar'}</button>`);
  const invById = x => inv.find(i => i.id === x);
  function renderMats() {
    const box = $('#sv_mats'); if (!box) return;
    if (!inv.length) { box.innerHTML = '<p class="muted" style="font-size:12.5px">Cadastre itens no <b>Estoque</b> primeiro pra poder vincular aqui.</p>'; return; }
    if (!mats.length) { box.innerHTML = '<p class="muted" style="font-size:12.5px">Nenhum material vinculado ainda — clique em “Adicionar material”.</p>'; return; }
    box.innerHTML = mats.map((m, idx) => {
      const it = invById(m[0]); const unit = it ? (it.unit || 'un') : 'un';
      return `<div class="sv-mat-row">
        <select class="input sv-mat-item" data-idx="${idx}">${invOpts(m[0])}</select>
        <input class="input sv-mat-qty" data-idx="${idx}" type="number" min="0" step="0.01" value="${m[1]}"/>
        <span class="sv-mat-unit">${esc(unit)}</span>
        <button type="button" class="ib ib-danger sv-mat-del" data-idx="${idx}" title="Remover material">✕</button>
      </div>`;
    }).join('');
    box.querySelectorAll('.sv-mat-item').forEach(el => el.onchange = () => { mats[+el.dataset.idx][0] = el.value; renderMats(); });
    box.querySelectorAll('.sv-mat-qty').forEach(el => el.oninput = () => { mats[+el.dataset.idx][1] = parseFloat(el.value) || 0; });
    box.querySelectorAll('.sv-mat-del').forEach(el => el.onclick = () => { mats.splice(+el.dataset.idx, 1); renderMats(); });
  }
  renderMats();
  const addBtn = $('#sv_addmat');
  if (addBtn) addBtn.onclick = () => { if (!inv.length) return toast('Cadastre itens no Estoque primeiro 📦', 'warn'); mats.push([inv[0].id, 1]); renderMats(); };
  $('#sv_save').onclick = () => {
    const name = $('#sv_name').value.trim();
    const price = parseFloat($('#sv_price').value);
    const dur = parseInt($('#sv_dur').value, 10);
    if (!name) return toast('Informe o nome do serviço.', 'warn');
    if (!(price >= 0)) return toast('Informe um valor válido.', 'warn');
    const cleanMats = mats.filter(m => m[0] && m[1] > 0).map(m => [m[0], +(+m[1]).toFixed(2)]);
    if (s) { s.name = name; s.price = price; s.dur = dur > 0 ? dur : (s.dur || 0); s.mat = cleanMats; }
    else { state.services.push({ id: 's_' + uid(), name, price, dur: dur > 0 ? dur : 60, mat: cleanMats }); }
    save(); closeModal(); render(); toast(s ? 'Serviço atualizado ✨' : 'Serviço adicionado ✨', 'ok');
  };
}
function modalTx(type, editId) {
  // com editId, edita o lançamento existente (ex.: corrigir valor quando deu desconto)
  const tx = editId ? state.transactions.find(t => t.id === editId) : null;
  if (editId && !tx) return;
  if (tx) type = tx.type;
  const baseCats = type === 'in' ? ['Atendimentos', 'Venda de produtos', 'Outros'] : ['Matéria-prima', 'Aluguel', 'Energia / Água', 'Marketing', 'Salários / Comissão', 'Manutenção', 'Outros'];
  state.business.customCats = state.business.customCats || { in: [], out: [] };
  const custom = (state.business.customCats[type] || []).filter(c => !baseCats.includes(c));   // categorias criadas pelo dono
  const oi = baseCats.indexOf('Outros');   // personalizadas entram logo antes de "Outros"
  const cats = oi >= 0 ? [...baseCats.slice(0, oi), ...custom, ...baseCats.slice(oi)] : [...baseCats, ...custom];
  if (tx && tx.category && !cats.includes(tx.category)) cats.push(tx.category);   // não perde categoria antiga
  openModal(tx ? (type === 'in' ? '✏️ Editar entrada' : '✏️ Editar saída') : (type === 'in' ? 'Nova entrada' : 'Nova saída'), `
    <div class="field"><label>Descrição</label><input class="input" id="t_desc" placeholder="${type === 'in' ? 'Ex.: Venda de kit de esmaltes' : 'Ex.: Conta de luz'}" value="${tx ? esc(tx.desc) : ''}"/></div>
    <div class="field-row"><div class="field"><label>Valor (R$)</label><input class="input" id="t_val" type="number" step="0.01" value="${tx ? tx.amount : ''}"/></div><div class="field"><label>Categoria</label><div class="cat-wrap"><select id="t_cat">${cats.map(c => `<option${tx && tx.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select><button type="button" class="cat-add-btn" id="t_cat_add" title="Nova categoria" aria-label="Nova categoria">＋</button></div><div class="cat-new" id="t_cat_new" hidden><input class="input" id="t_cat_name" placeholder="Nova categoria" maxlength="28"/><button type="button" class="btn btn-primary btn-sm" id="t_cat_ok">Incluir</button><button type="button" class="btn btn-ghost btn-sm cat-x" id="t_cat_cancel" aria-label="Cancelar">×</button></div></div></div>
    <div class="field"><label>Data</label><input class="input" id="t_date" type="date" value="${tx ? tx.date : todayISO()}"/></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="t_save">Salvar</button>`);
  // Categoria personalizada: botão ＋ abre um campo pra criar e salva na conta (state.business.customCats).
  const catSel = $('#t_cat'), catNew = $('#t_cat_new'), catName = $('#t_cat_name');
  $('#t_cat_add').onclick = () => { catNew.hidden = false; catName.focus(); };
  $('#t_cat_cancel').onclick = () => { catNew.hidden = true; catName.value = ''; };
  function addCat() {
    const name = catName.value.trim();
    if (!name) return toast('Digite o nome da categoria.', 'warn');
    const dup = [...catSel.options].find(o => o.value.toLowerCase() === name.toLowerCase());
    if (dup) { catSel.value = dup.value; catNew.hidden = true; catName.value = ''; return toast('Essa categoria já existe.', 'warn'); }
    state.business.customCats[type] = state.business.customCats[type] || [];
    state.business.customCats[type].push(name);
    save();
    const opt = document.createElement('option'); opt.textContent = name;
    const outros = [...catSel.options].find(o => o.value === 'Outros');
    if (outros) catSel.insertBefore(opt, outros); else catSel.appendChild(opt);
    catSel.value = name;
    catNew.hidden = true; catName.value = '';
    toast('Categoria "' + name + '" adicionada ✅', 'ok');
  }
  $('#t_cat_ok').onclick = addCat;
  catName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCat(); } });
  $('#t_save').onclick = () => {
    const val = parseFloat($('#t_val').value), desc = $('#t_desc').value.trim() || $('#t_cat').value;
    if (!(val > 0)) return toast('Informe um valor válido.', 'warn');
    if (tx) { tx.amount = val; tx.desc = desc; tx.category = $('#t_cat').value; tx.date = $('#t_date').value; }   // mantém id, type e clientId
    else state.transactions.push({ id: uid(), type, category: $('#t_cat').value, amount: val, desc, date: $('#t_date').value });
    save(); closeModal(); render(); toast(tx ? 'Lançamento atualizado ✏️' : (type === 'in' ? 'Entrada' : 'Saída') + ' registrada.', 'ok');
  };
}
// Conclusão com VALOR AJUSTÁVEL: o caixa recebe o que foi cobrado de verdade
// (ex.: desconto pra cliente) — sem precisar corrigir o lançamento depois.
function modalDoneAppt(id) {
  const a = state.appointments.find(x => x.id === id); if (!a) return;
  const cheio = +a.price || 0;
  openModal('✓ Concluir atendimento', `
    <p class="muted" style="margin-bottom:12px"><b>${esc(a.serviceName)}</b> — ${esc(a.clientName)}<br>Preço do catálogo: <b>${fmt(cheio)}</b></p>
    <div class="field"><label>Valor cobrado (R$) <span class="muted" style="font-weight:400">— mude se deu desconto</span></label><input class="input" id="d_val" type="number" step="0.01" min="0" value="${cheio}"/></div>
    <div class="kv" id="d_diff" style="display:none;color:#e8618c"><span>🏷️ Desconto dado</span><b>—</b></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="d_save">Concluir e lançar no caixa</button>`);
  const upd = () => {
    const v = +$('#d_val').value || 0, diff = cheio - v, el = $('#d_diff');
    if (diff > 0.005 && cheio > 0) { el.style.display = ''; el.querySelector('b').textContent = fmt(diff) + ' (' + Math.round(diff / cheio * 100) + '%)'; }
    else el.style.display = 'none';
  };
  $('#d_val').oninput = upd;
  $('#d_save').onclick = () => {
    const v = parseFloat($('#d_val').value);
    if (!(v >= 0)) return toast('Informe um valor válido.', 'warn');
    a.status = 'concluido'; a.charged = v;
    if (v > 0) state.transactions.push({ id: uid(), type: 'in', category: 'Atendimentos', amount: +v.toFixed(2), desc: a.serviceName + ' — ' + a.clientName.split(' ')[0] + (v < cheio ? ' (com desconto)' : ''), date: a.date < todayISO() ? a.date : todayISO(), clientId: a.clientId });
    const sv = state.services.find(s => s.id === a.serviceId); if (sv) deduct(sv);   // regra de ouro: estoque baixa só na conclusão
    save(); closeModal(); render(); toast('Atendimento concluído! ' + fmt(v) + ' no caixa 💰', 'ok');
  };
}
function modalCliente(editId) {
  // com editId, edita a ficha existente (mantém id, vínculos e data de cadastro)
  const c = editId ? state.clients.find(x => x.id === editId) : null;
  if (editId && !c) return;
  openModal(c ? '✏️ Editar cliente' : 'Novo cliente', `
    <div class="field"><label>Nome</label><input class="input" id="c_name" placeholder="Nome completo" value="${c ? esc(c.name) : ''}"/></div>
    <div class="field"><label>Telefone</label><input class="input" id="c_phone" placeholder="(11) 9...." value="${c ? esc(c.phone || '') : ''}"/></div>
    <div class="field"><label>Observações</label><textarea id="c_notes" placeholder="Preferências, alergias, esmalte favorito...">${c ? esc(c.notes || '') : ''}</textarea></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="c_save">Salvar</button>`);
  $('#c_save').onclick = () => {
    const name = $('#c_name').value.trim(); if (!name) return toast('Informe o nome.', 'warn');
    const data = { name, phone: $('#c_phone').value.trim(), notes: $('#c_notes').value.trim() };
    if (c) Object.assign(c, data);
    else state.clients.push({ id: 'c_' + uid(), ...data, createdAt: todayISO() });
    save(); closeModal(); render(); toast(c ? 'Cliente atualizada ✨' : 'Cliente cadastrada 💖', 'ok');
  };
}
// --- Cruzamento cliente↔agendamento: casa por TELEFONE (só dígitos, sem DDI) e, se não, por nome ---
function phoneKey(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length > 11 && d.slice(0, 2) === '55') d = d.slice(2);   // tira o +55 pra comparar
  return d;
}
function findClientByContact(name, phone) {
  const pk = phoneKey(phone);
  if (pk.length >= 8) {
    const byPhone = state.clients.find(c => phoneKey(c.phone) === pk);
    if (byPhone) return byPhone;                                  // mesma pessoa, mesmo número → não duplica
  }
  const ln = String(name || '').trim().toLowerCase();
  if (ln) return state.clients.find(c => String(c.name).trim().toLowerCase() === ln) || null;
  return null;
}
// --- Conflito de horário (ciente da DURAÇÃO do serviço) → evita 2 clientes no mesmo horário ---
function hhmmToMin(t) { const p = String(t || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
function minToHHMM(m) { m = Math.max(0, m | 0); return String((m / 60 | 0)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function apptDurMin(a) { const sv = state.services.find(s => s.id === a.serviceId); return (sv && +sv.dur) || 60; }
/* Expediente do salão (com padrões p/ contas antigas que ainda não configuraram).
   days = dias da semana atendidos (0=dom … 6=sáb); slot = intervalo entre horários. */
function bizHours() {
  const h = (state.business && state.business.hours) || {};
  return {
    open: h.open || '09:00',
    close: h.close || '19:00',
    days: (Array.isArray(h.days) && h.days.length) ? h.days.map(Number) : [1, 2, 3, 4, 5, 6],
    slot: +h.slot || 30
  };
}
/* Horário de almoço/intervalo — bloqueado na agenda e no link (não vira horário vago).
   days vazio = vale em TODOS os dias de expediente ("toda semana"); com dias = só neles. */
function bizLunch() {
  const l = (state.business && state.business.hours && state.business.hours.lunch) || null;
  if (!l || !l.on) return null;
  const start = l.start || '', end = l.end || '';
  if (!start || !end || hhmmToMin(end) <= hhmmToMin(start)) return null;   // faixa inválida = ignora
  return { start, end, days: Array.isArray(l.days) ? l.days.map(Number) : [] };
}
/* true se o atendimento [time, time+dur) encosta na faixa de almoço daquele dia. */
function inLunch(dateISO, timeMin, durMin) {
  const l = bizLunch(); if (!l) return false;
  const p = String(dateISO || '').split('-'); if (p.length !== 3) return false;
  const wd = new Date(+p[0], +p[1] - 1, +p[2]).getDay();
  const days = l.days.length ? l.days : bizHours().days;   // vazio = todos os dias de expediente
  if (!days.includes(wd)) return false;
  const ls = hhmmToMin(l.start), le = hhmmToMin(l.end);
  const te = timeMin + (+durMin || 60);
  return timeMin < le && ls < te;   // sobreposição da faixa do atendimento com o almoço
}
function isOpenDay(dateISO) {
  const p = String(dateISO || '').split('-'); if (p.length !== 3) return true;
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  return bizHours().days.includes(d.getDay());
}
/* Um horário só é válido se: for dia de atendimento, começar após a abertura
   e TERMINAR (início + duração) até o fechamento. */
function withinHours(dateISO, time, dur) {
  const h = bizHours();
  if (!isOpenDay(dateISO)) return { ok: false, reason: 'day' };
  const s = hhmmToMin(time), e = s + (+dur || 60);
  if (s < hhmmToMin(h.open)) return { ok: false, reason: 'before' };
  if (e > hhmmToMin(h.close)) return { ok: false, reason: 'after' };
  if (inLunch(dateISO, s, +dur || 60)) return { ok: false, reason: 'lunch' };
  return { ok: true };
}
/* Reservas feitas pelo link que ficaram penduradas (você não aceitou nem recusou)
   liberam o horário depois de 24h — evita a agenda entupir de pedido fantasma. */
const HOLD_TTL_MS = 24 * 60 * 60 * 1000;
function purgeExpiredHolds() {
  if (!state || !Array.isArray(state.appointments)) return false;
  const now = Date.now(), before = state.appointments.length;
  state.appointments = state.appointments.filter(a => !(a.pending && a.source === 'link' && a.hold && (now - a.hold) > HOLD_TTL_MS));
  return state.appointments.length !== before;
}
function slotConflict(date, time, dur, exceptId) {
  const s = hhmmToMin(time), e = s + (+dur || 60);
  return state.appointments.find(a => {
    if (a.status !== 'agendado' || a.date !== date || a.id === exceptId) return false;
    const bs = hhmmToMin(a.time), be = bs + apptDurMin(a);
    return s < be && bs < e;   // sobreposição de faixas de horário
  }) || null;
}
function modalAgenda(pre) {
  const p = pre || {};
  const slot = { iso: p.iso, time: p.time };
  if (!slot.iso || !slot.time) { const sg = suggestSlot(); slot.iso = slot.iso || sg.iso; slot.time = slot.time || sg.time; }
  const linkedCli = p.fromLink ? findClientByContact(p.cli, p.phone) : null;
  const opts = state.services.map(s => `<option value="${s.id}"${p.serviceId === s.id ? ' selected' : ''}>${esc(s.name)} — ${fmt(s.price)}</option>`).join('');
  const clopts = state.clients.map(c => `<option value="${esc(c.name)}">`).join('');
  const h = bizHours();
  openModal(p.editId ? 'Editar / remarcar horário' : 'Agendar atendimento', `
    ${p.fromLink ? `<div class="insight tone-violet" style="margin:0 0 12px;max-width:none"><div class="ins-ico" style="background:var(--tint)">📲</div><div><h4 style="margin:0">Pedido pelo seu link 💜</h4><p style="margin:2px 0 0">Confira os dados e toque em <b>Agendar</b> pra confirmar.${p.note ? '<br><b>Obs. da cliente:</b> ' + esc(p.note) : ''}<br>${linkedCli ? '✅ <b>Cliente já cadastrada:</b> ' + esc(linkedCli.name) + ' — vou vincular a esta ficha' : '✨ <b>Cliente nova</b> — vou cadastrar ao confirmar'}${p.phone ? ' · 📞 ' + esc(p.phone) : ''}</p></div></div>` : ''}
    <div class="field"><label>Cliente</label><input class="input" id="a_cli" list="adl" placeholder="Nome da cliente" value="${p.cli ? esc(p.cli) : ''}"/><datalist id="adl">${clopts}</datalist></div>
    <div class="field"><label>Serviço</label><select id="a_serv">${opts}</select></div>
    <div class="field-row"><div class="field"><label>Data</label><input class="input" id="a_date" type="date" value="${slot.iso}"/></div><div class="field"><label>Horário</label><input class="input" id="a_time" type="time" value="${slot.time}"/></div></div>
    <p class="muted" style="font-size:12.5px;margin:2px 2px 0">🕗 Expediente: ${h.open}–${h.close} · ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].filter((_, i) => h.days.includes(i)).join(', ')}</p>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="a_save">${p.editId ? 'Salvar mudança' : 'Agendar'}</button>`);
  $('#a_save').onclick = () => {
    const name = $('#a_cli').value.trim(); if (!name) return toast('Informe a cliente.', 'warn');
    const sv = state.services.find(s => s.id === $('#a_serv').value);
    const date = $('#a_date').value, time = $('#a_time').value;
    const dur = sv ? sv.dur : 60;
    // fora do expediente? o dono pode forçar (ele manda na própria agenda)
    const wh = withinHours(date, time, dur);
    if (!wh.ok) {
      const hh = bizHours();
      const lz = bizLunch();
      const msg = wh.reason === 'day'
        ? '⚠️ ' + dayName(date) + ' não é dia de atendimento (' + ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].filter((_, i) => hh.days.includes(i)).join(', ') + ').'
        : wh.reason === 'lunch'
        ? '🍽️ ' + time + ' cai no seu horário de almoço' + (lz ? ' (' + lz.start + '–' + lz.end + ')' : '') + ' — esse horário não aparece pras clientes.'
        : '⚠️ ' + time + ' está fora do expediente (' + hh.open + '–' + hh.close + ')' + (wh.reason === 'after' ? ' — o serviço terminaria depois do fechamento.' : '.');
      if (!confirm(msg + '\n\nAgendar assim mesmo?')) return;
    }
    const conf = slotConflict(date, time, dur, p.editId || null);
    if (conf) {
      const quem = (conf.clientName || 'outra cliente').split(' ')[0];
      if (!confirm('⚠️ Esse horário bate com ' + quem + ' às ' + conf.time + ' (' + conf.serviceName + ').\n\nAgendar assim mesmo?')) return;
    }
    // ----- EDIÇÃO / REMARCAÇÃO de um horário existente -----
    if (p.editId) {
      const a = state.appointments.find(x => x.id === p.editId);
      if (a) {
        const mudou = (a.date !== date || a.time !== time || a.serviceId !== (sv && sv.id));
        a.clientName = name; a.date = date; a.time = time;
        if (sv) { a.serviceId = sv.id; a.serviceName = sv.name; a.price = sv.price; }
        save(); closeModal(); render();
        if (mudou) offerReschedNotice(a); else toast('Agendamento atualizado ✨', 'ok');
      }
      return;
    }
    let cli = findClientByContact(name, p.phone);
    let novo = false;
    if (!cli) { cli = { id: 'c_' + uid(), name, phone: p.phone || '', notes: '', createdAt: todayISO() }; state.clients.push(cli); novo = true; }
    else if (p.phone && !cli.phone) { cli.phone = p.phone; }   // completa o telefone da ficha existente
    state.appointments.push({ id: uid(), date, time, serviceId: sv.id, serviceName: sv.name, clientId: cli.id, clientName: cli.name, price: sv.price, status: 'agendado' });
    save(); closeModal(); render();
    toast(novo ? 'Agendado 📅 — cliente nova cadastrada 💜' : 'Agendado 📅 — vinculado a ' + cli.name.split(' ')[0] + ' ✓', 'ok');
  };
}
/* Avisos SaaS → WhatsApp (sem Cloud API: abre o WhatsApp com a mensagem pronta,
   o dono só toca ENVIAR). Cobre remarcar (atualizar) e cancelar (rejeitar). */
function apptClientPhone(a) { const c = (state.clients || []).find(x => x.id === a.clientId); return c && c.phone ? c.phone : ''; }
function offerReschedNotice(a) {
  const phone = apptClientPhone(a);
  const first = (a.clientName || '').split(' ')[0];
  const biz = (state.business && state.business.name) || 'nosso espaço';
  const dataBR = a.date.split('-').reverse().join('/');
  const msg = `Oi ${first}! 💜 Seu horário na ${biz} foi atualizado: ${a.serviceName} agora no dia ${dataBR} às ${a.time}. Fica bom pra você? 😊`;
  openModal('Horário atualizado ✨', `<p>Avise <b>${esc(a.clientName)}</b> da mudança pra ela confirmar o novo horário:</p><p class="muted" style="font-size:13px">${esc(a.serviceName)} · ${dataBR} às ${a.time}</p>`,
    `<button class="btn btn-ghost" data-close>Depois</button><a class="btn btn-wa" href="${waLink(phone, msg)}" target="_blank" rel="noopener"${phone ? '' : ' title="Cliente sem telefone — escolha o contato no WhatsApp"'} data-close>📲 Avisar no WhatsApp</a>`);
}
function offerConfirmNotice(a) {
  const phone = apptClientPhone(a) || a.phone || '';
  const first = (a.clientName || '').split(' ')[0];
  const biz = (state.business && state.business.name) || 'nosso espaço';
  const dataBR = a.date.split('-').reverse().join('/');
  const msg = `Oi ${first}! ✅ Seu horário na ${biz} está confirmado: ${a.serviceName} dia ${dataBR} às ${a.time}. Te espero! 💜`;
  openModal('Pedido aceito ✅', `<p>Horário reservado pra <b>${esc(a.clientName)}</b>. Confirme com ela pelo WhatsApp:</p><p class="muted" style="font-size:13px">${esc(a.serviceName)} · ${dataBR} às ${a.time}</p>`,
    `<button class="btn btn-ghost" data-close>Depois</button><a class="btn btn-wa" href="${waLink(phone, msg)}" target="_blank" rel="noopener"${phone ? '' : ' title="Cliente sem telefone — escolha o contato no WhatsApp"'} data-close>📲 Confirmar no WhatsApp</a>`);
}
function modalCancelAppt(id) {
  const a = state.appointments.find(x => x.id === id); if (!a) return;
  const phone = apptClientPhone(a);
  const first = (a.clientName || '').split(' ')[0];
  const biz = (state.business && state.business.name) || 'nosso espaço';
  const dataBR = a.date.split('-').reverse().join('/');
  const msg = `Oi ${first}! Preciso cancelar seu horário na ${biz} (${a.serviceName} dia ${dataBR} às ${a.time}) 😔. Me chama que a gente remarca pra outro dia, tá? 💜`;
  openModal('Cancelar horário', `
    <p>Cancelar o horário de <b>${esc(a.clientName)}</b>?</p>
    <p class="muted" style="font-size:13px">${esc(a.serviceName)} · ${dataBR} às ${a.time}</p>
    <p class="muted">Antes de remover, avise a cliente pelo WhatsApp pra ela ficar sabendo. 😉</p>
  `, `<button class="btn btn-ghost" data-close>Voltar</button>
      <a class="btn btn-wa" href="${waLink(phone, msg)}" target="_blank" rel="noopener"${phone ? '' : ' title="Cliente sem telefone — escolha o contato no WhatsApp"'}>📲 Avisar no WhatsApp</a>
      <button class="btn btn-danger" id="cx_del">Remover da agenda</button>`);
  $('#cx_del').onclick = () => { state.appointments = state.appointments.filter(x => x.id !== id); save(); closeModal(); render(); toast('Horário cancelado.', 'info'); };
}
function modalItem(id) {
  const it = id ? state.inventory.find(i => i.id === id) : null;
  openModal(it ? '✏️ Editar item' : '📦 Novo item de estoque', `
    <div class="field"><label>Nome</label><input class="input" id="i_name" placeholder="Ex.: Esmalte vermelho" value="${it ? esc(it.name) : ''}"/></div>
    <div class="field-row"><div class="field"><label>Quantidade</label><input class="input" id="i_qty" type="number" step="0.01" value="${it ? it.qty : 0}"/></div><div class="field"><label>Unidade</label><input class="input" id="i_unit" value="${it ? esc(it.unit) : 'un'}"/></div></div>
    <div class="field-row"><div class="field"><label>Estoque mínimo</label><input class="input" id="i_min" type="number" step="0.01" value="${it ? it.min : 1}"/></div><div class="field"><label>Custo unit. (R$)</label><input class="input" id="i_cost" type="number" step="0.01" value="${it ? it.cost : 0}"/></div></div>
    <div class="field-row"><div class="field"><label>Categoria</label><input class="input" id="i_cat" value="${it ? esc(it.category) : 'Geral'}"/></div><div class="field"><label>Fornecedor</label><input class="input" id="i_sup" placeholder="Fornecedor" value="${it && it.supplier && it.supplier !== '—' ? esc(it.supplier) : ''}"/></div></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="i_save">Salvar</button>`);
  $('#i_save').onclick = () => {
    const name = $('#i_name').value.trim(); if (!name) return toast('Informe o nome.', 'warn');
    const data = { name, category: $('#i_cat').value.trim() || 'Geral', qty: +$('#i_qty').value, unit: $('#i_unit').value.trim() || 'un', min: +$('#i_min').value, cost: +$('#i_cost').value, supplier: $('#i_sup').value.trim() || '—' };
    if (it) { Object.assign(it, data); } else { state.inventory.push({ id: 'i_' + uid(), ...data, use: 0.05 }); }
    save(); closeModal(); render(); toast(it ? 'Item atualizado ✨' : 'Item adicionado ao estoque 📦', 'ok');
  };
}
function modalAsset() {
  openModal('Adicionar bem', `
    <div class="field"><label>Nome do bem</label><input class="input" id="b_name" placeholder="Ex.: Cabine UV/LED"/></div>
    <div class="field-row"><div class="field"><label>Valor (R$)</label><input class="input" id="b_val" type="number" step="0.01"/></div><div class="field"><label>Adquirido em</label><input class="input" id="b_date" type="date" value="${todayISO()}"/></div></div>
    <div class="field"><label>Categoria</label><input class="input" id="b_cat" value="Equipamento"/></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="b_save">Salvar</button>`);
  $('#b_save').onclick = () => {
    const name = $('#b_name').value.trim(), val = parseFloat($('#b_val').value);
    if (!name || !(val > 0)) return toast('Preencha nome e valor.', 'warn');
    state.assets.push({ id: uid(), name, category: $('#b_cat').value.trim() || 'Equipamento', value: val, acquiredAt: $('#b_date').value });
    save(); closeModal(); render(); toast('Bem adicionado ao patrimônio 🏛️', 'ok');
  };
}
/* Registrar (novo aporte) ou ATUALIZAR o valor atual (todo mês) de um investimento.
   Novo: opção de lançar a saída no caixa. Atualizar: só muda o valor + carimba a data. */
function modalInvestimento(id) {
  if (!state.investments) state.investments = [];
  const v = id ? state.investments.find(x => x.id === id) : null;
  const editing = !!v;
  openModal(editing ? '📈 Atualizar investimento' : '📈 Registrar investimento', `
    ${editing ? '' : '<p class="muted" style="margin:0 0 12px">Lance um valor que você já aplicou (Tesouro Selic, CDB, poupança…). Depois é só voltar aqui todo mês e atualizar o <b>valor atual</b> pra acompanhar o crescimento do seu patrimônio.</p>'}
    <div class="field"><label>Nome do investimento</label><input class="input" id="iv_name" placeholder="Ex.: Tesouro Selic 2029" value="${v ? esc(v.name) : ''}"/></div>
    <div class="field-row">
      <div class="field"><label>Valor atual (R$) <span class="muted" style="font-weight:400">— saldo de hoje</span></label><input class="input" id="iv_val" type="number" step="0.01" min="0" value="${v ? v.value : ''}"/></div>
      <div class="field"><label>Onde / tipo <span class="muted" style="font-weight:400">— opcional</span></label><input class="input" id="iv_place" placeholder="Ex.: Nubank, Tesouro Direto" value="${v && v.place ? esc(v.place) : ''}"/></div>
    </div>
    <div class="field"><label>Rende ~ (% ao ano) <span class="muted" style="font-weight:400">— estimativa pra calcular quanto rende por mês</span></label>
      <input class="input" id="iv_rate" type="number" step="0.1" min="0" max="200" value="${v ? investRate(v) : DEFAULT_INVEST_RATE}"/>
      <div class="row" id="iv_rate_presets" style="gap:6px;flex-wrap:wrap;margin-top:6px">
        <button type="button" class="btn btn-ghost btn-sm" data-rate="6">Poupança ~6%</button>
        <button type="button" class="btn btn-ghost btn-sm" data-rate="10.5">Tesouro/CDB ~10,5%</button>
        <button type="button" class="btn btn-ghost btn-sm" data-rate="13">CDB agressivo ~13%</button>
      </div>
    </div>
    ${editing
      ? `<p class="muted" style="font-size:12.5px;margin:2px 2px 0">Valor anterior: <b>${fmt(+v.value || 0)}</b> · atualizado em ${fmtDateFull(v.updatedAt)}</p>${investMonthsSince(v.updatedAt) >= 1 ? `<button type="button" class="btn btn-soft btn-sm" id="iv_useproj" style="margin-top:8px">📈 Usar projeção da taxa: ${fmt(investProjected(v))}</button>` : ''}`
      : `<label class="lunch-toggle" style="margin-top:4px"><input type="checkbox" id="iv_cash"/><span>💸 Esse dinheiro está saindo do meu caixa agora <span class="muted" style="font-weight:400">(lança uma saída no fluxo de caixa; desmarque se foi dinheiro de fora)</span></span></label>`}
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="iv_save">${editing ? 'Atualizar valor' : 'Registrar'}</button>`);
  $('#iv_rate_presets').querySelectorAll('button[data-rate]').forEach(b => b.onclick = () => { $('#iv_rate').value = b.dataset.rate; });
  const projBtn = $('#iv_useproj'); if (projBtn) projBtn.onclick = () => { $('#iv_val').value = investProjected(v).toFixed(2); };
  $('#iv_save').onclick = () => {
    const name = $('#iv_name').value.trim();
    const val = parseFloat($('#iv_val').value);
    const place = $('#iv_place').value.trim();
    const rate = (() => { const r = parseFloat($('#iv_rate').value); return isFinite(r) && r >= 0 ? Math.min(200, r) : DEFAULT_INVEST_RATE; })();
    if (!name || !(val >= 0)) return toast('Preencha nome e valor.', 'warn');
    if (editing) {
      v.name = name; v.value = +val.toFixed(2); v.place = place; v.rate = rate; v.updatedAt = todayISO();
    } else {
      state.investments.push({ id: uid(), name, place, value: +val.toFixed(2), rate, updatedAt: todayISO() });
      if ($('#iv_cash') && $('#iv_cash').checked && val > 0) {
        state.transactions.push({ id: uid(), type: 'out', category: 'Investimento', amount: +val.toFixed(2), desc: 'Aporte — ' + name, date: todayISO() });
      }
    }
    save(); closeModal(); render();
    toast(editing ? 'Valor atualizado 📈' : 'Investimento registrado no patrimônio 🏛️', 'ok');
  };
}
/* Resgatar/receber rendimento: tira do investimento e ENTRA no caixa (só quando o dinheiro cai na conta). */
function modalResgatar(id) {
  const v = (state.investments || []).find(x => x.id === id); if (!v) return;
  const val = +v.value || 0;
  const sugYield = Math.min(val, Math.round((investProjected(v) - val) * 100) / 100);   // rendimento acumulado desde a última atualização
  const sug = sugYield > 0 ? sugYield : Math.round(investMonthly(v) * 100) / 100;         // senão, o rendimento de ~1 mês
  openModal('💵 Resgatar / receber rendimento', `
    <p class="muted" style="margin:0 0 12px"><b>${esc(v.name)}</b> — valor atual <b>${fmt(val)}</b> · rende ≈ ${fmt(investMonthly(v))}/mês</p>
    <div class="field"><label>Quanto caiu na sua conta (R$) <span class="muted" style="font-weight:400">— o que você sacou</span></label><input class="input" id="rg_val" type="number" step="0.01" min="0" max="${val}" value="${sug > 0 ? sug : ''}"/></div>
    <div class="insight tone-blue" style="max-width:none"><div class="ins-ico" style="background:#e6effd">ℹ️</div><div><p style="margin:0">Isso <b>lança uma entrada no seu caixa</b> e reduz o valor investido no mesmo tanto. Use só quando o dinheiro <b>cair de verdade</b> na sua conta.</p></div></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="rg_save">Resgatar e lançar no caixa</button>`);
  $('#rg_save').onclick = () => {
    let amt = parseFloat($('#rg_val').value);
    if (!(amt > 0)) return toast('Informe o valor sacado.', 'warn');
    amt = Math.min(amt, val);                          // não pode sacar mais do que tem
    v.value = +(val - amt).toFixed(2); v.updatedAt = todayISO();
    state.transactions.push({ id: uid(), type: 'in', category: 'Rendimento de investimento', amount: +amt.toFixed(2), desc: 'Resgate — ' + v.name, date: todayISO() });
    save(); closeModal(); render();
    toast(fmt(amt) + ' resgatado e lançado no caixa 💵', 'ok');
  };
}
function modalRepor(id) {
  const it = state.inventory.find(i => i.id === id); if (!it) return;
  const price = it.cost;
  const sugQty = Math.max(it.min, Math.ceil(it.min * 2 - it.qty));
  openModal('Repor ' + esc(it.name), `
    <p class="muted" style="margin-bottom:12px">Estoque atual: <b>${it.qty} ${it.unit}</b> · mínimo ${it.min}${it.supplier && it.supplier !== '—' ? ` · fornecedor: <b>${esc(it.supplier)}</b>` : ''}</p>
    <div class="field-row"><div class="field"><label>Quantidade a comprar</label><input class="input" id="r_qty" type="number" step="0.01" value="${sugQty}"/></div><div class="field"><label>Preço unit. (R$)</label><input class="input" id="r_price" type="number" step="0.01" value="${price}"/></div></div>
    <div class="field"><label>Desconto (%) <span class="muted" style="font-weight:400">— opcional, ex.: promoção do fornecedor</span></label><input class="input" id="r_disc" type="number" step="0.01" min="0" max="100" value="0" placeholder="0"/></div>
    <div class="kv mt"><span>Total estimado</span><b id="r_total">${fmt(sugQty * price)}</b></div>
    <div class="kv" id="r_econ" style="display:none;color:#00b389"><span>💰 Você economiza</span><b>—</b></div>
    <label class="row" style="gap:8px;font-size:14px;margin-top:10px"><input type="checkbox" id="r_cash" checked style="width:auto"/> Lançar como saída no caixa</label>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="r_save">Confirmar compra</button>`);
  const reporDisc = () => Math.min(100, Math.max(0, +$('#r_disc').value || 0));
  const upd = () => {
    const q = +$('#r_qty').value || 0, p = +$('#r_price').value || 0, d = reporDisc();
    const full = q * p, total = full * (1 - d / 100);
    $('#r_total').textContent = fmt(total);
    const econ = $('#r_econ');
    if (d > 0 && full > 0) { econ.style.display = ''; econ.querySelector('b').textContent = fmt(full - total) + ' (' + (+d.toFixed(2)) + '% off)'; }
    else econ.style.display = 'none';
  };
  $('#r_qty').oninput = upd; $('#r_price').oninput = upd; $('#r_disc').oninput = upd;
  $('#r_save').onclick = () => {
    const q = +$('#r_qty').value, p = +$('#r_price').value, d = reporDisc();
    if (!(q > 0)) return toast('Informe a quantidade.', 'warn');
    const eff = +(p * (1 - d / 100)).toFixed(2);      // preço unit. já com desconto = o que foi pago
    const total = +(q * eff).toFixed(2);
    it.qty = +(it.qty + q).toFixed(2); it.cost = eff;
    if ($('#r_cash').checked) state.transactions.push({ id: uid(), type: 'out', category: 'Matéria-prima', amount: total, desc: 'Compra: ' + it.name + (d > 0 ? ' · −' + (+d.toFixed(2)) + '% desc' : ''), date: todayISO() });
    save(); closeModal(); render(); toast('Estoque reposto! +' + q + ' ' + it.unit + (d > 0 ? ' (−' + (+d.toFixed(2)) + '%)' : ''), 'ok');
  };
}
/* ---------- LISTA DE COMPRAS (salva na conta; sem compra automática) ----------
   O que chega no mínimo ENTRA SOZINHO na lista e sai quando é reposto.
   Não existe mais "comprar tudo": a compra real continua item a item no
   Repor (que atualiza estoque e lança a saída no caixa — regra de ouro). */
function syncShoppingList() {
  if (!state || !Array.isArray(state.inventory)) return [];
  if (!Array.isArray(state.shoppingList)) state.shoppingList = [];
  const lowIds = new Set(lowStock().map(i => i.id));
  const before = state.shoppingList.length;
  // sai da lista: item excluído do estoque ou já reposto (voltou acima do mínimo)
  state.shoppingList = state.shoppingList.filter(e => lowIds.has(e.itemId));
  // entra na lista: item que acabou de chegar no mínimo
  const inList = new Set(state.shoppingList.map(e => e.itemId));
  const added = [];
  lowStock().forEach(it => {
    if (inList.has(it.id)) return;
    const qty = Math.max(it.min, Math.ceil(it.min * 2 - it.qty));
    state.shoppingList.push({ id: 'sl_' + uid(), itemId: it.id, qty, done: false, addedAt: todayISO() });
    added.push(it.name);
  });
  if (added.length || state.shoppingList.length !== before) save();
  return added;
}
function modalListaCompras() {
  syncShoppingList();
  const rows = (state.shoppingList || []).map(e => {
    const it = state.inventory.find(i => i.id === e.itemId); if (!it) return null;
    const price = it.cost;
    return { e, it, price, sub: +(e.qty * price).toFixed(2) };
  }).filter(Boolean);
  if (!rows.length) { toast('Estoque saudável — nada na lista de compras ✅', 'ok'); return; }
  const falta = () => rows.filter(r => !r.e.done).reduce((s, r) => s + r.sub, 0);
  openModal('🛒 Lista de compras', `
    <p class="muted" style="margin-bottom:12px">Salva automaticamente na sua conta: o que chega no mínimo <b>entra sozinho</b> aqui e sai quando você repõe. Marque o que já comprou ✔️</p>
    ${rows.map(r => `
      <div class="shop-row ${r.e.done ? 'is-done' : ''}" id="row_${r.e.id}">
        <label class="row" style="gap:10px;flex:1;cursor:pointer;align-items:flex-start">
          <input type="checkbox" data-shop="${r.e.id}" ${r.e.done ? 'checked' : ''} style="width:auto;margin-top:3px"/>
          <span><b class="shop-name">${esc(r.it.name)}</b> — comprar ${r.e.qty} ${esc(r.it.unit)}
          <span class="muted" style="font-size:12.5px;display:block">tem ${r.it.qty}/${r.it.min} ${esc(r.it.unit)}${r.it.supplier && r.it.supplier !== '—' ? ' · ' + esc(r.it.supplier) : ''} · ${fmt(r.price)}/${esc(r.it.unit)} · ~${fmt(r.sub)}</span></span>
        </label>
        <button class="btn btn-soft btn-sm" data-act="repor-item" data-id="${r.it.id}">Repor</button>
      </div>`).join('')}
    <div class="kv mt" style="font-size:16px"><span>Falta comprar</span><b id="shopTotal" style="color:var(--violet)">${fmt(falta())}</b></div>
  `, `<button class="btn btn-ghost" data-close>Fechar</button>`);
  document.querySelectorAll('[data-shop]').forEach(cb => cb.onchange = () => {
    const e = state.shoppingList.find(x => x.id === cb.dataset.shop); if (!e) return;
    e.done = cb.checked; save();
    const rowEl = document.getElementById('row_' + e.id); if (rowEl) rowEl.classList.toggle('is-done', e.done);
    const t = document.getElementById('shopTotal'); if (t) t.textContent = fmt(falta());
  });
}
/* ---------- LINK PÚBLICO DE AGENDAMENTO (enxuto, sem Cloud API) ----------
   A cliente abre a página agendar.html, escolhe serviço/dia/horário e o pedido
   cai no WhatsApp do salão. Nada é gravado sem o dono confirmar → o agendamento
   entra "agendado" (pendente); estoque/receita só na conclusão. */
function bookingBaseUrl() {
  // agendar.html fica ao lado do index.html, na mesma pasta publicada
  return new URL('agendar.html', location.href).href.split('#')[0].split('?')[0];
}
function encodeBooking(obj) {
  // base64url do JSON em UTF-8 — só dados públicos (nome do salão, WhatsApp, serviços)
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeBooking(str) {
  try {
    let b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch (e) { return null; }
}
/* Consome o link "1 toque p/ agendar" (?ag=...) que veio da agendar.html:
   abre o modal de agendamento JÁ preenchido. NADA é gravado até o dono tocar
   "Agendar" → o atendimento entra pendente (status 'agendado'). */
function consumeBookingDeepLink() {
  const raw = new URLSearchParams(location.search).get('ag');
  if (!raw || !state) return;
  history.replaceState({}, '', location.pathname);   // limpa a URL (não reabre no refresh)
  const b = decodeBooking(raw);
  if (!b || !b.s) { toast('Não consegui ler esse pedido de agendamento. 😕', 'warn'); return; }
  const sv = (state.services || []).find(s => s.name.toLowerCase() === String(b.s).toLowerCase());
  modalAgenda({ iso: b.d, time: b.t, cli: b.n, phone: b.p, serviceId: sv ? sv.id : '', note: b.o, fromLink: true });
}
function bookingLink() {
  const wa = waPhone(state.business && state.business.whatsapp);
  if (!wa) return null;
  // Link CURTO e estável: a página busca os dados ao vivo pelo id do salão.
  // Curto = o WhatsApp linka a URL inteira; estável = sempre reflete os serviços atuais.
  if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) {
    return bookingBaseUrl() + '?s=' + currentUser.id;
  }
  // Fallback (ex.: demonstração sem login): embute os dados no próprio link.
  const svc = (state.services || []).map(s => [s.name, s.price, s.dur || 60]);
  const token = encodeBooking({ b: (state.business.name || bizWordPlain(true)), w: wa, s: svc, t: (state.business.theme === 'masc' ? 'masc' : 'fem'), seg: segmentKey() });
  return bookingBaseUrl() + '#' + token;
}
function modalLinkAgendamento() {
  const wa = waPhone(state.business && state.business.whatsapp);
  if (!wa) {
    openModal('🔗 Link de agendamento', `<p>Pra gerar seu link, cadastre primeiro o <b>WhatsApp ${term('the')}</b> — é pra lá que as clientes vão mandar os pedidos de horário.</p>`,
      `<button class="btn btn-ghost" data-close>Depois</button><button class="btn btn-primary" id="lk_cfg">Cadastrar WhatsApp agora</button>`);
    $('#lk_cfg').onclick = () => { closeModal(); modalBiz(); };
    return;
  }
  if (!(state.services || []).length) {
    openModal('🔗 Link de agendamento', `<p>Cadastre pelo menos um <b>serviço</b> antes de divulgar o link — é o que a cliente escolhe na hora de agendar.</p>`,
      `<button class="btn btn-ghost" data-close>Fechar</button><button class="btn btn-primary" id="lk_svc">Ir para o Catálogo</button>`);
    $('#lk_svc').onclick = () => { closeModal(); setView('servicos'); };
    return;
  }
  const link = bookingLink();
  const share = `Oi! ✨ Agende seu horário na ${state.business.name} por aqui, é rapidinho: ${link}`;
  openModal('🔗 Seu link de agendamento', `
    <p>Coloque esse link no seu <b>Instagram</b>, status do WhatsApp ou mande pras clientes. Elas escolhem serviço, dia e horário, e o pedido chega direto no seu WhatsApp <b>${fmtWa(wa)}</b> — você confirma e agenda. 😊</p>
    <div class="field"><label>Seu link</label><input class="input" id="lk_url" readonly value="${esc(link)}" onclick="this.select()"/></div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" id="lk_copy">📋 Copiar link</button>
      <a class="btn btn-soft btn-sm" href="${esc(link)}" target="_blank" rel="noopener">👀 Testar página</a>
      <a class="btn btn-wa btn-sm" href="${waLink(wa, share)}" target="_blank" rel="noopener">📲 Enviar pra mim</a>
    </div>
    <p class="muted" style="margin-top:12px;font-size:13px">🔗 O link é <b>curto e fixo</b> — pode divulgar à vontade. A página mostra sempre os seus serviços atuais.</p>
    <p class="muted" style="margin-top:6px;font-size:13px">💡 O pedido entra como <b>agendado</b> (pendente). O estoque só baixa e a receita só entra quando você marca o atendimento como <b>concluído</b> — nunca de um horário que a cliente ainda não compareceu.</p>
  `, `<button class="btn btn-ghost" data-close>Fechar</button>`);
  $('#lk_copy').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copiado! Cole no seu Instagram/status 💜', 'ok'); }
    catch (e) { const i = $('#lk_url'); i.select(); try { document.execCommand('copy'); } catch (_) {} toast('Link copiado!', 'ok'); }
  };
}
/* ---- Privacidade / PIN: seção de configuração + modais ---- */
function pinSectionHTML() {
  const on = pinIsSet();
  return `<hr style="border:none;border-top:1px solid var(--line);margin:8px 0 14px">
    <div class="field">
      <label>🔒 Privacidade — PIN das telas de dinheiro <span class="muted" style="font-weight:400">(Painel, Fluxo de caixa e Patrimônio)</span></label>
      <p class="muted" style="font-size:12.5px;margin:2px 0 8px">${on
        ? 'Proteção <b>ativada</b> ✅ — quem abrir essas 3 telas precisa do PIN de 6 dígitos.'
        : 'Ative pra esconder os valores de quem usa o sistema com você (ex.: secretária). Vai pedir um PIN de 6 dígitos pra ver.'}</p>
      ${on ? `
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-outline btn-sm" id="pin_change">Trocar PIN</button>
          <button type="button" class="btn btn-danger btn-sm" id="pin_remove">Desativar proteção</button>
        </div>` : `
        <div class="field-row">
          <div class="field"><label class="muted" style="font-weight:500;font-size:13px">Novo PIN (6 dígitos)</label><input class="input" id="pin_new" type="password" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="off"/></div>
          <div class="field"><label class="muted" style="font-weight:500;font-size:13px">Repita o PIN</label><input class="input" id="pin_new2" type="password" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="off"/></div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="pin_set">Ativar proteção com PIN</button>`}
      <div id="pin_msg" class="pin-err"></div>
    </div>`;
}
function bindPinSection() {
  const msg = () => $('#pin_msg');
  onlyPin($('#pin_new')); onlyPin($('#pin_new2'));
  if ($('#pin_set')) $('#pin_set').onclick = async () => {
    const a = ($('#pin_new').value || '').replace(/\D/g, ''), b2 = ($('#pin_new2').value || '').replace(/\D/g, '');
    if (a.length !== 6) return msg().textContent = 'O PIN precisa ter 6 dígitos.';
    if (a !== b2) return msg().textContent = 'Os dois PINs não são iguais.';
    state.security = { pinHash: await hashPin(a) }; privacyUnlocked = true; save();
    closeModal(); render(); toast('Proteção com PIN ativada 🔒', 'ok');
  };
  if ($('#pin_change')) $('#pin_change').onclick = modalPinChange;
  if ($('#pin_remove')) $('#pin_remove').onclick = modalPinRemove;
}
function modalPinChange() {
  openModal('Trocar PIN', `
    <div class="field"><label>PIN atual</label><input class="input" id="pc_old" type="password" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="off"/></div>
    <div class="field"><label>Novo PIN (6 dígitos)</label><input class="input" id="pc_new" type="password" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="off"/></div>
    <div class="field"><label>Repita o novo PIN</label><input class="input" id="pc_new2" type="password" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="off"/></div>
    <div id="pc_msg" class="pin-err"></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="pc_go">Salvar novo PIN</button>`);
  onlyPin($('#pc_old')); onlyPin($('#pc_new')); onlyPin($('#pc_new2'));
  $('#pc_go').onclick = async () => {
    const msg = $('#pc_msg');
    const old = $('#pc_old').value.replace(/\D/g, ''), a = $('#pc_new').value.replace(/\D/g, ''), b2 = $('#pc_new2').value.replace(/\D/g, '');
    if (!await verifyPin(old)) return msg.textContent = 'PIN atual incorreto.';
    if (a.length !== 6) return msg.textContent = 'O novo PIN precisa ter 6 dígitos.';
    if (a !== b2) return msg.textContent = 'Os dois novos PINs não são iguais.';
    state.security = { pinHash: await hashPin(a) }; privacyUnlocked = true; save();
    closeModal(); toast('PIN atualizado 🔒', 'ok');
  };
}
function modalPinRemove() {
  openModal('Desativar proteção', `
    <p class="muted" style="margin-top:0">Digite o PIN atual pra desativar. As telas de dinheiro voltam a ficar visíveis sem PIN.</p>
    <div class="field"><label>PIN atual</label><input class="input" id="pr_old" type="password" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="off"/></div>
    <div id="pr_msg" class="pin-err"></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-danger" id="pr_go">Desativar</button>`);
  onlyPin($('#pr_old'));
  $('#pr_go').onclick = async () => {
    const msg = $('#pr_msg');
    if (!await verifyPin($('#pr_old').value.replace(/\D/g, ''))) return msg.textContent = 'PIN incorreto.';
    state.security = { pinHash: '' }; privacyUnlocked = true; save();
    closeModal(); render(); toast('Proteção desativada.', 'info');
  };
}
// Esqueci o PIN: pra remover, confirma a SENHA DA CONTA (re-autentica no Supabase)
function modalPinForgot() {
  const email = (currentUser && currentUser.email) || '';
  openModal('Esqueci meu PIN', `
    <p class="muted" style="margin-top:0">Por segurança, pra remover o PIN confirme a senha da sua conta${email ? ' <b>' + esc(email) + '</b>' : ''}. Depois você cria um novo em Configurações do negócio.</p>
    <div class="field"><label>Senha da conta</label><input class="input" id="fpw" type="password" autocomplete="current-password" placeholder="Sua senha de login"/></div>
    <div id="fpwErr" class="pin-err"></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-danger" id="fpwGo">Remover PIN</button>`);
  $('#fpwGo').onclick = async () => {
    const pw = $('#fpw').value, err = $('#fpwErr'), btn = $('#fpwGo');
    if (!pw) return err.textContent = 'Digite sua senha.';
    if (!sb || !email) return err.textContent = 'Sem conexão pra validar agora. Tente mais tarde.';
    btn.disabled = true; btn.textContent = 'Validando…';
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) { err.textContent = 'Senha incorreta.'; btn.disabled = false; btn.textContent = 'Remover PIN'; return; }
    state.security = { pinHash: '' }; privacyUnlocked = true; save();
    closeModal(); render(); toast('PIN removido. Crie um novo em Configurações se quiser.', 'ok');
  };
}

function modalBiz() {
  const b = state.business;
  const curTheme = VALID_THEMES.includes(b.theme) ? b.theme : 'fem';
  const h = bizHours();
  const tz = b.timezone || DEFAULT_TZ;
  const diasLbl = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const lun = ((b.hours || {}).lunch && typeof (b.hours).lunch === 'object') ? b.hours.lunch : {};
  const lunOn = !!lun.on, lunStart = lun.start || '12:00', lunEnd = lun.end || '13:00';
  const lunDays = Array.isArray(lun.days) ? lun.days.map(Number) : [];
  const lunScope = lunDays.length ? 'some' : 'all';
  const tzOpts = [
    ['America/Sao_Paulo', 'Brasília (UTC−3) — SP, RJ, MG, Sul, Nordeste, DF'],
    ['America/Manaus', 'Amazônia (UTC−4) — AM, RO, RR, MT, MS'],
    ['America/Rio_Branco', 'Acre (UTC−5) — AC e oeste do AM'],
    ['America/Noronha', 'Fernando de Noronha (UTC−2)'],
  ];
  openModal('Configurações do negócio', `
    <div class="field"><label>Nome do negócio</label><input class="input" id="g_name" value="${esc(b.name)}"/></div>
    <div class="field"><label>🏷️ Ramo do negócio <span class="muted" style="font-weight:400">(adapta os textos e a página de agendamento ao seu segmento)</span></label>
      <select class="input" id="g_seg">${SEGMENT_ORDER.map(k => `<option value="${k}"${segmentKey() === k ? ' selected' : ''}>${SEGMENTS[k].icon} ${SEGMENTS[k].label}</option>`).join('')}</select>
    </div>
    <div class="field"><label>🎨 Tema do painel <span class="muted" style="font-weight:400">(identidade visual do sistema)</span></label>
      <div class="theme-pick" id="g_theme">
        <div class="tp ${curTheme === 'fem' ? 'on' : ''}" data-t="fem"><div class="tp-sw" style="background:linear-gradient(120deg,#f43f8e,#9b5de5)"></div><div class="tp-name">Rosa</div><div class="tp-sub">Beleza / Nails</div></div>
        <div class="tp ${curTheme === 'masc' ? 'on' : ''}" data-t="masc"><div class="tp-sw" style="background:linear-gradient(120deg,#2563eb,#1e3a8a)"></div><div class="tp-name">Azul</div><div class="tp-sub">Barbearia</div></div>
        <div class="tp ${curTheme === 'pet' ? 'on' : ''}" data-t="pet"><div class="tp-sw" style="background:linear-gradient(120deg,#22c55e,#047857)"></div><div class="tp-name">Verde</div><div class="tp-sub">Petshop</div></div>
        <div class="tp ${curTheme === 'ink' ? 'on' : ''}" data-t="ink"><div class="tp-sw" style="background:linear-gradient(120deg,#374151,#000)"></div><div class="tp-name">Preto</div><div class="tp-sub">Tattoo</div></div>
      </div>
    </div>
    <div class="field"><label>📲 WhatsApp ${term('the')} <span class="muted" style="font-weight:400">(pra receber os agendamentos das clientes)</span></label><input class="input" id="g_wa" inputmode="tel" placeholder="Ex.: (22) 99244-5995" value="${esc(b.whatsapp || '')}"/></div>
    <div class="field"><label>🕐 Fuso horário <span class="muted" style="font-weight:400">(base do "hoje" no caixa e na agenda)</span></label>
      <select class="input" id="g_tz">${tzOpts.map(([v, l]) => `<option value="${v}"${tz === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <p class="muted" style="font-size:12.5px;margin:6px 2px 0">🕐 Agora no fuso escolhido: <b id="g_tznow">—</b></p>
    </div>
    <div class="field"><label>🕗 Expediente <span class="muted" style="font-weight:400">(a agenda e o link só oferecem horários dentro dele)</span></label>
      <div class="field-row">
        <div class="field"><label class="muted" style="font-weight:500;font-size:13px">Abre às</label><input class="input" id="g_open" type="time" value="${h.open}"/></div>
        <div class="field"><label class="muted" style="font-weight:500;font-size:13px">Fecha às</label><input class="input" id="g_close" type="time" value="${h.close}"/></div>
        <div class="field"><label class="muted" style="font-weight:500;font-size:13px">Intervalo</label><select class="input" id="g_slot">${[15, 30, 45, 60].map(m => `<option value="${m}"${h.slot === m ? ' selected' : ''}>${m} min</option>`).join('')}</select></div>
      </div>
      <div class="row" id="g_days" style="gap:6px;flex-wrap:wrap;margin-top:8px">
        ${diasLbl.map((d, i) => `<button type="button" class="btn btn-sm ${h.days.includes(i) ? 'btn-primary' : 'btn-ghost'}" data-d="${i}">${d}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>🍽️ Horário de almoço / pausa <span class="muted" style="font-weight:400">(esse horário some da agenda — ninguém consegue marcar nele)</span></label>
      <label class="lunch-toggle"><input type="checkbox" id="g_lunch_on"${lunOn ? ' checked' : ''}/><span>Tenho um horário de almoço/pausa fixo</span></label>
      <div id="g_lunch_box"${lunOn ? '' : ' style="display:none"'}>
        <div class="field-row">
          <div class="field"><label class="muted" style="font-weight:500;font-size:13px">Começa às</label><input class="input" id="g_lunch_start" type="time" value="${lunStart}"/></div>
          <div class="field"><label class="muted" style="font-weight:500;font-size:13px">Volta às</label><input class="input" id="g_lunch_end" type="time" value="${lunEnd}"/></div>
          <div class="field"><label class="muted" style="font-weight:500;font-size:13px">Vale em</label>
            <select class="input" id="g_lunch_scope"><option value="all"${lunScope === 'all' ? ' selected' : ''}>Todos os dias (toda semana)</option><option value="some"${lunScope === 'some' ? ' selected' : ''}>Só em dias específicos</option></select>
          </div>
        </div>
        <div class="row" id="g_lunch_days" style="gap:6px;flex-wrap:wrap;margin-top:4px;${lunScope === 'some' ? '' : 'display:none'}">
          ${diasLbl.map((d, i) => `<button type="button" class="btn btn-sm ${lunDays.includes(i) ? 'btn-primary' : 'btn-ghost'}" data-d="${i}">${d}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="field-row"><div class="field"><label>Reserva de emergência alvo (R$)</label><input class="input" id="g_res" type="number" value="${b.reserveTarget}"/></div><div class="field"><label>Meta de faturamento mensal (R$)</label><input class="input" id="g_goal" type="number" value="${b.monthlyGoal}"/></div></div>
    ${pinSectionHTML()}
    <hr style="border:none;border-top:1px solid var(--line);margin:8px 0 14px">
    <button class="btn btn-danger btn-sm" id="g_reset">↺ Restaurar dados de demonstração</button>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="g_save">Salvar</button>`);
  bindPinSection();
  $('#g_theme').querySelectorAll('.tp').forEach(c => c.onclick = () => { $('#g_theme').querySelectorAll('.tp').forEach(x => x.classList.toggle('on', x === c)); applyTheme(c.dataset.t); });
  $('#g_days').querySelectorAll('button[data-d]').forEach(btn => btn.onclick = () => { btn.classList.toggle('btn-primary'); btn.classList.toggle('btn-ghost'); });
  // almoço: liga/desliga a caixa, alterna "dias específicos", e chips clicáveis
  const lunchBox = $('#g_lunch_box'), lunchDaysRow = $('#g_lunch_days'), lunchScope = $('#g_lunch_scope');
  $('#g_lunch_on').onchange = e => { lunchBox.style.display = e.target.checked ? '' : 'none'; };
  lunchScope.onchange = () => { lunchDaysRow.style.display = lunchScope.value === 'some' ? '' : 'none'; };
  lunchDaysRow.querySelectorAll('button[data-d]').forEach(btn => btn.onclick = () => { btn.classList.toggle('btn-primary'); btn.classList.toggle('btn-ghost'); });
  // relógio ao vivo do fuso escolhido (atualiza no dropdown e a cada 20s)
  const tzNow = () => {
    const sel = $('#g_tz').value;
    try {
      const hora = new Intl.DateTimeFormat('en-GB', { timeZone: sel, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      $('#g_tznow').textContent = fmtDateFull(isoInTZ(new Date(), sel)) + ' · ' + hora;
    } catch (_) { $('#g_tznow').textContent = '—'; }
  };
  $('#g_tz').onchange = tzNow; tzNow();
  const tzTimer = setInterval(() => { if (!$('#g_tznow')) return clearInterval(tzTimer); tzNow(); }, 20000);
  $('#g_save').onclick = () => {
    const _th = $('#g_theme .tp.on'); b.theme = _th && VALID_THEMES.includes(_th.dataset.t) ? _th.dataset.t : 'fem';
    const _sg = $('#g_seg'); if (_sg && SEGMENTS[_sg.value]) b.segment = _sg.value;   // ramo do negócio (adapta os textos)
    b.name = $('#g_name').value.trim() || b.name; b.reserveTarget = +$('#g_res').value || b.reserveTarget; b.monthlyGoal = +$('#g_goal').value || b.monthlyGoal;
    b.whatsapp = waPhone($('#g_wa').value);
    b.timezone = $('#g_tz').value || DEFAULT_TZ;
    const days = [...$('#g_days').querySelectorAll('button[data-d]')].filter(x => x.classList.contains('btn-primary')).map(x => +x.dataset.d);
    const lunchOn = $('#g_lunch_on').checked;
    const lScope = $('#g_lunch_scope').value;
    const lDays = lScope === 'some' ? [...$('#g_lunch_days').querySelectorAll('button[data-d]')].filter(x => x.classList.contains('btn-primary')).map(x => +x.dataset.d) : [];
    b.hours = { open: $('#g_open').value || '09:00', close: $('#g_close').value || '19:00', days: days.length ? days : [1, 2, 3, 4, 5, 6], slot: +$('#g_slot').value || 30, lunch: { on: lunchOn, start: $('#g_lunch_start').value || '12:00', end: $('#g_lunch_end').value || '13:00', days: lDays } };
    save(); closeModal(); render(); toast('Configurações salvas.', 'ok');
  };
  $('#g_reset').onclick = () => { if (confirm('Isso substitui seus dados pelos de demonstração. Continuar?')) { state = seed(); save(); closeModal(); render(); toast('Dados de demonstração carregados.', 'info'); } };
}

/* ============================================================
   AÇÕES GLOBAIS (delegação)
   ============================================================ */
const ACTIONS = {
  'new-atendimento': modalAtendimento,
  'new-entrada': () => modalTx('in'),
  'new-saida': () => modalTx('out'),
  'new-cliente': modalCliente,
  'new-agenda': () => modalAgenda(),
  'link-agenda': () => { if (!autoAgendaOk()) { modalGoldAgenda(); return; } modalLinkAgendamento(); },
  'new-servico': () => modalServico(),
  'edit-servico': (id) => modalServico(id),
  'del-servico': (id) => { if (confirm('Excluir este serviço?')) { state.services = state.services.filter(s => s.id !== id); save(); render(); toast('Serviço removido.', 'info'); } },
  'new-item': modalItem,
  'new-asset': modalAsset,
  'new-invest': () => modalInvestimento(),
  'edit-invest': (id) => modalInvestimento(id),
  'resgatar-invest': (id) => modalResgatar(id),
  'del-invest': (id) => { if (confirm('Remover este investimento do patrimônio?')) { state.investments = (state.investments || []).filter(v => v.id !== id); save(); render(); toast('Investimento removido.', 'info'); } },
  'como-investir': modalComoInvestir,
  'gerar-pedido': modalListaCompras,
  'go-estoque': () => setView('estoque'),
  'go-patrimonio': () => setView('patrimonio'),
  'go-agenda': () => { closeModal(); setView('agenda'); },
  'go-clientes': () => { closeModal(); setView('clientes'); },
  'central-avisos': () => modalCentralAvisos(),
  'assinar': () => showSubGate(),
  'go-gold': () => modalGoldAgenda(),
  'repor-item': (id) => modalRepor(id),
  'edit-item': (id) => modalItem(id),
  'del-item': (id) => { const it = state.inventory.find(i => i.id === id); if (it && confirm('Excluir "' + it.name + '" do estoque?')) { state.inventory = state.inventory.filter(i => i.id !== id); save(); render(); toast('Item removido do estoque.', 'info'); } },
  'done-appt': (id) => modalDoneAppt(id),
  'edit-appt': (id) => { const a = state.appointments.find(x => x.id === id); if (a) modalAgenda({ editId: id, iso: a.date, time: a.time, cli: a.clientName, serviceId: a.serviceId }); },
  'accept-appt': (id) => {
    const a = state.appointments.find(x => x.id === id); if (!a) return;
    // vincula (ou cria) a ficha da cliente a partir do nome + telefone do pedido
    let cli = findClientByContact(a.clientName, a.phone);
    if (!cli) { cli = { id: 'c_' + uid(), name: a.clientName, phone: a.phone || '', notes: '', createdAt: todayISO() }; state.clients.push(cli); }
    else if (a.phone && !cli.phone) { cli.phone = a.phone; }
    a.clientId = cli.id; a.clientName = cli.name; a.pending = false;
    save(); render(); toast('Pedido aceito ✅ — vinculado a ' + cli.name.split(' ')[0], 'ok');
    offerConfirmNotice(a);
  },
  'cancel-appt': (id) => modalCancelAppt(id),
  'del-appt': (id) => { state.appointments = state.appointments.filter(a => a.id !== id); save(); render(); toast('Agendamento removido.', 'info'); },
  'edit-tx': (id) => modalTx(null, id),
  'del-tx': (id) => { state.transactions = state.transactions.filter(t => t.id !== id); save(); render(); toast('Lançamento excluído.', 'info'); },
  'edit-cliente': (id) => modalCliente(id),
  'del-cliente': (id) => { const c = state.clients.find(x => x.id === id); if (c && confirm('Excluir a ficha de "' + c.name + '"? O histórico de atendimentos dela continua no caixa.')) { state.clients = state.clients.filter(x => x.id !== id); save(); render(); toast('Cliente removida.', 'info'); } },
  'del-asset': (id) => { state.assets = state.assets.filter(a => a.id !== id); save(); render(); toast('Bem removido.', 'info'); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACTIONS[el.dataset.act]; if (fn) fn(el.dataset.id);
});

/* ============================================================
   AUTENTICAÇÃO (tela de login / cadastro)
   ============================================================ */
let authMode = 'login';
function showAuth(mode) {
  setAuthMode(mode || 'login');
  $('#landing').hidden = true; $('#app').hidden = true; $('#authScreen').hidden = false;
  $('#auErr').hidden = true; document.body.style.background = '';
  refreshAuthTheme();
  window.scrollTo(0, 0);
}
function refreshAuthTheme() {
  const saved = savedThemePref() || 'fem';
  applyTheme(saved);
  const box = $('#au_theme'); if (box) box.querySelectorAll('.tp').forEach(c => c.classList.toggle('on', c.dataset.t === saved));
  const note = $('#authThemeNote'); if (note) note.classList.toggle('first', !themeChosen());
  if (!themeChosen()) toast('Rosa ou Azul? Toque na cor que você prefere logo acima. ↑', 'info');
}
function setAuthMode(mode) {
  authMode = mode;
  $$('#authScreen [data-auth-tab]').forEach(b => b.classList.toggle('on', b.dataset.authTab === mode));
  $$('#authScreen [data-only="signup"]').forEach(el => el.hidden = (mode !== 'signup'));
  $('#auSubmit').textContent = mode === 'signup' ? 'Criar minha conta' : 'Entrar';
  $('[data-auth-tab-text]').textContent = mode === 'signup' ? 'Já tem conta?' : 'Ainda não tem conta?';
  $('#auSwitch').textContent = mode === 'signup' ? 'Entrar' : 'Criar conta';
}
function authErr(m) { const e = $('#auErr'); e.textContent = m; e.hidden = false; }
function traduzErro(m) {
  m = (m || '').toLowerCase();
  if (m.includes('invalid login')) return 'Email ou senha incorretos.';
  if (m.includes('already')) return 'Esse email já tem conta. Tente entrar.';
  if (m.includes('password')) return 'Senha inválida (mínimo 6 caracteres).';
  if (m.includes('email')) return 'Email inválido.';
  if (m.includes('fetch') || m.includes('network')) return 'Sem conexão com a internet.';
  return 'Não consegui completar. Tente novamente.';
}
function wireAuth() {
  $$('#authScreen [data-auth-tab]').forEach(b => b.onclick = () => setAuthMode(b.dataset.authTab));
  $('#auSwitch').onclick = e => { e.preventDefault(); setAuthMode(authMode === 'signup' ? 'login' : 'signup'); };
  $$('[data-auth-back]').forEach(b => b.onclick = () => exitApp());
  $('#authForm').addEventListener('submit', onAuthSubmit);
  // Seletor de TIPO DE NEGÓCIO no cadastro (ícone colorido por ramo). Ao escolher,
  // já pré-visualiza a cor; no signup grava o segmento + a cor do ramo escolhido.
  const segBox = $('#au_seg');
  if (segBox) {
    segBox.innerHTML = SEGMENT_ORDER.map((k, i) => { const s = SEGMENTS[k]; return `<button type="button" class="segp${i === 0 ? ' on' : ''}" data-seg="${k}" data-t="${s.theme}" style="--segc:${s.color}"><span class="segp-ic">${s.svg}</span><span class="segp-tx">${s.label}</span></button>`; }).join('');
    const setBizPh = k => { const inp = $('#auBiz'); if (inp && SEGMENTS[k] && SEGMENTS[k].namePh) inp.placeholder = SEGMENTS[k].namePh; };
    setBizPh(SEGMENT_ORDER[0]);   // exemplo do nome já combina com o ramo pré-selecionado
    segBox.querySelectorAll('.segp').forEach(b => b.onclick = () => {
      segBox.querySelectorAll('.segp').forEach(x => x.classList.toggle('on', x === b));
      applyTheme(b.dataset.t);
      setBizPh(b.dataset.seg);   // o placeholder do "Nome do seu negócio" acompanha o ramo
      try { localStorage.setItem(THEME_CHOSEN_KEY, '1'); } catch (e) {}
      const note = $('#authThemeNote'); if (note) note.classList.remove('first');
    });
  }
}
async function onAuthSubmit(e) {
  e.preventDefault();
  if (!sb) return authErr('Serviço indisponível (sem internet?).');
  const email = $('#auEmail').value.trim(), pass = $('#auPass').value, biz = $('#auBiz').value.trim();
  if (!email || !pass) return authErr('Preencha email e senha.');
  if (pass.length < 6) return authErr('A senha precisa ter ao menos 6 caracteres.');
  const btn = $('#auSubmit'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Aguarde…';
  try {
    if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { business_name: biz || 'Meu Negócio' } } });
      if (error) throw error;
      if (!data.session) { const r = await sb.auth.signInWithPassword({ email, password: pass }); if (r.error) throw r.error; currentUser = r.data.user; }
      else currentUser = data.user;
      await cloudLoad();
      // ramo escolhido no cadastro → define o segmento E a cor do painel (rosa/azul/verde)
      const selSeg = document.querySelector('#au_seg .segp.on');
      const _seg = selSeg && SEGMENTS[selSeg.dataset.seg] ? selSeg.dataset.seg : null;
      const _th = _seg ? SEGMENTS[_seg].theme : savedThemePref();
      if (state) {
        if (biz) state.business.name = biz;
        if (_seg) state.business.segment = _seg;
        if (_th) state.business.theme = _th;
        save();
      }
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      currentUser = data.user;
    }
    await enterApp();
  } catch (err) {
    authErr(traduzErro(err && err.message));
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}
async function logout() {
  if (demoMode) { exitDemo(); return; }
  unsubscribeTenantRealtime();
  try { await sb.auth.signOut(); } catch (e) {}
  currentUser = null; state = null; lastCloudStamp = null;
  $('#app').hidden = true; $('#authScreen').hidden = true; $('#subScreen').hidden = true; $('#landing').hidden = false;
  document.body.style.background = ''; window.scrollTo(0, 0);
  toast('Você saiu da conta.', 'info');
}

/* ============================================================
   ASSINATURA (Stripe) — trava de acesso (sem teste grátis)
   ============================================================ */
let subInfo = null;
let subBilling = 'mes';
async function loadSubscription() {
  if (!sb || !currentUser) { subInfo = null; return; }
  const { data } = await sb.from('subscriptions').select('status,plan,current_period_end').eq('user_id', currentUser.id).maybeSingle();
  subInfo = data || { status: 'inactive' };
}
function accessNotExpired() {
  if (!subInfo) return false;
  if (subInfo.stripe_subscription_id) return true;       // cartão recorrente: status manda
  if (subInfo.current_period_end) return new Date(subInfo.current_period_end).getTime() > Date.now(); // pix/avulso: vence
  return true;
}
function subActive() { return !!(subInfo && ['active', 'trialing', 'pix'].includes(subInfo.status) && accessNotExpired()); }
/* Teste grátis: 24h a partir da criação da conta (created_at). Não reseta ao relogar. */
const TRIAL_MS = 24 * 60 * 60 * 1000;
function trialInfo() {
  if (!currentUser || !currentUser.created_at) return null;
  const start = new Date(currentUser.created_at).getTime();
  if (isNaN(start)) return null;
  const msLeft = start + TRIAL_MS - Date.now();
  return { msLeft, active: msLeft > 0, hoursLeft: Math.max(1, Math.ceil(msLeft / 3600000)) };
}
// Acesso revogado pelo dono no painel (assinatura marcada como 'canceled') corta
// TAMBÉM o teste grátis — senão quem ainda está dentro das 24h continuaria entrando.
function accessRevoked() { return !!(subInfo && subInfo.status === 'canceled'); }
function trialActive() { const t = trialInfo(); return !!(t && t.active) && !accessRevoked(); }
function hasAccess() { return subActive() || trialActive(); }
/* --- Agendamento automático (link + reserva na hora) é exclusivo do GOLD.
   Cortesia de lançamento para as primeiras contas até 03/08/2026 (interna, sem anúncio na UI). --- */
const AUTO_AGENDA_EARLY = ['c81920e0-9b26-438e-9cc6-f33e123b8094', '3a3adca8-c0fa-4b00-bf70-c38c497d8d3d', 'd737472f-8dff-4751-9945-ad724c1ba401'];
const AUTO_AGENDA_EARLY_UNTIL = '2026-08-03';
function goldActive() { return subActive() && /^gold/.test(String((subInfo && subInfo.plan) || '')); }
function silverActive() { return subActive() && /^silver/.test(String((subInfo && subInfo.plan) || '')); }
/* SILVER ganha o agendamento automático (recurso do GOLD) só no 1º mês — 30 dias
   contados a partir de quando o SILVER começou (state.business.silverSince). Depois
   disso, só voltando pro GOLD. */
const SILVER_AGENDA_DAYS = 30;
function silverAgendaInfo() {
  if (!silverActive()) return null;
  const since = state && state.business && state.business.silverSince;
  const start = since ? new Date(since).getTime() : Date.now();   // ainda não marcado = começa hoje
  const elapsed = isNaN(start) ? 0 : Math.floor((Date.now() - start) / 86400000);
  const dayNum = Math.min(SILVER_AGENDA_DAYS, elapsed + 1);        // "dia X de 30"
  return { dayNum, daysLeft: Math.max(0, SILVER_AGENDA_DAYS - dayNum), active: elapsed < SILVER_AGENDA_DAYS };
}
// grava o início do SILVER na 1ª vez que detectamos o plano ativo (fonte da verdade dos 30 dias)
function markSilverSince() {
  if (!state || !state.business) return;
  if (silverActive() && !state.business.silverSince) { state.business.silverSince = new Date().toISOString(); save(); }
}
function autoAgendaOk() {
  if (demoMode || isAdmin() || goldActive()) return true;
  if (currentUser && AUTO_AGENDA_EARLY.includes(currentUser.id) && todayISO() < AUTO_AGENDA_EARLY_UNTIL) return true;
  const sa = silverAgendaInfo();                 // SILVER: liberado no 1º mês (30 dias)
  return !!(sa && sa.active);
}
/* Upsell do GOLD — aparece sempre que alguém sem o plano tenta usar a agenda automática */
function modalGoldAgenda() {
  let bill = 'mes';
  const silver = subActive() && /^silver/.test(String((subInfo && subInfo.plan) || ''));
  const priceHTML = (b) => b === 'ano'
    ? 'R$ 949,00 <small style="font-size:14px;color:var(--ink-3);font-weight:600">/ano — plano GOLD</small>'
    : 'R$ 99,90 <small style="font-size:14px;color:var(--ink-3);font-weight:600">/mês — plano GOLD</small>';
  openModal('🔒 Agendamento automático das clientes no WhatsApp', `
    <div style="font-size:11px;font-weight:800;letter-spacing:.06em;color:#d6336c;text-transform:uppercase;margin-bottom:8px">✨ Recurso exclusivo do plano GOLD</div>
    <h3 style="font-family:var(--display);font-size:23px;line-height:1.18;margin:0 0 10px">Sua cliente agenda sozinha, direto pelo WhatsApp.</h3>
    <p class="muted" style="margin:0 0 12px">Ative o link de agendamento: ele mostra seus serviços, consulta sua agenda em tempo real e reserva o horário na hora — sem você precisar responder. E o melhor: assim que o atendimento acontece, a receita já entra no seu fluxo de caixa, como sempre.</p>
    <ul style="list-style:none;padding:0;margin:0 0 14px;font-size:13.5px;display:flex;flex-direction:column;gap:6px">
      <li>✔️ Fluxo de caixa, clientes, agenda e estoque</li>
      <li>✔️ Alertas de estoque e lista de compras automática</li>
      <li>✔️ Assistente inteligente (respostas sobre seus números)</li>
      <li>✨ <b>Agendamento automático das clientes</b></li>
    </ul>
    <div class="bill-toggle" id="gg_bill" style="margin:0 0 10px">
      <button type="button" class="bt on" data-bill="mes">Mensal</button>
      <button type="button" class="bt" data-bill="ano">Anual <span class="save-pill">2 meses grátis</span></button>
    </div>
    <div style="font-family:var(--display);font-weight:800;font-size:28px" id="gg_price">${priceHTML('mes')}</div>
    ${silver ? '<p class="muted" style="margin:8px 0 0">Você já está no SILVER — o upgrade mantém tudo que você já usa e libera o resto.</p>' : ''}
    <p class="muted" style="margin:10px 0 0;font-size:12px">🔒 Cartão (Stripe) ou Pix · cancele quando quiser</p>
  `, `<button class="btn btn-ghost" data-close>Agora não</button><button class="btn btn-primary" id="gg_go">Assinar GOLD e ativar →</button>`);
  $('#gg_bill').querySelectorAll('button[data-bill]').forEach(b => b.onclick = () => {
    bill = b.dataset.bill;
    $('#gg_bill').querySelectorAll('.bt').forEach(x => x.classList.toggle('on', x === b));
    $('#gg_price').innerHTML = priceHTML(bill);
  });
  $('#gg_go').onclick = () => startCheckout(bill === 'ano' ? 'gold_anual' : 'gold_mensal', $('#gg_go'));
}
function vencInfo() {
  if (!subInfo || !subInfo.current_period_end) return null;
  const end = new Date(subInfo.current_period_end);
  return { end, days: Math.ceil((end.getTime() - Date.now()) / 86400000), recorrente: !!subInfo.stripe_subscription_id };
}
function vencBannerHTML() {
  if (isAdmin()) return '';
  if (!subActive() && trialActive()) {
    const t = trialInfo();
    return `<div class="venc-bar tone-amber"><span>🎁 <b>Teste grátis</b> · termina em ${t.hoursLeft}h — aproveite pra assinar</span><button class="btn btn-soft btn-sm" data-act="assinar" style="margin-left:auto">Assinar agora</button></div>`;
  }
  if (!hasAccess()) return '';
  const v = vencInfo(); if (!v) return '';
  const tone = v.days <= 5 ? 'amber' : 'violet';
  const verbo = v.recorrente ? 'Renova automaticamente em' : 'Seu acesso vence em';
  const acao = (!v.recorrente && v.days <= 10) ? '<button class="btn btn-soft btn-sm" data-act="assinar" style="margin-left:auto">Renovar</button>' : '';
  return `<div class="venc-bar tone-${tone}"><span>⏳ ${verbo} <b>${v.days} dia(s)</b> · ${v.end.toLocaleDateString('pt-BR')}</span>${acao}</div>`;
}
async function pollSub(n) { for (let i = 0; i < n; i++) { await new Promise(r => setTimeout(r, 1500)); await loadSubscription(); if (subActive()) return; } }
function updatePlanChip() { const c = $('#sbPlanChip'); if (!c) return; if (subActive()) { const tier = subInfo.plan ? subInfo.plan.split('_')[0].toUpperCase() : 'ativo'; c.textContent = 'Plano ' + tier + (subInfo.status === 'pix' ? ' · Pix' : ''); } else if (trialActive()) { c.textContent = '🎁 Teste · ' + trialInfo().hoursLeft + 'h'; } else c.textContent = 'Sem plano'; }
function showSubGate() {
  // Na demonstração (ou deslogado) não dá pra assinar — manda criar a conta.
  if (demoMode) { toast('Crie sua conta gratuita pra assinar 💜', 'info'); demoSignup(); return; }
  if (!currentUser) { showAuth('signup'); return; }
  $('#landing').hidden = true; $('#authScreen').hidden = true; $('#app').hidden = true; $('#subScreen').hidden = false;
  document.body.style.background = '';
  const msg = $('#subTrialMsg'); if (msg) { const t = trialInfo(); const pre = (currentUser ? currentUser.email + ' · ' : ''); msg.textContent = pre + (t && !t.active ? 'Seu teste grátis de 24h terminou. Assine para continuar.' : 'Assine um plano para acessar o painel.'); }
  window.scrollTo(0, 0);
}
let pixTier = 'silver';
const PIX_VAL = { silver_mensal: 'R$ 49,90', silver_anual: 'R$ 490,00', gold_mensal: 'R$ 99,90', gold_anual: 'R$ 949,00' };
const OWNER_WA = (window.BELACAIXA_CFG && window.BELACAIXA_CFG.whatsapp) || '5522992445995';
function fmtWa(n) { const d = String(n).replace(/\D/g, '').replace(/^55/, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : n; }
function pixWaHref(ticket) {
  const email = (currentUser && currentUser.email) || '';
  const msg = `Olá! Segue o comprovante do meu Pix do BelaCaixa.\nTicket: ${ticket || '(vou gerar)'}\nPlano: ${currentPixPlan()}\nEmail: ${email}`;
  return `https://wa.me/${OWNER_WA}?text=${encodeURIComponent(msg)}`;
}
function currentPixPlan() { return pixTier + '_' + (subBilling === 'ano' ? 'anual' : 'mensal'); }
function updatePixAmount() {
  const p = currentPixPlan();
  const v = $('#pixValor'), per = $('#pixPeriodo');
  if (v) v.textContent = PIX_VAL[p];
  if (per) per.textContent = subBilling === 'ano' ? '/ano (à vista)' : '/mês';
  const num = $('#pixWaNum'); if (num) num.textContent = fmtWa(OWNER_WA);
  const link = $('#pixWaLink'); if (link) link.href = pixWaHref('');
}
async function pixClaim() {
  if (demoMode || !currentUser) { toast('Crie sua conta gratuita pra usar o Pix 💜', 'info'); demoSignup(); return; }
  const btn = $('#pixDone'); if (btn) { btn.disabled = true; btn.dataset.old = btn.textContent; btn.textContent = 'Gerando ticket…'; }
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(window.BELACAIXA_CFG.url + '/functions/v1/pix-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token, apikey: window.BELACAIXA_CFG.anon },
      body: JSON.stringify({ plan: currentPixPlan() })
    });
    const j = await res.json();
    if (j.ok && j.pending) { showPixTicket(j.ticket); return; }
    toast('Não consegui registrar seu Pix. ' + (j.error || ''), 'warn');
  } catch (e) { toast('Erro ao registrar o Pix.', 'warn'); }
  if (btn) { btn.disabled = false; if (btn.dataset.old) btn.textContent = btn.dataset.old; }
}
function showPixTicket(ticket) {
  const panel = $('#pixPanel'); if (!panel) return;
  panel.hidden = false;
  panel.innerHTML = `
    <div class="pix-head">
      <span style="font-size:34px">🎟️</span>
      <div><b>Ticket gerado!</b><div class="muted">Falta só validarmos seu comprovante</div></div>
    </div>
    <div class="pix-ticket"><span class="muted">Seu ticket</span><div class="pix-ticket-code">${esc(ticket)}</div></div>
    <p class="pix-ticket-msg">Agora envie o <b>comprovante</b> do Pix pelo WhatsApp <b>${fmtWa(OWNER_WA)}</b>. Assim que confirmarmos o pagamento, seu acesso é liberado — é só <b>entrar de novo</b>. 💜</p>
    <a class="btn btn-primary btn-block" href="${pixWaHref(ticket)}" target="_blank" rel="noopener">📲 Enviar comprovante agora</a>
    <button type="button" class="btn btn-ghost btn-block" data-logout>Sair</button>`;
  const lo = panel.querySelector('[data-logout]'); if (lo) lo.onclick = logout;
  toast('Ticket ' + ticket + ' gerado! Envie o comprovante no WhatsApp. 📲', 'ok');
}
function wireSub() {
  const t = $('#subBillToggle');
  if (t) t.addEventListener('click', e => {
    const b = e.target.closest('.bt'); if (!b) return;
    subBilling = b.dataset.bill;
    $$('#subBillToggle .bt').forEach(x => x.classList.toggle('on', x === b));
    const ano = subBilling === 'ano';
    $$('#subScreen .amt-mes').forEach(x => x.hidden = ano);
    $$('#subScreen .amt-ano').forEach(x => x.hidden = !ano);
    updatePixAmount();
  });
  $$('#subScreen [data-sub]').forEach(b => b.onclick = () => startCheckout(subBilling === 'ano' ? b.dataset.subAno : b.dataset.sub, b));
  const pt = $('#pixToggleBtn');
  if (pt) pt.onclick = () => { const p = $('#pixPanel'); if (p) { p.hidden = !p.hidden; if (!p.hidden) updatePixAmount(); } };
  $$('#pixPanel [data-pix-tier]').forEach(b => b.onclick = () => { pixTier = b.dataset.pixTier; $$('#pixPanel [data-pix-tier]').forEach(x => x.classList.toggle('on', x === b)); updatePixAmount(); });
  const pc = $('#pixCopy');
  if (pc) pc.onclick = async () => { try { await navigator.clipboard.writeText('67.136.444/0001-20'); toast('Chave Pix copiada!', 'ok'); } catch (e) { toast('Copie a chave: 67.136.444/0001-20', 'info'); } };
  const pd = $('#pixDone'); if (pd) pd.onclick = pixClaim;
}
async function startCheckout(plan, btn) {
  if (demoMode || !currentUser) { toast('Crie sua conta gratuita pra assinar 💜', 'info'); demoSignup(); return; }
  try {
    if (btn) { btn.disabled = true; btn.dataset.old = btn.textContent; btn.textContent = 'Abrindo pagamento…'; }
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(window.BELACAIXA_CFG.url + '/functions/v1/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token, apikey: window.BELACAIXA_CFG.anon },
      body: JSON.stringify({ plan, returnTo: location.origin + location.pathname })
    });
    const j = await res.json();
    if (j.url) { location.href = j.url; return; }
    toast('Não consegui iniciar o pagamento. ' + (j.error || ''), 'warn');
  } catch (e) { toast('Erro ao iniciar pagamento.', 'warn'); }
  if (btn) { btn.disabled = false; if (btn.dataset.old) btn.textContent = btn.dataset.old; }
}

/* ============================================================
   BOOT
   ============================================================ */
async function enterApp() {
  if (!currentUser) { showAuth('login'); return; }
  demoMode = false;                                             // login de verdade encerra a demonstração
  { const bar = $('#demoBar'); if (bar) bar.hidden = true; }    // e tira a barra "Você está na demonstração"
  $('#landing').hidden = true; $('#authScreen').hidden = true; $('#subScreen').hidden = true; $('#app').hidden = false;
  document.body.style.background = 'var(--bg)';
  if (!state) { $('#viewRoot').innerHTML = '<div class="empty"><span class="e-ico">⏳</span>Carregando seus dados…</div>'; await cloudLoad(); }
  if (purgeExpiredHolds()) save();   // limpa pedidos do link que expiraram (24h sem você tratar)
  await loadSubscription();
  markSilverSince();   // 1ª vez que vemos o SILVER ativo, grava a data de início dos 30 dias
  const params = new URLSearchParams(location.search);
  if (params.get('assinatura') === 'sucesso' && !subActive()) { $('#viewRoot').innerHTML = '<div class="empty"><span class="e-ico">⏳</span>Confirmando seu pagamento…</div>'; await pollSub(8); }
  if (params.get('assinatura')) { const ok = params.get('assinatura') === 'sucesso' && subActive(); history.replaceState({}, '', location.pathname); if (ok) toast('Assinatura ativada! 🎉', 'ok'); }
  if (!hasAccess() && !isAdmin()) { showSubGate(); return; }   // o administrador entra sem pagar
  // 1º acesso: escolher o RAMO do negócio (o app se adapta). Admin/contas antigas já seguem.
  if (needsSegmentChoice()) { showSegmentPicker(finishEnterApp); return; }
  finishEnterApp();
}
function finishEnterApp() {
  $('#app').hidden = false; $('#landing').hidden = true; $('#authScreen').hidden = true; $('#subScreen').hidden = true;
  const seg = document.getElementById('segScreen'); if (seg) seg.hidden = true;
  document.body.style.background = 'var(--bg)';
  const em = $('#sbUserEmail'); if (em) em.textContent = currentUser.email;
  updatePlanChip();
  const adm = $('#navAdmin'); if (adm) adm.hidden = !isAdmin();
  if (isAdmin()) { const chip = $('#sbPlanChip'); if (chip) chip.textContent = '🛡️ ADMIN'; }
  subscribeTenantRealtime();  // reservas do link aparecem na agenda sozinhas (sem recarregar)
  render(); window.scrollTo(0, 0);
  consumeBookingDeepLink();   // se veio de um link "1 toque p/ agendar", abre o modal já preenchido
  maybeOfferCatalog();        // conta nova com ramo definido → oferece o catálogo modelo (1 vez)
}
/* ---------------- ESCOLHA DE RAMO (segmento) — 1º acesso ---------------- */
function needsSegmentChoice() {
  return !demoMode && !!state && !!state.business && !state.business.segment && !isAdmin();
}
function showSegmentPicker(onDone) {
  let el = document.getElementById('segScreen');
  if (!el) { el = document.createElement('div'); el.id = 'segScreen'; document.body.appendChild(el); }
  el.hidden = false;
  el.innerHTML = `<div class="seg-wrap"><div class="seg-card">
    <div class="seg-logo">${brandIco(52)}</div>
    <h2>Bem-vindo(a) ao BelaCaixa! 👋</h2>
    <p class="seg-sub">O que você faz? Escolha seu ramo — o app já se adapta a você.<br><span class="muted">Dá pra mudar depois nas Configurações.</span></p>
    <div class="seg-list">${SEGMENT_ORDER.map(k => { const s = SEGMENTS[k]; return `<button type="button" class="seg-opt" data-seg="${k}" style="--segc:${s.color}"><span class="seg-ic">${s.svg || s.icon}</span><span class="seg-name">${s.label}</span><span class="seg-arrow" style="color:${s.color}">›</span></button>`; }).join('')}</div>
  </div></div>`;
  $('#app').hidden = true; $('#landing').hidden = true; $('#authScreen').hidden = true; $('#subScreen').hidden = true;
  document.body.style.background = 'var(--bg)';
  el.querySelectorAll('.seg-opt').forEach(b => b.onclick = () => chooseSegment(b.dataset.seg, { applyColor: true, onDone }));
  applyTheme();
}
function chooseSegment(key, opts) {
  opts = opts || {};
  const s = SEGMENTS[key]; if (!s || !state) return;
  state.business.segment = key;
  // Sugere a cor do ramo — mas SÓ em conta nova/vazia. Conta que já tem dados mantém
  // a cor atual (não surpreende quem já escolheu); ela troca depois nas Configurações.
  const fresh = !((state.services && state.services.length) || (state.transactions && state.transactions.length) || (state.clients && state.clients.length) || (state.appointments && state.appointments.length));
  if (opts.applyColor && fresh) { state.business.theme = s.theme; try { localStorage.setItem(THEME_KEY, s.theme); localStorage.setItem(THEME_CHOSEN_KEY, '1'); } catch (e) {} }
  applyTheme();
  save();
  const el = document.getElementById('segScreen'); if (el) el.hidden = true;
  (opts.onDone || (() => {}))();   // continua p/ o app; o catálogo modelo é oferecido no finishEnterApp
}
// Oferece o catálogo modelo UMA vez (conta nova com ramo definido e sem serviços).
// Vale tanto pra quem escolheu o ramo no cadastro quanto na tela de 1º acesso.
function maybeOfferCatalog() {
  if (demoMode || isAdmin() || !state || !state.business) return;
  if (document.querySelector('#modalRoot .modal')) return;   // não atropela um modal já aberto (ex.: pedido do link)
  const b = state.business;
  if (!b.segment || b.catAsked) return;
  const seg = SEGMENTS[b.segment];
  if ((state.services && state.services.length) || !seg || !seg.catalog || !seg.catalog.length) { b.catAsked = true; save(); return; }
  b.catAsked = true; save();
  offerModelCatalog(b.segment, () => render());
}
function offerModelCatalog(key, onDone) {
  const s = SEGMENTS[key];
  let fired = false;
  const done = () => { if (fired) return; fired = true; closeModal(); if (onDone) onDone(); };
  openModal(`${s.icon} Catálogo modelo`, `
    <p>Quer começar com um <b>catálogo de exemplo de ${esc(s.label.toLowerCase())}</b>? É só pra não começar do zero — você <b>edita, muda o preço ou apaga</b> tudo depois.</p>
    <div class="seg-cat">${s.catalog.map(c => `<div class="seg-cat-row"><span>${esc(c.name)}</span><b>${fmt(c.price)} · ${c.dur}min</b></div>`).join('')}</div>
    <p class="muted" style="font-size:12.5px;margin-top:10px">Se preferir, começa 100% em branco.</p>
  `, `<button class="btn btn-ghost" id="cat_skip">Começar do zero</button><button class="btn btn-primary" id="cat_use">Usar este modelo</button>`);
  $('#cat_use').onclick = () => { s.catalog.forEach(c => state.services.push({ id: uid(), name: c.name, price: c.price, dur: c.dur, mat: [] })); save(); toast('Catálogo modelo adicionado ✨', 'ok'); done(); };
  $('#cat_skip').onclick = done;
  const x = document.querySelector('#modalRoot .modal-x'); if (x) x.addEventListener('click', done);
}
function exitApp() { $('#app').hidden = true; $('#authScreen').hidden = true; $('#subScreen').hidden = true; $('#landing').hidden = false; document.body.style.background = ''; window.scrollTo(0, 0); }

/* ---------------- DEMONSTRAÇÃO (sem login, sem nuvem) ---------------- */
function enterDemo() {
  demoMode = true;
  state = seed();                              // dados de exemplo completos, em memória
  currentView = 'dashboard';
  $('#landing').hidden = true; $('#authScreen').hidden = true; $('#subScreen').hidden = true; $('#app').hidden = false;
  document.body.style.background = 'var(--bg)';
  const chip = $('#sbPlanChip'); if (chip) chip.textContent = 'DEMONSTRAÇÃO';
  const em = $('#sbUserEmail'); if (em) em.textContent = 'Modo demonstração · dados de exemplo';
  const bar = $('#demoBar'); if (bar) bar.hidden = false;
  render(); window.scrollTo(0, 0);
}
function exitDemo() {
  demoMode = false; state = null;
  const bar = $('#demoBar'); if (bar) bar.hidden = true;
  exitApp();
}
function demoSignup() {
  demoMode = false; state = null;
  const bar = $('#demoBar'); if (bar) bar.hidden = true;
  showAuth('signup');
}

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(savedThemePref() || 'fem');   // reflete o tema escolhido já na landing/login
  document.querySelectorAll('#lpTheme .tsw').forEach(b => b.onclick = () => {
    applyTheme(b.dataset.t);
    try { localStorage.setItem(THEME_CHOSEN_KEY, '1'); } catch (e) {}
    toast('Tema ' + (b.dataset.t === 'masc' ? 'Azul' : 'Rosa') + ' aplicado!', 'ok');
  });
  $$('[data-enter]').forEach(b => b.onclick = () => enterApp());
  $$('[data-demo]').forEach(b => b.onclick = () => enterDemo());
  $$('[data-demo-signup]').forEach(b => b.onclick = () => demoSignup());
  $$('[data-demo-exit]').forEach(b => b.onclick = () => exitDemo());
  $('#navMenu').addEventListener('click', e => { const b = e.target.closest('.nav-item'); if (b) setView(b.dataset.view); });
  $('[data-exit]').onclick = exitApp;
  $$('[data-logout]').forEach(b => b.onclick = logout);
  $('#hamburger').onclick = () => $('.sidebar').classList.toggle('open');
  $('#bizPill').onclick = modalBiz;
  const billToggle = $('#billToggle');
  if (billToggle) billToggle.addEventListener('click', e => {
    const b = e.target.closest('.bt'); if (!b) return;
    const ano = b.dataset.bill === 'ano';
    $$('#billToggle .bt').forEach(x => x.classList.toggle('on', x === b));
    $$('.amt-mes, .note-mes').forEach(x => x.hidden = ano);
    $$('.amt-ano, .note-ano').forEach(x => x.hidden = !ano);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  wireAuth();
  wireSub();
  // já existe sessão salva?
  if (initSb()) {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session) { currentUser = session.user; await enterApp(); }
    } catch (e) { console.error(e); }
  }
});
