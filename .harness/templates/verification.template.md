# Verification — <slug>

> Critérios de verificação com **IDs estáveis** ligados à constitution. O `harness-evaluator` copia este
> template para `.harness/spec/<slug>/verification.md` e marca cada critério a cada iteração. IDs estáveis
> garantem que a iteração N+1 avalie os MESMOS gates que a iteração N — isso alimenta a detecção de deadlock
> ("mesmo `criterion_id` falhando 3×") e a continuidade entre sessões.
>
> Marcar apenas os critérios APLICÁVEIS ao diff (riscar/`n/a` os que não se aplicam). Cada falha cita
> `file:line` + trecho de código (evidence chain).

## Gates determinísticos (rodar primeiro, de `frontend/`)

| ID | Critério | Comando | Status |
|---|---|---|---|
| C-BUILD-GREEN | Build passa (Art. 3) | `cd frontend && npm run build` | ☐ |
| C-LINT-GREEN | Lint sem erro (Art. 3) | `cd frontend && npm run lint` | ☐ |
| C-TESTS-GREEN | Testes relevantes verdes | `cd frontend && npm run test` | ☐ |

> Se qualquer gate determinístico falha → FAIL imediato, tipo (a). Não avaliar semântica em código que não compila.

## Gates de domínio (julgamento LLM — só se os determinísticos passaram)

| ID | Critério (Article) | Como verificar | Status |
|---|---|---|---|
| C-TS-STRICT | Sem `any` não documentado; props tipadas (Art. 2) | grep `: any`, `props: any` | ☐ |
| C-TYPES-CENTRAL | Tipos de domínio em `frontend/src/types/` (Art. 2) | tipos novos no contrato central | ☐ |
| C-FETCH-PATTERN | useState/useEffect + supabase direto, NÃO React Query (Art. 5) | grep `useQuery`/`useMutation` = vazio | ☐ |
| C-ROLE-ISOLATION | Rota worker/empresa correta sob `ProtectedRoute` (Art. 1, 12) | path + guard | ☐ |
| C-AUTH-GATE | Guard de sessão + onboarding + TOS (Art. 12) | `supabase.auth.getUser()` → /login | ☐ |
| C-SUPABASE | Acesso via `lib/supabase`; RLS é a defesa (Art. 4) | client correto + policy | ☐ |
| C-ASAAS-ONLY | Nenhum gateway além de Asaas (Art. 6) | grep `stripe` = vazio | ☐ |
| C-CENTRAL-WALLET | Sem subcontas; saldo no DB (Art. 7) | revisar fluxo | ☐ |
| C-ESCROW-ATOMIC | Saldo só por RPC atômica / `WalletService` (Art. 8) | grep `UPDATE wallets`/`.from('wallets').update` = vazio | ☐ |
| C-IDEMPOTENT | `reference_id` estável; UNIQUE `(wallet_id, reference_id)` (Art. 9) | migration + escrita financeira | ☐ |
| C-NO-SERVICE-ROLE | `service_role` ausente do frontend (Art. 10) | grep `service_role` em `frontend/src` = vazio | ☐ |
| C-CORS-PREFLIGHT | Edge function trata `OPTIONS` + origens local/prod (Art. 11) | handler da função | ☐ |
| C-RLS-NEW-TABLE | Tabela nova com RLS + policies por dono/papel (Art. 4) | migration | ☐ |
| C-DESIGN | Neo-brutalismo + cor por papel (Art. 13) | comparar com design-system.md | ☐ |
| C-MOBILE | Mobile-first (grid-cols-1 base, touch targets) | classes responsivas | ☐ |
| C-NO-LEGACY | Não toca `backend_legacy/`/`frontend-angular-backup/` (Art. 15) | paths do diff | ☐ |
| C-SPEC-COVERAGE | Todos os acceptance criteria da spec cobertos | spec.md ↔ diff | ☐ |

## Resultado

```
verdict: PASS | FAIL | CONDITIONAL
blockers: [<IDs que falharam como BLOCKER>]
next_step: builder_retry | clarifier | architect | approved
```
