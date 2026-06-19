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
const todayISO = () => new Date().toISOString().slice(0, 10);
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthKey = d => d.slice(0, 7);
const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}`; };
const fmtDateFull = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const dayName = iso => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][new Date(iso + 'T12:00').getDay()];
const initials = n => n.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const AVCOLORS = ['#f43f8e', '#9b5de5', '#00b389', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#06b6d4'];
const avColor = s => AVCOLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVCOLORS.length];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let state = load();

/* ============================================================
   SEED
   ============================================================ */
function load() {
  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.v === 1) return s; } catch (e) {}
  const fresh = seed();
  try { localStorage.setItem(STORE, JSON.stringify(fresh)); } catch (e) {}
  return fresh;
}
function save() { localStorage.setItem(STORE, JSON.stringify(state)); }

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
    birthday: `${String(((idx * 3) % 12) + 1).padStart(2, '0')}-${String(((idx * 7) % 27) + 1).padStart(2, '0')}`, notes: '', createdAt: todayISO()
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

  const market = [
    { id: uid(), itemId: 'i_acetona', itemName: 'Acetona', supplier: 'Bella Distribuidora', price: 14.4, discount: 22, unit: 'L' },
    { id: uid(), itemId: 'i_gel', itemName: 'Gel construtor', supplier: 'Distribuidora Prime', price: 31.9, discount: 20, unit: 'pote' },
    { id: uid(), itemId: 'i_base', itemName: 'Base / Top Coat', supplier: 'Glam Cosméticos', price: 11.5, discount: 18, unit: 'un' },
    { id: uid(), itemId: 'i_algodao', itemName: 'Algodão', supplier: 'Atacão Beleza', price: 7.9, discount: 20, unit: 'pct' },
    { id: uid(), itemId: 'i_esmalte', itemName: 'Esmalte (sortido)', supplier: 'Feira da Beleza', price: 4.9, discount: 25, unit: 'un' },
  ];

  // histórico de patrimônio (6 meses)
  const patHist = [];
  for (let m = 5; m >= 0; m--) {
    const dRef = new Date(now.getFullYear(), now.getMonth() - m, 1);
    patHist.push({ month: dRef.toISOString().slice(0, 7), value: 0 }); // calculado depois
  }

  return {
    v: 1,
    business: { name: 'Nails e Pedicure', reserveTarget: 5000, monthlyGoal: 8000 },
    clients, services, inventory: inv, transactions: tx, appointments: appts, assets, market,
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
const patrimonioTotal = () => assetsTotal() + Math.max(0, balance());
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
  const ms = monthStats(curMonthKey()); const day = Math.max(1, new Date().getDate());
  const cnt = txOfMonth(curMonthKey()).filter(t => t.category === 'Atendimentos').length;
  return Math.max(1, cnt / day);
}
function daysToDeplete(item) {
  const perDay = item.use * dailyServices();
  if (perDay <= 0) return 999;
  return Math.floor(item.qty / perDay);
}
function bestOffer(itemId) { return state.market.filter(m => m.itemId === itemId).sort((a, b) => a.price - b.price)[0]; }

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
    const it = low[0]; const off = bestOffer(it.id);
    out.push({
      tone: 'amber', ico: '📦', title: `${low.length} item(ns) acabando`,
      text: `${it.name} está em ${it.qty} ${it.unit} (mín. ${it.min}).` + (off ? ` Achei ${off.discount}% off na ${off.supplier}.` : ''),
      act: 'go-estoque', actLabel: 'Ver estoque & compras'
    });
  }
  // promoção destacada
  const promo = [...state.market].sort((a, b) => b.discount - a.discount)[0];
  if (promo) out.push({ tone: 'violet', ico: '🛒', title: `Promoção: ${promo.itemName} ${promo.discount}% off`, text: `${promo.supplier} está com ${promo.itemName} por ${fmt(promo.price)}/${promo.unit}. Boa hora pra estocar.`, act: 'go-estoque', actLabel: 'Aproveitar' });
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
    return `Com base no seu caixa livre de <b>${fmt(s.fc)}</b>, sugiro:<ul>${s.list.map(x => `<li><b>${esc(x.title)}</b>: ${fmt(x.alloc)} — ${esc(x.ret)}</li>`).join('')}</ul>Veja os detalhes na aba <b>Patrimônio</b>.`;
  }
  if (has('comprar', 'estoque', 'repor', 'acabando', 'falta', 'promo')) {
    const low = lowStock();
    if (!low.length) return 'Seu estoque está saudável ✅ Nenhum item abaixo do mínimo agora. Eu te aviso assim que algo começar a acabar.';
    const lines = low.map(it => { const o = bestOffer(it.id); return `<li><b>${esc(it.name)}</b> (${it.qty} ${it.unit}, mín ${it.min})${o ? ` → melhor preço: ${esc(o.supplier)} ${fmt(o.price)} (${o.discount}% off)` : ''}</li>`; });
    return `Você precisa repor <b>${low.length}</b> item(ns):<ul>${lines.join('')}</ul>Quer que eu monte a lista de compras? Vá em <b>Estoque & Compras → Gerar pedido</b>.`;
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
    const pct = Math.round(cur.in / state.business.monthlyGoal * 100);
    return `Sua meta é faturar <b>${fmt(state.business.monthlyGoal)}</b>/mês. Você já está em <b>${fmt(cur.in)}</b> (${pct}%). ${pct >= 100 ? 'Meta batida! 🎉' : `Faltam ${fmt(state.business.monthlyGoal - cur.in)} — cerca de ${Math.ceil((state.business.monthlyGoal - cur.in) / 60)} atendimentos.`}`;
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
  const COLORS = ['#f43f8e', '#9b5de5', '#00b389', '#f59e0b', '#3b82f6', '#ec4899', '#06b6d4'];
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
  const dots = points.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.value)}" r="4.5" fill="#fff" stroke="#9b5de5" stroke-width="2.5"><title>${p.label}: ${fmt(p.value)}</title></circle>`).join('');
  const labels = points.map((p, i) => `<text x="${X(i)}" y="${H - 6}" font-size="11" fill="#5b5168" text-anchor="middle">${p.label}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%"><defs><linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9b5de5" stop-opacity=".28"/><stop offset="1" stop-color="#9b5de5" stop-opacity="0"/></linearGradient></defs>
    ${grid}<polygon points="${area}" fill="url(#gArea)"/><polyline points="${line}" fill="none" stroke="#9b5de5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}</svg>`;
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
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'ok' ? 'ok' : type === 'warn' ? 'warn' : 'info');
  el.innerHTML = `<span>${type === 'ok' ? '✅' : type === 'warn' ? '⚠️' : '💡'}</span><span>${msg}</span>`;
  $('#toastRoot').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, 3200);
}
function openModal(title, body, foot) {
  $('#modalRoot').innerHTML = `<div class="modal-bg" data-close-bg>
    <div class="modal"><div class="modal-head"><h3>${title}</h3><button class="modal-x" data-close>×</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div></div>`;
  $('[data-close-bg]').addEventListener('click', e => { if (e.target.matches('[data-close-bg]')) closeModal(); });
  $('[data-close]').addEventListener('click', closeModal);
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
      ${kpi('💵', 'Saldo em caixa', fmt(balance()), '', 'linear-gradient(135deg,#f43f8e,#9b5de5)')}
      ${kpi('⬆️', 'Entradas (mês)', fmt(cur.in), delta(cur.in, prev.in), '#e2f8f1', '#00b389')}
      ${kpi('⬇️', 'Saídas (mês)', fmt(cur.out), delta(cur.out, prev.out), '#fde7ec', '#f0476a')}
      ${kpi('💎', 'Lucro líquido (mês)', fmt(cur.profit), delta(cur.profit, prev.profit), '#f3e8ff', '#9b5de5')}
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
function kpi(ico, label, value, delta = '', icoBg = '#f3e8ff', icoColor = '#9b5de5') {
  const bg = icoBg.startsWith('linear') ? icoBg : icoBg; const col = icoBg.startsWith('linear') ? '#fff' : icoColor;
  return `<div class="kpi"><div class="kpi-ico" style="background:${bg};color:${col}">${ico}</div><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${delta}</div>`;
}
function insightCard(i) {
  return `<div class="insight tone-${i.tone}"><div class="ins-ico" style="background:${{ green: '#e2f8f1', amber: '#fef3df', violet: '#f3e8ff', blue: '#e6effd' }[i.tone]}">${i.ico}</div>
    <div style="flex:1"><h4>${esc(i.title)}</h4><p>${esc(i.text)}</p>${i.act ? `<button class="btn btn-soft btn-sm" style="margin-top:8px" data-act="${i.act}">${esc(i.actLabel)} →</button>` : ''}</div></div>`;
}
function stockRow(it) {
  const pct = clamp(it.qty / (it.min * 2) * 100, 4, 100); const off = bestOffer(it.id);
  return `<div style="margin-bottom:12px"><div class="row between" style="margin-bottom:6px"><span>${esc(it.name)} <span class="muted">· ${it.qty} ${it.unit}</span></span>${off ? `<span class="badge b-violet">${off.discount}% off</span>` : ''}</div><div class="bar warn"><i style="width:${pct}%"></i></div></div>`;
}

/* ---------- FINANCEIRO ---------- */
let finFilter = { month: 'all', type: 'all' };
VIEWS.financeiro = {
  title: 'Fluxo de caixa', subtitle: 'Entradas, saídas e lucro líquido',
  html() {
    const cur = monthStats(curMonthKey());
    let list = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date));
    if (finFilter.month !== 'all') list = list.filter(t => monthKey(t.date) === finFilter.month);
    if (finFilter.type !== 'all') list = list.filter(t => t.type === finFilter.type);
    const monthsOpts = ['all', ...new Set(state.transactions.map(t => monthKey(t.date)))].sort().reverse();
    const fIn = sumIn(list), fOut = sumOut(list);
    return `
    <div class="section-head">
      <div class="row wrap">
        <div class="seg" id="typeSeg">
          <button data-type="all" class="${finFilter.type === 'all' ? 'on' : ''}">Tudo</button>
          <button data-type="in" class="${finFilter.type === 'in' ? 'on' : ''}">Entradas</button>
          <button data-type="out" class="${finFilter.type === 'out' ? 'on' : ''}">Saídas</button>
        </div>
        <select id="monthSel" style="width:auto">${monthsOpts.map(m => `<option value="${m}" ${finFilter.month === m ? 'selected' : ''}>${m === 'all' ? 'Todos os meses' : MONTHS[+m.slice(5) - 1] + '/' + m.slice(2, 4)}</option>`).join('')}</select>
      </div>
      <div class="row"><button class="btn btn-outline" data-act="new-saida">－ Saída</button><button class="btn btn-primary" data-act="new-entrada">＋ Entrada</button></div>
    </div>

    <div class="grid cols-3">
      ${kpi('⬆️', 'Entradas (filtro)', fmt(fIn), '', '#e2f8f1', '#00b389')}
      ${kpi('⬇️', 'Saídas (filtro)', fmt(fOut), '', '#fde7ec', '#f0476a')}
      ${kpi('💎', 'Resultado', fmt(fIn - fOut), `<span class="kpi-delta ${fIn - fOut >= 0 ? 'delta-up' : 'delta-down'}">margem ${fIn ? Math.round((fIn - fOut) / fIn * 100) : 0}%</span>`, '#f3e8ff', '#9b5de5')}
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
    $('#monthSel').onchange = e => { finFilter.month = e.target.value; render(); };
  }
};
function txRow(t) {
  const cli = t.clientId ? state.clients.find(c => c.id === t.clientId) : null;
  return `<tr><td class="muted">${fmtDateFull(t.date)}</td><td>${esc(t.desc)}</td><td><span class="tag-cat">${esc(t.category)}</span></td><td>${cli ? esc(cli.name.split(' ')[0]) : '—'}</td>
    <td class="num ${t.type === 'in' ? 't-in' : 't-out'}">${t.type === 'in' ? '+' : '−'} ${fmt(t.amount)}</td>
    <td class="num"><button class="modal-x" data-act="del-tx" data-id="${t.id}" title="Excluir">🗑️</button></td></tr>`;
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
        <thead><tr><th>Cliente</th><th>Telefone</th><th>Aniversário</th><th class="num">Visitas</th><th class="num">Total gasto</th><th>Última visita</th><th></th></tr></thead>
        <tbody>${rows.map(({ c, s }) => `<tr>
          <td><div class="row" style="gap:10px"><span class="cli-av" style="background:${avColor(c.name)}">${initials(c.name)}</span><b>${esc(c.name)}</b>${s.visits >= 3 ? '<span class="badge b-violet">fiel</span>' : ''}</div></td>
          <td class="muted">${esc(c.phone || '—')}</td>
          <td class="muted">${c.birthday ? c.birthday.split('-').reverse().join('/') : '—'}</td>
          <td class="num">${s.visits}</td><td class="num">${fmt(s.total)}</td>
          <td class="muted">${s.last ? fmtDateFull(s.last) : '—'}</td>
          <td class="num"><button class="modal-x" data-act="del-cliente" data-id="${c.id}" title="Excluir">🗑️</button></td></tr>`).join('')}</tbody>
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
    return `
    <div class="section-head">
      <div class="grid cols-3" style="flex:1;max-width:560px">
        ${miniStat('📅', 'Agendados', up.length)}
        ${miniStat('✅', 'Concluídos', concluded)}
        ${miniStat('⏰', 'Próximo horário livre', nextSlot.label)}
      </div>
      <button class="btn btn-primary" data-act="new-agenda">＋ Agendar</button>
    </div>

    <div class="insight tone-violet mt" style="max-width:none"><div class="ins-ico" style="background:#f3e8ff">🤖</div>
      <div><h4>Sugestão automática de horário</h4><p>O próximo encaixe livre é <b>${nextSlot.full}</b>. Quer agendar agora?</p>
      <button class="btn btn-soft btn-sm" style="margin-top:8px" data-act="new-agenda">Usar este horário →</button></div></div>

    ${Object.keys(byDate).length ? Object.entries(byDate).map(([date, list]) => `
      <div class="card mt">
        <div class="section-head"><h2>${date === todayISO() ? '🔆 Hoje' : dayName(date) + ', ' + fmtDateFull(date)}</h2><span class="muted">${list.length} atend.</span></div>
        ${list.sort((a, b) => a.time.localeCompare(b.time)).map(apptRow).join('')}
      </div>`).join('') : `<div class="card mt"><div class="empty"><span class="e-ico">📭</span>Nenhum atendimento agendado. Que tal divulgar seus horários?</div></div>`}`;
  }
};
function apptRow(a) {
  return `<div class="row between" style="padding:12px 0;border-bottom:1px dashed var(--line)">
    <div class="row" style="gap:12px"><span class="cli-av" style="background:${avColor(a.clientName)}">${initials(a.clientName)}</span>
      <div><b>${a.time}</b> · ${esc(a.clientName)}<div class="muted" style="font-size:13px">${esc(a.serviceName)} · ${fmt(a.price)}</div></div></div>
    <div class="row"><button class="btn btn-soft btn-sm" data-act="done-appt" data-id="${a.id}">✓ Concluir</button>
      <button class="modal-x" data-act="del-appt" data-id="${a.id}" title="Cancelar">×</button></div></div>`;
}
function suggestSlot() {
  const slots = ['09:00', '10:30', '13:00', '14:30', '16:00', '17:30'];
  for (let off = 0; off < 7; off++) {
    const d = new Date(); d.setDate(d.getDate() + off); const iso = d.toISOString().slice(0, 10);
    const taken = state.appointments.filter(a => a.date === iso && a.status === 'agendado').map(a => a.time);
    for (const s of slots) if (!taken.includes(s) && !(off === 0 && s < new Date().toTimeString().slice(0, 5))) {
      return { iso, time: s, label: (off === 0 ? 'Hoje ' : dayName(iso) + ' ') + s, full: (off === 0 ? 'hoje' : dayName(iso) + ' (' + fmtDate(iso) + ')') + ' às ' + s };
    }
  }
  return { iso: todayISO(), time: '09:00', label: '—', full: 'amanhã às 09:00' };
}

/* ---------- ESTOQUE & COMPRAS ---------- */
VIEWS.estoque = {
  title: 'Estoque & Compras', subtitle: 'IA que monitora consumo e caça promoções',
  html() {
    const low = lowStock();
    const inv = [...state.inventory].sort((a, b) => daysToDeplete(a) - daysToDeplete(b));
    return `
    <div class="section-head"><div class="grid cols-3" style="flex:1;max-width:600px">
      ${miniStat('📦', 'Itens', state.inventory.length)}
      ${miniStat('⚠️', 'Precisam repor', low.length)}
      ${miniStat('🛒', 'Promoções ativas', state.market.length)}
    </div><div class="row"><button class="btn btn-outline" data-act="new-item">＋ Item</button><button class="btn btn-primary" data-act="gerar-pedido">🤖 Gerar pedido</button></div></div>

    ${low.length ? `<div class="insight tone-amber mt" style="max-width:none"><div class="ins-ico" style="background:#fef3df">🤖</div>
      <div><h4>Hora de repor ${low.length} item(ns)</h4><p>Pelo seu ritmo de atendimentos, ${esc(low[0].name)} acaba em ~${daysToDeplete(low[0])} dia(s). Já encontrei os melhores preços no mercado.</p>
      <button class="btn btn-soft btn-sm" style="margin-top:8px" data-act="gerar-pedido">Montar lista de compras →</button></div></div>` : ''}

    <div class="grid cols-2 mt">
      <div class="card">
        <div class="section-head"><h2>📦 Meu estoque</h2></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="num">Qtd</th><th>Status</th><th class="num">Dura ~</th><th></th></tr></thead>
        <tbody>${inv.map(it => {
      const d = daysToDeplete(it); const st = it.qty <= it.min ? ['b-red', 'Repor'] : it.qty <= it.min * 1.4 ? ['b-amber', 'Atenção'] : ['b-green', 'OK'];
      return `<tr><td><b>${esc(it.name)}</b><div class="muted" style="font-size:12.5px">${esc(it.category)} · ${esc(it.supplier)}</div></td>
        <td class="num">${it.qty} ${it.unit}</td><td><span class="badge ${st[0]}">${st[1]}</span></td>
        <td class="num">${d > 60 ? '60+' : d} d</td>
        <td class="num"><button class="btn btn-soft btn-sm" data-act="repor-item" data-id="${it.id}">Repor</button></td></tr>`;
    }).join('')}</tbody></table></div>
      </div>

      <div class="card">
        <div class="section-head"><div><h2>🛒 Promoções no mercado</h2><span class="sh-sub">Matéria-prima monitorada pela IA</span></div></div>
        ${[...state.market].sort((a, b) => b.discount - a.discount).map(m => {
      const it = state.inventory.find(i => i.id === m.itemId);
      const save = it ? Math.max(0, it.cost - m.price) : 0;
      return `<div class="row between" style="padding:12px 0;border-bottom:1px dashed var(--line)">
        <div><b>${esc(m.itemName)}</b> <span class="badge b-red" style="margin-left:4px">${m.discount}% off</span><div class="muted" style="font-size:13px">${esc(m.supplier)} · ${fmt(m.price)}/${m.unit}${save > 0 ? ` · economiza ${fmt(save)}/un` : ''}</div></div>
        <button class="btn btn-soft btn-sm" data-act="comprar-promo" data-id="${m.id}">Comprar</button></div>`;
    }).join('')}
      </div>
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
      ${kpi('🏛️', 'Patrimônio total', fmt(patrimonioTotal()), `<span class="kpi-delta ${growth >= 0 ? 'delta-up' : 'delta-down'}">${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)}% em 6m</span>`, 'linear-gradient(135deg,#f43f8e,#9b5de5)')}
      ${kpi('🪑', 'Bens & equipamentos', fmt(assetsTotal()), '', '#f3e8ff', '#9b5de5')}
      ${kpi('💵', 'Em caixa', fmt(Math.max(0, balance())), '', '#e2f8f1', '#00b389')}
      ${kpi('🚀', 'Caixa livre p/ investir', fmt(inv.fc), '', '#e6effd', '#3b82f6')}
    </div>

    <div class="grid cols-2 mt">
      <div class="card"><div class="section-head"><div><h2>Evolução do patrimônio</h2><span class="sh-sub">Caixa + bens nos últimos 6 meses</span></div></div>${svgLine(series)}</div>
      <div class="card">
        <div class="section-head"><div><h2>🤖 Sugestões de investimento</h2><span class="sh-sub">Com base no seu caixa livre</span></div></div>
        ${inv.list.length ? inv.list.map(s => `<div class="insight tone-${s.tone}" style="margin-bottom:10px"><div class="ins-ico" style="background:${{ green: '#e2f8f1', amber: '#fef3df', violet: '#f3e8ff', blue: '#e6effd' }[s.tone]}">${s.ico}</div>
          <div style="flex:1"><div class="row between"><h4>${esc(s.title)}</h4><b style="font-family:var(--display);color:var(--violet)">${fmt(s.alloc)}</b></div><p>${esc(s.detail)}</p><span class="badge b-green" style="margin-top:6px">Retorno: ${esc(s.ret)}</span></div></div>`).join('') : `<div class="empty"><span class="e-ico">🌱</span>Fortaleça o caixa para liberar sugestões de investimento.</div>`}
      </div>
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

/* ============================================================
   RENDER / ROUTER
   ============================================================ */
function render() {
  const v = VIEWS[currentView];
  $('#viewTitle').textContent = v.title;
  $('#viewSubtitle').textContent = v.subtitle;
  $('#viewRoot').innerHTML = v.html();
  v.init && v.init();
  $$('#navMenu .nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
  $('#bizName').textContent = state.business.name;
}
function setView(v) { currentView = v; $('.sidebar')?.classList.remove('open'); render(); window.scrollTo(0, 0); }

/* ============================================================
   MODAIS (formulários)
   ============================================================ */
function modalAtendimento() {
  const opts = state.services.map(s => `<option value="${s.id}">${esc(s.name)} — ${fmt(s.price)}</option>`).join('');
  const clopts = state.clients.map(c => `<option value="${esc(c.name)}">`).join('');
  openModal('Registrar atendimento', `
    <div class="field"><label>Serviço</label><select id="f_serv">${opts}</select></div>
    <div class="field"><label>Cliente</label><input class="input" id="f_cli" list="clidl" placeholder="Nome da cliente"/><datalist id="clidl">${clopts}</datalist><span class="muted" style="font-size:12.5px">Cliente nova é cadastrada automaticamente ✨</span></div>
    <div class="field-row"><div class="field"><label>Valor (R$)</label><input class="input" id="f_val" type="number" step="0.01"/></div><div class="field"><label>Data</label><input class="input" id="f_date" type="date" value="${todayISO()}"/></div></div>
    <label class="row" style="gap:8px;font-size:14px"><input type="checkbox" id="f_baixa" checked style="width:auto"/> Dar baixa no material usado</label>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="f_save">Registrar</button>`);
  const sv = () => state.services.find(s => s.id === $('#f_serv').value);
  $('#f_val').value = sv().price;
  $('#f_serv').onchange = () => $('#f_val').value = sv().price;
  $('#f_save').onclick = () => {
    const name = $('#f_cli').value.trim(); const val = parseFloat($('#f_val').value);
    if (!name || !(val >= 0)) return toast('Preencha cliente e valor.', 'warn');
    let cli = state.clients.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!cli) { cli = { id: 'c_' + uid(), name, phone: '', birthday: '', notes: '', createdAt: todayISO() }; state.clients.push(cli); toast(`Cliente "${name}" cadastrada automaticamente 💖`, 'ok'); }
    const service = sv();
    state.transactions.push({ id: uid(), type: 'in', category: 'Atendimentos', amount: val, desc: service.name + ' — ' + name.split(' ')[0], date: $('#f_date').value, clientId: cli.id });
    if ($('#f_baixa').checked) deduct(service);
    save(); closeModal(); render(); toast('Atendimento registrado! ' + fmt(val) + ' no caixa.', 'ok');
  };
}
function deduct(service) {
  service.mat.forEach(([id, q]) => { const it = state.inventory.find(i => i.id === id); if (it) it.qty = Math.max(0, +(it.qty - q).toFixed(2)); });
}
function modalTx(type) {
  const cats = type === 'in' ? ['Atendimentos', 'Venda de produtos', 'Outros'] : ['Matéria-prima', 'Aluguel', 'Energia / Água', 'Marketing', 'Salários / Comissão', 'Manutenção', 'Outros'];
  openModal(type === 'in' ? 'Nova entrada' : 'Nova saída', `
    <div class="field"><label>Descrição</label><input class="input" id="t_desc" placeholder="${type === 'in' ? 'Ex.: Venda de kit de esmaltes' : 'Ex.: Conta de luz'}"/></div>
    <div class="field-row"><div class="field"><label>Valor (R$)</label><input class="input" id="t_val" type="number" step="0.01"/></div><div class="field"><label>Categoria</label><select id="t_cat">${cats.map(c => `<option>${c}</option>`).join('')}</select></div></div>
    <div class="field"><label>Data</label><input class="input" id="t_date" type="date" value="${todayISO()}"/></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="t_save">Salvar</button>`);
  $('#t_save').onclick = () => {
    const val = parseFloat($('#t_val').value), desc = $('#t_desc').value.trim() || $('#t_cat').value;
    if (!(val > 0)) return toast('Informe um valor válido.', 'warn');
    state.transactions.push({ id: uid(), type, category: $('#t_cat').value, amount: val, desc, date: $('#t_date').value });
    save(); closeModal(); render(); toast((type === 'in' ? 'Entrada' : 'Saída') + ' registrada.', 'ok');
  };
}
function modalCliente() {
  openModal('Novo cliente', `
    <div class="field"><label>Nome</label><input class="input" id="c_name" placeholder="Nome completo"/></div>
    <div class="field-row"><div class="field"><label>Telefone</label><input class="input" id="c_phone" placeholder="(11) 9...."/></div><div class="field"><label>Aniversário (dd-mm)</label><input class="input" id="c_bday" placeholder="15-08"/></div></div>
    <div class="field"><label>Observações</label><textarea id="c_notes" placeholder="Preferências, alergias, esmalte favorito..."></textarea></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="c_save">Salvar</button>`);
  $('#c_save').onclick = () => {
    const name = $('#c_name').value.trim(); if (!name) return toast('Informe o nome.', 'warn');
    state.clients.push({ id: 'c_' + uid(), name, phone: $('#c_phone').value.trim(), birthday: $('#c_bday').value.trim(), notes: $('#c_notes').value.trim(), createdAt: todayISO() });
    save(); closeModal(); render(); toast('Cliente cadastrada 💖', 'ok');
  };
}
function modalAgenda(pre) {
  const slot = pre || suggestSlot();
  const opts = state.services.map(s => `<option value="${s.id}">${esc(s.name)} — ${fmt(s.price)}</option>`).join('');
  const clopts = state.clients.map(c => `<option value="${esc(c.name)}">`).join('');
  openModal('Agendar atendimento', `
    <div class="field"><label>Cliente</label><input class="input" id="a_cli" list="adl" placeholder="Nome da cliente"/><datalist id="adl">${clopts}</datalist></div>
    <div class="field"><label>Serviço</label><select id="a_serv">${opts}</select></div>
    <div class="field-row"><div class="field"><label>Data</label><input class="input" id="a_date" type="date" value="${slot.iso}"/></div><div class="field"><label>Horário</label><input class="input" id="a_time" type="time" value="${slot.time}"/></div></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="a_save">Agendar</button>`);
  $('#a_save').onclick = () => {
    const name = $('#a_cli').value.trim(); if (!name) return toast('Informe a cliente.', 'warn');
    const sv = state.services.find(s => s.id === $('#a_serv').value);
    let cli = state.clients.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!cli) { cli = { id: 'c_' + uid(), name, phone: '', birthday: '', notes: '', createdAt: todayISO() }; state.clients.push(cli); }
    state.appointments.push({ id: uid(), date: $('#a_date').value, time: $('#a_time').value, serviceId: sv.id, serviceName: sv.name, clientId: cli.id, clientName: cli.name, price: sv.price, status: 'agendado' });
    save(); closeModal(); render(); toast('Atendimento agendado 📅', 'ok');
  };
}
function modalItem() {
  openModal('Novo item de estoque', `
    <div class="field"><label>Nome</label><input class="input" id="i_name" placeholder="Ex.: Esmalte vermelho"/></div>
    <div class="field-row"><div class="field"><label>Quantidade</label><input class="input" id="i_qty" type="number" step="0.01" value="0"/></div><div class="field"><label>Unidade</label><input class="input" id="i_unit" value="un"/></div></div>
    <div class="field-row"><div class="field"><label>Estoque mínimo</label><input class="input" id="i_min" type="number" step="0.01" value="1"/></div><div class="field"><label>Custo unit. (R$)</label><input class="input" id="i_cost" type="number" step="0.01" value="0"/></div></div>
    <div class="field-row"><div class="field"><label>Categoria</label><input class="input" id="i_cat" value="Geral"/></div><div class="field"><label>Fornecedor</label><input class="input" id="i_sup" placeholder="Fornecedor"/></div></div>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="i_save">Salvar</button>`);
  $('#i_save').onclick = () => {
    const name = $('#i_name').value.trim(); if (!name) return toast('Informe o nome.', 'warn');
    state.inventory.push({ id: 'i_' + uid(), name, category: $('#i_cat').value.trim() || 'Geral', qty: +$('#i_qty').value, unit: $('#i_unit').value.trim() || 'un', min: +$('#i_min').value, cost: +$('#i_cost').value, supplier: $('#i_sup').value.trim() || '—', use: 0.05 });
    save(); closeModal(); render(); toast('Item adicionado ao estoque 📦', 'ok');
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
function modalRepor(id) {
  const it = state.inventory.find(i => i.id === id); if (!it) return;
  const off = bestOffer(id); const price = off ? off.price : it.cost; const sup = off ? off.supplier : it.supplier;
  const sugQty = Math.max(it.min, Math.ceil(it.min * 2 - it.qty));
  openModal('Repor ' + esc(it.name), `
    <p class="muted" style="margin-bottom:12px">Estoque atual: <b>${it.qty} ${it.unit}</b> · mínimo ${it.min}${off ? ` · 🛒 melhor preço: <b>${esc(sup)}</b> ${fmt(price)}/${it.unit} <span class="badge b-red">${off.discount}% off</span>` : ''}</p>
    <div class="field-row"><div class="field"><label>Quantidade a comprar</label><input class="input" id="r_qty" type="number" step="0.01" value="${sugQty}"/></div><div class="field"><label>Preço unit. (R$)</label><input class="input" id="r_price" type="number" step="0.01" value="${price}"/></div></div>
    <div class="kv mt"><span>Total estimado</span><b id="r_total">${fmt(sugQty * price)}</b></div>
    <label class="row" style="gap:8px;font-size:14px;margin-top:10px"><input type="checkbox" id="r_cash" checked style="width:auto"/> Lançar como saída no caixa</label>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="r_save">Confirmar compra</button>`);
  const upd = () => $('#r_total').textContent = fmt((+$('#r_qty').value || 0) * (+$('#r_price').value || 0));
  $('#r_qty').oninput = upd; $('#r_price').oninput = upd;
  $('#r_save').onclick = () => {
    const q = +$('#r_qty').value, p = +$('#r_price').value;
    if (!(q > 0)) return toast('Informe a quantidade.', 'warn');
    it.qty = +(it.qty + q).toFixed(2); it.cost = p;
    if ($('#r_cash').checked) state.transactions.push({ id: uid(), type: 'out', category: 'Matéria-prima', amount: +(q * p).toFixed(2), desc: 'Compra: ' + it.name + (off ? ' (' + sup + ')' : ''), date: todayISO() });
    save(); closeModal(); render(); toast('Estoque reposto! +' + q + ' ' + it.unit, 'ok');
  };
}
function modalPedido() {
  const low = lowStock();
  if (!low.length) { toast('Estoque saudável — nada para comprar agora ✅', 'ok'); return; }
  let total = 0;
  const rows = low.map(it => {
    const off = bestOffer(it.id); const price = off ? off.price : it.cost; const qty = Math.max(it.min, Math.ceil(it.min * 2 - it.qty));
    const sub = qty * price; total += sub;
    return { it, off, price, qty, sub };
  });
  openModal('🤖 Pedido de compra sugerido', `
    <p class="muted" style="margin-bottom:14px">A IA montou este pedido com os itens abaixo do mínimo, já nos melhores preços encontrados:</p>
    <table class="tbl"><thead><tr><th>Item</th><th>Fornecedor</th><th class="num">Qtd</th><th class="num">Subtotal</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td><b>${esc(r.it.name)}</b></td><td class="muted">${esc(r.off ? r.off.supplier : r.it.supplier)}${r.off ? ` <span class="badge b-red">${r.off.discount}%</span>` : ''}</td><td class="num">${r.qty} ${r.it.unit}</td><td class="num">${fmt(r.sub)}</td></tr>`).join('')}</tbody></table>
    <div class="kv mt" style="font-size:16px"><span>Total do pedido</span><b style="color:var(--violet)">${fmt(total)}</b></div>
  `, `<button class="btn btn-ghost" data-close>Fechar</button><button class="btn btn-primary" id="p_buy">Comprar tudo (${fmt(total)})</button>`);
  $('#p_buy').onclick = () => {
    rows.forEach(r => { r.it.qty = +(r.it.qty + r.qty).toFixed(2); r.it.cost = r.price; });
    state.transactions.push({ id: uid(), type: 'out', category: 'Matéria-prima', amount: +total.toFixed(2), desc: 'Pedido de reposição (IA) — ' + rows.length + ' itens', date: todayISO() });
    save(); closeModal(); render(); toast('Pedido realizado! Estoque reposto 📦', 'ok');
  };
}
function modalBiz() {
  const b = state.business;
  openModal('Configurações do negócio', `
    <div class="field"><label>Nome do negócio</label><input class="input" id="g_name" value="${esc(b.name)}"/></div>
    <div class="field-row"><div class="field"><label>Reserva de emergência alvo (R$)</label><input class="input" id="g_res" type="number" value="${b.reserveTarget}"/></div><div class="field"><label>Meta de faturamento mensal (R$)</label><input class="input" id="g_goal" type="number" value="${b.monthlyGoal}"/></div></div>
    <hr style="border:none;border-top:1px solid var(--line);margin:8px 0 14px">
    <button class="btn btn-danger btn-sm" id="g_reset">↺ Restaurar dados de demonstração</button>
  `, `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="g_save">Salvar</button>`);
  $('#g_save').onclick = () => {
    b.name = $('#g_name').value.trim() || b.name; b.reserveTarget = +$('#g_res').value || b.reserveTarget; b.monthlyGoal = +$('#g_goal').value || b.monthlyGoal;
    save(); closeModal(); render(); toast('Configurações salvas.', 'ok');
  };
  $('#g_reset').onclick = () => { if (confirm('Isso apaga seus dados e restaura a demonstração. Continuar?')) { localStorage.removeItem(STORE); state = seed(); save(); closeModal(); render(); toast('Dados de demonstração restaurados.', 'info'); } };
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
  'new-item': modalItem,
  'new-asset': modalAsset,
  'gerar-pedido': modalPedido,
  'go-estoque': () => setView('estoque'),
  'go-patrimonio': () => setView('patrimonio'),
  'repor-item': (id) => modalRepor(id),
  'comprar-promo': (id) => { const m = state.market.find(x => x.id === id); if (m) modalRepor(m.itemId); },
  'done-appt': (id) => {
    const a = state.appointments.find(x => x.id === id); if (!a) return;
    a.status = 'concluido';
    state.transactions.push({ id: uid(), type: 'in', category: 'Atendimentos', amount: a.price, desc: a.serviceName + ' — ' + a.clientName.split(' ')[0], date: a.date < todayISO() ? a.date : todayISO(), clientId: a.clientId });
    const sv = state.services.find(s => s.id === a.serviceId); if (sv) deduct(sv);
    save(); render(); toast('Atendimento concluído! ' + fmt(a.price) + ' no caixa 💰', 'ok');
  },
  'del-appt': (id) => { state.appointments = state.appointments.filter(a => a.id !== id); save(); render(); toast('Agendamento removido.', 'info'); },
  'del-tx': (id) => { state.transactions = state.transactions.filter(t => t.id !== id); save(); render(); toast('Lançamento excluído.', 'info'); },
  'del-cliente': (id) => { state.clients = state.clients.filter(c => c.id !== id); save(); render(); toast('Cliente removida.', 'info'); },
  'del-asset': (id) => { state.assets = state.assets.filter(a => a.id !== id); save(); render(); toast('Bem removido.', 'info'); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACTIONS[el.dataset.act]; if (fn) fn(el.dataset.id);
});

/* ============================================================
   BOOT
   ============================================================ */
function enterApp() { $('#landing').hidden = true; $('#app').hidden = false; document.body.style.background = 'var(--bg)'; render(); window.scrollTo(0, 0); }
function exitApp() { $('#app').hidden = true; $('#landing').hidden = false; window.scrollTo(0, 0); }

document.addEventListener('DOMContentLoaded', () => {
  $$('[data-enter]').forEach(b => b.onclick = enterApp);
  $$('[data-demo]').forEach(b => b.onclick = enterApp);
  $('#navMenu').addEventListener('click', e => { const b = e.target.closest('.nav-item'); if (b) setView(b.dataset.view); });
  $('[data-exit]').onclick = exitApp;
  $('#hamburger').onclick = () => $('.sidebar').classList.toggle('open');
  $('#bizPill').onclick = modalBiz;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
});
