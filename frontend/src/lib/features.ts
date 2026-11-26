/**
 * Funções cujas migrations ainda não estão aplicadas: desligadas por padrão (`.env.example`).
 * Desligadas, o app não consulta coluna, tabela nem RPC nova. Só ligar DEPOIS das migrations.
 */
export const isLoteEnabled = (): boolean => import.meta.env.VITE_FEATURE_LOTE === 'true';
export const isPresencaEnabled = (): boolean => import.meta.env.VITE_FEATURE_PRESENCA === 'true';
export const isAvisosEnabled = (): boolean => import.meta.env.VITE_FEATURE_AVISOS === 'true';
