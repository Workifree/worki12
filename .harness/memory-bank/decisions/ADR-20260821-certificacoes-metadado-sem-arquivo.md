# ADR-20260821 — Certificações: duas tabelas, metadado sem arquivo, conferência atribuída e perecível

## Status

ACEITO (gate de arquitetura da F8, 21/08/2026)

## Contexto

A entrevista de 17/08/2026 (sócio-operador de 10 unidades do Divino Fogão + rede fitness) colocou
certificação num lugar diferente de "enfeite de perfil": na academia, CREF é **requisito regulatório**
(sem ele o profissional não pode atuar); no restaurante, o análogo é treinamento de boas práticas /
manipulação de alimentos (RDC 216 exige treinamento comprovado). Ou seja, o dado responde "esta pessoa
**pode legalmente** trabalhar neste turno", não "quem é mais qualificado".

Três consequências mudam a modelagem:

1. **Setor regulado eleva o risco de exibir informação falsa.** Se o Worki exibe "CREF verificado" e o
   documento é falso ou venceu, o problema deixa de ser do freela e passa a ser da plataforma que
   afirmou.
2. **O documento em si é dado pessoal pesado.** PDF de CREF/manipulação carrega nome completo, CPF,
   foto e assinatura.
3. **A palavra "certificação" cobre dois objetos diferentes** (spec, seção Context): treinamento
   interno (a empresa atesta, sem emissor externo, sem validade) e certificação externa (documento do
   freela, com emissor e validade). Donos, políticas de escrita e ciclos de vida distintos.

Estado relevante do repositório no momento da decisão:

- `can_view_worker_profile(uuid)` (20260816120000) e o par `is_job_owner` / `is_company_owner`
  (20260817000100 / 20260817000300) já resolvem autorização por vínculo e por empresa.
- **Nenhuma policy de `storage.objects` existe em migration.** O único bucket em uso (`avatars`) é
  público e foi criado pelo dashboard (`Profile.tsx:321` usa `getPublicUrl`).
- `delete-account` está **comprovadamente quebrado** para freela que trabalhou (débito pré-piloto #5:
  `shift_payments.worker_id → workers` é RESTRICT).
- O piloto é 100% restaurante; a vertical fitness (onde o documento formal importa) é semente.

## Decisão

**(1) Dois objetos, não um com `type`.** `worker_trainings` (registro operacional da empresa sobre o
freela; só a empresa escreve, só ela e o freela leem) e `worker_certifications` (documento pessoal e
portável do freela; só ele escreve o conteúdo). Confirma a spec. **Não** é coluna `jsonb` em `workers`
(como a F7 fez com `availability_days`): certificação tem ciclo de vida próprio (emissão, validade,
renovação, conferência por terceiro, revogação), N linhas por freela, e escrita por **dois atores
diferentes com permissões diferentes** — nada disso cabe num campo cuja política de escrita é
"o dono da linha `workers` escreve o que quiser".

**(2) v1 SEM ARQUIVO.** Não existe `document_path`, não existe bucket `certification-docs`, não existe
upload nem signed URL. O que fica é metadado + `registration_number` (o número do conselho é público e
conferível na fonte) + conferência visual da empresa. O documento continua circulando onde já circula
hoje: WhatsApp/presencial, fora do Worki.

**(3) Conferência é ATRIBUÍDA e PERECÍVEL.** `CHECK ((verified_by_company_id IS NULL) = (verified_at IS
NULL))` torna a conferência anônima um estado inexpressável — não existe "verificado" sem empresa e data.
E o trigger `enforce_certification_update_scope` **zera `verified_*` quando o freela edita o conteúdo**
(título, emissor, número, emissão, validade). A spec original congelava a conferência sobre conteúdo
mutável; isso permitiria a sequência: empresa confere "CREF 012345 até 2027" → freela troca número e
validade → o Worki segue exibindo "conferido por <Empresa>" sobre um dado que ninguém daquela empresa
viu. Num setor regulado, esse é exatamente o passivo que a feature deveria evitar.

**(4) Validade é derivada, nunca congelada.** Sem coluna de status, sem coluna gerada. Predicado único
(`expires_at < data local America/Sao_Paulo`) usado no SQL e no client. As colunas `notified_30d_at` /
`notified_expired_at` são livro-caixa do agendador, fora do `GRANT UPDATE` do client, e são **zeradas
quando `expires_at` muda** (renovar volta a avisar).

**(5) Nenhum dado de saúde.** Atestado, ASO, exame toxicológico, vacinação e laudo de deficiência estão
fora — dado sensível (LGPD art. 5º, II) sem base legal neste produto (o Worki não é empregador).
Sustentado por: ausência de upload (2), tetos de tamanho nos campos de texto, `COMMENT` nas tabelas,
copy na UI e item novo em `debitos-pre-piloto.md` §1.

**(6) FKs CASCADE, nunca RESTRICT.** Nem `worker_trainings` nem `worker_certifications` adicionam um
novo bloqueador ao `delete-account` já quebrado. CASCADE ainda entrega a R13 sem código.

## Consequências

### Positivas

- A promessa ("quem pode legalmente trabalhar") é entregue sem o Worki assumir custódia de documento
  com CPF, foto e assinatura — e sem estrear custódia em cima de um direito de exclusão que não funciona.
- O produto fica **estruturalmente incapaz** de exibir um selo de verificação genérico ou uma conferência
  desatualizada: as duas coisas são impedidas por CHECK e trigger, não por disciplina de UI.
