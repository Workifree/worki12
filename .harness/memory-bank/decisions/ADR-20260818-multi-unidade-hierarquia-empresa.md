# ADR-20260818 — Multi-unidade: hierarquia de contas, unificação do seam e fim do ramo `= auth.uid()`

## Status

ACEITO (2026-08-18) — gate `harness-architect` da feature F13 (`.harness/spec/multi-unidade/spec.md`).
Contrato executável: `.harness/spec/multi-unidade/ddl-aprovado.md`.
**Substitui a decisão 2 do `ADR-20260817-seam-autorizacao-empresa.md`** (que adiava a delegação de
`is_job_owner`) e **cumpre a decisão 3 do mesmo ADR** (contrato de manutenção conjunta do par).

Duas questões seguem **abertas para o owner** e estão marcadas como tal na §8 do contrato: se a
empresa-topo deve poder criar credencial de gerente (este ADR recomenda que não), e se o gerente
deve poder estornar marcador de pagamento (este ADR diz que sim, seguindo R14).

## Contexto

Entrevista de 17/08/2026, sócio de unidades Divino Fogão em Brasília; o sócio-operador Rafael
Barbugiani toca 10 restaurantes no Centro-Oeste. *"Quem faz a seleção dos freelancers são os
gerentes de loja... isso fica um pouco abaixo do radar do sócio operador."* Quem opera o dia a dia é
o gerente; quem precisa de visibilidade é o sócio. O Worki hoje não tem nem um nem outro: modela
`companies` como **unidade e conta ao mesmo tempo**, com `companies.id = companies.owner_id =
auth.uid()` para 100% das linhas em produção. Não existe operador distinto do login.

O raio de alcance é o maior do projeto: **duas funções-costura** (`is_job_owner`, `is_company_owner`),
**~15 policies** em nove tabelas ancoradas em empresa, seis RPCs que checam a autorização
explicitamente, e o mecanismo pelo qual `ProtectedRoute` decide "esta sessão é uma empresa?".

Três coisas foram descobertas neste gate e não estavam em nenhum documento anterior:

1. **`handle_new_user` insere em `companies` sem `organization_id`.** A migration de backfill da
   spec (`ALTER COLUMN organization_id SET NOT NULL`) quebraria **todo cadastro novo de empresa**,
   no trigger de `auth.users` — falha no signup, não numa tela.
2. **O gerente *tem* linha em `companies`.** A spec afirma que não tem (e constrói R11 em cima
   disso). `handle_new_user` cria uma casca vazia para todo signup `user_type='hire'`, então o loop
   de onboarding existe, mas por outro caminho — e o fix proposto pela spec não o resolveria.
3. **O desenho de RLS da spec (R7) recursa.** `company_members` → `is_company_owner` (INVOKER, com
   a branch nova) → `company_members` = `42P17`, e — como no precedente
   `shift_calls ↔ shift_call_targets` — **em runtime, não no `CREATE POLICY`**.

Há ainda uma dívida ativa: o ramo `p_company_id = (SELECT auth.uid())` de `is_company_owner` **não
verifica que a linha em `companies` existe**. Qualquer sessão autenticada que passe o próprio uuid
recebe `true`. Foi o furo apontado no gate do F8, e o multi-unidade o distribuiria por oito
superfícies novas.

## Decisão

### 1. Hierarquia por tabela de vínculo, não por coluna de auto-referência

`organizations` (o grupo) → `companies` (a unidade, ganha `organization_id`) →
`company_members` (gerente da unidade) e `organization_members` (sócio/operador da rede).
`parent_company_id` em `companies` é rejeitado: `companies` é simultaneamente unidade **e**
identidade de login (`id = auth.uid()`), então uma auto-referência exigiria `auth.users` fantasma
por unidade; e ela modela grupo↔unidade, não **pessoa × unidade** — que é a relação de que a
feature precisa, já que a entrevista descreve gerente cobrindo mais de uma loja.

`organizations` existe (em vez de só `company_members` com um papel `operator` por unidade) porque
o sócio precisa enxergar unidades **que ainda não existem** quando ele é cadastrado. Com membership
por unidade, cada loja nova exigiria lembrar de dar acesso ao sócio, e o modo de falha é silencioso
— exatamente a dor "abaixo do radar" que a feature existe para curar.

### 2. O par `is_job_owner` / `is_company_owner` é unificado nesta migration

`is_company_owner` ganha uma branch de multi-unidade; `is_job_owner` passa a **delegar** para ela,
com corpo `BEGIN ATOMIC` (PG14+) em vez de `AS $$ ... $$`. O corpo ATOMIC é parseado no `CREATE` e
registra a dependência em `pg_depend`, então `DROP FUNCTION is_company_owner` passa a falhar com
`2BP01` em vez de quebrar quatro policies em runtime — que é precisamente o motivo pelo qual o
`ADR-20260817` recusou a delegação naquele momento e a agendou para esta migration.

