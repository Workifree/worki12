# Plano de teste de usuário (E2E) — Equipe e encarregados

> Executor: `harness-tester`, modo DIRIGIDO. Spec: `spec.md` (A1–A27). Este plano é só leitura sobre o banco:
> o tester **nunca escreve SQL de mutação**; consultas de verificação são feitas pelo orquestrador/dono
> (MCP Supabase `execute_sql`, `SELECT` apenas) ou pelo tester via `evaluate_script` somente com o próprio
> token das contas de teste (leitura PostgREST). Nunca `service_role`.
> Rotas novas: `/convite-equipe/:token` (pública), `/company/hoje`, `/company/configuracoes/equipe`.

## 0. Pré-condições (conferir ANTES; se faltar algo, reportar BLOQUEADO/CEGO, não improvisar)

### 0.1 Banco
- Migrations E0 a E5 aplicadas em produção (`vrklakcbkcsonarmhqhp`) e conferidas no catálogo, não só no histórico:
  - `role` de `company_members` aceita `'encarregado'` (CHECK alargado por último, E4).
  - Existem as RPCs: `invite_company_member`, `accept_company_member_invite`, `resend_member_invite`,
    `remove_company_member`, `get_busy_workers`, `reassign_job_responsible`, `create_responsibility_coverage`,
    `cancel_job`, `my_link_risk_config(p_company_id)`; `jobs.responsible_id`/`tag_id` existem.
  - `is_company_owner` com `role='manager'` explícito (E0).
- Frontend no ar contém o diff (commit `37ba6657` ou posterior): provar pelo hash `assets/index-*.js` na rede e
  por `/company/hoje` existir. Se `/convite-equipe/x` cair em 404 genérico, a versão no ar é antiga: **primeiro
  achado**, parar.
- Ordem de deploy: migration antes do frontend (coluna/RPC ausente = 400/404 mudo; reportar como defeito de deploy).

### 0.2 Contas (só de teste; nenhuma conta real)
| Papel | Conta | Janela | Observação |
|---|---|---|---|
| Gestor/dono | `e2e-empresa@worki.test` | Chrome 9222 (`mcp__chrome__*`) | senha em `scripts/.e2e-credenciais` (regra do dono 22/11: pode digitar, só conta de teste, nunca no relatório) |
| Freela de teste 1 e 2 | `e2e-worker@worki.test` + `qa.worker2@worki.test` (ou outra `qa.*@worki.test` com perfil de freela) | Chrome 9223 (`mcp__chrome2__*`) | ambos precisam estar no **Elenco aceito** da empresa de teste; o 2º serve para "ocupado" e "Passar para" |
| Encarregado novo | e-mail **que receba o código OTP e que seja do dono/time** (ex.: alias `+enc1` de caixa do dono). **Não** pode ser `@worki.test` (não recebe e-mail) nem e-mail de terceiro/real | 3ª sessão: perfil Chrome limpo/anônimo OU reaproveitar 9223 após deslogar o freela | conta nasce no primeiro OTP; ver 0.3 |
| Encarregado 2 (opcional) | outro alias do dono (`+enc2`) | idem | só para C13/C14 (cobrir, passar para) |
| Dono único (controle) | uma empresa de teste **sem** nenhum membro (`qa.dono-unico@worki.test`) | 9222 após deslogar | para C16 |

O encarregado precisa de uma janela própria: o Gestor e o encarregado **não podem dividir perfil** (sessão vive em
`localStorage`). Se só existirem 2 Chromes, o orquestrador abre um 3º perfil (porta 9224) ou o tester alterna o 9223
(deslogando o freela) e declara a limitação em "Não testado" para cenários de duas sessões.

### 0.3 AVISO sobre e-mail do código (OTP)
- Sem SMTP próprio no projeto Supabase, o e-mail do código **só é entregue a membros do time do projeto Supabase** e o
  limite é de **~2 e-mails por hora**. Cada "Receber código" gasta um. Orçamento total deste plano: **no máximo 2 envios
  por hora**; planejar a ordem para não estourar (C2, C3 e C4 compartilham a mesma conta/sessão).
- Por isso o e-mail do encarregado de teste deve ser de **membro do time do projeto** (o dono). Qualquer outro e-mail
  aparece como "Não conseguimos enviar o código" (copy do app) e isso **não é defeito do app**: reportar como
  BLOQUEADO por infraestrutura, não FAIL.
- O tester **não lê caixa de e-mail**. O dono lê o código de 6 dígitos e passa ao tester na hora ("pausa de 1 passo").
  Se o código não vier em até 5 min, parar o cenário e reportar BLOQUEADO (limite de taxa ou e-mail não autorizado).
- Mensagem de limite esperada na UI: "Aguarde um minuto para pedir outro código." (429). Verificar uma vez, sem insistir.
- **Nunca** disparar WhatsApp real: o botão "Enviar no WhatsApp" abre `wa.me/?text=` em nova aba; o tester só **lê a URL**
  (sem telefone, v1) e fecha a aba. Não escolher contato.

### 0.4 Dados de teste
- Todo turno criado se chama `ZZ-TESTE equipe <cenário>`. Tags de teste: `ZZ-TESTE Evento`.
- Turnos futuros (datas ≥ amanhã) salvo onde dito "turno passado"/"hoje". Para "presença iniciada" e "pagamento ativo"
  o orquestrador prepara previamente um turno `ZZ-TESTE` nesses estados (o tester não consegue forjar check-in de data
  passada). Se não houver, marcar C9c/C9d como NÃO TESTADO com o motivo.
