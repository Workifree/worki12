# Guia vivo (modo "Me mostre"): integração e API

Fase 1, sem IA. Funciona sozinho sem chave de IA e é a base do modo "Me mostre" e do tutorial do copiloto.
Nada dele clica, preenche ou envia. A única escrita de rede é a métrica de uso em `analytics_events`.

Arquivos: `frontend/src/lib/guide/**`, `frontend/src/components/guide/**`, `frontend/src/hooks/useGuide.ts`,
`frontend/src/hooks/useGuideTarget.ts`. Nenhum arquivo existente foi editado: **o guia só aparece depois dos 4 pontos abaixo.**

## 1. Montagem (a fazer por quem edita os arquivos existentes)

1. `App.tsx`: dentro de `<BrowserRouter>` (que já está sob `AuthProvider` e `ToastProvider`), envolver tudo:
   ```tsx
   <BrowserRouter>
     <GuideProvider>
       <PwaPrompts />
       <RouteFocus />
       <Suspense fallback={<PageLoader />}>...</Suspense>
     </GuideProvider>
   </BrowserRouter>
   ```
   Não montar nos layouts: `/recibo/:jobId` fica fora deles e o guia precisa sobreviver à ida até lá.
2. `layouts/MainLayout.tsx`: `<GuideRoleFreela />` em qualquer ponto. `layouts/CompanyLayout.tsx`: `<GuideRoleEmpresa />`.
3. **Um único botão**, `BotaoComoFaco`, nunca flutuante:
   - cabeçalho do celular dos dois layouts: `<BotaoComoFaco />` ao lado do sino;
   - `components/Sidebar.tsx` (desktop, o cabeçalho é `md:hidden`): `<BotaoComoFaco variante="linha" className="w-full" />`.

   Ele não renderiza nada sem papel ou sem provider (testes de tela existentes não mudam).
4. Opcional: `<GuideChecklist ocultavel />` no Início (`Dashboard`, `CompanyDashboard`, `CompanyToday`).
   A lista já aparece dentro da ajuda.

Conferir depois de montar: `AcessoEncerrado` e `AguardandoConfirmacao` não devem ter guia (`GuideRoleEmpresa` já informa
papel nulo sem empresa ou sem confirmação, mas se essas telas substituírem o layout o último papel pode persistir).

## 2. Como o copiloto compõe

- O botão continua sendo um só: `<BotaoComoFaco aoAbrir={abrirPainelDoCopiloto} rotulo="..." />`.
- No painel do copiloto, o modo "Me mostre" é `<ConteudoComoFaco onEscolher={fecharPainel} />` (sem casca, precisa estar
  sob `GuideProvider` e o Router). **Fechar o painel ao iniciar** um roteiro ou destaque. Painel modal aberto torna o resto
  inerte: o guia entra no modal e, se o alvo não está nele, encolhe para uma barra no topo.
- Sem chave de IA, não passar `aoAbrir`: o botão abre o painel do próprio guia.
- Não criar segundo botão flutuante nem segundo destaque.

## 3. API estável (`lib/guide/api.ts`)

```ts
import { guia, listarRoteiros, rotasPermitidas } from '../guide/api';

type Resultado = { ok: true } | { ok: false; motivo:
  'guia-indisponivel' | 'roteiro-desconhecido' | 'alvo-invalido' | 'rota-nao-permitida' };

guia.destacar(alvo: unknown, pedido: string | { titulo?: string; explicacao: string }): Resultado
guia.iniciarRoteiro(id: unknown): Resultado
guia.irPara(rota: unknown): Resultado          // RotaId com destino fixo, alcançável pelo papel
guia.listarRoteiros(papel): { id; titulo; descricao }[]
guia.rotasPermitidas(papel?): { id: RotaId; nome; padrao; navegavel }[]
guia.abrirAjuda(): Resultado
guia.sair(): void
guia.estado(): { disponivel; papel; ativo: null | { roteiroId; passo; total; alvoVisivel } }
guia.assinar(ouvinte): () => void              // em React: useGuideState()
```

