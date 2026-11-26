# Tempo real: como ligar nas telas

Os arquivos novos estão prontos e testados. **Nenhum arquivo existente foi editado.** As linhas citadas
mudam (há integração em andamento nas telas): procure pelo nome da função.

## 0. Diagnóstico (25/11/2026)

**Falha de websocket do testador:** vem do `.mcp.json`. `--allowedUrlPattern` só tem `http(s)://`. O
puppeteer 25.18.1, dentro do chrome-devtools-mcp 1.14.0, transforma a lista em regras de rede e fecha com
`urlPattern: "" offline: true`. `ws://` e `wss://` não casam com `https://…` e falham com
`net::ERR_INTERNET_DISCONNECTED` (Supabase **e** HMR do Vite). A/B com a mesma página, no localhost e no
publicado: com a lista, `close 1006`; com a lista + ws/wss ou sem lista, `phx_reply:ok` e `system:ok`.

Correção (configuração do dono; não foi aplicada). Em `chrome` e `chrome2`, acrescentar:

```
"--allowedUrlPattern", "ws://localhost:*/*",
"--allowedUrlPattern", "ws://127.0.0.1:*/*",
"--allowedUrlPattern", "wss://*.supabase.co/*",
```

Depois, reiniciar a sessão. A prova do A/B foi com `puppeteer.launch`; com o MCP conectado a 9222/9223
confirme no primeiro teste.

**Queixa do dono (tela não atualiza):** causa separada. Só `Conversation`, `Message` e `notifications` estão
publicadas, e nenhuma tela de turno assina nada. Além disso, o aviso de aceite não dizia quem nem qual turno.

**Armadilha:** o canal de tabela não publicada devolve `SUBSCRIBED` e só depois `system: error`. Não use o
status do `subscribe` como prova de tempo real. O hub já trata isso.

## 1. Ordem

1. Aplicar `supabase/migrations/20261202000100_tempo_real.sql` (aprovação humana + gate architect/security).
2. Ligar as telas. A ordem pode ser invertida sem quebrar: sem a migration, o canal fica em `fallback` e a
   tela confere a cada 20s (só com a aba visível).

Teste do banco:
`npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-temporeal/run.mjs`.

## 2. Contrato do `onRefresh` (obrigatório em todas as telas)

A recarga é **silenciosa**. Quase todos os carregadores atuais **não** são: ajuste antes de ligar.

1. Não chamar `setLoading(true)` / `setCarregando(true)`.
2. Se falhar, manter o que está na tela: sem `setErroCarga(true)`, sem `setX([])`, sem `navigate`.
3. Não sobrescrever campo de formulário, filtro, aba, seleção, rolagem nem fechar modal.
4. Descartar resultado se `!ctx.isCurrent()`.
5. Com modal aberto, edição ou envio em andamento: `paused: true`. A recarga fica guardada e roda ao liberar.

Padrão sugerido: `fetchX({ silent }: { silent?: boolean } = {})`.

```tsx
useLiveRefresh({
  sources: companyId ? companyShiftSources(companyId) : [],
  onRefresh: () => fetchJobs({ silent: true }),
  paused: Boolean(modalAberto) || salvando,
});
```

`companyId` = empresa corrente pelo seam (`useCurrentCompany()?.company_id` ou `getAuthenticatedCompanyId`).
Nunca `user.id`: para gerente e encarregado é outro uuid. Trocar de unidade troca as origens sozinho.
Memorizar `sources` não é necessário. Não esconda a tela com base em `status`.

Hooks: `hooks/useLiveRefresh.ts`. Origens: `lib/realtime/liveSources.ts`.

## 3. Aviso na tela ("Fulano aceitou")

`hooks/useLiveAlerts.ts`, **uma vez por layout**: `layouts/CompanyLayout.tsx` e `layouts/MainLayout.tsx`
(ambos dentro do `ToastProvider`).

```tsx
const { user } = useAuth();
const { addToast } = useToast();
const { pathname } = useLocation();
useLiveAlerts(user?.id, addToast, (n) =>
  pathname.endsWith('/notifications') || (n.type === 'message' && pathname.endsWith('/messages')));
```

