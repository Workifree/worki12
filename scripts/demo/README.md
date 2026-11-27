# Conta de demonstração da EMPRESA — Restaurante Demo Sabor & Cia

Seed de uma empresa fictícia com **todas as telas preenchidas**, para mostrar o Worki a clientes.
Tudo é marcado como demo: e-mails `@demo.worki.test`, CPF/CNPJ inválidos de propósito
(`000.000.0NN-XX`, `00.000.000/0001-00`), PIX e telefones fictícios (`55119 9999-xxxx`).
Nenhum dado real. Nenhum dinheiro (o pagamento é só **modo A**: registro de pagamento externo).

## Como rodar

```bash
# criar / recriar (idempotente — pode rodar de novo a qualquer momento)
npx supabase db query --remote=vrklakcbkcsonarmhqhp --yes -f scripts/demo/seed-demo.sql

# derrubar tudo do demo (e nada além)
npx supabase db query --remote=vrklakcbkcsonarmhqhp --yes -f scripts/demo/teardown-demo.sql
```

- Roda em **uma transação**: se algo falhar, nada é gravado. O resultado final mostra contagens de conferência.
- **Rode o seed no dia/hora da demonstração** (ou na véspera). Todas as datas são relativas a `now()`
  e ao dia de hoje em `America/Sao_Paulo`: turnos "de hoje", "em andamento" e "amanhã" envelhecem.
  Para resetar o demo ao estado inicial, rode o seed de novo (ele apaga o que o demo criou e recria).
- Antes de rodar em produção, confira o item "Riscos" abaixo.

## Credenciais (senha de todos: `Demo#Worki2026`)

| Papel | E-mail | O que mostra |
|---|---|---|
| Gestor (dono) | `gestor@demo.worki.test` | Tudo da empresa. Use este na demo principal |
| 2º Gestor | `gestor2@demo.worki.test` | Gestor convidado (papel `manager`) |
| Encarregado Loja Centro | `enc.centro@demo.worki.test` | Só os turnos dele + "Hoje"; cobre a Loja Norte por alguns dias |
| Encarregado Loja Norte | `enc.norte@demo.worki.test` | Idem, Loja Norte |
| Encarregado Eventos | `enc.eventos@demo.worki.test` | Idem, Eventos |
| Encarregada aguardando | `enc.aguardando@demo.worki.test` | Tela de espera "o Gestor precisa confirmar" |
| Encarregado removido | `enc.removido@demo.worki.test` | Acesso encerrado (turnos antigos seguem no histórico) |
| Freela | `freela@demo.worki.test` | Beatriz Almeida Souza: recibo para confirmar, pagamento agendado, convite pendente, turno amanhã |
| Outros freelas | `freela.02@…` a `freela.25@demo.worki.test` | Mesma senha |
| Empresa parceira | `parceira@demo.worki.test` | Só existe para originar as indicações |

Link de **convite pendente** (encarregada Natália Siqueira, válido por 12 dias a partir do seed):
`https://worki-opal.vercel.app/convite-equipe/3be0c68bf8fb1406eea20b83decb6a5dfc93aa9cda81ef2b980ae962d962935a`
(abrir em aba anônima; o aceite pede código por e-mail, e `@demo.worki.test` não recebe e-mail, então serve só para
mostrar a tela de prévia do convite).

## Mapa: o que cada tela vai mostrar

| Tela (rota) | O que aparece |
|---|---|
| Dashboard `/company/dashboard` | ~70 turnos em todos os estados (passado até ~87 dias, hoje, futuro), faturamento mensal (4 meses), notas (empresa ~4,x), gasto vs. teto mensal |
| Turnos `/company/jobs` | Abertos, em andamento, concluídos, cancelados (soft delete), pausado, "sem registro de presença", série semanal (sábados), lote "Casamento Silva" (6 dias), 1–5 vagas, lojas variadas |
| Candidatos `/company/jobs/:id/candidates` | `invited`, `hired`, `in_progress`, `completed`, `cancelled`, `declined`; check-in/out com horas; botões de excluir/dispensar |
| Hoje `/company/hoje` | 1 turno em andamento (1 já chegou, 1 ainda não), 1 já concluído, 1 mais tarde, 1 SOS; exceção de presença pedida e ainda sem decisão |
| Presença e Pagamento | Confirmações de véspera (confirmou / sem resposta / não vai), pedidos manuais pendentes; GPS+QR verificado e 1 exceção manual por turno de Centro |
| Pagamentos / relatório `/company/relatorio` | Agendado, registrado (confirmado pelo freela e aguardando confirmação), estornado, estornado e refeito, pago em dinheiro, agendado vencido; ~3 meses de valores e horas coerentes; 4 exportações de planilha |
| Chamados de turno | Abertos (2 no futuro), preenchidos (2), expirado (1), cancelado (1), com recusas; 1 **SOS** aberto com 1 aceite (4 alvos fora do Elenco) |
| Elenco `/company/team` | 18 aceitos, 2 pendentes, 1 bloqueio do freela (veto); fontes link/telefone/QR/indicação; 3 listas (Garçons de confiança, Cozinha e copa, Bar e eventos) |
| Perfil do freela `/company/worker/:id` | Nota, avaliações, funções, cidade, disponibilidade por dia, certificações (vencendo, vencida, conferidas) e treinamentos (1 revogado) |
| Equipe `/company/configuracoes/equipe` | 3 encarregados ativos (1 por loja, com loja padrão), 1 aguardando confirmação ("É ele?"), 1 convite pendente, 1 removido, 2º Gestor; coberturas (ativa, encerrada, revogada) |
| Lojas / etiquetas | Loja Centro, Loja Norte, Eventos |
| Locais `/company/locais` | 3 locais com GPS e raio + segredo do QR |
| Indicações `/company/indicacoes` | 1 aguardando o freela, 1 recusada, 1 aceita (da Pizzaria Demo Parceira) |
| Mensagens `/company/messages` | 15 conversas com mensagens lidas e não lidas |
| Notificações | Gestor (10), encarregados, freelas |
| Perfil da empresa `/company/profile` | Logo, briefing padrão, endereço, setor, descrição |
| Freela (`freela@…`) | `/my-jobs` (convite, turno amanhã, concluídos), `/recebimentos` e `/recibo/:jobId` (agendado, registrado para confirmar, confirmado + termo aceito), `/messages`, `/profile` (certificações), notificações |

