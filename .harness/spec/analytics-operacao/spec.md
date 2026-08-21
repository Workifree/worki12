# Analytics de operação de freelancer (F9) — spec

## Context

Na entrevista de 17/08/2026, o sócio-operador das 10 unidades do Divino Fogão descreveu como controla a
operação de freelas HOJE, na mão: cruza **quanto gasta em caixa** com **nível de falta** e **nível de quebra de
escala**. Ele quer isso centralizado. O Worki já captura, desde o Onda 1 e as features F1/F4 mais recentes
(chamado de turno com primeiro-aceite, confirmação de véspera), praticamente todo o dado bruto que esse
controle manual precisa — só falta agregá-lo numa tela.

Esta spec cobre exclusivamente o painel de leitura (**Article 8 intacto — não move saldo, não escreve em
nenhuma tabela financeira**). É deliberadamente um recorte largo (10+ métricas, várias tabelas) — o `plan`
subsequente deve avaliar se o tamanho justifica passar por `harness-planner` antes do builder.

Duas correções feitas durante a apuração desta spec (documentadas no Clarifications log, não repetir a
suposição errada em código):

1. **`orderReportService.ts` NÃO calcula horas reais.** Foi lido por completo — trata só de
   `shift_payments`/status de pagamento, nunca `worker_checkin_at`/`checkout`. O cálculo real de horas
   trabalhadas (`calculateWorkedHours`, checkout−checkin com resolução de fonte worker/empresa) vive **local
   e não-exportado dentro de `frontend/src/pages/ReceiptView.tsx`**. Esta feature precisa dele — ver R4.
2. Não existe `financialBIService.ts` no repo (um comentário órfão em `orderReportService.ts` cita esse nome;
   é resíduo de uma versão anterior do arquivo, não uma dependência real).

## Requirements

- [ ] R1: Nova rota `/company/operacao` (`pages/company/CompanyOperationAnalytics.tsx`) registrada em
  `App.tsx` sob `<ProtectedRoute>` → `<CompanyLayout>`, com item de navegação no menu da empresa
  (Sidebar/BottomNav). Página nova, não extensão de `CompanyOrdersReport` (domínios diferentes: aquela é
  ledger financeiro por ordem de pagamento; esta é saúde operacional — preenchimento, aceite, presença,
  desempenho).
- [ ] R2: Novo service somente-leitura `frontend/src/services/operationAnalyticsService.ts` — `useState` +
  `useEffect` + `supabase.from(...)` direto (Article 5), **sem** RPC nova, **sem** view materializada. Decisão
  de escala piloto (10 unidades): ver Clarifications Q1. Nenhuma escrita, nenhuma chamada a RPC de
  saldo/escrow — o service não importa `walletService`.
- [ ] R3: Seletor de período com presets **Hoje / Semana / Mês / Custom**, mesmo padrão visual/funcional de
  `CompanyOrdersReport.tsx` (`applyPreset`, `startOfWeek`, `startOfMonth`). Todo cálculo de data em horário
  LOCAL — reaproveita `todayLocalDate`/`parseDateOnly` de `lib/dateUtils.ts`; proibido `toISOString()`/`new
  Date(dateOnlyString)` cru (cicatriz documentada no cabeçalho de `dateUtils.ts`).
- [ ] R4: Extrair `calculateWorkedHours` (hoje local a `ReceiptView.tsx`) para `lib/dateUtils.ts` como função
  exportada, mesma assinatura (`checkinIso`, `checkoutIso`) e mesmo comportamento (retorna `null` se ausente
  ou checkout ≤ checkin). `ReceiptView.tsx` passa a importar de lá; o novo service importa a mesma função —
  **zero reimplementação** da lógica de horas.
- [ ] R5: Card **Gasto absoluto** = soma de `shift_payments.amount` onde `status='recorded'` e `paid_at` cai
  no período (mesma regra "promessa ≠ liquidação" já estabelecida — `scheduled` nunca entra). Mostra variação
  percentual vs. o período imediatamente anterior de mesma duração (ex.: mês corrente vs. mês anterior
  completo).
