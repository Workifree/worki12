# Operação: SMTP próprio e e-mails de acesso do Worki

> Para quem administra o projeto no Supabase. Sem isto, o código por e-mail do convite de equipe **não chega** a quem não é membro do time do projeto.

## Por que é obrigatório
O Supabase vem com um serviço de e-mail embutido. Ele serve só para experimentar:
- envia **no máximo 2 e-mails por hora**;
- envia **só para endereços de membros do time do projeto**;
- o próprio painel avisa que "não é para aplicações em produção".

O convite de equipe usa **código por e-mail sem senha**. Com o serviço embutido, a pessoa convidada (a encarregada, por exemplo) nunca recebe o código.

## Passo a passo (cerca de 15 minutos)
1. Escolha um provedor de SMTP (por exemplo Resend ou Brevo) e crie a conta.
2. Verifique o **domínio de envio** no provedor (registros DNS de SPF e DKIM, que o provedor mostra na tela). Sem isso os e-mails caem em spam.
3. Gere as credenciais SMTP (host, porta, usuário, senha ou chave). **Guarde só no painel do Supabase**; nunca em arquivo do repositório.
4. No Supabase: **Authentication → Emails → SMTP Settings → Enable custom SMTP**. Preencha o remetente (por exemplo `Worki <acesso@seudominio.com.br>`), host, porta, usuário e senha.
5. **Desligue o rastreamento de links** (link tracking) no provedor: ele reescreve o link de confirmação e quebra o botão "Entrar no Worki".
6. Em **Authentication → Rate Limits**, suba o limite de e-mails por hora (o padrão com SMTP próprio é 30). Para o piloto, 30 basta; revise antes de crescer.
7. Peça um código para um e-mail de fora do time e confirme que chega, com o layout do Worki.

## Modelos de e-mail já aplicados
Em **Authentication → Emails → Templates** (versionados em `supabase/email-templates/`):
- **Magic link or OTP:** assunto "Seu código de acesso ao Worki"; mostra o código de 6 dígitos e o botão "Entrar no Worki".
- **Confirm sign up:** assunto "Confirme seu e-mail para entrar no Worki"; mostra o código e o botão "Confirmar e entrar".

> Atenção ao conferir o assunto do modelo "Magic link or OTP": se um gerenciador de senhas estiver preenchendo o campo "Subject" com um e-mail pessoal, **desative o preenchimento automático nessa página** antes de salvar, ou o assunto fica errado.

## URLs de redirect (obrigatório)
Em **Authentication → URL Configuration**. O app informa para onde o botão do e-mail deve voltar; se o endereço não estiver em **Redirect URLs**, o Supabase ignora e manda para a **Site URL**, e a pessoa convidada perde o convite (pode cair no cadastro de empresa).

- **Site URL:** `https://worki-opal.vercel.app`
- **Redirect URLs** (produção):
  - `https://worki-opal.vercel.app/convite-equipe/**` (convite de equipe)
  - `https://worki-opal.vercel.app/redefinir-senha` (recuperação de senha)
- **Redirect URLs** (desenvolvimento local):
  - `http://localhost:5173/convite-equipe/**`
  - `http://localhost:5173/redefinir-senha`

Se o domínio mudar, ou se o convite for testado em um deploy de preview, inclua os mesmos caminhos para o novo domínio. Some estas entradas às que já existirem; não apague outras sem conferir quem as usa.

Para conferir: peça o código em um convite, toque no botão do e-mail e veja que o endereço aberto é `/convite-equipe/...`. No mesmo navegador a entrada se conclui sozinha; em outro aparelho, a tela pede só o aceite dos Termos.

## Como verificar que está tudo certo
- Um e-mail de teste chega em menos de 1 minuto, na caixa de entrada.
- O código tem 6 dígitos e vale 1 hora.
- O botão abre o Worki já logado.
