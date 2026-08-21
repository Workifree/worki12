# Multi-unidade e papel de gerente (F13) — spec

> **Nível de risco: ALTO — a mais perigosa da fila.** Esta feature reescreve o predicado de
> autorização de que ~15 policies em 9 tabelas dependem hoje, mais o mecanismo pelo qual o
> frontend inteiro decide "quem é esta sessão" (`ProtectedRoute`, `CompanyProfile`,
> `teamConnectionService`). Cada seção abaixo tem uma decisão fixada, marcada **(Assumido)** onde o
> owner não especificou o detalhe, e cada `(Assumido)` está justificado no log de clarificações.
> Esta é candidata natural a gate `harness-architect` — a spec propõe uma sequência de migrations
> pequenas e independentemente reversíveis para que o gate tenha algo concreto a aprovar por partes,
> não um bloco monolítico.

## Context

Entrevista de 17/08/2026, sócio-operador de 10 unidades do Divino Fogão: *"Quem faz a seleção dos
freelancers são os gerentes de loja... isso é algo que fica um pouco abaixo do radar do sócio
operador... um controle centralizado disso permitiria administrar melhor, enxergar oportunidades,
evitar desvios."* E sobre pagamento: *"A gerente tem uma conta para onde a gente transfere um valor
mensal... essa conta é no nome da gerente e ela fica sob gestão da gerente. A gente tem acesso a
ela, ver os extratos, ver para quem foi pago."*

Hoje o Worki modela `companies` como unidade **e** conta ao mesmo tempo: `companies.id =
companies.owner_id = auth.uid()` sempre, para toda empresa em produção. Não existe operador
distinto do login. O owner já decidiu o modelo de correção — **não é relitigado aqui**:

```
organizations          → o grupo/rede
  companies             → a UNIDADE/loja (já existe; ganha organization_id)
    company_members     → gerente(s) da loja                 [role: manager]
  organization_members  → sócio/operador, vê tudo da rede     [role: owner | operator]
```

A conta-mãe cria a unidade e convida o gerente; o gerente cria a própria senha por link de convite,
mas a conta nasce **dentro** da organização — o Elenco (`team_connections`) pertence à empresa
(unidade), nunca ao gerente, para que a saída de um gerente não leve a lista consigo (o problema do
WhatsApp que o produto existe para resolver).

O raio de alcance real, verificado no banco em 18/08/2026: **nove tabelas** ancoradas em empresa
(`companies`, `jobs`, `applications`, `team_connections`, `shift_payments`, `shift_calls`,
`shift_call_targets`, `team_lists`, `team_list_members`, `job_series`,
`shift_attendance_confirmations`), **duas funções-costura** (`is_job_owner`, `is_company_owner`,
ambas `SECURITY INVOKER`, ancoragem dupla `company_id = auth.uid() OR via companies.owner_id`) das
quais dependem ~15 policies e as RPCs `claim_shift_slot`, `cancel_shift_call`, `create_job_series`,
`update_job_series_future`, `stop_job_series`, `request_attendance_confirmation`. O
`ADR-20260817-seam-autorizacao-empresa.md` já declara que as duas funções mudam **juntas** quando a
regra de autorização de empresa mudar, e que **esta feature é esse gatilho**. Ele registra também
que corpo de função `LANGUAGE sql` escrito como string não gera dependência no catálogo — por isso
`is_job_owner` nunca delegou para `is_company_owner`; esta feature é o momento certo de unificar via
corpo `BEGIN ATOMIC` (PG14+), que É parseado no `CREATE` e registra a dependência de verdade.

**O achado que muda o tamanho real da feature** (verificado nesta sessão, não estava nos ADRs
anteriores): `ProtectedRoute.tsx` resolve "esta sessão é uma empresa?" com
`supabase.from('companies').select(...).eq('id', authUser.id).single()` — tanto para onboarding
quanto para TOS gate. Um gerente autenticado (`auth.uid()` do gerente) **não tem nenhuma linha em
`companies` com `id` igual ao próprio uid**, nem `owner_id` igual ao próprio uid. A query falha
(`PGRST116`, capturada no `catch`), `onboardingRedirect` vira `/company/onboarding` incondicionalmente,
e o gerente fica preso num loop de onboarding para sempre — **nunca chega a usar o produto**. O
mesmo padrão se repete em `teamConnectionService.getAuthenticatedCompanyId()` (ancora só por
`owner_id`) e em `CompanyProfile.tsx` (ancora só por `id`) — divergência já documentada no
`ADR-20260817-seam-autorizacao-empresa.md` como dívida "inerte hoje". Multi-unidade é exatamente o
que a torna ativa: sem resolver isso, a feature entrega um schema correto e um produto que não
funciona para a persona que ela existe para servir.

