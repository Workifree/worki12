# Spec — cpf-restrito

Decisão do dono: empresa com vínculo não vê CPF nem data de nascimento do freela, exceto no recibo e no termo de
serviço. ADR: `ADR-20261125-cpf-restrito.md`.

## Requisitos
- R1. Uma sessão `authenticated` que não seja o próprio freela não lê `workers.cpf` nem `workers.birth_date`,
  por nenhum caminho do PostgREST (select direto, `*`, embed). (Etapa 2.)
- R2. O freela lê e edita o próprio cadastro completo. Leitura: `rpc('get_my_worker_profile')`, que devolve jsonb
  com a linha ou `null`. Gravação de CPF e nascimento: `rpc('set_my_worker_identity', { p_cpf, p_birth_date })`.
  Retornos: `saved | cpf_locked | invalid_cpf | not_found | unauthenticated`.
- R3. O termo de serviço e o recibo seguem com o CPF. Eles já o leem por DEFINER: `generate_service_term_on_payment`
  e `accept_service_term`, ambos em `20260817001100`.
- R4. Trilha (`bonus_worker_exclusion` compara o PIX do operador com `w.cpf`), `anonymize_account`,
  `delete-account` (service_role) e `admin-data` (service_role) seguem sem mudança.
- R5. A etapa 1 não pode mudar o comportamento do site publicado.

## Etapa 1 — agora
- Migration `20261129000100_cpf_leitura_propria.sql`, só aditiva.
- Frontend conforme `integracao.md`. Nada de `select('*')` em `workers` e nada de `cpf`/`birth_date` em caminho de empresa.
- Gate: build, lint, `pglite-cpf` verde. O tester confere onboarding novo, edição de CPF no Perfil, Dashboard do
  freela e recibo/termo do lado da empresa.

## Etapa 2 — só depois de a etapa 1 estar publicada (main + Vercel)
- Promover `etapa2_trava_coluna.sql.pendente` a migration. Antes, rodar a pré-checagem do cabeçalho no catálogo.
- Comparação feita no ADR. Escolhida a opção por coluna. Pontos auditados:
  | Ponto | Por coluna (A) | Tabela separada (B) |
  |---|---|---|
  | Upsert do onboarding | Quebra se mandar cpf. A etapa 1 já remove o cpf do upsert | Reescrever para duas escritas |
  | delete-account | service_role, sem efeito | Incluir a tabela nova |
  | anonymize_account | DEFINER, sem efeito | Reescrever o UPDATE |
  | Termos de serviço | DEFINER, sem efeito | Reescrever os 2 SELECTs |
  | Trilha (`bonus_worker_exclusion`) | DEFINER, sem efeito | Reescrever o JOIN |
  | `profile_trust_guard` | Sem efeito (to_jsonb em trigger não checa privilégio) | Tirar cpf/birth_date da lista |
  | Coluna futura em workers | Precisa de GRANT explícito | Não vaza |
- Risco residual: Realtime `postgres_changes` em `workers` respeita privilégio de coluna. Confirmar que nenhum canal
  assina `workers` (hoje nenhum foi encontrado no frontend).
- Ordem de deploy: o frontend da etapa 1 já em produção, depois a migration da etapa 2. Nunca o inverso.

## Fora de escopo
- `phone` e `pix_key` continuam visíveis para empresa com vínculo, porque o pagamento do modo A precisa deles.