- [ ] R6: Card **Contratações** = contagem de `applications` com `status IN ('hired','in_progress',
  'completed')` cujo `jobs.start_date` (fallback `jobs.created_at`) cai no período. Mesma comparação de
  período anterior de R5.
- [ ] R7: Card **Custo por hora** = (gasto de R5) ÷ (soma de horas reais trabalhadas no período, turnos
  `completed`). Horas por turno: `calculateWorkedHours(worker_checkin_at, worker_checkout_at)`; se ausente,
  fallback `calculateWorkedHours(company_checkin_confirmed_at, company_checkout_confirmed_at)`; se ambos
  ausentes, fallback `jobs.estimated_hours`. Denominador 0 → exibe "—", nunca `Infinity`/`NaN`/divisão por
  zero renderizada.
- [ ] R8: Card **Razão horas realizadas ÷ previstas** = soma(horas reais) ÷ soma(`jobs.estimated_hours`) para
  turnos `completed` no período **onde `estimated_hours` não é nulo** (turnos sem estimativa cadastrada são
  excluídos de numerador E denominador — não simplesmente tratados como 0 previsto, o que inflaria a razão).
  Exibe contagem de turnos excluídos por falta de estimativa como nota auxiliar.
- [ ] R9: Card **Tempo médio de preenchimento do chamado** = média de (`first_claim_at − created_at`) entre
  `shift_calls` com `first_claim_at` preenchido e `created_at` no período. Formatação reaproveita o núcleo de
  `formatDurationShort` (`lib/dateUtils.ts`) — extrair a conversão ms→texto para uma função auxiliar exportada
  (ex. `formatDurationMs(ms: number)`) que tanto `formatDurationShort` quanto a nova média chamam, em vez de
  duplicar a lógica de "Xh Ymin".
- [ ] R10: Bloco **Chamados × preenchimento** = contagem de `shift_calls` no período por `status`
  (`open`/`filled`/`expired`/`cancelled`). `expired` (chamado que venceu sem ninguém aceitar) é sempre exibido
  como "demanda não atendida" — nunca omitido, mesmo com valor 0.
- [ ] R11: Bloco **Motivo da quebra** = agrupamento de `shift_calls.reason` (enum existente: `falta`,
  `demissao`, `pico_previsto`, `evento`, `ferias`, `folga`, `reforco`, `outro`) no período — contagem total e
  contagem preenchida-vs-expirada por motivo. É o relatório manual do sócio, automatizado.
- [ ] R12: Tabela **Aceite por freela** — por `worker_id` (via `shift_call_targets` de chamados de turnos da
  própria empresa) no período: recebidos, aceitos, recusados, sem resposta (`closed`/pendente no fechamento do
  chamado). % de aceite só é calculada e exibida quando recebidos ≥ 2 (abaixo disso: "—", nunca 0%/100%
  precipitado de 1 amostra). Ordenação **alfabética por nome**, nunca por métrica (não vira ranking de
  melhor/pior).
- [ ] R13: Tabela **No-show por freela** = contagem, no período, de `applications` deste freela nesta empresa
  com `status IN ('hired','in_progress')` cujo turno já deveria ter terminado (`jobs.start_date` +
  `jobs.estimated_hours` < agora) e `worker_checkin_at` é nulo. Métrica isolada — não soma com Cancelamentos
  (R14).
- [ ] R14: Tabela/coluna **Cancelamentos por freela** = contagem de `applications` com `status='cancelled'`
  cujo turno caía no período, por freela. Rótulo fixo na UI: "inclui cancelamentos da empresa e do freela — o
  dado atual não distingue quem cancelou" (ver Clarifications Q_gap — não existe coluna `cancelled_by`
  persistida hoje; atribuir autoria exige migration nova, fora de escopo).
