# Gate do architect — Equipe e encarregados (23/11/2026)

Insumo obrigatório do builder e do security-reviewer. Fonte: migrations do repo + frontend lidos
em 23/11. **Repositório não é catálogo**: cada item abaixo precisa ser reconfirmado pelas consultas
da seção C antes de escrever a migration correspondente. Baseline de corpo de função = sempre
`pg_get_functiondef` do catálogo, nunca o arquivo (lição 24/08 e 20260824000200/000300).

## A. Correções na sequência E0–E3

| # | Achado | Ajuste obrigatório |
|---|---|---|
| G1 | E0 não é o único leitor de `company_members` sem filtro de papel. `get_my_companies` (cm `status='active'`, rotula como `'manager'`), `is_organization_member` (cm active → lê `organizations`) e `can_review_for_job` (20260825000400, lê `company_members` inline, ainda com `status='accepted'` — valor que nem existe no CHECK, logo o gerente hoje **não consegue avaliar**) | Em E0, endurecer **todos** os leitores de `company_members` (lista vem de C1): `role='manager'` explícito onde significa Gestor. `can_review_for_job` passa a usar `is_job_owner(p_job_id)` (corrige bug do gerente e já nasce com escopo por pessoa). `get_my_companies` ganha `role` real (`'encarregado'`), `confirmed`, `team_enabled` em E4 (E0 só filtra `role='manager'`). |
| G2 | `jobs` INSERT/UPDATE/DELETE usam `is_company_owner(company_id)` → Encarregado não cria nem edita turno. `is_job_owner(id)` dentro de policy de `jobs` lê snapshot, não `NEW` | E3: policies de `jobs` com ramo extra `session_can_operate_job(company_id, responsible_id, <data>)` sobre os valores da linha (ver ADR responsável-efetivo §2). INSERT do Encarregado exige `responsible_id = auth.uid()`. DELETE segue Gestor-only. Trigger recusa Encarregado mudar `company_id`/`responsible_id`/`series_id`. |
| G3 | `shift_payments` (sp_select/insert/update) e `service_terms` (SELECT) ancoram em `is_company_owner(company_id)`, e `enforce_shift_payment_immutability` em `is_company_owner(NEW.company_id)` | E3: trocar para `is_job_owner(job_id)`; transição `→voided` exige `is_company_owner(company_id)` **no trigger** (RLS não distingue coluna). Pré-condição: C7 = 0 linhas. |
| G4 | `count_worker_shifts_by_week` filtra `AND is_job_owner(a.job_id)` (20260817000900:245) → depois de E2 conta só os turnos do Encarregado, e a guarda F5 mente | E2 (mesma migration do seam): trocar por "mesma company do turno-âncora" via `is_company_member(...)`; resultado continua sem detalhe de turno. |
| G5 | E2 só é no-op se o ramo de responsável exigir membership `encarregado` **ativa**; o trigger R3 passa a gravar `responsible_id` em todo INSERT novo (dado muda, autorização não) | Condição de E2: ramo exige `session_company_member_role(company_id)='encarregado'`; validação só quando o valor muda e liberada para sessão nula (cron/service_role). A1 roda antes/depois com `ROLLBACK`. |
| G6 | `cm_select_self_or_operator`: Gestor `manager` (não operador de org) **não vê** a equipe; toda linha visível expõe `invite_token` | E4: listagem por RPC DEFINER `list_company_members(p_company_id)` com projeção fechada **sem token**; token devolvido só por `invite_company_member`/`resend_member_invite`. Nenhuma policy nova de SELECT em `company_members`. |
| G7 | `uq_company_members_company_user (company_id, user_id)` impede re-convidar quem foi removido; `uq_company_members_pending_email` não serve ao convite sem e-mail | E4: índice vira parcial `WHERE status <> 'removed'`; idempotência por `(company_id, lower(display_name), role) WHERE status='invited'`. |
| G8 | Tabelas novas e colunas de pessoa entram na guarda LGPD (ADR-20260822 D3): `responsibility_coverages.from_user/to_user` **escapam** do vocabulário (d); `company_members.display_name/accepted_email` são PII | E1 classifica as tabelas novas na mesma migration e estende `anonymize_account` (baseline do catálogo; replay já é seguro, 202611 > 20260821) para anular `display_name`/`accepted_email` e revogar coberturas. Nomear colunas `from_user_id`/`to_user_id` para cair no vocabulário. |

Veredito sobre reversibilidade: E0 (`CREATE OR REPLACE`), E1 (`DROP` aditivo; perde só
`responsible_id` gravado por E2, igual ao criador) e E2/E3 (restaurar corpos/policies guardados no
DOWN, na ordem `is_job_owner` → `is_company_owner` → helpers) são reversíveis **enquanto C6 mostrar
zero `encarregado`**. O ponto de não retorno continua sendo o primeiro aceite após E4.

