-- Migration: registra no CATALOGO por que wallets.asaas_customer_id nao pode ser limpo
-- Contrato: .harness/spec/lgpd-producao/ddl-aprovado.md §4.3
-- ADR: .harness/memory-bank/decisions/ADR-20260822-token-de-cartao-permanece-no-asaas.md
--
-- Nao muda comportamento: e SO um COMMENT. O ponto e ONDE o aviso mora.
--
-- A decisao de 22/08/2026 aceitou que o token de cartao PERMANECE no Asaas depois da exclusao da
-- conta (nao ha endpoint confirmado para revogar um creditCardToken avulso). O que mantem essa
-- situacao remediavel e esta coluna: `payment_methods` e apagada pela `anonymize_account`, entao
-- depois da exclusao ninguem mais sabe QUAIS tokens eram daquela conta -- mas o
-- `asaas_customer_id` sobrevive em `wallets`, que e INTOCADA por forca do Article 8/9, e o Asaas
-- documenta remocao na granularidade de CLIENTE. A janela de remediacao (J5) so existe por isso.
--
-- Ou seja: uma futura "limpeza de wallets orfas" -- operacao que parece higiene inofensiva --
-- FECHARIA essa janela em silencio, e o efeito so apareceria quando alguem tentasse cumprir um
-- pedido de titular. O aviso estava escrito no ddl-aprovado; quem escreve migration de limpeza
-- le o CATALOGO, nao o contrato. Por isso ele passa a morar aqui.

COMMENT ON COLUMN public.wallets.asaas_customer_id IS
    'ID do cliente no Asaas. ⚠️ NAO APAGAR em limpeza de wallets orfas, e NAO limpar na exclusao '
    'de conta: e o UNICO ponteiro que sobrevive a `anonymize_account` capaz de alcancar os dados '
    'de cartao que permanecem no gateway (o token avulso nao tem endpoint de revogacao '
    'confirmado). Apagar esta coluna torna IMPOSSIVEL cumprir pedido de titular sobre o cartao. '
    'Ver ddl-aprovado.md §4.3 / §5.4-J5 e ADR-20260822-token-de-cartao-permanece-no-asaas.';

COMMENT ON TABLE public.wallets IS
    'Saldo por usuario (Article 7: carteira central Asaas, sem subcontas; Article 8: saldo so muda '
    'por RPC atomica). INTOCADA pela rotina de LGPD (`anonymize_account`) -- e a coluna '
    'asaas_customer_id depende disso para manter a remediacao de cartao possivel apos a exclusao. '
    'Ver COMMENT da coluna antes de planejar qualquer limpeza.';
