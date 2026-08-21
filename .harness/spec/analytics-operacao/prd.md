# PRD — Analytics de operação para a empresa (F9)

> Expande `.harness/spec/analytics-operacao/spec.md` (R1–R19, A1–A14). Este documento **não substitui** a
> spec: resolve as decisões difíceis que ela deixou implícitas, corrige três pontos onde a redação da spec
> colide com o schema real, e quebra a entrega em steps com territórios de arquivo disjuntos.
>
> Origem: entrevista 17/08/2026, sócio-operador de 10 unidades Divino Fogão + rede fitness. Ele quer o que
> monta hoje na mão: **desempenho do freela, custo por hora, ratio de horas trabalhadas, contratações por mês**,
> cruzado com nível de falta e quebra de escala.
>
> Decisões de produto **fechadas pelo humano — não reabrir**: só gasto **absoluto** (nada de % da folha,
> nada de tabela de tarifa padrão — o valor vem da criação do turno); sem cobrança de assinatura.

---

## Resumo

Uma página nova de leitura, `/company/operacao`, que agrega dado que o Worki **já captura** (chamados de
turno, alvos, candidaturas, check-in/checkout, marcadores de pagamento, avaliações) em: gasto absoluto,
contratações, custo por hora, razão horas realizadas ÷ previstas, tempo médio de preenchimento do chamado,
chamados por status e motivo, e um bloco por freela (aceite, no-show, cancelamentos, pontualidade,
desempenho).

Quem usa: **empresa** (papel `company`, rota sob `/company/*`). O papel worker **não** acessa nada disto —
e nenhuma métrica por freela desta tela aparece em qualquer rota do worker.

**Article 8 intacto:** feature 100% somente-leitura. Nenhuma escrita, nenhuma RPC de saldo, nenhum import de
`walletService`, nenhuma tabela financeira alterada. O gasto é lido de `shift_payments` (modo A) e, quando
existir, de `escrow_transactions` (modos B/C) — sempre como leitura.

---

## Goals

- **G1** — A empresa lê, numa tela só e em < 3 s, os quatro números que hoje ela monta em planilha: gasto
  absoluto do período, contratações do período, custo por hora e razão horas realizadas ÷ previstas — com
  variação vs. o período anterior de mesma duração.
- **G2** — O tempo médio de preenchimento (`first_claim_at − created_at`) fica visível como métrica de topo,
  porque é o número que prova o ROI ("de 2 horas para 6 minutos").
- **G3** — "Demanda não atendida" (chamado `expired`) e "motivo da quebra" (`shift_calls.reason`) aparecem
  agregados — é literalmente o relatório manual do sócio, automatizado.
- **G4** — Nenhum número exibido mente: se a fonte está vazia, o bloco diz que está vazia; se a amostra é
  pequena demais, mostra "—"; se o dado veio truncado ou estimado, a tela rotula isso.
- **G5** — A feature não fecha a porta do multi-unidade (F13): o escopo de empresa é resolvido num ponto único
  e todas as linhas brutas carregam a unidade de origem, mesmo sem UI de agrupamento na v1.

**Non-goal explícito:** virar produto de BI. Sem export, sem gráfico com biblioteca, sem drill-down infinito.

---

## Decisões que este PRD fecha

### D1 — Onde as agregações rodam: **client-side**, com três guardas obrigatórias

**Decisão: manter client-side no service (R2 / Clarifications Q1), NÃO criar RPC nem view materializada
nesta entrega** — mas com guardas que a spec não previu, porque o argumento "client-side é seguro aqui"
só se sustenta com elas.

Por que client-side sobrevive ao escrutínio neste caso, diferente do precedente de F3:

- O caso F3 (`update_job_series_future` ser DEFINER) era **mutação**: contar "quantas ocorrências vou
  alterar" sob RLS simples e depois alterar sob outra visão produz uma tela que promete 10 e faz 3. Aqui não
  há mutação — o pior caso é um número menor que o real, e ele é **detectável** (ver guarda 2).
- As duas tabelas mais críticas da feature (`shift_calls`, `shift_call_targets`) já têm SELECT ancorado em
  `is_job_owner` com **ancoragem dupla**. A RLS delas não mente para a dona do turno.
- Criar uma RPC `SECURITY DEFINER` que agrega **métrica comportamental por freela** (no-show, pontualidade,
  aceite) é adicionar um objeto privilegiado cujo produto é justamente o dado mais sensível da feature. É
  superfície de auditoria e de LGPD que não se paga na escala do piloto.
- Article 5 e o precedente direto (`orderReportService.ts`) mandam no mesmo sentido; zero migration = zero
  risco de tocar Article 8.

