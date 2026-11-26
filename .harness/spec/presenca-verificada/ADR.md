# ADR-20261125 — Presença verificada (QR do local + GPS) como política por turno

## Status
PROPOSTO (gate do harness-architect, 25/11/2026). Nada implementado nem aplicado.

## Contexto
Hoje a presença tem só um modo, a dupla confirmação: o freela marca chegada e saída (`worker_checkin_at` / `worker_checkout_at`, com horário do servidor forçado pelo `applications_update_guard`, migration 20261125000200) e a empresa confirma (`company_*_confirmed_at`). O check-in por QR antigo foi removido inteiro porque não validava nada: aceitava qualquer conteúdo e pedia a localização para depois jogá-la fora. O dono quer que **quem cria o turno escolha** como a presença é confirmada, com um segundo modo, "QR do local + GPS no local", "pra começar garantir que está lá". Outras políticas podem vir depois.

Restrições: a validação tem de acontecer **no servidor**, porque o que o client decide se forja. O guard atual já impede o client de forjar carimbos, mas aceita qualquer `worker_checkin_at`. O `Permissions-Policy` em `frontend/vercel.json` tem `geolocation=()`, o que bloqueia o GPS. O seam de autorização é `is_company_owner` / `is_job_owner`, e o encarregado só é aplicado a partir da E2–E5. Pela LGPD, a localização é dado pessoal.

