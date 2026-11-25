/**
 * InviteAccept — convite de Elenco por link (Slice 1, R1-b) + link transitivo de contato.
 *
 * Rota: /convite/:token  (PÚBLICA — fora do ProtectedRoute, ver App.tsx: sob o guard, sem sessão
 * o token do link se perderia).
 *
 * CONSENTIMENTO: abrir o link NUNCA grava nada. A página só confere a sessão e mostra o convite;
 * `addToTeamByToken` / `addWorkerToTeamByToken` rodam apenas no toque do botão principal.
 *
 * Duas direções, distinguidas pelo prefixo do token (ver teamConnectionService):
 *   - sem prefixo: link de EMPRESA, quem aceita é o freela logado;
 *   - `w_`: link de contato de FREELA, quem age é a empresa logada.
 *
 * Nome de quem convida: antes do aceite só a RPC `get_invite_preview` pode dizer (tolerante a
 * falha: sem ela o texto fica genérico). Depois do aceite o nome vem de `companies`.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, Building2, User, ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { TeamConnectionService, NOT_A_WORKER_ERROR } from '../services/teamConnectionService';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { PENDING_INVITE_TOKEN_KEY } from '../lib/inviteToken';
import PageMeta from '../components/PageMeta';
import { Button, Card, ErrorState } from '../components/ui';
import { checkSession } from '../lib/authSession';
import { getInvitePreviewName } from '../services/invitePreviewService';

type PageState =
  | 'loading' | 'confirm' | 'accepting' | 'success' | 'pending' | 'already_exists'
  | 'blocked' | 'invalid' | 'wrong_role' | 'error' | 'offline';

interface StatusCardProps {
  icon: ReactNode;
  iconClassName: string;
  title: string;
  children?: ReactNode;
}

/** Moldura única dos estados da página. */
function StatusCard({ icon, iconClassName, title, children }: StatusCardProps) {
  return (
    <Card padding="lg" className="text-center shadow-brutal-lg [overflow-wrap:anywhere]">
      <div className={`w-14 h-14 border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-5 ${iconClassName}`}>
        {icon}
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-2 text-balance">{title}</h1>
      {children}
    </Card>
  );
}

