# F13 — Multi-unidade / gerente — DDL APROVADO (contrato do builder)

> **Este arquivo é o contrato.** O builder implementa o SQL abaixo **byte a byte**, na ordem dada,
> um arquivo por migration. Nada aqui é sugestão. Onde a spec `.harness/spec/multi-unidade/spec.md`
> divergir deste arquivo, **este arquivo vence** — as divergências estão listadas na §2 com o motivo.
>
> Veredito do gate: **APPROVED_WITH_CHANGES**.
> ADR: `.harness/memory-bank/decisions/ADR-20260818-multi-unidade-hierarquia-empresa.md`.

---

## 0. O que o builder faz, e o que NÃO faz

**Faz:** cria os 4 arquivos SQL da §5 exatamente como escritos, na ordem
`100000 → 100100 → 100200 → 100300`. Atualiza `frontend/src/types/index.ts` com os tipos da §7.
Roda `cd frontend && npm run build` + `npm run lint`.

**NÃO faz, em hipótese alguma:**

- Não toca `wallets`, `wallet_transactions`, `escrow_transactions`, nem nenhuma RPC de saldo
  (`reserve_escrow`, `release_escrow`, `refund_escrow`, `credit_deposit`, `update_wallet_balance`,
  `authorize_escrow_postpago`, `capture_escrow_postpago`, `release_hold_postpago`). **Article 8.**
- Não altera o trigger `enforce_shift_payment_immutability` nem nenhuma coluna de `shift_payments`.
- Não junta as migrations num arquivo só. As quatro fases sobem **separadas**, com o portão da §6
  entre a Fase 2 e a Fase 3.
- Não escreve o frontend da Fase 4 nesta entrega (R11/R12/R13/R16 são outra passada — a §7 só fixa
  o contrato de tipos e a assinatura da RPC que o frontend vai consumir).

---

## 1. Respostas às sete decisões

### D1 — Modelo de hierarquia: **tabela de vínculo, não `parent_company_id`**

Confirmado o modelo de três peças (`organizations` → `companies` → `company_members` /
`organization_members`). `parent_company_id` em `companies` é **rejeitado**, e não por elegância:

1. `companies.id = auth.uid()` é verdade para 100% das linhas de produção — a tabela é
   simultaneamente *unidade* e *identidade de login*. Um `parent_company_id` apontando de unidade
   para unidade obrigaria a unidade-filha a ter um `auth.users` fantasma por trás, ou a quebrar essa
   invariante — e é ela que `ProtectedRoute`, `handle_new_user`, `CompanyProfile` e
   `getAuthenticatedCompanyId()` assumem hoje.
2. Rafael toca 10 restaurantes; a entrevista descreve gerente que pode cobrir mais de uma loja.
   `parent_company_id` é 1:N de *unidade para grupo* — não modela **pessoa × unidade**, que é a
   relação de que a feature precisa. Para um gerente em duas lojas seria preciso duplicar a pessoa.
3. Convite, expiração, aceite e remoção-soft são **atributos do vínculo**, não da unidade. Numa
   coluna eles não têm onde morar.
4. Reversibilidade: `DROP TABLE company_members` apaga só o vínculo. Uma coluna de auto-referência,
   depois de povoada, exige decidir o que fazer com cada linha filha.

**Trade-off aceito:** três tabelas novas e quatro funções a mais no inventário de auditoria, contra
uma coluna. Pago de bom grado — a coluna não atende o caso real.

**Por que `organizations` existe e não bastam `company_members` com `role='operator'` por unidade:**
o sócio precisa enxergar unidades que **ainda não existem** no momento em que ele é cadastrado. Com
membership por unidade, cada loja nova exigiria lembrar de dar acesso ao sócio — e o modo de falha é
silencioso (o sócio simplesmente não vê a loja nova, exatamente a dor "abaixo do radar" que a
feature existe para curar). `organization_members` dá alcance por **pertencimento ao grupo**, não
por enumeração.

### D2 — Unificação do par `is_job_owner` / `is_company_owner`

As duas mudam na **mesma** migration (Fase 2), como o `ADR-20260817-seam-autorizacao-empresa`
exige. `is_job_owner` passa a **delegar** para `is_company_owner` com corpo `BEGIN ATOMIC`, o que
registra a dependência em `pg_depend` — `DROP FUNCTION is_company_owner` passa a falhar alto
(`2BP01`) em vez de quebrar quatro policies em runtime. Enumeração completa do alcance na §3.

### D3 — O ramo `= auth.uid()`: **eliminado, e é a única mudança não-aditiva desta feature**

Hoje `is_company_owner` tem o ramo nu `p_company_id = (SELECT auth.uid())`, que **não verifica que a
linha em `companies` existe**. Consequência: qualquer sessão autenticada — inclusive um freela — que
passe o próprio uuid recebe `true`. É o furo apontado no gate do F8. Combinado com as policies
inline de `jobs` (`company_id = auth.uid()`), um freela pode hoje **inserir um turno em nome de uma
empresa que não existe** e, a partir dele, ser `is_job_owner` daquele turno.

O ramo é substituído por um equivalente **ancorado em existência**:

```sql
EXISTS (SELECT 1 FROM public.companies c
         WHERE c.id = p_company_id
           AND (c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid())))
```

O termo `c.id = (SELECT auth.uid())` preserva as linhas legadas com `owner_id` NULL (o motivo pelo
qual o ramo nu existia — ver `20260318000000`). A **única** coisa que deixa de passar é
"`company_id = meu uid` sem linha correspondente em `companies`", que nunca é empresa legítima:
`handle_new_user` cria a linha de `companies` no mesmo instante do signup `user_type='hire'`, e quem
é freela tem linha em `workers`, não em `companies`.

**Custo de migração:** um `SELECT` de pré-voo (§6, Q0) que precisa devolver **zero linhas**. Se
devolver alguma, há dado ancorado em empresa inexistente e a Fase 2 **não sobe** até isso ser
resolvido à mão. Custo esperado: zero.

**Não fazer nada aqui não era opção:** as branches novas do multi-unidade multiplicam o furo por
oito superfícies. Fechar depois de distribuir é mais caro que fechar agora.

### D4 — Quem cria o gerente: **a conta-mãe convida; o gerente cria a própria credencial**

Convite por **token de link**, precedente `ADR-20260702-worker-join-by-invite-token`. A conta-mãe
chama `invite_company_manager(company_id, email)` e recebe um token; o link
`/convite-gerente/:token` leva o gerente a criar a **própria** conta Supabase Auth (senha dele,
e-mail dele) e só então `accept_manager_invite(token)` amarra `user_id = auth.uid()`.

**Criação direta de credencial pela empresa é rejeitada.** A empresa criaria senha para outra
pessoa; nenhuma superfície do Worki faz isso hoje (`team_connections` também é consentimento, nunca
cadastro de terceiro), e exigiria `service_role` numa Edge Function nova só para chamar
`auth.admin.createUser` — superfície privilegiada nova para resolver o que o token já resolve. O
e-mail do convite é **rótulo de conferência**, não credencial: o token é a única autoridade, e quem
aceita é quem tem o link.

**Landmine tratado (a spec não viu):** `handle_new_user` cria uma linha vazia em `companies` para
todo signup `user_type='hire'` — logo o gerente **tem sim** uma linha em `companies` com
`id = auth.uid()` e `onboarding_completed=false`, e cairia no loop de onboarding por um caminho
diferente do descrito na spec. `accept_manager_invite` remove essa casca vazia sob guardas estritas
(zero `jobs`, zero `team_connections`, zero `shift_payments`, zero `applications`,
`onboarding_completed = false`). Se as guardas não passarem, a casca fica e o seletor de unidade
(R13) resolve — nunca há perda de dado.

### D5 — Isolamento entre unidades: dois níveis, e só dois

| | Gerente (`company_members`, `status='active'`) | Sócio/operador (`organization_members`, `status='active'`) |
|---|---|---|
| Alcance | **exatamente as unidades onde tem linha ativa** | **todas** as unidades da organização, inclusive as criadas depois |
| Turnos, elenco, listas, chamados, presença, `shift_payments`, treinamentos, risco de vínculo | sim, na própria unidade | sim, em qualquer unidade da organização |
| Ler/escrever de unidade sem vínculo | **não** (0 linhas em SELECT, erro em INSERT/UPDATE) | não, fora da própria organização |
| Convidar/remover gerente | **não** | sim |
| Mudar `companies.organization_id` / `companies.owner_id` | **não** (trigger) | sim |
| Criar unidade nova na organização | não (fora de escopo v1) | sim |

O gerente da unidade A **não** vê nada da unidade B, nem sabe que ela existe: as policies de
`company_members`/`organization_members`/`organizations` só devolvem a própria linha para quem não é
operador. Analytics (F9) herda o isolamento de graça, porque toda query dele é
`.in('company_id', ids)` com `ids` vindo de `resolveCompanyScope()` → `get_my_companies()`.

### D6 — Article 8: o que muda e o que não muda

