# Trilha de bônus do operador — spec

> **Nível de risco: MÉDIO-ALTO.** Não mexe em saldo (Article 8 intacto), mas cria tabelas novas com
> dinheiro a pagar, uma superfície de admin com `service_role` e gatilhos em `shift_payments`. Gates:
> `harness-architect` (migrations + ADR de "bônus pago do caixa do Worki, fora do razão") e
> `harness-security-reviewer` (RLS, `admin-data`, PIX do operador). O dono já decidiu o modelo
> (seção "Decisões fixadas"); esta spec **não as relitiga**. Onde preenche lacuna está marcado
> **(Assumido)** e listado no Clarifications log. O dono pediu para relaxar o jurídico/LGPD: só
> "patrão ciente" + regulamento de 1 página (R4, R5).
>
> **Dependência dura: `equipe-encarregados`.** Os marcos de ação do operador só são provados se cada
> pessoa tem identidade própria. Ver "Dependência e estado de transição".
>
> **Revisão 2 (coordenador, 23/11/2026):** o antifraude passou a ser **invisível** (seção própria
> abaixo). Substitui a auditoria manual de todo marco (decisão 7 original, antigo R16): o caso normal
> libera sozinho em 48h, o operador honesto não percebe nada, e só o anômalo vira revisão de 1 clique
> do dono.

## Context

Piloto com 1 cliente (Momma Doces), teste inicial. O Worki quer que quem **opera** a empresa (não só
o dono) crie o hábito de rodar o fluxo inteiro no app: publicar turno, chamar freela, conferir
presença, validar recibo bilateral, avaliar. Hipótese (não promessa; a evidência vem de
academia/varejo/escola): marcos pequenos, visíveis e pagos em dinheiro de verdade aumentam a
frequência de uso enquanto o bônus existe e deixam hábito depois. A métrica é o **hábito nas semanas
13–16**, com o bônus já encerrado (R30).

O bônus é **custo de aquisição pago do caixa do Worki**, por PIX manual do dono. Não é carteira, não
é saldo, não é crédito, não é assinatura, não é cripto, não passa por Asaas e não toca `wallets`,
`escrow_transactions` nem `wallet_transactions` (Article 8; `product.md`: pagamento pelo Worki
pausado em 22/08/2026, nenhum dinheiro de turno passa pela plataforma). É um registro de
**obrigação do Worki com o operador** (marcos conquistados) mais um **livro de pagamentos feitos por
fora**, no mesmo espírito do modo A (auditoria/recibo, sem liquidação).

Operadores do piloto: **Sabrina** (eventos; ~1 evento/semana com 1–3 freelas, ou seja 12–36 turnos
em 12 semanas) e, em segunda trilha, quem cuida das **lojas nos fins de semana**: o RH (Luiz) e o
sócio do Worki, que às vezes também faz freela para a Momma. O volume de fim de semana das lojas é
**desconhecido**; por isso a trilha das lojas só abre depois de medir um fim de semana (R27) e todos
os limiares são **parâmetros por trilha**, não constantes no código (R6).

## Decisões fixadas pelo dono (não relitigadas)

1. **Teto de R$300 por OPERADOR** (não por empresa) em até 12 semanas. Bônus de velocidade saem do
   mesmo teto. O que não for conquistado fica com o Worki.
2. Operadores: Sabrina (trilha eventos); RH e sócio (trilha lojas, calibrada depois). **VETO:**
   freelas que sejam sócios/donos do Worki, ou tenham a mesma chave PIX/vínculo do operador, **nunca**
   contam para nenhum marco (anti-autopagamento).
3. Marcos **acumulativos** (não semanais), todos conferíveis por evento do sistema. "Turno completo" =
   freela aceitou + check-in + checkout + recibo validado pelos 2 lados. Marcos de 6 em diante são
   **ações do operador** (atribuição por responsável/ator; depende de `equipe-encarregados`).
4. Trilha de **19 marcos contáveis + Coleção completa** (tabela em R7). Nada que o operador possa perder; sem clawback; quebrar
   sequência não pune.
5. Tela estilo missões do Nubank (R20-R24). Não chamar de saldo/carteira. Prazos honestos.
6. Saque: PIX por pedido toda segunda-feira, mínimo R$25, **feito MANUALMENTE pelo dono** a partir de
   uma lista no painel admin; sem integração de pagamento (R25-R26).
7. **Antifraude invisível** (revisão 2, substitui o item original): mitigar fraude **sem bloquear a
   operação, sem burocracia, sem formulário/upload**; o operador honesto nunca percebe nada; só o
   **anômalo** vira revisão, e a revisão é de **1 clique do dono**. Detalhe na seção "Antifraude
   invisível" (AF1-AF10).
8. Métrica: hábito nas semanas 13-16 vs baseline, registrada no admin (R30).

## Dependência e estado de transição (`equipe-encarregados`)

Hoje o Worki não distingue **quem** dentro da empresa fez uma ação: a empresa é um login só, e o
concierge (equipe do Worki) pode operar a conta do cliente. Um marco que pagasse dinheiro por uma
ação que o concierge fez seria pagar o próprio Worki.

Regra desta spec (R9, AF8): **marco de ator só conta se o ator capturado em runtime (`auth.uid()`) é o
operador inscrito**, em sessão própria, com membership real (`company_members` ativo e confirmado, ou
dono único com login próprio). Nunca por responsável preenchido depois, nunca por service_role, nunca
por sessão compartilhada, nunca pela conta do dono operada pelo concierge.

O que depende de `equipe-encarregados` (E4/E5 em produção): identidade individual (`company_members`
com papel Encarregado), `jobs.responsible_id`, `team_connections.invited_by`, e a confirmação do
Gestor. **Enquanto não existir:**

- Fatias S1-S4 (schema, motor, RPCs) e S5-S6 (telas) podem ser construídas e testadas, mas atrás do
  flag `bonus_program_settings.enabled = false`; nenhuma inscrição real é ativada.
- `bonus_accept_enrollment` **recusa** (`outcome: 'identity_required'`) quem não tem identidade
  própria provada (ver R8). Logo o R$10 garantido do marco 2 também não é pago a ninguém sem
  identidade própria.
- Nenhum marco de ator é pago por ação do concierge, nem retroativamente: turnos/ações anteriores à
  atribuição capturada não contam (sem retroatividade; **Assumido**).
- Se o dono quiser rodar Sabrina antes da `equipe-encarregados` com login compartilhado, a spec **não
  autoriza**: o sistema não consegue provar quem agiu. Registrado como risco R-1, não como requisito.

## Modelo de dados (proposto, gate do architect)

Todas as tabelas novas, RLS ligada desde o nascimento, **dinheiro em centavos inteiros**
(`amount_cents integer`), nenhum nome `balance/wallet/saldo`. Escrita só por RPC DEFINER
(`search_path=''`) ou por `admin-data` com `service_role`; operador só **lê** o que é dele (e nunca lê
`exclusion_reason`, `flags` nem decisões do dono).

| Tabela | Colunas principais | Observação |
|---|---|---|
| `bonus_program_settings` | `id` singleton, `enabled boolean`, `min_payout_cents default 2500`, `rules_version text` | Interruptor global. |
| `bonus_tracks` | `id, key ('eventos'\|'lojas'), name, status ('calibrating'\|'open'\|'closed'), cap_cents default 30000, window_weeks default 12, params jsonb, created_at` | `params`: todos os limiares de AF2-AF5 e `validation_hours` (48). Trilha `lojas` nasce `calibrating`: **não aceita inscrição**. |
| `bonus_milestones` | `id, track_id, key, group ('A'..'E'), sort_order, title, amount_cents, event_kind, params jsonb, requires_actor boolean, counts_in_20 boolean, active` | Definições. Limiar (3/6/9/12 turnos, 5 freelas, 24h, 10 dias...) vive em `params`. |
| `bonus_enrollments` | `id, track_id, operator_user_id, company_id, display_name, pix_key text NULL, pix_key_normalized, starts_at, ends_at, status ('invited'\|'active'\|'ended'\|'cancelled'), accepted_at, rules_version, company_ack_at, company_ack_by_label, company_ack_note, milestones_snapshot jsonb, baseline_weekly_avg numeric, baseline_weeks int, cap_cents` | **UNIQUE (operator_user_id)**: uma inscrição por operador, ever (**Assumido**), o que faz o teto valer por operador. `milestones_snapshot` congela valores/limiares (inclusive os de antifraude) na inscrição. |
| `bonus_attributions` | `job_id PK, enrollment_id, operator_user_id, job_created_at, created_at` | Capturada por trigger no INSERT de `jobs` quando `auth.uid()` é um operador inscrito ativo daquela company. Define de quem é o turno. **Passar para / Cobrir não muda a atribuição** (anti-farm). |
| `bonus_events` | `id, enrollment_id, kind, ref_id uuid, occurred_at, actor_user_id, meta jsonb` | Append-only. Eventos de ator capturados no momento (briefing, convite ao Elenco, chamado, avaliação). Sem UPDATE/DELETE. |
| `bonus_shift_ledger` | `id, enrollment_id, application_id UNIQUE, job_id, worker_id, completed_at, counted boolean, exclusion_reason text NULL, flags text[], flag_state ('none'\|'open'\|'cleared'\|'excluded'), flagged_at, decision ('approved'\|'not_counted') NULL, decided_by, decided_at` | **Uma linha por (turno, freela) que chegou a "turno completo" candidato.** `exclusion_reason` ('vetoed_worker','same_identity','short_duration','implausible_times','no_lead_time','day_cap','week_cap','worker_week_cap') e `flags` são **internos**: nunca saem para o operador (RLS sem acesso do operador; a tela usa só um agregado). `counted=false` com motivo = exclusão silenciosa. |
| `bonus_awards` | `id, enrollment_id, milestone_id, tier smallint NULL, amount_cents, state ('validating'\|'in_review'\|'available'\|'not_counted'\|'in_payout'\|'paid'), earned_at, available_at, review_due_at NULL, evidence jsonb, payout_id NULL, celebrated_at NULL` | **UNIQUE (enrollment_id, milestone_id, tier)**. `earned_at` = instante em que o marco apareceu (confete). `available_at = earned_at + validation_hours`. `evidence` = ids de `applications`/`shift_payments`/`jobs`/`bonus_shift_ledger`. Imutável quando `paid`. Estado e decisão do dono derivam da(s) linha(s) de `bonus_shift_ledger` na evidence. |
| `bonus_payouts` | `id, enrollment_id, amount_cents, status ('requested'\|'paid'\|'cancelled'), requested_at, scheduled_for date, pix_key_snapshot, paid_at, paid_by, paid_note` | Um aberto por inscrição (UNIQUE parcial). Compõe-se de `bonus_awards.payout_id`. |
| `bonus_worker_vetos` | `worker_id PK, reason, created_by, created_at` | Lista de sócios/donos do Worki, mantida no admin (AF1). |
| `bonus_habit_snapshots` | `enrollment_id, week_index, week_start, completed_shifts, active boolean, captured_at` | Métrica de hábito (R30). Semanas 1 a 16. |

