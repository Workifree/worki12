# Spec técnica — Avisos multicanal (F1 push + app, F2 e-mail, F3 WhatsApp)

> Decisão: ADR.md (mesma pasta). Status: **não implementado, nada aplicado**. Precondição de produção:
> conferir no catálogo `pg_extension` (pg_cron, pg_net) antes de escrever a migration do agendador.

## 1. Eventos cobertos (fase inicial)

| event_kind | Origem (mesmo commit) | Destinatário | urgency | expires_at |
|---|---|---|---|---|
| `shift_call_target` | INSERT em `shift_call_targets` (team) | alvo | `normal`; `urgent` se início ≤ 6h | `shift_calls.expires_at` |
| `sos_call_target` | `create_sos_call` | alvo | `urgent` | `shift_calls.expires_at` |
| `attendance_request` | INSERT em `shift_attendance_confirmations` | freela | `normal` | início do turno |
| `shift_cancelled` | `trg_notify_counterpart_on_application_cancel` | contraparte | `normal` | início do turno |
| `payment_recorded` | `notify_worker_on_shift_payment` | freela | `low` | +30 dias |

Fora de escopo: chat, avisos de equipe (podem entrar depois só com `low`).

## 2. Schema (uma migration aditiva, RLS em tudo)

- `notice_outbox(id, event_kind, event_id uuid, recipient_id uuid → auth.users ON DELETE CASCADE, notification_id uuid NULL,
  payload jsonb, urgency text CHECK in(low,normal,urgent), expires_at timestamptz, created_at)`.
  UNIQUE `(event_kind, event_id, recipient_id)`. `payload` só com chaves de lista fechada (CHECK `payload ?& ... ` / trigger
  que rejeita chave fora de `{company_name, starts_at, city, path}`).
- `notice_deliveries(id, outbox_id, channel CHECK in(push,email,whatsapp), status CHECK in(pending,sending,sent,delivered,
  opened,failed,skipped_pref,skipped_quiet,skipped_cap,skipped_expired,skipped_channel_off,skipped_no_contact,superseded),
  attempts int, next_attempt_at, provider_message_id, last_error text (truncado, sem PII), sent_at, delivered_at, opened_at)`.
  UNIQUE `(outbox_id, channel)`; índice parcial `(next_attempt_at) WHERE status='pending'`; UNIQUE `(channel, provider_message_id)`.
- `notice_preferences(user_id PK, push bool default true, email bool default true, whatsapp bool default false,
  quiet_start time default '22:00', quiet_end time default '07:00', tz text default 'America/Sao_Paulo', updated_at)`.
- `notice_consents(id, user_id, channel, action CHECK in(opt_in,opt_out), source CHECK in(app,email_link,whatsapp_stop,admin),
  phone_e164 text NULL, text_version text, ip inet NULL, created_at)` — **append-only**, sem UPDATE/DELETE.
- `push_subscriptions(id, user_id, endpoint text UNIQUE, p256dh, auth, user_agent, created_at, last_success_at, failed_count)`.
- `notice_channel_settings(channel PK, enabled bool default false, whatsapp_delay_min int default 10, daily_cap int)`.

RLS: `notice_preferences`, `push_subscriptions` → dono SELECT/INSERT/UPDATE/DELETE (`user_id = auth.uid()`).
`notice_consents` → dono SELECT; INSERT só por RPC `set_notice_preference(channel, enabled, phone?)` (DEFINER,
grava preferência + consentimento na mesma transação). `notice_outbox`/`notice_deliveries`/`notice_channel_settings` →
sem policy para client (só service_role). Nenhuma FK CASCADE em consentimento (retenção legal; anonimizar em vez de apagar).

## 3. Funções

- `internal_enqueue_notice(...)` DEFINER, `search_path=''`, **sem GRANT a authenticated/anon**. Faz
  `INSERT ... ON CONFLICT DO NOTHING` no outbox e cria uma `notice_deliveries` `pending` por canal; WhatsApp nasce com
  `next_attempt_at = now() + delay` e só se `urgency='urgent'`.
- `claim_notice_batch(p_limit int)` DEFINER, só service_role: `UPDATE ... SET status='sending' WHERE id IN (SELECT ... FOR UPDATE
  SKIP LOCKED)`; antes de devolver, aplica regras em SQL (fonte única):
  1. expirado (`expires_at < now()`, ou alvo já respondeu / chamado não `open`) → `skipped_expired`;
  2. preferência desligada ou sem opt-in vigente (último `notice_consents`) → `skipped_pref`;
  3. horário silencioso no fuso do usuário → reagenda para `quiet_end`, **exceto** `urgent` (que envia);
  4. teto: máx 6 push/3 e-mails/2 WhatsApp por pessoa em 24h (`urgent` conta mas só é barrado no WhatsApp) → `skipped_cap`;
  5. WhatsApp: se `notifications.read_at` preenchido ou alvo respondeu → `superseded`.
