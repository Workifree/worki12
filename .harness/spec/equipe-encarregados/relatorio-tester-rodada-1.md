# Relatório do tester, rodada 1 (exploratória e regressão): Equipe e encarregados

**Veredito: FAIL**

- Ambiente: `http://localhost:5173` (Vite dev, worktree do commit `8030545b`; sem hash de bundle), banco de PRODUÇÃO com só E0 e E1.
- Horário: de 24/11/2026 ~23:55 a 25/11/2026 ~00:45 (BRT).
- Janelas: empresa 9222 (1366x800 e 320x568), freela 9223 (390x844 e 320x568).
- ATENÇÃO: a árvore principal do repositório tem alterações NÃO commitadas (ex.: `CompanyJobDetails.tsx`, `ProtectedRoute.tsx`, `useCurrentCompany.ts`) que o servidor testado não contém. Os "arquivos prováveis" vêm da árvore principal e as linhas podem diferir da versão servida.
- "Origem": REGRESSÃO = nasce do diff. PRÉ-EXISTENTE (provável) = julgamento por leitura de código/migration, sem comparar com a main no navegador.
- WebSocket `ERR_INTERNET_DISCONNECTED` em todas as páginas: artefato do ambiente (bloqueio de rede do MCP). Realtime e `emulate Offline` não funcionaram. Falhas de rede foram simuladas trocando `window.fetch`.

---

## DEFEITOS REAIS

CRÍTICO: nenhum observado (isolamento de rota por papel funcionou; sem duplicação em envios).

### ALTO

#### D-1 · Aviso de risco de vínculo ignora a configuração da empresa quando o front sobe antes da E5 (REGRESSÃO)
- Etapa: Chamado de Turno. Oráculo: F5 (aviso configurável), ordem de deploy; Perfil e modal se contradizem.
- Passos: 1) Empresa, Perfil Empresa, Editar Perfil, limite = 1, Salvar (a tela mostra "passar de 1x"). 2) Freela de teste com 1 turno contratado na semana (A). 3) Abrir `/company/jobs/<B>/candidates?chamar=1` (B na mesma semana).
- Esperado: selo de frequência no Worker E2E (1 + 1 > 1).
- Obtido: nenhum selo. `POST rpc/my_link_risk_config {"p_company_id":...}` = 404 `PGRST202`. `count_worker_shifts_by_week` = 200, `shift_count: 1`.
- A mesma RPC SEM parâmetro (assinatura antiga) responde 200 com `{enabled, threshold}`.
- Impacto: toda empresa cai no padrão ligado/2. Pelo código, quem desligou volta a ver o selo (lado não executado).
- Frequência: 404 em todas as aberturas; efeito visível na única abertura com limite alterado. Limite restaurado para 2.
- Arquivo provável: `frontend/src/services/linkRiskService.ts` (`getConfig`: em PGRST202, repetir sem parâmetro antes do default).

#### D-2 · Uma falha em `get_my_companies` manda a empresa já cadastrada para o onboarding "Primeiro acesso" (origem não determinada)
- Etapa: login/entrada. Oráculo: expectativa do usuário; empresa não pode perder o acesso por rede.
- Passos: 1) Empresa logada. 2) Fazer só `rpc/get_my_companies` falhar (`Failed to fetch`). 3) Carregar `/company/dashboard`.
- Esperado: erro de conexão + "Tentar de novo".
- Obtido: redireciona para `/company/onboarding`: "Primeiro acesso. Vamos configurar sua empresa..." com formulário Nome, CNPJ/CPF, Tipo, Setor, Cidade.
- NÃO enviei o formulário. Se o envio sobrescrever a linha de `companies`, o item passa a CRÍTICO. Verificar.
- Frequência: 1 de 1 (determinístico no teste). Recarregar com rede boa volta ao dashboard.
- Arquivo provável: `components/ProtectedRoute.tsx` (`catch` chama `setOnboardingRedirect('/company/onboarding')`).

#### D-3 · DONO vê "Seu acesso está quase pronto / O Gestor precisa liberar sua entrada" (REGRESSÃO)
- Oráculo: spec R22 (a espera é só para encarregado não confirmado).
- Passos: 1) Dono logado abre `/convite-equipe/<qualquer token, até inválido>` (ex.: Gestor testando o link). `sessionStorage.pending_team_invite_token` fica gravado. 2) Na mesma aba, `get_my_companies` falha. 3) Abrir `/company/dashboard`.
- Esperado: erro de conexão; token inválido não persiste.
- Obtido: título "Acesso quase pronto"; "O Gestor precisa liberar sua entrada. É um passo normal de segurança." com "Atualizar" e "Sair".
- Frequência: 2 de 2 (uma com o token gravado pelo fluxo real do convite; outra injetando o valor no `sessionStorage`). Com rede boa e sem o token, volta ao normal.
- Arquivo provável: `components/ProtectedRoute.tsx` (`hasTeamMemberHint() || readPendingTeamInviteToken() !== null`), `lib/teamInviteToken.ts`, `pages/AcceptTeamInvite.tsx`. Há mudança não commitada nesses pontos: retestar com ela.

