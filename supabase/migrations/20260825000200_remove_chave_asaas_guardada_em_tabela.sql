-- Migration: duas chaves de API do Asaas estavam guardadas em `wallets`
--
-- ACHADO (25/08/2026, varrendo colunas mortas antes do piloto): `wallets.asaas_api_key` tem DUAS
-- linhas preenchidas, com 166 caracteres cada e prefixo `$aact_` -- o formato real de chave do
-- Asaas, nao placeholder.
--
-- A policy de SELECT de `wallets` e `auth.uid() = user_id`. Ou seja: o dono daquela carteira le a
-- propria chave direto do cliente, com o anon key. Credencial de provedor de pagamento nao devia
-- estar em coluna de tabela de aplicacao em nenhuma hipotese -- e a Constitution do projeto diz
-- isso com todas as letras no Article 10 ("service_role nunca no frontend"; o principio e o
-- mesmo: segredo de provedor vive em `Deno.env` da edge function, nao no banco).
--
-- Sobra do desenho antigo, de quando se cogitou subconta por usuario. Aquele modelo foi
-- abandonado (Article 7: carteira central, sem subcontas) e o Asaas inteiro foi pausado pelo dono
-- em 22/08. Nenhum codigo le esta coluna: a varredura no frontend so encontra `asaas_customer_id`
-- (como campo de tipo), nunca `asaas_api_key`.
--
-- Esta migration APAGA o valor. Nao dropa a coluna: dropar e mudanca de esquema com risco proprio
-- e sem urgencia, e fica para a limpeza pos-piloto junto com as outras oito colunas mortas de
-- Stripe/Asaas.
--
-- ⚠️ APAGAR AQUI NAO INVALIDA A CHAVE. Se essas credenciais ainda existirem no painel do Asaas,
-- elas continuam validas para quem ja as tiver copiado. A acao complementar -- REVOGAR as chaves
-- no Asaas -- e do dono, e esta anotada no LEIA-ME de pre-piloto.
--
-- Article 8: nao toca saldo. `asaas_api_key` nao participa de nenhum calculo de saldo.

UPDATE public.wallets
   SET asaas_api_key = NULL
 WHERE asaas_api_key IS NOT NULL;

COMMENT ON COLUMN public.wallets.asaas_api_key IS
    'MORTA e deve permanecer NULA. Chegou a guardar chave real do Asaas ($aact_..., 166 chars) em '
    'duas linhas, legivel pelo dono da carteira via cliente (RLS de wallets e auth.uid() = '
    'user_id). Zerada em 20260825000200. Segredo de provedor vive em Deno.env da edge function, '
    'nunca em coluna de tabela. Coluna mantida so para nao mexer em esquema as vesperas do piloto; '
    'dropar junto com as demais colunas mortas de Stripe/Asaas depois.';
