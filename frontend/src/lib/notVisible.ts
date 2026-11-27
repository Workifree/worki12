/**
 * Leitura por id que a RLS não deixa ver (ou de turno removido) volta como 0 linhas: PostgREST
 * responde 406 / PGRST116 num `.single()`. Isso NÃO é falha de rede — mostrar "verifique sua
 * conexão" com "Tentar de novo" manda a pessoa repetir algo que nunca vai funcionar.
 */
export function isNotVisibleError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const e = error as { code?: string; status?: number; message?: string; details?: string };
    if (e.code === 'PGRST116' || e.status === 406) return true;
    const texto = `${e.message ?? ''} ${e.details ?? ''}`;
    return /0 rows|no rows returned/i.test(texto);
}