#### D-4 · Falha de rede ao navegar joga o freela logado no `/login` (PRÉ-EXISTENTE provável)
- Passos: 1) Freela no dashboard. 2) Derrubar chamadas ao Supabase. 3) Tocar "Recebimentos" no menu inferior.
- Esperado: "sem conexão", mantendo a sessão.
- Obtido: `/login` com formulário; o token continua no `localStorage`; só `GET /auth/v1/user` falhou.
- Evidência: pilha do `history.pushState` aponta `hooks/useShiftInvites.ts` (~98) e `pages/MeusRecebimentos.tsx` `fetchPayments`.
- Frequência: 3 de 3.
- Arquivo provável: esses dois e demais `getUser()` seguidos de `navigate('/login')`.

#### D-5 · Após convidar, o modal pós-criação continua dizendo que ninguém foi convidado (PRÉ-EXISTENTE provável)
- Passos: 1) Criar turno. 2) No modal "Convidar freela", tocar "Convidar" no Worker E2E. 3) Tocar de novo.
- Esperado: botão vira "Convidado" e some o aviso.
- Obtido: toast "Convite enviado com sucesso!", mas o botão segue "Convidar" e o texto segue "Convide pelo menos 1 freela para concluir a criação do turno." 2º toque: "Este freela já foi convidado para este turno." Em Meus Turnos o card com convite pendente mostra "Sem freela" + "Convidar freela".
- Evidência: o convite grava `shift_calls` + `shift_call_targets` (201); a lista lê `applications` com `invited_by_company_at not null` (`listInvitesByJob`).
- Frequência: 1 de 1 em cada tela.
- Arquivo provável: `hooks/useShiftInvites.ts`, `CompanyCreateJob.tsx`, `CompanyJobs.tsx`.

#### D-6 · Stepper do freela mostra "Chegada registrada" antes de qualquer check-in (PRÉ-EXISTENTE)
- Passos: freela com turno de hoje na janela, Meus Turnos, Em Andamento, sem tocar em nada.
- Esperado: chegada pendente. Obtido: etapa 1 em negrito "Chegada registrada" com botão "Check-in" abaixo.
- Frequência: sempre. Arquivo: `pages/MyJobs.tsx` `computeWorkerSteps` (rótulo fixo no estado `active`).

#### D-7 · SOS diz "só libera quando o turno começa em menos de 4 horas" para turno que começa em 17 min (PRÉ-EXISTENTE, backend)
- Passos: às ~00:03 criar turno de hoje 00:20 e abrir Presença e Pagamento.
- Obtido: botão desabilitado; `sos_call_eligibility` = `{"reason":"not_urgent","eligible":false}`.
- Causa provável (leitura): `jobs.start_date` é gravado 15:00Z (meio-dia BRT) e a RPC compara `start_date`, não `work_start_time` (`20260817001600_sos_discovery.sql` ~357 e ~504).
- Frequência: 1 turno, em várias cargas.

### MÉDIO

- **D-8 · "Cancelar turno" aparece para dono único e falha sempre sem a E5 (REGRESSÃO).** `/company/jobs/<id>`, "Mais opções do turno", ao lado de "Excluir". Confirmar: `404 rpc/cancel_job` e "Não foi possível cancelar o turno agora. Tente de novo em instantes." Sem erro cru e nada muda, mas tentar de novo não resolve. Esperado (R23): ação ausente. Arquivo: `CompanyJobDetails.tsx`; a árvore principal já tem `podeCancelarTurno`/`hasTeamNav`, que a versão servida não tem. Retestar.
- **D-9 · Modal "Convidar pessoa" atrás do menu inferior a 320x568.** `/company/configuracoes/equipe`. Antes de rolar, `elementFromPoint` no centro de "Gerar convite" devolve a `nav`. No scroll máximo o botão fica em 466-514 e a nav começa em 502 (12px cobertos). Ambos `z-50` (design system: modal 70). Provável: `CompanyTeamMembers.tsx` / `ModalShell.tsx`. `RemoveMemberDialog`, `CompanyJobs`, `CompanyCreateJob`, `CompanyTeam`, `CarteiraClientes` também têm `z-50` (não medidos).
- **D-10 · Histórico do freela cortado a 320px.** Meus Turnos, Histórico: card de 16 a 382px em contêiner 16-304; valor e "Concluído" cortados. A 390 cabe. `MyJobs.tsx` (item de grid sem `min-w-0`).
- **D-11 · Estado falso no carregamento.** Dashboard da empresa mostra "0/0/0" e "Nenhum turno encontrado. Criar primeiro turno" antes dos dados. Presença e Pagamento mostra "0 de 1 vaga preenchidas" em turno preenchido. `CompanyDashboard.tsx`, `CompanyJobCandidates.tsx`.