Semântica:
- `ok: true` quer dizer **pedido aceito**, não "alvo na tela" nem "tarefa feita". Para saber se o alvo apareceu, assinar o
  estado: `alvoVisivel` é `null` (procurando), `true` ou `false` (ausente após 3,5 s; a busca continua).
- `destacar` não navega. Destaca na tela atual um único alvo `empresa.*.*` ou `freela.*.*` compatível com o papel
  (o formato estrito impede injeção de seletor). `publico.*` é sempre recusado. Título até 80 e explicação até 280
  caracteres, uma linha, texto puro. Para ir antes à tela: `irPara` e depois `destacar`.
- `destacar` aceita âncora que não esteja no catálogo. Risco D vem do catálogo **ou** de `data-copilot-risk="D"` no
  elemento: nesses o balão avisa que quem toca é a pessoa e não oferece "Ir até o botão".
- A explicação de `destacar` vinda de modelo é conteúdo não confiável: não montar com texto de terceiros (mapa, §7).
- `iniciarRoteiro` substitui o que estiver ativo e pode navegar para a tela do passo.
- `guia.estado().ativo === null` não distingue "concluiu" de "saiu".
- Escolha por IA sem agir: `escolherRoteiro(papel, pergunta, escolhedor)` em `lib/guide/escolha.ts`; a resposta é
  `unknown` e só passa o id exato do papel. A pergunta precisa ser redigida (PII) antes de ir a modelo remoto.
- Rotas: `rotasPermitidas` é a lista fechada de navegação. O motor do copiloto deve usar a mesma, sem string livre.
- Estas garantias valem para o **guia**. Não restringem o que o motor do copiloto faz por conta própria.

## 4. Comportamento

- Papéis: `gestor`, `encarregado`, `freela`. Guia ausente em `/`, `/login`, senha, `/sobre`, `/admin`, onboardings e
  rotas de convite; some com o modal de Termos.
- Boas-vindas: até 3 cartões com "Pular", uma vez por usuário e papel no aparelho; esperam outros modais fecharem.
- Progresso: `localStorage` `worki:guia:v1:<userId>:<papel>`. A marca do checklist significa "guia visto", não tarefa feita.
- "Concluído": botão Concluir ou toque da pessoa no alvo do último passo.
- Navega só ao iniciar, em Próximo/Voltar ou no botão "Ir para ...". Depois de avanço por toque, quem navega é a tela.
- Esc sai do guia quando o foco está no balão; "Sair do guia" está sempre visível.
- `driver.js` (MIT, pequeno) não foi adotado: seria preciso resolver à parte o `<dialog>` modal (fora dele tudo é inerte),
  a barra inferior e o passo sem alvo, que são o grosso do trabalho. Nenhuma dependência nova.

## 5. Métricas (`analytics_events`, via `AnalyticsService.trackEvent`)

| evento | metadata |
|---|---|
| `guia_roteiro_iniciado` | papel, roteiro, origem (`ajuda`, `sugestao`, `checklist`, `copiloto`) |
| `guia_roteiro_concluido` | papel, roteiro |
| `guia_busca_sem_resultado` | papel, termos (`1`, `2`, `3`, `4+`), tela (`RotaId` ou `outra`) |

Sem texto digitado, sem texto do copiloto, sem URL. `destacar` não gera evento. A camada existente grava o `user_id`
(não é anônimo). Não conferi se a tabela/policy aceita o insert em produção; a camada falha em silêncio.

## 6. Limites conhecidos

- Testado só em jsdom. **Falta conferir em navegador real**: 320 px, top layer com `popover` sobre `<dialog>`
  (inclusive a reabertura feita por `syncTopLayer`), barra inferior, teclado virtual, leitor de tela e reduced-motion.
- Passos sem âncora (só texto): cancelar/excluir turno (itens de `Menu`), operação, disponibilidade, menus do encarregado.
  Não há âncora de navegação (`<papel>.nav.*`) nem nos campos do formulário de turno.
- O teste do catálogo garante que o alvo existe no código, não que está na rota citada nem visível para o papel.
- Os textos dos passos foram escritos a partir do mapa de intenções; revisar contra as telas após a reforma em andamento.
