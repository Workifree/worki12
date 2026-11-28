# ADR-20261127 — Convite de Encarregado preso ao e-mail, sem OTP e sem envio de e-mail

## Status
ACEITO (gate do architect, 27/11/2026). Supera a parte "Aceite: signInWithOtp → verifyOtp" de E4
(R11-R15) para convites novos. Os demais pontos de E4 (token opaco, hash queimado, "é ele?", remoção) ficam.

## Contexto
O aceite de E4 depende do e-mail embutido do Supabase (OTP de 6 dígitos), que está devolvendo 429. O dono
decidiu que não vai configurar SMTP e que o convite não manda e-mail nenhum. O Gestor digita nome e e-mail
do Encarregado, copia o link e envia por WhatsApp. Na tela do link, o e-mail aparece travado e o
Encarregado só cria uma senha.

Consequência de segurança: **ninguém prova que é dono da caixa de e-mail.** Quem prova é quem tem o
token (256 bits) e quem confirma é o Gestor ("é ele?"). O desenho precisa aceitar isso de forma explícita
e não fingir que houve verificação.

Estado relevante, conferido no repositório:
- `company_members.invited_email` existe desde F13 (20260818100000), com
  `uq_company_members_pending_email UNIQUE (company_id, lower(invited_email)) WHERE status='invited'`.
- `invite_company_member` hoje faz `RAISE` em qualquer `unique_violation` que não seja do índice de nome.
  Com e-mail gravado, o índice de e-mail passa a disparar e viraria erro 500.
- `accept_company_member_invite` exige `email_confirmed_at` e grava `accepted_email`. Não compara com
  `invited_email`.
- `anonymize_account` já anula `invited_email` de `company_members`. Nada a mudar na LGPD.
- `_shared/rate-limit.ts` é em memória, por isolate. É fraco e serve só como freio.

## Decisão
Uma recomendação, em cinco partes.

### 1. `invite_company_member(p_company_id, p_display_name, p_role, p_email text DEFAULT NULL)`
- `DROP FUNCTION public.invite_company_member(uuid, text, text)` e cria a assinatura de 4 argumentos.
  Com `DEFAULT NULL`, o frontend antigo continua resolvendo a chamada no PostgREST durante a janela de
  deploy, mas recebe `email_required` e não cria convite sem e-mail. **Convite novo sem e-mail deixa de
  existir.**
- O e-mail é normalizado com `lower(btrim())` e validado: tamanho 3 a 254, regex simples
  `^[^@\s]+@[^@\s]+\.[^@\s]+$`, sem caractere de controle. Se falhar, `invalid_email`.
- A idempotência passa a ser por **(empresa, e-mail)**. Se houver convite pendente vigente para o mesmo
  e-mail, devolve `already_invited` com o token vigente. Se estiver vencido, reemite (`reinvited`).
- Se houver convite pendente com o mesmo nome normalizado e outro e-mail, devolve `name_already_invited`.
  Não sobrescreve.
- O handler de `unique_violation` trata **também** `uq_company_members_pending_email`, porque o índice de
  e-mail agora dispara.
- Se o e-mail já pertence a um membro **ativo** desta empresa, devolve `already_member`. A verificação
  é por `accepted_email`, ou por `auth.users` com `user_id` ativo.
- Recusa no convite se o e-mail já é conta de freela (`worker_cannot_be_manager`). Assim o Gestor descobre
  na hora, e não o Encarregado no link. O Gestor só descobre "esse e-mail é de freela", o que já é
  inferível hoje. É aceitável e evita link morto.
- `resend_member_invite` não muda de assinatura. Ele rotaciona o token e **mantém** `invited_email`.
  Trocar o e-mail exige revogar e convidar de novo, para que o e-mail nunca mude com o token vivo.

### 2. `get_member_invite_preview` devolve o e-mail **mascarado**, nunca completo
- A resposta passa a ser `{outcome, company_name, role, email_masked, email_bound}`. O mascaramento usa a
  mesma regra do aviso ao Gestor (`jo***@dominio.com`). `email_bound` é `invited_email IS NOT NULL`.