### BAIXO
- **D-12** "0 de 1 vaga preenchidas" (concordância).
- **D-13** "3.7 h de turno" (ponto decimal), Novo turno 00:20-04:00.
- **D-14** Após "Saída OK" o card segue "Em Andamento" e oferece "Pedir confirmação". Turno só contratado, 18h antes, conta como "Em andamento 1" no Dashboard e detalhe.
- **D-15** Chat: com Realtime fora, o remetente continua vendo "Nenhuma mensagem ainda" (POST 201; freela recebeu 1 não lida). `CompanyMessages.handleSendMessage` não acrescenta localmente. Só visto com WebSocket bloqueado pelo ambiente.
- **D-16** 320px: modal de convite do freela com 4px de rolagem horizontal; itens do menu inferior com 38-41px de largura (altura 64); filtros de Meus Turnos da empresa passam da largura (332/451px; rolagem não medida); abas do freela rolam sem indicador.
- **D-17** "Confirmar Registro" desabilitado com valor -5 sem mensagem visível.
- **D-18** Organização mostra "2 Turnos abertos" com um dos dois finalizado.
- **D-19** CPF sem máscara no termo. A tela de erro do convite de equipe culpa a conexão ("Verifique sua conexão") num 404 de RPC.
- **D-20** Sidebar a 1366x800: "Perfil Empresa" abaixo da dobra (a nav rola sem indicação).

---

## BLOQUEADO POR BANCO (não são defeitos; degradação observada)

| Fluxo | Chamada | O que o usuário vê |
|---|---|---|
| Equipe: listar | `list_company_members` 404 | "Não foi possível carregar a equipe." + "Tentar de novo" (ok) |
| Equipe: gerar convite (duplo clique) | falha | "Não foi possível criar o convite. Tente novamente." (ok) |
| `/company/hoje` | `list_jobs_by_responsible` 404 | "Não foi possível carregar os turnos." + "Tentar de novo" + "Ver o painel da empresa" (ok) |
| `/convite-equipe/:token` (sem e com sessão) | `get_member_invite_preview` 404 | "Não foi possível abrir o convite" (ver D-19 e D-3) |
| Selo "ocupado" | `get_busy_workers` 404 | sem selo, chamado normal; conflito não testável |
| Cancelar turno | `cancel_job` 404 | ver D-8 |
| Aviso de vínculo | `my_link_risk_config(uuid)` 404 | NÃO degrada bem: D-1 |
| `/company/trilha` | sem erro de rede observado | 404 "Página não encontrada" |
| Passar para, Cobrir, etiquetas, aceite OTP, confirmação, remoção | E2-E5 | não alcançáveis |

---

## Cobertura
- Login dos dois papéis.
- Empresa: Dashboard; 2 turnos criados (duplo clique no 1º = 1 POST); editar local (persistiu); Meus Turnos; detalhe; Presença e Pagamento; convite individual (duplo clique = 1 `shift_calls`); Chamado de Turno (duplo clique = 1 chamado); confirmar chegada (Enter no botão dentro do card sem efeito colateral) e saída; Registrar Pagamento (-5 bloqueado; 1ª tentativa caiu com `ERR_CONNECTION_CLOSED`, o código emite toast "Erro ao verificar o turno.", que não capturei; 2ª com duplo clique = 1 `shift_payments`); recibo; Elenco, Pagamentos, Operação, Indicações, Organização, Notificações (carga); Perfil; Equipe; Mensagens (envio).
- Freela: Dashboard; aceite (duplo clique no 1º = 1 `claim_shift_slot`); Meus Turnos; check-in; check-out; notificação de pagamento; recibo + termo + confirmar (duplo clique = 1 aceite e 1 PATCH); Recebimentos, Empresas, Perfil, Mensagens (carga).
- Isolamento: freela em `/company/jobs/<id>/candidates`, `/company/hoje`, `/company/configuracoes/equipe` vai a `/dashboard`. Empresa em `/my-jobs` e `/recebimentos` vai a `/company/dashboard`.
- Viewports: 1366x800; 390x844; 320x568 (convite de turno, Histórico, Registrar Pagamento ok, Presença, Dashboard, Meus Turnos, Equipe).

