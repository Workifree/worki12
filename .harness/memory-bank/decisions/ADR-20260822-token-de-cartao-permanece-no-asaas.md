# ADR-20260822 — O token de cartão permanece no Asaas após a exclusão da conta, e o contrato passa a dizer isso

## Status

ACEITO (22/08/2026). Emenda a `.harness/spec/lgpd-producao/ddl-aprovado.md` (§2.1 `payment_methods`,
§4.1 passos 2 e 4b, §4.3, §5.3, §5.4 J5) e ao comentário correspondente em
`supabase/migrations/20260821000000_lgpd_account_anonymization.sql`.
Complementa ADR-20260821-anonimizacao-em-vez-de-exclusao.

## Contexto

O §4.1 do contrato de LGPD mandava, no passo 4b: *"Asaas: revogar os cartões tokenizados lidos em
(2)"*. Ao implementar a Edge Function `delete-account`, descobriu-se que **essa ação não tem como
existir hoje**:

- `DELETE /creditCard/{token}` **não tem precedente no repositório** — o único `DELETE` que o Worki
  faz contra o Asaas é o de `asaas-release-hold`, sobre `payments`, outro recurso.
- A documentação pública do Asaas **não descreve revogação de token avulso**. Ela documenta
  `POST /v3/creditCard/tokenize` para criar, e o token é vinculado ao **cliente**; o caminho
  aparente para eliminar o dado do cartão é **remover o cliente**, ação de escopo bem maior (afeta
  cobranças e histórico).

A primeira implementação chamou o endpoint como **melhor esforço** e, ao falhar, logava
"revogação não confirmada" — junto com **o próprio token**. A chamada foi removida e substituída por
um aviso único com a contagem de tokens remanescentes.

Resultado real: a RPC apaga `payment_methods`, o Worki perde a referência, **e o token continua
existindo no processador**. O contrato dizia o contrário, e quem lesse só a spec concluiria que o
cartão havia sido revogado.

## Decisão

### D1 — A remoção da chamada é mantida. "Melhor esforço" contra endpoint inexistente é pior que nada

Não é economia de código: uma chamada que **sempre** falha produz, em toda exclusão, um log de
"revogação não confirmada" que **fabrica evidência de esforço**. Quem audita — e numa rotina de LGPD
alguém vai auditar — lê uma tentativa legítima frustrada por instabilidade, quando houve chamada a
um endereço que não existe. Guarda que falha aberto não é guarda; log que descreve esforço que não
houve é pior, porque **desinforma ativamente**. Somado a isso, o token é credencial de pagamento e
estava sendo escrito em log dentro da rotina de LGPD.

Fica proibido, no contrato: (i) chamar o endpoint por melhor esforço, (ii) escrever o token em log
em qualquer nível.

### D2 — A rotina passa a ler a CONTAGEM de `payment_methods`, não os tokens

Sem revogação possível, carregar o token para a memória da Edge Function é manusear credencial de
pagamento **sem finalidade** — e foi por aí que ele quase acabou em log. A contagem é tudo o que o
aviso precisa. Minimização não é postura: é o que teria evitado o incidente antes de ele existir.

### D3 — A retenção é DECLARADA, com gate de publicação (não de aplicação)

Entra em §5.3 como risco residual aceito, com um gate explícito: **antes de a rotina ser liberada ao
usuário final**, confirmar contra a referência completa da API do Asaas ou o suporte deles se existe
revogação de `creditCardToken`. Se existir, isto vira bug com correção conhecida e volta a §4.1-4b
como ação de verdade. Se não existir, a retenção **tem** de constar da Política de Privacidade —
hoje ela promete o oposto pelo silêncio.

O que torna a retenção tolerável no intervalo: o token é **opaco** (nunca PAN/CVV — Article 10 e o
`COMMENT` da própria coluna) e sozinho não é utilizável fora da conta Asaas do Worki.

### D4 — A escolha real é de owner + jurídico (J5), não de engenharia

