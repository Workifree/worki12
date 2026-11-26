# Teste pós-reforma (tester) - 25/11/2026, 18:10-18:30 BRT

Veredito: PARCIAL. Nada bloqueante no que foi executado.
App http://localhost:5173 (commit 90a70f94, dev server, não é bundle de produção), backend produção, contas de teste.
Ambiente: websockets (Vite HMR e Supabase Realtime) falharam com ERR_INTERNET_DISCONNECTED; o HMR recarregou o perfil uma vez. Tempo real NÃO verificado (mensagem só apareceu no outro lado após recarregar).

## Blocos
1. Travas: PASS, nenhum 42501 observado.
   Perfil da empresa e logo (storage 200, PATCH 200, persistiu); perfil do freela (PIX, telefone, cidade, sobre, disponibilidade, persistiu) e foto (200);
   remover do elenco e re-entrar por link; criar turno; chamado; aceite; chegada; confirmação; saída; confirmação; registrar PIX (duplo clique: 1 registro);
   "Não recebi" abre o chat com texto e não envia; chat nos dois sentidos; estorno; notificação do estorno leva a /recebimentos e marca lida;
   novo registro em Dinheiro; termo e confirmação; avaliação nos dois sentidos (201; média, XP, nível e contagem recalculados).
2. Consentimento: PASS (logado). Abrir /convite não chama RPC; "Agora não" não entra; só "Entrar no Elenco" chama accept_company_invite_by_token.
3. Check-in: PASS. Hoje: "Registrar chegada" + "Você pode registrar até 26/11 às 00:00."; 27/11: "Chegada liberada a partir de 27/11 às 08:00."
4. Usabilidade: PASS. 320px: 15 rotas da empresa e 11 do freela sem rolagem horizontal; na empresa a varredura não achou controle coberto nem menor que 40px
   (os "cobertos" do freela eram modal de avaliação automático e conteúdo de seção recolhida). Menu "..." do último card inteiro acima da nav; Esc fecha e devolve foco.
   Modal Registrar Pagamento a 360x380: rodapé tocável. Chat a 360x380: campo tocável. Barra Cancelar/Salvar do perfil tocável. Enter em "Convidar para turno" abre o diálogo certo; Esc devolve foco.
5. Encarregado: PASS parcial. Convite (sem e-mail), aceite logado, espera sem acesso, confirmação com nome digitado, tela Hoje; turno do Gestor por URL = "Você não tem acesso";
   recibo alheio = "não encontrado"; relatório, mensagens e equipe negados; Elenco sem PIX/telefone/CPF; remoção cortou o acesso no próximo carregamento.

## Defeitos (todos BAIXO)
D-1 claim_shift_slot chamado 2x no mesmo tick (a.click();a.click() em "Aceitar" no InviteTakeover, por script): 1a resposta "claimed", 2a "filled" para o próprio vencedor;
    toasts "Vaga garantida! Turno confirmado." e "Outro freela aceitou primeiro..." juntos. Esperado already_hired. Origem provável: ordem das checagens na RPC e falta de guarda síncrona em useShiftInvites.respond.
    Toque duplo humano não reproduzido (o botão tem disabled).
D-2 /recibo > "Não recebi / valor errado": texto pré-preenchido em campo de 1 linha; a 390px só se vê o começo antes de enviar. pages/Messages.tsx.
D-3 Estado vazio falso durante o carregamento: chat da empresa "Nenhuma mensagem ainda." e card do Elenco "Nenhum turno ainda com você" (há 5). CompanyMessages.tsx, team/MemberCard.tsx.
D-4 Prévia de conversa antiga (rodada1 A) mostra "&lt;b&gt;x&lt;/b&gt;" literal. Mensagem nova com <i> apareceu correta; provável dado gravado antes.

## Observações (sem classificar como defeito)
- Ao salvar o perfil, "Nível 5" virou "Nível 3" com 475 XP inalterado (recompute_my_aggregates corrigiu valor armazenado); contas reais podem ver o nível cair.
- Meus Turnos abre "Avaliar Empresa" automaticamente a cada visita enquanto houver turno sem avaliação (intencional no código).
- Ex-encarregado que tem empresa própria cai nela sem aviso após a remoção.
- Recibo com intervalo menor que 1 min mostra "Horário não registrado corretamente" (artefato do teste rápido).

## Não testado
Tela "acesso encerrado" (exige ex-membro sem empresa própria; não há conta assim e criar conta é proibido); logout/login após remoção; aceite do encarregado por OTP;
freela "Sair da empresa" (só abri o diálogo e Esc; texto diz irreversível); /convite sem sessão; upload de capa; desktop só nos fluxos da empresa a 1366;
paisagem; rede lenta/offline; Realtime; Passar/Cobrir/cancelar turno; indicações; SOS; Admin; teclado virtual real (só simulado por altura reduzida).

## Dados deixados
Turno "ZZ-TESTE posreforma A" (concluído; 1 pagamento estornado + 1 confirmado Dinheiro R$50; termo aceito), 2 avaliações 5 estrelas, 2 mensagens.
Empresa E2E: logo, setor "Alimentação", descrição ZZ-TESTE. Freela E2E: foto, cidade, telefone fictício, PIX = e-mail de teste, sobre, disponibilidade seg manhã.
Vínculo de elenco removido e recriado por link. Encarregado qa.mobile.empresa convidado, confirmado e removido; o app pede "Gerar novo link do Elenco" (não gerei).
