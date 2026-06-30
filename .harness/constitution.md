# Constitution — Worki

> Princípios imutáveis do projeto. Cada Article é não-negociável a menos que explicitamente alterado aqui
> (com data + justificativa). Subagents leem isto antes de qualquer decisão técnica.

---

## Article 1 — Estrutura: páginas planas + isolamento por papel

O frontend vive em `frontend/src/` com estrutura **plana** (`pages/`, `components/`, `contexts/`, `hooks/`,
`layouts/`, `lib/`, `services/`, `types/`). **Não é Feature-Sliced Design** e não há boundary lint.

- Páginas de **empresa** ficam em `pages/company/` (rotas `/company/*`); páginas de **worker** em `pages/`
  (ou `pages/worker/`). Componentes cross-papel ficam em `components/`.
- O isolamento worker ⇎ company é regra de segurança, garantido por `components/ProtectedRoute.tsx` (frontend)
  espelhando o RLS (DB). Nenhuma rota mistura papéis.

## Article 2 — Tipagem estrita, tipos à mão

TypeScript em `strict: true` + `noUnusedLocals` + `noUnusedParameters`. `any` é proibido exceto em
`// @ts-expect-error` documentado com motivo. As interfaces de domínio vivem em `frontend/src/types/index.ts`
(escritas à mão — **não há codegen** do Supabase). Mudou schema → atualizar lá.

## Article 3 — `cd frontend && npm run build` é o gate

Toda entrega de código frontend DEVE passar `cd frontend && npm run build` (`tsc -b && vite build`) e
`cd frontend && npm run lint` sem erro. Build quebrado nunca é commitado.

## Article 4 — Supabase é o backend canônico

Acesso a dados via `frontend/src/lib/supabase.ts`. Auth, Realtime, Storage, RLS e RPCs: tudo via Supabase.
**RLS é a primeira linha de defesa**; filtros no client são apenas UX. Toda query autenticada começa com
`supabase.auth.getUser()` e redireciona para `/login` quando não há sessão.

## Article 5 — Padrão de fetch: useState/useEffect direto

O padrão de dados do projeto é `useState` + `useEffect` + `supabase.from(...)` direto. TanStack React Query
existe no bundle mas **não é usado nas páginas**. Não introduzir `useQuery` em features isoladas sem decisão
explícita de migração — consistência acima de preferência.

## Article 6 — Asaas é o ÚNICO gateway de pagamento

Stripe foi 100% removido por decisão do owner. Nenhuma feature reintroduz Stripe ou qualquer outro provedor.
Toda integração de pagamento passa pelo helper `supabase/functions/_shared/asaas.ts`.

## Article 7 — Carteira central, sem subcontas

Há **uma** conta master Asaas que detém todos os fundos. O saldo por usuário vive no DB (`wallets.balance`).
Não criar subcontas Asaas nem espelhar saldo fora do DB.

## Article 8 — Saldo só muda por RPC atômica

Toda alteração de saldo/escrow passa por RPC Postgres atômica (`reserve_escrow`, `release_escrow`,
`refund_escrow`, `credit_deposit`, `update_wallet_balance`). **Proibido** `UPDATE wallets SET balance` manual
no client ou em Edge Function fora dessas RPCs. As RPCs exigem `GRANT EXECUTE ... TO service_role, authenticated`.

## Article 9 — Idempotência de transações financeiras

`wallet_transactions` tem UNIQUE `(wallet_id, reference_id)` — nunca `reference_id` sozinho. Webhooks e
reprocessamentos não podem creditar/debitar em dobro. Toda escrita financeira carrega um `reference_id` estável.

## Article 10 — `service_role` nunca no frontend

A chave `service_role` só existe dentro de Edge Functions (`Deno.env`). Nenhuma operação privilegiada
(pagamentos, admin, exclusão de conta) acontece no client — sempre via Edge Function.

## Article 11 — Edge Functions tratam CORS preflight

Toda Edge Function responde ao preflight `OPTIONS` com headers CORS corretos. As funções Asaas aceitam
origens de produção **e** de desenvolvimento local (`http://localhost:5173`). Deploy: `asaas-webhook` e
`admin-data` vão com `--no-verify-jwt` (webhook não traz JWT Supabase; admin-data tem auth própria); as
demais validam o JWT do gateway.

## Article 12 — Auth + onboarding + TOS antes do acesso

Toda rota protegida vive sob `<ProtectedRoute>`, que exige sessão válida, `onboarding_completed` e
`accepted_tos` (TOS gate). Sem exceção para "rota interna".

## Article 13 — Design neo-brutalista

A identidade visual é neo-brutalista: bordas pretas 2px, sombras offset sólidas (sem blur), tipografia pesada
em caixa-alta, cantos arredondados. Verde `#00A651` = worker; azul `#2563EB` = empresa; preto `#111111` =
estrutura. Detalhes e classes canônicas em `memory-bank/design-system.md`. Não reintroduzir estilos do
Angular legado (`frontend-angular-backup/`).

## Article 14 — Commits em português, sem Co-Authored-By

Todas as mensagens de commit são em português (`feat:`, `fix:`, `refactor:`, `chore:`, `test:`). **Não**
adicionar linhas `Co-Authored-By`. Nunca `--no-verify` ou `--force` sem autorização humana explícita na sessão.

## Article 15 — Diretórios legados são intocáveis

`backend_legacy/` e `frontend-angular-backup/` são deprecados. Nenhuma feature nova lê, escreve ou depende deles.

## Article 16 — Routing de IA: Claude (tudo) + Gemini 3 (apenas frontend)

O orquestrador e todos os subagents `harness-*` rodam via Claude Code (Agent tool). **Única exceção
autorizada:** a construção de UI React/TSX usa **Gemini 3** — é o melhor construtor de frontend e foi o que
construiu o frontend do Worki até agora. O `harness-frontend-builder` (subagent Claude) despacha para o Gemini
via `scripts/gemini-dispatch.sh`, com fallback Claude se indisponível. A chave Gemini vem do ambiente, **nunca**
em plaintext no repo. Nenhum outro provedor de IA (OpenAI, cursor, ollama, openrouter) entra no fluxo do harness.
Este routing é de *desenvolvimento* — não cria dependência de IA em runtime (Article relacionado: o produto não
depende de IA para funcionar).

---

## Histórico de mudanças constitucionais

- 2026-06-15 — Constitution criada ao portar o harness v3.5 do projeto Momma, adaptada à realidade do Worki
  (estrutura plana, Asaas-only, escrow atômico, neo-brutalismo, Claude para tudo + Gemini 3 só no frontend).
