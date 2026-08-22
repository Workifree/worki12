# DDL aprovado — Indicação de freela entre empresas (F10, `troca-freelas`)

> **Este arquivo é o contrato.** O que está aqui é o que foi aprovado no gate do architect
> (21/08/2026). O builder implementa **isto**, não a proposta original do `spec.md` — onde os dois
> divergem, este arquivo vence, e a divergência está justificada em
> `.harness/memory-bank/decisions/ADR-20260821-indicacao-entre-empresas.md`.
>
> Motivo de existir: o relatório do architect não chega ao builder. Na F3 o DDL do gate ficou só no
> relatório e o builder implementou sem uma peça de segurança — achado HIGH que só apareceu na revisão.

---

## 0. O que muda em relação ao `spec.md`

| Spec original | Aprovado | Por quê (resumo) |
|---|---|---|
| **R11**: A (empresa destino) lê a própria linha de `worker_referrals` por RLS, inclusive `awaiting_worker` | A só lê a linha **depois** de `status='accepted'`. Antes disso, A enxerga a indicação **só** por RPC (`list_worker_referral_cards` / `get_worker_referral_card`), que **omitem `worker_id`** | A linha carrega `worker_id`. De posse do uuid, A faz `INSERT team_connections(company_id=A, worker_id=X, status='pending')` — a policy `tc_insert_company` só exige ser dona e nascer 'pending'. Isso é literalmente "B entregou o freela a A": A passa a poder convidar X pelas costas da indicação, e a decisão do freela vira decorativa. **Achado BLOCKER.** |
| **R1**: status `'blocked_by_veto'` persistido na tabela | Esse valor **não existe** no CHECK. Toda terminação sem aceite grava `'declined'` | B lê as próprias linhas por RLS (R11 mantida para B). Um status `blocked_by_veto` gravado conta a B que o freela vetou A — o mesmo vazamento que a R3 evita na resposta da RPC, pela porta de trás da tabela. **Achado BLOCKER.** |
| **R3**: recusa por veto com outcome `blocked_by_veto`; **R7**: `worker_opted_out`; **R13**: `already_connected` | Os três colapsam num **único** outcome `not_available` | Os três são fatos privados do freela (veto contra A, preferência, vínculo com A). Outcome distinto = oráculo: B descobre, uma tentativa por vez, o histórico de X com qualquer empresa. A resposta genérica da R3 só funciona se as **irmãs** também forem genéricas. |
| **R3**: checa `blocked` **com `blocked_by = worker_id`** | Checa **qualquer** linha `status='blocked'` do par (A, X), independente de `blocked_by` — inclusive `blocked_by IS NULL` | Fail-closed idêntico ao da `20260816000000`: autoria desconhecida (linha legada) é tratada como veto do freela. Um `blocked_by` NULL não pode virar porta de entrada. |
| **R5**: aceite "INSERT ... ou UPDATE se já existir linha 'pending'" | Aceite **nunca** escreve por cima de uma linha `'blocked'`. Se existir, o referral morre como `'declined'` e a RPC devolve `blocked_by_you` ao freela | Um `ON CONFLICT (company_id, worker_id) DO UPDATE SET status='accepted'` ingênuo atravessa a linha bloqueada e reabre exatamente a porta que a `20260816000000` fechou. O veto só se levanta na tela de bloqueios, por gesto deliberado — nunca como efeito colateral de um "aceitar". |
| **R2**: `create_worker_referral(p_worker_id, p_requesting_company_id, p_message)` | Ganha `p_referring_company_id` explícito e valida `EXISTS (companies)` das **duas** pontas | Um dono de várias empresas (rede de 10 unidades — o caso da entrevista) precisa dizer de qual unidade indica. E o `EXISTS` mata o ramo `= auth.uid()` de `is_company_owner` para conta que não é empresa. |
| Sem limite de indicações (Questão aberta) | **Três tetos** na RPC (§3.1, LM-4) | "Se indicar é barato, B varre o elenco alheio" — mas o vetor real é B **spammar o freela** e distribuir cartões em massa. Teto é 8 linhas de SQL; deixar para depois do piloto é deixar a notificação do freela sem defesa. |
| Sem prazo | `expires_at` (14 dias) + `expire_worker_referrals()` | O índice único parcial é sobre `awaiting_worker`: sem prazo, uma indicação abandonada trava aquele par (X, A) para sempre. |
| `source` de `team_connections` | Ganha o valor `'referral'` | O BI de aquisição da `20260622000000` (`qr|link|phone`) não sabe contar a origem nova. Sem isso o aceite falharia no CHECK. |

Inalterado e confirmado: **`can_view_worker_profile` NÃO muda** (Out-of-scope da spec, respeitado — nenhuma
policy de `workers` é tocada); **Article 8 intacto** (nenhuma tabela/RPC de saldo é lida ou escrita, nenhum
valor monetário aparece); vocabulário **"indicação"** em tabela, colunas, RPCs e textos de notificação;
recusa **neutra**; A **nunca** é notificada antes do aceite.

---

## 1. Migration

**Arquivo:** `supabase/migrations/20260817001400_worker_referrals.sql`
(a última da fila hoje é `20260817001300`; esta é a próxima)

