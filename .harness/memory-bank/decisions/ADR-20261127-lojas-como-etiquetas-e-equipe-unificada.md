# ADR-20261127 — Lojas como etiquetas e equipe unificada (Gestor + Encarregado num convite só)

## Status
PROPOSTO (decisão de produto do dono, 27/11/2026; desenho técnico do architect aguardando aprovação do plano)

## Contexto
O dono decidiu: **não existem sublojas nem várias empresas/unidades**. Uma company, pessoas com dois papéis:
- **Gestor** (`company_members.role='manager'`, ou o dono via `companies.owner_id`): vê e faz tudo, convida, configura.
- **Encarregado** (`role='encarregado'`): vê e opera **só** os turnos dele (responsável ou cobertura).

Loja = **etiqueta** (`company_tags`) do turno, para separar fiscal/financeiro. O encarregado fica preso, por padrão,
a uma etiqueta. Todos os controles de equipe, etiquetas e papéis ficam em **Configurações**, numa tela só
("Equipe"), com um único botão "Convidar pessoa" (nome, e-mail, papel), mesmo link de uso único preso ao e-mail
do ADR-20261127-convite-encarregado-preso-ao-email (sem e-mail enviado, sem OTP).

Estado de produção conferido no catálogo em 27/11/2026 (`vrklakcbkcsonarmhqhp`, somente leitura):
- `company_members`: 2 `encarregado/invited`, 3 `encarregado/removed`; **nenhum `manager`**.
  CHECK de papel já é `('manager','encarregado')`.
- `company_tags`: 1 linha; `jobs.tag_id` preenchido: **0**. `jobs.responsible_id` preenchido: 25.
- `organizations`: 16, nenhuma com mais de uma company; `organization_members`: só `owner` (14 ativos, 2 removidos).
- **`invite_company_manager`, `accept_manager_invite` e `revoke_company_manager` (F13 Fase 3; correção de 27/11:
  o ADR citava `accept_company_invite_by_token`, que é o aceite de ELENCO do freela e NÃO é revogado)
  continuam com `EXECUTE` para `authenticated`.** O frontend do convite de gerente foi removido, mas a porta no
  banco segue aberta e cria Gestor **sem** a confirmação "é ele?". Isso é um segundo caminho para um papel de
  poder total.
- `confirm_company_member` não trata `manager` (corpo não cita o papel).
- `session_operates_company_membership` concede Gestor a qualquer `manager` ativo, **sem exigir `confirmed_at`**.

## Decisão

### D1. Etiqueta padrão do encarregado = coluna em `company_members`
`company_members.default_tag_id uuid NULL`, com FK **composta** `(company_id, default_tag_id) →
company_tags(company_id, id) ON DELETE RESTRICT` (exige `UNIQUE (company_id, id)` em `company_tags`). A FK composta
garante por construção que a etiqueta é da mesma company — sem trigger. Coluna e não tabela: v1 é **uma** loja por
encarregado; N lojas por pessoa vira tabela num ADR próprio se aparecer o caso.

### D2. Herança no INSERT do turno, no trigger que já existe
`jobs_responsible_guard` (BEFORE INSERT) ganha um passo **depois** de resolver `responsible_id`:
se `NEW.tag_id IS NULL` e o responsável é encarregado ativo com `default_tag_id` não arquivada, `NEW.tag_id :=
default_tag_id`. A herança segue o **responsável**, não quem clicou: Gestor criando turno para o encarregado também
herda. Cobre os três produtores sem tocá-los: `CompanyCreateJob`, criação em lote (`20261128000100`) e série.
Explícito vence padrão (tag informada no INSERT é respeitada, validada pelo trigger como hoje).

**Trava de loja para o encarregado:** encarregado **com** `default_tag_id` não pode gravar `tag_id` diferente dela
(INSERT ou UPDATE) — `42501`. Sem padrão definido, escolhe livremente entre as etiquetas ativas. Gestor muda
qualquer coisa. Motivo: é dimensão fiscal; quem separa a loja é o Gestor.

**"Passar para..." não muda a etiqueta.** O turno pertence à loja onde foi lançado; trocar loja é ato explícito do
Gestor (`set_job_tag`). Mudar `default_tag_id` de uma pessoa **não** reescreve turnos existentes.

### D3. Etiqueta nunca concede acesso
O seam (`session_can_operate_job`, `is_job_owner`, `is_company_owner`) **não** lê `tag_id` nem `default_tag_id`.
Dois encarregados da mesma loja não veem os turnos um do outro. Fica escrito no COMMENT da coluna e num teste
negativo de auditoria. Relatório por loja é recorte do Gestor, não regra de visibilidade.