Lê as linhas de `notifications` (as mesmas do sino): não cria aviso, ignora o que já existia e o que está
lido, não repete e resume rajadas. Não ligar também em páginas.

**Sino:** `contexts/NotificationContext.tsx` não se recupera de queda. No provider:

```tsx
useLiveRefresh({ sources: user ? notificationSources(user.id) : [], onRefresh: () => loadNotifications() });
```

Extraia `loadNotifications` do effect (`useCallback`); em recarga, não ligar `erroCarga` se já há lista.
Pode manter o canal `notifications-changes`, mas o INSERT precisa deduplicar por `id`
(`prev.some(n => n.id === payload.new.id)`), porque a recarga e o evento podem trazer a mesma linha.
`pages/Notifications.tsx` consome o contexto: não precisa de hook.

## 4. Telas da empresa

| Tela | Origens | `onRefresh` | `paused` / cuidado |
|---|---|---|---|
| `CompanyDashboard.tsx` | `companyShiftSources(companyId)` | `Promise.all([refetchJobs(), refetchApps(), refetchShifts(), refetchPending()])` | `refetch` do React Query já é silencioso. Conferir que `isError*` com dado em cache não troca a tela por erro (usar `isError && !data`). |
| `CompanyJobs.tsx` | `companyShiftSources(companyId)` | `fetchJobs` com `silent` | `fetchJobs` liga `erroCarga` e `loading`. Pausar com confirmação de exclusão/cancelamento aberta. Não resetar `filter`, `search`, `pastExpanded`. |
| `CompanyJobCandidates.tsx` | `jobSources(id)` | `Promise.all([fetchCandidates({silent:true}), refreshCalls()])` | **Principal.** `paused`: `callModalOpen \|\| voidingPayment \|\| ratingModalOpen \|\| scheduleModalApp \|\| paymentModalApp \|\| dismissApp \|\| manualAttendance \|\| confirmDeliveryApp \|\| releasing` (mesma lista do fechar com Esc) mais outros envios. Em silent: não mexer em `setSemAcesso`/`setErroCarga`; `paymentsRead` não pode virar `'error'` nem voltar a "carregando". `refresh` de `useShiftCalls` (em `hooks/useShiftInvites.ts`) precisa não ligar `loading`. |
| `CompanyJobDetails.tsx` | `jobSources(id)` | `fetchJobDetails` + `fetchApplications` silenciosos | Pausar com confirmação aberta. |
| `CompanyToday.tsx` | `companyShiftSources(companyId)` | `setReloadKey(k => k + 1)` com ref "silencioso" | **Não** usar `reload()`: ele limpa a seleção e liga `loading`. No effect de turnos, em silent com falha: não fazer `setLoadError(true)` nem `setJobs([])`. Pausar com Passar/Cobrir/Cancelar abertos. Podar de `selected` ids que sumiram. |
| `CompanyTeam.tsx` | `companyTeamSources(companyId)` | `refresh` de `useCompanyTeam` | Adicionar modo silent a `fetchTeam` (hoje liga `loading`). Pausar com modal de adicionar/lista aberto. |
| `CompanyTeamMembers.tsx` | nenhuma tabela publicada (`company_members` tem hash de convite). Use `notificationSources(user.id)` | `reload(companyId)` silencioso | "Fulano entrou. É ele?" chega por notificação. Pausar com `inviteOpen`; em silent não fazer `setLoadError(true)`. |
| `CompanyMessages.tsx` | `conversationListSources()` | `setRefreshTrigger(n => n + 1)` | Já há canal `company_conversations_list` (nome fixo): **substituir** por este hook. Ver seção 6. |

Fora do escopo de tempo real: `CompanyProfile`, `CompanyCreateJob`, `CompanyCreateBatch` (formulários: **não
ligar**), relatórios e analytics.

## 5. Telas do freela

