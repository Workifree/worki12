# Copiloto Worki: mapa de intenções

Levantado em 25/11/2026, branch `feat/equipe-encarregados`. Código lido em `frontend/src`; RLS, triggers, grants e RPCs
conferidos no catálogo de produção (`vrklakcbkcsonarmhqhp`), só SELECT em metadados.
**Nenhuma escrita foi testada**: toda lacuna abaixo vem da leitura de policy + grant + trigger.
Outro agente edita a UI agora: as linhas de `pages/` e `components/` podem deslocar. Ancorar pelo nome da função.

> Divergência com o memory-bank: ele diz que E2 a E5 não foram aplicadas. No catálogo existem `session_can_operate_job`,
> `cancel_job`, `reassign_job_responsible`, os convites de E4 e os guards de `applications` (20261125).

## 0. Convenções

| Classe | O copiloto pode | Critério |
|---|---|---|
| **A** | ler, explicar, navegar, destacar | nenhuma escrita (ver §1: navegar nem sempre é A) |
| **B** | preencher sem enviar | a pessoa toca no botão final. Inclui o que envia aviso a terceiro ou não se desfaz, sem ser D |
| **C** | executar com confirmação | reversível de verdade, sem terceiro prejudicado |
| **D** | só guiar e destacar | dinheiro ou registro de pagamento, excluir ou cancelar vínculo, remover/bloquear, Termos, aceitar/recusar convite ou consentimento, senha/CPF/PIX, acesso, prova de presença |

Abreviações: `SIS` shiftInviteService, `SCS` shiftCallService, `PRS` paymentRecordService, `TCS` teamConnectionService,
`SOS_` sosService, `TMS` teamMembersService, `SOP` shiftOperationService, `TLS` teamListService, `JSS` jobSeriesService,
`REF` referralService, `CERT` certificationService, `ATT` attendanceConfirmationService (todos em `services/*.ts`).
`CJC` = `pages/company/CompanyJobCandidates.tsx`. "direto" = `supabase.from` dentro da tela, sem service (o copiloto
precisaria extrair um service antes de executar).

Papéis: **G** Gestor (dono, `manager`, operador de organização); **E** Encarregado confirmado; **F** freelancer.
Encarregado não confirmado só vê `AguardandoConfirmacao`; quem foi removido vê `AcessoEncerrado`.
Nos dois estados o copiloto fica em classe A, só explicando.

## 1. Rotas em que "só navegar" age (bloqueio obrigatório)

| Rota / gesto | Efeito ao montar | Regra |
|---|---|---|
| `/convite/:token` | **aceita o vínculo sozinho** no `useEffect` (`pages/InviteAccept.tsx:111-113`, `TCS:313,333`) | nunca navegar |
| `/convite-gerente/:token` | **aceita o convite de gerente sozinho** (`pages/AcceptManagerInvite.tsx:78`) | nunca navegar |
| `/convite-equipe/:token` | conclui o aceite com Termos se houver aceite pendente no aparelho (`pages/AcceptTeamInvite.tsx:~170`) | nunca navegar |
| `/login?redirect=/convite...` | cai nas rotas acima | nunca navegar |
| `/messages?conversation=` e `/company/messages?conversation=` | marca mensagens como lidas (`Messages.tsx:75,89`; `CompanyMessages.tsx:226`) | só a pedido |
| `/company/worker/:id` | registra visita ao perfil (`WorkerPublicProfile.tsx:84`) | só a pedido |
| `/company/trilha` | `bonus_get_my_trail` sem `p_light` roda a avaliação no banco | só a pedido |
| `/company/jobs/:id/candidates?chamar=1` | abre o modal de chamado (não envia) | permitido (B) |
| clique em notificação | marca lida e vai para `link` gravado por outra pessoa | o copiloto nunca segue `link` |
| `/admin` | área administrativa | fora do copiloto |

`navigate` deve ser **lista de permissão** de rotas com parâmetros tipados, nunca string livre vinda do modelo ou do banco.
`safeInternalPath` (`lib/safeRedirect.ts`) aceita `/convite/...`: não basta.

## 2. Empresa: Gestor

