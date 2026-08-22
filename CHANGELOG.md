# Changelog — Worki

Todas as mudanças visíveis ao usuário são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/).

---

## [Não lançado]

### Adicionado

#### Analytics de Operação — Painel de Métricas da Empresa (2026-08-21)

**Empresa:**
- **Nova tela "Operação"** (`/company/operacao`): painel de leitura com números que você monta na mão
- **Métrica de destaque:** tempo médio de preenchimento de chamados (quanto leva entre disparar e alguém aceitar)
- **Quatro números principais:**
  - Gasto no período (modo A — pagamento externo registrado)
  - Contratações (freelas que aceitaram)
  - Custo por hora (gasto ÷ horas trabalhadas)
  - Horas realizadas ÷ previstas (percentual de execução)
- **Breakdowns visuais:**
  - Chamados por status (aberto, preenchido, cancelado, expirado)
  - Chamados por motivo (falta, demissão, pico previsto, evento, férias, folga, reforço, outro)
  - Confirmações de véspera (quantos confirmaram/não responderam/disseram que não vão)
- **Tabelas por freela:**
  - Aceitação (quantos chamados aceitou)
  - Presença (quantos registraram check-in)
  - Desempenho (turnos concluídos, horas totais, nota)
  - Ordem alfabética, **não ranking** (sem "melhor freela")
- **Seletor de período:** atalhos (Hoje, Semana, Mês) + datas customizadas
- **Avisos de dados:**
  - Turno sem checkout usa hora estimada (aviso explícito: "X de Y usaram estimativa")
  - Período muito longo trunca números (aviso em destaque, pede redução)
  - Horas inconsistentes são descartadas (aviso em vermelho)
- **Limitação honesta documentada:** gasto contado por data de pagamento, horas por data de turno — deslocamento perto de bordas de período

#### Badges das Empresas — Selos no Perfil do Freela (2026-08-21)

**Freela:**
- **Seção "Já trabalhou com"** no perfil: selos visuais de empresas onde você concluiu turno
- **O que mostra o selo:**
  - Logo/nome da empresa
  - Quantos turnos você fez com ela
  - Nota que ela te deu (ex: "4.8 ★"), ou "Sem avaliação" se nunca avaliou
- **Clicar no selo:** abre perfil público daquela empresa (nome, setor, descrição, endereço, avaliações de outros freelas)
- **Dois controles de visibilidade:**
  1. **Esconder/reexibir selos individuais:** botão de olho em cada selo — reexibir depois é possível (dado não é apagado)
  2. **Chave-mestra:** switch "Não exibir onde já trabalhei" — esconde a seção **inteira** para todas as empresas; você continua vendo tudo em seu perfil
- **Ordem cronológica:** selos mais recentes aparecem primeiro, **não ranking por nota**
- **Quem vê:** só empresas com vínculo ativo (`team_connections.status='accepted'`) e selos que você deixou visíveis; você sempre vê tudo no seu perfil
- **"Sem avaliação" ≠ nota baixa:** é ausência de nota, não prejudica você

**Empresa:**
- **Ver selos ao revisar freela:** no perfil de um freela (rota `/company/worker/:id`), você vê os selos dele — prova social de experiência dele com outras empresas
- **Nunca vê selos ocultos:** se freela escondeu um selo ou ligou a chave-mestra, a seção desaparece de seu lado

#### Aviso de Risco de Vínculo — Alertar sobre Frequência Semanal do Freela (2026-08-18)

**Empresa:**
- **Configuração:** novo campo no perfil da empresa — escolha de 1 a 7 quantas vezes você quer ser avisada ao convidar o mesmo freela na mesma semana (padrão: 2)
- **Aviso na lista:** ao montar um chamado de turno ou convidar para uma série, freelas que já passaram do seu limite aparecem com um **selo de aviso** ao lado do nome
- **Aviso é só informação:** o selo não bloqueia a seleção — você continua podendo convidar; a decisão é sua
- **Contagem só desta empresa:** o limite considera **apenas turnos com você** — o Worki não conta trabalhos que o freela faz para outros negócios
- **Na série inteira:** ao convidar alguém para múltiplas ocorrências, o sistema mostra a contagem projetada para cada semana (carga preexistente + ocorrências novas)

#### Termo de Prestação de Serviço — Aceite Eletrônico do Pagamento (2026-08-18)

