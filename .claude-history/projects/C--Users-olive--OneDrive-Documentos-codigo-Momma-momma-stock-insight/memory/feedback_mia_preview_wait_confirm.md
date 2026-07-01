---
name: MIA — preview → aguarda "sim" → executa exatamente o prometido
description: Protocolo rígido de escrita: preview, parar, aguardar confirmação do usuário, e executar EXATAMENTE a operação proposta — não trocar de assunto, não sugerir outra coisa
type: feedback
originSessionId: 9f339aa2-0d65-4dd9-bea9-c7ace405d230
---
**Regra:** Qualquer escrita (criar, editar, desativar, classificar em lote, etc) segue o protocolo:

1. **Preview** — MIA mostra em tabela exatamente o que vai mudar e pede "sim" para confirmar.
2. **Espera** — MIA não faz NADA até receber confirmação explícita.
3. **Executa** — quando o usuário responde "sim"/"pode"/"confirma", MIA executa APENAS a operação que estava em preview — não faz outra coisa, não troca de contexto, não sugere próximo passo aleatório.

**Why:** Usuário (CTO) reportou em 2026-04-14: pediu renomeação de produto, MIA mostrou preview, usuário disse "sim", e em vez de renomear MIA exibiu o estoque do produto (ação totalmente diferente). Isso destrói confiança — quando o CTO diz "sim" ele confirmou a operação do preview, não abriu brecha pra MIA escolher outra.

**How to apply:**
- No ReAct loop, quando houver preview pendente, o próximo "sim" DEVE executar o mesmo tool do preview com `preview=false`, nada mais.
- Se houver ambiguidade na confirmação, PERGUNTE em vez de assumir.
- Se o usuário mudar de ideia e perguntar outra coisa após preview, confirme antes: "E a renomeação que tinha ficado pendente, mantém?".
- Nunca troque silenciosamente a ação — isso é violação grave do protocolo.