| ID | Intenção ("fala" do usuário) | Rota e elementos | Execução (arquivo:linha) | Parâmetros | Risco |
|---|---|---|---|---|---|
| G01 | "o que tenho hoje / amanhã?" | `/company/hoje`, `/company/dashboard`; cartões "Abrir turno" | `SOP:682` listJobsByResponsible, `SOP:744` listOwnJobs | companyId, from, to, responsibleId?, tagId? | A |
| G02 | "achar turno X" | `/company/jobs?filter=all\|open\|closed\|andamento` | leitura direta; escopo `jobScopeService.ts:19,47` | filter | A |
| G03 | "criar turno amanhã 18h" | `/company/create`; campos por `aria-label` (Título, Função, Quantas pessoas, Descrição, Data, Entrada, Saída, Valor) | direto `CompanyCreateJob.tsx:425`, insert `:566` | title*, category* (slug de `shiftCategories.ts`), description*, start_date*, work_start_time*, work_end_time*, budget*>0, slots, location, has_lunch, briefing, requirements, certification_requirement, tag | **B** |
| G04 | "repetir toda sexta" | mesmo form, `#job-repeat`; "Repetir até" | `JSS:176` rpc `create_job_series` | G03 + weekdays (0=dom), rangeEndDate; máx. 60 | B |
| G05 | "repetir o turno de ontem" | `/company/create?repetir=<jobId>` | só pré-preenche | jobId | B |
| G06 | "mudar horário/valor" | `/company/jobs/:id/edit` | direto `CompanyCreateJob.tsx:547` | G03 | B (sem trava, §6) |
| G07 | "pausar / reabrir turno" | `/company/jobs`, `/company/jobs/:id` | direto `CompanyJobDetails.tsx:126`, `CompanyJobs.tsx:480` | id, status open\|paused | C |
| G08 | "excluir / cancelar turno" | "Excluir", "Cancelar turno" (`CancelJobModal`) | `deleteShiftService.ts:39`, `SOP:413` rpc `cancel_job` | jobId, reason | **D** |
| G09 | "editar a série daqui pra frente" | `EditSeriesModal` | prévia `JSS:304` (A), aplicar `JSS:246` | seriesId, fromDate, patch | prévia A; aplicar B |
| G10 | "encerrar a série" | `CancelSeriesModal` | prévia `JSS:408`, aplicar `JSS:362` | seriesId, fromDate | prévia A; aplicar **D** |
| G11 | "chamar freelas" | `/company/jobs/:id/candidates?chamar=1`; `ShiftCallModal` (chips de lista, busca, motivo, validade) | `SCS:143` createShiftCall | jobId, workerIds[], reason, expiresAt, message | **B** |
| G12 | "convidar só a Fulana" | `InviteToShiftModal`, "Convidar para turno" (`MemberCard`) | `SIS:262` que delega a `SCS:143` | jobId, workerId | B |
| G13 | "quem respondeu ao chamado?" | `ShiftCallsPanel` | `SCS:261`, `SIS:744` | jobId | A |
| G14 | "parar de procurar" | painel, "Cancelar" e depois "Sim, cancelar o chamado" | `SCS:294` rpc `cancel_shift_call` | callId | C (não desfaz quem aceitou) |
| G15 | "SOS fora do elenco" / "por que o SOS não abre?" | `SosCallButton` | elegibilidade `SOS_:90`; abrir `SOS_:108` | jobId, reason, message | consultar A; abrir **B** (gasta cota, fala com desconhecidos) |
| G16 | "cancelar o convite do Fulano" | CJC "Cancelar Convite" | `SIS:365` | applicationId | **D** (a candidatura não reabre) |
| G17 | "dispensar / chamar substituto" | CJC "Dispensar..." | `SIS:445` | applicationId | **D** |
| G18 | "contratar candidato" (fluxo pull) | CJC "Contratar" | direto `CJC:547` | applicationId, status | **D** |
| G19 | "pedir confirmação de véspera" | CJC "Pedir confirmação" | `ATT:118` (tem cooldown) | applicationId | B |
| G20 | "avisar no WhatsApp" | CJC "Avisar no WhatsApp" | `CJC:683`, `SIS:799,835` abre `wa.me` | applicationId | B (o telefone nunca vai ao LLM) |
| G21 | "confirmar chegada/saída" (também com horário manual) | CJC "Confirmar Chegada/Saída", `#manual-attendance-time` | direto `CJC:1048,1075,1140` | applicationId, hora | **D** (gravou, não muda; é prova do pagamento) |
| G22 | "pagar o Fulano" | CJC "Registrar Pagamento", `#payment-amount/-paid-at/-note`, copiar PIX | `PRS:253` | jobId, workerId, amount, source, paidAt, note | **D**. Explicar: paga por fora, aqui só registra |
| G23 | "agendar pagamento" | CJC "Agendar Pagamento" | `PRS:339` | idem + scheduledFor | **D** |
| G24 | "marcar como pago" | CJC | `PRS:424` | paymentId | **D** |
| G25 | "estornar" (só G) | CJC | `PRS:676` | paymentId, reason | **D** |
| G26 | "confirmar entrega / liberar" (legado com escrow) | CJC "Confirmar Entrega" | `CJC:573`, `walletService.ts:208` | jobId, workerId | **D**; nunca vira ferramenta |
| G27 | "ver recibo" | `/recibo/:jobId?worker=` | `PRS:538,551` | jobId, workerId | A (navegar; não ler o conteúdo) |
| G28 | "quanto gastei no mês?" | `/company/relatorio`; Hoje/Semana/Mês, CSV, Imprimir | `orderReportService.ts:235` | from, to, status | A (agregado); exportar B |
| G29 | "como anda a operação?" | `/company/operacao` | `operationAnalyticsService` | period | A |
| G30 | "avaliar o freela" | CJC "Avaliar", `#review-comment` | direto `CJC:938` (`:963`) | jobId, workerId, rating, comment | B (a nota é da pessoa) |
| G31 | "meu elenco / quem está pendente" | `/company/team` | `TCS:540,613`, `workerCardsService.ts:18` | - | A |
| G32 | "convidar freela pro elenco" | "Copiar link", "Adicionar Freela" (`AddWorkerModal`) | link `TCS:181`; adicionar `TCS:108,313` | workerId, source | guiar e destacar (B). O token nunca vai ao LLM |
| G33 | "remover ou bloquear do elenco" | `RemoveMemberDialog` | `TCS:790` (bloqueio `TCS:475`) | workerId | **D** |
| G34 | "criar/renomear lista (turma)" | `/company/team` "Nova lista", `TeamListModal` | `TLS:134,194,238` | name, workerIds | C |
| G35 | "excluir lista" | idem | `TLS:303` | id | **D** |
| G36 | "ver perfil do freela" | `/company/worker/:id` | leitura direta + `badgeService.ts:83` | workerId | A (com §1) |
| G37 | "conferir certificação / registrar treinamento / revogar" | `WorkerCertificationsPanel` | `CERT:280,317,401,454` | certId; title, completedAt; reason | B (declaração da empresa); revogar **D** |
| G38 | "indicar freela / retirar indicação" | `/company/indicacoes` | `REF:211`, `REF:284` | workerId, empresas, message | indicar B; retirar C |
| G39 | "falar com o freela / responder" | `/company/messages`, CJC chat | envio `CompanyMessages.tsx:333` (`:354`); criar conversa `CJC:1000` | conversationId, content | **B** |
| G40 | "convidar encarregado" | `/company/configuracoes/equipe`, `#invitee-name/-phone` | `TMS:130`; reenviar `:161` (mata o link antigo); revogar `:180` | companyId, displayName | **D** (acesso) |
| G41 | "é ele? confirmar / rejeitar" | idem | `TMS:236,262` | userId, typedName | **D** |
| G42 | "remover da equipe" | idem | `TMS:286` (dry run é A) | companyId, userId | **D** |
| G43 | "novo link do elenco" | "Gerar novo link do Elenco" | `TMS:357` | companyId | **D** |
| G44 | "cobrir / passar turnos" | `/company/hoje` `CoverageModal`, `PassJobsModal` | `SOP:319,348,302` | from, to, datas; jobIds, to | **D** (muda quem acessa) |
| G45 | "etiquetas" | `TagsPanel` | `SOP:605,629`; arquivar `:617` | name; jobId, tagId | C; arquivar B |
| G46 | "unidades / convidar gerente" | `/company/organization` | `organizationService.ts:83,126,150` | companyId, email | ver A; resto **D** |
| G47 | "trocar de unidade" | `CompanySwitcher` | `companyScopeService.ts:245` | companyId | C |
| G48 | "briefing padrão / perfil / alerta de vínculo" | `/company/profile` | direto `CompanyProfile.tsx:147` (`:178`) | campos | B (nunca CNPJ) |
| G49 | "logo/capa" | idem | `CompanyProfile.tsx:242` | arquivo | A (guiar) |
| G50 | "senha / excluir empresa / sair" | idem | `CompanyProfile.tsx:215,341,327` | - | **D** |
| G51 | "aceitar os Termos" | `TosGateModal` | direto `TosGateModal.tsx:55-68` | - | **D**; copiloto oculto com o modal aberto |
| G52 | "bônus / trilha / saque / PIX" | `/company/trilha` | `components/bonus/rpcApi.ts:127-160` | pixKey | ver A (§1); aceitar, PIX, sacar **D** |
| G53 | "indicações que recebi / notificações" | dashboard, `/company/notifications` | `REF:322`; `NotificationContext.tsx:110-140` | id | ler A; marcar lidas C |
| G54 | "completar cadastro" | `/company/onboarding` | direto `CompanyOnboarding.tsx:139` | CNPJ etc. | **D** |

