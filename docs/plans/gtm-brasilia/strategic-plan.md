# Plano Estratégico: Go-to-Market Brasília-DF

## Data: 2026-04-02

## Contexto

MVP do Worki 100% funcional (28+ páginas, pagamentos Asaas, escrow, messaging, reviews, analytics). Zero usuários reais. Site em staging. CEO é 1 pessoa (dev + vendedor + suporte). Budget ~R$2.000/mês. Sem cliente âncora confirmado. Cold-start puro.

Worki é um marketplace de freelancers físicos (garçom, barman, cozinheiro, atendente) com foco em Brasília-DF, Plano Piloto. Modelo de receita: taxa progressiva 3%→6%→10%→13%.

## Decisões Estratégicas

### 1. Cidade e Vertical
- **Decisão:** Brasília-DF, Plano Piloto. Freelancers físicos para bares e restaurantes.
- **Dados:** DF tem 10.000+ bares/restaurantes (ABRASEL-DF). Plano Piloto concentra ~4.000-5.000. Turnover no setor: 74,3% (ANR/CAGED 2024). Renda per capita do DF é a maior do Brasil: R$3.276/mês (IBGE 2024). Diária de garçom freelancer em BSB: R$130-250.
- **Cases:** iFood começou em 1 cidade (Campinas). Cacau Show saturou SP antes de expandir. GigPro nasceu em Charleston antes de ir pra 28 cidades.
- **Riscos:** BSB pode não ter massa crítica de freelancers. Mercado menor que SP.
- **Confidence:** ALTA

### 2. Estratégia: Demand-First com Supply Just-in-Time
- **Decisão:** Ir primeiro em restaurantes validar a dor. Fechar 3-5 betas. Recrutar workers PRA vagas específicas que já existem.
- **Dados:** 80% dos marketplaces focam supply-first (Lenny Rachitsky), mas TaskRabbit quase morreu com supply ocioso. Supply-first SEM demand garantida gera churn em 7 dias.
- **Cases:** DoorDash: fundadores eram o supply no dia 1. GigPro: fundador era chef, conhecia o mercado de dentro. Urban Company: começou com 1 post no Facebook, matchmaking manual.
- **Riscos:** Ciclo de vendas B2B pode ser >14 dias. Restaurantes podem não querer usar app.
- **Confidence:** ALTA (convergência de YC Advisor + Growth Analyst)

### 3. Taxa Progressiva
- **Decisão:** 3% (mês 1) → 6% (mês 2) → 10% (mês 3) → 13% (mês 4+). Em vez de taxa zero → 13% abrupto.
- **Dados:** Homejoy (YC W13) morreu por dependência de descontos — quando preço normalizou, churn massivo. Paul Graham: "Charge from day one."
- **Cases:** Homejoy shutdown 2015 (TechCrunch). GetNinjas receita -11% YoY com modelo de lead pago.
- **Riscos:** 3% pode não ser suficiente pra validar willingness-to-pay.
- **Confidence:** MÉDIA

### 4. Sem cliente âncora
- **Decisão:** Não depender do amigo com 6 lojas. Ir do zero com cold outreach.
- **Dados:** N/A — decisão do CEO por indisponibilidade do parceiro.
- **Riscos:** Cold start é significativamente mais difícil sem âncora. Validação depende 100% de outbound.
- **Confidence:** MÉDIA

### 5. Referral simples, não MLM
- **Decisão:** R$20-30 fixo por worker indicado que completa 1° job. One-time. Só após 20 jobs completos.
- **Dados:** Uber: bônus fixo US$100-1.500, ROI 12x. Airbnb: US$25 one-time. Nenhum marketplace de sucesso usa royalty perpétuo. Risco legal de pirâmide (Lei 1.521/51).
- **Confidence:** ALTA

### 6. Concorrência: janela aberta
- **Decisão:** Switch App (principal concorrente em gig hospitality BR) NÃO opera em Brasília. Janela de oportunidade confirmada.
- **Dados:** switchapp.com.br — opera em SP, BH, RJ, Vitória. Sem BSB. [DADO VERIFICADO: abril 2026]
- **Riscos:** Janela pode fechar a qualquer momento.
- **Confidence:** ALTA

## KPIs para medir sucesso (Dia 14)

| KPI | Meta | Como medir |
|-----|------|-----------|
| Restaurantes que validam a dor | >10 de 20 abordados | Contagem nas visitas |
| Empresas beta fechadas | 3-5 | Cadastradas e com vaga postada |
| Workers cadastrados (perfil completo) | 15-20 | Query no banco |
| Jobs completos (pagamento processado) | 1-3 | wallet_transactions |
| Fill rate | >50% | Jobs preenchidos / postados |
| Feedback coletado | 5+ conversas | Calls realizados |

## Riscos e Mitigações

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| Nenhum restaurante quer usar | Média | Fatal | Pivotar pra eventos/buffets |
| Workers não completam perfil | Alta | Alto | Onboarding manual 1:1 |
| Primeira vaga não preenche | Média | Alto | Match manual via WhatsApp |
| Desintermediação (WhatsApp direto) | Alta | Alto | Escrow + rating como lock-in |
| Switch chega em BSB | Baixa | Fatal | Correr — janela existe hoje |
| Regulatório (CLT/MEI) | Baixa | Alto | Posicionar como "plataforma de conexão" |

## Próximos Passos

1. Salvar plano estratégico ✅
2. Sessão tática: transformar este plano em ações detalhadas com agentes, tools, KPIs operacionais
3. Build: criar infraestrutura operacional conforme action plan

## Dados de Suporte

### Fontes da Roundtable
- ABRASEL-DF: 10.000+ bares/restaurantes no DF (ago/2024)
- ANR/CAGED: turnover 74,3% no food service (1° sem 2024)
- IBGE PNAD 2024: renda per capita DF R$3.276/mês
- Switch App: switchapp.com.br — sem operação em BSB
- Lenny Rachitsky: "How to kickstart and scale a marketplace" (lennysnewsletter.com)
- Andrew Chen: "The Cold Start Problem" (a16z)
- Paul Graham: "Do Things That Don't Scale" (paulgraham.com)
- TaskRabbit pivot 2014: crescimento 400% após mudar de passivo pra instant booking (SaaStr, TechCrunch)
- GigPro: nasceu em Charleston, 28 cidades, $16M funding (Post and Courier)
- Homejoy: morreu por dependência de descontos (TechCrunch 2015)
- Instawork (YC S15): marketplace hospitality staffing, $149M funding, 7M+ workers (Contrary Research)
- GetNinjas: receita -11% YoY Q3 2024, EBITDA -R$3,6M (Rio Times)
- Uber referral: bônus one-time US$100-1.500, descontinuado 2020, ROI 12x (Viral Loops)
- Airbnb referral: US$25 one-time, +300% bookings (GrowSurf)
