/**
 * AcceptTeamInvite — entrada de Encarregado ou Gestor por link, com e-mail preso ao convite (E4 + ADR-20261127).
 *
 * Rota: /convite-equipe/:token (PÚBLICA — fora do ProtectedRoute, mesmo motivo de InviteAccept:
 * sob o guard, sem sessão o token do link se perderia).
 *
 * Fluxo, SEM OTP e sem nenhum e-mail enviado pelo Workyn: prévia pública ("{Empresa} te convidou
 * como Encarregado" + e-mail mascarado) → senha + Termos → Edge Function `accept-team-invite` cria a
 * conta com o e-mail do convite (`user_type='hire'`) → `signInWithPassword` →
 * `accept_company_member_invite(token, true)` → Hoje. Conta que já existe: a pessoa entra com a
 * própria senha e o banco confere que a sessão é o e-mail do convite (`email_mismatch`, sem queimar
 * o token). Se o Gestor ainda não confirmou, o ProtectedRoute mostra a tela de espera (R22).
 *
 * CONSENTIMENTO: abrir o link nunca aceita; só o clique no botão (com os Termos marcados).
 * O token nunca vai em URL de RPC: a prévia e o aceite saem por POST (`.rpc()`), ver service.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Building2, Eye, EyeOff, Loader2, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { focusFirstInvalid } from '../lib/formErrors';
import PageMeta from '../components/PageMeta';
import { Button, Card, Field } from '../components/ui';
import {
  clearPendingTeamInviteToken,
  readPendingTeamInviteToken,
  storePendingTeamInviteToken,
} from '../lib/teamInviteToken';
import {
  acceptMemberInvite,
  getInvitePreview,
  provisionTeamInviteAccount,
  ROLE_LABEL,
} from '../services/teamMembersService';
import { invalidateCompanyScope, switchCompany } from '../services/companyScopeService';
import type { InvitePreviewResult } from '../types';

type Step = 'form' | 'working';
/** `create`: conta nova com o e-mail do convite. `login`: a pessoa já tem conta e entra com ela. */
type Mode = 'create' | 'login';

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

/** Desfechos que encerram o fluxo com uma mensagem (tudo menos accepted/already_accepted/already_operator). */
const OUTCOME_COPY: Record<
  string,
  { title: string; body: string }
> = {
  expired: {
    title: 'Convite vencido',
    body: 'Este link passou da validade. Peça ao Gestor para reenviar um novo convite.',
  },
  revoked: {
    title: 'Convite cancelado',
    body: 'O Gestor cancelou este convite. Peça um novo, se ainda precisar entrar na equipe.',
  },
  token_already_used: {
    title: 'Link já usado',
    body: 'Este link já foi usado por outra pessoa. Peça um novo link ao Gestor.',
  },
  not_found: {
    title: 'Link inválido',
    body: 'Não encontramos este convite. Confira se copiou o link inteiro ou peça um novo ao Gestor.',
  },
  worker_cannot_be_manager: {
    title: 'Este e-mail é de uma conta de freela',
    body: 'Este e-mail já é de uma conta de freela e não pode entrar na equipe de uma empresa. Peça ao Gestor um convite com outro e-mail.',
  },
  manager_requires_verified_signup: {
    title: 'Cadastre-se primeiro',
    body: 'Para entrar como Gestor, cadastre-se primeiro com este e-mail e confirme o e-mail. Depois abra este link de novo.',
  },
  email_not_verified: {
    title: 'Não conseguimos confirmar seu e-mail',
    body: 'Sua conta ainda não está confirmada. Peça ao Gestor um convite com outro e-mail ou use "Esqueci a senha" na tela de login.',
  },
  email_mismatch: {
    title: 'Este convite é para outro e-mail',
    body: 'Você entrou com um e-mail diferente do que o Gestor informou. O convite continua valendo: entre com a conta certa.',
  },
  account_pending: {
    title: 'Já existe uma conta com este e-mail',
    body: 'Já existe uma conta com este e-mail ainda não confirmada. Peça ao Gestor um convite com outro e-mail ou use "Esqueci a senha" na tela de entrada.',
  },
  rate_limited: {
    title: 'Muitas tentativas',
    body: 'Houve muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
  },
  legacy_invite: {
    title: 'Convite antigo',
    body: 'Este convite é de um modelo antigo e não funciona mais. Peça ao Gestor um novo link.',
  },
  invalid_input: {
    title: 'Não foi possível entrar',
    body: 'Algo no convite não está certo. Peça um novo link ao Gestor.',
  },
  unauthenticated: {
    title: 'Sua sessão expirou',
    body: 'Entre de novo com seu e-mail e senha para continuar.',
  },
  error: {
    title: 'Não foi possível processar',
    body: 'Ocorreu um erro inesperado. Tente novamente em instantes ou peça um novo link ao Gestor.',
  },
};