- Antes de começar, anotar por leitura (§ "Consultas de apoio") a linha-base de `team_connections` da empresa de teste
  (contagem e ids) para comparar em C11/C12.

### 0.5 Consultas de apoio (somente `SELECT`; substituir `:company`, `:member`)
```sql
-- Q1 membership
select id, role, status, confirmed_at, confirmed_by, accepted_tos_at, expires_at, removed_at,
       display_name, (invite_token is not null) as tem_token
  from company_members where company_id = :company order by created_at;
-- Q2 turnos e responsável
select id, title, status, responsible_id, tag_id, start_date from jobs where title like 'ZZ-TESTE%' order by created_at;
-- Q3 candidaturas / chamados / pagamentos do turno
select id, status, worker_id from applications where job_id = :job;
select id, status, origin from shift_calls where job_id = :job;
select id, status from shift_payments where job_id = :job;
-- Q4 elenco (linha-base)
select count(*), count(*) filter (where status='accepted'), count(*) filter (where status='pending')
  from team_connections where company_id = :company;
select id, worker_id, status, invited_by, company_id from team_connections where company_id = :company order by created_at;
-- Q5 notificações do período
select user_id, title, created_at from notifications where created_at > now() - interval '30 minutes' order by created_at;
-- Q6 policies sem invited_by
select polname from pg_policy where pg_get_expr(polqual, polrelid) ilike '%invited_by%' or pg_get_expr(polwithcheck, polrelid) ilike '%invited_by%';
```
Nunca copiar CPF/PIX/telefone/e-mail de terceiro para o relatório.

---

## Convenção dos cenários
`[2S]` = **repetir/rodar com duas sessões simultâneas** (Gestor em 9222 e encarregado na outra janela, ao mesmo tempo,
alternando as ações). Os demais podem ser sequenciais. Viewport padrão 390×844; os que exigem outro estão marcados.
Cada cenário registra: console (`error`/`warn`), rede (4xx/5xx) e, onde indicado, recarregar para provar persistência.

---

### C1 · Convite por WhatsApp (Gestor)  — A7, A19, R11, R12, R23  [2S: não]
**Precondição:** empresa de teste com ≥1 freela; Gestor logado em 9222.
1. Abrir `/company/configuracoes/equipe`. Se vazia: ver "Ninguém na equipe ainda" e botão primário "Convidar pessoa".
2. Tocar o botão de convidar. Preencher nome `ZZ Ana Encarregada`; conferir que o papel **Encarregado** é cartão grande
   (há também Gestor só se o logado for dono/operador de organização; sem matriz de checkboxes).
3. (Se houver campo) telefone: **deixar vazio** na primeira vez, depois repetir com `(11) 91234-5678` fictício.
4. "Gerar convite" -> tela "Convite pronto" com link `data-testid="invite-link"`.
5. Tocar "Enviar no WhatsApp": abre aba `wa.me`. Ler a URL e **fechar sem enviar**. "Copiar link" -> toast "Link copiado.".
6. Clicar duas vezes rápido em "Gerar convite" com o mesmo nome+papel (vândalo).

**Esperado:** link `/convite-equipe/<token>` com token longo e aleatório (≥32 caracteres, sem uuid de empresa/pessoa);
texto do WhatsApp com empresa, papel e link e "não repasse"; **sem e-mail pedido**; duplo clique **não** cria dois convites
(idempotente por nome+papel: mesmo token); convite aparece na lista com selo "Convite enviado".
**Banco (Q1):** 1 linha `role='encarregado'`, `status` pendente/invited, `invited_email` nulo, `expires_at` ≈ agora+14 dias,
token ≥32 chars, `confirmed_at` nulo. Guardar o token só localmente (**não** colar no relatório; citar "token T1").
**Falha típica a caçar:** token derivado de id público; convite duplicado no duplo clique; link visível na Equipe de um encarregado.

### C2 · Aceite com código OTP, sem senha  — A8, R13, R14b  [2S: não]
**Precondição:** link T1 de C1; sessão "encarregado" **deslogada**; e-mail de encarregado autorizado (0.3).
1. Em janela limpa abrir `/convite-equipe/<T1>` **sem sessão**. Ver "{Empresa} te convidou como Encarregado" e "Não precisa
   criar senha". Console sem erro; a página **não** mostra nenhum dado além de nome da empresa e papel.
2. Tentar "Receber código por e-mail" com e-mail vazio -> "Digite um e-mail válido." e **sem** marcar Termos ->
   "Aceite os Termos de Uso e a Política de Privacidade para continuar." (não gasta e-mail).
3. Marcar Termos, e-mail do encarregado, "Receber código por e-mail" (**gasta 1 envio**). Tela do código.
4. Código errado de 6 dígitos -> "Código incorreto ou vencido. Confira ou peça um novo código." (não gasta e-mail).
5. Dono informa o código correto -> "Entrando na equipe..." -> navega para `/company/hoje`. **Não** passa por `/company/onboarding`
   (observar a sequência de URLs na rede/histórico).
6. Recarregar a página: continua logado como encarregado e fica na tela do passo C3 (não pede CNPJ, não pede senha).

