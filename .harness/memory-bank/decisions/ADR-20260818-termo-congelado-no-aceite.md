# ADR-20260818 — Termo de prestação de serviço: congelar no ACEITE, não na geração

## Status

ACEITO — gate `harness-architect` de 18/08/2026 sobre `.harness/spec/termo-prestacao/spec.md` (F6).
DDL aprovado: `.harness/spec/termo-prestacao/ddl-aprovado.md`.

## Contexto

O sócio-operador do Divino Fogão já coleta hoje, no papel, uma declaração de uma página por turno pago:
o freela declara ser o responsável pelo recolhimento dos encargos sobre o valor recebido. A F6 digitaliza
esse gesto: `service_terms`, 1:1 com `shift_payments`, com `term_text` como snapshot e aceite eletrônico.

O ponto central do desenho é **quando o texto congela**. A spec (R1, R3, A4) congela na **geração** — o
trigger renderiza o texto no instante em que `shift_payments.status` vira `'recorded'` e o texto nunca mais
muda. Combinado com R4 ("CPF ausente não bloqueia a geração, renderiza 'CPF não informado', mas bloqueia o
aceite"), isso produz um artefato autodestrutivo:

1. pagamento é registrado → termo nasce com `CPF não informado`;
2. freela tenta aceitar → `missing_cpf`, bloqueado;
3. freela preenche o CPF no perfil;
4. freela aceita → o documento **assinado** continua dizendo `CPF não informado`.

O documento cujo valor inteiro é identificar quem assumiu a responsabilidade tributária sai assinado sem
identificar ninguém. O bloqueio de R4 cobra o preço (fricção no freela) e não entrega o benefício.

Há um segundo ponto de reversibilidade difícil: a spec (R6) apoia a imutabilidade de `term_text` na
**ausência de caminho de escrita** ("nenhuma policy de INSERT/UPDATE/DELETE para `authenticated`"). Isso
protege contra o client, mas não contra `service_role` (bypassa RLS), contra o owner da tabela, nem contra
uma futura Edge Function. Um documento de valor probatório cuja imutabilidade depende de "ninguém escreveu
o código que o reescreve" não é imutável — é não-escrito-ainda. O precedente do projeto é o oposto:
`enforce_shift_payment_immutability` trava colunas materiais **para todos os papéis, inclusive
`service_role`**, por trigger.

E um terceiro: se o texto for realmente imutável para todos, uma futura decisão de anonimização (LGPD) só
pode ser executada por DDL em produção. Fechar essa porta sem uma fechadura é irreversível na prática.

## Decisão

1. **`term_text` é RASCUNHO enquanto `accepted_at IS NULL` e CONGELA no aceite.** O trigger de geração
   grava uma renderização inicial (para o freela ler antes de assinar); a RPC `accept_service_term`
   **re-renderiza com os dados vigentes e grava `term_text` + `accepted_at` no mesmo UPDATE**, atomicamente.
   Depois disso, `term_text` é imutável. O que congela é o que a pessoa aceitou.

2. **A imutabilidade é enforçada por trigger `BEFORE UPDATE`, não por ausência de policy.**
   `enforce_service_term_immutability` (padrão `enforce_shift_payment_immutability`) trava
   `id`, `shift_payment_id`, `job_id`, `worker_id`, `company_id`, `amount`, `created_at` sempre; trava
   `term_text`/`term_version` a partir do aceite; e faz `accepted_at`/`accepted_ip`/`accepted_user_agent`
   one-way (NULL → valor, nunca alterados depois). Vale para `service_role` e para o owner.

3. **Existe uma — e só uma — porta de anonimização:** a transição `anonymized_at` NULL → timestamp, que é
   a única circunstância em que `term_text` pode ser reescrito depois do aceite. Não há policy de UPDATE
   para `authenticated`; só `service_role`/owner alcança. A porta existe para que uma decisão futura de
   LGPD não exija cirurgia de DDL em produção — **não** para ser usada por padrão (ver Consequências).

4. **A cláusula de fronteira jurídica vive DENTRO de `term_text`**, não só na UI. A frase "a Worki não é
   parte deste termo, apenas registra o aceite; não é empregadora, não intermedia o pagamento, não presta
   consultoria jurídica e não garante a validade jurídica deste documento" é parte do texto congelado e
   impressa junto. Requisito de UI (A6) se perde numa refatoração de componente; texto congelado, não.

5. **`shift_payment_id` é `ON DELETE RESTRICT`, não `CASCADE`.** Tabela de auditoria não some em cascata —
   mesma regra já aplicada às FKs de `shift_payments`.

6. **`accepted_ip`/`accepted_user_agent` são declaradamente best-effort e falsificáveis.** Nome, comentário
   de coluna e tipos (`text`, não `inet`) declaram isso. Não são pré-requisito do aceite.

## Consequências

### Positivas

- O documento assinado contém o CPF de quem assinou. A fricção do `missing_cpf` passa a comprar algo.
- Imutabilidade é uma propriedade do schema, não uma consequência de omissão. Uma Edge Function futura
  escrita por engano não consegue reescrever um termo aceito.
- A fronteira "a Worki não é parte" sobrevive a qualquer refatoração de frontend.
- Anonimização LGPD tem um caminho previsto, auditável (`anonymized_at`) e fechado ao client.
- Rollback é `DROP TABLE` + `DROP FUNCTION`: nada em `wallets`, `escrow_transactions` ou RPC de saldo.

### Negativas / Trade-offs

- **A4 da spec muda de significado** e precisa ser reescrito: "congelado desde a geração" → "congelado
  desde o aceite". O rascunho pré-aceite é mutável por construção; um leitor que fotografe a tela antes de
  assinar pode ver um texto diferente do que assinou se os dados mudarem no intervalo. Aceito: o intervalo
  é de segundos a dias, e a alternativa (congelar um texto errado) é pior.
- A RPC de aceite fica mais gorda: lê `workers`/`companies`/`jobs` e renderiza, em vez de só carimbar
  `accepted_at`. Custo de uma chamada, sem concorrência relevante (row lock `FOR UPDATE`).
- `anonymized_at` é uma coluna que hoje ninguém escreve. É deliberadamente uma alavanca ociosa.
- **Retenção:** a decisão *default* é NÃO anonimizar em `delete-account`. Um termo de responsabilidade
  tributária assinado é justamente a prova que a empresa precisa em reclamatória (LGPD Art. 7, VI e Art.
  16, I/II). Consequência assumida: o CPF de um freela que apagou a conta **permanece** congelado dentro
  de `service_terms.term_text`, mesmo depois de `workers.cpf` ser anulado pela Edge Function. Isso precisa
  estar na Política de Privacidade antes do piloto — é dívida de documento, não de código.
- **Falha na geração aborta o registro do pagamento.** O trigger não engole exceção (ao contrário de
  `notify_worker_on_shift_payment`). Escolha consciente: termo faltando em silêncio é pior que registro de
  pagamento falhando com erro visível. Mitigado tornando o corpo do trigger estruturalmente incapaz de
  falhar (`concat`/`coalesce`, zero cast, render `IMMUTABLE` sem leitura de tabela).

## Alternativas rejeitadas

- **Congelar na geração (spec original).** Rejeitada: produz documento assinado sem CPF sempre que o
  bloqueio de R4 dispara — exatamente o caso que a feature existe para cobrir.
- **Bloquear o registro do pagamento quando falta CPF.** Rejeitada: muda o comportamento de um módulo
  existente e funcionando (`paymentRecordService`), e o termo passaria a ter poder de veto sobre o dinheiro.
- **Imutabilidade por ausência de policy (spec R6).** Rejeitada: não cobre `service_role`, owner nem
  Edge Function futura. Custo do trigger é ~30 linhas contra um precedente já estabelecido no projeto.
- **`term_text` NULL até o aceite (sem rascunho).** Rejeitada: o freela precisa ler o que vai assinar, e o
  read path do client é `.from()` direto (Article 5) — sem coluna, precisaria de uma RPC de preview só
  para isso.
- **Renderizar sempre em tempo de leitura (sem snapshot).** Rejeitada: aniquila o valor probatório. É a
  decisão que a spec acertou e que este ADR preserva.
- **Anonimizar `service_terms` em `delete-account` por default.** Rejeitada: destrói a prova da empresa
  a pedido da contraparte. Base legal de retenção existe; a alavanca fica disponível se o jurídico do
  owner decidir o contrário.
- **Hash/assinatura digital de `term_text` (`term_text_sha256`).** Rejeitada nesta fatia: cerimônia que
  sugere certificação pela Worki sem entregar certificação — colide com a fronteira jurídica (decisão 4).

## Referências

- Spec: `.harness/spec/termo-prestacao/spec.md`
- DDL aprovado: `.harness/spec/termo-prestacao/ddl-aprovado.md`
- Migration: `supabase/migrations/20260817001100_service_terms.sql`
- Precedentes: `20260630000000_shift_payments.sql` (imutabilidade por trigger, FK RESTRICT),
  `20260712000000_shift_payment_scheduled.sql` (transição única liberada em coluna imutável),
  `20260816140000_notify_worker_on_shift_payment.sql` (trigger DEFINER sobre `shift_payments`),
  `ADR-20260630-pagamento-opcional-piloto.md` (modo A = registro ≠ liquidação).
