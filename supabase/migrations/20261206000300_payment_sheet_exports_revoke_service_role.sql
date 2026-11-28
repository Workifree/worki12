-- Corrige permissao do log de geracao da planilha de pagamento (payment_sheet_exports).
-- O REVOKE da migration 20261205000200 nao alcancava service_role (permissao padrao do Supabase
-- em tabela nova). O log e imutavel: so SELECT e INSERT; UPDATE/DELETE/TRUNCATE saem.
-- O gatilho trg_payment_sheet_exports_immutable continua como segunda defesa.
REVOKE UPDATE, DELETE, TRUNCATE ON public.payment_sheet_exports FROM service_role;

DO $$
BEGIN
  IF has_table_privilege('service_role', 'public.payment_sheet_exports', 'UPDATE')
     OR has_table_privilege('service_role', 'public.payment_sheet_exports', 'DELETE')
     OR has_table_privilege('service_role', 'public.payment_sheet_exports', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role ainda altera payment_sheet_exports';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.payment_sheet_exports', 'INSERT') THEN
    RAISE EXCEPTION 'service_role perdeu INSERT em payment_sheet_exports';
  END IF;
END $$;
-- DOWN: GRANT UPDATE, DELETE, TRUNCATE ON public.payment_sheet_exports TO service_role;