- `report_notice_result(id, status, provider_message_id, error)` service_role. Falha → `attempts+1`,
  backoff `1, 5, 30, 120 min`, máx 4, depois `failed`. Erro 404/410 de push → apaga a inscrição.
- `record_notice_event(channel, provider_message_id, status)` para webhooks (delivered/opened/bounced/complaint).
  Bounce/complaint de e-mail → opt-out automático com `source='email_link'`.

## 4. Edge Functions (Deno)

- `notice-dispatch` — `--no-verify-jwt`; exige `x-dispatch-secret`; sem `NOTICE_DISPATCH_SECRET` → 503 sem efeito.
  Lote de 50; por canal: push (`web-push` com `VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT`), e-mail
  (`_shared/email.ts` com `RESEND_API_KEY`, header `List-Unsubscribe` + `List-Unsubscribe-Post`), WhatsApp
  (`graph.facebook.com/v{N}/{WA_PHONE_NUMBER_ID}/messages`, `WA_ACCESS_TOKEN`, template utility). Segredo ausente →
  `skipped_channel_off`. Nada de PII em log.
- `notice-webhook-resend` — verifica assinatura Svix (`RESEND_WEBHOOK_SECRET`) e janela de 5 min; rejeita sem.
- `notice-webhook-whatsapp` — GET de verificação com `WA_VERIFY_TOKEN`; POST valida `X-Hub-Signature-256` (HMAC
  `WA_APP_SECRET`) sobre o corpo cru; "PARAR"/"SAIR" → opt-out registrado.
- `notice-unsubscribe` — link assinado HMAC (`user_id`, canal, validade 90 dias); GET mostra confirmação, POST desliga
  (One-Click RFC 8058 é POST). GET nunca altera estado (prefetch de antivírus).
- Agendador: migration com `IF EXISTS pg_cron AND pg_net` → `cron.schedule('notice-dispatch','* * * * *', net.http_post(...))`
  lendo o segredo do Vault (`vault.decrypted_secrets`), nunca literal na migration. Senão, `RAISE WARNING` e cron externo.
  Gatilho de fila vazia: a função sai em <100 ms.

## 5. Web Push no frontend (F1)

- `sw.js`: acrescentar `push` (mostra `title`/`body`/`data.path`, `tag` = event_id para não empilhar) e `notificationclick`
  (foca janela existente ou `openWindow(path)` só se `path` começa com `/`). **Não** tocar em `install`/`activate`/`message`;
  manter sem `skipWaiting` automático. Bump de versão do cache segue o fluxo atual.
- Pedido de permissão **só após gesto**: no aceite do primeiro convite de Elenco ou ao abrir "Meus turnos" com convite
  pendente, cartão "Avisar quando chegar turno?". Nunca no carregamento. Recusou → não pergunta de novo por 30 dias.
- iOS: push só em PWA instalado (16.4+). Fora do modo standalone mostrar instrução "Adicionar à Tela de Início"; não pedir.
- Tela de preferências em Perfil: toggles por canal, horário silencioso, telefone do WhatsApp com checkbox e texto versionado.

## 6. Conteúdo