**Esperado/Banco (Q1):** `status='active'`, `confirmed_at IS NULL`, `accepted_tos_at` preenchido, token nulo (queimado),
`accepted_email` = e-mail do OTP. Sessão com `user_metadata.user_type='hire'` (via `evaluate_script`: ler só `user_type`, não o token).
A casca de `companies` do novo usuário não existe (`select count(*) from companies where id = <uid novo>` = 0).
**Falha típica:** cair em onboarding de CNPJ; pedir senha; token em query string de RPC (conferir `list_network_requests`: o
token deve ir em corpo POST, nunca na URL); código aceito sem Termos.

### C3 · Aguardando confirmação  — A12, R22  [2S: SIM]
**Precondição:** encarregado recém-aceito (C2), Gestor ainda não confirmou.
1. Janela do encarregado (após C2) deve mostrar **"Seu acesso está quase pronto"** (componente `AguardandoConfirmacao`)
   com "Atualizar" e "Sair". Medir alvos de toque ≥44px.
2. Na janela do encarregado tocar "Atualizar": continua na espera (sem erro).
3. **Janela do Gestor:** abrir `/company/configuracoes/equipe`: bloco **"Precisa da sua confirmação"** com a pessoa (nome e e-mail), botões Confirmar/Rejeitar. Sino de notificações: "entrou ... é ele(a)?" (Q5: notificação ao Gestor).
4. Encarregado tentando URLs diretas (ainda não confirmado): `/company/team`, `/company/jobs`, `/company/relatorio`, `/company/dashboard`.
**Esperado:** em todas, a tela de espera (não o conteúdo). Nenhum dado de freela na rede (conferir `list_network_requests`: `team_connections`
e `workers` devem devolver `[]`/401/403, nunca linhas). Sem 5xx mudo.
**Caso [2S] específico:** enquanto o encarregado está na tela de espera, o Gestor clica **Confirmar** na outra janela; o encarregado toca "Atualizar" e **entra** sem relogar (C4). Repetir uma vez o inverso: Gestor **Rejeita** (usar o 2º convite/encarregado 2) e o encarregado vê "Seu acesso a essa empresa foi encerrado" ao atualizar.

### C4 · Confirmação "é a pessoa certa?"  — A12, R22  [2S: SIM]
1. Gestor: comparar nome convidado com e-mail que entrou (nome `ZZ Ana Encarregada` vs e-mail do dono). Tocar **Confirmar** ->
   toast "Acesso confirmado para ZZ Ana Encarregada. Já pode trabalhar."
2. **Banco (Q1):** `confirmed_at` e `confirmed_by` preenchidos; `confirmed_by` = uid do Gestor (não pode ser o próprio encarregado).
3. Encarregado (outra janela) -> "Atualizar": entra em `/company/hoje`. Recarregar: persiste.
4. Gestor recarrega Equipe: pessoa aparece como "Ativo" e some do bloco "Precisa da sua confirmação".
**Esperado:** leitura de Elenco (`/company/team`... ver C5: a rota some do menu, mas a leitura dos chips funciona dentro do modal de chamado) só após confirmar.
Rejeição: ver C3 [2S]. **Falha típica:** encarregado confirmando a si mesmo; notificação ao Gestor ausente; confirmar duas vezes cria erro mudo.

### C5 · Encarregado opera só os próprios turnos e não vê Pagamentos/Elenco/Operação  — A2, A3, A4, R6, R8, R10  [2S: SIM]
**Precondição:** encarregado confirmado; Gestor tem 2 turnos `ZZ-TESTE gestor A` e `ZZ-TESTE gestor B` (responsável = Gestor, com 1 freela contratado em A e 1 pagamento registrado em B).
1. Encarregado cria `ZZ-TESTE enc 1` e `ZZ-TESTE enc 2` em `/company/create` (campo **Responsável** fixo "eu"; **não** troca; Tag aparece se `team_enabled`).
2. **Menu (lateral 1366×800 e BottomNav 390×844):** presentes: Hoje, Criar Turno, Meus Turnos, Mensagens?/Perfil conforme código; **ausentes**: "Pagamentos", "Meu Elenco", "Operação", "Indicações", "Organização", "Equipe". (Contrato: some da tela, não "desabilitado".)
3. Por URL direta como encarregado confirmado: `/company/relatorio`, `/company/operacao`, `/company/team`, `/company/indicacoes`, `/company/organization`, `/company/configuracoes/equipe`.
   Esperado: **não renderiza conteúdo de Gestor** (redireciona ou mostra acesso negado); zero linhas de pagamentos/elenco na rede.
