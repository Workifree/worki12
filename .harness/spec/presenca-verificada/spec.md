# Spec técnica — Presença verificada (QR do local + GPS)

ADR: `./ADR.md`. Status: PROPOSTO (gate do architect). As decisões do dono que estão pendentes ficam no fim do arquivo.

## Critérios testáveis
| # | Critério | Como testar |
|---|---|---|
| P1 | Um turno sem configuração nasce `presence_mode='dual'`, e o fluxo atual não muda | PGlite + e2e do fluxo de chegada atual |
| P2 | `qr_gps` sem `site_id` é recusado (CHECK) | PGlite |
| P3 | Só o Gestor cria, edita ou arquiva `company_sites`. O encarregado lê os locais da própria company. O freela não lê nada | PGlite (3 papéis) |
| P4 | Nenhum papel `authenticated`/`anon` lê `company_site_secrets` (SELECT devolve 0 linhas ou erro de permissão) | PGlite |
| P5 | Em turno `qr_gps`, o UPDATE direto de `worker_checkin_at`/`worker_checkout_at`/`company_*_confirmed_at` é recusado com 42501 | PGlite |
| P6 | `verify_presence` com QR válido (step atual ou anterior) e GPS dentro do raio carimba a chegada e a confirmação, e grava `presence_checks.result='verified'` | PGlite |
| P7 | QR com step-2, version antiga, outro site ou outro job resulta em `qr_invalid`/`qr_expired`, sem carimbo, com tentativa gravada | PGlite |
| P8 | `accuracy_m>150` resulta em `gps_low_accuracy`. Distância maior que `radius+min(acc,50)` resulta em `gps_out_of_range`. Entrada fora de faixa resulta em `invalid_input` | PGlite |
| P9 | `verify_presence` chamado por outro freela resulta em `not_owner`. Fora da janela resulta em `outside_window` | PGlite |
| P10 | Uma segunda verificação da mesma `(application, kind)` resulta em `already_verified`, de forma idempotente e sem novo carimbo | PGlite |
| P11 | `record_presence_exception` só funciona com `is_job_owner` e motivo da lista. Ela carimba e grava `manual_exception` + `decided_by` | PGlite |
| P12 | `presence_checks` não tem colunas de lat/lng (assert no catálogo) e nenhuma tabela nova tem coordenada do freela | PGlite (`information_schema`) |
| P13 | `get_presence_qr` só funciona para `is_job_owner` do turno, e só em turno `qr_gps`/`rotating` | PGlite |
| P14 | `presence_mode`/`site_id`/`qr_mode` ficam imutáveis depois do primeiro carimbo de qualquer application do turno; antes dele, afrouxar ou trocar de local só o Gestor | PGlite |
| P15 | O cron de purga apaga tentativas falhas com mais de 90 dias e preserva `verified`/`manual_exception` | PGlite (sem pg_cron: chamar a função) |
| P16 | Freela que nega o GPS vê "Pedir confirmação ao responsável" e chega ao recibo | e2e (harness-tester, 2 Chromes) |
| P17 | O recibo e o modal de pagamento mostram o selo verificado/exceção/não verificado, e o pagamento nunca é bloqueado | e2e + vitest de componente |
| P18 | O aviso de localização aparece antes do prompt do browser | e2e |
| P19 | `frontend/vercel.json` tem `geolocation=(self)` | grep no CI/teste |

## Modelo de dados
- `company_sites(id, company_id → companies RESTRICT, name, address_text, lat numeric(9,6), lng numeric(9,6), radius_m int CHECK 50..500 DEFAULT 150, created_by, created_at, updated_at, archived_at)`. RLS: SELECT para `is_company_owner(company_id) OR session_company_member_role(company_id) IS NOT NULL` (membro confirmado). Escrita por policy `is_company_owner`. Sem DELETE.
- `company_site_secrets(site_id PK → company_sites, secret bytea NOT NULL DEFAULT gen_random_bytes(32), version int NOT NULL DEFAULT 1, rotated_at)`. RLS habilitado, sem policy e com `REVOKE ALL FROM authenticated, anon`. O segredo nasce por trigger AFTER INSERT em `company_sites`.
- `jobs` (+ `presence_mode`, `site_id`, `qr_mode`) e `companies` (+ `default_presence_mode`, `default_site_id`, `default_qr_mode`). Em `jobs.site_id` vale a regra de que o local tem de ser da mesma company (trigger).
- `presence_checks(id, application_id → applications RESTRICT, job_id, worker_id, kind, result CHECK IN ('verified','manual_exception','qr_invalid','qr_expired','gps_out_of_range','gps_low_accuracy','gps_unavailable','outside_window','invalid_input'), distance_m int, accuracy_m int, qr_ok bool, qr_kind, reason text CHECK em lista, decided_by uuid, created_at)`. Índice UNIQUE parcial `(application_id, kind) WHERE result IN ('verified','manual_exception')`. RLS SELECT: o freela vê as próprias linhas e `is_job_owner(job_id)` vê as do turno. Escrita só por RPC.
- Motivos de exceção: `sem_sinal_gps`, `gps_negado`, `qr_ilegivel`, `celular_sem_bateria`, `local_mudou`, `outro`.
- Tipos à mão em `frontend/src/types/index.ts`: `PresenceMode`, `CompanySite`, `PresenceCheck`, `PresenceResult`.

