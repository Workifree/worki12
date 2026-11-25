# Integração dos avisos multicanal

F1 (push) e F2 (e-mail) construídas; F3 (WhatsApp) pronta e desligada. Nada aplicado, publicado ou commitado.

## 1. Ligações nas telas (ainda não feitas)

| Onde | O quê |
|---|---|
| `layouts/MainLayout.tsx` e `layouts/CompanyLayout.tsx` | `useEffect(() => { void syncPushSubscription(); return watchNoticeOpens() }, [])` |
| Todo ponto de logout (Sidebar, perfis, `AcessoEncerrado`, `SemAcesso`) | `await disablePushOnThisDevice()` **antes** de `supabase.auth.signOut()`. Obrigatório: sem isso, aparelho compartilhado segue recebendo avisos da conta que saiu |
| `pages/MyJobs.tsx` | `{temConvitePendente && <PedidoDeAvisos />}` |
| Após o aceite do primeiro convite de Elenco (`pages/InviteAccept.tsx`, na tela de sucesso) | `<PedidoDeAvisos />`. Se a tela redireciona na hora, basta o ponto de `MyJobs` |
| `pages/Profile.tsx` e `pages/company/CompanyProfile.tsx` | `<PreferenciasDeAvisos />`. Sem `whatsappDisponivel` até a F3 |
| Política de Privacidade | Citar Resend (F2) e Meta (F3) como operadores, antes de ligar cada canal |

Nenhuma rota nova em `App.tsx`. O descadastro é estático (`public/descadastro.html` + `.js`), porque o Supabase
não serve HTML a partir de Edge Function. A URL do projeto está fixa em `descadastro.js`.

## 2. Chaves e segredos

Nenhuma chave privada vai para o repositório, para o chat ou para arquivo versionado.

### VAPID (F1)

1. Num terminal fora do repositório: `npx web-push generate-vapid-keys`
2. Supabase > Edge Functions > Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT=mailto:<e-mail de contato>`.
3. Vercel > Environment Variables: `VITE_VAPID_PUBLIC_KEY` (a mesma chave **pública**). Exige novo build.
4. Guardar o par num cofre de senhas. Trocar o par invalida todas as inscrições existentes.

### Disparo

- Gerar: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
- Secret `NOTICE_DISPATCH_SECRET`, e no SQL Editor o mesmo valor:

```sql
select vault.create_secret('<mesmo valor>', 'notice_dispatch_secret');
select vault.create_secret('https://vrklakcbkcsonarmhqhp.supabase.co/functions/v1/notice-dispatch', 'notice_dispatch_url');
```

### E-mail (F2)

`RESEND_API_KEY`, `NOTICE_EMAIL_FROM` (ex.: `Worki <avisos@avisos.seudominio>`, domínio verificado),
`NOTICE_UNSUBSCRIBE_SECRET` (gerar como o do disparo), `RESEND_WEBHOOK_SECRET`.
Opcionais: `NOTICE_SENDER_ADDRESS` (rodapé), `APP_URL`.
Sem os três primeiros, o e-mail fica `skipped_channel_off`.

### WhatsApp (F3)

`WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN` (opcionais: `WA_TEMPLATE_NAME`,
`WA_API_VERSION`). Além deles: `update notice_channel_settings set enabled = true where channel = 'whatsapp';`
e `whatsappDisponivel` no componente de preferências.
O template precisa de 4 variáveis no corpo (empresa, dia, hora, cidade) e um botão de URL
`https://<app>/{{1}}`. Conferir `WA_API_VERSION` (padrão `v21.0`) contra a versão vigente da Meta.

## 3. Ordem de deploy

1. Migrations `20261201000100`, `000200`, `000300`, nesta ordem, dirigidas (nunca `supabase db push`).
2. Conferir: `select jobname from cron.job where jobname like 'notice-%';` (2 linhas) e
   `select public.internal_trigger_notice_dispatch();`.
3. `supabase functions deploy <nome> --no-verify-jwt` para `notice-dispatch`, `notice-webhook-resend`,
   `notice-webhook-whatsapp`, `notice-unsubscribe`.
4. Frontend.

Entre os passos 1 e 3 a fila acumula; o que vencer sai como `skipped_expired`. Aviso de pagamento vale 30 dias:
se o disparo for ligado muito depois, pagamentos antigos ainda serão avisados.

Sem `pg_net`: cron externo a cada minuto fazendo `POST` na função com o header `x-dispatch-secret`.

## 4. Testes

```
npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-avisos/run.mjs
node supabase/tests/pglite-avisos/edge.mjs
cd frontend && npx vitest run src/lib/serviceWorker.test.ts src/lib/serviceWorkerPush.test.ts
```

Não coberto: o envio real (`npm:web-push` no runtime Deno, Resend, Meta), `pg_net`/Vault reais e o schema real
de produção (o PGlite usa stubs). Fazer um push de ponta a ponta num aparelho depois do deploy.

## 5. Desvios da spec

- Produtores são triggers `AFTER` nas tabelas de origem; as RPCs existentes não foram reescritas. Falha ao
  enfileirar gera `WARNING` e não derruba o aceite, o pagamento nem o cancelamento.
- `claim_notice_batch` recebe também `p_channels` (canais que têm segredo).
- Aviso normal que venceria dentro do horário silencioso sai como `skipped_quiet`.
- Backoff: quatro novas tentativas (1, 5, 30, 120 min); a falha seguinte marca `failed`.
- `superseded` por leitura depende de abertura do push ou da linha do sino criada na mesma transação (ou com o
  mesmo link em até 1 min). A resposta ao chamado sempre vale.
- Clique no push não navega uma janela aberta em outra tela (evita perder formulário): usa `openWindow`.
- Sem `inet` no consentimento feito pelo app (a RPC não recebe IP).