## 3. Encarregado (herda só o que está aqui)

| ID | Intenção | Como difere do Gestor | Risco |
|---|---|---|---|
| E01 | "meus turnos de hoje" | `/company/hoje`; só os próprios ou cobertos (`jobScopeService.ts:47`) | A |
| E02 | "criar turno" | G03/G04; banco exige `responsible_id` = ele (policy `jobs_insert_company_owner`). Série: `job_series_insert` exige Gestor, então a opção deve falhar para ele (não testado) | B |
| E03 | "chamar freelas / ver respostas / cancelar chamado / SOS" | G11 a G15, via `is_job_owner` (SOS: confirmar pela elegibilidade) | iguais |
| E04 | "presença, confirmação, WhatsApp, avaliar" | G19 a G21, G30, só nos turnos dele | iguais |
| E05 | "pagar quem trabalhou" | G22 a G24 permitidos; PII só por `workerCardsService.ts:34` (`get_shift_worker_payment_card`). **Estornar é negado** pelo trigger | **D** |
| E06 | "cancelar turno" | só `cancel_job`; update cru para `deleted` só passa em turno vazio (`jobs_soft_delete_guard`) | **D** |
| E07 | "trazer freela pro elenco" | pode inserir só `pending` (`tc_insert_company`); não remove nem bloqueia | B |
| E08 | "passar meus turnos / cobrir meus turnos" | `SOP:302,319` | **D** |
| E09 | "minha trilha de bônus" | G52 | A / **D** |
| E10 | "por que não vejo relatórios, mensagens, equipe, indicações, unidades, dados da empresa?" | `GESTOR_ONLY_ROUTES` (`lib/navigation.ts`), `GestorRouteGuard`, `ProtectedRoute` | A: explicar e dizer para pedir ao Gestor, sem contornar |
| E11 | "aceitar convite da equipe" | `/convite-equipe/:token`, e-mail + código; `TMS:196` | **D**; o copiloto não toca no código |

