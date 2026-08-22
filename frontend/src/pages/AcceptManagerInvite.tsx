/**
 * AcceptManagerInvite — aceite de convite de gerente por link (F13, R8/R9).
 *
 * Rota: /convite-gerente/:token (PÚBLICA — fora do ProtectedRoute, mesmo motivo de InviteAccept:
 * se ficasse sob o guard, sem sessão o usuário seria mandado para "/" antes deste componente
 * montar e o token do link se perderia).
 *
 * Fluxo (R9): "o gerente cria a própria conta Supabase Auth normalmente, com
 * user_metadata.user_type = 'hire', ANTES de aceitar o convite — recebe link → se não tem conta,
 * cadastra → aceita." Sem sessão: preserva o token e manda para o cadastro/login (mesmo padrão
 * de `PENDING_INVITE_TOKEN_KEY`/`redirect` de InviteAccept, chave própria para não colidir com o
 * fluxo de convite de equipe).
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, Building2, ArrowRight } from 'lucide-react';
import { acceptManagerInvite } from '../services/organizationService';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import PageMeta from '../components/PageMeta';
import { PENDING_MANAGER_INVITE_TOKEN_KEY } from '../lib/managerInviteToken';

type PageState =
  | 'loading'
  | 'accepted'
  | 'already_accepted'
  | 'token_already_used'
  | 'revoked'
  | 'expired'
  | 'worker_cannot_be_manager'
  | 'error';

export default function AcceptManagerInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState<PageState>('loading');

  useEffect(() => {
    let active = true;

    async function processInvite() {
      if (!token) {
        if (active) setPage('error');
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!active) return;
        try {
          sessionStorage.setItem(PENDING_MANAGER_INVITE_TOKEN_KEY, token);
        } catch {
          // sessionStorage indisponível — segue só com o query param
        }
        navigate(`/login?redirect=${encodeURIComponent(`/convite-gerente/${token}`)}`, { replace: true });
        return;
      }

      try {
        const result = await acceptManagerInvite(token);
        if (!active) return;

        try {
          sessionStorage.removeItem(PENDING_MANAGER_INVITE_TOKEN_KEY);
        } catch {
          // best-effort
        }

        const knownStates: PageState[] = [
          'accepted', 'already_accepted', 'token_already_used', 'revoked',
          'expired', 'worker_cannot_be_manager',
        ];
        // `not_found` / `invalid_input` / `unauthenticated` (raros: link malformado, ou a
        // sessão expirou entre o check acima e a chamada) colapsam em 'error' — a copy
        // genérica já cobre "peça um novo link", sem precisar de um estado por outcome.
        setPage(knownStates.includes(result.outcome as PageState) ? (result.outcome as PageState) : 'error');
      } catch (err) {
        logError('AcceptManagerInvite.processInvite', err);
        if (active) setPage('error');
      }
    }

    void processInvite();
    return () => { active = false; };
  }, [token, navigate]);

  const CONTENT: Record<PageState, { title: string; body: string; tone: 'success' | 'warning' | 'error' }> = {
    loading: { title: 'Processando convite...', body: '', tone: 'success' },
    accepted: {
      title: 'Convite Aceito!',
      body: 'Você agora opera esta unidade como gerente. Bem-vindo(a).',
      tone: 'success',
    },
    already_accepted: {
      title: 'Convite já aceito',
      body: 'Você já opera esta unidade — não é necessário aceitar novamente.',
      tone: 'success',
    },
    token_already_used: {
      title: 'Convite já usado',
      body: 'Este link já foi utilizado por outra conta. Peça um novo convite à empresa.',
      tone: 'error',
    },
    revoked: {
      title: 'Convite cancelado',
      body: 'A empresa cancelou este convite. Peça um novo, se ainda for necessário.',
      tone: 'error',
    },
    expired: {
      title: 'Convite expirado',
      body: 'Este link não é mais válido (mais de 7 dias). Peça um novo convite à empresa.',
      tone: 'error',
    },
    worker_cannot_be_manager: {
      title: 'Conta incompatível',
      body: 'Esta conta é de freela. Crie uma conta de empresa para aceitar este convite.',
      tone: 'error',
    },
    error: {
      title: 'Não foi possível processar',
      body: 'Ocorreu um erro inesperado. Tente novamente ou peça um novo link à empresa.',
      tone: 'error',
    },
  };

  const current = CONTENT[page];
  const isSuccess = page === 'accepted' || page === 'already_accepted';

  return (
    <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
      <PageMeta
        title="Convite de Gerente"
        description="Aceite o convite para operar uma unidade no Worki."
      />

      <div className="w-full max-w-md">
        <div
          className={`bg-white border-2 border-black rounded-2xl p-8 text-center ${
            page === 'loading'
              ? 'shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]'
              : isSuccess
                ? 'shadow-[8px_8px_0px_0px_rgba(37,99,235,1)]'
                : 'shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]'
          }`}
        >
          <div
            className={`w-16 h-16 border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-6 ${
              page === 'loading' ? 'bg-blue-50' : isSuccess ? 'bg-blue-600' : 'bg-red-50'
            }`}
          >
            {page === 'loading' ? (
              <Building2 size={32} className="text-blue-600" />
            ) : isSuccess ? (
              <CheckCircle2 size={32} className="text-white" />
            ) : (
              <XCircle size={32} className="text-red-500" />
            )}
          </div>

          <h1 className="text-2xl font-black uppercase tracking-tighter mb-2">{current.title}</h1>

          {page === 'loading' ? (
            <div className="flex items-center justify-center gap-3 text-gray-500 mt-6">
              <Loader2 className="animate-spin text-blue-600" size={24} />
              <span className="font-bold">Confirmando seu acesso...</span>
            </div>
          ) : (
            <>
              <p className="text-gray-600 font-bold mb-8">{current.body}</p>
              <button
                onClick={() => navigate(isSuccess ? '/company/dashboard' : '/login')}
                className="w-full bg-black hover:bg-blue-600 text-white px-6 py-3 rounded-xl font-black uppercase transition-colors flex items-center justify-center gap-2"
              >
                {isSuccess ? 'Ir para o Dashboard' : 'Voltar ao Login'}
                <ArrowRight size={18} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
