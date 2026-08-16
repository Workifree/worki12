# Changelog — Worki

Todas as mudanças visíveis ao usuário são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/).

---

## [Não lançado]

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
