# 💅 BelaCaixa — MVP

**Plataforma de Gestão Financeira Inteligente com Automação de Suprimentos para microempresas da beleza.**

Feito para empreendedoras do ramo (manicures, cabeleireiras, esteticistas, donas de salão), com modelo de assinatura mensal.

---

## ▶️ Como abrir (sem instalar nada)

**Opção 1 — mais simples:** dê **duplo clique no arquivo `index.html`**. Ele abre no seu navegador e funciona 100% offline.

**Opção 2 — servidor local (recomendado para testar):**
```
python -m http.server 4321
```
Depois acesse `http://localhost:4321` no navegador.

> Os dados ficam salvos **no seu próprio navegador** (localStorage). Nada é enviado para a internet.

---

## ✨ O que tem no MVP

| Módulo | O que faz |
|---|---|
| **Landing / Planos** | Página de vendas com proposta de valor e 3 planos de assinatura (Iniciante R$0, Profissional R$49, Império R$99). |
| **Painel** | KPIs (saldo, entradas, saídas, lucro líquido), gráfico de fluxo de caixa (6 meses), gráfico de despesas por categoria, insights da IA, agenda do dia e alertas de estoque. |
| **Fluxo de caixa** | Entradas e saídas com categorias, filtros por mês/tipo, cálculo automático de lucro líquido e margem. Atalho de "Registrar atendimento". |
| **Clientes** | **Cadastro automático**: ao registrar um atendimento com nome novo, a cliente é criada sozinha. Histórico de visitas, total gasto, ticket médio e marca de cliente "fiel". |
| **Agenda** | Agendamento de atendimentos com **sugestão automática de horário livre**. Ao **Concluir**, a receita cai no caixa e o material usado sai do estoque automaticamente. |
| **Estoque & Compras (IA)** | Monitora consumo e estima em quantos dias cada item acaba, **caça promoções de matéria-prima no mercado**, alerta o que repor e **monta o pedido de compra** com os melhores preços. |
| **Patrimônio** | Soma de bens + caixa, evolução do patrimônio (6 meses) e **sugestões inteligentes de investimento** com base no caixa livre (reserva de emergência, CDB, reinvestir no negócio). |
| **Assistente IA** | Chat em português: pergunte "como está meu lucro?", "posso investir?", "o que preciso comprar?", "quais minhas melhores clientes?" e receba respostas com base nos seus números. |

---

## 🧠 Sobre a "inteligência"

Neste MVP, a IA é um **motor de regras** que analisa os seus dados reais (fluxo de caixa, ritmo de atendimentos, níveis de estoque, caixa livre) e gera recomendações honestas e acionáveis — sem depender de internet ou de chave de API. É a base perfeita para, na evolução do produto, plugar um modelo de linguagem (ex.: Claude) e cotações reais de fornecedores.

## ⚙️ Configurações

Clique no nome do negócio no topo (✎) para:
- Renomear o negócio
- Ajustar a reserva de emergência e a meta de faturamento
- **Restaurar os dados de demonstração**

---

## 🛠️ Stack

HTML + CSS + JavaScript puro (zero dependências, zero build). Gráficos em SVG feitos à mão. Tudo em 3 arquivos: `index.html`, `styles.css`, `app.js`.

## 🚀 Próximos passos sugeridos

- Autenticação e backend (multiusuário / multi-unidade)
- Cobrança da assinatura (ex.: Stripe / Pix recorrente)
- Integração real com fornecedores para cotação de matéria-prima
- App mobile / PWA instalável
- Relatórios em PDF e exportação
