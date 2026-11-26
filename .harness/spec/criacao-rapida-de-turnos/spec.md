# Spec / PRD — Criação rápida de turnos

> Estado: proposta, NÃO implementada. Tamanho: **XL** (lote atômico com RPC nova + revisão + copiloto), entregue em
> fases S/M independentes. Gate obrigatório: `harness-architect` na Fase 1 (migration + RPC) e
> `harness-security-reviewer` (RLS do encarregado, idempotência).
> Fontes lidas: `pages/company/CompanyCreateJob.tsx` (modelos, `?repetir=`, série, insert), `lib/jobDraft.ts`,
> `lib/recurrence.ts` (série EAGER, `MAX_SERIES_OCCURRENCES=60`), memory-bank (F1 slots/chamado, F3 série, E1-E5
> tags/responsável), `revisao-design/critica-empresa.md` §6, `copiloto-worki/mapa-de-intencoes.md` (G03/G05/E02).

## Resumo

Empresa (Gestor ou Encarregado) cria muitos turnos parecidos, no celular. Momma Doces: eventos com 1 a 3 freelas
(~1/semana) e lojas todo fim de semana. Hoje o formulário cria **um** turno por vez (ou uma série com o mesmo
horário). Esta spec define: regra slots x turnos, caminhos (rápido, repetir, vários de um modelo, série, copiar
semana), revisão antes de publicar, publicação atômica e idempotente, chamar freelas junto, e um contrato
`ShiftDraft` que a UI, um parser determinístico e o copiloto preenchem. O copiloto **só cria rascunhos**.

## O que existe hoje (base, não reinventar)

| Peça | Onde | Observação |
|---|---|---|
| "Comece de um turno anterior" | `CompanyCreateJob` (chips de `modelos`, últimos turnos no escopo) | É o "modelo" de hoje: um turno real. Limpa a data. |
| `?repetir=<jobId>` | `CompanyCreateJob:62-75,262` | Pré-preenche, foca a data. Não é edição. |
| Série recorrente | `JobSeriesService.createSeries` → RPC `create_job_series` | EAGER, mesmo horário em todas, máx 60, índice único contra duplo clique. Policy `job_series_insert` exige Gestor. |
| `jobs.slots` | F1 | N vagas = 1 turno; chamado fecha no N-ésimo aceite. |
| Briefing padrão | `companies.default_briefing` | Pré-preenche se vazio. |
| Tag | `set_job_tag` (E5), só se `tagsEnabled` | Aplicada DEPOIS do insert (não atômico hoje). |
| Responsável | trigger BEFORE INSERT preenche `auth.uid()` (E2, **não aplicada**) | |
| Rascunho | `lib/jobDraft.ts`, localStorage por usuário+empresa | Um rascunho de formulário; apagado no logout. |
| Chamar após criar | painel de convite pós-criação (`setShowInvitePanel`) | Só para 1 turno. |

**Medição "antes" (contada no código; confirmar com `harness-tester` cronometrando no 390px):**

| Tarefa | Toques | Segundos (est.) |
|---|---|---|
| 1 turno do zero | ~18 + digitação (título, descrição obrigatória, valor) | ~90 |
| 1 turno de um modelo | ~6 (modelo, data 2-3, rolar ~2.100px, Criar) | ~25 |
| 10 turnos, mesmo horário | série: ~14 (ligar recorrência, dias, data final, Criar) | ~45 |
| 10 turnos, horários diferentes (caso Momma) | 10 × (Criar turno, modelo, data, entrada, saída, Criar) ≈ **80-100** | ~300 |

**Meta "depois":** 1 turno de modelo ≤ 4 toques / ≤ 12 s; 10 turnos com horários diferentes ≤ 30 toques / ≤ 90 s;
copiar o fim de semana passado ≤ 5 toques / ≤ 20 s.

## Goals

