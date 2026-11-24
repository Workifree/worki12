/**
 * Convite de equipe (`/convite-equipe/:token`): chaves de storage e marca de "já foi da equipe".
 *
 * Módulo próprio (mesmo padrão de `lib/managerInviteToken.ts`) para não acoplar chunks lazy.
 * O token é segredo ao portador: vive só na sessão da aba e é apagado ao concluir o aceite.
 */
export const PENDING_TEAM_INVITE_TOKEN_KEY = 'pending_team_invite_token';

/**
 * Marca local de que esta pessoa entrou numa equipe por convite. Serve só para decidir a TELA
 * quando a sessão fica sem nenhuma empresa (acesso encerrado, em vez de onboarding de CNPJ).
 * Não concede nada: a autorização real é o RLS/seam no banco.
 */
export const TEAM_MEMBER_HINT_KEY = 'worki_team_member_hint';

export function readPendingTeamInviteToken(): string | null {
  try {
    return sessionStorage.getItem(PENDING_TEAM_INVITE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function markTeamMember(): void {
  try {
    localStorage.setItem(TEAM_MEMBER_HINT_KEY, '1');
  } catch {
    // best-effort
  }
}

export function clearTeamMemberHint(): void {
  try {
    localStorage.removeItem(TEAM_MEMBER_HINT_KEY);
  } catch {
    // best-effort
  }
}

/** Esta pessoa já entrou como membro de equipe neste aparelho (aceite concluído). */
export function hasTeamMemberHint(): boolean {
  try {
    return localStorage.getItem(TEAM_MEMBER_HINT_KEY) === '1';
  } catch {
    return false;
  }
}
