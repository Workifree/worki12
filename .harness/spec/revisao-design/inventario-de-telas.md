# Inventário de telas e estados do Worki

> Levantado do código (App.tsx, ProtectedRoute, layouts, páginas, componentes e services).
> A parte coberta é **gerada** de `scripts/galeria-telas/cenarios/` (`node gerar-inventario.mjs`); não editar à mão.
> Reproduzir um estado: `node run.mjs --so=<id>`. "Coberto" = há cenário declarado; se a foto confirmou o estado está em `index.md` da execução.

**Estados inventariados: 441** · com cenário: **425** · sem cenário: **16** (itens agrupados).

## Regras que decidem o que aparece

| Regra | Onde |
|---|---|
| Rota protegida: sem sessão vai a `/`; verificação que falha ou passa de 20s mostra ErroDeVerificacao | ProtectedRoute |
| Freela sem `onboarding_completed` vai a `/worker/onboarding`; empresa sem linha em `get_my_companies` vai a `/company/onboarding` | ProtectedRoute |
| Sem empresa: marca de membro = AcessoEncerrado; token de equipe pendente = volta ao convite | ProtectedRoute |
| Encarregado com `confirmed=false` só vê AguardandoConfirmacao | ProtectedRoute |
| `accepted_tos=false` fora do onboarding = TosGateModal | ProtectedRoute |
| Papel errado na rota = redireciona com aviso; Encarregado fora do perfil e onboarding da empresa | ProtectedRoute |
| Relatório, Operação, Unidades, Indicações e Equipe: só Gestor (SemAcesso); Unidades só dono/operador | GestorRouteGuard, lib/navigation |
| Menu ganha Hoje/Equipe com `team_enabled` ou papel encarregado | companyScopeService |
| InviteTakeover em qualquer tela do freela com convite pendente | MainLayout |
| Convite de instalar após 6s, fora de login/convite/onboarding; atualização tem prioridade | PwaPrompts |
| `/admin` exige sessão; e-mail fora de `VITE_ADMIN_EMAILS` vê o login com "Acesso negado" | App, Admin |

## publico (7)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `publico-escolha-de-papel` | visitante sem sessão | `/` | sem sessão em / | mundo padrão do papel |
| `publico-landing-sobre` | visitante sem sessão | `/sobre` | pública | mundo padrão do papel |
| `publico-termos` | visitante sem sessão | `/termos` | pública | mundo padrão do papel |
| `publico-privacidade` | visitante sem sessão | `/privacidade` | pública | mundo padrão do papel |
| `publico-ajuda` | visitante sem sessão | `/ajuda` | pública | mundo padrão do papel |
| `publico-regulamento-trilha` | visitante sem sessão | `/regulamento-trilha` | pública, versionada | mundo padrão do papel |
| `publico-404` | visitante sem sessão | `/rota-que-nao-existe` | path="*" | mundo padrão do papel |

## acesso (19)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `acesso-login-freela` | visitante sem sessão | `/login?type=work` | type=work | mundo padrão do papel |
| `acesso-login-empresa` | visitante sem sessão | `/login?type=hire` | type=hire | mundo padrão do papel |
| `acesso-login-sessao-expirada` | visitante sem sessão | `/login?reason=session_expired` | reason=session_expired | mundo padrão do papel |
| `acesso-cadastro` | visitante sem sessão | `/login?type=work&cadastro=1` | cadastro=1 | mundo padrão do papel |
| `acesso-cadastro-forca-senha` | visitante sem sessão | `/login?type=hire&cadastro=1` | senha digitada mostra a força | passos: preencher |
| `acesso-cadastro-confirmar-email` | visitante sem sessão | `/login?type=work&cadastro=1` | signUp sem sessão devolvida | passos: preencher > preencher > clicar (css) |
| `acesso-cadastro-email-ja-existe` | visitante sem sessão | `/login?type=work&cadastro=1` | identities vazio | mundo: `(m) => { m.auth.signup = () => ({ body: { ...m.usuarioNovo, identities: [] } }); }`; passos: preencher > preencher > clicar (css) |
| `acesso-login-senha-errada` | visitante sem sessão | `/login?type=work` | Invalid login credentials | mundo: `(m) => { m.auth[nome] = () => ({ status, body: { code, error_code: code, msg, message: msg, error_description:...`; passos: preencher > preencher > clicar (css) |
| `acesso-login-email-nao-confirmado` | visitante sem sessão | `/login?type=work` | Email not confirmed | mundo: `(m) => { m.auth[nome] = () => ({ status, body: { code, error_code: code, msg, message: msg, error_description:...`; passos: preencher > preencher > clicar (css) |
| `acesso-login-muitas-tentativas` | visitante sem sessão | `/login?type=work` | status 429 | mundo: `(m) => { m.auth[nome] = () => ({ status, body: { code, error_code: code, msg, message: msg, error_description:...`; passos: preencher > preencher > clicar (css) |
| `acesso-login-sem-internet` | visitante sem sessão | `/login?type=work` | fetch falha | mundo: `(m) => { m.falhas['auth:token'] = 'rede'; }`; passos: preencher > preencher > clicar (css) |
| `acesso-login-papel-errado` | visitante sem sessão | `/login?type=hire` | conta de freela entrando por type=hire | passos: preencher > preencher > clicar (css) |
| `acesso-esqueci-senha` | visitante sem sessão | `/esqueci-senha` | pública | mundo padrão do papel |
| `acesso-esqueci-senha-email-invalido` | visitante sem sessão | `/esqueci-senha` | validação nativa do navegador (balão do Chrome) | passos: preencher > clicar (css) |
| `acesso-esqueci-senha-enviado` | visitante sem sessão | `/esqueci-senha` | recover ok (com espera para reenviar) | passos: preencher > clicar (css) |
| `acesso-redefinir-senha` | freela | `/redefinir-senha` | link de recuperação (sessão) | mundo padrão do papel |
| `acesso-redefinir-senha-diferentes` | freela | `/redefinir-senha` | confirmação não bate | passos: preencher > preencher > clicar (css) |
| `acesso-redefinir-senha-ok` | freela | `/redefinir-senha` | updateUser ok | passos: preencher > preencher > clicar (css) |
| `acesso-redefinir-senha-link-expirado` | freela | `/redefinir-senha` | updateUser: token expirado | mundo: `(m) => { m.auth.user = (corpo) => (corpo ? { status: 422, body: { msg: 'Token has expired', message: 'Token ha...`; passos: preencher > preencher > clicar (css) |

## onboarding (22)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `onboarding-freela-redirecionado` | freela | `/dashboard` | gate: onboarding incompleto redireciona | mundo: `(m) => { m.eu().onboarding_completed = false; m.eu().accepted_tos = false; }` |
| `onboarding-freela-passo1-vazio` | freela | `/worker/onboarding` | onboarding_completed=false | mundo: `(m) => { novoFreela(m); extra.prep?.(m); }` |
| `onboarding-freela-passo1-pix-invalida` | freela | `/worker/onboarding` | CPF inválido como chave PIX | mundo: `(m) => { novoFreela(m); extra.prep?.(m); }`; passos: preencher > preencher > preencher > preencher > preencher > preencher |
| `onboarding-freela-passo1-pix-email` | freela | `/worker/onboarding` | tipo e-mail com valor inválido | mundo: `(m) => { novoFreela(m); extra.prep?.(m); }`; passos: preencher > preencher > preencher > preencher > preencher > selecionar > preencher |
| `onboarding-freela-passo1-preenchido` | freela | `/worker/onboarding` | onboarding_completed=false | mundo: `(m) => { novoFreela(m); extra.prep?.(m); }`; passos: preencher > preencher > preencher > preencher > preencher > preencher |
| `onboarding-freela-passo2-vazio` | freela | `/worker/onboarding` | sem especialidade e experiência | mundo: `(m) => { novoFreela(m); extra.prep?.(m); }`; passos: preencher > preencher > preencher > preencher > preencher > preencher > clicar /^Próximo/ |
| `onboarding-freela-passo2-preenchido` | freela | `/worker/onboarding` | onboarding_completed=false | mundo: `(m) => { novoFreela(m); extra.prep?.(m); }`; passos: preencher > preencher > preencher > preencher > preencher > preencher > clicar /^Próximo/ > clicar /^Garçom$/ > clicar /^Barista$/ > selecionar > preencher |
| `onboarding-freela-passo3-vazio` | freela | `/worker/onboarding` | sem disponibilidade e Termos | mundo: `(m) => { novoFreela(m); extra.prep?.(m); }`; passos: preencher > preencher > preencher > preencher > preencher > preencher > clicar /^Próximo/ > clicar /^Garçom$/ > clicar /^Barista$/ > selecionar > preencher > clicar /^Próximo/ |
| `onboarding-freela-passo3-preenchido` | freela | `/worker/onboarding` | pronto para finalizar | mundo: `(m) => { novoFreela(m); extra.prep?.(m); }`; passos: preencher > preencher > preencher > preencher > preencher > preencher > clicar /^Próximo/ > clicar /^Garçom$/ > clicar /^Barista$/ > selecionar > preencher > clicar /^Próximo/ > clicar /^Noite$/ > clicar /^Fim de Semana$/ > clicar (css) |
| `onboarding-freela-erro-ao-salvar` | freela | `/worker/onboarding` | upsert falha: aviso | mundo: `(m) => { novoFreela(m); extra.prep?.(m); }`; passos: preencher > preencher > preencher > preencher > preencher > preencher > clicar /^Próximo/ > clicar /^Garçom$/ > clicar /^Barista$/ > selecionar > preencher > clicar /^Próximo/ > clicar /^Noite$/ > clicar (css) > ligar falha > clicar /^Finalizar/ |
| `onboarding-freela-sair-armado` | freela | `/worker/onboarding` | saída pede segundo toque | mundo: `(m) => { novoFreela(m); extra.prep?.(m); }`; passos: clicar Sair e voltar |
| `onboarding-empresa-redirecionada` | empresa (dona/Gestor) | `/company/dashboard` | gate: sem empresa vai ao onboarding | mundo: `(m) => { m.rpc.get_my_companies = []; m.db.companies = []; }` |
| `onboarding-empresa-passo1-vazio` | empresa (dona/Gestor) | `/company/onboarding` | get_my_companies vazio | mundo: `(m) => { novaEmpresa(m); extra.prep?.(m); }` |
| `onboarding-empresa-passo1-cnpj-invalido` | empresa (dona/Gestor) | `/company/onboarding` | dígitos do CNPJ inválidos | mundo: `(m) => { novaEmpresa(m); extra.prep?.(m); }`; passos: preencher > preencher > selecionar > selecionar > preencher > clicar /^Próximo/ |
| `onboarding-empresa-passo1-cpf-invalido` | empresa (dona/Gestor) | `/company/onboarding` | dígitos do CPF inválidos | mundo: `(m) => { novaEmpresa(m); extra.prep?.(m); }`; passos: preencher > preencher > selecionar > selecionar > preencher > clicar /^Próximo/ |
| `onboarding-empresa-passo1-preenchido` | empresa (dona/Gestor) | `/company/onboarding` | dados válidos | mundo: `(m) => { novaEmpresa(m); extra.prep?.(m); }`; passos: preencher > preencher > selecionar > selecionar > preencher |
| `onboarding-empresa-passo2-vazio` | empresa (dona/Gestor) | `/company/onboarding` | sem objetivo, volume e Termos | mundo: `(m) => { novaEmpresa(m); extra.prep?.(m); }`; passos: preencher > preencher > selecionar > selecionar > preencher > clicar /^Próximo/ |
| `onboarding-empresa-passo2-preenchido` | empresa (dona/Gestor) | `/company/onboarding` | pronto para finalizar | mundo: `(m) => { novaEmpresa(m); extra.prep?.(m); }`; passos: preencher > preencher > selecionar > selecionar > preencher > clicar /^Próximo/ > clicar (css) > marcar > clicar (css) |
| `onboarding-empresa-sair-armado` | empresa (dona/Gestor) | `/company/onboarding` | saída pede segundo toque | mundo: `(m) => { novaEmpresa(m); extra.prep?.(m); }`; passos: clicar Sair e voltar |
| `onboarding-termos-gate-freela` | freela | `/dashboard` | accepted_tos=false (TosGateModal) | mundo: `(m) => { m.eu().accepted_tos = false; }` |
| `onboarding-termos-gate-empresa` | empresa (dona/Gestor) | `/company/dashboard` | accepted_tos=false (TosGateModal) | mundo: `(m) => m.empresa({ accepted_tos: false })` |
| `onboarding-termos-gate-erro-ao-salvar` | freela | `/dashboard` | gravação do aceite falha | mundo: `(m) => { m.eu().accepted_tos = false; }`; passos: clicar (css) > ligar falha > clicar (css) |

