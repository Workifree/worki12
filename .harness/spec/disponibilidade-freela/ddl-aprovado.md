# DDL aprovado — Disponibilidade declarada pelo freela (F7, `disponibilidade-freela`)

> **Este arquivo é o contrato.** O que está aqui é o que foi aprovado no gate do architect
> (21/08/2026). O builder implementa **isto**, não a proposta original do `spec.md` — onde os dois
> divergem, este arquivo vence, e a divergência está justificada em
> `.harness/memory-bank/decisions/ADR-20260821-disponibilidade-grade-jsonb.md`.
>
> Motivo de existir: na F3 o DDL do gate ficou só no relatório, não chegou ao ADR, e o builder
> implementou sem uma peça de segurança — achado HIGH que só apareceu na revisão. Desde a F5 o
> DDL é arquivo, e a migration sai byte a byte igual ao aprovado.

---

## 0. O que muda em relação ao `spec.md`

| Spec original | Aprovado | Por quê (resumo) |
|---|---|---|
| R1: `CHECK (availability_days IS NULL OR jsonb_typeof(...) = 'object')` | **CHECK com containment `<@` contra a grade universo + 7 limites de cardinalidade** | `GRANT SELECT, INSERT, UPDATE ON public.workers TO authenticated` é **de tabela, sem lista de colunas** (verificado — `20260816120000:175`). O client escreve a coluna direto via PostgREST: o CHECK é a **única** validação real. `jsonb_typeof='object'` aceita `{"lixo":true}`, `{"99":[...]}`, chave com 400 posições e blob de MB. |
| R1: "validação de enum fica no client, como `roles`/`tags`" | **Enum de período e domínio de dia validados no banco** | `roles`/`tags` são texto livre por natureza; esta grade é uma **chave de decisão** (ordena o disparo hoje, alimenta ranking depois). Lixo aqui não é cosmético — é decisão errada. |
| R5: `periodForTime(time: "HH:MM")` | **Aceitar `HH:MM` E `HH:MM:SS`** | `work_start_time` é `time` no Postgres e chega dos dois jeitos no código real: `'18:00'` (`ShiftCallModal.test.tsx:103`) e `'20:00:00'` (`InviteToShiftModal.test.tsx:143`); a UI já faz `.slice(0,5)` para renderizar. A8 do spec não cobre `"20:00:00"` — **cobrir**. |
| R6: "`available` ganha um sort" | **Novo memo `ordered`, derivado de `available`; `available` NUNCA é mutado nem reordenado** | `availableWorkerIdsKey` (F5, `ShiftCallModal.tsx:~110`) é `available.map(...).join(',')` e é dependência do efeito que dispara a RPC de contagem. Ordenar `available` muda essa chave e **redispara a RPC da F5**. |
| — (spec silencia) | **Ordem de deploy é gate: migration ANTES do frontend** | PostgREST devolve `42703` e **derruba a query inteira** quando o `select` nomeia coluna inexistente. Sem a coluna: roster vazio no `ShiftCallModal` às 8h30 **e** `handleSave` do `Profile` falha por completo. Ver §5 (LM-1). |
| — (spec silencia) | **Proibido backfill de `availability_days` a partir de `availability`** | O CTA da R14 é `availability_days IS NULL`. Qualquer backfill mata o CTA para a base inteira no dia do lançamento — e fabrica dia-da-semana que o freela nunca declarou (o legado não tem dia). Ver §5 (LM-6). |

Confirmado e inalterado: **`jsonb` é a estrutura certa** (ver ADR, decisão 1), **zero policy nova**
(§2), **0 = domingo** (convenção de `job_series.weekdays`), **ordena, nunca filtra**, **zero query
nova**, **Article 8 intacto** (§6).

---

## 1. Migration

**Arquivo:** `supabase/migrations/20260817001200_worker_availability_days.sql`
(aplicadas em produção vão até `20260817000800`; `...000900` está reservada pela F5 e `...001100`
pela F6, ambas escritas e ainda não aplicadas — esta é a próxima livre)