**Não muda nada de saldo.** Nenhuma tabela de carteira, nenhuma RPC atômica, nenhum `reference_id`,
nenhum trigger financeiro é tocado por nenhuma das quatro migrations. O piloto é modo A e continua
sendo.

**Muda em `shift_payments`, e só na RLS:** as três policies de empresa (`sp_select_participants`,
`sp_insert_company`, `sp_update_company`) trocam
`company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())` por
`public.is_company_owner(company_id)`. Efeitos, explicitamente:

- Gerente ativo passa a **ver, registrar, efetivar e estornar** marcador de pagamento da própria
  unidade. É o que R14 pede (a entrevista descreve a gerente operando a conta que paga).
- `recorded_by = auth.uid()` é **mantido** no `WITH CHECK` do INSERT: a auditoria passa a gravar
  **qual pessoa** registrou, não mais só "a empresa". Ganho de rastreabilidade, não perda.
- `enforce_shift_payment_immutability`, o CHECK de consistência de estado, o UNIQUE parcial
  `(job_id, worker_id) WHERE status IN ('scheduled','recorded')` e a ausência de policy de DELETE
  ficam **intocados**. Estorno continua sendo `voided`, nunca apagar.
- Empresa com `companies.owner_id` NULL passa a enxergar os próprios `shift_payments` — hoje não
  enxerga (bug latente). Widening deliberado, listado na §3.

**Risco aceito e nomeado:** um gerente pode estornar (`voided`) um marcador de pagamento da unidade
dele. É consistente com R14 e com a realidade da entrevista. Se o owner quiser restringir, é policy
separada numa iteração futura — **não invente essa restrição agora**.

### D7 — Reversibilidade: o que é aditivo e o que é definitivo

| Item | Classe | Como se desfaz |
|---|---|---|
| Fase 0 — 3 tabelas + `companies.organization_id` nullable + funções + trigger de auto-provisão | **Aditivo puro** | `DROP TRIGGER` / `DROP FUNCTION` / `DROP TABLE` / `DROP COLUMN`. Nada externo depende ainda. |
| Fase 1 — backfill 1 org por empresa + `SET NOT NULL` | **Aditivo, reversível com marcador** | Toda org criada aqui tem exatamente 1 `companies` apontando pra ela e `organization_members` só de `role='owner'`. `DROP NOT NULL` + `DELETE` guiado por esse marcador. Deixa de ser reversível no instante em que a primeira **segunda** unidade entrar numa org. |
| Fase 2 — branches novas, delegação, 15 policies migradas | **Aditivo (branches) + 1 narrowing (D3)** | `CREATE OR REPLACE` de volta às versões guardadas no bloco DOWN + `CREATE POLICY` das versões antigas, também guardadas. Não depende de dado. |
| Fase 3 — 4 RPCs | **Aditivo puro** | `DROP FUNCTION`. É a migration que *habilita* convidar, não a que convida. |
| **O primeiro `accept_manager_invite` bem-sucedido** | **DEFINITIVO** | A partir daqui existe gente operando unidade sem ser dona dela, e turnos/pagamentos/elenco criados por ela. Reverter a Fase 2 passa a **revogar acesso de gente trabalhando**, não a ser no-op. |
| **A primeira segunda unidade numa organização** | **DEFINITIVO** | O 1:1 org↔unidade acabou; o backfill não tem mais marcador para ser desfeito. |

**A linha que o projeto atravessa e não volta é a Fase 3 ligada, não a Fase 2.** Por isso o portão
da §6 fica entre elas.

---

## 2. Divergências deste contrato em relação à spec

| # | Spec diz | Contrato manda | Por quê |
|---|---|---|---|
| V1 | `company_members.user_id uuid NOT NULL` | **NULLABLE** até o aceite | No convite ainda não se sabe quem é a pessoa. `NOT NULL` torna R8 impossível. UNIQUE vira índice parcial `WHERE user_id IS NOT NULL`. |
| V2 | R2: `SET NOT NULL` e pronto | `SET NOT NULL` **só depois** do trigger de auto-provisão | `handle_new_user` faz `INSERT INTO companies (id, owner_id, email, name, onboarding_completed)` — **sem** `organization_id`. Com `NOT NULL` e sem trigger, **todo signup novo de empresa passa a falhar**. Blocker que a spec não viu. |
| V3 | R3: mantém as duas branches existentes | Branch nu `= auth.uid()` **substituída** por versão ancorada em existência | D3. |
| V4 | R7: as policies das tabelas de membership contam com a RLS delas para a função INVOKER ler a própria linha | Toda leitura de membership dentro do seam passa por **`SECURITY DEFINER` mínimo** | O desenho da spec cria recursão `company_members → is_company_owner → company_members` = `42P17` **em runtime**. §4. |
| V5 | R11: "o gerente não tem nenhuma linha em `companies`" | O gerente **tem** (casca vazia de `handle_new_user`) | D4. `accept_manager_invite` limpa sob guardas. |
| V6 | Fase 2 é "matematicamente um no-op para todo usuário existente" | **Não é.** É no-op para membership, mas **alarga** `team_connections`, `applications`, `shift_payments` para a ancoragem dupla | §3.3. Exige a conferência Q1 do portão antes de subir. |
| V7 | 5 migrations | **4** migrations SQL (a "Fase 4" é frontend, sem SQL) | Renumeração; o portão continua entre `100200` e `100300`. |

---

## 3. Alcance: as ~15 policies, uma a uma

Legenda de **"alcance aumenta hoje"** = a policy passa a devolver mais linhas **antes de existir
qualquer gerente**, só pelo efeito da ancoragem dupla / da existência exigida.

### 3.1 Herdam a mudança automaticamente (nenhuma linha de SQL nelas)

| Tabela | Policies | Via | Alcance aumenta hoje? |
|---|---|---|---|
| `shift_calls` | `shift_calls_select`, `shift_calls_insert_company` | `is_job_owner` | **Não** — já era ancoragem dupla. Perde só "turno de empresa inexistente" (D3). |
| `shift_call_targets` | `shift_call_targets_select`, `shift_call_targets_insert` | `is_job_owner` + `shift_call_job_id` | Não |
| `team_lists` | select/insert/update/delete (4) | `is_company_owner` | Só o narrowing D3; ganha membership. |
| `team_list_members` | select/insert/delete (3) | `is_company_owner` via `team_lists` | idem |
| `job_series` | select/insert/update (3) | `is_company_owner` | idem |
| `shift_attendance_confirmations` | select | `is_job_owner` | Não |
| `service_terms` | `st_select_participants` | `is_company_owner` | idem `team_lists` |
| `worker_trainings` | select/insert/update (3) | `is_company_owner` | idem `team_lists` |

RPCs que checam a função explicitamente e herdam junto: `cancel_shift_call`, `create_job_series`,
`update_job_series_future`, `stop_job_series`, `request_attendance_confirmation`, e a RPC de risco de
vínculo (`20260817000900`). **Nenhuma precisa ser reescrita** — é o dividendo do seam.

### 3.2 Migradas nesta entrega (ancoragem inline hoje)

| Tabela | Policy | Predicado hoje | Vira | Alcance aumenta hoje? |
|---|---|---|---|---|
| `team_connections` | `tc_select_participants` | só `owner_id` | `is_company_owner(company_id) OR worker_id = auth.uid()` | **SIM** — empresa com `owner_id` NULL passa a ver o próprio elenco |
| `team_connections` | `tc_insert_company` | só `owner_id` | `is_company_owner` + `status='pending'` | **SIM** |
| `team_connections` | `tc_update_company` | só `owner_id` | `is_company_owner` + guarda `status <> 'blocked'` **preservada** | **SIM** |
| `team_connections` | `tc_delete_company` | só `owner_id` + guarda de veto | `is_company_owner` + `(status <> 'blocked' OR blocked_by = auth.uid())` **preservada** | **SIM** |
| `jobs` | `jobs_insert_company_owner` | inline dupla, com o ramo nu | `is_company_owner(company_id)` | **Diminui** — fecha o furo do F8 |
| `jobs` | `jobs_update_company_owner` | inline dupla | `is_company_owner` em USING e WITH CHECK | Diminui |
| `jobs` | `jobs_delete_company_owner` | inline dupla | `is_company_owner` | Diminui |
| `applications` | `Companies can view applications for their jobs` | só `owner_id`, via `jobs` | `public.is_job_owner(job_id)` | **SIM** |
| `applications` | `applications_insert_company_invite` | só `owner_id`, via `jobs` | `is_job_owner(job_id)`, demais guardas intactas | **SIM** |
| `shift_payments` | `sp_select_participants` | só `owner_id` | `is_company_owner(company_id) OR worker_id = auth.uid()` | **SIM** |
| `shift_payments` | `sp_insert_company` | só `owner_id` | `is_company_owner` + `recorded_by = auth.uid()` **preservado** | **SIM** |
| `shift_payments` | `sp_update_company` | só `owner_id` | `is_company_owner`, transições intactas | **SIM** |
| `companies` | `Company owner can update own company` + `Companies can update own profile by id` | `owner_id` / `id` | consolidadas em `companies_update_operator` = `is_company_owner(id)` + **trigger** protegendo `owner_id`/`organization_id` | **SIM** — gerente edita a própria unidade |