- Motivo: a função é `anon`. Um link vazado (print de WhatsApp, grupo errado) não deve entregar o e-mail
  pessoal de terceiro a quem o lê. O Encarregado não precisa digitar o e-mail, porque o servidor usa
  `invited_email`. A tela mostra o campo travado com o valor mascarado, e isso basta para ele reconhecer
  que o convite é para ele.
- O e-mail completo só sai **depois** que a Edge Function aceita o token **e** a senha: ela devolve o
  e-mail para o cliente fazer `signInWithPassword`. Nesse ponto, quem tem o token já é dono daquela conta
  nova, então não há vazamento adicional.

### 3. Edge Function `accept-team-invite` (service_role, `verify_jwt=false`, CORS com OPTIONS)
- Entrada: `{token, password, accept_tos}`. Rejeita no corpo se o token não tiver 64 hex, se
  `accept_tos !== true` ou se a senha tiver menos de 8 ou mais de 72 caracteres (limite do bcrypt).
- A função **não lê tabela direto**. Ela chama uma RPC nova,
  `internal_team_invite_provision_check(p_token)` (SECURITY DEFINER, `search_path=''`, EXECUTE **só**
  para `service_role`). A RPC valida o token (`invite_token = token`, `status='invited'`,
  `role='encarregado'`, não vencido, `invited_email NOT NULL`) e classifica o e-mail em `auth.users` e
  `public.workers`. Devolve `{outcome, email, account}`, com `account` igual a
  `none | company | worker | unconfirmed`.
  Evita `auth.admin.listUsers` paginado e mantém a regra no banco.
- Desvios por `account`:
  - `none`: `auth.admin.createUser({ email: invited_email, password, email_confirm: true,
    user_metadata: { user_type: 'hire' }, app_metadata: { provisioned_via: 'team_invite',
    email_ownership: 'not_verified' } })`. Se ocorrer a corrida "already registered", trata como
    `company` (não repete, não troca senha). Responde `{outcome:'created', email}`.
  - `company`: **não cria, não troca senha e não confirma e-mail.** Responde
    `{outcome:'existing_account'}` **sem** o e-mail. A tela pede e-mail e senha da conta que a pessoa já
    tem. O aceite segue o fluxo com sessão, e a comparação do item 4 garante que é a mesma pessoa.
  - `worker`: responde `{outcome:'worker_cannot_be_manager'}`.
  - `unconfirmed`: a conta existe com `email_confirmed_at` nulo. **Não confirmar e não trocar senha.**
    Confirmar entregaria a conta a quem definiu aquela senha, que pode ser outra pessoa. Responde
    `{outcome:'account_pending'}`. A tela orienta a pessoa a pedir ao Gestor um convite com outro e-mail.
  - Token inválido, vencido ou revogado: devolve o mesmo `not_found` ou `expired` da prévia, sem detalhe.
- A função **não queima o token**. Quem queima é `accept_company_member_invite`, numa transação. Se o
  cliente cair entre a criação e o aceite, reabrir o link cai em `existing_account`, e a pessoa entra com
  a senha que acabou de criar. O fluxo é idempotente.
- A função **não aceita o convite**. O cliente faz `signInWithPassword` e depois
  `accept_company_member_invite(token, true)`. Uma única porta de ativação continua existindo.
- Logs sem e-mail, senha ou token. Registra só o `outcome`.
- Rate limit por IP com `_shared/rate-limit.ts` (10 por 10 min). O controle forte é outro: cada token
  cria no máximo uma conta, porque depois disso o e-mail existe.

### 4. `accept_company_member_invite` passa a exigir sessão == e-mail convidado
- Depois de ler `v_email` (e-mail da sessão), quando `v_row.invited_email IS NOT NULL` e
  `v_email <> lower(btrim(v_row.invited_email))`, devolve `email_mismatch` **sem consumir o token**.
  Fica antes de qualquer UPDATE.
- A checagem `email_not_verified` continua. Para conta criada pela função, ela passa, porque
  `email_confirm: true`. **O `email_confirmed_at` deixa de significar "provou a caixa" para esses
  usuários.** A marca honesta fica em `app_metadata.email_ownership='not_verified'`, e o aviso ao Gestor
  passa a dizer "e-mail informado por você, não verificado". O "é ele?" é o controle real.