## B. Raio de alcance verificado (tudo que decide "quem é a empresa")

Legenda: **H** = herda sozinho via `is_job_owner` (só confirmar); **M** = muda; **G** = fica
Gestor-only de propósito (declarar no COMMENT).

### Funções-seam
- M `session_operates_company_membership` (E0, `role='manager'`)
- M `is_company_owner` / `is_job_owner` (E2, par, BEGIN ATOMIC)
- M `get_my_companies` (E0 filtro; E4 papel real + `team_enabled` + `confirmed`)
- M `is_organization_member` (E0: `cm.role='manager'`, ou decidir explicitamente que Encarregado vê o nome da organização)
- novas: `session_company_member_role`, `is_company_member(_confirmed)`, `session_can_operate_job`, `notification_recipients_for_job`

### Policies
- M `jobs`: `jobs_insert_company_owner`, `jobs_update_company_owner` (G2); G `jobs_delete_company_owner`; `jobs_select_authenticated` intacta (A20)
- H `applications`: "Companies can view applications for their jobs", `applications_insert_company_invite`, "Companies can update their job application fields" (20260824000100) — mas a subquery de lista fechada em `applications_insert_company_invite` usa `tc.company_id = j2.company_id`: correto, não muda
- M `shift_payments`: `sp_select_participants`, `sp_insert_company`, `sp_update_company` (G3)
- M `service_terms`: SELECT (20260817001100:587)
- H `shift_calls` / `shift_call_targets` (insert/select, 20260817001600:234–269)
- H `shift_attendance_confirmations` SELECT
- M `team_connections`: `tc_select_participants` (+ membro confirmado), `tc_insert_company` (+ ramo membro confirmado, `invited_by`); G `tc_update_company`, `tc_delete_company`; `tc_delete_worker_pending` intacta
- M `team_lists` SELECT e `team_list_members` SELECT (+ membro confirmado); G insert/update/delete
- M `company_invite_links`: `cil_select_operator_ou_elenco` (+ membro confirmado)
- M `notifications_insert_self_or_connected` (20260825000100): ramo empresa→freela usa `is_company_owner(tc.company_id)` → **o insert best-effort do client em `shiftCallService`/`shiftInviteService` falha calado para Encarregado**. Adicionar ramo membro confirmado. Ramo freela→empresa (`tc.company_id = notifications.user_id`) prova que notificação "à empresa" vai ao uid da company, não às pessoas
- G `job_series` (todas), `worker_trainings`, `worker_certifications` (conferência), `worker_referrals`, `companies_update_operator`, `Conversation`/`Message` + `can_access_application`/`can_access_conversation` (chat fora do v1)
- M `reviews_insert_com_turno_concluido` via `can_review_for_job` (G1)
- Re-varrer em C2 as 19 policies "dívida consciente" de 20260824000300 (Conversation/Message, company_monthly_revenue, company_spend_limits, payment_methods): nenhuma pode passar a conceder a Encarregado

### Triggers / funções de regra
- H `validate_application_update` (já `is_job_owner`)
- M `enforce_shift_payment_immutability` (G3)
- M `notify_counterpart_on_application_cancel`: o ator "empresa" é `auth.uid() = v_company_id` → gerente/encarregado cancelando cai em `'system'` (notifica os dois com texto neutro). Trocar por `is_job_owner(NEW.job_id)` e destinatários por `notification_recipients_for_job`
- M destinatário "empresa" resolvido como `companies.owner_id` ou `company_id`: `claim_shift_slot` e `decline_shift_call` (corpo vigente = 20260817001600 + edições 20260824000800/000900 por replace → ler do catálogo), `respond_attendance_confirmation` (20260817000700:291), `notify_on_worker_referral` (G: indicação é Gestor), e o que C9 achar a mais
- H `cancel_shift_call`, `create_sos_call`, `sos_call_eligibility`, `request_attendance_confirmation`
- M `count_worker_shifts_by_week` (G4); M `my_link_risk_config` (20260817000900:286, ancoragem inline `c.id = auth.uid() OR c.owner_id = auth.uid()` — já quebra para gerente; ler da company corrente via seam, leitura liberada a membro, escrita Gestor)
- M `can_view_worker_profile`: ramo 2 (operacional) `is_company_owner(j.company_id)` → `is_job_owner(j.id)`; ramo 1 (elenco) fica Gestor-only (ADR elenco-unico §4)
- M `list_team_connection_cards` (+ membro confirmado; projeção inalterada)
- H/inalterada `can_view_reviews_of`, `get_profile_reviews` (Gestor-only no ramo "dono do perfil")
- G `get_company_invite_token` rotação; leitura via policy
- G `create_job_series`, `update_job_series_future`, `stop_job_series`, `enforce_training_rules`, `enforce_certification_update_scope`, `create/cancel_worker_referral`, `list_worker_referral_cards`
- M `anonymize_account` (G8); conferir `lgpd_guard_auth_user_delete` reconhece membro `encarregado`
- G `accept_manager_invite`, `invite_company_manager`, `revoke_company_manager` mantidos para convites já emitidos (filtrar `role='manager'` onde leem `company_members`)

