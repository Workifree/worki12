# ADR-20260821 — Disponibilidade do freela: grade `jsonb` em `workers`, validada por CHECK

## Status

ACEITO (gate de arquitetura da F7, `disponibilidade-freela`, 21/08/2026)

DDL aprovado (contrato do builder): `.harness/spec/disponibilidade-freela/ddl-aprovado.md`

---

## Contexto

O Chamado de Turno (F1) resolveu o disparo simultâneo, mas dispara **às cegas**: chama o elenco
inteiro sem saber quem trabalha de manhã, quem só à noite, quem tem outro emprego na terça. O custo
é duplo — ruído para o freela (que deixa de abrir o app) e taxa de aceite artificialmente baixa (a
empresa conclui "ninguém quer trabalhar" quando chamou as pessoas erradas). O dado também é o
insumo do ranking de descoberta automática (SOS) que vem depois: sem disponibilidade declarada,
"quem provavelmente aceita" é chute.

Já existe `workers.availability` (períodos soltos, sem dia da semana), coletada uma vez no passo 3
do `WorkerOnboarding` e **nunca mais editável**. Ela não responde "quem pode vir nesta terça de
manhã" e, por ser write-once, só pode envelhecer.

Quatro fatos do estado real do sistema condicionaram a decisão:

1. A leitura acontece **dentro do `ShiftCallModal`**, que abre às 8h30 sob pressão, e o dado chega
   junto do roster já carregado (`team_connections` → embed `worker:workers(...)`).
2. `GRANT SELECT, INSERT, UPDATE ON public.workers TO authenticated` é **de tabela, sem lista de
   colunas** (`20260816120000:175`) — o client escreve qualquer coluna direto via PostgREST.
3. A tabela `jobs` **não é definida por migration** neste repositório; `start_date` é `timestamptz`
   e o dia civil do turno vem de uma **convenção** (âncora de meio-dia local), não de um contrato.
4. O mesmo `ShiftCallModal` já carrega busca, "todos", chips de listas (F2) e o selo de risco de
   vínculo (F5), e vai receber o aviso de certificação (F8).

---

## Decisão

**1. A grade vive em `workers.availability_days jsonb NULL`** — objeto `{'0'..'6': ['manha' |
'tarde' | 'noite']}`, 0 = domingo (convenção de `job_series.weekdays`). Chave ausente = não
declarado para o dia (neutro). Coluna `NULL` = nunca declarou.

**2. A forma é garantida por um CHECK nomeado, não pelo client** —
`workers_availability_days_shape`, expressão pura (containment `<@` contra a grade universo + sete
limites de cardinalidade), sem função de usuário e sem subquery.

**3. Nenhuma policy nova, nenhum GRANT novo.** Leitura herda
`workers_select_self_or_related` / `can_view_worker_profile`; escrita herda
`USING (id = auth.uid()) WITH CHECK (id = auth.uid())`.

**4. Coexistência com o campo legado, com fonte da verdade declarada:**
`availability_days` é a **única** fonte de qualquer decisão automática (ordenação hoje, ranking
depois); `availability` é legado de exibição. **Sem backfill, em nenhuma direção.** A regra está
gravada em `COMMENT ON COLUMN` nas duas colunas.

**5. A conversão de dia-da-semana fica no client** (`lib/dateUtils.ts:getWeekdayIndex`, sobre
`parseDateOnly`), não no banco.

**6. Sem índice** nesta fatia.

---

## Consequências

### Positivas

- **Zero query nova no caminho das 8h30.** A grade viaja como mais uma coluna do embed que o roster
  já faz — o argumento central da feature (a F5, ao lado, precisou de uma RPC agregada).
- **`NULL` continua significando "nunca declarou"** sem coluna sentinela extra — é exatamente o que
  o CTA de adoção no Dashboard testa.
- **Lixo não entra.** Com o grant de tabela, o CHECK é a única validação real; ele barra
  `{"lixo":true}`, `{"99":[...]}`, `{"2":"manha"}`, `'"texto"'`, o JSON `null` literal e o inchaço
  por duplicata. Teto real da coluna: ~250 bytes.
- **Privacidade sem trabalho novo e sem ampliação de superfície:** RLS é row-level, então a
  disponibilidade fica exatamente tão exposta quanto CPF/telefone/PIX da mesma linha — nunca mais.
- **Reversível em dois comandos** (`DROP CONSTRAINT` + `DROP COLUMN`), sem reescrita de heap.
- **Extensível sem migration** para um 4º período ou granularidade maior — só o CHECK muda.
- **Article 8 e 9 intactos por construção:** nenhuma tabela financeira, nenhuma RPC, nenhum trigger,
  nenhum valor monetário.

### Negativas / Trade-offs

- **A validação de forma é uma expressão SQL de ~15 linhas** em vez de uma coluna tipada. Legível,
  mas é conhecimento que mora num CHECK e precisa ser mantido em sincronia com o tipo TypeScript.