## NÃO TESTADO (e por quê)
- Equipe ponta a ponta, encarregado, FREELA2, Hoje com dados, Passar para, Cobrir, etiquetas, conflito de horário: faltam E2-E5. Não loguei encarregado/freela2; sem OTP.
- `/regulamento-trilha`, trilha de bônus, `/admin`: não abertos.
- Avaliação mútua (modal abriu para o freela, não enviei); agendar e estornar pagamento.
- Excluir, Pausar, dispensar freela, cancelar convite, cancelar chamado, cancelamento pelo freela.
- Listas do elenco, adicionar freela, copiar link, `/convite/:token`, SOS efetivo, séries, QR, WhatsApp, `/empresa/:id`, `/indicacoes` do freela.
- Offline real, Realtime e push (bloqueio de rede do MCP).
- 360x740, 844x390, PWA; várias telas a 320 (perfil, recibo do freela, mensagens, chamado com lista).
- Intruso via PostgREST com dados de outra empresa (produção).

## Suspeitas (não confirmadas)
- Em `/convite-equipe/<token>` com sessão, em 2 cargas seguidas as chamadas de auth falharam com `AbortError: signal is aborted without reason` sem sair requisição (inclusive após "Tentar de novo"); na 3ª e na sessão anônima funcionou. Parece timeout do lock de auth.
- Após concluir B, o freela passou de "R$ 400,00 / 2 turnos / Nível 3" para "R$ 120,00 / 1 turno / Nível 2". Provável agregado velho de turnos de teste apagados, recalculado agora (a empresa tinha 0 turnos no início). Conferir se apagar turno deveria recalcular.
- Operação: "R$ 4.495,18/h" com turno de 2 minutos.
- Cerca de 10 a 20 chamadas a `/auth/v1/user` por tela.

## Sinais de saúde
Sem duplicação em criar turno, convite, chamado, aceite, pagamento e confirmação do recibo. Termo sem placeholder (CNPJ ausente aparece como "não informado"). A notificação de pagamento leva ao recibo certo e o aceite exige abrir o termo e marcar a caixa. Isolamento de rota por papel. Telas novas sem RPC mostram erro em português, sem loading eterno.

## DADOS DE TESTE CRIADOS/ALTERADOS EM PRODUÇÃO (para limpeza)
Empresa "Restaurante E2E" (`e2e-empresa@worki.test`) e freela "Worker E2E" (`e2e-worker@worki.test`):
1. Turno `ZZ-TESTE rodada1 A`, `5a970bea-b198-4c05-8a85-9a48d04efe50`, 25/11 18:00-22:00, R$ 150: aberto, freela CONTRATADO; local editado para "Rua de Teste, 200".
2. Turno `ZZ-TESTE rodada1 B-checkin`, `84e9f313-1117-4cad-8468-6e7e8b5f8e55`, 25/11 00:20-04:00, R$ 120: candidatura `ba80d5da-95ea-4daf-9402-d339197c2f53` concluída, com check-in/out.
3. `shift_payments` `e48636b3-9982-4e91-8c6d-5251bbced1d9` (PIX, R$ 120, `recorded`, recebimento confirmado) + `service_terms` aceito. Só registro, sem dinheiro movido; há travas de imutabilidade.
4. 2 chamados (`shift_calls` + `shift_call_targets`, um por turno), as `applications` dos aceites e as notificações dos dois lados (algumas foram marcadas como lidas).
5. 1 mensagem no chat do turno A, começando com `ZZ-TESTE mensagem rodada1`.
6. Perfil da empresa: limite do aviso de 2 para 1 e RESTAURADO para 2.
7. Agregados do Worker E2E recalculados pelo sistema.
8. Nenhum convite de equipe criado. Nenhum terceiro contatado. O formulário de onboarding NÃO foi enviado.
- Arquivo local que criei sem querer no repositório: `.harness\spec\equipe-encarregados\_snap.txt` (snapshot com dados de teste). Apagar.
- Navegadores: continuam logados; simulações de rede e viewport removidas; `pending_team_invite_token` limpo.

## Matriz de cobertura
Não li nem atualizei `COBERTURA-CLIQUE-A-CLIQUE.md`; o mapeamento das linhas fica com o orquestrador.