**Máquina de estados do award:** `validating` (conquistado, na janela de 48h) -> `available` (sozinho,
sem ação do dono, se nenhum turno da evidence ficou sinalizado) -> `in_payout` -> `paid`. Desvio:
`validating` -> `in_review` (turno da evidence sinalizado) -> `available` (dono **Aprovar**) ou
`not_counted` (dono **Não contar**). `not_counted` e `paid` são terminais. Nada vai de `paid` para outro
estado (sem clawback).

**Cap por trigger (defesa em profundidade):** BEFORE INSERT/UPDATE em `bonus_awards` trava a linha de
`bonus_enrollments` (`FOR UPDATE`) e rejeita se a soma de awards que não são `not_counted` passar de
`cap_cents`. A soma dos marcos já fecha R$300; o trigger existe para que bug de parâmetro nunca pague mais.

**Fuso:** todo cálculo de dia/semana em `America/Sao_Paulo`. Semana de ritmo = **segunda a domingo**
(**Assumido**: alinhada ao saque de segunda; diferente do domingo-sábado da guarda F5, e isso fica
documentado no código).

## Requirements

### Inscrição, regulamento, patrão ciente

- [ ] R1: Só o **admin** cria inscrições (`admin-data`, sem autoinscrição; **Assumido**). Cria
      `bonus_enrollments` em `invited` com `operator_user_id`, `company_id`, trilha.
- [ ] R2: Trilha `calibrating` (lojas) **não aceita inscrição**: `outcome: 'track_not_open'`. Abre
      quando o admin define os limiares (R27) e muda `status='open'`.
- [ ] R3: `bonus_accept_enrollment(p_pix_key text DEFAULT NULL)` (DEFINER, sobre `auth.uid()`): exige
      inscrição `invited`, `company_ack_at` preenchido (R4), programa `enabled`, identidade provada
      (R8) e aceite do regulamento vigente. Seta `starts_at = início do dia local`, `ends_at =
      starts_at + 84 dias`, `accepted_at`, `rules_version`, `milestones_snapshot`; **cria os dois
      primeiros awards**: marco 1 (R$0, "primeiro acesso") e marco 2 (R$10 garantido), ambos com
      `available_at = earned_at + validation_hours` como os demais (sem tratamento especial; é só mais um
      marco na janela, sem sinalização possível). Idempotente. Devolve `{outcome, enrollment_id}`.
- [ ] R4: **Patrão ciente.** Antes de ativar, o admin registra a ciência do patrão da empresa
      (`company_ack_at`, `company_ack_by_label` = nome de quem deu ciência, `company_ack_note` = como
      foi obtida, ex.: WhatsApp em tal data). Sem isso a inscrição não ativa. Não há tela nova para o
      patrão no v1 (**Assumido**; o jurídico foi relaxado pelo dono).
- [ ] R5: **Regulamento de 1 página**, pública em `/regulamento-trilha`, versionada (`rules_version`),
      conteúdo em `lib/bonusRules.ts`. Pontos mínimos: o que é; teto R$300 por operador em 12 semanas;
      a lista de marcos e valores; **regra geral de transparência: "contam turnos reais, com presença
      confirmada dos dois lados"** (nada de limiares, tetos, flags ou lista de exclusões, AF9); **uma
      linha dizendo que bônus de turno não genuíno pode deixar de ser pago e que o programa pode ser
      encerrado** (o já pago não é cobrado de volta e **não há cláusula de estorno/cobrança de
      valores já pagos**, AF10); saque por pedido, segunda-feira, mínimo R$25, saque final sem mínimo
      (R25); o dinheiro vem do caixa do Worki, não é carteira. O operador aceita marcando o regulamento
      na inscrição; grava versão e data.
- [ ] R6: **Limiares configuráveis por trilha.** Nenhum número de marco, duração mínima, teto, janela
      de 24h, janela de 48h, lacuna de 10 dias, limiar de anomalia ou mínimo de saque aparece como
      constante em código de aplicação ou SQL de função: tudo vem de `bonus_milestones.params`/
      `bonus_tracks.params`/`bonus_program_settings`, via `milestones_snapshot` da inscrição. Alterar
      parâmetro vale para **inscrições futuras**; inscrição em andamento só muda por nova versão aceita
      (fora do v1, **Assumido**: o admin cancela e reinscreve se necessário). **Exceção:** o teto de 2
      turnos por freela por semana é "regra real da rede" e vem com default 2 em `params`, mas **não pode
      ser configurado acima de 2** (CHECK).
- [ ] R7: **Definição dos 19 marcos contáveis + Coleção.** Valores em R$; "ator" = `requires_actor`. Ordem de exibição =
      numeração. Marcos 1-2 são os "2 de 19" iniciais. **Assumido:** o contador "N de 19" conta A-D;
      o grupo E (coleção) é um prêmio-meta fora dos 20 (A4+B8+C6+D2 = 20; somando E seriam 21).
      "Turno completo" é só o que o motor conta como **contável** (R10 + AF1-AF3).

| # | Grupo | Marco | R$ | Evento/condição (conferível) | Ator |
|---|---|---|---|---|---|
| 1 | A | Primeiro acesso | 0 | Aceite da inscrição (progresso dado, sem dinheiro) | não |
| 2 | A | Topei o desafio | 10 | Aceite da inscrição; **garantido**, sem fazer nada | não |
| 3 | A | Briefing da empresa preenchido | 10 | `companies.default_briefing` passa de vazio para >= 20 caracteres (**Assumido** o mínimo, param) após `starts_at`, evento capturado do operador | sim |
| 4 | A | Convidou 5 freelas | 10 | 5 `team_connections` criadas pelo operador (`bonus_events kind='elenco_invite'`) para 5 freelas distintos **não excluídos (AF1)**; `pending` basta | sim |
| 5 | B | 1º turno publicado | 10 | 1 `bonus_attributions` do operador com `jobs.status` não `deleted` | sim |
| 6 | B | 3 freelas do Elenco aceitaram | 10 | 3 freelas distintos, não excluídos, convidados pelo operador (marco 4), com `team_connections.status='accepted'` (**Assumido**: "aceitaram" = aceitaram entrar no Elenco) | sim |
| 7 | B | 1º check-in e checkout confirmados | 10 | 1ª `applications` de turno atribuído com check-in, checkout e conclusão confirmada pela empresa (nomes de campo: builder confirma no catálogo), **contável** | sim |
| 8 | B | 1º turno completo | 30 | Definição de turno completo contável (R10) | sim |
| 9 | B | 1º recibo validado em até 24h | 10 | Turno completo cujo `shift_payments.worker_confirmed_at` ocorreu em até `params.receipt_hours` (24) do checkout, **e** `recorded` pela empresa dentro do mesmo prazo (**Assumido**) | sim |
| ~~10~~ | B | ~~1ª avaliação de freela~~ REMOVIDO (ADR-20261124 A-i; R$10 realocados ao marco 8) | 0 | `reviews` direction `worker` feita pelo operador (`bonus_events kind='review'`) sobre turno atribuído a ele, freela não excluído | sim |
| 11 | B | 1º chamado de turno preenchido | 15 | `shift_calls.created_by = operador`, status `filled` com `first_claim_at`, claimante não excluído | sim |
| 12 | B | 1º freela repetido | 15 | Um mesmo freela não excluído com >= 2 turnos **contáveis** em turnos atribuídos ao operador, jobs distintos (o teto de 2/semana por freela, AF3, pode adiar o 2º para outra semana, o que é intencional) | sim |
| 13 | C | 3 turnos completos | 15 | Acumulado de turnos **contáveis** até `ends_at` | sim |
| 14 | C | 6 turnos completos | 15 | idem | sim |
| 15 | C | 9 turnos completos | 20 | idem | sim |
| 16 | C | 12 turnos completos | 20 | idem | sim |
| 17 | C | 6 semanas ativas | 15 | 6 semanas (seg-dom, SP) com >= 1 turno contável, **não** consecutivas | sim |
| 18 | C | 10 semanas ativas | 15 | idem, 10 semanas | sim |
| 19 | D | Velocidade | 15 ou 25 | Tier 1 (+15): 3 turnos contáveis em janela de 7 dias. Tier 2 (+25 no total): 5 em 14 dias. **O maior substitui:** se o tier 1 já foi concedido, o tier 2 concede a diferença (R$10); soma máxima R$25 | sim |
| 20 | D | Constância | 15 | Entre o 1º turno contável e `ends_at`, nenhuma lacuna > `params.max_gap_days` (10) dias entre turnos contáveis consecutivos nem entre o último e `ends_at`; exige >= `params.min_shifts_for_gap` (6, **Assumido**). Avaliado **uma vez, em `ends_at`** | sim |
| E | E | Coleção completa | 30 | Marcos 1-12 todos concluídos (A e B). Fora dos "N de 20" | sim (herda) |

  Totais: A 30 (0+10+10+10), B 100, C 100, D 40, E 30 = **R$300**. Marco com tiers grava um award por
  tier (`tier` 1 e 2).