```sql
-- Migration: Disponibilidade declarada pelo freela — grade dia × período (F7)
-- File: supabase/migrations/20260817001200_worker_availability_days.sql
-- Spec: .harness/spec/disponibilidade-freela/spec.md
-- DDL aprovado: .harness/spec/disponibilidade-freela/ddl-aprovado.md
-- ADR: .harness/memory-bank/decisions/ADR-20260821-disponibilidade-grade-jsonb.md
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ
-- ============================================================================
--   (a) `workers` ganha UMA coluna nullable: `availability_days jsonb`.
--   (b) Um CHECK nomeado que trava a FORMA do jsonb (domínio de dia, enum de período,
--       cardinalidade) — porque o client escreve esta coluna direto (ver seção seguinte).
--   (c) Dois COMMENT: um documentando a coluna nova, outro marcando o campo LEGADO
--       `workers.availability` como legado/write-once, para o próximo que abrir a tabela não
--       ficar em dúvida sobre qual dos dois manda.
--
--   NÃO cria tabela. NÃO cria função. NÃO cria trigger. NÃO cria índice. NÃO cria policy.
--   NÃO altera GRANT. NÃO faz backfill. NÃO toca `availability` (dado legado preservado).
--
-- ============================================================================
-- POR QUE O CHECK É GORDO (e não `jsonb_typeof = 'object'`)
-- ============================================================================
--   O grant vigente é de TABELA, sem lista de colunas:
--       GRANT SELECT, INSERT, UPDATE ON public.workers TO authenticated;   -- 20260816120000:175
--   Ou seja: o freela autenticado faz `PATCH /rest/v1/workers?id=eq.<ele>` com QUALQUER corpo
--   JSON nesta coluna. A policy de UPDATE (`id = auth.uid()`) decide QUEM escreve, nunca O QUÊ.
--   Não há trigger, não há RPC, não há Edge Function no caminho. Logo o CHECK é a ÚNICA
--   validação que existe de verdade — a validação no client é UX, exatamente como a RLS é a
--   primeira linha de defesa e o filtro no client é só UX (Article 4).
--
--   O CHECK abaixo é uma expressão pura (nenhuma função de usuário, nenhuma subquery). Foi
--   escolhido de propósito em vez de um validador `LANGUAGE sql`: CHECK que depende de função
--   de usuário é um foot-gun conhecido (o Postgres NÃO revalida as linhas existentes quando a
--   função é substituída com CREATE OR REPLACE, e a ordem de restore de um pg_dump passa a
--   importar). Expressão pura não tem dependência, não tem ordem, não tem versão.
--
--   O que cada pedaço trava:
--     jsonb_typeof(...) = 'object'
--         Rejeita `'"texto"'`, `'[1,2]'`, `'123'` e — de propósito — o JSON `null` literal.
--         "Não declarou" tem que ser SQL NULL, porque é isso que o CTA do Dashboard (R14)
--         testa (`availability_days IS NULL`). Duas representações de "vazio" quebrariam a R14.
--     ... <@ '{"0":["manha","tarde","noite"], ... "6":[...]}'::jsonb
--         Containment de jsonb: toda chave presente tem que existir no universo (⇒ só '0'..'6',
--         mata `{"lixo":true}` e `{"99":[...]}`) e todo valor tem que estar CONTIDO no array de
--         períodos (⇒ só 'manha'|'tarde'|'noite'). A exceção do Postgres que deixa um escalar
--         ser contido por um array vale SÓ no nível de topo, não aninhado — então
--         `{"2":"manha"}` (string onde devia ter array) é REJEITADO. Array vazio (`{"2":[]}`)
--         passa: significa "declarei este dia e não marquei período", inofensivo.
--     coalesce(jsonb_array_length(availability_days -> 'N'), 0) <= 3
--         Containment permite duplicata (`["manha","manha","manha",...]` continua contido).
--         Sem este limite, o freela pode gravar megabytes na PRÓPRIA linha — e essa linha é
--         lida no roster de TODA empresa do elenco dele, no caminho mais quente do produto
--         (o modal das 8h30). Chave ausente -> `->` devolve NULL -> coalesce 0 -> passa.
--     Teto real da coluna com este CHECK: 7 chaves × 3 períodos ≈ 250 bytes.
--
-- ============================================================================
-- POR QUE NENHUM GRANT NOVO (landmine da F5, mesma conclusão)
-- ============================================================================
--   NÃO escrever `GRANT UPDATE (availability_days) ON public.workers TO authenticated`.
--   GRANT por coluna é ADITIVO: enquanto existir o grant de tabela, ele não restringe nada —
--   é decoração que engana a próxima revisão. E o `REVOKE UPDATE ON public.workers FROM
--   authenticated` que o tornaria efetivo **derrubaria a edição de perfil inteira do freela**
--   (nome, cidade, bio, PIX, foto — `Profile.tsx:handleSave`). Foi exatamente a conclusão do
--   gate da F5 para `companies`. Se um dia o projeto quiser grant por coluna em `workers`, isso
--   é uma migration própria, com a lista COMPLETA de colunas editáveis, e não cabe nesta fatia.
--   Também NÃO usar `REVOKE ALL ... FROM PUBLIC` em tabela: 20260318000000 documenta que isso
--   derrubou o service_role.
--
-- ============================================================================
-- POR QUE SEM ÍNDICE
-- ============================================================================
--   Não existe nenhuma query que filtre por esta coluna. A leitura é sempre "a linha inteira do
--   worker, dentro de um roster já carregado" (o embed `worker:workers(...)` de
--   `TeamConnectionService.listTeamMembers`). Um GIN aqui seria custo de escrita puro. Quando o
--   ranking automático (SOS) precisar de `WHERE availability_days @> ...` no servidor, aí sim:
--       CREATE INDEX CONCURRENTLY idx_workers_availability_days
--           ON public.workers USING gin (availability_days);
--   (fora de transação — migrations do Supabase rodam em transação, então isso vai por psql).
--
-- Article 8: INTACTO. Nenhuma tabela financeira (`wallets`, `wallet_transactions`,
--   `escrow_transactions`, `shift_payments`) é lida ou escrita. Nenhuma RPC de saldo é criada
--   ou alterada. Nenhum valor monetário aparece nesta migration.
--
-- Risk: LOW. Coluna nova, nullable, sem default, sem backfill, sem reescrita de heap.
-- Backup required before production deploy: NO.
--
-- DOWN (rollback):
--   ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_availability_days_shape;
--   ALTER TABLE public.workers DROP COLUMN IF EXISTS availability_days;
-- ============================================================================

-- =============================================
-- 1. COLUNA
--    Nullable, sem DEFAULT: NULL = "nunca declarou" (estado inicial de toda a base, e a
--    condição do CTA da R14). ADD COLUMN nullable sem default não reescreve a tabela.
-- =============================================
ALTER TABLE public.workers
    ADD COLUMN IF NOT EXISTS availability_days jsonb;

-- =============================================
-- 2. CHECK DE FORMA
--    `ADD CONSTRAINT` não tem IF NOT EXISTS -> DROP IF EXISTS antes, para a migration ser
--    idempotente (rodar duas vezes não pode falhar).
--    Sem NOT VALID: a coluna acabou de nascer, toda linha existente tem NULL, a validação é
--    trivialmente satisfeita e o scan é irrelevante na escala do piloto. (Em tabela grande com
--    dado preexistente o padrão seria ADD ... NOT VALID + VALIDATE CONSTRAINT depois — não é o
--    caso aqui, e constraint NOT VALID esquecida é armadilha pior.)
-- =============================================
ALTER TABLE public.workers
    DROP CONSTRAINT IF EXISTS workers_availability_days_shape;

ALTER TABLE public.workers
    ADD CONSTRAINT workers_availability_days_shape CHECK (
        availability_days IS NULL
        OR (
            jsonb_typeof(availability_days) = 'object'
            AND availability_days <@ '{
                  "0": ["manha","tarde","noite"],
                  "1": ["manha","tarde","noite"],
                  "2": ["manha","tarde","noite"],
                  "3": ["manha","tarde","noite"],
                  "4": ["manha","tarde","noite"],
                  "5": ["manha","tarde","noite"],
                  "6": ["manha","tarde","noite"]
                }'::jsonb
            AND coalesce(jsonb_array_length(availability_days -> '0'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '1'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '2'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '3'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '4'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '5'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '6'), 0) <= 3
        )
    );

-- =============================================
-- 3. DOCUMENTAÇÃO NA PRÓPRIA TABELA
--    O COMMENT do campo legado não é cosmético: a partir desta migration existem DOIS campos
--    chamados "disponibilidade" na mesma linha, e quem abrir a tabela daqui a seis meses precisa
--    saber, sem ler o repositório, qual dos dois manda numa decisão.
-- =============================================
COMMENT ON COLUMN public.workers.availability_days IS
    'F7 — grade de disponibilidade declarada pelo freela. Objeto jsonb: chave = dia da semana '
    'como texto ''0''(domingo)..''6''(sabado), MESMA convencao de job_series.weekdays; valor = '
    'array de periodos, subconjunto de [''manha'',''tarde'',''noite''] (madrugada dobrada em '
    'noite). Chave ausente = NAO DECLARADO para aquele dia (neutro, nunca "indisponivel"). '
    'Coluna NULL = nunca declarou nada (condicao do CTA no Dashboard do worker). Escrita SOMENTE '
    'pelo proprio freela (policy de UPDATE id = auth.uid()); a forma e garantida pelo CHECK '
    'workers_availability_days_shape, que e a UNICA validacao real (o grant de UPDATE e de '
    'tabela, o client escreve direto). E SINAL, NUNCA TRAVA: so reordena o ShiftCallModal, nunca '
    'filtra, nunca bloqueia disparo. Nao toca saldo (Article 8).';

COMMENT ON COLUMN public.workers.availability IS
    'LEGADO (pre-F7, write-once no passo 3 do WorkerOnboarding, nunca editavel). Periodos soltos, '
    'SEM dia da semana — nao responde "quem pode vir nesta terca de manha". Mantido intacto por '
    'compatibilidade e para nao destruir dado ja coletado. NAO e fonte de verdade para nenhuma '
    'decisao automatica: quem manda em ordenacao/ranking/aviso e availability_days. Nao ha '
    'backfill de um para o outro (o legado nao tem dia; inventar dia seria mentira, e preencher '
    'availability_days mataria o CTA de adocao da F7 para a base inteira).';
```