- [ ] R15: Tabela **Pontualidade por freela** = compara horário real de chegada (`worker_checkin_at`, fallback
  `company_checkin_confirmed_at`) com o horário previsto de início (`jobs.work_start_time` combinado com a
  data local do turno). **Builder deve confirmar contra o schema real** (Supabase MCP `list_tables` / dado de
  produção) se `jobs.start_date` já embute a hora correta antes de montar o instante esperado — a migration
  `20260817000600` documenta `jobs.start_date` como `timestamptz` "confirmado em produção", o que pode tornar
  `work_start_time` redundante ou a fonte real. Tolerância de atraso: constante de código, 10 minutos
  (`ASSUMIDO`, não configurável na UI v1). % pontual só exibida com ≥ 2 turnos com checkin registrado no
  período.
- [ ] R16: Card **Desempenho por freela** = `workers.rating_average` rotulado explicitamente **"Avaliação
  (global — todas as empresas)"** lado a lado com "Turnos concluídos com você: N" (contagem `completed` desta
  empresa com este freela no período). Nunca combinados num único número/score.
- [ ] R17: Isolamento de papel e de dado sensível: página inteira sob `/company/*` (fora do alcance de rota do
  papel worker); nenhuma métrica por freela (R12–R16) é exposta em nenhuma rota/tela acessível ao próprio
  freela. Nenhum "score" único e opaco por freela em lugar nenhum da tela — sempre métricas componentes lado a
  lado (aceite %, no-show, pontualidade %, avaliação).
- [ ] R18: Estado vazio honesto — quando o período não tem dado suficiente numa fonte (ex.: nenhum
  `shift_call` disparado ainda), o card/bloco correspondente mostra mensagem orientada à ação (ex.: "Nenhum
  chamado disparado neste período") em vez de "0%"/"R$ 0,00" tratados como resultado real, e nunca renderiza
  gráfico vazio.
- [ ] R19: Nenhuma biblioteca de gráficos nova. Visualização 100% com componentes nativos (cards estilo
  `SummaryCard`, tabelas, barras feitas com `div`/Tailwind) no padrão neo-brutalista já usado em
  `CompanyOrdersReport.tsx` (bordas pretas 2px, sombras offset sólidas, `font-black uppercase`), mobile-first
  (cards empilhados no mobile, tabela no desktop — mesmo padrão responsivo já usado ali).

## Acceptance criteria

- [ ] A1: Dado que a empresa está autenticada em `/company/operacao` com preset "Mês" selecionado, quando a
  página termina de carregar, então os cards Gasto absoluto, Contratações, Custo por hora e Horas
  realizadas/previstas mostram o valor do mês corrente **e** a variação percentual vs. o mês anterior completo
  de mesma duração.
- [ ] A2: Dado um `shift_payment` com `status='recorded'` e `paid_at` dentro do período selecionado, quando a
  página recalcula, então seu `amount` entra na soma de "Gasto absoluto"; um `shift_payment` `scheduled` (não
  efetivado) do mesmo período NÃO entra nessa soma.
- [ ] A3: Dado um turno `completed` com `worker_checkin_at`/`worker_checkout_at` preenchidos, quando "Custo
  por hora" é calculado, então as horas usam `calculateWorkedHours` (checkout−checkin) importado de
  `lib/dateUtils.ts`; se ausentes, usa `company_checkin_confirmed_at`/`company_checkout_confirmed_at`; se
  ambos ausentes, usa `jobs.estimated_hours`.
- [ ] A4: Dado um `shift_call` com `first_claim_at` preenchido dentro do período, quando "Tempo médio de
  preenchimento" é calculado, então esse chamado entra na média; um `shift_call` sem `first_claim_at` (nunca
  aceito) é excluído da média mas contado em "Chamados × preenchimento" conforme seu `status`.
- [ ] A5: Dado que um `shift_call` expirou sem nenhum alvo aceitar (`status='expired'`) dentro do período,
  quando o bloco "Chamados × preenchimento" renderiza, então esse chamado é contado em "expirados" — nunca
  omitido do total de chamados disparados no período.
- [ ] A6: Dado que um freela recebeu exatamente 1 `shift_call_target` no período, quando a linha dele aparece
  em "Aceite por freela", então a coluna "% aceite" mostra "—" (recebidos < 2); a tabela está ordenada
  alfabeticamente por nome, não por métrica.
