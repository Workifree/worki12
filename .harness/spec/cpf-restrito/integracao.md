# Integração — pontos do frontend da etapa 1 (cpf-restrito)

Levantado na árvore de trabalho de `feat/equipe-encarregados` em 25/11/2026. As linhas podem deslocar, porque outro
agente está editando o frontend. Confirme pelo trecho citado.

## Muda (obrigatório)
| Arquivo:linha | Hoje | Etapa 1 |
|---|---|---|
| `frontend/src/pages/Dashboard.tsx:91` | `from('workers').select('*').eq('id', user.id).single()` | `supabase.rpc('get_my_worker_profile')`. Erro quando vier `null`, como faz o `.single()` hoje. Alternativa: lista explícita só com as colunas usadas, sem cpf/birth_date |
| `frontend/src/pages/Profile.tsx:302-305` | `from('workers').select('*').eq('id', user.id).single()` | `supabase.rpc('get_my_worker_profile')`. A linha 316 (`data.cpf`) continua funcionando sobre o jsonb |
| `frontend/src/pages/worker/WorkerOnboarding.tsx:287-288` | `cpf` e `birth_date` dentro do `upsert` (linha 282) | Tirar os dois do upsert. Depois do upsert sem erro, chamar `rpc('set_my_worker_identity', { p_cpf, p_birth_date })` e tratar `outcome !== 'saved'` (`cpf_locked` pode ser aceito em silêncio) |
| `frontend/src/pages/Profile.test.tsx` | mock de `from('workers').select('*')` | mock de `rpc('get_my_worker_profile')` |

## Muda (recomendado; funciona sem mudar mesmo após a etapa 2)
| Arquivo:linha | Hoje | Sugestão |
|---|---|---|
| `frontend/src/pages/Profile.tsx:532` e `542-545` | `cpf` vai no `update(updates)...select('id')` | `rpc('set_my_worker_identity', { p_cpf })`. A trava "CPF só se vazio" passa a valer no servidor. UPDATE puro de cpf + `select('id')` continua passando com a trava por coluna (provado no PGlite) |
| `frontend/src/pages/Profile.tsx:426-429` | `update(updates).select('id')` | Conferir se `updates` carrega `birth_date`. Se carregar, mesma sugestão |

## Conferido, sem mudança
- `frontend/src/pages/company/WorkerPublicProfile.tsx:114`: lista explícita, sem cpf/birth_date.
- `frontend/src/pages/company/CompanyJobCandidates.tsx:433`: já trocou o `workers(*)` por lista explícita.
- `frontend/src/components/ServiceTermSection.tsx:316`: link `/profile?editar=cpf`, só navegação.
- Leituras com lista explícita e sem cpf: `components/CompanyBadges.tsx:120`, `components/ProfileAvatarLink.tsx:18`,
  `components/ProtectedRoute.tsx:139`, `components/ReferralOptOutSection.tsx:43`, `components/Sidebar.tsx:87`,
  `components/SosDiscoverySection.tsx:47`, `pages/Profile.tsx:367`, `pages/worker/WorkerOnboarding.tsx:143`,
  `services/operationAnalyticsService.ts:528`, `services/orderReportService.ts:342`.
- Escritas sem cpf: `services/badgeService.ts:149`, `services/referralService.ts:503`, `services/sosService.ts:164`.
- Nenhum embed `workers(*)` nem assinatura Realtime em `workers` foi encontrado.

## Tipos
- `frontend/src/types/index.ts`: tipar o retorno de `get_my_worker_profile` como `Worker | null` e o de
  `set_my_worker_identity` como `{ outcome: 'saved' | 'cpf_locked' | 'invalid_cpf' | 'not_found' | 'unauthenticated' }`.