## 4. Freelancer

| ID | Intenção | Rota e elementos | Execução | Parâmetros | Risco |
|---|---|---|---|---|---|
| F01 | "tenho convite? quando trabalho?" | `/dashboard`, `/my-jobs`, `InviteTakeover` (cobre a tela no `MainLayout`) | `SCS:362,372`, `SIS:691,701` | - | A |
| F02 | "aceitar convite/chamado" | "Aceitar" | `hooks/useShiftInvites.ts:251` (`SIS:549`) e `:264` (`SCS:325` `claim_shift_slot`) | applicationId ou callId | **D** |
| F03 | "recusar" | "Recusar" e depois "Confirmar recusa" | `SIS:549`, `SCS:340` | idem | **D** |
| F04 | "fazer check-in" | `/my-jobs` "Check-in" | direto `MyJobs.tsx:593` (`:598`) | applicationId | **D** (hora do servidor, irreversível, atesta presença) |
| F05 | "check-out" | "Check-out" | direto `MyJobs.tsx:620` (`:625`) | applicationId | **D** |
| F06 | "vou / não vou poder (véspera)" | "Sim, vou" / "Não vou poder" | `ATT:159` | applicationId, response | **D** (declaração) |
| F07 | "cancelar meu turno" | "Cancelar turno" | direto `MyJobs.tsx:651` (`:657`) | applicationId | **D** (não volta; avisa a empresa) |
| F08 | "falar com a empresa" | "Falar com a empresa", `/messages` | criar `MyJobs.tsx:682` (`:697`); enviar `Messages.tsx:316` (`:337`) | applicationId, content | **B** |
| F09 | "avaliar a empresa" | "Avaliar", `RateModal` | direto `MyJobs.tsx:716` (`:733`) | rating, comment | B |
| F10 | "cadê meu pagamento?" | `/recebimentos` | `PRS:603,613` | - | A (o Worki não paga nem deposita) |
| F11 | "ver recibo / imprimir" | `/recibo/:jobId` | `PRS:538` | jobId | A |
| F12 | "confirmar que recebi / aceitar termo" | `ServiceTermSection` | `serviceTermService.ts:180`, `PRS:645` | termId, paymentId | **D** |
| F13 | "minhas empresas / pedido para entrar" | `/carteira` | `TCS:645,703` | - | A |
| F14 | "aceitar empresa / recusar / sair-bloquear" | "Aceitar", "Recusar", "Sair" | `hooks/useTeamConnections.ts:230,257,244` (`TCS:374,442,475`) | connectionId | **D** |
| F15 | "meu link / QR / código" | `/carteira`, `/profile` | `TCS:265` | - | A: destacar "copiar"; token fora do LLM |
| F16 | "quem me indicou / aceitar indicação" | `/indicacoes` | listar `REF:399,355`; `REF:425,457` | referralId | ver A; responder **D** |
| F17 | "ver a empresa antes de aceitar" | `/empresa/:id` | direto + rpc `get_profile_reviews` | companyId | A |
| F18 | "disponibilidade" | `/profile` "Declarar disponibilidade" | `Profile.tsx:485` handleSave (`:523`) | availability_days | B |
| F19 | "editar bio/funções/cidade" | `/profile` "Editar perfil" | idem | campos | B (formulário também tem CPF/PIX: preencher só campos nomeados) |
| F20 | "CPF / chave PIX / telefone / nascimento" | `/profile` "Cadastrar CPF" | idem | - | **D** |
| F21 | "foto/capa" | `/profile` | `Profile.tsx:368` | arquivo | A |
| F22 | "certificação: adicionar/editar/excluir" | `MyCertificationsSection` | `CERT:163,206,248` | title, issuer, nº, datas | adicionar/editar B (editar zera conferência; **dado de saúde é vetado**); excluir **D** |
| F23 | "aparecer no SOS / aceitar indicações / esconder badges" | `SosDiscoverySection`, `ReferralOptOutSection`, `CompanyBadges` | `SOS_:164`, `REF:~503`, `badgeService.ts:114,145` | boolean | **D** (consentimento e privacidade) |
| F24 | "senha / excluir conta / sair" | `/profile` | `Profile.tsx:550,596,582` | - | **D** |
| F25 | "notificações" | `/notifications` | `NotificationContext.tsx` | id | ler A; marcar C |
| F26 | "criar conta / entrar / recuperar senha" | `/login`, `/esqueci-senha`, `/worker/onboarding`, `TosGateModal` | `Login.tsx:134,174`, `ForgotPassword.tsx:38`, `WorkerOnboarding.tsx:279` | - | **D** |
| F27 | "como funciona? / ajuda" | `/ajuda`, `/termos`, `/privacidade` | - | - | A |