- [ ] A7: Dado uma `application` `status='hired'` cujo turno (`jobs.start_date` + `estimated_hours`) já
  passou e `worker_checkin_at` é nulo, quando "No-show por freela" renderiza, então esse turno soma 1 no-show
  daquele freela; essa mesma ocorrência NÃO é somada em "Cancelamentos" (métricas distintas, R13/R14).
- [ ] A8: Dado uma `application` `status='cancelled'` cujo turno caía no período, quando "Cancelamentos"
  renderiza a linha do freela, então aparece a contagem acompanhada da nota fixa "não distingue quem
  cancelou" — sem tentativa de inferir autoria.
- [ ] A9: Dado que a empresa acessa `/company/operacao` pela primeira vez no piloto (zero `shift_calls`, zero
  `shift_payments` `recorded`, zero `applications` `completed` no período), quando a página carrega, então
  nenhum card mostra "0%"/"R$ 0,00" como resultado — mostra o estado vazio orientado à ação (R18), sem gráfico
  vazio.
- [ ] A10: Dado um usuário autenticado com papel **worker** tentando acessar `/company/operacao` diretamente
  pela URL, quando a rota resolve, então `ProtectedRoute` bloqueia o acesso — nenhuma métrica por freela desta
  tela é exposta a ele.
- [ ] A11: Dado o card "Desempenho" de um freela, quando renderizado, então mostra separadamente "Avaliação
  (global): X,X ★" e "Turnos concluídos com você: N" — nunca combinados num único score.
- [ ] A12: Dado que a empresa muda o preset de "Mês" para "Semana", quando a página recalcula, então TODOS os
  cards e tabelas (não só os 4 de resumo) refletem exclusivamente o novo intervalo, sem mistura com dado do
  período anterior.
- [ ] A13: Dado um turno com `work_start_time` 08:00 e checkin registrado às 08:07 (dentro da tolerância de
  10 min), quando "Pontualidade por freela" calcula, então esse turno conta como pontual; um checkin às 08:15
  (fora da tolerância) conta como atraso.
- [ ] A14: Dado que `cd frontend && npm run build` e `cd frontend && npm run lint` são executados após a
  implementação, quando finalizados, então ambos retornam sem erro (Article 3), e `package.json` não ganhou
  nenhuma dependência nova de biblioteca de gráficos (R19).

## Out-of-scope

- RPC/view materializada para os cálculos — fica 100% client-side nesta versão (decisão de escala piloto).
  Se o piloto crescer e a tela ficar lenta, extrair para RPC/view é melhoria futura e exige gate
  `harness-architect` (mudança de onde a lógica de agregação mora).
- Comparação com período anterior nas tabelas por freela (Aceite, No-show, Cancelamentos, Pontualidade,
  Desempenho) — só os 4 cards de resumo (R5–R8) têm delta nesta versão.
- Atribuição de autoria em cancelamentos (`cancelled_by`) — exigiria migration nova; não incluída aqui.
- `%` da folha de pagamento / teto de 3% — cortado explicitamente pelo owner na entrevista.
- Tarifa padrão por função — não existe no produto hoje; não é criada por esta feature.
- Ranking (público ou interno) ordenado por melhor/pior desempenho, score único por freela, ou qualquer
  exposição destas métricas ao próprio freela.
- Nova dependência de biblioteca de gráficos (recharts, chart.js, etc.).
- Exportação CSV/impressão desta tela (diferente de `CompanyOrdersReport`, que já tem) — não pedido pelo
  owner nesta entrevista.
- Cobrança de assinatura — explicitamente ainda não existe (decisão do owner).
- Multi-unidade/gerente (F3) — filtro por unidade/loja não incluído aqui; a página é escopada à empresa
  inteira, mesma ancoragem dupla (`company_id = auth.uid()` OU via `companies.owner_id`) já usada em
  `is_job_owner`/`orderReportService`.