- Convites com `invited_email` nulo seguem pelo ramo antigo (OTP) sem mudança de código no banco.

### 5. Compatibilidade com os 2 convites de hoje (`invited_email` nulo)
- Não fazer backfill. Não há como saber o e-mail certo, e inventar quebraria a garantia do item 4.
- O ramo OTP continua no banco, mas na prática está morto (429). A tela do link, ao receber
  `email_bound=false`, mostra: "Este convite é de um modelo antigo. Peça ao Gestor um novo link." Não
  chama OTP.
- O Gestor revoga os dois e convida de novo com e-mail. Isso vai na nota de deploy.
- Uma migration futura pode remover o ramo OTP quando não houver mais convite pendente sem e-mail. Gatilho:
  `count(*) WHERE status='invited' AND role='encarregado' AND invited_email IS NULL` = 0.

## Riscos e mitigação obrigatória

| Risco | Avaliação | Mitigação obrigatória |
|---|---|---|
| Account takeover de e-mail existente | Seria crítico se a função trocasse senha ou confirmasse conta existente | A função **nunca** chama `updateUserById` e nunca cria se o e-mail existe. Conta `unconfirmed` não é confirmada. Conta existente só entra com a própria senha, e o aceite compara o e-mail da sessão |
| Pré-criação de conta com e-mail de terceiro (o Gestor digita o e-mail de outra pessoa, ou digita errado) | Real, aceito pelo dono ao abrir mão de e-mail. Cria conta confirmada sem prova de caixa | A conta nasce `hire` e só pode ser Encarregado **não confirmado**, que opera zero até o "é ele?". `app_metadata.email_ownership='not_verified'`. O dono verdadeiro recupera pela redefinição de senha quando houver e-mail, ou por `anonymize_account`. Documentado como débito. Erro de digitação: o Gestor vê o e-mail completo em `list_company_members` antes de confirmar |
| Token vazado | Quem tem o token cria a senha e vira Encarregado não confirmado | Prévia mascara o e-mail. O token queima no aceite. Validade de 14 dias. O Gestor confere nome, e-mail e hora no "é ele?" (72h) e pode revogar. Encarregado não confirmado não cria turno, não dispara SOS e não lê PII |
| Enumeração de e-mails | A função não recebe e-mail, só token: só revela "existe conta" para o único e-mail que o Gestor escolheu, e só para quem tem o token. `invite_company_member` revela "é freela" ao Gestor | Sem e-mail como entrada pública. Rate limit por IP. `existing_account` não devolve o e-mail |
| Spam de criação de usuários | Limitado: uma conta por token, e o token só nasce de Gestor autenticado | Rate limit por IP mais a regra de uma conta por token. O `invite_company_member` herda o lock da empresa |
| Isolamento de papel (Article 1) | Freela virando membro de empresa | Recusa em três pontos: no convite, na função e no aceite (`workers`) |

## Migration (antes de tudo)
`supabase/migrations/20261127000200_convite_encarregado_preso_ao_email.sql`, idempotente:
1. `DROP FUNCTION IF EXISTS public.invite_company_member(uuid, text, text);` e cria a versão de 4 argumentos
   (item 1), com `GRANT EXECUTE ... TO authenticated, service_role` e `COMMENT`.
2. `CREATE OR REPLACE public.resend_member_invite`: só o COMMENT muda (mantém o e-mail). Opcional.
3. `CREATE OR REPLACE public.get_member_invite_preview`: adiciona `email_masked` e `email_bound`. Mantém
   VOLATILE e o GRANT para `anon`.
4. `CREATE OR REPLACE public.accept_company_member_invite(text, boolean)`: adiciona `email_mismatch` (item 4)
   e o texto do aviso "não verificado". Mantém o GRANT.
