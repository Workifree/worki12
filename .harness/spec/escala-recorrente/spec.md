# Escala Recorrente / Bloco de Cobertura — spec

> Todas as decisões de escopo abaixo foram fixadas pelo clarifier sem confirmação humana, por
> instrução explícita da tarefa. Cada uma está marcada **(Assumido)** e justificada na seção
> "Clarifications log". Nenhum arquivo fora deste spec foi tocado — dois outros agentes estão
> editando `CompanyTeam.tsx`, `components/team/*`, `types/index.ts` e `teamListService.ts` em
> paralelo; o builder que pegar esta spec precisa reconferir `types/index.ts` antes de editar (pode
> ter mudado sob os pés).

## Context

A entrevista de 17/08/2026 com o sócio-operador de 10 unidades do Divino Fogão revelou que **a
maior parte do volume de freela dele não é emergência — é programado e repetitivo**: cobertura de
folga dominical (toda semana, mesmo dia) e cobertura de férias (um bloco de N dias seguidos). O F1
(Chamado de Turno, PR #211) resolve a urgência das 8h30, mas se o app só serve para emergência ele
é aberto 2-3× por mês e o elenco fica desatualizado — inclusive prejudicando o próprio F1 no dia em
que ele é mais necessário.

Hoje `CompanyCreateJob` só cria **um** `jobs` por vez. A empresa que quer cobrir 4 domingos seguidos
recria o mesmo formulário 4 vezes, à mão, com risco de digitar horário/valor diferente em algum. A
"Escala Recorrente" resolve isso: a empresa configura a recorrência UMA vez (dia-da-semana ou bloco
de dias corridos) e o sistema materializa os turnos individuais, que continuam sendo `jobs`
normais — a agenda por dia (`groupJobsByDay`), o Chamado de Turno (F1) e o convite direto continuam
funcionando sem alteração, ocorrência por ocorrência.

Esta é a feature que se propõe a gerar o uso **semanal** do app (não só nos dias de pico), e por
isso é candidata a feature de retenção nº 1 da fila.

## Requirements

- [ ] R1: Nova tabela `job_series` (registro-mãe): `id`, `company_id`, `recurrence_type` (`'weekly'
      | 'daily'`), `weekdays integer[]` (0=domingo..6=sábado; obrigatório e não-vazio se `weekly`;
      `NULL` se `daily`), `range_start_date date`, `range_end_date date` (**obrigatória — não existe
      recorrência sem fim**), `occurrences_generated integer`, `status` (`'active' | 'stopped'`),
      `created_by uuid`, `created_at timestamptz`. RLS com a MESMA ancoragem dupla de `jobs`
      (`company_id = auth.uid()` OR via `companies.owner_id` — padrão de `20260816210000` e do
      helper `is_job_owner` de `20260817000100`).
- [ ] R2: `jobs` ganha 2 colunas nullable: `series_id uuid REFERENCES job_series(id) ON DELETE SET
      NULL` e `series_occurrence_date date`. Turnos avulsos (fluxo de hoje) têm `series_id IS NULL`
      — nenhum comportamento existente muda para quem não usa recorrência.
- [ ] R3: Geração é **EAGER** (materializa todas as ocorrências como linhas `jobs` no momento da
      criação da série), não lazy/just-in-time. Cada ocorrência nasce com `status='open'` e herda
      `title`/`category`/`type`/`description`/`requirements`/`briefing`/`location`/`budget`/
      `budget_type`/`work_start_time`/`work_end_time`/`has_lunch`/`slots`/`scope` da configuração
      base — só `start_date` (e `series_occurrence_date`) muda por ocorrência.
- [ ] R4: Cálculo de datas usa aritmética de data LOCAL, nunca UTC puro — mesmo padrão de
      `lib/dateUtils.ts` (`parseDateOnly`/`todayLocalDate`). A serialização de cada `start_date`
      gerado usa o padrão já existente em `CompanyCreateJob.handleSubmit`
      (`new Date(dateStr + 'T12:00:00').toISOString()`) para não reintroduzir o off-by-one de fuso
      que os comentários do próprio `dateUtils.ts` documentam como bug histórico.
- [ ] R5: Recorrência **semanal**: a empresa marca 1+ dias da semana (checkboxes Dom–Sáb) + define
      `range_end_date`. Gera uma ocorrência por dia-da-semana marcado dentro de
      `[range_start_date, range_end_date]`, inclusive nas duas pontas.
- [ ] R6: Recorrência **diária** (bloco de cobertura — férias, evento de vários dias): a empresa
      define só `range_start_date` + `range_end_date`; gera uma ocorrência por dia corrido no
      intervalo, sem seleção de dia-da-semana.
- [ ] R7: Limite de geração — **cap de 60 ocorrências por série**. Se os parâmetros escolhidos
      gerariam mais de 60 linhas, a criação é bloqueada NO CLIENT antes de qualquer INSERT, com
      mensagem pedindo para encurtar o intervalo ou reduzir os dias da semana. O mesmo limite é
      reforçado por CHECK/trigger no banco (defesa em profundidade — client não é a única barreira,
      Article 4/RLS-first).
- [ ] R8: `CompanyCreateJob` ganha um toggle no Step 3 ("Turno único" — default, vs "Recorrente").
      Ao marcar "Recorrente": o campo "Início" atual vira `range_start_date`; aparecem seletor de
      tipo (`Toda semana` / `Cobrir um período`), checkboxes de dia-da-semana (só se `weekly`) e
      `range_end_date`. Submit cria 1 `job_series` + N `jobs` em sequência (insere a série, depois
      o lote de jobs com `series_id`); se o lote de jobs falhar, desfaz a série (mesmo padrão
      best-effort-rollback de `ShiftCallService.createShiftCall` quando o INSERT de targets falha).
- [ ] R9: Pós-criação de série NÃO abre o painel de convite pós-criação existente (que assume 1
      job). Mostra um resumo ("N turnos criados: toda domingo, de DD/MM a DD/MM") com atalho para a
      agenda (`/company/jobs`). Convidar freela por ocorrência continua sendo o fluxo per-job já
      existente (convite direto ou Chamado de Turno/F1) — **nenhuma mudança** em
      `shiftInviteService`/`ShiftCallService` além do R10.
- [ ] R10: Ação de conveniência "Convidar [freela] para a série inteira" — convida o MESMO freela
      para todas as ocorrências futuras e ainda sem freela de uma série, disparando um convite (via
      `ShiftCallService.createShiftCall` com 1 alvo) por ocorrência, em lote. **Sinalização de
      interação com a guarda futura de 2 turnos/semana** (feature seguinte da fila, fora de
      escopo aqui): se o freela seria convidado para mais de 2 ocorrências na MESMA semana corrida
      (dom–sáb) da série, exibe aviso não-bloqueante antes do disparo. Não impede o envio.
- [ ] R11: Editar/cancelar a partir de uma ocorrência que pertence a uma série oferece 3
      granularidades:
      - **"Somente este turno"** — comportamento de hoje, inalterado (edita/exclui só aquele
        `jobs`).
      - **"Este e os futuros"** — aplica a edição (título/categoria/descrição/requisitos/briefing/
        localização/horário/vagas — **NUNCA** `budget`, mesma regra de hoje que trava valor
        pós-criação) a toda ocorrência da série com `start_date >= hoje` E sem freela ativo
        (nenhuma `applications` com status em `hired`/`in_progress`/`completed`). Ocorrências já
        preenchidas são puladas e reportadas ("N turnos não foram alterados porque já têm freela
        confirmado").
      - **"Cancelar a série inteira"** — marca `job_series.status='stopped'` (impede reaproveitar a
        série para futuras extensões) e EXCLUI (mesmo mecanismo do botão "Excluir" de hoje, RLS
        `jobs_delete_company_owner`) as ocorrências futuras sem freela ativo. Ocorrências futuras
        COM freela ativo são mantidas na agenda e reportadas — cancelamento delas continua sendo o
        fluxo manual existente (dispensa/cancelamento por turno).
- [ ] R12: `types/index.ts` ganha `JobSeries` (interface nova) e `Job.series_id?: string | null`.
      **Builder: reconfirme o estado atual de `types/index.ts` antes de editar — está sendo tocado
      em paralelo por outro agente.**
- [ ] R13: Nenhuma RPC de saldo/escrow é criada ou tocada (Article 8 intacto). A feature é
      puramente de agendamento/geração de `jobs` — sem contato com `wallets`/`escrow_transactions`/
      `shift_payments`.

## Acceptance criteria

- [ ] A1 (semanal): Dado que a empresa está em `/company/jobs/novo` (Step 3) com um turno
      configurado (título, categoria, budget, horário, slots), quando ativa "Recorrente" → "Toda
      semana", marca só Domingo, define `range_start_date=01/09/2026` e `range_end_date=30/09/2026`
      e confirma, então são criados 1 `job_series` (`recurrence_type='weekly'`, `weekdays=[0]`) e
      **exatamente 4** `jobs` com `series_id` apontando para ela, com `start_date` em 06/09, 13/09,
      20/09 e 27/09/2026 (todos domingos), cada um herdando título/categoria/budget/horários/
      briefing/local/slots da configuração base, `status='open'`.
- [ ] A2 (bloco diário/férias): Dado que a empresa escolhe "Cobrir um período" (diário) com
      `range_start_date=01/09/2026` e `range_end_date=05/09/2026`, quando confirma, então são
      criados 5 `jobs` consecutivos (01, 02, 03, 04, 05/09/2026), um por dia corrido, todos com o
      mesmo `series_id` (`recurrence_type='daily'`, `weekdays IS NULL`).
- [ ] A3 (cap): Dado que a empresa marca os 7 dias da semana com um intervalo de 6 meses (>60
      ocorrências resultantes), quando tenta confirmar, então o formulário bloqueia o envio ANTES
      de qualquer INSERT, mostra mensagem indicando o limite de 60 turnos, e nem a série nem
      nenhum `jobs` é criado.
- [ ] A4 (fuso): Dado um usuário em `America/Sao_Paulo` criando uma série entre 21h e 23h59 locais
      (janela em que `UTC` já virou o dia seguinte), quando a série é gerada com
      `range_start_date=hoje`, então a primeira ocorrência elegível tem `start_date` cujo
      `parseDateOnly(...)` cai exatamente no dia-da-semana local esperado — nunca um dia antes por
      conversão UTC crua (`new Date(isoString)` sem `parseDateOnly`).
- [ ] A5 (editar "este e os futuros"): Dado uma série com 4 domingos gerados, dos quais o 1º (mais
      próximo) já tem freela `hired` e os outros 3 estão `open` sem freela, quando a empresa edita
      o briefing a partir de qualquer ocorrência futura e escolhe "Este e os futuros", então o
      briefing é atualizado nos 3 jobs sem freela (`start_date >= hoje`), o job com freela `hired`
      NÃO é alterado, e aparece aviso "1 turno não foi alterado porque já tem freela confirmado".
- [ ] A6 (cancelar série): Dado a mesma série do A5, quando a empresa escolhe "Cancelar a série
      inteira" a partir de qualquer ocorrência, então `job_series.status` vira `'stopped'`, os 3
      jobs sem freela são excluídos (mesmo mecanismo do "Excluir" de hoje), o job com freela
      `hired` permanece intacto na agenda, e aparece aviso "1 turno com freela confirmado não foi
      cancelado — dispense o freela manualmente".
- [ ] A7 (convidar série inteira + sinalização): Dado uma série diária de bloco de férias com 10
      ocorrências futuras sem freela (mais de 2 caindo na mesma semana corrida), quando a empresa
      usa "Convidar [freela] para a série inteira", então um banner de aviso não-bloqueante aparece
      ANTES do disparo citando o limite de 2 turnos/semana, e ao confirmar mesmo assim, são
      criados 10 `shift_calls` individuais (1 por ocorrência) — o mesmo resultado que 10 convites
      manuais produziriam hoje.
- [ ] A8 (RLS): Dado que a empresa B tenta ler ou editar uma `job_series` que pertence à empresa A
      (URL direta ou payload manipulado), quando a query/mutação é executada sob a sessão de B,
      então RLS nega (0 linhas retornadas/afetadas) — mesmo padrão de ancoragem dupla verificado em
      `20260816210000` (P4).

## Out-of-scope

- Guarda **dura** (bloqueante) de limite de 2 turnos/semana por freela na mesma empresa — é a
  próxima feature da fila (F4); aqui só existe **sinalização** (R10/A7), sem impedir o envio.
- Edição em massa de `budget`/valor — já é imutável pós-criação hoje (regra existente de
  `CompanyCreateJob`), e continua imutável aqui.
- Recorrência mensal, "todo dia N do mês", ou qualquer padrão além de semanal-por-dia-da-semana e
  diária-em-intervalo.
- Geração lazy/just-in-time ou série sem data-fim ("recorrência infinita").
- Multi-unidade/gerente — fora de escopo do produto hoje; a ancoragem dupla reaproveitada é a mesma
  costura que `is_job_owner` (F1) já deixou preparada para quando isso existir, mas nada aqui
  implementa gerente/unidade.
- Notificação in-app nova do tipo "sua série foi criada" para o freela — só a empresa vê o resumo
  pós-criação (R9); notificações por ocorrência (convite, pagamento, cancelamento) continuam sendo
  as já existentes, por-turno.
- Ajuste fino por-ocorrência de `slots` distinto dentro de uma edição em massa "este e os futuros"
  — se a empresa quer uma ocorrência com número de vagas diferente do resto da série, edita aquela
  ocorrência isoladamente ("Somente este turno").

## Clarifications log

- Q: Modelo de dados — série "virtual" com geração lazy, ou registro-mãe (`job_series`) que gera
  turnos filhos materializados em `jobs`? → A (Assumido): registro-mãe + geração EAGER. A agenda
  por dia (`groupJobsByDay`, `CompanyJobs.tsx`) já opera sobre `jobs` puro; materializar mantém
  esse código, o Chamado de Turno (F1) e o convite direto funcionando sem nenhuma alteração,
  ocorrência por ocorrência. Lazy exigiria ensinar toda leitura de `jobs` a "expandir" a série,
  espalhando a mudança por várias telas.
- Q: Quais recorrências suportar, e como a recorrência termina? → A (Assumido): só **semanal por
  dia(s)-da-semana** (cobre folga dominical) e **diária num intervalo** (cobre bloco de férias) —
  os dois casos citados na entrevista. Fim SEMPRE por `range_end_date` (data), nunca por
  "N ocorrências" nem "para sempre" — mais simples de raciocinar para o operador e evita série
  esquecida gerando turnos indefinidamente.
- Q: Bloco de cobertura de férias é um gesto de UI próprio ou um caso da recorrência diária? → A
  (Assumido): é a MESMA modelagem (`recurrence_type='daily'`), só com rótulo de UI diferente
  ("Cobrir um período" em vez de "Toda semana") — um preset, não uma tabela/fluxo paralelo.
- Q: Como a recorrência interage com o Chamado de Turno (F1) e com a futura guarda de 2
  turnos/semana? → A (Assumido): cada ocorrência é convidada separadamente pelo fluxo já
  existente; a única adição é o atalho "convidar a série inteira" (R10), que dispara N convites
  individuais e apenas SINALIZA (aviso, não bloqueio) quando ultrapassaria 2/semana para o mesmo
  freela — a guarda dura fica para a próxima feature da fila, de propósito, para não acoplar duas
  specs.
- Q: Cancelar/editar atinge uma ocorrência, as futuras, ou a série toda? → A (Assumido): as 3
  granularidades (R11) — "somente este" (comportamento de hoje), "este e os futuros" (só
  ocorrências sem freela ativo) e "cancelar a série" (idem, exclui só as sem freela ativo).
  Ocorrências já com freela confirmado NUNCA são tocadas em massa — exigem o fluxo manual de
  dispensa/cancelamento que já existe, preservando as notificações obrigatórias bidirecionais
  (`trg_notify_counterpart_on_application_cancel`) que dependem de UPDATE individual em
  `applications`.
- Q: Limite de geração por série? → A (Assumido): 60 ocorrências, validado no client (bloqueia
  ANTES do INSERT) e reforçado no banco (CHECK/trigger) — número redondo que cobre um ano de
  recorrência semanal (52) ou dois meses de recorrência diária (60), com folga de segurança contra
  erro de digitação no formulário.
