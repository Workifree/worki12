# ADR-20260821 — A conferência de certificação pertence a quem conferiu

## Status
ACEITO — emenda pontual ao contrato `.harness/spec/certificacoes/ddl-aprovado.md` (DS8).
Complementa (não substitui) `ADR-20260821-certificacoes-metadado-sem-arquivo.md`.

## Contexto

F8 modela a conferência visual de uma certificação como um par atribuído
(`verified_by_company_id` + `verified_at`, travados por CHECK): o Worki nunca atesta, quem atesta é
uma empresa nomeada (D3).

O trigger `enforce_certification_update_scope()` particiona a escrita por ator. O ramo `(b)` (empresa
com vínculo) exigia `is_company_owner(NEW.verified_by_company_id)` — ou seja, guardava a **criação**
da conferência ("só confiro em nome próprio") — mas não guardava a **destruição**: com
`NEW.verified_by_company_id := NULL`, o predicado da guarda não se aplica e o trigger limpava
`verified_at`/`verified_note` sem perguntar de quem era aquela conferência.

Efeito: qualquer empresa que passe em `can_view_worker_profile(worker_id)` — todo o elenco e todo
vínculo operacional do freela, não só a conferente — podia derrubar a atestação de outra. E, pelo
mesmo buraco, **sobrescrevê-la** (`NEW := própria empresa` passa em `is_company_owner(NEW...)`),
apagando o registro de que a empresa A havia conferido.

`can_view_worker_profile` responde "posso ver *este freela*?"; a pergunta aqui é "sou dona *desta
atestação*?". É a mesma distinção que já motivou o D4 a recusar `can_view_worker_profile` no SELECT
de `worker_trainings`: ancorar no freela quando o dado é de outra empresa viola o isolamento.

A única barreira era a UI (`WorkerCertificationsPanel.tsx:217` só renderiza "Desfazer conferência"
quando `verified_by_company_id === companyId`). Article 4: filtro no client é UX; a defesa é o banco.

Peso do risco: num setor regulado (CREF, manipulação de alimentos), a empresa B degrada para
"auto-declarado" exatamente a informação que decide quem pode trabalhar — e sem deixar rastro.
Integridade, não confidencialidade: ninguém lê o que não podia ler.

A migration `20260817001300` **ainda não foi aplicada em produção**. Corrigir agora custa uma linha
de contrato; corrigir depois custa uma migration de correção sobre dado real.

## Decisão

**Aceitar o fix, com um alargamento e nenhuma outra mudança.**

No ramo `(b)`, antes das guardas existentes:

```sql
IF OLD.verified_by_company_id IS NOT NULL
   AND v_verified_changed
   AND NOT public.is_company_owner(OLD.verified_by_company_id) THEN
    RAISE EXCEPTION 'worker_certifications: so a empresa que conferiu pode desfazer ou alterar a propria conferencia.';
END IF;
```

Alargamento em relação ao fix proposto pelo revisor: a condição é `v_verified_changed`, **não**
`NEW.verified_by_company_id IS NULL`. O revisor viu o apagamento; a sobrescrita (`A -> B`) entra pela
mesma porta e destrói a mesma informação. Ancorar em `OLD` cobre os dois casos com um predicado só:
**conferência existente só é tocada por quem a fez.** Regra ancorada no dono do registro, exatamente
como `is_company_owner(company_id)` em `worker_trainings`.

### Por que isto não contamina o resto do trigger

- **Ramo (a), conferência perecível (DS2/D3):** intacto. O `IF/ELSIF` é exclusivo — o freela entra em
  `(a)` (`v_uid = OLD.worker_id`) e nunca alcança `(b)`. A queda automática de `verified_*` quando o
  conteúdo muda continua sendo do freela, que obviamente não é `is_company_owner` de ninguém.
  Verificação por construção, não por teste.
- **Ramo (c), ator sem sessão (DS4):** intacto. Cron (`notify_certification_expiries`),
  `delete-account` (roda com `SUPABASE_SERVICE_ROLE_KEY`, `auth.uid()` nulo) e a ação `SET NULL` da FK
  seguem entrando em `(c)`. O blocker corrigido na spec original continua corrigido.
