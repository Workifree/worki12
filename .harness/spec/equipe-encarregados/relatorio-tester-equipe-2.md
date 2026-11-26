# Relatório do tester: rodada de equipe 2 (RETESTE) — FINAL

**Veredito: PARCIAL.** D-1 a D-6 corrigidos; menu, links e offline passaram. Há um defeito novo ALTO (E-1, chat) a resolver antes de liberar o Encarregado.

Ambiente: http://localhost:5173 (Vite dev, commit d3edc83c informado; sem hash de bundle), 25/11/2026 ~13:50 a 14:45 BRT. Banco de produção, só contas e2e/qa. Gestor no 9222; encarregado (contexto "enc") e freela no 9223 até ele cair (ECONNREFUSED, depois do D-1); depois o freela foi para um contexto isolado no 9222 (login por senha de teste).
Notas de automação: no 9223 emulado o clique por uid caía em coordenada x1,25 (botão em 275,474; evento em 344,593), então usei click() no DOM; várias navegações foram por pushState+popstate ou iframe. Offline do MCP indisponível no 9222: offline SIMULADO (fetch para supabase.co rejeitado, navigator.onLine=false). WebSocket ERR_INTERNET_DISCONNECTED no console é do ambiente; realtime não testado. A aba do Gestor tinha chaves antigas zzT1/zzTC no sessionStorage e mudou de rota 2 vezes sem comando meu (em 20 s de observação não repetiu): possível uso paralelo da janela.

## Reteste
| Item | Resultado |
|---|---|
| D-1 | CORRIGIDO. Gestor, turno "sos" com convite pendente > Mais opções > Excluir: rpc/cancel_job 200, chamados cancelled, job deleted; não aparece no /my-jobs do freela |
| D-2 (390px) | CORRIGIDO. Cai em "Seu acesso está quase pronto" da empresa certa; "Trocar de unidade" 307x44; persiste no reload |
| D-3 | CORRIGIDO. Criar turno sem quebra; Chamar Freelas, Convidar Freela do Elenco e Convidar para turno mostram o nome |
| D-4 | CORRIGIDO. Turnos, "turno anterior", Visão geral e Hoje só próprios; reg-A em /jobs/:id, /candidates, /edit = "Este turno é de outra pessoa da equipe" |
| D-5 | CORRIGIDO. relatorio, operacao, indicacoes, organization, configuracoes/equipe = "Você não tem acesso a esta tela" em carga completa (equipe também em SPA, sem quebrar as rotas seguintes). /company/profile vai para a Visão geral |
| D-6 | CORRIGIDO. Nome do freela aparece; sem nível ou nota inventados |

Também PASS: aceite com sessão por senha; nome errado recusado na confirmação; botão desabilitado sem Termos; no turno enc-3 do encarregado: convite, aceite, check-in, confirmar chegada, check-out, confirmar saída, pagamento Dinheiro R$80 (recorded), recibo do freela (PIX não aparece porque o freela de teste não tem chave); Elenco restrito (só Adicionar Freela, Copiar link, Convidar para turno, que lista só turno próprio); cancelar chamado; menu do encarregado 1366 e 320 sem Relatórios; Gestão só com Ajuda e Sair.

Menu (spec navegacao): PASS. Gestor 1366: item ativo nas sub-rotas, abas Hoje/Visão geral, Elenco/Indicações, Pagamentos/Operação, "Gestão" de volta, /notifications sem marcação; 390 e 320: 5 itens, FAB 144x48 sem cobrir o fim da lista, abas 44px, Relatórios e Sair em Gestão, sem rolagem horizontal. Freela 390/320/1366: 5 itens, "Turnos"/"Empresas", abas, avatar "Meu perfil" 44x44 ativo, rodapé "Ver meu perfil".

Links: PASS. Aviso "Nova mensagem" abre /company/messages?conversation=...; link do Elenco copiado, deslogado vai ao /login?redirect=/convite/... e volta ao convite após login; logado como freela abre "Convite Aceito!" (já era do elenco); ?redirect=//example.com no login ficou no app; /\example.com já logado também ficou.

Offline (simulado): PASS. Freela e empresa, a frio: "Não conseguimos carregar" + "Tentar de novo", sem login/onboarding, recupera. No meio da sessão a rota se mantém; a faixa empurra o cabeçalho (sino e avatar livres a 320; as "coberturas" medidas em /my-jobs eram o modal Avaliar Empresa).

