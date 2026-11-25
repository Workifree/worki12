/**
 * AcceptTeamInvite — entrada de Encarregado por link, SEM senha (Equipe e encarregados, E4).
 *
 * Rota: /convite-equipe/:token (PÚBLICA — fora do ProtectedRoute, mesmo motivo de InviteAccept e
 * AcceptManagerInvite: sob o guard, sem sessão o token do link se perderia).
 *
 * Fluxo (spec R13): prévia pública ("{Empresa} te convidou como Encarregado") → e-mail + Termos →
 * código de 6 dígitos enviado por e-mail (`signInWithOtp`/`verifyOtp`, conta nasce com
 * `user_type='hire'`, nunca de freela) → `accept_company_member_invite(token, true)` → cai na tela da
 * empresa, sem onboarding de CNPJ. Se o Gestor ainda não confirmou, o ProtectedRoute mostra a tela de
 * espera (R22).
 *
 * O token nunca vai em URL de RPC: a prévia e o aceite saem por POST (`.rpc()`), ver service.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Building2, CheckCircle2, Loader2, Mail, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import PageMeta from '../components/PageMeta';
import { Button, Card, Field } from '../components/ui';
import { clearPendingTeamInviteToken, readPendingTeamInviteToken, storePendingTeamInviteToken } from '../lib/teamInviteToken';
import { acceptMemberInvite, getInvitePreview, ROLE_LABEL } from '../services/teamMembersService';
import type { AcceptMemberInviteOutcome, InvitePreviewResult } from '../types';

type Step = 'form' | 'code' | 'working';

/** Desfechos que encerram o fluxo com uma mensagem (tudo menos accepted/already_accepted/already_operator). */
const OUTCOME_COPY: Record<
  Exclude<AcceptMemberInviteOutcome, 'accepted' | 'already_accepted' | 'already_operator' | 'tos_required'>,
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
    body: 'Este e-mail já é de uma conta de freela. Use outro e-mail para entrar na equipe.',
  },
  use_manager_invite: {
    title: 'Este convite é de Gestor',
    body: 'Convites de Gestor têm outro caminho de entrada. Toque abaixo para continuar.',
  },
  email_not_verified: {
    title: 'Não conseguimos confirmar seu e-mail',
    body: 'Peça um novo código e tente de novo. Se continuar, avise o Gestor.',
  },
  invalid_input: {
    title: 'Não foi possível entrar',
    body: 'Algo no convite não está certo. Peça um novo link ao Gestor.',
  },
  unauthenticated: {
    title: 'Sua sessão expirou',
    body: 'Entre de novo com o código do e-mail para continuar.',
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
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [acceptedTos, setAcceptedTos] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [terminal, setTerminal] = useState<TerminalOutcome | null>(null);

  const loadPreview = useCallback(async () => {
    if (!token) {
      setPreview({ outcome: 'not_found' });
      return;
    }
    setPreview(null);
    const result = await getInvitePreview(token);
    // Só um convite VÁLIDO fica guardado (rede de segurança do reload/login). Convite inexistente,
    // vencido ou revogado apaga o que houver, para não prender a conta num redirecionamento em ciclo.
    // Falha de rede (`error`) preserva o estado anterior: o convite pode estar bom.
    if (result.outcome === 'ok') storePendingTeamInviteToken(token);
    else if (result.outcome !== 'error') clearStoredToken();
    setPreview(result);
  }, [token]);

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
    // Todo desfecho terminal (not_found, expired, revoked, token_already_used...) descarta o token.
    if (result.outcome !== 'error' && result.outcome !== 'unauthenticated') clearStoredToken();
    // Desfecho fora do contrato (RPC nova, resposta estranha) cai em 'error' em vez de tela branca.
    setTerminal(result.outcome in OUTCOME_COPY ? (result.outcome as TerminalOutcome) : 'error');
    setStep('form');
  }, [token, navigate]);

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const clean = email.trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      setFormError('Digite um e-mail válido.');
      return;
    }
    if (!acceptedTos) {
      setFormError('Aceite os Termos de Uso e a Política de Privacidade para continuar.');
      return;
    }
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: clean,
      // A conta nasce como EMPRESA ('hire'): quem entra na equipe nunca é conta de freela.
      options: { shouldCreateUser: true, data: { user_type: 'hire' } },
    });
    setSending(false);
    if (error) {
      logError('AcceptTeamInvite.sendCode', error);
      const limitado = error.status === 429 || /rate limit|security purposes|too many/i.test(error.message ?? '');
      setFormError(
        limitado
          ? 'Aguarde um minuto para pedir outro código.'
          : 'Não conseguimos enviar o código. Confira o e-mail e tente de novo.',
      );
      return;
    }
    setEmail(clean);
    setCode('');
    setStep('code');
  };

  const verifyCode = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const clean = code.replace(/\s/g, '');
    if (clean.length < 6) {
      setFormError('Digite o código que chegou no seu e-mail.');
      return;
    }
    setSending(true);
    const { data, error } = await supabase.auth.verifyOtp({ email, token: clean, type: 'email' });
    setSending(false);
    if (error || !data.user) {
      if (error) logError('AcceptTeamInvite.verifyCode', error);
      setFormError('Código incorreto ou vencido. Confira ou peça um novo código.');
      return;
    }
    // A partir daqui há sessão: se o aceite falhar, "tentar de novo"/Termos não pedem outro código.
    setSessionEmail(data.user.email ?? email);
    if (data.user.user_metadata?.user_type === 'work') {
      // E-mail que já é de freela: não cria nem move conta de empresa (Article 1).
      setSessionIsWorker(true);
      clearStoredToken();
      setTerminal('worker_cannot_be_manager');
      return;
    }
    await finish();
  };

  const trocarDeEmail = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      logError('AcceptTeamInvite.signOut', err);
    }
    setSessionEmail(null);
    setSessionIsWorker(false);
    setTerminal(null);
    setEmail('');
    setCode('');
    setFormError(undefined);
    setStep('form');
  };

  // ── Renderização ───────────────────────────────────────────────────────────────────────────

  const frame = (children: ReactNode) => (
    <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
      <PageMeta title="Convite para a equipe" description="Entre na equipe de uma empresa no Worki." noindex />
      <div className="w-full max-w-md">
        <Card padding="lg" className="shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          {children}
        </Card>
      </div>
    </div>
  );

  const alerta = (tone: 'error' | 'ok', title: string, body: string) => (
    <div className="text-center" role="alert">
      <div
        className={`w-14 h-14 border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-5 ${
          tone === 'ok' ? 'bg-blue-600' : 'bg-red-50'
        }`}
      >
        {tone === 'ok' ? (
          <CheckCircle2 size={28} className="text-white" aria-hidden="true" />
        ) : (
          <XCircle size={28} className="text-red-500" aria-hidden="true" />
        )}
      </div>
      <h1 className="text-2xl font-black tracking-tight mb-2">{title}</h1>
      <p className="text-base text-gray-700 mb-6">{body}</p>
    </div>
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
        <Button variant="dark" size="lg" fullWidth onClick={() => navigate('/')} iconRight={<ArrowRight size={18} />}>
          Ir para o início
        </Button>
      </>,
    );
  }

  if (terminal) {
    const copy = OUTCOME_COPY[terminal];
    return frame(
      <>
        {alerta('error', copy.title, copy.body)}
        {terminal === 'use_manager_invite' && token ? (
          <Button
            variant="dark"
            size="lg"
            fullWidth
            onClick={() => navigate(`/convite-gerente/${token}`)}
            iconRight={<ArrowRight size={18} />}
          >
            Continuar como Gestor
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
        ) : terminal === 'worker_cannot_be_manager' || terminal === 'email_not_verified' || terminal === 'unauthenticated' ? (
          <Button variant="dark" size="lg" fullWidth onClick={() => void trocarDeEmail()}>
            Usar outro e-mail
          </Button>
        ) : (
          <Button variant="dark" size="lg" fullWidth onClick={() => navigate('/')} iconRight={<ArrowRight size={18} />}>
            Ir para o início
          </Button>
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
      <h1 className="text-2xl font-black tracking-tight">
        {company} te convidou como {roleLabel}
      </h1>
      <p className="text-sm text-gray-600 mt-2">
        Entre com um código enviado ao seu e-mail. Não precisa criar senha.
      </p>
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

  // Já há sessão: não precisa de e-mail nem de código; só os Termos e entrar.
  if (sessionEmail) {
    if (sessionIsWorker) {
      return frame(
        <>
          {alerta(
            'error',
            OUTCOME_COPY.worker_cannot_be_manager.title,
            OUTCOME_COPY.worker_cannot_be_manager.body,
          )}
          <Button variant="dark" size="lg" fullWidth onClick={() => void trocarDeEmail()}>
            Usar outro e-mail
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
          {termsBox}
          {errorLine}
          <Button
            variant="dark"
            size="lg"
            fullWidth
            disabled={!acceptedTos}
            onClick={() => void finish()}
            iconRight={<ArrowRight size={18} />}
          >
            Entrar na equipe
          </Button>
          <Button variant="ghost" size="lg" fullWidth onClick={() => void trocarDeEmail()}>
            Não sou eu — usar outro e-mail
          </Button>
        </div>
      </>,
    );
  }

  if (step === 'code') {
    return frame(
      <>
        {header}
        <form onSubmit={(e) => void verifyCode(e)} className="space-y-4" noValidate>
          <p className="text-sm text-gray-800">
            Enviamos um código para <strong>{email}</strong>. Digite abaixo.
          </p>
          <Field label="Código do e-mail" required>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/[^\d\s]/g, '')); setFormError(undefined); }}
              className="text-center text-2xl font-black tracking-[0.3em] h-14"
            />
          </Field>
          {errorLine}
          <Button type="submit" variant="dark" size="lg" fullWidth loading={sending} iconRight={<ArrowRight size={18} />}>
            Entrar na equipe
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            fullWidth
            onClick={() => { setStep('form'); setFormError(undefined); }}
          >
            Trocar e-mail ou pedir novo código
          </Button>
        </form>
      </>,
    );
  }

  return frame(
    <>
      {header}
      <form onSubmit={(e) => void sendCode(e)} className="space-y-4" noValidate>
        <Field label="Seu e-mail" required>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setFormError(undefined); }}
          />
        </Field>
        {termsBox}
        {errorLine}
        <Button type="submit" variant="dark" size="lg" fullWidth loading={sending} iconLeft={<Mail size={18} />}>
          Receber código por e-mail
        </Button>
      </form>
    </>,
  );
}