## Modelo de dados (fixado pelo owner — não relitigado)

- **`organizations`** — nova tabela. `(id uuid PK, name text NOT NULL, created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now())`. Não tem `owner_id` direto — o dono/operador é
  modelado em `organization_members`, não numa coluna (permite mais de um operador, ex.: sócios).
- **`companies.organization_id uuid REFERENCES organizations(id)`** — nova coluna, nullable na
  migration inicial (Fase 1 faz backfill; ver Sequência). Toda empresa passa a pertencer a
  exatamente uma organização.
- **`company_members`** — nova tabela: `(id uuid PK, company_id uuid NOT NULL REFERENCES
  companies(id) ON DELETE CASCADE, user_id uuid NOT NULL, role text NOT NULL DEFAULT 'manager' CHECK
  (role = 'manager'), status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active',
  'removed')), invited_email text, invite_token text, invited_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, accepted_at timestamptz, created_by uuid NOT NULL, UNIQUE
  (company_id, user_id))`. `role` fixado em `'manager'` por CHECK — único papel de unidade no v1
  (Assumido — ver clarificações). Um `user_id` só pode ter uma linha `active` por `company_id`
  (via UNIQUE); nada impede o mesmo `user_id` de ser `active` em **mais de uma** unidade (não
  restringido de propósito — cobre o caso real de gerente cobrindo duas lojas próximas, mencionado
  como possível pelo padrão de operação de rede).
- **`organization_members`** — nova tabela: mesma forma de `company_members`, trocando
  `company_id` por `organization_id`, `role text NOT NULL CHECK (role IN ('owner', 'operator'))`,
  mesmos `status`/convite. `'owner'` e `'operator'` distintos para abrir espaço a mais de um sócio
  com poderes diferentes no futuro (v1 trata os dois como equivalentes em permissão — ver
  Permissões).

## Requirements

### Schema (Fase 0 — aditivo puro, zero policy tocada)

- [ ] R1: Criar `organizations`, `company_members`, `organization_members` conforme o modelo acima,
      com RLS habilitada e policies desde o nascimento (policies antes de `ENABLE ROW LEVEL
      SECURITY`, landmine do harness). `companies.organization_id` criado **nullable** nesta fase —
      NOT NULL só depois do backfill (R2). Nenhuma policy das 9 tabelas existentes é alterada nesta
      migration. Migration isolada e 100% reversível por `DROP TABLE`/`DROP COLUMN` porque nada além
      dela referencia as tabelas novas ainda.
- [ ] R2: Migration de backfill — para cada `companies` existente sem `organization_id`, criar UMA
      `organizations` nova (`name` = `companies.name`, `created_by` = `companies.owner_id`) e setar
      `companies.organization_id` para ela; inserir uma `organization_members` (`role='owner'`,
      `status='active'`, `user_id = companies.owner_id`). Depois do backfill, `ALTER COLUMN
      organization_id SET NOT NULL`. Efeito: toda empresa hoje vira uma organização de UMA unidade
      só — o modelo multi-unidade nasce sem mudar nada do que já funciona; virar "multi" de verdade
      é uma ação futura da conta-mãe (criar uma segunda unidade na mesma organização — UI fora do
      escopo desta spec, ver Out-of-scope).

### Seam de autorização (Fase 2 — a migration que decide a feature)

- [ ] R3: `is_company_owner(p_company_id uuid)` ganha DUAS branches novas, somadas por `OR` às duas
      existentes (self / via `owner_id`):
      - `EXISTS (SELECT 1 FROM company_members cm WHERE cm.company_id = p_company_id AND cm.user_id
        = auth.uid() AND cm.status = 'active')`
      - `EXISTS (SELECT 1 FROM organization_members om JOIN companies c ON c.organization_id =
        om.organization_id WHERE c.id = p_company_id AND om.user_id = auth.uid() AND om.status =
        'active')`
      `SECURITY INVOKER` preservado — `company_members`/`organization_members` precisam de policy de
      SELECT que permita a própria função ler a própria linha do usuário (ver R7); sem isso a função
      INVOKER erra para `false` sob a RLS das tabelas novas, o mesmo modo de falha que o ADR já
      descreveu para "erra para menos".
