# ADR-20260821 — A busca de empresas da F10 cavalga uma superfície já aberta, e fica acoplada ao débito #10

## Status

ACEITO (gate de arquitetura, 21/08/2026). Escalada aberta pelo `harness-frontend-reviewer` da F10
(achado MÉDIO) contra a Questão aberta #2 de `.harness/spec/troca-freelas/ddl-aprovado.md` §5.
Emenda correspondente no contrato: `.harness/spec/troca-freelas/ddl-aprovado.md` §6 (DS-BUSCA).

Este ADR **não reabre** nenhuma outra parte da F10.

## Contexto

O contrato do gate da F10 dizia, em §5 (Questões que este gate NÃO resolve), item 2:

> "uma busca de empresas por nome/CNPJ é uma superfície nova de enumeração de `companies` — se o
> builder precisar de RPC para isso, volta ao gate."

O builder implementou a busca sem RPC e sem voltar ao gate:
`frontend/src/components/company/CreateReferralModal.tsx:76-81` faz
`from('companies').select('id, name, logo_url').ilike('name', '%<termo>%').neq('id', B).limit(8)`.

Três fatos apurados neste gate:

1. **`companies` já é `SELECT USING (true)` para `authenticated`** (`20260317160000`), e a tabela
   carrega `cnpj`, `email` e `address`. Está registrado como **débito #10** em
   `.harness/memory-bank/debitos-pre-piloto.md`. Quem quisesse varrer `companies` já podia — com
   `select('*')`, sem `limit`, sem passar pela F10 e sem abrir o app.
2. **A projeção da F10 é subconjunto estrito do que já está aberto:** três colunas
   (`id`, `name`, `logo_url`), todas não-sensíveis, com teto de 8 linhas. A busca não devolve `cnpj`,
   `email` nem `address`. Ou seja: **exposição delta = zero**.
3. **Mas o padrão de acesso é novo no client.** Levantamento de todos os `from('companies')` do
   frontend: `Sidebar`, `CompanyLayout`, `CompanyDashboard`, `CompanyProfile`, `ProtectedRoute`,
   `useTeamConnections`, `CompanyReferrals`, `QuemTeIndicou`, `InviteToShiftModal`,
   `certificationService`, `jobSeriesService` — **todos** ancorados em `.eq('id', …)` ou
   `.in('id', …)`, isto é, sobre um id que o chamador já possui legitimamente. `CreateReferralModal`
   é o **primeiro e único** consumidor com predicado irrestrito. O comentário do builder no arquivo
   ("mesmo padrão já usado em Sidebar.tsx/CompanyMessages.tsx") é **factualmente incorreto**:
   aqueles dois leem a própria linha, por id.

A tensão, portanto, não é "a F10 abriu dado". É: a F10 é a primeira tela do produto que **depende**
de `companies` ser `USING (true)`. Trocar `ilike` por RPC **hoje**, com a policy como está, não
reduziria exposição nenhuma — a RPC leria a mesma tabela e devolveria as mesmas três colunas, com o
mesmo atacante podendo ignorá-la e chamar PostgREST direto. Seria teatro de segurança, e teatro caro:
uma sétima RPC para manter, escrita **antes** de saber o formato do fecho do #10 (que, segundo o
próprio débito, não é escopo por linha e sim *column-scoped*: `get_company_public_profile` + policy
restrita ao dono).

## Decisão

### D1 — A busca fica como leitura direta, e a decisão é **acoplada ao débito #10**

Não se exige RPC agora. A justificativa é única e é condicional: **enquanto `companies` for
`SELECT USING (true)`**, uma RPC de busca não subtrai capacidade de ninguém.

O acoplamento é a parte que não pode se perder: **no dia em que o débito #10 for fechado — isto é, no
dia em que a policy de `companies` deixar de ser `USING (true)` — esta busca para de funcionar e
precisa virar RPC na MESMA migration.** Sem isso, o campo "Empresa destino" do `CreateReferralModal`
passa a devolver 0 linhas silenciosamente (RLS que não casa devolve conjunto vazio, não erro) e a F10
inteira fica inoperante **sem nenhuma mensagem de erro** — a empresa indicadora simplesmente nunca
encontra a empresa destino e conclui que "o Worki não tem essa empresa". Esse é o modo de falha a
reconhecer.

Consequência operacional registrada em três lugares (para não depender de memória de sessão): este
ADR, a §6 do contrato da F10, e o próprio débito #10.

### D2 — Contrato da RPC futura, especificado agora

Especificado aqui para que o fecho do #10 não tenha de reabrir este gate. Quando for escrita:

```
public.search_companies_for_referral(p_term text) RETURNS jsonb  -- array
  SECURITY DEFINER, STABLE, SET search_path = ''
```

- **Entra:** só o termo. **Não aceita** "por qual empresa perguntar", nem `p_limit`, nem `p_offset`,
  nem `p_order`. Autorização sempre sobre `auth.uid()` — precedentes `is_shift_call_target`
  (F1, não aceita "por qual usuário perguntar") e `list_worker_referral_cards` (F10, sem parâmetro).
- **Sai:** `id`, `name`, `logo_url`. Montado campo a campo — **nunca** `to_jsonb(c.*)`, pela mesma
  razão de `get_worker_referral_card`: qualquer coluna futura de `companies` vazaria sozinha.
- **Não vira oráculo de enumeração:** mínimo de 3 caracteres **dentro da função** (conjunto vazio
  abaixo disso, nunca exceção — distinguir "termo curto" de "nada encontrado" já é sinal), teto de 8
  linhas **dentro da função**, e o termo sanitizado no servidor (D3). **Sem paginação e sem cursor:**
  quem não achou refina o termo. Teto fixo sem cursor é justamente o que impede a varredura por
  janelas sucessivas.