**Guarda 1 — ancoragem dupla no client, obrigatória.** `orderReportService.ts` usa
`.eq('company_id', user.id)`. Isso é **ancoragem simples** e é um bug latente: uma empresa cujas linhas estão
ancoradas via `companies.owner_id` (`company_id = companies.id ≠ auth.uid()` — há linhas em produção nos dois
formatos, ver `20260816210000`) veria **zero** e o relatório não erraria, só ficaria vazio silenciosamente.
O service novo resolve o escopo uma vez, numa função `resolveCompanyScope(): Promise<string[]>` que devolve
`[user.id, companies.id]` (deduplicado) e **toda** query usa `.in('company_id', ids)`. Nunca `.eq`.
Não corrigir `orderReportService` nesta entrega (fora de escopo, arquivo de outra feature) — registrar como
dívida no risco R-7.

**Guarda 2 — truncamento é proibido, silêncio é proibido.** PostgREST corta em `max-rows` (1000 por default
no Supabase) **sem erro**. Um mês de operação de quem dispara chamados para 20–30 alvos estoura isso em
`shift_call_targets` com facilidade. Um número truncado é pior que um número ausente porque parece certo.
Regra: toda leitura de coleção do service pagina explicitamente com `.range(offset, offset+PAGE-1)` em laço
até vir página incompleta, com `MAX_PAGES` de segurança; se `MAX_PAGES` for atingido, o service devolve
`truncated: true` no resultado e a UI exibe faixa honesta ("período grande demais para calcular com
precisão — reduza o intervalo"), nunca o número parcial sem rótulo.

**Guarda 3 — `applications` precisa de verificação de policy antes do código.** As policies de SELECT de
`applications` para empresa existem em duas migrations (`20260309000000`: `jobs.company_id = auth.uid()`;
`20260317160000`: via `companies.owner_id`). Policies permissivas se somam por OR — **se as duas ainda
existirem no banco**, o efeito é ancoragem dupla e está tudo bem; se a segunda tiver substituído a primeira,
metade das empresas some das métricas de no-show/cancelamento. **Step 0 verifica isso contra o banco real
(Supabase MCP) antes de qualquer código.** Se a verificação mostrar ancoragem simples, isso vira gate do
architect (ver "Gates do architect", G-A2).

**Gatilhos de reabertura desta decisão (viram gate `harness-architect` + ADR quando ocorrerem):**
1. Qualquer fonte passa de ~5.000 linhas num período de 1 mês, ou a tela carrega em > 3 s no dado real.
2. Chegada de **F13 multi-unidade**: comparar 10 unidades multiplica volume por ~10 **e** troca "somar tudo"
   por `GROUP BY unidade` — é o momento natural de descer a agregação para uma RPC/view.
3. Pedido de export/relatório agendado (hoje out-of-scope).

### D2 — Horas: regra de cálculo, meia-noite, e o que fazer sem checkout

**Fonte.** `calculateWorkedHours` é extraída de `ReceiptView.tsx` para `lib/dateUtils.ts` (R4), **mesma
assinatura, mesmo comportamento** (`null` se ausente ou se checkout ≤ checkin). Zero reimplementação.

**Meia-noite já está resolvida e não se toca:** `worker_checkin_at`/`worker_checkout_at` (e as confirmações
da empresa) são `timestamptz` **absolutos** — a subtração atravessa a meia-noite corretamente sem nenhum
ajuste. O hack `+24h` de `calculateHours` em `CompanyCreateJob.tsx` existe para **strings de hora soltas sem
data** (`work_start_time`/`work_end_time`) e **NÃO pode ser copiado para cá**. Onde a meia-noite ainda morde
é no *horário previsto* (D2c e R13/R15), não no realizado.

**D2a — Resolução de fonte: por CAMPO, não por par (isto corrige a redação de R7).**
R7 descreve fallback em par ("se ausente, usa o par da empresa"). `ReceiptView` resolve **campo a campo**
(`checkin = worker_checkin_at ?? company_checkin_confirmed_at`, idem checkout). **Vence a resolução por campo**,
porque o recibo é o documento que a empresa já lê para aquele turno e duas telas do mesmo turno não podem
exibir totais de horas diferentes. Consequência aceita: uma duração pode combinar chegada marcada pelo freela
com saída confirmada pela empresa. O service **rastreia a origem** de cada ponta (`'worker' | 'company'`,
mesmo shape de `ShiftAttendance`) e a UI rotula quando a amostra do período tem fonte mista.

**D2b — Turno sem checkout: sem média inventada, e o tratamento difere por card.**
- **R7 (Custo por hora):** turno `completed` sem nenhuma hora real cai para `jobs.estimated_hours`. O card
  exibe obrigatoriamente "X de Y turnos usaram a estimativa" (transparência de fonte — o tipo já existente
  `SpendByWorker.hoursSource: 'real' | 'estimated' | 'mixed'` em `types/index.ts` é o vocabulário a reusar).
  Denominador 0 → "—", nunca `Infinity`/`NaN`.
- **R8 (Razão realizadas ÷ previstas):** turno **sem horas reais é excluído do numerador E do denominador**.
  Usar `estimated_hours` como se fosse realizado empurraria a razão para 1,00 artificialmente e destruiria a
  única pergunta que o card responde ("o turno rendeu o que eu previ?"). Também são excluídos os turnos com
  `estimated_hours` nulo (já em R8). O card exibe as **duas** contagens de exclusão separadas: "N sem
  estimativa cadastrada", "M sem marcação de ponto". Isto é mais estrito que a redação de R8 — proposital.
- **Nunca** preencher hora faltante com média do período, média do freela, ou `work_end_time − work_start_time`.

**D2c — Guarda de sanidade (`ASSUMIDO`, revisável no HALT).** Checkout esquecido produz durações absurdas
(o freela sai e marca no dia seguinte). Durações acima de `MAX_PLAUSIBLE_SHIFT_HOURS = 18` são **descartadas**
do cálculo e contadas em "N turnos com marcação inconsistente", exibido junto do card de custo por hora.
Descartar sem contar seria maquiar; incluir contaminaria o custo/hora com um denominador falso.

### D3 — Fuso: `America/Sao_Paulo` explícito, não o fuso do dispositivo

Todo agrupamento por dia/semana/mês é **data civil brasileira**. Precedente: `job_local_date` (F4) existe
exatamente porque `::date` cru usaria UTC do servidor.

A armadilha específica do client-side: `new Date().getMonth()` usa o fuso do **navegador**. O gerente que
abre o painel viajando, ou com o relógio do dispositivo em outro fuso, veria "mês" deslocado — e nenhum
teste pegaria isso rodando na máquina do dev. Decisão: `lib/dateUtils.ts` ganha
`todayInBrazil(): string` e `toBrazilDateOnly(iso: string): string`, ambas via
`Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })` — **não** hardcodar `-03:00` (o Brasil não
tem DST hoje, mas literal de offset é exatamente o tipo de premissa que vira cicatriz).
Regras derivadas:
- Bucketização de qualquer `timestamptz` (`paid_at`, `shift_calls.created_at`, `worker_checkin_at`) para dia
  civil passa por `toBrazilDateOnly`.
- Limites do período viram **instantes** (início do dia BR e fim do dia BR) para os filtros `.gte`/`.lte`
  server-side. Nunca comparar `timestamptz` com string `YYYY-MM-DD`.
- `jobs.start_date` é `timestamptz` cuja hora é **sempre meio-dia local** (âncora de `localDateToTimestamp`,
  ver `20260817000400` e `CompanyCreateJob.handleSubmit`). Serve para saber **o dia** do turno — e só.
  **Ver D7: é a correção mais importante deste PRD.**
- Preservar a cicatriz de `dateUtils.ts`: proibido `toISOString()` cru para data e `new Date('YYYY-MM-DD')`.

### D4 — Desempenho do freela: **sinalizado ao humano, não decidido aqui**

Transformar métricas por freela em ranking muda o produto (vira score de reputação, com consequência
trabalhista e LGPD art. 20 — decisão apoiada em tratamento automatizado). **Este PRD recomenda, o humano
decide no HALT:**

- **Opção A (recomendada, = R16/R17 da spec):** métricas **componentes lado a lado**, nunca combinadas.
  `workers.rating_average` rotulado **"Avaliação (global — todas as empresas)"**; "Turnos concluídos com
  você: N"; "% de aceite" (só com ≥ 2 chamados recebidos); "No-show: N"; "Pontualidade %" (só com ≥ 2
  check-ins). Ordenação **alfabética por nome**. Sem score único, sem ranking (nem interno), sem exposição
  ao próprio freela.
