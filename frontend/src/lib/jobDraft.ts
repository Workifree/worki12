/**
 * Rascunho do formulário de novo turno (localStorage). A chave é por usuário + empresa: em aparelho
 * compartilhado, ou para quem opera mais de uma unidade, um rascunho nunca aparece no lugar errado.
 */
const PREFIX = 'worki_rascunho_turno';

export function jobDraftKey(userId: string, companyId: string): string {
  return `${PREFIX}:${userId}:${companyId}`;
}

/** Apaga todos os rascunhos deste aparelho (logout), inclusive a chave antiga sem dono. */
export function clearJobDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (key === PREFIX || key.startsWith(`${PREFIX}:`))) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // storage indisponível: rascunho é só conveniência
  }
}