```sql
-- Migration: Indicação de freela entre empresas (F10)
-- File: supabase/migrations/20260817001400_worker_referrals.sql
-- Spec: .harness/spec/troca-freelas/spec.md
-- DDL aprovado: .harness/spec/troca-freelas/ddl-aprovado.md
-- ADR: .harness/memory-bank/decisions/ADR-20260821-indicacao-entre-empresas.md
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ
-- ============================================================================
--   (a) `workers` ganha `accepts_referrals boolean NOT NULL DEFAULT true` (opt-out do freela).
--   (b) `team_connections.source` passa a aceitar o valor 'referral'.
--   (c) Tabela nova `worker_referrals` + índices + RLS (SELECT-only, assimétrica).
--   (d) Seis funções SECURITY DEFINER: criar / aceitar / recusar / cancelar / cartão / lista.
--   (e) Um trigger de notificação em `worker_referrals` (freela e empresas).
--   (f) Um trigger em `team_connections` que mata indicação pendente quando nasce um bloqueio.
--   (g) Uma função de housekeeping (`expire_worker_referrals`), só service_role.
--
--   NÃO altera nenhuma policy de `workers` (`can_view_worker_profile` intacta — Out-of-scope
--   explícito da spec). NÃO altera nenhuma policy de `team_connections`. NÃO toca saldo.
--
-- ============================================================================
-- A REGRA CENTRAL (é isto que o resto do arquivo protege)
-- ============================================================================
--   B nunca ENTREGA o freela a A. B APRESENTA o freela a A, e só o "sim" do próprio freela
--   cria a conexão. Consequências que o SQL tem de sustentar, e não só a UI:
--     1. Antes do aceite, A não pode obter o `worker_id` — com o uuid em mãos, A convida X
--        direto (`tc_insert_company` só exige ser dona e nascer 'pending') e a decisão do
--        freela vira enfeite. Por isso a RLS de A é `status = 'accepted'` e as RPCs de vitrine
--        OMITEM `worker_id` enquanto a indicação está pendente.
--     2. O veto do freela (`team_connections.status='blocked'`) é indelével para a empresa
--        desde a 20260816000000. A indicação não pode ser o caminho lateral que o desfaz —
--        nem na criação, nem no aceite, nem numa corrida entre os dois.
--     3. Nada que B receba de volta pode distinguir "o freela recusou" de "o freela vetou A"
--        de "o freela não aceita indicações" — senão a feature vira um oráculo sobre o
--        histórico do freela, consultável a uma tentativa por vez.
--
-- ============================================================================
-- O VETO SOBREVIVE — OS QUATRO CAMINHOS (achado #1 do gate)
-- ============================================================================
--   V-a) A já bloqueada ANTES da indicação
--        `create_worker_referral` consulta `team_connections(company_id = destino,
--        worker_id, status='blocked')` — QUALQUER linha bloqueada, sem olhar `blocked_by`
--        (fail-closed: `blocked_by IS NULL` de linha legada também barra, mesma escolha da
--        20260816000000). Recusa ANTES de inserir e ANTES de notificar. B recebe
--        `not_available`, indistinguível de opt-out e de "já conectado".
--
--   V-b) Freela bloqueia A e SÓ DEPOIS B indica
--        Mesmo caminho de V-a (a checagem é no momento da criação, não no do convite).
--
--   V-c) Bloqueio nasce DEPOIS da indicação e ANTES do aceite  ← o caso difícil
--        Duas defesas, de propósito redundantes:
--        - PROATIVA: `trg_cancel_referrals_on_block` em `team_connections`. No instante em
--          que a linha vira 'blocked', toda indicação `awaiting_worker` daquele freela com
--          aquela empresa (nas DUAS pontas: como destino e como indicadora) vira 'declined'.
--        - REATIVA: `accept_worker_referral` RE-CONSULTA `team_connections` com
--          `FOR UPDATE` no momento do aceite. Se achar 'blocked', não escreve por cima:
--          encerra o referral como 'declined' e devolve `blocked_by_you` ao FREELA (a ele
--          é seguro contar — o veto é dele).
--        Por que as duas: o trigger não cobre a corrida em que o UPDATE de bloqueio e o
--        aceite acontecem no mesmo instante; o lock `FOR UPDATE` da RPC serializa contra
--        exatamente esse UPDATE, porque é a MESMA linha de `team_connections`.
--
--        ORDEM DE LOCK (consequência conhecida e aceita): o aceite trava `worker_referrals`
--        e depois `team_connections`; o bloqueio trava `team_connections` e depois
--        `worker_referrals` (dentro do trigger). É um ABBA clássico: no instante exato em que
--        os dois se cruzam, o Postgres detecta e aborta um deles (40P01). Quem paga:
--         - victim = TRIGGER: o `EXCEPTION WHEN OTHERS` dele engole o erro, o BLOQUEIO DO
--           FREELA É GRAVADO (é o que não pode falhar) e a limpeza é pulada — a defesa
--           reativa do aceite continua barrando. Fail-safe na direção certa.
--         - victim = ACEITE: a RPC devolve erro, a transação inteira rola de volta, o freela
--           reclica. Nada fica inconsistente.
--        NÃO "consertar" unificando a ordem: travar `team_connections` antes do referral no
--        aceite abriria a janela entre ler o referral e travar o vínculo — exatamente a
--        janela que V-c fecha.
--
--   V-d) O aceite escrevendo por cima do bloqueio
--        Nenhum `ON CONFLICT ... DO UPDATE SET status='accepted'` nesta migration. O aceite
--        lê a linha com `FOR UPDATE` e ramifica na unha: 'blocked' → aborta; 'accepted' →
--        idempotente; 'pending' → promove; ausente → INSERT com `ON CONFLICT DO NOTHING`
--        seguido de RE-LEITURA (a corrida em que a linha nasce entre o SELECT e o INSERT
--        cai no mesmo ramo de bloqueio).
--
--   Nota sobre o que TORNA isso suficiente: a empresa não consegue DELETAR a linha bloqueada
--   (guarda `tc_delete_company`, 20260816000000), então a linha está sempre lá para ser vista.
--   Se aquela guarda cair, esta feature cai junto — as duas são um par.
--
-- ============================================================================
-- O RAMO `= auth.uid()` DE `is_company_owner` (achado #2 do gate)
-- ============================================================================
--   `is_company_owner(p)` devolve true quando `p = auth.uid()` SEM verificar que `p` existe
--   em `companies` (20260817000300). Para uma conta de freela, `is_company_owner(<uid dele>)`
--   é TRUE. Onde isso poderia morder aqui, e o que fecha:
--     - Indicar a si mesmo / se auto-indicar como empresa de origem:
--       CHECK de tabela `worker_id <> referring_company_id AND worker_id <> requesting_company_id`
--       + guarda na RPC `p_worker_id <> auth.uid()`.
--     - Passar `p_referring_company_id = <uid do freela>` para satisfazer `is_company_owner`:
--       a RPC exige `EXISTS (SELECT 1 FROM companies WHERE id = p_referring_company_id)`
--       ANTES de qualquer leitura de `workers`/`team_connections`. O ramo `= auth.uid()`
--       deixa de ser suficiente sozinho. (A FK sozinha NÃO bastaria: ela só falharia no
--       INSERT, isto é, DEPOIS de a RPC já ter lido dado do freela para decidir.)
--     - `get_worker_referral_card` autorizada pelo ramo `= auth.uid()`: só casa se
--       `auth.uid()` for igual ao `requesting_company_id` da linha, que tem FK para
--       `companies` e CHECK `<> worker_id`. Resíduo conhecido: um uuid que seja
--       SIMULTANEAMENTE linha de `companies` e de `workers` é a MESMA pessoa — não há
--       escalada entre pessoas distintas. Documentado, não mitigado.
--   O par `is_job_owner`/`is_company_owner` continua sendo a costura da F3 (multi-unidade):
--   nada aqui reimplementa a ancoragem à mão, para não criar um terceiro lugar para consertar.
--
-- ============================================================================
-- A VITRINE (achado #3 do gate) — `get_worker_referral_card`
-- ============================================================================
--   É a única superfície da feature que entrega dado pessoal a quem NÃO tem vínculo. Regras:
--     - Campos que SAEM, exaustivamente: full_name, avatar_url, rating_average,
--       reviews_count, primary_role, roles. Mais metadado NÃO-pessoal da indicação
--       (status, created_at, expires_at) e a identificação da empresa indicadora
--       (nome/logo — dado público de empresa, não de pessoa).
--     - Campos que NUNCA saem: cpf, phone, pix_key, birth_date, bio, city, xp, level,
--       earnings_total, completed_jobs_count, availability_days, e — enquanto pendente —
--       o PRÓPRIO `worker_id`. O jsonb é montado campo a campo; NUNCA `to_jsonb(w.*)`,
--       que passaria a vazar sozinho toda coluna futura de `workers`.
--     - NÃO aceita "por qual empresa perguntar": a única entrada é o `referral_id`, e a
--       autorização é sempre sobre `auth.uid()`. Precedente `is_shift_call_target`
--       (20260817000100), que também não aceita "por qual usuário perguntar" justamente
--       para não servir de varredura.
--     - Enumeração: a entrada é um uuid v4 de linha existente + ownership do destino. Sem
--       índice de acesso por empresa exposto ao client, sem listagem por parâmetro. Quem
--       quer a própria caixa de entrada chama `list_worker_referral_cards()`, SEM parâmetro.
--     - `STABLE`, nunca `VOLATILE`: a vitrine não escreve nada (nem contador de view).
--
-- ============================================================================
-- ANTI-ABUSO (achado #4 do gate)
-- ============================================================================
--   Vetor real: A não "pede" nada dentro do app (Suposição 1 da spec) — A só RECEBE. Logo
--   não existe "A varrendo elenco alheio": ela precisaria adivinhar uuids v4 de referrals que
--   B criou. O abuso possível é do lado de B: inundar o freela de notificações e distribuir
--   cartões do elenco inteiro para meio mercado. Três tetos, todos na RPC de criação:
--     T1. 20 indicações criadas por empresa indicadora nas últimas 24h  → `rate_limited`
--     T2.  3 indicações do MESMO par (B, X) nos últimos 30 dias         → `rate_limited`
--     T3.  5 indicações `awaiting_worker` simultâneas para o MESMO freela, somando TODAS as
--          empresas                                                     → `not_available`
--   T1/T2 são fato da própria B (ela vê as próprias linhas por RLS) → outcome específico.
--   T3 é fato do freela (quantas empresas o estão disputando) → outcome GENÉRICO, senão vira
--   oráculo de popularidade/atividade do freela. Os três números são constantes nomeadas no
--   corpo da função, para ajuste sem migration de schema.
--
-- ============================================================================
-- CICLO DE VIDA (achado #5 do gate)
-- ============================================================================
--   - Freela SAI do elenco de B (linha (B,X) deletada, ou X vira 'pending' de novo):
--     a indicação pendente SOBREVIVE. É uma declaração datada de B, feita quando o vínculo
--     existia, e o freela ainda não respondeu. Matá-la daria a B um jeito indireto de retirar
--     a apresentação sem clicar em "cancelar" — e daria a X um jeito de perder, por um gesto
--     não relacionado, uma oferta que ele talvez quisesse. `expires_at` (14 dias) limita a
--     validade. B pode sempre `cancel_worker_referral`.
--   - Freela BLOQUEIA B: a indicação pendente MORRE ('declined'), via
--     `trg_cancel_referrals_on_block`. Bloqueio é veto, não desligamento administrativo — B
--     perde na hora o direito de continuar falando pelo freela.
--   - B SOME (conta deletada): `ON DELETE CASCADE` nas duas FKs de empresa. A indicação
--     desaparece com quem a fez. A tabela não é financeira nem de auditoria de saldo, então
--     o CASCADE aqui é o mesmo padrão de `team_connections` (20260622000000) e não conflita
--     com a regra "sem CASCADE em tabela financeira".
--   - Freela SOME: `ON DELETE CASCADE` em `worker_id` (mesmo padrão; direito de apagamento).
--   - Freela JÁ TEM vínculo 'accepted' com A no momento da criação: recusa `not_available`.
--   - Vínculo com A nasce ENTRE a criação e o aceite: o aceite é idempotente — marca o
--     referral 'accepted' sem duplicar nada e devolve `already_connected`.
--   - Ninguém responde: `expires_at` + `expire_worker_referrals()` (ou expiração preguiçosa
--     no próprio aceite) liberam o par (X, A) do índice único parcial.
--
-- ============================================================================
-- 42P17 (recursão de policy) — POR QUE NÃO ACONTECE AQUI
-- ============================================================================
--   Grafo, orientado: `worker_referrals` → (via is_company_owner) `companies`, que tem SELECT
--   `USING (true)` e NÃO referencia nada. Nenhuma policy de `companies`, `workers`,
--   `team_connections` ou `applications` menciona `worker_referrals`. Grafo acíclico ⇒ sem
--   42P17 (que, lembrando, só aparece em RUNTIME — o CREATE POLICY nunca reclama). Mesma
--   conclusão da F2; o par de DEFINERs mínimos que a F1 precisou não é necessário.
--
-- ============================================================================
-- ORDEM DE CRIAÇÃO
-- ============================================================================
--   Tabela ANTES de qualquer função que a referencie (a F-anterior queimou nisso: função
--   `LANGUAGE sql` com corpo que lê tabela inexistente falha no CREATE). Ordem deste arquivo:
--   coluna → CHECK de source → TABELA → índices → RLS/grants → funções → triggers → grants
--   de função.
--
-- Article 8: INTACTO. `wallets`, `wallet_transactions`, `escrow_transactions` e
--   `shift_payments` não são lidas nem escritas. Nenhuma RPC de saldo criada ou alterada.
--   Nenhum valor monetário nesta migration.
-- Article 12: o acesso a dado de pessoa continua atrás de sessão válida + consentimento; a
--   vitrine pré-aceite é projeção mínima, não abertura de policy.
--
-- Risk: MEDIUM (tabela nova + trigger em `team_connections`, tabela central do consentimento).
-- Backup required before production deploy: NO (nenhuma reescrita de dado existente; a única
--   alteração em tabela existente é ADD COLUMN com default e troca de CHECK por um SUPERSET).
--
-- DOWN (rollback): ver bloco no fim do arquivo.
-- ============================================================================


-- =============================================
-- 1. OPT-OUT DO FREELA (R7)
--    NOT NULL DEFAULT true não reescreve a tabela (PG11+ guarda o default no catálogo).
--    Sem GRANT novo: o grant vigente é de TABELA
--    (`GRANT SELECT, INSERT, UPDATE ON public.workers TO authenticated`, 20260816120000:175),
--    então o freela já grava esta coluna no PATCH do próprio perfil. GRANT por coluna aqui
--    seria decoração (é aditivo) e o REVOKE que o tornaria efetivo derrubaria a edição de
--    perfil inteira — mesma conclusão da F5 e da F7.
--    Quem PODE escrever: só o dono (policy de UPDATE `id = auth.uid()`). Empresa nenhuma
--    alcança esta coluna.
-- =============================================
ALTER TABLE public.workers
    ADD COLUMN IF NOT EXISTS accepts_referrals boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workers.accepts_referrals IS
    'Opt-out de indicacao entre empresas (F10). true = empresas do elenco podem me indicar a '
    'outra empresa; false = create_worker_referral recusa com outcome generico. Default true '
    '(Suposicao 3 da spec: a pratica ja ocorre hoje por WhatsApp SEM nenhum consentimento; a '
    'feature adiciona consentimento no momento decisivo). Escrita SO pelo proprio freela.';


-- =============================================
-- 2. `team_connections.source` GANHA 'referral'
--    O aceite (secao 6.2) cria a conexao com source='referral'. Sem isto, o CHECK inline da
--    20260622000000 (qr|link|phone) faria o aceite explodir em producao.
--    O CHECK novo e SUPERSET do antigo -> nenhuma linha existente e invalidada, a validacao
--    do ADD e trivial. `IF EXISTS` no DROP mantem a migration idempotente.
-- =============================================
ALTER TABLE public.team_connections
    DROP CONSTRAINT IF EXISTS team_connections_source_check;

ALTER TABLE public.team_connections
    ADD CONSTRAINT team_connections_source_check
    CHECK (source IN ('qr', 'link', 'phone', 'referral'));

COMMENT ON COLUMN public.team_connections.source IS
    'Canal de origem da conexao: qr | link | phone | referral. "referral" = nasceu do aceite '
    'de uma indicacao de outra empresa (F10, accept_worker_referral) — o BI de aquisicao '
    'precisa distinguir quem chegou por apresentacao de quem chegou por convite direto.';


-- =============================================
-- 3. TABELA
--    Vocabulario: "referral"/"indicacao". NUNCA transfer/swap/lend/emprestimo — o nome da
--    tabela e a primeira coisa que a proxima pessoa le, e nomear pessoa como ativo que se
--    move entre empresas contradiz o modelo de consentimento inteiro (product.md, anti-vision).
-- =============================================
CREATE TABLE IF NOT EXISTS public.worker_referrals (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Quem foi indicado.
    worker_id              uuid        NOT NULL REFERENCES public.workers(id)   ON DELETE CASCADE,

    -- Quem indica (B): tem o freela no PROPRIO elenco aceito.
    referring_company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

    -- Para quem se indica (A): NAO tem vinculo nenhum com o freela (ainda).
    requesting_company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

    -- 'blocked_by_veto' NAO existe de proposito: ver secao 0 (B le as proprias linhas; um
    -- status especifico contaria a B que o freela vetou A). Toda terminacao sem aceite e
    -- 'declined' — indistinguivel entre recusa do freela, veto e expiracao por bloqueio.
    status                 text        NOT NULL DEFAULT 'awaiting_worker'
                                       CHECK (status IN ('awaiting_worker', 'accepted',
                                                         'declined', 'cancelled', 'expired')),

    -- Recado curto de B para o freela ("a Ana e otima no salao"). Teto porque quem escreve e
    -- o client via RPC e a linha e lida na notificacao do freela.
    message                text        CHECK (message IS NULL OR length(message) <= 500),

    created_by             uuid,
    created_at             timestamptz NOT NULL DEFAULT now(),

    -- Sem prazo, uma indicacao abandonada trava o par (worker, A) para sempre no indice unico
    -- parcial abaixo. 14 dias: o problema do interlocutor e desta semana, nao deste trimestre.
    expires_at             timestamptz NOT NULL DEFAULT (now() + interval '14 days'),

    responded_at           timestamptz,

    -- Indicar para si mesma nao e indicacao.
    CONSTRAINT worker_referrals_distinct_companies
        CHECK (referring_company_id <> requesting_company_id),

    -- Fecha o auto-referral pelo ramo `= auth.uid()` de is_company_owner: um uuid nao pode ser
    -- ao mesmo tempo o freela indicado e qualquer uma das pontas de empresa.
    CONSTRAINT worker_referrals_worker_is_not_company
        CHECK (worker_id <> referring_company_id AND worker_id <> requesting_company_id)
);

COMMENT ON TABLE public.worker_referrals IS
    'Indicacao de freela entre empresas (F10). B APRESENTA um freela do proprio elenco aceito '
    'a uma empresa A; a conexao real (team_connections) so nasce se o FREELA aceitar. B nunca '
    'entrega o freela. Sem policy de UPDATE/DELETE: toda transicao passa por RPC DEFINER '
    '(padrao de shift_calls/shift_call_targets, F1).';

COMMENT ON COLUMN public.worker_referrals.status IS
    'awaiting_worker (padrao) | accepted | declined | cancelled | expired. NAO existe status '
    'de veto: veto termina como "declined" para nao contar a B o historico do freela com A.';

COMMENT ON COLUMN public.worker_referrals.expires_at IS
    'Prazo da indicacao (14d). Enquanto awaiting_worker, a linha ocupa o indice unico parcial '
    'do par (worker_id, requesting_company_id) — o prazo e o que devolve o par a circulacao.';


-- =============================================
-- 4. INDICES
--    Tabela nova/vazia -> CREATE INDEX simples e seguro. CONCURRENTLY nao pode ser usado:
--    migrations do Supabase rodam dentro de transacao.
-- =============================================

-- Uma indicacao PENDENTE por par (freela, empresa destino), venha de quem vier (R6/A7).
-- Deliberadamente NAO inclui referring_company_id: se incluisse, N empresas poderiam empilhar
-- N notificacoes sobre o mesmo freela para o mesmo destino.
CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_referrals_pending
    ON public.worker_referrals (worker_id, requesting_company_id)
    WHERE status = 'awaiting_worker';

-- Caixa de entrada de A (list_worker_referral_cards) e caixa de saida de B.
CREATE INDEX IF NOT EXISTS idx_worker_referrals_requesting
    ON public.worker_referrals (requesting_company_id, status);

-- Caixa de saida de B + tetos T1/T2 de anti-abuso (filtram por created_at).
CREATE INDEX IF NOT EXISTS idx_worker_referrals_referring
    ON public.worker_referrals (referring_company_id, created_at DESC);

-- Tela do freela ("quem te indicou") + teto T3.
CREATE INDEX IF NOT EXISTS idx_worker_referrals_worker
    ON public.worker_referrals (worker_id, status);


-- =============================================
-- 5. RLS — SELECT-ONLY E ASSIMETRICA
--    Sem FORCE ROW LEVEL SECURITY e sem REVOKE de PUBLIC em tabela: a 20260318000000
--    documenta que isso derrubou o service_role.
--    NENHUMA policy de INSERT/UPDATE/DELETE: toda escrita passa pelas RPCs DEFINER, que
--    rodam como owner e nao consultam estas policies. Isso mantem a maquina de estados em
--    um lugar auditavel (padrao de shift_calls, F1).
-- =============================================
ALTER TABLE public.worker_referrals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.worker_referrals FROM anon;
GRANT SELECT ON public.worker_referrals TO authenticated;
GRANT ALL    ON public.worker_referrals TO service_role;

-- O freela ve tudo que e sobre ele, em qualquer status. E o dono do dado.
DROP POLICY IF EXISTS "wr_select_worker" ON public.worker_referrals;
CREATE POLICY "wr_select_worker" ON public.worker_referrals
    FOR SELECT TO authenticated
    USING (worker_id = (SELECT auth.uid()));

-- B ve tudo que ELA indicou, em qualquer status (precisa acompanhar/cancelar).
DROP POLICY IF EXISTS "wr_select_referring_company" ON public.worker_referrals;
CREATE POLICY "wr_select_referring_company" ON public.worker_referrals
    FOR SELECT TO authenticated
    USING (public.is_company_owner(referring_company_id));

-- A so ve a linha DEPOIS do aceite. ESTA E A LINHA MAIS IMPORTANTE DO ARQUIVO:
-- a linha carrega `worker_id`; com o uuid, A insere team_connections(A, X, 'pending') pela
-- `tc_insert_company` e passa a convidar X por fora, sem depender do "sim" que a feature
-- inteira existe para exigir. Antes do aceite, A enxerga a indicacao SO pelas RPCs de
-- vitrine, que omitem `worker_id`. Divergencia consciente da R11 — ver ADR.
DROP POLICY IF EXISTS "wr_select_requesting_company" ON public.worker_referrals;
CREATE POLICY "wr_select_requesting_company" ON public.worker_referrals
    FOR SELECT TO authenticated
    USING (
        status = 'accepted'
        AND public.is_company_owner(requesting_company_id)
    );

COMMENT ON POLICY "wr_select_requesting_company" ON public.worker_referrals IS
    'Empresa DESTINO le a linha so apos o aceite. Antes disso a linha exporia worker_id, e com '
    'o uuid a empresa convida o freela direto por tc_insert_company, contornando o consentimento '
    'que a indicacao existe para pedir. Pre-aceite, use get_worker_referral_card / '
    'list_worker_referral_cards (omitem worker_id).';


-- =============================================
-- 6. RPCs
--    Todas SECURITY DEFINER + SET search_path = ''. DEFINER desliga a RLS: por isso cada
--    autorizacao aparece explicita, na unha, no corpo da funcao.
-- =============================================

-- ---------------------------------------------------------------------------
-- 6.1 create_worker_referral — B apresenta X a A
--
-- CONTRATO DE OUTCOMES (o builder trata TODOS; o texto na UI e generico nos genericos):
--   created        -> criado (devolve referral_id)
--   unauthenticated / invalid_input / same_company / invalid_target
--   forbidden      -> quem chama nao opera a empresa indicadora
--   company_not_found -> empresa destino nao existe
--   not_in_roster  -> o freela nao esta no elenco ACEITO de B (fato da propria B)
--   already_pending-> a PROPRIA B ja tem uma indicacao pendente deste par
--   rate_limited   -> teto T1/T2 (fato da propria B; devolve `limit`)
--   not_available  -> GENERICO. Cobre, INDISTINGUIVELMENTE: veto do freela contra A,
--                     opt-out do freela, freela ja conectado a A, teto T3, e indicacao
--                     pendente criada por OUTRA empresa. Nunca detalhar: a soma de outcomes
--                     especificos e um oraculo sobre o historico do freela.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_worker_referral(
    p_worker_id             uuid,
    p_referring_company_id  uuid,
    p_requesting_company_id uuid,
    p_message               text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- Tetos de anti-abuso (secao "ANTI-ABUSO" do cabecalho). Constantes aqui de proposito:
    -- ajustar depois do piloto nao deve exigir migration de schema.
    c_max_per_company_24h   constant integer := 20;  -- T1
    c_max_per_pair_30d      constant integer := 3;   -- T2
    c_max_open_per_worker   constant integer := 5;   -- T3

    v_uid       uuid := (SELECT auth.uid());
    v_now       timestamptz := now();
    v_opt_in    boolean;
    v_count     integer;
    v_existing  public.worker_referrals%ROWTYPE;
    v_id        uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    IF p_worker_id IS NULL OR p_referring_company_id IS NULL OR p_requesting_company_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    IF p_referring_company_id = p_requesting_company_id THEN
        RETURN jsonb_build_object('outcome', 'same_company');
    END IF;

    -- Fecha o auto-referral pelo ramo `= auth.uid()` de is_company_owner (achado #2).
    IF p_worker_id = v_uid
       OR p_worker_id = p_referring_company_id
       OR p_worker_id = p_requesting_company_id THEN
        RETURN jsonb_build_object('outcome', 'invalid_target');
    END IF;

    -- Autorizacao: opera a empresa indicadora...
    IF NOT public.is_company_owner(p_referring_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- ...E a empresa indicadora EXISTE de fato. Sem este EXISTS, o ramo `= auth.uid()` de
    -- is_company_owner sozinho autorizaria uma conta que nao e empresa a chegar nas leituras
    -- de `workers`/`team_connections` abaixo (a FK so barraria no INSERT, tarde demais).
    IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_referring_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_requesting_company_id) THEN
        RETURN jsonb_build_object('outcome', 'company_not_found');
    END IF;

    -- R2/R7: B so indica quem ja e do elenco ACEITO dela. Fato da propria B -> outcome proprio.
    IF NOT EXISTS (
        SELECT 1 FROM public.team_connections tc
         WHERE tc.company_id = p_referring_company_id
           AND tc.worker_id  = p_worker_id
           AND tc.status     = 'accepted'
    ) THEN
        RETURN jsonb_build_object('outcome', 'not_in_roster');
    END IF;

    -- T1 — volume da propria B nas ultimas 24h.
    SELECT count(*) INTO v_count
      FROM public.worker_referrals r
     WHERE r.referring_company_id = p_referring_company_id
       AND r.created_at > v_now - interval '24 hours';
    IF v_count >= c_max_per_company_24h THEN
        RETURN jsonb_build_object('outcome', 'rate_limited', 'limit', 'company_24h');
    END IF;

    -- T2 — insistencia sobre o MESMO freela nos ultimos 30 dias.
    SELECT count(*) INTO v_count
      FROM public.worker_referrals r
     WHERE r.referring_company_id = p_referring_company_id
       AND r.worker_id            = p_worker_id
       AND r.created_at > v_now - interval '30 days';
    IF v_count >= c_max_per_pair_30d THEN
        RETURN jsonb_build_object('outcome', 'rate_limited', 'limit', 'pair_30d');
    END IF;

    -- ==== A PARTIR DAQUI, TUDO QUE FALHA VIRA `not_available` (fatos privados do freela) ====

    -- T3 — quantas empresas ja estao disputando este freela agora. Generico: o numero e um
    -- fato sobre o freela, nao sobre B.
    SELECT count(*) INTO v_count
      FROM public.worker_referrals r
     WHERE r.worker_id = p_worker_id
       AND r.status    = 'awaiting_worker'
       AND r.expires_at > v_now;
    IF v_count >= c_max_open_per_worker THEN
        RAISE LOG 'create_worker_referral: recusa por T3 (worker=%)', p_worker_id;
        RETURN jsonb_build_object('outcome', 'not_available');
    END IF;

    -- R7 — opt-out. `coalesce` defensivo: a coluna e NOT NULL, mas a funcao nao deve depender
    -- de um SELECT que nao achou linha (freela deletado entre checagens).
    SELECT w.accepts_referrals INTO v_opt_in
      FROM public.workers w WHERE w.id = p_worker_id;
    IF NOT FOUND OR NOT coalesce(v_opt_in, false) THEN
        RAISE LOG 'create_worker_referral: recusa por opt-out (worker=%)', p_worker_id;
        RETURN jsonb_build_object('outcome', 'not_available');
    END IF;

    -- R3 / V-a / V-b — VETO. Qualquer linha 'blocked' do par (destino, freela) barra, SEM
    -- olhar `blocked_by`: fail-closed identico ao da 20260816000000 (autoria desconhecida e
    -- tratada como veto do freela). Nada e gravado, ninguem e notificado.
    IF EXISTS (
        SELECT 1 FROM public.team_connections tc
         WHERE tc.company_id = p_requesting_company_id
           AND tc.worker_id  = p_worker_id
           AND tc.status     = 'blocked'
    ) THEN
        RAISE LOG 'create_worker_referral: recusa por veto (worker=%, destino=%)',
                  p_worker_id, p_requesting_company_id;
        RETURN jsonb_build_object('outcome', 'not_available');
    END IF;

    -- R13 — ja conectado ao destino. Tambem privado (e o historico do freela com A).
    IF EXISTS (
        SELECT 1 FROM public.team_connections tc
         WHERE tc.company_id = p_requesting_company_id
           AND tc.worker_id  = p_worker_id
           AND tc.status     = 'accepted'
    ) THEN
        RAISE LOG 'create_worker_referral: recusa por vinculo existente (worker=%)', p_worker_id;
        RETURN jsonb_build_object('outcome', 'not_available');
    END IF;

    -- Duplicata pendente: se e da PROPRIA B, ela pode saber (ve a linha por RLS). Se e de
    -- outra empresa, generico — senao B descobre que um concorrente indicou o mesmo freela.
    SELECT * INTO v_existing
      FROM public.worker_referrals r
     WHERE r.worker_id             = p_worker_id
       AND r.requesting_company_id = p_requesting_company_id
       AND r.status                = 'awaiting_worker'
       FOR UPDATE;
    IF FOUND AND v_existing.expires_at <= v_now THEN
        -- Expiracao preguicosa: sem isto, uma indicacao vencida e nunca respondida trava o par
        -- (freela, destino) no indice unico parcial para SEMPRE, e a feature simplesmente para
        -- de funcionar para aquele par sem ninguem entender por que.
        UPDATE public.worker_referrals SET status = 'expired' WHERE id = v_existing.id;
        v_existing := NULL;
    END IF;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.referring_company_id = p_referring_company_id THEN
            RETURN jsonb_build_object('outcome', 'already_pending',
                                      'referral_id', v_existing.id);
        END IF;
        RETURN jsonb_build_object('outcome', 'not_available');
    END IF;

    BEGIN
        INSERT INTO public.worker_referrals (
            worker_id, referring_company_id, requesting_company_id,
            status, message, created_by
        ) VALUES (
            p_worker_id, p_referring_company_id, p_requesting_company_id,
            'awaiting_worker', nullif(btrim(coalesce(p_message, '')), ''), v_uid
        )
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        -- Corrida contra outra criacao no mesmo par. Generico: nao da para saber, sem uma
        -- segunda leitura, se a vencedora foi a propria B — e a leitura extra so serviria
        -- para detalhar algo que talvez seja de outra empresa.
        RETURN jsonb_build_object('outcome', 'not_available');
    END;

    -- A notificacao do freela (R9) NAO e disparada aqui: e do trigger
    -- trg_notify_on_worker_referral (garantia do produto, nao cortesia da UI).
    -- A empresa DESTINO nao e notificada (R8) — ela so descobre no aceite.
    RETURN jsonb_build_object('outcome', 'created', 'referral_id', v_id);
END;
$$;

COMMENT ON FUNCTION public.create_worker_referral(uuid, uuid, uuid, text) IS
    'F10 — empresa B indica um freela do proprio elenco aceito a uma empresa A. Checa veto, '
    'opt-out, vinculo existente e tetos ANTES de gravar ou notificar. Recusas por fato privado '
    'do freela colapsam num unico outcome "not_available" (nao virar oraculo). Nao toca saldo.';


-- ---------------------------------------------------------------------------
-- 6.2 accept_worker_referral — o "sim" do freela (o unico ato que cria vinculo)
--
-- OUTCOMES: accepted | already_connected | blocked_by_you | expired | not_pending |
--           not_found | forbidden | unauthenticated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_worker_referral(p_referral_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid  uuid := (SELECT auth.uid());
    v_now  timestamptz := now();
    v_ref  public.worker_referrals%ROWTYPE;
    v_tc   public.team_connections%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    -- Lock do referral: serializa aceite x recusa x cancelamento de B.
    SELECT * INTO v_ref
      FROM public.worker_referrals r
     WHERE r.id = p_referral_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- So o proprio freela aceita. Sem ramo de empresa: nao existe "aceitar pelo freela".
    IF v_ref.worker_id <> v_uid THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF v_ref.status <> 'awaiting_worker' THEN
        RETURN jsonb_build_object('outcome', 'not_pending', 'status', v_ref.status);
    END IF;

    -- Expiracao preguicosa: libera o par no indice unico parcial mesmo sem housekeeping.
    IF v_ref.expires_at <= v_now THEN
        -- `responded_at` fica NULL de proposito: ninguem respondeu. O timestamp de fechamento
        -- e o proprio `expires_at`.
        UPDATE public.worker_referrals SET status = 'expired' WHERE id = v_ref.id;
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    -- ==== V-c / V-d: o veto tem de sobreviver ao aceite ====
    -- Lock na linha de team_connections do par (destino, freela). E a MESMA linha que o UPDATE
    -- de bloqueio do freela toca, entao o lock serializa a corrida "bloqueio x aceite".
    SELECT * INTO v_tc
      FROM public.team_connections tc
     WHERE tc.company_id = v_ref.requesting_company_id
       AND tc.worker_id  = v_uid
       FOR UPDATE;

    IF FOUND THEN
        IF v_tc.status = 'blocked' THEN
            -- NUNCA escrever por cima de um bloqueio. Levantar o veto e um gesto deliberado,
            -- na tela de bloqueios do freela — nunca efeito colateral de "aceitar".
            UPDATE public.worker_referrals
               SET status = 'declined', responded_at = v_now
             WHERE id = v_ref.id;
            -- Ao FREELA e seguro contar o motivo: o veto e dele. B recebe a notificacao
            -- neutra padrao (identica a de uma recusa), via trigger.
            RETURN jsonb_build_object('outcome', 'blocked_by_you');

        ELSIF v_tc.status = 'accepted' THEN
            -- Vinculo nasceu entre a criacao e o aceite. Idempotente.
            UPDATE public.worker_referrals
               SET status = 'accepted', responded_at = v_now
             WHERE id = v_ref.id;
            RETURN jsonb_build_object('outcome', 'already_connected');

        ELSE  -- 'pending': A ja tinha convidado; o aceite promove a MESMA linha (UNIQUE).
            UPDATE public.team_connections
               SET status      = 'accepted',
                   accepted_at = v_now,
                   blocked_by  = NULL
             WHERE id = v_tc.id;
        END IF;
    ELSE
        INSERT INTO public.team_connections (company_id, worker_id, status, source, accepted_at)
        VALUES (v_ref.requesting_company_id, v_uid, 'accepted', 'referral', v_now)
        ON CONFLICT (company_id, worker_id) DO NOTHING;

        IF NOT FOUND THEN
            -- A linha nasceu entre o SELECT e o INSERT. Re-le (ja com o lock livre) e cai nos
            -- mesmos ramos: um bloqueio criado nessa janela NAO pode ser atropelado.
            SELECT * INTO v_tc
              FROM public.team_connections tc
             WHERE tc.company_id = v_ref.requesting_company_id
               AND tc.worker_id  = v_uid
               FOR UPDATE;

            IF FOUND AND v_tc.status = 'blocked' THEN
                UPDATE public.worker_referrals
                   SET status = 'declined', responded_at = v_now
                 WHERE id = v_ref.id;
                RETURN jsonb_build_object('outcome', 'blocked_by_you');
            ELSIF FOUND AND v_tc.status = 'pending' THEN
                UPDATE public.team_connections
                   SET status = 'accepted', accepted_at = v_now, blocked_by = NULL
                 WHERE id = v_tc.id;
            END IF;
        END IF;
    END IF;

    UPDATE public.worker_referrals
       SET status = 'accepted', responded_at = v_now
     WHERE id = v_ref.id;

    -- A empresa DESTINO e notificada pelo trigger — este e o PRIMEIRO momento em que ela
    -- fica sabendo que a indicacao existiu (R8).
    RETURN jsonb_build_object('outcome', 'accepted');
END;
$$;

COMMENT ON FUNCTION public.accept_worker_referral(uuid) IS
    'F10 — o "sim" do freela: cria/promove team_connections(destino, freela, accepted, '
    'source=referral) e fecha a indicacao. NUNCA escreve por cima de uma linha "blocked" — '
    'o veto indelevel da 20260816000000 sobrevive tambem por este caminho. Nao toca saldo.';


-- ---------------------------------------------------------------------------
-- 6.3 decline_worker_referral — recusa NEUTRA (R6, precedente decline_shift_call)
-- OUTCOMES: declined | not_pending | not_found | forbidden | unauthenticated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decline_worker_referral(p_referral_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_now timestamptz := now();
    v_ref public.worker_referrals%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    SELECT * INTO v_ref FROM public.worker_referrals r WHERE r.id = p_referral_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF v_ref.worker_id <> v_uid THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF v_ref.status <> 'awaiting_worker' THEN
        RETURN jsonb_build_object('outcome', 'not_pending', 'status', v_ref.status);
    END IF;

    -- Nenhum efeito em reputacao, XP, ranking ou elenco. Recusar nao custa nada ao freela —
    -- e essa gratuidade que torna o "sim" um consentimento de verdade.
    UPDATE public.worker_referrals
       SET status = 'declined', responded_at = v_now
     WHERE id = v_ref.id;

    RETURN jsonb_build_object('outcome', 'declined');
END;
$$;

COMMENT ON FUNCTION public.decline_worker_referral(uuid) IS
    'F10 — recusa NEUTRA da indicacao pelo freela. Sem penalidade. B recebe notificacao '
    'generica identica a de qualquer outro desfecho (nao distinguir recusa de veto).';


-- ---------------------------------------------------------------------------
-- 6.4 cancel_worker_referral — B retira a apresentacao (R12)
-- OUTCOMES: cancelled | not_pending | not_found | forbidden | unauthenticated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_worker_referral(p_referral_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_now timestamptz := now();
    v_ref public.worker_referrals%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    SELECT * INTO v_ref FROM public.worker_referrals r WHERE r.id = p_referral_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- DEFINER desliga a RLS: autorizacao explicita. So a empresa que INDICOU cancela.
    IF NOT public.is_company_owner(v_ref.referring_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF v_ref.status <> 'awaiting_worker' THEN
        RETURN jsonb_build_object('outcome', 'not_pending', 'status', v_ref.status);
    END IF;

    UPDATE public.worker_referrals
       SET status = 'cancelled', responded_at = v_now
     WHERE id = v_ref.id;

    -- A empresa destino NAO e notificada: ela nunca soube que a indicacao existiu (R8/A9).
    RETURN jsonb_build_object('outcome', 'cancelled');
END;
$$;

COMMENT ON FUNCTION public.cancel_worker_referral(uuid) IS
    'F10 — a empresa que indicou retira a indicacao ainda pendente. Notifica o freela de forma '
    'neutra (trigger); NAO notifica a empresa destino, que nunca soube da tentativa.';


-- ---------------------------------------------------------------------------
-- 6.5 get_worker_referral_card — A VITRINE (superficie mais delicada da feature)
--
-- Entrega dado pessoal a quem NAO tem vinculo com o freela. Por isso:
--   - Projecao EXAUSTIVA, campo a campo. NUNCA `to_jsonb(w.*)` — isso faria toda coluna
--     futura de `workers` vazar sozinha, sem ninguem revisar.
--   - `worker_id` SO sai depois do aceite, NO CAMPO `worker_id`.
--
--     ATENCAO — esta linha ja foi lida como "o uuid nao sai", e NAO e isso que ela diz.
--     `avatar_url` sai durante `awaiting_worker` e HOJE carrega o uuid embutido: o unico
--     ponto de upload de foto de freela (`Profile.tsx:315`) monta o path do bucket como
--     `${profile.id}/avatar_<ts>.<ext>`, entao a URL publica e
--     `.../avatars/<WORKER_UUID>/avatar_<ts>.png` e vai para o `src` do <img> do cartao
--     (`CompanyReferrals.tsx:66`). Ler o uuid e abrir o DevTools.
--
--     Isso e ACEITAVEL a partir de DS-PII-1 (ADR-20260821-uuid-de-freela-nao-e-credencial-de-pii):
--     `can_view_worker_profile` deixa de conceder leitura por `team_connections.status='pending'`,
--     logo conhecer o uuid nao destrava mais `cpf/phone/pix_key/birth_date`. O que sobra —
--     a empresa criar um convite `pending` para quem viu no cartao — e o proprio objetivo de F10,
--     com o consentimento no lugar certo (o freela aceita ou nao; o veto `blocked` continua
--     indelevel). DS-PII-5 troca a convencao de path por chave aleatoria em uploads novos;
--     e defesa em profundidade, NAO e o que torna a vitrine segura.
--
--     PRE-REQUISITO DE MERGE: sem DS-PII-1 aplicada, esta funcao vaza CPF/PIX por escalada.
--     Ver §6.5-bis.
--   - `avatar_url` e SO `w.avatar_url`. NAO usar `coalesce(w.avatar_url, w.photo_url)`:
--     `photo_url` NAO e coluna de `workers` — e um alias montado no client
--     (WorkerPublicProfile.tsx:114 faz `photo_url: profileData.avatar_url`). Corpo de plpgsql
--     nao e validado no CREATE, entao a coluna inexistente so explodiria EM RUNTIME, na
--     primeira empresa que abrisse um cartao.
--   - Nao aceita "por qual empresa perguntar": a unica entrada e o referral_id e a
--     autorizacao e sempre sobre auth.uid() (precedente is_shift_call_target, F1).
--   - STABLE: nao escreve nada, nem contador de visualizacao.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_worker_referral_card(p_referral_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid   uuid := (SELECT auth.uid());
    v_ref   public.worker_referrals%ROWTYPE;
    v_card  jsonb;
BEGIN
    IF v_uid IS NULL OR p_referral_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    SELECT * INTO v_ref FROM public.worker_referrals r WHERE r.id = p_referral_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- SO a empresa DESTINO. A empresa que indicou nao precisa desta funcao: ela ja tem
    -- vinculo de elenco e le `workers` normalmente por can_view_worker_profile. Cada papel
    -- extra aqui e mais uma porta para auditar.
    IF NOT public.is_company_owner(v_ref.requesting_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Vitrine so vale enquanto a indicacao esta viva ou ja virou vinculo. Cancelada/recusada/
    -- expirada nao rende cartao (e a empresa destino nem soube que existiu).
    IF v_ref.status NOT IN ('awaiting_worker', 'accepted') THEN
        RETURN jsonb_build_object('outcome', 'not_available');
    END IF;
    IF v_ref.status = 'awaiting_worker' AND v_ref.expires_at <= now() THEN
        RETURN jsonb_build_object('outcome', 'not_available');
    END IF;

    SELECT jsonb_build_object(
               'full_name',      w.full_name,
               'avatar_url',     w.avatar_url,
               'rating_average', w.rating_average,
               'reviews_count',  w.reviews_count,
               'primary_role',   w.primary_role,
               'roles',          w.roles
           )
      INTO v_card
      FROM public.workers w
     WHERE w.id = v_ref.worker_id;

    IF v_card IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_available');
    END IF;

    RETURN jsonb_build_object(
        'outcome',     'ok',
        'referral_id', v_ref.id,
        'status',      v_ref.status,
        'message',     v_ref.message,
        'created_at',  v_ref.created_at,
        'expires_at',  v_ref.expires_at,
        -- Dado PUBLICO de empresa (companies tem SELECT USING(true)) — nao e dado de pessoa.
        'referring_company', (
            SELECT jsonb_build_object('id', c.id, 'name', c.name, 'logo_url', c.logo_url)
              FROM public.companies c WHERE c.id = v_ref.referring_company_id
        ),
        -- O uuid do freela SO depois do aceite. Antes disso ele e a chave que permitiria
        -- convidar o freela por fora (tc_insert_company) e tornar o "sim" dispensavel.
        'worker_id',   CASE WHEN v_ref.status = 'accepted' THEN v_ref.worker_id ELSE NULL END,
        'card',        v_card
    );
END;
$$;

COMMENT ON FUNCTION public.get_worker_referral_card(uuid) IS
    'F10 — vitrine pre-aceite. Projecao EXAUSTIVA e fechada de workers (full_name, avatar_url, '
    'rating_average, reviews_count, primary_role, roles). NUNCA cpf/phone/pix_key/birth_date, e '
    'nunca worker_id enquanto pendente. Nao aceita "por qual empresa perguntar" — autorizacao '
    'sempre sobre auth.uid(). can_view_worker_profile E alterada por DS-PII-1 (§6.5-bis).';


-- ---------------------------------------------------------------------------
-- 6.5-bis  DS-PII-1..3 — CONDICAO DE MERGE DE F10
--
-- Emenda de 21/08/2026. Decisao completa e alternativas rejeitadas:
-- .harness/memory-bank/decisions/ADR-20260821-uuid-de-freela-nao-e-credencial-de-pii.md
--
-- A versao anterior deste contrato afirmava que `cpf/phone/pix_key/birth_date` "NUNCA saem".
-- A afirmacao era verdadeira sobre a PROJECAO e falsa sobre o SISTEMA: com o uuid em maos, a
-- empresa destino insere `team_connections` em 'pending' (tc_insert_company, 20260622000000:103)
-- e `can_view_worker_profile` (20260816120000) le a linha inteira de `workers`. O uuid era
-- credencial portadora — e por isso o defeito NAO e o path do bucket: uma SEGUNDA instancia,
-- ja aplicada em producao, entrega o uuid como coluna, sem path nenhum
-- (`get_profile_reviews`, 20260816130000:143, devolve `reviewer_id` cru).
--
-- MIGRATION NOVA (numeracao apos 20260817001500; F10 nao foi aplicada, entao nao ha migration
-- de correcao a escrever para ela — mas DS-PII-1 e DS-PII-3 corrigem policies que ESTAO em
-- producao desde 16/08).
--
-- DS-PII-1 (BLOQUEANTE) — can_view_worker_profile perde o ramo 'pending'
--   Ramos que ficam: (0) self; (1) team_connections.status = 'accepted'; (2) vinculo
--   operacional via `applications` em `jobs` da empresa. O ramo 'pending' sai.
--   PII de pessoa natural passa a exigir consentimento do titular ou trabalho real em curso.
--   Regra: 'pending' e a empresa dizendo "quero"; 'accepted' e a pessoa dizendo "pode".
--
-- DS-PII-2 (BLOQUEANTE) — list_team_connection_cards(), SEM PARAMETRO
--   DS-PII-1 quebraria o cartao de convite pendente: teamConnectionService.listAllConnections
--   (:538) embute `worker:workers(...)` sem filtrar status, e sob PostgREST o embed de linha
--   negada vem `null` (cartao sem nome) — sem erro, igual ao padrao de patterns.md
--   "DELETE/UPDATE sob RLS negado silenciosamente".
--   RPC SECURITY DEFINER, search_path = '', SEM PARAMETRO (precedente is_shift_call_target /
--   list_worker_referral_cards: funcao que aceita "por qual empresa listar" e varredura com
--   passo de uuid). Projecao fechada e exaustiva — EXATAMENTE os seis campos que a tela ja
--   consome, nenhum deles PII:
--       id, full_name, avatar_url, primary_role, rating_average, city
--   `listTeamMembers` (:479, filtra 'accepted') NAO muda: la o consentimento existe e
--   phone/pix_key sao o insumo do modo A.
--
-- DS-PII-3 (BLOQUEANTE, e o unico item vivo em PRODUCAO) — get_profile_reviews
--   Com p_direction = 'company' o avaliador e FREELA: a funcao mascara o NOME ("Carlos S.") e
--   entrega o uuid ao lado. `reviewer_id` passa a sair NULL quando o caller nao e o dono do
--   perfil avaliado — MESMO predicado que ja governa o mascaramento, aplicado ao campo que
--   ninguem olhou. Com p_direction = 'worker' o avaliador e empresa e `companies.id` e publico
--   (SELECT USING (true)): segue saindo.
--   Consumidor: ProfileReviews.tsx usa `reviewer_id` como key de lista -> passa a usar
--   `review_id`, que ja vem e e unico.
--
-- NAO BLOQUEANTES (nao entram nesta migration):
--   DS-PII-4 — a vitrine MANTEM `avatar_url` em `awaiting_worker` (ver §6.5). Omitir a foto
--     custaria a prova social que e o mecanismo da feature, para comprar o que DS-PII-1 da
--     de graca e melhor.
--   DS-PII-5 — `Profile.tsx:315` passa a usar crypto.randomUUID() no path, em uploads NOVOS.
--     Backfill (mover objeto no Storage + reescrever workers.avatar_url) e tarefa de ops
--     pre-piloto, nao cabe em SQL. `CompanyProfile.tsx:233` usa a mesma convencao com
--     `companies.id`, que e publico — nao vaza HOJE, mas passa a vazar um auth.users.id de
--     pessoa natural quando o F3 (multi-unidade/gerente) entrar pela costura
--     is_company_owner/is_job_owner. Trocar agora custa uma linha.
--
-- ARTICLE 8 INTACTO: nenhuma das tres toca saldo, escrow ou wallet_transactions.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 6.6 list_worker_referral_cards — caixa de entrada de A, SEM PARAMETRO
--
-- Existe porque a RLS de A cobre so `status='accepted'` (secao 5): A nao consegue listar as
-- pendentes pela tabela. Sem parametro de propria vontade: uma funcao que aceitasse
-- "por qual empresa listar" seria uma varredura com passo de uuid. Precedente:
-- is_shift_call_target, que e sempre sobre auth.uid().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_worker_referral_cards()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_now timestamptz := now();
    v_out jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    -- Ancoragem dupla materializada (a mesma de is_company_owner). O ramo `= auth.uid()` so
    -- entra se auth.uid() FOR mesmo uma empresa — senao um freela varreria pelo proprio uid.
    -- (Na pratica o CHECK worker_id <> requesting_company_id ja tornaria o resultado vazio;
    -- a condicao esta aqui para nao depender disso.)
    WITH mine AS (
        SELECT c.id FROM public.companies c WHERE c.owner_id = v_uid
        UNION
        SELECT c.id FROM public.companies c WHERE c.id = v_uid
    )
    -- ORDER BY na coluna timestamptz, NUNCA no texto de dentro do jsonb: a serializacao de
    -- timestamptz depende do TimeZone da sessao, entao ordenar por `x->>'created_at'` da uma
    -- ordem que muda com o cliente.
    SELECT coalesce(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb)
      INTO v_out
      FROM (
        SELECT r.created_at AS ord, jsonb_build_object(
                   'referral_id', r.id,
                   'status',      r.status,
                   'message',     r.message,
                   'created_at',  r.created_at,
                   'expires_at',  r.expires_at,
                   'referring_company', jsonb_build_object(
                       'id', c.id, 'name', c.name, 'logo_url', c.logo_url),
                   'worker_id',   CASE WHEN r.status = 'accepted' THEN r.worker_id ELSE NULL END,
                   'card', jsonb_build_object(
                       'full_name',      w.full_name,
                       'avatar_url',     w.avatar_url,
                       'rating_average', w.rating_average,
                       'reviews_count',  w.reviews_count,
                       'primary_role',   w.primary_role,
                       'roles',          w.roles)
               ) AS x
          FROM public.worker_referrals r
          JOIN public.workers   w ON w.id = r.worker_id
          JOIN public.companies c ON c.id = r.referring_company_id
         WHERE r.requesting_company_id IN (SELECT id FROM mine)
           AND (
                 r.status = 'accepted'
              OR (r.status = 'awaiting_worker' AND r.expires_at > v_now)
           )
      ) s;

    RETURN jsonb_build_object('outcome', 'ok', 'items', v_out);
END;
$$;

COMMENT ON FUNCTION public.list_worker_referral_cards() IS
    'F10 — caixa de entrada de indicacoes da empresa da sessao. SEM PARAMETRO de proposito: '
    'nao aceita "por qual empresa listar", para nao virar varredura. Mesma projecao fechada de '
    'get_worker_referral_card (worker_id so apos o aceite).';


-- ---------------------------------------------------------------------------
-- 6.7 expire_worker_referrals — housekeeping (service_role apenas)
-- Nao agenda pg_cron: a expiracao preguicosa em accept_worker_referral ja impede que uma
-- linha vencida produza efeito. Esta funcao existe para higiene de listagem/indice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_worker_referrals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE public.worker_referrals
       SET status = 'expired'
     WHERE status = 'awaiting_worker'
       AND expires_at <= now();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.expire_worker_referrals() IS
    'F10 — housekeeping: fecha indicacoes vencidas (libera o par no indice unico parcial). '
    'Apenas service_role. A expiracao preguicosa no accept ja impede efeito de linha vencida.';


-- =============================================
-- 7. TRIGGER DE NOTIFICACAO (R9)
--    Notificacao a contraparte e GARANTIA DO PRODUTO, nao cortesia da UI — mesma conclusao de
--    notify_worker_on_shift_payment (20260816140000) e de
--    trg_notify_counterpart_on_application_cancel (20260816150000). Por isso trigger DEFINER,
--    e nao INSERT no client: a policy de INSERT em `notifications` exige
--    `user_id = auth.uid()`, entao nenhum dos dois lados consegue notificar o outro.
--
--    `notifications.type` tem CHECK (status_change | message | payment | system) desde
--    20250209120000 -> usar 'status_change'. NAO inventar tipo novo aqui.
--
--    NEUTRALIDADE (R6): B recebe a MESMA mensagem em accepted, declined e expired. Se o
--    aceite fosse distinguivel, a recusa passaria a ser inferivel por eliminacao — e a
--    neutralidade da recusa e o que impede a feature de virar um oraculo sobre o freela.
-- =============================================
CREATE OR REPLACE FUNCTION public.notify_on_worker_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_referring_name text;
    v_requesting_name text;
    v_worker_name    text;
    v_referring_user uuid;
    v_requesting_user uuid;
BEGIN
    SELECT c.name, coalesce(c.owner_id, c.id) INTO v_referring_name, v_referring_user
      FROM public.companies c WHERE c.id = NEW.referring_company_id;
    SELECT c.name, coalesce(c.owner_id, c.id) INTO v_requesting_name, v_requesting_user
      FROM public.companies c WHERE c.id = NEW.requesting_company_id;

    IF TG_OP = 'INSERT' THEN
        -- R9: o freela SEMPRE sabe que foi indicado. Vocabulario: "indicou", nunca "passou",
        -- "cedeu" ou "emprestou".
        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            NEW.worker_id,
            'status_change',
            'Voce foi indicado',
            coalesce(v_referring_name, 'Uma empresa do seu elenco')
                || ' indicou voce para ' || coalesce(v_requesting_name, 'outra empresa')
                || '. Quer se conectar?',
            '/indicacoes'
        );
        RETURN NEW;
    END IF;

    -- UPDATE: so reage a saida de 'awaiting_worker'.
    IF OLD.status <> 'awaiting_worker' OR NEW.status = 'awaiting_worker' THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'accepted' THEN
        SELECT w.full_name INTO v_worker_name FROM public.workers w WHERE w.id = NEW.worker_id;
        -- R8: PRIMEIRA e unica vez que a empresa destino ouve falar desta indicacao.
        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            v_requesting_user,
            'status_change',
            'Indicacao aceita',
            coalesce(v_worker_name, 'Um freela')
                || ' aceitou a indicacao de ' || coalesce(v_referring_name, 'outra empresa')
                || ' e agora faz parte do seu elenco.',
            '/company/team'
        );
    END IF;

    IF NEW.status = 'cancelled' THEN
        -- R12: quem cancelou foi B; o freela precisa saber que a indicacao saiu do ar.
        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            NEW.worker_id,
            'status_change',
            'Indicacao retirada',
            coalesce(v_referring_name, 'A empresa') || ' retirou a indicacao. Nada muda para '
                || 'voce — voce continua no elenco de sempre.',
            '/indicacoes'
        );
    ELSE
        -- accepted | declined | expired -> MESMA mensagem para B, de proposito (ver cabecalho).
        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            v_referring_user,
            'status_change',
            'Indicacao finalizada',
            'A indicacao que voce enviou nao esta mais pendente.',
            '/company/indicacoes'
        );
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Best-effort: falha de notificacao NUNCA derruba a transicao da indicacao. Mesmo padrao
    -- de notify_worker_on_shift_payment.
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_on_worker_referral() IS
    'F10 — notifica freela (criacao/cancelamento), empresa destino (so no aceite, R8) e empresa '
    'indicadora (mensagem IDENTICA em aceite/recusa/expiracao, R6 — neutralidade). SECURITY '
    'DEFINER porque a policy de INSERT em notifications exige user_id = auth.uid().';

DROP TRIGGER IF EXISTS trg_notify_on_worker_referral_insert ON public.worker_referrals;
CREATE TRIGGER trg_notify_on_worker_referral_insert
    AFTER INSERT ON public.worker_referrals
    FOR EACH ROW
    WHEN (NEW.status = 'awaiting_worker')
    EXECUTE FUNCTION public.notify_on_worker_referral();

DROP TRIGGER IF EXISTS trg_notify_on_worker_referral_update ON public.worker_referrals;
CREATE TRIGGER trg_notify_on_worker_referral_update
    AFTER UPDATE OF status ON public.worker_referrals
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION public.notify_on_worker_referral();


-- =============================================
-- 8. TRIGGER DE VETO EM `team_connections` (defesa PROATIVA do caso V-c)
--    No instante em que uma conexao vira 'blocked', toda indicacao pendente daquele freela
--    com aquela empresa morre — nas DUAS pontas:
--      - empresa como DESTINO: o freela vetou A; a indicacao para A nao pode sobreviver.
--      - empresa como INDICADORA: o freela vetou B; B perde na hora o direito de continuar
--        falando por ele.
--
--    ANCORAGEM EM `OLD` (achado DS8 da F8): a pergunta e "de quem era o vinculo que esta
--    sendo destruido?" — a identidade vem de OLD.worker_id / OLD.company_id. Hoje nenhuma
--    policy permite trocar essas colunas num UPDATE, entao NEW teria os mesmos valores; usar
--    OLD e o que continua correto se isso mudar.
--
--    Termina como 'declined' (nao um status proprio de veto): B le as proprias linhas por
--    RLS, e um 'blocked_by_veto' gravado contaria a B exatamente o que a R3 esconde.
--
--    SEM ramo de DELETE de proposito: sair do elenco (linha deletada) NAO mata a indicacao
--    pendente — ver "CICLO DE VIDA" no cabecalho.
-- =============================================
CREATE OR REPLACE FUNCTION public.cancel_referrals_on_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.worker_referrals r
       SET status = 'declined', responded_at = now()
     WHERE r.worker_id = OLD.worker_id
       AND r.status    = 'awaiting_worker'
       AND (
             r.requesting_company_id = OLD.company_id
          OR r.referring_company_id  = OLD.company_id
       );
    RETURN NULL;  -- AFTER trigger: retorno ignorado.
EXCEPTION WHEN OTHERS THEN
    -- Best-effort: nunca derrubar o bloqueio do freela por causa desta limpeza. A defesa
    -- REATIVA (re-checagem com FOR UPDATE dentro de accept_worker_referral) continua de pe.
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.cancel_referrals_on_block() IS
    'F10 — quando uma team_connections vira "blocked", encerra as indicacoes pendentes do '
    'freela com aquela empresa (nas duas pontas). Ancorada em OLD (identidade do vinculo que '
    'esta sendo vetado). Defesa proativa; a reativa e a re-checagem no accept_worker_referral.';

DROP TRIGGER IF EXISTS trg_cancel_referrals_on_block ON public.team_connections;
CREATE TRIGGER trg_cancel_referrals_on_block
    AFTER UPDATE OF status ON public.team_connections
    FOR EACH ROW
    WHEN (NEW.status = 'blocked' AND OLD.status IS DISTINCT FROM 'blocked')
    EXECUTE FUNCTION public.cancel_referrals_on_block();


-- =============================================
-- 9. GRANTS DE FUNCAO
--    Sem GRANT EXECUTE, `.rpc()` do supabase-js falha (PostgREST). `REVOKE ... FROM PUBLIC,
--    anon` primeiro: a 20260816201420 fez exatamente isso para funcoes DEFINER, e a
--    20260816201457 restaurou o EXECUTE de `authenticated` nas funcoes de TRIGGER — sem ele
--    o statement do usuario falha ao disparar o trigger.
-- =============================================
REVOKE ALL ON FUNCTION public.create_worker_referral(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_worker_referral(uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_worker_referral(uuid)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_worker_referral(uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_worker_referral_card(uuid)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_worker_referral_cards()                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_worker_referrals()                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_worker_referral()                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_referrals_on_block()                    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_worker_referral(uuid, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_worker_referral(uuid)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_worker_referral(uuid)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_worker_referral(uuid)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_worker_referral_card(uuid)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_worker_referral_cards()                   TO authenticated, service_role;

-- Housekeeping: NAO exposta ao client.
GRANT EXECUTE ON FUNCTION public.expire_worker_referrals() TO service_role;

-- Funcoes de trigger: `authenticated` precisa de EXECUTE para que o proprio statement dele
-- (o UPDATE de bloqueio, a RPC que insere) consiga disparar o trigger (20260816201457).
GRANT EXECUTE ON FUNCTION public.notify_on_worker_referral() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_referrals_on_block() TO authenticated, service_role;


-- ============================================================================
-- DOWN (rollback manual — copiar/colar, ordem inversa das dependencias)
-- ============================================================================
--   DROP TRIGGER IF EXISTS trg_cancel_referrals_on_block ON public.team_connections;
--   DROP TRIGGER IF EXISTS trg_notify_on_worker_referral_update ON public.worker_referrals;
--   DROP TRIGGER IF EXISTS trg_notify_on_worker_referral_insert ON public.worker_referrals;
--   DROP FUNCTION IF EXISTS public.cancel_referrals_on_block();
--   DROP FUNCTION IF EXISTS public.notify_on_worker_referral();
--   DROP FUNCTION IF EXISTS public.expire_worker_referrals();
--   DROP FUNCTION IF EXISTS public.list_worker_referral_cards();
--   DROP FUNCTION IF EXISTS public.get_worker_referral_card(uuid);
--   DROP FUNCTION IF EXISTS public.cancel_worker_referral(uuid);
--   DROP FUNCTION IF EXISTS public.decline_worker_referral(uuid);
--   DROP FUNCTION IF EXISTS public.accept_worker_referral(uuid);
--   DROP FUNCTION IF EXISTS public.create_worker_referral(uuid, uuid, uuid, text);
--   DROP TABLE IF EXISTS public.worker_referrals;
--   ALTER TABLE public.workers DROP COLUMN IF EXISTS accepts_referrals;
--   -- ATENCAO: NAO reverter o CHECK de team_connections.source antes de conferir que nenhuma
--   -- linha ficou com source='referral' (o DOWN acima nao desfaz os aceites ja realizados):
--   --   SELECT count(*) FROM public.team_connections WHERE source = 'referral';
--   -- Se for 0:
--   --   ALTER TABLE public.team_connections DROP CONSTRAINT IF EXISTS team_connections_source_check;
--   --   ALTER TABLE public.team_connections ADD CONSTRAINT team_connections_source_check
--   --       CHECK (source IN ('qr','link','phone'));
-- ============================================================================
```