- [ ] R8: **Prova de identidade própria** no aceite (e em todo evento de ator): `bonus_accept_enrollment`
      só passa se `auth.uid()` = `operator_user_id` **e** (o usuário tem linha ativa e **confirmada**
      em `company_members` daquela company, **ou** é o dono único cujo login não é compartilhado, o que o
      admin atesta em `company_ack_note`; **Assumido**). Depende de `equipe-encarregados`. Sem
      identidade: `outcome:'identity_required'`.
- [ ] R9: **Atribuição de ator.** Triggers AFTER (DEFINER, `search_path=''`) capturam `auth.uid()` na
      hora do evento, só se for operador inscrito ativo da company do evento, nas tabelas: `jobs` (cria
      `bonus_attributions` com `job_created_at`), `companies.default_briefing`, `team_connections`,
      `reviews`, `shift_calls`. Ator nulo (service_role, cron, admin), sessão de outra pessoa, **conta do
      dono operada pelo concierge** ou operador de organização do Worki **não** gera evento. Marcos
      `requires_actor` só leem `bonus_events`/`bonus_attributions`: **ação do concierge nunca paga
      marco.** Eventos antes de `starts_at` não contam.
- [ ] R9b: **Triggers nunca quebram o fluxo principal.** Todo trigger de captura/avaliação tem bloco
      `EXCEPTION WHEN OTHERS` que registra `RAISE WARNING` e segue (mesma regra da F5: nunca quebrar a
      feature). Falha do bônus não pode impedir criar turno, convidar freela nem confirmar recibo.

### Motor de avaliação

- [ ] R10: **Turno completo (candidato)** = linha (`job_id`, `worker_id`) em que, **todas** verdadeiras:
      (a) `applications` aceita (`hired` -> ... -> `completed`); (b) check-in e checkout registrados; (c)
      `shift_payments` `recorded` pela empresa **e** `worker_confirmed_at` preenchido (recibo validado
      pelos 2 lados); (d) `jobs` com `bonus_attributions` do operador. O instante do turno completo é
      `worker_confirmed_at`; só conta se estiver entre `starts_at` e `ends_at +
      params.receipt_grace_days` (**Assumido** 3 dias) para turnos cujo checkout foi até `ends_at`. Todo
      candidato vira uma linha de `bonus_shift_ledger`. Ele só é **contável** (`counted=true`) se passar
      nas condições silenciosas de AF1, AF2 e AF3; senão, `counted=false` + `exclusion_reason`, **sem
      aviso, sem erro, sem bloquear a operação**.
- [ ] R11: `bonus_evaluate_enrollment(p_enrollment_id)` (DEFINER, `search_path=''`, idempotente,
      sem parâmetro "por qual usuário"): recalcula tudo a partir dos eventos, reconstrói o
      `bonus_shift_ledger`, aplica AF4 e insere awards com `INSERT ... ON CONFLICT (enrollment_id,
      milestone_id, tier) DO NOTHING`. Nunca apaga nem reduz award existente por conta própria (sem
      clawback); a única forma de um award virar `not_counted` é a decisão **do dono** na fila (AF6),
      e só antes de `paid`. Grava `evidence`. GRANT só a `postgres`/`service_role` e ao wrapper do
      operador. **Nenhum gatilho a executa** (MEDIUM-2; ver adendo do ADR): o trigger em `shift_payments`
      só **registra** a confirmação (com `lock_timeout='2s'`). A avaliação roda na **primeira leitura**
      após o recibo: `bonus_get_my_trail()` (tela do operador), pedido de saque e `admin_bonus_refresh`
      (o admin roda antes das listas). A janela de 48h conta a partir dessa avaliação.
- [ ] R12 a R16: **substituídos pela seção "Antifraude invisível" (AF1-AF10).** Mapa: R12 (duração
      mínima) -> AF2; R13 (veto de freela) -> AF1; R14 (teto semanal) -> AF3; R15 (recibo bilateral +
      estorno) -> AF2/AF4 (`voided_after`); R16 (auditoria manual de tudo) -> **removido**: AF5-AF6.
      Auditoria por amostragem fica fora do v1.

### Antifraude invisível

Princípio do dono: **mitigar sem bloquear, sem burocracia, sem formulário nem upload.** O operador
honesto nunca percebe nada: não há aviso de exclusão, não há mensagem de erro, não há campo novo, não
há atraso visível além de uma janela de 48h igual para todos. Tudo é parâmetro (R6).

- [ ] AF1: **Exclusões silenciosas.** Um turno **simplesmente não conta** (`counted=false`,
      `exclusion_reason` interno), sem aviso nem bloqueio, quando o freela: (a) está em
      `bonus_worker_vetos` (sócios/donos do Worki; lista mantida no admin); (b) tem a **mesma chave PIX**
      normalizada (`normalizePixKeyForStorage`) que o operador (ou que qualquer freela vetado); (c) tem o
      **mesmo CPF** que o operador; (d) tem o **mesmo telefone** (só dígitos, DDI 55 normalizado) que o
      operador; (e) **é o próprio operador** (`worker_id = operator_user_id`, defesa; Article 1 já
      impede). Valores do operador vêm do que **já existe no sistema** (chave PIX que ele cadastrou para
      receber, telefone/CPF de perfil quando houver; **Assumido**: nenhum campo novo é pedido). A
      comparação roda dentro de função DEFINER; CPF, telefone e PIX de freela **nunca** saem para o
      operador. A mesma exclusão vale para convites/aceites do Elenco (marcos 4 e 6), chamado (11),
      avaliação (10) e freela repetido (12). Sinal "mesma chave PIX/telefone em 2+ freelas do mesmo
      operador" não exclui: vira flag (AF4).
- [ ] AF2: **Condições mínimas de "turno completo", verificadas pelo sistema.** Todas silenciosas
      (reprovar = `counted=false`): (a) duração check-in -> checkout >= `params.min_shift_minutes`
      (ex.: 120); (b) check-in e checkout em **instantes distintos e plausíveis**: checkout > check-in e
      ambos dentro de `[início do turno - params.checkin_tolerance_min, fim do turno +
      params.checkout_tolerance_min]` do `jobs` (**Assumido**: tolerâncias param); (c) `jobs.start_date`
      **posterior à criação** do turno com antecedência >= `params.min_lead_minutes` (**Assumido** 60), de
      modo que turno criado e completado no mesmo instante não conta; (d) recibo bilateral confirmado
      (R10). Estorno `voided` do `shift_payments` depois do award gera flag `voided_after` (AF4), nunca
      reverte nada já `paid`.
- [ ] AF3: **Tetos de contagem** (o excedente só não conta, sem erro; **operar continua livre**; nenhuma
      outra funcionalidade é limitada): no máximo `params.max_counted_per_day` turnos contados por dia e
      `params.max_counted_per_week` por semana (seg-dom, SP) por operador (**Assumido** defaults 4/dia e
      8/semana, a calibrar; para Sabrina, <= 3 por semana, o teto nunca atua), e **no máximo 2 turnos
      contados por freela por semana** por operador (regra real da rede; R6). A ordem de preferência
      é cronológica por `worker_confirmed_at`: os primeiros contam, o excedente fica `counted=false` com
      `exclusion_reason` `day_cap`/`week_cap`/`worker_week_cap`. O operador pode dar o 3º turno ao mesmo
      freela na semana normalmente; ele só não entra na contagem do bônus.
