# Guia do sistema visual (fundação entregue)

> Para quem migra telas. Tudo vem de `frontend/src/components/ui` (barril `index.ts`, **fechado**: se faltar algo,
> reporte ao orquestrador, não edite). Textos de estado vêm de `lib/statusLabels.ts`; dinheiro e horas de `lib/currency.ts`.
> Os caminhos abaixo são relativos a `frontend/src`.

## 1. Tokens (`tailwind.config.js`)

| Token | Valores | Regra |
|---|---|---|
| Raio | `rounded-xl`, `rounded-2xl`, `rounded-pill` | controle e aviso; card e dialog; selo e chip. `rounded-full` só em avatar, ponto e barra |
| Sombra | `shadow-brutal-sm` (3px), `shadow-brutal` (4px), `shadow-brutal-lg` (6px) + `shadow-brutal-brand` (verde, destaque do freela) | card em repouso não tem sombra; nada de `shadow-[...]` |
| Borda | `border-2 border-black` (1º nível, controle) · `border-2 border-gray-200` (aninhado) · `border-status-*-line` (selo, aviso) | |
| Fundo | `bg-canvas` | nunca `#F4F4F0` |
| Status | `status-{neutral,info,success,warning,danger}-{bg,fg,line}` | use via `StatusBadge`, `Alert` ou `TONE_CLASS` |
| Verde | `bg-primary` (marca, sem texto pequeno em cima) · `bg-primary-dark` (fundo com texto branco) · `text-primary`, `text-primary-dark` e `text-primary-ink` são o tom AA `#006b33` | sobre fundo preto use `text-green-400` |
| Texto | mínimo `text-gray-600`; `gray-500` só em placeholder; `gray-300/400` só em ícone decorativo | |
| Movimento | `duration-press` 80ms, `duration-fast` 150ms, `duration-base` 200ms, `duration-exit` 150ms; `ease-standard`, `ease-enter`, `ease-exit` | sem `transition-all`, sem `animate-in`, sem bounce |
| z-index | conteúdo fixo 30 · BottomNav e Sidebar 50 · menu 60 (top layer) · dialog 70 · toast 80 · skip link e gate 90 | |

**Tipografia:** título de página só `PageHeader`; h2 `text-lg font-bold`; h3 `text-base font-bold`; corpo `text-sm`;
meta `text-xs text-gray-600`; número `text-2xl font-bold tabular-nums`. Sem `font-black` (fora de marca e heróis) e sem caixa-alta em botão, título ou frase.

## 2. Botões

| Nível | Componente | Quando |
|---|---|---|
| Primário | `<Button variant="primary">` (freela) / `variant="dark"` (empresa) | no máximo **1 por contexto**; em lista, só o item que exige ação agora |
| Secundário | `variant="secondary"` | alternativas, ação por item, "Voltar" |
| Terciário | `variant="ghost"` | baixa prioridade |
| Destrutivo | `variant="danger"` | só na confirmação final |
| Abre confirmação destrutiva | `variant="dangerOutline"` | no card ou na lista |
| Só ícone | `<IconButton aria-label="...">` | nunca `Button className="w-11 !px-0"` |
| Navegação | `<ButtonLink to="...">` | nunca `<button onClick={navigate}>` |

`size`: `md` (padrão, 44px); `lg` só no CTA único de rodapé, onboarding e autenticação; `sm` só em tabela desktop.
`loading` mantém o rótulo. `className` só para layout. Estados hover, active (afunda), focus-visible, loading e disabled já vêm prontos.
Fora de React Router: `buttonClasses()` / `linkButtonClasses()`.

## 3. Componentes

