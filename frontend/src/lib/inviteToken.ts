/**
 * Chave de sessionStorage compartilhada entre InviteAccept e Login (item 11 do GTM).
 *
 * Fica num módulo próprio (em vez de exportada de InviteAccept.tsx) para não acoplar o
 * chunk lazy do Login ao chunk lazy do InviteAccept — ambos são rotas com
 * `React.lazy` em App.tsx e devem permanecer em bundles separados.
 */
export const PENDING_INVITE_TOKEN_KEY = 'pending_invite_token';
