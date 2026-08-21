# Features F5–F8: Guarda de Vínculo, Termo de Serviço, Disponibilidade e Certificações

Documentação de features para usuários finais (empresas e freelas) — lançamento 2026-08-18.

---

## F5 — Aviso de Risco de Vínculo

### Para empresas

A Worki avisa quando você está convocando o mesmo freela muitas vezes na mesma semana. A ideia é **ajudar você a controlar a frequência**, sem restringir a decisão.

#### Como configurar

1. Vá para seu **Perfil** (empresa) → **Configurações da Empresa**
2. Procure o campo **"Limite semanal de convites para o mesmo freela"**
3. Escolha de **1 a 7** quantas vezes você quer ser avisada (padrão: 2)
4. Salve

#### Como funciona

- Ao disparar um **Chamado de Turno** (F1) ou convidar para uma **Série Recorrente** (F3), o app mostra um **selo de aviso** (ícone amarelo ou badge) ao lado de quem já passou do seu limite
- **O aviso é só informação:** você continua podendo convidar normalmente — não há bloqueio
- **Contagem é só seus turnos:** o app conta apenas turnos **com sua empresa**; não conta trabalhos que o freela faz para outros negócios
- Exemplo: se você configurou limite 2 e o freela já aceitou 2 turnos nesta semana, ao tentar convidar um terceiro, você verá o aviso

#### Na série inteira

Quando você **convida alguém para todas as ocorrências de uma série**, o sistema calcula a carga:
- Quantos turnos o freela **já tem** naquelas semanas (preexistente)
- Quantos turnos **novos** você vai adicionar (da série)
- O aviso aparece por linha/semana se ultrapassar seu limite

---

## F6 — Termo de Prestação de Serviço

### Para freelas

Quando você confirma o recebimento de um pagamento registrado, o Worki gera um **termo declaratório** — um documento que você assina eletronicamente.

#### O que é

O termo é um modelo sugerido pela Worki que resume:
- Quem trabalhou (você)
- Para quem (a empresa)
- Qual turno, data, horário
- Quanto recebeu
- Uma cláusula de que você é responsável pelo recolhimento de impostos sobre aquele valor

**Importante:** o Worki não é parte deste termo, não valida e não garante sua validade jurídica — isso fica entre você e a empresa.

#### Como aceitar

1. Abra o **Recibo** do pagamento (em "Meus Recebimentos")
2. Procure a seção **"Termo de Prestação de Serviço"**
3. Clique em **"Ler o termo inteiro"** para expandir o texto completo
4. Leia com atenção
5. Marque a caixa **"Li e concordo com os termos acima"**
6. Clique em **"Aceitar termo e confirmar recebimento"** — os dois acontecem juntos

#### O que acontece depois

- O termo fica **congelado** com a data e a hora em que você aceinou
- Mesmo que os dados da empresa ou do turno mudem depois, o documento que você assinou **não muda**
- O termo vira parte do seu histórico (pode ser impresso)

#### Se o CPF está faltando

Se você não tem um CPF cadastrado no Worki, o aceite será bloqueado com a mensagem:

> **"Seu cadastro está sem um CPF válido — por isso não é possível assinar este termo agora."**

Neste caso, **fale com a empresa ou com o suporte do Worki** para regularizar seu cadastro antes de poder aceitar o termo.

### Para empresas

Quando você **registra um pagamento** para um turno, o Worki gera automaticamente o termo.

#### O que você vê

- No **Recibo**, a seção "Termo de Prestação de Serviço" mostra:
  - O texto do termo com os dados do turno
  - Se o freela já aceitou (com data/hora) ou se ainda está pendente

#### Dica

Se precisar de um padrão de briefing ou avisos que apareça automaticamente em todo termo, coordene com o suporte — o template do termo pode ser ajustado.

---

## F7 — Disponibilidade da Semana

### Para freelas

**A ideia:** você informa em quais dias e períodos você **costuma** estar disponível. As empresas veem isso e convidam preferentemente nos seus horários.

#### Como declarar

1. Vá para seu **Perfil** → **Minha Disponibilidade** (nova seção)
2. Para cada **dia da semana** (segunda a domingo), marque:
   - ☐ **Manhã** (madrugada até meio-dia)
   - ☐ **Tarde** (meio-dia até 18h)
   - ☐ **Noite** (18h em diante)