4. `/company/jobs`: aparecem **só** `ZZ-TESTE enc 1/2`; **não** aparecem `gestor A/B` (título, valor, candidatos). `/company/jobs/<id-de-gestor-A>/candidates` por URL: nenhum candidato, nenhum valor.
5. No turno próprio: convidar/chamar freela do Elenco (modal de chamado mostra chips de listas e freelas do Elenco), confirmar presença, registrar pagamento (modo A) em `ZZ-TESTE enc 1`. **Estornar** pagamento (voided) **não** deve estar oferecido ao encarregado.
6. **[2S]** Em paralelo, o Gestor abre `/company/hoje`: vê os turnos do encarregado e dele com **responsável** em cada card; filtra por pessoa e por tag. O Gestor consegue operar os do encarregado (ex.: abrir candidatos).
**Banco:** Q2: `responsible_id` dos turnos criados = uid do encarregado (preenchido por trigger, não pelo cliente). Q3 para `enc 1`: legível pelo encarregado; Q3 para `gestor A` via sessão do encarregado (PostgREST com o token dele em `evaluate_script`, leitura): `applications`, `shift_payments`, `shift_calls`, `shift_call_targets` = **0 linhas** (A3).
**Falha típica (CRÍTICO se achar):** valor/nome de freela de turno alheio visível; soma de valores alheios em alguma tela (A4); botão de estorno visível.

### C6 · Freela ocupado = aviso sem detalhe  — A5, A6, R14  [2S: SIM]
**Precondição:** freela F1 `hired` em `ZZ-TESTE gestor A` (18h–22h, amanhã). Encarregado tem `ZZ-TESTE enc 1` amanhã 19h–23h.
1. Encarregado abre o chamado/convite do `enc 1` e vê F1 na lista com selo **"ocupado"** (`BusyWorkerBadge`).
2. Inspecionar a tela e a resposta da RPC `get_busy_workers` (aba rede): **só** `worker_id`s; nenhum título, valor, responsável, id de turno ou motivo.
3. Mesmo ocupado, o encarregado consegue **selecionar e disparar** (só avisa, não bloqueia).
4. Freela fora do Elenco aceito (ex.: conta de teste sem vínculo): não aparece como ocupado nem como livre; chamar `get_busy_workers` por `evaluate_script` incluindo o uuid dele -> ausente do retorno (A6).
5. Ocupado por turno **do próprio encarregado**: pode mostrar detalhe (é dele); conferir que não mostra detalhe do turno de Gestor.
6. **[2S]** Gestor, na mesma hora, contrata F2 em outro turno do mesmo horário; encarregado reabre o modal e vê o selo aparecer **sem recarregar a página inteira** (ou após reabrir o modal; anotar o comportamento).
**Falha típica:** selo diz "ocupado no turno X"; bloqueio da seleção; payload com campos extras.

### C7 · "Passar para"  — A14, R18  [2S: SIM]
**Precondição:** encarregado E com ≥3 turnos `ZZ-TESTE` abertos; encarregado 2 (Ana2) confirmado ou o próprio Gestor como destino.
1. Em `/company/hoje` o encarregado seleciona 2 turnos e toca "Passar para..."; modal `PassJobsModal` ("Quem recebe"): destinos = outros operadores confirmados (E **não** aparece a si mesmo).
2. Confirmar -> toast com "2 turnos foram passados." Os 2 somem de Hoje do E; aparecem na Hoje do destino. Notificações a origem e destino (Q5).
3. Tentar passar turno que **não** é dele (por URL/estado velho: abrir Hoje do E, o Gestor passa o turno antes no outro lado, E tenta passar o mesmo) -> mensagem de "ignorado/skipped" sem erro mudo.
4. Não existe "Passar para" para dono único (C16).
**Banco (Q2):** `responsible_id` dos movidos = destino; os demais intactos; nenhuma outra coluna de `jobs` mudou. **[2S]** o cenário de corrida do passo 3 é o objetivo.

### C8 · Cobrir  — A15, R18  [2S: SIM]
1. Em Hoje tocar "Cobrir meus turnos" (encarregado) / "Cobrir alguém" (Gestor): `CoverageModal` com "Quem será coberto", "Quem cobre", "De", "Até".
2. Janela inválida: `Até` antes de `De` e janela >60 dias -> erro de campo claro, botão impedido, nada gravado.
3. Criar cobertura válida cobrindo o dia de amanhã de E para Ana2. Ana2 (outra sessão) abre Hoje: vê e opera os turnos de E **naquele dia**; fora da janela (dia+8) **não vê** (simular escolhendo janela curta de hoje até amanhã e conferir hoje+2).
4. Seção "Coberturas em andamento" lista a cobertura; "encerrar" a remove e Ana2 perde acesso no próximo request.
5. Notificação a E e Ana2 na criação (Q5). `jobs.responsible_id` **continua E** (Q2).
**Falha típica:** cobertura sem fim (não expira por data), responsável reescrito, Ana2 vendo turnos fora da janela.
> Não é possível esperar a data real passar: para "fim automático" usar janela que já termina hoje e verificar no dia seguinte, ou marcar NÃO TESTADO e citar A15 (a parte de 08/12) como pendente.

