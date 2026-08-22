# ADR-20260821 — Exclusão de conta é anonimização com lápide pseudônima

## Status

PROPOSTO — depende de dois aceites do humano (H1 e H2 do DDL aprovado) antes de virar ACEITO.

## Contexto

`delete-account` (Edge Function, `service_role`) promete o direito de eliminação da LGPD (art. 18, VI)
e **não o cumpre em produção**. A leitura do schema encontrou dois caminhos independentes de bloqueio:

1. `auth.users --CASCADE--> workers --RESTRICT-- shift_payments` (débito pré-piloto #5) e, desde a F6
   (aplicada em 18/08), também `--RESTRICT-- service_terms` em quatro FKs mais uma FK composta.
2. `auth.users --CASCADE--> wallets --NO ACTION-- wallet_transactions / escrow_transactions`
   (`001_create_wallet_escrow_tables.sql`) — **não registrado em lugar nenhum**. Basta uma linha de
   `wallet_transactions` para `auth.admin.deleteUser` falhar, independente de `shift_payments`.

Ou seja: para qualquer usuário que efetivamente usou o produto, a exclusão falha. O usuário vê um erro
genérico ("Erro ao deletar conta. Tente novamente.") e a conta permanece intacta.

Os dados que bloqueiam não são acessórios:
- `shift_payments` é o documento fiscal declaratório do modo A (o único modo do piloto);
- `service_terms` é a prova da transação encerrada entre empresa e freela — o COMMENT da tabela já
  declara a retenção pós-exclusão (ADR-20260818);
- `wallet_transactions` é o livro-caixa cuja existência **é** a garantia de idempotência do Article 9.

Trocar esses `RESTRICT`/`NO ACTION` por `CASCADE` "resolveria" a exclusão destruindo auditoria fiscal e
razão financeira. É a saída errada.

## Decisão

**A credencial é apagada; a linha de identidade sobrevive como lápide pseudônima.**

1. Remover as FKs `ON DELETE CASCADE` de `public.workers.id`, `public.companies.id` e
   `public.wallets.user_id` para `auth.users`. `auth.admin.deleteUser` passa a apagar **só** a
   credencial. As linhas viram órfãs **por construção** — é o que uma lápide é.
2. Criar `public.anonymize_account(uuid)` — RPC `SECURITY DEFINER`, `search_path=''`,
   `GRANT EXECUTE` **só** para `service_role`, chamada exclusivamente pela Edge Function (Article 10).
   Uma transação: ou a conta inteira é anonimizada, ou nada.
3. A RPC **recusa** (devolve `outcome`, não exceção) se houver saldo > 0, escrow ativo ou
   `shift_payments` com `status='scheduled'`. Article 8 intacto: nenhum `UPDATE` de saldo, nenhum
   `DELETE` no razão. A remoção da CASCADE de `wallets` existe justamente para **proteger** o razão.
4. Classificação por coluna (contrato completo em `.harness/spec/lgpd-producao/ddl-aprovado.md` §2.1):
   - **apagado:** `cpf`, `phone`, `birth_date`, `pix_key`, `bio`, `city`, `avatar_url`, `cover_url`,
     `primary_role`, `roles`, `tags`, `availability`, `availability_days`, `experience_years` (worker);
     `cnpj`, `email`, `address`, `website`, `description`, `industry`, `logo_url`, `cover_url`,
     `default_briefing` (empresa);
   - **substituído:** `full_name → '[Conta Deletada]'`, `name → '[Empresa Deletada]'`,
     `verified_identity → false`;
   - **retido:** `id` (chave pseudônima), agregados numéricos, `accepted_tos`/`tos_accepted_at`/
     `tos_version` (prova de contrato), timestamps;
   - **apagado por DELETE de linha:** `worker_certifications`, `worker_trainings`,
     `team_connections`, `team_list_members`, `notifications`, `payment_methods`.
5. `service_terms` usa a coluna `anonymized_at` que já existia para isto:
   - termo **rascunho** (`accepted_at IS NULL`): `term_text` é redigido — não tem valor probatório;
   - termo **aceito**: `term_text` é **retido integralmente** (art. 7º, VI + art. 16, I) e só
     `accepted_ip`/`accepted_user_agent` são apagados. IP é dado pessoal autônomo, user-agent é
     fingerprint, e o próprio schema declara os dois `BEST-EFFORT e FALSIFICÁVEIS` — retê-los não
     sustenta prova nenhuma.
6. Emenda mínima em `enforce_service_term_immutability`: permitir `accepted_ip`/`accepted_user_agent`
   irem a `NULL` (**e só a NULL**) dentro da transição `anonymized_at NULL→ts`. Sem ela, a
   anonimização é barrada pelo próprio guarda. Nenhuma outra mudança.
7. `enforce_shift_payment_immutability` **não muda**: nada em `shift_payments` é anonimizado.
8. `worker_certifications` **não** se anonimiza por `UPDATE`: o ramo (c) do
   `enforce_certification_update_scope` (ator sem sessão) recusa mudança de conteúdo, por desenho.
   O tratamento correto é `DELETE` — certificação não tem valor fiscal.

## Consequências

### Positivas

- O direito de eliminação passa a ser cumprido de fato: a credencial some, o dado pessoal some, o
  acesso acaba.
- A trilha fiscal (`shift_payments`) e a prova de transação (`service_terms` aceito) sobrevivem sem
  contorcionismo de FK.
- O livro-caixa financeiro deixa de estar a um `deleteUser` de distância de ser destruído.
- Anonimização vira **uma** rotina transacional auditável no banco, não uma sequência de `update()`
  soltos no TypeScript que pode falhar pela metade.
- A autoria em `ProfileReviews` degrada retroativamente sozinha: `mask_display_name` devolve `NULL`
  para `'[%'`, e o nome é resolvido ao vivo (por isso `reviewer_name` nunca foi desnormalizado).

### Negativas / Trade-offs

- **O produto não pode mais dizer "apagamos todos os seus dados".** O termo aceito retém nome e CPF.
  Isto não é anonimização no sentido do art. 5º, XI — é eliminação parcial + retenção justificada
  (art. 16, I) sobre chave pseudônima. Copy e Política de Privacidade precisam mudar **antes**
  (débito #1 vira pré-requisito).
- Perde-se a integridade referencial entre `auth.users` e as tabelas de identidade. Mitigação: a
  policy de INSERT de `workers` é `WITH CHECK (id = auth.uid())` e a criação real vem do trigger
  `handle_new_user` — nenhum client inventa linha com `id` alheio.
- Sem prazo de retenção definido, a lápide é permanente. Um cron de expurgo (5 anos) **não existe**.
- A anonimização é irreversível: erro operacional não tem `undo`. Backup antes de aplicar é
  obrigatório, e o ensaio é em conta de teste.
- A rotina passa a poder **recusar** exclusão (saldo, escrow, pagamento agendado). É correto, mas
  cria estados em que o usuário precisa agir antes — e a UI precisa dizer qual.

## Alternativas rejeitadas

- **Trocar `RESTRICT` por `CASCADE` em `shift_payments`/`service_terms`.** Apaga documento fiscal e
  recibo bilateral. Resolve a mensagem de erro destruindo a razão de existir do modo A.
- **Tornar `shift_payments.worker_id` nullable com `ON DELETE SET NULL`.** A coluna é âncora de RLS
  (é como o freela lê o próprio recibo) e participa da FK composta `service_terms_payment_identity`.
  Quebraria acesso e integridade de uma vez.
- **Manter `auth.users` vivo, banido, com e-mail trocado por placeholder.** Preserva a integridade
  referencial, mas deixa uma casca de conta reativável e mantém um registro de identidade que o
  titular pediu para eliminar. É a alternativa de reserva se o humano rejeitar H2 — e exige redesenho.
- **Anonimizar `term_text` de termo aceito.** Destrói a prova que a empresa e o freela têm da
  transação — o oposto da razão pela qual a F6 existe.
- **Manter a anonimização espalhada no TypeScript da Edge Function (como hoje).** Sem transação: uma
  falha no meio deixa metade do dado pessoal vivo, sem sinal nenhum.

## Referências

- DDL aprovado (normativo): `.harness/spec/lgpd-producao/ddl-aprovado.md`
- Débitos: `.harness/memory-bank/debitos-pre-piloto.md` §5 (e §1, que vira pré-requisito)
- ADR-20260818 — termo congelado no aceite (origem de `service_terms.anonymized_at`)
- ADR-20260821 — certificações: metadado sem arquivo (razão de F8 não custodiar documento)
- Migrations lidas: `001_create_wallet_escrow_tables.sql`, `20260630000000_shift_payments.sql`,
  `20260712000000_shift_payment_scheduled.sql`, `20260817001100_service_terms.sql`,
  `20260817001300_worker_certifications_trainings.sql`
- Edge Function: `supabase/functions/delete-account/index.ts`
