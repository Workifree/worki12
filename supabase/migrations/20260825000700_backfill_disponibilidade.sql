-- Migration: backfill de `availability_days` a partir de `availability`
--
-- ACHADO (25/08/2026, o dono usando o produto no celular): "já registrei minha disponibilidade e o
-- perfil continua pedindo para registrar".
--
-- Reproduzido e medido em produção: **11 dos 16 freelas** têm o campo antigo `availability`
-- preenchido e a grade `availability_days` NULA. Para todos eles o Perfil exibe "Você ainda não
-- declarou sua disponibilidade" — sobre algo que eles declararam.
--
-- O F7 criou a grade e o cadastro passou a preencher as duas (comentário em `WorkerOnboarding.tsx`
-- registra que esse mesmo defeito foi corrigido para contas NOVAS em 22/08). Quem já tinha conta
-- nunca foi convertido. É metade de uma migração de dado: o código novo entrou, o dado velho ficou.
--
-- E não é só cosmético. `availability_days` é o que o `ShiftCallModal` usa para ORDENAR quem
-- aparece primeiro no chamado de turno; `availability` não é lido por nenhuma tela de empresa nem
-- por nenhuma RPC. Enquanto a grade estiver nula, esses 11 freelas não são priorizados em chamado
-- nenhum — o produto os trata como quem não declarou nada.
--
-- A CONVERSÃO É A MESMA DE `gradeAPartirDosChips` (WorkerOnboarding.tsx:30), campo a campo, para
-- que backfill e cadastro nunca discordem:
--   'Manhã'                  -> manha
--   'Tarde'                  -> tarde
--   'Noite' OU 'Madrugada'   -> noite       (madrugada dobra em noite, como no client)
--   'Fim de Semana'          -> só domingo (0) e sábado (6); senão, os sete dias
--   nenhum período marcado   -> os três períodos (quem só disse "Fim de Semana" topa o dia inteiro)
--
-- Não toca quem já tem grade: o `WHERE availability_days IS NULL` garante que uma grade refinada no
-- Perfil nunca é sobrescrita por uma derivação grosseira dos chips.
--
-- Article 8: não toca saldo.

WITH base AS (
    SELECT w.id,
           (w.availability ? 'Manhã')                                      AS tem_manha,
           (w.availability ? 'Tarde')                                      AS tem_tarde,
           ((w.availability ? 'Noite') OR (w.availability ? 'Madrugada'))  AS tem_noite,
           (w.availability ? 'Fim de Semana')                              AS so_fds
      FROM public.workers w
     WHERE w.availability_days IS NULL
       AND w.availability IS NOT NULL
       AND jsonb_typeof(w.availability) = 'array'
       AND jsonb_array_length(w.availability) > 0
),
calc AS (
    SELECT id,
           CASE WHEN so_fds THEN ARRAY['0','6']
                ELSE ARRAY['0','1','2','3','4','5','6'] END AS dias,
           CASE WHEN (tem_manha OR tem_tarde OR tem_noite) THEN
                     (CASE WHEN tem_manha THEN ARRAY['manha'] ELSE ARRAY[]::text[] END
                    || CASE WHEN tem_tarde THEN ARRAY['tarde'] ELSE ARRAY[]::text[] END
                    || CASE WHEN tem_noite THEN ARRAY['noite'] ELSE ARRAY[]::text[] END)
                ELSE ARRAY['manha','tarde','noite'] END AS periodos
      FROM base
)
UPDATE public.workers w
   SET availability_days = (
        SELECT jsonb_object_agg(d, to_jsonb(c.periodos))
          FROM unnest(c.dias) AS d
       )
  FROM calc c
 WHERE w.id = c.id;
