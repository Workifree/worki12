# Débitos pré-piloto

> Itens levantados pelas revisões durante as features F1–F7 que NÃO bloqueiam merge técnico
> mas precisam ser resolvidos antes do piloto com cliente real. Atualizar ao fechar cada um.

## 1. Política de Privacidade desatualizada — 2 campos novos de dado pessoal

**Origem:** security-reviewer F6 e F7.

- **`service_terms` (F6):** termo de prestação com CPF, nome e valor congelados no aceite, retidos
  indefinidamente. A política vigente não declara essa retenção.
- **`workers.availability_days` (F7):** rotina semanal declarada do freela. É perfil comportamental
  (quando está livre ⇒ quando não está), classe de risco próxima a geolocalização de rotina.
  Visível a empresas com vínculo, armazenado indefinidamente. Não consta como categoria coletada.
- **`worker_certifications` / `worker_trainings` (F8):** certificação profissional declarada
  (título, emissor, número de registro de conselho, validade) e histórico de treinamento interno
  registrado pela empresa. É dado profissional, retido indefinidamente e visível a empresas com
  vínculo. Não consta como categoria coletada na política vigente. **Delimitação explícita a
  declarar:** o Worki **não** coleta documento de saúde (atestado, ASO, exame, vacinação) e
  **não** armazena o arquivo do certificado (v1 é só metadado — ADR-20260821).

**Gate:** LGPD. Não é cortesia — é base legal para o dado que já estamos gravando.

## 2. `{}` passa no CHECK de `availability_days`

**Origem:** security-reviewer F7 (registrado como NOTA consciente).

Containment de objeto vazio (`'{}'::jsonb <@ qualquer`) é sempre verdadeiro, então o CHECK
`workers_availability_days_shape` não barra `{}`. Hoje só não vira bug porque
`normalizeAvailabilityGrade` converte para `null` antes de gravar — a garantia está no client,
não no banco. Qualquer client alternativo, RPC futura ou regressão no normalizador grava `{}`,
e o CTA "Declarar disponibilidade" (R14) some silenciosamente para esse freela: a UI checa
"tem grade?" e `{}` responde que sim, sem nenhum período dentro.

**Correção:** adicionar `AND p <> '{}'::jsonb` (ou exigir cardinalidade >= 1) ao CHECK.

## 3. `/profile` não tem campo de CPF — beco sem saída do `missing_cpf`

**Origem:** F6, outcome `missing_cpf` de `acceptServiceTerm`.

