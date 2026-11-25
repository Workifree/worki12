# Relatório do tester, rodada 3 (reteste + regressão): Equipe e encarregados

**Veredito: FAIL.** Não há ALTO. Restam 2 MÉDIO: N-4 (novo) e Mensagens da empresa com falha de carregamento.

- Ambiente: http://localhost:5173 (Vite dev; commit 024dd78e informado pelo orquestrador, sem hash de bundle), banco de PRODUÇÃO só com E0 e E1. 25/11/2026, ~01:20 a ~01:35 BRT.
- Empresa 9222 (desktop, 320x568, 390x844); freela 9223 (390x844, 320x568). Falhas e atrasos simulados trocando window.fetch.
- "useNotifications fora do provider": não apareceu (recarga sem cache no início e 1ª carga após novo login).

## Reteste
| Item | Status | Evidência |
|---|---|---|
| D-11 | CORRIGIDO | REST atrasado 1,2 a 3,5 s: "Bem-vindo de volta" sem nome, depois "Restaurante E2E"; contadores só aparecem já com dados. |
| D-13 | CORRIGIDO | "3 h 40 min", "4 h", "4 h 15 min" (cruza a meia-noite), "20 min", "1 h 15 min". Intervalo de almoço não marcado. |
| D-14 | CORRIGIDO no escopo pedido | Turno E: "Em andamento 1" com chegada; após saída confirmada, 0 no Dashboard, filtro de Meus Turnos vazio, sem selo na Presença. Freela: "Você está no turno agora" e "Ao vivo" somem com a saída marcada. Resíduos em B-1. |
| D-16 | CORRIGIDO | 320: freela 44/44/52/73/59/44 x 64; empresa 46/53/44/53/75/45 x 64; sem estouro; nenhum rótulo com reticências (scrollWidth = clientWidth no freela, medido). |
| D-18 | CORRIGIDO | Dashboard 3 ativos, Organização 3, Meus Turnos 3 não finalizados. |
| N-1 | CORRIGIDO | Convite z 75 sobre avaliação z 70, botões tocáveis; 1º Esc fecha só o convite (foco vai a "1 estrela"), 2º fecha a avaliação. |
| N-2 | CORRIGIDO | Aceite pelo aviso, sem recarregar: D-vinculo foi para Agendados 2 e E para Em Andamento 2, com a aba trocando sozinha. |
| N-3 | CORRIGIDO (Enviar), com regressão N-4 | 320 freela: Enviar em x 225-286, inteiro. |
| Mensagens com erro | PERSISTE METADE (empresa) | Freela: "CONVERSAS" sem número + "Tentar de novo". Empresa: M-2. |
| Confirmação ao cancelar chamado | CORRIGIDO | Diálogo "Cancelar este chamado?", foco em "Manter o chamado", Esc mantém. "Sim, cancelar" não foi executado. |
| Duplo clique no chamado | CORRIGIDO | Duplo clique real: 1 POST shift_calls, 1 shift_call_targets, 1 notifications. Os dois .click() no mesmo tick não foram repetidos. |
| D-7 | BLOQUEADO | Depende de migration. |

## Defeitos

### N-4 · MÉDIO · Chat do freela: selo de status cobre o nome da empresa (regressão provável da correção do N-3)
- Oráculo: expectativa do usuário.
- Passos: 1) Freela 390x844. 2) /messages?conversation=9b7ce9e0-09a7-4392-b705-a36d391baa0c.
- Esperado: nome com reticências antes do selo "Em Andamento".
- Obtido: o selo fica por cima do texto; aparece "Restaurante E2" a 390 e "Resta" a 320. Também cobre parte do botão "Ver perfil da empresa" (a 320: botão x 134-261, selo x 175-286; o toque na ponta direita cai no selo). A 390: coluna x 134-233, botão x 134-261.
- Frequência: sempre nesta conversa (2 viewports). Outros status não medidos.
- Origem (confirmada no código): pages/Messages.tsx:484-491, o botão com "truncate" é inline-block e ignora a largura da coluna; falta "block max-w-full".

### M-2 · MÉDIO · Mensagens da empresa: falha ao carregar vira "Nenhuma conversa ainda"
- Oráculo: regra do harness (erro específico, sem estado falso) e inconsistência com a tela do freela.
- Passos: 1) Empresa logada. 2) Fazer o GET /rest/v1/Conversation falhar. 3) Abrir /company/messages.
- Esperado: erro com "Tentar de novo".
- Obtido: "FREELAS (0) Nenhuma conversa ainda. Os freelas aparecem aqui quando você inicia uma conversa a partir de um turno." Console: "SUPABASE ERROR fetching conversations". Sem falha, havia 3 conversas.
- Frequência: 1 de 1. Origem: pages/company/CompanyMessages.tsx:99-101 (só logError e setLoading(false)).

