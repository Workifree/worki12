---
name: Hardware do PC
description: Specs do notebook Samsung do usuário (gargalos e capacidades), pra dimensionar tarefas de games/perf
type: user
originSessionId: bf1aed18-a242-4f69-82bc-4038cc11d22a
---
Notebook **Samsung 550XBE/350XBE**, Windows 11 Home Single Language (build 26200).

- **CPU:** Intel i5-8265U (Whiskey Lake-U, 4c/8t, 1.6–1.8 GHz, ULV de notebook). Throttla pra ~800 MHz na bateria.
- **GPU:** Intel UHD 620 (iGPU, ~1 GB compartilhado). **É o gargalo principal** em qualquer 3D moderno. Driver atual em 2026-05: `31.0.101.2141` (29/Mar/2026).
- **Bug conhecido CS2 + UHD 620 + Win11 + DX11:** modelos de player borrados/listras/piscando/vazando textura. **NÃO é fixável por config.** É bug aberto da Valve (GitHub issues #4315 "Severe rendering glitch on Workshop maps" e #4092 "Vertex Explosion"). Comunidade Steam: "There is nothing we can do." Workarounds paliativos: limpar shader caches (script `CS2_CLEAR_SHADERS.bat` na Desktop), `-vulkan` na launch option (pula pipeline DX11 quebrado), verificar integridade no Steam, ALT+Enter quando aparecer, evitar mudar resolução mid-sessão. Solução real só com Valve fix ou hardware novo.
- **RAM:** 16 GB DDR4 (2 slots, fabricante Samsung).
- **Disco:** Kingston A400 SATA 480 GB (SSD).
- **Tela:** 1920×1080 @ 60 Hz.
- **Plano de energia padrão:** Balanced (não tem High Performance ou Ultimate criados).

Implicações:
- Manter plugado na tomada para evitar throttle de CPU.
- Em jogos pesados, esperar 720p–900p low. CS2: 40–70 fps in-game após tuning low-end.
- Driver Intel raramente é atualizado pelo Windows Update — buscar manualmente no site da Intel/Samsung.
