/**
 * Chave de sessionStorage compartilhada entre AcceptManagerInvite e Login (F13, R8/R9).
 *
 * Fica num módulo próprio (mesmo padrão de `lib/inviteToken.ts`) para não acoplar o chunk
 * lazy do Login ao chunk lazy de AcceptManagerInvite — ambos são rotas com `React.lazy` em
 * App.tsx e devem permanecer em bundles separados.
 */
export const PENDING_MANAGER_INVITE_TOKEN_KEY = 'pending_manager_invite_token';
