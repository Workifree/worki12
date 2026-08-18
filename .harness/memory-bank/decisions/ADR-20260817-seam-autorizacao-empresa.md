# ADR-20260817 — Seam de autorização de empresa: `is_company_owner` ao lado de `is_job_owner`

## Status

ACEITO (2026-08-17) — gate de migration da feature F2 "Listas salvas do elenco"
(`.harness/spec/listas-elenco/spec.md`, R1/R12).

## Contexto

A migration `20260817000100_shift_calls.sql` (F1 — Chamado de Turno) introduziu
`public.is_job_owner(uuid)` e declarou explicitamente, no cabeçalho, que ela é **"a costura por onde o
multi-unidade/gerente (F3) vai passar: muda esta função, muda todo mundo junto"**. Aquele arquivo tinha
uma única âncora de autorização a expressar — "sou dono deste turno?" — e a resolveu com uma função só.

A F2 cria duas tabelas (`team_lists`, `team_list_members`) cuja âncora **não é um turno**: é a empresa
diretamente. Não existe `job_id` no caminho. Aplicar `is_job_owner` aqui é impossível sem inventar um
turno fictício, e inlinar o predicado de ancoragem dupla dentro de cada policy (4 policies em
`team_lists` + 3 em `team_list_members`) reproduziria sete vezes uma regra que `20260816210000` já
documentou como frágil e sujeita a mudança (há linhas em produção com `companies.owner_id` NULL e
outras com `owner_id = id`).

O predicado em questão — a **ancoragem dupla** — é o mesmo nos dois casos:

```
company_id = auth.uid()
OR company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())
```

`is_job_owner` já o carrega embutido. Criar `is_company_owner` significa que esse predicado passa a
existir em **dois** objetos do banco. A pergunta que este ADR fecha não é "criar ou não a função"
(é necessária), mas **onde a costura de autorização de empresa mora daqui pra frente** e o que F3
(multi-unidade/gerente) é obrigado a fazer quando chegar.

Foi considerado, e rejeitado agora, fazer `is_job_owner` delegar para `is_company_owner` — o que
deixaria o predicado num lugar só.

## Decisão

1. **Criar `public.is_company_owner(p_company_id uuid)`**, `SECURITY INVOKER`, `STABLE`,
   `SET search_path = ''`, com a ancoragem dupla. INVOKER porque `public.companies` tem SELECT
   `USING (true)` para `authenticated` desde `20260317160000` — como DEFINER a função devolveria
   exatamente o mesmo resultado ao custo de mais um objeto privilegiado para auditar. Mesmo raciocínio,
   verbatim, que `20260817000100` aplicou a `is_job_owner`.

2. **NÃO refatorar `is_job_owner` para delegar** nesta entrega. Motivo decisivo e não óbvio: o corpo de
   funções SQL escrito como string (`AS $$ ... $$`) **não gera dependência registrada no catálogo**.
   Se `is_job_owner` passasse a chamar `is_company_owner`, um `DROP FUNCTION is_company_owner` (o bloco
   DOWN desta migration) sucederia sem reclamar e `is_job_owner` quebraria **em runtime**, derrubando
   quatro policies de `shift_calls`/`shift_call_targets` e a RPC `cancel_shift_call`. Rollback de F2
   passaria a ser rollback de F1 sem avisar. Ganho funcional da delegação hoje: zero.

3. **Contrato de manutenção conjunta (a parte não-negociável deste ADR):** `is_job_owner` e
   `is_company_owner` são **um par**. São o único ponto do schema onde "esta sessão opera esta empresa"
   é decidido. Qualquer mudança na regra de autorização de empresa — e F3 (multi-unidade/gerente) é
   exatamente isso — **DEVE alterar as duas funções na mesma migration**, e é o momento certo para
   unificá-las (`is_job_owner` passando a delegar, com o DOWN reescrito para refletir a dependência).
   Cada função carrega `COMMENT ON FUNCTION` apontando para a outra e para este ADR.

4. **Escopo de RLS da F2:** `team_lists` — SELECT/INSERT/UPDATE/DELETE, todos sob
   `is_company_owner(company_id)`; `team_list_members` — SELECT/INSERT/DELETE (sem UPDATE), ancorados
   por `EXISTS` em `team_lists` + `is_company_owner`, com a trava de elenco aceito no INSERT espelhando
   `shift_call_targets_insert`. O freela **não** enxerga `team_list_members` (lista é artefato interno
   da empresa). Nenhuma policy de `team_lists` referencia `team_list_members` — é o que mantém o grafo
   de policies acíclico e evita o 42P17 que F1 teve de contornar com dois DEFINER mínimos.

