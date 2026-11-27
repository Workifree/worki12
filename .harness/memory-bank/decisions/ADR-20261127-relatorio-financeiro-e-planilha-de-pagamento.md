# ADR-20261127 — Relatório financeiro e planilha de pagamento por RPC DEFINER com dois níveis de PII

## Status
PROPOSTO

## Contexto
O dono vai apresentar ao financeiro da Momma Doces um relatório que pede: horas e valor/hora (check-in/out),
CPF e PIX do freela (somente Gestor/dono), encarregado responsável, etiqueta e título do turno, totais por
freela e por dia, filtros (freela, responsável, etiqueta), ID do pagamento no CSV, uma visão do Encarregado
restrita aos próprios turnos e sem PII, e uma **planilha de pagamento** com uma linha por freela.

Hoje `orderReportService.getReport` lê `jobs`, `shift_payments`, `applications` e `workers` direto pelo
PostgREST e monta tudo em JS. Isso não serve para o novo pedido:
- `can_view_worker_profile` (DS-PII) não concede ao Encarregado leitura de `workers`. O nome do freela some
  (`workerName = null`), e CPF/PIX não podem nem devem vir por esse caminho.
- O nome do responsável vem de `company_members.display_name`, que o Encarregado não deve varrer.
- O filtro de período é aplicado em JS depois de baixar **todos** os turnos da company, e com fuso do
  navegador. Não escala e erra o dia local.
- Os totais (por freela, por dia, horas) somados no client sobre linhas que a RLS cortou em silêncio
  mentiriam: é o mesmo problema que levou F3 a usar `p_dry_run` no banco.

Catálogo de produção conferido em 27/11/2026 (somente leitura):
- `applications`: `worker_checkin_at`, `worker_checkout_at`, `company_checkin_confirmed_at`,
  `company_checkout_confirmed_at` (todas `timestamptz`), `status`. Em produção: 19 check-ins, 19 checkouts,
  17 checkouts confirmados pela empresa, 16 `completed`.
- `jobs`: `start_date timestamptz`, `work_start_time text`, `work_end_time text`, `estimated_hours integer`,
  `budget`, `budget_type`, `title`, `category`, `responsible_id`, `tag_id`, `status`, `company_id`.
- `shift_payments`: `id`, `job_id`, `worker_id`, `application_id`, `amount numeric`, `source`, `status`,
  `paid_at`, `scheduled_for date`, `worker_confirmed_at`, `voided_at`, `purged_at`, `recorded_by`, `note`.
  Não existe coluna de número de recibo: o identificador é `shift_payments.id`.
- `workers`: `full_name`, `cpf`, `pix_key` (text). **Não existe `pix_key_type`**: o tipo é inferido.
- `company_tags(id, company_id, name, archived_at)`; `company_members(user_id, display_name, role, status, confirmed_at, ...)`.
- Funções existentes: `is_company_owner(uuid)` e `is_job_owner(uuid)` (INVOKER),
  `session_can_operate_job(company, responsible, date)` (DEFINER), `job_local_date(uuid)`,
  `session_company_member_role(uuid)`, `get_shift_worker_payment_card(uuid)` (DEFINER, jsonb).
- Não há tabela genérica de auditoria (só `bonus_admin_log`). Não há lib XLSX no `frontend/package.json`.

## Decisão

### 1. Duas RPCs SECURITY DEFINER, uma por produto, cada uma com o próprio nível de PII
Leitura sai das tabelas e passa a ser **só** por RPC. `orderReportService` deixa de consultar `workers`.

- `get_financial_report(...)` — linhas (turno, freela). Serve Gestor **e** Encarregado. **Nunca devolve CPF
  nem PIX**, para ninguém. O Gestor vê CPF/PIX só na planilha.
- `get_payment_sheet(...)` — uma linha por freela. **Gestor-only** (`is_company_owner`). É a única saída com
  CPF e PIX completos. Grava log de geração.

Separar os dois evita a armadilha de "mesma RPC, coluna condicional por papel": um bug no `CASE` vazaria PII
para o Encarregado. Com duas funções, a de PII nem é chamável com sucesso por quem não é Gestor.

