---
name: project_disco_base_embalagem
description: "Momma usa SETOR (não categoria — desativada); discos são da Câmara Fria, só na fábrica; etiqueta do saco de disco = 2 discos, base é 1:1"
metadata: 
  node_type: memory
  type: project
  originSessionId: c1f37187-b393-4159-93fc-34528ebb49cb
---

**Momma NÃO usa "categoria" — usa SETOR.** Categorias foram **desativadas**. Não documentar/codar fluxo por categoria; o seletor de categoria deve sair do frontend de Produtos (usar só setor).

**Discos** (ex.: disco branco, disco brownie lowcarb, etc.) — setor **Câmara Fria** (`congelado`), produzidos **só na fábrica**:

- **Disco**: 1 saco = **2 discos**. A etiqueta QR do saco marca **2** (`quantidade_interna`/quantidade impressa = 2); bipar o saco conta 2 unidades.
- **Base**: **1:1** (1 base por saquinho). Tratar disco e base separadamente — NÃO existe regra "Discos & Bases = 2".

Relevante para a regra de quantidade por etiqueta na bipagem (ver [[project_etiquetas_qr_rastreabilidade]]). Setor vem de `produtos_master.setor`.