```tsx
<Card padding="sm" tone="default|nested|highlight" onActivate={abrir}>…</Card>

<StatusBadge domain="application" status={app.status} />          // rótulo, tom e ícone do glossário
<StatusBadge tone="warning" icon={AlertTriangle}>Falta 1</StatusBadge>

<Alert tone="warning" title="Freela sem chave PIX" action={<Button variant="secondary">Ver contato</Button>}>…</Alert>

<EmptyState icon={Inbox} title="Nenhum turno em andamento agora." description="…" action={…} size="inline|page" />

<ErrorState onRetry={recarregar} retrying={loading} />             // ErroDeCarga é só um reexport legado

<PageHeader title="Turnos" subtitle="…" action={<CreateShiftLink />} inlineAction />

<ActionBar secondary={<Button variant="secondary">Cancelar</Button>}
           primary={<Button variant="dark" size="lg">Salvar</Button>}
           summary="4h · R$ 100,00" />

<Menu label="Mais opções do turno" menuLabel="Ações do turno" items={[
  { label: 'Editar', icon: Edit2, onSelect: editar },
  podeCancelar && { label: 'Cancelar turno', icon: XCircle, onSelect: cancelar },
  { label: 'Excluir', icon: Trash2, onSelect: excluir, danger: true },   // destrutivos por último
]} />

<Dialog labelledBy="t" onClose={fechar}>
  <DialogHeader titleId="t" title="Cancelar este turno?" subtitle="…" onClose={fechar} />
  …
  <DialogActions>                         {/* ordem no DOM: secundário, depois principal */}
    <Button variant="secondary" onClick={fechar}>Voltar</Button>
    <Button variant="danger">Cancelar turno</Button>
  </DialogActions>
</Dialog>

<ul className="divide-y divide-gray-200"><li><ListRow leading={avatar} title="Ana" meta="Garçom · 4 turnos" to="…" trailing={menu} /></li></ul>
<FilterChip pressed={f === 'open'} onClick={…}>Abertos</FilterChip>   {/* em role="group" */}
<Tabs label="Meus turnos" value={aba} onChange={setAba} tabs={[{ id: 'hoje', label: 'Hoje', count: 1 }]} />
<ChoiceCard pressed={marcado} onClick={…}>Ana · Garçom</ChoiceCard>
<SkeletonList count={4} itemClassName="h-28" />  <Spinner label="Carregando" />  <ProgressBar value={60} label="Perfil 60% completo" />
```

### Posição das ações

| Contexto | Celular | Desktop |
|---|---|---|
| Ação principal de lista ("Criar turno") | `PageHeader action` (`inlineAction` quando é um botão curto) | topo da Sidebar (o `CreateShiftLink` é `md:hidden`) |
| Concluir formulário ou detalhe longo | `ActionBar`, grudada acima da BottomNav | estática no fim, à direita |
| Dialog, 2 ações curtas | `DialogActions` lado a lado | à direita |
| Dialog, rótulos longos ou 3 ações | `DialogActions stacked` (principal no topo) | linha à direita |
| Ação por item | até 2 no rodapé do card; o resto no `Menu` | à direita da linha |
| Destrutiva | no fim do menu ou após divisor; nunca encostada na principal | igual |

**Não existe mais botão flutuante.** Não crie `fixed bottom-*` em tela.

**Regras da `ActionBar`:** é o último filho do conteúdo; é `sticky`, então ocupa o próprio lugar e não cobre o fim da página
(não precisa de `pb-*` extra; remova folgas antigas como `pb-20`/`pb-44` ao migrar). Nenhum ancestral pode ter `overflow`
diferente de `visible` (os `<main>` dos layouts já não têm). Pressupõe o padding lateral do `<main>` (`px-4`/`sm:px-6`).

**Regras do `Menu`:** abre em `popover` (top layer), vira para cima quando falta espaço, usa a área útil inteira se não couber de
nenhum lado e rola só em último caso. Respeita o cabeçalho e a BottomNav (`[data-bottom-nav]`). Não use `div absolute` como menu.

## 4. Glossário (`lib/statusLabels.ts`)

`getStatus(domain, status)`, `statusLabel(...)`, `roleLabel(slug)`, `TONE_CLASS`. Domínios: `application`, `job`, `shiftCall`,
`payment`, `invite`, `member`, `certification`, `referral`. Estado desconhecido vira "Encerrado", nunca o enum.