- [ ] AF4: **Detecção de anomalia por regra simples** (parâmetros configuráveis; nenhuma regra bloqueia
      nada). Cada regra, ao disparar sobre um turno **contável**, escreve `flags` e põe
      `flag_state='open'` no `bonus_shift_ledger`:
      - `burst`: >= `params.burst_count` turnos criados **e** concluídos dentro de
        `params.burst_window_hours` (rajada);
      - `single_worker`: o mesmo freela em >= `params.single_worker_pct` % dos turnos do operador, com
        mínimo de `params.single_worker_min_shifts` turnos;
      - `stuck_times`: check-in e checkout **registrados** (carimbo de criação da linha) com menos de
        `params.stuck_minutes` entre si, embora os horários declarados indiquem duração longa;
      - `repeat_pattern`: >= `params.pattern_count` turnos com o mesmo horário exato de início e duração
        no mesmo freela;
      - `shared_pix`/`shared_phone`: o mesmo PIX/telefone em 2+ freelas do mesmo operador;
      - `voided_after`: recibo estornado dentro da janela de validação.
      Turno com `flag_state='open'` fica **"em conferência"** (AF5-AF6). Marca `flagged_at` e
      `review_due_at = flagged_at + params.review_hours` (48).
- [ ] AF5: **Janela automática de validação de 48h** (`params.validation_hours`). O marco **aparece
      como conquistado na hora** (confete, contador sobe, `earned_at`), em estado `validating`. Passadas
      as 48h (`available_at`), o cron/avaliação o move **sozinho** para `available` se nenhum turno da
      `evidence` ficou sinalizado: **nenhuma aprovação manual no caso normal**. Se algum turno da
      `evidence` está sinalizado, o award vai a `in_review`: o **progresso continua aparecendo na tela**
      (marco aceso, valor em "Bônus conquistado"), mas o valor **só entra em "Disponível para saque"
      depois que o dono aprova** (AF6). Texto ao operador, neutro e igual para todos: "libera em até
      48h" (nunca "suspeito", "revisão antifraude", "conferência de irregularidade"); se passar de
      `review_due_at` ainda sem decisão, o texto muda para "estamos finalizando" (honesto, sem acusação).
      **Corte do PIX de segunda:** a lista de segunda inclui só awards `available` cujo `available_at`
      foi até a **sexta-feira anterior 23:59:59 SP**; o que libera depois entra na segunda seguinte. A
      tela mostra "libera em DD/MM" só com a data real.
- [ ] AF6: **Fila de conferência no admin** (`BonusAdminPanel`): lista **só os sinalizados**
      (`flag_state='open'`), cada um com operador, empresa, turno, freela, motivo em português (flags
      traduzidas), valor em jogo e dois botões de **1 clique: "Aprovar"** (`decision='approved'`,
      `flag_state='cleared'`, o turno passa a contar e os awards que dependiam dele voltam a seguir a
      janela de 48h/`available`; flag não reabre nesse turno) e **"Não contar"** (`decision='not_counted'`,
      `flag_state='excluded'`, `counted=false`; awards só dessa evidence viram `not_counted`, os que
      ainda têm base seguem, e o motor reavalia contadores e tiers). Sem formulário, sem justificativa
      obrigatória (campo de nota opcional), sem upload. Ação grava `decided_by`/`decided_at`. Só `service_role`
      via `admin-data`. **Auditoria por amostragem fica fora do v1.** Decisão sobre turno só antes de
      `paid`; em `paid` nada muda.
- [ ] AF7: **O operador nunca vê o antifraude.** RLS e RPCs ocultam `exclusion_reason`, `flags`,
      `flag_state`, `decision` e a lista de vetos. A tela só tem estado de award (`validating`/
      `in_review` aparecem como "libera em até 48h"; `available` como disponível) e, quando o dono
      decide "Não contar", **texto neutro**: "Esse turno não entrou na contagem", sem motivo.
      Exclusões silenciosas (AF1-AF3) **não geram nenhum texto**: o turno some da contagem e o progresso
      anda mais devagar; a tela mostra só o número real de turnos contados.
- [ ] AF8: **Atribuição por ator** (reforço de R9 e R17-R19): só ações do próprio operador contam;
      ações do concierge (conta do dono operada pela equipe do Worki), service_role, admin ou outra
      pessoa **nunca** geram bônus; depende de `equipe-encarregados`; sem a dependência, `identity_required`
      e nada se paga.
- [ ] AF9: **Transparência limitada.** A tela e o regulamento informam a **regra geral** ("contam
      turnos reais, com presença confirmada dos dois lados") e **não publicam** limiares (duração, tetos,
      janelas), nem a lista de vetos, nem as regras de anomalia, nem os motivos de exclusão. O admin
      vê tudo.
- [ ] AF10: **Sem estorno e sem punição.** Não existe cobrança de volta de valor já pago, nem saldo
      negativo, nem penalidade; o regulamento tem só a linha de R5 sobre bônus de turno não genuíno
      deixar de ser pago e o programa poder ser encerrado. Decisão "Não contar" só atua **antes** de pagar.

### Atribuição de marcos de ator e transição

- [ ] R17: Marcos `requires_actor` (3 a 20 e E; **Assumido**: mais estrito que "6 em diante" do dono)
      só consideram atribuição capturada pelos triggers de R9. Se `equipe-encarregados` ainda não está
      em produção, a inscrição não ativa (R8) e a tela mostra `identity_required`.
- [ ] R18: Responsável efetivo/Cobrir/Passar para (da outra spec) **não** transferem marco. O marco é
      de quem criou/atribuiu o turno e fez a ação. Cancelar o turno (`cancel_job`) antes de completar
      remove o turno da contagem sem punir (nada já concedido é revertido pelo motor).
- [ ] R19: Operador de organização/Gestor que não é o operador inscrito não gera marco; o patrão
      operando o turno da Sabrina não paga marco à Sabrina.

### Tela do operador

- [ ] R20: Página `pages/company/BonusTrail.tsx`, rota `/company/trilha` (**Assumido**), sob
      `<ProtectedRoute>` papel empresa; item no menu só aparece se `bonus_get_my_trail()` devolve
      inscrição `active` (divulgação progressiva; ninguém sem inscrição vê nada). Mobile-first,
      neo-brutalista azul (Article 13).
- [ ] R21: **Roadmap de missões.** Lista vertical dos 19 marcos contáveis na ordem de R7: concluídos acesos
      (selo, valor e data); **no máximo 3 ativos por vez** (os 3 primeiros não concluídos em
      `sort_order`, destacados, com barra de progresso real, ex.: "2 de 3 turnos", contando só turnos
      contáveis); os demais **trancados**, com cadeado e **valor à vista**. Marco E aparece no fim como
      "Coleção completa". **Trancar é só visual:** o progresso e os awards de um marco trancado são
      calculados e concedidos normalmente; o motor não olha o que a tela mostra.
- [ ] R22: Contador "N de 19 marcos concluídos". Começa com **2 de 19** (marcos 1-2) logo após aceitar.
      (ADR-20261124 A-i: marco de avaliação removido; "Coleção completa" fica fora do contador.)
- [ ] R23: **Três números** no topo: **"Bônus conquistado"** (soma de awards `validating`, `in_review`,
      `available`, `in_payout`, `paid`; subtexto "R$ X liberando" para `validating`/`in_review`, com a data
      real quando `validating`, e "libera em até 48h" quando `in_review`), **"Disponível para saque"**
      (só `available` sem pedido, dentro do corte de AF5; se < mínimo e inscrição ativa: "Faltam R$ Y para o
      mínimo de R$ 25"), **"Próximo PIX (segunda)"** (soma do pedido `requested` e a data real da próxima
      segunda; sem pedido, "Nenhum pedido" e a data da próxima segunda). Proibido nas telas e no código de
      UI os termos "saldo", "carteira" e "wallet".
- [ ] R24: **Comemoração.** Ao concluir marco (award novo com `celebrated_at NULL`), anima confete e
      mostra o valor, **na hora**, mesmo em `validating`/`in_review`; marca `celebrated_at` via RPC para
      não repetir. CSS/canvas leve, **sem nova dependência**; respeita `prefers-reduced-motion`. **Prazos
      honestos:** só a data real de término da janela ("Sua trilha vai até DD/MM"), a próxima segunda de PIX
      e a data de liberação; sem contador regressivo, sem urgência artificial. Marco 20 mostra "só fecha
      na semana 12", não "em risco". Marco não conquistado ao fim aparece como "não conquistado", nunca
      como perda.
- [ ] R24b: Tela mostra a chave PIX (mascarada) e permite cadastrá-la/alterá-la (R25), histórico de
      PIX enviados (data, valor, marcos) e link para o regulamento.

### Saque manual

