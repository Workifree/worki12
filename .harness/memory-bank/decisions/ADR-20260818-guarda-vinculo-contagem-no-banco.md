# ADR-20260818 — Guarda de vínculo: a contagem mora no banco, não no client

## Status

ACEITO (gate de migration da F5 — `.harness/spec/guarda-vinculo/spec.md`).
DDL aprovado, verbatim: `.harness/spec/guarda-vinculo/ddl-aprovado.md`.

## Contexto

Entrevista de 17/08/2026 (sócio-operador, 10 unidades do Divino Fogão): *"a gente tem um cuidado de
nunca superar o mesmo freelancer trabalhando na loja mais de duas vezes por semana, para evitar a
geração do vínculo trabalhista eventual."* O owner decidiu: limite **configurável por empresa** e o
sistema **avisa, não bloqueia**.

O `spec.md` (R5) propôs resolver isso inteiramente no client: uma query PostgREST agregada
(`applications` → `jobs`, filtro por `worker_id IN (...)` + janela da semana) montada no
`ShiftCallModal` e reduzida a um `Map` em JS, sem função nova no banco — justificando com o
Article 5 (fetch direto) e com "não abrir superfície `SECURITY DEFINER` desnecessária". A janela
da semana (dom–sáb) sairia de uma função nova em `lib/dateUtils.ts`.

Quatro fatos do schema real, verificados neste gate, quebram esse desenho:

1. **`jobs.start_date` é `timestamptz` e o servidor roda em UTC.** "Que semana é esta" é pergunta
   de data local. O client só acerta a data de um turno porque `start_date` é gravado com **âncora
   de meio-dia** (`dateUtils.localDateToTimestamp`) — convenção, não garantia; `parseDateOnly` faz
   `.split('T')[0]` do ISO em UTC. Para um turno gravado com hora real de fim de noite, o client
   erra o dia — e o projeto já tem cicatriz de off-by-one documentada no topo de `dateUtils.ts`.
   O banco já tem a resposta canônica: `public.job_local_date` (`AT TIME ZONE 'America/Sao_Paulo'`).
