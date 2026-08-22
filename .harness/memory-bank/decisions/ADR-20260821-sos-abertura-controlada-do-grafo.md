# ADR-20260821 — SOS: abertura controlada do grafo fechado

## Status

**ACEITO COM CONDIÇÕES** — as condições estão em §"Condições de aceite" e são vinculantes: o DDL
aprovado (`.harness/spec/sos-descoberta/ddl-aprovado.md`) é o contrato do builder, e três das
condições **alteram policies do F1 já em produção**. Sem essas alterações, a promessa central da
feature (a empresa nunca vê quem foi chamado) **não se sustenta** — ver Achado 1.

Substitui/estende: nada. Referenciado por: `.harness/spec/sos-descoberta/spec.md` (seção "DECISÃO
IRREVERSÍVEL"), que exigiu explicitamente este ADR antes de qualquer código.

---

## Contexto

### A fala que originou a feature

Entrevista 17/08/2026, sócio de 10 unidades Divino Fogão:

> "8:30 o freela cancela, [o turno] abre às 10. As outras empresas não dizem nada a tempo via o
> app; o próprio app dispara uma chamada para freelas próximos das empresas próximas, de qualidade
> suficiente."

### A fala que a contradiz — do mesmo entrevistado

> "tudo vem com base em confiança, gente próxima ou que já trabalhou; dificilmente alguém do zero,
> de fora absoluto, como é a premissa de todos os marketplaces por aí fadados ao fracasso."

E o `product.md` (anti-vision) diz, hoje, que o Worki **não é** um marketplace aberto: o fluxo é
push (empresa convida quem já está no Elenco), não pull (freela navega vagas / empresa navega
freelas).

### Por que isso é uma decisão de modelo, não de implementação

O F1 (Chamado de Turno) resolveu o disparo 1→N **dentro** do Elenco. O teto é estrutural: se
ninguém do Elenco aceita, o turno fica aberto — que é literalmente o cenário das 8h30. Qualquer
solução para esse teto alcança gente fora do Elenco, e "alcançar gente fora do Elenco" é a
definição operacional de "abrir o grafo".

A tensão é real e não se dissolve com salvaguardas cosméticas. Ou se decide o que exatamente se
abre, com que reversibilidade, ou a feature vira o cavalo de Troia do marketplace aberto que o
produto vendeu que não é.

### O estado real do banco (verificado neste gate, não presumido)

- `shift_calls` / `shift_call_targets` existem, com RLS, sem policy de UPDATE/DELETE (toda
  transição é RPC) — `20260817000100`, `20260817000200`.
- A policy `shift_call_targets_select` entrega ao dono do turno **todos** os alvos do chamado.
- A policy `shift_call_targets_insert` exige `team_connections.status = 'accepted'` — é a trava
  de lista fechada do Slice 1.
- `notifications_insert_self_or_connected` (`20260702000000`) só deixa a empresa notificar quem
  tem vínculo `accepted`.
- `can_view_worker_profile` (`20260816120000`) só libera a linha do freela (CPF, telefone,
  `pix_key`, `birth_date`) para empresa com `team_connections` pending/accepted **ou** com uma
  `applications` do freela num turno dela.
- `workers.city` existe (texto livre, escrito pelo próprio freela em `Profile.tsx`, sem
  normalização); `companies.city` existe (`20260317140000`), `TEXT` nullable.
- `workers.completed_jobs_count` é `INTEGER NOT NULL DEFAULT 0`, recomputado por
  `recompute_worker_aggregates`; `workers.rating_average` é `NUMERIC` nullable, mantido por
  trigger **só em INSERT de review**.

---

## Decisão

### D1 — A membrana: abre-se o ALCANCE, não a VISIBILIDADE

Esta é a formulação central do ADR, e é o que resolve a tensão sem contorná-la:

> **O que se abre:** o direito da empresa de **emitir** um convite para alguém que não está no
> Elenco dela.
>
> **O que permanece fechado:** o direito de **ver** quem está fora do Elenco. A empresa não ganha
> lista, busca, filtro, ranking, diretório, prévia nem contagem por nome. Ela ganha um **alcance
> cego, mediado pelo banco**.

O que caracteriza um marketplace aberto não é o convite chegar a um desconhecido — é a **navegação
do catálogo de pessoas**. Um freela abre o feed e escolhe a vaga; uma empresa abre o diretório e
escolhe o freela. O Worki não tem nem nunca teve o segundo, e o SOS **não o introduz**: a empresa
aperta um botão que diz "preciso de alguém agora" e o banco decide, sozinho, para quem aquilo vai.
A empresa descobre a existência de uma pessoa específica **no instante do aceite** — momento em
que essa pessoa passa a ser alguém que ela contratou, e portanto uma relação já consentida.

Consequência prática que precisa ficar escrita: **em nenhuma fatia futura a lista de alvos de um
SOS é exposta à empresa sem um novo ADR.** Isso já está em Out-of-scope da spec; aqui vira regra
com força de ADR.

### D2 — A fronteira do "próximo" é `city × city`, e isso é uma substituição declarada

O pedido literal foi "freelas próximos **das empresas próximas**". A implementação **não** faz
isso, e a divergência é deliberada:

| Pedido literal | Implementado | Por quê |
|---|---|---|
| "das empresas próximas" | `completed_jobs_count >= 3` (freela com histórico na plataforma) | Filtrar por "está no Elenco de uma empresa vizinha" obrigaria a Empresa A a operar sobre o Elenco da Empresa B. Mesmo calculado dentro de uma função e nunca devolvido, é o vetor mais direto de vazamento de relação comercial se algum dia a lista escapar. E o sinal é **quase redundante**: 3 turnos concluídos já implicam ter sido aceito e pago por alguém. |
| "próximos" (distância) | `workers.city` = `companies.city` | O Worki não tem lat/long de freela. Adicionar geolocalização é decisão própria, com LGPD muito mais pesada, e não cabe de carona nesta. |

**Registrado como limitação honesta:** em São Paulo capital, "mesma cidade" é um raio ruim. A
mitigação nesta fatia é o corte de qualidade e a cota — não é geolocalização. Se o piloto mostrar
que o raio é o problema, a resposta é um ADR de geolocalização, não afrouxar o corte.

### D3 — Consentimento é opt-in explícito e revogável no ato

`workers.discoverable_for_sos boolean NOT NULL DEFAULT false`. Ninguém entra no alcance ampliado
sem ter marcado, e desmarcar tem efeito imediato (o pool é calculado no momento do disparo, sem
cache — A14).

O texto do toggle é requisito, não cópia: precisa dizer o que acontece, incluindo a parte
desconfortável — **ao aceitar um SOS, a empresa passa a ler a linha completa do freela**
(`can_view_worker_profile`, ramo de vínculo operacional), o que inclui telefone e chave PIX,
porque é o que permite pagá-lo. O consentimento tem que cobrir isso.

### D4 — Reuso de `shift_calls`/`shift_call_targets` com `origin`, não tabela nova

Confirmado. A métrica `first_claim_at - created_at` é a prova de ROI da leva F1–F11 inteira;
fragmentá-la em duas tabelas mataria o número. `claim_shift_slot` é reaproveitada **sem alteração
de lógica** — ela opera sobre `shift_call_targets` e é agnóstica a como o alvo foi escolhido.

### D5 — `origin` é denormalizado em `shift_call_targets`, sincronizado por trigger

Divergência do `spec.md` (R6 dizia "sem tocar em `shift_call_targets`). Motivo: a policy de SELECT
e a cota por freela precisam do `origin` **na linha do alvo**. As alternativas eram (a) mais uma
função `SECURITY DEFINER` para quebrar a recursão de policy, ou (b) a coluna. Escolhemos a coluna
porque:

1. **Zero novos objetos privilegiados.** O item 4 do gate pedia garantia de que nada novo aceite
   "por qual usuário perguntar" — a melhor garantia é não criar nada novo. Esta decisão mantém
   `is_shift_call_target` e `shift_call_job_id` como os únicos DEFINER de predicado do F1, ambos
   intactos e ambos ancorados em `auth.uid()`.
2. **A cota por freela vira indexável.** `origin` vivendo em `shift_calls` obrigaria um join para
   contar "quantos SOS este freela recebeu em 7 dias" — no caminho mais quente do produto.
3. **Sem drift possível:** um `BEFORE INSERT` copia `origin` do chamado e ignora o que o cliente
   mandou. Não é campo livre.

### D6 — O pool nasce e morre dentro de `create_sos_call` (SECURITY DEFINER)

A RPC recebe `job_id`, `reason`, `message`. Ela — e só ela — calcula quem é elegível, insere os
alvos, **insere as notificações**, e devolve `{outcome, targets_count}`. Nenhuma lista sai.

A notificação dentro da RPC não é elegância: é **necessidade**. A policy
`notifications_insert_self_or_connected` exige vínculo `accepted`, então o cliente **não consegue**
notificar um alvo de SOS — e, se conseguisse, precisaria da lista de ids, que é exatamente o que
não pode ter. O `spec.md` não previu isso.

Corolário aceito: **nesta fatia o SOS tem notificação in-app apenas.** O disparo de e-mail/push do
F1 é feito pelo cliente com a lista de ids (`send-notification`); sem lista, não há como. Levar
e-mail ao SOS exige uma Edge Function lendo os alvos com `service_role` — trabalho legítimo
(Article 10 satisfeito), fora desta fatia.

### D7 — Toda a elegibilidade e toda a cota são reverificadas dentro da RPC

O `spec.md` trata R8 (gatilho de urgência) como condição de exibição do botão. Botão é UX; a
condição é regra. `create_sos_call` reverifica as três condições e devolve `outcome` estruturado.
Um cliente adulterado que chame a RPC direto não abre SOS fora da janela.

### D8 — Aceite de SOS não cria vínculo de Elenco

Confirmado por leitura de `claim_shift_slot`: ela não toca `team_connections` em nenhum ramo. A12
e A11 são satisfeitos **por construção**, sem código novo. O Elenco continua sendo handshake
bilateral explícito.

### D9 — Kill switch de um comando

A reversão da abertura do grafo **não passa por migration**:

```sql
REVOKE EXECUTE ON FUNCTION public.create_sos_call(uuid, text, text) FROM authenticated;
```

A partir daí nenhum SOS novo nasce; os dados históricos (`origin='sos'`) permanecem, as
`applications` já criadas seguem válidas, nada é desfeito. O botão no cliente passa a receber erro
de permissão e deve ser escondido — mas mesmo se não for, não há efeito.

### D10 — Gatilhos de reversão (o que faz a gente puxar o kill switch)

Isto é a parte do ADR que o gate pediu explicitamente. Cada gatilho é observável com o que o
`origin` já grava; nenhum exige instrumentação nova.

| # | Sinal | Limiar | Leitura |
|---|---|---|---|
| **G1** | `% dos turnos preenchidos via SOS` (aceites com `origin='sos'` ÷ total de aceites) | **> 25%** em 2 semanas corridas | O alcance ampliado virou o canal padrão. O Elenco parou de ser o produto. |
| **G2** | Mediana de SOS por empresa ativa por semana | **>= 2** (cota de 3 saturada pela maioria) | A cota está sendo tratada como orçamento a gastar, não como exceção. |
| **G3** | `discoverable_for_sos` revertido de `true` para `false` | **> 20%** dos opt-in em 30 dias | O alcance está sendo sentido como spam pelo lado que aceitou ser alcançado. |
| **G4** | Rating médio das contratações via SOS vs. via Elenco | **> 0,7 ponto abaixo** | O corte de qualidade não segura; "confiança de segundo grau" não se traduziu em desempenho. |
| **G5** | Qualquer relato verificado de empresa inferindo relação comercial de terceiro a partir do SOS | **1 ocorrência** | Falha da promessa central. Desligar no mesmo dia, sem discussão de limiar. |

G1–G4 abrem revisão; **G5 é desligamento imediato.**

---

## Condições de aceite (vinculantes — o builder implementa isto)

Estas são as correções que o gate encontrou. As três primeiras alteram objetos do F1 **já em
produção**; sem elas a feature entrega o oposto do que promete.

**C1 (blocker) — Reescrever `shift_call_targets_select`.** A policy vigente entrega ao dono do
turno *todos* os alvos. Com `origin='sos'` isso é o vazamento inteiro em uma linha de SQL: a
empresa faz `GET /rest/v1/shift_call_targets?call_id=eq.<seu_sos>` e recebe a lista de quem foi
chamado — o pool de descoberta completo, com ids de freelas com quem ela não tem nenhum vínculo.
A6 e A7 **falham** com a spec como escrita. Nova regra: para `origin='sos'`, o dono só enxerga o
alvo cuja `response = 'accepted'`.

**C2 (blocker) — `shift_calls_insert_company` passa a exigir `origin = 'team'`.** Hoje a empresa
insere `shift_calls` direto do cliente; com a coluna nova sem trava, ela escolhe o `origin`.
`'sos'` só nasce dentro da RPC.

**C3 (blocker) — `shift_call_targets_insert` passa a exigir `origin = 'team'`.** Sem isso a empresa
anexa alvos escolhidos por ela a um chamado SOS legítimo, contornando pool, corte de qualidade e
cota — e, de quebra, esses alvos ficariam invisíveis para ela por C1, produzindo um estado
incoerente.

**C4 (major) — Cota por empresa conta sobre o conjunto de identidades da empresa, não sobre
`shift_calls.company_id`.** O projeto tem ancoragem dupla documentada (`jobs.company_id` é ora o
uuid da empresa, ora o uid do dono — `20260816210000`). Contar por igualdade simples permite
duas contas de cota para o mesmo humano. A contagem tem que ser
`company_id = auth.uid() OR company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())`,
exatamente como `is_job_owner`.

**C5 (major) — Varrer SOS expirados antes de aplicar a cota "1 simultâneo".** O F1 usa expiração
**preguiçosa** (só `claim_shift_slot` fecha o que venceu). Um SOS que ninguém abriu fica `open`
para sempre — e trancaria a empresa fora do SOS **permanentemente**. A RPC fecha os vencidos dela
antes de contar.

**C6 (major) — Normalizar cidade de verdade, e recusar cidade ausente.** `workers.city` é texto
livre digitado pelo freela; `companies.city` é `TEXT` nullable. `lower()` não é suficiente:
"São Paulo", "Sao Paulo", "sao paulo " e "SÃO PAULO/SP" são quatro cidades diferentes hoje. A
comparação usa trim + lower + remoção de acentos por `translate()` (expressão pura, sem depender
da extensão `unaccent` estar habilitada). E se a empresa não tem `city` preenchida, a RPC devolve
`outcome='company_city_missing'` — **nunca** cai em "compara NULL com NULL" e alcança a base toda.

**C7 (major) — Texto de fechamento do F1 é falso para alvo de SOS.** `claim_shift_slot` avisa quem
perdeu a corrida com "Você continua no elenco e recebe os próximos chamados normalmente", e
`decline_shift_call` avisa a empresa com "Chame mais gente do elenco". Para um alvo de SOS as duas
frases são mentira e reforçam um modelo mental errado ("eu estou no elenco dessa empresa"), o que
corrói justamente o consentimento informado que D3 comprou. As duas funções ganham ramo por
`origin`.

**C8 (minor) — `rating_average` é um sinal mais fraco do que a spec supõe.** O trigger
`update_worker_rating_on_review` (a) dispara só em INSERT — editar ou apagar uma review não
recalcula; (b) engole exceções (`EXCEPTION WHEN OTHERS THEN RETURN NEW`), então uma falha deixa o
valor velho silenciosamente; (c) conta reviews com `direction IS NULL` (legado) como se fossem de
worker. Para um **portão binário e generoso** como o do SOS (`>= 4.0` OU sem reviews) isso é
aceitável — mas o corte tem que ser escrito tolerante a `NULL` (`COALESCE`), tratando "sem nota"
como "não penalizado", nunca como "reprovado". `completed_jobs_count` é confiável
(`NOT NULL DEFAULT 0`, recomputado no gatilho de conclusão) e é o corte que realmente segura.

**C9 (minor) — `outcome='pool_empty'` quando ninguém é elegível.** Sem isso nasce um chamado com
zero alvos, que a empresa vê como "abri o SOS e ninguém veio" (falso: ninguém foi chamado) e que
ainda assim consome cota.

---

## Consequências

### Positivas

- O teto estrutural do F1 deixa de existir: o turno das 8h30 tem um caminho de preenchimento
  depois que o Elenco falha, sem esperar a empresa lembrar de ligar para alguém.
- A promessa "não somos marketplace" fica **verificável em SQL**, não em intenção: não existe
  endpoint, policy ou RPC que devolva uma lista de pessoas fora do Elenco a uma empresa.
- O F1 sai deste gate mais seguro do que entrou: C2 e C3 fecham a possibilidade de a empresa
  forjar `origin` e de anexar alvos arbitrários a um chamado, e C5 remove um trancamento
  permanente latente na expiração preguiçosa.
- O BI de tempo de preenchimento passa a distinguir "preenchi com meu Elenco" de "precisei do
  SOS" — que é, por si só, o indicador de saúde do Elenco de cada empresa.
- Reversão custa um `REVOKE`. Não há migration de volta, não há dado a desfazer.

### Negativas / Trade-offs

- **A empresa opera às cegas.** Ela não sabe quantos, quem, nem se vale a pena esperar. É o preço
  direto da promessa, e vai gerar pedido de "deixa eu ver quem foi chamado" — que este ADR
  antecipa e nega.
- **`city` é um raio ruim.** Em capital, o SOS vai alcançar gente longe demais para chegar em
  duas horas. A feature vai parecer pior do que é até existir geolocalização.
- **Cotas são chutes.** 3 por empresa/7 dias e 2 por freela/7 dias não têm base empírica. O
  primeiro mês do piloto vai dizer se estão apertadas ou frouxas; ajustar é trocar constantes na
  RPC, não redesenhar.
- **Sem e-mail/push no SOS nesta fatia** (D6). Justo no caso mais urgente, o alcance depende do
  freela abrir o app — o oposto do que o F4 aprendeu ("alcançar quem não abriu o app é o
  diferencial"). É a lacuna mais incômoda desta fatia e deve ser a primeira extensão.
- **O aceite expõe dado sensível para quem não tinha vínculo nenhum.** Ao aceitar,
  `can_view_worker_profile` libera a linha inteira (CPF, telefone, PIX) para uma empresa
  desconhecida. É inerente a ser contratado e pago, mas é a primeira vez no produto que isso
  acontece **sem nenhum vínculo prévio** — o que justifica a revisão jurídica/LGPD do texto de
  consentimento levantada na spec.
- **Duas policies do F1 mudam de semântica.** Qualquer código que dependa de "a empresa vê todos
  os alvos" precisa passar a tolerar ver menos. Hoje só a UI do F1 lê essa tabela, e ela só lê
  chamados `origin='team'`.

---

## Alternativas rejeitadas

**Marketplace aberto (feed/diretório de freelas).** É a resposta óbvia e é exatamente o que o
entrevistado chamou de "fadado ao fracasso". Rejeitada sem contraproposta.

**Rede de indicação entre empresas ("a Empresa B empresta o Elenco dela").** É a leitura mais
literal de "freelas próximos das empresas próximas". Rejeitada porque a Empresa A inevitavelmente
aprende que o freela X pertence ao Elenco da Empresa B — vazamento de relação comercial de
terceiro, que é o dano que o resto do desenho existe para impedir. Nota: calcular esse predicado
**dentro** da `SECURITY DEFINER`, sem devolvê-lo, seria tecnicamente seguro; foi rejeitado assim
mesmo por não discriminar quase nada além de `completed_jobs_count >= 3` (três turnos concluídos
já implicam ter sido aceito por alguém) ao custo de um join e de um precedente perigoso.

**Disparo automático por cron quando o chamado ao Elenco expira.** Rejeitado nesta fatia. Abrir o
grafo é a decisão mais sensível do produto; automatizá-la significa que ela acontece sem ninguém
decidir, o que também torna G1 inevitável — o SOS viraria o canal padrão por inércia, não por
escolha. Botão explícito primeiro; automação só depois de o piloto mostrar que a decisão humana é
gargalo, com ADR próprio.

**Tabela `sos_calls` separada.** Rejeitada: fragmenta `first_claim_at`, duplica `claim_shift_slot`
e cria um segundo produtor de convite com regras de reversibilidade diferentes — o erro que o F1
documentou ter evitado.

**Função `SECURITY DEFINER` nova para expor `origin` às policies.** Rejeitada em favor da coluna
denormalizada (D5): menos objeto privilegiado para auditar, e a cota por freela fica indexável.

**Cota no cliente.** Rejeitada por definição: é o `spec.md` R10/R11 e está certo. Registrado aqui
só porque a tentação de "checar antes para esconder o botão" é real — checar no cliente para UX é
bem-vindo, **desde que a RPC recuse de novo**.

**Corte de qualidade ajustável pela empresa.** Rejeitado: é o vetor mais barato de erosão. A
empresa afrouxa o filtro na primeira urgência não atendida e o "de qualidade suficiente" da
entrevista morre em duas semanas.

---

## Referências

- Spec: `.harness/spec/sos-descoberta/spec.md`
- DDL aprovado (contrato do builder): `.harness/spec/sos-descoberta/ddl-aprovado.md`
- Entrevista: `research-divino-fogao-2026-08` (memória do projeto), 17/08/2026
- F1: `supabase/migrations/20260817000100_shift_calls.sql`, `20260817000200_shift_call_rpcs.sql`
- Visibilidade de worker: `supabase/migrations/20260816120000_workers_select_by_relationship.sql`
  + `ADR-20260816-workers-select-por-vinculo.md`
- Policy de notificação: `supabase/migrations/20260702000000_notifications_notify_counterpart.sql`
- Ancoragem dupla de empresa: `ADR-20260817-seam-autorizacao-empresa.md`
- Constitution: Articles 1 (isolamento de papel), 4 (RLS é a primeira linha), 12 (auth+TOS)
- `product.md` — anti-vision ("NÃO é rede social", push-only, sem catálogo de pessoas)