**Freela:**
- **Novo na confirmação de recebimento:** ao receber um pagamento registrado, o app gera um termo declaratório (modelo sugerido pelo Worki, com os dados do turno)
- **Ler e concordar:** antes de confirmar que recebeu, você **deve** ler o termo inteiro e marcar a caixa "Li e concordo com os termos acima"
- **Um gesto:** a confirmação de recebimento e o aceite do termo acontecem no mesmo clique — não há caminho para confirmar sem aceitar o termo
- **Termo congelado:** uma vez aceito, o termo fica congelado com a data e a hora — se os dados da empresa ou do turno mudarem depois, o documento que você assinou permanece intacto
- **Se o CPF está faltando:** o aceite será bloqueado com a mensagem "Seu cadastro está sem um CPF válido" — neste caso, fale com a empresa ou com o suporte do Worki para regularizar

**Empresa:**
- **Recibo do pagamento:** quando você registra um pagamento, o termo é gerado automaticamente e aparece no recibo junto com o comprovante
- **Você vê o status:** o recibo mostra se o freela já aceitou o termo ou se ainda está pendente

**Nota importante:** o Worki apenas registra o aceite entre as partes — o app não valida, não garante e não é parte deste termo. A responsabilidade tributária (recolhimento de impostos) é da pessoa que recebeu o pagamento, conforme declarado no próprio termo.

#### Disponibilidade da Semana — Freela Declara Melhor Horário (2026-08-18)

**Freela:**
- **Novo no perfil:** seção "Minha Disponibilidade" onde você marca em quais dias e períodos (manhã, tarde, noite) costuma estar disponível para trabalhar
- **Não é compromisso:** é uma declaração de quando você **costuma** estar livre — não é uma agenda nem um bloqueio; você continua podendo recusar qualquer turno
- **Destaque no chamado:** quando uma empresa dispara um chamado de turno, quem declarou disponibilidade para aquele dia e período aparece **destacado** e no topo da lista
- **Sem punição:** se você não declarou nada, não aparece destacado — mas continua podendo aceitar o turno normalmente
- **Convite para completar:** enquanto você não tiver declarado nada, há um aviso no painel "Meus Turnos" convidando você a informar sua disponibilidade (opcional)

#### Certificações e Capacitações — Registrar Documentos de Qualificação (2026-08-18)

**Freela:**
- **Novo no perfil:** seção "Certificações e Treinamentos" onde você registra:
  - **Certificações externas** (CREF, manipulação de alimentos, cursos técnicos): nome, órgão emissor, número de registro, data de emissão e validade
  - Sem upload de arquivo — o número de registro é o que vale (você o confere na fonte oficial quando precisar)
  - Certificações vencidas continuam aparecendo, marcadas como vencidas (não são apagadas)
- **Conferência pela empresa:** quando uma empresa tem vínculo com você, ela pode **confirmar que viu** o documento original (assinando manualmente o registro digital)
  - Uma vez confirmada, a empresa vê um ícone verde ao lado
  - **Se você alterar o número ou validade** de uma certificação já confirmada, a conferência cai — a empresa terá que conferir de novo (porque ela verificou aquele conteúdo, não a linha do banco)
  - Só a empresa que conferiu pode desfazer a própria conferência

**Empresa:**
- **Ver certificações:** no Elenco ou ao convidar, você consegue ver as certificações de quem tem vínculo com você
- **Marcar como conferida:** depois de ver o documento original (físico ou digital), clique em "Confirmar que vi" — fica registrado quando você conferiu
- **Usar como filtro nos chamados:** ao criar um turno, você pode informar que uma certificação é obrigatória — o app exibe um aviso destacado no chamado, mas **não bloqueia** ninguém (a decisão é sua na hora de convidar)
- **Treinamentos internos:** você também pode registrar treinamentos que você mesma deu ao freela (ex.: "Treinamento de Segurança Alimentar" com data de conclusão)
  - Treinamentos são visíveis só para você e para o próprio freela (não aparecem para outra empresa)
  - Você pode revogar um registro se tiver registrado por engano (aparece um aviso de revogação, não é apagado)

**Não registre aqui:** documentos de saúde (atestado, exame) — as certificações são só para qualificação profissional.

#### Confirmação de Véspera — Validar Presença do Freela um Dia Antes (2026-08-18)

**Freela:**
- **Card de confirmação em "Meus Turnos":** na véspera do turno, aparece um card destacado perguntando "Você vai trabalhar amanhã?"
- **Dois botões, um toque:** "Sim, vou" ou "Não vou poder" — resposta imutável (não pode ser mudada depois)
- **Notificação:** sino avisa que há pedido de confirmação pendente (link direto para `/my-jobs`)
- **Badge de status:** após responder, o card mostra um badge verde (Confirmado) ou âmbar (Avisou que não vai)

