# ADR-20261123 — Prévia pública do convite de equipe: GRANT anon em RPC de projeção fechada

## Status
ACEITO (parecer do architect sobre a pendência de E4, 23/11/2026).

## Contexto
A8/R13 da spec `equipe-encarregados` exigem que quem abre o link de convite **sem sessão** veja
"{Empresa} te convidou como {Papel}" antes de informar e-mail/código. Em `20261123000500`,
`get_member_invite_preview(text)` só tem EXECUTE para `authenticated, service_role` (o builder seguiu a
regra de não dar `anon`). Sem decisão, A8 não fecha pelo banco.

## Decisão
1. **`GRANT EXECUTE ON FUNCTION public.get_member_invite_preview(text) TO anon`** — exceção explícita e
   única à regra "sem anon", restrita a esta função. Ela continua SECURITY DEFINER, `SET search_path = ''`,
   STABLE.
2. **Projeção fechada, como está hoje:** `{outcome, company_name, role}`. **Não** acrescentar nome do
   convidado nem de quem convidou: a anon não entrega nome de pessoa (o convidado já sabe quem é).
3. **Colapso de erro:** token inexistente, queimado, rotacionado, revogado, malformado ou de tamanho
   inválido → `not_found` genérico. `expired` só para token vivo vencido (não revela nada além do que o
   portador já tem). Nenhum RAISE com detalhe; validar tamanho/charset do token antes do SELECT.
4. **Rate-limit:** não é a defesa de enumeração — o token tem ~244 bits, adivinhar é inviável. Fica a
   proteção padrão do gateway/PostgREST. Não criar tabela de tentativas.
5. **Exposição no PostgREST:** dar EXECUTE a anon publica a função em `/rpc/` e no schema OpenAPI para
   anon. Aceitável porque a assinatura não revela nada. Nenhuma outra função de E4 ganha anon. O gate da
   migration passa a afirmar que esta é a **única** função de E4 com EXECUTE para anon.
6. O frontend segue o padrão de `InviteAccept`/`AcceptManagerInvite`: rota pública fora do
   `ProtectedRoute`, token guardado em sessionStorage, e o aceite (`accept_company_member_invite`) só
   **depois** do login, sem anon.

## Consequências
### Positivas
- A8 fecha só com o banco, sem nova peça de infraestrutura.
- Nenhum uso novo de service_role (Article 10). Nenhuma Edge Function nova com CORS para manter (Article 11).
- Tem o mesmo formato de vitrine mínima de `get_worker_referral_card`.
### Negativas / Trade-offs
- Abre precedente de anon em RPC. Daqui em diante, cada exceção precisa de ADR próprio.
- Quem tem o link vê nome da empresa e papel. Vazamento do link = vazamento desse par, e só dele.
  Aceitar exige login, e operar exige confirmação do Gestor (ADR-20261123-encarregado-confirmado-e-pii).

## Alternativas rejeitadas
- **Edge Function pública com service_role:** traz mais superfície (service_role, CORS, deploy
  `--no-verify-jwt`) para entregar o mesmo resultado. O rate-limit dela seria em memória, por instância,
  logo fraco, e nem é a defesa que importa.
- **Exigir login antes da prévia:** quebra A8; a pessoa se cadastraria sem saber para quem.
- **Pôr o nome da empresa no próprio link:** não é verificável e é falsificável.

## Referências
- Spec: .harness/spec/equipe-encarregados/spec.md (R13, A8)
- Migration: supabase/migrations/20261123000500_equipe_e4_convites_e_papel.sql (§3.4, GRANTs :1245-1255)
- ADR-20261123-encarregado-confirmado-e-pii
