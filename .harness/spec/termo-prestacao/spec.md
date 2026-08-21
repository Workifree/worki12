# Termo de prestação de serviço com aceite eletrônico (F6) — spec

## Context

O sócio-operador do Divino Fogão já faz isso **hoje, no papel**: quando paga o freela por fora (PIX/dinheiro),
ele faz o freela assinar um "contratinho bobinho de uma página" dizendo que o freela — não a loja — é o
responsável pelo recolhimento dos encargos (tributários/previdenciários) sobre o valor recebido. É a peça
que tira da empresa a responsabilidade pelo recolhimento e reduz o risco trabalhista percebido — o mesmo
risco que a tese (`.harness/thesis.md`, risco #4) já mapeia como "não criamos o vínculo, no máximo
documentamos".

Esta feature digitaliza esse gesto: gera o texto do termo a partir dos dados reais do turno/pagamento e
captura o aceite eletrônico do freela, com timestamp e o texto exato aceito (não um ponteiro pra um texto
que pode mudar depois). Não inventa nada novo no fluxo de dinheiro — o Worki continua **modo A puro**
(`shift_payments`, sem mover saldo, Article 8 intacto). O termo nasce **junto com o pagamento**, exatamente
como descrito na entrevista ("ele assina quando recebe"), reaproveitando o loop bilateral que já existe em
`ReceiptView`/`PaymentRecordService` (empresa registra → freela confirma).

**Fronteira jurídica não-negociável:** o Worki não é parte do contrato entre empresa e freela, não presta
consultoria jurídica, não valida nem garante a validade jurídica do texto, e não se posiciona como
empregador/garantidor (`product.md` anti-vision: "NÃO é folha de pagamento/CLT"; tese risco #4). O produto
**registra** uma declaração de aceite entre as partes — a mesma postura declaratória que `shift_payments` já
assume para o pagamento ("Registro Worki (declaratório)").

## O que reaproveitar (não recriar)

- Padrão de aceite já existe em `workers` (onboarding): `accepted_tos` + `tos_version` + `tos_accepted_at`
  gravados no INSERT do onboarding — precedente direto de "guardar versão + timestamp do aceite", mas sem
  IP/user-agent e sem texto renderizado (é só um checkbox de TOS genérico, não um documento com dados do
  turno). Esta feature estende o padrão para um documento por-pagamento.
- Padrão de trigger `SECURITY DEFINER` que reage a `shift_payments` (migrations `20260816140000`
  `notify_worker_on_shift_payment`, `20260712000000` agendamento): mesmo gancho (`AFTER INSERT/UPDATE ON
  shift_payments WHEN status → 'recorded'`) será reaproveitado para gerar o termo.
- Padrão "outcome enum, banco é autoridade" já usado em `ShiftCallOutcome`/`AttendanceConfirmationOutcome`
  (`types/index.ts`): a nova RPC de aceite segue o mesmo formato (client só reage ao outcome retornado).
- Padrão `.select('id')` + checar `data.length === 0` pós UPDATE sob RLS (`confirmReceiptByWorker`,
  `voidPayment`, `removeFromTeam`) — RLS nega silenciosamente, não com exceção.
- `ReceiptView.tsx` é a tela âncora: novo bloco "Termo de Prestação de Serviço" entra ali, reaproveitando a
  mesma barra de impressão (`window.print()`) e o mesmo aviso amarelo declaratório que já existe no rodapé.

## Requirements

- [ ] R1: Nova tabela `service_terms` (migration nova — **verificar a migration mais recente em
      `supabase/migrations/` antes de criar o arquivo**; a numeração deste spec não assume um timestamp fixo
      porque F5 pode consumir vários) com, no mínimo: `id`, `shift_payment_id` (FK única para
      `shift_payments.id`, `ON DELETE CASCADE` — 1 termo por marcador de pagamento), `job_id`, `worker_id`,
      `company_id`, `term_version` (text), `term_text` (text — snapshot **renderizado e congelado**, com os
      dados já substituídos, nunca um template com placeholders vivos), `amount` (numeric, espelha
      `shift_payments.amount` no momento da geração, para auditoria caso o valor original mude de
      interpretação no futuro), `created_at`, `accepted_at` (nullable — NULL = pendente), `accepted_ip`
      (nullable, best-effort), `accepted_user_agent` (nullable, best-effort).
- [ ] R2: Função `render_service_term_text(...)` (SQL, determinística) monta o texto final substituindo:
      nome e CPF do freela, nome e CNPJ da empresa, título do turno, data do turno, valor do pagamento, e a
      cláusula fixa de responsabilidade (baseada na fala literal): o freela recebe o **valor bruto** e é o
      **responsável pelo recolhimento dos encargos** (tributários/previdenciários) incidentes sobre aquele
      pagamento; natureza autônoma da prestação; ausência de vínculo empregatício com o Worki e com a
      empresa contratante. **(Assumido)** Texto único, em português, não customizável por empresa nesta
      fatia (ver Out-of-scope).
- [ ] R3: Trigger `AFTER INSERT OR UPDATE ON shift_payments` (`SECURITY DEFINER`, `search_path=''`, mesmo
      padrão de `notify_worker_on_shift_payment`) cria automaticamente 1 linha em `service_terms` na
      **primeira vez** que `status` de um `shift_payments` vira `'recorded'` (INSERT direto com
      `status='recorded'` OU UPDATE `scheduled→recorded`). Idempotente: `shift_payment_id` é UNIQUE, então um
      segundo evento no mesmo marcador não duplica (guarda `NOT EXISTS` ou `ON CONFLICT DO NOTHING`).
      **(Assumido)** pagamentos `scheduled` (promessa) não geram termo — só quando efetivam, espelhando a
      fala "assina junto com o pagamento" (A8).
- [ ] R4: **(Assumido)** Se `workers.cpf` estiver vazio/NULL no momento da geração, o termo é gerado do mesmo
      jeito (não bloqueia o registro do pagamento, que é módulo já existente e não deve mudar de
      comportamento) com o campo CPF renderizado como "CPF não informado" — mas o **aceite fica bloqueado**
      até o freela completar o CPF (R6). Não há bloqueio simétrico para CNPJ da empresa ausente: a cláusula
      de responsabilidade recai sobre o freela, e o ato de a empresa registrar o pagamento já representa o
      compromisso dela (sem checkbox de aceite do lado empresa nesta fatia).
- [ ] R5: RPC `accept_service_term(p_service_term_id uuid)` (`SECURITY DEFINER`, `search_path=''`, GRANT
      EXECUTE só para `authenticated`) valida nesta ordem e retorna um outcome (nunca lança exceção pro
      client em caminho esperado): sem sessão → `unauthenticated`; termo não encontrado → `not_found`;
      `auth.uid() <> service_terms.worker_id` → `forbidden`; `service_terms.accepted_at IS NOT NULL` →
      `already_accepted` (idempotente, não altera nada); `shift_payments.status <> 'recorded'` (foi
      estornado depois de gerado o termo) → `payment_voided`; `workers.cpf` vazio/NULL → `missing_cpf`;
      caso contrário → grava `accepted_at = now()`, `accepted_ip`/`accepted_user_agent` **best-effort** (lidos
      de `current_setting('request.headers', true)` quando disponível; se ausente ou o parse falhar, grava
      NULL e segue — IP/UA são reforço probatório, não bloqueio) → retorna `accepted`.
- [ ] R6: RLS de `service_terms`: SELECT liberado para `worker_id = auth.uid()` OU empresa dona (mesmo
      critério de `sp_select_participants`/`can_view_worker_profile`: `company_id = auth.uid()` OU
      `company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())`). **Nenhuma policy de
      INSERT/UPDATE/DELETE para `authenticated`** — a única escrita é via trigger (R3) e via RPC `SECURITY
      DEFINER` (R5), ambos rodando como owner; a imutabilidade dos campos materiais (`term_text`,
      `term_version`, `amount`, `shift_payment_id`) vem de nunca existir um caminho de UPDATE aberto ao
      client, não de um trigger de imutabilidade separado.
- [ ] R7: `ReceiptView.tsx` ganha um bloco "Termo de Prestação de Serviço", visível só quando
      `payment.status !== 'scheduled'` (espelha R3 — sem termo em promessa) e o termo existir:
      - Texto completo do termo (`term_text`), em área rolável/expansível, **sem** `print:hidden` (aparece na
        impressão, junto do recibo — não cria fluxo de PDF/e-mail separado).
      - Se `accepted_at` preenchido: selo "Termo aceito eletronicamente em DD/MM/AAAA às HH:MM" (mesmo padrão
        visual do bloco "Confirmação de recebimento" já existente — ícone `CheckCircle`, fundo
        `primary-light`, borda preta).
      - Se pendente e `isWorkerViewer`: checkbox "Li e concordo com os termos acima" que precisa estar
        marcado para habilitar o botão de confirmação (R8). Se pendente e `isCompanyViewer`: texto
        "Aguardando aceite do termo pelo freela" (mesmo padrão do "Aguardando confirmação do freela").
      - Aviso fixo (mesmo componente visual do rodapé amarelo já existente): "O Worki apenas registra o
        aceite deste termo entre as partes; não é parte do contrato, não presta consultoria jurídica e não
        garante validade jurídica do documento."
- [ ] R8: O botão existente "Confirmar Recebimento" (`handleConfirmReceipt`) passa a exigir, **antes** de
      chamar `confirmReceiptByWorker`, que o termo tenha sido aceito: se ainda pendente, o clique dispara
      primeiro `accept_service_term`; se o outcome vier `missing_cpf`, o fluxo para ali — toast "Complete seu
      CPF no perfil para aceitar o termo e confirmar o recebimento" com link para `/profile`, e
      `confirmReceiptByWorker` **não** é chamado. Se o outcome vier `accepted` (ou já `already_accepted`),
      segue normalmente para `confirmReceiptByWorker` como hoje. O checkbox do R7 é pré-condição de UI (botão
      desabilitado sem ele) — a RPC é a autoridade real, o checkbox é só UX.
- [ ] R9: Novo service `services/serviceTermService.ts` (mesmo padrão de `paymentRecordService.ts`: `.from`
      direto, `logError`, sem RPC financeira) com `getByShiftPayment(shiftPaymentId)` (leitura) e
      `acceptServiceTerm(serviceTermId)` (chama a RPC do R5, mapeia outcome). Novos tipos em
      `types/index.ts`: `ServiceTerm` (espelha a tabela) e `ServiceTermAcceptOutcome` (união dos outcomes do
      R5, mesmo estilo de `AttendanceConfirmationOutcome`).
- [ ] R10: Toques ≥44px, mobile-first, neo-brutalismo (`border-2 border-black`, `font-black uppercase` nos
      rótulos, sombra offset no card do termo se for card próprio) — Article 13.
- [ ] R11: `frontend && npm run build` + `npm run lint` verdes (Article 3); `types/index.ts` atualizado à mão
      (Article 2, sem codegen).

## Acceptance criteria

- [ ] A1: Dado que a empresa registra ou efetiva um pagamento de turno (`shift_payments.status` vira
      `'recorded'`, direto ou via `scheduled→recorded`), quando a escrita completa, então uma linha nasce em
      `service_terms` vinculada 1:1 àquele `shift_payment_id`, com `term_text` já contendo nome/CPF do
      freela, nome/CNPJ da empresa, título e data do turno e o valor, e `accepted_at` NULL.
- [ ] A2: Dado um freela com CPF cadastrado acessando `/recibo/:jobId` de um pagamento `recorded` com termo
      pendente, quando ele marca "Li e concordo" e clica em "Confirmar Recebimento", então
      `accept_service_term` retorna `accepted`, `service_terms.accepted_at`/`accepted_ip`/`accepted_user_agent`
      são preenchidos, em seguida `shift_payments.worker_confirmed_at` é preenchido (fluxo já existente), e a
      tela passa a mostrar "Termo aceito eletronicamente em DD/MM/AAAA às HH:MM".
- [ ] A3: Dado um freela SEM CPF cadastrado tentando aceitar o termo em `/recibo/:jobId`, quando ele clica em
      "Confirmar Recebimento", então a ação para com uma mensagem **cumprível** ("Fale com a empresa ou com o
      suporte do Worki para regularizar seu cadastro"), **sem** link para `/profile`, e **nem**
      `service_terms.accepted_at` **nem** `shift_payments.worker_confirmed_at` mudam. O toast e o banner da
      tela devem dizer a MESMA coisa.
      > CORRIGIDO em 21/08/2026 (achado `C-TERM-CPF-DEADEND` do evaluator). A redacao original exigia toast
      > "Complete seu CPF no perfil" + link para `/profile` — mas `pages/Profile.tsx` **nao tem** campo de
      > edicao de `workers.cpf`. O criterio, como escrito, mandava construir um beco sem saida: o freela
      > clicaria no link e chegaria numa tela onde o problema e irresoluvel. Enquanto o campo de CPF nao
      > existir em `/profile` (ver `.harness/memory-bank/debitos-pre-piloto.md`, item 3), a mensagem honesta
      > e a correta. Quando o campo existir, este criterio volta a forma original.
- [ ] A4: Dado um termo já aceito, quando a empresa ou o freela reabrem `/recibo/:jobId` (inclusive depois de
      o freela editar o próprio CPF), então o `term_text` exibido é o **snapshot congelado** da geração
      original (não recalculado com o CPF novo), e a ação "Imprimir" inclui o texto do termo no documento
      impresso.
- [ ] A5: Dado um usuário que não é o freela nem a empresa daquele `shift_payment`, quando ele tenta ler
      aquela linha de `service_terms` (via `select` direto ou via `getByShiftPayment`), então a RLS retorna 0
      linhas — nenhum CPF/CNPJ vaza.
- [ ] A6: Dado qualquer estado do bloco de termo (aceito ou pendente), quando renderizado em `ReceiptView`,
      então o aviso "o Worki não é parte do contrato, não presta consultoria jurídica, não garante validade
      jurídica" está sempre visível — nenhum texto ao redor (título, botão, ícone) sugere o Worki como parte,
      garantidor ou validador do documento.
- [ ] A7: Dado um termo com `accepted_at` já preenchido, quando `accept_service_term` é chamado de novo para
      o mesmo id (retry de rede, duplo clique), então o outcome é `already_accepted` e
      `accepted_at`/`accepted_ip`/`accepted_user_agent` permanecem exatamente como estavam (idempotência).
- [ ] A8: Dado um `shift_payment` com `status='scheduled'` (promessa, ainda não efetivada), quando o freela
      ou a empresa acessam `/recibo/:jobId`, então **nenhum** termo é exibido nem gerado — o bloco do R7 não
      aparece (o termo só nasce quando o pagamento é efetivado, R3).
- [ ] A9: Dado um `shift_payment` com termo já **aceito** que a empresa depois estorna (`status→'voided'`),
      quando qualquer parte reabre o recibo, então o `service_terms` histórico continua legível (nunca é
      deletado por estorno — `ON DELETE CASCADE` só dispara se o `shift_payment` em si for excluído, não em
      `voided`), mas uma nova tentativa de `accept_service_term` para aquele id retornaria `payment_voided`
      se por algum motivo ainda estivesse pendente.

## Out-of-scope

- Geração de PDF assinado digitalmente / certificado ICP-Brasil — o texto vive na própria tela do recibo;
  "baixar" continua sendo o `window.print()` já existente (impressão/"salvar como PDF" do navegador).
- Termo de texto customizável por empresa (hoje é um único texto padrão, `term_version` fixo no código) —
  reabrir isso é decisão de produto futura, mesmo espírito de gatilho de ADR usado em
  `ADR-20260630-pagamento-opcional-piloto`.
- Aceite/assinatura formal do lado da **empresa** (só o freela assina eletronicamente nesta fatia; o registro
  do pagamento já é o ato da empresa).
- Backfill de termos para `shift_payments` já `'recorded'` **antes** desta feature entrar no ar — histórico
  antigo fica sem termo; só pagamentos efetivados a partir do deploy geram `service_terms`.
- Retenção/expiração/exclusão automática de `service_terms` (direito ao esquecimento LGPD) — segue a mesma
  ausência de política de expiração que `shift_payments` já tem hoje; não é resolvido nesta fatia.
- Envio do termo por e-mail/WhatsApp automaticamente.
- Validação jurídica do conteúdo do texto por advogado — responsabilidade de negócio do owner, fora do
  escopo de implementação; o requisito de UI (R7/A6) só garante que o produto não se posiciona como parte.
- Modos B/C de pagamento (escrow/cartão) — esta fatia cobre exclusivamente o modo A (`shift_payments`), único
  modo ativo no piloto.
- Flag de concentração de horas / risco trabalhista agregado (`ConcentrationFlag`, BI-5 já existente) — não
  se conecta a este termo; permanece feature separada.

## Clarifications log

Nenhuma pergunta foi feita ao humano nesta rodada — todas as decisões em aberto foram resolvidas e marcadas
**(Assumido)** nos Requirements (R2, R3, R4) com base no memory-bank, na constitution e no padrão de código
já existente (`shift_payments`, `workers.accepted_tos`, outcomes enum). Pontos que valem revisão humana antes
do HALT de plano, se o dono do produto quiser ajustar:
- R4: threshold de bloqueio por CPF ausente (aceite bloqueado, registro do pagamento não) — pode ser
  revisado se o piloto mostrar freelas comuns sem CPF completo.
- Out-of-scope "customização por empresa": Divino Fogão usa texto padrão de rede: mesmo que outra empresa
  peça texto próprio, esta fatia não resolve isso.