---

## 2. Como verificar (read-only, depois de aplicar)

```sql
-- V1. RLS ligada, FORCE desligada
SELECT relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE oid = 'public.worker_referrals'::regclass;
-- ESPERADO: t | f

-- V2. TRES policies, TODAS de SELECT (nenhuma de UPDATE/DELETE/INSERT)
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'worker_referrals' ORDER BY 1;
-- ESPERADO: 3 linhas, cmd = SELECT nas tres.

-- V3. A empresa DESTINO nao alcanca linha pendente pela tabela (o achado BLOCKER)
SELECT qual FROM pg_policies WHERE policyname = 'wr_select_requesting_company';
-- ESPERADO: contem  (status = 'accepted'::text)

-- V4. Nenhuma funcao DEFINER sem search_path travado
SELECT p.proname, p.prosecdef, p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE '%worker_referral%';
-- ESPERADO: prosecdef = t e proconfig = {"search_path="} em TODAS.

-- V5. anon sem EXECUTE em nenhuma RPC da feature
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE '%worker_referral%';
-- ESPERADO: f em todas.

-- V6. can_view_worker_profile INTACTA (Out-of-scope respeitado)
SELECT qual FROM pg_policies WHERE tablename = 'workers' AND cmd = 'SELECT';
-- ESPERADO: can_view_worker_profile(id) — exatamente como antes da F10.

-- V7. source aceita 'referral'
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname = 'team_connections_source_check';
-- ESPERADO: CHECK (source = ANY (ARRAY['qr','link','phone','referral']))

-- V8. Indice unico parcial no par pendente
SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_worker_referrals_pending';
-- ESPERADO: UNIQUE ... (worker_id, requesting_company_id) WHERE (status = 'awaiting_worker')
```