Se não houver revogação, sobram duas saídas e nenhuma é técnica: **remover o cliente no Asaas** na
exclusão (mexe no contrato financeiro — cobranças e histórico) **ou** declarar a retenção na
Política de Privacidade (mexe no que o produto promete ao titular). Registrado como J5.

### D5 — A janela de remediação NÃO fecha, e o motivo tem de estar escrito

- A **lista de tokens** só existe **antes** do passo 3: depois da RPC, ninguém sabe quais tokens
  eram daquela conta. Ação **por token** só caberia entre (2) e (3) — e é a que não existe.
- O **`asaas_customer_id` sobrevive**: vive em `wallets` (`20250222153500`), tabela **INTOCADA** por
  força do Article 8/9. Logo a remediação de J5 continua possível **depois** da exclusão, na
  granularidade de **cliente** — que é a granularidade que o Asaas documenta.

A mesma linha preservada para proteger o razão é a que mantém aberta a porta de remediação. Isso é
fato de schema e não sorte a ser confiada em silêncio: uma "limpeza" futura de `wallets` órfãs
fecharia a porta sem que ninguém percebesse. Por isso vai para §4.3 agora, e não quando J5 vier.

## Consequências

### Positivas

- Spec e código voltam a dizer a mesma coisa. Quem lê o contrato deixa de concluir que o cartão foi
  revogado.
- Some um log que escrevia credencial de pagamento, e some um log que descrevia esforço inexistente.
- A pergunta certa passa a estar registrada no lugar certo: técnica para o Asaas, depois de
  owner/jurídico — em vez de continuar como linha de spec que ninguém consegue implementar.
- O caminho de remediação futuro fica documentado com a granularidade que ele realmente tem.

### Negativas / Trade-offs

- **O dado sai do nosso banco e permanece no processador.** É retenção em terceiro, sem prazo, que
  o titular não pediu — e o produto não pode chamar isso de "todos os seus dados foram apagados".
- Depende de uma confirmação externa (Asaas) que ainda não temos; até lá, a redação de §5.3 é
  baseada em documentação pública e ausência de precedente, não em resposta do fornecedor.
- Se J5 concluir "não pode reter", a exclusão passa a depender de uma chamada externa que **pode
  falhar**, e será preciso decidir se a falha **bloqueia** a exclusão (o titular fica preso ao
  gateway) ou apenas registra incidente. Nada disso existe hoje.

## Alternativas rejeitadas

- **Manter a chamada de melhor esforço** (com o log corrigido): continuaria produzindo ruído
  indistinguível de tentativa legítima em 100% das exclusões. Se um dia o endpoint existir, a
  chamada volta como ação **verificada**, não como aposta.
- **Guardar os tokens numa fila de revogação** antes do `DELETE`: seria reter credencial de
  pagamento de quem pediu para ser eliminado, precisando de base legal própria — e é desnecessário,
  porque o `asaas_customer_id` sobrevive em `wallets` (D5) e a remediação documentada é por cliente.
- **Remover o cliente no Asaas por decisão nossa**: afeta cobranças e histórico. É J5, do owner.
- **Registrar só no `debitos-pre-piloto.md`**: é o lugar certo da dívida e não substitui o contrato.
  Enquanto §4.1 dissesse "revogar", a spec estaria mentindo — e é a spec que o próximo builder lê.

## Referências

- Contrato: `.harness/spec/lgpd-producao/ddl-aprovado.md` §2.1, §4.1 (2 e 4b), §4.3, §5.3, §5.4 J5
- Migration: `supabase/migrations/20260821000000_lgpd_account_anonymization.sql`
- Schema: `20260622000600_payment_methods.sql` (token opaco), `20250222153500` (`asaas_customer_id`)
- Dívida: `.harness/memory-bank/debitos-pre-piloto.md`
- ADR-20260821-anonimizacao-em-vez-de-exclusao · ADR-20260822-fronteira-lgpd-multi-unidade