### Mecanismo para a classe B
Hoje **não existe pré-preenchimento por URL**, só `?repetir=`, `?chamar=1`, `?filter=` e `?conversation=`.
Não escrever no DOM nem no rascunho em `localStorage` (`lib/jobDraft.ts`, chave interna por usuário+empresa).
Criar uma ponte tipada em memória (`CopilotDraftContext`): a tela registra `applyDraft(schema)`; valida contra lista de campos;
marca o que foi preenchido; nunca chama o handler de envio. Nada na query string (vai para histórico e Sentry).
"Amanhã 18h" se resolve no cliente em `America/Sao_Paulo`. Saída, valor, função e descrição são obrigatórios:
perguntar, não inventar. Em G11 a ponte precisa de `selectedIds`, `reason` e validade; os freelas entram por apelido (`F1`).

## 5. "Por que não vejo X?" (classe A; responder por regra, não por palpite)

| Pergunta | Causas verificáveis |
|---|---|
| "Chamar Freelas" | turno completo (`filledCount >= jobSlots`) ou tela carregando (`CJC:~1330`) |
| SOS | outcome de `sos_call_eligibility`: falta menos de 4h, elenco não tentado, chamado aberto, cota 1 aberto/3 em 7 dias, empresa sem cidade, lotado, iniciado (`SOS_:49-80`) |
| Freela fora do chamado | não está `accepted` no elenco ou já está no turno |
| "Registrar Pagamento" | falta confirmar saída; turno com escrow legado; já há marcador ativo para (turno, freela) |
| Check-in (freela) | já registrado por um dos lados; banco recusa antes de 12h da entrada ou turno cancelado (`applications_update_guard`) |
| Check-out | exige chegada registrada |
| Não aceita o convite | expirado, vaga já preenchida, já respondeu, cancelado antes (outcomes de `claim_shift_slot`) |
| Perfil/PIX do freela (empresa) | só self, vínculo `accepted` (Gestor) ou candidatura em turno da empresa; `pending` não dá acesso |
| Turno (Encarregado) | não é o responsável nem cobre a data; ou ainda não confirmado |
| Menus sumidos | Encarregado (§E10); "Unidades" só com `canSeeOrganization`; "Trilha" só com `useBonusTrailAccess` |
| Chat (gerente que não é o dono) | **defeito provável**: policies de `Message` usam `jobs.company_id = auth.uid()` (§6, L7) |
| Carteira, saque, depósito | pagamento pausado: não existe tela |
| Lista vazia | distinguir erro de carga de vazio: usar as variantes `*Checked` dos services |