### Frontend (procurado por predicado, não por nome)
- `services/companyScopeService.ts` `getAuthenticatedCompanyId`/`pickPrimaryCompany`/`canSeeOrganization` — papel `encarregado` e `team_enabled`
- Homônimos locais que só delegam (confirmar que continuam só delegando): `teamConnectionService.ts:79`, `teamListService.ts:65`, `certificationService.ts:77`; aliases em `jobSeriesService`, `paymentRecordService`, `shiftCallService`, `shiftInviteService`
- **Ancoragem crua remanescente** (quebra para gerente hoje e para Encarregado amanhã):
  - `services/orderReportService.ts:250` `.eq('company_id', user.id)`
  - `pages/company/CompanyCreateJob.tsx:220` `companies ... .eq('id', user.id)` (briefing padrão)
  - `pages/company/CompanyJobCandidates.tsx:423` `companies ... .eq('id', user.id)` (nome p/ WhatsApp)
  - `components/TosGateModal.tsx:36` `update companies ... .eq('id', user.id)` — para membro, TOS vai para `company_members.accepted_tos_at` (R13)
  - `services/paymentMethodService.ts:122,158` `.eq('owner_id', user.id)` — código morto (pagamento pausado); não reativar
- Listas que filtram só por `company_id` (`jobs` é `USING (true)` → Encarregado veria turnos alheios): `CompanyJobs.tsx:436`, `CompanyJobDetails.tsx:94`, `CompanyJobCandidates.tsx:409`, `CompanyDashboard.tsx:80–196`, `WorkerPublicProfile.tsx:173`, `CompanyCreateJob.tsx:237`, `operationAnalyticsService.resolveCompanyScope`. Para Encarregado: RPC/filtro por operável, nunca só `company_id`
- `ProtectedRoute.tsx`, `Sidebar.tsx`, `BottomNav`, `CompanyLayout`, `InviteToShiftModal.tsx:60`, `useTeamConnections.ts:60,85`, `ShiftCallModal`, `InviteSeriesModal`, `ReceiptView`, `RateModal`, `CompanyOperationAnalytics`, `App.tsx`

## C. Consultas read-only obrigatórias em `vrklakcbkcsonarmhqhp` (antes de E1+)