| Use | Não use |
|---|---|
| Concluído | Finalizado |
| Cancelado | Dispensado (como selo; "Dispensar" segue sendo o verbo da ação) |
| Recusado (tom neutro) | Recusou, vermelho |
| Expirado | Expirou (como selo; a frase "Expirou sem resposta" é narrativa e pode ficar) |
| Contratado | Aceito, Confirmado (como estado do turno) |
| Em andamento | Em Andamento |
| Aguardando resposta | Convidado, Convite |
| Turno · Freela · Chamar | vaga (salvo posição) · worker, candidato, trabalhador · atrelar |
| Registrar chegada / saída · Perguntar se vem | Check-in, Check-out, Confirmar Presença |
| Código do freela | Worki ID, ID do worker |

Já aplicado na fundação: selos dos dois chats, selo do freela em Presença, abas e filtro de Turnos, função com acento
nas telas que mostram `primary_role`/`category`, textos de código do freela, opções do Admin. **Pendente nos lotes:**
"Check-in/Check-out", "Confirmar Presença", "Candidatos", "atrelar", "Freelance", "Lvl", "Confirmado" na linha de Turnos e
os textos jurídicos que dizem "Worker" (Termos e Privacidade só com revisão jurídica).

**Dinheiro:** sempre `formatBRL(valor)` (milhar e centavos). **Horas:** `formatWorkedTime(horas, fallback)`; zero, ausente
ou menos de 1 min viram o fallback ("Sem registro"), nunca "0h"/"N/A". Dado ausente: oculte ou ofereça "Adicionar".

## 5. Movimento

- Press já vem em `Button`, `IconButton`, `Card` clicável, `ListRow`, `Tabs`, `FilterChip`, `ChoiceCard`, `Menu` e BottomNav.
  Em controle próprio: `active:bg-gray-100` ou `motion-safe:active:scale-[.97]`.
- Dialog e toast têm entrada; toast tem saída (`data-closing`). Saída de dialog não existe (decisão da proposta, 2.6).
- Sem animação de entrada de página. Todas as classes `animate-in` mortas foram removidas.
- `prefers-reduced-motion` por caso em `index.css`: giro desacelera; pulse, bounce e letreiro param; dialog e toast só com fade curto.
- Letreiro do Onboarding tem botão de pausa.
- Foco: anel global em `index.css`; os primitivos especializam.

## 6. Conferir antes de entregar

`npm run build`, `npm run lint`, `npx vitest run`. Fotos: `cd scripts/galeria-telas && node run.mjs --so=<filtro> --saida=<pasta>`.
A foto padrão estica a janela e **esconde** sobreposição; use `dobra: true` no cenário (janela real) e `verificar: '<js que devolve "" ou o erro>'`.
Nos arquivos do lote: zero `<button>` cru fora dos primitivos; zero `!` em primitivo; zero `shadow-[`, `transition-all`, `rounded-lg`,
`font-black` (fora das exceções); um primário visível por contexto; 44px a 390px; sem rolagem horizontal a 320px.
Nenhuma mudança de regra de negócio, query ou texto jurídico sem spec.

## 7. Divisão em 4 lotes (nenhum arquivo repetido)

Os lotes consomem `components/ui`, `lib/statusLabels.ts`, `lib/currency.ts`, `tailwind.config.js` e `index.css` sem editar.
Teste ao lado do arquivo acompanha o lote. Testes compartilhados (`pages/__tests__`, `pages/testerRodada*`, `components/__tests__`)
podem ser tocados por mais de um lote: **reporte ao orquestrador** em vez de editar em paralelo. Itens "E§n" são de
`critica-empresa.md`; "F§n" de `critica-freela-publico.md`. Itens que dependem de banco, trigger ou regra nova estão
marcados **[spec]** e não entram no lote visual.

### Lote 1: empresa, operação do turno

