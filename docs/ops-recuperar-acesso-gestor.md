# Runbook: o Gestor de empresa de dono único perdeu o acesso

Quando usar: o dono é o único Gestor (sem operador de organização e sem outro `manager` ativo) e não consegue mais entrar. Encarregados não resolvem isso: eles não confirmam pessoas, não convidam e não rotacionam o link do Elenco.

Quem executa: um admin da Worki, com `service_role` (painel do Supabase ou SQL Editor). Nunca no frontend. Registre quem pediu, quem aprovou, quem executou e quando.

## 1. Prova mínima antes de tocar em qualquer coisa

Peça os itens 1 e 2. Peça também ao menos um entre 3 e 4. Quem executa não pode ser a única pessoa que aprova.

1. Documento com foto do solicitante.
2. Prova de vínculo com o CNPJ: contrato social ou certificado MEI em que ele figure como sócio ou responsável, com o CNPJ igual ao cadastrado na empresa. Se não houver CNPJ cadastrado, exija os itens 3 **e** 4.
3. Retorno de contato pelo telefone ou e-mail que **já estava** cadastrado antes do pedido. Não vale o contato informado agora.
4. Conhecimento operacional que só a empresa tem: nomes de freelas do Elenco, datas e valores de turnos recentes.

Desconfie de pedido urgente, de e-mail novo parecido com o antigo e de pedido feito por um ex-encarregado. Não anexe cópias de documentos a tickets abertos. Guarde-as só onde o acesso é restrito e apague quando o caso fechar (LGPD).

## 2. Caminho preferido: recuperar a MESMA conta (sem SQL)

O `uid` não muda, então empresa, turnos, Elenco, chat e avisos continuam intactos.

1. No painel do Supabase (Authentication), ou com `auth.admin.updateUserById`, troque o e-mail da conta para o novo e-mail já comprovado.
2. O dono redefine a senha ou entra pelo código enviado ao novo e-mail.
3. Encerre as sessões antigas da conta. Um token já emitido continua válido até expirar.
4. Vá para a seção 4.

Use a seção 3 só se a conta não puder ser recuperada ou se a propriedade passar para **outra pessoa**.

## 3. Transferência de `owner_id` (outra conta)

A pessoa nova precisa ter uma conta de **empresa** criada e com e-mail confirmado. Conta de freela não pode (Article 1).

**Atenção, leia antes.** Nas contas atuais, `companies.id` é igual ao `uid` do dono antigo, e o seam aceita `companies.id = auth.uid()`. Trocar só o `owner_id` **não tira o acesso da conta antiga**. Para cortar, é obrigatório banir a conta antiga no Auth (`updateUserById(<uid_antigo>, { ban_duration: '876000h' })`) e encerrar as sessões dela. Não apague a conta: a guarda de LGPD recusa apagar enquanto houver perfil vivo, e `companies.id` depende desse `uid`.

**Limitação conhecida.** Chat (`Conversation`/`Message`) e algumas policies antigas ainda comparam o id da empresa com `auth.uid()`. O novo dono pode não ver o chat. Avise-o e abra uma pendência técnica.

Rode primeiro com `ROLLBACK`, confira as saídas e só então troque por `COMMIT`.

```sql
-- BEGIN;
--
-- -- Preencha os três uuids. Nunca rode com valores adivinhados.
-- --   <company_id>  empresa afetada
-- --   <uid_antigo>  owner_id atual
-- --   <uid_novo>    conta de empresa já criada e comprovada
--
-- -- 3.1 Conferência (esperado: owner_id = <uid_antigo>, anonymized_at NULL)
-- SELECT id, name, owner_id, organization_id, anonymized_at
--   FROM public.companies WHERE id = '<company_id>' FOR UPDATE;
--
-- -- 3.2 A conta nova existe, está confirmada e não é de freela (esperado: 1 linha, e_freela = false)
-- SELECT u.id, u.email_confirmed_at IS NOT NULL AS confirmada,
--        EXISTS (SELECT 1 FROM public.workers w WHERE w.id = u.id) AS e_freela
--   FROM auth.users u WHERE u.id = '<uid_novo>';
--
-- -- 3.3 Transfere a propriedade (esperado: UPDATE 1)
-- UPDATE public.companies
--    SET owner_id = '<uid_novo>'             -- depois, rotacione o link do Elenco (seção 4)
--  WHERE id = '<company_id>' AND owner_id = '<uid_antigo>';
--
-- -- 3.4 Organização: o novo dono entra como owner ANTES de o antigo sair (a rede nunca fica sem dono).
-- --     Se o novo uid já tiver linha nesta organização, faça UPDATE dela em vez do INSERT.
-- INSERT INTO public.organization_members
--        (organization_id, user_id, role, status, accepted_at, created_by)
-- SELECT c.organization_id, '<uid_novo>', 'owner', 'active', now(), '<uid_novo>'
--   FROM public.companies c WHERE c.id = '<company_id>';
--
-- UPDATE public.organization_members om
--    SET status = 'removed'                       -- nunca DELETE
--   FROM public.companies c
--  WHERE c.id = '<company_id>' AND om.organization_id = c.organization_id
--    AND om.user_id = '<uid_antigo>' AND om.status = 'active';
--
-- -- Se a organização tiver OUTRAS unidades, pare e avalie: o passo 3.4 afeta todas elas.
-- SELECT id, name, owner_id FROM public.companies
--  WHERE organization_id = (SELECT organization_id FROM public.companies WHERE id = '<company_id>');
--
-- -- 3.5 Conferência como o novo dono (esperado: true e papel 'owner')
-- SET LOCAL ROLE authenticated;
-- SET LOCAL request.jwt.claims = '{"sub":"<uid_novo>","role":"authenticated"}';
-- SELECT public.is_company_owner('<company_id>');
-- SELECT company_id, role FROM public.get_my_companies();
-- RESET ROLE;
--
-- ROLLBACK;  -- troque por COMMIT só depois de conferir cada saída
```

## 4. Depois de recuperar

1. O Gestor gera um link novo do Elenco, mesmo sem aviso na tela: quem perdeu ou deixou o acesso pode conhecer o link atual. (O aviso automático só considera membros removidos, não troca de dono.)
2. Ele abre Configurações, Equipe, e confere cada pessoa: remove quem não reconhecer e revoga convites pendentes.
3. Ele confere pagamentos registrados e turnos criados no período sem acesso.
4. Registre o encerramento do caso e apague as cópias de documentos que não precisam ser retidas.

## O que não fazer

- Não editar `companies.id`.
- Não apagar usuário, empresa ou linha de membro.
- Não criar `company_members` com `role = 'manager'` direto no SQL como atalho. Se precisar de um segundo Gestor, use o convite por e-mail (`invite_company_manager`).
- Não tocar em saldo ou escrow.