| Tela | Origens | `onRefresh` | `paused` / cuidado |
|---|---|---|---|
| `Dashboard.tsx` | `[...workerShiftSources(user.id), ...workerTeamSources(user.id)]` | `refetchNextJob`, `refetchHistory`, `refetchReceipts`, `refreshInvites`, `refreshStores` | `refreshInvites`/`refreshStores` ligam `loading` hoje: modo silent. Pausar durante `register` do `TodayShiftCard` (o card não precisa de hook próprio; recebe os dados da tela). |
| `MyJobs.tsx` | `workerShiftSources(user.id)` | `fetchJobs`, `fetchConfirmations`, `refreshInvites` silenciosos | Pausar com `rateModalOpen`, cancelamento ou resposta em curso (`respondingConfirmationId`). Não trocar `activeTab`. Conferir que o auto-abrir de avaliação não reabre um modal já dispensado. |
| `components/InviteTakeover.tsx` | usa a instância de `useWorkerInvites` dele: `workerShiftSources(user.id)` | `refresh` silencioso | Pausar com `respondingId`. É o caminho de o convite novo aparecer sem recarregar. |
| `CarteiraClientes.tsx` | `workerTeamSources(user.id)` | `refresh` de `useWorkerStores` (silent) | Pausar com confirmação de bloqueio/recusa aberta. |
| `MeusRecebimentos.tsx` | `[{table:'shift_payments', filter:\`worker_id=eq.${user.id}\`}]` | `setReloadKey` em modo silent | O effect liga `setLoading(true)` e `setErroCarga(true)`. |
| `ReceiptView.tsx` | `jobSources(jobId)` (vale para os dois papéis) | `fetchReceipt` silent | Hoje liga `loading` e zera presença. **Pausar** enquanto o aceite do termo não foi enviado (checkbox marcado) ou há confirmação em envio: o texto não pode mudar sob quem está lendo. |

## 6. Mensagens (`Messages.tsx` e `CompanyMessages.tsx`)

A conversa aberta já assina `Message`. Falta recuperar queda e atualizar a lista:

- Lista: hook com `conversationListSources()`; em `Messages.tsx`, `setReloadKey(k => k + 1)`.
- **Pisca hoje:** `loadData` faz `setSelectedConversation(conv)` com objeto novo; o effect de mensagens depende
  do objeto e faz `setMessages([])`. Antes de ligar: manter a referência se o `id` não mudou
  (`setSelectedConversation(prev => prev?.id === conv.id ? prev : conv)`), ou depender de
  `selectedConversation?.id`. Em recarga silenciosa, não reselecionar a partir da URL.
- Conversa aberta: na recuperação, buscar as mensagens e **mesclar por `id`**, sem `setMessages([])`. Não tocar
  em `newMessage` nem na rolagem de quem está lendo o histórico.

## 7. Roteiro de aceite (2 navegadores, migration aplicada, `.mcp.json` com ws/wss)

1. Empresa em "Presença e pagamento"; freela aceita: lista muda em até 3s, toast `<Nome> aceitou o turno "X" de DD/MM.`, sino +1 (um só).
2. Chegada, saída e confirmação de recebimento: idem.
3. Empresa muda o horário: freela vê o turno novo e "Turno alterado". Cancela: some da lista do freela.
4. Modal "Registrar pagamento" aberto com valor digitado; chega evento: nada muda. Fecha: atualiza.
5. Rede desligada 30s com evento no meio; ao religar, atualiza sem F5.
6. Sair e entrar com outra conta: nenhum toast nem dado da anterior.

## 8. Limites conhecidos

- Recusa em chamado com várias pessoas atualiza a tela, mas só gera aviso quando **todas** recusam (recusa
  neutra, regra do produto). Recusa de convite direto (sem chamado) avisa.
- DELETE não passa por RLS nem aceita filtro: chega só o uuid. Só `team_connections` assina DELETE (uma
  remoção em outra empresa provoca uma recarga a mais, sem dado).
- Quem perde acesso (turno repassado, remoção) não recebe o evento da própria saída; foco ou navegação corrige.
- Encarregado: a RLS decide o que chega, mesmo com filtro por `company_id`.
- Custo: cada mudança é avaliada pela RLS para cada assinante da tabela. Adequado ao piloto; rever se crescer.
- Aviso "Turno alterado" é um por turno: editar uma série gera um por ocorrência com freela.
- `supabase/tests/equipe_e5_auditoria.sql` espera o título antigo `Vaga preenchida no turno`; atualizar para
  `<Nome> aceitou o turno` se for rodado depois desta migration.
