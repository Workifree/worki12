# Pesquisa de canais para avisar o freela de um turno

Data da consulta: **26/11/2026** (todas as fontes abaixo foram acessadas nessa data).
Marcas: **[OFICIAL]** = fonte do dono do serviço, lida nesta pesquisa. **[SECUNDÁRIO]** = blog ou resumo de busca.
**[NÃO CONFIRMADO]** = não achei fonte que sustente. **[INFERÊNCIA]** = avaliação minha.
Limite do método: as páginas foram lidas por um extrator que resume. As tarifas da Meta e o texto da cobrança foram conferidos no arquivo baixado. Revalide os pontos críticos antes de contratar.

## 0. Conclusão curta
1. O WhatsApp oficial não tem mensalidade documentada e custa pouco se o template for utility: R$ 0,035 por mensagem. Como marketing, custa R$ 0,3217, 9,2 vezes mais.
2. A categoria do "convite de turno" **não está confirmada**. Orçar pelo pior caso e submeter o template para teste.
3. Usar o mesmo número do app WhatsApp Business (coexistência) exige, pela documentação, Solution Partner ou Tech Provider. Direto e sem BSP, o plano seguro é um número dedicado.
4. Web Push não tem tarifa, mas no iPhone só funciona com o app instalado na tela de início.
5. E-mail: o Resend grátis cobre o volume mensal. O gargalo é o teto de 100/dia. Sem domínio próprio verificado, não envia para freelas.

## 1. WhatsApp Business Platform (Cloud API direto com a Meta)

### 1.1 Modelo de cobrança vigente [OFICIAL]
Fonte: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Cobrança **por mensagem entregue**, conforme a categoria e o país do destinatário. Vale desde 01/07/2025. Mensagens enviadas pelo usuário são grátis.
- **Desde 01/10/2026** (já em vigor):
  - utility dentro da janela de 24h **passou a ser cobrada**;
  - service (texto livre na janela) **voltou a ser cobrada** a partir da 1.001ª mensagem entregue no mês, por número. As 1.000 grátis não acumulam;
  - sem meio de pagamento no Billing Hub, o service acima da franquia não é entregue.
- Muito material na internet, inclusive a página comercial https://whatsappbusiness.com/pt-br/products/platform-pricing/ (que diz que service e utility em resposta ao usuário não são cobrados), **contradiz a documentação de desenvolvedor**. Considerei a documentação, que traz a data da mudança.
- A Meta só altera preços no primeiro dia de um trimestre.

### 1.2 Preço para destinatário no Brasil [OFICIAL]
Rate cards "effective October 1, 2026" (planilhas BRL e USD baixadas da página de preços, seção "Rate cards and volume tiers"; os links de download são temporários).

| Categoria | USD | BRL |
|---|---|---|
| Marketing | 0,0625 | 0,3217 |
| Utility | 0,0068 | 0,0350 |
| Authentication | 0,0068 | 0,0350 |
| Authentication-international | n/a | n/a |
| Service (acima de 1.000/mês por número) | 0,0068 | 0,0350 |

