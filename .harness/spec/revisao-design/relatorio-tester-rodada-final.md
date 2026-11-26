# Relatório do harness-tester — rodada pré-publicação (rodada 1 + Rodada 2: lote)

**Veredito geral: PARCIAL.** Rodada 1 (flags desligadas) abaixo; a seção "Rodada 2: lote" vem primeiro porque supera o D-1 e a limitação "lote não testado".
Ambiente: http://localhost:5173 (dev Vite, commit 7a1b86ec), banco de produção, 26/11/2026 ~02:50–03:50 (BRT). Contas: e2e-empresa e e2e-worker. Senha usada só nos campos de login.

---

# Rodada 2: lote (VITE_FEATURE_LOTE=true, AVISOS=true, presença desligada)

**Veredito da rodada 2: PASS com 1 SUSPEITA ALTA (cancelamento) e 2 defeitos baixos.** D-1 da rodada 1 está resolvido (a tela "Criar turnos" aparece).

## Resultados por item
1. **Lote de 3 turnos `ZZ-TESTE lote A` — PASSOU.** `/company/create` mostra "Criar turnos" ("Um ou vários de uma vez. Nada é publicado sem o seu toque."), "Comece de um modelo" (6 modelos + "Repetir o fim de semana passado/a semana passada"), "Turnos a partir de texto", "Criar do zero". Modelo "ZZ-TESTE final A" → "Mais detalhes" (título mudado para `ZZ-TESTE lote A`) → "Várias datas" → 27/11, 29/11, 30/11 → "Revisar (3)" → revisão ("3 turnos · 3 vagas · R$ 3,00 previstos") → "Chamar freelas > Escolher pessoas" (Worker E2E) → **duplo clique em "Publicar 3"** → "3 turnos publicados · lote 26/11", chamados "2 enviados · enviando 1". Em `/company/jobs` há **exatamente 3** `ZZ-TESTE lote A` (sem duplicata), agrupados em "Lote de 26/11 · N turnos". Aviso de conflito aparece na revisão ("Worker E2E já está em outro turno nesse horário.") e a "Frequência na semana: 12 turnos…" — avisa, não bloqueia.
2. **Lote inválido — PASSOU (parcial).** Pelo campo "Colar ou digitar" (2 linhas: uma com data de ontem 25/11 e outra "sem horario"): a linha de ontem vira cartão com "Falta: valor.", "Esta data já passou." e "Já existe um turno parecido (mesma data, entrada e função)." + "Ver turno parecido"; rodapé "Corrija 2 pendências para publicar." e **"Publicar 1" desabilitado**; a linha sem horário não vira turno e aparece em "Confira o que ficou de fora": `Não entendi "…sem horario…": não sei interpretar "sem". Escreva as datas, por exemplo "sex e sáb" ou "29/11".` **Nada foi publicado.** Não testei o caso "linha sem horário" pelo editor de linhas (a entrada de texto o descarta antes); só a mensagem de fora.
   - Observação: o parser descartou o título digitado ("ZZ TESTE lote B ontem 1" apareceu como "Não entendi"); o cartão ficou sem título, só "Garçom / Garçonete". Esperado pelo modelo de texto, mas o título que o usuário escreve some sem aviso.
3. **Série semanal pelo lote — PASSOU.** "Várias datas" → sáb 28/11 → "Repetir toda semana até…" (12/12) → "Gerar 3 datas" → "Revisar (3)" mostra Sáb 28/11, 05/12, 12/12 → "Publicar 3" → "3 turnos publicados" (cada um "Sem chamado · Chamar"). Em Turnos: "Série · todo sábado". Menu da série: "Convidar para a série", "Editar os futuros", "Encerrar a série", "Excluir".
4. **Convite → aceite → empresa vê — PASSOU, 13,6 s.** Freela abriu `/dashboard` e recebeu o modal "Convite de turno" (`ZZ-TESTE lote A`, 30/11) em ≤ 1 carregamento; clicou "Aceitar"; a empresa (página `/company/jobs` aberta, sem recarregar) já mostrava o turno "Worker E2E · Contratado" na primeira leitura do script, **no máximo 13,6 s depois do clique** (`Date.now()` no clique = …278106; detecção = …291670; limite superior porque o estado já estava presente quando o script começou). Mecanismo: polling de 20 s (WebSocket bloqueado pela ferramenta, ver T-1 abaixo).
5. **Tela de lote em 390 e 320 — PASSOU, 2 observações.** Medido nas etapas início / editor / várias datas / revisão: sem rolagem horizontal; barra de ação ("Voltar" + "Publicar N") é `position: sticky`, altura 48 px, base em y=743 (390) e y=563 (320), **acima** do menu inferior (topo em 779 / 575) e `elementFromPoint` no centro devolve o próprio botão (não cobre, não é coberto). Alvos: só o checkbox 20×20 (dentro de rótulo) a 390; **a 320 as 31 células do calendário medem 41×44 px (3 px abaixo de 44 na largura)** — BAIXO.
   - Cartão de revisão: "Editar" e "Freelas deste turno" são botões sem contorno nem ícone, parecem texto (afordância fraca) — BAIXO.
   - **Teclado virtual cobrindo campo: NÃO testado** (emulação de viewport não abre o teclado). Só a barra sticky foi medida.