- [ ] R25: **Pedido de saque.** `bonus_request_payout()` (DEFINER, `auth.uid()`): cria `bonus_payouts`
      `requested` com **todos** os awards `available` sem pedido e dentro do corte de AF5, se soma >=
      `min_payout_cents` (2500), há chave PIX cadastrada e não há outro pedido aberto. **Exceção:**
      inscrição `ended` pode pedir o saldo restante abaixo do mínimo (**Assumido**: saque final sem
      mínimo). `scheduled_for` = segunda-feira seguinte ao corte de **sexta 23:59:59 America/Sao_Paulo**
      (ADR-20261124 C10): pedido de segunda a sexta até o corte vale para a segunda seguinte; pedido de
      sábado/domingo cai **duas segundas depois** (A-ii). Grava
      `pix_key_snapshot`. Não há expiração para pedir saque (**Assumido**: nada se perde).
      `bonus_cancel_payout()` cancela pedido `requested` até o corte e devolve os awards a `available`.
      Alterar a chave PIX com pedido aberto é recusado (cancele antes).
- [ ] R26: **Lista de pagamento no admin.** Ação nova no `admin-data` (ou função irmã `admin-bonus` se
      o arquivo não comportar; decisão do builder/architect; **nunca** `service_role` no client, Article
      10) devolve, por semana ou mês, os pedidos com: operador, empresa, valor, **chave PIX do
      operador** (a cadastrada por ele), marcos que compõem o valor (título, valor, `evidence`) e status.
      Admin: copiar chave, **"marcar como pago"** (grava `paid_at`, `paid_by`, `paid_note`, e passa awards
      a `paid`, imutáveis), exportar CSV. **Sem aprovação por award aqui**: a lista só contém o que já está
      `available` (a conferência de anômalos é a fila de AF6). Sem integração de pagamento; o dono faz o
      PIX no banco dele.

### Admin e calibração

- [ ] R27: **Calibração da trilha das lojas.** Painel admin mostra, por empresa/responsável e fim de
      semana, turnos completos (mesma definição de R10, **sem os tetos** de AF3) e dias/horas, para medir
      pelo menos um fim de semana real. Só depois o admin edita `params` da trilha `lojas` (incluindo os
      limiares de AF2-AF4) e muda para `open`. A trilha `eventos` abre com os limiares da R7 e os defaults
      assumidos de AF.
- [ ] R28: Painel admin (`components/admin/BonusAdminPanel.tsx` montado em `Admin.tsx`): inscrições
      (criar, registrar ciência do patrão, ativar/cancelar), **fila de conferência (AF6)**, lista de
      saque, vetos de freela, parâmetros por trilha (com histórico de quem mudou), exposição máxima
      ("operadores ativos x R$ 300" e quanto já foi conquistado/disponível/pago) e interruptor `enabled`.
- [ ] R29: Toda ação de admin grava rastro (quem, quando, o quê) e passa por checagem própria do
      `admin-data`. Operador nunca lê awards/pagamentos/PIX de outro operador (RLS por
      `operator_user_id = auth.uid()`; **sem** usar `company_id = auth.uid()` na mão, e nenhum acesso do
      Gestor/patrão às tabelas de bônus no v1).
- [ ] R30: **Métrica de sucesso (hábito, semanas 13-16).** Na inscrição grava `baseline_weekly_avg` =
      média semanal de turnos completos do operador nas **4 semanas anteriores**, quando houver
      histórico (**Assumido**; se não houver, `baseline_weeks=0` e o relatório diz "sem baseline",
      sem inventar). `pg_cron` semanal grava `bonus_habit_snapshots` (semana 1 a 16, turnos completos e
      semana ativa), **continuando após o fim do bônus** (semanas 13-16 sem pagar nada). O admin exibe
      por operador: baseline x semanas 1-12 x semanas 13-16, em tabela simples. Rotulado "hipótese, não
      resultado": o sistema não declara sucesso nem calcula p-valor.

## Acceptance criteria

Verificação SQL: `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = ...; ...;
ROLLBACK;` com dados de QA (padrão de `supabase/tests/`). UI: Vitest co-located + Playwright E2E.

**Inscrição e regulamento**

- [ ] A1: Dado admin que cria inscrição para Sabrina (trilha `eventos`, `open`), quando o operador tenta
      aceitar sem `company_ack_at`, então `outcome` de recusa e nenhuma linha em `bonus_awards`; após o
      admin registrar a ciência do patrão (nome + nota), o aceite funciona.
- [ ] A2: Dado inscrição da trilha `lojas` em `calibrating`, quando o admin tenta ativar, então
      `track_not_open` e a inscrição segue `invited`.
- [ ] A3: Dado Sabrina com identidade própria confirmada que aceita o regulamento v1, então
      `starts_at` = início do dia local, `ends_at` = `starts_at + 84 dias`, existem **exatamente 2**
      awards (marco 1 R$0, marco 2 R$10), `milestones_snapshot` preenchido e a tela mostra "2 de 19".
- [ ] A4: Dado operador cujo `auth.uid()` não tem `company_members` ativo e confirmado (login
      compartilhado, ou service_role), quando tenta aceitar, então `identity_required`, nenhum award, e
      nenhum marco de ator conta depois.
- [ ] A5: Dado um segundo `bonus_enrollments` para o mesmo `operator_user_id`, então o UNIQUE rejeita
      (teto de R$300 vale por pessoa, não por empresa); dois operadores da mesma company têm tetos
      independentes.
- [ ] A5b: Dado o regulamento servido em `/regulamento-trilha`, então contém a regra geral "turnos reais,
      com presença confirmada dos dois lados" e a linha de bônus de turno não genuíno / encerramento do
      programa, **não** contém cláusula de estorno ou cobrança de valores pagos, e nenhum número de
      limiar (duração, tetos, 48h, dias) nem lista de exclusões (busca no texto e no bundle).

**Atribuição**

- [ ] A6: Dado admin, service_role ou conta do dono (operada pelo concierge) criando turno na company da
      Sabrina, quando o motor roda, então nenhum `bonus_attributions` nem award de marco 5; dado turno
      criado na sessão da Sabrina, então existe atribuição e o marco 5 (R$10) é concedido com
      `evidence.job_id`.
- [ ] A7: Dado turno atribuído à Sabrina depois "passado" para outra pessoa (ou coberto), quando o turno
      completa, então o marco continua da Sabrina e a pessoa que recebeu o turno não ganha marco; dado
      turno que o patrão publicou e a Sabrina só operou, nenhuma atribuição à Sabrina.

**Exclusões silenciosas (AF1) e condições mínimas (AF2)**

- [ ] A8: Dado freela F em `bonus_worker_vetos` (sócio do Worki), quando F cumpre todo o ciclo em turno
      da Sabrina, então o turno **não conta** em nenhum marco (7-9, 12-20), `bonus_shift_ledger` tem
      `counted=false` com `exclusion_reason='vetoed_worker'`, e **a Sabrina não recebe nenhum aviso**:
      nenhuma notificação, nenhum texto na tela, nenhuma mudança de comportamento (turno concluído e recibo
      funcionam normalmente); o mesmo F convidado ao Elenco não conta nos marcos 4 e 6.
- [ ] A8b: Dado freela cuja chave PIX normalizada, CPF (só dígitos) ou telefone (DDI 55 normalizado) é
      igual ao do operador, em formatos de máscara diferentes, então mesmo resultado de A8; dado
      `worker_id` igual ao `operator_user_id`, mesmo resultado; CPF/telefone/PIX do freela nunca aparecem
      em resposta ao operador.
- [ ] A9: Dado turno com check-in 18:00 e checkout 18:40 e `min_shift_minutes=120`, então
      `counted=false` (`short_duration`), sem aviso, e a operação segue.
- [ ] A9b: Dado turno cujo checkout é anterior ao check-in, ou com horários fora das tolerâncias do
      turno, então `counted=false` (`implausible_times`); dado turno criado às 10:00 com `start_date` às
      10:00 e completado em seguida (sem antecedência de `min_lead_minutes`), então `counted=false`
      (`no_lead_time`); sem aviso em todos.
- [ ] A10: Dado turno com checkout feito mas `shift_payments` sem `worker_confirmed_at`, então **não** é
      turno completo; após o freela confirmar o recibo, o trigger só registra; o award dos marcos 8/13
      é concedido na primeira leitura seguinte (tela, saque ou admin), com `earned_at` = instante dessa
      avaliação (não o da confirmação).

**Tetos (AF3)**

- [ ] A11: Dado operador com `max_counted_per_week=8` e 9 turnos completos contáveis na semana, então o
      9º fica `counted=false` (`week_cap`) e não soma em 13-16/19; dado `max_counted_per_day=4` e 5 no
      mesmo dia, o 5º `day_cap`; em ambos o turno foi operado normalmente, sem erro nem bloqueio na
      criação, convite, check-in ou recibo.
- [ ] A11b: Dado o mesmo freela com 3 turnos completos na mesma semana nos turnos da Sabrina, então o 1º
      e o 2º contam e o **3º não conta** (`worker_week_cap`), sem aviso, e a Sabrina consegue criar,
      contratar e pagar o 3º normalmente; na semana seguinte o mesmo freela volta a contar até 2.
      Configurar `max_per_worker_week=3` é rejeitado pelo CHECK.

**Anomalias e janela de 48h (AF4-AF6)**

- [ ] A12: Dado award `validating` cujo turno é estornado (`shift_payments` -> `voided`) dentro da
      janela, então o turno recebe `flag voided_after`, o award vai a `in_review` e entra na fila do admin;
      após `paid`, tentativa de UPDATE/DELETE no award falha no banco e nada é cobrado de volta.
