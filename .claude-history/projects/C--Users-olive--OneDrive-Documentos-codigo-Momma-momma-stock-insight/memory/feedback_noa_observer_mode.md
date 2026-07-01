---
name: Conversas WhatsApp em mode='observer' = humano respondeu, NÃO Noa
description: Ao analisar histórico WhatsApp do atendimento Momma, mensagens com role='assistant' são do atendente HUMANO; Noa AI não estava ativa
type: feedback
originSessionId: 86a9b845-c78c-4040-8f0f-b412588d1631
---
Quando trabalhar com histórico de noaa_messages no canal whatsapp e a sessão estiver em `mode='observer'` (152/154 sessões em abril/2026), as mensagens com `role='assistant'` foram enviadas por um ATENDENTE HUMANO via WhatsApp Web/celular. A Noa AI estava só observando.

**Why:** Em 27/abr/2026, ao fazer análise científica do corpus, eu (Claude) classifiquei por engano dizendo "gap_noa" e "Noa errou X" quando na verdade era humano. CTO corrigiu na hora ("o noa nao respondeu nenhuma desss cnversas burro. era humano estamos estudando o historico nao o que noa ja fez é para noa nao errar"). O objetivo é estudar o playbook humano para Noa REPLICAR.

**How to apply:**
- Ao renderizar transcripts, rotular `assistant` como "ATENDENTE" (humano), não "NOA"
- Em prompts de classificação, deixar explícito: "ATENDENTE = humano da Momma; Noa AI ainda não estava ativa"
- Schema de classificação deve ter `tecnicas_atendente_que_funcionaram` (replicar) + `ponto_que_pode_melhorar` (Noa fará melhor) — NÃO usar `gap_noa`
- Sempre conferir `mode` da sessão antes de assumir que assistant=IA: `'ai'`=Noa respondeu, `'observer'`=Noa só observou, `'human'`=humano operando ativo
