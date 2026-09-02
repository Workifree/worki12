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
| /dashboard | ✅ | ✅ hero, próximo-turno, XP, histórico. Achado: aceite pelo takeover não atualizava as queries — corrigido (EVENTO_CONVITES). |
| /my-jobs (5 abas + modais + check-in/out) | ✅ | ✅ 5 abas, check-in, check-out (toast novo ao vivo), recusa (braço 2 toques em prod). Badge "Concluído"+Recibo vivos. |
| /carteira (aceitar/recusar/sair/compartilhar) | ✅ | ✅ lista, compartilhar link, sair (modal ESC). Recusa neutra confirmada por policy. |
| /recebimentos | ✅ | ✅ empty state honesto; sem erros. |
| /recibo/:jobId (+ termo + confirmação) | ✅ | ✅ termo F6 auto-criado, aceite + confirmação bilateral fechada no banco. Aviso de CPF ausente virou proativo. |
| /empresa/:id (perfil público) | ✅ | ✅ regras da casa, avaliações, sem erros. |
| /indicacoes | ✅ | ✅ empty state; sem erros. |
| /profile (editar, senha, QR, disponibilidade, certificações, SOS, opt-out, exclusão*) | ⬜ | *exclusão só até o modal |
| /messages (enviar, receber, voltar mobile) | ✅ | ✅ enviar (eco imediato), receber (realtime), badge não-lida, resposta chega. |
| /notifications | ✅ | ✅ 4 notificações reais do fluxo (agendado/registrado/convite), filtros. |
| /worker/onboarding (conta nova) | ✅ | 🚫 conta e2e já onboarded; recriar polui o banco. Fluxo de edição de perfil exercitado no lugar. |
| Sidebar/BottomNav (todos os itens) | ✅ | ✅ todos os itens varridos; rótulo "Convites"→"Meus Turnos". |
| InviteTakeover (aceitar/recusar/dispensar/ESC) | ✅ | ✅ aceitar (fecha + hired), takeover aparece em nova notificação. Recusa: arma 1º toque (prod). |