- [ ] A12b: Dado operador com `burst_count=3` e `burst_window_hours=3` que cria e conclui 3 turnos nessa
      janela, ou com o mesmo freela em >= `single_worker_pct` dos turnos (>= `single_worker_min_shifts`), ou
      check-in/checkout registrados com menos de `stuck_minutes` entre si, ou `pattern_count` turnos de
      horário idêntico, então os turnos ficam `flag_state='open'` com a flag correspondente, o marco **aparece
      conquistado com confete**, o award vai a `in_review` e o valor **não** entra em "Disponível para
      saque"; a tela mostra "libera em até 48h" sem nenhuma palavra de suspeita.
- [ ] A12c: Dado o caso normal (nenhuma flag), quando passam `validation_hours` (48h) sem nenhuma ação do
      dono, então o cron de hora em hora move o award de `validating` para `available` sozinho e o valor
      entra em "Disponível para saque"; antes das 48h ele aparece em "Bônus conquistado" e não em
      "Disponível".
- [ ] A12d: Dado award que vira `available` na quinta e outro no sábado, quando o dono gera a lista da
      segunda, então só o da quinta entra (corte: sexta anterior 23:59:59 SP); o do sábado entra na
      segunda seguinte.
- [ ] A12e: Dado a fila de conferência do admin, então lista **somente** os turnos com `flag_state='open'`,
      cada um com motivo legível, valor em jogo, e dois botões; **Aprovar** (1 clique) leva os awards
      dependentes a `available` e o turno a `cleared` (não sinaliza de novo); **Não contar** (1 clique) leva o
      turno a `excluded`, os awards sem outra base a `not_counted`, o progresso é recalculado, e a tela da
      operadora mostra apenas "Esse turno não entrou na contagem"; nenhum dos dois exige texto ou upload.
- [ ] A12f: Dado o dono sem nenhuma ação por 5 dias e nenhum turno sinalizado, então todos os awards
      normais ficaram `available` e foram pagáveis sem passo manual; dado turno sinalizado sem decisão, o
      valor segue fora de "Disponível" e, após `review_due_at`, o texto da tela vira "estamos finalizando".
- [ ] A12g: Dado operador honesto (nenhum filtro disparado) percorrendo todo o fluxo, quando se inspeciona
      o DOM, as respostas das RPCs e as notificações, então **não há** nenhum campo, texto ou evento sobre
      exclusão, flag, tetos, veto ou revisão (teste automatizado de ausência), e as chaves
      `exclusion_reason`, `flags`, `flag_state`, `decision` nunca aparecem no payload do operador.

**Marcos (cada gatilho, com valor)**

- [ ] A13: Dado Sabrina que preenche o briefing com 25 caracteres na própria sessão, então marco 3
      (R$10) é concedido; dado briefing preenchido por outra sessão ou antes de `starts_at`, nada.
- [ ] A14: Dado Sabrina que convida 5 freelas distintos não excluídos para o Elenco, então marco 4 (R$10);
      com 4 convidados + 1 vetado, não; ao 3º aceitar entrar no Elenco, marco 6 (R$10).
- [ ] A15: Dado 1º turno completo contável com recibo confirmado pelo freela em 20h após o checkout, então
      marcos 7 (R$10), 8 (R$20) e 9 (R$10) são concedidos; com confirmação em 30h, 9 **não** é concedido
      e 7/8 sim.
- [x] A16 (REMOVIDO por ADR-20261124 A-i — nenhuma avaliação gera marco): Dado avaliação de freela feita pela Sabrina sobre turno atribuído a ela, então marco 10
      (R$10); avaliação feita por outra pessoa, não.
- [ ] A17: Dado chamado criado pela Sabrina com claimante aceito (`first_claim_at`), então marco 11
      (R$15); dado claimante excluído (AF1), não.
- [ ] A18: Dado freela não excluído com 2 turnos contáveis em jobs distintos da Sabrina, então marco 12
      (R$15).
- [ ] A19: Dado 3, 6, 9 e 12 turnos contáveis acumulados, então concede 15, 15, 20 e 20 nessa ordem,
      cada um exatamente uma vez (rodar o motor 3x seguidas não duplica: UNIQUE).
- [ ] A20: Dado turno contável em 6 semanas distintas, não consecutivas (seg-dom, SP), então marco 17
      (R$15); com 10, marco 18 (R$15); uma lacuna de 3 semanas no meio **não** impede (e não remove nada).
- [ ] A21: Dado 3 turnos contáveis em 6 dias, então marco 19 tier 1 (+15); depois 2 turnos contáveis que
      formem 5 em 14 dias, então tier 2 concede **+10** (total 25, nunca 40); dado 5 em 14 dias sem nunca ter
      tido tier 1, concede 25 no total (um ou dois awards; a soma é 25).
- [ ] A22: Dado ao `ends_at` >= 6 turnos contáveis e nenhuma lacuna > 10 dias (incluindo do último
      turno até `ends_at`), então marco 20 (R$15) é concedido **só então**, na primeira avaliação lida após `ends_at`
      (sem cron, ADR-20261124 C4); dado uma lacuna de 11
      dias, não é concedido, a tela mostra "não conquistado" sem texto de perda e nenhum outro award muda.
- [ ] A23: Dado marcos 1-12 todos concluídos, então "Coleção completa" concede R$30 e o contador "N de
      19" **não** passa de 19; soma total de awards (exceto `not_counted`) nunca excede R$300 (teste:
      inserir award que estoure o cap falha pelo trigger).
- [ ] A24: Dado ações capturadas antes da ativação de `equipe-encarregados` (turnos sem atribuição),
      quando o motor roda, então nenhum marco de ator é concedido retroativamente.

**Tela**

- [ ] A25: Dado Sabrina com inscrição ativa, quando abre `/company/trilha` em 375 px de largura, então
      vê topo com os três números "Bônus conquistado", "Disponível para saque", "Próximo PIX
      (segunda)", "2 de 19 marcos concluídos", exatamente 3 marcos ativos com barra de progresso, os
      demais com cadeado e valor em R$, e nenhum texto "saldo"/"carteira" (teste por busca no DOM).
- [ ] A26: Dado marco trancado (ex.: marco 14, 6 turnos) cuja condição for cumprida antes de os
      anteriores concluírem, então o award é concedido mesmo trancado e a tela o mostra aceso.
- [ ] A27: Dado award novo não celebrado, quando a tela abre, então confete e valor aparecem uma vez e
      `celebrated_at` é preenchido; com `prefers-reduced-motion: reduce`, sem animação; recarregar não
      repete.
- [ ] A28: Dado usuário sem inscrição, então o item de menu não aparece e `/company/trilha` mostra
      estado vazio sem dado de terceiros; dado freela (papel worker) acessando, `ProtectedRoute` nega.
- [ ] A29: Dado a tela de qualquer estado, então nenhuma contagem regressiva, nenhum "últimas horas" e as
      únicas datas de prazo são `ends_at` real, a data real de liberação e a próxima segunda real.

**Saque e admin**

- [ ] A30: Dado R$20 `available`, então "Disponível" mostra R$20,00 com "Faltam R$ 5,00 para o mínimo de
      R$ 25" e `bonus_request_payout()` retorna `below_minimum`; com R$35 `available` e PIX cadastrado,
      cria pedido de R$35 com `scheduled_for` = segunda por regra de corte de sexta 23:59:59 SP (testar quarta e
      sexta 23:59 → segunda seguinte; sábado 00:00 e domingo 23:59 → duas segundas depois; ADR-20261124
      C10/A-ii).
- [ ] A31: Dado pedido aberto, quando o operador pede de novo ou altera a chave PIX, então recusa; ao
      cancelar o pedido antes do corte, awards voltam a `available` e a chave pode ser alterada.
- [ ] A32: Dado inscrição `ended` com R$10 `available`, então o pedido de saque final é aceito (sem
      mínimo).
- [ ] A33: Dado admin autenticado em `admin-data`, quando pede a lista da próxima segunda, então recebe
      por pedido: operador, empresa, valor, chave PIX cadastrada, marcos (título/valor/`evidence`); não
      contém award `in_review` nem `validating`; não-admin recebe negação; anon/authenticated chamando as
      RPCs de admin é negado por GRANT.
- [ ] A34: Dado admin marcando o pedido como pago, então `paid_at`, `paid_by` preenchidos, awards
      `paid` imutáveis, a tela do operador passa a mostrar o PIX no histórico e "Próximo PIX" zera; o
      CSV exportado tem as mesmas linhas.
- [ ] A35: Dado `wallets`, `escrow_transactions`, `wallet_transactions` antes e depois de todo o fluxo
      acima, então nenhuma linha alterada e nenhuma RPC de saldo chamada (Article 8); `grep` no diff por
      `wallets`/`balance` retorna vazio fora de comentários.
- [ ] A36: Dado operador A tentando ler `bonus_awards`, `bonus_payouts`, `bonus_shift_ledger` ou PIX de
      operador B (e o patrão/Gestor da company tentando), então 0 linhas; e o operador A lendo o próprio
      `bonus_shift_ledger` obtém 0 linhas (só agregados via RPC).