### C9 · Cancelar turno e cada recusa  — A26, A27, R27  [2S: SIM em C9a e C9e]
Modal `CancelJobModal` ("Cancelar turno" / "Cancelar o turno" / "Manter o turno"). Copy de cada recusa (de `cancelJobMessage`):
- **C9a — turno populado, sem pagamento (sucesso):** E tem `ZZ-TESTE enc cancelar` com 1 freela `hired` e 1 `invited` e 1 chamado aberto. Cancelar. Esperado: "Turno cancelado. 2 pessoas foram avisadas." (ou texto equivalente do total), turno some da lista. **Banco:** `jobs.status='deleted'`, `applications` = `cancelled`, `shift_calls` = `cancelled`, `team_connections` idênticos antes/depois (Q4). Freela (9223): notificação "Turno cancelado pela empresa" em `/my-jobs`; Gestor recebe notificação (rastro). **[2S]** Gestor observa a notificação chegar em tempo real.
- **C9b — pagamento ativo:** turno com `shift_payments` `scheduled|recorded`. Esperado (encarregado): "Esse turno tem pagamento agendado ou registrado. Peça ao Gestor para estornar o pagamento antes de cancelar."; Gestor vê "Estorne o pagamento registrado antes de cancelar o turno." Nada muda (Q3: status do turno e candidaturas iguais). Depois o Gestor estorna e cancela com sucesso (A27).
- **C9c — presença iniciada:** candidatura `in_progress|completed`. Esperado: "Esse turno já teve presença registrada. Não dá para cancelar um turno que já começou." Nada muda.
- **C9d — escrow ativo:** só se existir turno legado com reserva. Esperado: "Este turno tem uma reserva de saldo ativa; fale com o suporte do Worki." Se não houver massa de teste, NÃO TESTADO.
- **C9e — turno passado:** turno que já começou/passou. Encarregado: "Esse turno já começou ou já passou. Só o Gestor consegue cancelar nesse caso."; Gestor consegue (desde que não caia em C9b/C9c).
- **C9f — turno alheio:** encarregado tenta cancelar `gestor A` (URL direta ou estado velho) -> "Você não tem permissão para cancelar esse turno." (`forbidden`), nada muda.
- **C9g — turno vazio por UPDATE cru:** ver C18 (abuso).
- **C9h — duplo clique** em "Cancelar o turno": uma única execução; o segundo toque não gera erro nem notificações duplicadas (contar notificações em Q5).
Para cada recusa conferir: modal mostra aviso amarelo + "Nada foi alterado: o turno continua como estava." + botão "Entendi".

### C10 · Remover pessoa: corta acesso na hora; freelas e turnos continuam  — A13, A13b, R17  [2S: SIM]
**Precondição:** encarregado E confirmado com ≥2 turnos abertos próprios, 1 chamado aberto e ≥1 freela que E trouxe ao Elenco (convite pending/aceito com `invited_by` = E); linha-base Q4 anotada.
1. **[2S]** E logado na janela dele em `/company/hoje`. Gestor, em Equipe, toca Remover em E: modal "Remover ZZ Ana Encarregada?" com "O acesso é cortado agora." e "2 turnos abertos no nome dessa pessoa ficarão com você." (informativo; **não** pede destino nem bloqueia). Confirmar -> toast "ZZ Ana Encarregada saiu da equipe."
2. Na janela de E (sem recarregar), tocar qualquer ação (abrir turno, criar turno, listar) e depois recarregar: tela **"Seu acesso a essa empresa foi encerrado"** (`AcessoEncerrado`), botões "Sair da conta" e "Verificar de novo" (que continua negando).
3. Por URL direta E tenta `/company/hoje`, `/company/jobs`, `/company/create`: nada de conteúdo da empresa. Rede: PostgREST de `jobs` operáveis/`applications`/`team_connections` -> 0 linhas ou negado; escritas negadas.
4. **Gestor:** Hoje mostra os 2 turnos de E agora com responsável **"Gestor"** + "criado por ZZ Ana" e consegue operá-los; chamado, candidatos e pagamentos intactos.
5. **Banco:** Q1: E `status='removed'`, `removed_at` preenchido, token nulo, `display_name` mantido. Q4: `team_connections` **idênticas** à linha-base (mesmo count, mesmas ids; `invited_by` = E preservado; nenhuma com `company_id` = uid de E). Q2: `responsible_id` dos turnos **não reescrito** (ainda uid de E).
6. Freelas continuam no Elenco do Gestor (ver em `/company/team` como Gestor) e podem receber novo chamado.
**Falha típica (ALTO/CRÍTICO):** remoção bloqueada por turnos abertos; acesso residual de E após remover; turnos apagados; freelas saíram junto; sessão de E continua operando >1 request.

### C11 · Re-convite de quem foi removido  — R11, R15, R17  [2S: não]
1. Gestor convida de novo o mesmo nome+papel (ou o mesmo e-mail por novo convite). Esperado: novo convite com **novo token** (o antigo de C1 não funciona: `not_found`/`revoked`/`token_already_used`, ver C15).
2. O mesmo e-mail (E) abre o novo link (**gasta 1 envio de OTP**; ou, se já logado como E, "Entrar na equipe" sem código). Aceita Termos novamente?
3. Esperado: volta a `active` sem confirmar ainda (C3 de novo) ou conforme a regra implementada: **registrar o que acontece**; o ponto de risco é re-entrar já confirmado sem o Gestor confirmar.
4. Após confirmar, E vê de novo os turnos que o Gestor **passou** para ele; turnos que ficaram com o Gestor continuam do Gestor (não voltam automaticamente).
5. Banco (Q1): não duplicar membership ativa para o mesmo `user_id`; histórico `removed` preservado ou reativado de forma explícita.
**Falha típica:** re-convite reativa acesso sem passar por "é ele?"; duas linhas ativas para o mesmo usuário; link velho de C1 ainda válido.