**Empresa:**
- **Resumo agregado:** tela "Presença e Pagamento" mostra no topo quantos confirmaram, quantos não responderam, quantos disseram que não vão
- **Badge por freela:** cada linha da lista exibe o status de confirmação (Confirmado / Sem resposta / Avisou que não vai)
- **Botão "Pedir confirmação":** dispara manualmente um pedido de confirmação a qualquer hora (não só na véspera)
  - Máximo 2 pedidos por freela no mesmo turno
  - Cooldown de 6 horas entre pedidos
  - Botão desabilitado com motivo se limite foi atingido ou cooldown em vigor
- **Notificação urgente:** quando freela avisa "não vai poder", empresa recebe alerta imediato e acesso direto à tela de turno
- **"Dispensar e chamar substituto":** novo botão que dispensa o freela **e abre** o Chamado de Turno (F1) para reabrir a vaga na hora (não duplica telas)
- **Bloqueio seguro:** se houver pagamento agendado/registrado para o freela, dispensa é bloqueada — é preciso estornar o pagamento antes

**Aspecto técnico (operação):**
- O pedido automático está planejado para às 18h diariamente, mas depende de configuração de servidor (`pg_cron`) que ainda não está habilitada em produção
- Por enquanto a confirmação funciona **apenas pelo botão manual** "Pedir confirmação" que a empresa controla
- O automático será ativado assim que a infraestrutura for configurada (não necessita mudança no app)

**Integração:**
- Sem mudança de status automática — silêncio ou "não vai poder" são só avisos; a empresa decide manualmente se dispensa ou toma ação
- `applications.status` continua intacto; mudanças passam pelos fluxos já existentes (`dismissFromShift`, check-in/checkout)
- Resposta da confirmação fica no histórico (dados para análise futura de confiabilidade do freela)

#### Escala Recorrente — Turnos que Se Repetem (2026-08-17)

**Empresa:**
- **Criar série recorrente:** ao invés de cadastrar turnos um por um, crie uma série que gera múltiplos turnos automaticamente
- **Dois tipos de repetição:** (1) **Toda semana** — escolha os dias que se repetem (seg, ter, etc.); (2) **Cobrir um período** — um turno por dia corrido (ideal para férias/eventos)
- **Data final obrigatória:** toda série tem um fim — nada de recorrência infinita
- **Máximo 60 turnos por série:** limita o tamanho das séries; a tela avisa se ultrapassar o limite
- **Prévia ao criar:** antes de confirmar, você vê quantos turnos serão criados e a lista completa de datas
- **Cada turno é independente:** após criada, cada turno funciona como um turno normal (edit, convite, pagamento, avaliação)
- **Convidar para a série inteira:** escolha um freela e convide-o para todas as ocorrências futuras ainda abertas (em paralelo, sem digitar cada uma)
- **Aviso de sobrecarga:** se convidar alguém para tantos turnos que ultrapasse o limite semanal configurado, a tela avisa (a decisão é sua)
- **Editar os futuros:** altere título, função, descrição, requisitos, briefing, local, horário, vagas para todas as ocorrências futuras abertas, de uma vez (o valor fica travado)
- **Cancelar a série:** encerre a série — ela para de gerar novos turnos e remove as ocorrências futuras ainda abertas
- **Prévia antes de aplicar:** tanto para edição quanto cancelamento, a tela mostra quantos turnos serão afetados e quantos ficarão (porque já têm freela ou chamado)
- **Proteção de freelas confirmados:** turnos com freela já contratado ou chamado aberto NUNCA são alterados ou cancelados em massa — segurança contra quebra de compromisso
- **Série é imutável:** após criar, não dá para mudar tipo/dias/datas — crie uma nova se precisar de padrão diferente

#### Chamado de Turno — Disparo 1→N com Primeiro-Aceite (2026-08-17)

