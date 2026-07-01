---
name: Estilo de colaboração
description: Como o usuário prefere que o assistente conduza tarefas (autorização explícita = executar)
type: feedback
originSessionId: bf1aed18-a242-4f69-82bc-4038cc11d22a
---
Quando o usuário autoriza explicitamente uma tarefa ampla ("faça você tudo isso", "executa", "muda X e Y"), **executar diretamente** as mudanças de sistema (powercfg, edição de configs em userdata/Steam, drivers via comando) sem pedir confirmação a cada passo.

**Why:** Em 2026-04 o usuário pediu otimização full do CS2 e, ao receber instruções para ele executar manualmente (mudar plano de energia, atualizar driver), respondeu "sim salve e faça voce tudo isso". Pediu execução, não checklist.

**How to apply:** Para mudanças locais reversíveis (powercfg, config files com backup, ajustes de registro com restauração), aplicar direto e reportar no final. Para ações de blast radius maior (drivers que requerem download externo, mudanças irreversíveis, comandos que afetam outras contas/serviços), ainda confirmar — autorização cobre o escopo do pedido, não tudo.