A branch nova não é lida diretamente pela função INVOKER: passa por
`session_operates_company_membership(uuid)`, `SECURITY DEFINER`, mínima, sempre sobre `auth.uid()` e
sem parâmetro de "por qual usuário perguntar". É o precedente `is_shift_call_target` reaplicado, e é
o que mantém o grafo de policies acíclico.

### 3. O ramo nu `= auth.uid()` é eliminado — única mudança não-aditiva da feature

Substituído por um equivalente ancorado em existência:

```sql
EXISTS (SELECT 1 FROM public.companies c
         WHERE c.id = p_company_id
           AND (c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid())))
```

O termo `c.id = auth.uid()` preserva as linhas legadas com `owner_id` NULL. O que deixa de passar é
só "`company_id = meu uid` sem linha em `companies`", que nunca é empresa legítima. Combinado com a
migração das policies inline de `jobs` para a função, isso fecha o furo do F8 (um freela criando
turno em nome de uma empresa inexistente e virando `is_job_owner` dele).

Custo: uma query de pré-voo bloqueante (`Q0`) que precisa devolver zero linhas de dado ancorado em
empresa inexistente. Esperado: zero.

### 4. Gerente entra por convite consentido, não por credencial criada pela empresa

RPC `invite_company_manager` emite token de 7 dias (precedente
`ADR-20260702-worker-join-by-invite-token`); o gerente cria a **própria** conta Supabase Auth e
chama `accept_manager_invite`, que amarra `user_id = auth.uid()`, queima o token e remove — sob
guardas estritas de vacuidade — a casca de `companies` deixada pelo `handle_new_user`. Remoção é
sempre **soft** (`status='removed'`), nunca `DELETE`: o Elenco, os turnos e os `shift_payments`
ficam com a **unidade**, não com a pessoa — que é o problema do WhatsApp que o produto existe para
resolver.

Criação direta de credencial pela empresa é rejeitada: nenhuma superfície do Worki cadastra terceiro
(nem `team_connections`), e exigiria uma Edge Function nova com `service_role` chamando
`auth.admin.createUser`.

### 5. Dois níveis de alcance, e só dois

Gerente (`company_members` ativo) = uma conta de empresa comum, **escopada às unidades onde tem
linha ativa**, sem enxergar a existência de outra unidade. Sócio/operador (`organization_members`
ativo) = o mesmo em **qualquer** unidade da organização, inclusive as criadas depois, mais
convidar/remover gerente e mover a unidade de organização (protegido por trigger, já que RLS não
restringe coluna).

### 6. Article 8 intacto; `shift_payments` só tem RLS tocada

Nenhuma tabela de saldo, nenhuma RPC atômica, nenhum `reference_id`, nenhum trigger financeiro é
tocado. Em `shift_payments` mudam só os predicados das três policies de empresa;
`enforce_shift_payment_immutability`, o CHECK de estado, o UNIQUE parcial e a ausência de policy de
DELETE ficam como estão. `recorded_by = auth.uid()` é mantido, e passa a registrar **qual pessoa**
lançou o pagamento — ganho de auditoria que o modelo antigo não tinha.

### 7. Quatro migrations, com um portão entre a Fase 2 e a Fase 3

`100000` (schema, aditivo puro) → `100100` (backfill + NOT NULL) → **`100200` (o seam + as 15
policies)** → *portão de verificação read-only contra produção* → `100300` (RPCs de convite). O
frontend é uma quinta entrega, sem SQL.

## Consequências

### Positivas

- O seam paga o investimento: **oito superfícies** (`shift_calls`, `shift_call_targets`,
  `team_lists`, `team_list_members`, `job_series`, `shift_attendance_confirmations`,
  `service_terms`, `worker_trainings`) e seis RPCs herdam multi-unidade **sem uma linha de SQL
  nelas**. Era exatamente a aposta do `ADR-20260817`.
- O furo do F8 fecha junto, sem uma migration corretiva separada.
- Três bugs latentes viram correções: empresa com `owner_id` NULL passa a enxergar o próprio elenco,
  os próprios candidatos e os próprios `shift_payments`.
- A dependência do par fica registrada no catálogo: a próxima pessoa que tentar mexer numa função
  sem a outra recebe um erro, não um comportamento silenciosamente assimétrico.
- O contrato do F9 (`resolveCompanyScope()` como único ponto de mudança do frontend) é **cumprido**,
  não invalidado: ele passa a devolver N ids em vez de 1–2.

### Negativas / Trade-offs