**Empresa:**
- **Novo modelo de convite:** em vez de convidar freela por freela e segurar a vaga por horas, a empresa dispara um turno para vários freelas do Elenco **ao mesmo tempo**
- **Quem aceitar primeiro fica com a vaga:** o chamado fecha automaticamente quando a vaga é preenchida; os demais recebem notificação sem qualquer punição
- **Opções de expiração:** 30 minutos, 1 hora, **2 horas (padrão)**, 6 horas, 24 horas, ou até o horário de início do turno
- **Motivo do chamado:** empresa marca por que precisa chamar (falta de freela, demissão/quebra de escala, pico previsto, evento, férias, folga, reforço)
- **Métrica de performance:** a tela do turno mostra em quanto tempo a primeira vaga foi preenchida (ex: "6 minutos" em vez de "2 horas")
- **Visão em tempo real:** painel mostra quantos responderam, quantos recusaram, quantos ainda estão aguardando
- **Cancelar chamado:** empresa pode parar de procurar a qualquer momento — o chamado encerra e ninguém perde reputação
- **Convite tradicional ainda funciona:** para chamar apenas um freela, a interface é a mesma (é um chamado com um alvo)

#### Listas do Elenco — Organizar Freelas por Função (2026-08-17)

**Empresa:**
- **Nova tela "Listas do Elenco":** salvar grupos de freelas por função/tipo ("Cozinha", "Salão", "Chapa", "Limpeza", etc.)
- **Criar/editar/excluir listas:** interface simples de nomear e marcar freelas
- **Um freela em várias listas:** o mesmo freela pode estar em "Cozinha" E "Limpeza"
- **Criar lista vazia:** salvar uma lista sem membros e preenchê-la depois é válido
- **Usar listas no chamado:** ao disparar um turno, clicar num chip de lista **adiciona todos os freelas daquele grupo** à seleção
- **Marcar/desmarcar:** clicar novamente no chip remove só aquele grupo (não desfaz os freelas marcados à mão)
- **Excluir lista não remove ninguém:** quando você exclui uma lista, os freelas continuam no Elenco — apenas a categorização é removida
- **Disponibilidade na hora:** no moment do chamado, os chips mostram **quantos da lista estão realmente disponíveis** para aquele turno (quem já está alocado ou saiu do Elenco não é contado)

#### Revisão Pré-Piloto (Onda 3) — 2026-08-16

**Agenda de Turnos por Dia (Empresa):**
- "Meus Turnos" agora é uma agenda organizada por dia: Hoje, Amanhã, Esta Semana, Depois, Sem Data, Anteriores
- Cada linha mostra horário, função, freela (com avatar/estado) — sem necessidade de clicar
- Turno sem freela em Hoje ou Amanhã fica destacado em âmbar com alerta "Sem freela"
- Seção "Anteriores" permanece recolhida por padrão (operação não vive no passado)

**Gerenciamento de Convites e Recursos Humanos (Empresa):**
- **"Cancelar Convite":** quando convite está pendente, empresa pode cancelá-lo; freela é notificado
- **"Dispensar do Turno":** quando freela já está confirmado, empresa pode dispensá-lo; requer confirmação explícita
- Ambas as ações não são possíveis se houver pagamento já registrado/agendado para o turno (é preciso estornar antes)

**Notificação via WhatsApp (Empresa):**
- Botão **"Avisar no WhatsApp"** aparece ao lado de convites pendentes (se freela tem telefone cadastrado)
- Abre o WhatsApp com mensagem pronta: turno, data, horário, local e valor
- Serve para resgatar convite que pode expirar sem o freela abrir o app

**Convidar Diretamente do Elenco (Empresa):**
- Card de cada freela em "Meu Elenco" agora tem botão **"Convidar para turno"** na base
- Abre modal para escolher um turno elegível (aberto/pausado, sem esse freela, data futura)
- Dispara convite direto sem sair da tela de elenco

**Histórico do Freela por Empresa (Empresa):**
- Card de freela em "Meu Elenco" agora mostra quantos turnos ele já fez com você e quando foi o último

**Comunicação com Empresa (Freelancer):**
- Botão **"Falar com a empresa"** aparece em turnos em andamento e agendados
- Permite freelancer iniciar conversa sem esperar empresa abrir a conversa
- Mesma conversa em ambos os lados; se empresa já abriu, freelancer vê histórico

**Recibo Melhorado (Freelancer e Empresa):**
- Recibo agora mostra **Chegada** (hora real do check-in), **Saída** (hora real do checkout) e **Total de horas trabalhadas**
- Funciona mesmo para turnos que cruzam a meia-noite (cálculo automático)
- Se check-in/checkout não foram registrados, aquela linha é omitida (não inventa dados)

**Unificação de Nome de Tela (Empresa):**
- Tela de "Confirmação de Presença" agora é consistentemente chamada **"Presença e Pagamento"** em todos os pontos de acesso

