# Copiloto Worki: pesquisa cética do estado da arte (25/11/2026)

Legenda: **[E]** evidência (estudo com método) · **[D]** documentação oficial ou norma (prova o que o produto ou a regra diz, não a eficácia) · **[M]** marketing ou dado autodeclarado de fornecedor · **[O]** opinião, inferência ou recomendação minha.

Método e limites: busca web e leitura de páginas em uma passada. O WebFetch resume as páginas com um modelo pequeno, então conferir o texto original antes de qualquer decisão jurídica. Não li PDFs completos. Não medi nada no app. Não conheço o volume atual de atendimento do Worki, que é o dado mais importante para decidir.

## 0. Veredito

[O] Faz sentido testar um assistente pequeno, que **responde, mostra e prepara**, usando ferramentas tipadas. Não faz sentido, agora, um agente que "opera o app" clicando no DOM. E nada disso se justifica antes de saber por que as pessoas pedem ajuda. Não encontrei evidência de que um copiloto reduza atendimento num SaaS deste porte. A redução é hipótese a medir.

Restrição interna: o Artigo 16 da constitution diz que o routing de IA atual é só de desenvolvimento e que o produto não depende de IA para funcionar. Um copiloto cria IA em runtime e um novo operador de dados. Pede ADR, e o app precisa continuar completo com o copiloto desligado. A edge function de proxy também pede revisão de segurança.

## 1. Tutoriais, tours e ajuda no momento