### D4. Etiquetas em Configurações: criar, renomear, arquivar; nunca apagar
- `create_company_tag` / `archive_company_tag` existentes; **nova `rename_company_tag(p_tag_id, p_name)`**
  (Gestor-only, mesma regra de unicidade sem caixa, 1..40). O `id` é a chave fiscal; o nome é rótulo — renomear
  muda o rótulo em relatórios passados (aceito e dito na UI).
- `archive_company_tag` passa a recusar com `outcome='default_of_members'` (+ contagem) se alguma pessoa **ativa
  ou convidada** tem a etiqueta como padrão. Sem isso, a herança cairia em silêncio para "sem loja".
- Rótulo de UI: **"Lojas"**. Nome no banco segue `company_tags`.

### D5. Convite unificado: Gestor entra pelo mesmo fluxo, com confirmação obrigatória
- `invite_company_member(company, nome, papel, e-mail, default_tag_id DEFAULT NULL)`: `p_role IN ('encarregado',
  'manager')`. Convidar **Gestor** exige `is_company_owner` **confirmado** (D6). `default_tag_id` só vale para
  encarregado (para manager → `invalid_input`). Idempotência por (empresa, e-mail) passa a ser independente do papel:
  convite pendente do mesmo e-mail com **outro** papel → `already_invited_other_role` (não sobrescreve).
- `get_member_invite_preview`, `internal_team_invite_provision_check`, `accept_company_member_invite`: aceitam os
  dois papéis. Sai o ramo `use_manager_invite`. A varredura de pendente vencido (72h) e o texto do aviso passam a
  valer por papel ("entrou como Gestor — acesso total").
- **Edge Function `accept-team-invite` não muda de lógica.** Ela só provisiona conta a partir de
  `internal_team_invite_provision_check`; o papel é decidido no banco. Muda só o comentário de cabeçalho.
  Redeploy com `--no-verify-jwt` (mesmo do ADR anterior).

### D6. Gestor convidado opera ZERO até ser confirmado (mudança no seam)
`session_operates_company_membership` passa a exigir `cm.confirmed_at IS NOT NULL` para `role='manager'`. O
aceite deixa o Gestor `active` com `confirmed_at NULL`; ele vê só "Aguardando confirmação". Confirma: o **dono**
(`companies.owner_id`) **ou** outro Gestor confirmado — nunca a própria pessoa. Remover Gestor: idem; **ninguém
remove o dono** (ele não é linha de `company_members`). Mesmo prazo de 72h do encarregado.
Seguro em produção: zero `manager` hoje, ninguém perde acesso. `internal_company_gestor_ids`,
`notification_recipients_for_job`, `list_company_members` e `get_my_companies` passam a considerar só manager
confirmado (e mostrar `awaiting_confirmation` para manager).

### D7. Porta antiga fechada
`REVOKE EXECUTE ... FROM authenticated, anon, PUBLIC` em `invite_company_manager`, **`accept_manager_invite`**
e `revoke_company_manager` nesta migration; `DROP` numa migration posterior depois de um ciclo sem chamadas
(grep no frontend já limpo pelo commit 9abe877e). Um só caminho cria Gestor.
**`accept_company_invite_by_token` NÃO é revogada:** é o aceite do Elenco pelo freela (`team_connections`).
Complementos de segurança (revisão de 27/11): convite de Gestor só com conta VERIFICADA
(`internal_team_invite_provision_check` devolve `manager_requires_verified_signup` se não há conta; o aceite recusa
`email_ownership='not_verified'` e convite de Gestor sem e-mail); `company_tags_select` e `rc_select_partes_ou_gestor`
usam `is_company_member_confirmed`; `get_invite_preview` (anon) só serve token de Elenco (48 hex); a trava de loja do
encarregado vale também para a loja herdada de outro responsável; `create_company_tag` e `rename_company_tag` usam a
mesma normalização de espaços. Rollback em `supabase/migrations/_rollback/20261204000400_down.sql`.

### D8. Migração de dados
- `company_tags`: 1 linha, mantida. `jobs.tag_id`: 0 — **nenhum backfill** de turno (inventar loja de turno
  passado seria dado fiscal falso).
- `default_tag_id` nasce NULL para todos. Os 2 convites `encarregado/invited` seguem válidos (o aceite não muda
  para eles).
- Organizações: nenhuma com mais de uma company e só `owner` em `organization_members`. O ramo de organização do
  seam fica **dormente** (não removido aqui — remover mexe no par do seam e merece ADR próprio). Novo
  `organization_members.role='operator'` não deve ser criado por ninguém; a RPC que o criava é a da D7.

## SQL esboçado (migration `20261127000500_lojas_etiquetas_equipe_unificada.sql`)