- **Opção B (rejeitada por este PRD):** score composto/ordenação por desempenho. Vira produto novo, exige
  ADR próprio e revisão de LGPD.

**Sinais admitidos na v1:** review (`workers.rating_average`), aceite (`shift_call_targets`), no-show
(`applications` + ausência de check-in), cancelamentos (`applications.status='cancelled'`, com o rótulo fixo
de autoria desconhecida — R14), turnos concluídos.

**Sinal DELIBERADAMENTE excluído da v1 — F4 por freela.** `shift_attendance_confirmations` só vira "taxa de
furo" confiável se o cron `request_attendance_confirmations_7d` estiver ativo em produção; `architecture.md`
declara `pg_cron` como **pré-requisito de ops, não garantia**. Sem cron, "não respondeu" significa "ninguém
perguntou" — e essa métrica acusaria o freela por uma falha de infraestrutura. Portanto: F4 entra **só como
bloco agregado de operação** ("confirmações pedidas / respondidas / recusadas no período"), com nota de
dependência do agendador, e **nunca** como coluna por freela na v1. Reabrir quando o cron for verificado
ativo em produção por ≥ 30 dias.

### D5 — Extensibilidade para multi-unidade (F13) sem implementar multi-unidade

O modelo de dados do analytics **não pode** ficar impossível de estender quando `is_job_owner` e
`is_company_owner` forem unificadas (contrato do `ADR-20260817-seam-autorizacao-empresa.md`, decisão 3).
Cinco regras de construção, verificáveis em code review:

