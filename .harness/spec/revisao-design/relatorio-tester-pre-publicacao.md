# Teste pré-publicação — ee45feab em http://localhost:5173 (dev Vite, backend de produção) — 25/11/2026 ~20:50-21:15 BRT

Veredito: PARCIAL. PODE PUBLICAR: sim, com ressalvas (nenhum CRÍTICO/ALTO reproduzido; ver Não testado).

## Defeitos

### D-1 · Quem saiu da empresa recebe prévia com "Entrar no Elenco" e leva erro genérico
- Severidade: MÉDIO. Oráculo: inconsistência interna / expectativa do usuário.
- Onde: /convite/<token do Elenco E2E>, conta qa.mobile.freela, contexto isolado, viewport padrão.
- Passos: 1) abrir o link e tocar "Entrar no Elenco"; 2) /carteira > "Mais opções de Restaurante E2E" > "Sair da empresa" > confirmar; 3) recarregar /carteira (0 empresas); 4) reabrir o link; 5) tocar "Entrar no Elenco".
- Esperado: a prévia já informar que a pessoa saiu e não pode voltar por este link (ou dizer o que fazer).
- Obtido: prévia normal, com "Você pode sair do Elenco quando quiser" e o botão; depois do toque, "Não foi possível concluir / Não é possível concluir este convite agora." ("agora" sugere que é temporário).
- Frequência: 1 de 1 após saída confirmada por recarga. Suspeita: get_invite_preview não considera o bloqueio.
- O veto em si funciona (a empresa deixa de ver o freela). Não há "desbloquear" na interface do freela.

### D-2 · Empresa continua vendo "Avaliar" depois de avaliar
- BAIXO. Inconsistência interna (o freela vê "Avaliado"). /company/jobs/<id>/candidates: Avaliar > 5 > Enviar > recarregar > Avaliar > 5 > Enviar. Obtido: modal reabre, reviews 409, aviso "Você já avaliou este freela para este turno." Sem duplicação.

### D-3 · rpc/bonus_get_my_trail responde 404 na área da empresa
- BAIXO. Percurso das telas da empresa a 320px (função não existe no banco ou não está exposta). Não vi erro na tela de Gestão. A origem exata (qual tela chama) não foi isolada.

## Passou
- Turno ZZ-TESTE pre-pub 2511 (aa98e4e4): criar > Chamado de Turno (carregando, aviso de conflito e de vínculo) > aceite com duplo toque (1 claim_shift_slot, 1 aviso) > chegada > confirmação > saída > confirmação > pagamento com duplo clique (1 POST shift_payments 201) > recibo/termo > confirmar com duplo toque (1 accept_service_term) > avaliação dos dois lados.
- Chat nos dois sentidos, 1 mensagem no duplo clique; "Carregando mensagens..." antes do estado vazio/conteúdo. Chamado de Turno e Elenco mostram carregando.
- "Não recebi / valor errado": texto pronto em campo de várias linhas (115px, inteiro visível a 390px), não envia sozinho.
- Convite do Elenco mostra o NOME da empresa; ao abrir só chama get_invite_preview; entra só no toque (duplo toque = 1 accept). Redirect pós-login volta ao convite (login real com qa.mobile.freela).
- Remover pelo lado da empresa (0 freelas) e voltar pelo link: OK com e2e-worker. Sair pelo lado do freela: OK após recarga.
- Salvar perfil: Nível 4 / 725 XP antes, depois e após recarga. Upload de foto OK (naturalWidth 192).
- Notificações dos dois lados abrem e listam os eventos.
- 320px: freela (dashboard, my-jobs, recebimentos, carteira, chat, recibo, notifications) e empresa (dashboard, jobs, team, create, candidates, chat, relatorio, gestao): scrollWidth=320, nenhum botão/link do main coberto após rolar ao centro. /profile acusou só controles dentro de seção recolhida (provável falso positivo, não verificado aberto). Botão Salvar do perfil livre a 390px.
- Nenhum 42501 observado. 4xx vistos: reviews 409 (esperado) e D-3. A coleta foi por amostragem, não em toda navegação.

## Ambiente
- No início a janela da empresa mostrava "Sem conexão"; normalizou ao redefinir a emulação. Websockets (inclusive ws://localhost) falham nos dois Chromes com ERR_INTERNET_DISCONNECTED: TEMPO REAL NÃO TESTADO; chegadas de mensagem conferidas por recarga.
- Cliques só funcionaram com a janela trazida à frente.

## Suspeitas (não são defeitos)
- Primeira saída da empresa (qa.mobile.freela): aviso "Conexão removida." mas a lista ainda mostrava 1 empresa ~4s depois, e o link aceitou de novo. Não recarreguei antes de reabrir o link. A segunda saída persistiu. 1 de 2.
- Duplo clique em "Enviar mensagem" (empresa, 1366px, janela em segundo plano): a conversa selecionada mudou para outra. 1 de 1, não repetido com duplo clique; clique simples normal.
- Logo após carregar /my-jobs a 390px, um clique automatizado em "Registrar saída" caiu no menu inferior (botão em top=790, sob a nav). Rolando, o botão fica livre; não considerei defeito.

## Não testado
Tempo real/push; chat do gerente/encarregado (mudança de banco de hoje, NÃO coberta); autoria no Elenco (invited_by) por encarregado; trava de pagamento além do duplo clique (estorno, agendamento, 2ª sessão); /company/team/members; indicações; SOS (proibido); séries; 844x390; offline; PWA/bundle de produção (testado dev server); login da empresa (já logada); varredura de console a 390px na empresa.

## Dados deixados
Turno ZZ-TESTE pre-pub 2511 concluído/pago/avaliado; mensagens ZZ-TESTE; e2e-worker com foto trocada (ícone do app) e "Sobre" = "ZZ-TESTE sobre pre-publicacao", de volta ao Elenco; qa.mobile.freela ficou com saída (veto) da empresa E2E, sem volta pelo link.

## Cobertura (linhas da matriz que podem mudar)
Fluxo bilateral convite>recibo, chat, convite de Elenco, perfil do freela, 320px das telas principais.