### Teste manual obrigatorio antes de produção (o veto)

1. X aceita elenco de B. X bloqueia A (`blockConnection`).
2. B tenta indicar X para A → outcome **`not_available`**; `SELECT count(*) FROM worker_referrals` = 0;
   `SELECT count(*) FROM notifications WHERE user_id = X AND created_at > ...` = 0.
3. Agora com A **sem** bloqueio: B indica X para A → `created`. X bloqueia A **antes** de responder →
   conferir `worker_referrals.status = 'declined'` (trigger proativo).
4. Reabrir o cenário e, com o referral pendente, forçar o bloqueio **na mesma janela** do aceite
   (duas sessões psql, `BEGIN` em ambas) → o aceite tem de devolver `blocked_by_you` e
   `team_connections.status` continuar `'blocked'`.
5. Com sessão de A (JWT de empresa), rodar `select * from worker_referrals` **enquanto pendente** →
   **0 linhas**; e `select * from workers where id = X` → **0 linhas**.

---

## 3. Contrato para o frontend (o builder implementa contra isto)

| Ação | Chamada | Observação |
|---|---|---|
| B indica | `supabase.rpc('create_worker_referral', { p_worker_id, p_referring_company_id, p_requesting_company_id, p_message })` | Mapear **todos** os outcomes. `not_available` → **uma** mensagem: *"Não foi possível concluir a indicação."* Nunca detalhar, nunca logar o motivo no client. |
| B lista/cancela | `from('worker_referrals').select(...)` / `rpc('cancel_worker_referral')` | B lê as próprias linhas por RLS. |
| A lista | `supabase.rpc('list_worker_referral_cards')` | **Sem parâmetro.** Não tentar `from('worker_referrals')` pré-aceite: retorna 0 linhas por design. |
| A abre um cartão | `supabase.rpc('get_worker_referral_card', { p_referral_id })` | `worker_id` vem `null` enquanto pendente — a UI **não** deve ter caminho que dependa dele antes do aceite. |
| Freela lista | `from('worker_referrals').select(...).eq('status','awaiting_worker')` + join de empresas | RLS já filtra por `worker_id`. |
| Freela responde | `rpc('accept_worker_referral')` / `rpc('decline_worker_referral')` | `blocked_by_you` → *"Você bloqueou esta empresa. Para se conectar, reative o vínculo nas suas configurações de bloqueio."* |
| Opt-out | `from('workers').update({ accepts_referrals })` | Só o próprio freela. |