```sql
-- Pré: 20261123000300..600 e 20261127000200 aplicadas. Não toca saldo (Article 8).
ALTER TABLE public.company_tags
  ADD CONSTRAINT company_tags_company_id_id_key UNIQUE (company_id, id);      -- tabela de 1 linha: lock trivial

ALTER TABLE public.company_members ADD COLUMN IF NOT EXISTS default_tag_id uuid;
ALTER TABLE public.company_members
  ADD CONSTRAINT company_members_default_tag_fk
  FOREIGN KEY (company_id, default_tag_id) REFERENCES public.company_tags (company_id, id) ON DELETE RESTRICT;
ALTER TABLE public.company_members
  ADD CONSTRAINT company_members_default_tag_role_chk
  CHECK (default_tag_id IS NULL OR role = 'encarregado');
COMMENT ON COLUMN public.company_members.default_tag_id IS
  'Loja padrão do encarregado (ADR-20261127-lojas). Herdada no INSERT de jobs. NUNCA concede acesso.';
-- escrita de default_tag_id: só via RPC (sem policy de UPDATE nova; company_members já é DEFINER-only)

-- Seam (D6)
CREATE OR REPLACE FUNCTION public.session_operates_company_membership(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND p_company_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = p_company_id AND cm.user_id = (SELECT auth.uid())
               AND cm.status = 'active' AND cm.role = 'manager'
               AND cm.confirmed_at IS NOT NULL)                         -- NOVO
    OR EXISTS (SELECT 1 FROM public.organization_members om
                 JOIN public.companies c ON c.organization_id = om.organization_id
                WHERE c.id = p_company_id AND om.user_id = (SELECT auth.uid())
                  AND om.status = 'active' AND om.role IN ('owner','operator')));
$$;
-- (preservar atributos/GRANTs vigentes — conferir no catálogo antes; is_company_owner é BEGIN ATOMIC e
--  depende desta função: CREATE OR REPLACE com mesma assinatura não quebra pg_depend)

-- Herança + trava (D2), dentro de jobs_responsible_guard, após o bloco que preenche responsible_id:
--   IF v_is_insert AND NEW.tag_id IS NULL AND NEW.responsible_id IS NOT NULL THEN
--     SELECT cm.default_tag_id INTO v_default FROM public.company_members cm
--       JOIN public.company_tags t ON t.id = cm.default_tag_id AND t.archived_at IS NULL
--      WHERE cm.company_id = NEW.company_id AND cm.user_id = NEW.responsible_id
--        AND cm.status = 'active' AND cm.role = 'encarregado';
--     IF v_default IS NOT NULL THEN NEW.tag_id := v_default; v_tag_changed := true; END IF;
--   END IF;
--   IF public.session_company_member_role(v_company) = 'encarregado' AND NOT public.is_company_owner(v_company)
--      AND v_tag_changed AND NEW.tag_id IS DISTINCT FROM (default do próprio auth.uid(), se não nulo) THEN
--     RAISE EXCEPTION 'jobs: a loja do turno é definida pelo Gestor.' USING ERRCODE = '42501';
--   END IF;
-- (a validação "tag da mesma empresa e não arquivada" existente continua depois)

-- Novas/alteradas
--   rename_company_tag(p_tag_id uuid, p_name text) -> jsonb {renamed|already_exists|not_found|forbidden|invalid_input|unauthenticated}
--   set_member_default_tag(p_member_id uuid, p_tag_id uuid) -> jsonb (Gestor-only; tag ativa da company; só encarregado)
--   archive_company_tag: + outcome 'default_of_members' (status IN ('invited','active'))
--   list_company_tags(p_company_id) já via listTags? manter; list_company_members + 'default_tag_id'
--   invite_company_member(uuid,text,text,text,uuid DEFAULT NULL): DROP da assinatura de 4 args na mesma transação
--   get_member_invite_preview / internal_team_invite_provision_check: role IN ('encarregado','manager')
--   accept_company_member_invite: sem 'use_manager_invite'; varredura 72h e aviso por papel
--   confirm_company_member / reject_company_member / remove_company_member: tratam manager; nunca self;
--     confirmar manager exige is_company_owner (que já exige manager confirmado ou dono)
--   internal_company_gestor_ids, notification_recipients_for_job, get_my_companies: manager só confirmado

REVOKE ALL ON FUNCTION public.invite_company_manager        FROM PUBLIC, anon, authenticated; -- assinatura exata do catálogo
REVOKE ALL ON FUNCTION public.accept_manager_invite(text)   FROM PUBLIC, anon, authenticated; -- NÃO accept_company_invite_by_token (Elenco)
REVOKE ALL ON FUNCTION public.revoke_company_manager        FROM PUBLIC, anon, authenticated;

-- GRANT EXECUTE TO authenticated, service_role em toda RPC nova; REVOKE de anon/PUBLIC.
-- DOWN: DROP FUNCTION rename_company_tag, set_member_default_tag; ALTER TABLE company_members DROP CONSTRAINT
--   company_members_default_tag_role_chk, company_members_default_tag_fk, DROP COLUMN default_tag_id;
--   restaurar corpos anteriores (copiar de 20261123000300/000500/000600 e 20261127000200).
--   DOWN do seam só é seguro enquanto não houver manager confirmado por este fluxo.
```

