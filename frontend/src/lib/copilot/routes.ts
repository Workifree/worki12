/**
 * Política de rotas do copiloto. Lista de PERMISSÃO: o que não está aqui é recusado.
 * Base: App.tsx e `.harness/spec/copiloto-worki/mapa-de-intencoes.md` §1.
 */

export type CopilotRole = 'company' | 'worker'

/** `blocked`: o copiloto some e não lê nada. `readonly`: só explica, destaca e navega. */
export type PathPolicy = 'normal' | 'readonly' | 'blocked'

interface RouteDef {
  pattern: string
  name: string
  policy?: Exclude<PathPolicy, 'normal'>
  /** Chegar até aqui tem efeito (registra visita, roda avaliação): exige confirmação. */
  confirmToOpen?: boolean
}

const ROUTES: readonly RouteDef[] = [
  { pattern: '/dashboard', name: 'Início do freela' },
  { pattern: '/my-jobs', name: 'Meus turnos' },
  { pattern: '/carteira', name: 'Minhas empresas' },
  { pattern: '/recebimentos', name: 'Recebimentos' },
  { pattern: '/indicacoes', name: 'Quem te indicou' },
  { pattern: '/profile', name: 'Meu perfil' },
  { pattern: '/messages', name: 'Mensagens' },
  { pattern: '/notifications', name: 'Notificações', policy: 'readonly' },
  { pattern: '/empresa/:id', name: 'Perfil da empresa' },
  { pattern: '/recibo/:id', name: 'Recibo', policy: 'readonly' },
  { pattern: '/ajuda', name: 'Ajuda' },
  { pattern: '/termos', name: 'Termos de Uso', policy: 'readonly' },
  { pattern: '/privacidade', name: 'Privacidade', policy: 'readonly' },
  { pattern: '/company/hoje', name: 'Hoje' },
  { pattern: '/company/dashboard', name: 'Visão geral' },
  { pattern: '/company/jobs', name: 'Turnos' },
  { pattern: '/company/create', name: 'Criar turno' },
  { pattern: '/company/jobs/:id', name: 'Detalhes do turno' },
  { pattern: '/company/jobs/:id/edit', name: 'Editar turno' },
  { pattern: '/company/jobs/:id/candidates', name: 'Presença e pagamento' },
  { pattern: '/company/team', name: 'Meu Elenco' },
  { pattern: '/company/indicacoes', name: 'Indicar freela' },
  { pattern: '/company/relatorio', name: 'Relatório de pagamentos' },
  { pattern: '/company/operacao', name: 'Operação' },
  { pattern: '/company/gestao', name: 'Gestão' },
  { pattern: '/company/profile', name: 'Dados da empresa' },
  { pattern: '/company/messages', name: 'Mensagens' },
  { pattern: '/company/worker/:id', name: 'Perfil do freela', confirmToOpen: true },
  { pattern: '/company/empresa/:id', name: 'Perfil da empresa' },
  { pattern: '/company/notifications', name: 'Notificações', policy: 'readonly' },
  { pattern: '/company/trilha', name: 'Trilha de bônus', policy: 'readonly', confirmToOpen: true },
  { pattern: '/company/configuracoes/equipe', name: 'Equipe e acessos', policy: 'readonly' },
  { pattern: '/company/organization', name: 'Empresas da rede', policy: 'readonly' },
]

/** Destinos que a ferramenta `navigate` aceita. O modelo escolhe um id, nunca uma URL. */
export const NAV_DESTINATIONS = {
  company: {
    'empresa.hoje': '/company/hoje',
    'empresa.visao-geral': '/company/dashboard',
    'empresa.turnos': '/company/jobs',
    'empresa.criar-turno': '/company/create',
    'empresa.elenco': '/company/team',
    'empresa.indicacoes': '/company/indicacoes',
    'empresa.relatorio': '/company/relatorio',
    'empresa.operacao': '/company/operacao',
    'empresa.dados': '/company/profile',
    'empresa.mensagens': '/company/messages',
    'empresa.equipe': '/company/configuracoes/equipe',
    'comum.ajuda': '/ajuda',
  },
  worker: {
    'freela.inicio': '/dashboard',
    'freela.turnos': '/my-jobs',
    'freela.empresas': '/carteira',
    'freela.recebimentos': '/recebimentos',
    'freela.indicacoes': '/indicacoes',
    'freela.perfil': '/profile',
    'freela.mensagens': '/messages',
    'comum.ajuda': '/ajuda',
  },
} as const satisfies Record<CopilotRole, Record<string, string>>

export function destinationFor(role: CopilotRole, id: string): string | null {
  const table: Record<string, string> = NAV_DESTINATIONS[role]
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null
}

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i

function matchRoute(pathname: string): RouteDef | null {
  const parts = pathname.replace(/\/+$/, '').split('/')
  return (
    ROUTES.find((route) => {
      const expected = route.pattern.split('/')
      return (
        expected.length === parts.length &&
        expected.every((segment, i) => (segment === ':id' ? ID_SEGMENT.test(parts[i]) : segment === parts[i]))
      )
    }) ?? null
  )
}

/** Caminhos fora do alcance. `/convite*` age ao montar; os demais lidam com credencial. */
const BLOCKED_PREFIX =
  /^\/(?:convite|login|esqueci-senha|redefinir-senha|admin|company\/onboarding|worker\/onboarding)/i

export function pathPolicy(pathname: string): PathPolicy {
  if (BLOCKED_PREFIX.test(pathname)) return 'blocked'
  // Rota desconhecida: não age nem lê.
  const route = matchRoute(pathname)
  if (!route) return 'blocked'
  return route.policy ?? 'normal'
}

/** URL que pode ir ao modelo: só o padrão da rota, sem id, query ou hash. */
export function routePattern(pathname: string): string {
  return matchRoute(pathname)?.pattern ?? '/fora-do-alcance'
}

export function screenName(pathname: string): string {
  return matchRoute(pathname)?.name ?? 'Tela fora do alcance'
}

export type LinkVerdict = 'safe' | 'confirm' | 'blocked'

const SAFE_QUERY: Record<string, RegExp> = {
  filter: /^(?:all|open|closed|andamento)$/,
  chamar: /^1$/,
  tab: /^[a-z-]{1,24}$/,
}

/** Julga um destino de link ou de `history.pushState`. */
export function judgeUrl(href: string, base: string = window.location.href): LinkVerdict {
  let url: URL
  try {
    url = new URL(href, base)
  } catch {
    return 'blocked'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'blocked'
  if (url.origin !== new URL(base).origin) return 'blocked'
  let decoded: string
  try {
    decoded = decodeURIComponent(url.href)
  } catch {
    return 'blocked'
  }
  if (/\/convite/i.test(decoded)) return 'blocked'
  if (pathPolicy(url.pathname) === 'blocked') return 'blocked'
  if (matchRoute(url.pathname)?.confirmToOpen) return 'confirm'
  for (const [key, value] of url.searchParams) {
    if (!SAFE_QUERY[key]?.test(value)) return 'confirm'
  }
  return 'safe'
}