- G1: 10 turnos de um modelo com horários distintos em ≤ 30 toques no 390px (medido pelo tester).
- G2: zero turno duplicado por duplo toque ou retry de rede (lote idempotente).
- G3: publicação tudo-ou-nada: nenhum estado "criei 6 de 10".
- G4: copiloto cria turno só via rascunho revisado pela pessoa (0 publicações sem toque humano).

## Regra 1 — slots x turnos (normativa)

Chave de agrupamento de um rascunho: `(data, início, fim, função, valor, tipo_de_valor, local, título)`.

- R1.1 Rascunhos com a **mesma chave** viram **1 turno** com `slots = soma`. Ex.: "3 garçons sáb 18-23 R$150" = 1
  turno, 3 vagas. Nunca 3 turnos.
- R1.2 Qualquer campo da chave diferente ⇒ **turnos separados**, criados no mesmo lote.
- R1.3 A fusão acontece na revisão, visível: "2 linhas iguais foram juntadas: 1 turno com 5 vagas" + "Separar".
- R1.4 Função determinística `mergeDrafts(drafts) → drafts` em `lib/shiftDrafts.ts`, testada (Vitest).
- R1.5 Turnos do mesmo lote ficam agrupados nas listas por `jobs.creation_batch_id` (Fase 1) com rótulo
  "Lote de 25/11 · 6 turnos · 14 vagas". Fora do lote, agrupamento por data na agenda continua como é.
- R1.6 Teto: `slots` por turno 1..50; lote máx **60 turnos** (mesmo teto da série, uma regra só).

## Contrato `ShiftDraft` (a peça central)

Tipo em `frontend/src/types/index.ts`; UI, parser e copiloto produzem **o mesmo objeto**.

```ts
export type ShiftDraftSource = 'form' | 'template' | 'repeat' | 'copy_week' | 'parser' | 'copilot';

export interface ShiftDraftTemplate {          // o que é comum a todas as linhas
  title: string; category: string;              // slug de SHIFT_CATEGORIES
  description: string; requirements?: string; briefing?: string;
  certification_requirement?: string | null;
  location?: string; budget_type: 'hourly' | 'daily' | 'project';
  has_lunch: boolean; tag_id?: string | null;
  attendance_mode?: AttendanceMode | null;      // reservado (ver Regra 6); null = padrão da empresa
  source_job_id?: string | null;                // modelo de origem, se houver
}

export interface ShiftDraftRow {               // o que varia por turno
  key: string;                                  // uuid local, estável na tela
  date: string;                                 // YYYY-MM-DD local (America/Sao_Paulo)
  start_time: string; end_time: string;         // HH:MM; end < start = vira meia-noite
  slots: number;                                // 1..50
  budget: number;                               // > 0
  overrides?: Partial<Pick<ShiftDraftTemplate, 'title' | 'category' | 'location' | 'tag_id'>>;
  invite_worker_ids?: string[];                 // chamar junto (Regra 5)
}

export interface ShiftDraftBatch {
  client_batch_id: string;                      // uuid gerado UMA vez ao abrir a revisão
  source: ShiftDraftSource;
  template: ShiftDraftTemplate;
  rows: ShiftDraftRow[];                        // 1..60 após mergeDrafts
  call?: { mode: 'none' | 'list' | 'workers'; list_id?: string; worker_ids?: string[];
           reason?: string; expires_minutes?: number };
}

export type ShiftDraftIssue =
  | { kind: 'past_date' | 'crosses_midnight' | 'probable_duplicate' | 'worker_busy'
            | 'missing_field' | 'over_limit'; row_key: string; detail: string; blocking: boolean };
```

- Validação única `validateBatch(batch) → ShiftDraftIssue[]` (pura, testada) usada pela UI e pelo copiloto.
- Persistência local: `lib/jobDraft.ts` passa a guardar `ShiftDraftBatch` (mesma chave usuário+empresa; versão
  `v: 2`; rascunho v1 do formulário único continua lido). Logout continua apagando.
- Copiloto: ferramenta `propose_shift_drafts(batch)` que **só** abre a tela de revisão preenchida. Não existe
  ferramenta de publicar. Classe de risco B do `mapa-de-intencoes.md` (G03/G05) passa a ser "rascunho".

