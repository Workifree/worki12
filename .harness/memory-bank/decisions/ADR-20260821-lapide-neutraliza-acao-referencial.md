# ADR-20260821 — A lápide pseudônima neutraliza TODA ação referencial em `workers`/`companies`

## Status

ACEITO (emenda de cobertura ao contrato `.harness/spec/lgpd-producao/ddl-aprovado.md`, §2.1).
Complementa — não substitui — `ADR-20260821-anonimizacao-em-vez-de-exclusao.md`.

## Contexto

A decisão de anonimização (ADR-20260821) faz a linha de `workers`/`companies` **sobreviver** à exclusão
da conta: ela vira lápide pseudônima porque é a chave que sustenta `shift_payments` e `service_terms`
(retenção por obrigação legal, LGPD art. 16, I).

Essa decisão tem uma consequência que não foi enunciada quando o contrato foi congelado, e que é mais
ampla do que "a CASCADE parou de limpar os filhos":

> **A ação referencial só existe no ato do `DELETE` da linha referenciada. Sem esse ato,
> `ON DELETE CASCADE`, `SET NULL` e `SET DEFAULT` viram, de fato, `NO ACTION`.**

Antes, apagar a conta limpava os dependentes de graça e ninguém precisava pensar neles. Depois da
lápide, o schema declara uma intenção (`ON DELETE CASCADE` = "apague junto") que **o runtime não
executa mais**. O dado sobrevive **em silêncio** — o pior modo de falhar numa rotina de LGPD, porque
não há erro, não há log, e a verificação manual passa.

A prova de que isso não é teórico: entre o congelamento do contrato e a revisão do evaluator, **duas
tabelas nasceram** (`worker_referrals` — F10 — e `worker_company_badge_prefs` — F12), ambas com
`ON DELETE CASCADE` para `workers`/`companies`, ambas ausentes da classificação. Uma varredura de
`pg_constraint` durante esta emenda encontrou **mais cinco** que ninguém tinha notado, incluindo
`company_spend_limits`, que carrega `financial_contact_email` e `financial_contact_phone` — contato de
pessoa natural dentro de uma tabela de configuração.

Também ficou visível uma assimetria: a RPC tratava `team_list_members` e `worker_trainings` apenas sob
`IF v_is_worker`. Uma **empresa** excluindo a conta deixava para trás listas, treinamentos, tetos de
gasto, faturamento declarado e séries de escala.

## Decisão

1. **Toda tabela com FK para `workers`/`companies` exige linha explícita na §2.1 do contrato** —
   inclusive quando a decisão for "nada a fazer". Vale para toda tabela futura. É obrigação
   permanente, não manutenção de lista.

2. **Quem descobre é o catálogo, não a memória.** A migration ganha a **asserção (c)**: enumera
   `pg_constraint` com `confrelid IN (workers, companies)` e **HALTa** se algum dependente não estiver
   na allow-list classificada. A lista à mão passa a ser apenas a *declaração de que foi decidido*.
   O filtro **não** discrimina `confdeltype` de propósito: `SET NULL` também deixou de disparar, e
   `RESTRICT` é dependência que a rotina precisa ter pensado (`shift_payments` = "INTOCADA").

3. **Cascatas intra-domínio continuam valendo e devem ser exploradas.**
   `team_list_members → team_lists(id)` dispara normalmente porque `team_lists` **é** apagada. Só
   quebram as FKs cujo alvo é a lápide. Apagar o pai intra-domínio limpa o filho de graça.

4. **Flag booleana de alcance/exposição não é "dado não-pessoal, logo retida".** Quando a flag governa
   um cálculo **derivado de dado retido**, ela é o único ponto que fecha o vazamento:
   - `badges_hidden → true`: o badge "Já trabalhou com" deriva de `applications`/`jobs`/`reviews`
     (RETIDOS). Apagar `worker_company_badge_prefs` sem isso **ressuscitaria** o grafo que aquelas
     linhas suprimiam, para toda empresa que ainda passa em `can_view_worker_profile`.
   - `discoverable_for_sos → false`: o pool de F11 é `WHERE discoverable_for_sos`, **sem** filtro de
     `anonymized_at` (a coluna não existia). Sem zerar, a lápide continua sendo alcançada por chamados.
   - `accepts_referrals → false`: defesa em profundidade; o caminho já fecha por `team_connections`.