## Defeitos e suspeitas novos
### S-3 · ALTO (suspeita, 1 de 2 tentativas) — "Turno excluído com sucesso." sem efeito
- **Oráculo:** expectativa do usuário (sucesso falso, constitution/patterns "sucesso falso").
- **Passos:** `/company/jobs` → menu "Mais opções do turno" do `ZZ-TESTE lote A` de 29/11 (convite "Aguardando resposta", chamado aberto) → "Cancelar turno" → confirmar "Cancelar turno". Toast: "Turno excluído com sucesso." Recarreguei a página: o turno de 29/11 **continuou** na lista como "Aguardando resposta" e a página `/candidates` mostrou "Chamado aberto … 1 sem responder". Repeti os mesmos passos: dessa vez saiu da lista (0 restantes após recarga).
- **Hipótese:** na 1ª tentativa o clique veio por script logo depois de outro cancelamento (lista em refresh); pode ser corrida minha. Não consegui distinguir. Vale um teste manual: cancelar turno com chamado aberto e conferir após F5.
### D-7 · BAIXO — células do calendário do lote a 320 medem 41×44 (ver item 5).
### D-8 · BAIXO — título digitado no "Colar ou digitar" é descartado sem aviso (item 2).
### Ruído (não é defeito): WebSocket idem rodada 1 (T-1).

## Limpeza e dados deixados (Rodada 2)
- Cancelados pelo produto: `ZZ-TESTE lote A` ×3 (27/11, 29/11, 30/11) e `ZZ-TESTE lote serie` ×3 (28/11, 05/12, 12/12, via "Encerrar a série": "3 turnos cancelados"). Conferido: após recarga `lote A` = 0, `lote serie` = 0.
- **Não** publiquei o lote inválido `ZZ-TESTE lote B` (nada no banco).
- O cancelamento do `lote A` de 30/11 (que o freela tinha aceitado) disparou "1 freela notificado": há notificações de cancelamento na conta do freela. Chamados abertos (`shift_calls`) e linhas de `applications`/`shift_call_targets` dos turnos cancelados ficam no banco (cancelamento é soft delete); não verifiquei se o chamado de 29/11 foi encerrado.
- **Continuam (são da rodada 1):** `ZZ-TESTE final A` (28/11, freela contratado, aberto) e `ZZ-TESTE final B hoje` (concluído, pago, termo aceito).

---

# Rodada 1 (flags desligadas)

Viewports medidos: 1440 (empresa e freela), 1024, 390, 320, nos dois papéis (script de medição por rota). Sem 4xx/5xx em nenhuma requisição (resource timing nos dois Chromes). Console: só ruído de WebSocket (ver T-1), sem erro de aplicação.

## Defeitos

### D-1 · ~~ALTO~~ RESOLVIDO na rodada 2 (flags ligadas)
- Antes: `/company/create` renderizava o formulário antigo porque `frontend/.env.local` não definia `VITE_FEATURE_LOTE/PRESENCA/AVISOS`. Agora mostra "Criar turnos". **Atenção para a Vercel:** as mesmas variáveis precisam existir lá, senão o lote não aparece em produção.

### D-2 · MÉDIO — menu inferior do freela trunca rótulos a 320
- Oráculo: design-system (texto cortado no BottomNav) / expectativa do usuário.
- Freela, 320×640, qualquer tela: "Empres…", "Recebimen…", "Mensag…". O da empresa (5 itens) cabe. Repro: login freela → emulate 320 → `/my-jobs`.

