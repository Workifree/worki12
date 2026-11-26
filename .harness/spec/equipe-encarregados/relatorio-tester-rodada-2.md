# Relatório do tester, rodada 2 (reteste): Equipe e encarregados

**Veredito: PARCIAL.** Todos os ALTO retestáveis (D-1 a D-5) e D-6 estão corrigidos. Restam D-13, partes de D-11, D-14 e D-16, e há 3 defeitos que a rodada 1 não registrou.

- Ambiente: http://localhost:5173 (Vite dev, commit 1fb19b20 informado pelo orquestrador; sem hash de bundle), banco de PRODUÇÃO só com E0 e E1.
- 25/11/2026, ~00:54 a ~01:10 BRT. Empresa 9222 (1366x800, 320x568); freela 9223 (390x844, 360x740, 320x568).
- Freela estava deslogado; login feito com a conta de teste (regra do dono para contas de teste).
- WebSocket ERR_INTERNET_DISCONNECTED continua (artefato do ambiente). Falhas de rede simuladas trocando window.fetch.

## Reteste
| ID | Status | Evidência |
|---|---|---|
| D-1 | CORRIGIDO | Turno D, freela com 3 turnos na semana, selecionado. Limite 1 e 2: selo "Já 4x esta semana com você" + "tolera até 1x/2x". Limite 4: sem selo. Rede: my_link_risk_config(uuid) 404, repetição sem parâmetro 200 {"enabled":true,"threshold":4}. Limite restaurado em 2. Lado "aviso desligado" não executado. |
| D-2 | CORRIGIDO | get_my_companies com Failed to fetch: "Não conseguimos carregar" + "Tentar de novo" / "Sair", URL fica em /company/dashboard. "Tentar de novo" recarrega a página. |
| D-3 | CORRIGIDO | Token inválido não vai para o sessionStorage. Com a falha, erro de conexão, também com o token injetado à mão. |
| D-4 | CORRIGIDO | Todo supabase.co bloqueado, navegação por Recebimentos, Turnos, Início, Mensagens, Perfil, Empresas e recibo: nunca /login, token mantido, erro + "Tentar de novo". Recibo recupera. Resíduo: Mensagens mostra "CONVERSAS (0)" junto do erro. |
| D-5 | CORRIGIDO | Após "Convidar" (duplo clique): "Convidado", "Concluir — 1 convite enviado", 1 POST jobs e 1 shift_calls. Meus Turnos: "Aguardando resposta". |
| D-6 | CORRIGIDO | Antes do check-in: "Registrar chegada". |
| D-7 | BLOQUEADO | Depende de migration. |
| D-8 | CORRIGIDO | "Mais opções": Editar, Pausar, Excluir. |
| D-9 | CORRIGIDO | 320x568: z 70; após rolar, "Gerar convite" 478-526 tocável em topo, meio e base. Gerar não foi tocado. Outros modais antes z-50 não medidos. |
| D-10 | CORRIGIDO | 320: nada passa da largura nas 4 abas; Histórico inteiro (screenshot). |
| D-11 | CORRIGIDO PELA METADE | Presença: "Carregando o turno...". Dashboard: "Nenhum turno encontrado" sumiu, mas por um instante aparece "Em andamento 0" (depois 2) e "Bem-vindo de volta, Empresa". |
| D-12 | CORRIGIDO (com ressalva) | Leituras finais e arquivo servido: "0 de 1 vaga preenchida". Uma leitura ~00:59 em ?chamar=1 devolveu "preenchidas"; não explico (pode ter mudado o arquivo servido). |
| D-13 | PERSISTE | Novo turno 01:10-04:50: "3.7 h de turno". CompanyCreateJob.tsx usa total.toFixed(1). |
| D-14 | CORRIGIDO PELA METADE | Após "Saída OK" sumiu "Pedir confirmação" e Meus Turnos mostra "Confirmado". Persiste: Presença com selo "Em Andamento"; Dashboard "Em andamento 2" contando um turno 17h antes ("Aguardando chegada") e o C; freela vê "Você está no turno agora / Em andamento" com saída já confirmada e antes das 01:10. |
| D-15 | CORRIGIDO | Remetente vê a mensagem na hora (Realtime bloqueado), POST 201, freela recebe. |
| D-16 | CORRIGIDO PELA METADE | Modal de convite 320 sem rolagem horizontal; filtros da empresa quebram em 2 linhas; abas do freela em grade 2x2. Persiste: menu inferior Início 38, Perfil 38, Turnos 41 px de largura (altura 64). |
| D-17 | CORRIGIDO | -5: "Informe um valor maior que zero para confirmar o registro." (sem aria-describedby no campo). |
| D-18 | CORRIGIDO | Organização: 3 turnos abertos de 4 (exclui B). Inconsistência: Dashboard diz "Turnos ativos 4" e lista B (pago) como "Ativo". |
| D-19 | CORRIGIDO | CPF do termo formatado; tela do convite de equipe não culpa mais a conexão. |
| D-20 | CORRIGIDO | 1366x800: "Perfil Empresa" termina em 489px, nav sem rolagem. |

## Defeitos não registrados na rodada 1