`applications` — a policy de **UPDATE da empresa não existe** hoje (só
`Workers can update own applications`); as transições da empresa passam por RPC `SECURITY DEFINER` /
`service_role`. **Não crie uma.**

`companies` SELECT continua `USING (true)` — decisão preexistente, não relitigada.

### 3.3 As três policies que o widening obriga a conferir antes

`team_connections`, `applications` e `shift_payments` ancoram **só** por `owner_id` hoje. Ao passar
pela função, ganham o termo `c.id = auth.uid()`. Isso corrige um bug latente documentado desde
`20260816210000` — mas **é mudança de comportamento em produção sem nenhum gerente existir**. A
pergunta Q1 do portão (§6) mede quantas linhas mudam de mão. Se devolver 0, a Fase 2 é de fato um
no-op para o caso dominante e A1 passa trivialmente.

---

## 4. Grafo de dependências das policies novas — feito ANTES de escrever o SQL

O desenho ingênuo (e o da spec, R7) recursa:

```
policy company_members_select ──chama──> is_company_owner(company_id)
                                              │ (branch nova, INVOKER)
                                              └──lê──> public.company_members
                                                            └──avalia──> company_members_select  ✗ 42P17
```

Mesma classe de erro que `shift_calls ↔ shift_call_targets` (F1) e, como lá, **não aparece no
`CREATE POLICY`; aparece na primeira query real**. Solução idêntica ao precedente
(`is_shift_call_target`): **funções `SECURITY DEFINER` mínimas**, que respondem sempre sobre
`auth.uid()` e nunca aceitam "por qual usuário perguntar".

Grafo final, **acíclico**:

```
is_job_owner (INVOKER, ATOMIC)
   └─> is_company_owner (INVOKER, ATOMIC)
         ├─> public.companies                     [SELECT USING(true) — sem função no caminho]
         └─> session_operates_company_membership (DEFINER)  ──RLS ignorada──> company_members,
                                                                              organization_members,
                                                                              companies

policy organizations_select        ─> is_organization_member   (DEFINER) ─> organization_members
policy organization_members_select ─> is_organization_operator (DEFINER) ─> organization_members
policy company_members_select      ─> is_organization_operator(company_organization_id(company_id))
                                       └─> company_organization_id (INVOKER) ─> companies [USING(true)]

policy companies_update_operator   ─> is_company_owner ─> (acima)
                                      [companies NÃO referencia company_members em nenhuma policy]
```

Regras que sustentam o grafo, e que o builder **não pode** quebrar:

1. **Nenhuma policy de `company_members` / `organization_members` / `organizations` chama
   `is_company_owner` ou `is_job_owner`.** Elas usam só os DEFINERs mínimos e `user_id = auth.uid()`.
2. **Nenhuma policy de `companies` referencia `company_members`.** `companies` é folha do grafo.
3. Toda tabela nova nasce `NO FORCE ROW LEVEL SECURITY` — sem isso os DEFINERs (que rodam como dono
   da tabela) voltariam a ser filtrados pela RLS e o seam erraria **para menos**, em silêncio (lição
   de `20260318000000`).
4. **Ordem dentro de cada arquivo: tabelas → funções → policies → `ENABLE ROW LEVEL SECURITY`.**
   Corpo `LANGUAGE sql` é validado no `CREATE` (`check_function_bodies` ligado) mesmo escrito como
   string — foi assim que uma migration nossa chegou inaplicável em produção. Corpo `BEGIN ATOMIC` é
   validado **e** registra dependência.
5. **Tudo dentro de corpo `BEGIN ATOMIC` é schema-qualificado** (`public.`, `auth.uid()`), sem
   exceção. O corpo é resolvido para OIDs no `CREATE`; depender do `search_path` ali é a diferença
   entre uma função que funciona e uma que resolve para o objeto errado depois de um `DROP/CREATE`.
6. **Ordem das duas funções do seam dentro da Fase 2: `is_company_owner` primeiro, `is_job_owner`
   depois.** O corpo ATOMIC de `is_job_owner` só parseia se `is_company_owner` já estiver na forma
   nova. No **DOWN**, a ordem inverte: `is_job_owner` volta a corpo-string **antes** de
   `is_company_owner` ser mexida, senão a dependência registrada trava a reversão.

### 4.1 Landmines catalogados (o builder confere um a um antes de abrir PR)

| # | Landmine | Onde morde | Guarda neste contrato |
|---|---|---|---|
| LM-1 | `handle_new_user` insere `companies.name = ''` | `CHECK (length(trim(name)) > 0)` de `organizations` derruba **o signup inteiro** | fallback `'Organizacao ' || left(id::text,8)` no trigger e no backfill |
| LM-2 | `handle_new_user` não conhece `organization_id` | `SET NOT NULL` da Fase 1 quebra todo cadastro novo de empresa | trigger `trg_company_autoprovision_organization` **na Fase 0**, antes do NOT NULL |
| LM-3 | `handle_new_user` usa `ON CONFLICT (id) DO UPDATE`; `BEFORE INSERT` dispara antes da detecção do conflito | organização órfã criada no caminho de conflito | guarda `IF EXISTS (SELECT 1 FROM companies WHERE id = NEW.id) THEN RETURN NEW` |
| LM-4 | recursão de policy A→B→A | `42P17` **em runtime**, não no `CREATE` | §4: DEFINERs mínimos; nenhuma policy de membership chama `is_company_owner` |
| LM-5 | `FORCE ROW LEVEL SECURITY` em tabela nova | DEFINER volta a ser filtrado pela RLS → seam erra **para menos**, em silêncio | `NO FORCE` explícito nas três tabelas |
| LM-6 | função `LANGUAGE sql` declarada antes da tabela que lê | migration chega **inaplicável** em produção; build/lint/teste não pegam (nenhum executa SQL) | ordem fixa tabelas → funções → policies → `ENABLE RLS` |
| LM-7 | `EXECUTE` de função de trigger revogado de `authenticated` | `INSERT` da própria sessão falha ao disparar o trigger (lição `20260816201420`/`57`) | `GRANT EXECUTE` explícito nas duas funções de trigger |
| LM-8 | `company_members.user_id NOT NULL` (como a spec pede) | impossível emitir convite antes de saber quem é a pessoa | NULLABLE + `CHECK (status <> 'active' OR user_id IS NOT NULL)` + UNIQUE parcial |
| LM-9 | gerente com casca vazia em `companies` (`id = auth.uid()`) | loop de onboarding permanente por caminho diferente do que a spec previu | limpeza guardada em `accept_manager_invite` + `get_my_companies` como único resolvedor |

---

## 5. O SQL

### 5.1 `supabase/migrations/20260818100000_organizations_schema.sql` — Fase 0 (aditivo puro)