**Tipos (`frontend/src/types/index.ts`, à mão — Article 2):**
```ts
export type WorkerReferralStatus =
  | 'awaiting_worker' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface WorkerReferral {
  id: string;
  worker_id: string;
  referring_company_id: string;
  requesting_company_id: string;
  status: WorkerReferralStatus;
  message?: string | null;
  created_by?: string | null;
  created_at: string;
  expires_at: string;
  responded_at?: string | null;
}

/** Projeção fechada devolvida por get_worker_referral_card / list_worker_referral_cards.
 *  NUNCA estender com cpf/phone/pix_key/birth_date sem novo gate do architect. */
export interface WorkerReferralCard {
  referral_id: string;
  status: WorkerReferralStatus;
  message?: string | null;
  created_at: string;
  expires_at: string;
  referring_company: { id: string; name: string; logo_url?: string | null };
  /** null enquanto `status !== 'accepted'` — por design (ver ddl-aprovado §5). */
  worker_id: string | null;
  card: {
    full_name: string;
    avatar_url?: string | null;
    rating_average?: number | null;
    reviews_count?: number | null;
    primary_role?: string | null;
    roles?: string[] | null;
  };
}
```
E em `WorkerProfile`: `accepts_referrals?: boolean;`

**Vocabulário (requisito, não estética):** "indicar", "indicação", "indicado por", "quem te indicou".
Proibidos em qualquer string de UI, comentário, nome de arquivo, rota ou variável:
*trocar, troca, emprestar, empréstimo, ceder, transferir, repassar, passar o contato*.
Rotas: `/indicacoes` (worker), `/company/indicacoes` (empresa) — os links das notificações apontam
para elas, então mudar a rota exige mudar o trigger.