## Regra 2 — caminhos

Uma entrada só: botão "Criar turno" abre a tela com 3 começos e um formulário.

- **2a Rápido (1 turno):** chip de modelo (último primeiro) → data (chips "Hoje / Amanhã / Sáb / Dom" + calendário)
  → Publicar. Horário, vagas e valor vêm do modelo, editáveis inline. Barra fixa com resumo e botão (crítica §6).
- **2b Repetir:** `?repetir=` mantido; vira atalho para 2a com o modelo já escolhido (link em detalhe do turno,
  agenda e copiloto).
- **2c Vários de um modelo:** modelo + "Várias datas" → calendário multi-seleção → uma linha por data com
  início/fim/vagas/valor do modelo. Ações por linha: editar, duplicar (mesma data, outro horário), remover.
  "Aplicar a todas" para horário, vagas, valor. → Revisar.
- **2d Série recorrente:** fica como opção avançada **dentro** de 2c: "Repetir toda semana até…" gera as datas no
  calendário com `generateOccurrenceDates`; o resultado é o mesmo lote de linhas (editáveis). Só quando a pessoa
  NÃO edita nenhuma linha e tudo tem o mesmo horário o lote é publicado como `job_series` (mantém `stop_job_series`
  e `update_job_series_future`). Com edição, vira lote comum e a tela diz: "Como você mudou horários, estes turnos
  não formam uma série: para parar, cancele cada um." Encarregado não vê a opção série (policy exige Gestor).
- **2e Copiar semana:** "Repetir o fim de semana passado" (e "a semana passada"): lê os turnos não-`deleted` do
  escopo da pessoa no intervalo, desloca +7 dias, abre a revisão como lote. Freelas chamados antes aparecem
  sugeridos (desmarcados) em `call`.
- **2f Texto (sem LLM):** campo "Colar ou digitar" com parser determinístico (Fase 4). Ver abaixo.

## Regra 3 — modelos nomeados

Hoje "modelo" = turno anterior (sem tabela). Recomendação: **não criar tabela na Fase 1.** Os últimos turnos
distintos (dedupe por título+função+horário+valor) cobrem a Momma. Fase 5 (só se pedirem): tabela
`job_templates (id, company_id, name, template jsonb no formato ShiftDraftTemplate, created_by, archived_at,
created_at)` com RLS `is_company_owner` para escrita e leitura também pelo encarregado confirmado; nunca DELETE,
arquivar (como tags). "Salvar como modelo" a partir de um turno ou da revisão.

## Regra 4 — revisão e publicação

- R4.1 Tela de revisão sempre antes de publicar lote (≥2 turnos) ou rascunho do copiloto/parser. Turno único do
  caminho 2a publica direto com o resumo na barra.
- R4.2 Cabeçalho: "6 turnos · 14 vagas · R$ 2.100 previstos" (custo = Σ slots × valor × horas se `hourly`;
  rótulo "previsto, você paga direto aos freelas").
- R4.3 Conflitos (por linha, `validateBatch` + uma RPC de leitura):
  - data passada → **bloqueia**; vira meia-noite → aviso "termina 02:00 do dia seguinte";
  - duplicata provável (já existe turno não-`deleted` da empresa com mesma data+início+função) → aviso com link;
  - freela ocupado (`get_busy_workers`, E5) → aviso, nunca bloqueia; sem E5 aplicada, degrada para sem aviso.