- [ ] R4: `is_job_owner(p_job_id uuid)` passa a **delegar** para `is_company_owner(jobs.company_id)`
      em vez de reimplementar a ancoragem dupla — com corpo `LANGUAGE sql ... BEGIN ATOMIC ... END`
      (PG14+), não `AS $$ ... $$`, precisamente para que o `DROP FUNCTION is_company_owner` registre
      dependência no catálogo e falhe alto (`ERROR: cannot drop function ... because other objects
      depend on it`) em vez de quebrar `is_job_owner` em runtime — fechando o risco que o
      `ADR-20260817-seam-autorizacao-empresa` (decisão 2) documentou e adiou explicitamente para
      este momento. `is_job_owner` e `is_company_owner` mudam nesta MESMA migration (contrato do
      ADR); nenhuma migration futura altera uma sem a outra.
- [ ] R5: Auditoria e alinhamento de TODAS as ~15 policies das 9 tabelas na MESMA migration de
      R3/R4 (o modo de falha que o ADR chama de "silencioso": gerente edita listas mas não dispara
      chamados, ou o inverso, se só uma parte for atualizada). Catalogar cada policy hoje por
      predicado usado e migrar as que ainda ancoram inline para chamar a função correta:
      | Tabela | Predicado hoje | Ação |
      |---|---|---|
      | `shift_calls`, `shift_call_targets` | já usa `is_job_owner` (via `shift_call_job_id`) | nenhuma — herda a mudança automaticamente |
      | `team_lists`, `team_list_members` | já usa `is_company_owner` | nenhuma — herda automaticamente |
      | `team_connections` | inline, **só** `company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())` — divergência já documentada no ADR como "inerte hoje" | migrar para `is_company_owner(company_id)` — sem isso um gerente NUNCA vê/edita o Elenco, que é a razão de existir da feature (a frase do owner é literalmente sobre quem faz a seleção) |
      | `jobs` | inline, ancoragem dupla (`20260816210000`) | migrar para `is_company_owner(company_id)` |
      | `applications` | inline, **só** `owner_id` (`20260317160000`, pré-seam) | migrar para `is_company_owner` via `jobs.company_id` (join, já que `applications` não guarda `company_id` direto) |
      | `shift_payments` | conferir ancoragem real na migration `20260630000000`/`20260712000000` antes de alterar; se inline, migrar para `is_company_owner` — **só a policy de SELECT/INSERT/UPDATE muda; o trigger `enforce_shift_payment_immutability` e qualquer coluna financeira NÃO são tocados (Article 8)** | auditar + migrar se necessário |
      | `job_series` | conferir ancoragem real na `20260817000400` antes de alterar | auditar + migrar se necessário |
      | `shift_attendance_confirmations` | conferir ancoragem real na `20260817000600` antes de alterar | auditar + migrar se necessário |
      A query de auditoria (`pg_policies` + `pg_get_expr` da qual predicado cada policy usa) faz
      parte do artefato de verificação (ver Acceptance A6).
- [ ] R6: `companies` ganha policy de SELECT/UPDATE equivalente — hoje é `USING (true)` para SELECT
      (não muda; é dado semi-público, decisão preexistente) e `owner_id`/`id`-anchored para UPDATE
      (`20260317150000`). UPDATE de `companies` passa a aceitar também `is_company_owner(id)` — um
      gerente pode editar a própria unidade (briefing padrão, endereço) mas **não** `organization_id`
      nem `owner_id` (colunas fora do `GRANT UPDATE` de coluna já restrito, se existir; auditar o
      grant atual antes de assumir que é irrestrito).