## RPCs (todas SECURITY DEFINER, `SET search_path=''`, retorno `jsonb {outcome,...}`)
- `verify_presence(p_application_id, p_kind, p_qr, p_lat, p_lng, p_accuracy_m)` com GRANT `authenticated`.
- `record_presence_exception(p_application_id, p_kind, p_reason)` com GRANT `authenticated` (exige `is_job_owner`).
- `request_presence_exception(p_application_id, p_kind, p_reason)`: o freela pede ajuda. Grava a tentativa e notifica `notification_recipients_for_job` (se a E2 não estiver aplicada, notifica o dono da company).
- `get_presence_qr(p_job_id)` → `{token, expires_in_s}` com GRANT `authenticated`.
- `get_site_static_qr(p_site_id)` e `rotate_site_secret(p_site_id)` com GRANT `authenticated` (exigem `is_company_owner`).
- `purge_presence_checks()` com GRANT só `postgres, service_role`, agendada no `pg_cron` `'30 6 * * *'` com `IF EXISTS` + `RAISE WARNING`.
- O guard ganha um ramo: `IF v_presence_mode='qr_gps' AND (v_wi OR v_wo OR v_ci OR v_co) AND current_setting('app.presence_rpc', true) IS DISTINCT FROM 'on' THEN RAISE 42501`.

## Plano de migrations (ordem obrigatória; cada uma idempotente e com DOWN no cabeçalho)
1. `20261127000100_presenca_p1_locais.sql`: `pgcrypto` (IF NOT EXISTS, schema `extensions`), `company_sites`, `company_site_secrets`, RLS e trigger do segredo.
2. `20261127000200_presenca_p2_politica_turno.sql`: colunas em `jobs`/`companies` (ADD COLUMN com DEFAULT constante, sem rewrite pesado), CHECKs, trigger de congelamento e de local da mesma company, e atualização de `create_job_series` para copiar os campos do template.
3. `20261127000300_presenca_p3_verificacao.sql`: `presence_checks`, as RPCs, o ramo novo no `applications_update_guard` (CREATE OR REPLACE preservando 100% do corpo atual), purga e cron.
4. Índices: `CREATE INDEX CONCURRENTLY` em `presence_checks(job_id)` e `company_sites(company_id)`, em arquivo separado `..._000400_presenca_indices.sql`, fora da transação.
- Testes: `supabase/tests/pglite-presenca/run.mjs`, no padrão de `pglite-sos/run.mjs`, cobrindo P2–P15. Também é preciso rodar de novo `pglite-acesso`, `applications_update_hardening.sql` e os testes da equipe E0–E5, porque o guard mudou.
- Dependência: o seam `is_job_owner` com encarregado vem da E2. A P3 funciona com o seam vigente (Gestor-only) e herda o encarregado quando a E2 for aplicada, sem retrabalho.

## Fases
- **F0 (só infra):** migration P1 + página `/company/locais` (CRUD do Gestor, "Estou no local agora", mapa Leaflet/OSM opcional, impressão do QR estático) + `geolocation=(self)`.
- **F1 (política):** P2 + seletor "Como confirmar presença" no `CompanyCreateJob`, na série e nas configurações da empresa (padrão).
- **F2 (verificação):** P3 + leitura no fluxo de chegada/saída do freela (`QrScannerPane` sob demanda + `navigator.geolocation.getCurrentPosition({enableHighAccuracy:true, timeout:15000, maximumAge:0})`), aviso LGPD, tela "Mostrar QR do turno" para o responsável, pedido e resolução de exceção, e selo no `ReceiptView`/modal de pagamento.
- **F3 (depois):** relatório de exceções por local e responsável, e novos modos.

## Arquivos (prováveis)
- Novos: `frontend/src/pages/company/CompanySites.tsx`, `frontend/src/pages/company/SiteQrPrint.tsx`, `frontend/src/components/presence/PresenceCheckFlow.tsx`, `frontend/src/components/presence/ShowShiftQr.tsx`, `frontend/src/components/presence/PresenceBadge.tsx`, `frontend/src/services/presenceService.ts`, `frontend/src/lib/geo.ts` (haversine só para UX/pré-visualização; o servidor decide).
- Alterados: `frontend/vercel.json`, `frontend/src/App.tsx` (rotas sob `ProtectedRoute` de company), `frontend/src/types/index.ts`, `CompanyCreateJob`, o fluxo de chegada em `MyJobs`, `CompanyJobCandidates` (pagamento), `ReceiptView`, `services/jobSeriesService` (template), a página de Privacidade (finalidade "verificação de presença").
- Fiação: o `QrScannerPane` já existente é reaproveitado, só como leitor. O conteúdo vai cru para a RPC, e o client não interpreta.

## Perguntas ao dono (recomendação padrão entre parênteses; seguir com ela se não houver resposta)
1. A chegada verificada dispensa a confirmação da empresa? (Sim.)
2. A saída também exige QR+GPS? (Sim, com a mesma contingência. Sem verificação não bloqueia, só marca.)
3. Rotativo ou estático como padrão? (Rotativo. Estático só para local sem responsável presente.)
4. Exceção manual: o encarregado pode aprovar ou só o Gestor? (Quem opera o turno, `is_job_owner`.)
5. Raio padrão? (150 m, editável entre 50 e 500 por local.)