### 2. Autorização (sempre pelo seam, nunca `company_id = auth.uid()` escrito à mão)
- Entrada: `p_company_id` obrigatório (sessão pode operar mais de uma company; `LIMIT 1` proibido).
- `get_financial_report`:
  - `is_company_owner(p_company_id)` → escopo = company inteira; filtro `p_responsible_id` livre.
  - senão, papel `encarregado` confirmado (`internal_company_confirmed_operator`) → escopo = turnos em que
    `session_can_operate_job(j.company_id, j.responsible_id, job_local_date(j.id))` é true (próprios +
    cobertos). `p_responsible_id` é ignorado (forçado ao escopo). Não confirmado → `outcome='not_confirmed'`.
  - senão → `outcome='forbidden'`, zero linhas (nunca EXCEPTION com detalhe — não é oráculo).
- `get_payment_sheet`: só `is_company_owner(p_company_id)`; caso contrário `forbidden`.
- Nome do freela no relatório do Encarregado: sai pela RPC (nome não é PII sensível e ele já o vê no turno).
- Nome do responsável: `company_members.display_name` resolvido dentro da RPC; responsável efetivo NULL ou
  inativo é rotulado "Gestor" (mesma regra do seam).

### 3. Horas trabalhadas e valor/hora
- Fonte: `applications.worker_checkin_at` e `applications.worker_checkout_at`.
- `hours = round(extract(epoch from (checkout - checkin)) / 3600, 2)` quando ambos existem e checkout > checkin;
  senão `NULL` (nunca 0 — zero seria "trabalhou zero horas", falso). Cruza meia-noite corretamente por ser
  diferença de `timestamptz`.
- `hours_source`: `'checkin'` (medido) ou `NULL`. **Não** cair para `estimated_hours`/`work_*_time` em
  silêncio: a coluna `hours_estimated` vem separada (de `jobs.estimated_hours`) para a UI rotular.
- `checkout_confirmed` = `company_checkout_confirmed_at IS NOT NULL` (a empresa conferiu). Exibido; não filtra.
- `hourly_rate = amount / hours` quando `hours > 0`; senão `NULL`. Calculado na RPC, arredondado a 2 casas.
- `amount`: `shift_payments.amount` do marcador ativo; sem marcador, `jobs.budget` com `amount_kind='estimated'`
  (mantém a separação realizado × estimado do ADR-20260816).

### 4. Definições de status e "turno completo" (planilha)
- Linha do relatório: mesma união de hoje (marcador ativo ∪ application `hired|in_progress|completed`),
  status `aberta | agendada | paga | conciliada` (`agendada` novo: marcador `scheduled`).
- Planilha: entra só application `status='completed'` no período. Por freela, colunas separadas
  `total_paid` (marcadores `recorded`) e `total_to_pay` (sem marcador `recorded`: soma de `scheduled.amount`
  ou, sem marcador, `jobs.budget` marcado como estimado em `has_estimated_amount=true`).
  `voided` e `purged_at IS NOT NULL` são ignorados.
- Período = data local do turno (`job_local_date`, `America/Sao_Paulo`), inclusivo, sobre `jobs.start_date`
  (fallback `created_at`). `jobs.status <> 'deleted'`.

### 5. Formato de saída e limites
- `get_financial_report` devolve `jsonb`:
  `{outcome, scope:'company'|'own', truncated, rows:[...], totals:{by_worker:[...], by_day:[...], overall}}`.
  Totais calculados **no banco** sobre o conjunto inteiro filtrado (não sobre a página).
- Limites: período máximo 92 dias (`outcome='range_too_large'`); máximo 5.000 linhas, com `truncated=true`.
  Sem paginação por cursor nesta versão: 5.000 pares (turno, freela) em 92 dias cobre a Momma com folga e
  mantém os totais coerentes com o que está na tela.
- `get_payment_sheet` devolve `jsonb {outcome, rows:[{worker_id, full_name, cpf, pix_key, shifts_count,
  hours_total, hours_missing_count, total_paid, total_to_pay, has_estimated_amount, tags:[text],
  payment_ids:[uuid]}], generated_at, log_id}`. Máximo 500 freelas.
