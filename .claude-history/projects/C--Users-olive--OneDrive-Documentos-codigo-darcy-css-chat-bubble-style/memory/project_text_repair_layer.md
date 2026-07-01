---
name: project_text_repair_layer
description: Camada de correção de texto PT-BR (anti palavras-grudadas) no darcy-chat — determinístico + revisor IA gated
metadata: 
  node_type: memory
  type: project
  originSessionId: cea28ead-5bc2-4a61-acab-afce678be95c
---

Os modelos `:free` (nemotron/qwen/llama) às vezes cospem português com espaços faltando ("conteúdo acadêmico"→"conteúdoacadêmico", "o tema"→"otema", "direta e"→"diretae", "é a"→"éa"). Como não dá pra trocar os modelos, foi adicionada uma **camada de pós-processamento server-side** que conserta a SAÍDA antes de exibir ao aluno (decisão do usuário em 2026-06-09: abordagem **híbrida**).

**Como funciona (2 camadas):**
1. **Determinístico SEMPRE** (grátis/instantâneo): `_shared/text-repair.ts` → `repairPortugueseText()`. Conserta espaçamento de pontuação + separa palavras grudadas via **léxico PT-BR embutido** (`_shared/pt-dictionary.ts`, ~30k palavras mais frequentes do corpus OpenSubtitles pt_br). Só divide um token quando ele NÃO está no léxico E cada pedaço resultante está; pedaços curtos só podem ser palavras-função (a/e/o/de/do…); estrangeirismos de domínio (login, email, online…) protegidos em `EXTRA_WORDS`. Protege código/inline-code/URLs/e-mails. Retorna `{text, suspicious}`.
2. **Revisor IA GATED**: só quando `suspicious=true`, chama `proofreadAnswer()` (em `darcy-chat/services/openrouter.ts`, modelo llama-3.3-70b, temp 0, best-effort com fallback pro texto já reparado — nunca piora).

**Onde está ligado:** `darcy-chat/index.ts` logo após `normalizeAnswer()` (≈linha 510). O texto reparado é o que vai pro widget E pra telemetria. Testes em `_shared/text-repair.test.ts` (`deno test`). **Só no darcy-local** (não mexer no nuvem/supabase, instrução do usuário). Voz não foi tocada (produz áudio, não texto na tela).

**Why:** requisito do usuário — "nenhuma falha pode chegar ao usuário"; usamos a IA como motor de inferência mas precisamos de uma camada de correção/organização do texto na saída.

**How to apply:** mudança é em edge function — precisa **redeploy/restart** da função `darcy-chat` no VM self-hosted pra ter efeito (ver [[reference_cead_vm_access]]). Regenerar o dicionário: top 30k de `pt_br_50k.txt` (hermitdave/FrequencyWords), só alfabético ≥2 letras, minúsculas. Relacionado: [[feedback_deployment_workflow]], [[project_telemetry_v3]].
