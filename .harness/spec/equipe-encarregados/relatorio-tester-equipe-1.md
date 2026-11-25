# Relatório do tester: rodada de equipe 1 (banco completo) — FINAL

**Veredito: FAIL.** Não liberar o papel Encarregado: D-3 e D-4. As travas novas em applications não quebraram nenhum fluxo legítimo exercitado.

Ambiente: http://localhost:5173 (Vite dev, commit 5aebd223 informado; dev server, sem hash de bundle), 25/11/2026 ~12:27 a 13:27 BRT. Chrome 9222 Gestor (1366x800), 9223 freela (390x844 emulado) + contexto isolado "enc" no 9223 para o encarregado. Banco de produção, só contas e2e/qa. Parte das interações foi por script no DOM (a automação por uid falhava às vezes). Erros de WebSocket ERR_INTERNET_DISCONNECTED (ws do Vite e realtime) e 404 de rpc/bonus_get_my_trail são ambiente/trilha não aplicada. Realtime NÃO testado.

## Resumo por bloco
| Bloco | Status |
|---|---|
| 1 Regressão com travas | PASS (nenhum 42501 nem applications_*_guard); D-1 MÉDIO no Excluir |
| 2 Convite, aceite, confirmação | PASS no fluxo, com D-2 ALTO |
| 3 Escopo do encarregado | FAIL (D-3, D-4, D-5, D-6); escrita no servidor PASS |
| 4 Remover encarregado | PASS no servidor, observação B-1 |
| 5 SOS | PASS parcial (elegibilidade e botão); nada disparado |

## Bloco 1
- reg-A (hoje): criar (duplo clique = 1 turno), convite individual, claim_shift_slot = claimed, check-in, confirmar chegada, check-out, confirmar saída, registrar pagamento (duplo clique = 1 POST shift_payments 201), recibo, termo, confirmar recebimento: OK. (PATCH shift_payments 400 P0001 "worker_confirmed_at nao pode ser alterado apos a confirmacao" veio de duplo click() sintético meu: guarda funcionou.)
- reg-B: recusa em 2 toques, 2º em até 4 s (decline_shift_call 200): OK.
- reg-C: Chamado de Turno, selo "Já está em outro turno nesse horário" (conflito real, sem detalhe), aceite, Dispensar (freela notificado): OK.
- reg-D: aceite + Excluir pela empresa (freela notificado): OK. reg-F: aceite + freela cancela (PATCH applications 200, empresa notificada): OK.
- sos: Cancelar chamado pendente ("Chamado cancelado.", cancel_shift_call 200, alvo "closed", convite some para o freela): OK.
- Cancelar turno pago (reg-A) na Hoje: recusado, "Esse turno tem pagamento agendado ou registrado. Estorne o pagamento registrado antes de cancelar o turno." + "Nada foi alterado": OK.