## 6. Permissões quando o copiloto chama os mesmos services

Com o mesmo cliente `supabase` e o JWT da pessoa: **mesma RLS, mesmos triggers, mesmas RPCs**. Nunca `service_role`,
nunca ferramenta SQL/`from()`/`rpc()` genérica. Porém:

1. **Trava de interface não acompanha o service**: modais de confirmação, botões escondidos, validações (valor > 0,
   saída antes do pagamento), cooldowns e `GestorRouteGuard` ficam na tela.
2. **Leitura ampla**: `jobs` e `companies` têm SELECT `USING (true)`. Qualquer logado lê turnos de qualquer empresa
   (valor, local, briefing) e CNPJ, e-mail, endereço e `owner_id` das empresas. Toda ferramenta de leitura filtra por empresa
   (`getAuthenticatedCompanyId`, `companyScopeService.ts:287`; `getJobScope`) e projeta colunas.
3. **Negação silenciosa**: UPDATE/DELETE barrado devolve 0 linhas sem erro. Só dizer "feito" com `.select('id')` ou outcome da RPC.
4. **Multiunidade**: os services usam a unidade selecionada. A confirmação precisa mostrar o nome dela.
5. **Texto da RPC não é autorização**: o gate de classe vive no executor do cliente (registro fixo ferramenta -> classe).
   Ferramentas D **não são registradas**. A confirmação C é um botão da interface, com argumentos congelados; "sim" no chat
   (ou texto vindo de terceiro) não confirma. Se houver proxy de LLM no servidor, ele não recebe poder de escrita.

### Ações sem trava no banco (lacunas)

