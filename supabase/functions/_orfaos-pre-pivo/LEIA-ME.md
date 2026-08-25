# Edge functions órfãs do backend anterior ao pivô — REMOVIDAS EM 25/08/2026

> **Status: removidas de produção em 25/08/2026.** As três respondem `404` desde então
> (conferido por requisição). Este diretório é o que torna a remoção reversível: para trazer
> qualquer uma de volta, `supabase functions deploy <slug>` a partir daqui.

`jobs-api`, `applications-api` e `profiles-api` estavam **ativas em produção** e não tinham código
neste repositório. Baixadas em 25/08/2026 (`supabase functions download`) e guardadas aqui para
que a remoção delas seja reversível.

## O que são

Sobra do backend pré-pivô. Auditadas linha a linha:

- **Rodam com `SUPABASE_SERVICE_ROLE_KEY`** — ignoram RLS por completo.
- **Exigem `Authorization`** e validam o token com `auth.getUser()`. Não estão abertas: uma
  requisição sem cabeçalho recebe `400 Missing Authorization header` (verificado).
- **Operam sobre as tabelas PascalCase do backend antigo** — `Job`, `JobApplication`, `User`,
  `ClientProfile`, `Skill`, `WorkExperience`, `FreelancerProfile`, `ClientReview`,
  `FreelancerReview`. Nenhuma toca `jobs`, `applications`, `workers` ou `companies`, que é onde o
  produto de hoje vive.
- ⚠️ **CORREÇÃO (25/08) a uma afirmação anterior deste arquivo.** Escrevi aqui que elas tocavam
  *somente* tabelas mortas. É falso: **`applications-api` escreve em `Conversation`** — que não é
  morta, é a tabela do **chat vivo** (o frontend a usa em 10 pontos). Ou seja: era um endpoint com
  `service_role`, sem consumidor, capaz de escrever na conversa entre empresa e freela. Isso deixa
  de ser argumento para remover "por higiene" e passa a ser argumento para remover **por
  segurança**. Conferido: `Job` e `JobApplication` estão com 0 linhas; `Conversation` tem 13 e
  `Message` tem 6, ambas em uso.
- **Nenhum arquivo do frontend as chama** (verificado por varredura em `frontend/src`).

## Por que ainda existem

Ninguém as removeu quando o produto pivotou. Estão deployadas com `verify_jwt: false`, o que na
prática significa "a função faz a própria checagem" — e faz.

## Recomendação

Remover de produção:

```
npx supabase functions delete jobs-api        --project-ref vrklakcbkcsonarmhqhp
npx supabase functions delete applications-api --project-ref vrklakcbkcsonarmhqhp
npx supabase functions delete profiles-api     --project-ref vrklakcbkcsonarmhqhp
```

Endpoint com service_role que ninguém chama é superfície sem contrapartida. O risco hoje é baixo
(só alcançam tabelas mortas, e exigem token válido), mas o custo de manter é maior que o de tirar
— e, com o código aqui, dá para redeployar se aparecer um consumidor esquecido.

**Não removi por conta própria**: apagar endpoint de produção é ação para fora, e a ausência de
consumidor no frontend não prova ausência de consumidor no mundo (app antigo, integração, script).
