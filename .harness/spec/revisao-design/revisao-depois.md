# Revisão visual independente: reforma de design (commit 90a70f94)

Revisor que não participou da reforma. Base: galeria "depois" com dados simulados. Não prova RLS, RPC nem comportamento real.

- Depois: `C:\Users\user\AppData\Local\Temp\claude\025b17446c25563b\b93dd2bc-cfe7-4dcf-bef8-f1d6f9728c8b\scratchpad\galeria-depois\`
- Antes: mesma pasta `scratchpad\galeria\`
- Rodadas: completa (397/428), ajustados (91/93) e mais 2/2. Ao fim, 430 cenários sem falha registrada. Requisições externas que saíram: **0**.
- Olhei amostra priorizada em 390 e as telas principais em 320 e 1440. Não abri as cerca de 1.300 fotos.
- Ajustes só em `scripts/galeria-telas`: rótulos e passos novos, 2 cenários (`convite-elenco-previa` e `-previa-contato`), fixture `my_access_state`.
- **Aviso:** um builder editou o app durante a revisão (avisados: `useShiftInvites`, `Messages`, `CompanyMessages`, `MemberCard` e o link "fale com a empresa" do perfil do freela). O `git status` mostra também `MyJobs`, `Dashboard`, `Profile`, `CompanyLayout`, `CompanyTeam`, `RateModal`, entre outros. Essas telas **podem ter sido fotografadas antes ou depois da correção**. Reconferir os itens que as tocam.

## Placar dos ALTOS (47)

| Crítica | Resolvido | Parcial | Não |
|---|---|---|---|
| Empresa (ALTO), 32 | 26 | 5 | 1 |
| Freela (S1), 9 | 6 | 3 | 0 |
| Primeiro acesso (P0), 6 | 4 | 2 | 0 |
| **Total** | **36** | **10** | **1** |

### Empresa

| Item | Status | Nota |
|---|---|---|
| FAB cobre CTA | RESOLVIDO | |
| Menu coberto | RESOLVIDO | |
| Início: dobra só com contadores | RESOLVIDO | |
| Início 320: card perde identidade | RESOLVIDO | |
| Card sem data e hora | RESOLVIDO | |
| Hoje: vazio igual a preenchido | RESOLVIDO | |
| Hoje: "Abrir turno" repetido | PARCIAL | CTA muda por estado, mas há até 3 controles por card e o card segue alto |
| Hoje: subtítulo promete responsável | RESOLVIDO | |
| Pílula "Presença" parece status | RESOLVIDO | |
| Turnos: encerrados no topo | RESOLVIDO | |
| Excluir x Cancelar turno | PARCIAL | Turnos ainda diz "Excluir turno?" para turno com gente; Hoje diz "Cancelar este turno?" |
| Detalhe sem ação principal | PARCIAL | Turno futuro com "Falta 2" destaca "Marcar presença" |
| Convidar perde o contexto | RESOLVIDO | por código |
| Histórico de chamados empurra o trabalho | RESOLVIDO | ver regressão no desktop |
| Card do freela com 5 ações iguais | RESOLVIDO | |
| Stepper em escada | RESOLVIDO | |
| Três "confirmar" | RESOLVIDO | |
| Pagamento: sem PIX e sem dizer quem | RESOLVIDO | na foto sem PIX o valor vem "0"; verificar |
| Presença manual: texto falso | RESOLVIDO | |
| Elenco: jargão no modal | RESOLVIDO | |
| Lixeira colada | RESOLVIDO | |
| Equipe: alerta domina o vazio | RESOLVIDO | |
| Chip em inglês | RESOLVIDO | `statusLabel`, por código |
| Uma conversa por candidatura | PARCIAL | prévia e hora entraram; agrupamento não demonstrado |
| Notificações não orientam | PARCIAL | turno e data entraram; cancelamento e aceite têm o mesmo ícone amarelo |
| **Dados da empresa: Salvar no topo** | **NÃO** | `empresa-perfil-editando__390`; `CompanyProfile.tsx:506-532` |
| Relatório: slug cru | RESOLVIDO | |
| Relatório: card sem turno | RESOLVIDO | |
| Custo por hora absurdo | RESOLVIDO | há piso em `costPerHourOf` |
| Cartões contraditórios | RESOLVIDO | não reproduzi o dado ruim |
| Perfil do freela sem convidar | RESOLVIDO | ver regressão de alinhamento |
| Unidades: e-mail colapsado | RESOLVIDO | |

### Freela

| Item | Status | Nota |
|---|---|---|
| Presença sem caminho | RESOLVIDO | cartão "Hoje" |
| Aba inicial | RESOLVIDO | gerou o problema D3 |
| Sem "Não recebi" | RESOLVIDO | |
| Confirmar recebimento em 5 passos | PARCIAL | pergunta no topo; ainda exige expandir, marcar e tocar, e o botão nasce desabilitado |
| PIX sem alerta no Início | RESOLVIDO | fica abaixo do turno e do pagamento |
| CPF manda para suporte inexistente | RESOLVIDO | em edição pelo builder |
| Convite vira login genérico | PARCIAL | há faixa e cadastro com papel certo; sem nome da empresa; validade do link só após a conta |
| "Voltar" cobre o título em 320 | RESOLVIDO | |
| Ajuda sem canal | PARCIAL | o e-mail só aparece com `VITE_CONTACT_EMAIL` (a galeria injeta um falso; vazio no `.env.example`). Conferir na Vercel. FAQ segue voltado à empresa |

### Primeiro acesso

| Item | Status | Nota |
|---|---|---|
| Elenco aceito sem consentimento | PARCIAL | há prévia com Entrar e Agora não, mas **sem o nome da empresa** ao liberar CPF, nascimento, telefone e PIX. Pede decisão de produto e revisão de segurança |
| Falha vira zero | RESOLVIDO | |
| Valor nulo confirmável | PARCIAL | o recibo bloqueia, mas Início e Recebimentos ainda pedem "Confirmar recebimento", e a dica do botão manda ler o termo |
| Finalizado sem Estornar | RESOLVIDO | |
| Menu coberto | RESOLVIDO | |
| Gerente revogado cai no cadastro | RESOLVIDO | depende da RPC `my_access_state` (migration 20261126000600) aplicada; confirmar antes do deploy |

P1 conferido: "Aguardando" em chamado vencido está **resolvido** ("Não respondeu a tempo", `chamado-sos-chamado-expirado__390`).

## Defeitos e regressões

Severidade: ALTA, MÉDIA, BAIXA. Imagens sem caminho estão na pasta "depois".

| # | Sev. | Defeito | Imagem | Arquivo provável | Correção |
|---|---|---|---|---|---|
| D1 | ALTA, piorou | Convite em 320: o nome da empresa quebra em cerca de 9 linhas de 2 ou 3 letras, e "Recusar" vaza do card. No "antes" o nome já cortava em "M..." e o botão já vazava | `freela-turnos-convites__320` | `pages/MyJobs.tsx:822-875` | A classe `block` anula o `display` do `line-clamp-2`: tirar `block` do nome. Pôr o selo em linha própria (`flex-wrap`). Botões com `min-w-0`, ou empilhados abaixo de 360 |
| D2 | ALTA, nova | Presença em 1440: grade 2/3 + 1/3 com a coluna direita vazia; o histórico foi para o rodapé ou não existe. Antes os cards usavam a largura toda. Título espremido pelos botões | `empresa-presenca-pagamento-turno-futuro__1440` | `CompanyJobCandidates.tsx:1464-1712` | Aplicar a grade só quando a coluna lateral tiver conteúdo e pôr o histórico nela no topo. `min-w-[20rem]` no título |
| D3 | ALTA, nova | Meus Turnos: "Hoje" mais "Confirma 28/11" empurram as abas para cerca de 1.000px em 390 e mais de 1.200 em 320. Convite disputado ("quem aceitar primeiro") fica fora da dobra e tocar numa aba não mostra efeito visível | `freela-turnos-convites__390`, `__320` | `pages/MyJobs.tsx` | Compactar o cartão Hoje; subir o convite disputado; recolher a véspera numa linha |
| D4 | MÉDIA, nova | Perfil do freela (empresa): "Convidar para turno" e "Mensagem" empilhados em degrau, sobre a borda da capa, sem alinhamento comum | `empresa-presenca-pagamento-perfil-do-freela__390` | `WorkerPublicProfile.tsx` | Linha própria abaixo do nome, `grid grid-cols-2` |
| D5 | MÉDIA, nova | "Chamado aberto" em 320: a coluna de texto fica estreita e "4 chamados, 1 aceite, 2 sem responder" quebra em 5 linhas | `empresa-presenca-pagamento-sem-resposta-vespera__320` | `ShiftCallsPanel.tsx:133-170` | `flex-wrap` e botão abaixo no celular |
| D6 | MÉDIA | Modais de confirmação sem padrão: lado a lado com Voltar à esquerda; empilhado com vermelho embaixo (Remover pessoa); empilhado com vermelho em cima (Encerrar chamado, Cancelar agendamento, Remover do Elenco). Este último ainda usa "Cancelar" e ícone centralizado | `empresa-elenco-remover__390`, `equipe-gestor-remover-pessoa__390`, `empresa-turnos-excluir__390` | `components/ui/DialogParts.tsx` e chamadores | Um só `DialogActions`, "Voltar" mais o verbo |
| D7 | MÉDIA | "O pagamento será liberado imediatamente ao profissional", com o pagamento pelo Worki pausado | `empresa-presenca-pagamento-confirmar-entrega-escrow__390` | `CompanyJobCandidates.tsx:1726` e teste | Remover o caminho ou o texto |
| D8 | MÉDIA | Dados da empresa: Salvar e Cancelar antes dos campos (cerca de 3.200px) | `empresa-perfil-editando__390` | `CompanyProfile.tsx` | Usar `ActionBar` |
| D9 | MÉDIA | E-mail da empresa cortado na borda do card | `empresa-perfil-visao__390` | `CompanyProfile.tsx` | `min-w-0` e `break-all` |
| D10 | MÉDIA | Overflow em 320 e 390: citação sem espaços em Indicações estoura 214px (320) e 144px (390) e alarga a barra inferior; modal de certificação +18px; e-mail longo na Equipe +23px | `estresse-longos-indicacoes__320`, `freela-perfil-certificacao-nova__320`, `estresse-longos-equipe__320` | Indicações, `MyCertificationsSection.tsx`, `CompanyTeamMembers.tsx` | `[overflow-wrap:anywhere]` e `min-w-0`; no modal, revisar o cabeçalho com "Cadastrar", que a medição aponta como o elemento que sobra |
| D11 | MÉDIA | "Sim, vou" e "Não vou poder" quebram em 2 e 3 linhas em 320 | `freela-turnos-agendados__320` | `MyJobs.tsx` | Empilhar abaixo de 360, sem ícone |
| D12 | MÉDIA | InviteTakeover em 320 trunca um nome comum ("Momentos Doces...") ao competir com "Ver perfil" | `freela-convite-turno-chamado-disputado__320` | `InviteTakeover.tsx` | "Ver perfil" abaixo do nome |
| D13 | MÉDIA | Notificações: margem lateral dupla (título desalinhado das outras telas), chips em 2 ou 3 linhas, "Marcar todas" solto no centro, ícones iguais | `freela-telas-notificacoes__390`, `__320` | `pages/Notifications.tsx:25-35` | Remover o padding próprio; ícone por tipo |
| D14 | MÉDIA | Trilha parece outro produto: título e valores em fonte pesada, "ENTRAR NA TRILHA" em caixa-alta; PIX no fim de cerca de 3.000px; "ainda não está aberta" com botão ativo. O mesmo peso de fonte aparece em "Passar turno para..." e "Cobrir turnos" | `trilha-ativa__390`, `trilha-aceite-falhou__390`, `equipe-gestor-passar-turnos__390` | Telas da Trilha, `PassJobsModal` | Tipografia e botões do sistema; PIX no card de saldo |
| D15 | MÉDIA | Esqueci e Nova senha usam outra casca: Voltar dentro do card, texto à esquerda, sem sombra, título em Title Case, foco verde | `acesso-esqueci-senha__390`, `acesso-redefinir-senha__390` | páginas de senha | Mesma casca do login |
| D16 | MÉDIA | Papel errado no login: dois botões fortes, "dashboard de freelancer" | `acesso-login-papel-errado__390` | `pages/Login.tsx` | Um primário; "área do freela" |
| D17 | BAIXA | "Encerrados (1)" é texto solto sem seta, com vão; "Anteriores" tem seta e divisor | `empresa-turnos-lista__390` | `CompanyJobs.tsx:672` | Mesmo componente |
| D18 | BAIXA | Modais Registrar e Agendar: o rodapé fixo corta uma frase ao meio sem indicar rolagem ("o turno é marcado como concluído") | `empresa-presenca-pagamento-agendar-pagamento__390` | `CompanyJobCandidates.tsx` | Divisor ou sombra; consequência junto do botão |
| D19 | BAIXA | Detalhe do turno: faixa de fundo entre a `ActionBar` e a navegação na foto de página inteira. Conferir no aparelho | `empresa-turnos-detalhe__390` | `ui/ActionBar.tsx`, `CompanyLayout.tsx` | Revisar o padding inferior |
| D20 | BAIXA | Hoje com equipe: "Todos" e pessoas quebram em 3 ou 4 linhas; "Chamar freelas" quebra em 2; o primeiro turno cai para perto de 650px em 320 | `equipe-gestor-hoje__320` | `CompanyToday.tsx` | Filtros em rolagem horizontal |
| D21 | BAIXA | Abas de Turnos (freela e empresa) cortam "Históri" e "Conclu" sem pista de rolagem | `freela-turnos-agendados__390`, `empresa-turnos-lista__390` | `ui/Tabs.tsx`, `FilterChip` | Esmaecer a borda ou encurtar os rótulos |
| D22 | BAIXA | Landing e Sobre com cabeçalhos e marcas diferentes; "Sem calote, sem sumiço" permanece; letreiro cortado | `publico-escolha-de-papel__390`, `publico-landing-sobre__390` | `LandingPage.tsx:9,112` | Unificar; passar a copy pelo jurídico |
| D23 | BAIXA | Termos: o link de Privacidade quebra em outra linha e parece segundo item | `onboarding-empresa-passo2-vazio__390` | onboardings | Texto corrido |

## Onde ainda parece amador

- **Tudo é caixa.** O Início do freela é uma pilha de sete cartões de mesmo peso. "Minhas Empresas" e "Nível" ocupam um cartão cada para um número.
- **Botão contornado com sombra em excesso.** A ação principal ora é preta ou verde cheia, ora contornada. "Chamar Freelas" muda de estilo entre estados da mesma tela.
- **Capitalização mista:** "Chamar Freelas" e "Chamar freelas", "Adicionar Freela", "Registrar Pagamento", "Editar Perfil".
- **Elenco:** cerca de 190px por pessoa, chave PIX crua em todos (para o dono) e chips repetidos. Sem busca visível com 7 pessoas.
- **Recibo:** mais de 2.100px, duas caixas amarelas jurídicas, IP e user-agent crus. A prévia do termo corta uma linha ao meio.
- **1440:** boa lista de Turnos e tabela do relatório. Já Presença (D2), Notificações e o login com "Voltar" solto no canto parecem inacabados.
- **Admin** segue no visual e no vocabulário antigos (Asaas, Escrow).

## O que melhorou de fato

Turnos e Hoje com estado e ação por card; menu legível; stepper horizontal; erros de carga honestos; "Não recebi"; consentimento antes do aceite; "Pagamento sem valor informado" no recibo; tela de acesso encerrado; login por papel.
