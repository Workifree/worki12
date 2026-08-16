-- Migration: Leitura de autoria das avaliações (RPC) — restaura o nome do avaliador sob a policy
--            de `workers` restrita por vínculo (20260816120000).
-- File: supabase/migrations/20260816130000_profile_reviews_reader.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260816-workers-select-por-vinculo.md (seção
--      "Adendo 2026-08-16 — autoria de avaliações")
--
-- PROBLEMA (achado do harness-evaluator, Onda 1 do spec `revisao-piloto`):
--   `components/ProfileReviews.tsx` resolve o nome de quem escreveu cada avaliação com uma
--   SEGUNDA query, direto na tabela do avaliador:
--       supabase.from(table).select('id, ' + nameField).in('id', reviewerIds)
--   Com `table = 'workers'` (reviewerRole='worker'), sob a policy nova
--   `workers_select_self_or_related` (20260816120000), um FREELA só enxerga a PRÓPRIA linha em
--   `workers`. Logo, na página nova `pages/CompanyPublicProfile.tsx` (R2 — freela olhando o perfil
--   público de uma empresa), o `.in('id', reviewerIds)` volta VAZIO e o componente cai no fallback
--   `'Freela'` (ProfileReviews.tsx:78): TODAS as avaliações passam a aparecer assinadas como
--   "Freela".
--   A tabela `reviews` continua `USING (true)` (20260309000000:109), então nota e comentário
--   aparecem normalmente — só a AUTORIA some. Degrada em silêncio: sem erro, sem log.
--   Isso esvazia a R2, que existe exatamente para o freela ver "o que outros freelas disseram sobre
--   esta empresa" antes de aceitar um convite. "Freela, Freela, Freela" não é prova social.
--
-- ESCOPO REAL (os 3 call sites de ProfileReviews):
--   - `pages/Profile.tsx:797`            reviewerRole='company' -> lê `companies` (USING true) ..... OK
--   - `pages/company/CompanyProfile.tsx:649` reviewerRole='worker' -> empresa lendo os freelas que a
--       avaliaram; todo review de freela nasce de um turno, então existe `applications` -> a branch
--       (2) de `can_view_worker_profile` concede ................................................. OK
--   - `pages/CompanyPublicProfile.tsx:198` reviewerRole='worker' visto por um FREELA ......... QUEBRADO
--   `pages/company/WorkerPublicProfile.tsx:125` resolve nomes em `companies`, cuja policy de SELECT
--   segue `USING (true)` (20260317160000:23) ...................................................... OK
--
-- SOLUÇÃO: RPC `SECURITY DEFINER` que devolve as avaliações JÁ COM o nome do avaliador.
--   Anti-oráculo: a RPC NÃO recebe lista de ids arbitrários. Ela recebe o PERFIL AVALIADO e deriva
--   os avaliadores da própria tabela `reviews` — que já é legível por qualquer autenticado. O único
--   dado novo que sai é o nome de exibição de quem, comprovadamente, avaliou aquele perfil. Não há
--   como alimentar UUIDs escolhidos pelo atacante para descobrir nomes.
--
--   Minimização (nome de pessoa física):
--     - avaliador EMPRESA  -> `companies.name` inteiro (nome comercial, público por natureza).
--     - avaliador FREELA   -> nome MASCARADO ("Carlos S.") para terceiros; nome completo apenas
--       quando quem chama é o DONO do perfil avaliado (self-view em Profile/CompanyProfile), o que
--       preserva 1:1 o comportamento das telas que já existiam.
--     - conta anonimizada pelo `delete-account` (`full_name = '[Conta Deletada]'`) -> NULL, e o
--       frontend cai no rótulo genérico. Como o nome é lido AO VIVO de `workers`, a anonimização
--       LGPD continua valendo retroativamente (é por isso que NÃO desnormalizamos `reviewer_name`
--       dentro de `reviews` — ver "Alternativas rejeitadas" na ADR).
--
-- NÃO TOCA SALDO/ESCROW (Article 8): nenhuma tabela ou RPC financeira. Só leitura.
-- NÃO altera nenhuma policy: `workers_select_self_or_related` (20260816120000) fica EXATAMENTE como
--   está. Esta migration só ADICIONA um caminho de leitura estreito e auditável.
--
-- Risk: LOW (só adiciona função + índice; nenhuma escrita, nenhuma policy alterada).
-- Backup required before production deploy: NO.
--
-- DOWN (rollback): ver bloco no fim do arquivo.

-- =============================================
-- 1. ÍNDICE DE SUPORTE
--    A RPC filtra por (reviewed_id, direction). Sem índice vira seq scan em `reviews`.
--    Sem CONCURRENTLY: migrations do Supabase rodam em transação (CONCURRENTLY é proibido em bloco
--    transacional) e `reviews` é pequena no pré-piloto.
-- =============================================
CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_direction
    ON public.reviews (reviewed_id, direction);

-- =============================================
-- 2. HELPER DE MASCARAMENTO
--    "Carlos Silva Souza" -> "Carlos S."      (prova social crível sem expor identidade completa)
--    "Carlos"             -> "Carlos"
--    "[Conta Deletada]"   -> NULL             (frontend usa o rótulo genérico)
--    NULL / vazio         -> NULL
--    IMMUTABLE: função pura de string. `search_path = ''` (pg_catalog é implícito).
-- =============================================
CREATE OR REPLACE FUNCTION public.mask_display_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN t.v = ''                        THEN NULL
        WHEN t.v LIKE '[%'                   THEN NULL   -- marcador de conta anonimizada
        WHEN array_length(t.parts, 1) = 1    THEN t.parts[1]
        ELSE t.parts[1] || ' ' ||
             upper(left(t.parts[array_length(t.parts, 1)], 1)) || '.'
    END
    FROM (
        SELECT s.v, string_to_array(s.v, ' ') AS parts
        FROM (
            SELECT regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g') AS v
        ) s
    ) t;