---

## 2. RLS — confirmação (nenhuma policy nova, e por quê está certo)

**Leitura (R2/A6) — CONFIRMADO.** Policy vigente (verificada em `20260816120000:164`):

```sql
CREATE POLICY "workers_select_self_or_related" ON public.workers
    FOR SELECT TO authenticated
    USING (public.can_view_worker_profile(id));
```

RLS no Postgres é **row-level**: a policy admite ou nega a **linha inteira**, coluna nova inclusa,
sem uma linha de trabalho a mais. Quem lê `availability_days` é exatamente quem já lê `cpf`,
`birth_date`, `phone` e `pix_key` da mesma linha: o próprio freela, empresa com `team_connections`
em `pending`/`accepted`, ou empresa com vínculo operacional via `applications`. `blocked` (veto do
freela) não concede leitura.

**A disponibilidade é estritamente MENOS sensível que os vizinhos de linha** (é preferência de
agenda, não identificador nem instrumento de pagamento) e não amplia superfície nenhuma: não existe
caminho em que ela seja legível por alguém que já não lê CPF e PIX daquele freela. A pergunta do
gate ("não fica mais exposta que telefone/PIX?") tem resposta formal: por construção de RLS
row-level, a exposição é **idêntica**, nunca maior.

**Escrita (R3/A7) — CONFIRMADO, verificado, não presumido.** Policies vigentes
(`20260309000000:17-25`), nunca substituídas por migration posterior:

```sql
CREATE POLICY "Workers can update their own profile" ON workers
    FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Workers can insert their own profile" ON workers
    FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
```

Não há policy de UPDATE para empresa em `workers`. Não há RPC nem Edge Function que escreva
`availability_days`. Conclusão: **só o próprio freela escreve, só a própria linha** — A7 passa sem
DDL novo. `service_role` mantém `GRANT ALL` e bypassa RLS (sem `FORCE ROW LEVEL SECURITY`), como
desde `20260318000000`.

O que a policy **não** decide é *o quê* se escreve — daí o CHECK da §1.

---

## 3. Contrato consumido pelo frontend

### 3.1 `types/index.ts`

```ts
export type AvailabilityPeriod = 'manha' | 'tarde' | 'noite';
export type AvailabilityWeekday = '0' | '1' | '2' | '3' | '4' | '5' | '6';
export type AvailabilityDays = Partial<Record<AvailabilityWeekday, AvailabilityPeriod[]>>;
```

`WorkerProfile` ganha `availability_days?: AvailabilityDays | null;` — **opcional** (`?`) porque nem
toda query traz a coluna, e `| null` porque "nunca declarou" é um valor de verdade e não o mesmo que
"não pedi essa coluna". Mesma disciplina já escrita nos campos da F5 em `CompanyProfile`.