- Zero superfície nova de storage: nenhuma policy de `storage.objects`, nenhum TTL de signed URL,
  nenhum objeto órfão para limpar no `delete-account`.
- Article 8 intacto por construção — nenhuma tabela financeira é lida ou escrita.
- A1–A3, A5–A11, A14, A15 continuam atendidas.

### Negativas / Trade-offs

- **A empresa não vê o documento dentro do Worki.** Ela precisa pedir a foto/PDF por fora antes de
  clicar "Marcar como conferida". A copy assume isso explicitamente ("você confirma ter visto o
  documento original"), mas é uma ida ao WhatsApp que a v1 não elimina.
- **A4 (parte do arquivo), A12 e A13 saem do escopo de teste** — não há bucket para negar acesso.
- **Reconferência manual após edição:** o freela que corrige um erro de digitação no número do CREF
  derruba a conferência e precisa pedir de novo. É o custo consciente de (3); a UI deve avisar antes de
  salvar ("editar esta certificação vai remover a conferência de <Empresa>").
- **Sem `pg_cron` habilitado, a R9 não roda.** Mesmo risco já documentado na F4; a verificação V6 do
  `ddl-aprovado.md` é passo obrigatório de runbook.
- **`is_company_owner` tem primeiro ramo `p_company_id = auth.uid()`**, que sozinho aceitaria um freela
  passando o próprio uuid. Aqui isso é fechado por FK para `companies` + `worker_id <> company_id`, mas
  o padrão vale para qualquer tabela futura que ancore em `is_company_owner` sem FK — anotado como risco
  do par de funções.

## Alternativas rejeitadas

- **Bucket privado `certification-docs` na v1 (spec R10):** entrega custódia de documento sensível antes
  de existir cliente que a exija, estreia quatro mecanismos novos de uma vez (bucket privado, policy de
  storage versionada, signed URL, ciclo de vida de objeto) e o faz sobre um `delete-account` quebrado.
  Reversibilidade assimétrica: adicionar depois é migration aditiva; remover depois é operação sobre
  backups. **Adiado, com gatilho** (abaixo), não descartado.
- **Bucket público (custo zero de policy):** vazamento por URL adivinhável/compartilhável de PDF com
  CPF e assinatura. Descartado sem discussão.
- **Coluna `jsonb` em `workers` (padrão da F7):** um só ator escreveria (o dono da linha), então a
  conferência pela empresa seria impossível de proteger, o histórico de revogação sumiria e o cron de
  vencimento teria de varrer array dentro de jsonb. Ciclo de vida próprio pede linha.
- **Verificação pela plataforma ("CREF verificado pelo Worki"):** exigiria integração com conselho de
  classe (que não existe) e transferiria para o Worki a responsabilidade por afirmação em setor regulado.
  Fora, e a modelagem impede tecnicamente que a UI finja o contrário.
- **Congelar a conferência sobre conteúdo mutável (spec R4 literal):** analisado em (3); é o caminho
  para o Worki exibir um atestado que ninguém emitiu.
- **`can_view_worker_profile` no SELECT de `worker_trainings`:** viola A15 (empresa B leria treinamento
  registrado pela empresa A). Predicado correto é `is_company_owner(company_id)` — âncora no registro,
  não no freela.

## Reabertura do arquivo (desenho pronto, para quando o gatilho disparar)

**Gatilho:** vertical fitness saindo de semente para operação com contrato assinado, OU cliente exigindo
retenção do documento para auditoria própria. **Pré-requisito inegociável:** débito pré-piloto #5
(`delete-account`) resolvido — sem direito de exclusão funcionando, não se assume custódia de documento.

Migration aditiva, nesta forma:

1. `ALTER TABLE public.worker_certifications ADD COLUMN document_path text;` (nullable, sem default).
2. Bucket **privado** `certification-docs` (`storage.buckets`, `public = false`), path canônico
   `<worker_id>/<cert_id>.<ext>`.
3. Policies em `storage.objects` para o bucket, extraindo o `worker_id` do primeiro segmento do path:
   - SELECT: `public.can_view_worker_profile((storage.foldername(name))[1]::uuid)`
   - INSERT/UPDATE/DELETE: `(storage.foldername(name))[1] = auth.uid()::text` (só o dono escreve)
   - nenhuma policy para `anon`.
4. Leitura **sempre** por `createSignedUrl` no client autenticado, **TTL 60 s**, gerada no momento do
   clique (nunca no carregamento da lista, nunca persistida, nunca colocada em `src` de card renderizado
   em massa) — a autorização é a policy de storage; a signed URL é só o transporte, e TTL curto limita o
   estrago de um link vazado por print/encaminhamento.
5. `delete-account` passa a remover os objetos do prefixo `<worker_id>/` antes de apagar o usuário.
6. Copy de upload declarando o veto a documento de saúde (D5) **no próprio seletor de arquivo**.

## Referências

- Spec: `.harness/spec/certificacoes/spec.md`
- Contrato de DDL (normativo): `.harness/spec/certificacoes/ddl-aprovado.md`
- Migração de referência de autorização: `supabase/migrations/20260816120000_workers_select_by_relationship.sql`
- Par de autorização de empresa: `ADR-20260817-seam-autorizacao-empresa.md`
- Padrão de campo novo em `workers` (rejeitado aqui): `supabase/migrations/20260817001200_worker_availability_days.sql`
- Débitos: `.harness/memory-bank/debitos-pre-piloto.md` (§1 Política de Privacidade, §5 `delete-account`)
- Constitution: Articles 2 (tipos à mão), 4 (RLS é a primeira linha), 8 (saldo intacto), 13 (design)