5. **`companies.city` é APAGADO.** Decisão escrita, não omissão. O argumento "empresa é PJ, cidade é
   dado comercial" falha nos próprios termos do contrato: `address` já está classificado como apagado
   e `city` é subconjunto estrito dele; o mesmo raciocínio que apaga `cnpj` ("de MEI/EI identifica
   pessoa natural") vale aqui; e `workers.city` é apagado.

## Consequências

### Positivas
- O modo de falha vira **HALT em `apply`** em vez de dado pessoal sobrevivendo em silêncio.
- A obrigação passa a ser detectada por quem aplica a migration, não lembrada por quem escreve a feature.
- Cinco tabelas com dado da empresa (uma delas com contato de pessoa natural) deixam de sobreviver.
- O ramo empresa da RPC fica simétrico ao ramo freela.

### Negativas / Trade-offs
- A asserção (c) **quebra a aplicação da migration** sempre que uma feature nova pendura tabela em
  `workers`/`companies` sem passar pelo gate. É o comportamento desejado, mas é atrito real: o
  builder da próxima feature vai bater nisso e precisa saber que **não se adiciona nome à lista para
  "fazer passar"** — adicionar significa "eu decidi e escrevi na §2.1".
- Perde-se o molde de `job_series` e a auditoria "o que a empresa pediu". Aceito: o único público
  daquela auditoria era a empresa que saiu, e as ocorrências materializadas em `jobs` permanecem
  (não há FK — ADR-20260817-serie-eager-e-cancelamento-suave, decisão 1).
- Perde-se BI regional sobre lápides (`companies.city`).
- `worker_certifications.verified_by_company_id` fica apontando para lápide de empresa. Aceito e
  registrado como risco residual: o CHECK torna "conferência anônima" inexpressável e o ramo (c) de
  `enforce_certification_update_scope` barraria o UPDATE.

## Alternativas rejeitadas

- **Trocar as FKs `CASCADE` por triggers `AFTER UPDATE OF anonymized_at`**: transformaria a limpeza em
  N triggers espalhados, cada um com seu `search_path` e sua chance de silêncio. A rotina de exclusão
  precisa ser **um** lugar auditável e transacional — que é a RPC `anonymize_account`.
- **Gerar a §2.1 inteira por query, sem lista à mão**: impossível. A classificação é uma **decisão
  jurídica por coluna** (base legal, valor probatório, quem é o titular), não uma propriedade do
  catálogo. O que o catálogo pode fazer — e agora faz — é provar que **nenhuma** coluna/tabela ficou
  **sem** decisão. Enumeração automática + decisão à mão; nunca uma das duas sozinha.
- **Manter só a asserção de colunas (a)/(b)**: ela cobria `workers`/`companies` e teria pego
  `companies.city` e os três booleans, mas **não** pegaria tabela nova — que é o vetor de F10/F12.

## Referências

- Contrato: `.harness/spec/lgpd-producao/ddl-aprovado.md` §2.1.0, §2.1, §2.2 asserção (c), §2.5, §2.6 V9–V12, §5.3
- `ADR-20260821-anonimizacao-em-vez-de-exclusao.md` (decisão-mãe da lápide)
- `ADR-20260817-serie-eager-e-cancelamento-suave.md` (por que apagar `job_series` não fere `jobs`)
- Migrations dos dependentes encontrados: `20260623000000`, `20260623000100`, `20260817000300`,
  `20260817000400`, `20260817001300`, `20260817001400`, `20260817001500`, `20260817001600`
- **Não libera aplicação.** H1/H2 (§5) seguem pendentes do owner.