### B-1 · BAIXO · "Em Andamento" que sobrou depois da saída
- Chat dos dois lados: turno C (saída confirmada) continua com selo "Em Andamento" (status in_progress). Presença diz "Saída confirmada".
- Freela, /my-jobs: a aba "Em Andamento 2" ainda lista turnos com saída registrada (MyJobs.tsx:446). O orquestrador só declarou intencional o fim do "no turno agora"; confirmar se a aba também é.

### B-2 · BAIXO · Chat da empresa a 320px corta a borda direita
- Enviar em x 248-309, cartão corta em 304; bolha e selo "Em Andamento" também cortados (screenshot). Contêiner com scrollWidth 324 e clientWidth 285. A 390 cabe. Origem provável: CompanyMessages.tsx:447 sem min-w-0.

### B-3 · BAIXO · /company/relatorio e /company/operacao a 320px
- A aba "OPERAÇÃO" aparece cortada; o main rola 28px na horizontal. Origem não comparada com a main.

### B-4 · BAIXO · Menu lateral durante o carregamento
- Por um instante mostra "Carregando... Não verificado" e depois "Restaurante E2E Verificado".

## Regressão (OK)
- Logout e login dos dois: token removido; /company/dashboard sem sessão vai para "/".
- Freela em /company/dashboard volta para /dashboard; empresa em /dashboard volta para /company/dashboard.
- Criar turno (duplo clique = 1 POST jobs), convite, aceite pelo aviso (duplo clique em D-vinculo = 1 claim_shift_slot na rede).
- Check-in com duplo clique (1 PATCH); confirmar chegada e saída com duplo clique (1 PATCH cada); check-out.
- Registrar pagamento com duplo clique (1 POST shift_payments); recibo; ler termo; aceitar e confirmar (1 accept_service_term); empresa vê a confirmação.
- Mensagem freela para empresa (1 POST, 201), visível na empresa.
- 320px sem rolagem na página: 9 rotas do freela e 11 da empresa (exceção B-3; filtros de /notifications e modelos de /company/create rolam na horizontal; só o primeiro teve overflow-x auto conferido).
- 390px: dashboard, meus turnos, recibo, chat (N-4), perfil.
- Console: WebSocket (ambiente) e rpc bonus_get_my_trail 404 (trilha não aplicada). my_link_risk_config 404 seguido de 200 e get_busy_workers 404 degradam.
- Nota de método: um clique em "Check-out" abaixo da dobra caiu no menu inferior; após rolar, o botão fica livre. Não é defeito.

## Suspeitas
- Perfil da empresa mostra "5.0 · 1 avaliação" no topo e "Ainda sem avaliações" abaixo; get_profile_reviews(company) respondeu 200 com []. Pode ser nota de seed sem linha em reviews; não conferido. 1 observação.

## Não testado
- Equipe E2-E5, encarregado, FREELA2, Hoje, Passar para, Cobrir, conflito de horário, SOS (D-7), trilha, admin.
- Cancelar o chamado até o fim, agendar e estornar pagamento, avaliar, excluir/pausar/dispensar, cancelamento pelo freela, listas, link do elenco, séries, indicações, convite por link.
- 360x740, 844x390, offline real, Realtime, push, PWA.
- Matriz COBERTURA-CLIQUE-A-CLIQUE.md não lida nem alterada.

## Dados de teste criados ou alterados em produção
1. Turno novo "ZZ-TESTE rodada3 E" 4f18e0b5-8f85-4195-875c-ba5b7775a1aa (25/11 01:45-03:00, R$100): convite aceito, presença confirmada, pagamento registrado (marcador PIX, registro 67AE63A8), termo aceito e recebimento confirmado. Criado novo porque nenhum turno existente estava na janela de check-in.
2. "ZZ-TESTE rodada2 D-vinculo": novo chamado, aceito pelo freela de teste (contratado, 27/11).
3. Mensagem "ZZ-TESTE mensagem rodada3" na conversa 9b7ce9e0.
4. Notificações correspondentes; XP e ganhos da conta de teste do freela subiram.
- Nenhum terceiro tocado, nada apagado. As duas janelas ficaram logadas; empresa sem emulação, freela emulando 390x844.