Dívida pré-existente que **não** se corrige aqui: `WorkerProfile.availability` está tipado `string`
mas o dado gravado por `WorkerOnboarding` é `string[]` (`Profile.tsx:68` já contorna com um tipo
local). Não confundir os dois campos; não "consertar" o legado nesta fatia.

### 3.2 `lib/availability.ts` — `periodForTime`

Aceita **`HH:MM` e `HH:MM:SS`**. Implementação exigida: regex ancorada nos dois primeiros grupos
(`/^(\d{1,2}):(\d{2})/`), validar `0 <= hh <= 23` e `0 <= mm <= 59`, e só então bucketizar:
`05:00–11:59` → `'manha'`; `12:00–17:59` → `'tarde'`; `18:00–04:59` → `'noite'`. Qualquer outra
coisa (`null`, `undefined`, `''`, `'abc'`, `'99:00'`) → `null`.

Casos obrigatórios no Vitest, **somados** aos de A8 do spec:
`periodForTime('20:00:00')` → `'noite'`; `periodForTime('08:00:00')` → `'manha'`;
`periodForTime('12:00')` → `'tarde'`; `periodForTime('17:59')` → `'tarde'`;
`periodForTime('18:00')` → `'noite'`; `periodForTime('04:59')` → `'noite'`;
`periodForTime('05:00')` → `'manha'`; `periodForTime('99:00')` → `null`;
`periodForTime('abc')` → `null`.

### 3.3 `lib/dateUtils.ts` — `getWeekdayIndex`

```ts
export function getWeekdayIndex(isoOrDateOnly: string): number  // 0=domingo .. 6=sábado
```
Corpo obrigatório: `parseDateOnly(isoOrDateOnly).getDay()`. **Nunca** `new Date(iso).getDay()` cru —
o cabeçalho do arquivo já documenta a cicatriz de off-by-one que isso produz em BRT.

Onde mora a conversão de fuso, e por que no client (a pergunta 6 do gate):

- `jobs.start_date` é `timestamptz`, servidor em UTC, e **`jobs` nem sequer é definida por migration
  neste repositório** (confirmado em `20260816150000:101`) — não há CHECK, não há constraint, não há
  contrato de banco sobre o horário gravado.
- O que existe é uma **convenção**: todo turno é gravado com âncora de meio-dia local
  (`localDateToTimestamp`, `dateUtils.ts:69`, usada em `CompanyCreateJob.tsx:298` e na materialização
  das séries da F3). Meio-dia dá ±3h de folga: em qualquer fuso brasileiro a parte de data da string
  ISO devolvida pelo PostgREST é o dia civil pretendido.
- **Todo o resto do app já deriva o dia civil assim** (`formatDateOnly` → `parseDateOnly` →
  `split('T')[0]`): recibo, agenda, `jobScheduling`, cartão do turno. Se a F7 derivasse o dia da
  semana no banco (`AT TIME ZONE 'America/Sao_Paulo'`), ela poderia discordar da data impressa 3px ao
  lado — um selo "Disponível" de terça num card que diz quarta. **Uniformemente igual ao resto vale
  mais que isoladamente mais correto**: um selo que discorda da própria tela destrói a confiança no
  sinal.
- E fazer no banco custaria uma query nova, matando a economia que é o argumento central da R7.

**Reconciliação obrigatória com a F5** (o security-reviewer vai comparar os dois gates e achar que se
contradizem): a F5 mandou a janela da semana para o **banco**; a F7 mantém o dia da semana no
**client**. Não é incoerência, são problemas diferentes. A F5 precisava **agregar linhas que o client
não enxerga** (contar turnos da empresa inteira sob RLS) — quem define a janela tem de ser quem
enxerga as linhas. A F7 precisa do dia da semana de **um único turno que o client já está
renderizando na tela** — dado já presente, zero linhas invisíveis envolvidas. Regra derivada, para o
próximo: *conversão de fuso vai para o banco quando decide QUAIS LINHAS entram; fica no client quando
só rotula uma linha que já está na tela.*