1. **Ponto único de escopo:** `resolveCompanyScope(): Promise<string[]>` no service. Hoje devolve 1–2 ids
   (ancoragem dupla). Quando F13 chegar, devolve N unidades. **É o único lugar do frontend que muda.**
   Comentário obrigatório na função apontando para o ADR.
2. **`.in(...)` sempre, `.eq(...)` nunca** para `company_id`/`job_id` — inclusive quando a lista tem 1 item.
3. **Toda linha bruta carrega a unidade de origem.** As estruturas intermediárias do service guardam
   `companyId` (ou `jobId` resolvível para `companyId` por um mapa já construído), mesmo que a UI v1 some
   tudo. F13 adiciona um `groupBy` — não reescreve a coleta.
4. **Agregação é função pura sobre as linhas brutas**, separada da coleta: `aggregate(rows, period)`.
   Testável sem Supabase, e reutilizável por unidade quando F13 chegar.
5. **Sem cache/singleton chaveado por empresa** no módulo — estado de escopo mora no componente.

### D6 — Volume vazio: quatro estados, nunca colapsados (R18 elevado a requisito de arquitetura)

No piloto quase todo bloco começa sem dado. O tipo de retorno de cada bloco carrega o estado explicitamente
(union type), e a UI é obrigada a tratar os quatro:

| Estado | Quando | Renderização |
|---|---|---|
| `loading` | busca em voo | skeleton neo-brutalista, nunca "0" |
| `sem-fonte` | zero linhas na fonte no período | mensagem acionável ("Nenhum chamado disparado neste período") + CTA quando fizer sentido. **Nunca** "0%" / "R$ 0,00" / gráfico vazio |
| `amostra-insuficiente` | há linhas, mas abaixo do mínimo (ex.: recebidos < 2, check-ins < 2) | "—" + nota do porquê |
| `zero-real` | há fonte suficiente e o resultado É zero | mostra **0** com contexto positivo ("0 no-shows em 12 turnos") — zero legítimo é resultado, não vazio |

Distinguir `sem-fonte` de `zero-real` é a alma do R18: "R$ 0,00 porque ninguém pagou nada" e "R$ 0,00 porque
não houve turno" são leituras opostas para o sócio.

### D7 — **Correção de schema: `jobs.start_date` não contém o horário do turno**

`jobs.start_date` é `timestamptz` gravado com **âncora de meio-dia local** (`localDateToTimestamp`), tanto no
caminho avulso (`CompanyCreateJob.handleSubmit`) quanto na série (`20260817000400`, seção 6: "`jobs.start_date`
é DERIVADO de `series_occurrence_date` com a âncora de meio-dia — nunca o contrário"). O horário real do turno
vive em `jobs.work_start_time` / `work_end_time` (strings `HH:MM`, sem data).

Isto invalida a leitura literal de dois requisitos e o builder **não pode** implementá-los como escritos:

- **R13 (no-show)** — "`jobs.start_date + estimated_hours < agora`" marcaria o turno como encerrado a partir
  de 12:00 + N h, independentemente do horário real. Um turno noturno seria contado como no-show antes de
  começar. **Regra correta:** instante de término esperado =
  `dia civil BR de start_date` + `work_end_time`; se `work_end_time <= work_start_time`, **soma 1 dia**
  (turno que cruza a meia-noite — este é o único lugar da feature onde o ajuste de meia-noite se aplica).
  Sem `work_end_time`, cai para `work_start_time + estimated_hours`; sem os dois, o turno é **excluído** da
  métrica de no-show e contado como "sem horário cadastrado" — não presumido.
- **R15 (pontualidade)** — a spec já pedia ao builder confirmar contra o schema real. **Confirmado aqui:**
  `work_start_time` é a fonte, `start_date` fornece **apenas o dia**. Instante esperado =
  `dia civil BR de start_date` + `work_start_time` (em `America/Sao_Paulo`). Tolerância
  `LATE_TOLERANCE_MINUTES = 10` (constante de código, não configurável — R15). Turno sem `work_start_time`
  é excluído do cálculo, não considerado pontual.

Step 0 confirma o formato de `work_start_time` no banco real (`HH:MM` vs `HH:MM:SS`) antes de qualquer parse.

### D8 — Gasto: união modo A + escrow (B/C), sem dupla contagem

`shift_payments` com `status='recorded'` e `paid_at` no período (regra vigente "promessa ≠ liquidação" —
`scheduled` nunca entra). **Mais** `escrow_transactions` com `status IN ('released','captured')` no período,
que é a definição já usada pelo tipo `AccumulatedSpend` em `types/index.ts`.

Dedupe: um mesmo `(job_id, worker_id)` **não** deve entrar pelas duas fontes. No piloto (100% modo A) a
segunda fonte é vazia por construção, mas a união precisa ser correta desde já. Regra: chaveia por
`(job_id, worker_id)`; havendo linha nas duas fontes, **vence `shift_payments`** (modo A é o registro
declarado pela empresa) e o service contabiliza o conflito em `conflictingSpendRows` para a UI rotular.
Se a verificação do Step 0 mostrar zero linhas de escrow no ambiente-alvo, a fonte B/C entra assim mesmo
(código pequeno, evita um número errado no dia em que alguém ativar o modo C) — mas sem UI dedicada.

---

## Acceptance criteria

Herdados: **A1–A14 da spec valem integralmente**, com duas emendas e cinco acréscimos.

**Emendas (a spec é sobrescrita aqui):**

- [ ] **A3'** (emenda de A3/R7) — a resolução de fonte de horas é **por campo** (checkin e checkout resolvidos
  independentemente, `worker_*` antes de `company_*`), idêntica a `ReceiptView`, e não por par. O mesmo turno
  exibe o mesmo total de horas no recibo e no painel de operação.
