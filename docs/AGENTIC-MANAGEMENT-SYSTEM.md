# Agentic Management System — Blueprint Completo

## Documento de Referência para Replicação em Outros Projetos

---

## 1. O Que É

Um sistema de gestão empresarial operado por um humano (CEO/founder) amplificado por agentes de IA organizados em 3 níveis hierárquicos. O humano sempre decide e direciona. Os agentes amplificam velocidade, abrangência analítica e capacidade de execução.

**Não é** automação 100%. **É** multiplicação de produtividade de 1 pessoa para operar como se fosse uma equipe de 10-20.

---

## 2. Por Que Existe

### O Problema

Um solo founder tem visão estratégica mas é limitado por:
- Não consegue pesquisar mercado, analisar financeiro, avaliar produto e planejar growth ao mesmo tempo
- Decisões estratégicas são tomadas com base em gut feeling em vez de dados
- O gap entre decisão e execução é lento (precisa contratar, treinar, coordenar)
- Informação fica fragmentada (planilhas, docs, cabeça do founder)

### A Solução

Uma "C-suite virtual" onde cada cadeira é um agente de IA especializado que:
- Opera APENAS com dados reais (nunca inventa)
- Ancora recomendações em cases de startups que já fizeram antes
- Desafia ativamente as ideias do CEO (nunca é yes-man)
- Pode acessar dados internos (banco de dados) e externos (web)

---

## 3. Fundamentos Teóricos

### Alinhamento com McKinsey "Agentic Organization" (2025-2026)

| McKinsey Shift | Como implementamos |
|---|---|
| Reimaginar trabalho como AI-first | Ciclo completo dados-análise-decisão-plano-execução-métricas é IA-first |
| Repensar papéis de liderança | CEO vira "orquestrador de agentes" |
| Redesenhar perfis e funções | CEO = context engineer + curador de qualidade + conector no mundo real |
| Cultura de reinvenção contínua | Infraestrutura dinâmica — operacional é criado e destruído por plano |
| Reestruturar em torno de valor | Planos como unidade organizacional, não departamentos |
| Transformar gestão de pessoas | Workforce híbrida: 1 humano + N agentes |

### Referências

- Sam Altman (OpenAI): "One-person billion-dollar companies" como tendência
- Dario Amodei (Anthropic): 70-80% chance em 2026
- Carnegie Mellon TheAgentCompany: melhor IA completa 30% das tarefas complexas (limitação real)
- CrewAI: 1.1B automações/trimestre, padrão hierárquico manager-workers
- Base44: vendida por $80M sem time de engenharia
- NxCode: "Vibe CEO" operating model — direction + curation, not execution

### Limitações Aceitas

- Agentes trabalham ~2h sem supervisão confiável (McKinsey 2026)
- Taxa de completude em tarefas complexas: ~30% (Carnegie Mellon)
- O mundo físico (visitas, reuniões, networking) exige humano
- Confiança e reputação são construídas por humanos, não bots

---

## 4. Arquitetura

```
CEO (humano)
 |
 |  /project:roundtable
 v
ESTRATÉGICO (fixo, permanente)
 Chief of Staff (opus) coordena 7 especialistas:
   Strategist (opus)        — posicionamento, competidores, moats
   Growth Hacker (sonnet)   — canais, aquisição, funil
   Finance (sonnet)         — unit economics, pricing, runway
   YC Advisor (opus)        — padrões startup, devil's advocate
   VC & Fundraising (sonnet)— investidores, pitch, capital
   Product & Tech (sonnet)  — features, codebase, priorização
   Market Researcher (sonnet)— dados mercado, regulação, fact-check
 |
 |  Output: strategic-plan.md → /project:tactical {plano}
 v
TÁTICO (fixo, CEO sempre presente)
 Tactical Architect (opus) — projeta infraestrutura operacional
 |
 |  Output: action-plan.md → /project:build {plano}
 v
BUILD (execução mecânica)
 Builder (sonnet) — cria agentes + comandos do action plan
 |
 |  Output: .claude/agents/plan-*.md + exec/kpi commands
 v
OPERACIONAL (dinâmico, por plano)
 N agentes executam → KPIs monitorados → feedback loop → volta ao estratégico
```

### Princípio-Chave: Planos como Unidade Organizacional

Diferente de departamentos fixos, aqui planos são containers:
- Cada plano tem seu strategic-plan.md + action-plan.md
- Cada plano gera seus próprios agentes operacionais
- Quando o plano termina, sua infraestrutura pode ser descartada
- Só a camada estratégica é permanente

---

## 5. Os 3 Protocolos (em TODOS os agentes)

### Protocolo 1: Integridade de Dados

Toda afirmação quantitativa DEVE ter fonte verificável.

Classificação obrigatória:
- `[DADO VERIFICADO]` — fonte citada (URL ou query no banco)
- `[ESTIMATIVA]` — cálculo sobre dados verificados, premissas explícitas
- `[PREMISSA]` — suposição que precisa ser validada
- `[SEM DADOS]` — admissão honesta de não saber

Se não tem fonte, não afirma. Silêncio > informação inventada.

### Protocolo 2: Evidence-Based (Cases Reais)

Toda recomendação DEVE ser ancorada em precedente real.