**Landmine residual aceita conscientemente (LM-4):** a âncora de meio-dia é convenção, não garantia.
Se algum caminho futuro gravar `start_date` com hora real (ex.: turno das 22:00 → 01:00Z do dia
seguinte), o dia da semana anda um. Mitigação barata e **recomendada** (não bloqueante): quando o
turno for ocorrência de série, preferir `jobs.series_occurrence_date` (é `date` puro, imune à âncora)
e só cair em `start_date` na ausência dela — exige acrescentar `series_occurrence_date?: string | null`
ao `Pick<Job, ...>` da prop do modal.

### 3.4 `TeamConnectionService.listTeamMembers()`

Acrescentar `availability_days` à lista de colunas do embed `worker:workers ( ... )` **que já
existe** (`teamConnectionService.ts:479`) — sem mudar a forma da query, sem query nova, sem
round-trip novo. Não tocar o segundo embed (`:537`, usado por outra tela, fora de escopo da F7).

### 3.5 `ShiftCallModal.tsx` — como F7 entra sem esbarrar na F5

```ts
const weekday = useMemo(() => getWeekdayIndex(job.start_date), [job.start_date]);
const period  = useMemo(() => periodForTime(job.work_start_time), [job.work_start_time]);

const availableIds = useMemo(
  () => new Set(
    period === null
      ? []
      : available.filter(m => isWorkerAvailableFor(m.worker.availability_days, weekday, period))
                 .map(m => m.worker.id),
  ),
  [available, weekday, period],
);

// `ordered` é uma CÓPIA. `available` continua intacto e na ordem original.
const ordered = useMemo(() => {
  if (availableIds.size === 0) return available;              // A4/A11: MESMA referência
  return [...available].sort(
    (a, b) => Number(availableIds.has(b.worker.id)) - Number(availableIds.has(a.worker.id)),
  );
}, [available, availableIds]);
```

Regras não-negociáveis desta integração:

1. **`available` nunca é reordenado nem mutado.** `availableWorkerIdsKey` (F5) deriva dele e é
   dependência do efeito que chama `countForShift`. Reordenar em lugar faz a chave mudar e **a RPC da
   F5 redisparar** a cada render — regressão de performance no caminho exato que a F5 gastou dois
   landmines (LM-9/LM-10) para proteger. A renderização passa a iterar `ordered`; todo o resto
   (seleção, chips de lista, contagem, busca) continua sobre `available`.
2. **`Array.prototype.sort` é estável** (ES2019 em diante) — é o que garante A3: dentro de cada grupo
   (match / não-match) a ordem relativa não muda, então quem não declarou e quem declarou outro
   período ficam exatamente no mesmo patamar, sem diferenciação visual nem de ordem.
3. **Sem horário conhecido, mesma referência de array** (`period === null` → `availableIds` vazio →
   retorna `available` em si, não uma cópia ordenada). A4 pede ordem *idêntica*; devolver a mesma
   referência também evita re-render de filhos memoizados.
4. **F7 não lê nada da F5.** Não depende de `riskCounts`, não espera `riskLoading`, não entra no
   `Promise.allSettled`. O dado da F7 chega **junto do roster**, é síncrono a partir de `members`, e
   por isso o selo e a ordem têm de aparecer **no primeiro paint**, com a contagem da F5 ainda em voo.
   A recíproca também vale: a ordem da F7 **não pode** depender de dado assíncrono, ou a lista pula
   sozinha na tela quando a RPC da F5 aterrissar — justamente enquanto o gerente clica.
5. **Selo na linha do cargo, não na linha do nome** (R10) — a linha do nome é da F5.

### 3.6 `Profile.tsx`

`handleSave` monta um objeto `updates` explícito (`Profile.tsx:375`), estilo whitelist — acrescentar
`availability_days` ali é uma linha. Manter o `.select('id')` + checagem de `data.length === 0`
(patterns.md: UPDATE negado pela RLS não levanta erro, retorna zero linhas).

Gravar **SQL NULL** (JS `null`) quando o freela desmarcar tudo, nunca `{}` — o CTA da R14 e o CHECK
(que rejeita o JSON `null` literal) dependem de haver **uma** representação de "não declarado".
Podar chaves com array vazio antes de gravar.

---

## 4. Verificação (read-only, depois de aplicar)