## convite-elenco (11)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `convite-elenco-deslogado-vai-ao-login` | visitante sem sessão | `/convite/MDAwMDAwMDItMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAx` | sem sessão: guarda o token e manda ao login | mundo padrão do papel |
| `convite-elenco-contato-freela-deslogado` | visitante sem sessão | `/convite/w_MDAwMDAwMDEtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAx` | token w_ deslogado: login de empresa | mundo padrão do papel |
| `convite-elenco-processando` | freela | `/convite/MDAwMDAwMDItMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAx` | RPC em andamento | mundo: `(m) => { m.falhas['rpc:accept_company_invite_by_token'] = 'pendura'; }` |
| `convite-elenco-aceito` | freela | `/convite/MDAwMDAwMDItMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAx` | success | mundo: `(m) => { m.db.team_connections = m.db.team_connections.filter((x) => x.worker_id !== ID.freela); }` |
| `convite-elenco-freela-convidado` | empresa (dona/Gestor) | `/convite/w_MDAwMDAwMDEtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAx` | empresa abre link de contato (success) | mundo: `(m) => { m.db.team_connections = []; }` |
| `convite-elenco-ja-no-elenco` | empresa (dona/Gestor) | `/convite/w_MDAwMDAwMDEtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAx` | alreadyExists | mundo padrão do papel |
| `convite-elenco-bloqueado` | empresa (dona/Gestor) | `/convite/w_MDAwMDAwMDEtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAx` | conexão blocked (mensagem neutra) | mundo: `(m) => { m.db.team_connections[0].status = 'blocked'; }` |
| `convite-elenco-papel-errado` | empresa (dona/Gestor) | `/convite/MDAwMDAwMDItMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAx` | empresa abre link de elenco (not_a_worker) | mundo: `(m) => { m.falhas['rpc:${nome}'] = { status: 400, body: { message, code: 'P0001' } }; }` |
| `convite-elenco-invalido` | freela | `/convite/MDAwMDAwMDItMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAx` | invalid_token | mundo: `(m) => { m.falhas['rpc:${nome}'] = { status: 400, body: { message, code: 'P0001' } }; }` |
| `convite-elenco-empresa-inexistente` | freela | `/convite/MDAwMDAwMDItMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAx` | company_not_found | mundo: `(m) => { m.falhas['rpc:${nome}'] = { status: 400, body: { message, code: 'P0001' } }; }` |
| `convite-elenco-sem-conexao` | freela | `/convite/MDAwMDAwMDItMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAx` | sessão indisponível | mundo: `(m) => { m.falhas['auth:user'] = 'rede'; }` |

## convite-gerente (10)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `convite-gerente-deslogado-vai-ao-login` | visitante sem sessão | `/convite-gerente/token-gerente-falso` | sem sessão: login type=hire | mundo padrão do papel |
| `convite-gerente-processando` | empresa (dona/Gestor) | `/convite-gerente/token-gerente-falso` | RPC em andamento | mundo: `(m) => { m.falhas['rpc:accept_manager_invite'] = 'pendura'; }` |
| `convite-gerente-accepted` | empresa (dona/Gestor) | `/convite-gerente/token-gerente-falso` | accept_manager_invite outcome=accepted | mundo: `(m) => { m.rpc.accept_manager_invite = { outcome: o }; }` |
| `convite-gerente-already-accepted` | empresa (dona/Gestor) | `/convite-gerente/token-gerente-falso` | accept_manager_invite outcome=already_accepted | mundo: `(m) => { m.rpc.accept_manager_invite = { outcome: o }; }` |
| `convite-gerente-token-already-used` | empresa (dona/Gestor) | `/convite-gerente/token-gerente-falso` | accept_manager_invite outcome=token_already_used | mundo: `(m) => { m.rpc.accept_manager_invite = { outcome: o }; }` |
| `convite-gerente-revoked` | empresa (dona/Gestor) | `/convite-gerente/token-gerente-falso` | accept_manager_invite outcome=revoked | mundo: `(m) => { m.rpc.accept_manager_invite = { outcome: o }; }` |
| `convite-gerente-expired` | empresa (dona/Gestor) | `/convite-gerente/token-gerente-falso` | accept_manager_invite outcome=expired | mundo: `(m) => { m.rpc.accept_manager_invite = { outcome: o }; }` |
| `convite-gerente-worker-cannot-be-manager` | empresa (dona/Gestor) | `/convite-gerente/token-gerente-falso` | accept_manager_invite outcome=worker_cannot_be_manager | mundo: `(m) => { m.rpc.accept_manager_invite = { outcome: o }; }` |
| `convite-gerente-not-found` | empresa (dona/Gestor) | `/convite-gerente/token-gerente-falso` | accept_manager_invite outcome=not_found | mundo: `(m) => { m.rpc.accept_manager_invite = { outcome: o }; }` |
| `convite-gerente-sem-conexao` | empresa (dona/Gestor) | `/convite-gerente/token-gerente-falso` | sessão indisponível | mundo: `(m) => { m.falhas['auth:user'] = 'rede'; }` |

