---
name: Caminhos CS2
description: Onde ficam autoexec, video.txt, user_convars do CS2 instalado neste PC; usar pra editar/backup de configs
type: reference
originSessionId: bf1aed18-a242-4f69-82bc-4038cc11d22a
---
CS2 instalado em `C:\Program Files (x86)\Steam\` (não em D: nem outra biblioteca).

- **Executável:** `C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe`
- **autoexec.cfg / configs do jogo:** `C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg\` (criar `autoexec.cfg` aqui; carrega só com `+exec autoexec` nas launch options)
- **Settings de vídeo (resolução, VSync, FSR):** `C:\Program Files (x86)\Steam\userdata\362123109\730\local\cfg\cs2_video.txt`
- **User convars (sensitivity, viewmodel, crosshair, fps_max):** `C:\Program Files (x86)\Steam\userdata\362123109\730\local\cfg\cs2_user_convars_0_slot0.vcfg`
- **Machine convars (engine_no_focus_sleep, mobile_fps_limit, rate, etc.):** `C:\Program Files (x86)\Steam\userdata\362123109\730\local\cfg\cs2_machine_convars.vcfg`

Atenção: `cs2_*.vcfg` são re-escritos pelo jogo ao fechar. Pra mudanças persistentes, usar autoexec.cfg.