```sql
-- (1) Coluna existe, nullable, sem default.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'workers'
   AND column_name IN ('availability', 'availability_days');
-- esperado: availability_days | jsonb | YES | NULL   (e a legada intacta ao lado)

-- (2) O CHECK está lá e VALIDADO.
SELECT conname, convalidated, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.workers'::regclass AND conname = 'workers_availability_days_shape';
-- esperado: convalidated = true

-- (3) O CHECK realmente barra lixo (rodar como o DONO de uma linha; cada um deve dar ERRO 23514).
--     Trocar <ID> por um worker de teste. NÃO rodar em linha de freela real.
-- UPDATE public.workers SET availability_days = '{"lixo": true}'          WHERE id = '<ID>';
-- UPDATE public.workers SET availability_days = '{"9": ["manha"]}'        WHERE id = '<ID>';
-- UPDATE public.workers SET availability_days = '{"2": ["madrugada"]}'    WHERE id = '<ID>';
-- UPDATE public.workers SET availability_days = '{"2": "manha"}'          WHERE id = '<ID>';
-- UPDATE public.workers SET availability_days = '"texto"'                 WHERE id = '<ID>';
-- UPDATE public.workers SET availability_days = 'null'                    WHERE id = '<ID>';
-- UPDATE public.workers SET availability_days =
--        '{"2": ["manha","manha","manha","manha"]}'                       WHERE id = '<ID>';

-- (4) E deixa passar o que é válido.
-- UPDATE public.workers SET availability_days = '{"2": ["manha","tarde"]}' WHERE id = '<ID>';
-- UPDATE public.workers SET availability_days = NULL                       WHERE id = '<ID>';

-- (5) Nada de policy nova / grant novo apareceu por engano.
SELECT policyname, cmd, qual, with_check FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'workers' ORDER BY cmd;
-- esperado: EXATAMENTE 3 — workers_select_self_or_related (SELECT),
--           "Workers can update their own profile" (UPDATE), "Workers can insert..." (INSERT)

SELECT grantee, privilege_type, string_agg(DISTINCT column_name, ',') AS colunas
  FROM information_schema.column_privileges
 WHERE table_schema='public' AND table_name='workers' AND grantee='authenticated'
 GROUP BY grantee, privilege_type;
-- esperado: NENHUMA linha vinda de grant por coluna criado agora (o acesso continua vindo do
--           grant de TABELA). Se aparecer grant por coluna, a migration saiu errada — ver LM-2.

-- (6) Article 8: a migration não encostou em nada financeiro.
--     Conferência textual, não SQL: o arquivo não contém wallets / wallet_transactions /
--     escrow_transactions / shift_payments / balance / amount. `grep -niE` para provar.
```

---

## 5. Landmines (o builder lê esta lista antes de escrever a primeira linha)

**LM-1 — Ordem de deploy é gate, não detalhe. `42703` derruba a query INTEIRA.**
PostgREST não ignora coluna desconhecida no `select`: devolve erro e a requisição inteira falha.
Se o frontend subir antes da migration, acontecem **duas** quebras, não uma: (a)
`listTeamMembers` falha → o `Promise.allSettled` do modal cai no ramo `[]` → **elenco vazio no
`ShiftCallModal` às 8h30**, sem mensagem de erro, exatamente no gesto que a plataforma vende; (b)
`Profile.handleSave` manda `availability_days` no `updates` → **o salvamento inteiro do perfil
falha** (nome, cidade, bio, PIX juntos). Regra: **migration aplicada e verificada em produção
ANTES do deploy do frontend.** Não há fallback esperto que compense — o correto aqui é a ordem.

**LM-2 — Não escrever `GRANT UPDATE (availability_days)`.** É aditivo: não restringe nada enquanto
existir o grant de tabela, e cria a ilusão de proteção para a próxima revisão. Torná-lo efetivo
exigiria `REVOKE UPDATE ON public.workers FROM authenticated`, que **derruba a edição de perfil
inteira do freela**. Mesma conclusão do gate da F5 para `companies`. E jamais
`REVOKE ALL ... FROM PUBLIC` em TABELA (`20260318000000` documenta o estrago no service_role).

**LM-3 — O CHECK é a única validação. Validar de novo no client não substitui, e validar só no
client não vale nada.** Qualquer conta autenticada faz `PATCH /rest/v1/workers` direto, sem passar
pelo `Profile.tsx`. Se alguém "simplificar" o CHECK numa migration futura, a coluna volta a aceitar
lixo silenciosamente e o modal passa a ordenar por dado inventado.