### Adicionado

#### Revisão Pré-Piloto (Onda 1) — 2026-08-16

**Chave PIX na Plataforma:**
- Freelancer informa sua chave PIX (CPF/CNPJ/e-mail/telefone) durante o onboarding
- Chave é exibida no perfil do freelancer (com botão de copiar)
- Empresa vê a chave PIX em "Meu Elenco" (card do freelancer)
- Ao registrar pagamento, chave PIX vem pré-carregada

**Novo Perfil Público da Empresa:**
- Freelancer pode abrir perfil completo de qualquer empresa antes de aceitar convite
- Mostra: nome, logo, capa, setor, descrição, endereço, briefing padrão
- Inclui avaliações de outros freelancers que já trabalharam lá
- Acessível de: convite pendente, Carteira de Clientes, chat, tela cheia de convite

**Cards de Elenco Clicáveis:**
- Cards de freelancer em "Meu Elenco" (empresa) agora abrem o perfil completo ao clicar
- Botões de compartilhar e remover continuam funcionando normalmente

**Validação na Criação de Turno:**
- Campos obrigatórios (título, função, descrição, valor, data e horário) são validados antes de confirmar
- Data no passado é bloqueada

**Confirmação de Presença Simplificada:**
- QR de check-in e verificação por GPS foram removidos (nenhum verificava de fato)
- Confirmação de presença agora: freelancer faz check-in no app + empresa confirma manualmente na tela do turno
- Rótulo "(GPS)" removido (a geolocalização era solicitada e descartada)
- O QR de **identidade do freelancer** (usado para adicionar ao elenco) permanece ativo

**Limpeza de Interface:**
- Sino da empresa ramifica por papel: navega para `/company/notifications` em vez de tela de erro
- Botão "Mensagem" em perfil de freelancer agora funciona
- Ícones decorativos (lupa/funil) removidos de dashboards
- "Dica Pro" com dados inventados foi corrigida/removida

