# Sobreposições e componentes que se empurram: auditoria automática (26/11/2026)

Detector: `scripts/galeria-telas/lib/layout.mjs` (modo `node run.mjs --layout`), resumo em
`node relatorio-layout.mjs <pasta>`. 430 cenários x 7 tamanhos = **3006 fotos** (1440x900, 1024x768,
768x1024, 390x844, 390x720, 390x640, 320x640), todas com o Supabase interceptado: **0 requisições externas saíram**.
Por foto: (a) sobreposição de alvos (>15%), (b) alvo coberto por camada/fixo (`elementFromPoint`), (c) overflow horizontal,
(d) texto cortado/escapando, (e) alvo < 44px no toque, (f) primário abaixo da dobra sem barra fixa,
(g) barra fixa que impede ver o fim, (h) teclado virtual simulado (janela -42%) cobrindo o campo.
Fotos dos casos graves, com o elemento contornado: `layout/*.png` na pasta de saída.

## Contagens (só o que é defeito deste lote)

Fora da conta, por regra explícita no relatório: ~5090 achados do rail do Sidebar em 768/1024 (arquivo de outro agente, ver abaixo)
e ~126 falsos positivos conhecidos (h1 `max-md:sr-only`, prévia recortada do termo com "ver completo", nome truncado com reticências
intencional, painel do sino aberto cobrindo por desenho, menu aberto contado como barra no teclado).

| tipo | antes | depois |
|---|---:|---:|
| (a) sobreposição | 0 | 0 |
| (b) fixo/camada cobre alvo | 30 | 30 (todos em `PwaPrompts`, de outro dono) |
| (g) barra impede o fim | 0 | 0 |
| (c) overflow horizontal | 3 | **0** |
| (d) texto cortado/escapando | 38 | **24** |
| (e) alvo < 44px | 221 | **101** |
| (h) teclado cobre campo | 0 | 0 |
| (f) primário abaixo da dobra (informativo, não corrigido) | 931 | 932 |
| **total sem (f)** | 292 | **155** |

"Depois" refeito nos 56 cenários que tinham achado (392 fotos); os demais mantêm a medida do "antes".
A primeira passada (antes de refinar as regras do detector) achou também: painel do sino 58px fora da tela (corrigido),
2 sobreposições falsas de links em linha e cabeçalho sticky tratado como "cobre o fim" (regras corrigidas no detector).

## Corrigido (arquivos permitidos)

- `components/NotificationBell.tsx`: painel do sino vazava 58px pela esquerda quando o sino está no menu lateral (1440); agora a posição é `left` com limites.
- `components/MyCertificationsSection.tsx`: cabeçalho com título + "Cadastrar" estourava 18px a página em 320; agora quebra linha (`flex-wrap`, `min-w-0`).
- `components/team/ShiftCallModal.tsx`: chip de lista com nome longo tinha altura fixa (`h-11`) e o texto escapava; agora `min-h-11`, quebra e `max-w-full`.
- Alvos < 44px: `components/bonus/PayoutPanel.tsx` e `TrailGate.tsx` (links do regulamento, 16px), `pages/BonusRules.tsx` (link Termos), `pages/CompanyPublicProfile.tsx` (link Site, 32px), `pages/Profile.tsx` (trocar foto, 36px em tablet: removido `sm:h-9 sm:w-9`), `pages/Admin.tsx` (campos do login, 40px), `components/ServiceTermSection.tsx` (duas linhas de checkbox, 36 a 40px).
- Infra: `scripts/galeria-telas` (modo `--layout`, retomada se o Chrome cair, gravação incremental), fixture `get_my_worker_profile` (telas do freela ficavam em "carregando").

## Pendente, de outro dono (não editei)

1. **`components/PwaPrompts.tsx` + `index.css` (`.worki-pwa-stack`)**: a pilha fixa cobre conteúdo e ações no celular.
   - "Instale o Worki" cobre o botão "Ver tudo" e o card/link do turno (8 cenários, 320/390): `pwa-offline-instalar-android|iphone|empresa`, `extras-sino-vazio`.
   - A faixa "Você está sem internet" (linha ~144) cobre o campo "Mensagem" do chat (`pwa-offline-faixa-sem-internet-chat`).
   - Correção sugerida: publicar a altura da pilha numa variável CSS e somar ao `padding-bottom` da rolagem principal; no chat, subir a pilha acima do compositor (ou deixar só o ícone) e esconder o aviso de instalação quando houver campo em foco.
2. **`components/Sidebar.tsx:137-138`** (rail em 768/1024, `overflow-hidden`): rótulos ("Início", "Criar turno", "Verificado", nome da empresa) ficam cortados por desenho, sem `aria-hidden` nem `sr-only`, e os links do rail medem **44x40** no toque (768 é toque): abaixo de 44px de altura. Correção sugerida: `min-h-11` nos links do rail e rótulo `sr-only` quando o rail está recolhido.
3. **`components/BottomNav.tsx`**: os dois testes que falham (`text-gray-500`, `text-blue-600`) são do próprio arquivo, que o outro agente mudou para `text-gray-600`/`text-blue-700`; **a mudança não é minha** e os testes ficam com o dono do arquivo.
4. **Onboarding (`pages/worker/WorkerOnboarding.tsx:684-686`, `pages/company/CompanyOnboarding.tsx:377-379`)**: links "Termos de Uso"/"Política" medem 36px e a linha do checkbox também (12 cenários). Estão dentro de frase (exceção WCAG 2.5.8), então ficaram; se quiserem o alvo de 44px, usar `min-h-11` na linha toda em vez de `py-2` no link.
5. **Valor monetário longo**: `p "R$ 900,00"` escapa 25px à direita em 6 cenários (`admin-bonus-acompanhamento`, `estresse-longos-empresa-publica`, `estresse-longos-relatorio`). Só no cenário de estresse (números enormes); falta `min-w-0`/`truncate` no contêiner do valor. Não localizei o componente com certeza; ver `components/bonus/*` e relatórios da empresa.
6. **Primário abaixo da dobra (932 ocorrências, sev 1)**: informativo. Os casos que importam são os de formulário longo no 320 e no 390x640; avaliar barra de ação fixa nesses diálogos (`DialogParts`).

## Como repetir

```
cd scripts/galeria-telas
node run.mjs --layout --porta=5193 --paralelo=6 --vp=1440,1024,768,390,320,390s,390c --saida=<pasta>
node relatorio-layout.mjs <pasta> --md=<arquivo.md>
```
`--so=<ids>` reprocessa só alguns cenários e mantém o resto de `layout.json` da pasta.
