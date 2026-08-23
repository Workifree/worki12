# Achados navegando o produto no browser (22/08/2026)

Brave real, via porta de debug (CDP), contra **produção**. Cadastro de freela e de empresa feitos
pelo fluxo real, console e rede lidos a cada passo.

Contas de teste criadas em produção: `qa.freela.claude@worki.test` e `qa.empresa.claude@worki.test`.

---

## ✅ CORRIGIDOS

### 1. 🔴 BLOQUEADOR — nenhuma empresa nova conseguia se cadastrar
**Regressão introduzida por mim hoje**, na Fase 1 da F13.

`companies.organization_id` virou NOT NULL, preenchida por trigger BEFORE INSERT. Mas o trigger
tinha a guarda `IF EXISTS (linha) THEN RETURN NEW` — que devolvia `organization_id` NULL. O
onboarding grava com `.upsert()`, que é `INSERT ... ON CONFLICT DO UPDATE`, e o NOT NULL é avaliado
sobre a **tupla proposta, antes** do ON CONFLICT. Resultado:

```
HTTP 400  23502: null value in column "organization_id" violates not-null constraint
```

A tela ficava parada, **sem mensagem de erro**. Corrigido em `20260822000700`: o trigger passa a
**herdar** o `organization_id` da linha existente em vez de desistir. Validado por simulação com
rollback e confirmado no browser — o cadastro conclui e cai no dashboard.

**Só apareceu clicando.** Build, lint, 915 testes e revisão de código não pegaram — eu inclusive
revisei essa guarda e a aprovei como correta.

### 2. 🟠 Especialidade do freela era coletada e jogada fora
O onboarding pergunta "QUAIS SUAS ESPECIALIDADES?" e grava em `workers.roles`. **Nenhuma tela da
empresa lê `roles`** — todas exibem `primary_role`, que só era escrito na página de Perfil.

Medido em produção: **11 de 16 freelas** tinham declarado a especialidade e apareciam **sem função**
para a empresa — inclusive sumindo da busca por função do `ShiftCallModal`.

Corrigido no onboarding (grava `primary_role`) + backfill (`20260822000600`) dos 11 existentes.
Depois: 14 de 16 com função visível, zero invisíveis.

---

## 🟡 ABERTOS — conteúdo e produto

### 3. A tela de login da empresa promete "10k+ profissionais avaliados"
Existem **16** freelas em produção. É a primeira frase que um cliente do piloto lê.

### 4. O campo SETOR é do marketplace antigo
Opções: Desenvolvimento, Design, Marketing, Vendas, Suporte. **Um restaurante — o cliente do
piloto — não tem onde se encaixar.** Tive de escolher "Suporte" para um restaurante.

### 5. "DISPONIBILIDADE" significa duas coisas na mesma tela
No perfil do freela aparecem, uma embaixo da outra: **"DISPONIBILIDADE"** (Manhã/Tarde/Noite/
Madrugada/Fim de Semana — array do cadastro) e **"DISPONIBILIDADE DA SEMANA"** (a grade dia×período
do F7). São colunas diferentes com o mesmo nome. Pior: quem acaba de declarar no cadastro cai no
dashboard e lê "Declare sua disponibilidade" — parece que o que ele preencheu não valeu.

### 6. Perfil aceita texto livre onde a empresa espera uma função
`primary_role` e `roles` não têm validação. Em produção hoje:
- um freela tem **o próprio e-mail** gravado como função;
- outro tem uma **bio inteira** dentro do array de especialidades;
- convivem **"Garcom"** e **"Garçom"** — a busca por função no `ShiftCallModal` compara texto, então
  quem digitou sem cedilha não é encontrado por quem busca com.

---

## 🔵 ABERTOS — menores

### 7. Inputs de login sem `autocomplete`
Console do Brave: `[DOM] Input elements should have autocomplete attributes (suggested:
"current-password")`. Atrapalha gerenciador de senhas.

### 8. Botão desabilitado não diz o que falta
No onboarding do freela, com um campo obrigatório vazio, o PRÓXIMO fica `disabled` **sem nenhuma
indicação de qual campo falta**. A pessoa não tem como saber o que corrigir.

---

## ✅ Verificado e funcionando

- **Cadastro do freela** ponta a ponta (3 passos), console limpo.
- **Cadastro da empresa** ponta a ponta (2 passos), depois do conserto #1.
- **F7 disponibilidade**: marquei SEG-noite e TER-tarde; o banco gravou `{"1":["noite"],"2":["tarde"]}`
  — exato, e confirma a convenção 0=domingo.
- **8 rotas do freela** e **10 da empresa** (incluindo Operação/F9, Indicações/F10 e Organização/F13)
  carregam com console limpo.
- Login, logout e roteamento por papel funcionam; empresa com onboarding pendente é levada de volta
  a ele corretamente.

## Nota de método

Um "bug" que reportei primeiro **não existia**: o botão travado no onboarding do freela era
contaminação da minha própria automação (escrevi um valor inválido dentro de um `<select>`, o
`onChange` gravou vazio). Conferi antes de concluir. Vale a regra: automação que escreve direto no
DOM pode **criar** o defeito que ela está investigando.