- **O banco não consegue filtrar/ordenar por disponibilidade com eficiência** enquanto não houver
  GIN. Aceito de propósito: hoje ninguém filtra. Quando o SOS precisar, entra
  `CREATE INDEX CONCURRENTLY ... USING gin` (fora de transação, via psql).
- **Duas colunas de "disponibilidade" na mesma linha** — ambiguidade permanente para quem abrir a
  tabela. Mitigada por `COMMENT` nas duas, não eliminada. A unificação fica para quando o modelo
  novo tiver adoção.
- **A ordem de deploy vira gate.** PostgREST devolve `42703` e derruba a query inteira: frontend
  antes da migration significa elenco vazio no modal das 8h30 **e** salvamento de perfil quebrado.
- **O dia da semana depende de uma convenção, não de um contrato** (âncora de meio-dia). Escolha
  consciente: ficar igual ao resto do app vale mais que ficar isoladamente mais correto — um selo
  que discorda da data impressa ao lado destrói a confiança no sinal.
- **O card do `ShiftCallModal` fica com duas linhas ocupadas** (nome = F5, cargo = F7). A F8 herda o
  problema de espaço; por isso a F7 entrega um contêiner de sinais, não um selo solto.

---

## Alternativas rejeitadas

- **21 colunas booleanas (`avail_0_manha` … `avail_6_noite`):** o único desenho que dispensa CHECK
  (o tipo já valida) e o único indexável de graça. Rejeitado por dois motivos, nesta ordem: (i) para
  preservar "nunca declarou" ≠ "declarou que não", os 21 booleanos teriam de ser nullable — 21
  NULLs de três significados é pior de raciocinar que um objeto — ou exigiriam uma coluna sentinela
  (`availability_declared_at`), trocando 1 coluna por 22; (ii) 21 nomes na lista de `select` do
  roster e 21 no `updates` do `Profile`, com +7 a cada período futuro.
- **Bitmask `int` (21 bits):** o mais compacto e indexável. Rejeitado por opacidade: `1234567` é
  ilegível no Studio e em log, e a ordem dos bits é exatamente a classe de bug (off-by-one de dia da
  semana) de que este projeto já tem cicatriz documentada. Além disso o CHECK só conseguiria limitar
  o intervalo, não o significado — validaria menos que o `jsonb`, não mais. Depurar isso às 8h30 é
  inviável.
- **Tabela filha `worker_availability (worker_id, weekday, period)`:** o desenho normalizado
  "correto". Rejeitado pelo critério que decide esta feature — o caminho de leitura. Custaria uma
  segunda query ou um embed de dois níveis no roster mais quente do produto, **e** uma tabela nova
  significa policies novas em cima de `can_view_worker_profile` (o oposto da promessa "zero policy
  nova"), com risco de recursão de policy do tipo que a F1 já pagou (42P17) e que a F2 evitou de
  propósito. Ganho real: zero, porque ninguém consulta a grade fora do contexto de um worker.
- **Validador `LANGUAGE sql` chamado pelo CHECK:** mais legível que a expressão. Rejeitado porque
  CHECK que depende de função de usuário é foot-gun conhecido — `CREATE OR REPLACE` endurece a regra
  sem revalidar as linhas já gravadas, e a ordem de restore do `pg_dump` passa a importar. Expressão
  pura não tem dependência, ordem, nem versão.
- **Derivar o dia da semana no banco (`AT TIME ZONE 'America/Sao_Paulo'`), como a F5 fez com a
  janela semanal:** rejeitado, e a diferença é a regra que fica para as próximas features —
  *conversão de fuso vai para o banco quando decide QUAIS LINHAS entram (F5: agregar turnos que o
  client não enxerga sob RLS); fica no client quando só rotula uma linha que já está na tela (F7: o
  turno que o modal está renderizando)*. Fazer no banco custaria uma query nova e poderia discordar
  da data impressa no mesmo card.
- **Backfill de `availability_days` a partir de `availability`:** rejeitado duas vezes. Inventaria
  dia da semana que o freela nunca declarou (o legado só tem período) e o `ShiftCallModal` passaria
  a ordenar por essa invenção; e apagaria o CTA de adoção (`IS NULL`) para a base inteira no dia do
  lançamento — a feature morreria antes de começar.
- **Filtrar em vez de ordenar no modal:** fora do escopo do ADR (decisão de produto já tomada), mas
  o desenho a sustenta sem custo: o sort é estável e roda sobre uma cópia, então quem não declarou e
  quem declarou outro período ficam no mesmo patamar, e ninguém desaparece da lista.

---

## Referências

- DDL aprovado: `.harness/spec/disponibilidade-freela/ddl-aprovado.md`
- Spec: `.harness/spec/disponibilidade-freela/spec.md`
- Migration alvo: `supabase/migrations/20260817001200_worker_availability_days.sql`
- Precedentes: `20260816120000_workers_select_by_relationship.sql` (RLS e grants de `workers`),
  `20260817000400_job_series.sql` (convenção 0=domingo e âncora de meio-dia),
  `.harness/spec/guarda-vinculo/ddl-aprovado.md` (F5 — grant de tabela em `companies`, CHECK como
  única validação, contagem no banco)