---

## 4. Landmines para o builder

- **LM-1 — Não "consertar" a RLS de A.** Vai parecer bug que A não vê a própria indicação pendente na
  tabela. É o achado central do gate (§0). Se aparecer um `from('worker_referrals')` na tela de A
  esperando linhas pendentes, é regressão de segurança, não ajuste de UX.
- **LM-2 — Não montar o cartão no client.** Nunca `from('workers').select(...)` para a tela de A: a
  policy devolve 0 linhas e a "correção" natural (abrir `can_view_worker_profile`) é exatamente o
  Out-of-scope da spec e desfaz a `20260816120000`.
- **LM-3 — `not_available` é opaco.** Não instrumentar, não mandar para o Sentry com o `p_worker_id`,
  não escrever "provavelmente a pessoa não aceita indicações" no toast. O motivo mora no log do
  Postgres, e só.
- **LM-4 — Os tetos são constantes na função.** Ajustar valor = nova migration com
  `CREATE OR REPLACE FUNCTION`. Não replicar os números no client como se fossem verdade (o client
  pode mostrar o teto, mas quem decide é o banco).
- **LM-5 — `jsonb` de RPC no supabase-js** volta como `data` já parseado; `outcome` sempre existe.
  Tratar `error` (rede/permissão) e `data.outcome` (regra de negócio) como caminhos distintos.