```sql
-- Migration: F13 Fase 0 — organizations / company_members / organization_members (aditivo puro)
-- File: supabase/migrations/20260818100000_organizations_schema.sql
-- Contrato: .harness/spec/multi-unidade/ddl-aprovado.md §5.1
-- ADR: .harness/memory-bank/decisions/ADR-20260818-multi-unidade-hierarquia-empresa.md
--
-- NENHUMA policy existente é tocada aqui. NENHUMA função de autorização existente é tocada aqui.
-- Esta migration pode subir em produção sozinha e ficar meses inerte sem efeito observável.
--
-- ORDEM OBRIGATÓRIA (landmine do projeto): tabelas -> funções -> policies -> ENABLE RLS.
-- Corpo LANGUAGE sql é parseado no CREATE mesmo escrito como string; função antes da tabela = a
-- migration chega inaplicável em produção e build/lint/teste não pegam (nenhum executa SQL).
--
-- Article 8: nada aqui toca wallets / escrow_transactions / wallet_transactions / shift_payments.
--
-- DOWN (rollback): bloco no final do arquivo.

-- =============================================
-- 1. TABELAS
-- =============================================

CREATE TABLE IF NOT EXISTS public.organizations (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL CHECK (length(trim(name)) > 0),
    created_by  uuid        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organizations IS
    'Grupo/rede de unidades. NAO tem owner_id: o dono/operador vive em organization_members '
    '(permite mais de um socio). Uma companies pertence a exatamente uma organization.';

-- Coluna nova em companies: NULLABLE nesta fase. SET NOT NULL so na Fase 1, DEPOIS do trigger
-- de auto-provisao (senao handle_new_user quebra todo signup novo de empresa).
ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.companies.organization_id IS
    'Organizacao (rede) a que esta unidade pertence. ON DELETE RESTRICT: organizacao nunca some '
    'por baixo de uma unidade com dado gravado. Preenchida automaticamente por '
    'trg_company_autoprovision_organization quando a linha nasce sem ela.';

CREATE INDEX IF NOT EXISTS idx_companies_organization
    ON public.companies (organization_id);

CREATE TABLE IF NOT EXISTS public.organization_members (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id         uuid,                       -- NULL ate o aceite do convite
    role            text        NOT NULL DEFAULT 'operator'
                                CHECK (role IN ('owner', 'operator')),
    status          text        NOT NULL DEFAULT 'invited'
                                CHECK (status IN ('invited', 'active', 'removed')),
    invited_email   text,
    invite_token    text,
    invited_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    accepted_at     timestamptz,
    created_by      uuid        NOT NULL,
    CONSTRAINT organization_members_active_needs_user
        CHECK (status <> 'active' OR user_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.company_members (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
    user_id         uuid,                       -- NULL ate o aceite do convite (divergencia V1)
    role            text        NOT NULL DEFAULT 'manager'
                                CHECK (role = 'manager'),
    status          text        NOT NULL DEFAULT 'invited'
                                CHECK (status IN ('invited', 'active', 'removed')),
    invited_email   text,
    invite_token    text,
    invited_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    accepted_at     timestamptz,
    created_by      uuid        NOT NULL,
    CONSTRAINT company_members_active_needs_user
        CHECK (status <> 'active' OR user_id IS NOT NULL)
);

COMMENT ON TABLE public.company_members IS
    'Vinculo pessoa x unidade (gerente). user_id NULLABLE ate o aceite: no convite ainda nao se '
    'sabe quem e a pessoa. Remocao e SOFT (status=removed), nunca DELETE — preserva a auditoria '
    'de quem operou a unidade e quando. ON DELETE RESTRICT em company_id pelo mesmo motivo.';

-- Unicidade: uma pessoa tem no maximo UMA linha por unidade (indice parcial por causa do NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members_company_user
    ON public.company_members (company_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_members_org_user
    ON public.organization_members (organization_id, user_id) WHERE user_id IS NOT NULL;

-- Um convite pendente por (unidade, e-mail) — evita fila de tokens validos para a mesma pessoa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members_pending_email
    ON public.company_members (company_id, lower(invited_email)) WHERE status = 'invited';

-- Token e credencial portadora: unico e indexado para o lookup da RPC de aceite.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members_invite_token
    ON public.company_members (invite_token) WHERE invite_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_members_invite_token
    ON public.organization_members (invite_token) WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_company_members_user_active
    ON public.company_members (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_organization_members_user_active
    ON public.organization_members (user_id) WHERE status = 'active';

-- =============================================
-- 2. FUNCOES (DEPOIS das tabelas — ver cabecalho)
-- =============================================

-- 2.1 DEFINER minimo: "sou operador ativo desta organizacao?" — sempre sobre auth.uid(), nunca
-- aceita "por qual usuario perguntar". Existe para quebrar a recursao 42P17 da policy de
-- organization_members consigo mesma (precedente: is_shift_call_target, 20260817000100).
CREATE OR REPLACE FUNCTION public.is_organization_operator(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_organization_id IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM public.organization_members om
             WHERE om.organization_id = p_organization_id
               AND om.user_id = (SELECT auth.uid())
               AND om.status  = 'active'
               AND om.role IN ('owner', 'operator')
       );
$$;

COMMENT ON FUNCTION public.is_organization_operator(uuid) IS
    'DEFINER minimo (grafo de policies aciclico, ver ddl-aprovado.md §4). Sempre sobre auth.uid(); '
    'nao aceita uid de terceiro, entao nao serve para varrer dado alheio.';

-- 2.2 DEFINER minimo: "pertenco a esta organizacao em qualquer papel ativo?" (para ver a linha
-- de organizations).
CREATE OR REPLACE FUNCTION public.is_organization_member(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_organization_id IS NOT NULL
       AND (
            EXISTS (SELECT 1 FROM public.organization_members om
                     WHERE om.organization_id = p_organization_id
                       AND om.user_id = (SELECT auth.uid())
                       AND om.status  = 'active')
         OR EXISTS (SELECT 1 FROM public.company_members cm
                      JOIN public.companies c ON c.id = cm.company_id
                     WHERE c.organization_id = p_organization_id
                       AND cm.user_id = (SELECT auth.uid())
                       AND cm.status  = 'active')
         OR EXISTS (SELECT 1 FROM public.companies c2
                     WHERE c2.organization_id = p_organization_id
                       AND (c2.owner_id = (SELECT auth.uid()) OR c2.id = (SELECT auth.uid())))
       );
$$;

-- 2.3 INVOKER: resolve a organizacao de uma unidade. NAO precisa de DEFINER — companies ja tem
-- SELECT USING(true) para authenticated (20260317160000). Manter INVOKER mantem o inventario de
-- objetos privilegiados menor (licao dos advisors 20260816201420/57).
CREATE OR REPLACE FUNCTION public.company_organization_id(p_company_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT c.organization_id FROM public.companies c WHERE c.id = p_company_id;
$$;

-- 2.4 DEFINER minimo: a branch NOVA do seam. Uma funcao so (em vez de duas) para nao dobrar o
-- custo por linha nas ~15 policies que chamam is_company_owner.
CREATE OR REPLACE FUNCTION public.session_operates_company_membership(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_company_id IS NOT NULL
       AND (
            EXISTS (
                SELECT 1 FROM public.company_members cm
                 WHERE cm.company_id = p_company_id
                   AND cm.user_id = (SELECT auth.uid())
                   AND cm.status  = 'active'
            )
         OR EXISTS (
                SELECT 1
                  FROM public.organization_members om
                  JOIN public.companies c ON c.organization_id = om.organization_id
                 WHERE c.id = p_company_id
                   AND om.user_id = (SELECT auth.uid())
                   AND om.status  = 'active'
                   AND om.role IN ('owner', 'operator')
            )
       );
$$;

COMMENT ON FUNCTION public.session_operates_company_membership(uuid) IS
    'Branch de multi-unidade do seam de autorizacao. DEFINER de proposito: se fosse INVOKER, a '
    'policy de company_members chamaria is_company_owner que chamaria esta funcao que releria '
    'company_members = recursao 42P17 EM RUNTIME (precedente shift_calls x shift_call_targets). '
    'Chamada por public.is_company_owner a partir de 20260818100200. Ver ddl-aprovado.md §4.';

-- 2.5 Auto-provisao de organizacao: sem isto, o SET NOT NULL da Fase 1 quebra handle_new_user
-- (trigger de auth.users que INSERE em companies sem organization_id) e NENHUMA empresa nova
-- consegue se cadastrar. Blocker identificado no gate — nao remover.
-- ATENCAO: organizations.name tem CHECK length(trim(name)) > 0 e companies.name NASCE COMO ''
-- em handle_new_user. Um NULLIF direto devolveria NULL e violaria o NOT NULL no primeiro signup.
-- Dai o fallback de rotulo estavel abaixo; a conta-mae renomeia depois na UI.
CREATE OR REPLACE FUNCTION public.autoprovision_company_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id uuid;
    v_name   text;
BEGIN
    IF NEW.organization_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM public.companies c WHERE c.id = NEW.id) THEN
        RETURN NEW;
    END IF;

    v_name := NULLIF(trim(COALESCE(NEW.name, '')), '');
    IF v_name IS NULL THEN
        v_name := 'Organizacao ' || left(NEW.id::text, 8);
    END IF;

    INSERT INTO public.organizations (name, created_by)
    VALUES (v_name, COALESCE(NEW.owner_id, NEW.id))
    RETURNING id INTO v_org_id;

    INSERT INTO public.organization_members
        (organization_id, user_id, role, status, accepted_at, created_by)
    VALUES
        (v_org_id, COALESCE(NEW.owner_id, NEW.id), 'owner', 'active', now(), COALESCE(NEW.owner_id, NEW.id));

    NEW.organization_id := v_org_id;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.autoprovision_company_organization() IS
    'BEFORE INSERT em companies: toda unidade nova nasce dentro de uma organizacao propria, com '
    'o dono como organization_members owner ativo. Sem isto, o SET NOT NULL da Fase 1 quebra '
    'handle_new_user e nenhum signup de empresa funciona. NAO toca saldo (Article 8).';

DROP TRIGGER IF EXISTS trg_company_autoprovision_organization ON public.companies;
CREATE TRIGGER trg_company_autoprovision_organization
    BEFORE INSERT ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.autoprovision_company_organization();

-- =============================================
-- 3. GRANTS (antes das policies, padrao do projeto)
-- =============================================
REVOKE ALL ON public.organizations        FROM anon;
REVOKE ALL ON public.organization_members FROM anon;
REVOKE ALL ON public.company_members      FROM anon;

-- Sem INSERT/UPDATE/DELETE para authenticated: toda escrita passa pelas RPCs da Fase 3.
GRANT SELECT ON public.organizations        TO authenticated;
GRANT SELECT ON public.organization_members TO authenticated;
GRANT SELECT ON public.company_members      TO authenticated;

GRANT ALL ON public.organizations        TO service_role;
GRANT ALL ON public.organization_members TO service_role;
GRANT ALL ON public.company_members      TO service_role;

REVOKE ALL ON FUNCTION public.is_organization_operator(uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_organization_member(uuid)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_organization_id(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.session_operates_company_membership(uuid)   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_organization_operator(uuid)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_organization_member(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_organization_id(uuid)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.session_operates_company_membership(uuid) TO authenticated, service_role;

-- Funcao de trigger: EXECUTE para authenticated (licao 20260816201420/57 — sem isto o INSERT
-- de companies feito pela propria sessao falha ao disparar o trigger).
REVOKE ALL ON FUNCTION public.autoprovision_company_organization() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.autoprovision_company_organization() TO authenticated, service_role;

-- =============================================
-- 4. POLICIES (antes do ENABLE RLS — landmine do harness)
-- =============================================
-- NENHUMA destas policies chama is_company_owner / is_job_owner. Ver ddl-aprovado.md §4, regra 1.

DROP POLICY IF EXISTS "organizations_select_member" ON public.organizations;
CREATE POLICY "organizations_select_member" ON public.organizations
    FOR SELECT TO authenticated
    USING (public.is_organization_member(id));

DROP POLICY IF EXISTS "om_select_self_or_operator" ON public.organization_members;
CREATE POLICY "om_select_self_or_operator" ON public.organization_members
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR public.is_organization_operator(organization_id)
    );

DROP POLICY IF EXISTS "cm_select_self_or_operator" ON public.company_members;
CREATE POLICY "cm_select_self_or_operator" ON public.company_members
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR public.is_organization_operator(public.company_organization_id(company_id))
    );

COMMENT ON POLICY "cm_select_self_or_operator" ON public.company_members IS
    'Gerente ve so a PROPRIA linha (nunca a de outro gerente, nem a existencia de outra unidade). '
    'Socio/operador ve todas as linhas das unidades da organizacao dele. NAO usa is_company_owner: '
    'isso recursaria (42P17) — ver ddl-aprovado.md §4.';

-- SEM policy de INSERT/UPDATE/DELETE em nenhuma das tres tabelas: toda transicao de estado passa
-- pelas RPCs SECURITY DEFINER da Fase 3, mantendo a maquina de estados num lugar auditavel
-- (mesmo padrao de shift_calls / shift_call_targets).

-- =============================================
-- 5. RLS (depois das policies; SEM FORCE — ver 20260318000000)
-- =============================================
ALTER TABLE public.organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.company_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members      NO FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- DOWN (rollback) — aditivo puro, nada externo depende ainda:
--   DROP TRIGGER  IF EXISTS trg_company_autoprovision_organization ON public.companies;
--   DROP FUNCTION IF EXISTS public.autoprovision_company_organization();
--   DROP FUNCTION IF EXISTS public.session_operates_company_membership(uuid);
--   DROP FUNCTION IF EXISTS public.company_organization_id(uuid);
--   DROP FUNCTION IF EXISTS public.is_organization_member(uuid);
--   DROP FUNCTION IF EXISTS public.is_organization_operator(uuid);
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS organization_id;
--   DROP TABLE IF EXISTS public.company_members;
--   DROP TABLE IF EXISTS public.organization_members;
--   DROP TABLE IF EXISTS public.organizations;
-- ATENCAO: a partir da 20260818100200, session_operates_company_membership vira dependencia
-- registrada de is_company_owner (corpo BEGIN ATOMIC) e este DROP passa a falhar com 2BP01 —
-- o que e desejado: reverta a Fase 2 primeiro.
-- ============================================================================
```

