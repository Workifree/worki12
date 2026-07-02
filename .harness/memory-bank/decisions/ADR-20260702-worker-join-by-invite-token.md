# ADR-20260702 — Worker entra no elenco via link de convite (RPC SECURITY DEFINER, nasce 'accepted')

## Status
ACEITO

## Contexto
Fix bloqueante do GTM. A forcing-function do produto (pivô empresa-primeiro) é: a EMPRESA gera um link
de convite (Meu Elenco → Adicionar → Link) e manda pro freela; o freela logado abre `/convite/:token`
e entra no elenco da empresa.

No E2E de prod (contas novas) o worker abrindo o link recebe "LINK INVÁLIDO" + **403 em
`POST /rest/v1/team_connections`**. Causa-raiz: `teamConnectionService.addToTeamByToken` faz **INSERT
direto como o worker**, mas a policy `tc_insert_company` (migration `20260622000000_team_connections.sql`)
só autoriza a EMPRESA a inserir (`WITH CHECK company_id ∈ companies do auth.uid()`). Worker inserindo →
viola RLS → 403.

O caminho oposto funciona: empresa adiciona por Worki ID/QR (INSERT pela empresa, `pending`) → worker
aceita (`UPDATE` via `tc_update_worker`, `pending→accepted`). Só o **link empresa→worker** está quebrado.

Restrição de segurança: o token da empresa é `base64url(company_id)` — **não assinado, forjável**. Qualquer
worker que conheça/derive um `company_id` pode forjar o token.

## Decisão
1. **RPC `SECURITY DEFINER` estreita** (`accept_company_invite_by_token(p_token text)`) em vez de abrir uma
   policy de INSERT ampla pro worker. A RPC roda como owner (bypassa RLS) mas valida e **força server-side**:
   `worker_id := auth.uid()`, `status := 'accepted'`, `source := 'link'`, empresa existe, caller é worker
   (isolamento de papel). O INSERT direto do worker na tabela continua **proibido**; as policies existentes
   ficam **intactas** → o fluxo que já funciona não muda.
2. **A conexão nasce `accepted`** (não `pending`). Ambos os lados já consentiram: a empresa deliberadamente
   gerou e enviou o link; o worker abriu e está logado. Um `pending` só adicionaria uma reconfirmação
   redundante da empresa (ela iniciou o convite), **sem ganho de segurança** — o token é forjável de qualquer
   forma e uma linha forjada exige a mesma remediação (empresa bloqueia/deleta) seja `pending` ou `accepted`.
3. **Idempotente**: conexão existente é retornada sem alteração; em particular **não reabre `blocked`** (veto
   do freela preservado).

## Consequências
### Positivas
- GTM one-shot: worker abre o link → entra no elenco, sem passo extra.
- Superfície mínima: nenhuma policy nova, nenhum INSERT direto do worker liberado; a lógica sensível fica
  server-side numa função auditável. Reversível via `DROP FUNCTION`.
- Caminho legado (empresa-adiciona-por-ID → worker-aceita) intocado.

### Negativas / Trade-offs
- **Auto-inserção como `accepted` via token forjável (spam leve).** Um worker malicioso pode se inserir no
  roster de qualquer empresa cujo `company_id` conheça. Impacto **limitado**: (a) a RLS de SELECT só expõe a
  própria linha do worker — **nenhum acesso indevido a dados** da empresa (jobs, outros workers, financeiro);
  (b) a empresa dirige os convites de turno — não convida quem não reconhece; (c) remediação existente: a
  empresa `DELETE` (`tc_delete_company`) ou bloqueia. O delta de risco entre spam-`pending` e spam-`accepted`
  é pequeno e tem a mesma remediação.
- A forjabilidade do token é a raiz do risco residual. Não é resolvida aqui (gatilho de reabertura abaixo).

## Alternativas rejeitadas
- **(b) Nova policy de INSERT `worker_id = auth.uid() AND status='pending'`**: mais simples, mas (i) abre
  escrita direta do worker na tabela (menos controle sobre `source`/validação de empresa), e (ii) força um
  passo de aceite adicional que a empresa/worker considera redundante — sem reduzir o risco de spam forjável.
- **Nascer `pending`**: fricção redundante sem ganho de segurança sobre a forjabilidade do token.
- **Assinar o token (HMAC) agora**: correto a longo prazo, mas fora do escopo do fix bloqueante e exigiria
  segredo + mudança no `generateInviteToken` do frontend. Registrado como gatilho de reabertura.

## Gatilhos de reabertura
- Se o spam de auto-inserção virar problema real em prod → assinar o token (HMAC com segredo em Edge Function)
  ou exigir expiração/nonce; então a RPC valida assinatura e o "ambos consentiram" deixa de depender de token
  forjável.

## Referências
- Migration: `supabase/migrations/20260702120000_worker_join_by_invite_token.sql`
- Bug/contrato: `teamConnectionService.addToTeamByToken`; policy `tc_insert_company` em
  `supabase/migrations/20260622000000_team_connections.sql`
- ADR relacionado: `ADR-20260622-aceite-convite-invited-hired.md` (máquina de estados de conexão/convite)