**Métrica e qualidade**

- [ ] A37: Dado inscrição com 4 semanas de histórico, então `baseline_weekly_avg` e `baseline_weeks=4`
      são gravados na inscrição; sem histórico, `baseline_weeks=0` e o relatório mostra "sem baseline".
- [ ] A38: Dado o cron semanal, quando roda nas semanas 13 a 16 (bônus encerrado), então grava
      `bonus_habit_snapshots` sem criar award nem alterar `ends_at`; o admin vê baseline x 1-12 x 13-16
      rotulado "hipótese".
- [ ] A39: Dado erro simulado dentro da função do trigger de bônus, quando o operador cria turno, convida
      freela ou o freela confirma recibo, então a operação principal **conclui** e há `WARNING` no log.
- [ ] A40: Dado limiares alterados em `bonus_milestones.params`/`bonus_tracks.params` de uma trilha, então
      inscrições existentes mantêm o `milestones_snapshot` e novas usam o novo valor; nenhuma constante de
      limiar em `frontend/src` ou nas funções SQL (revisão por grep).
- [ ] A41: `cd frontend && npm run build` e `npm run lint` verdes (Article 3); Vitest para o cálculo de
      "3 ativos", dos três números, do corte de segunda/sexta e da cópia sem "saldo/carteira"; E2E (2
      Chromes) cobrindo aceite -> turno completo -> confete -> janela 48h -> pedido -> admin paga, e um turno
      sinalizado -> fila -> Aprovar.

## Out-of-scope

- **Pagamento automático**, qualquer integração Asaas/PIX API/open finance (o dono paga manualmente).
- Carteira, saldo, extrato, créditos, assinatura, cripto, token, cashback; qualquer coluna ou tela com
  "saldo". Nada em `wallets`/`escrow_transactions`/`wallet_transactions`.
- **Loteria, sorteio, aleatoriedade**, ranking entre operadores, competição, placar público.
- **Clawback**, estorno de bônus pago, cobrança de volta, penalidade por quebrar sequência, perda de marco.
- **Auditoria por amostragem**, KYC, upload de comprovante, formulário de justificativa, selfie, geolocalização
  de check-in (v1: só o antifraude invisível).
- Bônus para o **freela** (engajamento do freela é outra frente; ver `freelancer-engagement`).
- Bônus por empresa, por volume financeiro, por gasto, por indicação de cliente.
- Autoinscrição, múltiplas inscrições por operador, renovação/segunda rodada da trilha (decidir depois
  do resultado da semana 16).
- Visão do patrão/Gestor sobre a trilha do operador; aceite da ciência pelo patrão dentro do app.
- Edição de limiares em inscrição em andamento sem reinscrição.
- Notificação por e-mail/WhatsApp automático (só notificação in-app existente, se o builder quiser; sem
  e-mail transacional, que não existe).
- Texto jurídico além do regulamento de 1 página; parecer de LGPD/trabalhista (relaxado pelo dono).
- Relatório estatístico, p-valor, atribuição causal do hábito (só tabela descritiva rotulada hipótese).

## Sequência de implementação (fatias pequenas)

Cada fatia é mergeável e **inerte** até `bonus_program_settings.enabled = true` (S8). Migrations
aplicadas por MCP dirigido e verificadas no catálogo (nunca `supabase db push`).

| Fatia | Entrega | Gate | Reversão |
|---|---|---|---|
| S0 | ADR "bônus de aquisição pago manualmente do caixa do Worki, fora do razão"; confirmar estado de `equipe-encarregados` E4/E5 e nomes de colunas (check-in/checkout, `created_by`, `jobs.created_at`/`start_date`, `reviews.reviewer_id`, `default_briefing`, `workers.cpf`/`phone`) no **catálogo** | architect | n/a |
| S1 | Migration de schema: tabelas (incl. `bonus_shift_ledger`), RLS (operador lê só o próprio e nunca o ledger), UNIQUEs, CHECK do teto 2/freela/semana, trigger de cap e de imutabilidade `paid`, seed da trilha `eventos` (19 marcos contáveis + Coleção, params de AF) e `lojas` em `calibrating`, `enabled=false` | architect + security | DROP TABLE (nada referencia) |
| S2 | Triggers de captura de atribuição/eventos (R9, R9b) com bloco de exceção; testes SQL de ator (concierge/dono não conta) | security | DROP TRIGGER |
| S3 | Motor `bonus_evaluate_enrollment` por grupos: (a) ledger + exclusões silenciosas AF1-AF3, (b) marcos A-B, (c) C, (d) D+E, cada um com testes SQL de fixtures (vetos, PIX/CPF/telefone, duração, lead time, tetos dia/semana/freela, 24h, fuso) | evaluator | `CREATE OR REPLACE` anterior |
| S3b | Anomalias AF4 + máquina `validating`/`in_review`/`available` + cron horário (AF5) | evaluator + security | `CREATE OR REPLACE`; DROP cron |
| S4 | RPCs do operador (`bonus_accept_enrollment`, `bonus_get_my_trail`, `bonus_set_pix_key`, `bonus_request_payout`, `bonus_cancel_payout`, `bonus_mark_celebrated`) + cron semanal | security | DROP FUNCTION |
| S5 | Frontend: `BonusTrail.tsx`, componentes de marco/progresso/confete, `/regulamento-trilha`, `lib/bonusRules.ts`, `bonusService.ts`; Vitest (incl. teste de ausência de termos de antifraude) | frontend-reviewer | revert |
| S6 | Admin: ações no `admin-data`, `BonusAdminPanel.tsx` (inscrições, ciência do patrão, **fila de conferência 1 clique**, lista de saque, pago, CSV, vetos, params) | security (Admin.tsx + edge fn) | revert |
| S7 | Métrica: baseline, `bonus_habit_snapshots`, relatório admin; **relatório de calibração do fim de semana das lojas** (R27) | evaluator | DROP |
| S8 | Ligar para Sabrina: só depois de `equipe-encarregados` em produção, ciência do patrão registrada, E2E 2 Chromes, simulação do `harness-tester`. Trilha lojas só abre após calibrar | tester | `enabled=false` |

## Riscos

- **R-1 Identidade compartilhada.** Sem `equipe-encarregados`, a atribuição de ator é falsa. Mitigação:
  recusa (`identity_required`), sem retroatividade, e nenhuma "exceção do concierge".
- **R-2 Sócio como operador e freela.** O sócio do Worki em lojas é pago pelo próprio Worki (conflito de
  interesse) e é freela da Momma. Mitigação: veto de freelas sócios (AF1), flag, fila do dono. Fica claro
  ao dono que isso é dinheiro dele para ele mesmo; a spec só impede o autopagamento via freela.
- **R-3 Gaming de atribuição/volume** (criar turnos curtos com amigos, passar turnos entre operadores,
  repetir freela). Mitigação invisível: duração/antecedência mínimas, tetos por dia/semana/freela,
  atribuição capturada no INSERT, recibo bilateral, regras de anomalia com fila de 1 clique. **Não elimina**
  conluio freela+operador com PIX/CPF/telefone diferentes e baixa frequência: esse caso passa pela janela
  de 48h sem sinalização. Aceito no piloto de 3 operadores e R$300 de teto por pessoa; sem auditoria por
  amostragem no v1.