- R4.4 Publicar = **uma** RPC `create_jobs_batch(p_client_batch_id uuid, p_company_id uuid, p_template jsonb,
  p_rows jsonb)`:
  - SECURITY INVOKER (os INSERTs passam pela RLS de `jobs` e pelo trigger de `responsible_id`: o encarregado
    confirmado só cria turno próprio, sem regra nova), transação única: tudo ou nada.
  - Idempotência: colunas novas `jobs.creation_batch_id uuid NULL`, `jobs.creation_row smallint NULL`, UNIQUE
    parcial `(creation_batch_id, creation_row) WHERE creation_batch_id IS NOT NULL`. Se o lote já existe, devolve
    os ids existentes com `outcome='already_created'` (duplo toque e retry viram sucesso, nunca 2º lote).
  - Tag aplicada dentro da mesma transação (validação equivalente a `set_job_tag`), não depois.
  - Recusa > 60 linhas, slots fora de 1..50, budget ≤ 0, data passada. Devolve
    `{outcome, job_ids[], created}`; erros por linha com `row`.
  - Não toca saldo (Article 8 intacto). Sem DEFINER, sem GRANT especial além de `authenticated`.
- R4.5 Botão Publicar desabilita no toque; `client_batch_id` nasce ao abrir a revisão e só muda se o lote mudar.

## Regra 5 — chamar freelas junto

- Na revisão, seção "Chamar freelas" (padrão: nenhum): lista do Elenco (F2) ou pessoas, aplicada a todos os
  turnos ou por linha.
- Depois do commit do lote, o client dispara `ShiftCallService.createShiftCall(jobId, workerIds)` por turno, em
  sequência. Falha de chamado **não** desfaz turno (o turno é o contrato; o chamado é tentativa): a tela final
  mostra "6 turnos publicados · 5 chamados enviados · 1 falhou [Tentar de novo]". Aviso de risco de vínculo (F5)
  e indisponibilidade (F7) aparecem aqui como já aparecem no `ShiftCallModal`.
- Encarregado não confirmado: seção some (não opera).

## Regra 6 — presença (só o campo)

`attendance_mode` reservado no `ShiftDraftTemplate` e como linha "Presença: Padrão da empresa ›" na revisão e no
modelo. Valores e coluna em `jobs` são definidos por `.harness/spec/presenca-verificada/`. Até lá a linha não
aparece e o campo é sempre `null`.

## Parser determinístico (vale a pena? sim, como Fase 4, pequeno)

Entrada: "sex e sáb 18-23h 3 garçons 150". Gramática fechada em `lib/shiftTextParser.ts`: dias (seg..dom, hoje,
amanhã, dd/mm), intervalos `18-23h`/`18h às 23h30`, `N <função>` contra sinônimos de `SHIFT_CATEGORIES`, valor
`150`/`R$150`/`150/h`. Saída: `ShiftDraftBatch` parcial + lista do que não entendeu (nunca chuta). Linha não
entendida vira aviso na revisão. Barato, testável por tabela, funciona offline e sem custo de LLM; o copiloto
pode chamar o mesmo parser antes de recorrer ao modelo de linguagem.

## Wireframes 390px