- Faixas de volume (só utility e authentication): no Brasil, o preço de lista vale até 250.000 utility/mês. É irrelevante para o Worki.
- A planilha também lista "Meta Business Agent" (cobrado por token). Não se aplica.
- Moeda: contas com país de faturamento Brasil podem criar conta em BRL desde 01/07/2026 (todas as elegíveis desde 16/07/2026), com fatura da Facebook Brasil. A migração para BRL é obrigatória até 30/06/2027. A moeda é escolhida na criação da conta. **Criar já em BRL.** [OFICIAL]
- Impostos sobre a fatura e bandeiras ou cartões aceitos: **[NÃO CONFIRMADO]**. Há um meio de pagamento cadastrado no Billing Hub (https://business.facebook.com/latest/billing_hub/).
- Mensalidade: **não há nenhuma mencionada** na documentação de preços. Servidor, número e chip são custos à parte.

### 1.3 O que é grátis [OFICIAL, mesma página]
- Até 1.000 mensagens service entregues por número/mês.
- **Ponto de entrada gratuito:** o usuário chama por anúncio click-to-WhatsApp (app Android ou iOS) e a empresa responde dentro da janela. Abre-se uma janela de até **7 dias** com marketing, utility, authentication e service grátis. A página comercial ainda fala em 72h (divergência).
- A janela de 24h abre ou renova quando o usuário escreve ou liga. Ela **libera** texto livre, mas **não torna a utility grátis**.
- Fora da janela, só template aprovado.

### 1.4 Categoria de "você recebeu um convite de turno"
Fonte [OFICIAL]: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
- Utility exige conteúdo **sem intenção promocional ou persuasiva** e que seja específico ou pedido pelo usuário, ou essencial/crítico para ele.
- Conteúdo misto ou pouco claro vira marketing. O exemplo de convite para evento ("clique para participar") aparece como marketing.
- **Não há exemplo oficial de convite de turno ou oferta de trabalho. [NÃO CONFIRMADO]**
- [INFERÊNCIA] Convite direto e individual a quem aceitou entrar no Elenco tem argumento para utility. Disparo 1 para N ("vaga aberta, o primeiro que aceitar leva") e SOS fora do elenco têm **risco alto de marketing**. Um guia [SECUNDÁRIO] trata anúncio de vaga como marketing: https://www.ycloud.com/blog/whatsapp-api-message-template-guide
- [INFERÊNCIA] Texto a testar, factual e sem apelo: "{empresa} convidou você para o turno {função} em {data}, {hora}, {local}. Responda no Worki." Evitar valor em destaque, urgência, emoji e "não perca".
- Reclassificação: em regra há aviso 1 dia antes. Quem já recebeu alerta de mau uso é reclassificado na hora, sem aviso. A contestação é pelo WhatsApp Manager (prazo de 60 dias). Ler a categoria pela API ou webhook, não pelo que foi submetido.
- Marketing tem **limite por usuário** (somando todas as empresas): a entrega pode falhar com o erro 131049. Esperar 24h antes de repetir. https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits [OFICIAL]

### 1.5 Requisitos
- **Para começar:** conta de desenvolvedor, app Meta com o caso de uso WhatsApp, portfólio empresarial, conta de mensagens (WABA), número, token de usuário de sistema e webhook. https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started [OFICIAL]
- **Verificação de empresa:** pela página de limites, não é pré-requisito para começar. É um dos caminhos para sair de 250 e chegar a 2.000. https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits [OFICIAL]
- **Limites:** portfólio novo começa em **250 destinatários únicos** fora da janela, em 24h móveis, por portfólio. Sobe para 2.000 com verificação da empresa ou com 2.000 mensagens entregues a números únicos em 30 dias com boa qualidade. Depois vai a 10 mil, 100 mil e ilimitado, subindo um nível quando se usa ao menos metade do limite em 7 dias com qualidade alta. A Meta pode negar. [OFICIAL]
- **Número:** próprio, capaz de receber SMS ou ligação; verificação por código e PIN de duas etapas. Um número já em uso no WhatsApp não pode ser registrado sem antes ser apagado. Exige nome de exibição, que passa por análise. https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers e https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names [OFICIAL]
- **Coexistência** (app Business e API no mesmo número): existe, com app 2.24.17 ou superior, throughput fixo de 20 msg/s, listas de transmissão desativadas e grupos sem sincronização. Mensagens enviadas pelo app seguem grátis. **A documentação exige Solution Partner ou Tech Provider.** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users [OFICIAL]. A página não lista países. Disponibilidade no Brasil: só [SECUNDÁRIO] (https://chakrahq.com/product/whatsapp/tools/whatsapp-coexistence-support/). Se o Worki pode virar Tech Provider só para o próprio número, e com que esforço: **[NÃO CONFIRMADO]**.
- **Aprovação de template:** análise automática na criação ou edição; o status "em análise" pode levar até 24h. Sem verificação, até 250 templates; verificado e com nome aprovado, até 6.000. https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview [OFICIAL]
- **Qualidade:** feedback negativo ou baixa leitura leva o template a pausa ou desativação. Utility só sofre "pacing" nos 7 dias depois de uma utility pausada; mensagens retidas podem ser descartadas (erro 132015). https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pacing [OFICIAL]
- **Opt-in obrigatório:** a pessoa deu o número e consentiu em receber mensagens **daquele negócio**, identificado pelo nome. Pode ser geral (não específico de WhatsApp), respeitada a lei local. O método é livre (site, SMS, presencial). Honrar todo pedido de parar. A Meta recomenda opt-in por categoria. https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in e https://whatsappbusiness.com/policy/ [OFICIAL]. [INFERÊNCIA] O opt-in deve nomear o Worki como remetente, que age em nome das empresas. Aceitar os Termos não basta como boa prática: usar caixa própria e desmarcada, com registro de data e versão.
- **Automação:** para quem automatiza respostas, a política exige um caminho claro de escalonamento para humano ou suporte. [OFICIAL] Emprego e intermediação de trabalho não aparecem no resumo obtido das verticais proibidas; **ler a política na íntegra antes de lançar**.
- **Webhooks** [OFICIAL] https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview: app em modo Live; permissões `whatsapp_business_messaging` (mensagens e status) e `whatsapp_business_management` (os demais). Sem resposta 200, a Meta repete por até 7 dias, então o consumidor precisa ser idempotente. O status traz entrega, leitura e o objeto `pricing`. A validação da assinatura `X-Hub-Signature-256` é conhecimento prévio, não conferido nesta pesquisa. Numa Edge Function, o deploy é com `--no-verify-jwt`.

### 1.6 Alternativas não oficiais (apenas registro; NÃO usar)
Baileys, whatsapp-web.js e Evolution API em modo não oficial.
- Os Termos do WhatsApp vedam engenharia reversa, acesso automatizado não autorizado e envio em massa ou automático, com risco de suspensão ou desativação da conta. https://www.whatsapp.com/legal/terms-of-service [OFICIAL]
- O Baileys declara não ter afiliação nem endosso do WhatsApp. https://github.com/WhiskeySockets/Baileys
- Riscos: banimento do número (inclusive o comercial), quebra a cada mudança de protocolo, nenhum suporte e sessão sensível guardada em servidor próprio. Não medi a taxa de banimento. **Não recomendado.**

## 2. E-mail

### 2.1 Resend [OFICIAL]
- https://resend.com/pricing: grátis com **3.000/mês, 100/dia, 3 domínios**. Pro por **US$ 20/mês com 50 mil** (US$ 35 com 100 mil), sem limite diário, 10 domínios, excedente de US$ 0,90 por mil (precisa ser ativado).
- https://resend.com/docs/dashboard/domains/introduction: é preciso verificar ao menos um domínio próprio.
- https://resend.com/docs/knowledge-base/403-error-resend-dev-domain: **sem domínio**, só se envia de `resend.dev` **para o e-mail da própria conta**. Qualquer outro destinatário recebe 403. `worki-opal.vercel.app` não serve, porque o DNS não é do Worki. [a última frase é INFERÊNCIA]
- DNS: publicar os registros SPF e DKIM que o painel gerar e acrescentar DMARC (começar com `p=none`). Os valores exatos vêm do painel; a página consultada só menciona o DMARC como passo adicional.
- Descadastro: o Resend não gerencia lista para transacional. Enviar o cabeçalho `List-Unsubscribe`; para envio em massa, também `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), com endpoint que aceite POST e GET e processe em até 48h. https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails
- Gmail (https://support.google.com/a/answer/81126): todos precisam de SPF **ou** DKIM, DNS reverso, TLS e spam abaixo de 0,3%. A partir de 5 mil/dia: SPF, DKIM, DMARC alinhado e descadastro em um clique (marketing e assinaturas).
- [INFERÊNCIA] Se o mesmo Resend for o SMTP do Supabase Auth (códigos OTP, usados no convite de equipe), a cota de 100/dia é dividida. Um chamado 1 para N pode atrasar logins. O código atual não foi verificado nesta pesquisa.

### 2.2 Alternativas
| Serviço | Grátis | Pago de entrada | Observação |
|---|---|---|---|
| Brevo | 300/dia [OFICIAL do dono, via resumo de busca] | cerca de US$ 9/mês, a partir de 5 mil (há também €7) | https://www.brevo.com/products/transactional-email/ ; a página de preços não pôde ser lida; regras de domínio [NÃO CONFIRMADO] |
| MailerSend | **500/mês**, 100 requisições de API/dia, 1 domínio, pede cartão | US$ 7/mês (US$ 5,60 no anual) | https://www.mailersend.com/pricing [OFICIAL]; não cobre 1.000/mês |
| Amazon SES (referência) | créditos de até US$ 200 para conta nova, por tempo limitado | US$ 0,10 por mil (à la carte) | https://aws.amazon.com/ses/pricing/ [OFICIAL]; exige mais operação |

### 2.3 Domínio .com.br
**R$ 40,00 por ano**, no registro e na renovação. Fonte [OFICIAL]: metadado das páginas https://registro.br/dominio/valores/ e https://registro.br/ajuda/pagamento-de-dominio/ ("Registro de domínio por R$ 40,00 por ano"). Plurianual de até R$ 364 por 10 anos: só no resumo de busca.

## 3. Web Push (PWA)
- **Custo:** o padrão não cobra por mensagem e não encontrei tabela de preço dos serviços de push. R$ 0 fora do servidor próprio. [INFERÊNCIA] A Apple declara que não é preciso ser membro do Apple Developer Program. [OFICIAL] https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- **iOS/iPadOS:** versão **16.4 ou superior**, site **adicionado à tela de início**, manifest com `display: standalone` ou `fullscreen`, e permissão pedida após um toque do usuário. Liberar `*.push.apple.com` se houver filtro de saída. Aba comum do Safari no iPhone não recebe. [OFICIAL]
- **Declarative Web Push** a partir do iOS 18.4 evita perder a inscrição por falha do service worker. No push clássico, não exibir a notificação pode revogar a inscrição. https://webkit.org/blog/16535/meet-declarative-web-push/ [OFICIAL]
- **Android/Chrome:** funciona sem instalar. O Android acorda o Chrome e o service worker mesmo com o app fechado; no desktop, o navegador precisa estar rodando. https://web.dev/articles/push-notifications-faq [OFICIAL]
- **Chrome revoga permissão** de sites com muito pouco engajamento e alto volume (Android e desktop; anúncio de 10/10/2025). **Apps web instalados ficam de fora.** https://blog.google/chromium/automatic-notification-permission/ [OFICIAL]
- **VAPID:** gerar um par de chaves próprio. A pública vai em `applicationServerKey`; a privada fica só no servidor (secret da Edge Function). TTL de até 28 dias e cabeçalho `Urgency`; o token VAPID dura no máximo 24h. [SECUNDÁRIO, RFC 8030/8292 não lidas]. Para convite, o TTL não deve passar do início do turno.
- **Limitações:** não há garantia de entrega nem confirmação de leitura (201 significa aceito pelo serviço de push, não entregue). A pessoa pode negar ou bloquear, trocar de aparelho ou limpar os dados. Tratar 404/410 apagando a inscrição. O efeito de economia de bateria de cada fabricante Android é **[NÃO CONFIRMADO]**. Medir pelo clique ou pela resposta ao convite e ter um canal de reserva.

## 4. Custo mensal estimado
**Premissas:** 1 convite = 1 destinatário = 1 mensagem entregue (um chamado para 8 pessoas conta 8); sem lembretes, reenvios, OTP ou respostas; destinatário +55; conta em BRL; sem BSP, sem impostos adicionais (não confirmados), sem desenvolvimento, servidor ou chip; Supabase dentro do plano atual (não verificado). USD vem do rate card em USD, sem conversão cambial minha.

| Canal | 50/mês | 200/mês | 1.000/mês |
|---|---|---|---|
| WhatsApp utility | R$ 1,75 (US$ 0,34) | R$ 7,00 (US$ 1,36) | R$ 35,00 (US$ 6,80) |
| WhatsApp marketing (pior caso) | R$ 16,09 (US$ 3,13) | R$ 64,34 (US$ 12,50) | R$ 321,70 (US$ 62,50) |
| E-mail Resend grátis | R$ 0 | R$ 0 se ≤100/dia | R$ 0 se ≤100/dia, senão Pro US$ 20 |
| Domínio .com.br (rateado) | R$ 3,33 | R$ 3,33 | R$ 3,33 |
| Web Push | R$ 0 | R$ 0 | R$ 0 |

- Cada lembrete por template soma outro tanto igual.
- Respostas em texto livre do Worki: R$ 0 até 1.000/mês por número.
- 250 destinatários únicos em 24h comportam esses volumes, salvo rajada com mais de 250 pessoas diferentes num dia.
- O `wa.me` manual que já existe continua sem tarifa de API, mas depende de alguém clicar.

## 5. LGPD, consentimento, frequência e horário
Fonte da lei [OFICIAL]: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm (lidos os primeiros 100 mil de 125 mil caracteres). Isto não é parecer jurídico.
- Bases do art. 7º: consentimento (I), execução de contrato ou procedimentos preliminares a pedido do titular (V), legítimo interesse (IX, não prevalece sobre direitos do titular).
- Art. 6º: finalidade informada, necessidade (mínimo de dados), transparência e prestação de contas. Art. 8º §5º: consentimento revogável a qualquer momento. Art. 18: acesso, correção e revogação.
- [INFERÊNCIA] O aviso de convite a quem entrou no Elenco pode se apoiar no inciso V ou IX. Para WhatsApp, a **política da Meta exige opt-in de qualquer forma**. SOS fora do elenco precisa de consentimento explícito (o `discoverable_for_sos` atual não equivale a opt-in de canal).
- [INFERÊNCIA] Práticas recomendadas:
  - preferência por canal, desligável no app e no próprio aviso (link no e-mail; "PARAR" ou botão no WhatsApp, processado pelo webhook);
  - registro de data, origem e versão do texto do opt-in;
  - mínimo de dados na mensagem e na tela bloqueada: sem CPF, PIX ou dado de saúde; avaliar se o valor precisa aparecer;
  - Meta, Resend e serviços de push como operadores na Política de Privacidade, com transferência internacional informada; exclusão incluída no fluxo de anonimização;
  - um canal principal e reserva só se não houver resposta; deduplicar por convite; nada de aviso de turno já preenchido;
  - silêncio entre 21h e 8h (America/Sao_Paulo), com exceção opt-in para turno urgente;
  - teto inicial de cerca de 3 avisos de oferta por dia por freela, agrupando os excedentes.
- **Horário e frequência legais para essas mensagens: [NÃO CONFIRMADO].** Não achei regra da LGPD ou da ANPD (fiz uma única busca; não é prova de que não exista). Os horários de autorregulação de telemarketing achados são [SECUNDÁRIO], divergem entre si e tratam de ligação comercial. Os valores acima são escolha de produto.

## 6. Pendências antes de implementar
1. Submeter o template de convite individual e o de chamado 1 para N e registrar a categoria que a Meta atribuir.
2. Decidir: número dedicado ou coexistência (via Tech Provider).
3. No Billing Hub: conta em BRL, meio de pagamento aceito e tratamento de impostos.
4. Ler a Business Messaging Policy na íntegra, inclusive para intermediação de trabalho.
5. Comprar o domínio e verificar SPF, DKIM e DMARC; checar se o SMTP do Auth divide a cota.
6. [INFERÊNCIA] Ordem sugerida: Web Push e e-mail primeiro; WhatsApp oficial depois dos passos 1 a 3, ou em paralelo se a verificação demorar.
