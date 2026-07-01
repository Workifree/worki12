---
name: Agentes não devem pedir confirmação de fetch
description: Nunca pedir confirmação para WebFetch/WebSearch nos agentes — executar direto sem perguntar
type: feedback
---

Agentes da roundtable e subagents NÃO devem pedir confirmação para buscar URLs ou fazer web searches. Executar direto.

**Why:** O usuário quer fluxo contínuo sem interrupções. Pedir "posso acessar este site?" quebra o ritmo.
**How to apply:** Ao spawnar agentes, incluir na instrução que devem executar todas as buscas sem pedir confirmação ao usuário.