- [ ] R7: `company_members`/`organization_members` ganham policies próprias: usuário lê a PRÓPRIA
      linha (`user_id = auth.uid()`) em qualquer status; dono/operador da organização (via
      `organization_members` ativo) lê/gerencia todas as linhas de `company_members` das unidades da
      própria organização e todas as linhas de `organization_members` da própria organização; gerente
      (`company_members` ativo) **não** gerencia `company_members`/`organization_members` de
      nenhuma unidade (nem a própria) — só a conta-mãe convida/remove gerentes (ver Permissões).
      Cuidado com recursão de policy (mesma classe de erro 42P17 que `shift_calls` teve): a policy de
      `organization_members` que decide "sou operador desta organização" NÃO pode reler
      `organization_members` dentro de si mesma de forma cíclica — usar a mesma técnica de função
      `SECURITY DEFINER` mínima (`is_organization_operator(org_id)`, devolve só um booleano sobre
      `auth.uid()`) se a policy natural recursar, seguindo o precedente de `is_shift_call_target`.

### Convite do gerente

- [ ] R8: Nova RPC `invite_company_manager(p_company_id uuid, p_email text) RETURNS jsonb`
      (`SECURITY DEFINER`, `search_path=''`) — só quem passa em `is_company_owner(p_company_id)` E é
      `organization_members` ativo (owner/operator) da organização dona da unidade pode chamar
      (gerente NÃO convida gerente — decisão de Permissões). Cria `company_members (status='invited',
      invite_token=gen_random_uuid()::text, expires_at=now()+interval '7 days')`. Devolve o token; o
      client monta a URL `/convite-gerente/:token` (mesmo padrão de `/convite/:token` do
      `ADR-20260702-worker-join-by-invite-token`). **(Assumido)** expiração 7 dias — mesma janela do
      convite de worker por link.
- [ ] R9: Nova RPC `accept_manager_invite(p_token text) RETURNS jsonb` — chamada pelo usuário já
      autenticado (o gerente cria a conta Supabase Auth normalmente, com `user_metadata.user_type =
      'hire'`, ANTES de aceitar o convite — fluxo: recebe link → se não tem conta, cadastra → aceita).
      Valida token não expirado e `status='invited'`, seta `user_id = auth.uid()`, `status='active'`,
      `accepted_at = now()`. Idempotente: token já aceito pelo mesmo `user_id` devolve sucesso sem
      duplicar; token aceito por OUTRO `user_id`, ou expirado, devolve erro explícito (nunca aceita
      silenciosamente o segundo).
- [ ] R10: Quando a conta-mãe remove um gerente (`revoke_company_manager(p_company_id, p_user_id)`,
      mesma guarda de `is_company_owner` + operador de organização), `company_members.status` vira
      `'removed'` — **soft**, nunca `DELETE`, para preservar auditoria de quem operou a unidade e
      quando (a mesma razão de `applications`/`shift_calls` nunca usarem DELETE). O acesso do gerente
      às 9 tabelas cessa no próximo request (a função de autorização já ignora `status <> 'active'`).
      A conta Supabase Auth do gerente **não é excluída** — sai do escopo desta feature (é
      `delete-account`, fluxo separado e do próprio usuário). O Elenco (`team_connections`), os
      turnos (`jobs`), os `shift_payments` — tudo o que o gerente criou continua pertencendo à
      `company_id`, intocado (é exatamente a garantia que o modelo existe para dar).
- [ ] R11: `ProtectedRoute.tsx` — a resolução de "esta sessão é company e está pronta?" (onboarding +
      TOS) precisa reconhecer gerente ativo, não só `companies.id = auth.uid()`. Extensão mínima
      (Assumido — evita reescrever o componente inteiro): antes de concluir "sem perfil, mandar para
      onboarding", se `userType === 'hire'` e a query direta por `id` não achou linha, tentar
      `company_members` (`user_id = auth.uid() AND status = 'active'`) → se achou, resolver a
      `companies` correspondente e usar o `onboarding_completed`/`accepted_tos` DAQUELA linha (não do
      gerente, que não tem linha própria em `companies`). Sem este fix o gerente entra em loop de
      onboarding permanente e a feature não é utilizável — é o achado mais crítico desta spec.