| # | Lacuna (catálogo de 25/11) | Efeito |
|---|---|---|
| L1 | `workers` UPDATE só exige `auth.uid() = id`; grant em todas as colunas; sem guard (há só XP/nível) | freela pode gravar `rating_average`, `reviews_count`, `verified_identity`, `earnings_total`, `completed_jobs_count`, `xp`, `cpf`, `accepted_tos` |
| L2 | `companies_update_operator` sem guard de coluna (só hierarquia) | gerente grava a própria nota, `cnpj`, `email`, `accepted_tos` |
| L3 | `tc_update_worker` checa só `worker_id` e status final `accepted\|blocked`; `company_id` e `blocked_by` são graváveis; o trigger só protege `invited_by` | freela pode **repontar o vínculo para outra empresa** (entra no elenco sem convite) ou **desfazer bloqueio feito pela empresa**. Prioridade alta |
| L4 | `shift_payments` INSERT exige só `is_job_owner`, empresa do turno e `amount > 0`; nada exige candidatura, presença ou teto | registro (e termo + aviso) para qualquer `worker_id` e valor |
| L5 | `jobs` UPDATE sem guard de valor/data/horário/local após contratação; `jobs_delete_company_owner` permite DELETE físico | condição muda depois do aceite; cascata |
| L6 | `notifications_insert_self_or_connected`: a contraparte com vínculo aceito grava `title`, `message`, `link` livres | aviso forjado "do sistema", com link para rota que auto-aceita (§1) |
| L7 | `Message` SELECT/INSERT e uma policy antiga de `Conversation` usam `company_id = auth.uid()`, fora do seam | gerente/operador sem chat apesar do menu |
| L8 | `refund_escrow` com EXECUTE para `authenticated` (confere só dono da carteira) | movimenta saldo legado; nunca expor |
| L9 | bucket `avatars`: INSERT para qualquer autenticado, sem restrição de caminho; leitura pública | upload em caminho alheio novo |
| L10 | Termos: aceite é UPDATE comum | um agente com acesso ao service aceitaria sozinho |

Travas fortes (confiar, sem reimplementar): `applications_insert_guard`, `applications_update_guard` (máquina de estados,
presença imutável, papel certo), `enforce_shift_payment_immutability` (estorno só Gestor), unicidade de pagamento ativo,
`enforce_term_accepted_before_confirm`, `can_review_for_job`, RPCs de equipe, chamado e SOS.
**Trava de banco não distingue pessoa de copiloto**: para o banco, D executado pelo agente é legítimo.

## 7. Dados pessoais (mascarar) e texto de terceiros (injeção), por tela

Regra: o LLM **não recebe DOM, HTML, screenshot, URL crua nem linha de tabela**. Recebe `screenId`, estado tipado e
lista de elementos disponíveis. Pessoas viram apelidos estáveis na sessão (`F1`, `E1`, `T1`); o mapa para uuid e nome
fica só no cliente. Nunca saem: CPF, CNPJ, telefone, e-mail, PIX, nascimento, senha/OTP, tokens e links de convite,
`accepted_ip`/user agent, `term_text`, URL de avatar (contém uuid). Texto digitado no chat do copiloto também passa por
redação (CPF, telefone, e-mail, PIX).

| Tela | Dados pessoais / sensíveis | Texto de terceiros (autor) |
|---|---|---|
| `/company/dashboard`, `/company/hoje` | nomes e avatar de freelas e membros, local, valores | título/local do turno (Encarregado), nome de membro, tag, cobertura; cartões de indicação |
| `/company/jobs`, `/:id`, `/create?repetir`, `/edit` | nomes, avatar, endereço, valor | title, description, requirements, briefing, location (outro operador); nome de freela no convite |
| `/candidates` (maior risco) | nome, avatar, **PIX**, telefone (WhatsApp), presença, valores, comprovantes | nome/bio do freela, motivo de recusa/chamado, `note`, `void_reason`, mensagem do chamado |
| `/company/team`, `ShiftCallModal` | nome, avatar, cidade, nota, **PIX** (`MemberCard`), disponibilidade, risco de vínculo | `full_name`, `primary_role`, `city`, nome de lista, requisito de certificação |
| `/company/worker/:id` | nome, bio, cidade, telefone, PIX, certificações com nº de registro | bio, avaliações, certificação (title, issuer, nº), treinamentos, `verified_note`, `revoked_reason` |
| `/company/indicacoes` | nome e avatar | `message` de outra empresa, nomes de empresas |
| `/company/messages`, `/messages` | nomes, avatar, conteúdo | **`Message.content`** (vetor principal), título do turno |
| `/company/relatorio`, `/operacao` | nomes, valores, documento no relatório | títulos, nomes; CSV |
| `/company/profile` | CNPJ, e-mail, endereço, link de convite | - |
| `/company/configuracoes/equipe`, `/organization` | nomes, telefone, e-mail de gerente, **link com token** | `display_name` digitado pelo convidado |
| `/company/trilha` | PIX do operador, ganhos | notas do admin |
| `/dashboard`, `/my-jobs`, `InviteTakeover` | nome, ganhos, locais, valores, horários | título, descrição, **briefing**, local, mensagem do chamado, nome da empresa |
| `/carteira`, `/empresa/:id`, `/indicacoes` | endereço; link próprio com token | nome, descrição, `default_briefing`, avaliações de outros freelas, `message` da indicação |
| `/recebimentos`, `/recibo/:jobId` | CPF/CNPJ no termo, valores, nomes, IP | `note`, `void_reason`, título, nomes dentro de `term_text` |
| `/profile`, onboardings, `/login`, convites | **tudo**: CPF, telefone, PIX, nascimento, e-mail, senha, OTP, tokens | issuer e nota de conferência |
| notificações (sino e página) | nomes e valores no texto | `title`, `message`, `link` (L6) |