- **Sem `RAISE EXCEPTION` em nenhum ramo de autorização** — conjunto vazio (padrão DS10 da F8).
- **Não escreve nada**, nem contador de busca: `STABLE`.
- Autorização mínima: chamador autenticado que opere ao menos uma empresa
  (`EXISTS (companies WHERE owner_id = auth.uid() OR id = auth.uid())`). Uma conta de freela não tem
  o que buscar aqui.
- `GRANT EXECUTE ... TO authenticated, service_role` (sem isso, `.rpc()` falha via PostgREST).

### D3 — Endurecimento que vale **agora**, mesmo mantendo a leitura direta

Independe do #10 e é barato. Três itens (§6 do contrato, obrigatórios):

1. **Sanitizar o termo.** Hoje o termo do usuário entra cru num padrão LIKE: `%`, `_`, `*` e `\`
   digitados são **metacaracteres** (o PostgREST aceita `*` como alias de `%`). Um usuário que digita
   `%%` satisfaz o mínimo de 2 caracteres e casa com a tabela inteira — o guard de comprimento é
   decorativo. Remover `% _ * \` do termo antes de montar o padrão (nenhum deles é significativo num
   nome de empresa). Preferir remoção a escape: escape depende da semântica de `ESCAPE` do LIKE e da
   tradução `*`→`%` do PostgREST, remoção não depende de nenhuma das duas.
2. **Mínimo de 3 caracteres** (hoje 2). Dois caracteres num `%…%` já é varredura barata.
3. **Debounce** (~300 ms). `onChange` dispara uma query por tecla, e `ilike` com curinga à esquerda
   sobre coluna não indexada é *seq scan* em `companies` — cada digitação é um scan completo. É
   custo de banco, não de segurança, mas é o mesmo botão.

Mantidos como estão e agora **normativos**: `limit(8)`, `neq('id', referringCompanyId)`, e a projeção
fechada `id, name, logo_url` (proibido `select('*')` aqui).

### D4 — O comentário do arquivo é corrigido

O bloco de comentário de `CreateReferralModal.tsx` afirma que a busca "não é uma superfície de
enumeração que o gate ainda não tenha aprovado". Era falso quando foi escrito (o gate havia
explicitamente pedido a escalada) e a afirmação de precedente é errada. Substituir por um apontamento
a este ADR e ao acoplamento do #10 — o comentário é o único lugar onde a próxima pessoa vai olhar
antes de mexer na busca.

## Consequências

### Positivas

- Nenhuma RPC escrita duas vezes: o formato certo depende do fecho do #10, que é *column-scoped*.
- Exposição não aumenta (projeção é subconjunto estrito do que já é público a `authenticated`).
- O endurecimento de D3 fecha um furo **real e presente** (injeção de curinga) que a discussão
  "RPC ou não" estava encobrindo — a RPC, sem D3, teria exatamente o mesmo furo.
- O contrato da RPC futura fica escrito, então o fecho do #10 não reabre este gate.

### Negativas / Trade-offs

- **Dívida acoplada, e acoplamento é frágil por natureza.** Se o #10 for fechado por alguém que não
  ler este ADR, a F10 quebra em silêncio. Mitigação: registro nos três lugares + modo de falha
  descrito explicitamente ("campo de busca sem resultados para sempre").
- A busca continua sendo um caminho *ergonômico* de enumeração dentro do produto, ainda que não
  privilegiado. Aceito porque `curl` contra PostgREST é estritamente mais eficiente hoje.
- `ilike '%…%'` sem índice não escala. Irrelevante no piloto (dezenas de empresas); vira `pg_trgm`
  ou `unaccent` + índice quando a RPC nascer.

## Alternativas rejeitadas

- **Exigir a RPC agora.** Com a policy `USING (true)`, a RPC não subtrai capacidade de ninguém — quem
  quer varrer ignora a RPC e chama PostgREST. Custo real (código, teste, revisão, reescrita no fecho
  do #10) contra benefício zero em exposição. **Ressalva honesta:** se o #10 fosse fechado nesta mesma
  leva, a ordem correta seria a inversa (RPC junto com o fecho). Não é o caso — o #10 tem spec
  própria, ainda não escrita.
- **Fechar o débito #10 aqui, dentro da F10.** O fecho correto é column-scoped e mexe em
  `/empresa/:id` (perfil público), `CompanyProfile` e `CompanyPublicProfile`. É spec própria, com
  gate próprio; enfiá-la numa feature de indicação é como a F3 perdeu uma peça de segurança.
- **Exigir correspondência por prefixo (`termo%`) em vez de `%termo%`.** Rejeitada por usabilidade:
  o interlocutor busca "fogão" para achar "Divino Fogão Shopping Norte". D3 (sanitização + 3 chars +
  teto) reduz varredura sem cobrar esse preço.
- **Buscar por CNPJ em vez de nome.** Rejeitada agora: exigiria o CNPJ em mãos (não é como o gerente
  conhece a unidade vizinha) e faria a busca tocar uma coluna sensível — hoje ela não toca nenhuma.

## Referências

- Contrato: `.harness/spec/troca-freelas/ddl-aprovado.md` §5 (Questão aberta 2) e §6 (DS-BUSCA, emenda).
- ADR base da feature: `.harness/memory-bank/decisions/ADR-20260821-indicacao-entre-empresas.md`.
- Débito acoplado: `.harness/memory-bank/debitos-pre-piloto.md` #10 (e #9, mesma classe em `workers`).
- Código: `frontend/src/components/company/CreateReferralModal.tsx:67-95`.
- Policy em questão: `companies` SELECT `USING (true)` (`supabase/migrations/20260317160000_*.sql`).