- Exportação: **CSV UTF-8 com BOM, delimitador `;`, decimal com vírgula** (padrão do `toCSV` atual; abre
  direto no Excel pt-BR). **XLSX fica fora desta entrega**: exige dependência nova (SheetJS/ExcelJS) e o
  CSV cumpre o pedido. Reabre por ADR se a contabilidade exigir.
- Proteção contra injeção de fórmula no CSV: campo que começa com `= + - @` ou tab recebe `'` na frente
  (nomes e etiquetas são texto livre).

### 6. LGPD
- CPF/PIX só em `get_payment_sheet` (Gestor). `get_financial_report` nunca os carrega.
- Tela da planilha: **mascarados** (CPF `***.456.789-**`, PIX com só o fim visível). Completos **só no arquivo
  exportado**. A RPC devolve completo (o mascaramento é UX); a fronteira de segurança é o Gestor-only.
- **Log de geração: sim.** Tabela nova `payment_sheet_exports(id, company_id, generated_by, generated_at,
  period_from, period_to, filters jsonb, workers_count)`, sem nenhum CPF/PIX nela. Escrita só pela RPC.
  RLS SELECT para `is_company_owner(company_id)`; sem policy de INSERT/UPDATE/DELETE. `ON DELETE RESTRICT`
  nas FKs (auditoria). Responde "quem extraiu CPF/PIX de quem e quando" — obrigação de controlador.
- Tipo da chave PIX: inferido no client a partir do valor (`cpf`/`cnpj`/`email`/`telefone`/`aleatoria`),
  reaproveitando `PixKeyType` de `lib/validation.ts`. Não criar coluna nesta entrega.
- Freela anonimizado (`anonymize_account`): aparece com nome anonimizado e CPF/PIX nulos; a linha segue
  existindo (o pagamento aconteceu).

### 7. Assinaturas (esboço)
```sql
CREATE OR REPLACE FUNCTION public.get_financial_report(
  p_company_id     uuid,
  p_from           date,
  p_to             date,
  p_worker_id      uuid DEFAULT NULL,
  p_responsible_id uuid DEFAULT NULL,
  p_tag_id         uuid DEFAULT NULL,
  p_status         text DEFAULT NULL   -- aberta|agendada|paga|conciliada|NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$ ... $$;
-- rows[]: job_id, job_title, job_category, job_date (date local), tag_id, tag_name,
--         responsible_id, responsible_name, worker_id, worker_name,
--         checkin_at, checkout_at, checkout_confirmed, hours, hours_estimated,
--         amount, amount_kind ('realized'|'estimated'), hourly_rate,
--         payment_id, payment_status, source, paid_at, scheduled_for, worker_confirmed_at, status

CREATE OR REPLACE FUNCTION public.get_payment_sheet(
  p_company_id     uuid,
  p_from           date,
  p_to             date,
  p_worker_id      uuid DEFAULT NULL,
  p_responsible_id uuid DEFAULT NULL,
  p_tag_id         uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''   -- VOLATILE: grava o log
AS $$ ... $$;

REVOKE ALL ON FUNCTION public.get_financial_report(uuid,date,date,uuid,uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_payment_sheet(uuid,date,date,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_report(uuid,date,date,uuid,uuid,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_sheet(uuid,date,date,uuid,uuid,uuid) TO authenticated, service_role;
```
Down: `DROP FUNCTION IF EXISTS` das duas; `payment_sheet_exports` **não** é dropada no down (auditoria).

### 8. Divisão de trabalho (paralelo, sem colisão)
Contrato congelado = este ADR seção 5 e 7. Os dois builders começam juntos.

**Builder backend (`harness-builder`):**
- NOVO `supabase/migrations/20261205000100_relatorio_financeiro_e_planilha.sql` (tabela
  `payment_sheet_exports` + RLS, as duas RPCs, GRANTs, COMMENTs apontando para este ADR, down comentado).
- NOVO `supabase/tests/relatorio_financeiro.sql` (ou o padrão de teste SQL do repo, se houver): Gestor vê
  tudo; Encarregado confirmado vê só próprios+cobertos e nenhuma chave `cpf`/`pix_key` no jsonb;
  Encarregado chamando `get_payment_sheet` → `forbidden` e nenhuma linha de log; freela → `forbidden`;
  horas NULL sem checkout; turno cruzando meia-noite; `range_too_large`.