### D-3 · MÉDIO — informação de horário cortada em linhas de lista (390)
- Empresa `/company/dashboard` ("Contratados"): "Qua., 25/11 · 01:10–04…" (horário final perdido quando o botão "Presença e pagamento" é largo).
- Freela `/recebimentos`: "Restaurante E2E · turno de 25…" (data cortada) e `/my-jobs` a 320: "Restaurante E…".
- Oráculo: expectativa do usuário (dado útil truncado em vez de quebrar linha).

### D-4 · MÉDIO — alvo de toque pequeno no Elenco
- Empresa `/company/team` ("Meu Elenco"), 390 e 320: botão/link do nome do freela mede 78×20 px (< 44). Medido por `getBoundingClientRect`.

### D-5 · MÉDIO — "Turno alterado" não chegou ao vivo (suspeita forte, 1 tentativa)
- Empresa editou saída 12:00→13:00 em `/company/jobs/<id>/edit`; "Turno atualizado com sucesso!". Freela estava em `/dashboard` e **não** recebeu aviso em 40 s. A notificação "Turno alterado" existe e estava na lista ao navegar para `/notifications` ("A empresa alterou data, horário, local ou valor do turno…"). Polling é de 20 s e só roda com aba visível (`liveRefresher.ts`); a janela do freela provavelmente estava oculta, então pode ser a ferramenta. Não consegui separar produto de ferramenta.
- Observação: o campo Valor está desabilitado na edição ("O valor não pode ser alterado após a criação."), então "empresa altera valor" não é possível; só horário foi testado.

### D-6 · BAIXO
- Chips de filtro (`/company/jobs`, 1440): última chip "Concluídos" com borda direita cortada (container `worki-scroll-row` com `px-0` e `overflow-x:auto` no `md`).
- Heading: `/recibo/:jobId` abre com `h2` ("Você recebeu R$ 1,00…?") antes do `h1` "Recibo de Pagamento".
- `/my-jobs` a 320: aba "Agendados" cortada no meio da palavra (a lista rola, há fade; "Histórico" some).
- Sidebar do freela mostra "… Nível 1 · 0 XP" durante o carregamento (número fabricado transitório), depois "Nível 4 · 725 XP".
- Toast "Turno criado! Convide um freela do seu elenco." persiste após navegar para outra tela (`/candidates`) e para a tela do chamado.
- `/company/trilha` (trilha desligada) mostra subtítulo "Conclua marcos e receba bônus por PIX." acima de "A trilha não está disponível para você agora" (promete o que está desligado).
- ~8 GET `auth/v1/user` em rajada a cada navegação (todas 200). Dev/StrictMode duplica o resto; confirmar no build.
- Rótulo "Esta Semana" capitalizado diferente de "Hoje"/"Amanhã" (`/company/jobs`).

## Suspeitas (não reproduzidas como defeito)
- **S-1** Dados pessoais: `team_connections?select=…workers(…phone,pix_key…)` e `applications?select=…phone,pix_key` são lidos em telas que não os exibem (criar turno, candidatos). Elenco aceito, então RLS permite; é minimização de dados (LGPD), 1 observação.
- **S-2** "Contratados"/"Agendados" mantêm turnos de ontem (25/11) como "Aguardando chegada" com botão "Registrar chegada" (resíduo de testes anteriores). Em produção real, turno vencido sem presença não some nem muda de estado.

## T-1 · Tempo real: ferramenta, não produto
- `new WebSocket('wss://<supabase>/realtime/v1/websocket')` e `ws://localhost:5173` falham em **0–1 ms** com `net::ERR_INTERNET_DISCONNECTED` nos DOIS Chromes (`navigator.onLine` é true). Bloqueio do ambiente de automação; não é o app. Consequência: Realtime por WebSocket **não foi verificado**.
- O fallback (`useLiveRefresh`, polling 20 s + foco) funcionou nos dois sentidos, sem recarregar a página:
  - empresa cria convite → freela recebeu o modal "Convite de turno" ao abrir `/dashboard` (≤20 s);
  - freela aceita (duplo clique) → empresa viu o aviso "Worker E2E aceitou o turno…" e "Contratados (3→4)" sem recarregar;
  - freela "Registrar chegada" → a tela da empresa mudou para "Confirmar Chegada"; "Registrar saída" → "Confirmar saída" (ambos sem recarregar).
  - Tempos da rodada 1 NÃO cronometrados com precisão (cada espera retornou antes de 30 s). Na rodada 2 o aceite foi cronometrado: ≤ 13,6 s.