> **Nota ao builder (LM-1):** `handle_new_user` (`20260318110000`) insere `companies` com
> `name = ''`. Se o trigger de auto-provisão passar esse `''` (ou um `NULL` vindo de `NULLIF`) para
> `organizations.name`, o `CHECK length(trim(name)) > 0` derruba **o signup inteiro**. O fallback
> `'Organizacao ' || left(id::text, 8)` não é enfeite — é o que mantém o cadastro de pé.

### 5.2 `supabase/migrations/20260818100100_organizations_backfill.sql` — Fase 1

```sql
-- Migration: F13 Fase 1 — backfill de organizacoes + organization_id NOT NULL
-- File: supabase/migrations/20260818100100_organizations_backfill.sql
-- Contrato: .harness/spec/multi-unidade/ddl-aprovado.md §5.2
--
-- Efeito: toda empresa existente vira uma organizacao de UMA unidade so. O modelo multi-unidade
-- nasce sem mudar nada do que ja funciona. Virar "multi" de verdade e acao futura da conta-mae.
--
-- Marcador de reversibilidade: toda organizacao criada aqui tem EXATAMENTE 1 companies apontando
-- para ela e organization_members apenas com role='owner'. Enquanto isso for verdade, o DOWN e
-- seguro. Deixa de ser no instante em que a primeira SEGUNDA unidade entrar numa organizacao.
--
-- Idempotente: rodar duas vezes nao cria organizacao duplicada (WHERE organization_id IS NULL).
-- Article 8: nao toca saldo.

DO $$
DECLARE
    v_company RECORD;
    v_org_id  uuid;
    v_name    text;
BEGIN
    FOR v_company IN
        SELECT id, name, owner_id FROM public.companies WHERE organization_id IS NULL
    LOOP
        v_name := NULLIF(trim(COALESCE(v_company.name, '')), '');
        IF v_name IS NULL THEN
            v_name := 'Organizacao ' || left(v_company.id::text, 8);
        END IF;

        INSERT INTO public.organizations (name, created_by)
        VALUES (v_name, COALESCE(v_company.owner_id, v_company.id))
        RETURNING id INTO v_org_id;

        UPDATE public.companies
           SET organization_id = v_org_id
         WHERE id = v_company.id;

        INSERT INTO public.organization_members
            (organization_id, user_id, role, status, accepted_at, created_by)
        VALUES
            (v_org_id, COALESCE(v_company.owner_id, v_company.id), 'owner', 'active', now(),
             COALESCE(v_company.owner_id, v_company.id))
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

-- Trava: nenhuma linha pode ter sobrado sem organizacao. Falha alto se sobrou.
DO $$
DECLARE
    v_orphans bigint;
BEGIN
    SELECT count(*) INTO v_orphans FROM public.companies WHERE organization_id IS NULL;
    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'F13 Fase 1: % companies sem organization_id apos o backfill', v_orphans;
    END IF;
END $$;

-- So AGORA o NOT NULL. O trigger trg_company_autoprovision_organization (Fase 0) garante que
-- handle_new_user e o onboarding continuem funcionando dai em diante.
ALTER TABLE public.companies ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================================
-- DOWN (rollback) — SO e seguro enquanto nenhuma organizacao tiver 2+ unidades:
--   ALTER TABLE public.companies ALTER COLUMN organization_id DROP NOT NULL;
--   -- conferir o marcador antes de apagar:
--   --   SELECT organization_id, count(*) FROM public.companies
--   --    GROUP BY 1 HAVING count(*) > 1;   -- precisa devolver ZERO linhas
--   UPDATE public.companies SET organization_id = NULL;
--   DELETE FROM public.organization_members;   -- so linhas do backfill existem nesta janela
--   DELETE FROM public.organizations;
-- ============================================================================
```

### 5.3 `supabase/migrations/20260818100200_seam_multi_unidade.sql` — Fase 2 (a migration que decide)

