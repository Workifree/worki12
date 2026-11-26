/**
 * AcceptManagerInvite — aceite de convite de gerente por link (F13, R8/R9).
 *
 * Rota: /convite-gerente/:token (PÚBLICA — fora do ProtectedRoute, mesmo motivo de InviteAccept:
 * se ficasse sob o guard, sem sessão o usuário seria mandado para "/" antes deste componente
 * montar e o token do link se perderia).
 *
 * CONSENTIMENTO: abrir o link NUNCA chama o aceite; `acceptManagerInvite` só roda no toque em
 * "Aceitar". O nome da empresa não aparece antes: não há leitura permitida ao convidado (RLS de
 * `company_members`) nem RPC de prévia para convite de gerente.
 *
 * Fluxo (R9): "o gerente cria a própria conta Supabase Auth normalmente, com
 * user_metadata.user_type = 'hire', ANTES de aceitar o convite — recebe link → se não tem conta,
 * cadastra → aceita." Sem sessão: preserva o token e manda para o cadastro/login (mesmo padrão
 * de `PENDING_INVITE_TOKEN_KEY`/`redirect` de InviteAccept, chave própria para não colidir com o
 * fluxo de convite de equipe).
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, Building2, ArrowRight } from 'lucide-react';
import { acceptManagerInvite } from '../services/organizationService';
import { logError } from '../lib/logger';
import { checkSession } from '../lib/authSession';
import ErroDeVerificacao from '../components/ErroDeVerificacao';
import PageMeta from '../components/PageMeta';
import { Button, Card } from '../components/ui';
import { supabase } from '../lib/supabase';
import { PENDING_MANAGER_INVITE_TOKEN_KEY } from '../lib/managerInviteToken';

type PageState =
  | 'loading'
  | 'confirm'
  | 'accepting'
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
  const [semConexao, setSemConexao] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Montar a página só LÊ a sessão; o aceite é o clique.
    async function openInvite() {
      if (!token) {
        if (active) setPage('error');
        return;
      }

      const session = await checkSession();
      if (session.status === 'unavailable') {
        // Rede fora não é "sem conta": não manda para o login nem gasta o convite.
        logError('AcceptManagerInvite.session', session.error);
        if (active) setSemConexao(true);
        return;
      }
      if (session.status === 'signed_out') {
        if (!active) return;
        try {
          sessionStorage.setItem(PENDING_MANAGER_INVITE_TOKEN_KEY, token);
        } catch {
          // sessionStorage indisponível — segue só com o query param
        }
        // `type=hire` NAO e tema visual aqui: sem ele o /login assume 'work' por default e
        // recebe o convidado com a copy de freela ("Comece a trabalhar"). Quem cria a conta
        // por esse caminho vira worker -- e worker nao pode ser gerente (`worker_cannot_be_manager`),
        // entao o convite fica inutilizavel pela unica pessoa a quem foi enviado.
        navigate(
            `/login?type=hire&redirect=${encodeURIComponent(`/convite-gerente/${token}`)}`,
            { replace: true },
        );
        return;
      }

      setAccountEmail(session.user.email ?? null);
      // Conta de freela nunca vira Gestor: avisa antes, sem gastar o convite.
      setPage(session.user.user_metadata?.user_type === 'work' ? 'worker_cannot_be_manager' : 'confirm');
    }

    void openInvite();
    return () => { active = false; };
  }, [token, navigate, tentativa]);

  const forgetToken = () => {
    try {
      sessionStorage.removeItem(PENDING_MANAGER_INVITE_TOKEN_KEY);
    } catch {
      // best-effort
    }
  };

  const accept = async () => {
    if (!token || page === 'accepting') return;
    setPage('accepting');
    try {
      const result = await acceptManagerInvite(token);
      forgetToken();

      if (result.companyId && (result.outcome === 'accepted' || result.outcome === 'already_accepted')) {
        try {
          const { data } = await supabase.from('companies').select('name').eq('id', result.companyId).maybeSingle();
          setCompanyName((data as { name?: string | null } | null)?.name ?? null);
        } catch (err) {
          logError('AcceptManagerInvite.companyName', err);
        }
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
      logError('AcceptManagerInvite.accept', err);
      setPage('error');
    }
  };

  const decline = () => {
    forgetToken();
    navigate('/');
  };

  /** Sai da conta atual e leva ao login/cadastro de empresa guardando o convite. */
  const switchAccount = async (cadastro: boolean) => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      logError('AcceptManagerInvite.signOut', err);
    }
    navigate(
      `/login?type=hire&${cadastro ? 'cadastro=1&' : ''}redirect=${encodeURIComponent(`/convite-gerente/${token ?? ''}`)}`,
    );
  };

  const CONTENT: Record<PageState, { title: string; body: string; tone: 'success' | 'warning' | 'error' }> = {
    loading: { title: 'Abrindo o convite...', body: '', tone: 'success' },
    confirm: { title: 'Convite para ser Gestor de uma empresa', body: '', tone: 'success' },
    accepting: { title: 'Convite para ser Gestor de uma empresa', body: '', tone: 'success' },
    accepted: {
      title: 'Convite Aceito!',
      body: companyName
        ? `Você agora opera ${companyName} como Gestor. Boas-vindas.`
        : 'Você agora opera esta unidade como Gestor. Boas-vindas.',
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
      body: 'Esta conta é de freela. Para aceitar, você vai sair desta conta e criar uma conta de empresa com outro e-mail.',
      tone: 'error',
    },
    error: {
      title: 'Não foi possível processar',
      body: 'Ocorreu um erro inesperado. Tente novamente ou peça um novo link à empresa.',
      tone: 'error',
    },
  };

  if (semConexao) {
    return <ErroDeVerificacao onRetry={() => { setSemConexao(false); setTentativa((n) => n + 1); }} />;
  }

  const current = CONTENT[page];
  const isSuccess = page === 'accepted' || page === 'already_accepted';

  const isConfirm = page === 'confirm' || page === 'accepting';

  let actions: ReactNode;
  if (isConfirm) {
    actions = (
      <>
        <div className="mb-4 rounded-xl border-2 border-gray-200 p-4 text-left text-sm">
          <p className="font-bold mb-1">Se você aceitar</p>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>você passa a operar a empresa: turnos, Elenco e pagamentos;</li>
            <li>a empresa vê seu e-mail e o que você fizer em nome dela.</li>
          </ul>
          <p className="mt-2 text-gray-600">O link não mostra o nome da empresa antes do aceite. Só continue se você sabe quem te enviou.</p>
        </div>
        {accountEmail && (
          <p className="mb-4 text-sm text-gray-600">Você está com a conta <strong>{accountEmail}</strong>.</p>
        )}
        <div className="space-y-3">
          <Button variant="dark" size="lg" fullWidth loading={page === 'accepting'} onClick={() => void accept()} data-copilot="publico.convite-gerente.aceitar">
            Aceitar
          </Button>
          <Button variant="secondary" size="lg" fullWidth disabled={page === 'accepting'} onClick={decline}>
            Agora não
          </Button>
          <Button variant="ghost" size="lg" fullWidth disabled={page === 'accepting'} onClick={() => void switchAccount(false)}>
            Usar outra conta
          </Button>
        </div>
      </>
    );
  } else if (page === 'worker_cannot_be_manager') {
    actions = (
      <div className="space-y-3">
        <Button variant="dark" size="lg" fullWidth onClick={() => void switchAccount(true)}>
          Sair e criar conta de empresa
        </Button>
        <Button variant="secondary" size="lg" fullWidth onClick={decline}>
          Agora não
        </Button>
      </div>
    );
  } else {
    actions = (
      <Button
        variant="dark"
        size="lg"
        fullWidth
        onClick={() => navigate(isSuccess ? '/company/dashboard' : '/')}
        iconRight={<ArrowRight size={18} />}
      >
        {isSuccess ? 'Ir para o Início' : 'Voltar à página inicial'}
      </Button>
    );
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <PageMeta
        title="Convite de Gestor"
        noindex
        description="Veja o convite para operar uma empresa no Worki."
      />

      <div className="w-full max-w-md">
        <Card
          padding="lg"
          className="text-center shadow-brutal-lg [overflow-wrap:anywhere]"
        >
          <div
            className={`w-14 h-14 border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-5 ${
              page === 'loading' || isConfirm ? 'bg-blue-50' : isSuccess ? 'bg-blue-600' : 'bg-gray-100'
            }`}
          >
            {page === 'loading' || isConfirm ? (
              <Building2 size={28} className="text-blue-600" />
            ) : isSuccess ? (
              <CheckCircle2 size={28} className="text-white" />
            ) : (
              <XCircle size={28} className="text-red-500" />
            )}
          </div>

          <h1 className="text-2xl font-bold tracking-tight mb-2">{current.title}</h1>

          {page === 'loading' ? (
            <div className="flex items-center justify-center gap-3 text-gray-600 mt-5" role="status">
              <Loader2 className="animate-spin text-blue-600" size={22} />
              <span className="text-sm font-semibold">Confirmando seu acesso...</span>
            </div>
          ) : (
            <>
              {current.body && <p className="text-sm sm:text-base text-gray-600 mb-6">{current.body}</p>}
              {actions}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
