# Relatório do harness-tester — Rodadas 1 (local, flags off), 2 (local, lote) e 3 (produção)

Ordem: Rodada 3 (produção) primeiro; depois Rodada 2 (lote) e Rodada 1 (base). Contas: e2e-empresa e e2e-worker. Senha usada só nos campos de login, nunca registrada.

---

# Rodada 3: produção (https://worki-opal.vercel.app, 26/11/2026 ~04:10–04:50 BRT)

**Veredito: PASS** (nenhum defeito bloqueante; 1 MÉDIO novo, 3 BAIXOS). Bundle no ar: `assets/index-Csp6ROGO.js`; flags LOTE e AVISOS ligadas (tela "Criar turnos" aparece); presença desligada.

## Checagens pedidas
1. **Site novo no ar — OK.** `/licencas` responde 200 e mostra "Licenças de código aberto" (+ link "Baixar em texto"). Cabeçalho `Permissions-Policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()` (lido por `fetch('/licencas')`). CSP presente.
2. **Empresa: lote em produção — OK.** `/company/create` = "Criar turnos" (modelo + "Várias datas"). Modelo "ZZ-TESTE final A" → título `ZZ-TESTE prod lote` → 27/11 e 29/11 → "Revisar" → "Chamar freelas > Escolher pessoas (Worker E2E)" → **duplo clique em "Publicar 2"** → "2 turnos publicados · lote 26/11", "Chamados: 2 enviados". Em Turnos: exatamente 2 `ZZ-TESTE prod lote` ("Lote de 26/11"). **Freela aceitou:** convite 29/11 → "Aceitar" às …779148; a empresa (aba visível, em `/company/create`) mostrou o aviso `Worker E2E aceitou o turno "ZZ-TESTE prod lote" de 29/11.` às …798624 = **19,5 s** (≤30 s). O 2º convite (27/11) também foi aceito; a lista de Turnos aberta da empresa passou a mostrar "Contratado" nas duas linhas sem recarregar (observado dentro da janela de 45 s; não cronometrei esse segundo com precisão).
3. **Freela 390 e 1440 — OK.** Início, Meus Turnos, Carteira (Empresas), Recebimentos, Mensagens, Perfil, Notificações, Indicações: sem rolagem horizontal, sem erro de aplicação no console, **0 respostas 4xx/5xx** (resource timing; 179 requisições, nenhum 403/42501 em `/rest/v1/workers`). Chamadas a `workers`: todas 200, incluindo `rpc/get_my_worker_profile`. **CPF e PIX:** Perfil mostra "Mostrar CPF" / "Mostrar chave PIX" / "Mostrar onde já trabalhei…" (44×44 px); depois do clique viram "Ocultar CPF"/"Ocultar chave PIX" e, com "Identidade" expandida, o CPF aparece completo (formato ###.###.###-##; um CPF de teste conhecido, não registrado aqui). Não alterei CPF nem nascimento (só observei). **Etapa 2 do CPF (authenticated sem leitura direta de `workers.cpf/birth_date`):** nenhum 42501/403; Sidebar (nome/nível), Início, Meus Turnos, Perfil carregam; empresa abre **Candidatos** (`/company/jobs/<id>/candidates`), **Elenco** (`/company/team`), Início, Hoje, Turnos, Gestão, Mensagens, Relatórios sem erro na tela e 0 4xx/5xx.
4. **Login e cadastro, nova casca, 390 e 320 — OK.** `/login` (freela e empresa) e "Cadastre-se" ("Criar conta de freela/empresa"): sem rolagem horizontal, botão primário visível (y≈562 a 320), alternância "Sou freela/Sou empresa" funciona. (`/cadastro` não existe: 404 "Página não encontrada"; o cadastro é uma aba de `/login`.)
5. **Faixa "Instale o Worki" e "sem internet" — FALHA PARCIAL (D-9).** `emulate Offline` **não é possível** aqui ("Network throttling is not supported when network blocking is configured"); simulei com `navigator.onLine=false` + evento `offline`: aparece "Você está sem internet. Algumas telas podem não carregar." (não é o offline real, só a camada de UI).

## Defeitos novos (produção)
### D-9 · MÉDIO — "Instale o Worki" cobre conteúdo e ações; empilha com o aviso de offline (390)
- **Oráculo:** design-system (camadas: nada cobre ação principal) / expectativa do usuário.
- **Passos:** login empresa → emulate 390×844 → `/company/jobs` (primeira visita, banner ainda não dispensado) → simular offline (`navigator.onLine=false` + `window.dispatchEvent(new Event('offline'))`).
- **Obtido:** a faixa "Instale o Worki / Abra seus turnos direto da tela inicial. [Agora não] [Instalar]" fica sobre a lista, acima do menu inferior (≈ y 654–767), com o aviso "Você está sem internet…" empilhado logo acima (≈ y 597–645). Juntos tapam ~170 px da lista, inclusive os botões "Chamar" das linhas seguintes, até o usuário tocar "Agora não". No freela a faixa também cobre o cartão "Nível/XP" em `/profile` (390). No PC (1440) fica no rodapé do conteúdo.
- **Esperado:** a faixa não cobrir linhas de ação (reservar espaço ou encolher), ou aparecer só em tela sem lista de ações.
- **Frequência:** sempre na 1ª visita por aparelho.
- **Suspeita de origem:** componente de convite de instalação (PWA) e aviso offline, ambos em fluxo `fixed` acima do BottomNav.
### D-10 · BAIXO — "Baixar em texto" em `/licencas` mede 104×16 px (alvo < 44 px, 390).
### D-11 · BAIXO — no cadastro (390) os links "Termos de Uso" (86×14) e "Política de Privacidade" (211×30) são alvos pequenos (inline em frase).
### D-12 · BAIXO — telefone aparece sem "Mostrar" no Perfil, enquanto CPF e PIX têm máscara (pode ser intencional; confirmar a regra).

## Não testado (rodada 3)
- Offline real (`emulate Offline` bloqueado); SW/banner de atualização; "Instalar" de fato.
- WebSocket Realtime (bloqueado pela ferramenta, T-1); o que funcionou foi o polling.
- Gravação de nascimento/CPF (só observação, conforme pedido).
- Teclado virtual, paisagem, 1024/320 das telas logadas.

## Limpeza (produção) e dados deixados
- Cancelados/excluídos pelo produto, todos `ZZ-TESTE` da conta e2e: `prod lote` ×2 (27/11 e 29/11), `final A` (28/11), `rodada2 D-vinculo` (27/11) ("Cancelar turno", freela notificado) e 4 turnos vazios `equipe reg-B`, `equipe enc-1`, `equipe reg-C`, `equipe reg-F` ("Excluir"). Recarreguei: **não há turno futuro/aberto restante** em Turnos.
- **Ficaram** (passados ou concluídos, não cancelei para não mexer em histórico/pagamento): `ZZ-TESTE final B hoje` (concluído, pago R$ 1,00, termo aceito), `pre-pub 2511`, `posreforma A`, `equipe2 enc-3`, `equipe reg-A`, `rodada3 E`, `rodada2 C`, `rodada1 B-checkin`, `rodada1 A` (todos de 25–26/11, na lista "Anteriores"; `rodada1 A` e `rodada1 B-checkin` ainda aparecem como contratados sem presença).
- Notificações geradas nas duas contas (convites, aceites, cancelamentos). Cancelamento é soft delete: as linhas permanecem no banco com status excluído.
- **Sessões abertas:** os dois Chromes continuam logados em produção.

---

# Rodada 2: lote (local, VITE_FEATURE_LOTE=true, AVISOS=true, presença desligada)

**Veredito da rodada 2: PASS com 1 SUSPEITA ALTA (cancelamento) e 2 defeitos baixos.** D-1 da rodada 1 resolvido.

1. **Lote de 3 `ZZ-TESTE lote A` — PASSOU.** "Criar turnos" → modelo → "Mais detalhes" → "Várias datas" (27/11, 29/11, 30/11) → "Revisar (3)" → "Chamar freelas > Escolher pessoas" → duplo clique em "Publicar 3" → "3 turnos publicados · lote 26/11". Em Turnos: exatamente 3, agrupados "Lote de 26/11 · N turnos". Conflito ("Worker E2E já está em outro turno nesse horário.") e frequência ("12 turnos na semana…") só avisam.
2. **Lote inválido — PASSOU (parcial).** Pelo "Colar ou digitar" (linha de ontem + linha "sem horario"): cartão com "Falta: valor.", "Esta data já passou.", "Já existe um turno parecido…"; "Corrija 2 pendências para publicar."; **"Publicar 1" desabilitado; nada publicado.** A linha sem horário vai para "Confira o que ficou de fora": `Não entendi "…": não sei interpretar "sem". Escreva as datas, por exemplo "sex e sáb" ou "29/11".` Não testei "sem horário" pelo editor de linhas.
3. **Série semanal — PASSOU.** "Repetir toda semana até…" (12/12) → "Gerar 3 datas" → Sáb 28/11, 05/12, 12/12 → "Publicar 3". Em Turnos: "Série · todo sábado". Menu: "Convidar para a série", "Editar os futuros", "Encerrar a série", "Excluir".
4. **Convite → aceite → empresa vê — PASSOU, ≤13,6 s** (polling; limite superior).
5. **390 e 320 — PASSOU.** Sem rolagem horizontal; barra "Voltar/Publicar" sticky (48 px, base y=743 a 390 e y=563 a 320) acima do menu (topo 779/575); `elementFromPoint` devolve o botão. A 320 as 31 células do calendário medem 41×44. Teclado virtual: não testado.
- **S-3 · ALTO (suspeita, 1 de 2) — "Turno excluído com sucesso." sem efeito:** cancelar `lote A` de 29/11 (chamado aberto, "Aguardando resposta") mostrou o toast, mas após recarregar o turno continuou com "Chamado aberto … 1 sem responder"; repeti e saiu. Pode ser corrida do meu script de limpeza. Teste manual com F5 recomendado. (Em produção, rodada 3, os cancelamentos conferidos após recarga funcionaram.)
- **D-7 · BAIXO** células do calendário a 320 = 41×44. **D-8 · BAIXO** título digitado no "Colar ou digitar" é descartado sem aviso. "Editar" e "Freelas deste turno" na revisão parecem texto (afordância fraca).
- Limpeza da rodada 2: `lote A` ×3 e `lote serie` ×3 cancelados.

---

# Rodada 1 (local, flags desligadas)

Viewports medidos: 1440, 1024, 390, 320, nos dois papéis. Sem 4xx/5xx. Console: só WebSocket (T-1).

- **D-1 · RESOLVIDO** (rodada 2): `frontend/.env.local` não definia as flags `VITE_FEATURE_LOTE/PRESENCA/AVISOS`. As mesmas variáveis precisam existir na Vercel (confirmado na rodada 3: lote aparece).
- **D-2 · MÉDIO** menu inferior do freela trunca rótulos a 320 ("Empres…", "Recebimen…", "Mensag…"). Repro: freela, 320×640, qualquer tela. (Não reverifiquei em produção.)
- **D-3 · MÉDIO** horário/data cortados em listas a 390: empresa Início "Qua., 25/11 · 01:10–04…"; freela Recebimentos "turno de 25…"; `/my-jobs` a 320 "Restaurante E…".
- **D-4 · MÉDIO** nome do freela em `/company/team` mede 78×20 px (390/320).
- **D-5 · MÉDIO (suspeita)** "Turno alterado" não chegou ao vivo em 40 s (a notificação existia ao abrir `/notifications`); polling de 20 s só com aba visível; pode ser a janela oculta. Valor desabilitado na edição ("O valor não pode ser alterado após a criação.").
- **D-6 · BAIXO** chip "Concluídos" com borda cortada no PC; `/recibo/:id` com `h2` antes do `h1`; aba "Agendados" cortada a 320; sidebar do freela mostra "… Nível 1 · 0 XP" durante o carregamento; toast "Turno criado!" persiste ao trocar de tela; trilha desligada promete "bônus por PIX"; ~8 `auth/v1/user` por navegação; "Esta Semana" capitalizado diferente de "Hoje/Amanhã".
- **S-1** `team_connections`/`applications` selecionam `phone, pix_key` em telas que não os exibem (minimização LGPD). **S-2** turnos de ontem seguem "Aguardando chegada" com "Registrar chegada".
- **T-1 Tempo real:** `new WebSocket` falha em 0–1 ms com `ERR_INTERNET_DISCONNECTED` nos dois Chromes (ferramenta, não produto); o polling de 20 s funcionou em convite, aceite, chegada e saída.
- **Passou:** login, menus (1440/1024/390/320) sem sobreposição nem rolagem horizontal; criar turno com data passada rejeitada; duplo clique em criar/convidar/aceitar/confirmar sem duplicar; fluxo do dia completo no 390 (chegada, saída, pagamento R$ 1,00, recibo com termo aceito, persistiu após recarga; valores consistentes entre Recebimentos, Início e Perfil); aviso de frequência não bloqueia; trilha degrada; copiloto não apareceu.
- **Não testado:** edição de CPF (CPF e2e já gravado e somente leitura: "O CPF … não muda por aqui"; sem conta de teste sem CPF); offline/lento, PWA, teclado, paisagem; Mensagens/Gestão/Relatórios só medidos.
- **Linhas da matriz que mudariam:** criar turno ✅; fluxo convite→recibo (modo A) 390 ✅; lote (criar 3, duplo clique, inválido, série, 390/320) ✅; lote em produção ✅; CPF Mostrar via RPC ✅; cancelar turno com chamado aberto 🔶; CPF edição ⬜; offline real ⬜.