## Bloco 2
- Convite "ZZ Ana Encarregada": token 64 chars, duplo clique = 1 invite_company_member; wa.me sem número, texto com empresa, papel, link e "não repasse".
- Prévia sem sessão: só empresa e papel; e-mail vazio mostra "Digite um e-mail válido.". Nenhum OTP enviado. Link já usado e token aleatório: get_member_invite_preview = not_found.
- Freela logado abrindo o link: "Este e-mail é de uma conta de freela".
- Com sessão por senha o link oferece "Entrar na equipe" sem OTP: NÃO bloqueado. Quem não tem senha depende do OTP (não testável sem SMTP: BLOQUEADO).
- Não confirmado: /company/* testadas = "Seu acesso está quase pronto"; 320px sem rolagem horizontal, botões 48px. REST: team_connections, applications, shift_payments da empresa = 0 linhas; invite (invalid_input), remove e tag negados; insert de job 403; auto-confirmar 0 linhas; get_busy_workers 403.
- Gestor: "Precisa da sua confirmação" com e-mail; diálogo exige digitar o nome (testei só o certo); confirm_company_member 200; notificação "Nova pessoa na equipe" com e-mail mascarado. Encarregado entra em /company/hoje com menu Hoje, Criar, Turnos, Mensagens, Perfil.

## Defeitos

### D-3 CRÍTICO (papel inutilizável): encarregado não consegue escalar freela, a tela quebra
- Oráculo: regra do projeto (spec equipe, R10).
- Passos A: encarregado confirmado, 390x844 > /company/create > "ZZ-TESTE equipe enc-1" (27/11 12:40-17:00, R$90) > Criar turno. Obtido: POST rest/v1/jobs 201 e depois "Algo deu errado". Console: "TypeError: Cannot read properties of null (reading 'avatar_url') ... in <CompanyCreateJob>". O turno FOI criado (repetir duplica).
- Passos B: Hoje > Abrir turno > Chamar Freelas. Obtido: "Algo deu errado"; "TypeError: Cannot read properties of null (reading 'id') ... in <ShiftCallModal>".
- Frequência: A 2/2; B 1/1.
- Causa verificada: select team_connections com embed worker:workers(...) devolve worker:null para o encarregado (RLS); rpc list_team_connection_cards devolve os nomes. Prováveis: serviço de listagem do Elenco usado por components/team/ShiftCallModal.tsx:138 e pages/company/CompanyCreateJob.tsx:996. "Convidar Freela do Elenco" (CompanyJobCandidates.tsx:1857) usa o mesmo dado: não acionado como encarregado.

### D-4 CRÍTICO (critério C5 do plano): encarregado vê turnos e valores do Gestor
- Oráculo: spec A2, A3, A4, R6.
- Passos: encarregado confirmado > Turnos (/company/jobs, carga completa).
- Obtido: TODOS os turnos da empresa, cada um "Sem freela" + "Convidar freela" + "Mais opções", inclusive pagos/contratados (informação FALSA: candidaturas ocultas por RLS). /company/create "Comece de um turno anterior" lista turnos do Gestor com "R$ 100". /company/jobs/<reg-A> mostra valor, local, horário; /candidates mostra "0 de 1 vaga preenchida", "Chamar Freelas", "Convidar Freela do Elenco".
- /company/relatorio (carga completa, unidade Restaurante E2E) renderiza para o encarregado: "Ordens 5, Abertas 5, Valor Previsto R$ 570,00", linhas R$ 120/100/150/100/100 que coincidem com valores de turnos do Gestor (correspondência inferida pelos valores). /company/operacao também renderizou (só via navegação SPA).
- Servidor protege candidaturas e escrita: applications/shift_payments/shift_calls/targets = 0 linhas; PATCH title/status/responsible_id em reg-B = 0 linhas; cancel_job forbidden; get_shift_worker_payment_card(turno do Gestor) forbidden; POST jobs com responsible_id alheio 403. A linha de jobs é legível por SELECT amplo.
- Prováveis: CompanyJobs.tsx, CompanyCreateJob.tsx, CompanyJobDetails.tsx, CompanyJobCandidates.tsx e relatório filtram só por company_id; usar list_jobs_by_responsible (como a Hoje) e guarda de papel nas rotas.

### D-6 ALTO: no próprio turno o encarregado não vê quem é o freela contratado
- Passos: turno enc-2 do encarregado; Gestor convida; freela aceita; encarregado: Hoje > Abrir turno.
- Obtido: "Freela · Aceitou", cartão "? / Usuário Worki / Lvl 1 / Sem avaliações ainda". Para o Gestor o mesmo freela é "Worker E2E", Lvl 4, 5.0 (1 avaliação): nome oculto e nível/nota falsos.
- Mesma causa de D-3. get_shift_worker_payment_card(p_job_id) existe no banco e não tem chamada em frontend/src (suspeita: sem PIX para pagar; modal de pagamento não testado).

### D-2 ALTO: quem já tem empresa própria aceita o convite e cai na empresa errada; no celular não troca
- Passos: conta dona de outra empresa, 390x844 > abrir o link > marcar Termos > Entrar na equipe.
- Obtido: /company/hoje da PRÓPRIA empresa ("Nenhum turno nos próximos 14 dias"), nada sobre o convite. get_my_companies = [própria owner; Restaurante E2E encarregado confirmed=false]. "Trocar de unidade" só no Sidebar (a 390px o select tem largura 0). No desktop, após trocar, a espera só tem Atualizar/Sair.
- Prováveis: AcceptTeamInvite.tsx finish() não chama setSelectedCompanyId; pickPrimaryCompany prefere owner; falta seletor mobile.

### D-5 ALTO: rota de Gestor por URL quebra em vez de negar
- /company/team como encarregado (navegação SPA, 1/1, não repetido com recarga): "TypeError: Cannot read properties of null (reading 'id') ... in <CompanyTeam>"; as rotas seguintes no mesmo SPA ficaram no "Algo deu errado" até recarregar. Esperado: negar/redirecionar.

### D-1 MÉDIO: Excluir turno com convite pendente deixa convite vivo
- Passos: Gestor cria reg-E > Convidar > /company/jobs > Mais opções > Excluir > Excluir ("Turno excluído com sucesso.") > freela abre /my-jobs.
- Obtido: takeover do turno excluído com Aceitar/Recusar e "Expira em 2 dias", sem aviso. Só ao Aceitar: rpc/claim_shift_slot 200 {"outcome":"cancelled"}, "A empresa encerrou este chamado.".
- Origem: CompanyJobs.tsx handleDelete cancela só hired/in_progress, chama refund_escrow (400 P0001 "No reserved escrow found for job") e faz PATCH jobs status=deleted; não usa cancel_job. Padrão parecido em CompanyJobDetails.tsx ~158.

### BAIXO
- Convite individual expira em 48h mesmo com turno em 2h (sos: entrada 25/11 15:16, expires_at 27/11 13:19); a tela mostra só "expira 13:19", sem a data (parece já vencido).
- Freela: convite pendente e "Avaliar Empresa" empilhados (z75 sobre z70); "Avaliar Empresa" reabre a cada carga de /my-jobs.
- /candidates?chamar=1 fica na URL; recarregar reabre o modal com a vaga preenchida.
- Passar para: "Gestor será notificada"; após "Nenhum turno foi passado" a lista atrás não se atualiza.

## Bloco 3: o que passou
- Hoje do encarregado: só turnos próprios, "Responsável: Você".
- get_busy_workers: só [{worker_id}]; freela de fora do Elenco ausente. (Selo na UI do encarregado não verificável por causa de D-3.)
- Passar para: Gestor passou reg-B para Ana; corrida (Gestor retomou com o modal da Ana aberto) = "Nenhum turno foi passado. Eles já podem estar com essa pessoa, ou você não pode passá-los.".
- Cancelar turno pelo encarregado (enc-2, 1 contratado, duplo clique): "Turno cancelado. 1 pessoa foi avisada."; freela e Gestor notificados ("foi cancelado por ZZ Ana Encarregada"); 2 POST cancel_job 200, uma notificação vista de cada lado.
- Etiquetas: criar "ZZ-TESTE Evento" (duplo clique = 1 RPC), aparece no filtro da Hoje e em Criar turno; filtros por etiqueta (vazio correto) e pessoa OK. Não atribuí etiqueta a turno.

## Bloco 4
- Remover: "O acesso é cortado agora. 1 turno aberto no nome dessa pessoa ficará com você." > Remover agora (200) > toast + pedido de novo link do Elenco (não gerei).
- Sessão do encarregado sem recarregar: team_connections [], applications [], PATCH enc-1 0 linhas, cancel_job forbidden, get_busy_workers 403. A tela antiga exibia o card até a próxima ação; "Abrir turno" levou a /company/jobs.
- Gestor: membership removed; ids/status do Elenco idênticos; enc-1 continua open com responsible_id não reescrito.
- B-1 observação: após recarregar, a conta cai silenciosamente na própria empresa, sem "Seu acesso a essa empresa foi encerrado" (tela para quem não tem outra empresa NÃO testada). Era a única pessoa: o Gestor volta ao modo dono único (menu sem Hoje/Equipe; em /company/hoje por URL somem Responsável, filtros, Passar para, Cancelar; sem "criado por ZZ Ana").

## Bloco 5
- sos_call_eligibility: turno > 4h = not_urgent; já iniciado = job_started; entrada em ~2h = team_not_tried; botão desabilitado "Chame primeiro o seu Elenco"; com chamado aberto "Ainda há um chamado ao Elenco em aberto". SOS não aberto/disparado (poderia notificar terceiros). Caminho "eligible=true" não testado.

## Suspeitas (não classificadas)
- "AbortError: signal is aborted without reason": após login por senha no contexto enc, spinner > 20 s até recarregar (1/1); uma carga de /candidates do Gestor ficou sem título, sem o painel do chamado e com "Não foi possível verificar se o SOS está disponível agora." (console: CompanyJobCandidates AbortError, shiftCall.listCallsByJob, sosService.checkEligibility); nova carga resolveu após demora (1 de várias).
- Toast "Link copiado." não capturado; checkbox de Termos vazio no "Entrar na equipe" não mostrou mensagem no trecho lido (1 leitura).

## Cobertura
Rotas: /company/create, jobs, jobs/:id, candidates, hoje, configuracoes/equipe, relatorio; /my-jobs, /notifications, /recibo/:jobId, /convite-equipe/:token, /login. Viewports: 1366x800, 390x844, 320x640 (só tela de espera).

## Não testado
OTP e conta nova por OTP; "Não é essa pessoa"; nome errado na confirmação; Cobrir (o Gestor só vê com 2+ encarregados; o encarregado único não mostrou o botão: não é possível afirmar defeito); re-convite C11; convite vencido/revogado/reenviado; encarregado sem empresa própria (inclusive AcessoEncerrado); recusas de cancelamento C9c/d/e/f pela UI; pagamento, chegada e saída operados pelo encarregado; chat do encarregado (item Mensagens aparece no menu, C16f não verificado); INSERT forjado em team_connections; Q6; C14 completo (modais a 320, 360, 844x390); agendar/estornar pagamento; realtime; offline.

## Linhas da matriz COBERTURA-CLIQUE-A-CLIQUE
Matriz não lida nem editada.

## Dados de teste deixados (Restaurante E2E)
reg-A (concluído, registro de pagamento R$100, recibo confirmado), reg-B (aberto, convite recusado, responsável Gestor), reg-C (27/11, freela dispensado), reg-D e reg-E (excluídos), reg-F (30/11, cancelado pelo freela), enc-1 (27/11, aberto, sem freela, responsible_id da ex-encarregada), enc-2 (02/12, cancelado), sos (25/11 15:16, aberto, chamado cancelado), etiqueta "ZZ-TESTE Evento" ativa (a seção some sem equipe). Aviso de rotação do link do Elenco pendente. Todos os títulos começam com "ZZ-TESTE equipe". Conta qa.mobile.empresa segue com a empresa própria intacta (só leitura).

## Encarregado de teste
REMOVIDO pela UI e conferido (company_members = removed; get_my_companies do Gestor team_enabled=false). Nenhum convite de equipe pendente. A sessão da conta de encarregado ficou aberta no contexto isolado do 9223; o freela segue logado e a emulação dele foi limpa.