## Defeitos novos

### E-1 ALTO: encarregado vê o botão de chat e ele falha
- Oráculo: regra do projeto (spec equipe: chat fora do v1 para o Encarregado; "some da tela").
- Passos: encarregado confirmado, 390x844 > /company/jobs/<enc-3>/candidates > ícone "Abrir chat com freela".
- Esperado: sem botão (ou o chat funciona). Obtido: GET Conversation 200, POST rest/v1/Conversation 403, fica na mesma tela; console "CompanyJobCandidates [object Object]" (o código dá o toast "Erro ao iniciar conversa.", não capturado na minha leitura tardia). 2/2.
- "Mensagens" segue no menu e mostra "FREELAS (0)". A spec de navegação lista Mensagens para o encarregado e a de equipe exclui o chat: decidir qual vale.
- Suspeita: CompanyJobCandidates.tsx, handleChat (~l.1007) e botão (~l.1506).

### E-2 MÉDIO: depois de "Convidar Freela do Elenco", a tela não mostra o convite
- Oráculo: expectativa do usuário e inconsistência (após recarregar aparece "Chamado aberto").
- Passos: /candidates de turno sem freela > Convidar Freela do Elenco > Convidar.
- Obtido: modal fecha, shift_call criado, tela segue "Nenhum freela atrelado a este turno" sem o painel do chamado após 6 a 9 s; não capturei toast. Encarregado (enc-1) e Gestor (sos), 2/2. O card em /company/jobs já mostra "Aguardando resposta".
- Suspeita: CompanyJobCandidates.tsx não recarrega os chamados após o convite do picker.

## Suspeitas
- Aba do Gestor presa em "Sem conexão ou não foi possível verificar seu acesso" com rede normal, 2 episódios: console "ProtectedRoute.session AbortError: signal is aborted without reason"; getSession lançava em 1 ms; "Tentar de novo" não recuperou (nem 1 reload no 2º episódio). Recuperou depois (nova carga/reload, com refresh do token 200). Token estava por vencer no 1º e vencido no 2º. Pode ser trava do auth-js no navegador automatizado, mas se ocorrer em usuário real é ALTO (lib/authSession.ts, ProtectedRoute.tsx). Mesma assinatura da suspeita da rodada 1.
- Modal pós-criação: dois click() no mesmo tick em "Convidar" geraram 2 shift_calls (o freela viu 2 convites iguais). dblClick real (Gestor, outro modal) e 90 ms entre cliques geraram 1. Não reproduzido com clique humano.
- Visão geral offline mostra seções sem dados e "Bem-vindo de volta, Empresa" (texto não lido por inteiro).
- Encarregado em turno não urgente lê "Você não pode abrir um SOS para este turno." (para o Gestor há motivo específico).

## Não testado
OTP e conta nova por OTP; "Não é essa pessoa"; Cobrir (exige 2+ encarregados; o botão não apareceu para o único); Passar para (testado na rodada 1); pagamento com PIX e agendar/estornar; offline real de rede/PWA/service worker; realtime; viewports 360 e 844x390; link do Elenco com conta sem vínculo (não criei conta); docs de usuário e contato (worki.com.br) do acréscimo da spec; "Unidades"/Trilha além do carregamento (trilha dá erro: rpc bonus_get_my_trail 404). Matriz COBERTURA-CLIQUE-A-CLIQUE não lida nem editada.

## Dados de teste deixados (Restaurante E2E)
ZZ-TESTE equipe2 enc-3 (25/11, concluído, pagamento em dinheiro R$80 registrado, recibo NÃO confirmado pelo freela; 2 chamados encerrados); enc-1 recebeu 1 chamado, cancelado (segue aberto, sem freela, responsible_id da ex-encarregada); "ZZ-TESTE equipe sos" EXCLUÍDO nesta rodada; etiqueta "ZZ-TESTE Evento" ativa. Nenhum SOS ou e-mail disparado; mensagem de chat não enviada. Aviso "Gere um novo link do Elenco" pendente (não gerei).

## Encarregado de teste
REMOVIDO pela UI (company_members: removed; get_my_companies do Gestor team_enabled=false). Sem convite pendente. A sessão do encarregado e a do freela no 9223 ficam por conta do Chrome que caiu: rodar scripts/chrome-teste.sh e conferir o login do 9223.