- **`ON DELETE SET NULL` não cria linha travada.** Se a empresa conferente é deletada, o próprio
  `SET NULL` da FK já limpa a atestação, e essa UPDATE roda pelo `delete-account` (service_role, sem
  sessão) ⇒ ramo `(c)`, fora do alcance da guarda nova. Não existe hoje policy de DELETE em
  `companies` para `authenticated` — nenhum caminho autenticado dispara a ação da FK.
  E se por outra via a linha ficasse com uma conferência que ninguém consegue desfazer, quem é
  prejudicado — o freela — tem duas saídas próprias: editar qualquer campo de conteúdo (DS2 derruba a
  conferência) ou apagar a certificação (`wc_delete_owner`). Nenhuma linha fica sem remédio.

### Preservar histórico de conferência: **feature separada, não esta emenda**

Guardar "quem conferiu, quando, quem desfez" é uma tabela-evento nova
(`certification_verification_events` + trigger), não uma coluna. Além do tamanho, ela reabre duas
decisões fechadas: (i) DS2 diz que a conferência é *perecível* de propósito — histórico só vira
produto se aparecer na UI, e "conferida por A (revogada)" é justamente o tipo de selo residual que o
D3 proíbe; (ii) é mais dado sobre pessoa retido indefinidamente, o que mexe no item de
`debitos-pre-piloto.md §1` recém-escrito. Fica como **F8.1**, com gatilho: primeiro cliente do
vertical fitness pedindo auditoria de quem atestou o quê.

O que esta emenda entrega sem a tabela: a atestação deixa de ser destruível por terceiro, que era a
perda de informação real. O caso restante (a própria conferente desfaz o que fez) é intencional e
tem dono conhecido.

## Consequências

### Positivas
- A atestação passa a ter dono no banco, não só na UI — o botão escondido ganha espelho (Article 4).
- Cobre apagamento **e** sobrescrita com um predicado só, ancorado em `OLD`.
- Custo zero de migration de correção: contrato ainda não aplicado.
- `is_company_owner` continua sendo a costura única de autorização de empresa (par com
  `is_job_owner`) — o multi-unidade/gerente (F3) herda a regra de graça.

### Negativas / Trade-offs
- Uma empresa que conferiu e depois perde o vínculo com o freela deixa a atestação "de pé" para
  sempre do ponto de vista dela. Aceito: quem sofre é o freela, e ele tem remédio próprio (editar
  conteúdo ou apagar a certificação).
- Mais uma exceção `P0001` que o client precisa traduzir. `translateRlsError` já cobre;
  a UI nunca deveria chegar lá (o botão só aparece para a conferente).
- Custo de leitura: `is_company_owner` a mais por UPDATE de conferência. Função `STABLE`, tabela
  pequena, caminho não-quente.

## Alternativas rejeitadas

- **Aceitar o fix literal do revisor (só `NEW ... IS NULL`)**: deixaria a sobrescrita `A -> B` aberta,
  que apaga a mesma informação com um gesto a mais.
- **Fechar por RLS (`wc_update_scoped` com `is_company_owner(verified_by_company_id)`)**: `USING` lê
  `OLD` e `WITH CHECK` lê `NEW`; expressar "só quem fez muda" numa policy exigiria duplicar a lógica
  nos dois lados e quebraria o ramo do freela e o do cron. A partição por ator já mora no trigger
  (padrão `enforce_shift_payment_immutability`) — é lá que ela continua.
- **Declarar aceitável ("empresa do elenco pode desconferir")**: só faria sentido se conferência fosse
  informação da plataforma. D3 decidiu o contrário: ela é declaração de uma empresa nomeada. Empresa B
  apagando declaração da empresa A é B falando pela boca de A.
- **Tabela-evento de histórico agora**: ver acima — vira F8.1.

## Referências
- Contrato emendado: `.harness/spec/certificacoes/ddl-aprovado.md` (§2 DS8, §3 bloco 5, §4 V7)
- Migration: `supabase/migrations/20260817001300_worker_certifications_trainings.sql`
- Spec: `.harness/spec/certificacoes/spec.md`
- ADR irmão: `.harness/memory-bank/decisions/ADR-20260821-certificacoes-metadado-sem-arquivo.md`
- Achado: security-reviewer, 2026-08-21 (MÉDIO, integridade)