Injeção: texto de terceiro não entra no contexto por padrão. Se a pessoa pedir ("resume o briefing"), chamar um modelo
**sem ferramentas**, com o texto delimitado como dado, e renderizar a saída como texto puro (sem link clicável, markdown de
imagem ou HTML). Depois dessa leitura, o turno fica sem ferramentas B e C. Explicações de "como usar" vêm de conteúdo
próprio versionado (este mapa), nunca do banco. Nunca usar `error.message` cru como contexto: usar o `outcome`.

## 8. Destaque estável (`data-*`)

Estado atual: quase não há âncora. Existem `data-testid` soltos (úteis: `shift-call-modal`, `service-term-section`,
`tos-gate-modal`, `worker-certifications-panel`, `lifecycle-stepper`, `invite-link`). Rótulos mudam por estado e
há redesign em curso: **não** selecionar por texto, classe ou `aria-label`. Não reaproveitar `data-testid`.

- `data-copilot="<tela>.<elemento>"`: contrato público. **Convenção adotada (25/11/2026)**: `<tela>` são dois
  segmentos, `<papel>.<tela>`, com papel `empresa`, `freela` ou `publico` (login, convites, senha, entrada, Termos);
  nomes em português, kebab-case. O id completo é `<papel>.<tela>.<elemento>`, ex. `empresa.turno-criar.enviar`,
  `empresa.presenca.chamar-freelas`, `freela.turno.registrar-chegada`, `publico.convite-equipe.aceitar`.
  Os exemplos anteriores deste mapa (`shift-create.title`) não existiam no código e foram descartados.
  O valor é sempre literal no código (ternário de literais pode; template string não). Cada id é declarado uma única
  vez; as exceções (ramos exclusivos ou itens repetidos de lista) estão listadas em `lib/copilotAnchors.test.ts`.
  Navegação, quando ganhar âncora: `<papel>.nav.<NavItem.id>`, nas duas navegações.
- `data-copilot-ref="<apelido>"` em itens repetidos (`T1`, `F2`), atribuído em runtime. Nada de uuid ou nome no atributo.
- `data-copilot-risk="D"` nos gatilhos D: o executor se recusa a clicar ou focar com Enter; só contorna visualmente.
  É defesa extra; a principal é não existir ferramenta de clique genérico.
- Registro tipado `lib/copilot/targets.ts` (união de ids + rota + papel + risco + como abrir o contêiner), com teste que
  renderiza cada tela e exige os ids.
- `Button`, `IconButton` e `Card` já repassam `...rest`; `MenuItem` aceita `data-*`;
  `Field`, `Tabs`, `FilterChip` precisam de conferência.
- Destaque: esperar o elemento (lazy/skeleton) com timeout; preferir o que está visível (desktop e `BottomNav` duplicam);
  alvo dentro de modal fechado, abrir só se abrir não escrever; se não achar, dizer o motivo pela tabela §5.
  Overlay com `pointer-events:none`, fora do `InviteTakeover`/`TosGateModal`, sem roubar foco, com anúncio `aria-live`.

## 9. Ordem sugerida
1. v1 só A (+ §5 e destaque), sem texto de terceiros.
2. B pela ponte de rascunho: G03, G11, F18.
3. C: G07, G14, G34, G45, marcar notificações.
4. Antes de qualquer escrita por agente: corrigir L3, L1/L2, L6 (e o auto-aceite ao montar), L4, L5. L7 e L8 em paralelo.