### N-1 · MÉDIO · "Avaliar Empresa" abre por cima do convite de turno; um Esc fecha os dois
- Oráculo: expectativa do usuário (convite tem prazo); um Esc deve fechar só o modal do topo.
- Pré-condição: freela com turno concluído sem avaliação (B) e convite pendente.
- Passos: 1) Freela 390x844. 2) Abrir /my-jobs. 3) Apertar Esc.
- Esperado: convite na frente; Esc fecha um modal por vez.
- Obtido: 2 diálogos aria-modal; "Avaliar Empresa" z 70 sobre o convite z 60; "Fechar", "Ver perfil", "Aceitar", "Recusar" cobertos (elementFromPoint); foco em "1 estrela". Um Esc deixou 0 diálogos. Fechando pelo X, o convite aparece.
- Frequência: sobreposição em toda carga de /my-jobs observada; Esc 1 de 1.
- Provável (não comparado com a main): RateModal.tsx:57 z-[70], InviteTakeover.tsx:166 z-[60], useModalDismiss sem pilha, abertura automática em MyJobs.tsx.

### N-2 · MÉDIO · Turno aceito pelo aviso de convite não aparece em nenhuma aba até recarregar
- Passos: 1) Empresa convida para turno de hoje. 2) Freela em /my-jobs, fecha a avaliação, toca "Aceitar" no aviso. 3) Aguardar 4s e olhar as abas.
- Esperado: turno em "Em Andamento".
- Obtido: "Nenhum convite pendente"; Em Andamento vazia e sem contador; Agendados continua 1 (outro turno). Após reload, "Em Andamento 1". claim_shift_slot 200, um só.
- Frequência: 1 de 1. Provável: InviteTakeover.tsx não avisa MyJobs.tsx para recarregar (hooks/useShiftInvites.ts).

### N-3 · MÉDIO · Chat do freela a 320px: botão Enviar e selo de status cortados
- Passos: 1) Freela 320x568, Mensagens, abrir conversa.
- Esperado: Enviar inteiro. Obtido: botão em x 286-347; a borda do cartão (overflow hidden) corta em ~304, sobram ~18 de 61px; "Em Andamento" cortado ("Em Andar"). A 360 passa 3px; a 390 cabe. scrollWidth 320 (não há como rolar até ele). Envio por Enter no celular não testado.
- Evidência: screenshot e rects. Provável: pages/Messages.tsx (campo/linha sem min-w-0). Origem provavelmente anterior.

## Suspeitas (não confirmadas)
- Dois .click() no mesmo tick em "Enviar convite" (Chamado) criaram 2 shift_calls, 2 alvos e 2 notificações; o freela viu 2 cartões de convite do mesmo turno. É artificial (a rodada 1, com duplo clique real, criou 1). ShiftCallModal.handleDispatch só se protege por estado; não há trava no servidor para chamado repetido ao mesmo alvo. 1 tentativa.
- "Cancelar" do chamado age na hora, sem diálogo de confirmação (2 de 2). Não conferi se isso é intencional.
- 1ª carga do freela após o login: "Algo deu errado" (useNotifications must be used within a NotificationProvider em InviteTakeover). Reload sem cache resolveu e não voltou. Provável módulo antigo em cache do Vite dev misturado com ?t=.

## Regressão
- Criar turno (duplo clique = 1 POST), convite, aceite (1 claim_shift_slot), check-in (duplo clique = 1 PATCH), confirmar chegada (1 PATCH), check-out, confirmar saída, cancelar chamado (some do freela), recibo B com termo e confirmação, mensagem.
- 320: recibo, perfil, recebimentos e dashboard do freela sem estouro.
- Console: só WebSocket (ambiente). Na empresa, rpc/bonus_get_my_trail 404 com console.error "bonusTrailService.getAccessStatus" (trilha não aplicada, sem quebra de tela vista). get_busy_workers 404 degrada.

## Não testado
- Equipe E2-E5, encarregado, FREELA2, Hoje, Passar para, Cobrir, conflito de horário, SOS (D-7), trilha, admin.
- Novo pagamento, recibo e avaliação do turno C; agendar e estornar.
- Excluir, pausar, dispensar, cancelamento pelo freela, listas do elenco, link do elenco, séries, indicações, perfil público.
- Offline real, Realtime, push, PWA, 844x390; chat da empresa a 320; modais z-50 citados no D-9.
- Matriz COBERTURA-CLIQUE-A-CLIQUE.md não lida nem alterada.

## Dados de teste criados ou alterados em produção
1. Turno "ZZ-TESTE rodada2 C" 28b9dfe5-3fdf-4dc7-b169-eeafe5c2c389 (25/11 01:10-04:50, R$100): chamado aceito, candidatura 725db0a4-23d0-4d70-bf65-2491590c0a7b com check-in/out confirmados; SEM pagamento. Conversa 9b7ce9e0-09a7-4392-b705-a36d391baa0c com 1 mensagem "ZZ-TESTE mensagem rodada2".
2. Turno "ZZ-TESTE rodada2 D-vinculo" 8c065101-958e-4f9d-aaaa-dd261564ccf2 (27/11 10:00-14:00, R$100): aberto; 2 chamados, ambos CANCELADOS.
3. Notificações correspondentes nos dois lados.
4. Limite do aviso: 2 -> 4 -> 1 -> 4 -> 2 (restaurado).
5. Nenhum pagamento, avaliação ou convite de equipe. Nenhum terceiro contatado. Nada apagado.
- Navegadores logados; simulações de rede e viewport removidas; sessionStorage de convite limpo. A janela da empresa foi redimensionada para 1366x800.