5. `CREATE FUNCTION public.internal_team_invite_provision_check(text)` com SECURITY DEFINER e
   `search_path=''`. `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, depois
   `GRANT EXECUTE ... TO service_role`.
6. Down: recriar as versões de E4 (corpo de 20261123000500) e
   `DROP FUNCTION IF EXISTS public.internal_team_invite_provision_check(text);`.

Nenhuma coluna nova e nenhum `ALTER TABLE`. Não toca saldo (Article 8).

**Pré-requisito: E4 aplicada.** Esta migration reescreve funções de E4.

**Ordem de deploy:** (1) migration, (2) `supabase functions deploy accept-team-invite --no-verify-jwt`,
(3) frontend. Atualizar o Article 11 e a memória: `accept-team-invite` entra na lista de funções
`--no-verify-jwt`. É a terceira, com auth própria pelo token.

## Arquivos para o builder
Criar:
- `supabase/migrations/20261127000200_convite_encarregado_preso_ao_email.sql`
- `supabase/functions/accept-team-invite/index.ts` (CORS e OPTIONS, prod e `localhost:5173`, client
  service_role via `Deno.env`, `_shared/rate-limit.ts`)

Alterar:
- `supabase/config.toml`: `[functions.accept-team-invite] verify_jwt = false`, se o arquivo declara funções
- `frontend/src/services/teamMembersService.ts`: `inviteMember` com `email`; `getInvitePreview` com
  `email_masked` e `email_bound`; nova `provisionInviteAccount(token, password)` via `invokeFunction`;
  outcomes novos (`email_required`, `invalid_email`, `name_already_invited`, `already_member`,
  `email_mismatch`, `existing_account`, `account_pending`)
- `frontend/src/pages/AcceptTeamInvite.tsx` e `AcceptTeamInvite.test.tsx`: remove OTP; e-mail mascarado
  travado; senha e confirmação; ramos `existing_account` (pede e-mail e senha), `account_pending` e
  convite legado
- `frontend/src/pages/company/CompanyTeamMembers.tsx`: campo e-mail obrigatório no convite
- `frontend/src/types/index.ts`: tipos de outcome e prévia, se vivem lá
- `frontend/src/lib/teamInviteToken.ts`: sem mudança esperada. Só reutilizar a validação de 64 hex
- `.harness/memory-bank/architecture.md` (pelo memory-updater): "Convite por link" e a lista `--no-verify-jwt`

## Consequências
### Positivas
- O convite funciona sem SMTP e sem a cota de e-mail do Supabase.
- O link fica preso a uma identidade. Token vazado não vira conta com e-mail arbitrário.
- A ativação continua numa porta só (`accept_company_member_invite`), e o token queima numa transação.

### Negativas / Trade-offs
- `email_confirmed_at` deixa de provar posse da caixa para contas provisionadas. Isso fica marcado em
  `app_metadata` e o "é ele?" do Gestor vira o controle principal.
- Possível conta "ocupando" o e-mail de um terceiro. Remédio manual: anonimização ou redefinição.
- Terceira função `--no-verify-jwt`. É mais superfície pública, contida pelo token de 256 bits.
- O rate limit em memória é fraco. É aceitável porque a regra de uma conta por token limita o dano.

## Alternativas rejeitadas
- **Prévia com e-mail completo**: vaza dado pessoal de terceiro a quem tiver o link, sem ganho de UX.
- **A função cria a conta e já aceita o convite com service_role**: seriam duas portas de ativação, e
  `auth.uid()` ficaria nulo no aceite, o que quebra o aviso e o seam.
- **Trocar a senha ou confirmar conta existente ou não confirmada**: é account takeover.
- **Backfill de e-mail nos 2 convites antigos**: não há fonte confiável.
- **Magic link, OTP ou SMTP próprio**: vetado pelo dono.
- **Overload de 3 e 4 argumentos coexistindo**: manteria viva a criação de convite sem e-mail.

## Referências
- `supabase/migrations/20261123000500_equipe_e4_convites_e_papel.sql` (invite, resend, preview, accept)
- `supabase/migrations/20260818100000_organizations_schema.sql` (`uq_company_members_pending_email`)
- ADR-20261123-previa-publica-do-convite, ADR-20261123-encarregado-confirmado-e-pii
- Branch `fix/convite-encarregado-email-sem-unidades`