**Builder frontend (`harness-builder` para service/tipos, `harness-frontend-builder` para telas):**
- ALTERADO `frontend/src/services/orderReportService.ts`: `getReport` passa a chamar
  `supabase.rpc('get_financial_report', ...)`; remove leitura de `workers`/`jobs`/`applications`; `toCSV`
  ganha colunas (Data, Etiqueta, Turno, Função, Responsável, Freela, Check-in, Check-out, Horas, Valor/hora,
  Valor, Tipo do valor, Forma, Status, Data Pgto, ID do pagamento) e proteção de fórmula.
- NOVO `frontend/src/services/paymentSheetService.ts`: `getPaymentSheet`, `toPaymentSheetCSV`,
  `maskCpf`, `maskPixKey`, `inferPixKeyType`.
- ALTERADO `frontend/src/types/index.ts`: `FinancialReportRow`, `FinancialReportTotals`, `PaymentSheetRow`.
- ALTERADO `frontend/src/pages/company/CompanyOrdersReport.tsx`: filtros (freela, responsável, etiqueta),
  colunas novas, totais por freela/dia vindos da RPC; responsável/filtro de responsável escondidos para o
  Encarregado; botão "Planilha de pagamento" só quando `isGestor`.
- NOVO `frontend/src/components/company/PaymentSheetModal.tsx` (prévia mascarada + exportar CSV).
- ALTERADO `frontend/src/services/orderReportService.test.ts`; NOVO `frontend/src/services/paymentSheetService.test.ts`
  (mascaramento, inferência de tipo PIX, CSV com BOM/`;`/vírgula, escape de fórmula).
- Rota: se o Encarregado ainda não alcança `CompanyOrdersReport`, ajustar a guarda em `App.tsx` (o
  frontend-reviewer e o security-reviewer entram).

Regra anti-colisão: backend toca só `supabase/**`; frontend só `frontend/**`. O frontend mocka `supabase.rpc`
nos testes contra o shape da seção 5 até a migration existir. Ordem de deploy: migration antes do frontend.

## Consequências
### Positivas
- PII com uma única porta, Gestor-only, auditada.
- Encarregado ganha relatório real (com nomes) sem afrouxar `can_view_worker_profile`.
- Totais e filtro de período corretos (no banco, data local), sem baixar a company inteira.
- Zero toque em saldo/escrow (Article 8 intacto); modo A puro.
### Negativas / Trade-offs
- RPC com shape jsonb grande vira contrato: mudar coluna exige mexer em migration + tipos à mão.
- Limite de 92 dias / 5.000 linhas pode exigir paginação no futuro.
- A RPC devolve CPF/PIX completos ao navegador do Gestor (necessário para o arquivo); o mascaramento na tela
  não é fronteira de segurança.
- Tipo de PIX inferido pode errar (telefone × CPF ambos com 11 dígitos); rotular "provável".
- Horas dependem de check-in/out do freela; turnos sem checkout aparecem com horas vazias e contagem
  `hours_missing_count`.

## Alternativas rejeitadas
- **Leitura direta de `workers`/`company_members` no client**: o Encarregado não pode ler; afrouxar a policy
  reabre DS-PII.
- **Uma RPC só com colunas de PII condicionais por papel**: um erro no ramo vaza CPF/PIX ao Encarregado.
- **Mascarar no banco e ter outra RPC para "desmascarar"**: dobra a superfície sem ganho; a autorização é a mesma.
- **XLSX agora**: dependência nova pesada para um ganho que o CSV `;` com BOM já entrega no Excel pt-BR.
- **Horas por `work_start_time`/`work_end_time`**: são o planejado, não o trabalhado; usar como fallback
  silencioso pagaria hora que não aconteceu.
- **Sem log de geração**: extração em massa de CPF/PIX sem rastro é o pior cenário LGPD do produto.

## Referências
- ADR-20260816-marcador-pagamento-por-freela.md; ADR-20261123-encarregado-confirmado-e-pii.md;
  ADR-20261123-responsavel-efetivo-derivado-no-seam.md
- `frontend/src/services/orderReportService.ts`, `frontend/src/pages/company/CompanyOrdersReport.tsx`
