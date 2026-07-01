---
name: Módulo Funcionários (Core HR / DP/RH) — implementado 2026-04-28
description: Core HR completo (Sprint 1+2+3+4) — schema aplicado, 12 páginas com glassmorphism Momma, rotas em /funcionarios/*, ESS em /minha-conta, LGPD em /lgpd/encarregado
type: project
originSessionId: f3565f59-f147-48f9-aceb-a80009254bcc
---
# Módulo Funcionários (Core HR + MSS) — Implementado 2026-04-28

## Status: schema aplicado em prod + UI completa

Migration `20260428120000_create_funcionarios_module.sql` aplicada em `jaumyfyeueayibbxunxc` (Supabase prod). 7 tabelas + RLS + triggers + 26 cargos seed + 2 roles novas (`rh_admin`, `rh_analista`) + 7 permissions.

## Nomenclatura
- **Rótulo técnico interno:** `core-hr`
- **Label UI:** **"Funcionários"** (rota `/funcionarios`, pasta `src/features/funcionarios/`)
- **NÃO confundir com `/usuarios`** (módulo de gestão de acesso ao sistema — refatorado 2026-04-28)

## Tabelas criadas (DB)
- `cargos` (12 cols) — 26 seed food service (atendente, cozinheiro, padeiro, gerente, etc.)
- `employees` (42 cols) — entidade central, separada de profiles
- `contratos` (13 cols) — com CHECK constraints CLT (Art. 445/451)
- `experiencia_decisoes` (8 cols) — audit das decisões prorrogar/efetivar/encerrar
- `employee_audit_log` (11 cols) — append-only via triggers (LGPD)
- `eventos_esocial` (10 cols) — XML S-2200/S-2299
- `lgpd_solicitacoes` (11 cols) — canal exercício direitos titular

## Triggers ativos
- `gen_employee_matricula` — gera matrícula `M{loja_id}{YYYYMM}{seq}` automática
- `log_employee_changes` — audit log automático em INSERT/UPDATE/DELETE de employees
- `set_employee_descarte_planejado` — calcula `data_descarte_planejada = data_demissao + 5 anos` ao terminar
- `set_updated_at_timestamp` — em cargos/employees/contratos

## Páginas implementadas (12 rotas)

| Rota | Página | Descrição |
|---|---|---|
| `/funcionarios` | `Funcionarios.page.tsx` | Lista + KPIs + filtros + tabela com mascaramento CPF |
| `/funcionarios/novo` | `NovoFuncionario.page.tsx` | Wizard admissão com validação CLT em tempo real, presets 45+45 |
| `/funcionarios/cargos` | `Cargos.page.tsx` | CRUD cargos + dialog modal + KPIs por área |
| `/funcionarios/:id` | `FuncionarioPerfil.page.tsx` | Perfil 3 tabs (dados, contratos, audit) + alerta de experiência |
| `/funcionarios/experiencia` | `Experiencia.page.tsx` | Buckets por urgência + dialog decisão (efetivar/prorrogar/encerrar) com validação CLT |
| `/funcionarios/aniversariantes` | `Aniversariantes.page.tsx` | Cards por mês, respeitando `divulgar_aniversario` LGPD |
| `/funcionarios/organograma` | `Organograma.page.tsx` | Árvore expansível de `manager_id`, filtro por loja |
| `/funcionarios/esocial` | `Esocial.page.tsx` | Gerenciamento de eventos S-2200/S-2299, download XML, status |
| `/funcionarios/audit` | `AuditLog.page.tsx` | Audit log com busca, últimos 500 |
| `/funcionarios/dashboard` | `DashboardRH.page.tsx` | KPIs multi-loja, turnover 30d, top cargos |
| `/lgpd/encarregado` | `LgpdEncarregado.page.tsx` | Canal direitos LGPD com formulário |
| `/minha-conta` | `MinhaConta.page.tsx` | ESS: colaborador edita próprios dados + privacidade |

## Hooks/Libs
- `model/useEmployees.ts` — hook lista com filtros (loja/cargo/status/search/aniversariantes_mes)
- `model/useCargos.ts` — CRUD cargos
- `lib/cpf.ts` — `formatCpf`, `maskCpf`, `isValidCpf` (algoritmo dígitos verificadores)
- `lib/probation.ts` — `validatePrazoExperiencia`, `validateProrrogacao`, `tempoDeCasa`, `probationAlertLevel`

## Componente shared criado
- `src/shared/ui/MaskedSensitive.tsx` — mascara CPF/RG/salário/conta_bancaria com botão revelar (audit log no consumer)

## Design system aplicado (Momma)
- **Layout:** `MommaPageLayout` (stripe toldo `repeating-linear-gradient #57715B`, folhas animadas, glows)
- **Glassmorphism:** cards `bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl border-[#57715B]/10 rounded-[28px-32px] shadow-lg shadow-[#57715B]/5`
- **Filtros:** `bg-white/40 backdrop-blur-md rounded-3xl`
- **Inputs:** `bg-white/60 border-[#57715B]/20 rounded-2xl h-10`
- **Cores:** verde `#57715B`/`#33733F`, cream `#E6DCCF`, marrom dourado `#B49364`/`#7a5f3a`/`#C5A065`, vermelho urgência `#C04848`, foreground `#2D362E`, muted `#8C7B6D`/`#9BA59C`
- **Tipografia:** títulos `font-serif text-4xl md:text-5xl font-bold tracking-tight`, subtítulos `text-xs uppercase tracking-widest opacity-80`
- **Animações:** `animate-in fade-in duration-500` no container, `transition-all duration-200` nos hovers, `hover:bg-[#57715B]/5`
- **Pills:** `rounded-full px-3 py-0.5 bg-[cor]/10 border-[cor]/20`

## Rotas integradas
- `src/App.tsx` — 12 rotas com `ProtectedRoute + DashboardLayout`
- `src/app/router.tsx` — mesmas 12 rotas no roteador moderno
- `src/features/dashboard/ui/AppSidebar.tsx` — `PERMISSION_MAP` configurado (admin-only por agora; `/lgpd/encarregado` e `/minha-conta` são públicos)
- `src/features/dashboard/ui/menuItems.ts` — `gerenciaItems` com "Funcionários" + "Usuários" (ícones IdCard / Users)

## Compliance crítico
- **CLT Art. 445/451 + Súmula 188 TST:** validações no banco via CHECK constraints (prazo ≤ 90 dias, prorrogação ≤ 1)
- **LGPD:** mascaramento CPF default; audit log automático via trigger; `data_descarte_planejada` calculado no desligamento; canal `/lgpd/encarregado` com prazo Art. 19 (15 dias); base legal default = Art. 7º II (obrigação legal)
- **eSocial:** export XML S-2200 (admissão) e S-2299 (desligamento) via `/funcionarios/esocial`

## Validação técnica feita
- `npx tsc --noEmit` exit 0
- 1 lint warning intencional (`audit_insert_system` allows true — pattern correto de trigger SECURITY DEFINER)
- 26 cargos seed inseridos
- 2 roles RH novas
- 7 permissions criadas

## O que ainda falta (out of scope desta sessão)
- Geração de XML S-2200/S-2299 reais (hoje a tabela `eventos_esocial` existe mas não há código gerando o XML automático na admissão/desligamento — precisa ser feito como step pós-criação)
- Wizard de desligamento dedicado (hoje "encerrar" no fluxo de experiência marca como `terminated`, mas não há fluxo separado para desligamento de quem já está `active`)
- MIA tools (`funcionarios_listar`, `funcionarios_em_experiencia`, etc.) — PRD seção 11
- Criptografia at-rest com `pgcrypto` + Vault (hoje texto plano com RLS estrita)
- Cron jobs de alerta D-30/D-15/D-7 e conversão automática Art. 451 (hoje só visualização sob demanda)

## Dúvidas em aberto
- Encarregado LGPD nominal (hoje placeholder `lgpd@momma.com.br` em `LgpdEncarregado.page.tsx`)
