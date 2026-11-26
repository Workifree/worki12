# ADR-20261124 — Trilha de bônus do operador: obrigação do caixa do Worki, fora do razão, derivada de eventos

## Status
ACEITO (25/11/2026). Gate do harness-architect de 24/11/2026; condições C1 a C10 aceitas pelo dono e
implementadas nas migrations `20261124000100`–`20261124000400`, que as citam por número. Adendos A-i a
A-vii registram decisões de engenharia fixadas depois do gate.

## Contexto
O Worki quer pagar ao operador da empresa cliente (piloto: Momma Doces) um bônus em dinheiro do próprio
caixa, com teto de R$300 por operador em 12 semanas, via PIX manual do dono toda segunda a partir de uma
lista no admin. O processamento de pagamento está pausado (ADR-20260822) e o Article 8 precisa ficar
intacto. A spec `.harness/spec/trilha-bonus-operador/spec.md` propunha 11 tabelas, máquina de 6 estados,
cron de hora em hora e ledger reconstruído a cada avaliação. Riscos: (1) pagar marco por ação do
concierge; (2) contar o mesmo marco duas vezes; (3) corrida entre liberação em 48h e "Não contar";
(4) dependência das fatias E2 a E5 de `equipe-encarregados`.

## Decisão
Princípio geral: **fora do razão financeiro.** As tabelas `bonus_*` registram uma obrigação do Worki e
PIX feitos por fora (espírito do modo A). Nenhuma leitura/escrita em `wallets`, `escrow_transactions`,
`wallet_transactions`, nenhuma chamada às RPCs de saldo, valores em centavos inteiros, nenhum nome
`balance`/`wallet`/`saldo`.

### Condições do gate (C1–C10)
- **C1 — `tier` NOT NULL DEFAULT 1.** Com NULL o UNIQUE (inscrição, marco, tier) não colide e o
  `ON CONFLICT DO NOTHING` duplicaria marcos sem tier. Cada par (marco, tier) é pago uma vez; um turno
  alimentar vários marcos é intencional.
- **C2 — Operador = membro confirmado, não dono, não vetado.** Linha ativa em `company_members` com
  `confirmed_at` (`internal_company_confirmed_operator`), `operator_user_id <> companies.owner_id`, fora
  da lista de veto (sócios e pessoas de organização do Worki). Ramo "dono único atestado" (R8) rejeitado:
  o concierge opera com o login do dono.
- **C3 — Ledger gravado uma vez; `review` único.** `bonus_shift_ledger` nasce uma vez, quando o recibo
  bilateral fecha; `counted`/`exclusion_reason` decididos na inserção, em ordem cronológica, com a
  inscrição `FOR UPDATE`, nunca recalculados. `flag_state` + `decision` viram uma coluna só,
  `review` (`none|open|approved|excluded`), única mutação permitida (decisão do dono).
- **C4 — 48h calculada na leitura, sem cron.** Estado persistido do award: `earned | not_counted |
  in_payout | paid`. "Disponível" = `now() >= available_at` e nenhuma evidência com `review='open'`.
  Tela, pedido de saque e lista do admin chamam `bonus_evaluate_enrollment` antes de ler; o marco de
  regularidade é avaliado na primeira chamada após `ends_at`. Flag tardio não regride award.
- **C5 — "Não contar" reavalia antes.** O motor reavalia antes de marcar `not_counted`; se o marco ainda
  tem base, a evidência é reescrita e o award mantido. Award em pedido `requested` sai do pedido e o
  valor é recalculado na mesma transação. `paid` é imutável.
- **C6 — Marcos derivados.** Convite ao Elenco e aceite vêm de `team_connections.invited_by`; chamado de
  `shift_calls.created_by`; turnos/recibos de `applications`, `shift_payments`, `bonus_attributions`.
  Hábito e baseline derivados do histórico.
- **C7 — Capturar só o que o dado não guarda:** criador imutável do turno (`bonus_attributions`;
  `jobs.responsible_id` muda com "Passar para"/"Cobrir") e autor do briefing (`bonus_events`). A captura
  de avaliação foi removida (ver A-i).
- **C8 — Sem `bonus_habit_snapshots`.** Reputação/hábito não é materializado.
- **C9 — Tudo `enabled=false` até E2–E5 em produção.** Condição de ativação, não de construção. Nada
  retroativo: baseline nasce com zero semanas.
- **C10 — Corte único: sexta 23:59:59 America/Sao_Paulo.** Pedido feito até o corte entra no PIX da
  segunda seguinte; depois dele, na segunda subsequente. Um só corte para saque, lista do admin e
  disponibilidade.