- **R-4 Limiares errados para as lojas** (volume desconhecido): ou ninguém alcança, ou todos alcançam em
  duas semanas; limiares de anomalia mal calibrados geram falso positivo (operador honesto cai em "libera
  em até 48h" sem motivo) ou falso negativo. Mitigação: trilha em `calibrating`, medição antes, parâmetros
  e snapshot por inscrição, fila do dono mostra a taxa de sinalização.
- **R-5 Calibração da trilha eventos.** Sabrina com 12 turnos só alcança o marco 16 com 1 freela/evento
  sem folga; 10 semanas ativas exige constância quase total; e o teto de 2/freela/semana pode **atrasar** o
  marco 12 e os acumulados se ela repete o mesmo freela. Aceito pelo dono; dado de calibração no admin.
- **R-6 Obrigação sem cobertura.** O caixa do Worki cobre até R$300 por operador; exposição máxima =
  operadores ativos x R$300, visível no admin (R28). Sem trava de orçamento global.
- **R-7 Confiança do operador e "Não contar".** Um marco aceso que depois vira "não contado" pode parecer
  perda. Mitigação: texto neutro, só antes de `paid`, regra geral no regulamento (R5); a revisão de anômalo
  usa a janela de 48h para que a maioria das decisões aconteça antes de o valor ser mostrado como disponível.
  Risco residual aceito pelo dono (decisão de 23/11).
- **R-8 Corrida de dados.** Avaliação por cron/trigger pode atrasar a comemoração; `bonus_get_my_trail()`
  avalia ao abrir, então a tela nunca fica atrás do banco.
- **R-9 Trigger em `shift_payments`** é caminho crítico do modo A. Mitigação: R9b (exceção engolida) e
  teste A39.
- **R-10 PIX/CPF/telefone.** O PIX do operador é legível só ao dono da inscrição e ao admin; CPF e telefone de
  freela só são comparados dentro de função DEFINER, nunca devolvidos. LGPD relaxada pelo dono, mas a
  restrição de leitura é grátis.
- **R-11 Semana seg-dom vs F5 dom-sáb.** Duas convenções de semana no projeto; escopo isolado em funções
  `bonus_*`, documentado, para não vazar para outras features.
- **R-12 Dependência do cron.** A liberação sozinha em 48h e o marco 20 dependem de `pg_cron` ativo; sem ele
  nada vira `available` e o dono teria de aprovar à mão, o oposto do princípio. Gate de entrega: confirmar a
  extensão em produção antes de S8 (mesmo padrão do F4/F8).

## Open items (defaults Assumidos valem se não houver resposta)

1. "N de 20" exclui o prêmio E? (Assumido: sim, A-D = 20, E é meta extra.)
2. "Marcos 6+" para marcos de ator: aplicar a 3-20? (Assumido: sim, mais estrito.)
3. Saque final sem mínimo e sem prazo para pedir? (Assumido: sim, sem expiração.)
4. Defaults de antifraude: duração mínima 120 min, antecedência mínima 60 min, teto 4/dia e 8/semana
   contados, 2/freela/semana (fixo), rajada 3 turnos em 3h, `single_worker` 80% com mínimo 4 turnos,
   `stuck_minutes` 10, `pattern_count` 3, janela de validação 48h, `review_hours` 48; briefing >= 20
   caracteres.
5. Patrão ciente registrado pelo admin, sem tela nova.
6. Sabrina e o sócio/RH compartilham login hoje? Se sim, não entram antes de `equipe-encarregados`.
7. Telefone/CPF do operador para a comparação de AF1: vêm do que já existe; se o perfil de empresa não
   tem, só PIX e `worker_id` são comparados. (Assumido: sem campo novo.)

## Clarifications log

- Q: Há rodada de perguntas ao humano? -> A: Não. O dono fixou as decisões 1-8; lacunas foram
  preenchidas como **(Assumido)** abaixo.
- Q: **(Revisão 2, coordenador 23/11)** Antifraude manual ou invisível? -> A (decisão do dono): invisível.
  Substitui a auditoria manual de todo marco: exclusões silenciosas (AF1), condições mínimas (AF2), tetos
  (AF3), anomalias por regra (AF4), janela automática de 48h (AF5), fila de 1 clique só para sinalizados
  (AF6), atribuição por ator (AF8), transparência limitada (AF9), sem estorno (AF10).
- Q: Marco aparece como conquistado enquanto o valor ainda não é pagável? -> A (decisão do dono): sim, na hora, com
  confete; "Bônus conquistado" inclui; "Disponível" só após 48h sem sinalização; sinalizado só após aprovação.
- Q: Corte do PIX de segunda com a janela de 48h? -> A (decisão do dono): a segunda cobre o que foi validado até a sexta
  anterior; **Assumido** 23:59:59 SP e corte de **pedido** continua domingo 23:59:59 SP.
- Q: Teto por freela por semana? -> A (decisão do dono): máx. 2 turnos contados por freela por semana, "regra real da
  rede"; **Assumido** CHECK que impede configurar acima de 2. Contado por operador, seg-dom, SP.
- Q: Tetos por dia e por semana por operador? -> A (decisão do dono: parâmetros). **Assumido** defaults 4/dia e 8/semana.
- Q: "Check-in e checkout colados" já não é coberto por duração mínima? -> A (Assumido): duração mínima exclui
  em silêncio; `stuck_times` detecta o caso que passa nesse filtro: horários declarados longos mas **carimbos
  de registro** colados (declarou 4h, registrou os dois em poucos minutos).
- Q: Mesmo CPF/telefone do operador: de onde vêm os dados do operador? -> A (Assumido): do que já existe no
  sistema (PIX cadastrado para receber, perfil quando houver); nenhum formulário novo, sem bloquear a
  inscrição se faltar.
- Q: O que o operador vê quando o dono diz "Não contar"? -> A (Assumido): só "Esse turno não entrou na
  contagem", sem motivo, sem acusação; exclusões silenciosas não mostram nada.
- Q: Decisão do dono em turno sinalizado (campos)? -> A: gravada em `bonus_shift_ledger`
  (`decision`, `decided_by`, `decided_at`, `flag_state`), com motivo em `flags`; award herda estado.
- Q: Sinalizado sem decisão do dono vence sozinho? -> A (decisão do dono: só após o dono aprovar): não; fica
  `in_review`; o texto muda para "estamos finalizando" após `review_due_at`; sem auto-aprovação.
- Q: "20 marcos" vs A(4)+B(8)+C(6)+D(2)+E(1) = 21? -> A (Assumido): contador "N de 20" = A-D; "Coleção
  completa" (E, R$30) é prêmio-meta fora do contador. Início "2 de 20" = marcos 1 (primeiro acesso) e 2
  (aceite com R$10 garantido).
- Q: Marco 19 (velocidade) com dois tiers soma? -> A (Assumido): tier 1 +15, tier 2 total +25; "o maior
  substitui" = paga a diferença de R$10 quando o tier 1 já foi pago; máximo R$25, nunca R$40.
- Q: Marco 20 (nenhuma lacuna > 10 dias) pode ser avaliado antes de `ends_at`? -> A (Assumido): não;
  fecha em `ends_at` e exige >= 6 turnos contáveis para não ser trivial; lacuna conta também do último turno
  até `ends_at`.
- Q: O que é "3 freelas do Elenco aceitaram"? -> A (Assumido): 3 freelas convidados pelo operador que
  aceitaram entrar no Elenco (`team_connections.status='accepted'`); não excluídos.
- Q: "1º recibo validado em até 24h" conta a partir de quê? -> A (Assumido): do checkout; e a empresa deve
  registrar no mesmo prazo.
- Q: Que marcos são "ação do operador"? -> A (Assumido): 3-20 e E; só 1-2 não dependem de ator, e mesmo
  assim exigem identidade própria no aceite (R8).
- Q: Atribuição por `responsible_id` ou por captura no evento? -> A (Assumido): **captura no evento**
  (`auth.uid()` na criação), porque `responsible_id` pode ser reescrito por "Passar para"/remoção e
  permitiria transferir marcos; `equipe-encarregados` continua sendo pré-requisito para identidade.
- Q: Concierge/admin criando turno paga marco? -> A: Não, nunca; ator nulo, service_role, conta do dono operada
  por concierge ou outra sessão não gera evento.
- Q: O que acontece enquanto `equipe-encarregados` não existe? -> A: Fatias de construção seguem inertes
  (`enabled=false`), aceite recusa `identity_required`, nada é pago, nada retroage.
- Q: Quem é o "patrão ciente" e como se registra? -> A (Assumido): Gestor/dono da company; o admin registra
  nome, data e nota de como obteve (ex.: WhatsApp). Sem tela nova no v1.
- Q: Corte do saque de segunda? -> A (Assumido): pedido até domingo 23:59:59 (SP) entra na segunda
  seguinte; pedido na segunda vai para a próxima. Cancelável até o corte.
- Q: Saque abaixo de R$25 ao fim? -> A (Assumido): saque final sem mínimo; sem prazo de expiração.
- Q: Rejeição de marco é clawback? -> A: não; "Não contar" só atua **antes** de `paid`; depois é imutável e
  não há cobrança de volta (AF10).
- Q: Teto por operador vs UNIQUE de inscrição? -> A (Assumido): uma inscrição por operador (UNIQUE
  `operator_user_id`), assim o teto de R$300 vale por pessoa; duas pessoas na mesma empresa têm dois tetos.
- Q: Limiares do antifraude? -> A (Assumido, todos parâmetros): ver Open items 4; tolerância de 3 dias após
  `ends_at` para confirmar recibo de turno feito dentro da janela.
- Q: Semana "ativa" começa em que dia? -> A (Assumido): segunda a domingo, `America/Sao_Paulo` (diferente
  da F5, isolado em `bonus_*`).
- Q: Baseline e métrica de sucesso? -> A (Assumido): média das 4 semanas anteriores à inscrição quando
  houver; senão "sem baseline"; snapshots semanais da semana 1 a 16; apresentado como hipótese.
- Q: Onde fica o painel admin e as ações privilegiadas? -> A (Assumido): `Admin.tsx` + `admin-data` (ou
  função irmã), nunca `service_role` no client. **Não li** `Admin.tsx` nem `admin-data` nesta sessão; o
  builder confirma o padrão de ações.
- Q: Nomes de colunas (check-in/checkout, criador do turno, `jobs.created_at`/`start_date`,
  `reviews.reviewer_id`, `default_briefing`, `workers.cpf`/`phone`) existem como assumido? -> A: **Não
  verificado**; esta spec não consultou o catálogo. Fatia S0 confirma.
- Q: Estado de produção de `equipe-encarregados`? -> A: lido só o spec e as migrations não commitadas
  (`20261123000100`-`000500`); **não** está confirmado como aplicado.
- Q: Rota e nome da tela? -> A (Assumido): `/company/trilha`, "Trilha"; regulamento em
  `/regulamento-trilha`.