### C12 · Dono único não vê nada da equipe  — A19, R23  [2S: não]
**Precondição:** empresa de controle sem nenhum `company_members` (zero pessoas).
1. Logar como dono único. Percorrer Dashboard, Meus Turnos, Criar Turno, Meu Elenco, Perfil Empresa, Configurações.
2. Esperado: **nenhum** de: "Hoje" no menu, "Equipe" no menu lateral/BottomNav, campo "Responsável", seletor "Tag", "Passar para...", "Cobrir", filtro por pessoa. Único traço: entrada "Equipe" em Configurações/Perfil Empresa com **um** botão primário "Convidar pessoa".
3. `/company/hoje` por URL: renderiza sem erro e **sem** filtros de equipe (ou redireciona), sem 5xx. `/company/configuracoes/equipe` mostra "Ninguém na equipe ainda" e botão único; **sem matriz de checkboxes**.
4. Gerar o primeiro convite (sem enviar) e voltar: agora os elementos de equipe aparecem (divulgação progressiva) **ou** só após o primeiro membro existir, conforme R23: registrar o momento exato e comparar com a spec ("≥1 company_members não removido").
5. Console limpo; `get_my_companies` com `team_enabled` falso antes e verdadeiro depois (aba rede).

### C13 · Tela Hoje `/company/hoje`  — R25  [2S: SIM]
Gestor e encarregado, ambos com turnos criados nos cenários anteriores.
1. Gestor: vê todos os turnos de hoje/próximos dias (agrupados por dia), filtro por pessoa e por tag, card com responsável (avatar/nome; "Gestor" quando efetivo). Estados: com turnos, sem turnos ("Nenhum turno nos próximos N dias"), filtro vazio ("Nenhum turno com esse filtro" + "Ver todos os turnos"), erro de carga (cortar rede com `emulate`: "Não foi possível carregar os turnos." + "Tentar de novo" e recuperar ao religar).
2. Encarregado: só os próprios + coberturas; sem filtro por pessoa; nenhum card alheio.
3. Presença: status de check-in/checkout reflete o que o freela faz em 9223 (freela faz check-in em turno de hoje; empresa vê sem recarregar manualmente ou após atualizar; anotar).
4. Atalhos (abrir candidatos, cancelar turno, passar para) funcionam e respeitam permissão.
5. Seleção múltipla -> barra "Limpar seleção" / "Passar para..." fixa no rodapé: **não pode ficar atrás do BottomNav** (medir com `elementFromPoint` no centro de "Passar para...", z-index nav 50 / modal 70).
6. Limite "Mostrando os primeiros 500 turnos" só em massa; não testar.
7. Criar turno pelo botão "Criar turno" do estado vazio: leva a `/company/create`.

### C14 · Mobile a 320px  — Article 13, design-system  [2S: não]
Viewports: **320×640** (novo pior caso), 360×740, 390×844, 844×390. Telas: `/convite-equipe/<token>` (formulário e tela do código), "Seu acesso está quase pronto", "Seu acesso a essa empresa foi encerrado", `/company/configuracoes/equipe` (lista, "Convidar pessoa", "Convite pronto", "Remover"), `/company/hoje` (cards, filtros, barra de seleção), `PassJobsModal`, `CoverageModal`, `CancelJobModal`.
Medir por `evaluate_script`: `document.documentElement.scrollWidth <= clientWidth` (sem rolagem horizontal); todo botão/alvo ≥44px (checkbox dos Termos incluso: label inteiro ≥44px); link do convite `break-all` sem estourar; modais com botão primário alcançável (não coberto por BottomNav); texto não cortado; nomes longos (60 caracteres) e emoji em `display_name`.
Esperado: nenhum overflow horizontal; modais rolam por dentro; botões de ação inalcançáveis = ALTO.

### C15 · Link de convite inválido / expirado / revogado / já usado  — A9, A11, R15  [2S: parcial]
Sem sessão, janela limpa, para cada caso conferir copy exata e que **nenhum dado** vaza (nem nome da empresa quando inválido):
| Caso | Como obter | Esperado |
|---|---|---|
| inexistente | `/convite-equipe/abc123` (aleatório) | "Link inválido" ("Não encontramos este convite...") e botão "Ir para o início" |
| já usado | link T1 depois do aceite de C2 (outra pessoa/janela) | "Link já usado" (`token_already_used`) ou prévia que já bloqueia; nenhuma segunda membership (Q1) |
| revogado | Gestor cancela convite pendente (na Equipe, botão de cancelar) e abre o link | "Convite cancelado" |
| vencido | convite com `expires_at` no passado: o dono (SQL de QA já existente, **fora do tester**) ou aguardar; se não houver massa, NÃO TESTADO | "Convite vencido" na página; na Equipe selo **"Venceu"** + botão "Reenviar" |
| reenviado | Gestor "Reenviar" convite vencido/pendente | novo link funciona; o antigo -> inválido/revogado; `expires_at` renovado +14 dias (A11); toast "Novo link gerado. O link antigo deixou de valer." |
| conta de freela | no passo do OTP usar e-mail de conta de freela (se o dono tiver um alias que receba e seja de freela) | "Este e-mail é de uma conta de freela" + "Este e-mail já é de uma conta de freela. Use outro e-mail para entrar na equipe." + botão "Usar outro e-mail"; **nada criado** (A10). Se não houver como (limite de e-mails), NÃO TESTADO |
| convite de Gestor | token de convite de gerente | "Este convite é de Gestor" + "Continuar como Gestor" (leva a `/convite-gerente/<token>`) |
Também: abrir o **mesmo** link em duas abas ao mesmo tempo e aceitar nas duas (vândalo) -> apenas uma membership; a segunda recebe desfecho claro, nunca tela branca. Abrir o link com sessão de **freela** logado (9223): bloquear com a copy de freela, **sem** criar conta de empresa.
Rede: o token nunca em URL/query de requisição (só corpo POST). Console sem token impresso.

