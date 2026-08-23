-- Migration: o COMMENT de `link_risk_alert_threshold` descrevia a regra errada
--
-- ACHADO (23/08/2026, testando o F5 no browser): selecionei um freela que ja tinha 1 turno
-- concluido na semana, com a empresa configurada no default (limite 2), esperando o selo de
-- aviso. Nenhum selo. O codigo esta certo -- a regra e `contagem + 1 > limite`, ou seja o limite
-- e o TETO TOLERADO e o aviso aparece acima dele. Isso casa com a entrevista que originou a
-- feature (17/08/2026): "maximo 2x por semana por freela" -- 2 e aceitavel, 3 e que incomoda.
--
-- O que estava errado eram as PALAVRAS, em dois lugares, dizendo o oposto:
--   (a) este COMMENT: "A partir de quantos turnos na MESMA semana corrida avisar"
--   (b) CompanyProfile: "Avisar a partir de quantas vezes por semana" / "Avisando a partir de 2x"
-- Sob essa leitura, limite 2 avisaria NA segunda vez. O operador configura o numero lendo essa
-- frase; com ela, ele calibra a ferramenta um degrau abaixo do que pretende e conclui que o aviso
-- esta quebrado -- foi exatamente o que aconteceu comigo.
--
-- (b) corrigido no mesmo commit. Um terceiro texto, no toggle logo acima, ja dizia certo
-- ("quando um freela do elenco passaria do limite") -- os tres agora concordam.
--
-- Nao ha mudanca de comportamento aqui: so COMMENT. O `>` continua `>`.
--
-- Article 8: nao toca saldo.

COMMENT ON COLUMN public.companies.link_risk_alert_threshold IS
    'TETO TOLERADO de turnos do mesmo freela na MESMA semana corrida (dom-sáb, data local '
    'America/Sao_Paulo). O aviso aparece ACIMA dele: a regra no client é `contagem + 1 > limite`, '
    'então limite 2 avisa na 3ª vez, não na 2ª (entrevista Divino Fogão 17/08/2026: "máximo 2x por '
    'semana por freela" — 2 é aceitável). Default 2; configurável 1..7. NÃO bloqueia nada: só liga '
    'um selo de tela. O client escreve esta coluna DIRETO (grant de tabela em companies) — o CHECK '
    'é a única validação real, não confiar no <input type=number>. Espelhado no client por '
    'components/company/seriesWeekRisk.ts:DEFAULT_LINK_RISK_THRESHOLD (fallback quando a config '
    'não vem). Texto corrigido em 20260823000400: dizia "a partir de quantos turnos avisar", '
    'descrevendo `>=` enquanto o código faz `>`.';