- [ ] R12: Nova RPC de leitura `get_my_companies() RETURNS TABLE (company_id uuid, company_name
      text, role text, organization_id uuid)` (`SECURITY DEFINER`, `search_path=''`, sempre `auth.uid()`
      — nunca recebe um uid como parâmetro) — devolve toda unidade que a sessão opera (dono direto,
      via `owner_id`, `company_members` ativo, ou `organization_members` ativo via organização) com
      o papel efetivo (`'owner'` se dono direto/legado, `'operator'`/`'manager'` conforme a origem).
      **`teamConnectionService.getAuthenticatedCompanyId()` e `CompanyProfile.tsx` são reescritos
      para consumir esta RPC** em vez das duas âncoras divergentes que usam hoje (`owner_id` num
      lugar, `id` no outro) — fecha a dívida que o `ADR-20260817-seam-autorizacao-empresa` registrou
      como "inerte hoje", ativada por esta feature.
- [ ] R13: Seletor de unidade — quando `get_my_companies()` devolve mais de uma linha (gerente de
      duas lojas, ou sócio navegando por unidade), a UI de empresa ganha um seletor simples (dropdown
      no header/sidebar da `CompanyLayout`) que guarda a unidade corrente em estado local (não em
      URL — Assumido, simplicidade v1) e a usa como `company_id` em todas as queries de tela que hoje
      resolvem via `getAuthenticatedCompanyId()`. Quando só há UMA linha (o caso hoje, 100% das
      contas), o seletor não aparece — zero mudança visual para quem não é multi-unidade.

### Permissões por papel (Assumido — sem detalhamento do owner além da citação da entrevista)

- [ ] R14: **Gerente (`company_members`, ativo)** pode, dentro da própria unidade: criar/editar
      turnos, disparar chamados (F1), gerenciar o Elenco da unidade (convidar/aceitar/ver
      `team_connections`, listas F2), confirmar presença, registrar/efetivar/estornar
      `shift_payments`, configurar o limite de risco de vínculo da unidade (`link_risk_alert_*`) —
      em resumo, tudo que uma conta de empresa faz hoje, escopado à própria unidade. **Não pode**:
      ver/acessar dados de OUTRA unidade (mesma organização ou não), convidar/remover outro gerente
      (R8/R10 exigem `organization_members`), mudar `companies.organization_id`, excluir a própria
      unidade, ver a visão consolidada da organização (R16). Justificativa: a entrevista descreve o
      gerente operando a loja no dia a dia (seleção de freela) e o sócio querendo **visibilidade**,
      não descreve o sócio querendo restringir a operação do gerente além disso — a única restrição
      pedida explicitamente é "abaixo do radar" (falta de visibilidade), que R16 resolve.
- [ ] R15: **Sócio/operador (`organization_members`, ativo, `role IN ('owner','operator')`)** pode
      tudo que um gerente pode, em QUALQUER unidade da organização, mais: criar novas unidades dentro
      da organização, convidar/remover gerentes (R8/R10), ver a visão consolidada (R16). `'owner'` e
      `'operator'` têm o MESMO conjunto de permissões no v1 (Assumido — a distinção existe no schema
      para não bloquear uma diferenciação futura, ex.: só `'owner'` pode remover outro operador, mas
      isso não foi pedido e fica fora do escopo).
- [ ] R16: Visão mínima de unidades — nova página `pages/company/Organization.tsx` (rota
      `/company/organization`, só acessível a quem tem `organization_members` ativo — outra unidade
      no `roleRedirect` de `ProtectedRoute`, mesma técnica do bloqueio worker⇎company hoje) listando
      as unidades da organização com nome, contagem de turnos abertos e do elenco (`jobs`/
      `team_connections` count por `company_id`, via `get_my_companies()` + queries já existentes
      escopadas por `company_id`, sem RPC de agregação nova). **A visão de BI/analytics consolidada
      de verdade (gastos, faltas, comparação entre unidades) é da spec `analytics-operacao` (em
      escrita paralela) — esta página é só navegação/visibilidade básica, não duplica aquele
      trabalho.** Coordenação: `analytics-operacao` deve consumir `get_my_companies()` (R12) para
      decidir se agrega uma unidade só ou várias, em vez de reimplementar a resolução de organização.

## Sequência de execução e reversibilidade — a seção mais importante desta spec

Cinco migrations pequenas, cada uma com seu próprio DOWN, aplicadas **nesta ordem**, com um portão
de verificação entre a Fase 2 e a Fase 4 que é o que torna a feature reversível de verdade:

| # | Migration (proposta) | O que faz | Reversível como |
|---|---|---|---|
| Fase 0 | `20260818090000_organizations_company_members_schema.sql` | R1 — tabelas novas, RLS própria, zero policy existente tocada | `DROP TABLE` das 3 tabelas novas + `DROP COLUMN companies.organization_id` — nada externo depende ainda |
| Fase 1 | `20260818090100_organizations_backfill.sql` | R2 — 1 organização por empresa existente, `organization_id NOT NULL` | Reversível SE nenhuma segunda unidade foi criada ainda: `DELETE FROM organizations WHERE created_by IN (...)` (marcador: toda org criada aqui tem exatamente 1 `companies` apontando pra ela) + `ALTER COLUMN organization_id DROP NOT NULL` |
| Fase 2 | `20260818090200_seam_multi_unidade.sql` | R3, R4, R5, R6, R7 — a MUDANÇA de autorização em si | **Trivialmente reversível enquanto `company_members`/`organization_members` estiverem vazias de linhas `active` além do backfill de owners**: as duas branches novas de `is_company_owner` são `EXISTS` sobre tabelas sem gerentes reais ainda ⇒ sempre `false` ⇒ resultado idêntico ao pré-migration para 100% dos usuários existentes. Reversão = `CREATE OR REPLACE FUNCTION` de volta à versão anterior (guardada no DOWN do arquivo), NUNCA precisa de `DROP`/dado. **Esta propriedade é o motivo de a Fase 2 poder ir para produção ANTES da Fase 3/4 e ficar verificada em paz, sem pressa, sem ninguém dependendo dela ainda.** |
| Portão | Rodar as queries de Acceptance A1-A6 em produção contra a Fase 2, comparando resultado ANTES/DEPOIS para contas reais. Só prosseguir para Fase 3/4 se A1-A6 baterem. | — | — |
| Fase 3 | `20260818090300_organization_invite_rpcs.sql` | R8, R9, R10, R6 (grants) | Reversível por `DROP FUNCTION` das 3 RPCs — ninguém foi convidado ainda (é a migration que HABILITA convidar, não que convida) |
| Fase 4 | Frontend: R11 (`ProtectedRoute`), R12 (`get_my_companies` + refactor dos 2 consumidores), R13 (seletor), R14-R16 (UI) | Muda comportamento visível | Reversível por revert de commit/branch — nenhuma migration nova, e a Fase 2/3 já aplicadas continuam corretas (aditivas) mesmo que o frontend seja revertido |

**O ponto central:** porque as duas tabelas de membership nascem vazias e as branches novas de
`is_company_owner`/`is_job_owner` são puramente aditivas (`OR` de mais uma condição, nunca
substituição), a Fase 2 — a migration que mexe nas ~15 policies — pode ser aplicada, verificada
exaustivamente contra dados reais em produção, e só então "ligada" de fato ao permitir o primeiro
convite (Fase 3) e ao expor a UI que usa tudo isso (Fase 4). Não existe janela em que autorização
nova e UI nova sobem juntas sem verificação intermediária — é o oposto do que aconteceu com `jobs`
em `20260816210000` (RLS ligada sem policy, meses inertes) e é a lição que este ADR-gatilho pede
para não repetir ao contrário (RLS mudando sob usuários ativos sem checar antes).

## Acceptance criteria

- [ ] A1: Dado o estado de produção ANTES da Fase 2 (uma empresa legada com `companies.id =
      owner_id = auth.uid()`), quando se roda `SELECT is_company_owner(company_id)` como aquela
      sessão DEPOIS da Fase 2 aplicada (sem nenhum `company_members`/`organization_members` `active`
      criado ainda), então o resultado é `true` — idêntico ao comportamento pré-migration (regressão
      zero para o caso dominante).
- [ ] A2: Dado um `company_members` com `status='active'` para o gerente G na unidade U, quando G
      autenticado chama `is_company_owner(U)`, `is_job_owner(<turno de U>)`, ou tenta
      `SELECT`/`INSERT` em `team_connections`/`jobs`/`shift_calls`/`team_lists` da unidade U, então
      todas retornam acesso concedido — o gerente opera a unidade como uma conta de empresa comum.
