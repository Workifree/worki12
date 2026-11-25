# ADR-20261126: prévia pública do convite de Elenco e de gerente

**Status:** aceito (aplicado em produção em 26/11/2026, migration `20261126000900_previa_de_convite.sql`).

## Contexto
O convite era aceito ao abrir o link. Com o aceite passando a exigir um toque, a tela de consentimento
precisa dizer quem está convidando, inclusive antes do login. É a segunda função de convite executável por
`anon` (a primeira é `get_member_invite_preview`, ver `ADR-20261123-previa-publica-do-convite`).

## Decisão
`get_invite_preview(p_token)` devolve só `{outcome, inviter_name, kind}`. `inviter_name` é o nome da
empresa. Toda falha responde o mesmo `not_found`. `SECURITY DEFINER`, `search_path` vazio e `VOLATILE`
(o PostgREST só aceita POST, então o token não vai para URL nem log).

O link `w_` do freela **não** é atendido: o token é o próprio id do freela codificado, sem segredo, sem
validade e sem revogação. Uma prévia pública revelaria o nome a partir do id. Atender exige antes um token
opaco próprio.

## Consequências e riscos aceitos
- Quem tem um token válido descobre que ele é válido e o nome da empresa.
- O link de Elenco não expira (a empresa pode gerar outro) e a função não tem limite de requisições.
  Adivinhar um token (192 bits no Elenco, cerca de 244 no gerente) é inviável.
- O nome exibido é o que a empresa cadastrou.
