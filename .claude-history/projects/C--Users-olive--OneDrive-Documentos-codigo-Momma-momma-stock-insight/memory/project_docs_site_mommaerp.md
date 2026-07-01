---
name: project_docs_site_mommaerp
description: Docs públicas em momma-xi.vercel.app/docs (MkDocs em public/docs servido pelo app); sistema renomeado para MommaERP
metadata: 
  node_type: memory
  type: project
  originSessionId: c1f37187-b393-4159-93fc-34528ebb49cb
---

**Nome do sistema = MommaERP** (antes "Gidape" codinome / "Momma Sistema" display). Rename feito 2026-06-03 **apenas nas docs publicadas**; o restante ainda usa Gidape: repo `Ochozn/Gidape`, título do CLAUDE.md, memory-bank, e `service.name=gidape` no OTel (preservado de propósito — é identificador, não troca). Se for canonizar MommaERP no codebase, é tarefa separada.

**Marca em conteúdo de usuário (regra forte do CTO):** a empresa é só **"Momma"** — NUNCA "Confeitaria Artesanal" (nunca foi isso, mesmo a doc antiga estando errada), NUNCA "doces saudáveis" como descritor público. O sistema/ERP é **MommaERP**. ("doces saudáveis"/shelf-life curto continua válido como fato INTERNO de negócio p/ forecast — ver [[project_momma_business_validade]] — só não vai em doc de usuário.)

**Docs reescritas 100% (2026-06-04):** overhaul multi-agente revisou toda a doc publicada contra o código real (frontend mudou muito). MIA atualizada (router→agents ReAct, streaming, Modo IA glass-box, /mia entrada desktop). Manter doc fiel ao código: ao mexer numa feature, atualizar a página de usuário correspondente (regra de sync via Gemini no [[CLAUDE.md]]).

**Docs publicadas em https://momma-xi.vercel.app/docs** — público, sem login. Mecanismo:
- Gerador = **MkDocs Material** (open-source, SOTA estilo GitBook). Config em `mkdocs.yml`.
- **NÃO usa GitHub Pages**: plano do GitHub não suporta Pages de repo privado (HTTP 422). gh-pages branch órfão pode ser ignorado/apagado.
- Site é buildado para **`public/docs/`** (commitado, marcado `linguist-generated` em `.gitattributes`) → Vite copia para `dist/docs/` → servido pelo deploy do app na Vercel (projeto `momma`, prebuilt).
- `vercel.json`: rewrite exclui `/docs` da SPA; `vite.config.ts`: PWA exclui `/docs` (globIgnores + navigateFallbackDenylist).
- Build Python (mkdocs) **não roda** no cloud build da Vercel — por isso o estático vai commitado em `public/docs`. Regenerar com `npm run docs:build` (precisa mkdocs-material via pip).
- `exclude_docs` no mkdocs.yml blinda conteúdo interno (mia/, research/, specs/, qa-security-review/, seguranca-permissoes etc.) do site público.

Regra do harness em [[CLAUDE.md]]: antes de todo push, agent Gemini atualiza docs de usuário + rebuilda `public/docs`. Ver feedback [[feedback_stg_only_branch]].