Push/e-mail/WhatsApp: "{Empresa} chamou você para um turno em {dia} às {hora} ({cidade}). Abra o Worki para responder."
Link `https://<app>/my-jobs` (ou `/convite/...` existente que **só mostra**). E-mail: template HTML neo-brutalista inline
(borda 2px #111, sombra sólida, CTA verde #00A651, caixa-alta), versão texto, rodapé com descadastro e endereço do remetente.
WhatsApp template `turno_disponivel` (pt_BR, utility) com 4 variáveis + botão URL. Proibido: CPF, PIX, valor, endereço, nome de outro freela.

## 7. LGPD e retenção

Base: execução de contrato (push/app/e-mail transacional) e consentimento (WhatsApp). `notice_outbox`/`deliveries`
apagados após 90 dias (cron); agregados de métrica preservados sem `recipient_id`. `notice_consents` 5 anos, telefone
anonimizado por `anonymize_account` (incluir as tabelas novas nela). `push_subscriptions` apagadas no `anonymize_account`.
Atualizar a Política de Privacidade (operadores: Resend, Meta) antes de ligar F2/F3.

## 8. Métricas

View `notice_funnel_daily` (service_role/admin-data): por canal e event_kind — enfileirado, enviado, entregue, aberto
(push click via `notificationclick` → RPC `mark_notice_opened(event_id)`; e-mail via webhook), skipped por motivo,
convite aceito (`shift_call_targets.response='accepted'`) e mediana de `responded_at - notified_at` por canal que chegou primeiro.
Custo WhatsApp estimado = conversas × tarifa utility.

## 9. Testes

- PGlite (`supabase/tests/pglite-*`): dedupe (enqueue 2× = 1 linha); rollback do evento não deixa outbox; client sem
  acesso a outbox/deliveries/consents INSERT; expiração → `skipped_expired`; quiet hours reagenda `normal` e envia
  `urgent`; teto; WhatsApp só com opt-in vigente e só `urgent`; `superseded` após `read_at`; backoff e `failed` após 4;
  payload com chave fora da lista é rejeitado; `anonymize_account` limpa as novas tabelas.
- Unit (Vitest/Deno): verificação Svix e `X-Hub-Signature-256` (válida, adulterada, fora da janela); link de descadastro
  (assinatura, expiração, GET sem efeito); renderização de template sem PII; dispatch com segredo ausente → 503 /
  `skipped_channel_off`; `sw.js` handlers recusam `path` absoluto externo.

## 10. Fases

- **F1 (grátis):** schema + enqueue nos 5 eventos + `notice-dispatch` só push + sw.js + permissão + preferências. App já existe.
- **F2:** e-mail Resend + webhook + descadastro + templates. Liga quando `RESEND_API_KEY` e domínio verificados.
- **F3:** WhatsApp Cloud API + opt-in + webhook. Liga quando template aprovado e `WA_*` configurados; `enabled=false` até lá.
Ordem de deploy: migration → funções → frontend.

## 11. O que SÓ O DONO pode fazer

F1 (Web Push):
1. Gerar par VAPID (`npx web-push generate-vapid-keys`) e gravar `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`,
   `VAPID_SUBJECT=mailto:contato@<dominio>` em Supabase → Edge Functions → Secrets; `VITE_VAPID_PUBLIC_KEY` na Vercel.
2. Gerar `NOTICE_DISPATCH_SECRET` (32+ bytes aleatórios), gravar nos Secrets e no Vault (`vault.create_secret`).
3. Habilitar `pg_net` (Database → Extensions) e confirmar `pg_cron`; aprovar a aplicação da migration (MCP interativo).

F2 (Resend):
4. Ter o domínio (`worki.com.br` ou outro) e acesso ao DNS.
5. Resend → Domains → Add (usar subdomínio `avisos.<dominio>`), copiar e publicar no DNS os registros SPF (TXT/MX) e DKIM;
   criar DMARC `_dmarc` `v=DMARC1; p=none; rua=mailto:...`. Aguardar "Verified".
6. Criar API key (permissão só "Sending") → Secret `RESEND_API_KEY`; ajustar remetente para o domínio verificado.
7. Resend → Webhooks → endpoint `notice-webhook-resend` (delivered, opened, bounced, complained) → Secret `RESEND_WEBHOOK_SECRET`.

F3 (WhatsApp Cloud API):
8. Criar/verificar Meta Business Portfolio (CNPJ, documentos) em business.facebook.com.
9. developers.facebook.com → criar app tipo Business → adicionar produto WhatsApp.
10. Número dedicado que **não** esteja no WhatsApp comum (ou migrá-lo), receber SMS/ligação de verificação, definir nome
    de exibição "Worki" (passa por aprovação).
11. Criar usuário de sistema, gerar token permanente com `whatsapp_business_messaging` → `WA_ACCESS_TOKEN`;
    copiar `WA_PHONE_NUMBER_ID`, `WA_BUSINESS_ACCOUNT_ID`, App Secret → `WA_APP_SECRET`; inventar `WA_VERIFY_TOKEN`.
12. Cadastrar forma de pagamento (cartão) no WhatsApp Manager: sem mensalidade, cobrança por conversa utility.
13. Submeter template `turno_disponivel` (pt_BR, Utility, texto do §6) e aguardar aprovação.
14. Configurar webhook do app para `notice-webhook-whatsapp` (campo `messages`) com o verify token.
15. Aprovar o texto de opt-in e a atualização da Política de Privacidade; ligar `notice_channel_settings.enabled` por canal.