```sql
-- C1. Toda função de public que lê company_members/organization_members ou ancora empresa na mão
SELECT p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosecdef definer
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f'
   AND (strpos(pg_get_functiondef(p.oid), 'company_members') > 0
     OR strpos(pg_get_functiondef(p.oid), 'owner_id') > 0
     OR pg_get_functiondef(p.oid) ~* 'company_id\s*=\s*\(?\s*(select\s+)?auth\.uid\(\)'
     OR pg_get_functiondef(p.oid) ~* 'auth\.uid\(\)\s*\)?\s*=\s*[a-z_]*\.?company_id')
 ORDER BY 1;

-- C2. Todas as policies de public com predicado de sessão (classificar H/M/G uma a uma)
SELECT tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies WHERE schemaname = 'public'
   AND strpos(coalesce(qual,'')||coalesce(with_check,''), 'auth.uid()') > 0
    OR (schemaname = 'public' AND (strpos(coalesce(qual,'')||coalesce(with_check,''), 'is_company_owner') > 0
                                OR strpos(coalesce(qual,'')||coalesce(with_check,''), 'is_job_owner') > 0))
 ORDER BY tablename, policyname;

-- C3. Triggers de usuário e a função que executam
SELECT c.relname tabela, t.tgname, p.proname, t.tgenabled
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY 1, 2;

-- C4. Corpo vigente das peças que serão reescritas (guardar no DOWN)
SELECT p.proname, pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('is_company_owner','is_job_owner',
  'session_operates_company_membership','get_my_companies','is_organization_member','can_review_for_job',
  'can_view_worker_profile','list_team_connection_cards','enforce_shift_payment_immutability',
  'validate_application_update','notify_counterpart_on_application_cancel','claim_shift_slot',
  'decline_shift_call','respond_attendance_confirmation','count_worker_shifts_by_week',
  'my_link_risk_config','anonymize_account','lgpd_guard_auth_user_delete','get_company_invite_token');

-- C5. Constraints e índices de company_members (nome real do CHECK de role)
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.company_members'::regclass;
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='company_members';

-- C6. Estado da equipe hoje (precisa ser só 'manager'; nenhuma 'encarregado')
SELECT role, status, count(*) FROM public.company_members GROUP BY 1, 2 ORDER BY 1, 2;

-- C7. company_id denormalizado casa com o do turno? (pré-condição de G3; esperado 0 em todas)
SELECT 'shift_payments' t, count(*) FROM public.shift_payments sp JOIN public.jobs j ON j.id=sp.job_id WHERE sp.company_id IS DISTINCT FROM j.company_id
UNION ALL SELECT 'service_terms', count(*) FROM public.service_terms st JOIN public.jobs j ON j.id=st.job_id WHERE st.company_id IS DISTINCT FROM j.company_id
UNION ALL SELECT 'shift_calls', count(*) FROM public.shift_calls sc JOIN public.jobs j ON j.id=sc.job_id WHERE sc.company_id IS DISTINCT FROM j.company_id;

-- C8. Colunas de jobs (tabela sem DDL no repo): tipo de start_date e ausência de responsible_id/tag_id
SELECT attname, format_type(atttypid, atttypmod), attnotnull FROM pg_attribute
 WHERE attrelid='public.jobs'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum;

-- C9. Funções que inserem notificação (mapear destinatário "empresa")
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind='f' AND strpos(pg_get_functiondef(p.oid),'INSERT INTO public.notifications')>0 ORDER BY 1;

-- C10. Empresas onde id <> owner_id (destinatário de notificação diverge) e turnos órfãos
SELECT count(*) FILTER (WHERE owner_id IS DISTINCT FROM id) id_diferente_owner, count(*) total FROM public.companies;
SELECT count(*) FROM public.jobs j WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = j.company_id);

-- C11. Dependências registradas do par (ordem do DOWN)
SELECT pg_describe_object(classid, objid, objsubid) dependente, pg_describe_object(refclassid, refobjid, refobjsubid) depende_de
  FROM pg_depend WHERE refobjid IN ('public.is_company_owner(uuid)'::regprocedure, 'public.is_job_owner(uuid)'::regprocedure,
                                    'public.session_operates_company_membership(uuid)'::regprocedure);

-- C12. Cron que chama função com resolução de empresa
SELECT jobname, schedule, command FROM cron.job ORDER BY 1;

-- C13. Snapshot ANTES (repetir DEPOIS de cada migration; resultado tem de ser idêntico) — por conta real
BEGIN; SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}';
SELECT c.id, public.is_company_owner(c.id) FROM public.companies c;
SELECT j.id, public.is_job_owner(j.id) FROM public.jobs j WHERE j.status <> 'deleted';
SELECT * FROM public.get_my_companies();
ROLLBACK;
```
Rodar C13 para: cada dono real, o gerente de QA, uma conta de freela e uma conta de empresa sem vínculo.

## D. Condições para builder e security-reviewer
1. Nenhum predicado novo com `company_id = auth.uid()` / `owner_id = auth.uid()`; auditoria A21 com `strpos`, nunca `LIKE`.
2. Toda RPC nova DEFINER + `SET search_path=''` + `REVOKE ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated, service_role`; nenhuma aceita "por qual usuário perguntar".
3. `get_busy_workers` devolve só `worker_id`, só para ids com `team_connections` aceita na company; teste de payload (A5/A6).
4. Edições de corpo por `pg_get_functiondef` + asserção de presença do trecho antigo (padrão 20260824000200/000300).
5. CHECK de `role` alargado **por último** em E4, depois do Portão; E4 só aplica com C6 limpo e A1 idêntico.
6. Policies criadas antes de qualquer `ENABLE RLS` em tabela nova; `company_tags`/`responsibility_coverages` sem policy de DELETE nem `GRANT DELETE`.
7. Article 8: zero alteração em `wallets`, `escrow_transactions`, `wallet_transactions` e RPCs de escrow (A22).
8. Security-reviewer valida explicitamente: Encarregado não confirmado lê 0 linhas de Elenco/PII; link de Elenco legível por Encarregado (risco do ex-encarregado); `invited_by` ausente de predicados; `voided` só Gestor no trigger; sessão nula (cron) atravessa os triggers novos.
9. Ordem de deploy: migration antes do frontend (42703 derruba a query inteira).