type TerminalOutcome = keyof typeof OUTCOME_COPY;

/** Token morto não pode ficar guardado: o ProtectedRoute o usaria para redirecionar em ciclo. */
const clearStoredToken = clearPendingTeamInviteToken;

export default function AcceptTeamInvite() {
  const { token: paramToken } = useParams<{ token: string }>();
  // A URL manda; o sessionStorage é a rede de segurança (reload, volta do login) e é apagado no aceite.
  const token = paramToken ?? readPendingTeamInviteToken() ?? undefined;
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitePreviewResult | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionIsWorker, setSessionIsWorker] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [mode, setMode] = useState<Mode>('create');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [acceptedTos, setAcceptedTos] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [terminal, setTerminal] = useState<TerminalOutcome | null>(null);

  const loadPreview = useCallback(async () => {
    if (!token) {
      setPreview({ outcome: 'not_found' });
      return null;
    }
    setPreview(null);
    const result = await getInvitePreview(token);
    // Só um convite VÁLIDO fica guardado (rede de segurança do reload/login). Convite inexistente,
    // vencido ou revogado apaga o que houver, para não prender a conta num redirecionamento em ciclo.
    // Falha de rede (`error`) preserva o estado anterior: o convite pode estar bom.
    if (result.outcome === 'ok') storePendingTeamInviteToken(token);
    else if (result.outcome !== 'error') clearStoredToken();
    setPreview(result);
    return result;
  }, [token]);

  /** Chama o aceite com a sessão atual e traduz o desfecho. */
  const finish = useCallback(async () => {
    if (!token) return;
    setStep('working');
    const result = await acceptMemberInvite(token, true);
    if (
      result.outcome === 'accepted'
      || result.outcome === 'already_accepted'
      || result.outcome === 'already_operator'
    ) {
      clearStoredToken();
      // Quem já tem empresa própria cairia nela (`pickPrimaryCompany`): abre a do convite.
      if (result.companyId) switchCompany(result.companyId);
      invalidateCompanyScope();
      // Cai direto na Hoje (E5); sem onboarding de CNPJ (o ProtectedRoute resolve pelo seam
      // e, se o Gestor ainda não confirmou, mostra a tela de espera).
      navigate('/company/hoje', { replace: true });
      return;
    }
    if (result.outcome === 'tos_required') {
      // Não é beco sem saída: volta à etapa com o checkbox dos Termos (a sessão já existe).
      setAcceptedTos(false);
      setStep('form');
      setFormError('Para entrar, aceite os Termos de Uso e a Política de Privacidade.');
      return;
    }
    // `email_mismatch` NÃO queima o token (o banco recusa antes de consumir): mantém guardado.
    // Todo outro desfecho terminal (not_found, expired, revoked, token_already_used...) o descarta.
    if (
      result.outcome !== 'error'
      && result.outcome !== 'unauthenticated'
      && result.outcome !== 'email_mismatch'
    ) {
      clearStoredToken();
    }
    // Desfecho fora do contrato (RPC nova, resposta estranha) cai em 'error' em vez de tela branca.
    setTerminal(result.outcome in OUTCOME_COPY ? (result.outcome as TerminalOutcome) : 'error');
    setStep('form');
  }, [token, navigate]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await loadPreview();
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!active || !user) return;
        setSessionEmail(user.email ?? null);
        setSessionIsWorker(user.user_metadata?.user_type === 'work');
      } catch (err) {
        logError('AcceptTeamInvite.getUser', err);
      }
    })();
    return () => { active = false; };
  }, [loadPreview]);

  /** Entra com e-mail e senha e conclui o aceite. Devolve `false` se o login em si falhou. */
  const signInAndFinish = async (email: string, pass: string): Promise<boolean> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error || !data.user) {
      if (error) logError('AcceptTeamInvite.signIn', error);
      return false;
    }
    setSessionEmail(data.user.email ?? email);
    if (data.user.user_metadata?.user_type === 'work') {
      // Conta de freela: não cria nem move conta de empresa (Article 1).
      setSessionIsWorker(true);
      clearStoredToken();
      setTerminal('worker_cannot_be_manager');
      return true;
    }
    await finish();
    return true;
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    setPasswordError(undefined);
    setConfirmError(undefined);
    const form = e.currentTarget as HTMLFormElement;
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      flushSync(() => setPasswordError(`A senha precisa ter de ${MIN_PASSWORD} a ${MAX_PASSWORD} caracteres.`));
      focusFirstInvalid(form);
      return;
    }
    if (password !== confirmPassword) {
      flushSync(() => setConfirmError('As senhas não são iguais.'));
      focusFirstInvalid(form);
      return;
    }
    if (!acceptedTos) {
      setFormError('Aceite os Termos de Uso e a Política de Privacidade para continuar.');
      return;
    }
    if (!token) return;
    setSending(true);
    const result = await provisionTeamInviteAccount(token, password);
    if (result.outcome === 'created' && result.email) {
      const entered = await signInAndFinish(result.email, password);
      setSending(false);
      if (!entered) {
        // Conta criada, mas o login falhou: a criação não se repete, então segue pelo login.
        setLoginEmail(result.email);
        setMode('login');
        setFormError('Sua conta foi criada, mas não conseguimos entrar agora. Digite a senha que você acabou de criar.');
      }
      return;
    }
    setSending(false);
    switch (result.outcome) {
      case 'existing_account':
        setMode('login');
        return;
      case 'account_pending':
      case 'worker_cannot_be_manager':
      case 'legacy_invite':
      case 'not_found':
      case 'expired':
        clearStoredToken();
        setTerminal(result.outcome);
        return;
      case 'rate_limited':
        setTerminal('rate_limited');
        return;
      case 'invalid_input':
        setFormError('Confira a senha (8 a 72 caracteres) e os Termos e tente de novo.');
        return;
      default:
        setFormError('Não foi possível criar sua conta agora. Tente de novo em instantes.');
    }
  };

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const clean = loginEmail.trim().toLowerCase();
    if (!clean || !clean.includes('@') || !loginPassword) {
      setFormError('Digite o e-mail e a senha da sua conta.');
      return;
    }
    if (!acceptedTos) {
      setFormError('Aceite os Termos de Uso e a Política de Privacidade para continuar.');
      return;
    }
    setSending(true);
    const entered = await signInAndFinish(clean, loginPassword);
    setSending(false);
    if (!entered) setFormError('E-mail ou senha incorretos. Confira e tente de novo.');
  };

  /** Desiste: apaga o token guardado. Nada é gravado no banco. */
  const agoraNao = () => {
    clearStoredToken();
    navigate('/');
  };

  /** Sai da sessão atual e abre o login para entrar com a conta do convite. */
  const trocarDeConta = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      logError('AcceptTeamInvite.signOut', err);
    }
    setSessionEmail(null);
    setSessionIsWorker(false);
    setTerminal(null);
    setLoginEmail('');
    setLoginPassword('');
    setMode('login');
    setFormError(undefined);
    setStep('form');
  };

  // ── Renderização ───────────────────────────────────────────────────────────────────────────

  const frame = (children: ReactNode) => (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <PageMeta title="Convite para a equipe" description="Entre na equipe de uma empresa no Worki." noindex />
      <div className="w-full max-w-md">
        <Card padding="lg" className="shadow-brutal-lg [overflow-wrap:anywhere]">
          {children}
        </Card>
      </div>
    </div>
  );

  const alerta = (tone: 'error' | 'neutral', title: string, body: string) => (
    <div className="text-center" role="alert">
      <div
        className={`w-14 h-14 border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-5 ${
          tone === 'neutral' ? 'bg-blue-50' : 'bg-gray-100'
        }`}
      >
        {tone === 'neutral' ? (
          <Building2 size={28} className="text-blue-600" aria-hidden="true" />
        ) : (
          <XCircle size={28} className="text-red-500" aria-hidden="true" />
        )}
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-2">{title}</h1>
      <p className="text-base text-gray-700 mb-6">{body}</p>
    </div>
  );

  const irParaInicio = (
    <Button variant="dark" size="lg" fullWidth onClick={() => navigate('/')} iconRight={<ArrowRight size={18} />}>
      Ir para o início
    </Button>
  );

  if (preview === null) {
    return frame(
      <div className="text-center">
        <div className="w-14 h-14 border-2 border-black rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-5">
          <Building2 size={28} className="text-blue-600" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-center gap-3 text-gray-600" role="status">
          <Loader2 className="animate-spin text-blue-600" size={22} />
          <span className="text-sm font-semibold">Abrindo seu convite...</span>
        </div>
      </div>,
    );
  }

  if (preview.outcome === 'error') {
    return frame(
      <>
        {alerta('error', 'Não foi possível abrir o convite', 'Não conseguimos abrir o convite agora. Tente de novo em instantes. Se continuar, peça um novo link ao Gestor.')}
        <Button variant="dark" size="lg" fullWidth onClick={() => void loadPreview()}>
          Tentar de novo
        </Button>
      </>,
    );
  }

  if (preview.outcome === 'not_found' || preview.outcome === 'expired') {
    const copy = OUTCOME_COPY[preview.outcome];
    return frame(
      <>
        {alerta('error', copy.title, copy.body)}
        {irParaInicio}
      </>,
    );
  }

  // Convite antigo (sem e-mail preso): o ramo por código está morto, então não há como aceitar.
  if (!preview.emailBound) {
    const copy = OUTCOME_COPY.legacy_invite;
    return frame(
      <>
        {alerta('error', copy.title, copy.body)}
        {irParaInicio}
      </>,
    );
  }

  if (terminal) {
    const copy = OUTCOME_COPY[terminal] ?? OUTCOME_COPY.error;
    return frame(
      <>
        {alerta('error', copy.title, copy.body)}
        {terminal === 'manager_requires_verified_signup' ? (
          <Button
            variant="dark"
            size="lg"
            fullWidth
            onClick={() => navigate(`/login?type=hire&cadastro=1&redirect=${encodeURIComponent(`/convite-equipe/${token ?? ''}`)}`)}
            iconRight={<ArrowRight size={18} />}
          >
            Cadastrar com este e-mail
          </Button>
        ) : terminal === 'error' && sessionEmail && !sessionIsWorker ? (
          <Button
            variant="dark"
            size="lg"
            fullWidth
            onClick={() => { setTerminal(null); void finish(); }}
          >
            Tentar de novo
          </Button>
        ) : terminal === 'rate_limited' ? (
          <Button variant="dark" size="lg" fullWidth onClick={() => setTerminal(null)}>
            Voltar ao convite
          </Button>
        ) : terminal === 'account_pending' ? (
          <Button variant="dark" size="lg" fullWidth onClick={() => navigate('/login')} iconRight={<ArrowRight size={18} />}>
            Ir para o login
          </Button>
        ) : terminal === 'email_mismatch'
          || terminal === 'worker_cannot_be_manager'
          || terminal === 'email_not_verified'
          || terminal === 'unauthenticated' ? (
          <Button variant="dark" size="lg" fullWidth onClick={() => void trocarDeConta()}>
            Entrar com outra conta
          </Button>
        ) : (
          irParaInicio
        )}
      </>,
    );
  }

  const roleLabel = ROLE_LABEL[preview.role ?? 'encarregado'];
  const company = preview.companyName ?? 'Uma empresa';

  const header = (
    <div className="text-center mb-6">
      <div className="w-14 h-14 border-2 border-black rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
        <Building2 size={28} className="text-blue-600" aria-hidden="true" />
      </div>
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-balance">
        {company} te convidou como {roleLabel}
      </h1>
      <p className="text-sm text-gray-600 mt-2">
        {mode === 'login' || sessionEmail
          ? 'Entre com a sua conta para aceitar o convite.'
          : 'Crie uma senha para entrar.'}
      </p>
      {preview.role === 'manager' && (
        <p className="text-sm font-bold mt-2">
          Como Gestor você terá acesso total à empresa. Só começa a operar depois que o dono confirmar.
        </p>
      )}
    </div>
  );

  const termsBox = (
    // Área de toque >= 44px: o <label> inteiro (min-h-11) é o alvo, não só a caixinha.
    <div className="flex items-start gap-3 min-h-11">
      <input
        id="team-invite-tos"
        type="checkbox"
        checked={acceptedTos}
        onChange={(e) => { setAcceptedTos(e.target.checked); setFormError(undefined); }}
        className="mt-2 h-7 w-7 shrink-0 rounded border-2 border-black accent-black"
      />
      <label htmlFor="team-invite-tos" className="text-sm text-gray-800 py-3 min-h-11">
        Li e aceito os{' '}
        <a href="/termos" target="_blank" rel="noopener noreferrer" className="font-bold underline">
          Termos de Uso
        </a>{' '}
        e a{' '}
        <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="font-bold underline">
          Política de Privacidade
        </a>
        .
      </label>
    </div>
  );

  const oQueAEmpresaVe = (
    <p className="rounded-xl border-2 border-gray-200 p-3 text-sm text-gray-700">
      Ao aceitar, você entra na equipe e a empresa passa a ver seu e-mail e o que você fizer em nome dela.
    </p>
  );

  const naoAgora = (
    <Button variant="secondary" size="lg" fullWidth onClick={agoraNao}>
      Agora não
    </Button>
  );

  const errorLine = formError ? (
    <p role="alert" className="text-sm font-bold text-red-600">
      {formError}
    </p>
  ) : null;

  if (step === 'working') {
    return frame(
      <>
        {header}
        <div className="flex items-center justify-center gap-3 text-gray-600" role="status">
          <Loader2 className="animate-spin text-blue-600" size={22} />
          <span className="text-sm font-semibold">Entrando na equipe...</span>
        </div>
      </>,
    );
  }

  // Já há sessão: não precisa de senha; só os Termos e entrar.
  if (sessionEmail) {
    if (sessionIsWorker) {
      return frame(
        <>
          {alerta(
            'error',
            OUTCOME_COPY.worker_cannot_be_manager.title,
            OUTCOME_COPY.worker_cannot_be_manager.body,
          )}
          <Button variant="dark" size="lg" fullWidth onClick={() => void trocarDeConta()}>
            Entrar com outra conta
          </Button>
        </>,
      );
    }
    return frame(
      <>
        {header}
        <div className="space-y-4">
          <p className="text-sm text-gray-800">
            Você está com a conta <strong>{sessionEmail}</strong>.
          </p>
          {oQueAEmpresaVe}
          {termsBox}
          {errorLine}
          {!acceptedTos && <p className="text-sm text-gray-600">Marque os Termos acima para aceitar.</p>}
          <Button
            data-copilot="publico.convite-equipe.entrar"
            variant="dark"
            size="lg"
            fullWidth
            disabled={!acceptedTos}
            onClick={() => void finish()}
            iconRight={<ArrowRight size={18} />}
          >
            Entrar na equipe
          </Button>
          {naoAgora}
          <Button variant="ghost" size="lg" fullWidth onClick={() => void trocarDeConta()}>
            Não sou eu — usar outra conta
          </Button>
        </div>
      </>,
    );
  }

  if (mode === 'login') {
    return frame(
      <>
        {header}
        <form onSubmit={(e) => void submitLogin(e)} className="space-y-4" noValidate>
          <p className="text-sm text-gray-800">
            Já existe uma conta com o e-mail do convite
            {preview.emailMasked ? <> (<strong>{preview.emailMasked}</strong>)</> : null}. Entre com ela.
          </p>
          <Field label="Seu e-mail" required>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={loginEmail}
              onChange={(e) => { setLoginEmail(e.target.value); setFormError(undefined); }}
            />
          </Field>
          <Field label="Sua senha" required>
            <input
              type="password"
              autoComplete="current-password"
              value={loginPassword}
              onChange={(e) => { setLoginPassword(e.target.value); setFormError(undefined); }}
            />
          </Field>
          {oQueAEmpresaVe}
          {termsBox}
          {errorLine}
          <Button
            type="submit"
            variant="dark"
            size="lg"
            fullWidth
            loading={sending}
            iconRight={<ArrowRight size={18} />}
            data-copilot="publico.convite-equipe.entrar-conta"
          >
            Entrar na equipe
          </Button>
          {naoAgora}
        </form>
      </>,
    );
  }

  return frame(
    <>
      {header}
      <form onSubmit={(e) => void submitCreate(e)} className="space-y-4" noValidate>
        <div>
          <p className="text-sm font-bold text-black">E-mail do convite</p>
          <p className="mt-1 text-base font-semibold break-all" data-testid="convite-email">{preview.emailMasked ?? ''}</p>
          <p className="mt-1 text-sm text-gray-600">Definido por quem te convidou. Não dá para trocar aqui.</p>
        </div>
        <Field label="Crie uma senha" required hint="De 8 a 72 caracteres." error={passwordError}>
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            maxLength={MAX_PASSWORD}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setFormError(undefined); setPasswordError(undefined); }}
          />
        </Field>
        <Field label="Repita a senha" required error={confirmError}>
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            maxLength={MAX_PASSWORD}
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setFormError(undefined); setConfirmError(undefined); }}
          />
        </Field>
        <Button
          variant="ghost"
          size="md"
          onClick={() => setShowPassword((v) => !v)}
          iconLeft={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {showPassword ? 'Ocultar senha' : 'Mostrar senha'}
        </Button>
        {oQueAEmpresaVe}
        {termsBox}
        {errorLine}
        <Button
          type="submit"
          variant="dark"
          size="lg"
          fullWidth
          loading={sending}
          iconRight={<ArrowRight size={18} />}
          data-copilot="publico.convite-equipe.aceitar"
        >
          Criar senha e entrar na equipe
        </Button>
        <Button variant="ghost" size="lg" fullWidth onClick={() => { setMode('login'); setFormError(undefined); }}>
          Já tenho conta com este e-mail
        </Button>
        {naoAgora}
      </form>
    </>,
  );
}