- Tolerância de atraso configurável pela empresa na UI — fica como constante de código nesta versão (R15).

## Clarifications log

- Q: Onde vive o cálculo (client, RPC, ou view)? → A: **Client-side, no service (Article 5)** (Assumido).
  Escala do piloto (10 unidades) não justifica RPC/view ainda; `orderReportService.ts` é o precedente direto
  do mesmo padrão para um relatório de várias tabelas. Se ficar lento, é gate de arquiteto depois, não agora.
- Q: Recorte temporal e navegação — mês corrente, últimos 30 dias, comparação? → A: **Presets Hoje/Semana/Mês
  + custom, iguais a `CompanyOrdersReport`, com comparação vs. período anterior de mesma duração SÓ nos 4
  cards de resumo** (Assumido). Sem comparação, "gasto absoluto" isolado não diz se piorou ou melhorou — mas
  estender comparação às 5 tabelas por freela infla demais o escopo desta entrega.
- Q: Onde a tela mora — estende `CompanyOrdersReport` ou é rota nova? → A: **Rota nova `/company/operacao`**
  (Assumido). Domínios diferentes: `CompanyOrdersReport` é ledger financeiro por ordem de pagamento
  (`shift_payments`); esta feature é saúde operacional (preenchimento, aceite, presença, desempenho) sobre
  `shift_calls`/`shift_call_targets`/`applications`. Misturar as duas sobrecarregaria a tela existente e
  confundiria o "Valor Total" que o JSDoc de `orderReportService` já é cuidadoso em não deixar ambíguo.
- Q: Métrica por freela é delicada — quem vê, o que NÃO mostrar? → A: **Só a empresa que trabalhou com o
  freela** (RLS já restringe: `shift_call_targets`/`applications` só aparecem para o dono do turno). NÃO
  mostrar: ranking (nem interno), score único combinando métricas, número exposto ao próprio freela nesta
  tela, ou qualquer dado cross-empresa que pareça específico desta empresa quando não é (por isso o rótulo
  "Avaliação — global" no card de Desempenho, R16).
- Q: Fuso — agregação por mês/semana é data local? → A: **Sim, sempre local**, reaproveitando
  `todayLocalDate`/`parseDateOnly`/`formatDurationShort` de `lib/dateUtils.ts` — nunca UTC cru (cicatriz já
  documentada no próprio arquivo).
- Q: Turno sem preenchimento (chamado expirado) entra no relatório? → A: **Sim, sempre** (R10/A5) — é
  exatamente a "demanda não atendida" que o sócio quer enxergar; omitir seria esconder o dado mais acionável.
- Q: Estado vazio — como ficar útil e honesto com pouco dado no piloto? → A: Ver R18/A9 — mensagem orientada
  à ação por bloco, nunca "0%"/gráfico vazio fingindo ser resultado real.
- Q (gap encontrado durante apuração, não estava no briefing): o cálculo de horas reais mencionado como "já
  existente em `orderReportService.ts`" na verdade está em `ReceiptView.tsx` (local, não exportado), e não
  há `financialBIService.ts` no repo. → A: **Corrigido nesta spec** — R4 extrai `calculateWorkedHours` para
  `lib/dateUtils.ts` como ponto único, reaproveitado por `ReceiptView` e pelo novo service.
- Q: Cancelamento por freela — dá pra atribuir autoria (empresa vs. freela) com o schema atual? → A: **Não**
  (Assumido, gap real). O trigger `trg_notify_counterpart_on_application_cancel` resolve o ator via
  `auth.uid()` só em tempo de execução para decidir quem notificar — não persiste `cancelled_by` na linha.
  R14 mostra a contagem combinada com rótulo explícito da limitação; atribuir exigiria migration nova
  (fora de escopo aqui).
- Q: Biblioteca de gráficos — usa alguma existente? → A: **Nenhuma** (Assumido/verificado em
  `package.json`: não há recharts/chart.js/victory no projeto). R19 exige visualização nativa
  (cards/tabelas/barras via Tailwind), evitando decisão de nova dependência dentro desta spec.