## Arquivos por builder (sem colisão)

**Backend (harness-builder):**
- `supabase/migrations/20261127000500_lojas_etiquetas_equipe_unificada.sql` (novo)
- `supabase/functions/accept-team-invite/index.ts` (só cabeçalho/comentário; redeploy)
- `supabase/tests/equipe_lojas_unificada_auditoria.sql` (novo: herança, trava, encarregado da mesma loja NÃO vê
  turno alheio, manager não confirmado opera zero, porta F13 sem EXECUTE, archive recusado)
- `frontend/src/services/teamMembersService.ts` (+ papel no convite, `default_tag_id`, `setMemberDefaultTag`, outcomes)
- `frontend/src/services/teamMembersService.test.ts`
- `frontend/src/services/shiftOperationService.ts` — **só** o bloco de tags (`renameTag`, outcome
  `default_of_members` em `TagOutcome`/`tagMessage`)
- `frontend/src/services/shiftOperationService.test.ts`
- `frontend/src/types/index.ts` (CompanyMember.default_tag_id, roles)

**Frontend (harness-frontend-builder), consome só as assinaturas acima:**
- `frontend/src/pages/company/CompanyTeamMembers.tsx` (+ `.test.tsx`): vira "Configurações → Equipe": um
  "Convidar pessoa" (nome, e-mail, papel, loja padrão se Encarregado), lista com papel, loja e estado
  (aguardando confirmação vale para Gestor também)
- `frontend/src/components/company/TagsPanel.tsx`: vira "Lojas" (criar, renomear, arquivar; sem apagar), sai da
  condição `members.length > 0`
- `frontend/src/pages/AcceptTeamInvite.tsx`: texto por papel ("como Gestor — acesso total à empresa")
- `frontend/src/pages/company/CompanyCreateJob.tsx`: seletor "Loja" pré-selecionado com a loja do encarregado e
  travado para ele
- `frontend/src/lib/navigation.ts` + `frontend/src/pages/company/CompanyGestao.tsx` (+ `.test.tsx`): card único
  "Configurações → Equipe e lojas"
- `frontend/src/App.tsx` só se a rota mudar (recomendação: manter `/company/configuracoes/equipe`, sem rota nova)

**Fora de alcance (outro fluxo):** `orderReportService*`, `CompanyOrdersReport.tsx`, RPC de relatório financeiro.
Contrato para eles: filtrar/agrupar por `jobs.tag_id` + `company_tags.name`; turno sem loja = "Sem loja".

## Consequências
### Positivas
- Um só caminho cria qualquer pessoa da equipe, com e-mail preso e confirmação humana; fecha a porta F13 aberta.
- Loja vira dimensão fiscal estável por `id`, herdada sem depender do cliente; nenhuma regra de acesso nova.
- Zero impacto em quem existe hoje (sem manager, sem tag em turno).

### Negativas / Trade-offs
- Gestor recém-aceito fica inerte até confirmação: um passo a mais para o dono.
- Seam muda (`session_operates_company_membership`): exige revisão de segurança e de todos os leitores de "manager ativo".
- Renomear loja altera o rótulo de relatórios passados.
- Uma loja padrão por encarregado; quem atende duas lojas precisa ficar sem padrão (escolha livre) ou esperar a v2.
- Ramo de organização do seam fica dormente, não removido (dívida explícita).

## Alternativas rejeitadas
- **Loja como company/unidade separada:** contradiz a decisão do dono e reabre o F13.
- **Tabela `member_tags` N:N:** sem caso real; complica a herança (qual das N?).
- **Etiqueta como filtro de visibilidade:** encarregados da mesma loja veriam turnos alheios; contraria a regra do dono.
- **Herança no cliente (`CompanyCreateJob`):** lote e série escapariam; o servidor é quem garante dado fiscal.
- **Gestor ativo sem confirmação (como na F13):** convite vazado = poder total imediato, inclusive PII e pagamento.
- **Só o dono convida Gestor:** mais seguro, mas contraria "Gestor faz tudo"; a confirmação por outro Gestor/dono
  e o aviso a todos cobrem o risco.
- **Edge Function nova para convite de Gestor:** duplicaria a provisão de conta; o papel é decisão do banco.

## Referências
- ADR-20261127-convite-encarregado-preso-ao-email.md, ADR-20261123-encarregado-confirmado-e-pii.md,
  ADR-20261123-responsavel-efetivo-derivado-no-seam.md, ADR-20260817-seam-autorizacao-empresa.md
- Migrations: 20261123000300 (seam/guard), 20261123000600 (tags), 20261127000200 (convite preso ao e-mail)
