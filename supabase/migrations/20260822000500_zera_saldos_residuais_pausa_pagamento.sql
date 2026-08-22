-- Migration: zera os saldos e escrows residuais — pausa do processamento de pagamento
-- ADR: .harness/memory-bank/decisions/ADR-20260822-pausa-do-processamento-de-pagamento.md
--
-- CONTEXTO. O owner decidiu em 22/08/2026 que o Asaas foi abandonado e o Worki NAO processa
-- pagamento por enquanto. Sobraram no banco:
--   * 4 carteiras com saldo, somando R$ 8.834,04
--   * 4 escrows em `reserved`
-- Segundo o owner, entrou dinheiro real em algum momento (alguns reais de teste do Asaas) e ele
-- JA FOI SACADO. O saldo que restou nao corresponde a dinheiro devido a ninguem.
--
-- E o raso nao sustenta o saldo, o que confirma a leitura: os 8 lancamentos de
-- `wallet_transactions` somam -R$ 680,64 contra +R$ 8.834,04 de saldo; os dois unicos
-- lancamentos de `credit` sao de R$ 0,00; e uma das carteiras tem R$ 4.700 com ZERO lancamentos.
-- Ou seja, os saldos foram gravados direto na coluna, fora das RPCs.
--
-- POR QUE ISSO PRECISA SER RESOLVIDO E NAO IGNORADO. `anonymize_account` (rotina de exclusao de
-- conta, LGPD) RECUSA a exclusao com `wallet_has_balance` e `escrow_active`. Essas guardas existem
-- para impedir que alguem apague a conta deixando dinheiro para tras — protecao correta. Mas com o
-- pagamento pausado e o saldo sem lastro, elas deixam de proteger dinheiro e passam a IMPEDIR o
-- exercicio do art. 18, VI por causa de residuo de teste. A guarda continua; o residuo sai.
--
-- POR QUE MIGRATION E NAO `UPDATE` SOLTO. O Article 8 proibe `UPDATE wallets SET balance` manual
-- no CLIENT ou em EDGE FUNCTION fora das RPCs de saldo. Uma migration nao e nem um nem outro, e
-- roda em transacao unica. Mas a razao do Article 8 nao e burocratica: e que todo movimento de
-- saldo tem de ficar EXPLICADO no razao. Por isso cada zeragem abaixo grava um
-- `wallet_transactions` com o valor exato do movimento, a descricao do motivo e um `reference_id`
-- estavel — o mesmo contrato de idempotencia do Article 9. Depois desta migration, saldo e razao
-- ficam reconciliados pela primeira vez.
--
-- POR QUE NAO USEI as RPCs existentes (`refund_escrow`, `update_wallet_balance`): elas modelam
-- EVENTOS DE NEGOCIO (estorno de reserva, credito de deposito). Isto nao e nenhum dos dois — e uma
-- operacao declarada de encerramento. Forcar o evento errado faria o razao contar uma historia
-- falsa, que e exatamente o que esta migration existe para corrigir.
--
-- IDEMPOTENTE por construcao: so age sobre saldo <> 0 e escrow em estado ativo. Rodar de novo nao
-- encontra nada.
--
-- ⚠️ NAO COPIAR ESTE PADRAO para operacao rotineira de saldo. Isto e encerramento pontual, com
-- ADR, sobre dado sem lastro. Movimento de dinheiro de verdade continua indo por RPC atomica.

-- =============================================
-- 1. ESCROWS ATIVOS -> terminal
-- =============================================
-- `refunded` e o unico terminal honesto entre os valores aceitos pelo CHECK
-- ('reserved','authorized','captured','released','refunded'): a reserva foi desfeita, NAO houve
-- captura. `released` diria que o freela recebeu — falso. `captured` diria que a empresa pagou pela
-- plataforma — falso.
-- NAO ha credito de volta a carteira da empresa aqui, e e deliberado: o passo 2 zera os saldos de
-- qualquer forma, e creditar para debitar em seguida encheria o razao de dois lancamentos que se
-- anulam, escondendo o movimento real (que e "isto deixou de existir") atras de contabilidade
-- decorativa.
UPDATE public.escrow_transactions
   SET status      = 'refunded',
       released_at = COALESCE(released_at, now())
 WHERE status IN ('reserved', 'authorized');

