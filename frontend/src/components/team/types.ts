// ---------------------------------------------------------------------------
// Tipos compartilhados entre os componentes de `components/team/` e a página
// `pages/company/CompanyTeam.tsx` que os orquestra.
// ---------------------------------------------------------------------------

/**
 * Histórico do freela com ESTA empresa (turnos concluídos) — batch para todo o
 * elenco de uma vez (evita N+1: 1 query cobre todos os membros da tela).
 */
export interface WorkerHistoryWithCompany {
  /** Quantos turnos concluídos o freela já fez com esta empresa. */
  count: number;
  /** Data (YYYY-MM-DD) do turno concluído mais recente, se houver. */
  lastDate: string | null;
}