- **A Fase 2 não é um no-op**, ao contrário do que a spec afirma. `team_connections`,
  `applications` e `shift_payments` ancoram só por `owner_id` hoje e ganham a ancoragem dupla. É
  correção de bug, mas é mudança de comportamento em produção antes de existir qualquer gerente —
  daí a query `Q1` do portão.
- **Quatro objetos `SECURITY DEFINER` novos** (`is_organization_operator`, `is_organization_member`,
  `session_operates_company_membership`, e as funções de trigger) num projeto que vinha reduzindo a
  superfície privilegiada. Mitigado: todas mínimas, todas sobre `auth.uid()`, nenhuma aceita uid de
  terceiro, todas com `REVOKE PUBLIC, anon`.
- **Custo por linha nas policies sobe.** `is_company_owner` deixa de ser inlinável quando cai na
  branch de membership (chamada a função DEFINER). As branches estão ordenadas com a barata
  primeiro (lookup por PK em `companies`), mas isso vira item de atenção se o volume por empresa
  crescer.
- **`accept_manager_invite` faz um `DELETE` em `companies`.** É o único DELETE que este contrato
  autoriza em tabela de domínio, guardado por seis `NOT EXISTS`. Se qualquer um falhar, a casca
  fica e o seletor de unidade resolve — mas é uma operação destrutiva num lugar onde o projeto
  normalmente usa soft-delete, e merece revisão de segurança específica.
- **Ponto de não-retorno explícito:** o primeiro `accept_manager_invite` bem-sucedido e a primeira
  segunda unidade numa organização. Depois deles, reverter a Fase 2 deixa de ser um no-op e passa a
  revogar acesso de gente que está trabalhando.
- O gerente pode estornar (`voided`) marcador de pagamento da unidade dele. Consistente com R14,
  mas é permissão financeira dada a alguém que não é o dono da conta.

## Alternativas rejeitadas

- **`companies.parent_company_id` (auto-referência):** não modela pessoa × unidade, exige
  `auth.users` fantasma por unidade e não tem onde guardar convite/expiração/aceite/remoção. Menos
  reversível depois de povoada, não mais.
- **Só `company_members`, sem `organizations`:** o sócio deixaria de ver unidades criadas depois do
  cadastro dele, com falha silenciosa — a própria dor da entrevista.
- **Manter o ramo nu `= auth.uid()`:** o furo do F8 continuaria disponível, agora distribuído por
  oito superfícies. Fechar depois de distribuir é mais caro.
- **Manter `is_job_owner` reimplementando a ancoragem (sem delegar):** a assimetria que o
  `ADR-20260817` nomeou como o modo de falha a vigiar viraria realidade na primeira migration
  futura que mexesse numa função só.
- **`is_company_owner` como `SECURITY DEFINER` inteira** (em vez de INVOKER chamando um DEFINER
  mínimo): resolveria a recursão também, mas transformaria a função mais chamada do schema num
  objeto privilegiado, e ela lê `companies`, que é semi-pública — não compra nada.
- **Policies de membership que dependem da própria RLS para a função INVOKER ler a própria linha**
  (desenho R7 da spec): recursa em runtime, e mesmo se não recursasse, faria a autorização depender
  de uma policy de SELECT permanecer exatamente como está — errando **para menos**, em silêncio, se
  alguém a apertasse.
- **`SET NOT NULL` em `organization_id` sem trigger de auto-provisão:** quebra `handle_new_user` e
  derruba todo signup novo de empresa.
- **Uma migration única com tudo:** eliminaria o portão de verificação entre a mudança de
  autorização e a habilitação dos convites, que é o que torna a feature reversível de verdade.

## Referências

- Contrato executável (SQL byte a byte, portão, landmines): `.harness/spec/multi-unidade/ddl-aprovado.md`
- Spec: `.harness/spec/multi-unidade/spec.md`
- ADR gatilho: `.harness/memory-bank/decisions/ADR-20260817-seam-autorizacao-empresa.md` (decisões 2 e 3)
- Precedente de recursão `42P17` e DEFINER mínimo: `supabase/migrations/20260817000100_shift_calls.sql`
- Precedente de convite por token consentido: `ADR-20260702-worker-join-by-invite-token.md` /
  `supabase/migrations/20260702120000_worker_join_by_invite_token.sql`
- Ancoragem dupla e por que existe: `supabase/migrations/20260816210000_enable_rls_jobs.sql`
- Lição `FORCE RLS`: `supabase/migrations/20260318000000_fix_force_rls_service_role.sql`
- Lição `EXECUTE` em função de trigger: `20260816201420` / `20260816201457`
- Extensibilidade do analytics: `.harness/spec/analytics-operacao/prd.md`, D5
- Entrevista: `research-divino-fogao-2026-08` (memória do projeto)
- Constitution: Articles 1, 4, 8, 12 — nenhum alterado por esta decisão.