## O que NÃO é semeado (de propósito)

- `wallets`, `escrow_transactions`, `wallet_transactions`, `payment_methods`: pagamento pelo Worki está pausado.
- Trilha de bônus (`bonus_*`): spec ainda sem migration em uso, flag desligada.
- `analytics_events`, `notice_*`, `push_subscriptions`, `copilot_usage_daily`: são criados pelo **uso** do demo
  (login, push, copiloto). O teardown apaga o que o uso criar para os usuários demo.

## Riscos (leia antes de rodar)

1. **Triggers com efeito externo.** O seed roda com `SET LOCAL session_replication_role = replica`, que
   desliga TODOS os triggers de usuário só dentro da transação. Foi isso que o catálogo mostrou:
   existem triggers de notificação (`notice_on_*`), `notice_outbox` (fila de e-mail/push), `live_notify_*`,
   `bonus_stamp_*` e `handle_new_user` em `auth.users`. Com `replica`, nenhum dispara; o seed grava à mão
   o que eles gravariam (conversas, termos, agregados de nota/XP, notificações). Não há `ENABLE ALWAYS`
   no banco (conferido), então nada escapa. Um guard no início do script **aborta** se o papel de
   replicação não ficar ativo (por exemplo, se o CLI não mantiver a transação).
2. **FKs não são checadas** durante o seed e o teardown (efeito colateral do `replica`). Por isso toda
   ordem de limpeza é explícita e filtrada por IDs de demo. O teardown remove `auth.users` em uma
   **segunda transação**, sem `replica`, para o CASCADE das FKs de auth funcionar.
3. **Cron em produção opera sobre dados demo.** Jobs ativos: `shift-attendance-confirmations-d1` (21h UTC),
   `certification-expiry-notices`, `lgpd-retention-purge`, `notice-purge`, `presence-checks-purge`.
   Mitigações já no seed: confirmação de véspera `auto` pré-gravada para todo freela contratado
   (`uq_sac_auto_once` impede o cron de criar outra e notificar), e `notified_30d_at`/`notified_expired_at`
   preenchidos nas certificações. Mesmo assim, jobs **novos** que o demo criar durante a apresentação
   entram no ciclo normal do cron (notificação in-app; e-mail só se `notice_outbox` for despachado — e
   `@demo.worki.test` não existe). O expurgo LGPD só atinge dados com mais de `lgpd_retention_interval()`,
   bem além dos ~87 dias semeados.
4. **Dados de produção.** O demo vive no mesmo banco de produção. Ele aparece em contagens internas
   (admin, BI do dono). O SOS e a busca de freelas **não** devolvem demo a empresas reais:
   `can_view_worker_profile` e o pool do SOS exigem vínculo/cidade/opt-in; mas freelas demo com
   `discoverable_for_sos = true` (nº 3 e 22–25, cidade São Paulo) podem entrar no pool de SOS de uma empresa
   real de São Paulo. Para evitar, desligue-os antes de abrir o demo a clientes:
   `UPDATE workers SET discoverable_for_sos = false WHERE id IN (SELECT id FROM auth.users WHERE email LIKE '%@demo.worki.test');`
   (o SOS demo já tem seus alvos gravados; isso só afeta chamados novos).
5. A sequência `jobs_display_code_seq` avança ~70 números a cada seed (buracos no código de turno; sem efeito funcional).
6. Se o `SET LOCAL session_replication_role` for negado ao role do CLI, o script aborta no início sem gravar nada.
   Não há plano B automático: não rode sem `replica`.
7. Usuários demo logados criam sessões em `auth`; o teardown remove (CASCADE). Contas reais **nunca** são
   alteradas: tudo é filtrado por `@demo.worki.test` ou por UUID derivado de `md5('worki-demo:…')`.

## Como derrubar

```bash
npx supabase db query --remote=vrklakcbkcsonarmhqhp --yes -f scripts/demo/teardown-demo.sql
```

Remove: empresa, organização, equipe, lojas, locais, turnos, candidaturas, conversas e mensagens, presença,
chamados, pagamentos, termos, avaliações, listas, indicações, certificações, treinamentos, notificações,
freelas, usuários e identidades de auth. A última consulta devolve zeros (`usuarios_demo`, `empresas_demo`,
`turnos_demo`). Se algum cron já tiver gerado algo para um usuário demo, o teardown também cobre
(notificações, `notice_outbox`, `push_subscriptions` etc. por `user_id`).

## Como o seed foi validado

Sem executar em produção: o catálogo vivo foi lido em modo somente leitura (colunas, NOT NULL, CHECKs, índices
únicos, triggers, funções) e os blocos de geração (turnos, candidaturas, chamados, pagamentos, termos, avaliações,
mensagens, notificações) foram executados **como SELECTs** read-only para checar tipos, unicidade
(`job_id, worker_id`; `call_id, worker_id`; `reviews`), ausência de timestamps no futuro e contagens. A execução
real do `INSERT` continua sendo o primeiro teste de integração: rode primeiro em horário calmo.
