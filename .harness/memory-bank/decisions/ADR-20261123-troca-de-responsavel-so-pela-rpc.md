# ADR-20261123 — Troca de `responsible_id` pelo Encarregado só pela RPC (sinal de transação)

## Status
ACEITO (gate do architect, 23/11/2026). Implementa a decisão 4 de
ADR-20261123-responsavel-efetivo-derivado-no-seam (sem emendá-la). Spec: `.harness/spec/equipe-encarregados/spec.md`.

## Contexto
`reassign_job_responsible` é SECURITY DEFINER, mas `auth.uid()` lá dentro continua sendo o JWT do
Encarregado, então `jobs_responsible_guard` barrava o "Passar para". O builder (E5) relaxou o guard para
`OLD.responsible_id = auth.uid()`, o que abriu PATCH direto de `responsible_id` pelo responsável, sem os
avisos, sem o relatório e sem o `ROW_COUNT` otimista da RPC. Isso contradiz a decisão 4. Não há escalada
de privilégio, mas existem dois caminhos de escrita com regras diferentes.

## Decisão
A RPC sinaliza ao guard com uma GUC **local à transação**, amarrada ao id do turno:

- Na RPC, imediatamente antes do UPDATE de cada turno:
  `PERFORM set_config('app.job_reassign', r.id::text, true);`
  e logo depois (sucesso ou `CONTINUE`): `PERFORM set_config('app.job_reassign', '', true);`
- No guard, o ramo do Encarregado volta à regra estrita, com uma única exceção:
  ```sql
  IF CASE WHEN v_is_insert THEN false
          ELSE (v_moved OR (v_resp_changed
                AND COALESCE(current_setting('app.job_reassign', true), '') <> NEW.id::text))
     END THEN
      RAISE EXCEPTION 'jobs: encarregado não altera company_id, responsible_id nem series_id (use "Passar para...").'
          USING ERRCODE = '42501';
  END IF;
  ```
  O sinal só libera `responsible_id`; `v_moved` (company/series) segue sempre recusado. A autorização
  ("é o responsável atual, confirmado") continua **dentro da RPC** (`v_can`), e a validação de operador
  destino continua no guard.
- O marcador de idempotência do bloco de edição em E5 passa a ser `app.job_reassign` (não mais
  `OLD.responsible_id IS DISTINCT FROM v_uid`); a asserção (c) muda junto.

Por que o cliente não forja o sinal: PostgREST só expõe funções dos schemas configurados (`public`);
`set_config` vive em `pg_catalog`, logo `/rpc/set_config` não existe. O cliente não executa SQL livre, e
os únicos GUCs que o PostgREST grava por requisição são `role` e `request.*` (JWT/headers/path), nunca
`app.*`. `is_local = true` faz o valor morrer no fim da transação (cada requisição PostgREST é uma), e o
valor é o id do turno, então nem um vazamento dentro da mesma transação liberaria outro turno.
Contrato de manutenção: **nenhuma função exposta em `public` pode chamar `set_config` com texto vindo do
chamador** (o security-reviewer checa por grep `set_config` em migrations novas).

## Consequências
### Positivas
- Um só caminho de escrita do responsável pelo Encarregado; avisos e relatório nunca são pulados.
- Sem papel/owner novo, sem mudança de GRANT; rollback = reverter o `replace` do guard.
### Negativas / Trade-offs
- Acoplamento por string (`'app.job_reassign'`) entre RPC e trigger; documentado nos COMMENTs das duas.
- O Gestor segue podendo trocar por PATCH direto (não passa pelo ramo do Encarregado) — já era assim e
  está fora do escopo da decisão 4.

## Alternativas rejeitadas
- **(b) Aceitar o PATCH direto e emendar o ADR:** dois caminhos com regras diferentes; os avisos da RPC
  viram opcionais para quem chama a API na mão.
- **(c) Reconhecer a RPC por `current_user`/owner distinto:** toda DEFINER do projeto tem o mesmo owner
  (`postgres`), então `current_user` não distingue esta RPC das outras; exigiria papel novo dono da
  função e GRANTs na tabela. Mais peças, mesma garantia. Não há precedente no projeto
  (`enforce_shift_payment_immutability` decide por papel via `auth.uid()`, não por `current_user`).

## Referências
- `supabase/migrations/20261123000600_equipe_e5_operacao.sql` (bloco 1 e `reassign_job_responsible`)
- `supabase/migrations/20261123000300_equipe_e2_seam_job_operator.sql` (guard original)
- ADR-20261123-responsavel-efetivo-derivado-no-seam (decisão 4)
