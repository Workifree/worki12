// Regrava .harness/spec/revisao-design/inventario-de-telas.md a partir dos cenários declarados
// (parte coberta) e da lista abaixo (estados do código ainda sem foto). Uso: node gerar-inventario.mjs
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = join(aqui, '../../.harness/spec/revisao-design/inventario-de-telas.md');

/** [área, estado, quem vê, condição no código, como simular / por que ficou fora] */
const FORA = [
  ['Tempo real', 'Mensagem nova chegando com o chat aberto; "digitando..."', 'freela, empresa', 'canais `messages:*` e `typing:*` (Messages, CompanyMessages)', 'o realtime falso é mudo; exigiria falar o protocolo Phoenix'],
  ['Tempo real', 'Notificação chegando ao vivo, InviteTakeover surgindo sem recarregar, aviso nativo do navegador', 'freela, empresa', 'NotificationContext + InviteTakeover', 'mesmo motivo; o takeover é fotografado na carga'],
  ['Retorno de ação', 'A maior parte dos toasts de sucesso e erro de cada botão (cada outcome de RPC de salvar, cancelar, passar, cobrir, etiqueta, indicação, certificação, véspera, check-in)', 'todos', 'mapas de outcome nos services', 'só os fluxos principais têm foto; declarar `rpc` + passo de clique'],
  ['Retorno de ação', 'Botões em estado "salvando..." (loading) e duplo toque', 'todos', '`loading` dos Button', 'estado transitório; simular com falha `pendura` caso a caso'],
  ['Presença', 'Recusa do banco ao marcar presença (cedo demais, futuro, turno cancelado, já gravado)', 'freela, empresa', '`attendanceGuardMessage` (MyJobs, CompanyJobCandidates)', 'são toasts; simular com `falhas["rest:applications"]` com `applications_update_guard`'],
  ['Upload', 'Envio de foto/capa: progresso, arquivo inválido, erro', 'freela, empresa', 'Profile, CompanyProfile (`storage.from("avatars")`)', 'exige seletor de arquivo'],
  ['Sistema', 'Área de transferência: "copiado" e link para copiar à mão quando falha', 'empresa, freela', 'CompanyTeam `manualLink`, copiar PIX/ID', 'não automatizado'],
  ['Sistema', 'Leitor de QR com câmera funcionando e QR lido', 'empresa', 'QrScannerPane', 'sem câmera em headless (só o caso de permissão negada)'],
  ['Sistema', 'Recibo impresso', 'freela, empresa', '`window.print()` + CSS de impressão', 'o script não usa mídia print'],
  ['Sistema', 'Página offline do service worker (`public/offline.html`) e recarga por chunk antigo', 'todos', 'só no build de produção', 'a galeria usa o Vite de desenvolvimento'],
  ['Sessão', 'Sessão expirando no meio do uso; logout; login/cadastro bem-sucedidos com redirecionamento', 'todos', 'AuthContext, Login', 'são transições, sem tela própria'],
  ['Admin', 'Bloqueio de 1 minuto após 5 tentativas', 'admin', '`MAX_LOGIN_ATTEMPTS` (Admin)', 'as esperas progressivas somam mais de 15s com relógio congelado'],
  ['Admin', 'Ações da trilha (decidir, marcar PIX pago, vetar, abrir trilha, ligar programa, inscrever) e seus diálogos/desfazer', 'admin', 'components/admin/bonus/*', 'só as 5 abas em leitura'],
  ['Séries e relatórios', 'Resultado final de editar/parar série e de convidar para a série; exportação CSV', 'empresa', 'Edit/Cancel/InviteSeriesModal, CompanyOrdersReport', 'só o primeiro passo e a prévia da edição'],
  ['Páginas estáticas', 'Perguntas da Ajuda abertas, filtros do relatório e períodos da Operação', 'todos', 'Help, CompanyOrdersReport, CompanyOperationAnalytics', 'só o estado padrão'],
  ['Pagamento pausado', 'Fluxos Asaas (depósito, saque, cartão, hold)', '-', 'walletService, paymentMethodService', 'sem tela no app desde 22/08/2026; só "Confirmar Entrega" do legado tem foto'],
];

const cenarios = [];
for (const f of readdirSync(join(aqui, 'cenarios')).filter((x) => x.endsWith('.mjs')).sort()) cenarios.push(...(await import(`./cenarios/${f}`)).default);