function forgetPendingToken() {
  try {
    sessionStorage.removeItem(PENDING_INVITE_TOKEN_KEY);
  } catch {
    // best-effort
  }
}

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>('loading');
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  // Nome de quem convida, quando a prévia responde; `null` = texto genérico.
  const [inviterName, setInviterName] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Direção do convite é conhecida só pelo prefixo do token — não depende de rede.
  const isWorkerLink = !!token && TeamConnectionService.isWorkerInviteToken(token);
  const redirectTo = isWorkerLink ? '/company/team' : '/carteira';
  const redirectLabel = isWorkerLink ? 'Ver meu Elenco' : 'Ver minhas empresas';

  // Montar a página só LÊ a sessão. Nenhuma escrita acontece aqui.
  useEffect(() => {
    let active = true;

    async function open() {
      // O mesmo teste que o service faz antes de gravar: se ele recusaria, o link é inválido
      // e dá para dizer isso já, sem custar um cadastro.
      const workerLink = !!token && TeamConnectionService.isWorkerInviteToken(token);
      const resolved = !token
        ? null
        : workerLink
          ? TeamConnectionService.resolveWorkerInviteToken(token)
          : TeamConnectionService.resolveInviteToken(token);
      if (!token || !resolved) {
        forgetPendingToken();
        if (active) setState('invalid');
        return;
      }

      const session = await checkSession();
      if (!active) return;
      if (session.status === 'unavailable') {
        logError('InviteAccept.session', session.error);
        setState('offline');
        return;
      }
      if (session.status === 'signed_out') {
        try {
          sessionStorage.setItem(PENDING_INVITE_TOKEN_KEY, token);
        } catch {
          // sessionStorage indisponível — segue só com o query param
        }
        // Link de contato de freela (`w_`) só serve a EMPRESA: sem `type=hire` o /login assume
        // freela, a conta nasce com o papel errado e o link fica inutilizável para ela.
        const papel = workerLink ? 'type=hire&' : '';
        navigate(`/login?${papel}redirect=${encodeURIComponent(`/convite/${token}`)}`, { replace: true });
        return;
      }

      const userType = session.user.user_metadata?.user_type;
      setAccountEmail(session.user.email ?? null);
      const wrongRole = workerLink ? userType === 'work' : userType === 'hire';
      if (!wrongRole) {
        const name = await getInvitePreviewName(token, workerLink ? 'freela' : 'elenco');
        if (!active) return;
        setInviterName(name);
      }
      setState(wrongRole ? 'wrong_role' : 'confirm');
    }

    void open();
    return () => { active = false; };
  }, [token, navigate, attempt]);

  const accept = async () => {
    if (!token || state === 'accepting') return;
    setState('accepting');
    try {
      const result = isWorkerLink
        ? await TeamConnectionService.addWorkerToTeamByToken(token)
        : await TeamConnectionService.addToTeamByToken(token);

      // Desfecho final nesta aba: sem limpar, o próximo login "seco" voltaria para cá.
      forgetPendingToken();

      if (result.error) {
        setErrorMsg(result.error);
        setState('error');
        return;
      }
      if (result.alreadyExists) {
        // O freela vetou a empresa (status 'blocked'): não afirmar sucesso nem revelar o bloqueio.
        setState(result.blocked ? 'blocked' : 'already_exists');
        return;
      }

      if (!isWorkerLink) {
        // A RPC devolve a linha que já existia sem mudar o status: só 'accepted' é "entrou".
        const status = result.connection?.status;
        if (status === 'blocked') {
          setState('blocked');
          return;
        }
        const companyId = result.connection?.company_id;
        if (companyId) {
          try {
            const { data } = await supabase.from('companies').select('name').eq('id', companyId).maybeSingle();
            setCompanyName((data as { name?: string | null } | null)?.name ?? null);
          } catch (err) {
            logError('InviteAccept.companyName', err);
          }
        }
        if (status === 'pending') {
          setState('pending');
          return;
        }
      }
      setState('success');
    } catch (err) {
      logError('InviteAccept.accept', err);
      setErrorMsg('Ocorreu um erro inesperado. Tente novamente.');
      setState('error');
    }
  };

  const decline = () => {
    forgetPendingToken();
    navigate('/');
  };

  const switchAccount = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      logError('InviteAccept.signOut', err);
    }
    setState('loading');
    setAttempt((n) => n + 1);
  };

  const brand = isWorkerLink ? 'dark' : 'primary';
  const inviteIcon = isWorkerLink
    ? <User size={28} className="text-primary" aria-hidden="true" />
    : <Building2 size={28} className="text-primary" aria-hidden="true" />;

  const goOn = (
    <Button variant={brand} size="lg" fullWidth onClick={() => navigate(redirectTo)} iconRight={<ArrowRight size={18} />}>
      {redirectLabel}
    </Button>
  );

  const home = (
    <Button variant="dark" size="lg" fullWidth onClick={() => navigate('/')} iconRight={<ArrowRight size={18} />}>
      Voltar ao início
    </Button>
  );

  const outcome = (title: string, body: string, ok: boolean, action: ReactNode = goOn) => (
    <StatusCard
      iconClassName={ok ? 'bg-primary-light' : 'bg-gray-100'}
      icon={ok
        ? <CheckCircle2 size={28} className="text-primary" aria-hidden="true" />
        : <XCircle size={28} className="text-gray-600" aria-hidden="true" />}
      title={title}
    >
      <p className="text-sm sm:text-base text-gray-600 mb-6" role="status">{body}</p>
      {action}
    </StatusCard>
  );

  const company = companyName ?? 'a empresa';

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <PageMeta title="Convite de Elenco" description="Veja o convite de Elenco no Worki." noindex />

      <div className="w-full max-w-md">
        {state === 'loading' && (
          <StatusCard iconClassName="bg-primary-light" icon={inviteIcon} title="Convite de Elenco">
            <div className="flex items-center justify-center gap-3 text-gray-600 mt-5" role="status">
              <Loader2 className="animate-spin text-primary" size={22} />
              <span className="text-sm font-semibold">Abrindo o convite...</span>
            </div>
          </StatusCard>
        )}

        {state === 'offline' && (
          <ErrorState onRetry={() => { setState('loading'); setAttempt((n) => n + 1); }} />
        )}

        {(state === 'confirm' || state === 'accepting') && (
          <StatusCard
            iconClassName="bg-primary-light"
            icon={inviteIcon}
            title={isWorkerLink
              ? `Convidar ${inviterName ?? 'um freela'} para o seu Elenco`
              : `${inviterName ?? 'Uma empresa'} te convidou para o Elenco dela`}
          >
            <p className="text-sm text-gray-600 mb-4">
              {isWorkerLink
                ? inviterName
                  ? `Você abriu o link de contato de ${inviterName}.`
                  : 'Você abriu o link de contato de um freela. O nome dele aparece no seu Elenco depois que você enviar o convite.'
                : inviterName
                  ? `Confira se é mesmo ${inviterName} quem te enviou o link. Nada é aceito sem o seu toque.`
                  : 'Não foi possível mostrar o nome da empresa antes do aceite. Só continue se você sabe quem te enviou. Nada é aceito sem o seu toque.'}
            </p>
            <div className="mb-4 rounded-xl border-2 border-gray-200 p-4 text-left text-sm">
              {isWorkerLink ? (
                <>
                  <p className="font-bold mb-1">O que acontece</p>
                  <ul className="list-disc pl-5 space-y-1 text-gray-700">
                    <li>O freela entra como aguardando resposta.</li>
                    <li>Você vê nome, foto, função, cidade e nota.</li>
                    <li>Telefone e chave PIX só aparecem se ele aceitar.</li>
                  </ul>
                </>
              ) : (
                <>
                  <p className="font-bold mb-1">Se você aceitar, {inviterName ?? 'a empresa'} poderá ver</p>
                  <ul className="list-disc pl-5 space-y-1 text-gray-700">
                    <li>seu nome, foto, funções, cidade e avaliações;</li>
                    <li>seu telefone e sua chave PIX;</li>
                    <li>os dados do seu cadastro, como CPF e data de nascimento.</li>
                  </ul>
                  <p className="mt-2 text-gray-600">Ela também poderá te convidar para turnos. Você pode sair do Elenco quando quiser, em Empresas.</p>
                </>
              )}
            </div>
            {accountEmail && (
              <p className="mb-4 text-sm text-gray-600">
                Você está com a conta <strong>{accountEmail}</strong>.
              </p>
            )}
            <div className="space-y-3">
              <Button
                variant={brand}
                size="lg"
                fullWidth
                loading={state === 'accepting'}
                onClick={() => void accept()}
                data-copilot="publico.convite-elenco.aceitar"
              >
                {isWorkerLink ? 'Convidar para o Elenco' : 'Entrar no Elenco'}
              </Button>
              <Button variant="secondary" size="lg" fullWidth disabled={state === 'accepting'} onClick={decline}>
                Agora não
              </Button>
            </div>
          </StatusCard>
        )}

        {state === 'success' && outcome(
          isWorkerLink ? 'Convite enviado' : 'Você entrou no Elenco',
          isWorkerLink
            ? 'Falta o freela aceitar. Depois disso você pode chamá-lo para turnos.'
            : `Agora ${company} pode te convidar para turnos. Você será avisado quando houver um convite.`,
          true,
        )}

        {state === 'pending' && outcome(
          'Falta você responder em Empresas',
          `Já existe um convite pendente de ${company}. Abra Empresas para aceitar ou recusar.`,
          true,
        )}

        {state === 'already_exists' && outcome(
          isWorkerLink ? 'Já está no seu elenco' : 'Você já está no elenco',
          isWorkerLink
            ? 'Já existe uma conexão com este freela. Veja no Elenco se ela está aceita ou aguardando resposta.'
            : 'Você já tem uma conexão com esta empresa. Não é necessário aceitar novamente.',
          true,
        )}

        {/* Bloqueado — não afirma sucesso, mas também não revela que houve veto do freela */}
        {state === 'blocked' && outcome(
          'Não foi possível concluir',
          isWorkerLink ? 'Não é possível adicionar este freela agora.' : 'Não é possível concluir este convite agora.',
          false,
        )}

        {state === 'invalid' && outcome(
          'Link de convite inválido',
          `Este link está incompleto ou não vale mais. Confira se copiou o link inteiro ou peça um novo ${isWorkerLink ? 'ao freela' : 'à empresa'}.`,
          false,
          home,
        )}

        {state === 'wrong_role' && outcome(
          isWorkerLink ? 'Este link é para empresas' : 'Este link é para freelas',
          isWorkerLink
            ? 'Só uma conta de empresa pode usar este link. Para continuar, entre com a conta da empresa.'
            : `${NOT_A_WORKER_ERROR} Você está com uma conta de empresa. Se o convite é para você, entre com sua conta de freela.`,
          false,
          <div className="space-y-3">
            <Button variant="dark" size="lg" fullWidth onClick={() => void switchAccount()}>
              Sair e usar outra conta
            </Button>
            <Button variant="secondary" size="lg" fullWidth onClick={decline}>
              Agora não
            </Button>
          </div>,
        )}

        {state === 'error' && (
          <StatusCard
            iconClassName="bg-gray-100"
            icon={<XCircle size={28} className="text-red-600" aria-hidden="true" />}
            title="Não foi possível concluir o convite"
          >
            <p className="text-sm sm:text-base text-gray-600 mb-1" role="alert">
              {errorMsg ?? 'Não foi possível processar este convite.'}
            </p>
            {errorMsg !== NOT_A_WORKER_ERROR && (
              <p className="text-sm text-gray-600">
                Se continuar, peça um novo link {isWorkerLink ? 'ao freela' : 'à empresa'}.
              </p>
            )}
            <div className="mt-6">{home}</div>
          </StatusCard>
        )}
      </div>
    </div>
  );
}