```
A) CRIAR TURNO (início)                B) VÁRIOS DE UM MODELO
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ ← Criar turno                │      │ ← Garçom evento · 18–23 R$150│
│ COMECE DE UM MODELO          │      │ DATAS  [calendário nov/dez]  │
│ [Garçom evento 18–23 R$150]› │      │  S T Q Q S [S] [D]           │
│ [Loja sáb 9–17 R$120]      › │      │ ─────────────────────────────│
│ [Repetir fim de semana pass.]│      │ Sáb 29/11  18:00–23:00  3 ⋮ │
│ ou cole: "sex e sáb 18-23..."│      │ Dom 30/11  18:00–23:00  3 ⋮ │
│ [________________________]   │      │ Dom 30/11  12:00–17:00  2 ⋮ │
│ ─── ou do zero ───           │      │ + Adicionar linha            │
│ Função [Garçom ▾] Vagas [1]  │      │ Aplicar a todas: [horário]   │
│ Data [Hoje][Amanhã][Sáb][📅] │      │ [vagas][valor]               │
│ Entrada [18:00] Saída [23:00]│      │ Repetir toda semana até… ›   │
│ Valor [R$ 150] por dia ▾     │      │                              │
│ Mais detalhes (opcional)  ›  │      ├──────────────────────────────┤
├──────────────────────────────┤      │ 3 turnos · 8 vagas           │
│ 5 h · R$ 150    [PUBLICAR]   │      │ R$ 1.200     [REVISAR (3)]   │
└──────────────────────────────┘      └──────────────────────────────┘
 (barra fixa; BottomNav oculta)

C) REVISÃO                              D) PUBLICADO
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ ← Revisar                    │      │ ✓ 3 turnos publicados        │
│ 3 TURNOS · 8 VAGAS           │      │   8 vagas · lote 25/11       │
│ R$ 1.200 previstos (você paga│      │ Chamados: 3 enviados         │
│ direto aos freelas)          │      │ ─────────────────────────────│
│ ⚠ Dom 30/11 12–17: já existe │      │ Sáb 29/11 18–23  0/3  [Ver]  │
│   turno parecido  [Ver]      │      │ Dom 30/11 18–23  0/3  [Ver]  │
│ ⚠ Ana já trabalha sáb 18h    │      │ Dom 30/11 12–17  0/2  [Ver]  │
│ Sáb 29/11 18–23 3 vagas R$450│      │                              │
│ Dom 30/11 18–23 3 vagas R$450│      │ [Criar mais]   [Ir para Hoje]│
│ Dom 30/11 12–17 2 vagas R$300│      │                              │
│ CHAMAR FREELAS               │      │                              │
│ (•) Ninguém agora            │      │                              │
│ ( ) Lista: Garçons eventos   │      │                              │
│ ( ) Escolher pessoas      ›  │      │                              │
├──────────────────────────────┤      └──────────────────────────────┘
│ [Voltar]     [PUBLICAR 3]    │
└──────────────────────────────┘
```

## Critérios de aceite (testáveis)

- [ ] A1: DADO duas linhas com a mesma chave (R1) QUANDO revisar ENTÃO aparece 1 turno com `slots` somado e o aviso
      "juntadas"; `mergeDrafts` tem teste com 3 casos (igual, horário diferente, valor diferente).
- [ ] A2: DADO lote de 10 linhas QUANDO publicar ENTÃO existem 10 `jobs` com o mesmo `creation_batch_id`, ou 0 se
      qualquer linha falhar (teste SQL com linha inválida na posição 7).
- [ ] A3: DADO o mesmo `client_batch_id` chamado 2× (duplo toque/retry) ENTÃO há 10 jobs, não 20, e a 2ª chamada
      devolve `already_created` com os mesmos ids.
- [ ] A4: DADO encarregado confirmado QUANDO publica lote ENTÃO todos os `jobs.responsible_id = auth.uid()`; DADO
      encarregado não confirmado ENTÃO a RPC falha inteira; DADO empresa B ENTÃO não cria em A (`SET ROLE`).
- [ ] A5: DADO data passada ENTÃO Publicar fica desabilitado e a linha mostra o motivo; DADO 22:00–02:00 ENTÃO a
      linha diz "termina 02:00 do dia seguinte" e o turno é criado na data de início.
- [ ] A6: DADO turno existente com mesma data+início+função ENTÃO aviso "parecido" com link, sem bloquear.
- [ ] A7: DADO chamar Lista X em 3 turnos QUANDO 1 chamado falhar ENTÃO os 3 turnos seguem publicados e a tela
      oferece "Tentar de novo" só para o que falhou.
- [ ] A8: DADO "Repetir o fim de semana passado" ENTÃO a revisão mostra os turnos do sáb/dom anterior em +7 dias,
      só do escopo da pessoa, sem `deleted`.
- [ ] A9: DADO o copiloto pedindo "3 garçons sexta 18h" ENTÃO abre a revisão preenchida e nenhum `jobs` é criado
      sem o toque em Publicar (teste: ferramenta não tem caminho de escrita).
- [ ] A10: DADO "sex e sáb 18-23h 3 garçons 150" ENTÃO o parser gera 2 linhas (próxima sex e sáb), slots 3,
      budget 150, função garçom; DADO "tal dia lá" ENTÃO devolve "não entendi" e nenhuma linha.
