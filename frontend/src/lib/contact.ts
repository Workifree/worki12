/**
 * Fonte ÚNICA do canal de contato público. Vem de `VITE_CONTACT_EMAIL`; sem a variável não existe
 * canal publicado e a UI não pode inventar endereço nem prometer atendimento.
 */
export function getContactEmail(): string | null {
    const value = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined)?.trim();
    return value ? value : null;
}

/** Texto honesto das páginas legais enquanto não há canal publicado. */
export const CONTACT_PENDING_TEXT = 'O canal de atendimento para dados pessoais será publicado nesta página.';
