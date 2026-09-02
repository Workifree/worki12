# Cobertura clique-a-clique — matriz honesta (iniciada 02/09/2026)

Browser Brave dedicado (CDP porta 9222, perfil isolado), contra **produção**
(worki-opal.vercel.app), contas `e2e-worker@worki.test` / `e2e-empresa@worki.test`.
Regra: linha só vira ✅ depois de navegada E com os elementos interativos exercitados,
console e rede lidos. "Visto antes" NÃO conta — só o que esta rodada exercitou.

Legenda: ✅ exercitado nesta rodada · 🔶 parcial (dito o que faltou) · ⬜ não exercitado
· 🚫 não exercitável com conta de teste (dito porquê)

## Público (sem sessão)
| Rota | Status | Achados |
|---|---|---|
| /login (freela e empresa) | ⬜ | |
| /esqueci-senha | ⬜ | |
| /redefinir-senha | ⬜ | |
| /termos · /privacidade · /ajuda · /sobre | ⬜ | |
| /convite/:token (aceite de elenco por link) | ⬜ | |
| /convite-gerente/:token | ⬜ | |
| 404 (rota inválida) | ⬜ | |

## Freela (MainLayout)
| Rota | Status | Achados |
|---|---|---|
| /dashboard | ⬜ | |
| /my-jobs (5 abas + modais + check-in/out) | ⬜ | |
| /carteira (aceitar/recusar/sair/compartilhar) | ⬜ | |
| /recebimentos | ⬜ | |
| /recibo/:jobId (+ termo + confirmação) | ⬜ | |
| /empresa/:id (perfil público) | ⬜ | |
| /indicacoes | ⬜ | |
| /profile (editar, senha, QR, disponibilidade, certificações, SOS, opt-out, exclusão*) | ⬜ | *exclusão só até o modal |
| /messages (enviar, receber, voltar mobile) | ⬜ | |
| /notifications | ⬜ | |
| /worker/onboarding (conta nova) | ⬜ | |
| Sidebar/BottomNav (todos os itens) | ⬜ | |
| InviteTakeover (aceitar/recusar/dispensar/ESC) | ⬜ | |

## Empresa (CompanyLayout)
| Rota | Status | Achados |
|---|---|---|
| /company/dashboard (triagem, presença, repetir) | ⬜ | |
| /company/create (3 passos, templates, ?repetir, ?chamar, rascunho, série F3) | ⬜ | |
| /company/jobs (lista + filtros) | ⬜ | |
| /company/jobs/:id (detalhe) | ⬜ | |
| /company/jobs/:id/edit | ⬜ | |
| /company/jobs/:id/candidates (7 modais: pagamento, presença, dispensa, avaliação...) | ⬜ | |
| /company/worker/:id (perfil freela + certificações + treinamentos) | ⬜ | |
| /company/team (elenco, listas F2, convites, ShiftCallModal F1, SOS F11) | ⬜ | |
| /company/indicacoes (indicar freela F10) | ⬜ | |
| /company/organization (unidades, gerentes F13) | ⬜ | |
| /company/relatorio (pagamentos + tabs) | ⬜ | |
| /company/operacao (analytics + tabs) | ⬜ | |
| /company/profile (editar, briefing, guarda de vínculo F5) | ⬜ | |
| /company/messages | ⬜ | |
| /company/notifications | ⬜ | |
| /company/onboarding (conta nova) | 🚫 | testado em 22/08 (achado #1 da rodada anterior); recriar empresa nova polui o banco — reavaliar se sobrar tempo |
| Série recorrente F3 (editar futuras, parar série, dry-run) | ⬜ | |
| Chamado de turno F1 (disparo 1→N, aceite-corrida, expirar) | ⬜ | |
| Confirmação de véspera F4 (pedir manual + responder) | ⬜ | |

## Fluxos duplos (empresa ↔ freela na mesma rodada)
| Fluxo | Status | Achados |
|---|---|---|
| Convite de turno → aceite → check-in → checkout → confirmar presença | ⬜ | |
| Registrar pagamento → notificação → recibo → termo → confirmar recebimento | ⬜ | |
| Chamado 1→N → corrida de aceite → perdedor vê "preenchido" | ⬜ | |
| Chat bidirecional (mensagem + lido + realtime) | ⬜ | |
| Avaliação mútua pós-turno | ⬜ | |
| Cancelamentos (empresa desfaz convite; freela cancela turno) | ⬜ | |
| Indicação B→A de X → aceite do freela | ⬜ | |
| Bloqueio do freela → empresa não reconvida | ⬜ | |
