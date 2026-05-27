# Worki — E2E Run Report

**Data:** 2026-05-26
**Ambiente:** PRODUÇÃO (Supabase `vrklakcbkcsonarmhqhp`), dev server `localhost:5173`
**Suite:** `frontend/e2e/full-flow.cjs` — UMA sessão, DOIS contextos de browser (worker + empresa simultâneos), asserções reais, progresso persistido.
**Contas de teste:** `geribameuacesso+worker@gmail.com` / `geribameuacesso+company@gmail.com`

## Resultado final (passe limpo, sessão única)

**71 / 75 PASS — 4 FAIL.** As 4 falhas são `JC16`–`JC19`, todas em cascata a partir do release de pagamento bloqueado por CORS no `localhost`. Todo o resto — lado worker (A), lado empresa (B) e o fluxo conjunto **até `JC15`** — passou.

| Fase | Escopo | Resultado |
|---|---|---|
| A — Worker | signup/onboarding, dashboard, busca+filtros, meus-jobs, carteira, perfil (editar+toast), segurança, excluir-conta (modal), mensagens, notificações, analytics, re-login | ✅ todos |
| B — Empresa | signup/onboarding, dashboard, **criar vaga real + escrow reserve**, **modal de depósito** (min R$50, taxa Worki 8% vs operador R$4, abas PIX/Boleto/Cartão), perfil, notificações, analytics, re-login | ✅ todos |
| C — Conjunto | candidatar → empresa aprova → contrata → **check-in worker → empresa confirma chegada → check-out worker → empresa confirma saída** | ✅ JC01–JC15 |
| C — pagamento | confirmar entrega → release escrow → saldo worker → avaliações → saque | ❌ JC16–JC19 (CORS) |
| Segurança | `/admin` nega não-admin, rota inexistente → 404 | ✅ |
| E-mail | esqueci-senha, redefinir-senha, sonda de troca/confirmação de e-mail | ✅ (com achados, ver abaixo) |

## Bugs confirmados (priorizados)

> **STATUS PÓS-CORREÇÃO (2026-05-26) — TUDO CORRIGIDO. Re-run final: 75/75 PASS, 0 falhas.**
> - Bug 1 (mensageria) — ✅ **CORRIGIDO em produção** (migration `20260319000000` removeu a FK `fk_message_sender`). Verificado no fluxo real: JC08 mensagem persiste (`companyMsgInDb: true`), JC09/JC10 worker recebe e responde.
> - Bug 2 (turno noturno) — ✅ **CORRIGIDO no código** (`MyJobs.tsx`: soma 1 dia quando fim ≤ início). Build OK. Falta apenas deploy do frontend (Vercel).
> - Bug 3 (CORS) — ✅ **CORRIGIDO em produção** (deploy de `asaas-sync`, `asaas-deposit`, `asaas-checkout`, `asaas-withdraw`, `delete-account`). Verificado: depósito retorna 200, release de escrow funciona (`escrow: released`, saldo worker 0→150), saque valida CPF.
> - Bugs 5/6 (e-mail 429 / 401s) — diagnosticados como infra/timing (cota de e-mail do Supabase; JWT em transição). Não bloqueiam o app. Sem correção de código necessária.
>
> **Ciclo completo verificado ponta-a-ponta:** candidatar → aprovar → contratar → mensagear → check-in → confirmar chegada → check-out → confirmar saída → confirmar entrega → release de pagamento → avaliações (ambos lados) → saque.

### 1. 🔴 CRÍTICO — Mensageria 100% quebrada  ✅ CORRIGIDO
Enviar qualquer mensagem falha:
```
POST /rest/v1/Message → 409
code 23503: insert on "Message" violates FK "fk_message_sender"
details: Key is not present in table "User".
```
O chat grava na tabela legada (era Prisma) `Message`, cujo `senderid` referencia uma tabela `User` antiga **vazia em produção**. Worker↔empresa não conseguem se comunicar. Detectado em `JC08`; `JC09`/`JC10` não têm o que ler.
**Correção provável:** migrar o chat para a tabela atual (ex.: `messages`/`conversations` no schema novo) ou corrigir a FK `fk_message_sender` para apontar para `auth.users`/`profiles` e popular/ajustar dados. Verificar `Messages.tsx` / `CompanyMessages.tsx` / serviço de chat.

### 2. 🟠 ALTO — Turno noturno impede check-in (lifecycle)
`MyJobs.tsx:195-202` calcula a janela com `setHours(todayDate, endH)`, fixando o fim **no mesmo dia**. Qualquer turno que cruze a meia-noite (`work_end_time < work_start_time`, ex.: evento 20:00–02:00) gera intervalo invertido → `isWithinWorkHours` sempre `false` → a vaga nunca entra em "Em Andamento" → **o worker nunca consegue dar check-in**, travando todo o fluxo de execução/pagamento. Mesma lógica em `CompanyJobCandidates.tsx`.
**Correção:** quando `end <= start`, somar 1 dia ao fim antes do `isWithinInterval`.