- [E] NN/g, teste quantitativo entre grupos, 70 pessoas, 4 apps iOS (2020): com tutorial, 91% de sucesso contra 94% sem, e 93 s contra 85 s (nenhuma das duas diferenças é significativa). O tutorial piorou a percepção de facilidade (4,92 contra 5,49 de 7, p=0,047). Limite: tutorial em cartões, apps de consumo, não B2B. https://www.nngroup.com/articles/mobile-tutorials/
- [E/O] NN/g (2023): ajuda empurrada fora de contexto é pulada e esquecida. A recomendação é ajuda "puxada", ligada ao que a pessoa está fazendo, fácil de fechar e de reabrir. Ressalva do próprio artigo: é mais difícil de construir (cita o Clippy). https://www.nngroup.com/articles/onboarding-tutorials/
- [E, antigo, 2015] NN/g: ajuda em sobreposição complementa a base de ajuda, não substitui. Ajuda adaptativa só funciona com alta precisão, e o dinheiro pode render mais em teste de usabilidade e conserto da interface. https://www.nngroup.com/articles/pop-up-adaptive-help/
- [M] Chameleon 2024 (cerca de 300 milhões de interações de 2023): conclusão média de 33,5%; 5 passos, 21,6%; iniciado pelo usuário via lista, 64%. Só 1 em 10 abre o menu de checklist e 28% desses concluem um item. A página não define "conclusão". https://www.chameleon.io/benchmark-report-24
- [M] Chameleon 2025: disparo por clique ou checklist, 67%; atraso fixo, 31%; 3 passos, 72%; 4 passos, 74%; 7 ou mais, 16%. https://www.chameleon.io/blog/mastering-product-tours
- [M] A versão antiga fala em média de 61% (https://www.chameleon.io/blog/product-tour-benchmarks-highlights). Os números variam muito entre anos: usar só a direção (curto e iniciado pelo usuário é melhor). Conclusão de tour **não** prova aprendizado, retenção nem menos suporte. Há viés de seleção: quem clica já queria ajuda.
- [E] Assistente por texto tem a "barreira de articulação": parte das pessoas não consegue formular o pedido (estudo qualitativo com usuários frequentes de ChatGPT, outro contexto). https://www.nngroup.com/articles/response-outlining/ · [O] No celular, em bar ou evento, oferecer 3 ou 4 botões por tela, não uma caixa vazia.
- Não encontrei estudo da NN/g sobre checklist de onboarding de produto. A eficácia de checklist se apoia aqui só em [M].

## 2. Agente por DOM × ferramentas tipadas

### Confiabilidade e latência
- [E] Online-Mind2Web (300 tarefas, 136 sites): os autores concluem que a capacidade dos agentes web era bem menor do que os benchmarks anteriores indicavam. https://arxiv.org/abs/2504.01382 (o resumo lido não traz taxas).
- [M/placar misto] Em 2026 há entradas perto de 97% no mesmo benchmark, entre elas uma autodeclarada e julgada pelo próprio fornecedor (https://browser-use.com/posts/online-mind2web-benchmark). Agregadores: https://yutori.com/leaderboards/online-mind2web e https://leaderboard.steel.dev/leaderboards/online-mind2web/ . Julgamentos diferentes não são comparáveis. [O] Evoluiu rápido, mas isso não mede o nosso app, em pt-BR, no celular, com um modelo barato.
- [E] OSWorld-Human (computer use em desktop, **não** é agente DOM): os melhores dos 16 agentes dão 2,7 a 4,3 vezes mais passos que o humano; a latência chega a dezenas de minutos em tarefas de poucos minutos, dominada por chamadas ao modelo. https://arxiv.org/abs/2506.16042
- [E, 2024, modelos antigos] τ-bench: **ferramentas tipadas também falham**. GPT-4o resolveu menos de 50% e, no varejo, acertou as 8 de 8 repetições em menos de 25% (pass^8). https://arxiv.org/abs/2406.12045
- [O] Ferramenta tipada não torna o modelo correto. Ela reduz o espaço de erro e permite validar argumentos, testar e impor regra no servidor. Conta ilustrativa, supondo passos independentes: 95% por passo dá 77% em 5 passos e 60% em 10.
- Não encontrei comparação controlada, publicada e independente, entre DOM e ferramentas no **mesmo** app. As vantagens "N vezes mais rápido ou barato" que apareceram são de fornecedores.

### Bibliotecas (comparação rasa; page-agent é analisado a fundo por outro agente)

| Opção | O que é | Encaixe no Worki [O] |
|---|---|---|
| [page-agent](https://github.com/alibaba/page-agent) (MIT, v1.12.4) [D] | Agente dentro da página, DOM em texto; o README mostra a chave do LLM no construtor e não descreve confirmação humana | Protótipo. Produção exigiria proxy e portões próprios. A ausência no README não prova ausência no código |
| [browser-use](https://github.com/browser-use/browser-use) (MIT) [D] | Agente que dirige um navegador via CDP (Python e nuvem) | Automação externa ou QA, não é widget para o usuário |
| [Stagehand](https://github.com/browserbase/stagehand) (MIT) [D] | SDK de agente de navegador (act, observe, extract), local ou Browserbase | Mesma categoria |
| [CopilotKit](https://github.com/CopilotKit/CopilotKit) (MIT) [D] | Ferramentas no frontend e humano no circuito; o quickstart usa runtime de servidor | Completo; avaliar peso e como o runtime roda em Edge Function (não verificado) |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) (MIT) [D] | Componentes React de chat, UI de ferramenta, aprovação inline | Boa camada de UI; falta validar com o design neo-brutalista |
| [Vercel AI SDK](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/03-chatbot-tool-usage.mdx) [D] | Ferramentas no cliente e aprovação; `toolApproval` (o `needsApproval` está depreciado); como o cliente reenvia o histórico, há segredo experimental para verificar aprovações | Menor camada útil. Aprovação vinda do cliente não é autorização |
| [driver.js](https://github.com/kamranahmedse/driver.js) (MIT) [D] | Destaque, tour, dicas, checklist, sem dependências | Recomendado para "me mostre onde" |
| [Shepherd](https://github.com/shipshapecode/shepherd) [D] | AGPL-3.0 ou licença comercial (comercial exige licença paga) | Evitar |

### WebMCP
- [D] Origin trial a partir do Chrome 149, API sujeita a mudança, pensada para fluxo com humano presente; a página documenta só o Chrome e não menciona celular (atualizada em 07/10/2026). https://developer.chrome.com/docs/ai/webmcp
- [D] Orienta marcar `readOnlyHint`, `consequentialHint`, `untrustedContentHint`, restringir `exposedTo` e não confiar só em proteção do modelo; extensões com permissão de host alcançam as ferramentas. https://developer.chrome.com/docs/ai/webmcp/secure-tools
- Fontes secundárias divergem sobre a versão final do trial. As skills `webmcp`, `agentic-javascript-tools` e `agentic-forms` do modern-web-guidance **não foram lidas**: exigem opt-in explícito de origin trial no projeto (`npx modern-web-guidance@latest set-allow-origin-trials`), que não executei. O que está aqui vem das páginas públicas do Chrome.
- [O] WebMCP serve para o agente **do navegador do usuário** usar o app. Não é um copiloto próprio. Não adotar agora. Um catálogo de ferramentas bem definido pode ser exposto depois.

### Padrão híbrido recomendado [O]
1. Ações e dados: só ferramentas tipadas, que chamam os services e RPCs existentes com o JWT do usuário (RLS e o seam valem). Nunca `service_role`.
2. Interface: `navigate_to(rota_permitida)`, `highlight(ancora)` e `start_tour(id)`, com lista fechada de âncoras (`data-help="..."`) e driver.js. O modelo escolhe um ID, nunca um seletor ou clique livre.
3. Sem fallback de clique por DOM em produção. Se não há ferramenta, o assistente mostra o caminho.
4. LLM só atrás de Edge Function: chave no servidor, cota por usuário, teto de passos e de gasto, botão de desligar.

## 3. Segurança

- [D] OWASP LLM01: não está claro se existe prevenção infalível. Mitigações: menor privilégio, código (não o modelo) detém tokens e funções, aprovação humana em alto risco, separar conteúdo não confiável, testes adversariais. https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- [D] OWASP LLM06, agência excessiva: poucas ferramentas, granulares, no contexto do usuário, aprovação para alto impacto e **mediação completa** no sistema de destino. https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
- [D] Existe também o Top 10 para aplicações agênticas 2026 (não li os itens): https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- [O/modelo mental] "Lethal trifecta": dados privados + conteúdo não confiável + comunicação externa. https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- [O de fornecedor] "Rule of Two" da Meta: no máximo 2 entre entrada não confiável, acesso sensível e mudar estado ou comunicar para fora; com 3, supervisão. [E] "The Attacker Moves Second": ataques adaptativos furaram a maioria de 12 defesas publicadas com mais de 90% de sucesso. Resumo de ambos: https://simonwillison.net/2025/Nov/2/new-prompt-injection-papers/
- [M, autoteste] Anthropic, agente de navegador: injeção deliberada teve 23,6% de sucesso sem mitigações e 11,2% com mitigações no modo autônomo; confirmação para publicar, comprar ou compartilhar dado pessoal. É número de um produto e de um momento. https://claude.com/blog/claude-for-chrome

### No Worki a trifecta aparece naturalmente [O]
- Privado: CPF, telefone, PIX, nascimento, pagamentos.
- Não confiável, escrito por terceiros: nomes, mensagens de chat, título e briefing de turno, avaliações, observações, nome de empresa, certificações.
- Saída: mensagem no chat, convite, SOS, notificação, link `wa.me` e **link ou imagem markdown renderizados na resposta** (exfiltração por URL).

Regras mínimas:
1. Ferramentas não devolvem CPF, PIX, telefone ou nascimento. A tela mostra o dado ao usuário sem passar pelo modelo.
2. A resposta é texto simples: sem imagem e sem URL livre. Links só como componente com rota de lista fechada.
3. Na v1, não enviar chat, avaliação ou briefing ao modelo. Se precisar depois, a sessão fica somente leitura e sem saída.
4. Papel e empresa vêm do JWT no servidor, nunca de argumento do modelo. RLS continua sendo a barreira. O conjunto de ferramentas muda por papel (freela, gestor, encarregado).
5. Antes de ação irreversível ou que atinge terceiros: cartão montado **pelo código** a partir dos argumentos validados (quem, o quê, quando, valor, quantas pessoas avisadas), toque no botão nativo, sem "sim" por texto, sem "sempre permitir", confirmação de uso único presa ao hash dos argumentos e que expira, revalidação de estado, idempotência, `dry_run` quando existir, trilha de auditoria.
6. Confirmação sozinha não basta: gera fadiga. Por isso são poucas ações elegíveis.

Fora do copiloto (nem com confirmação, na v1 a v3): registrar, efetivar, estornar ou confirmar recebimento de pagamento; aceite de Termos ou termo de serviço; bloquear ou remover pessoa; confirmar encarregado ("é ele?"); convite de equipe; excluir conta; trocar PIX ou dados pessoais; SOS; dispensar freela; cancelar turno ou série; avaliar. Contratar ou escolher pessoas por recomendação do modelo também fica fora.

Teste: conjunto de injeção plantada em nome, título e mensagem, rodado a cada mudança de modelo ou prompt. Zero falhas nesse conjunto não prova segurança contra ataque adaptativo.

## 4. LGPD e privacidade (não é parecer jurídico)

- [D] Princípios de finalidade, necessidade e transparência (art. 6), direitos do titular (art. 18), revisão de decisão unicamente automatizada, inclusive de perfil profissional (art. 20), transferência internacional (art. 33), registro (art. 37), relatório de impacto quando a autoridade exigir (art. 38), operador segue instruções (art. 39), segurança (art. 46). https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- [D] Resolução CD/ANPD 19/2024: quando a base são cláusulas-padrão, adotar as da ANPD **sem modificação**; prazo de adequação encerrado em 23/08/2025. https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados · https://www.mayerbrown.com/pt/insights/publications/2025/08/end-of-grace-period-implementation-of-brazils-standard-contractual-clauses-in-international-transfers-of-personal-data
- [D] A única adequação listada pela ANPD é a da UE (Resolução 32/2026). Os EUA não aparecem. Mesma página da ANPD.
- **Lacuna a resolver** [D, via resumo]: o DPA da Anthropic incorpora cláusulas da UE, adendos do Reino Unido e da Suíça, e não menciona LGPD, Brasil nem cláusulas da ANPD. https://www.anthropic.com/legal/data-processing-addendum . Levar a um advogado: qual hipótese do art. 33 vale e se o fornecedor assina as cláusulas da ANPD. Não verifiquei os DPAs de OpenAI e Google quanto ao Brasil. O Supabase como transferência já existente deve entrar na mesma análise.
- [D] Anthropic: não treina com conteúdo de cliente comercial (https://www.anthropic.com/legal/commercial-terms); API apaga entrada e saída em até 30 dias, com exceções; conteúdo sinalizado fica até 2 anos e pontuações até 7 (https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data).
- [D] ZDR depende de aprovação comercial, não cobre tudo, e não apaga a retenção legal ou de conteúdo sinalizado. Modelos Fable e Mythos exigem 30 dias. https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- [D] `inference_geo` só aceita `us` ou `global` (`us` custa 1,1x) e o armazenamento do workspace só `us`. Não há Brasil na API direta. https://platform.claude.com/docs/en/manage-claude/data-residency . Região no Brasil via nuvem parceira não foi verificada.
- [D] Gemini pago: não usa prompts para melhorar produtos, mas registra por período limitado, sem prazo no texto lido; o nível gratuito usa os dados (não usar). https://aistudio.google.com/docs/terms · https://aistudio.google.com/docs/pricing

[O] Medidas: minimização na origem (lista de campos permitidos por ferramenta); IDs opacos e rótulos ("Freela A") com o nome resolvido só na tela; filtro de CPF, telefone, e-mail e chave PIX no texto digitado (pseudonimizar não é anonimizar, o dado continua pessoal); dado de saúde nunca; aviso na primeira abertura e atualização da política de privacidade com o novo suboperador e o país; retenção própria curta dos transcritos, incluída no `anonymize_account`; sem transcrito bruto no Sentry; avaliar relatório de impacto; ordem de freelas continua sendo do código, não do modelo.

## 5. Custo

### Preços por milhão de tokens (US$), oficiais, consultados em 25/11/2026

| Modelo | Entrada | Escrita cache 5 min | Leitura cache | Saída |
|---|---|---|---|---|
| Claude Haiku 5.5 (prompt até 100 mil) | 0,10 | 0,125 | 0,01 | 0,50 |
| Claude Sonnet 5.5 | 2 | 2,50 | 0,10 | 10 |
| Claude Opus 5.5 | 4 | 5 | 0,20 | 20 |
| gpt-6-luna (até 272 mil) | 0,10 | assumido 0,10 | 0,01 | 0,50 |
| Gemini 3.8 Flash até 31/12/2026 | 0,75 | assumido 0,75 | 0,075 | 3,75 |
| Gemini 3.8 Flash a partir de 2027 | 1,50 | assumido 1,50 | 0,15 | 7,50 |

Fontes: https://platform.claude.com/docs/en/about-claude/pricing (conferida com a tabela da skill `claude-api`) · https://developers.openai.com/api/docs/pricing · https://aistudio.google.com/docs/pricing (Gemini também cobra armazenamento de cache, ignorado aqui).

### Premissas (todas são suposições, nada foi medido)
- **8 conversas por usuário ativo por mês**: 400 (50 usuários) e 4.000 (500).
- Cache frio no início de cada conversa (pouco volume), TTL de 5 min; pausas maiores aumentam o custo.
- **Ferramentas, base**: prefixo de 7.600 tokens (instruções, base de ajuda curta, cerca de 15 ferramentas, mais 286 de sistema de ferramentas); 4 chamadas; histórico cresce 800 por chamada; 300 de saída por chamada. Total: 35,2 mil de entrada e 1,2 mil de saída.
- **DOM, base**: 3.300 fixos em cache; 10 chamadas; 8.000 de tela por chamada, sem cache; histórico resumido de mais 300 por passo; só a tela atual é enviada (hipótese favorável ao DOM); 300 de saída. Total: 126,5 mil de entrada e 3 mil de saída. Sem imagens e sem novas tentativas.
- Faixa baixa: ferramentas 3 chamadas, 6.000 de prefixo, +500, 200 de saída; DOM 6 passos, 4.000 por tela. Faixa alta: ferramentas 8 chamadas, 10.000, +1.500, 700 de saída; DOM 16 passos, 20.000 por tela, 700 de saída.
- Saída inclui raciocínio. Mesmo número de tokens entre fornecedores (falso na prática: medir com contagem de tokens em pt-BR).

### Cenário base (US$)

| Modelo | Abordagem | Por conversa | 50 usuários/mês | 500 usuários/mês |
|---|---|---|---|---|
| Haiku 5.5 | ferramentas | 0,0021 | 0,84 | 8,41 |
| Haiku 5.5 | DOM | 0,0116 | 4,62 | 46,24 |
| Sonnet 5.5 | ferramentas | 0,040 | 15,81 | 158 |
| Sonnet 5.5 | DOM | 0,228 | 91,29 | 913 |
| Opus 5.5 | ferramentas | 0,079 | 31,62 | 316 |
| Opus 5.5 | DOM | 0,456 | 183 | 1.826 |
| gpt-6-luna | ferramentas | 0,0019 | 0,74 | 7,41 |
| gpt-6-luna | DOM | 0,0115 | 4,59 | 45,91 |
| Gemini 3.8 Flash 2026 | ferramentas | 0,014 | 5,56 | 55,56 |
| Gemini 3.8 Flash 2026 | DOM | 0,086 | 34,43 | 344 |
| Gemini 3.8 Flash 2027 | ferramentas | 0,028 | 11,11 | 111 |
| Gemini 3.8 Flash 2027 | DOM | 0,172 | 68,86 | 689 |

### Faixa para 500 usuários (US$/mês, baixa a alta)

| Modelo | Ferramentas | DOM |
|---|---|---|
| Haiku 5.5 | 5 a 26 | 16 a 168 |
| Sonnet 5.5 | 99 a 470 | 316 a 3.349 |
| Opus 5.5 | 198 a 939 | 631 a 6.698 |

Para 50 usuários, dividir por 10. DOM sai de 3 a 7 vezes mais caro, e a razão **depende das premissas** (sobretudo tamanho da tela e número de passos). Em reais, a um câmbio **suposto** de R$ 5,50 e sem IOF e impostos: Haiku com ferramentas, 500 usuários, cerca de R$ 46/mês; Sonnet, cerca de R$ 870.

[O] O token não deve decidir o projeto. O custo relevante é construir, avaliar, manter o catálogo e a base de ajuda, o jurídico e o suporte aos erros do próprio assistente. Escolher modelo por avaliação própria com 50 a 100 pedidos reais em pt-BR, medindo custo por **tarefa resolvida**. Começar testando um modelo pequeno e subir só se reprovar. Mais chamadas também significam mais espera; não medi latência.

## 6. Redução de suporte: casos com métrica honesta

- [E] Brynjolfsson, Li e Raymond, 5.172 atendentes: IA **ajudando humanos** aumentou em 15% os casos resolvidos por hora. Não mede autoatendimento. https://arxiv.org/abs/2304.11771
- [E, outro contexto] Ensaio de campo com bot de suporte interno (arXiv 2401.10956): 9,2 pontos a menos de escalonamento do que um bot de fluxo. Escalonar menos não prova resolver. https://arxiv.org/pdf/2401.10956
- [M] Klarna, 02/2024: 2,3 milhões de conversas no primeiro mês, dois terços do volume, 25% menos recontato; sem método nem verificação independente. https://www.klarna.com/international/press/klarna-ai-assistant-handles-two-thirds-of-customer-service-chats-in-its-first-month/
- [Imprensa] Em 2025 a empresa voltou a contratar humanos, citando qualidade, e segue usando IA no volume simples. https://www.forbes.com/sites/quickerbettertech/2025/05/18/business-tech-news-klarna-reverses-on-ai-says-customers-like-talking-to-people/ (não consegui abrir a página; apoio no trecho da busca).
- [D/M] Intercom Fin conta "resolução presumida" quando a pessoa sai sem pedir mais ajuda (e cobra; desfaz se voltar à mesma conversa). Quem desistiu pode entrar na conta. https://www.intercom.com/help/en/articles/8205718-fin-ai-agent-outcomes
- [E, pesquisa de percepção] Gartner, 5.728 clientes: só 14% dos problemas se resolvem por completo no autoatendimento (36% dos simples); falha comum: não achar conteúdo relevante. Lido pelo trecho da busca (a página devolveu 403). https://www.gartner.com/en/newsroom/press-releases/2024-08-19-gartner-survey-finds-only-14-percent-of-customer-service-issues-are-fully-resolved-in-self-service
- [Jurisprudência canadense, não vinculante aqui] Moffatt v. Air Canada: a empresa respondeu por informação errada do chatbot. https://www.americanbar.org/groups/business%5Flaw/resources/business-law-today/2024-february/bc-tribunal-confirms-companies-remain-liable-information-provided-ai-chatbot/
- Não encontrei estudo independente de redução de suporte por copiloto em SaaS pequeno.

## 7. Recomendação em fases [O]

Os limiares abaixo são propostas minhas, para o dono ajustar antes de começar.

**Fase 0, 3 a 4 semanas: diagnosticar.** Registrar todo contato (WhatsApp inclusive): data, papel, tela, motivo, minutos, causa (bug, interface confusa, dúvida de regra, pedido de operação, problema entre pessoas). Instrumentar o funil das 5 a 8 tarefas principais. Testar com 5 pessoas por papel no celular. Corrigir as maiores causas. Porta: se o volume for baixo (por exemplo, menos de 30 contatos por mês ou 3 h/mês) ou a maioria for bug ou disputa, não construir LLM.

**Fase 1: ajuda sem LLM.** Estados vazios que ensinam, checklist curto que se marca pelo estado real do banco, "Como faço isso?" por tela com 3 ou 4 perguntas, destaque de 1 a 3 passos iniciado pelo usuário (driver.js), busca na /ajuda, mensagens de erro com próximo passo, "falar com uma pessoa" com contexto sem dados sensíveis. É também a base de conhecimento e as âncoras da fase 2. Reavaliar após 4 semanas.

**Fase 2: copiloto somente leitura.** Responde com base na ajuda curada ("não sei" é válido), 5 a 8 ferramentas de leitura sem PII, navega e destaca, passa para humano em um toque. Sem nenhuma escrita. Antes: ADR, jurídico (transferência), revisão de segurança, conjunto de avaliação. Liberar para poucos pilotos.

**Fase 3: preparar.** 2 ou 3 ferramentas que preenchem um formulário (ex.: rascunho de turno). A pessoa revisa e toca o botão **da própria tela**. É o melhor ponto de parada.

**Fase 4, só com demanda medida: executar** poucas ações reversíveis e sem efeito em terceiros (ex.: salvar rascunho, criar lista, disponibilidade própria), com o cartão da seção 3. Ação que notifica terceiros não é reversível.

### O que não fazer
Agente de clique em produção; chave de LLM no navegador; `service_role` na ferramenta; ferramenta genérica (SQL, "chamar API", clicar por seletor); mandar DOM, tabelas ou transcritos com PII; tour longo no primeiro acesso; abrir sozinho; esconder o humano; deixar o modelo explicar regra de pagamento, vínculo ou termo fora de texto aprovado; prometer redução de atendimento antes de medir; usar conclusão de tour ou "conversa sem escalonamento" como sucesso; fine-tuning, multiagente ou voz agora; WebMCP agora.

## 8. Como medir

- **Principal:** contatos humanos por 100 usuários ativos por semana e minutos de atendimento, por motivo e papel, contra a linha de base da fase 0.
- **Resolução verificada:** evento esperado no banco aconteceu (quando é tarefa) **e** não houve contato humano nem nova pergunta do mesmo tema em 7 dias. Um estudo de campo no Alibaba usa recontato em 3 dias como proxy (visto só no trecho da busca; não confirmei em qual dos artigos do grupo está a métrica, candidato: https://www.researchgate.net/publication/385700506). Para dúvida sem evento, revisão humana por amostra. "Saiu da conversa" e polegar não contam sozinhos; abandono é reportado separado.
- **Produto:** conclusão e tempo de cada tarefa principal; ativação de empresa e freela.
- **Qualidade:** revisão semanal de 100% das conversas no piloto (com acesso restrito e minimizado); taxa de resposta errada; toques para chegar ao humano.
- **Portões:** zero escrita sem confirmação válida; zero vazamento entre papéis ou empresas; zero PII proibida nas amostras do payload.
- **Antes de liberar execução:** avaliação repetida (pass^k). Regra de três: 0 erro em n execuções independentes dá limite superior de cerca de 3/n com 95%; para sustentar menos de 1% são cerca de 300 execuções sem erro grave, representativas.
- **Operação:** custo por tarefa resolvida, latência p50 e p95 em 4G.
- **Causalidade:** com poucos usuários, A/B não terá poder. Liberar em ondas por empresa, comparar com quem ainda não recebeu, anotar lançamentos, correções e sazonalidade. Separar o efeito das correções de UX do efeito do copiloto.
- **Critério de desistência** (definir antes): após 6 a 8 semanas, desligar se a queda nos contatos não superar o tempo gasto em manter e revisar, ou se as respostas erradas passarem do limite combinado.