O termo exige CPF. Se o freela não tem CPF cadastrado, o aceite falha e **não há tela onde ele
possa resolver isso sozinho** — `/profile` não expõe o campo. A mensagem hoje é honesta ("fale com
a empresa ou o suporte"), mas o caminho continua sendo humano.

**Correção:** campo de CPF em `pages/Profile.tsx` com a mesma validação do onboarding.

## 4. `GRANT UPDATE (term_text, anonymized_at)` amplo demais

**Origem:** F6. Roteado ao architect, ainda sem parecer.

O grant permite ao papel escrever `term_text` livremente; a imutabilidade é garantida só pelo
trigger `enforce_service_term_immutability`. Defesa em profundidade pede o grant estreitado ao
mínimo que a RPC de aceite precisa.

## 5. 🔴 PRÉ-EXISTENTE — `delete-account` já está quebrado para freela com pagamento

**Origem:** descoberto durante F6. **Não foi introduzido por nenhuma feature desta leva.**

`workers.id → auth.users` é **CASCADE**, mas `shift_payments.worker_id → workers` é **RESTRICT**.
Logo, `auth.admin.deleteUser` **falha** para qualquer freela que tenha um registro de pagamento —
ou seja, para todo freela que efetivamente trabalhou. O produto acredita cumprir o direito de
exclusão da LGPD e **não cumpre**.

**Gate:** é obrigação legal, e o pilha de dados só cresce depois do piloto. Precisa de decisão do
architect: anonimização em vez de exclusão (preservando a trilha fiscal do pagamento) é o caminho
mais provável, já que `shift_payments` é documento de auditoria e não pode simplesmente sumir.

## 6. Aceite do termo não é garantido pelo banco — só pela UI

**Origem:** evaluator F6, finding `C-TERM-FETCH-FAIL` (tipo c — decisão de arquitetura).

Nada em `shift_payments` exige que `service_terms.accepted_at` esteja preenchido antes de
`worker_confirmed_at`: `confirmReceiptByWorker` é um `.update()` direto. O acoplamento entre
"aceitar o termo" e "confirmar o recebimento" vive inteiramente no componente React.

Consequência: qualquer caminho que não passe por `ServiceTermSection` — client alternativo,
chamada direta ao PostgREST, script de suporte, ou uma regressão futura na UI — grava a
confirmação com o termo pendente. A correção da rodada 3 fecha o caso de falha de leitura
(falha fechado), mas continua sendo garantia de client.

**Decisão pendente do architect:** trigger em `shift_payments` recusando `worker_confirmed_at`
quando existir `service_terms` pendente para aquele pagamento. Pesar contra o risco de travar
turnos legados sem termo gerado — a condição precisa ser "existe termo E não foi aceito",
nunca "não existe termo aceito".

**Por que importa:** a feature existe para ser prova. Prova que depende do front estar correto
é mais fraca do que o produto promete ao usar a palavra "termo".

## 7. F6 — resíduos do aceite (INFO, aprovados com ressalva)

**Origem:** evaluator F6, rodada 4 (APPROVED). Nenhum bloqueia; registrados para não sumirem.

1. **O gate de consentimento vive só no `disabled`.** `handleAcceptOnly` e `handleConfirmReceipt`
   não têm guarda defensiva de `agreedToTerm`/`showFullText` no topo. A RPC continua sendo a
   autoridade real e R8 define o checkbox como UX — mas um refactor que remova o `disabled`
   perde o consentimento **em silêncio**, sem quebrar nenhum teste.
2. **`fetchTerm` não reseta `agreedToTerm`.** O consentimento sobrevive a um re-fetch do rascunho.
   Hoje inexplorável (o rascunho só muda no aceite, e depois o checkbox some), mas é estado de
   consentimento persistindo através de uma recarga do objeto consentido.
3. **O banner de falha de leitura aparece para a empresa**, dizendo que "a confirmação de
   recebimento fica bloqueada" — mensagem escrita para o freela, exibida a quem não tem esse botão.

## 8. Reversão da A3 do F6 depende do item 3

Quando `/profile` ganhar campo de CPF, o critério A3 da spec `termo-prestacao` volta à forma
original (toast "Complete seu CPF no perfil" + link). Enquanto não ganhar, a mensagem honesta é a
correta. Os dois itens andam juntos — não reverter A3 sozinho.

## 9. 🔴 PRÉ-EXISTENTE — `reviews` é varrível por qualquer conta autenticada

**Origem:** gate do F12 (badges). **Não introduzido por nenhuma feature desta leva — está em produção.**

`reviews` tem `SELECT USING (true)` (migração `20260309000000`) e `companies` também. Consequência:
qualquer conta autenticada, criada em 30 segundos, **sem vínculo nenhum**, lê todas as avaliações de
qualquer freela e resolve o nome da empresa avaliadora a partir de `reviewer_id`.
`pages/company/WorkerPublicProfile.tsx:120-140` já renderiza exatamente isso.

É a **mesma classe** do problema que a migração `20260816120000` fechou em `workers` (CPF, telefone e
PIX varríveis por qualquer autenticado) — e ficou de fora naquela passagem.

**Por que não foi corrigido junto com o F12:** quebraria `ProfileReviews`, `CompanyProfile`,
`CompanyPublicProfile` e `WorkerPublicProfile` de uma vez. Precisa de spec própria, no molde da
`20260816120000` (escopo por vínculo + RPC DEFINER com mascaramento, como `get_profile_reviews`).

**Efeito sobre o F12:** nenhum. A feature lê por SECURITY DEFINER; quando esta dívida for paga,
o badge não muda uma linha.

**Gate:** é exposição de dado pessoal em produção, e cresce com o piloto.