## convite-equipe (30)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `convite-equipe-abrindo` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | prévia carregando | mundo: `(m) => { m.falhas['rpc:get_member_invite_preview'] = 'pendura'; }` |
| `convite-equipe-deslogado-email` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | prévia ok, sem sessão | mundo padrão do papel |
| `convite-equipe-email-invalido` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | validação local | passos: preencher > clicar Receber código |
| `convite-equipe-sem-aceitar-termos` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | Termos obrigatórios | passos: preencher > clicar Receber código |
| `convite-equipe-limite-de-codigo` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | otp 429 | mundo: `(m) => { m.auth.otp = () => ({ status: 429, body: { msg: 'rate limit', message: 'rate limit' } }); }`; passos: preencher > marcar > clicar Receber código |
| `convite-equipe-falha-ao-enviar-codigo` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | otp 500 | mundo: `(m) => { m.auth.otp = () => ({ status: 500, body: { msg: 'boom' } }); }`; passos: preencher > marcar > clicar Receber código |
| `convite-equipe-codigo` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | código enviado | passos: preencher > marcar > clicar Receber código |
| `convite-equipe-codigo-curto` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | menos de 6 dígitos | passos: preencher > marcar > clicar Receber código > preencher > clicar Entrar na equipe |
| `convite-equipe-codigo-errado` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | verifyOtp falha | mundo: `(m) => { m.auth.verify = () => ({ status: 403, body: { msg: 'Token has expired or is invalid', error_code: 'ot...`; passos: preencher > marcar > clicar Receber código > preencher > clicar Entrar na equipe |
| `convite-equipe-aceitando` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | aceite em andamento | mundo: `(m) => { semConta(m); m.falhas['rpc:accept_company_member_invite'] = 'pendura'; }`; passos: preencher > marcar > clicar Receber código > preencher > clicar Entrar na equipe |
| `convite-equipe-logado-confirmar` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | já há sessão de empresa | mundo padrão do papel |
| `convite-equipe-logado-freela` | freela | `/convite-equipe/token-de-equipe-falso-0001` | sessão de freela (papel errado) | mundo padrão do papel |
| `convite-equipe-ok-aguardando-confirmacao` | encarregado | `/convite-equipe/token-de-equipe-falso-0001` | accepted + não confirmado: tela de espera | mundo: `(m) => { m.empresa({ role: 'encarregado', confirmed: false }); m.db.jobs = []; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-ok` | encarregado | `/convite-equipe/token-de-equipe-falso-0001` | outcome=accepted: vai para Hoje | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-ja-usado-por-mim` | encarregado | `/convite-equipe/token-de-equipe-falso-0001` | outcome=already_accepted: vai para Hoje | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-ja-opera-a-empresa` | encarregado | `/convite-equipe/token-de-equipe-falso-0001` | outcome=already_operator: vai para Hoje | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-tos-requerido` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | outcome=tos_required | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-desfecho-expired` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | accept outcome=expired | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-desfecho-revoked` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | accept outcome=revoked | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-desfecho-token-already-used` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | accept outcome=token_already_used | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-desfecho-not-found` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | accept outcome=not_found | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-desfecho-worker-cannot-be-manager` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | accept outcome=worker_cannot_be_manager | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-desfecho-use-manager-invite` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | accept outcome=use_manager_invite | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-desfecho-email-not-verified` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | accept outcome=email_not_verified | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-desfecho-invalid-input` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | accept outcome=invalid_input | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-desfecho-unauthenticated` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | accept outcome=unauthenticated | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-desfecho-error` | empresa (dona/Gestor) | `/convite-equipe/token-de-equipe-falso-0001` | accept outcome=error | mundo: `(m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; }`; passos: marcar > clicar Entrar na equipe |
| `convite-equipe-previa-inexistente` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | prévia not_found | mundo: `(m) => { m.rpc.get_member_invite_preview = v; }` |
| `convite-equipe-previa-vencida` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | prévia expired | mundo: `(m) => { m.rpc.get_member_invite_preview = v; }` |
| `convite-equipe-previa-sem-rede` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | prévia falha | mundo: `(m) => { m.falhas['rpc:get_member_invite_preview'] = 'erro'; }` |

## freela-telas (22)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `freela-telas-inicio` | freela | `/dashboard` | com próximo turno e recebimento a confirmar | mundo padrão do papel |
| `freela-telas-inicio-com-convite` | freela | `/dashboard` | convite pendente, takeover fechado | mundo: `(m) => { comConvite()(m); m.db.shift_payments = []; }`; passos: clicar Fechar aviso de convite |
| `freela-telas-inicio-vazio` | freela | `/dashboard` | conta nova sem nada | mundo: `(m) => { vazio(m); Object.assign(m.eu(), { xp: 0, level: 1, rating_average: null, reviews_count: 0, completed_...` |
| `freela-telas-inicio-carregando` | freela | `/dashboard` | consultas penduradas | mundo: `(m) => { for (const t of tabelas) m.falhas['rest:${t}'] = tipo; }` |
| `freela-telas-inicio-erro-parcial` | freela | `/dashboard` | parte das consultas falha (ErroDeCarga) | mundo: `(m) => { for (const t of tabelas) m.falhas['rest:${t}'] = tipo; }` |
| `freela-telas-carteira` | freela | `/carteira` | empresas do elenco + convite de elenco pendente | mundo padrão do papel |
| `freela-telas-carteira-vazia` | freela | `/carteira` | sem conexões | mundo: `(m) => { m.vazio(...TABELAS); m.rpc.get_worker_company_badges = []; m.rpc.get_profile_reviews = []; m.rpc.list...` |
| `freela-telas-carteira-erro` | freela | `/carteira` | falha de carga | mundo: `(m) => { for (const t of tabelas) m.falhas['rest:${t}'] = tipo; }` |
| `freela-telas-carteira-sair-empresa` | freela | `/carteira` | confirmação de sair do elenco | passos: clicar (css) |
| `freela-telas-carteira-recusar-elenco` | freela | `/carteira` | recusar convite de elenco | passos: clicar /^Recusar/ |
| `freela-telas-empresa-publica` | freela | `/empresa/00000002-0000-4000-8000-000000000001` | perfil público antes de aceitar convite | mundo padrão do papel |
| `freela-telas-empresa-publica-sem-avaliacao` | freela | `/empresa/00000002-0000-4000-8000-000000000003` | sem nota nem avaliações | mundo: `(m) => { m.rpc.get_profile_reviews = []; }` |
| `freela-telas-empresa-publica-inexistente` | freela | `/empresa/00000009-0000-4000-8000-000000000009` | id inexistente | mundo padrão do papel |
| `freela-telas-indicacoes` | freela | `/indicacoes` | indicação aguardando o freela | mundo padrão do papel |
| `freela-telas-indicacoes-vazio` | freela | `/indicacoes` | sem indicação | mundo: `(m) => { m.db.worker_referrals = []; }` |
| `freela-telas-mensagens` | freela | `/messages` | lista de conversas | mundo padrão do papel |
| `freela-telas-mensagens-conversa` | freela | `/messages?conversation=00000095-0000-4000-8000-000000000001` | conversa aberta | mundo padrão do papel |
| `freela-telas-mensagens-vazio` | freela | `/messages` | sem conversa | mundo: `(m) => { m.vazio(...TABELAS); m.rpc.get_worker_company_badges = []; m.rpc.get_profile_reviews = []; m.rpc.list...` |
| `freela-telas-mensagens-erro` | freela | `/messages` | falha de carga | mundo: `(m) => { for (const t of tabelas) m.falhas['rest:${t}'] = tipo; }` |
| `freela-telas-notificacoes` | freela | `/notifications` | lidas e não lidas | mundo padrão do papel |
| `freela-telas-notificacoes-vazio` | freela | `/notifications` | nenhuma | mundo: `(m) => { m.db.notifications = []; }` |
| `freela-telas-sino-aberto` | freela | `/dashboard` | dropdown do sino | passos: clicar (css) |

## freela-turnos (13)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `freela-turnos-convites` | freela | `/my-jobs` | aba Convites com chamado disputado | mundo: `(m) => { jaAvaliou(m); comConvite()(m); }`; passos: clicar Fechar aviso de convite |
| `freela-turnos-convites-vazio` | freela | `/my-jobs` | aba Convites vazia | mundo: `(m) => { vazio(m); }` |
| `freela-turnos-convite-recusa-armada` | freela | `/my-jobs` | recusar pede segundo toque | mundo: `(m) => { jaAvaliou(m); conviteLegado(m); }`; passos: clicar Fechar aviso de convite > clicar /^Recusar$/ |
| `freela-turnos-confirmar-presenca` | freela | `/my-jobs` | pedido de confirmação de véspera em aberto | mundo: `(m) => { m.db.reviews.push({ id: id(97, 5), job_id: m.job(3).id, reviewer_id: ID.freela, reviewed_id: ID.empre...` |
| `freela-turnos-presenca-respondida` | freela | `/my-jobs` | resposta enviada | mundo: `(m) => { jaAvaliou(m); m.rpc.respond_attendance_confirmation = { outcome: 'confirmed' }; }`; passos: clicar Sim, vou |
| `freela-turnos-em-andamento` | freela | `/my-jobs` | turno em andamento (check-out) | mundo: `(m) => { m.db.reviews.push({ id: id(97, 5), job_id: m.job(3).id, reviewer_id: ID.freela, reviewed_id: ID.empre...`; passos: clicar /^Em Andamento/ |
| `freela-turnos-agendados` | freela | `/my-jobs` | turnos agendados | mundo: `(m) => { m.db.reviews.push({ id: id(97, 5), job_id: m.job(3).id, reviewer_id: ID.freela, reviewed_id: ID.empre...`; passos: clicar /^Agendados/ |
| `freela-turnos-checkin` | freela | `/my-jobs` | turno de hoje aguardando chegada | mundo: `(m) => { jaAvaliou(m); const a = m.app(3); Object.assign(a, { status: 'hired', worker_checkin_at: null, compan...`; passos: clicar /^Em Andamento/ |
| `freela-turnos-historico` | freela | `/my-jobs` | concluídos e cancelados | mundo: `(m) => { m.db.reviews.push({ id: id(97, 5), job_id: m.job(3).id, reviewer_id: ID.freela, reviewed_id: ID.empre...`; passos: clicar /^Histórico/ |
| `freela-turnos-detalhe` | freela | `/my-jobs` | modal de detalhe do turno | mundo: `(m) => { m.db.reviews.push({ id: id(97, 5), job_id: m.job(3).id, reviewer_id: ID.freela, reviewed_id: ID.empre...`; passos: clicar /^Histórico/ > clicar /Garçom para evento/ |
| `freela-turnos-cancelar-turno` | freela | `/my-jobs` | modal de cancelamento pelo freela | mundo: `(m) => { m.db.reviews.push({ id: id(97, 5), job_id: m.job(3).id, reviewer_id: ID.freela, reviewed_id: ID.empre...`; passos: clicar /^Agendados/ > clicar /^Cancelar turno/ |
| `freela-turnos-avaliar` | freela | `/my-jobs` | RateModal abre sozinho para turno concluído sem avaliação | mundo padrão do papel |
| `freela-turnos-erro` | freela | `/my-jobs` | falha de carga | mundo: `(m) => { for (const t of tabelas) m.falhas['rest:${t}'] = tipo; }` |

## freela-convite-turno (8)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `freela-convite-turno-chamado-disputado` | freela | `/dashboard` | InviteTakeover: chamado 1→N | mundo: `(m) => { m.db.shift_calls.push({ id: id(80, 5), job_id: m.job(5).id, company_id: ID.empresa, created_by: ID.em...` |
| `freela-convite-turno-chamado-individual` | freela | `/dashboard` | InviteTakeover: só um alvo | mundo: `(m) => { m.db.shift_calls.push({ id: id(80, 5), job_id: m.job(5).id, company_id: ID.empresa, created_by: ID.em...` |
| `freela-convite-turno-chamado-sos` | freela | `/dashboard` | InviteTakeover vindo de SOS (fora do elenco) | mundo: `(m) => { m.db.shift_calls.push({ id: id(80, 5), job_id: m.job(5).id, company_id: ID.empresa, created_by: ID.em...` |
| `freela-convite-turno-legado` | freela | `/dashboard` | InviteTakeover: application invited | mundo: `(m) => { m.db.applications.push({ id: id(30, 40), job_id: m.job(5).id, worker_id: ID.freela, status: 'invited'...` |
| `freela-convite-turno-recusa-armada` | freela | `/dashboard` | primeiro toque em Recusar | mundo: `(m) => { m.db.shift_calls.push({ id: id(80, 5), job_id: m.job(5).id, company_id: ID.empresa, created_by: ID.em...`; passos: clicar /^Recusar/ |
| `freela-convite-turno-aceito` | freela | `/dashboard` | claim_shift_slot=claimed | mundo: `(m) => { comConvite()(m); m.rpc.claim_shift_slot = (_a, w) => { w.db.shift_call_targets.at(-1).response = 'acc...`; passos: clicar /^Aceitar/ |
| `freela-convite-turno-perdeu-a-corrida` | freela | `/dashboard` | claim_shift_slot=filled | mundo: `(m) => { comConvite()(m); m.rpc.claim_shift_slot = { outcome: 'filled' }; }`; passos: clicar /^Aceitar/ |
| `freela-convite-turno-texto-longo` | freela | `/dashboard` | empresa, título, endereço e briefing longos | mundo: `(m) => { comConvite()(m); m.db.companies[0].name = 'Confeitaria, Cafeteria e Buffet para Eventos Corporativos ...` |

## pagamento-recibo (14)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `pagamento-recibo-recibo-registrado-confirmar` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | recorded sem confirmação + termo a aceitar | mundo padrão do papel |
| `pagamento-recibo-recibo-termo-aberto` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | termo expandido | passos: clicar Ler o termo inteiro |
| `pagamento-recibo-recibo-termo-marcado` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | termo lido e concordância marcada | passos: clicar Ler o termo inteiro > clicar (css) |
| `pagamento-recibo-recibo-sem-cpf` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | termo com CPF não informado (bloqueia aceite) | mundo: `(m) => { m.db.service_terms[0].term_text = m.db.service_terms[0].term_text.replace(/CPF [\d.-]+/, 'CPF: não in...` |
| `pagamento-recibo-recibo-confirmado` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | recebimento confirmado e termo aceito | mundo: `(m) => { soPagamento('recorded', { worker_confirmed_at: em(0, '09:00') })(m); Object.assign(m.db.service_terms...` |
| `pagamento-recibo-recibo-agendado` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | status scheduled: comprovante de agendamento | mundo: `(m) => { const p = m.db.shift_payments[0]; Object.assign(p, { status, ...extra }); if (status === 'scheduled')...` |
| `pagamento-recibo-recibo-estornado` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | voided não aparece: recibo não encontrado | mundo: `(m) => { const p = m.db.shift_payments[0]; Object.assign(p, { status, ...extra }); if (status === 'scheduled')...` |
| `pagamento-recibo-recibo-termo-falhou` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | leitura do termo falha: confirmação bloqueada | mundo: `(m) => { for (const t of tabelas) m.falhas['rest:${t}'] = tipo; }` |
| `pagamento-recibo-recibo-sem-presenca-nota` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | sem horários, dinheiro, com nota longa e valor zero | mundo: `(m) => { Object.assign(m.db.shift_payments[0], { amount: 0, source: 'cash', note: 'Pago em dinheiro no fim do ...` |
| `pagamento-recibo-recibo-empresa` | empresa (dona/Gestor) | `/recibo/00000020-0000-4000-8000-000000000003?worker=00000001-0000-4000-8000-000000000001` | empresa vê o recibo (aguarda aceite) | mundo padrão do papel |
| `pagamento-recibo-recibo-erro` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | falha de carga | mundo: `(m) => { for (const t of tabelas) m.falhas['rest:${t}'] = tipo; }` |
| `pagamento-recibo-recebimentos` | freela | `/recebimentos` | a confirmar, agendado, recebido, cancelado | mundo: `(m) => { m.db.shift_payments.forEach((p) => { p.worker_id = ID.freela; }); m.db.shift_payments[1].job_id = m.j...` |
| `pagamento-recibo-recebimentos-vazio` | freela | `/recebimentos` | sem pagamento | mundo: `(m) => { m.db.shift_payments = []; }` |
| `pagamento-recibo-recebimentos-erro` | freela | `/recebimentos` | falha de carga | mundo: `(m) => { for (const t of tabelas) m.falhas['rest:${t}'] = tipo; }` |

## freela-perfil (13)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `freela-perfil-visao` | freela | `/profile` | perfil completo: badges, certificações, SOS, indicações | mundo padrão do papel |
| `freela-perfil-vazio` | freela | `/profile` | sem CPF, PIX, disponibilidade, badges e certificados | mundo: `(m) => { Object.assign(m.eu(), { cpf: null, pix_key: null, bio: null, availability_days: null, availability: [...` |
| `freela-perfil-editando` | freela | `/profile` | modo edição (disponibilidade em grade) | passos: clicar /^Editar/ |
| `freela-perfil-badges-ocultos` | freela | `/profile` | chave-mestra de badges ligada | mundo: `(m) => { m.eu().badges_hidden = true; }` |
| `freela-perfil-badges-erro` | freela | `/profile` | RPC de selos falha | mundo: `(m) => { m.falhas['rpc:get_worker_company_badges'] = 'erro'; }` |
| `freela-perfil-sos-ligado` | freela | `/profile` | discoverable_for_sos=true | mundo: `(m) => { m.eu().discoverable_for_sos = true; m.eu().accepts_referrals = false; }` |
| `freela-perfil-certificacao-nova` | freela | `/profile` | modal de cadastro de certificação | passos: clicar /^Cadastrar$/ |
| `freela-perfil-certificacao-editar` | freela | `/profile` | editar certificação conferida | passos: clicar (css) |
| `freela-perfil-certificacao-excluir` | freela | `/profile` | confirmar exclusão | passos: clicar (css) |
| `freela-perfil-meu-qr` | freela | `/profile` | modal QR de identidade | passos: clicar /QR/ |
| `freela-perfil-conta` | freela | `/profile` | configurações de conta abertas | passos: clicar /Segurança\|Conta\|Configurações/ |
| `freela-perfil-excluir-conta` | freela | `/profile` | modal de exclusão de conta | passos: clicar /Segurança\|Conta\|Configurações/ > clicar Excluir minha conta |
| `freela-perfil-erro` | freela | `/profile` | falha ao carregar perfil | mundo: `(m) => { let n = 0; Object.defineProperty(m.falhas, 'rest:workers', { get: () => (++n > 1 ? 'erro' : undefined...` |

## empresa-painel (23)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `empresa-painel-inicio` | empresa (dona/Gestor) | `/company/dashboard` | dono sozinho, com pendências | mundo padrão do papel |
| `empresa-painel-inicio-com-equipe` | empresa (dona/Gestor) | `/company/dashboard` | team_enabled: navegação ganha Hoje e Equipe | mundo: `(m) => m.comEquipe()` |
| `empresa-painel-inicio-vazio` | empresa (dona/Gestor) | `/company/dashboard` | empresa nova, zero turnos | mundo: `(m) => { m.vazio('jobs', 'applications', 'shift_payments', 'team_connections', 'shift_calls', 'shift_call_targ...` |
| `empresa-painel-inicio-carregando` | empresa (dona/Gestor) | `/company/dashboard` | consultas penduradas | mundo: `(m) => { for (const x of tabelas) m.falhas['rest:${x}'] = tipo; }` |
| `empresa-painel-inicio-erro` | empresa (dona/Gestor) | `/company/dashboard` | todas as consultas falham (DEFEITO: a consulta de companies ignora o erro e o painel fica em esqueleto para sempre) | mundo: `(m) => { for (const x of tabelas) m.falhas['rest:${x}'] = tipo; }` |
| `empresa-painel-inicio-erro-turnos` | empresa (dona/Gestor) | `/company/dashboard` | só a consulta de turnos falha (DEFEITO: aparece 0 turnos e "Criar primeiro turno", sem erro) | mundo: `(m) => { for (const x of tabelas) m.falhas['rest:${x}'] = tipo; }` |
| `empresa-painel-inicio-atalho-trilha` | empresa (dona/Gestor) | `/company/dashboard` | inscrição ativa mostra atalho da trilha | mundo: `(m) => { m.rpc.bonus_get_my_trail = trilha('active'); }` |
| `empresa-painel-gestao` | empresa (dona/Gestor) | `/company/gestao` | hub Gestão (Gestor) | mundo padrão do papel |
| `empresa-painel-gestao-com-equipe-trilha` | empresa (dona/Gestor) | `/company/gestao` | equipe + trilha ativa | mundo: `(m) => { m.comEquipe(); m.rpc.bonus_get_my_trail = trilha('active'); }` |
| `empresa-painel-hoje-dono-sozinho` | empresa (dona/Gestor) | `/company/hoje` | sem equipe: sem filtros por pessoa | mundo padrão do papel |
| `empresa-painel-relatorio` | empresa (dona/Gestor) | `/company/relatorio` | relatório de ordens | mundo padrão do papel |
| `empresa-painel-relatorio-vazio` | empresa (dona/Gestor) | `/company/relatorio` | sem dados | mundo: `(m) => { m.vazio('jobs', 'applications', 'shift_payments', 'team_connections', 'shift_calls', 'shift_call_targ...` |
| `empresa-painel-relatorio-erro` | empresa (dona/Gestor) | `/company/relatorio` | falha de carga (DEFEITO: o service devolve vazio e a tela mostra R$ 0,00 em vez de erro) | mundo: `(m) => { for (const x of tabelas) m.falhas['rest:${x}'] = tipo; }` |
| `empresa-painel-operacao` | empresa (dona/Gestor) | `/company/operacao` | painel de operação com amostra | mundo padrão do papel |
| `empresa-painel-operacao-amostra-insuficiente` | empresa (dona/Gestor) | `/company/operacao` | sem fonte / amostra insuficiente | mundo: `(m) => { m.vazio('jobs', 'applications', 'shift_payments', 'team_connections', 'shift_calls', 'shift_call_targ...` |
| `empresa-painel-operacao-erro` | empresa (dona/Gestor) | `/company/operacao` | hasError | mundo: `(m) => { for (const x of tabelas) m.falhas['rest:${x}'] = tipo; }` |
| `empresa-painel-unidades` | empresa (dona/Gestor) | `/company/organization` | dono/operador de organização | mundo: `(m) => { m.db.company_members = [{ id: id(75, 30), company_id: ID.empresa, user_id: id(76, 30), role: 'manager...` |
| `empresa-painel-multi-unidade` | empresa (dona/Gestor) | `/company/dashboard` | operador com 3 unidades: seletor | mundo: `(m) => { const base = m.rpc.get_my_companies[0]; m.rpc.get_my_companies = [{ ...base, role: 'operator' }, { .....` |
| `empresa-painel-multi-unidade-organizacao` | empresa (dona/Gestor) | `/company/organization` | visão das 3 unidades | mundo: `(m) => { const base = m.rpc.get_my_companies[0]; m.rpc.get_my_companies = [base, { ...base, company_id: ID.emp...` |
| `empresa-painel-mensagens` | empresa (dona/Gestor) | `/company/messages` | lista de conversas | mundo padrão do papel |
| `empresa-painel-mensagens-conversa` | empresa (dona/Gestor) | `/company/messages?conversation=00000095-0000-4000-8000-000000000001` | conversa aberta | mundo padrão do papel |
| `empresa-painel-mensagens-vazio` | empresa (dona/Gestor) | `/company/messages` | sem conversas | mundo: `(m) => { m.vazio('jobs', 'applications', 'shift_payments', 'team_connections', 'shift_calls', 'shift_call_targ...` |
| `empresa-painel-notificacoes` | empresa (dona/Gestor) | `/company/notifications` | lista | mundo padrão do papel |

## empresa-turnos (27)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `empresa-turnos-lista` | empresa (dona/Gestor) | `/company/jobs` | abertos, em andamento, concluídos, série e chamado aberto | mundo padrão do papel |
| `empresa-turnos-lista-vazia` | empresa (dona/Gestor) | `/company/jobs` | nenhum turno | mundo: `(m) => { m.vazio('jobs', 'applications', 'shift_payments', 'team_connections', 'shift_calls', 'shift_call_targ...` |
| `empresa-turnos-lista-erro` | empresa (dona/Gestor) | `/company/jobs` | falha de carga | mundo: `(m) => { for (const x of tabelas) m.falhas['rest:${x}'] = tipo; }` |
| `empresa-turnos-busca-sem-resultado` | empresa (dona/Gestor) | `/company/jobs` | busca sem resultado | passos: preencher |
| `empresa-turnos-menu` | empresa (dona/Gestor) | `/company/jobs` | menu de ações do turno | passos: clicar (css) |
| `empresa-turnos-menu-serie` | empresa (dona/Gestor) | `/company/jobs` | menu de ocorrência de série | mundo: `(m) => { m.db.jobs = [m.job(4), m.job(5)]; }`; passos: clicar (css) |
| `empresa-turnos-excluir` | empresa (dona/Gestor) | `/company/jobs` | confirmar exclusão (menu do primeiro turno da lista cheia) | passos: clicar (css) > clicar /^Excluir/ |
| `empresa-turnos-menu-coberto` | empresa (dona/Gestor) | `/company/jobs` | um único turno (DEFEITO no celular: menu abre sob a barra inferior e o botão Criar turno; a página não rola e Excluir fica inalcançável) | mundo: `(m) => { m.db.jobs = [m.job(1)]; m.db.applications = []; m.db.shift_calls = []; }`; passos: clicar (css) |
| `empresa-turnos-serie-editar` | empresa (dona/Gestor) | `/company/jobs` | EditSeriesModal | mundo: `(m) => { m.db.jobs = [m.job(4), m.job(5)]; }`; passos: clicar (css) > clicar /Editar.*(série\|seguintes\|futur)/i |
| `empresa-turnos-serie-cancelar` | empresa (dona/Gestor) | `/company/jobs` | CancelSeriesModal com prévia | mundo: `(m) => { m.db.jobs = [m.job(4), m.job(5)]; m.rpc.stop_job_series = { outcome: 'ok', affected: 6, with_commitme...`; passos: clicar (css) > clicar /(Cancelar\|Encerrar\|Parar).*série/i |
| `empresa-turnos-serie-convidar` | empresa (dona/Gestor) | `/company/jobs` | InviteSeriesModal | mundo: `(m) => { m.db.jobs = [m.job(4), m.job(5)]; }`; passos: clicar (css) > clicar /Convidar.*série/i |
| `empresa-turnos-convidar-na-lista` | empresa (dona/Gestor) | `/company/jobs` | modal Convidar freela | passos: clicar /^Convidar/ |
| `empresa-turnos-criar` | empresa (dona/Gestor) | `/company/create` | formulário novo (com turnos anteriores como modelo) | mundo padrão do papel |
| `empresa-turnos-criar-validacao` | empresa (dona/Gestor) | `/company/create` | enviar vazio mostra erros | mundo: `(m) => { m.db.jobs = []; }`; passos: clicar (css) |
| `empresa-turnos-criar-serie` | empresa (dona/Gestor) | `/company/create` | repetição semanal ligada | passos: clicar /Repetir\|recorr/i |
| `empresa-turnos-criar-opcionais` | empresa (dona/Gestor) | `/company/create` | detalhes opcionais abertos | passos: clicar /Requisitos, briefing/ |
| `empresa-turnos-editar` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/edit` | edição de turno | mundo padrão do papel |
| `empresa-turnos-editar-erro` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/edit` | falha ao carregar para edição | mundo: `(m) => { for (const x of tabelas) m.falhas['rest:${x}'] = tipo; }` |
| `empresa-turnos-detalhe` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001` | detalhe do turno | mundo padrão do papel |
| `empresa-turnos-detalhe-menu` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001` | menu de ações | passos: clicar (css) |
| `empresa-turnos-detalhe-cancelar` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001` | CancelJobModal (R23: só quem opera em equipe) | mundo: `(m) => m.comEquipe()`; passos: clicar (css) > clicar /Cancelar turno/ |
| `empresa-turnos-detalhe-cancelado` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000006` | turno cancelado | mundo padrão do papel |
| `empresa-turnos-detalhe-erro` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001` | falha de carga | mundo: `(m) => { for (const x of tabelas) m.falhas['rest:${x}'] = tipo; }` |
| `empresa-turnos-criado-convidar` | empresa (dona/Gestor) | `/company/create` | turno salvo: painel Convidar freela | mundo: `(m) => { m.db.jobs = []; }`; passos: preencher > selecionar > preencher > preencher > preencher > preencher > preencher > preencher > clicar (css) |
| `empresa-turnos-criado-convidar-sem-elenco` | empresa (dona/Gestor) | `/company/create` | turno salvo com elenco vazio | mundo: `(m) => { semModelos(m); m.db.team_connections = []; }`; passos: preencher > selecionar > preencher > preencher > preencher > preencher > preencher > preencher > clicar (css) |
| `empresa-turnos-serie-criada` | empresa (dona/Gestor) | `/company/create` | create_job_series outcome=ok | mundo: `(m) => { semModelos(m); m.rpc.create_job_series = { outcome: 'ok', series_id: id(60, 9), occurrences: 6 }; }`; passos: preencher > selecionar > preencher > preencher > preencher > preencher > preencher > preencher > clicar /Repetir este turno\|Repetir\|recorr/i > preencher > clicar /^s[aá]b/i > clicar (css) |
| `empresa-turnos-serie-editar-previa` | empresa (dona/Gestor) | `/company/jobs` | prévia (dry run) da edição das próximas | mundo: `(m) => { m.db.jobs = [m.job(4), m.job(5)]; m.rpc.update_job_series_future = { outcome: 'ok', affected: 6, with...`; passos: clicar (css) > clicar /Editar.*(série\|seguintes\|futur)/i > preencher > clicar /^Continuar/ |

## empresa-presenca-pagamento (27)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `empresa-presenca-pagamento-turno-futuro` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | contratado, convidado, recusou, chamado aberto, véspera confirmada | mundo padrão do papel |
| `empresa-presenca-pagamento-sem-ninguem` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | nenhum freela no turno | mundo: `(m) => { m.db.applications = []; m.db.shift_calls = []; m.db.shift_call_targets = []; }` |
| `empresa-presenca-pagamento-convidar-do-elenco` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | modal Convidar Freela | mundo: `(m) => { m.db.applications = []; m.db.shift_calls = []; m.db.shift_call_targets = []; }`; passos: clicar Convidar Freela do Elenco |
| `empresa-presenca-pagamento-convite-expirado-reconvidar` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | invited vencido: Convidar outro | mundo: `(m) => { const a = m.app(n); m.db.applications = [Object.assign(a, extra)]; }`; passos: clicar /^Convidar outro/ |
| `empresa-presenca-pagamento-sem-resposta-vespera` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | pediu confirmação e não respondeu: substituto | mundo: `(m) => { soCand(1)(m); Object.assign(m.db.shift_attendance_confirmations[0], { source: 'manual', requested_by:...` |
| `empresa-presenca-pagamento-nao-vai` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | avisou que não vai | mundo: `(m) => { soCand(1)(m); m.db.shift_attendance_confirmations[0].response = 'cannot_attend'; }` |
| `empresa-presenca-pagamento-dispensar` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | modal Dispensar Freela | mundo: `(m) => { const a = m.app(n); m.db.applications = [Object.assign(a, extra)]; }`; passos: clicar /^Dispensar/ |
| `empresa-presenca-pagamento-confirmar-chegada` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000007/candidates` | freela marcou chegada, empresa confirma | mundo padrão do papel |
| `empresa-presenca-pagamento-presenca-manual` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000007/candidates` | modal de horário manual (freela sem check-in) | mundo: `(m) => { m.app(9).worker_checkin_at = null; }`; passos: clicar /^Confirmar Presença/ |
| `empresa-presenca-pagamento-saida-manual` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000002/candidates` | modal de saída manual | passos: clicar /^Registrar Saída/ |
| `empresa-presenca-pagamento-concluido-todos-estados` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000003/candidates` | registrado, agendado, confirmado e estornado | mundo padrão do papel |
| `empresa-presenca-pagamento-registrar-pagamento` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000003/candidates` | modal Registrar Pagamento com PIX | mundo: `(m) => { soCand(4)(m); m.db.shift_payments = []; }`; passos: clicar /^Registrar Pagamento/ |
| `empresa-presenca-pagamento-registrar-pagamento-sem-pix` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000003/candidates` | freela sem chave PIX, valor zero | mundo: `(m) => { semPagamento(m); m.eu().pix_key = null; m.job(3).budget = 0; }`; passos: clicar /^Registrar Pagamento/ |
| `empresa-presenca-pagamento-pagamento-registrado` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000003/candidates` | confirmação de sucesso | mundo: `(m) => { soCand(4)(m); m.db.shift_payments = []; }`; passos: clicar /^Registrar Pagamento/ > clicar /^Confirmar Registro/ |
| `empresa-presenca-pagamento-agendar-pagamento` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000003/candidates` | modal Agendar Pagamento | mundo: `(m) => { soCand(4)(m); m.db.shift_payments = []; }`; passos: clicar /^Agendar Pagamento/ |
| `empresa-presenca-pagamento-estornar` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000003/candidates` | modal Estornar/cancelar a partir de um pagamento agendado | mundo: `(m) => { const a = m.app(n); m.db.applications = [Object.assign(a, extra)]; }`; passos: clicar /^(Estornar\|Cancelar agendamento)/ |
| `empresa-presenca-pagamento-finalizado-registrado-sem-estorno` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000003/candidates` | DEFEITO: turno finalizado com pagamento registrado só oferece Ver Recibo (sem Estornar) | mundo: `(m) => { const a = m.app(n); m.db.applications = [Object.assign(a, extra)]; }` |
| `empresa-presenca-pagamento-avaliar` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000003/candidates` | empresa avalia freela | mundo: `(m) => { const a = m.app(n); m.db.applications = [Object.assign(a, extra)]; }`; passos: clicar /^Avaliar/ |
| `empresa-presenca-pagamento-confirmar-entrega-escrow` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000003/candidates` | legado com escrow: Confirmar Entrega | mundo: `(m) => { soCand(4, { status: 'in_progress' })(m); m.db.shift_payments = []; m.db.escrow_transactions = [{ id: ...`; passos: clicar /^Confirmar Entrega/ |
| `empresa-presenca-pagamento-carregando` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | consulta pendurada | mundo: `(m) => { for (const x of tabelas) m.falhas['rest:${x}'] = tipo; }` |
| `empresa-presenca-pagamento-erro` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | falha de carga | mundo: `(m) => { for (const x of tabelas) m.falhas['rest:${x}'] = tipo; }` |
| `empresa-presenca-pagamento-perfil-do-freela` | empresa (dona/Gestor) | `/company/worker/00000001-0000-4000-8000-000000000001` | perfil visto pela empresa com certificações e treinamentos | mundo padrão do papel |
| `empresa-presenca-pagamento-registrar-treinamento` | empresa (dona/Gestor) | `/company/worker/00000001-0000-4000-8000-000000000001` | modal Registrar Treinamento | passos: clicar /^Registrar/ |
| `empresa-presenca-pagamento-revogar-treinamento` | empresa (dona/Gestor) | `/company/worker/00000001-0000-4000-8000-000000000001` | modal Revogar com motivo | passos: clicar /^Revogar/ |
| `empresa-presenca-pagamento-freela-sem-certificacao` | empresa (dona/Gestor) | `/company/worker/00000010-0000-4000-8000-000000000005` | sem certificação nem histórico | mundo: `(m) => { m.db.worker_certifications = []; m.db.worker_trainings = []; m.rpc.get_profile_reviews = []; m.rpc.ge...` |
| `empresa-presenca-pagamento-freela-inexistente` | empresa (dona/Gestor) | `/company/worker/00000009-0000-4000-8000-000000000009` | id inexistente ou sem vínculo | mundo padrão do papel |
| `empresa-presenca-pagamento-pagamento-agendado-sucesso` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000003/candidates` | agendamento gravado | mundo: `(m) => { m.db.applications = [m.app(4)]; m.db.shift_payments = []; }`; passos: clicar /^Agendar Pagamento/ > preencher > clicar (css) |

## chamado-sos (16)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `chamado-sos-painel-aberto` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | chamado em aberto com respostas | mundo: `(m) => { m.db.shift_attendance_confirmations = []; }` |
| `chamado-sos-cancelar-chamado` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | confirmação de cancelar chamado | passos: clicar /Cancelar chamado\|Encerrar chamado\|^Cancelar$/ |
| `chamado-sos-modal-chamado` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | ShiftCallModal com listas, disponibilidade e risco de vínculo | mundo: `(m) => { m.db.applications = []; m.db.shift_calls = []; }`; passos: clicar /^Chamar Freelas/ |
| `chamado-sos-modal-chamado-selecionados` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | lista selecionada e aviso de menos alvos que vagas | mundo: `(m) => { m.db.applications = []; m.db.shift_calls = []; }`; passos: clicar /^Chamar Freelas/ > clicar /Turma de sábado/ |
| `chamado-sos-modal-chamado-elenco-vazio` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | elenco vazio | mundo: `(m) => { m.db.applications = []; m.db.team_connections = []; m.db.shift_calls = []; }`; passos: clicar /^Chamar Freelas/ |
| `chamado-sos-via-query` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates?chamar=1` | ?chamar=1 abre o modal | mundo padrão do papel |
| `chamado-sos-sos-elegivel` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | sos_call_eligibility.eligible | mundo: `(m) => { m.rpc.sos_call_eligibility = { eligible: reason === 'ok', reason, quota_week_left: 2, missing_slots: ...` |
| `chamado-sos-sos-modal` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | modal do SOS | mundo: `(m) => { m.rpc.sos_call_eligibility = { eligible: reason === 'ok', reason, quota_week_left: 2, missing_slots: ...`; passos: clicar SOS: fora do Elenco |
| `chamado-sos-sos-bloqueado-quota-open` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | SOS inelegível: quota_open | mundo: `(m) => { m.rpc.sos_call_eligibility = { eligible: reason === 'ok', reason, quota_week_left: 2, missing_slots: ...` |
| `chamado-sos-sos-bloqueado-quota-week` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | SOS inelegível: quota_week | mundo: `(m) => { m.rpc.sos_call_eligibility = { eligible: reason === 'ok', reason, quota_week_left: 2, missing_slots: ...` |
| `chamado-sos-sos-bloqueado-team-not-tried` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | SOS inelegível: team_not_tried | mundo: `(m) => { m.rpc.sos_call_eligibility = { eligible: reason === 'ok', reason, quota_week_left: 2, missing_slots: ...` |
| `chamado-sos-sos-bloqueado-team-call-still-open` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | SOS inelegível: team_call_still_open | mundo: `(m) => { m.rpc.sos_call_eligibility = { eligible: reason === 'ok', reason, quota_week_left: 2, missing_slots: ...` |
| `chamado-sos-sos-bloqueado-not-urgent` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | SOS inelegível: not_urgent | mundo: `(m) => { m.rpc.sos_call_eligibility = { eligible: reason === 'ok', reason, quota_week_left: 2, missing_slots: ...` |
| `chamado-sos-sos-bloqueado-already-filled` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | SOS inelegível: already_filled | mundo: `(m) => { m.rpc.sos_call_eligibility = { eligible: reason === 'ok', reason, quota_week_left: 2, missing_slots: ...` |
| `chamado-sos-chamado-sos-aberto` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | chamado de origem SOS: alvos ocultos | mundo: `(m) => { Object.assign(m.db.shift_calls[0], { origin: 'sos', targets_count: 18 }); m.db.shift_call_targets = [...` |
| `chamado-sos-chamado-expirado` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | prazo vencido com status ainda open (não há cron); DEFEITO: alvos sem resposta seguem "Aguardando" | mundo: `(m) => { m.db.shift_calls[0].expires_at = em(-1); }` |

## empresa-elenco (13)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `empresa-elenco-elenco` | empresa (dona/Gestor) | `/company/team` | membros, pendentes, listas | mundo padrão do papel |
| `empresa-elenco-vazio` | empresa (dona/Gestor) | `/company/team` | elenco vazio | mundo: `(m) => { m.vazio('jobs', 'applications', 'shift_payments', 'team_connections', 'shift_calls', 'shift_call_targ...` |
| `empresa-elenco-adicionar` | empresa (dona/Gestor) | `/company/team` | AddWorkerModal | passos: clicar Adicionar Freela |
| `empresa-elenco-nova-lista` | empresa (dona/Gestor) | `/company/team` | TeamListModal (nova) | passos: clicar Nova lista |
| `empresa-elenco-editar-lista` | empresa (dona/Gestor) | `/company/team` | TeamListModal (editar) | passos: clicar (css) |
| `empresa-elenco-excluir-lista` | empresa (dona/Gestor) | `/company/team` | confirmação de exclusão | passos: clicar (css) |
| `empresa-elenco-convidar-para-turno` | empresa (dona/Gestor) | `/company/team` | InviteToShiftModal | passos: clicar Convidar para turno |
| `empresa-elenco-convidar-para-turno-sem-turno` | empresa (dona/Gestor) | `/company/team` | sem turno aberto | mundo: `(m) => { m.db.jobs = []; }`; passos: clicar Convidar para turno |
| `empresa-elenco-remover` | empresa (dona/Gestor) | `/company/team` | RemoveMemberDialog | passos: clicar (css) |
| `empresa-elenco-indicacoes-recebidas` | empresa (dona/Gestor) | `/company/indicacoes` | recebidas em 3 estados | mundo padrão do papel |
| `empresa-elenco-indicacoes-enviadas` | empresa (dona/Gestor) | `/company/indicacoes` | aba enviadas | passos: clicar /Enviadas/ |
| `empresa-elenco-indicacoes-vazio` | empresa (dona/Gestor) | `/company/indicacoes` | nenhuma recebida | mundo: `(m) => { m.vazio('jobs', 'applications', 'shift_payments', 'team_connections', 'shift_calls', 'shift_call_targ...` |
| `empresa-elenco-indicar` | empresa (dona/Gestor) | `/company/indicacoes` | CreateReferralModal | passos: clicar Indicar Freela |

## empresa-perfil (5)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `empresa-perfil-visao` | empresa (dona/Gestor) | `/company/profile` | dados da empresa | mundo padrão do papel |
| `empresa-perfil-vazio` | empresa (dona/Gestor) | `/company/profile` | campos nulos e sem nota | mundo: `(m) => { Object.assign(m.db.companies[0], { description: null, website: null, email: null, address: null, indu...` |
| `empresa-perfil-editando` | empresa (dona/Gestor) | `/company/profile` | modo edição | passos: clicar Editar Perfil |
| `empresa-perfil-conta` | empresa (dona/Gestor) | `/company/profile` | configurações de conta | passos: clicar /Configurações\|Segurança\|Conta/ |
| `empresa-perfil-excluir` | empresa (dona/Gestor) | `/company/profile` | modal de exclusão | passos: clicar /Configurações\|Segurança\|Conta/ > clicar /Excluir minha empresa\|Excluir/ |

## equipe-gestor (22)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `equipe-gestor-pessoas-vazio` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | dono sozinho: ninguém na equipe | mundo padrão do papel |
| `equipe-gestor-pessoas` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | aguardando confirmação, ativos, convidados, vencidos | mundo: `(m) => { m.comEquipe(); extra?.(m); }` |
| `equipe-gestor-carregando` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | lista pendurada | mundo: `(m) => { m.falhas['rpc:list_company_members'] = 'pendura'; }` |
| `equipe-gestor-erro` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | lista falha | mundo: `(m) => { m.falhas['rpc:list_company_members'] = 'erro'; }` |
| `equipe-gestor-rotacionar-link` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | elenco_link_rotation_pending | mundo: `(m) => { m.comEquipe(); extra?.(m); }` |
| `equipe-gestor-convidar` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | modal Convidar pessoa | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar /^Convidar pessoa/ |
| `equipe-gestor-convidar-validacao` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | gerar sem nome | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar /^Convidar pessoa/ > clicar Gerar convite |
| `equipe-gestor-convite-pronto` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | link gerado para WhatsApp | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar /^Convidar pessoa/ > preencher > clicar Gerar convite |
| `equipe-gestor-confirmar-pessoa` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | Gestor confirma ("é ele?") | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar /^Confirmar$/ |
| `equipe-gestor-confirmar-nome-errado` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | outcome=name_mismatch | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar /^Confirmar$/ > preencher > clicar Confirmar acesso |
| `equipe-gestor-rejeitar-pessoa` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | Não é essa pessoa | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar Não é essa pessoa |
| `equipe-gestor-remover-pessoa` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | dry run com turnos abertos e aviso de link | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar Remover da equipe |
| `equipe-gestor-hoje` | empresa (dona/Gestor) | `/company/hoje` | Hoje com filtros por pessoa e etiqueta | mundo: `(m) => { m.comEquipe(); extra?.(m); }` |
| `equipe-gestor-hoje-selecao` | empresa (dona/Gestor) | `/company/hoje` | barra de seleção em lote | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar (css) |
| `equipe-gestor-passar-turnos` | empresa (dona/Gestor) | `/company/hoje` | PassJobsModal | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar Passar para |
| `equipe-gestor-cobrir` | empresa (dona/Gestor) | `/company/hoje` | CoverageModal | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar /^Cobrir alguém\|^Cobrir meus turnos/ |
| `equipe-gestor-cobertura-ativa` | empresa (dona/Gestor) | `/company/hoje` | coberturas em andamento | mundo: `(m) => { m.comEquipe(); extra?.(m); }` |
| `equipe-gestor-cancelar-turno` | empresa (dona/Gestor) | `/company/hoje` | CancelJobModal na Hoje | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar /^Cancelar turno/ |
| `equipe-gestor-hoje-filtro-vazio` | empresa (dona/Gestor) | `/company/hoje` | filtro sem resultado | mundo: `(m) => { m.comEquipe(); extra?.(m); }` |
| `equipe-gestor-hoje-erro` | empresa (dona/Gestor) | `/company/hoje` | falha de carga | mundo: `(m) => { m.comEquipe(); extra?.(m); }` |
| `equipe-gestor-etiquetas` | empresa (dona/Gestor) | `/company/profile` | TagsPanel (empresa com equipe) | mundo: `(m) => { m.comEquipe(); extra?.(m); }`; passos: clicar /Etiquetas\|Configurações\|Segurança\|Conta/ |
| `equipe-gestor-criar-turno-com-etiqueta` | empresa (dona/Gestor) | `/company/create` | equipe: campo Etiqueta | mundo: `(m) => { m.comEquipe(); extra?.(m); }` |

## equipe-encarregado (13)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `equipe-encarregado-hoje` | encarregado | `/company/hoje` | só os próprios turnos | mundo padrão do papel |
| `equipe-encarregado-hoje-vazio` | encarregado | `/company/hoje` | sem turno | mundo: `(m) => { m.db.jobs = []; m.rpc.list_jobs_by_responsible = { outcome: 'ok', truncated: false, items: [] }; }` |
| `equipe-encarregado-inicio` | encarregado | `/company/dashboard` | painel restrito | mundo padrão do papel |
| `equipe-encarregado-turnos` | encarregado | `/company/jobs` | lista restrita | mundo padrão do papel |
| `equipe-encarregado-gestao` | encarregado | `/company/gestao` | hub sem itens de Gestor | mundo padrão do papel |
| `equipe-encarregado-presenca` | encarregado | `/company/jobs/00000020-0000-4000-8000-000000000007/candidates` | turno próprio (PII via RPC) | mundo padrão do papel |
| `equipe-encarregado-turno-de-outro` | encarregado | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | SemAcesso: turno de outra pessoa | mundo padrão do papel |
| `equipe-encarregado-detalhe-de-outro` | encarregado | `/company/jobs/00000020-0000-4000-8000-000000000001` | SemAcesso no detalhe | mundo padrão do papel |
| `equipe-encarregado-elenco` | encarregado | `/company/team` | Elenco único sem remover | mundo padrão do papel |
| `equipe-encarregado-sem-acesso-relatorio` | encarregado | `/company/relatorio` | GestorRouteGuard: SemAcesso | mundo padrão do papel |
| `equipe-encarregado-sem-acesso-equipe` | encarregado | `/company/configuracoes/equipe` | GestorRouteGuard: SemAcesso | mundo padrão do papel |
| `equipe-encarregado-sem-acesso-unidades` | encarregado | `/company/organization` | GestorRouteGuard: SemAcesso | mundo padrão do papel |
| `equipe-encarregado-perfil-redirecionado` | encarregado | `/company/profile` | perfil da empresa redireciona com aviso | mundo padrão do papel |

## equipe-acesso (12)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `equipe-acesso-aguardando-confirmacao` | encarregado | `/company/hoje` | encarregado com confirmed=false (R22) | mundo: `(m) => m.empresa({ role: 'encarregado', confirmed: false, team_enabled: true })` |
| `equipe-acesso-aguardando-via-onboarding` | encarregado | `/company/onboarding` | não escapa pela rota de onboarding | mundo: `(m) => m.empresa({ role: 'encarregado', confirmed: false, team_enabled: true })` |
| `equipe-acesso-acesso-encerrado` | encarregado | `/company/hoje` | sem empresa e com marca de membro (removido) | mundo: `(m) => { m.rpc.get_my_companies = []; }`; localStorage semeado |
| `equipe-acesso-retorno-ao-convite` | encarregado | `/company/hoje` | sem empresa e token de equipe pendente | mundo: `(m) => { m.rpc.get_my_companies = []; }`; sessionStorage semeado |
| `equipe-acesso-gerente-revogado-sem-marca` | encarregado | `/company/dashboard` | sem empresa e sem marca: onboarding | mundo: `(m) => { m.rpc.get_my_companies = []; m.db.companies = []; }` |
| `equipe-acesso-freela-em-rota-de-empresa` | freela | `/company/dashboard` | isolamento de papel com aviso | mundo padrão do papel |
| `equipe-acesso-empresa-em-rota-de-freela` | empresa (dona/Gestor) | `/my-jobs` | isolamento de papel com aviso | mundo padrão do papel |
| `equipe-acesso-verificacao-falhou-empresa` | empresa (dona/Gestor) | `/company/dashboard` | get_my_companies sem rede: ErroDeVerificacao | mundo: `(m) => { m.falhas['rpc:get_my_companies'] = 'rede'; }` |
| `equipe-acesso-verificacao-falhou-freela` | freela | `/dashboard` | leitura de workers falha: ErroDeVerificacao | mundo: `(m) => { m.falhas['rest:workers'] = 'erro'; }` |
| `equipe-acesso-verificacao-raiz-sem-rede` | freela | `/` | HomeRedirect sem rede | mundo: `(m) => { m.falhas['auth:user'] = 'rede'; }` |
| `equipe-acesso-verificando` | empresa (dona/Gestor) | `/company/dashboard` | gate carregando (spinner) | mundo: `(m) => { m.falhas['rpc:get_my_companies'] = 'pendura'; }` |
| `equipe-acesso-verificacao-timeout` | empresa (dona/Gestor) | `/company/dashboard` | passou de 20s: vira erro | mundo: `(m) => { m.falhas['rpc:get_my_companies'] = 'pendura'; }`; passos: esperar 21000ms |

## trilha (16)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `trilha-desligada` | empresa (dona/Gestor) | `/company/trilha` | enabled=false | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |
| `trilha-sem-inscricao` | empresa (dona/Gestor) | `/company/trilha` | not_enrolled | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |
| `trilha-sem-login-proprio` | empresa (dona/Gestor) | `/company/trilha` | identity_required | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |
| `trilha-convidada` | empresa (dona/Gestor) | `/company/trilha` | invited: aceite do regulamento | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |
| `trilha-convidada-cadastrar-pix` | empresa (dona/Gestor) | `/company/trilha` | convite: formulário da chave PIX | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }`; passos: clicar Cadastrar chave PIX |
| `trilha-aceite-falhou` | empresa (dona/Gestor) | `/company/trilha` | accept outcome=track_not_open | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }`; passos: clicar (css) > clicar Entrar na trilha |
| `trilha-ativa` | empresa (dona/Gestor) | `/company/trilha` | active com turnos quase lá e saque disponível | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |
| `trilha-ativa-inicial` | empresa (dona/Gestor) | `/company/trilha` | dia 1: dois marcos, nada disponível, sem PIX | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |
| `trilha-ativa-abaixo-do-minimo` | empresa (dona/Gestor) | `/company/trilha` | disponível menor que R$25 | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |
| `trilha-pagamento-solicitado` | empresa (dona/Gestor) | `/company/trilha` | requested_payout_cents | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |
| `trilha-celebracao` | empresa (dona/Gestor) | `/company/trilha` | marco conquistado ainda não celebrado | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |
| `trilha-todos-concluidos` | empresa (dona/Gestor) | `/company/trilha` | coleção completa e teto atingido | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |
| `trilha-encerrada` | empresa (dona/Gestor) | `/company/trilha` | ended | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |
| `trilha-erro` | empresa (dona/Gestor) | `/company/trilha` | falha ao carregar | mundo: `(m) => { m.falhas['rpc:bonus_get_my_trail'] = 'erro'; }` |
| `trilha-carregando` | empresa (dona/Gestor) | `/company/trilha` | consulta pendurada | mundo: `(m) => { m.falhas['rpc:bonus_get_my_trail'] = 'pendura'; }` |
| `trilha-encarregado-ativa` | encarregado | `/company/trilha` | trilha vista pelo Encarregado | mundo: `(m) => { m.rpc.bonus_get_my_trail = snap; }` |

## admin (12)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `admin-login` | visitante sem sessão | `/admin` | rota protegida sem sessão volta à raiz | mundo padrão do papel |
| `admin-acesso-negado` | empresa (dona/Gestor) | `/admin` | e-mail fora de ADMIN_EMAILS | mundo padrão do papel |
| `admin-visao-geral` | admin | `/admin` | aba dashboard | mundo padrão do papel |
| `admin-usuarios` | admin | `/admin` | aba usuários | passos: clicar /Usu[aá]rios/i |
| `admin-escrows` | admin | `/admin` | aba escrows | passos: clicar /Escrow\|Cust[oó]dia\|Reservas/i |
| `admin-bonus-conferencia` | admin | `/admin` | trilha: fila de conferência | passos: clicar /Trilha\|B[oô]nus/i > clicar /^Conferência$/i |
| `admin-bonus-inscricoes` | admin | `/admin` | trilha: inscrições | passos: clicar /Trilha\|B[oô]nus/i > clicar /^Inscrições$/i |
| `admin-bonus-pix` | admin | `/admin` | trilha: PIX da segunda, com bloqueado | passos: clicar /Trilha\|B[oô]nus/i > clicar /^PIX da segunda$/i |
| `admin-bonus-vetos` | admin | `/admin` | trilha: vetos e limiares | passos: clicar /Trilha\|B[oô]nus/i > clicar /^Vetos e limiares$/i |
| `admin-bonus-acompanhamento` | admin | `/admin` | trilha: acompanhamento | passos: clicar /Trilha\|B[oô]nus/i > clicar /^Acompanhamento$/i |
| `admin-bonus-vazio` | admin | `/admin` | filas vazias | mundo: `(m) => { m.fn['admin-data:bonus_review_queue'] = { items: [] }; }`; passos: clicar /Trilha\|B[oô]nus/i > clicar /^Conferência$/i |
| `admin-erro` | admin | `/admin` | edge function falha | mundo: `(m) => { m.falhas['fn:admin-data'] = 'erro'; }` |

## pwa-offline (8)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `pwa-offline-instalar-android` | freela | `/dashboard` | beforeinstallprompt após 6s | passos: script > esperar 6500ms |
| `pwa-offline-instalar-iphone` | freela | `/dashboard` | Safari iOS após 6s | user agent de iPhone; passos: esperar 6500ms |
| `pwa-offline-instalar-empresa` | empresa (dona/Gestor) | `/company/dashboard` | convite sobre o painel da empresa | passos: script > esperar 6500ms |
| `pwa-offline-atualizar` | freela | `/dashboard` | service worker novo esperando | script de inicialização no navegador; passos: script > esperar 800ms |
| `pwa-offline-faixa-sem-internet-freela` | freela | `/dashboard` | navigator.onLine=false | passos: cortar a rede |
| `pwa-offline-faixa-sem-internet-empresa` | empresa (dona/Gestor) | `/company/jobs` | navigator.onLine=false | passos: cortar a rede |
| `pwa-offline-faixa-sem-internet-chat` | freela | `/messages?conversation=00000095-0000-4000-8000-000000000001` | faixa descontada da altura do chat | passos: cortar a rede |
| `pwa-offline-faixa-sem-internet-modal` | empresa (dona/Gestor) | `/company/team` | offline com modal aberto | passos: clicar Adicionar Freela > cortar a rede |

## erros (3)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `erros-error-boundary-publico` | visitante sem sessão | `/ajuda` | exceção de render (módulo trocado pela galeria) | mundo: `(m) => { m.modulos = { [arquivo]: "export default function Quebrada() { throw new Error('galeria: erro simulad...` |
| `erros-error-boundary-logado` | empresa (dona/Gestor) | `/company/relatorio` | exceção de render numa página interna | mundo: `(m) => { m.modulos = { [arquivo]: "export default function Quebrada() { throw new Error('galeria: erro simulad...` |
| `erros-pagina-carregando` | visitante sem sessão | `/ajuda` | chunk da página demorando (PageLoader) | mundo: `(m) => { m.modulos = { '/src/pages/Help.tsx': 'await new Promise(() => {}); export default function X() { retu...`; script de inicialização no navegador |

## estresse (35)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `estresse-longos-inicio-freela` | freela | `/dashboard` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-meus-turnos` | freela | `/my-jobs` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-carteira` | freela | `/carteira` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-recebimentos` | freela | `/recebimentos` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-perfil-freela` | freela | `/profile` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-notificacoes` | freela | `/notifications` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-chat-freela` | freela | `/messages?conversation=00000095-0000-4000-8000-000000000001` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-empresa-publica` | freela | `/empresa/00000002-0000-4000-8000-000000000001` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-recibo` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-inicio-empresa` | empresa (dona/Gestor) | `/company/dashboard` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-turnos` | empresa (dona/Gestor) | `/company/jobs` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-detalhe-turno` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-presenca` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-elenco` | empresa (dona/Gestor) | `/company/team` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-hoje` | empresa (dona/Gestor) | `/company/hoje` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-relatorio` | empresa (dona/Gestor) | `/company/relatorio` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-operacao` | empresa (dona/Gestor) | `/company/operacao` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-perfil-empresa` | empresa (dona/Gestor) | `/company/profile` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-perfil-do-freela` | empresa (dona/Gestor) | `/company/worker/00000001-0000-4000-8000-000000000001` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-longos-chat-empresa` | empresa (dona/Gestor) | `/company/messages?conversation=00000095-0000-4000-8000-000000000001` | nomes, títulos, endereços e valores muito longos | mundo: `(m) => { m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : '${w.full_name} de ${PALAVRA_SEM_...` |
| `estresse-volume-meus-turnos` | freela | `/my-jobs` | dezenas de turnos, pessoas, pagamentos e avisos | mundo: `(m) => { const w0 = m.db.workers; const j0 = m.db.jobs; for (let i = 10; i < 90; i++) m.db.workers.push({ ...w...` |
| `estresse-volume-recebimentos` | freela | `/recebimentos` | dezenas de turnos, pessoas, pagamentos e avisos | mundo: `(m) => { const w0 = m.db.workers; const j0 = m.db.jobs; for (let i = 10; i < 90; i++) m.db.workers.push({ ...w...` |
| `estresse-volume-notificacoes` | freela | `/notifications` | dezenas de turnos, pessoas, pagamentos e avisos | mundo: `(m) => { const w0 = m.db.workers; const j0 = m.db.jobs; for (let i = 10; i < 90; i++) m.db.workers.push({ ...w...` |
| `estresse-volume-inicio-empresa` | empresa (dona/Gestor) | `/company/dashboard` | dezenas de turnos, pessoas, pagamentos e avisos | mundo: `(m) => { const w0 = m.db.workers; const j0 = m.db.jobs; for (let i = 10; i < 90; i++) m.db.workers.push({ ...w...` |
| `estresse-volume-turnos` | empresa (dona/Gestor) | `/company/jobs` | dezenas de turnos, pessoas, pagamentos e avisos | mundo: `(m) => { const w0 = m.db.workers; const j0 = m.db.jobs; for (let i = 10; i < 90; i++) m.db.workers.push({ ...w...` |
| `estresse-volume-presenca` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | dezenas de turnos, pessoas, pagamentos e avisos | mundo: `(m) => { const w0 = m.db.workers; const j0 = m.db.jobs; for (let i = 10; i < 90; i++) m.db.workers.push({ ...w...` |
| `estresse-volume-elenco` | empresa (dona/Gestor) | `/company/team` | dezenas de turnos, pessoas, pagamentos e avisos | mundo: `(m) => { const w0 = m.db.workers; const j0 = m.db.jobs; for (let i = 10; i < 90; i++) m.db.workers.push({ ...w...` |
| `estresse-volume-hoje` | empresa (dona/Gestor) | `/company/hoje` | dezenas de turnos, pessoas, pagamentos e avisos | mundo: `(m) => { const w0 = m.db.workers; const j0 = m.db.jobs; for (let i = 10; i < 90; i++) m.db.workers.push({ ...w...` |
| `estresse-volume-relatorio` | empresa (dona/Gestor) | `/company/relatorio` | dezenas de turnos, pessoas, pagamentos e avisos | mundo: `(m) => { const w0 = m.db.workers; const j0 = m.db.jobs; for (let i = 10; i < 90; i++) m.db.workers.push({ ...w...` |
| `estresse-volume-operacao` | empresa (dona/Gestor) | `/company/operacao` | dezenas de turnos, pessoas, pagamentos e avisos | mundo: `(m) => { const w0 = m.db.workers; const j0 = m.db.jobs; for (let i = 10; i < 90; i++) m.db.workers.push({ ...w...` |
| `estresse-longos-modal-chamado` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates?chamar=1` | modal de chamado com 80 pessoas e nomes longos | mundo: `(m) => { ambos(m); m.db.applications = []; m.db.shift_calls = []; }` |
| `estresse-longos-modal-lista` | empresa (dona/Gestor) | `/company/team` | TeamListModal com 80 pessoas | mundo: `(m) => { grande(m); textosLongos(m); }`; passos: clicar Nova lista |
| `estresse-longos-equipe` | empresa (dona/Gestor) | `/company/configuracoes/equipe` | nomes e e-mails longos na equipe | mundo: `(m) => { m.comEquipe(); m.rpc.list_company_members = { outcome: 'ok', items: pessoasDaEquipe().map((x) => ({ ....` |
| `estresse-longos-indicacoes` | empresa (dona/Gestor) | `/company/indicacoes` | indicação com nomes longos | mundo: `(m) => { const i = m.rpc.list_worker_referral_cards.items; i.forEach((x) => { x.card.full_name = NOME_LONGO; x...` |
| `estresse-longos-gate-equipe` | visitante sem sessão | `/convite-equipe/token-de-equipe-falso-0001` | nome de empresa longo no convite | mundo: `(m) => { m.rpc.get_member_invite_preview = { outcome: 'ok', company_name: '${EMPRESA_LONGA} ${PALAVRA_SEM_ESPA...` |

## nulos (18)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `nulos-inicio-freela` | freela | `/dashboard` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-meus-turnos` | freela | `/my-jobs` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-carteira` | freela | `/carteira` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-recebimentos` | freela | `/recebimentos` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-perfil-freela` | freela | `/profile` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-notificacoes` | freela | `/notifications` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-empresa-publica` | freela | `/empresa/00000002-0000-4000-8000-000000000001` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-recibo` | freela | `/recibo/00000020-0000-4000-8000-000000000003` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-inicio-empresa` | empresa (dona/Gestor) | `/company/dashboard` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-turnos` | empresa (dona/Gestor) | `/company/jobs` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-detalhe-turno` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-presenca` | empresa (dona/Gestor) | `/company/jobs/00000020-0000-4000-8000-000000000001/candidates` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-elenco` | empresa (dona/Gestor) | `/company/team` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-hoje` | empresa (dona/Gestor) | `/company/hoje` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-relatorio` | empresa (dona/Gestor) | `/company/relatorio` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-operacao` | empresa (dona/Gestor) | `/company/operacao` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-perfil-empresa` | empresa (dona/Gestor) | `/company/profile` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |
| `nulos-perfil-do-freela` | empresa (dona/Gestor) | `/company/worker/00000001-0000-4000-8000-000000000001` | valores zero e campos nulos | mundo: `(m) => { m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: n...` |

## extras (6)

| id | Quem vê | Rota | Condição que ativa | Como simular |
|---|---|---|---|---|
| `extras-chat-travado-freela` | freela | `/messages?conversation=00000095-0000-4000-8000-000000000001` | Conversation.islocked | mundo: `(m) => { m.db.Conversation.forEach((c) => { c.islocked = true; }); }` |
| `extras-chat-travado-empresa` | empresa (dona/Gestor) | `/company/messages?conversation=00000095-0000-4000-8000-000000000001` | Conversation.islocked | mundo: `(m) => { m.db.Conversation.forEach((c) => { c.islocked = true; }); }` |
| `extras-qr-camera-negada` | empresa (dona/Gestor) | `/company/team` | leitor de QR sem permissão de câmera | script de inicialização no navegador; passos: clicar Adicionar Freela > clicar /QR\|c[aâ]mera/i |
| `extras-admin-email-sem-permissao` | empresa (dona/Gestor) | `/admin` | tentativa de login com e-mail fora da lista (espera progressiva) | passos: preencher > preencher > clicar (css) |
| `extras-sino-vazio` | empresa (dona/Gestor) | `/company/dashboard` | dropdown sem notificações | mundo: `(m) => { m.db.notifications = []; }`; passos: clicar (css) |
| `extras-redefinir-senha-sem-sessao` | visitante sem sessão | `/redefinir-senha` | link aberto sem sessão de recuperação | mundo padrão do papel |

## Sem cenário (16)

| Área | Estado | Quem vê | Condição no código | Por que ficou fora / como simular |
|---|---|---|---|---|
| Tempo real | Mensagem nova chegando com o chat aberto; "digitando..." | freela, empresa | canais `messages:*` e `typing:*` (Messages, CompanyMessages) | o realtime falso é mudo; exigiria falar o protocolo Phoenix |
| Tempo real | Notificação chegando ao vivo, InviteTakeover surgindo sem recarregar, aviso nativo do navegador | freela, empresa | NotificationContext + InviteTakeover | mesmo motivo; o takeover é fotografado na carga |
| Retorno de ação | A maior parte dos toasts de sucesso e erro de cada botão (cada outcome de RPC de salvar, cancelar, passar, cobrir, etiqueta, indicação, certificação, véspera, check-in) | todos | mapas de outcome nos services | só os fluxos principais têm foto; declarar `rpc` + passo de clique |
| Retorno de ação | Botões em estado "salvando..." (loading) e duplo toque | todos | `loading` dos Button | estado transitório; simular com falha `pendura` caso a caso |
| Presença | Recusa do banco ao marcar presença (cedo demais, futuro, turno cancelado, já gravado) | freela, empresa | `attendanceGuardMessage` (MyJobs, CompanyJobCandidates) | são toasts; simular com `falhas["rest:applications"]` com `applications_update_guard` |
| Upload | Envio de foto/capa: progresso, arquivo inválido, erro | freela, empresa | Profile, CompanyProfile (`storage.from("avatars")`) | exige seletor de arquivo |
| Sistema | Área de transferência: "copiado" e link para copiar à mão quando falha | empresa, freela | CompanyTeam `manualLink`, copiar PIX/ID | não automatizado |
| Sistema | Leitor de QR com câmera funcionando e QR lido | empresa | QrScannerPane | sem câmera em headless (só o caso de permissão negada) |
| Sistema | Recibo impresso | freela, empresa | `window.print()` + CSS de impressão | o script não usa mídia print |
| Sistema | Página offline do service worker (`public/offline.html`) e recarga por chunk antigo | todos | só no build de produção | a galeria usa o Vite de desenvolvimento |
| Sessão | Sessão expirando no meio do uso; logout; login/cadastro bem-sucedidos com redirecionamento | todos | AuthContext, Login | são transições, sem tela própria |
| Admin | Bloqueio de 1 minuto após 5 tentativas | admin | `MAX_LOGIN_ATTEMPTS` (Admin) | as esperas progressivas somam mais de 15s com relógio congelado |
| Admin | Ações da trilha (decidir, marcar PIX pago, vetar, abrir trilha, ligar programa, inscrever) e seus diálogos/desfazer | admin | components/admin/bonus/* | só as 5 abas em leitura |
| Séries e relatórios | Resultado final de editar/parar série e de convidar para a série; exportação CSV | empresa | Edit/Cancel/InviteSeriesModal, CompanyOrdersReport | só o primeiro passo e a prévia da edição |
| Páginas estáticas | Perguntas da Ajuda abertas, filtros do relatório e períodos da Operação | todos | Help, CompanyOrdersReport, CompanyOperationAnalytics | só o estado padrão |
| Pagamento pausado | Fluxos Asaas (depósito, saque, cartão, hold) | - | walletService, paymentMethodService | sem tela no app desde 22/08/2026; só "Confirmar Entrega" do legado tem foto |