- [ ] A11: medição do `harness-tester` no 390px atinge as metas da tabela "depois" (G1).
- [ ] A12: lote > 60 linhas é recusado no client e na RPC com a mesma mensagem.
- [ ] A13: build + lint verdes; `CompanyCreateJob.tsx` não passa de 600 linhas (extrair `ShiftBatchEditor`,
      `ShiftBatchReview`).

## Fases (cada uma entregável)

| Fase | Entrega | Tamanho | Útil para a Momma |
|---|---|---|---|
| 0 | Reordenar o formulário (função, data, horários, vagas, valor primeiro), chips de data, barra fixa, descrição sugerida pela função. Só frontend. **Coordenar com o agente que já edita o frontend** (crítica §6). | S | 1 turno de modelo em ~4 toques |
| 1 | `ShiftDraft` + `mergeDrafts`/`validateBatch` + migration `creation_batch_id` + RPC `create_jobs_batch` + telas B/C/D sem chamada. **Primeira fase de valor real**: eventos e fim de semana com horários diferentes. | M | 10 turnos em ~30 toques |
| 2 | Chamar freelas junto (Regra 5) + aviso de freela ocupado (depende de E5) + duplicata provável. | M | |
| 3 | Copiar semana/fim de semana + série dentro de 2c. | S | lojas todo fim de semana em ~5 toques |
| 4 | Parser determinístico + campo "Colar ou digitar". | S | |
| 5 | Copiloto `propose_shift_drafts` (depende da spec do copiloto) e, se pedirem, `job_templates`. | M | |

## Files to touch

| Path | Ação | Camada | Fase |
|---|---|---|---|
| `supabase/migrations/<ts>_criacao_lote_turnos.sql` | criar | data | 1 (colunas, UNIQUE parcial, RPC, GRANT authenticated, DOWN) |
| `frontend/src/types/index.ts` | modificar | types | 1 |
| `frontend/src/lib/shiftDrafts.ts` (+ `.test.ts`) | criar | lib | 1 |
| `frontend/src/lib/jobDraft.ts` | modificar | lib | 1 (formato v2) |
| `frontend/src/services/jobBatchService.ts` (+ teste) | criar | services | 1 |
| `frontend/src/components/shifts/ShiftBatchEditor.tsx`, `ShiftBatchReview.tsx` | criar | components | 1 |
| `frontend/src/pages/company/CompanyCreateJob.tsx` | modificar | pages | 0, 1 |
| listas de turnos (`CompanyJobs`, `CompanyToday`) | modificar | pages | 1 (agrupar por lote) |
| `frontend/src/lib/shiftTextParser.ts` (+ teste em tabela) | criar | lib | 4 |
| `e2e/criacao-lote.spec.ts` | criar | test | 1 |

## Risk matrix

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Duplo toque cria 2 lotes | M | A | `client_batch_id` + UNIQUE parcial + `already_created` |
| Lote parcial | B | A | RPC única, transação; tag dentro da transação |
| Encarregado cria turno de outro | M | A | RPC INVOKER: RLS + trigger de `responsible_id`; teste com 3 papéis. Depende de E2/E3 aplicadas: até lá só o Gestor usa o lote |
| Série e lote confundem | M | M | Série só sem edição; texto explícito quando vira lote |
| Chamada em massa vira spam | B | M | Padrão "Ninguém agora"; F5/F7 visíveis; cota existente do chamado |
| Página > 600 linhas | A | M | Extrair editor e revisão em componentes |
| Copiloto publica sozinho | B | A | Ferramenta só de rascunho; sem RPC de escrita exposta |
| Deploy frontend antes da migration (`42703`) | M | A | Ordem: migration antes do frontend |

## Estimate: XL no total (6 fases, ~6-8 dias); Fase 1 é M (~2 dias) e é a primeira com ganho grande.

## Rollback

`git revert <hash>` por fase. Migration DOWN: `DROP FUNCTION create_jobs_batch`, `DROP INDEX` do UNIQUE parcial,
`DROP COLUMN creation_batch_id, creation_row` (os turnos criados ficam, só perdem o agrupamento).
