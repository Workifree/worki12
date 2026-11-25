# Presença verificada: pontos de integração

Banco e componentes novos prontos. Nenhum arquivo existente do frontend foi editado. Caminhos relativos a `frontend/src`.

## Ordem de entrega (obrigatória)
1. Migrations `20261127000100`, `000200`, `000300` (cada uma com sua transação) e depois `000400` fora de transação, um comando por vez. Compatíveis com o site publicado: todo turno nasce `dual`.
2. Conferir `pg_cron` (job `presence-checks-purge`). Sem ele a P3 só emite WARNING e a retenção de 90 dias não roda.
3. `vercel.json` e frontend. O seletor "QR do local + localização" (item 3) só pode ir ao ar junto com os itens 4 a 6: o site antigo não sabe registrar presença em turno `qr_gps`.

## Pendências nos arquivos existentes
1. `frontend/vercel.json`: `geolocation=()` para `geolocation=(self)` em `Permissions-Policy` (manter `camera=(self)`). Sem isso o GPS não funciona em produção (P19). Atualizar o teste de headers, se houver.
2. `App.tsx`, sob `ProtectedRoute` de company, com `PageHeader`:
   - `/company/locais`: `<SiteManager companyId={...} canManage={isGestor} printPath={(id) => `/company/locais/${id}/qr`} />`. `companyId` pelo seam (`companyScopeService`).
   - `/company/locais/:id/qr`: `<SiteQrPrint siteId={id} />` (só Gestor). A impressão esconde a casca por CSS; conferir no navegador.
   - `/company/jobs/:id/qr`: `<ShowShiftQr jobId={id} />`, para quem opera o turno.
   - Entrada de menu "Locais" em Gestão.
3. `CompanyCreateJob`, edição de turno, série e padrão da empresa: `<PresencePolicyFields value onChange sites={await listSites(companyId)} frozen siteError />`.
   - Gravar `presence_mode`, `site_id`, `qr_mode` no insert e update de `jobs`.
   - Série: os três campos em `p_job_template` (`services/jobSeriesService.ts`); a RPC já os copia. `update_job_series_future` NÃO propaga a política.
   - Padrão: `companies.default_presence_mode/default_site_id/default_qr_mode` (já liberadas no `profile_trust_guard`). Copiar para o formulário; o banco não aplica o padrão sozinho (inclusive em duplicação de turno).
4. Fluxo do freela (`MyJobs`, `components/TodayShiftCard.tsx`, `pages/Dashboard.tsx`): se `job.presence_mode === 'qr_gps'`, os botões "Registrar chegada/saída" abrem um `Dialog` com `<PresenceCheckFlow applicationId kind onRegistered={reload} onClose />` em vez do UPDATE direto. Incluir `presence_mode` no `select` de `jobs` (só depois das migrations). Um `Dialog` só: o leitor usa id fixo no DOM.
5. `CompanyJobCandidates` (e `CompanyToday`), quando `qr_gps`:
   - Remover os botões de confirmação direta de chegada e saída: o banco recusa (`applications_presence_guard`, 42501), inclusive o registro manual de presença.
   - Botão "Mostrar QR do turno" (modo `rotating`; em `static`, indicar o cartaz).
   - `listPresenceChecks({ jobId })` + `pendingExceptionRequests(checks)` para destacar pedidos; `<PresenceExceptionPanel>` por freela e momento, sempre disponível (mesmo sem pedido). Na saída ele oferece também "Confirmar saída sem verificação".
   - "Concluir turno" segue igual (exige as duas confirmações da empresa).
   - Se o freela registrou a saída sem verificação, a empresa ainda precisa de um dos dois botões do painel antes de concluir.
6. `lib/checkinWindow.ts` (`attendanceGuardMessage`): tratar `applications_presence_guard` como "Este turno exige QR e localização. Atualize a página." Tratar também `jobs_presence_policy` na edição de turno.
7. `ReceiptView` e modal "Registrar pagamento": quando `qr_gps`, `<PresenceBadge checks={checks} departureDone={!!(app.worker_checkout_at || app.company_checkout_confirmed_at)} />`. Se `listPresenceChecks` devolver `null` (falha de leitura), não mostrar o selo. Nunca bloquear o pagamento. Em turno com chegada por exceção, `worker_checkin_at` fica vazio: usar `company_checkin_confirmed_at` como chegada em horas e recibo.
8. `pages/Privacy.tsx`: finalidade "verificação de presença": localização lida uma vez por gesto, não armazenada; guardados resultado, distância e precisão; falhas por 90 dias; verificada ou exceção enquanto existir o recibo; alternativa sem localização. Texto jurídico: revisar antes de publicar.
9. `types/index.ts`: reexportar os tipos de `lib/presence.ts` e acrescentar a `Job`/`Company` as colunas novas.

## Diferenças em relação ao ADR e à spec
- O guard é um trigger separado (`trg_zz_applications_presence_guard`, distinção por `current_user`); o corpo de `applications_update_guard` não mudou. A GUC `app.presence_rpc` só desvia `validate_application_update`, que barraria a própria RPC. Efeito: reaplicar `20261125000200` ou `000100` depois da P3 faz HALT por trigger BEFORE desconhecido.
- Saída sem verificação: RPC `register_departure_unverified` (freela ou quem opera), resultado novo `unverified`. Resultado novo `exception_requested` para o pedido de ajuda.
- `verify_presence` limita 20 falhas em 10 min por candidatura (`too_many_attempts`).
- Turno rotativo não aceita o QR impresso, e o estático não aceita o rotativo.
- Mapa Leaflet e busca Nominatim não entraram (dependência nova): há "Estou aqui agora" e "Conferir no mapa" (abre o OpenStreetMap em outra aba, enviando a coordenada do local).
- LGPD: anonimização de freela e empresa por triggers próprios; `anonymize_account` não foi editada.
- `qr_mode` não congela (permite trocar para o cartaz se o celular do responsável falhar).

## Limites conhecidos (dizer ao dono)
GPS falso não é detectável no navegador; o QR rotativo pode ser retransmitido por vídeo em até 60 s; o cartaz pode ser fotografado; não prova a identidade de quem segura o aparelho. Quem opera o turno pode voltar o turno para `dual` antes do primeiro registro.

## Antes de aplicar em produção
Gate de `harness-security-reviewer` (RPCs DEFINER, desvio no validador, LGPD) e avaliação independente. O PGlite usa schema mínimo e seam simplificado: conferir no catálogo real que as asserções passam e rodar `supabase/tests/applications_update_hardening.sql` e as auditorias de equipe. e2e P16 a P18 depois da integração.
