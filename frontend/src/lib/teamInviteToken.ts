/**
 * Convite de equipe (`/convite-equipe/:token`): chaves de storage e marca de "já foi da equipe".
 *
 * Módulo próprio (mesmo padrão de `lib/managerInviteToken.ts`) para não acoplar chunks lazy.
 * O token é segredo ao portador: vive só na sessão da aba e é apagado ao concluir o aceite — e
 * também em todo desfecho terminal (convite inexistente, vencido, revogado ou já usado).
 */
export const PENDING_TEAM_INVITE_TOKEN_KEY = 'pending_team_invite_token';

/**
 * Prefixo da marca local de que ESTA PESSOA entrou numa equipe por convite. Serve só para decidir
 * a TELA quando a sessão fica sem nenhuma empresa (acesso encerrado, em vez de onboarding de CNPJ).
 * Não concede nada: a autorização real é o RLS/seam no banco.
 *
 * A marca é POR USUÁRIO (`<prefixo>:<uid>`): num aparelho compartilhado, um dono novo que entra
 * depois de um ex-membro nunca herda a marca dele. Também é apagada no logout.
 */
export const TEAM_MEMBER_HINT_KEY = 'worki_team_member_hint';

function hintKey(uid: string): string {
  return `${TEAM_MEMBER_HINT_KEY}:${uid}`;
}

export function readPendingTeamInviteToken(): string | null {
  try {
    return sessionStorage.getItem(PENDING_TEAM_INVITE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storePendingTeamInviteToken(token: string): void {
  try {
    sessionStorage.setItem(PENDING_TEAM_INVITE_TOKEN_KEY, token);
  } catch {
    // sessionStorage indisponível — o token segue na URL da própria rota
  }
}

export function clearPendingTeamInviteToken(): void {
  try {
    sessionStorage.removeItem(PENDING_TEAM_INVITE_TOKEN_KEY);
  } catch {
    // best-effort
  }
}

/**
 * Quem pediu o código já marcou os Termos. O botão do e-mail costuma abrir em OUTRA aba: esta marca
 * (localStorage, 1h = validade do código) deixa a volta concluir o aceite sem repetir o clique.
 * O token não é gravado, só uma impressão curta dele. Uso único.
 */
const TEAM_INVITE_TOS_KEY = 'worki_team_invite_tos';
const TEAM_INVITE_TOS_TTL_MS = 60 * 60 * 1000;

function fingerprint(token: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) hash = Math.imul(hash ^ token.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16);
}

export function rememberTeamInviteTos(token: string, email: string): void {
  try {
    localStorage.setItem(TEAM_INVITE_TOS_KEY, JSON.stringify({ invite: fingerprint(token), email, at: Date.now() }));
  } catch {
    // best-effort: sem a marca, a volta pede os Termos de novo
  }
}

/** `true` (uma única vez) se ESTE e-mail aceitou os Termos para ESTE convite há menos de 1h. */
export function consumeTeamInviteTos(token: string, email: string): boolean {
  try {
    const raw = localStorage.getItem(TEAM_INVITE_TOS_KEY);
    if (!raw) return false;
    const mark = JSON.parse(raw) as { invite?: string; email?: string; at?: number };
    const ok = mark.invite === fingerprint(token)
      && mark.email === email.trim().toLowerCase()
      && Date.now() - (mark.at ?? 0) < TEAM_INVITE_TOS_TTL_MS;
    if (ok) localStorage.removeItem(TEAM_INVITE_TOS_KEY);
    return ok;
  } catch {
    return false;
  }
}

export function markTeamMember(uid: string | null | undefined): void {
  if (!uid) return;
  try {
    localStorage.setItem(hintKey(uid), '1');
  } catch {
    // best-effort
  }
}

/** Apaga a marca deste usuário (e a antiga, global, de versões anteriores). */
export function clearTeamMemberHint(uid?: string | null): void {
  try {
    if (uid) localStorage.removeItem(hintKey(uid));
    localStorage.removeItem(TEAM_MEMBER_HINT_KEY);
  } catch {
    // best-effort
  }
}

/** Apaga TODAS as marcas deste aparelho (logout / `SIGNED_OUT`). */
export function clearAllTeamMemberHints(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (key === TEAM_MEMBER_HINT_KEY || key.startsWith(`${TEAM_MEMBER_HINT_KEY}:`))) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // best-effort
  }
}

/** ESTA pessoa já entrou como membro de equipe neste aparelho (aceite concluído). */
export function hasTeamMemberHint(uid: string | null | undefined): boolean {
  if (!uid) return false;
  try {
    return localStorage.getItem(hintKey(uid)) === '1';
  } catch {
    return false;
  }
}
