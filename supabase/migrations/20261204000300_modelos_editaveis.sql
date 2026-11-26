-- Migration: MODELOS DE TURNO (3/3) - o modelo passa a ser editável
--
-- O dono quer editar um modelo pelo lápis (nome, função, local, horário, vagas, valor). Antes só
-- name e archived_at eram atualizáveis. Agora template e defaults também; a policy de UPDATE
-- (is_company_member_confirmed, WITH CHECK) e os CHECKs de chaves fechadas continuam valendo, e
-- company_id segue imutável (fora do GRANT).
--
-- DOWN: REVOKE UPDATE (template, defaults) ON public.shift_templates FROM authenticated;

GRANT UPDATE (name, template, defaults, archived_at) ON public.shift_templates TO authenticated;

COMMENT ON TABLE public.shift_templates IS
    'Modelo de turno da empresa (criacao rapida). Pertence a empresa. Nunca apagada: arquivar = archived_at. Escrita por Gestor e encarregado confirmado; UPDATE de name, template, defaults e archived_at (o modelo e editavel). Chaves do jsonb fechadas por CHECK. LGPD: sem dado de pessoa; created_by e uuid pseudonimo retido (regua de company_tags).';