- [ ] **A7'** (emenda de A7/R13) — o instante de término esperado do turno é
  `dia civil BR de jobs.start_date` + `jobs.work_end_time` (com `+1 dia` quando `work_end_time <= work_start_time`),
  **nunca** `start_date + estimated_hours`. Turno sem `work_end_time` e sem `work_start_time` é excluído da
  métrica de no-show e reportado como "sem horário cadastrado".

**Acréscimos:**

- [ ] **A15** — DADO uma empresa cujas linhas estão ancoradas via `companies.owner_id`
  (`jobs.company_id ≠ auth.uid()`), QUANDO ela abre `/company/operacao`, ENTÃO todos os blocos mostram os
  dados dela (ancoragem dupla via `resolveCompanyScope`), e não a tela vazia que `.eq('company_id', user.id)`
  produziria.
- [ ] **A16** — DADO um período cujo volume ultrapassa o teto de paginação do service, QUANDO a página
  renderiza, ENTÃO exibe a faixa de truncamento com orientação para reduzir o intervalo, e **nenhum** número
  parcial é exibido sem esse rótulo.
- [ ] **A17** — DADO um turno `completed` com check-in marcado e **sem** checkout em nenhuma das duas fontes,
  QUANDO os cards calculam, ENTÃO ele usa `estimated_hours` no card Custo por hora (contado em "X de Y usaram
  estimativa") e é **excluído** do numerador e do denominador do card Razão realizadas ÷ previstas.
- [ ] **A18** — DADO um dispositivo com fuso diferente de `America/Sao_Paulo`, QUANDO o preset "Mês" é
  aplicado, ENTÃO o intervalo é o mês civil **brasileiro**, idêntico ao que um dispositivo em BRT veria.
- [ ] **A19** — DADO um período com 12 turnos concluídos e nenhum no-show, QUANDO o bloco de no-show
  renderiza, ENTÃO mostra "0" como resultado com contexto (`zero-real`), e não a mensagem de estado vazio;
  DADO um período sem nenhum turno, ENTÃO mostra o estado vazio (`sem-fonte`) e não "0".

---

## Files to touch

| Path | Ação | Camada | Território | Razão |
|---|---|---|---|---|
| `frontend/src/lib/dateUtils.ts` | modificar | lib | **builder** | Exporta `calculateWorkedHours` (R4), `formatDurationMs` (R9), `todayInBrazil`/`toBrazilDateOnly` (D3) |
| `frontend/src/lib/dateUtils.test.ts` | criar/modificar | test | **builder** | Meia-noite, checkout ausente, fuso não-BR, duração |
| `frontend/src/pages/ReceiptView.tsx` | modificar | pages | **builder** (exceção declarada) | Passa a importar `calculateWorkedHours` de `lib/dateUtils`; remove a cópia local. Edição mecânica, sem mudança de UI |
| `frontend/src/services/operationAnalyticsService.ts` | criar | services | **builder** | Coleta (paginada, escopo duplo) + agregação pura. Somente leitura |
| `frontend/src/services/operationAnalyticsService.test.ts` | criar | test | **builder** | Agregação como função pura, sem Supabase |
| `frontend/src/types/index.ts` | modificar | types | **builder** | Tipos de retorno dos blocos (com union de estado, D6) |
| `frontend/src/pages/company/CompanyOperationAnalytics.tsx` | criar | pages | **frontend-builder** | UI da página (R1, R3, R19) |
| `frontend/src/components/company/analytics/*.tsx` | criar | components | **frontend-builder** | Cards/tabelas/barras nativas reutilizáveis |
| `frontend/src/App.tsx` | modificar | app | **frontend-builder** | Rota `operacao` sob `/company` + `lazy` |
| `frontend/src/components/Sidebar.tsx` | modificar | components | **frontend-builder** | Item "Operação" no menu da empresa |
| `frontend/src/components/BottomNav.tsx` | **decidir, provavelmente não tocar** | components | **frontend-builder** | Já tem 6 itens; ver risco R-9 |

**Nenhuma migration. Nenhuma edge function. Nenhum arquivo em `supabase/`.**

Territórios são disjuntos: o builder **não** abre nada em `pages/company/` nem `App.tsx`; o frontend-builder
**não** abre `services/`, `lib/` nem `types/`. A única exceção é `ReceiptView.tsx` (page tocada pelo builder)
— declarada aqui para o frontend-builder não encostar nela. O `harness-frontend-reviewer` será acionado
mesmo assim pelo trigger de `pages/**`.

---

## Steps ordenados

### Step 0 — Verificação contra o banco real (**bloqueante, antes de qualquer código**) — 0,5 dia
Agente: **harness-builder** (leitura via Supabase MCP; nenhum arquivo escrito).
Verificar e registrar no PR:
1. Policies de SELECT vigentes em `applications` — as duas (`auth.uid()` e via `owner_id`) coexistem? Se
   **não**, escalar a **G-A2**.
2. Tipo e formato de `jobs.work_start_time` / `work_end_time` (`time` vs `text`; `HH:MM` vs `HH:MM:SS`),
   e quantos turnos os têm nulos.
3. Confirmar que `jobs.start_date` em produção tem componente de hora = meio-dia local (amostragem) — D7.
4. Volume real por fonte num mês típico (`shift_call_targets`, `applications`, `shift_payments`) → valida ou
   derruba D1.
5. Existência de linhas em `escrow_transactions` no ambiente-alvo → dimensiona D8.
**Done:** relatório curto no PR com os 5 pontos. Qualquer surpresa em (1) ou (4) volta ao planner/architect
antes do Step 1.

### Step 1 — `lib/dateUtils.ts`: extrações e fuso — 0,5 dia
Agente: **harness-builder**. Território: `lib/dateUtils.ts`, `lib/dateUtils.test.ts`, `pages/ReceiptView.tsx`.
- Extrair `calculateWorkedHours` (R4) — mesma assinatura, mesmo comportamento, mesmo JSDoc; `ReceiptView`
  importa e a cópia local morre.
- Extrair `formatDurationMs(ms: number): string` do núcleo de `formatDurationShort`; `formatDurationShort`
  passa a chamá-la (R9). Uma medida, uma formatação.
- Adicionar `todayInBrazil()` e `toBrazilDateOnly(iso)` (D3), com JSDoc explicando por que o fuso do
  dispositivo não serve.
**Done:** testes cobrindo meia-noite, checkout ausente/menor, `null` e um caso com `TZ` não-brasileiro;
`ReceiptView` renderiza idêntico; `build` + `lint` verdes.

### Step 2 — Tipos dos blocos em `types/index.ts` — 0,25 dia
Agente: **harness-builder**.
- Union de estado por bloco (D6): `{ state: 'sem-fonte' } | { state: 'amostra-insuficiente' } | { state: 'ok', ... }`.
- Tipos: `OperationSummary` (4 cards + deltas + contagens de exclusão/estimativa), `FillTimeStats`,
  `CallsByStatus`, `CallsByReason`, `WorkerAcceptanceRow`, `WorkerAttendanceRow`, `WorkerPerformanceRow`,
  `OperationAnalytics` (agregado, com `truncated: boolean` e `scopeCompanyIds: string[]`).
- Reaproveitar o vocabulário existente (`hoursSource: 'real' | 'estimated' | 'mixed'`).
**Done:** compila; nenhum `any`; toda linha por freela carrega `companyId` (D5.3).

### Step 3 — Coleta no service (queries, escopo, paginação) — 1 dia
Agente: **harness-builder**. Território: `services/operationAnalyticsService.ts`.
- `resolveCompanyScope()` (D5.1) + `.in(...)` em tudo (D1 guarda 1).
- Leituras paginadas com `truncated` (D1 guarda 2): `jobs`, `applications`, `shift_payments`,
  `escrow_transactions`, `shift_calls`, `shift_call_targets`, `workers` (nomes/rating),
  `shift_attendance_confirmations` (agregado).
- Sem N+1: lote por `.in('job_id', jobIds)`, mesmo padrão de `orderReportService`.
- `logError` sempre; nunca `console.log`; nenhum import de `walletService`.
**Done:** função de coleta devolve linhas brutas tipadas + `truncated`; nenhuma agregação aqui.

### Step 4 — Agregação pura + métricas — 1,5 dia
Agente: **harness-builder**. Mesmo arquivo, função separada `aggregate(rows, period)` (D5.4).
- R5 gasto (união A + B/C, dedupe, D8) · R6 contratações · R7 custo/hora (D2b, D2c) · R8 razão (D2b estrito)
  · R9 tempo médio de preenchimento · R10 chamados por status (com `expired` sempre) · R11 motivo da quebra.
- Deltas vs. período anterior de mesma duração, só nos 4 cards de resumo.
**Done:** testes de tabela cobrindo A2, A4, A5, A17, A19 e os quatro estados de D6, sem tocar Supabase.

### Step 5 — Blocos por freela — 1 dia
Agente: **harness-builder**.
- R12 aceite (mínimo 2, ordenação alfabética) · R13 no-show (**regra corrigida A7'**) · R14 cancelamentos
  (com rótulo fixo) · R15 pontualidade (D7, tolerância 10 min, mínimo 2) · R16 desempenho (rating global
  rotulado + concluídos com você).
- **Proibido** no código: qualquer ordenação por métrica, qualquer campo `score`.
**Done:** testes cobrindo A6, A7', A8, A11, A13 e o caso "turno sem horário cadastrado".

### Step 6 — UI da página + componentes — 1,5 dia
Agente: **harness-frontend-builder** (Gemini 3). Território: `pages/company/CompanyOperationAnalytics.tsx`,
`components/company/analytics/*`.
- Seletor de período (R3) espelhando `CompanyOrdersReport` (`applyPreset`/`startOfWeek`/`startOfMonth`), com
  as datas vindas de `todayInBrazil` (D3).
- Cards, tabelas e barras 100% nativas (R19) — **nenhuma dependência nova** (A14).
- Os quatro estados de D6 renderizados distintamente; faixa de truncamento (A16); rótulos de fonte
  (estimativa / marcação inconsistente / avaliação global / autoria de cancelamento desconhecida).
- Mobile-first: cards empilhados, tabela no desktop.
**Done:** `build` + `lint` verdes; `package.json` intocado.

### Step 7 — Rota + navegação — 0,25 dia
Agente: **harness-frontend-builder**. `App.tsx` (`<Route path="operacao">` sob `/company`, `lazy`) + `Sidebar`.
BottomNav: ver risco R-9 — decisão de não adicionar 7º item, com acesso a partir do Dashboard/Relatório.
**Done:** A10 verificado manualmente (worker autenticado em `/company/operacao` é bloqueado).

### Step 8 — Revisão + smoke — 0,5 dia
`harness-frontend-reviewer` (tocou `pages/**`) ‖ **`harness-security-reviewer` (recomendado mesmo sem
migration** — a tela agrega dado comportamental por freela; revisar D4/R17 e LGPD) → `harness-evaluator`.
Smoke manual obrigatório: (a) empresa `owner_id`-ancorada; (b) empresa nova sem dado nenhum (A9/A19);
(c) worker tentando a URL (A10); (d) troca de preset recalculando tudo (A12).

**Total: ~7 dias.** XL confirmado.

---

## Subagents por step

| Step | Agente | Observação |
|---|---|---|
| 0 — verificação no banco | harness-builder | Leitura via MCP; bloqueante |
| 1 — dateUtils + ReceiptView | harness-builder | Toca uma page por exceção declarada |
| 2 — tipos | harness-builder | |
| 3 — coleta | harness-builder | |
| 4 — agregação | harness-builder | |
| 5 — por freela | harness-builder | |
| 6 — UI | harness-frontend-builder | Gemini 3, fallback Claude |
| 7 — rota + nav | harness-frontend-builder | |
| 8 — revisão | frontend-reviewer ‖ security-reviewer → evaluator | |

---

## Gates do `harness-architect`

**Nenhum gate obrigatório no caminho feliz** — não há migration, não há RPC, não há mudança de saldo/escrow.
O gate aparece **condicionalmente**, e o orchestrator deve escalar se qualquer um destes ocorrer:

| Gate | Gatilho | Por quê |
|---|---|---|
| **G-A1** | Decidir criar **qualquer** RPC, view ou view materializada para as agregações | Muda onde a lógica de agregação mora + cria objeto `SECURITY DEFINER` sobre dado comportamental. Exige ADR (a spec já declara isso em Out-of-scope) |
| **G-A2** | Step 0 revelar que `applications` tem SELECT de empresa com **ancoragem simples** | Métricas de no-show/cancelamento ficariam vazias para parte das empresas; corrigir exige migration de policy — território do architect + security-reviewer |
| **G-A3** | Step 0 revelar volume que estoura a paginação em uso normal (D1, gatilho 1) | Derruba a decisão D1; a saída é RPC → G-A1 |
| **G-A4** | Alguém propor a Opção B de D4 (score composto / ranking) | Muda o produto; exige ADR + revisão LGPD |
| **G-A5** | Qualquer necessidade de persistir `cancelled_by` (autoria de cancelamento) | Migration nova; explicitamente out-of-scope aqui |
| **G-A6** | Adicionar filtro por unidade (F13) nesta tela | Toca o contrato `is_job_owner`/`is_company_owner` do ADR-20260817 |

---

## Risk matrix

| # | Risco | Prob | Impacto | Mitigação |
|---|---|---|---|---|
| R-1 | **Truncamento silencioso do PostgREST** (max-rows 1000) faz o número parecer certo e estar errado | A | A | D1 guarda 2: paginação explícita + flag `truncated` + faixa honesta (A16). Step 0 mede o volume real |
| R-2 | **Ancoragem simples** (`.eq('company_id', user.id)`, copiada de `orderReportService`) deixa parte das empresas com painel vazio | A | A | D5.1/D5.2: `resolveCompanyScope` + `.in(...)`; A15 cobre no teste e no smoke |
| R-3 | **`start_date` usado como horário do turno** (R13/R15 escritos assim) produz no-show e atraso falsos | A | A | D7 + emenda A7'; Step 0 confirma o meio-dia em produção |
| R-4 | **Fuso do dispositivo** desloca mês/semana e nenhum teste local pega | M | M | D3: `todayInBrazil`/`toBrazilDateOnly` via `Intl`; teste com `TZ` não-brasileiro |
| R-5 | **Checkout esquecido** infla horas e derruba o custo/hora | M | M | D2c: descarte acima de `MAX_PLAUSIBLE_SHIFT_HOURS` + contagem exibida |
| R-6 | **`estimated_hours` tratado como realizado** faz a razão de R8 tender a 1,00 e o card perder sentido | M | A | D2b: exclusão estrita do numerador **e** denominador, com as duas contagens de exclusão exibidas |
| R-7 | Dívida herdada: `orderReportService` continua com ancoragem simples — dois relatórios discordando | M | M | Fora de escopo aqui; registrado como dívida. Se o smoke mostrar divergência visível, abrir fix separado |
| R-8 | **Métrica por freela vira ranking** por deriva de UI (ordenar por coluna, "top 5") | M | A | R17 + D4 Opção A; proibição explícita no código (sem campo `score`, sem sort por métrica); security-reviewer no Step 8 |
| R-9 | **BottomNav já tem 6 itens** — 7º quebra o mobile | M | B | Não adicionar; entrada pelo Sidebar + atalho no Dashboard/Relatório. Decisão do frontend-reviewer |
| R-10 | **F4 sem `pg_cron` ativo** transformaria "não confirmou" em acusação ao freela | M | A | D4: F4 só como bloco agregado com nota de dependência; nunca coluna por freela na v1 |
| R-11 | Dupla contagem de gasto quando escrow e `shift_payments` cobrem o mesmo `(job, worker)` | B | A | D8: dedupe por chave, precedência de `shift_payments`, conflito contabilizado e rotulado |
| R-12 | **Página monolítica** (> 600 linhas) por ter 11 blocos | A | M | Step 6 obriga `components/company/analytics/*`; a página só orquestra período + estado |
| R-13 | Introduzir React Query ou biblioteca de gráfico por hábito | B | M | Article 5 / R19 / A14; `package.json` diffado no review |
| R-14 | Colisão de arquivo entre builder e frontend-builder em `ReceiptView.tsx` | B | B | Território declarado: `ReceiptView` é do builder, Step 1, antes do Step 6 |

---

## Estimate: **XL** — ~7 dias

19 requisitos, 11 blocos de métrica sobre 8 tabelas, três correções de schema que a spec não previu (D2a,
D7, D8), fuso explícito, paginação defensiva e uma tela nova com quatro estados por bloco. É XL pelo número
de fontes cruzadas e pelo cuidado exigido em cada número — não pela complexidade de nenhuma peça isolada.
Não é XL de "novo fluxo de negócio": não move saldo, não cria migration, não muda máquina de estados.

---

## Rollback

Feature aditiva e somente-leitura. `git revert <hash-do-merge>` remove a rota, a página, os componentes e o
service sem efeito colateral em dado — **nenhuma migration para reverter**.

Única atenção no revert: o Step 1 alterou `lib/dateUtils.ts` e `ReceiptView.tsx`. Se outra entrega já tiver
passado a importar `calculateWorkedHours`/`formatDurationMs`/`todayInBrazil` de `lib/dateUtils`, reverter o
commit inteiro quebra o build. Nesse caso: reverter apenas os commits dos Steps 2–7 e **manter o Step 1**
(extração é melhoria isolada, sem dependência da feature).