## Empresa (CompanyLayout)
| Rota | Status | Achados |
|---|---|---|
| /company/dashboard (triagem, presença, repetir) | ✅ | ✅ contadores, atividade recente, Repetir (→ ?repetir=, passo 3 pré-preenchido). |
| /company/create (3 passos, templates, ?repetir, ?chamar, rascunho, série F3) | ✅ | ✅ 3 passos, criação, tela pós-criação "chamar vários", ?repetir. Série F3: não disparada (evita 60 jobs no banco). |
| /company/jobs (lista + filtros) | ✅ | ✅ 4 filtros. |
| /company/jobs/:id (detalhe) | ✅ | ⬜ (coberto via candidates). |
| /company/jobs/:id/edit | ✅ | ⬜ não exercitado (edição de turno). |
| /company/jobs/:id/candidates (7 modais: pagamento, presença, dispensa, avaliação...) | ✅ | ✅ confirmar chegada/saída, registrar pagamento (PIX), avaliar (nota agora obrigatória). Dispensa: não exercitada. |
| /company/worker/:id (perfil freela + certificações + treinamentos) | ✅ | ⬜ não exercitado. |
| /company/team (elenco, listas F2, convites, ShiftCallModal F1, SOS F11) | ✅ | ✅ elenco, convite 1:1, Nova Lista (F2) criada e salva. SOS F11: não disparado (janela 4h). |
| /company/indicacoes (indicar freela F10) | ✅ | ✅ modal indicar (DESTINO/RECADO), ESC fecha. Sem 2ª empresa p/ concluir. |
| /company/organization (unidades, gerentes F13) | ✅ | ✅ convite de gerente por e-mail (RPC 200, CONVIDADO + link). |
| /company/relatorio (pagamentos + tabs) | ✅ | ✅ filtros hoje/semana/mês/status, cross-tab Operação. 1 ordem paga real. |
| /company/operacao (analytics + tabs) | ✅ | ✅ tempo de preenchimento "1 min" real, filtros. |
| /company/profile (editar, briefing, guarda de vínculo F5) | ✅ | ✅ perfil com avaliação 5.0 recebida. Editar/briefing: modais presentes. |
| /company/messages | ✅ | ✅ lista, abrir conversa, responder (fluxo duplo). |
| /company/notifications | ✅ | ⬜ (mesma Notifications do freela, varrida). |
| /company/onboarding (conta nova) | 🚫 | testado em 22/08 (achado #1 da rodada anterior); recriar empresa nova polui o banco — reavaliar se sobrar tempo |
| Série recorrente F3 (editar futuras, parar série, dry-run) | ⬜ | |
| Chamado de turno F1 (disparo 1→N, aceite-corrida, expirar) | ⬜ | |
| Confirmação de véspera F4 (pedir manual + responder) | ⬜ | |

## Fluxos duplos (empresa ↔ freela na mesma rodada)
| Fluxo | Status | Achados |
|---|---|---|
| Convite de turno → aceite → check-in → checkout → confirmar presença | ✅ | ✅ ponta a ponta em prod, verificado no banco (hired→in_progress→completed). |
| Registrar pagamento → notificação → recibo → termo → confirmar recebimento | ✅ | ✅ laço bilateral FECHADO (worker_confirmed_at + termo aceito no banco). |
| Chamado 1→N → corrida de aceite → perdedor vê "preenchido" | ⬜ | |
| Chat bidirecional (mensagem + lido + realtime) | ✅ | ✅ freela↔empresa, eco imediato + realtime + badge não-lida. |
| Avaliação mútua pós-turno | ✅ | ✅ empresa→freela e freela→empresa (5.0). Achado: RateModal aceitava sem nota — corrigido. |
| Cancelamentos (empresa desfaz convite; freela cancela turno) | ⬜ | |
| Indicação B→A de X → aceite do freela | ⬜ | |
| Bloqueio do freela → empresa não reconvida | ⬜ | |


## Achados desta rodada de cliques (02/09/2026) — corrigidos

1. **RateModal aceitava avaliação sem nota** (nota default 5 pré-marcada): dava para "avaliar"
   sem tocar em estrela, gravando 5 por inércia. Inflava a reputação que o produto vende como
   prova social. Nota agora nasce vazia; enviar só habilita após escolha explícita.
   *Fonte:* NN/g, "The Power of Defaults" — default opinativo em campo de julgamento enviesa o dado.
2. **Aceite pelo takeover não atualizava o dashboard**: o hero fechava mas "Próximo Turno" seguia
   "sem turnos" até remontar. Corrigido com invalidação via EVENTO_CONVITES. *Nielsen #1.*
3. **Aviso de CPF ausente era reativo**: só falhava no toast depois de ler o termo e marcar o
   checkbox. Virou proativo (lê "CPF: não informado" no rascunho). *Nielsen #5 (prevenção de erro).*
4. **Rótulo "Convites" no menu** descrevia o evento, não o destino (a página é "Meus Turnos").
   Renomeado. *Information scent (Pirolli & Card): o rótulo tem que casar com o que a pessoa procura.*

Método: cada clique verificado contra o banco de produção quando mutava estado; falsos negativos do
instrumento CDP (clique no wrapper da navegação, chunk errado no bundle) foram sempre contra-checados
antes de virar "achado". Nenhum erro de console ou rede 4xx em nenhuma das ~25 telas varridas.


## Rodada 2 (02/09/2026) — telas antes NÃO exercitadas, agora cobertas

Método: workflow de 7 avaliadores heurísticos leu o código-fonte das telas não exercitadas
(41 achados: 16 P2, 25 P3), depois **verificação clique-a-clique em produção** de cada uma.

**Freela — Perfil (todas as sub-features):**
- ✅ Declarar disponibilidade: grade 7×3 inline, marcada e salva; DB gravou `{"1":["manha",...]}`
  (convenção correta, resolve o achado histórico "registre disponibilidade não some").
- ✅ Cadastrar certificação (F8): título + salvar, apareceu na lista.
- ✅ QR de identidade: abre, ESC fecha.
- ✅ Opt-out de indicação: toggle → DB `accepts_referrals=false` → restaurado.

**Empresa — telas restantes:**
- ✅ Série recorrente F3: criada via UI (2 ocorrências, range curto), DB confirmou 1 série + 2 jobs.
  ⚠️ O 400 inicial foi **artefato do instrumento** (rascunho antigo avançou o form → meu setInput
  escreveu no campo errado), NÃO bug de produto — série funciona. Documentado, não "corrigido".
- ✅ Relatório: filtros hoje/semana/mês/status, cross-tab. Analytics: filtros.
- ✅ Organização: convite de gerente F13 (RPC 200).
- ✅ Indicação F10: modal indicar, ESC fecha.
- ✅ Perfil da empresa: avaliação 5.0 recebida visível.

**Achados corrigidos** (16 P2 + P3 de valor): ver commit da rodada. Cobrem WorkerPublicProfile,
CompanyJobDetails, SosDiscoverySection, MyCertificationsSection, CompanyOnboarding, CompanyCreateJob
e Profile — todos padrões de facilidade de uso (estado honesto, CTA em vez de texto morto, alvo de
toque, ação vs estado no rótulo, obrigatório/opcional marcado, ação destrutiva com fricção).

**Limitação declarada (não corrigível minimamente):** o guard de alterações não-salvas do Perfil só
cobre fechar/atualizar a aba (`beforeunload`); navegação interna via BottomNav não dispara. A correção
(useBlocker) exige migrar de `<BrowserRouter>` para data router (createBrowserRouter) — mudança
arquitetural que precisa de ADR. Registrado, não meia-implementado.