## Decisão
1. **Locais da empresa** (`company_sites`): nome, endereço textual, `lat`/`lng` (`numeric(9,6)`), `radius_m` (CHECK 50..500, padrão 150), `archived_at`. Um local nunca é apagado, só arquivado (`ON DELETE RESTRICT` vindo de `jobs`). O segredo do QR fica numa tabela separada, `company_site_secrets(site_id, secret bytea, version int)`, com RLS habilitado, **nenhuma policy** e nenhum GRANT para `authenticated`/`anon`. Só RPCs DEFINER leem essa tabela. Quem gerencia os locais é o **Gestor** (`is_company_owner`). O encarregado só escolhe um local já cadastrado.
2. **A política vive no turno** e tem padrão na empresa. Colunas `jobs.presence_mode text NOT NULL DEFAULT 'dual' CHECK IN ('dual','qr_gps')`, `jobs.site_id uuid NULL REFERENCES company_sites`, `jobs.qr_mode text NOT NULL DEFAULT 'rotating' CHECK IN ('rotating','static')`. Um CHECK exige `site_id` quando o modo é `qr_gps`. Os padrões ficam em `companies.default_presence_mode`, `default_site_id` e `default_qr_mode`, e são copiados para o formulário. Na série, os mesmos campos vão em `p_job_template` e são materializados em cada ocorrência (EAGER, como no F3). O modo e o local **congelam** depois do primeiro carimbo de presença de qualquer application do turno (trigger em `jobs`). Usamos `text + CHECK` e não `enum` para que modos futuros sejam só um ALTER do CHECK.
3. **No modo `qr_gps`, o carimbo do freela só nasce de RPC.** A RPC `verify_presence(p_application_id, p_kind 'arrival'|'departure', p_qr text, p_lat, p_lng, p_accuracy_m)` é SECURITY DEFINER com `search_path=''` e `GRANT` só para `authenticated`. Ela confere, nesta ordem: dono da application é `auth.uid()`, status, janela de horário (a mesma do guard), QR, GPS. Sempre grava uma tentativa em `presence_checks`. Se tudo passa, faz o UPDATE com `set_config('app.presence_rpc','on',true)`. O guard passa a recusar alteração de `worker_checkin_at`/`worker_checkout_at` em turno `qr_gps` quando essa GUC local está ausente. Essa GUC é inalcançável via PostgREST porque é transação-local e setada dentro do DEFINER, e o padrão é o mesmo do `app.job_reassign` da E5.
4. **Verificado conta como confirmação.** No modo `qr_gps`, a chegada verificada também preenche `company_checkin_confirmed_at`, porque o local confirmou. O responsável continua podendo marcar a confirmação manual, mas só por `record_presence_exception(p_application_id, p_kind, p_reason)`. A RPC exige `is_job_owner`, um motivo de uma lista fechada mais uma nota de até 200 caracteres, e grava `presence_checks.result='manual_exception'` com `decided_by`. O UPDATE direto de `company_*_confirmed_at` em turno `qr_gps` é recusado pelo guard (mesma GUC).
5. **QR rotativo por padrão, estático opcional por turno.** O rotativo usa o token `base64url(site_id‖version‖step‖HMAC-SHA256(secret, site_id‖job_id‖step)[0:10])`, com `step = floor(epoch/30)`. Ele é calculado **no servidor** por `get_presence_qr(p_job_id)` (DEFINER, exige `is_job_owner`) e exibido na tela "Mostrar QR do turno" do responsável, que busca um novo código a cada 20s. A verificação aceita `step` e `step-1` (até 60s) e assim tolera atraso de rede e de leitura sem distribuir o segredo. O estático usa `HMAC(secret, site_id‖version‖'static')` e é impresso em PDF/A4 pela página `/company/locais/:id/qr` (sem serviço pago, gerado no browser). A troca é por `rotate_site_secret` (version+1), que invalida o impresso antigo.
6. **Regra de GPS.** `distance_m` é calculada por haversine em SQL. **Passa** quando `accuracy_m <= 150` e `distance_m <= radius_m + least(accuracy_m, 50)`. Se `accuracy_m > 150`, o resultado é `gps_low_accuracy` e a UI pede para ir até perto de uma janela e tentar de novo. Raio e precisão são números do client: nós os registramos, não confiamos neles. Valores fora de faixa (`|lat|>90`, `accuracy<=0`) dão `invalid_input`.
7. **Contingência.** GPS negado, indisponível, sem sinal em ambiente fechado ou QR ilegível levam a "Pedir confirmação ao responsável". Isso gera uma notificação via trigger DEFINER, e o responsável resolve por `record_presence_exception`. A exceção fica **marcada** no recibo e no BI. O freela **sempre** tem essa alternativa: negar a localização não o impede de trabalhar nem de receber (LGPD, direito de alternativa).
8. **A saída segue a mesma regra da chegada**, com a mesma contingência. Uma saída sem verificação não bloqueia o fluxo, só fica marcada.
9. **O pagamento não é bloqueado.** No modo A, o Worki não move dinheiro, então bloquear não teria efeito real e só criaria atrito. O modal "Registrar pagamento" e o `ReceiptView` mostram um selo: "Presença verificada no local" / "Confirmada manualmente: <motivo>" / "Não verificada". A decisão de pagar fica com a empresa.
10. **Minimização (LGPD).** `presence_checks` guarda `result`, `distance_m int`, `accuracy_m int`, `qr_ok bool`, `qr_kind`, `created_at`, `decided_by`, `reason`. **Coordenada bruta do freela não é gravada**, nem em log (a RPC usa a coordenada e descarta). Não há trilha: só uma tentativa por gesto, sem rastreamento contínuo. Retenção: as tentativas falhas são purgadas em 90 dias por `pg_cron`, e a verificada/exceção vive enquanto viver o recibo, entrando no `anonymize_account`. A base legal é a execução de contrato e o legítimo interesse (art. 7º, V e IX). O aviso aparece antes do prompt do browser, com texto curto e link para a Privacidade. A coordenada **do local** é da empresa e não é dado pessoal.
11. **Como definir o local.** O principal é "Estou no local agora": o Gestor captura a posição com o GPS, o que exige `accuracy <= 50`, senão a UI pede para tentar de novo. O secundário é ajustar o pino num mapa Leaflet com tiles OSM, sem geocodificação paga. A busca por endereço via Nominatim é opcional, com no máximo 1 req/s e com atribuição.
12. **Headers.** `frontend/vercel.json` passa a ter `geolocation=(self)`, e `camera=(self)` continua.