### C16 · Abuso: encarregado não confirmado e PATCH em `jobs`  — A3, A12, A24, R27, Article 4  [2S: SIM em C16c]
Executar com token do **encarregado** (lido por `evaluate_script` de `localStorage` do próprio app; **nunca** imprimir o token, usar só na chamada e descartar).
- **C16a — não confirmado abrindo rotas:** (usar encarregado 2 aceito mas não confirmado) `/company/hoje`, `/company/jobs`, `/company/create`, `/company/team`, `/company/relatorio`, `/company/messages`, `/company/profile`, `/company/dashboard`: todas caem em "Seu acesso está quase pronto"; nenhuma requisição devolve linhas de freela/turno de terceiros.
- **C16b — leitura direta (PostgREST) com o token do não confirmado:** `GET team_connections?company_id=eq.<empresa>`, `GET workers?select=*&limit=5`, `POST rpc/count_worker_shifts_by_week` -> `[]`/negado; a RPC deve devolver `outcome='not_confirmed'` (nunca zero) (A24); `POST rpc/get_busy_workers` -> negado/sem dados; `POST rpc/my_link_risk_config` sem parâmetro numa sessão de uma única company -> limite dela, com `p_company_id` de outra empresa -> negado sem vazar.
- **C16c — PATCH em `jobs` [2S]:** com o token do encarregado **confirmado**:
  1. `PATCH jobs?id=eq.<turno do Gestor>` com `{"title":"ZZ-TESTE hack"}` -> 0 linhas afetadas/negado; o turno do Gestor continua igual (conferir como Gestor em outra janela).
  2. `PATCH jobs?id=eq.<turno próprio com candidatura viva>` com `{"status":"deleted"}` -> **rejeitado** (trigger exige turno vazio); candidaturas e chamados intactos, ninguém ficou sem aviso.
  3. `PATCH jobs?id=eq.<turno próprio VAZIO>` com `{"status":"deleted"}` -> passa (A26).
  4. `PATCH jobs?id=eq.<turno próprio>` com `{"responsible_id":"<uid de outra pessoa>"}` -> aceito só se destino é operador ativo confirmado; para uid de freela/aleatório -> erro. `{"company_id":"<outra empresa>"}` -> negado.
  5. `POST jobs` com `responsible_id` forjado de outra pessoa -> trigger força o próprio (não obedece o cliente).
  6. Gestor, na outra janela, vê o resultado em tempo real e confirma que nada vazou.
- **C16d — forjar `invited_by` / vínculo no Elenco:** como encarregado confirmado, `POST team_connections` com `invited_by` de outra pessoa -> grava `auth.uid()` do encarregado (conferir Q4); `PATCH invited_by` depois -> rejeitado; `DELETE`/`PATCH status=blocked` em vínculo existente -> 0 linhas/negado; vínculo novo só `pending` e com `company_id` da empresa (nunca uid do encarregado). Q6 devolve **zero** policies mencionando `invited_by` (A13d).
- **C16e — escalada:** encarregado tenta ações de Gestor via RPC: `invite_company_member` com papel Gestor, `remove_company_member`, `resend_member_invite`, criar tag, ler `company_members` de outros, ler `invite_token` de alguém -> todas negadas; **encarregado lê só a própria linha** em `company_members` e jamais `invite_token`.
- **C16f — chat e séries:** encarregado fora do chat da empresa; `create_job_series`/parar série negados (v1).
- **C16g — freela atacando:** freela (9223) tentando as RPCs de equipe (`invite_company_member`, `accept_company_member_invite` com token de convite) -> `worker_cannot_be_manager` ou negado, sem criar membership.
Severidade: qualquer item de C16 que permita ler/gravar fora do escopo = **CRÍTICO** (oráculo: constitution Article 4, spec A2/A3/A12/A13d/A24).

---

## Matriz [2S] — o que repetir com duas sessões simultâneas
| Cenário | 2S? | Motivo |
|---|---|---|
| C1 | não | só Gestor |
| C2 | não | uma sessão nova (gasta e-mail) |
| C3 | **SIM** | espera x confirmar/rejeitar em tempo real |
| C4 | **SIM** | confirmar e entrar sem relogar |
| C5 | **SIM** | isolamento: Gestor e encarregado vendo o mesmo universo de turnos |
| C6 | **SIM** | ocupado sem detalhe, atualização cruzada |
| C7 | **SIM** | corrida "Passar para" (skipped) |
| C8 | **SIM** | cobertura vista pela outra pessoa |
| C9a, C9e | **SIM** | notificação cruzada ao cancelar |
| C10 | **SIM** | corte de acesso na hora, sem recarregar |
| C11 | não | sequencial |
| C12 | não | conta de controle |
| C13 | **SIM** | presença/atualização cruzada |
| C14 | não | viewport |
| C15 | parcial | mesmo link aberto por duas pessoas |
| C16c | **SIM** | PATCH do encarregado verificado pelo Gestor |