- **LM-6 — Notificação tem CHECK de `type`.** Só `status_change | message | payment | system`. Um
  `'referral'` novo exigiria alterar o CHECK — não faz parte desta fatia.
- **LM-7 — `expires_at` não é editável.** Não expor "estender prazo": não há RPC para isso e a coluna
  não tem policy de UPDATE. Reindicar depois do vencimento é o caminho (respeitando T2).
- **LM-8 — Não deletar linha de `worker_referrals` pelo client.** Não há policy de DELETE; `cancelled`
  é o caminho. Um `.delete()` volta 204 com 0 linhas afetadas e a UI vai mentir se não checar
  `.select()` — mesma armadilha documentada em `removeFromTeam`.

---

## 5. Questões que este gate NÃO resolve (ficam para o humano)

1. **Default do opt-out** (`accepts_referrals = true`). O DDL segue a Suposição 3 da spec. Inverter
   para `false` é trocar o DEFAULT + backfill — 2 linhas de migration, decisão de produto/LGPD, não
   de arquitetura.
2. ~~**Como B identifica A** (Suposição 2). O DDL só exige um `uuid` de `companies` que exista. A busca
   (Worki ID / CNPJ / telefone) é UI e não muda o modelo. **Alerta:** uma busca de empresas por
   nome/CNPJ é uma superfície nova de enumeração de `companies` — se o builder precisar de RPC para
   isso, volta ao gate.~~
   → **RESOLVIDA em 21/08/2026 pelo gate: ver §6 (DS-BUSCA)** e
   `ADR-20260821-busca-de-empresas-acoplada-ao-debito-10.md`. Resumo: a busca fica como leitura
   direta (`from('companies').ilike(...)`), **sem RPC**, porque `companies` já é `SELECT USING (true)`
   (débito #10) e a projeção da F10 é subconjunto estrito do que já está aberto. A decisão é
   **acoplada ao débito #10** e traz três exigências imediatas.
3. **A poder desistir antes do aceite** (Questão aberta da spec). Não implementado: sem RPC, sem
   outcome. Se o humano quiser, é uma sétima RPC, não uma policy de UPDATE.
4. **Valores dos tetos** (20 / 3 / 5). Chutados com folga para o piloto; revisar com dado real.

---

## 6. EMENDA 2026-08-21 — DS-BUSCA: a busca da empresa destino

> **Emenda de gate.** Resolve a Questão aberta #2 da §5, escalada pelo `harness-frontend-reviewer`
> (achado MÉDIO sobre `CreateReferralModal.tsx:76-81`). Justificativa completa em
> `.harness/memory-bank/decisions/ADR-20260821-busca-de-empresas-acoplada-ao-debito-10.md`.
> **Nada mais da F10 é reaberto** — os 4 BLOCKERs do gate original seguem fechados.

### DS-BUSCA — leitura direta aprovada, **acoplada ao débito #10**

`CreateReferralModal` pode buscar a empresa destino com
`from('companies').select('id, name, logo_url').ilike('name', …).neq('id', B).limit(8)`.
**Não** é exigida RPC agora.

Por quê: `companies` tem `SELECT USING (true)` para `authenticated` desde `20260317160000` — dívida
**#10** de `.harness/memory-bank/debitos-pre-piloto.md`. Quem quisesse enumerar `companies` (com
`cnpj`, `email`, `address`) já podia, direto no PostgREST, sem `limit` e sem a F10. A busca devolve
**três colunas não-sensíveis** e no máximo 8 linhas: subconjunto estrito do que já está aberto.
Exposição delta = **zero**. Uma RPC hoje leria a mesma tabela sob a mesma policy — teatro.