## Revisão de 25/11/2026 (revisão no catálogo; prevalece sobre os itens acima)
- **Afrouxar é do Gestor** (itens 2 e 4): `qr_gps` para `dual`, `rotating` para `static` e trocar de local exigem `is_company_owner`, em UPDATE direto, em lote ou por RPC. `qr_mode` congela junto com modo e local no primeiro carimbo.
- **Guard fail-closed** (item 3): o carimbo direto só passa se o turno for visível e `dual`.
- **Sem texto livre** (itens 4 e 10): a nota da exceção saiu; só o motivo da lista fechada.
- **Retenção** (item 10): tentativas falhas e pedidos são apagados em 90 dias. Em `verified`, `manual_exception` e `unverified`, `distance_m` e `accuracy_m` são anulados em 90 dias (só servem para contestação recente); resultado, motivo e autor ficam enquanto existir o recibo.
- O pedido de ajuda respeita a janela de horário; as RPCs autorizam antes de travar linhas; casca de empresa com local não é apagada no aceite de convite.

## Consequências
### Positivas
- Pela primeira vez a presença é validada por algo que o client não decide sozinho (segredo do servidor, relógio do servidor, distância calculada no servidor).
- O modo `dual` fica intacto e continua o padrão: zero mudança para quem não opta.
- A política por turno abre espaço para modos futuros (por exemplo, só GPS ou foto) sem migration de estrutura.
### Negativas / Trade-offs
- **O que NÃO dá para garantir**, dito ao dono e na copy:
  - Num browser não é possível detectar GPS falso (mock location, emulador). Ele é derrotado quando combinado com o QR rotativo, que exige estar vendo a tela do responsável. Mas um cúmplice pode transmitir o QR por vídeo em até 60s.
  - O QR estático pode ser fotografado e reusado indefinidamente. Nele, a única barreira real é o GPS, que é falsificável.
  - Aparelho emprestado: nada prova que a pessoa é o freela, porque identidade não está no escopo.
  - Replay: é limitado a 60s no rotativo e a uma verificação por `(application, kind)`.
- O rotativo exige que o responsável esteja presente com o celular online. Sem isso, cai no estático ou na exceção.
- Offline: não há verificação offline. Validar no client exigiria o segredo no aparelho, e isso anularia o modelo. O freela sem rede cai na contingência.
- O guard ganha mais um ramo, e o `applications_update_guard` é contrato sensível.

## Alternativas rejeitadas
- **TOTP calculado no aparelho do responsável (funciona offline):** distribui o segredo para N celulares de encarregados. Um vazamento invalida o local inteiro.
- **Validar o QR/GPS no client e mandar só o carimbo:** é o mesmo erro do QR antigo.
- **Gravar lat/lng do freela "para auditoria":** a distância e a precisão respondem à pergunta, e a coordenada bruta é dado de localização sem necessidade.
- **Bloquear o pagamento sem verificação:** no modo A não há dinheiro passando pelo Worki para bloquear, e puniria a falha de GPS em ambiente fechado.
- **Raio só pela precisão reportada (`distance <= radius + accuracy`):** uma precisão de 2 km aprovaria qualquer pessoa na cidade.
- **Geocodificação paga (Google):** é custo e dependência nova para algo que o GPS no local resolve melhor.

## Referências
- Spec: `.harness/spec/presenca-verificada/spec.md`
- Guard: `supabase/migrations/20261125000200_*.sql`; janela: `frontend/src/lib/checkinWindow.ts`
- MDN `GeolocationCoordinates.accuracy`: https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy
- MDN Permissions-Policy geolocation: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/geolocation
- Política de uso do Nominatim (1 req/s, atribuição): https://operations.osmfoundation.org/policies/nominatim/
- Política de tiles OSM: https://operations.osmfoundation.org/policies/tiles/
- RFC 6238 (TOTP; janela de passo): https://www.rfc-editor.org/rfc/rfc6238
- LGPD, art. 7º: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