Ordem sugerida para poupar e-mails (≤2 envios/hora): C1 -> C12 (sem e-mail) -> C2 (1 envio) -> C3/C4/C5/C6/C7/C8/C9/C13/C16 (sem novo envio, mesma sessão) -> C10 -> C11 (2º envio) -> C15 (sem envio, só leitura de links) -> C14.
Para Encarregado 2 (C3 rejeição, C7 destino, C8 cobertura, C16a) reservar o orçamento da hora seguinte.

## Regras de segurança do teste
- Só contas de teste; nunca abrir/alterar empresa ou freela real; nunca e-mail ou WhatsApp para terceiro.
- O tester **não cria conta com senha**; a conta do encarregado nasce pelo OTP (fluxo do produto) e é de teste do dono.
- Nenhuma mutação SQL pelo tester; verificação no banco **somente `SELECT`**.
- Dados pessoais (CPF, PIX, telefone, e-mail de terceiro, tokens de convite, JWT) **nunca** vão ao relatório; citar "token T1", "e-mail do encarregado".
- Defeito que não reproduz vai em "Suspeitas"; teste não executado vai em "Não testado" com motivo. Relatório completo em `.harness/spec/equipe-encarregados/teste-rodada-N.md`.

## Evidências a anexar ao relatório
1. URL testada, horário e **hash do bundle** (`assets/index-*.js`) provando que a versão contém o diff; lista de migrations E0–E5 conferidas no catálogo.
2. Para cada cenário: veredito (PASS/FAIL/BLOCKED/NÃO TESTADO) + 1 snapshot ou screenshot da tela-chave + console (`error`/`warn`) + requisições 4xx/5xx.
3. C1: URL do `wa.me` (texto, sem número), tamanho do token (contagem de caracteres, não o valor), resultado de Q1.
4. C2: sequência de URLs até `/company/hoje` (prova de que não passou por onboarding), `user_type` da sessão, Q1 após aceite, prova de que o token não aparece em URL de requisição (corpo POST).
5. C3/C4: screenshots das duas janelas lado a lado (espera x "Precisa da sua confirmação"), Q1 antes/depois com `confirmed_at/by`, Q5 (notificação ao Gestor).
6. C5/C16: respostas literais de PostgREST/RPC (status HTTP + corpo **sem PII**) mostrando 0 linhas/negado para turnos alheios, `not_confirmed`, rejeição do PATCH `deleted` e do `invited_by` forjado; resultado de Q6.
7. C6: payload bruto de `get_busy_workers` (só `worker_id`) e screenshot do selo "ocupado".
8. C7/C8: Q2 antes/depois (`responsible_id`), notificações (Q5), prova do fim da janela de cobertura.
9. C9: uma captura por recusa com a mensagem exata, Q3 mostrando que nada mudou nas recusas e o resultado do sucesso (`cancelled_applications`/`cancelled_calls`), Q4 idêntica antes/depois, notificações do freela (9223) e do Gestor.
10. C10: Q1/Q2/Q4 antes e depois da remoção, screenshot de `AcessoEncerrado`, prova de 0 linhas para o ex-encarregado, card "Gestor" + "criado por ...".
11. C11–C12: Q1 após re-convite; capturas do dono único sem nenhum elemento de equipe e depois com.
12. C14: medições de `scrollWidth`/`clientWidth` e menor alvo de toque por tela a 320px.
13. C15: tabela dos 7 desfechos com copy literal e confirmação de que nenhum dado vaza.
14. Seções obrigatórias: **Cobertura**, **Não testado** (com motivo: e-mail/limite de OTP, massa de dados, 3ª janela), **Suspeitas**, **Sinais de saúde**, e quais linhas de `COBERTURA-CLIQUE-A-CLIQUE.md` mudariam de status.
15. Mapa de rastreabilidade: A1–A27 -> cenário que cobriu (A1, A21, A22, A20 e as asserções puramente SQL ficam para o orquestrador/portão; o tester cobre A2–A19, A23 parte E2E, A24–A27 pela superfície).

---
## Decisões de engenharia (24/11/2026) que fecham as duas dúvidas do roteiro

**C11 — Re-convite de quem foi removido.** Volta ATIVO e NÃO CONFIRMADO: o convite novo é outra linha em `company_members` (o índice parcial `uq_company_members_company_user`, `status <> 'removed'`, permite) com outro token, e `confirmed_at` nasce NULL. Remover revoga a confiança; entrar já confirmado anularia a defesa "é a pessoa certa?" contra link vazado. Esperado: tela "Seu acesso está quase pronto" até o Gestor confirmar de novo; antes disso a pessoa opera ZERO turnos e lê ZERO Elenco/PII.

**C8 — Fim automático da cobertura.** NÃO precisa esperar a data passar. O seam (`session_can_operate_job`) compara `p_job_date BETWEEN rc.starts_on AND rc.ends_on`. Prova por dado, em QA com ROLLBACK ou conta de teste: (a) cobertura com `ends_on = ontem` e um turno de hoje do coberto → o cobridor NÃO opera; (b) cobertura cobrindo hoje → opera; (c) turno fora da janela (data anterior a `starts_on`) → não opera. Complementa com o teste unitário de `buildShiftWindow` (fuso America/Sao_Paulo).