Hierarquia de evidência:
1. Mesmo mercado (marketplace trabalho BR)
2. Mesmo tipo (marketplace two-sided BR)
3. Mesmo estágio (pre-PMF, 0 users)
4. Mesmo modelo (gig economy global)
5. Princípio comprovado (YC, a16z) com 3+ cases

Se não encontrou precedente: `[EXPERIMENTAL — sem precedente verificado]`

### Protocolo 3: Desafio Ativo

NUNCA concordar para agradar. Antes de apoiar qualquer decisão:
1. Tentar INVALIDAR com dados
2. Encontrar pelo menos 2 riscos
3. Se sobreviver ao teste, apoiar COM ressalvas
4. YC Advisor: devil's advocate obrigatório (min 3 razões de falha)

---

## 6. Agentes Estratégicos

| Agente | Model | Domínio | Papel especial |
|---|---|---|---|
| Chief of Staff | opus | Coordenação, integração | Orquestrador da mesa |
| Strategist | opus | Posicionamento, competidores | Visão macro |
| Growth Hacker | sonnet | Canais, aquisição, métricas | Dados de funil |
| Finance | sonnet | Unit economics, pricing | Os números fecham? |
| YC Advisor | opus | Padrões startup, timing | Devil's advocate |
| VC & Fundraising | sonnet | Investidores, pitch | Capital e timing |
| Product & Tech | sonnet | Features, codebase | Lê código real |
| Market Researcher | sonnet | Mercado, regulação | Fact-checker |

Todos têm: Read, Glob, Grep, Bash, WebSearch, WebFetch
Todos acessam: banco de dados (Supabase via REST API) + web (pesquisa real)

---

## 7. Fluxo Completo

```
1.  /project:roundtable       → CEO + CoS + especialistas discutem
2.  Múltiplos rounds          → dados, análises, debates
3.  CEO declara pronto        → strategic-plan.md salvo
4.  /project:tactical {plano} → CEO + Architect projetam infra
5.  Múltiplos rounds          → ajustes de custo, escopo, agents
6.  CEO aprova                → action-plan.md salvo
7.  /project:build {plano}    → Builder cria agents + commands
8.  /project:exec-{plano}     → Agentes operacionais rodam
9.  /project:kpi-{plano}      → Métricas vs metas
10. Feedback                  → Volta ao passo 1 com dados novos
```

---

## 8. Banco de Dados

```sql
-- Memória compartilhada
CREATE TABLE agent_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_name TEXT,          -- null = global
    category TEXT NOT NULL,  -- 'business_context', 'metric', 'config'
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    updated_by TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(plan_name, category, key)
);

-- KPIs por plano
CREATE TABLE agent_kpis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_name TEXT NOT NULL,
    kpi_name TEXT NOT NULL,
    target_value NUMERIC,
    current_value NUMERIC,
    unit TEXT,
    measured_at TIMESTAMPTZ DEFAULT NOW(),
    measured_by TEXT
);
```

---

## 9. Estrutura de Arquivos

```
.claude/
  agents/
    strategy-advisor.md        # Permanente
    growth-analyst.md          # Permanente
    finance-analyst.md         # Permanente
    yc-advisor.md              # Permanente
    vc-fundraising.md          # Permanente
    product-advisor.md         # Permanente
    market-researcher.md       # Permanente
    plan-{nome}-*.md           # Dinâmico (por plano)
  commands/
    roundtable.md              # /project:roundtable
    tactical.md                # /project:tactical {plano}
    build.md                   # /project:build {plano}
    exec-{nome}.md             # Dinâmico (por plano)
    kpi-{nome}.md              # Dinâmico (por plano)

docs/
  plans/
    {nome-do-plano}/
      strategic-plan.md
      action-plan.md
  AGENTIC-MANAGEMENT-SYSTEM.md  # Este documento

supabase/migrations/
  20260329000000_agent_management.sql

scripts/
  seed-agent-memory.sql
```

---

## 10. Como Replicar em Outro Projeto

### Passo a passo

1. Copiar migração SQL (agent_memory + agent_kpis)
2. Copiar os 7 agentes estratégicos — adaptar DOMAIN KNOWLEDGE
3. Copiar os 3 comandos (roundtable, tactical, build) — são genéricos
4. Adaptar seed (agent_memory) com contexto do novo negócio
5. Manter os 3 protocolos em todos os agentes

### O que adaptar

- Domain knowledge dos agentes (concorrentes, métricas, tabelas do banco)
- Seed de business_context (produto, pricing, stack)
- Database queries (tabelas específicas do projeto)

### O que NÃO muda

- Arquitetura de 3 níveis
- Os 3 protocolos
- Chief of Staff como orquestrador
- YC Advisor como devil's advocate
- Fluxo: roundtable → tactical → build → exec → kpi → loop
- Princípio: humano decide, agente amplifica

---

## 11. Princípios Fundamentais

1. **Humano decide, agente amplifica**
2. **Data-centric** — decisões baseadas em dados reais
3. **Evidence-based** — recomendações ancoradas em cases
4. **Lean** — mínimo viável, escala conforme precisa
5. **Plano como container** — operacional é dinâmico e descartável
6. **Founder mode** — CEO é gargalo intencional nas decisões
7. **Honestidade brutal** — agentes desafiam antes de apoiar
8. **Custo consciente** — opus para estratégia, haiku para execução

---

*Blueprint v1.0 — Março 2026*