-- =============================================
-- 2. RAZAO — o lancamento vem ANTES do saldo mudar
-- =============================================
-- Ordem deliberada: se algo falhar no meio, a transacao inteira volta; mas ler o codigo na ordem
-- "explica, depois muda" deixa claro que nenhum saldo se move sem linha de razao correspondente.
INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id, status)
SELECT w.id,
       -w.balance,                      -- valor EXATO do movimento: leva o saldo a zero
       'debit',
       'Encerramento de saldo residual — pausa do processamento de pagamento (Asaas abandonado, '
       'ADR-20260822). Saldo sem lastro no razao; dinheiro real de teste ja havia sido sacado. '
       'Nao corresponde a valor devido a ninguem.',
       'pausa-pagamento-2026-08-22',    -- estavel: UNIQUE (wallet_id, reference_id) torna re-run inofensivo
       'completed'
  FROM public.wallets w
 WHERE COALESCE(w.balance, 0) <> 0;

-- =============================================
-- 3. SALDOS -> zero
-- =============================================
UPDATE public.wallets
   SET balance = 0
 WHERE COALESCE(balance, 0) <> 0;

-- =============================================
-- 4. ASSERCAO — falha fechado se o resultado nao for o esperado
-- =============================================
DO $$
DECLARE
    v_saldo   numeric;
    v_escrow  integer;
    v_semlinha integer;
BEGIN
    SELECT COALESCE(sum(balance), 0) INTO v_saldo FROM public.wallets;
    SELECT count(*) INTO v_escrow FROM public.escrow_transactions WHERE status IN ('reserved','authorized');

    IF v_saldo <> 0 THEN
        RAISE EXCEPTION 'ASSERCAO: sobrou saldo apos a zeragem (soma = %). HALT.', v_saldo;
    END IF;
    IF v_escrow <> 0 THEN
        RAISE EXCEPTION 'ASSERCAO: sobrou escrow ativo apos a zeragem (% linhas). HALT.', v_escrow;
    END IF;

    -- A que mais importa: nenhum saldo pode ter sido mexido SEM linha de razao. Se esta assercao
    -- disparar, a migration moveu dinheiro em silencio — exatamente o que o Article 8 proibe.
    SELECT count(*) INTO v_semlinha
      FROM public.wallets w
     WHERE NOT EXISTS (
             SELECT 1 FROM public.wallet_transactions t
              WHERE t.wallet_id = w.id AND t.reference_id = 'pausa-pagamento-2026-08-22')
       AND EXISTS (
             SELECT 1 FROM public.wallet_transactions t2 WHERE t2.wallet_id = w.id);
    RAISE NOTICE 'Zeragem concluida. Carteiras com razao preexistente e sem lancamento de encerramento: % (esperado: as que ja estavam zeradas).', v_semlinha;
END $$;

-- ============================================================================
-- DOWN — literal. NAO ha "desfazer" automatico: restaurar exigiria reescrever saldo, que e
-- justamente o que nao se faz sem operacao declarada. O caminho de reversao e:
--   1. Ler os valores originais no proprio razao:
--      SELECT wallet_id, -amount AS saldo_original FROM public.wallet_transactions
--       WHERE reference_id = 'pausa-pagamento-2026-08-22';
--   2. Escrever uma NOVA migration de restauracao, com ADR proprio, gravando lancamentos de
--      `credit` com um `reference_id` diferente e devolvendo os saldos.
--   3. Os escrows voltariam a 'reserved' — mas so se houver motivo de negocio, porque `refunded`
--      com `released_at` preenchido e um fato registrado, nao um estado transitorio.
-- Os valores originais NAO SE PERDEM: ficam no `amount` do lancamento de encerramento. Foi por
-- isso que o razao veio antes do UPDATE.
-- ============================================================================