### Adendos de engenharia (fixados após o gate)
- **A-i — Marco de avaliação REMOVIDO.** `reviews.reviewer_id` não identifica a pessoa que avaliou. Os
  R$10 foram realocados ao marco 8. Trilha: **19 marcos contáveis + "Coleção completa"**, total R$300.
- **A-ii — Corte de sexta muda o A30.** Pedido de sábado ou domingo já perdeu o corte da sexta e cai
  **duas segundas depois** (não na segunda imediata).
- **A-iii — `not_counted` pode ser reconquistado** se a base voltar a existir, sem nunca ultrapassar o
  teto (trigger de cap continua valendo).
- **A-iv — Turno contável exige os quatro carimbos de presença** (check-in e check-out do freela +
  confirmação de chegada e de saída pela empresa) **e recibo confirmado**, por decisão do dono. A UI diz
  qual carimbo falta.
- **A-v — Flag `stuck_times` desligada por padrão** (parâmetro da trilha); liga só com evidência de abuso.
- **A-vi — Marcos de convite contam só convite direto na v1.** Aceite por link grava `invited_by` NULL e
  não gera marco.
- **A-vii — Evidência de presença SEMPRE dos carimbos do servidor** (`now()` gravado pelo banco na
  transição), nunca dos horários enviados pelo cliente. Achado de segurança A1: o cliente escreve os
  campos de horário de check-in/out.

## Consequências
### Positivas
- Article 8 intacto por construção; reputação não materializada; saem `bonus_habit_snapshots`, a maior
  parte de `bonus_events`, dois estados e um cron.
- O concierge não gera marco: o login do dono nunca é operador.
- Rastreabilidade: cada comentário de migration aponta para Cn/A-x deste ADR.

### Negativas / Trade-offs
- Dono que opera sozinho, sem encarregado, não participa.
- Avaliação síncrona dentro do trigger de `shift_payments` (transação do freela), em
  `EXCEPTION WHEN OTHERS`, custo O(turnos do operador) — aceitável no piloto.
- A-iv torna turnos com carimbo esquecido não contáveis; mitigado pela UI que nomeia o carimbo faltante.
- A-vi deixa de premiar crescimento por link até a v2 capturar o autor do link.
- AF1(c)/(d) (mesmo CPF/telefone) podem ficar vazios; defesa real fica no veto e no PIX.

## Adendo 2026-11-25 — Avaliação na leitura, bloqueio PIX e reabertura

- **Motor fora de gatilho (MEDIUM-2).** Nenhum trigger executa o motor da trilha: os gatilhos só registram (`SET LOCAL lock_timeout='2s'`), para que o bônus nunca trave nem derrube a confirmação do recibo. Os marcos aparecem, e a janela de 48h começa a contar, na **primeira leitura após o recibo** (tela do operador, pedido de saque ou admin), não no instante da confirmação.
- **`pix_match` sem liberação manual.** O bloqueio só cai se o PIX mudar ou se o dono vetar; não há botão de "liberar mesmo assim".
- **Troca de PIX reabre turno aprovado.** Exceção consciente ao C4 (decisão não se reabre), em favor do antifraude A2: sem isso, aprovar e depois trocar o PIX para o do freela contornaria o bloqueio.
- **Consequência de produto.** Operador que não abre a tela atrasa o próprio pagamento (a janela nem começou). Aceito: o atraso só afeta quem não olha, e o saque já força a leitura. Mitigação: o admin roda `admin_bonus_refresh` antes das listas, então nada fica invisível para o dono no fechamento semanal.

## Alternativas rejeitadas
- **Cron de hora em hora para as 48h**: transição assíncrona que corre contra a decisão do dono.
- **Atribuir por `jobs.responsible_id`**: muda com "Passar para"/"Cobrir", permitindo farm.
- **Ramo "dono único" (R8)**: concierge indistinguível do dono.
- **Recalcular o ledger a cada avaliação**: evidência instável, dupla contagem possível.
- **Marco de avaliação via `reviews`**: autor não é a pessoa (A-i).
- **Horários de presença do cliente como evidência**: forjáveis (A-vii).
- **Ledger em `wallet_transactions`**: viola Article 8 e a pausa de pagamento.

## Referências
- Spec: .harness/spec/trilha-bonus-operador/spec.md
- Migrations: supabase/migrations/20261124000100 a 20261124000400
- Seam: supabase/migrations/20261123000200 (internal_company_confirmed_operator), 000300 (session_can_operate_job, is_job_owner), 000400 (team_connections.invited_by)
- ADR-20260822-pausa-do-processamento-de-pagamento.md
