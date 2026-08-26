-- Migration: três débitos pré-piloto de uma vez (#2 CHECK, #4 GRANT, #11 avaliação sem turno)
--
-- Os três são independentes entre si e pequenos; vão juntos porque são a mesma classe de dívida:
-- garantia que hoje mora no client e devia morar no banco.
--
-- Article 8: nenhum toca saldo.

-- ═══════════════════════════════════════════════════════════════════════════════
-- #2 — `{}` passava no CHECK de `availability_days`
--
-- `'{}'::jsonb <@ qualquer` é SEMPRE verdadeiro, então o CHECK aceitava objeto vazio. Hoje só não
-- vira bug porque `normalizeAvailabilityGrade` converte para NULL antes de gravar -- garantia de
-- client. Qualquer client alternativo, RPC futura ou regressão no normalizador grava `{}`, e aí o
-- CTA "Declarar disponibilidade" some em silêncio para aquele freela: a UI pergunta "tem grade?" e
-- `{}` responde que sim, sem nenhum período dentro. Bug que não dá erro, só desaparece com a tela.
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_availability_days_shape;

ALTER TABLE public.workers ADD CONSTRAINT workers_availability_days_shape CHECK (
    availability_days IS NULL
    OR (
        jsonb_typeof(availability_days) = 'object'
        -- NULL e '{}' nao podem coexistir como "nao declarou" (LM-8 do DDL): ha UMA representacao.
        AND availability_days <> '{}'::jsonb
        AND availability_days <@ '{"0": ["manha","tarde","noite"], "1": ["manha","tarde","noite"], "2": ["manha","tarde","noite"], "3": ["manha","tarde","noite"], "4": ["manha","tarde","noite"], "5": ["manha","tarde","noite"], "6": ["manha","tarde","noite"]}'::jsonb
        -- Enumerado dia a dia porque CHECK nao aceita subquery. BETWEEN 1 AND 3: dia declarado com
        -- zero periodos e a mesma mentira que `{}`, um nivel abaixo -- "declarei terca" sem terca.
        AND (NOT (availability_days ? '0') OR jsonb_array_length(availability_days -> '0') BETWEEN 1 AND 3)
        AND (NOT (availability_days ? '1') OR jsonb_array_length(availability_days -> '1') BETWEEN 1 AND 3)
        AND (NOT (availability_days ? '2') OR jsonb_array_length(availability_days -> '2') BETWEEN 1 AND 3)
        AND (NOT (availability_days ? '3') OR jsonb_array_length(availability_days -> '3') BETWEEN 1 AND 3)
        AND (NOT (availability_days ? '4') OR jsonb_array_length(availability_days -> '4') BETWEEN 1 AND 3)
        AND (NOT (availability_days ? '5') OR jsonb_array_length(availability_days -> '5') BETWEEN 1 AND 3)
        AND (NOT (availability_days ? '6') OR jsonb_array_length(availability_days -> '6') BETWEEN 1 AND 3)
    )
);

COMMENT ON COLUMN public.workers.availability_days IS
    'Grade semanal declarada: chaves "0".."6" com 0=domingo (mesma convenção de job_series.weekdays '
    'e de getWeekdayIndex), valores subconjunto de [manha,tarde,noite]. NULL = não declarou. '
    '`{}` é PROIBIDO desde 20260825000400 -- duas representações de vazio faziam o CTA de '
    'disponibilidade sumir em silêncio. Dia sem período também é rejeitado.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- #4 — GRANT UPDATE amplo demais em `service_terms`
--
-- `authenticated` tinha UPDATE em praticamente toda coluna da tabela -- inclusive `term_text`,
-- `amount`, `company_id` e `accepted_at`. A imutabilidade do termo dependia SÓ do trigger
-- `enforce_service_term_immutability`.
--
-- Não é preciso nenhum UPDATE direto: o aceite acontece em `accept_service_term`, que é
-- SECURITY DEFINER (conferido no catálogo) e portanto escreve com o dono da função, não com o
-- papel do chamador. Revogar é defesa em profundidade pura: mesmo que o trigger seja removido por
-- engano numa migration futura, o papel não alcança a linha.
-- ═══════════════════════════════════════════════════════════════════════════════
REVOKE UPDATE ON public.service_terms FROM authenticated;
REVOKE INSERT, DELETE ON public.service_terms FROM authenticated;

COMMENT ON TABLE public.service_terms IS
    'Termo de prestação 1:1 com shift_payments. `authenticated` tem SELECT e NADA MAIS desde '
    '20260825000400: escrita é exclusiva de accept_service_term (SECURITY DEFINER). O trigger '
    'enforce_service_term_immutability continua valendo -- os dois juntos, não um no lugar do outro.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- #11 — `reviews` aceitava avaliação sem turno concluído
--
-- A policy de INSERT era só `reviewer_id = auth.uid()`. Nada exigia que existisse turno concluído
-- entre as partes: qualquer conta podia inventar avaliação sobre qualquer id, em qualquer direção.
-- A validação vivia no client -- o comentário da migração original dizia isso com todas as letras
-- ("validated by application status in app logic").
--
-- Isso importa mais aqui do que pareceria: a avaliação alimenta `rating_average` por trigger, e o
-- rating é a prova social que o freela usa para decidir se aceita um convite e que a empresa usa
-- para decidir quem chama. Reputação forjável é pior que reputação ausente.
--
-- POR QUE UMA FUNÇÃO SECURITY DEFINER, E NÃO EXISTS DIRETO NA POLICY:
-- Subquery em policy roda sob a RLS da tabela referenciada. Se a policy de `applications` não
-- deixar o chamador ver a linha, o EXISTS falha e o INSERT é negado -- rejeitando avaliação
-- legítima, em silêncio. É a mesma armadilha que este projeto já pagou duas vezes (a recursão
-- 42P17 de F1 e o "RLS simples mente" da contagem de F3). A pergunta aqui é de autorização, não de
-- visibilidade, então ela é respondida por função DEFINER que devolve só um booleano.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.can_review_for_job(p_job_id uuid, p_reviewed_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_job_id IS NOT NULL
       AND p_reviewed_id IS NOT NULL
       AND auth.uid() IS NOT NULL
       AND auth.uid() <> p_reviewed_id          -- ninguém avalia a si mesmo
       AND EXISTS (
        SELECT 1
          FROM public.applications a
          JOIN public.jobs j ON j.id = a.job_id
         WHERE a.job_id = p_job_id
           AND a.status = 'completed'
           AND (
                -- (a) empresa (ou gerente da unidade) avalia o freela daquele turno
                (    a.worker_id = p_reviewed_id
                 AND (   j.company_id = auth.uid()
                      OR j.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = auth.uid())
                      OR EXISTS (SELECT 1 FROM public.company_members m
                                  WHERE m.company_id = j.company_id
                                    AND m.user_id = auth.uid()
                                    AND m.status = 'accepted'))   -- convite pendente NAO avalia
                )
             OR -- (b) freela avalia a empresa do turno que ele concluiu
                (    a.worker_id = auth.uid()
                 AND (   j.company_id = p_reviewed_id
                      OR j.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = p_reviewed_id))
                )
           )
       );
$$;

COMMENT ON FUNCTION public.can_review_for_job(uuid, uuid) IS
    'Responde "auth.uid() pode avaliar p_reviewed_id pelo turno p_job_id?". Exige applications '
    'concluída ligando as duas partes, nos dois sentidos, e recusa auto-avaliação. DEFINER de '
    'propósito: a pergunta é de autorização, não de visibilidade -- EXISTS direto na policy rodaria '
    'sob a RLS de applications e negaria avaliação legítima em silêncio. Ver débito #11.';

REVOKE ALL ON FUNCTION public.can_review_for_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_review_for_job(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated users can create reviews" ON public.reviews;

CREATE POLICY "reviews_insert_com_turno_concluido"
    ON public.reviews
    FOR INSERT
    TO authenticated
    WITH CHECK (
        reviewer_id = auth.uid()
        AND public.can_review_for_job(job_id, reviewed_id)
    );