## Consequências

### Positivas

- F2 não depende de nenhum objeto criado por F1. A migration pode ser aplicada em produção **antes,
  depois ou sem** `20260817000100` — propriedade valiosa a dias do piloto, com F1 ainda em PR.
- Duas tabelas novas com RLS fechada desde o nascimento (policies primeiro, `ENABLE` por último,
  `NO FORCE`), sem repetir o histórico de `jobs`, que passou meses com policies inertes.
- Sem objeto `SECURITY DEFINER` novo. A superfície privilegiada da F2 é zero — relevante porque o
  advisor `anon_security_definer_function_executable` (lint 0028) já custou duas migrations
  corretivas (`20260816201420` / `20260816201457`).
- F3 herda um ponto de mudança explícito e documentado, em vez de sete predicados inlinados.

### Negativas / Trade-offs

- **A ancoragem dupla passa a existir em dois lugares.** É o custo aceito, mitigado pelo contrato (3)
  e pelos comentários cruzados. Se F3 alterar só uma das duas, a autorização fica assimétrica — um
  gerente poderia editar listas do elenco sem poder disparar chamados, ou o inverso. Esse é o **modo
  de falha a vigiar**, e ele é silencioso.
- Persiste (não é criada aqui) a divergência de ancoragem com `public.team_connections`, cujas policies
  usam **só** `company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())`, sem o termo
  `company_id = auth.uid()`. Consequência concreta: uma empresa com `companies.owner_id` NULL passaria
  em `is_company_owner` e criaria uma lista, mas todo INSERT em `team_list_members` seria negado (o
  `EXISTS` sobre `team_connections` roda sob a RLS de `team_connections`). Hoje isso é inerte — o
  client resolve o `company_id` por `getAuthenticatedCompanyId()`, que consulta `companies` por
  `owner_id` e lança "Perfil de empresa não encontrado" antes de qualquer tela de elenco carregar. É
  dívida a saldar junto com F3, não nesta entrega.
- `is_company_owner` é chamada por linha nas policies. Custo real desprezível (função SQL STABLE,
  inlinável, termo dominante `= auth.uid()` sem acesso a tabela, fallback por PK de `companies`), mas
  vira item de atenção se listas escalarem para milhares de linhas por empresa.

## Alternativas rejeitadas

- **Inlinar o predicado nas 7 policies (sem função nova):** replica sete vezes uma regra declarada
  instável, e apaga a costura de F3 justamente onde ela mais faz falta.
- **`is_company_owner` como `SECURITY DEFINER`:** não compra nada (`companies` já tem SELECT
  `USING (true)`) e adiciona objeto privilegiado ao inventário de auditoria.
- **Refatorar `is_job_owner` para delegar agora:** funcionalmente idêntico hoje, e transforma o DOWN
  de F2 numa quebra silenciosa de F1 (dependência não registrada em corpo de função SQL como string).
  Fica agendado para a migration de F3, onde as duas mudam juntas de qualquer forma.
- **Reusar `team_connections` com uma coluna/tag de agrupamento em vez de tabelas novas:** sobrecarrega
  a aresta consentida worker↔empresa (que o freela lê e controla, e cuja policy de DELETE guarda o veto
  indelével da `20260816000000`) com um conceito puramente organizacional que só a empresa vê. Um freela
  passaria a enxergar em que "gaveta" a empresa o colocou. Rejeitado por escopo de privacidade e por
  contaminação de uma tabela com regra de consentimento já delicada.
- **Denormalizar `company_id` em `team_list_members`** (para a policy não precisar de subquery em
  `team_lists`): o `WITH CHECK` teria de comparar com o `company_id` da lista de qualquer jeito — a
  subquery volta, e sobra uma coluna que pode divergir.

## Referências

- Spec: `.harness/spec/listas-elenco/spec.md` (R1, R2, R12, A13, A14)
- Migration precedente (costura declarada): `supabase/migrations/20260817000100_shift_calls.sql`
- Ancoragem dupla e por que existe: `supabase/migrations/20260816210000_enable_rls_jobs.sql` +
  `ADR-20260816-rls-desligada-jobs-conversation.md`
- Lição `FORCE RLS` / `REVOKE ALL FROM PUBLIC`: `supabase/migrations/20260318000000_*.sql`
- Lição EXECUTE em função de trigger: `20260816201420` / `20260816201457`
- Constitution Article 8 — intacto: nenhuma tabela ou RPC de saldo/escrow é tocada por esta feature.