```sql
-- Migration: F13 Fase 2 — unificacao do seam de autorizacao de empresa + alinhamento das policies
-- File: supabase/migrations/20260818100200_seam_multi_unidade.sql
-- Contrato: .harness/spec/multi-unidade/ddl-aprovado.md §5.3
-- ADR gatilho: ADR-20260817-seam-autorizacao-empresa.md, decisao 3 ("contrato de manutencao
--   conjunta": is_job_owner e is_company_owner mudam na MESMA migration). Esta e essa migration.
--
-- TRES coisas acontecem aqui, e so aqui:
--   1. is_company_owner ganha a branch de multi-unidade E perde a branch nua `= auth.uid()`
--      (que autorizava qualquer sessao a se dizer empresa passando o proprio uuid — furo do gate
--      do F8). A substituta exige que a linha em companies EXISTA.
--   2. is_job_owner passa a DELEGAR para is_company_owner com corpo BEGIN ATOMIC, registrando a
--      dependencia em pg_depend (DROP FUNCTION is_company_owner passa a falhar com 2BP01 em vez
--      de quebrar 4 policies em runtime).
--   3. As policies que ainda ancoravam inline (team_connections, jobs, applications,
--      shift_payments, companies) passam a chamar a funcao. Sem isso a autorizacao fica
--      ASSIMETRICA — o modo de falha silencioso que o ADR-20260817 nomeia.
--
-- NAO E UM NO-OP para o dado existente: team_connections, applications e shift_payments ancoram
-- hoje SO por owner_id e passam a ter tambem a ancoragem por companies.id. Rodar Q0 e Q1 do
-- portao (ddl-aprovado.md §6) ANTES de aplicar.
--
-- Article 8: nenhuma tabela de saldo, nenhuma RPC de escrow, nenhum trigger financeiro tocado.
-- shift_payments tem SO a RLS alterada; enforce_shift_payment_immutability fica intacto.
--
-- DOWN: bloco no final, com o corpo ANTERIOR das duas funcoes e das 13 policies.

-- =============================================
-- 1. O SEAM
-- =============================================

-- 1.1 is_company_owner — BEGIN ATOMIC para registrar a dependencia em
-- session_operates_company_membership (20260818100000).
CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
BEGIN ATOMIC
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_company_id IS NOT NULL
       AND (
             EXISTS (
                SELECT 1 FROM public.companies c
                 WHERE c.id = p_company_id
                   AND (c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid()))
             )
          OR public.session_operates_company_membership(p_company_id)
       );
END;

COMMENT ON FUNCTION public.is_company_owner(uuid) IS
    'A sessao atual opera esta empresa? QUATRO caminhos: (a) companies.owner_id = auth.uid(); '
    '(b) companies.id = auth.uid() (linhas legadas com owner_id NULL) — note que AMBOS exigem '
    'que a linha em companies EXISTA: a branch nua `p_company_id = auth.uid()` foi REMOVIDA em '
    '20260818100200 porque autorizava qualquer sessao a se dizer empresa passando o proprio uuid '
    '(furo do gate do F8); (c) company_members ativo (gerente da unidade); (d) organization_members '
    'ativo owner/operator da organizacao dona da unidade (socio ve toda a rede). (c)/(d) via '
    'session_operates_company_membership (DEFINER, evita recursao 42P17). PAR de is_job_owner, que '
    'DELEGA para esta desde 20260818100200 — as duas mudam juntas, sempre. '
    'Ver ADR-20260818-multi-unidade-hierarquia-empresa.md.';

-- 1.2 is_job_owner — delega. BEGIN ATOMIC: o corpo e parseado no CREATE e a dependencia fica
-- registrada (o que o ADR-20260817 decisao 2 adiou explicitamente para este momento).
CREATE OR REPLACE FUNCTION public.is_job_owner(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
BEGIN ATOMIC
    SELECT EXISTS (
        SELECT 1 FROM public.jobs j
         WHERE j.id = p_job_id
           AND public.is_company_owner(j.company_id)
    );
END;

COMMENT ON FUNCTION public.is_job_owner(uuid) IS
    'A sessao atual opera este turno? DELEGA para public.is_company_owner(jobs.company_id) desde '
    '20260818100200 — a ancoragem deixou de ser reimplementada aqui. Corpo BEGIN ATOMIC de '
    'proposito: registra dependencia em pg_depend, entao DROP FUNCTION is_company_owner falha alto '
    '(2BP01) em vez de quebrar as policies de shift_calls/shift_call_targets em runtime.';

-- =============================================
-- 2. companies — UPDATE pelo operador da unidade + protecao das colunas de hierarquia
-- =============================================
-- Consolida as duas policies de UPDATE (owner_id, 20260317160000; id, 20260318000000) numa so.
DROP POLICY IF EXISTS "Company owner can update own company"   ON public.companies;
DROP POLICY IF EXISTS "Companies can update own profile by id" ON public.companies;
DROP POLICY IF EXISTS "companies_update_operator"              ON public.companies;
CREATE POLICY "companies_update_operator" ON public.companies
    FOR UPDATE TO authenticated
    USING (public.is_company_owner(id))
    WITH CHECK (public.is_company_owner(id));

-- RLS nao restringe COLUNA. A protecao de owner_id/organization_id e por trigger.
CREATE OR REPLACE FUNCTION public.enforce_company_hierarchy_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Sem sessao (service_role, cron, migration) => nao interfere.
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
        IF NOT public.is_organization_operator(OLD.organization_id) THEN
            RAISE EXCEPTION
                'Apenas socio/operador da organizacao pode alterar owner_id ou organization_id da unidade'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_company_hierarchy_immutability() IS
    'Gerente (company_members ativo) edita a unidade dele (briefing, endereco) mas NAO pode '
    'mover a unidade de organizacao nem trocar o dono. RLS nao restringe coluna; por isso trigger. '
    'Nao toca saldo (Article 8).';

DROP TRIGGER IF EXISTS trg_enforce_company_hierarchy_immutability ON public.companies;
CREATE TRIGGER trg_enforce_company_hierarchy_immutability
    BEFORE UPDATE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.enforce_company_hierarchy_immutability();

REVOKE ALL ON FUNCTION public.enforce_company_hierarchy_immutability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_company_hierarchy_immutability() TO authenticated, service_role;

-- =============================================
-- 3. jobs — 3 policies inline -> is_company_owner (fecha o furo do F8)
-- =============================================
DROP POLICY IF EXISTS "jobs_insert_company_owner" ON public.jobs;
CREATE POLICY "jobs_insert_company_owner" ON public.jobs
    FOR INSERT TO authenticated
    WITH CHECK (public.is_company_owner(company_id));

DROP POLICY IF EXISTS "jobs_update_company_owner" ON public.jobs;
CREATE POLICY "jobs_update_company_owner" ON public.jobs
    FOR UPDATE TO authenticated
    USING (public.is_company_owner(company_id))
    WITH CHECK (public.is_company_owner(company_id));

DROP POLICY IF EXISTS "jobs_delete_company_owner" ON public.jobs;
CREATE POLICY "jobs_delete_company_owner" ON public.jobs
    FOR DELETE TO authenticated
    USING (public.is_company_owner(company_id));

-- jobs_select_authenticated (USING true) NAO muda — decisao preexistente (20260816210000).

-- =============================================
-- 4. team_connections — 4 policies de empresa; guardas de veto do freela PRESERVADAS
-- =============================================
DROP POLICY IF EXISTS "tc_select_participants" ON public.team_connections;
CREATE POLICY "tc_select_participants" ON public.team_connections
    FOR SELECT TO authenticated
    USING (
        public.is_company_owner(company_id)
        OR worker_id = (SELECT auth.uid())
    );

DROP POLICY IF EXISTS "tc_insert_company" ON public.team_connections;
CREATE POLICY "tc_insert_company" ON public.team_connections
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_company_owner(company_id)
        AND status = 'pending'
    );

DROP POLICY IF EXISTS "tc_update_company" ON public.team_connections;
CREATE POLICY "tc_update_company" ON public.team_connections
    FOR UPDATE TO authenticated
    USING (
        public.is_company_owner(company_id)
        AND status <> 'blocked'
    )
    WITH CHECK (
        public.is_company_owner(company_id)
        AND status IN ('pending', 'blocked')
    );

-- Veto do freela indelevel para a empresa (20260816000000) — regra INALTERADA.
DROP POLICY IF EXISTS "tc_delete_company" ON public.team_connections;
CREATE POLICY "tc_delete_company" ON public.team_connections
    FOR DELETE TO authenticated
    USING (
        public.is_company_owner(company_id)
        AND (status <> 'blocked' OR blocked_by = (SELECT auth.uid()))
    );

-- tc_update_worker NAO muda (lado do freela).

-- =============================================
-- 5. applications — SELECT e INSERT da empresa -> is_job_owner
-- =============================================
DROP POLICY IF EXISTS "Companies can view applications for their jobs" ON public.applications;
CREATE POLICY "Companies can view applications for their jobs"
ON public.applications FOR SELECT TO authenticated
USING (public.is_job_owner(job_id));

-- Guardas de lista fechada e de estado de convite INALTERADAS (20260622000100).
DROP POLICY IF EXISTS "applications_insert_company_invite" ON public.applications;
CREATE POLICY "applications_insert_company_invite" ON public.applications
    FOR INSERT TO authenticated
    WITH CHECK (
        status = 'invited'
        AND invited_by_company_at IS NOT NULL
        AND public.is_job_owner(job_id)
        AND EXISTS (
            SELECT 1
              FROM public.team_connections tc
              JOIN public.jobs j2 ON j2.id = applications.job_id
             WHERE tc.worker_id  = applications.worker_id
               AND tc.company_id = j2.company_id
               AND tc.status     = 'accepted'
        )
    );

-- "Workers can insert applications" e "Workers can update own applications" NAO mudam.
-- NAO existe policy de UPDATE da empresa em applications, e NAO se cria uma aqui: as transicoes
-- da empresa passam por RPC SECURITY DEFINER / service_role.

-- =============================================
-- 6. shift_payments — SO a RLS. Trigger de imutabilidade e colunas INTOCADOS (Article 8).
-- =============================================
DROP POLICY IF EXISTS "sp_select_participants" ON public.shift_payments;
CREATE POLICY "sp_select_participants" ON public.shift_payments
    FOR SELECT TO authenticated
    USING (
        public.is_company_owner(company_id)
        OR worker_id = (SELECT auth.uid())
    );

DROP POLICY IF EXISTS "sp_insert_company" ON public.shift_payments;
CREATE POLICY "sp_insert_company" ON public.shift_payments
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_company_owner(company_id)
        AND recorded_by = (SELECT auth.uid())     -- passa a gravar QUAL pessoa registrou
        AND status IN ('scheduled', 'recorded')
        AND worker_confirmed_at IS NULL
        AND voided_at IS NULL
        AND void_reason IS NULL
    );

DROP POLICY IF EXISTS "sp_update_company" ON public.shift_payments;
CREATE POLICY "sp_update_company" ON public.shift_payments
    FOR UPDATE TO authenticated
    USING (
        public.is_company_owner(company_id)
        AND status IN ('scheduled', 'recorded')
    )
    WITH CHECK (
        public.is_company_owner(company_id)
        AND status IN ('scheduled', 'recorded', 'voided')
    );

-- sp_update_worker NAO muda. Continua SEM policy de DELETE (auditoria nao se apaga).

-- ============================================================================
-- DOWN (rollback) — nao depende de dado; seguro enquanto nao houver company_members ativo:
--
--   -- 1. Seam de volta (corpo string, sem dependencia registrada — como era):
--   CREATE OR REPLACE FUNCTION public.is_job_owner(p_job_id uuid)
--   RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
--   AS $f$
--       SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id
--         AND (j.company_id = (SELECT auth.uid())
--              OR j.company_id IN (SELECT c.id FROM public.companies c
--                                   WHERE c.owner_id = (SELECT auth.uid()))));
--   $f$;
--   CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid)
--   RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
--   AS $f$
--       SELECT (SELECT auth.uid()) IS NOT NULL AND p_company_id IS NOT NULL
--          AND (p_company_id = (SELECT auth.uid())
--               OR EXISTS (SELECT 1 FROM public.companies c
--                           WHERE c.id = p_company_id AND c.owner_id = (SELECT auth.uid())));
--   $f$;
--   (nesta ordem: is_job_owner PRIMEIRO, para soltar a dependencia registrada.)
--
--   -- 2. Trigger de hierarquia:
--   DROP TRIGGER  IF EXISTS trg_enforce_company_hierarchy_immutability ON public.companies;
--   DROP FUNCTION IF EXISTS public.enforce_company_hierarchy_immutability();
--
--   -- 3. Policies: recriar as versoes de 20260317160000 / 20260318000000 (companies),
--   --    20260816210000 (jobs), 20260622000000 + 20260816000000 (team_connections),
--   --    20260317160000 + 20260622000100 (applications), 20260712000000 (shift_payments).
--   --    Todas ancoradas em `company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())`.
-- ============================================================================
```