$$;

COMMENT ON FUNCTION public.mask_display_name(text) IS
    'Reduz um nome completo a "Primeiro U." para exibição pública. Devolve NULL para vazio ou para '
    'o marcador de conta anonimizada ("[Conta Deletada]"). Usada por get_profile_reviews.';

-- =============================================
-- 3. RPC DE LEITURA DAS AVALIAÇÕES (com autoria)
--
--    p_direction segue a semântica de `reviews.direction` (20260622000200) — descreve QUEM FOI
--    AVALIADO:
--      'worker'  -> empresa avaliou o freela  => o AVALIADOR é uma EMPRESA  (nome em `companies`)
--      'company' -> freela avaliou a empresa  => o AVALIADOR é um FREELA    (nome em `workers`)
--    É o mesmo valor que ProfileReviews.tsx já calcula hoje a partir de `reviewerRole`.
--
--    Tipos: `reviews.reviewer_id` / `reviewed_id` são TEXT no DB (ver 20260314000008 e
--    20260622000200) enquanto `workers.id` / `companies.id` são UUID — todas as comparações usam
--    cast explícito para text. A saída também é castada, para não depender do tipo exato das
--    colunas de `reviews` (a tabela vem do schema legado, não há DDL dela nas migrations).
--
--    SECURITY DEFINER porque precisa ler `workers` por cima da policy restrita por vínculo.
--    Devolve APENAS: id da review, nota, comentário, data, id e NOME DE EXIBIÇÃO do avaliador.
--    NUNCA devolve phone, pix_key, cpf, birth_date, e-mail ou avatar.
--
--    Sem sessão (anon), a WHERE derruba tudo: `auth.uid() IS NOT NULL`.
-- =============================================
CREATE OR REPLACE FUNCTION public.get_profile_reviews(
    p_reviewed_id text,
    p_direction   text
)
RETURNS TABLE (
    review_id     text,
    rating        numeric,
    comment       text,
    created_at    text,
    reviewer_id   text,
    reviewer_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        r.id::text,
        r.rating::numeric,
        r.comment::text,
        -- ISO 8601 explícito em UTC. NÃO usar `::text` puro: o formato do Postgres
        -- ("2026-03-12 10:00:00+00") é rejeitado por parsers de Date mais estritos (Safari).
        -- O `::timestamptz` normaliza caso a coluna legada seja `timestamp without time zone`.
        to_char(r.created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        r.reviewer_id::text,
        (CASE
            -- Avaliador é EMPRESA: nome comercial, sem mascaramento.
            WHEN p_direction = 'worker' THEN (
                SELECT c.name::text
                FROM public.companies c
                WHERE c.id::text = r.reviewer_id::text
            )
            -- Avaliador é FREELA (pessoa física): completo só para o dono do perfil avaliado.
            ELSE (
                SELECT CASE
                    WHEN (
                        p_reviewed_id = auth.uid()::text
                        OR EXISTS (
                            SELECT 1 FROM public.companies co
                            WHERE co.id::text = p_reviewed_id
                              AND co.owner_id = auth.uid()
                        )
                    ) THEN nullif(btrim(coalesce(w.full_name, '')), '')::text
                    ELSE public.mask_display_name(w.full_name)
                END
                FROM public.workers w
                WHERE w.id::text = r.reviewer_id::text
            )
        END)::text
    FROM public.reviews r
    WHERE auth.uid() IS NOT NULL
      AND p_reviewed_id IS NOT NULL
      AND p_direction IN ('worker', 'company')
      AND r.reviewed_id::text = p_reviewed_id
      AND r.direction::text = p_direction
    ORDER BY r.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_profile_reviews(text, text) IS
    'Avaliações recebidas por um perfil, já com o nome de exibição do avaliador. Deriva os '
    'avaliadores da própria tabela reviews (não aceita lista de ids do caller) — não é oráculo de '
    'enumeração de nomes. Freela avaliador aparece mascarado ("Carlos S.") para terceiros e '
    'completo só para o dono do perfil avaliado. Existe porque a policy '
    'workers_select_self_or_related (20260816120000) impede o freela de ler a linha de outro freela.';

-- =============================================
-- 4. GRANTS
--    EXECUTE em função é concedido a PUBLIC por padrão no Postgres — o que exporia a RPC ao papel
--    `anon` via PostgREST. Revogamos e concedemos explicitamente.
--    NOTA: isto é REVOKE em FUNÇÃO, não em TABELA. A lição de 20260318000000
--    (`REVOKE ALL ON <tabela> FROM PUBLIC` derrubou o service_role) não se aplica aqui, e o
--    service_role é re-concedido logo abaixo de qualquer forma.
-- =============================================
REVOKE EXECUTE ON FUNCTION public.get_profile_reviews(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_profile_reviews(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_profile_reviews(text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.mask_display_name(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mask_display_name(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.mask_display_name(text) TO authenticated, service_role;

-- =============================================
-- DOWN (rollback manual — copiar/colar):
--   DROP FUNCTION IF EXISTS public.get_profile_reviews(text, text);
--   DROP FUNCTION IF EXISTS public.mask_display_name(text);
--   DROP INDEX IF EXISTS public.idx_reviews_reviewed_direction;
--   -- e reverter ProfileReviews.tsx para a dupla query (from('reviews') + from(table).in('id',...)),
--   -- lembrando que o nome do avaliador FREELA volta a quebrar para terceiros.
-- =============================================