const PAPEL = { anon: 'visitante sem sessão', freela: 'freela', empresa: 'empresa (dona/Gestor)', encarregado: 'encarregado', admin: 'admin' };
const limpar = (s) => String(s).replace(/\s+/g, ' ').replace(/\|/g, '\\|');
const comoSimular = (c) => {
  const partes = [];
  if (c.prep) { const f = limpar(c.prep); partes.push(f.startsWith('(') || f.startsWith('function') ? `mundo: \`${f.slice(0, 110).replace(/`/g, "'")}${f.length > 110 ? '...' : ''}\`` : 'mundo alterado'); }
  if (c.ua) partes.push('user agent de iPhone');
  if (c.local) partes.push('localStorage semeado');
  if (c.session) partes.push('sessionStorage semeado');
  if (c.init) partes.push('script de inicialização no navegador');
  if (c.passos?.length) partes.push(`passos: ${c.passos.map((p) => limpar(p.clicar ? `clicar ${p.clicar}` : p.preencher ? 'preencher' : p.selecionar ? 'selecionar' : p.marcar ? 'marcar' : p.css ? 'clicar (css)' : p.offline ? 'cortar a rede' : p.falhar ? 'ligar falha' : p.esperar ? `esperar ${p.esperar}ms` : 'script')).join(' > ')}`);
  return partes.join('; ') || 'mundo padrão do papel';
};

const grupos = [...new Set(cenarios.map((c) => c.grupo))];
let md = `# Inventário de telas e estados do Worki

> Levantado do código (App.tsx, ProtectedRoute, layouts, páginas, componentes e services).
> A parte coberta é **gerada** de \`scripts/galeria-telas/cenarios/\` (\`node gerar-inventario.mjs\`); não editar à mão.
> Reproduzir um estado: \`node run.mjs --so=<id>\`. "Coberto" = há cenário declarado; se a foto confirmou o estado está em \`index.md\` da execução.

**Estados inventariados: ${cenarios.length + FORA.length}** · com cenário: **${cenarios.length}** · sem cenário: **${FORA.length}** (itens agrupados).

## Regras que decidem o que aparece

| Regra | Onde |
|---|---|
| Rota protegida: sem sessão vai a \`/\`; verificação que falha ou passa de 20s mostra ErroDeVerificacao | ProtectedRoute |
| Freela sem \`onboarding_completed\` vai a \`/worker/onboarding\`; empresa sem linha em \`get_my_companies\` vai a \`/company/onboarding\` | ProtectedRoute |
| Sem empresa: marca de membro = AcessoEncerrado; token de equipe pendente = volta ao convite | ProtectedRoute |
| Encarregado com \`confirmed=false\` só vê AguardandoConfirmacao | ProtectedRoute |
| \`accepted_tos=false\` fora do onboarding = TosGateModal | ProtectedRoute |
| Papel errado na rota = redireciona com aviso; Encarregado fora do perfil e onboarding da empresa | ProtectedRoute |
| Relatório, Operação, Unidades, Indicações e Equipe: só Gestor (SemAcesso); Unidades só dono/operador | GestorRouteGuard, lib/navigation |
| Menu ganha Hoje/Equipe com \`team_enabled\` ou papel encarregado | companyScopeService |
| InviteTakeover em qualquer tela do freela com convite pendente | MainLayout |
| Convite de instalar após 6s, fora de login/convite/onboarding; atualização tem prioridade | PwaPrompts |
| \`/admin\` exige sessão; e-mail fora de \`VITE_ADMIN_EMAILS\` vê o login com "Acesso negado" | App, Admin |
`;
for (const g of grupos) {
  const lista = cenarios.filter((c) => c.grupo === g);
  md += `\n## ${g} (${lista.length})\n\n| id | Quem vê | Rota | Condição que ativa | Como simular |\n|---|---|---|---|---|\n`;
  for (const c of lista) md += `| \`${c.id}\` | ${PAPEL[c.papel]} | \`${limpar(c.rota)}\` | ${limpar(c.regra)} | ${comoSimular(c)} |\n`;
}
md += `\n## Sem cenário (${FORA.length})\n\n| Área | Estado | Quem vê | Condição no código | Por que ficou fora / como simular |\n|---|---|---|---|---|\n`;
for (const l of FORA) md += `| ${l.join(' | ')} |\n`;
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, md);
console.log(`${cenarios.length} cobertos, ${FORA.length} fora -> ${destino}`);