### 5.4 `supabase/migrations/20260818100300_manager_invite_rpcs.sql` — Fase 3

```sql
-- Migration: F13 Fase 3 — RPCs de convite/remocao de gerente e leitura de unidades
-- File: supabase/migrations/20260818100300_manager_invite_rpcs.sql
-- Contrato: .harness/spec/multi-unidade/ddl-aprovado.md §5.4
--
-- Esta e a migration que HABILITA convidar. Enquanto ela nao subir, a Fase 2 e observavelmente
-- um no-op de membership (as duas tabelas ficam vazias). Aplicar SO depois do portao (§6).
--
-- Padrao: toda RPC SECURITY DEFINER + SET search_path = '' + REVOKE PUBLIC/anon + GRANT explicito.
-- Nenhuma delas aceita "por qual usuario perguntar" a nao ser onde a autorizacao ja foi checada.
-- Article 8: nao toca saldo.

-- =============================================
-- 1. Gerador de token (sem dependencia de extensao)
-- =============================================
CREATE OR REPLACE FUNCTION public.generate_invite_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
    SELECT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- =============================================
-- 2. invite_company_manager — so socio/operador da organizacao convida
-- =============================================
CREATE OR REPLACE FUNCTION public.invite_company_manager(p_company_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid   uuid := auth.uid();
    v_org   uuid;
    v_token text;
    v_id    uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR NULLIF(trim(COALESCE(p_email, '')), '') IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT c.organization_id INTO v_org FROM public.companies c WHERE c.id = p_company_id;
    IF v_org IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Gerente NAO convida gerente: exige organization_members owner/operator.
    IF NOT public.is_organization_operator(v_org) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Convite pendente para o mesmo e-mail nesta unidade: devolve o token existente
    -- (idempotente; nao empilha tokens validos para a mesma pessoa).
    SELECT cm.id, cm.invite_token INTO v_id, v_token
      FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'invited'
       AND lower(cm.invited_email) = lower(trim(p_email))
       AND cm.expires_at > now();
    IF v_id IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_invited',
                                  'member_id', v_id, 'invite_token', v_token);
    END IF;

    -- Convite vencido para o mesmo e-mail: marca como removido e emite um novo.
    UPDATE public.company_members
       SET status = 'removed'
     WHERE company_id = p_company_id
       AND status = 'invited'
       AND lower(invited_email) = lower(trim(p_email));

    v_token := public.generate_invite_token();

    INSERT INTO public.company_members
        (company_id, user_id, role, status, invited_email, invite_token, expires_at, created_by)
    VALUES
        (p_company_id, NULL, 'manager', 'invited', lower(trim(p_email)), v_token,
         now() + interval '7 days', v_uid)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('outcome', 'invited', 'member_id', v_id, 'invite_token', v_token);
END;
$$;

-- =============================================
-- 3. accept_manager_invite — o gerente ja autenticado amarra o proprio user_id
-- =============================================
CREATE OR REPLACE FUNCTION public.accept_manager_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_row public.company_members;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF NULLIF(trim(COALESCE(p_token, '')), '') IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.invite_token = trim(p_token)
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Idempotencia: mesmo usuario reaceitando o proprio convite.
    IF v_row.status = 'active' AND v_row.user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_row.id);
    END IF;
    -- NUNCA aceitar em silencio um token ja usado por outra pessoa.
    IF v_row.user_id IS NOT NULL AND v_row.user_id <> v_uid THEN
        RETURN jsonb_build_object('outcome', 'token_already_used');
    END IF;
    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;
    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;
    -- Isolamento de papel (Article 1): quem tem perfil de freela nao vira gerente.
    IF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_uid) THEN
        RETURN jsonb_build_object('outcome', 'worker_cannot_be_manager');
    END IF;

    UPDATE public.company_members
       SET user_id      = v_uid,
           status       = 'active',
           accepted_at  = now(),
           invite_token = NULL          -- token queima no uso
     WHERE id = v_row.id;

    -- Limpeza da CASCA de companies criada por handle_new_user para o signup user_type='hire'.
    -- Sem isto o gerente carrega uma "empresa" fantasma com onboarding_completed=false e volta
    -- ao loop de onboarding por outro caminho (ver ddl-aprovado.md D4).
    -- Guardas estritas: so remove se estiver COMPLETAMENTE vazia.
    DELETE FROM public.companies c
     WHERE c.id = v_uid
       AND COALESCE(c.onboarding_completed, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.jobs             j  WHERE j.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.team_connections tc WHERE tc.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.shift_payments   sp WHERE sp.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_members  cm WHERE cm.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.team_lists       tl WHERE tl.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.job_series       js WHERE js.company_id = c.id);

    RETURN jsonb_build_object('outcome', 'accepted',
                              'company_id', v_row.company_id, 'member_id', v_row.id);
END;
$$;

-- =============================================
-- 4. revoke_company_manager — remocao SOFT
-- =============================================
CREATE OR REPLACE FUNCTION public.revoke_company_manager(p_company_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_org uuid;
    v_n   integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    SELECT c.organization_id INTO v_org FROM public.companies c WHERE c.id = p_company_id;
    IF v_org IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_organization_operator(v_org) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    UPDATE public.company_members
       SET status = 'removed', invite_token = NULL
     WHERE company_id = p_company_id
       AND (user_id = p_user_id OR (p_user_id IS NULL AND user_id IS NULL))
       AND status IN ('invited', 'active');
    GET DIAGNOSTICS v_n = ROW_COUNT;

    -- NUNCA DELETE: o historico de quem operou a unidade e quando fica. jobs / team_connections /
    -- shift_payments criados pelo gerente continuam pertencendo a UNIDADE, intocados.
    RETURN jsonb_build_object('outcome', CASE WHEN v_n > 0 THEN 'revoked' ELSE 'not_found' END,
                              'affected', v_n);
END;
$$;

-- =============================================
-- 5. get_my_companies — o unico ponto de resolucao de escopo do frontend
-- =============================================
CREATE OR REPLACE FUNCTION public.get_my_companies()
RETURNS TABLE (
    company_id           uuid,
    company_name         text,
    role                 text,
    organization_id      uuid,
    organization_name    text,
    onboarding_completed boolean,
    accepted_tos         boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT c.id,
           c.name,
           CASE
               WHEN c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid()) THEN 'owner'
               WHEN EXISTS (SELECT 1 FROM public.organization_members om
                             WHERE om.organization_id = c.organization_id
                               AND om.user_id = (SELECT auth.uid())
                               AND om.status = 'active') THEN 'operator'
               ELSE 'manager'
           END AS role,
           c.organization_id,
           o.name,
           COALESCE(c.onboarding_completed, false),
           COALESCE(c.accepted_tos, false)
      FROM public.companies c
      LEFT JOIN public.organizations o ON o.id = c.organization_id
     WHERE (SELECT auth.uid()) IS NOT NULL
       AND (
             c.owner_id = (SELECT auth.uid())
          OR c.id = (SELECT auth.uid())
          OR EXISTS (SELECT 1 FROM public.company_members cm
                      WHERE cm.company_id = c.id
                        AND cm.user_id = (SELECT auth.uid())
                        AND cm.status = 'active')
          OR EXISTS (SELECT 1 FROM public.organization_members om2
                      WHERE om2.organization_id = c.organization_id
                        AND om2.user_id = (SELECT auth.uid())
                        AND om2.status = 'active'
                        AND om2.role IN ('owner', 'operator'))
       )
     ORDER BY 3, 2;
$$;

COMMENT ON FUNCTION public.get_my_companies() IS
    'Toda unidade que a SESSAO opera, com o papel efetivo. SEMPRE sobre auth.uid() — nunca recebe '
    'uid como parametro. E o unico ponto de resolucao de escopo de empresa do frontend: '
    'teamConnectionService.getAuthenticatedCompanyId(), CompanyProfile e '
    'operationAnalyticsService.resolveCompanyScope() consomem esta RPC. DEFINER porque precisa '
    'enxergar companies alem do que a RLS do invoker mostraria em cenarios futuros; nao expoe nada '
    'que a sessao nao pudesse ler (companies tem SELECT USING(true)).';

-- =============================================
-- 6. GRANTS
-- =============================================
REVOKE ALL ON FUNCTION public.generate_invite_token()                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invite_company_manager(uuid, text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_manager_invite(text)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_company_manager(uuid, uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_companies()                          FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.generate_invite_token()            TO service_role;
GRANT EXECUTE ON FUNCTION public.invite_company_manager(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_manager_invite(text)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_company_manager(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_companies()                 TO authenticated, service_role;

-- ============================================================================
-- DOWN (rollback) — aditivo puro; ninguem foi convidado ainda no momento em que sobe:
--   DROP FUNCTION IF EXISTS public.get_my_companies();
--   DROP FUNCTION IF EXISTS public.revoke_company_manager(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.accept_manager_invite(text);
--   DROP FUNCTION IF EXISTS public.invite_company_manager(uuid, text);
--   DROP FUNCTION IF EXISTS public.generate_invite_token();
-- ============================================================================
```

