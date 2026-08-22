# Selos das Empresas — Guia do Freela

## O que são Selos

Um **selo** é um certificado visual no seu perfil que mostra: "Eu já trabalhei com esta empresa e concluí um turno."

Cada empresa onde você completou um turno ganha um selo. O selo exibe:
- **Logo/nome da empresa**
- **Quantos turnos você fez com ela** (ex: "5 turnos")
- **A nota que ela te deu** (ex: "4.8 ★"), ou "Sem avaliação" se ela nunca te avaliou

Os selos aparecem em uma seção chamada **"Já trabalhou com"** no seu perfil.

---

## Onde Aparecem Selos

### Seu Perfil (Você Gerencia)

Na tela **Meu Perfil** (`/profile`), role para baixo até a seção **"Já trabalhou com"**.

Aqui você vê:
- Todos os selos que tem (inclusive os que está escondendo)
- Um **botão de olho** em cada selo (aberto = visível, fechado = oculto)
- Um **switch de chave-mestra** no topo que esconde a seção **inteira** para qualquer um

### Perfil que Empresa Vê

Quando uma empresa com vínculo ativo olha seu perfil (rota `/company/worker/:seu-id`), ela vê:
- Os selos que você **deixou visíveis**
- Nunca vê selos que você ocultou
- Se você ligou a chave-mestra, a seção inteira desaparece (ela não vê nada)

---

## Dois Controles de Visibilidade

### 1. Esconder/Reexibir Selos Individuais

Em seu perfil, cada selo tem um ícone de olho. Clique para alternar:

- **Olho aberto** = o selo está **visível** para empresas que têm vínculo com você
- **Olho fechado** = o selo está **oculto** — só você vê

**Uso prático:**
- Esconda selos de empresas com as quais você teve experiência ruim mas quer guardar o histórico
- Reexiba quando quiser (o dado não é apagado, só escondido)
- Qualquer mudança é salva automaticamente

### 2. Chave-Mestra: Esconder Tudo

No topo da seção (em "Meu Perfil"), há um switch grande chamado **"Não exibir onde já trabalhei"**.

- **Desligado** = empresas com vínculo ativo veem seus selos
- **Ligado** = **ninguém** vê a seção inteira (desaparece do perfil delas)
- **Você continua vendo tudo** aqui em seu perfil, para poder desligar de novo quando quiser

**Diferença:**
- Esconder um selo individual = essa empresa específica não vê aquele selo (outras veem)
- Chave-mestra ligada = nenhuma empresa vê nenhum selo

---

## Quem Vê Seus Selos

### ✅ Vê

- Empresas que têm **vínculo ativo** com você (`team_connections.status = 'accepted'`)
  - Ou seja: você aceitou o convite delas
- Você mesmo (sempre)

### ❌ Não Vê

- Empresas que você **bloqueou** ou que ainda têm convite **pendente** (não aceitou)
- Estranhos (geral)
- Selos individuais que você escondeu (mesmo empresa com vínculo)
- Toda a seção se você ligar a chave-mestra

---

## Clicar num Selo

Ao clicar em qualquer selo, abre o **perfil público daquela empresa**:
- Nome, logo, setor
- Descrição do negócio
- Avaliações que outros freelas deram dela
- Endereço e contato

Isto é útil se você quer relembrar algo sobre aquela empresa ou conferir a reputação dela.

---

## "Sem Avaliação" vs. Nota

Cada selo mostra um badge com a nota:

### Quando Vê Estrelas (ex: "4.8 ★")

A empresa te avaliou após um turno. A nota é a média de todas as vezes que ela te avaliou.

### Quando Vê "Sem Avaliação"

A empresa **nunca** te avaliou. Isto NÃO é uma nota baixa — é ausência de nota.

**Importante:** "Sem avaliação" não prejudica você. É só informação de que aquele turno não foi avaliado ainda.

---

## Quando Selos Aparecem

Seu primeiro selo aparece assim que você:
1. **Completa um turno** com uma empresa (status = `completed`)
2. O app valida que existe e gera o selo automaticamente

Você não faz nada — aparece na próxima vez que carrega `/profile`.

Você pode ter **vários selos da mesma empresa** se trabalhou com filiais diferentes? Não — o sistema agrupa por empresa (mesma `company_id`), então um único selo mostra o total de turnos.

---

## Ordem dos Selos

Os selos aparecem em **ordem cronológica** — o mais recente primeiro.

**Não é ranking:** não são ordenados por nota ou quantidade de turnos. A ordem reflete "quando foi meu último turno com eles", ponto.

---

## Perguntas Frequentes

**P: Posso deletar um selo?**  
R: Não há botão de delete. Você pode escondê-lo (botão de olho). O histórico fica guardado no banco — você pode reexibir depois se quiser.

**P: Uma empresa pode ver meus selos dela?**  
R: Não. O selo é visível para **outras empresas** com vínculo ativo com você. A empresa do selo não pode ver "qual é o meu selo", mas pode ver sua avaliação geral no seu perfil público (média de todas as notas).

**P: Posso esconder só um turno de uma empresa sem esconder o selo inteiro?**  
R: Não. O selo agrupa todos os turnos com aquela empresa. Se quer esconder, tem que esconder o selo inteiro (e perderá a visibilidade de quantos turnos fez).

**P: Se eu bloquear uma empresa, ela vê meus selos?**  
R: Não. Bloqueio significa "sem vínculo", então não há acesso a selos.

**P: Empresas veem a avaliação que EU dei a elas?**  
R: Não — avalições de freela para empresa não aparecem no perfil da empresa (privado). Empresas só veem as avaliações que receberam de outros freelas.

**P: Quanto tempo leva para aparecer um novo selo?**  
R: Automático assim que o turno é marcado como concluído (completion confirmado). Recarregue seu perfil se não vir imediatamente.
