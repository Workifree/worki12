---
name: project_moodle_knowledge_base
description: "Base de conhecimento do Moodle (domínio do produto) no darcy-chat — núcleo fixo + roteador por palavra-chave, sem RAG"
metadata: 
  node_type: memory
  type: project
  originSessionId: cea28ead-5bc2-4a61-acab-afce678be95c
---

Darcy agora é especialista no **Moodle (o produto)**, não só na FAQ do CEAD e nos dados do curso. Objetivo do usuário (2026-06-10): orientar "onde clicar" em QUALQUER funcionalidade do Moodle, com base na doc OFICIAL (docs.moodle.org, estável 5.2, licença GNU GPL).

**Decisão do usuário: SEM RAG / sem embeddings.** (A doc tem ~20k páginas / ~2.900 artigos — impossível inlinear tudo em modelo :free. Acordado: base curada destilada da doc oficial, não os 20k brutos.)

**Arquitetura** (`_shared/moodle-knowledge.ts`):
- `MOODLE_SECTIONS`: 25 seções PT-BR destiladas da doc oficial (aluno + professor), cada uma com `keywords`, `doc` (URL oficial verificada) e `body` (passo a passo "onde clicar" com rótulos pt_br reais). Geradas por 5 subagents em paralelo, URLs verificadas via WebFetch.
- `MOODLE_CORE_INDEX`: mapa compacto de TODAS as áreas (~600 tokens), injetado SEMPRE — Darcy sabe que domina o Moodle inteiro.
- `selectMoodleSections()` / `buildMoodleKnowledgeBlock()`: roteador DETERMINÍSTICO por palavra-chave (normaliza sem acento, fronteira de palavra p/ tokens, substring p/ frases e fragmentos de caminho tipo `/mod/forum`). Casa a pergunta + pageContext (URL/atividade/seção) e injeta as 1–2 seções relevantes. Sem match → só o índice.

**Ligado em** `darcy-chat/index.ts`: `systemPromptFull = systemPrompt + buildMoodleKnowledgeBlock(sanitizedMessage, safePageContext, verifiedRole)`; usado nas messages E na telemetria (captura o prompt completo). Custo: ~600 tokens sempre, ~1150 quando injeta detalhe. Testes: `_shared/moodle-knowledge.test.ts` (`deno test`).

**Só no darcy-local.** A voz (buildVoiceInstructions) NÃO foi tocada (orçamento de tokens do realtime é apertado) — possível follow-up. Regenerar/expandir seções: mesmo padrão (destilar docs.moodle.org/en/<Pagina>, verificar URL).

**How to apply:** é edge function — precisa redeploy/restart de `darcy-chat` no VM ([[reference_cead_vm_access]]). Relacionado: [[project_text_repair_layer]] (mesma leva de mudanças, ainda não deployada), [[feedback_deployment_workflow]].