---

## 6. O portão — queries read-only, entre a Fase 2 e a Fase 3

`Q0` e `Q1` rodam **antes** de aplicar a Fase 2. `Q2`–`Q6` rodam **depois**, contra dados reais, e
todas precisam bater antes de a Fase 3 subir.

```sql
-- Q0 (PRE-VOO, BLOQUEANTE) — dado ancorado em empresa que nao existe.
-- Se qualquer contagem for > 0, a Fase 2 NAO sobe: o narrowing de D3 tiraria acesso de alguem.
SELECT 'jobs'             AS t, count(*) FROM public.jobs j
  WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = j.company_id)
UNION ALL SELECT 'team_connections', count(*) FROM public.team_connections tc
  WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = tc.company_id)
UNION ALL SELECT 'shift_payments', count(*) FROM public.shift_payments sp
  WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = sp.company_id)
UNION ALL SELECT 'team_lists', count(*) FROM public.team_lists tl
  WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = tl.company_id)
UNION ALL SELECT 'job_series', count(*) FROM public.job_series js
  WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = js.company_id);

-- Q1 (PRE-VOO) — quanto o widening de team_connections/applications/shift_payments custa.
-- Zero linhas => a Fase 2 e de fato no-op para o caso dominante e A1 passa trivialmente.
SELECT count(*) AS empresas_que_ganham_alcance
  FROM public.companies c
 WHERE c.owner_id IS NULL OR c.owner_id <> c.id;

-- Q2 (POS, = A1) — regressao zero para a conta legada dominante.
-- Rodar como a sessao da empresa real (JWT dela), nao como postgres:
SELECT public.is_company_owner('<company_id real>'::uuid);   -- esperado: true

-- Q3 (POS, = A6) — nenhuma policy ficou para tras com a ancoragem antiga.
SELECT schemaname, tablename, policyname,
       pg_get_expr(pol.polqual,      pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
  FROM pg_policies p
  JOIN pg_policy   pol ON pol.polname = p.policyname
  JOIN pg_class    cl  ON cl.oid = pol.polrelid AND cl.relname = p.tablename
 WHERE p.schemaname = 'public'
   AND p.tablename IN ('companies','jobs','applications','team_connections','shift_payments',
                       'shift_calls','shift_call_targets','team_lists','team_list_members',
                       'job_series','shift_attendance_confirmations','service_terms',
                       'worker_trainings','organizations','organization_members','company_members')
 ORDER BY p.tablename, p.policyname;
-- Criterio: nenhuma linha de empresa contem a string 'owner_id' inline. Toda autorizacao de
-- empresa aparece como is_company_owner / is_job_owner / is_organization_operator.

-- Q4 (POS, = A11) — a dependencia do par ficou registrada.
DROP FUNCTION public.is_company_owner(uuid);   -- esperado: ERRO 2BP01 (nao execute em prod fora
                                               -- de uma transacao com ROLLBACK)

-- Q5 (POS) — nenhuma empresa ficou sem organizacao e nenhuma organizacao nasceu com 2 unidades.
SELECT count(*) FROM public.companies WHERE organization_id IS NULL;      -- esperado: 0
SELECT organization_id, count(*) FROM public.companies
 GROUP BY 1 HAVING count(*) > 1;                                          -- esperado: 0 linhas

-- Q6 (POS) — signup novo de empresa continua funcionando (o blocker V2).
-- Criar uma conta de teste user_type='hire' em STAGING e conferir a linha dela pelo uid:
SELECT id, name, organization_id FROM public.companies WHERE id = '<uid da conta de teste>'::uuid;
--   organization_id NAO pode ser NULL, e organizations tem que ter a linha correspondente com
--   organization_members role='owner' status='active' para o mesmo uid.
```

**A Fase 3 só sobe se Q0 = 0 em todas as linhas, Q2 = true, Q3 limpo, Q4 = erro, Q5 = 0/0, Q6 com
organização preenchida.** Q1 > 0 não bloqueia, mas exige conferir com o owner quais contas passam a
enxergar o que não enxergavam.

---

## 7. Contrato para o frontend (Fase 4 — outra entrega, fixado aqui)

`frontend/src/types/index.ts` (à mão, Article 2):

```ts
export type CompanyRole = 'owner' | 'operator' | 'manager';

export interface MyCompany {
  company_id: string;
  company_name: string | null;
  role: CompanyRole;
  organization_id: string;
  organization_name: string | null;
  onboarding_completed: boolean;
  accepted_tos: boolean;
}
```

Regras não-negociáveis da Fase 4:

1. `get_my_companies()` é o **único** resolvedor de escopo de empresa do frontend.
   `teamConnectionService.getAuthenticatedCompanyId()`, `CompanyProfile.tsx` e
   `operationAnalyticsService.resolveCompanyScope()` (F9, D5.1 do PRD de `analytics-operacao`)
   passam a consumir esta RPC. `resolveCompanyScope()` continua sendo o único ponto do frontend a
   mudar — o contrato do F9 **não é invalidado**, é cumprido: ele passa a devolver N ids em vez de
   1–2, e `.in(...)` continua obrigatório.
2. `ProtectedRoute.tsx` resolve "esta sessão é empresa e está pronta?" por
   `get_my_companies()`: **zero linhas** → onboarding; **uma ou mais** → usa `onboarding_completed`
   e `accepted_tos` da linha corrente (a de `role='owner'` primeiro, senão a primeira). Nunca mais
   `.eq('id', authUser.id).single()`.
3. `/company/organization` só é acessível a `role IN ('owner','operator')` — mesma técnica de
   `roleRedirect` do bloqueio worker⇎company.
4. Seletor de unidade aparece **só** quando `get_my_companies()` devolve mais de uma linha. Para
   100% das contas de hoje (uma linha), zero mudança visual.

---

## 8. O que este gate NÃO decidiu, e precisa do humano

- **A pergunta literal do owner** ("subcontas abaixo da empresa-topo, ou gerentes criam contas
  individuais?") tem como recomendação deste gate: **conta individual do gerente, vinculada por
  convite** (D4). O trade-off em uma frase: *a empresa-topo perde o controle de criar/resetar a
  senha do gerente (fica com o suporte do Worki e com o próprio gerente), e ganha que o vínculo é
  consentido, auditável, revogável em soft-delete, e que a saída do gerente não leva o Elenco
  junto.* A alternativa (empresa cria a credencial) só volta à mesa se o owner disser que a rede
  quer rotatividade de gerente sem passar por e-mail de cada pessoa — e aí exige Edge Function com
  `service_role` chamando `auth.admin.createUser`, superfície privilegiada nova.
- **Gerente pode estornar pagamento?** Este contrato diz sim (D6), seguindo R14. Se o owner quiser
  não, é policy separada — não improvisar.
- **Diferenciação `owner` vs `operator`** continua sem comportamento distinto (v1), só schema.
