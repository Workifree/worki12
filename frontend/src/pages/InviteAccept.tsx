/**
 * InviteAccept — página de aceite de convite de equipe via link (Slice 1, R1-b)
 * + link transitivo de contato (R-transitivo).
 *
 * Rota: /convite/:token  (PÚBLICA — fora do ProtectedRoute, ver App.tsx)
 *
 * Duas direções, distinguidas pelo prefixo do token (ver teamConnectionService):
 *   - Token de EMPRESA (sem prefixo): quem abre precisa estar logado como WORKER.
 *     Chama `addToTeamByToken` (deriva workerId da sessão, empresa vem do token).
 *   - Token de WORKER (prefixo `w_`): quem abre precisa estar logado como EMPRESA.
 *     Chama `addWorkerToTeamByToken` (deriva companyId da sessão, worker vem do token).
 *     Esse é o link "transitivo": uma empresa que já tem o worker no elenco pode
 *     repassar o MESMO link a outra empresa, sem precisar pedir ao worker de novo.
 *
 * Item 11 (bug crítico do GTM) — fluxo sem conta:
 * A rota é PÚBLICA para não perder o token: se ela ficasse sob ProtectedRoute, o guard
 * mandava o freela sem sessão para "/" antes deste componente montar, e o token do link
 * desaparecia da URL. Agora, ao montar, checamos a sessão diretamente aqui: sem sessão,
 * guardamos o token em sessionStorage (`pending_invite_token`, rede de segurança) e
 * navegamos para `/login?redirect=/convite/<token>`. O Login (Login.tsx) lê `redirect` e
 * volta para cá após cadastro/login — a conexão é então processada normalmente.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, Building2, User, ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { TeamConnectionService } from '../services/teamConnectionService';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { PENDING_INVITE_TOKEN_KEY } from '../lib/inviteToken';
import PageMeta from '../components/PageMeta';
import { Button, Card } from '../components/ui';

type PageState = 'loading' | 'success' | 'already_exists' | 'blocked' | 'error';
type InviteDirection = 'company' | 'worker';

interface PageData {
  state: PageState;
  errorMsg?: string;
}

interface StatusCardProps {
  icon: ReactNode;
  iconClassName: string;
  shadowClassName?: string;
  title: string;
  children?: ReactNode;
}

/** Moldura única dos estados da página (ícone, título, corpo e UMA ação). */
function StatusCard({ icon, iconClassName, shadowClassName, title, children }: StatusCardProps) {
  return (
    <Card padding="lg" className={`text-center ${shadowClassName ?? 'shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]'}`}>
      <div className={`w-14 h-14 border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-5 ${iconClassName}`}>
        {icon}
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-2">{title}</h1>
      {children}
    </Card>
  );
}

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState<PageData>({ state: 'loading' });

  // Direção do convite é conhecida só pelo prefixo do token — não depende de rede.
  const direction: InviteDirection = token && TeamConnectionService.isWorkerInviteToken(token)
    ? 'worker'
    : 'company';
  const redirectTo = direction === 'worker' ? '/company/team' : '/my-jobs';
  const redirectLabel = direction === 'worker' ? 'Ver Meu Elenco' : 'Ver Meus Turnos';

  useEffect(() => {
    let active = true;

    async function processInvite() {
      if (!token) {
        if (active) setPage({ state: 'error', errorMsg: 'Link de convite inválido.' });
        return;
      }

      // Sem sessão: preserva o token e manda pro login em vez de deixar o
      // service falhar com "sessão expirada" — ver nota do item 11 no topo do arquivo.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!active) return;
        try {
          sessionStorage.setItem(PENDING_INVITE_TOKEN_KEY, token);
        } catch {
          // sessionStorage indisponível (ex.: modo privado restrito) — segue só com o query param
        }
        navigate(`/login?redirect=${encodeURIComponent(`/convite/${token}`)}`, { replace: true });
        return;
      }

      try {
        const result = TeamConnectionService.isWorkerInviteToken(token)
          ? await TeamConnectionService.addWorkerToTeamByToken(token)
          : await TeamConnectionService.addToTeamByToken(token);

        if (!active) return;

        if (result.error) {
          setPage({ state: 'error', errorMsg: result.error });
          return;
        }

        try {
          sessionStorage.removeItem(PENDING_INVITE_TOKEN_KEY);
        } catch {
          // ignora — best-effort
        }

        if (result.alreadyExists) {
          // O freela vetou a empresa (status 'blocked') — o veto continua íntegro no banco
          // (policy de DELETE guardada); aqui só não podemos afirmar sucesso nem revelar que
          // houve bloqueio. Mesma copy neutra do hook (useTeamConnections.addWorker).
          if (result.blocked) {
            setPage({ state: 'blocked' });
            return;
          }
          setPage({ state: 'already_exists' });
          return;
        }

        setPage({ state: 'success' });
      } catch (err) {
        logError('InviteAccept.processInvite', err);
        if (active) {
          setPage({ state: 'error', errorMsg: 'Ocorreu um erro inesperado. Tente novamente.' });
        }
      }
    }

    void processInvite();
    return () => { active = false; };
  }, [token, navigate]);

  const successTitle = direction === 'worker' ? 'Freela Convidado!' : 'Convite Aceito!';
  const successBody = direction === 'worker'
    ? 'O freela do link entrou (pendente de aceite dele) no seu elenco. Assim que ele confirmar, você poderá convidá-lo para turnos.'
    : 'Você entrou para o elenco da empresa. Agora pode receber convites de turno diretamente.';
  const alreadyTitle = direction === 'worker' ? 'Já está no seu elenco' : 'Você já está no elenco';
  const alreadyBody = direction === 'worker'
    ? 'Esse freela já tem uma conexão com a sua empresa. Não é necessário repetir.'
    : 'Você já tem uma conexão com esta empresa. Não é necessário aceitar novamente.';

  const GREEN_SHADOW = 'shadow-[6px_6px_0px_0px_rgba(0,166,81,1)]';

  return (
    <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
      <PageMeta
        title="Convite de Elenco"
        description="Aceite o convite para entrar no elenco de uma empresa no Worki."
      />

      <div className="w-full max-w-md">
        {/* Loading */}
        {page.state === 'loading' && (
          <StatusCard
            iconClassName="bg-primary-light"
            icon={direction === 'worker'
              ? <User size={28} className="text-primary" />
              : <Building2 size={28} className="text-primary" />}
            title="Convite de Elenco"
          >
            <div className="flex items-center justify-center gap-3 text-gray-600 mt-5" role="status">
              <Loader2 className="animate-spin text-primary" size={22} />
              <span className="text-sm font-semibold">Processando convite...</span>
            </div>
          </StatusCard>
        )}

        {/* Sucesso */}
        {page.state === 'success' && (
          <StatusCard
            iconClassName="bg-primary"
            shadowClassName={GREEN_SHADOW}
            icon={<CheckCircle2 size={28} className="text-white" />}
            title={successTitle}
          >
            <p className="text-sm sm:text-base text-gray-600 mb-6">{successBody}</p>
            <Button
              variant={direction === 'worker' ? 'dark' : 'primary'}
              size="lg"
              fullWidth
              onClick={() => navigate(redirectTo)}
              iconRight={<ArrowRight size={18} />}
            >
              {redirectLabel}
            </Button>
          </StatusCard>
        )}

        {/* Já existe (idempotência) */}
        {page.state === 'already_exists' && (
          <StatusCard
            iconClassName="bg-primary-light"
            shadowClassName={GREEN_SHADOW}
            icon={<CheckCircle2 size={28} className="text-primary" />}
            title={alreadyTitle}
          >
            <p className="text-sm sm:text-base text-gray-600 mb-6">{alreadyBody}</p>
            <Button
              variant={direction === 'worker' ? 'dark' : 'primary'}
              size="lg"
              fullWidth
              onClick={() => navigate(redirectTo)}
              iconRight={<ArrowRight size={18} />}
            >
              {redirectLabel}
            </Button>
          </StatusCard>
        )}

        {/* Bloqueado — não afirma sucesso, mas também não revela que houve veto do freela */}
        {page.state === 'blocked' && (
          <StatusCard
            iconClassName="bg-gray-50"
            icon={<XCircle size={28} className="text-gray-500" />}
            title="Não Foi Possível Concluir"
          >
            <p className="text-sm sm:text-base text-gray-600 mb-6">
              Não é possível adicionar este freela agora.
            </p>
            <Button
              variant="dark"
              size="lg"
              fullWidth
              onClick={() => navigate(redirectTo)}
              iconRight={<ArrowRight size={18} />}
            >
              {redirectLabel}
            </Button>
          </StatusCard>
        )}

        {/* Erro */}
        {page.state === 'error' && (
          <StatusCard
            iconClassName="bg-red-50"
            icon={<XCircle size={28} className="text-red-500" />}
            title="Não foi possível abrir o convite"
          >
            <p className="text-sm sm:text-base text-gray-600 mb-1" role="alert">
              {page.errorMsg ?? 'Não foi possível processar este convite.'}
            </p>
            <p className="text-xs sm:text-sm text-gray-600 mb-6">
              {direction === 'worker'
                ? 'Este link só pode ser aberto por uma conta de empresa.'
                : 'Peça à empresa um novo link de convite.'}
            </p>
            <Button
              variant="dark"
              size="lg"
              fullWidth
              onClick={() => navigate('/')}
              iconRight={<ArrowRight size={18} />}
            >
              Voltar ao início
            </Button>
          </StatusCard>
        )}
      </div>
    </div>
  );
}