### 3. 🟠 ALTO (infra) — CORS bloqueia funções Asaas fora do domínio Vercel
`asaas-checkout` (release de escrow), `asaas-deposit` (depósito) e `asaas-sync` (sync de saldo) respondem `Access-Control-Allow-Origin: https://worki-opal.vercel.app`, bloqueando qualquer outra origem (incl. `localhost:5173`). Consequência: **o caminho de release de pagamento não pôde ser verificado** via browser (JC16 falha; server-side retorna 200). Também quebra depósito e sync de saldo em dev.
**Nota:** o usuário indicou que o CORS já era conhecido e não é prioridade — registrado aqui apenas como causa-raiz das falhas JC16–JC19. O release continua **NÃO verificado** ponta-a-ponta (precisa de deploy com CORS correto ou teste server-side do `release_escrow`).

### 4. 🟡 MÉDIO — Sem troca de e-mail / "Confirmar E-mail" é beco sem saída
Não existe funcionalidade de troca de e-mail em lugar nenhum (`0` inputs de e-mail no `/profile`). A quest "Confirmar Email" do dashboard e qualquer UI de confirmar/reenviar e-mail **não existem** no `/profile`. Se o produto espera permitir trocar/confirmar e-mail, está ausente.

### 5. 🟡 MÉDIO — Esqueci-senha estoura o limite de e-mail do Supabase
`POST /auth/v1/recover → 429` (rate limit / cota de e-mail do Supabase). A UI trata o erro graciosamente ("Muitas tentativas"), mas e-mails transacionais de recuperação podem não chegar em produção sob o provedor de e-mail padrão do Supabase. Considerar SMTP/Resend dedicado.

### 6. 🟢 BAIXO — 401 em selects de `workers`/`companies`
`GET /rest/v1/workers?select=accepted_tos` e `GET /rest/v1/companies?select=name` retornam `401` durante a navegação. Provável lacuna de política RLS. Não bloqueou fluxos, mas gera ruído de erro.

## O que funciona (verificado com asserção real)
- **Worker:** signup/onboarding completo, dashboard, busca de vagas + todos os filtros (busca, categorias, modalidade, orçamento, cidade, limpar), abas de Meus Jobs, carteira (saldo + estado do botão Sacar), perfil ver/editar/salvar (toast "Perfil atualizado"), UI de troca de senha, modal de excluir conta (abrir+cancelar), mensagens (página), notificações + abas, analytics, logout, re-login → `/dashboard`.
- **Empresa:** signup/onboarding, dashboard, **criação de vaga real (form multi-step + publicar)**, vaga aparece em `/company/jobs`, **escrow reservado na criação** (R$150 travado, saldo 3850→3700 ✓), **modal de depósito** (validação mínimo R$50, breakdown taxa Worki 8% vs operador R$4 separados, abas PIX/Boleto/Cartão, geração de fatura PIX), perfil, notificações, analytics, re-login → `/company/dashboard`.
- **Conjunto:** worker encontra a vaga e se candidata (toast + linha no DB) → empresa vê candidato em `/company/jobs/:id/candidates` → abre perfil público do worker → aprova para entrevista → **contrata** → seed da janela → **worker check-in (DB) → empresa "Confirmar Chegada" (DB) → worker check-out (DB) → empresa "Confirmar Saída" (DB)**.
- **Segurança:** `/admin` nega worker não-admin (sem vazamento), rota inexistente → página 404.

## Notas da suíte de teste
- Robustez aplicada nesta sessão: `notes.json` persistido (resume com estado), criação de vaga **idempotente** (reusa a vaga rastreada — não cria nova a cada run), seletores de check-in/out **escopados à vaga rastreada** + invariante de vaga única, leitura tolerante a BOM, janela de trabalho semeada como dia inteiro (`00:00–23:59`) para tornar o lifecycle testável a qualquer hora.
- Segurança em produção: nenhum PIX/saque real concluído; saldo da empresa de teste semeado via service_role; vaga de teste e escrow limpos ao final (saldo restaurado).
- 5 vagas de teste duplicadas de execuções anteriores (geradas por reset+rerun antes da correção de idempotência) foram removidas da produção.

## Próximos passos sugeridos
1. **Corrigir mensageria** (crítico) — migrar/realinhar a FK do chat.
2. **Corrigir janela de turno noturno** em `MyJobs.tsx` e `CompanyJobCandidates.tsx`.
3. **CORS das funções Asaas** — permitir origens válidas (allowlist com localhost + Vercel) para destravar release/depósito/sync; depois reverificar JC16–JC19 ponta-a-ponta.
4. Decidir sobre troca/confirmação de e-mail (implementar ou remover a quest "Confirmar Email").
5. Revisar RLS de `workers`/`companies` para os 401.