**LM-4 — Dia da semana: `parseDateOnly`, nunca `new Date(iso)`.** E nunca uma segunda derivação de
dia civil. A âncora de meio-dia é convenção (a tabela `jobs` nem é definida por migration): se o dia
for derivado de duas formas diferentes em dois lugares, o selo vai discordar da data impressa ao
lado. Ver §3.3 e a mitigação opcional por `series_occurrence_date`.

**LM-5 — `work_start_time` chega como `HH:MM` E como `HH:MM:SS`.** Está provado nos testes do
próprio repositório (`'18:00'` e `'20:00:00'`). Um `periodForTime` que só entenda `HH:MM` devolve
`null` para metade dos turnos reais e a feature simplesmente não aparece — falha silenciosa, sem
erro, sem log. Testar os dois formatos.

**LM-6 — Proibido backfill.** Não derivar `availability_days` de `availability`: o legado não tem
dia da semana, então qualquer conversão inventa informação que o freela nunca declarou — e o
`ShiftCallModal` passaria a ordenar por essa invenção. Pior: o CTA da R14 é
`availability_days IS NULL`; um backfill o apaga para a base inteira no dia do lançamento, e a
adoção da feature morre antes de começar. Duas fontes, uma só manda: **`availability_days` decide,
`availability` só exibe** (e o COMMENT da §1 grava isso na própria tabela).

**LM-7 — Não reordenar `available` em lugar.** Ver §3.5, regra 1. É acoplamento silencioso com a
F5: muda `availableWorkerIdsKey` e redispara a RPC de contagem a cada render.

**LM-8 — Duas representações de "vazio" quebram a R14.** `null` e `{}` não podem coexistir. O CHECK
já rejeita o JSON `null` literal; cabe ao client podar chaves vazias e gravar SQL `NULL` quando não
sobrar nada. Um `{}` gravado por engano some com o CTA de um freela que nunca declarou.

**LM-9 — Ordem dentro da migration.** Coluna antes do CHECK que a referencia. Nesta migration **não
há função nem tabela nova**, então a armadilha do `LANGUAGE sql` (que valida o corpo no `CREATE` e
exige a tabela criada antes) **não se aplica** — e é justamente por isso que a validação foi feita
com expressão pura em vez de um validador `LANGUAGE sql`: sem função, não há ordem de criação, não
há dependência no `pg_dump`, e não há o risco de um `CREATE OR REPLACE` futuro endurecer a regra sem
revalidar as linhas já gravadas.

**LM-10 — Espaço no card do modal está acabando.** F5 ocupou a linha do nome (selo amarelo + banner
de rodapé + texto de "verificando"), F7 ocupa a linha do cargo, e a F8 (certificações) já está na
fila querendo um aviso no mesmo card. A F7 deve renderizar seu selo dentro de um **contêiner de
sinais** na linha secundária (um `<span>` que aceite vizinhos), não como um elemento solto — para a
F8 entrar ao lado em vez de inventar uma terceira linha. Também: com o card selecionado já pintado
de verde, um pill verde **preenchido** some no fundo; usar contorno (borda + texto) em vez de fill.
E `aria-label` em `<span>` não-interativo não é anunciado de forma confiável — usar texto visível
+ `title`, ou um `sr-only` complementar. Esses três últimos pontos são do `harness-frontend-reviewer`,
não bloqueiam o gate.

**LM-11 — `service_role` intacto.** Nada nesta migration usa `FORCE ROW LEVEL SECURITY` nem mexe nos
grants do `service_role`. Se alguém acrescentar isso "por segurança", quebra as funções DEFINER que
leem `workers` (`recompute_worker_aggregates`, `set_review_direction`,
`accept_company_invite_by_token`, `increment_worker_view`, triggers de notificação).

---

## 6. Article 8 — declaração explícita

A migration é **um `ALTER TABLE ADD COLUMN` + um `CHECK` + dois `COMMENT`** numa tabela de perfil.
Não lê nem escreve `wallets`, `wallet_transactions`, `escrow_transactions` ou `shift_payments`. Não
cria, altera ou concede execução em nenhuma RPC. Não há trigger. Não há valor monetário. Não há
`reference_id`, logo não há questão de idempotência financeira (Article 9). O caminho de leitura da
feature (roster do `ShiftCallModal`) e o de escrita (`Profile.handleSave`) também não tocam saldo.
**Article 8 e Article 9: intactos por construção.**
