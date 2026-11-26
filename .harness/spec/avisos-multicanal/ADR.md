# ADR-20261125 — Avisos multicanal por outbox no banco (app, Web Push, e-mail, WhatsApp)

## Status
PROPOSTO (nada implementado nem aplicado)

## Contexto
Hoje o único aviso é a linha em `public.notifications` (sino + Realtime), que só alcança quem está com o
app aberto. A promessa do Chamado de Turno (F1) e do SOS (F11) é preencher vaga em minutos; F4 (véspera)
existe para alcançar "freela que não abriu o app". Sem canal fora do app, as três prometem mais do que entregam.

Fatos lidos no repositório (25/11/2026):
- `notifications(type)` aceita só `status_change|message|payment|system`: grosso demais para decidir canal.
- Os avisos nascem em triggers/RPCs SECURITY DEFINER (`claim_shift_slot`, `create_sos_call`, `trg_notify_*`,
  `notify_worker_on_shift_payment`, `internal_notify_member_event`, `notification_recipients_for_job` — E5, não aplicada).
- `_shared/email.ts` já fala com Resend (`RESEND_API_KEY`, degrada sem a chave); remetente `noreply@worki.com.br`
  sem domínio verificado. `send-notification` foi removida de produção (sem auth) e não volta.
- `frontend/public/sw.js` não tem handler de push (de propósito); atualização é por mensagem `SKIP_WAITING`.
- `pg_cron` é usado (F4, F8), guardado por `IF EXISTS`. **`pg_net` não aparece em nenhuma migration**: não assumir.

## Decisão
1. **Outbox transacional.** Tabela `notice_outbox` preenchida pela função interna
   `internal_enqueue_notice(event_kind, event_id, recipient_id, payload jsonb, expires_at, urgency)`, chamada
   **dentro** do trigger/RPC que gera o evento (mesmo commit). Se o evento faz rollback, o aviso some junto.
   Nunca envio no cliente; o cliente não tem INSERT nem EXECUTE.
2. **Um item por canal** (`notice_deliveries`), UNIQUE `(event_kind, event_id, recipient_id, channel)` =
   idempotência. Reprocessar nunca duplica.
3. **Despacho por puxada, não por empurrão.** Edge Function `notice-dispatch` (service_role) é acionada por
   `pg_cron` a cada minuto via `pg_net` **se a extensão existir**; senão, por Supabase Scheduled Function / cron
   externo. Ela reivindica lote com `claim_notice_batch()` (`FOR UPDATE SKIP LOCKED`), envia, grava resultado.
   Invocação exige header `x-dispatch-secret` = segredo `NOTICE_DISPATCH_SECRET` (comparação de tempo constante);
   deploy `--no-verify-jwt`. Sem o segredo configurado a função responde 503 e não faz nada.
4. **Canal desligado = segredo ausente.** `notice_channel_settings(channel, enabled)` + checagem de segredo na
   função. Canal sem segredo marca o item `skipped_channel_off`, sem erro ao usuário.
5. **Escalonamento por custo:** app (sempre, já existe) + Web Push (grátis) → e-mail (Resend, plano grátis) →
   WhatsApp (pago por conversa de utilidade) **só** se `urgency='urgent'` **e** a notificação continuar sem
   leitura/resposta após `whatsapp_delay_min` (default 10, por empresa/global).
6. **WhatsApp só pela Cloud API oficial da Meta**, template de categoria *utility*, opt-in explícito registrado
   (`notice_consents`). Nenhum BSP com mensalidade, nenhuma biblioteca não oficial.
7. **Conteúdo mínimo:** nome da empresa, dia/hora, cidade, link `/<rota>` do app. Sem CPF, PIX, valor, endereço
   completo, nome de terceiro. Link nunca executa ação ao abrir: leva à tela onde o freela decide (ação exige sessão).

## Consequências
### Positivas
- Atomicidade evento↔aviso; retry e dedupe triviais; métricas saem da própria fila.
- Canais ligam por segredo, sem deploy de código novo.
- Custo previsível: WhatsApp só no recorte urgente e não lido.
### Negativas / Trade-offs
- Latência de até ~1 min (cron). Aceitável para turno; inaceitável seria só para chat (fora de escopo).
- Mais uma superfície service_role com segredo próprio para girar.
- Cada produtor de aviso precisa chamar `internal_enqueue_notice` explicitamente (migração por evento).

## Alternativas rejeitadas
- **Trigger AFTER INSERT em `notifications` dispara tudo**: `type` não diz urgência nem expiração; acoplaria todo
  aviso de sino (inclusive chat) a canal pago. Fica como fonte só do sino.
- **Database Webhook / `pg_net` direto no trigger**: HTTP dentro do commit, sem retry nem dedupe, falha silenciosa.
- **Envio pelo frontend**: viola Article 10 e perde o aviso quando o autor fecha a aba.
- **Z-API/Evolution/whatsapp-web.js**: não oficiais, risco de ban do número; o dono vetou.
- **OneSignal/FCM SDK**: dependência e rastreamento de terceiro; VAPID puro resolve.

## Reversibilidade
Aditivo. DOWN = `DROP` das tabelas novas e remoção das chamadas a `internal_enqueue_notice`. Ponto difícil:
apagar `notice_consents` perde a prova de opt-in exigida pela Meta — retenção mínima de 5 anos antes de qualquer DROP.

## Referências
- Spec: .harness/spec/avisos-multicanal/spec.md
- F1 chamado-de-turno, F4 confirmacao-vespera, F11 sos-descoberta, E5 `notification_recipients_for_job`