**O acoplamento (a parte que não pode se perder):** quando o débito #10 for fechado — isto é, quando
a policy de `companies` deixar de ser `USING (true)` — **esta busca precisa virar RPC na MESMA
migration**. Caso contrário a tela quebra **em silêncio**: RLS que não casa devolve conjunto vazio,
não erro; o campo "Empresa destino" nunca acha ninguém e a F10 fica inoperante sem mensagem alguma.
O contrato da RPC futura (`search_companies_for_referral`) já está escrito no ADR §D2 — não reabrir
o gate para escrevê-lo.

### DS-BUSCA-1 (obrigatório agora) — sanitizar o termo

O termo do usuário entra **cru** num padrão LIKE. `%`, `_`, `*` e `\` são metacaracteres (o PostgREST
aceita `*` como alias de `%`). Digitar `%%` passa no mínimo de caracteres e casa com a tabela inteira
— o guard de comprimento é decorativo hoje. **Remover** `% _ * \` do termo antes de montar o padrão
(remoção, não escape: escape depende da semântica de `ESCAPE` do LIKE **e** da tradução `*`→`%` do
PostgREST; remoção não depende de nenhuma das duas). Nenhum desses caracteres é significativo num
nome de empresa. Cobrir com teste.

### DS-BUSCA-2 (obrigatório agora) — mínimo de 3 caracteres

Hoje são 2. Dois caracteres dentro de `%…%` já é varredura barata. Abaixo de 3: lista vazia, sem
query.

### DS-BUSCA-3 (obrigatório agora) — debounce ~300 ms

`onChange` dispara uma query por tecla e `ilike` com curinga à esquerda sobre coluna não indexada é
*seq scan* em `companies`. Custo de banco, não de segurança — mas é o mesmo botão.

### DS-BUSCA-4 (normativo) — o que **não** pode mudar sem novo gate

`limit(8)`, `neq('id', referringCompanyId)` e a projeção fechada `id, name, logo_url`.
**Proibido `select('*')` aqui**, e proibido acrescentar `cnpj`, `email` ou `address` à projeção —
são exatamente as colunas que fazem do #10 um débito.

### DS-BUSCA-5 (obrigatório agora) — corrigir o comentário do arquivo

O bloco de comentário de `CreateReferralModal.tsx` afirma que a busca "não é uma superfície de
enumeração que o gate ainda não tenha aprovado" e cita `Sidebar.tsx`/`CompanyMessages.tsx` como
precedente. **As duas afirmações são falsas**: o gate havia pedido a escalada (§5.2), e aqueles dois
arquivos leem a **própria linha** por `.eq('id', user.id)`. Levantados todos os `from('companies')`
do frontend, `CreateReferralModal` é o **único** com predicado irrestrito. Substituir o comentário
por: o que a busca é (o primeiro consumidor que depende de `USING (true)`), o apontamento a este
DS-BUSCA e ao ADR, e o acoplamento ao débito #10.