3. Salve

#### Não é compromisso

- Isso **não bloqueia** você de aceitar turnos em outros horários
- Você **continua podendo recusar** qualquer convite, em qualquer horário
- Se alguém chamar você de madrugada numa quarta e você quiser aceitar, aceite — a declaração é só uma sinalização, não uma agenda

#### Como aparece para as empresas

- No **Chamado de Turno**, quem declarou disponibilidade para aquele dia e período aparece **destacado no topo**
- Quem não declarou nada continua na lista, só não fica destacado
- **Sem punição:** não declarar não afeta sua reputação nem suas chances

#### Se você não declarou ainda

- Há um aviso no painel "Meus Turnos" convidando você a preencher
- É **opcional** — não há obrigação

---

## F8 — Certificações e Capacitações

### Para freelas

#### Cadastrar certificações

1. Vá para seu **Perfil** → **Certificações e Treinamentos** (nova seção)
2. Clique em **"Adicionar Certificação"**
3. Preencha:
   - **Nome:** ex. "CREF — Conselho Regional de Educação Física"
   - **Órgão emissor:** ex. "CREF-SP"
   - **Número de registro:** ex. "123456/SP"
   - **Data de emissão:** quando você recebeu
   - **Válida até:** quando expira (pode deixar vazio se não tem prazo)
4. Salve

#### Sem upload de arquivo

**Não há campo para enviar arquivo** — o número de registro é o que importa. Quando uma empresa quiser conferir, ela pode consultar o número no site do órgão emissor (CREF, prefeitura, conselho etc.).

#### Certificações vencidas

- Se a validade passou, a certificação continua aparecendo no seu perfil
- Fica marcada como **"Vencida"** (não é apagada)
- Você pode renovar cadastrando uma nova certificação com a nova validade

#### Conferência pela empresa

Quando uma **empresa tem vínculo com você**, ela pode:
1. Ver suas certificações
2. Clicar em **"Confirmar que vi"** (depois de consultar o número)
3. Deixar uma **nota** (opcional), ex.: "Confirmado em CREF"

- Fica registrado **quando** ela conferiu
- Um **ícone verde** aparece ao lado

#### Se você editar uma certificação já confirmada

- Se você **mudar o número de registro** ou a **data de validade** de uma certificação que já foi conferida, a confirmação cai
- **Por quê?** A empresa verificou aquele conteúdo específico; se o conteúdo muda, ela precisa verificar de novo
- A empresa verá o aviso e pode re-conferir quando quiser

#### Apenas você controla sua certificação

- Você pode **desmentir a conferência** de uma empresa se achar que há erro
- A empresa que conferiu também pode desmentir a própria conferência
- Outras empresas **não conseguem** remover a conferência que outra empresa fez

### Para empresas

#### Ver certificações

No **Elenco**, ao clicar no card de um freela que tem vínculo com você, aparece a seção **"Certificações"**:
- Nome, órgão, validade
- Se já foi conferida (e por quem)
- Ícone de vencida se expirou

#### Confirmar que viu

1. Procure o certificado que quer conferir
2. Clique em **"Confirmar que vi"** (ou escaneie o documento física)
3. (Opcional) Deixe uma nota, ex.: "Consultado em CREF-SP em 18/08/2026"
4. Confirme

**Fica registrado:**
- Quando você conferiu
- Qual empresa confirmou
- Sua nota (se deixou)

#### Exigir certificação no turno

Ao **criar um turno**, há um campo:
- **"Certificação obrigatória:"** (texto livre)
- Exemplo: "Manipulador de Alimentos" ou "CREF"

**Como aparece:**
- No **Chamado de Turno**, há um aviso destacado no topo: "Este turno exige: [certificação]"
- **Não bloqueia ninguém** — freelas sem o certificado continuam vendo e podendo aceitar
- A decisão de convidar é sua

#### Registrar treinamentos internos

Você também pode registrar **treinamentos que você mesma deu** ao freela:

1. No card do freela → **"Adicionar Treinamento"**
2. Preencha:
   - **Título:** ex. "Treinamento de Segurança Alimentar"
   - **Data de conclusão:** quando terminou
   - (Opcional) **Nota:** ex. "Aprovado"
3. Salve

**Características:**
- **Visível só para você e para o freela** — outras empresas não veem
- **Revogação:** se você registrou por engano, pode revogar (aparece marcado como "revogado", não é apagado)
- **Sem edição:** não dá para mudar a data — se precisa corrigir, revoga e cria um novo

#### Sem documentos de saúde

**Não registre neste campo:**
- Atestado médico
- Exame de sangue / COVID
- Qualquer documento de saúde

As certificações são apenas para **qualificação profissional**. Dados de saúde têm regulação específica (LGPD) e não cabem aqui.

---

## Perguntas frequentes

### F5 — Aviso de Risco de Vínculo

**P: Por quê o sistema avisa sobre frequência?**  
R: Por questões trabalhistas. Uma pessoa que trabalha regularmente (muitas vezes por semana) para a mesma empresa pode gerar um vínculo trabalhista eventual, o que muda as obrigações de ambos (imposto, benefício, etc.). O aviso ajuda você a acompanhar isso.

**P: Posso ignorar o aviso e convidar mesmo assim?**  
R: Sim, totalmente. O aviso é só informação. A decisão é sua.

**P: O aviso conta freelancers de outras cidades / franquias da mesma rede?**  
R: Não. Conta só os turnos **com sua empresa**. Se a sua rede tem filiais cadastradas como empresas diferentes no Worki, cada uma conta as suas separadamente — e nenhuma enxerga os turnos da outra. Isso é proposital: o Worki não expõe para uma empresa onde o freela trabalha além dela. Se você precisa de uma visão consolidada da rede, isso ainda não existe.

### F6 — Termo de Prestação de Serviço

**P: O Worki garante a validade jurídica do termo?**  
R: Não. O Worki é apenas um **registrador do aceite**. A validez e a força do termo dependem da legislação brasileira, da capacidade das partes e de outros fatores. Para questões jurídicas, consulte um contador ou advogado.

**P: O termo é permanente?**  
R: Sim. Uma vez aceito, fica congelado. Você pode solicitaranonimização (remover dados pessoais) através do suporte em caso de exercício de direitos LGPD, mas o termo não desaparece dos registros.

**P: Se a empresa mudou a descrição do turno depois que aceitei o termo, o termo mudou também?**  
R: Não. O termo que você assinou é um **snapshot** daquele momento. Se a descrição ou os dados mudaram depois, o documento que você assinou continua igual.

### F7 — Disponibilidade da Semana

**P: Se declaro que não estou disponível à noite, a empresa não pode me chamar?**  
R: Errado. A disponibilidade é uma **sugestão, não um bloqueio**. A empresa pode chamar em qualquer horário. Você continua podendo recusar, ou aceitar fora do seu horário habitual.

**P: Onde aparece a disponibilidade?**  
R: No topo do Chamado de Turno. Quem tem disponibilidade para aquele dia/período aparece destacado.

**P: Preciso preencher a disponibilidade?**  
R: Não. É opcional. Se não preencheu, você simplesmente não fica destacado — mas continua podendo aceitar tudo normalmente.

### F8 — Certificações e Capacitações

**P: Posso enviar uma foto ou arquivo do certificado?**  
R: Não. A Worki não armazena arquivos nesta versão. O número de registro (ou código do certificado) é o que vale — é consultável na fonte (site do conselho, prefeitura, etc.).

**P: Se a empresa confirmou meu certificado e eu mudei o número, o que acontece?**  
R: A confirmação dela cai. Ela terá que conferir de novo, porque o conteúdo mudou. (Se mudou o número, significa que é um certificado diferente.)

**P: Não tenho um certificado. Posso deixar a seção vazia?**  
R: Sim, totalmente. A seção é opcional.

**P: Treinamento interno serve como certificação para outra empresa?**  
R: Não. Treinamentos internos são visíveis só para você e para a empresa que registrou. Outras empresas não veem.

---

## Contato e suporte

Dúvidas sobre estas features? Entre em contato:
- **Chat do Worki** (no app)
- **Email:** suporte@worki.com.br (quando disponível)