2. **`jobs.company_id` tem ancoragem dupla** (id da empresa **ou** uid do dono — documentado em
   `20260816210000`), e a policy de SELECT de `applications` ("Companies can view applications for
   their jobs", `20260317160000`) é ancorada **só** em `companies.owner_id`. Uma contagem lida sob
   essa policy pode devolver **menos linhas do que existem**. Numa guarda de segurança, errar para
   menos significa dizer **"sem risco"** quando se quer dizer **"não enxerguei"**.
3. **`ADR-20260816-rls-desligada-jobs-conversation` planeja apertar o SELECT de `jobs`** (Fase 3,
   `can_view_job`). Uma contagem pendurada no `USING (true)` de hoje mudaria de semântica em
   silêncio naquele dia — e ninguém percebe um aviso que parou de aparecer.
4. **A F3 já conta semanas, e conta errado de propósito.**
   `components/company/seriesWeekRisk.ts:weeksOverThreshold` considera **só as ocorrências da
   própria série**, ignorando a carga preexistente do freela, com `DEFAULT_LINK_RISK_THRESHOLD = 2`
   fixo e um comentário dizendo que a F5 substitui isso. Duas implementações de "o que conta como
   uma vez" divergindo é o resultado default se cada tela montar a sua query.

Some-se a restrição de produto: o modal abre **às 8h30**, com a loja abrindo às 11h. Latência aqui
é a diferença entre a feature ajudar e atrapalhar.

## Decisão

**A contagem é uma função Postgres; o client só rotula e decide o que mostrar.**

1. `public.count_worker_shifts_by_week(p_worker_ids uuid[], p_anchor_job_id uuid, p_range_start
   date, p_range_end date)` → `(worker_id, week_start, shift_count)`. `SECURITY DEFINER`,
   `STABLE`, `search_path = ''`, `REVOKE` de `PUBLIC`/`anon`, `GRANT EXECUTE` a `authenticated` e
   `service_role`. **Somente leitura** — não escreve, não notifica, não bloqueia.
2. **Dois modos, um corpo:** âncora (a semana do turno-alvo — `ShiftCallModal`/F5) e intervalo (a
   série inteira — `InviteSeriesModal`/F3). O intervalo é **sempre expandido para semanas
   inteiras** dom–sáb, senão a carga preexistente das pontas some e a F3 repete o próprio bug.
3. **Sem `p_company_id` no contrato.** A empresa é derivada da sessão via
   `public.is_job_owner` — reuso verbatim, honrando o contrato de manutenção conjunta do
   `ADR-20260817-seam-autorizacao-empresa` (nada de uma terceira cópia inline do predicado de
   dono). Não existe tenant forjável no argumento.
4. **Autorização negada levanta exceção**, nunca devolve zero. Zero silencioso é a falha que a
   feature inteira existe para evitar.
5. **Janela em SQL, rótulo em JS.** As fronteiras viram `timestamptz` a partir da data local
   (`(d::text || ' 00:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo'`) — comparação sargable,
   índice btree usado. O client mantém `localWeekStartKey`/`weekRangeLabel` (já testados) apenas
   para exibir; como ambos os lados operam sobre **data-only** (`EXTRACT(DOW)` no SQL, componentes
   locais no JS), não há como divergirem. **Não** se cria
   `getWeekBoundsSundayToSaturday` no client (R3 do spec fica sem efeito).
6. **O que conta como "uma vez":** `applications.status IN ('hired','in_progress','completed')`
   (mesmo conjunto de `claim_shift_slot`) **E `jobs.status <> 'deleted'`**. Turno cancelado por
   soft delete não foi trabalhado e não conta — sem isso, um `stop_job_series` cancelando 60
   ocorrências inflaria a guarda de todo o elenco. O spec não previa esta cláusula.
7. **Configuração em `companies`** (`link_risk_alert_enabled bool NOT NULL DEFAULT true`,
   `link_risk_alert_threshold int NOT NULL DEFAULT 2 CHECK BETWEEN 1 AND 7`), lida por
   `public.my_link_risk_config()`, que **sempre devolve uma linha** e cai em LIGADO/2 quando não
   resolve a empresa (fail-safe na direção do aviso). Sem grant de coluna, sem policy nova: o
   grant de tabela existente (`GRANT SELECT, INSERT, UPDATE ON companies TO authenticated`,
   `20260317150000`) já permite a empresa escrever a própria linha, e a RLS de `companies` já barra
   a alheia — verificado, não presumido.
8. **`DEFAULT_LINK_RISK_THRESHOLD` sobrevive** no client, mudando de papel: de "o limite" para "o
   fallback quando a config não carregou". Seu valor fica acoplado ao `DEFAULT` da coluna, e o
   acoplamento está escrito no `COMMENT ON COLUMN`.

**Article 8 intacto:** nenhuma tabela financeira e nenhuma RPC de saldo é lida ou escrita; não há
trigger nem escrita de qualquer espécie nesta feature. Verificação incluída no DDL aprovado (V9).

## Consequências

### Positivas

- Uma definição só de "o que conta como uma vez", partilhada por F3 e F5. A F3 deixa de ignorar a
  carga preexistente do freela — que é metade do número que a empresa precisa ver.
- Fuso resolvido onde o dado mora. O off-by-one de semana deixa de ser possível por construção.
- Um round-trip para o elenco inteiro (20+ membros), agregado no banco, dentro do `Promise.all`
  que o modal já faz. Latência somada ≈ 0 no caminho das 8h30.
- A contagem não depende da policy de SELECT de `applications` nem do `USING (true)` de `jobs` —
  fica imune à Fase 3 do ADR-20260816 e à ancoragem dupla de `jobs.company_id`.
- Dois índices que pagam por si fora da feature: `idx_applications_job_status` acelera a contagem
  de vagas ocupadas **dentro do lock** de `claim_shift_slot` (hoje sem índice que a cubra no fluxo
  pull).

### Negativas / Trade-offs

- **Mais uma função `SECURITY DEFINER` para auditar.** Mitigação: só leitura, sem parâmetro de
  tenant, autorização explícita por `is_job_owner`, teto de 200 ids, `REVOKE` de `PUBLIC`/`anon`.
- **Desvia do Article 5** (fetch direto) para esta leitura. Não é migração para React Query nem
  precedente para telas — é uma leitura que precisa de fuso, agregação e autorização própria, na
  mesma categoria das RPCs que a F1/F3 já usam.
- **`is_job_owner` é avaliada por linha** no filtro final. Aceitável porque vem depois dos filtros
  indexados (função tem cost 100; o planner a deixa por último) e porque a janela é uma semana.
  Se algum dia ficar quente, o remédio é somar `my_company_ids()` à família do seam — na mesma
  migration que mudar `is_job_owner`, nunca antes.
- **Frontend fica acoplado à migration.** Deploy da Vercel antes da aplicação manual do SQL derruba
  o salvamento do perfil da empresa se o fallback de coluna-ausente não for estendido (LM-5).
- **`companies` tem SELECT `USING (true)`**: qualquer conta autenticada consegue ler o limite
  configurado por qualquer empresa. Baixo impacto (é uma política operacional, não dado pessoal),
  consistente com o estado atual da tabela — mas registrado aqui para não virar surpresa e para
  não servir de precedente para colunas sensíveis.

## Alternativas rejeitadas

- **Query agregada no client (proposta original do spec, R5).** Rejeitada pelos quatro fatos do
  contexto: erra o fuso quando `start_date` não é meio-dia, lê sob uma policy single-anchored que
  pode devolver menos do que existe, quebra em silêncio na Fase 3 do RLS de `jobs`, e deixa a F3
  com uma segunda contagem divergente. Custo de errar: a guarda diz "sem risco" por não enxergar.
- **Função `SECURITY INVOKER`.** Mais barata de auditar, mas herda exatamente a policy
  single-anchored de `applications` e o `USING (true)` de `jobs`. O projeto já decidiu que não
  confia em `companies.owner_id` estar preenchido — é por isso que `is_job_owner`/`is_company_owner`
  nasceram com ancoragem dupla. Construir uma leitura nova sobre a âncora que o projeto já declarou
  não-confiável seria assinar o mesmo bug de novo.
- **Trigger/constraint que impede a contratação acima do limite.** Contraria a decisão do owner e a
  tese (`risco #4`: o Worki é conector/registro, nunca parte do contrato — não decide risco
  jurídico de terceiro).
- **Contar em todas as empresas (visão global do freela).** Contraria R9 e vazaria a agenda do
  freela para a concorrência.
- **`p_company_id` como argumento.** Cria um tenant forjável que só um guard consegue defender;
  derivar da sessão elimina a classe inteira.
- **Materializar a contagem (coluna/tabela agregada mantida por trigger).** Cache invalidável em
  cinco caminhos (aceite, cancelamento, dispensa, soft delete de turno, série parada) para uma
  query que custa milissegundos. Desproporcional, e cada trigger novo é uma escrita a mais perto de
  `applications`.

## Referências

- Spec: `.harness/spec/guarda-vinculo/spec.md`
- DDL aprovado (contrato do builder): `.harness/spec/guarda-vinculo/ddl-aprovado.md`
- Migration: `supabase/migrations/20260817000900_link_risk_guard.sql`
- `ADR-20260817-seam-autorizacao-empresa.md` — contrato de manutenção conjunta de
  `is_job_owner`/`is_company_owner`
- `ADR-20260816-rls-desligada-jobs-conversation.md` — Fase 3 (apertar SELECT de `jobs`)
- `ADR-20260817-serie-eager-e-cancelamento-suave.md` — convenção de âncora de meio-dia e soft delete
- `patterns.md` — "Cancelamento é SOFT DELETE"; "`LANGUAGE sql` valida o corpo no CREATE"
- Migrations de referência: `20260317150000` (grants/RLS de `companies`), `20260317160000`
  (policies), `20260816210000` (ancoragem dupla), `20260817000200` (`claim_shift_slot`),
  `20260817000600` (`job_local_date`, `job_is_active`)