**Remoção de Superfície de Modelo Antigo (Modos B/C — Postpago):**
- Seção "Carteira da Empresa" (`/company/wallet`) removida
- Modais de depósito e cartão de crédito removidos (Modo B/C não está no piloto)
- Página "Painel Financeiro" (`/company/financeiro`) removida
- Página "Meu Saldo" (worker) removida — substituída por [**Meus Recebimentos**](#meus-recebimentos-pagamento-externo-modo-a)
- Código morto removido: `Analytics.tsx`, `CreateJob.tsx`, `Placeholder.tsx`, `WorkerDashboard.tsx`

**Meus Recebimentos (Pagamento Externo — Modo A):**
- Nova página `/recebimentos` acessível pelo menu inferior (BottomNav)
- Freelancer acompanha todos os pagamentos registrados pelas empresas em uma única tela
- Categorias: agendados (promessa), aguardando confirmação, recebidos, cancelados
- Cada item abre o recibo bilateral completo para conferência e confirmação

### Adicionado

#### Cancelamento de Turno Agendado (2026-07-14)

**Freelancer:**
- Botão "Cancelar turno" na aba Agendados permite cancelar um turno que já foi aceito
- Empresa recebe notificação automática do cancelamento e o turno volta a ficar disponível

### Corrigido

#### Perfil, Home e Notificações (2026-07-14)

**Freelancer e Empresa:**
- **Perfil:** seções de Segurança (trocar senha), Sair e Zona de Perigo agora ficam ocultas atrás do botão "Configurações da Conta" (reduz poluição visual e risco de clique acidental)

**Freelancer:**
- **Próximo Turno na home:** exibe corretamente o próximo turno agendado (antes mostrava "Invalid Date")
- **Status do turno em andamento:** destaca quando o freelancer está no turno agora
- **Sem turnos:** exibe "Sem próximos turnos marcados" quando não há agendamento
- **Notificações de mensagem:** o sino limpa as notificações de mensagem ao abrir a conversa (antes ficavam presas)

### Adicionado

#### Agregados e Histórico Detalhado do Freela (2026-07-12)

**Freela:**
- **XP e nível corretos:** ao concluir turnos, XP sobe (100 por turno) + bônus de perfil (foto +50, especialidades +75), nível progride automaticamente
- **Ganhos totais visíveis:** o total de ganhos e número de turnos concluídos agora aparecem corretos na tela inicial
- **Histórico detalhado:** ao clicar em um turno concluído, vê chegada/saída (timestamps), valor, status de pagamento e avaliação recebida
- **Avaliações no perfil:** tanto freela quanto empresa veem a lista de avaliações recebidas (estrelas + comentário) em seus perfis públicos
- **Avaliação obrigatória após pagamento:** ao receber um turno pago, o freela é solicitado uma vez (por visita) a avaliar a empresa antes de deixar a tela de histórico

#### Pagamento Agendado e Comprovante (2026-07-12)

**Empresa e Freelancer:**
- **Agendamento de pagamento:** a empresa pode agendar pagamento com data prevista, gerando um "Comprovante de Agendamento" que dá respaldo ao freela
- **Transição para pago:** após o agendamento, a empresa marca como efetivamente pago (status → 'recorded'), gerando o recibo normal

#### Briefing Padrão (2026-07-12)

**Empresa:**
- **Briefing padrão do negócio:** configurar uma vez no perfil da empresa (regras da casa, dress code, apresentação)
- **Pré-preenchimento ao criar turno:** ao criar novo turno, o briefing padrão vem preenchido e pode ser ajustado por turno

#### Modo A — Pagamento Externo (Piloto 2026-07-01)

**Empresa e Freelancer:**
- **Registrar pagamento feito por fora:** ao concluir um turno, a empresa registra que pagou o freelancer por PIX/dinheiro (fora do Worki)
- **Recibo in-app:** geração automática de recibo declaratório acessível por empresa e freelancer
- **Confirmação de recebimento (bilateral):** o freelancer pode confirmar que recebeu o pagamento
- **Inteligência financeira unificada:** o painel financeiro e alertas de teto agora contam tanto pagamentos via Worki quanto registrados por fora

**Empresa:**
- Botão "Registrar pagamento" na tela de conclusão de turno (campo "Pagamento feito por fora do Worki")
- Seleção de fonte de pagamento: PIX, dinheiro em espécie ou outro método
- Confirmação e emissão automática de recibo
- Rastreamento do pagamento no histórico de turnos

**Freelancer:**
- Visualização de recibos de pagamentos registrados
- Confirmação de recebimento (gera valor comprovado no recibo bilateral)

#### Meu Elenco e Convites de Turno (Novo Fluxo de Contratação)

**Empresa:**
- Página "Minha Equipe" (`/company/team`) — construir e gerenciar sua equipe de freelancers
  - Adicionar por: link de convite, Worki ID ou **QR Scanner** (câmera)
  - Ver status: confirmados, aguardando resposta, bloqueados
- Campo "Briefing" ao criar turno (regras, dress code, procedimentos)
- Convite direto de turno para freelancers da equipe (sem abrir no feed)
- Acompanhamento de respostas (aceito, recusado, aguardando, expirado)

**Freelancer:**
- Aba "Convites" em "Meus Turnos" — receber e responder convites de turno
- Código QR de identidade no perfil (empresas podem escanear para adicionar)
- Link de aceite de convite por e-mail/WhatsApp/SMS
- Resposta neutra a convites (recusar não afeta reputação)

**Ambos:**
- Avaliação bidirecional pós-turno (empresa avalia freelancer; freelancer avalia empresa)
- Histórico completo de avaliações nos perfis públicos

### FUTURO — Não lançado no piloto

#### Slice 2 — Pagamento Postpago (modelo Uber — Futuro)

Recursos planejados para expansão futura:

**Empresa:**
- Cadastro de cartão de crédito na Carteira da Empresa
- Seção "Cartões de Crédito" com interface de adicionar/gerenciar cartões
- Modelo de pagamento postpago: **sem depósito antecipado**
- Na conclusão do turno, o cartão é automaticamente debitado

#### Slice 3 — Inteligência Financeira (BI da Empresa — Futuro)

Recursos planejados para expansão futura:

**Empresa:**
- Painel Financeiro com análise detalhada de gasto
- **Teto de gasto mensal** com alertas
- **Faturamento do mês** e indicadores de custo
- **Gasto por freelancer** e tendências
- **Alerta de concentração** para risco de vínculo trabalhista

### Alterado

- **Fluxo de criação de turno:** Freelancers da sua equipe em vez de candidatos anônimos no feed
- **Modelo de convite:** Aceitar/recusar convites em vez de candidatura automática em vagas abertas
- **Modelo de pagamento (Piloto):** Pagamento Externo (Modo A — PIX/dinheiro direto) é o padrão; registrado e confirmado no app