**Arquivos:** `pages/company/{CompanyDashboard,CompanyToday,CompanyJobs,CompanyJobDetails,CompanyCreateJob,CompanyJobCandidates}.tsx`;
`components/company/{CancelJobModal,CancelSeriesModal,CoverageModal,EditSeriesModal,InviteSeriesModal,PassJobsModal,TagsPanel,CreateShiftLink,TrailShortcutCard}.tsx`;
`components/team/{ShiftCallModal,ShiftCallsPanel,SosCallButton,InviteToShiftModal,BusyWorkerBadge}.tsx`; `components/JobLifecycleStepper.tsx`;
um `lib/nextAction.ts` novo.

- E§1 Início: KPIs em faixa clicável sem "Total"; card de contratado legível a 320 com data e hora; CTA por estado; recentes em lista densa; remover "Atividade recente" no celular.
- E§2 Hoje: selo de ocupação por estado; card clicável sem CTA repetido; subtítulo condizente com `teamEnabled`; "Passar para..."/"Cancelar turno" no `Menu`; encerrados recolhidos; h2 fora de `font-black`.
- E§3 Turnos: "Marcar presença" como botão no lugar da pílula; ordem do dia com encerrados recolhidos; chips em uma linha (`FilterChip`); vazio com próximo passo; menu filtrado por estado; um só gesto de cancelar/excluir com diálogo "Voltar" + verbo; "Chamar freelas" único. (Menu coberto e FAB: **resolvidos**.)
- E§4 Detalhe: ação principal (`ActionBar`) quando há freela; vazio abre o chamado deste turno; "Freelas · x de y vagas"; horário no cabeçalho.
- E§5 Presença e Pagamento e modais: freelas antes de chamados, histórico em `<details>`; card em três zonas; stepper horizontal; rótulos "Registrar chegada/saída" e "Perguntar se vem"; PIX ausente vira `Alert` com saída; título do pagamento com nome e turno; texto condicional da presença manual; estrelas começam vazias; "Cancelar agendamento"; trocar o `ModalShell` local e o `StatusChip`.
- E§6 Criar/editar: `ActionBar` com resumo; ordem por urgência; "Faltam n campos" com link; valor fixo como texto.

### Lote 2: empresa, pessoas, gestão e casca

**Arquivos:** `pages/company/{CompanyTeam,CompanyTeamMembers,CompanyReferrals,WorkerPublicProfile,CompanyMessages,CompanyGestao,CompanyProfile,Organization,CompanyOrdersReport,CompanyOperationAnalytics,BonusTrail}.tsx`;
`components/team/{AddWorkerModal,MemberCard,ModalShell,PendingCard,QrScannerPane,RemoveMemberDialog,TeamListModal}.tsx`;
`components/company/{CreateReferralModal,WorkerCertificationsPanel,BackToGestao,CompanySwitcher,GestorRouteGuard}.tsx`; `components/company/analytics/**`;
`components/bonus/**`; `components/admin/**`; `pages/Admin.tsx`; `pages/Notifications.tsx`;
`components/{NotificationBell,Sidebar,BottomNav,SectionTabs,ModalShell}.tsx`; `layouts/CompanyLayout.tsx`;
`services/operationAnalyticsService.ts` (só o piso do custo por hora).

- E§0 Casca: "Empresa" no lugar de "Business"; ativo preto ou azul (nunca verde) na empresa; "Hoje" x "Início"; cabeçalho do `MainLayout` é do Lote 3.
- E§7 Elenco: modal abre em "Link"; linhas de 72px com `ListRow`; remover no `Menu`; rótulo no compartilhar.
- E§8 Indicações; E§9 Equipe (aviso de novo link só após remoção; um CTA no vazio).
- E§10 e F§12 não: chat da empresa agrupado por pessoa com prévia (dados novos são **[spec]**), sangria total no celular ("cancelled": **resolvido**).
- E§11 e F§12 Notificações: lista com divisores, ícone por tipo, filtros sem corte, "Marcar todas" discreto. Texto com turno e pessoa é **[spec]** (triggers).
- E§12 Gestão; E§13 Dados da empresa (`ActionBar` na edição, item "Conta"); E§14 Pagamentos (card com nome do turno, filtros depois dos números, 3 KPIs; slug: **resolvido**); E§15 Operação (piso do custo por hora, caixa-alta, tabelas no celular); E§16 Perfil do freela ("Convidar para turno"); E§18 Unidades (input colapsado); E§19 Trilha (`PageHeader`); E§21 Admin por último.
- F "Desktop": contêiner único e "Sair" discreto na Sidebar. F§10: `SectionTabs` no mesmo padrão de `Tabs`.
- Ao fim, apagar os dois `ModalShell` quando não houver importador (o Lote 1 usa `team/ModalShell`: coordenar; apagar só depois dos dois).