- [ ] A3: Dado o mesmo gerente G (ativo só na unidade U), quando G tenta ler/escrever
      `jobs`/`applications`/`team_connections`/`shift_payments` de uma unidade DIFERENTE V (mesma
      organização ou não), então a RLS nega — 0 linhas em SELECT, erro de policy em INSERT/UPDATE.
      Nenhuma das ~15 policies vaza dado cross-unidade.
- [ ] A4: Dado um `company_members` com `status='removed'` (gerente que saiu), quando esse usuário
      tenta qualquer operação na unidade que já geriu, então é negado no próximo request (sem
      precisar de logout/refresh de token) — e `team_connections`/`jobs`/`shift_payments` que ele
      criou continuam intactos, pertencendo à unidade, visíveis para o dono/operador ou próximo
      gerente.
- [ ] A5: Dado o sócio/operador O (`organization_members` ativo) da organização da unidade U, quando
      O chama `is_company_owner(U)` para QUALQUER unidade U da própria organização (mesmo sem nunca
      ter sido convidado como `company_members` daquela unidade específica), então retorna `true` —
      visibilidade de organização inteira, sem precisar de membership unidade-a-unidade.
- [ ] A6: Dado o script de auditoria de policies (query sobre `pg_policies`/`pg_get_expr` catalogando
      cada uma das ~15 policies das 9 tabelas por predicado usado), quando rodado ANTES e DEPOIS da
      Fase 2, então TODA policy que hoje ancora só em `owner_id` (ex.: `team_connections`,
      `applications`) passa a referenciar `is_company_owner`/`is_job_owner` — nenhuma policy fica
      para trás com a ancoragem antiga (o modo de falha "assimétrico" que o ADR nomeia).
- [ ] A7: Dado um gerente recém-aceito (R9, `accept_manager_invite` bem-sucedido), quando ele acessa
      `/company/dashboard` pela primeira vez, então `ProtectedRoute` NÃO o redireciona para
      `/company/onboarding` (resolve onboarding/TOS pela linha de `companies` correta via
      `company_members`, não por `companies.id = auth.uid()`) — cobre o achado crítico de R11.
- [ ] A8: Dado um convite de gerente expirado (R8, `expires_at` no passado), quando alguém chama
      `accept_manager_invite(token)`, então a RPC recusa com erro explícito (nunca ativa
      silenciosamente um convite vencido).
- [ ] A9: Dado que `get_my_companies()` (R12) é chamado por uma conta legada (1 empresa, dono
      direto), então devolve exatamente 1 linha com `role='owner'` — o refactor de
      `teamConnectionService`/`CompanyProfile` não muda o comportamento para os 100% dos usuários
      atuais, só passa a funcionar para os novos (gerente/multi-unidade).
- [ ] A10: `cd frontend && npm run build` e `npm run lint` passam sem erro em cada uma das Fases 3-4
      (Article 3). As Fases 0-2 são só SQL — verificadas pelas queries read-only de A1-A6, não pelo
      build do frontend.
- [ ] A11: Dado o corpo `BEGIN ATOMIC` de `is_job_owner` delegando a `is_company_owner` (R4), quando
      alguém tenta `DROP FUNCTION is_company_owner` sem antes remover `is_job_owner`, então o Postgres
      recusa com erro de dependência (`2BP01`/objeto dependente) — não mais o "sucede em silêncio e
      quebra em runtime" que o ADR documentou como problema do desenho anterior.

## Out-of-scope

- UI de criação de uma SEGUNDA unidade dentro de uma organização existente (o backfill cria só a
  primeira; o botão "criar nova loja" fica para uma iteração seguinte — o schema já suporta, só
  falta a tela).
- BI/analytics consolidado real (gastos, faltas, comparação de unidades) — spec própria
  `analytics-operacao`, que deve consumir `get_my_companies()` (R12) desta feature.