## O que passou
- Login nos dois papéis; primeira dobra, menu lateral (1440), rail de ícones com nomes e ≥44 px (1024), menu inferior (390/320): nada cobre nada, sem rolagem horizontal da página em **nenhuma** rota a 1440/1024/390/320 (`scrollWidth == clientWidth`).
- Criar turno: data passada rejeitada com "Escolha uma data que ainda não passou."; duplo clique em "Criar turno" → 1 único `POST /jobs` (201). Duplo clique em "Enviar convite" do chamado → 1 `shift_call_targets` POST. Duplo clique em "Aceitar" (freela), "Confirmar Chegada" (empresa) e "Confirmar Registro" (pagamento) sem duplicar efeito visível.
- Fluxo do dia (turno `ZZ-TESTE final B hoje`, R$ 1,00): chamado → aceite ("Vaga garantida!") → "Registrar chegada" → empresa "Chegada confirmada!" → freela saída → empresa "Saída confirmada!" → "Registrar pagamento" (PIX, R$ 1,00) → "Pagamento registrado!" → freela `/recibo/<id>`: a 390×844 o valor "R$ 1,00" está no título (acima da dobra); o botão "Aceitar termo e confirmar recebimento" fica em y≈577 px (visível, 48 px) mas desabilitado até abrir "Ler o termo inteiro" (y≈380, 44 px) e marcar o checkbox. Confirmou ("Recebimento confirmado!"); recarregou e persistiu ("Termo aceito em 26/11/2026 às 02:59", "Recebimento confirmado em …"). Sem `{{placeholder}}` no termo. Recebimentos: "Total recebido R$ 461,00" = Ganhos do Início após recarga; "7 turnos realizados" = Resumo do perfil.
- Check-in padrão funciona como antes (presença verificada desligada: sem QR/GPS, não testado, conforme instrução).
- Chamado: aviso de vínculo ("Já 11x esta semana… tolera até 2x/semana") aparece, não bloqueia.
- `/company/trilha` degrada com mensagem; `/company/hoje`, `/operacao`, `/organization`, `/indicacoes` abrem sem erro.
- Copiloto: botão "Ajuda e copiloto" **não apareceu** (só "Como faço…?"), então nada foi aberto.

## Não testado (e por quê)
- **CPF (passo 5):** a leitura usa `get_my_worker_profile` (200) e exibe CPF só ao próprio freela (um CPF de teste conhecido, 529.***.***-25). **Edição não testada:** o CPF da conta e2e já está gravado e o formulário diz "O CPF … não muda por aqui" (somente leitura; `set_my_worker_identity` só é chamado quando o CPF está vazio, `Profile.tsx` 523–545). Nascimento não aparece no perfil. CPF inválido / salvar / recarregar: **sem conta de teste sem CPF**. Nenhum CPF foi digitado.
- WebSocket Realtime (T-1); avisos pela fila (flag ligada na rodada 2, mas sem canal externo, nada a ver na UI); presença verificada (não existe).
- 320/1024 só varridos por script (sem inspeção visual de todas as telas); Mensagens, Perfil da empresa, Gestão, Relatórios medidos mas não fotografados.
- Offline, rede lenta, PWA, teclado (Tab/Esc nos modais, teclado virtual), "Intruso", paisagem 844×390.
- Rodada 2: "linha sem horário" pelo editor de linhas; "Editar os futuros"/"Convidar para a série" da série.

## Linhas da matriz COBERTURA que mudariam
Criar turno (dupla submissão, data passada): ✅. Convite→aceite→check-in→saída→pagamento→recibo (modo A) 390: ✅. Varredura 1440/390 empresa+freela: ✅ (medida). **Lote (criar 3, duplo clique, inválido, série, 390/320): ✅.** Cancelar turno com chamado aberto: 🔶 (S-3). CPF edição: ⬜.

## Dados ZZ-TESTE deixados no banco de produção (estado final)
- `ZZ-TESTE final A` (28/11, 10:00–13:00, R$ 1,00): freela contratado, **agendado, aberto**. Sugestão: cancelar pelo produto.
- `ZZ-TESTE final B hoje` (26/11): concluído; 1 chamado aceito; presença registrada; pagamento R$ 1,00 registrado e confirmado; termo aceito (recibo nº 2A10CCF8).
- Notificações nas duas contas (convites, aceites, alteração, pagamento, cancelamento do lote). Soft delete: os 6 turnos de lote cancelados continuam como linhas com status excluído.
- Resíduos de rodadas anteriores (`ZZ-TESTE rodada1 A`, `rodada2 …`, `equipe …`) não são desta rodada.