### Lote 3: freela

**Arquivos:** `pages/{Dashboard,MyJobs,ReceiptView,MeusRecebimentos,Profile,CarteiraClientes,QuemTeIndicou,Messages,CompanyPublicProfile}.tsx`;
`components/{InviteTakeover,RateModal,LocalDoTurno,ServiceTermSection,MyCertificationsSection,SosDiscoverySection,ReferralOptOutSection,CompanyBadges,ProfileReviews,ProfileAvatarLink}.tsx`;
`layouts/MainLayout.tsx`.

- F§1 cartão "Hoje" com "Registrar chegada" (a janela de horário divergente do banco é **[spec]**, pelo harness de fix). F§2 aba inicial por prioridade, ordem pela data do turno, `Tabs` em uma linha.
- F§3 a F§5: cartão de agendado e histórico (`StatusBadge`, cancelados compactos, "Confirmar recebimento" no pendente), detalhe com ação, copy do cancelar.
- F§6 recibo: bloco de confirmação no topo com `ActionBar`; termo; horas ("0min": **resolvido**); ocultar id do modelo. "Não recebi" como atalho para o chat; contestação formal é **[spec]**. Texto do termo não muda.
- F§7 Recebimentos; F§8 Início (alerta de PIX ausente, hierarquia); F§9 Perfil (ordem, `ActionBar` no lugar da barra fixa que cobre a BottomNav, um só liga/desliga, vazios; "0h": **resolvido**).
- F§10 Empresas ("Sair" no `Menu`); F§11 Mensagens (tela cheia, prévia **[spec]** se pedir dado novo); F§13 e E§17 Perfil público da empresa; cabeçalho do `MainLayout` com `bg-white/90` (depois remover o token `glass`).

### Lote 4: público, entrada e estados da casca

**Arquivos:** `pages/{LandingPage,Onboarding,Login,ForgotPassword,ResetPassword,InviteAccept,AcceptTeamInvite,AcceptManagerInvite,Help,Terms,Privacy,BonusRules,NotFound}.tsx`;
`pages/worker/WorkerOnboarding.tsx`; `pages/company/CompanyOnboarding.tsx`; `App.tsx`;
`components/{TosGateModal,PwaPrompts,ErrorBoundary,ErroDeVerificacao,SemAcesso,AcessoEncerrado,AguardandoConfirmacao,HomeRedirect,ProtectedRoute,SkipLink}.tsx`.

- F§14 faixa de convite no login e abrir no cadastro (prévia do nome da empresa é **[spec]** com revisão de segurança).
- F§15 "Voltar" no fluxo (cobre o título a 320), seletor de papel, regra e "mostrar senha"; F§16 `AuthShell` local ao lote e link expirado.
- F§17 Landing e Sobre (um vocabulário, cartões com CTA; promessas passam pelo jurídico; letreiro já pausa, avaliar remover).
- F§18 Ajuda: canal de contato (**depende do dono** informar o canal) e FAQ por papel. F§19 sumário nos textos longos. F§20 404 e convite inválido. E§20 Onboarding da empresa.

## 8. O que a fundação deliberadamente não migrou

As telas ainda têm `<button>` cru, `shadow-[...]`, `font-black`, `text-gray-400`, selos e vazios à mão, e o `StatusBadge`,
`EmptyState`, `ActionBar`, `Tabs`, `ListRow` e `DialogActions` ainda não têm uso nelas. A guarda automática contra
regressão fica para o lote de fechamento, depois dos quatro.