- Papéis intermediários dentro de `company_members` além de `'manager'` (ex.: "assistente de
  gerente" com permissões reduzidas) — CHECK trava em `'manager'` único por decisão de escopo, não
  por limitação técnica; estender é aditivo (novo valor de CHECK) quando pedido.
- Diferenciação de permissão entre `organization_members.role = 'owner'` vs `'operator'` — schema
  aberto, comportamento idêntico no v1.
- Qualquer coisa envolvendo saldo/escrow/Asaas — Article 8 intacto; `shift_payments` só tem a RLS de
  SELECT/INSERT/UPDATE tocada (quem pode ver/registrar), nunca o trigger de imutabilidade financeira
  nem o RPC de nenhuma carteira.
- Exclusão de conta do gerente removido (`delete-account`) — fluxo separado, do próprio usuário.
- Migração de contas com múltiplas `companies` sob o MESMO `owner_id` hoje (se existirem — não
  verificado nesta spec) para uma organização compartilhada automaticamente; o backfill (R2) cria
  uma organização POR EMPRESA, não por dono. Se o owner tiver hoje 2 `companies` com o mesmo
  `owner_id`, o backfill produz 2 organizações de 1 unidade cada — juntá-las manualmente (mover
  `organization_id`) é operação manual pós-migration, fora do escopo automatizado desta spec.

## Clarifications log

- Q: Como as empresas existentes viram "unidade dentro de organização" sem quebrar nada? → A
  (Assumido): backfill cria 1 organização nova POR empresa existente (não por dono), preservando
  1:1 até uma ação futura explícita da conta-mãe juntar unidades. `organization_id` nasce nullable,
  vira NOT NULL só depois do backfill completo — nunca há janela com linha órfã.
- Q: A regra de autorização exata e como as duas funções mudam juntas? → A: `is_company_owner` ganha
  2 branches `OR` (company_members ativo, organization_members ativo via organização);
  `is_job_owner` passa a DELEGAR para `is_company_owner` via corpo `BEGIN ATOMIC` (não mais
  reimplementar a ancoragem) — resolve o adiamento explícito do ADR-20260817 e fecha o buraco de
  dependência não registrada que o corpo `AS $$ ... $$` tinha.
- Q: O que o gerente pode e não pode fazer? → A (Assumido): tudo que uma conta de empresa faz hoje,
  escopado à própria unidade; não pode ver outras unidades nem gerenciar convites de outros
  gerentes (isso é do sócio/operador). Base: a entrevista descreve o gerente operando o dia a dia e
  o sócio querendo VISIBILIDADE, não descreve pedido de restringir a operação do gerente além disso.
- Q: Fluxo de convite do gerente, expiração, e o que acontece quando ele sai? → A (Assumido): RPC de
  convite com token de 7 dias (mesma janela do convite de worker por link existente); gerente cria a
  própria conta Supabase Auth normalmente e depois aceita o convite (linka `user_id`); saída/remoção
  é SEMPRE soft (`status='removed'`), nunca DELETE — preserva auditoria e garante que o Elenco/turnos
  ficam com a unidade, não com a pessoa.
- Q: Visão consolidada do sócio — soma ou por loja? Conversa com `analytics-operacao`? → A
  (Assumido): esta spec entrega só uma lista de navegação básica por unidade (R16); a agregação de
  BI de verdade é da spec `analytics-operacao` (em escrita paralela), que deve consumir a RPC
  `get_my_companies()` desta feature em vez de resolver organização por conta própria.
- Q: Ordem de execução e reversibilidade? → A: 5 migrations pequenas (Fase 0-4 descritas acima),
  com um portão de verificação (queries A1-A6 rodadas contra produção) ENTRE a mudança de
  autorização (Fase 2) e a habilitação de convites/UI (Fase 3-4) — porque `company_members`/
  `organization_members` nascem vazias, a Fase 2 é matematicamente um no-op para todo usuário
  existente até que a Fase 3 crie o primeiro gerente de verdade, o que torna a janela de verificação
  segura e sem pressa.
- Q: Como verificar que nada quebrou? → A: script de auditoria de `pg_policies` catalogando
  predicado por policy (A6), mais comparação ANTES/DEPOIS de `is_company_owner`/`is_job_owner` para
  contas legadas reais (A1), mais os testes de isolamento cross-unidade (A3) e de escopo de
  organização (A5) — todos read-only, rodáveis em produção sem risco.
- Q: Achado não pedido pelo humano, mas bloqueador — `ProtectedRoute` resolve empresa só por
  `companies.id = auth.uid()`. → A: incluído como R11/A7 porque sem ele nenhum gerente consegue
  usar o produto (loop de onboarding permanente) — não é opcional, é pré-condição funcional da
  feature.
