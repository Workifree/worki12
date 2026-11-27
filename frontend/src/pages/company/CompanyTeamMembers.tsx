/**
 * CompanyTeamMembers — Gestão → Equipe e acessos (só Gestor). Rota: /company/configuracoes/equipe.
 *
 * "Equipe" = pessoas que OPERAM a empresa; "Elenco" = freelas (`CompanyTeam`). Nunca misturar rótulos.
 *
 * Spec R11/R12/R15/R17/R22/R24. Convite (ADR-20261127): o Gestor informa nome + e-mail, o banco prende o
 * convite a esse e-mail e a tela mostra SÓ o link para copiar. Nenhum e-mail é enviado pelo Worki. Remover nunca
 * bloqueia e não exige transferência: o modal só informa (ADR remover-pessoa-so-corta-acesso).
 * Toda autorização real mora nas RPCs; esta tela é UX.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useLatestResponse } from '../../hooks/useLatestResponse';
import { useAnyDialogOpen } from '../../hooks/useModalDismiss';
import { notificationSources } from '../../lib/realtime/liveSources';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Copy,
  RefreshCw,
  Send,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';
import PageMeta from '../../components/PageMeta';
import BackToGestao from '../../components/company/BackToGestao';
import ModalShell from '../../components/ModalShell';
import TagsPanel from '../../components/company/TagsPanel';
import { DialogActions, Button, Card, ErrorState, Field, PageHeader } from '../../components/ui';
import { getMyCompanies, isGestor, pickCurrentCompany } from '../../services/companyScopeService';
import {
  buildInviteLink,
  isValidInviteEmail,
  normalizeInviteEmail,
  confirmMember,
  inviteMember,
  listMembers,
  memberActionMessage,
  rejectMember,
  removeMember,
  resendInvite,
  revokeInvite,
  rotateElencoLink,
  ROLE_LABEL,
} from '../../services/teamMembersService';
import type { RemoveMemberResult, TeamMemberItem, TeamMemberState } from '../../types';
import { flushSync } from 'react-dom';
import { focusFirstInvalid } from '../../lib/formErrors';

const STATE_BADGE: Record<TeamMemberState, { label: string; className: string }> = {
  invited: { label: 'Convite enviado', className: 'bg-blue-50 text-blue-700' },
  invite_expired: { label: 'Venceu', className: 'bg-red-50 text-red-700' },
  awaiting_confirmation: { label: 'Aguardando confirmação', className: 'bg-yellow-100 text-yellow-800' },
  pending_expired: { label: 'Expirado', className: 'bg-red-50 text-red-700' },
  active: { label: 'Ativo', className: 'bg-primary-light text-primary-dark' },
  removed: { label: 'Removido', className: 'bg-gray-100 text-gray-700' },
};

interface ShareState {
  displayName: string;
  token: string;
  /** E-mail ao qual o convite está preso; vazio só se o banco não informou. */
  email: string;
  /** O banco já tinha um convite pendente (nome igual ou parecido): é o mesmo link. */
  reused?: boolean;
}

/** Data e hora no fuso de São Paulo, como o Gestor as lê. */
function formatSaoPaulo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Mensagem do Gestor para cada desfecho de `invite_company_member` que não gera link. */
function inviteErrorMessage(outcome: string): string {
  switch (outcome) {
    case 'email_required':
      return 'Informe o e-mail da pessoa. O convite fica preso a ele.';
    case 'invalid_email':
      return 'Esse e-mail não parece válido. Confira e tente de novo.';
    case 'worker_cannot_be_manager':
      return 'Esse e-mail já é de uma conta de freela. Use outro e-mail para a equipe.';
    case 'already_member':
      return 'Essa pessoa já faz parte da equipe.';
    case 'name_already_invited':
      return 'Já existe um convite pendente com esse nome e outro e-mail. Revogue o antigo ou use outro nome.';
    case 'invalid_input':
      return 'Confira o nome (até 80 caracteres, sem símbolos estranhos).';
    default:
      return memberActionMessage(outcome, 'Não foi possível criar o convite. Tente novamente.');
  }
}

export default function CompanyTeamMembers() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteNameError, setInviteNameError] = useState<string | undefined>(undefined);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteEmailError, setInviteEmailError] = useState<string | undefined>(undefined);
  const [inviting, setInviting] = useState(false);
  const [share, setShare] = useState<ShareState | null>(null);
  const [copied, setCopied] = useState(false);

  const [removing, setRemoving] = useState<{ member: TeamMemberItem; preview: RemoveMemberResult } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [rejecting, setRejecting] = useState<TeamMemberItem | null>(null);
  const [confirming, setConfirming] = useState<TeamMemberItem | null>(null);
  const [typedName, setTypedName] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [linkRotationPending, setLinkRotationPending] = useState(false);
  const [rotating, setRotating] = useState(false);

  const beginMembers = useLatestResponse();
  const reload = useCallback(async (id: string, silent = false): Promise<TeamMemberItem[]> => {
    const claim = beginMembers();
    const result = await listMembers(id);
    if (result.outcome !== 'ok') {
      if (!silent && claim()) setLoadError(true);
      return [];
    }
    if (!claim()) return result.items;
    setLoadError(false);
    setMembers(result.items);
    setLinkRotationPending(result.elencoLinkRotationPending === true);
    return result.items;
  }, [beginMembers]);

  // `company_members` não é publicada: "Fulano entrou. É ele?" chega pela notificação do Gestor.
  const { user } = useAuth();
  const dialogOpen = useAnyDialogOpen();
  useLiveRefresh({
    sources: user && companyId ? notificationSources(user.id) : [],
    onRefresh: () => (companyId ? reload(companyId, true) : undefined),
    paused: loading || dialogOpen || inviteOpen || inviting || !!busyId || removeBusy || confirmBusy || rotating,
  });

  /** Resolve a empresa pelo seam e carrega a equipe. */
  const loadAll = useCallback(async (): Promise<void> => {
    try {
      const current = pickCurrentCompany(await getMyCompanies());
      if (!current || !isGestor(current)) {
        navigate('/company/dashboard', { replace: true });
        return;
      }
      setCompanyId(current.company_id);
      await reload(current.company_id);
    } catch (error) {
      logError('CompanyTeamMembers.load', error);
      setLoadError(true);
    }
  }, [navigate, reload]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await loadAll();
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [loadAll]);

  /** "Tentar de novo": nunca silencioso — resolve a empresa de novo, não só a lista. */
  const retryLoad = async () => {
    setLoading(true);
    setLoadError(false);
    await loadAll();
    setLoading(false);
  };

  const awaiting = members.filter((m) => m.state === 'awaiting_confirmation' && m.userId);
  const others = members.filter((m) => !(m.state === 'awaiting_confirmation' && m.userId));

  const openInvite = () => {
    setInviteName('');
    setInviteNameError(undefined);
    setInviteEmail('');
    setInviteEmailError(undefined);
    setShare(null);
    setCopied(false);
    setInviteOpen(true);
  };

  const closeInvite = () => {
    setInviteOpen(false);
    setShare(null);
  };

  const submitInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!companyId) {
      addToast('Não foi possível identificar a empresa. Recarregando a tela...', 'error');
      void retryLoad();
      return;
    }
    const name = inviteName.trim();
    if (!name) {
      const form = e.currentTarget as HTMLFormElement;
      flushSync(() => setInviteNameError('Digite o nome da pessoa.'));
      focusFirstInvalid(form);
      return;
    }
    if (!isValidInviteEmail(inviteEmail)) {
      const form = e.currentTarget as HTMLFormElement;
      flushSync(() => setInviteEmailError('Digite um e-mail válido, como nome@empresa.com.'));
      focusFirstInvalid(form);
      return;
    }
    if (inviting) return;
    setInviting(true);
    const result = await inviteMember(companyId, name, 'encarregado', normalizeInviteEmail(inviteEmail));
    setInviting(false);
    if (
      (result.outcome === 'invited' || result.outcome === 'reinvited' || result.outcome === 'already_invited')
      && result.inviteToken
    ) {
      const reused = result.outcome === 'already_invited';
      setShare({ displayName: name, token: result.inviteToken, email: normalizeInviteEmail(inviteEmail), reused });
      const items = await reload(companyId);
      // Convite reaproveitado pode estar gravado com uma variação do nome (acento, espaços): a
      // mensagem e a conferência do Gestor precisam usar o nome que está no convite.
      const stored = reused ? items.find((m) => m.memberId === result.memberId)?.displayName : null;
      if (stored) setShare((current) => (current ? { ...current, displayName: stored } : current));
      return;
    }
    addToast(inviteErrorMessage(result.outcome), 'error');
  };

  const shareLink = share ? buildInviteLink(share.token) : '';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      addToast('Link copiado.', 'success');
      window.setTimeout(() => setCopied(false), 2500);
    } catch (error) {
      logError('CompanyTeamMembers.copyLink', error);
      addToast('Não foi possível copiar. Selecione o link e copie manualmente.', 'error');
    }
  };

  const handleResend = async (member: TeamMemberItem) => {
    if (!companyId) return;
    setBusyId(member.memberId);
    const result = await resendInvite(member.memberId);
    setBusyId(null);
    if (result.outcome === 'resent' && result.inviteToken) {
      setCopied(false);
      setInviteOpen(true);
      setShare({
        displayName: member.displayName ?? 'a pessoa',
        token: result.inviteToken,
        email: member.invitedEmail ?? '',
      });
      addToast('Novo link gerado. O link antigo deixou de valer.', 'success');
      void reload(companyId);
      return;
    }
    addToast(memberActionMessage(result.outcome, 'Não foi possível gerar um novo link. Tente novamente.'), 'error');
    void reload(companyId);
  };

  const handleRevoke = async (member: TeamMemberItem) => {
    if (!companyId) return;
    setBusyId(member.memberId);
    const result = await revokeInvite(member.memberId);
    setBusyId(null);
    if (result.outcome === 'revoked') {
      addToast('Convite cancelado. O link deixou de valer.', 'success');
    } else {
      addToast(memberActionMessage(result.outcome, 'Não foi possível cancelar o convite. Tente novamente.'), 'error');
    }
    void reload(companyId);
  };

  const openConfirm = (member: TeamMemberItem) => {
    // Campo SEMPRE vazio: quem confirma precisa digitar o nome, não só tocar num botão.
    setTypedName('');
    setConfirmError(null);
    setConfirming(member);
  };

  const submitConfirm = async (e: FormEvent) => {
    e.preventDefault();
    const member = confirming;
    const name = typedName.trim();
    if (!companyId || !member?.userId || !name) return;
    setConfirmBusy(true);
    setConfirmError(null);
    const result = await confirmMember(companyId, member.userId, name);
    setConfirmBusy(false);
    if (result.outcome === 'name_mismatch') {
      setConfirmError('O nome não confere com o do convite. Digite o nome como você escreveu ao convidar.');
      return;
    }
    setConfirming(null);
    if (result.outcome === 'confirmed' || result.outcome === 'already_confirmed') {
      addToast(`Acesso confirmado${member.displayName ? ` para ${member.displayName}` : ''}. Já pode trabalhar.`, 'success');
    } else if (result.outcome === 'expired') {
      addToast('O prazo de 72 horas para confirmar acabou e o acesso foi encerrado. Convide essa pessoa de novo.', 'error');
    } else {
      addToast(memberActionMessage(result.outcome, 'Não foi possível confirmar. Tente novamente.'), 'error');
    }
    void reload(companyId);
  };

  /**
   * Prazo de confirmação vencido: o convite novo exige o e-mail (o banco recusa sem ele), então
   * abre o formulário com o nome já preenchido.
   */
  const handleInviteAgain = (member: TeamMemberItem) => {
    openInvite();
    if (member.displayName) setInviteName(member.displayName);
  };

  const handleRotateLink = async () => {
    if (!companyId) return;
    setRotating(true);
    const result = await rotateElencoLink(companyId);
    setRotating(false);
    if (!result.ok) {
      addToast('Não foi possível gerar o novo link do Elenco. Tente novamente.', 'error');
      return;
    }
    setLinkRotationPending(false);
    addToast('Novo link do Elenco criado. O antigo deixou de valer.', 'success');
    void reload(companyId);
  };

  const handleReject = async (member: TeamMemberItem) => {
    if (!companyId || !member.userId) return;
    setRejecting(null);
    setBusyId(member.memberId);
    const result = await rejectMember(companyId, member.userId);
    setBusyId(null);
    if (result.outcome === 'rejected') {
      addToast('Acesso cortado. Se foi engano, envie um novo convite.', 'success');
    } else {
      addToast(memberActionMessage(result.outcome, 'Não foi possível cortar o acesso. Tente novamente.'), 'error');
    }
    void reload(companyId);
  };

  const openRemove = async (member: TeamMemberItem) => {
    if (!companyId || !member.userId) return;
    setBusyId(member.memberId);
    // Dry-run: não escreve; só descobre quantos turnos abertos dele ficarão com o Gestor.
    const preview = await removeMember(companyId, member.userId, true);
    setBusyId(null);
    if (preview.outcome !== 'would_remove') {
      addToast(memberActionMessage(preview.outcome, 'Não foi possível preparar a remoção. Tente novamente.'), 'error');
      return;
    }
    setRemoving({ member, preview });
  };

  const confirmRemove = async () => {
    if (!companyId || !removing?.member.userId) return;
    setRemoveBusy(true);
    const result = await removeMember(companyId, removing.member.userId, false);
    setRemoveBusy(false);
    if (result.outcome === 'removed') {
      addToast(`${removing.member.displayName ?? 'A pessoa'} saiu da equipe.`, 'success');
      setRemoving(null);
    } else {
      addToast(memberActionMessage(result.outcome, 'Não foi possível remover. Tente novamente.'), 'error');
    }
    void reload(companyId);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <PageMeta title="Equipe e acessos" description="Quem opera a sua empresa no Worki." />
      <BackToGestao />

      <PageHeader
        title="Equipe e acessos"
        subtitle="Pessoas que operam a empresa com você. Seus freelas ficam em Meu Elenco."
        action={
          <Button variant="dark" size="lg" onClick={openInvite} iconLeft={<UserPlus size={18} />} data-copilot="empresa.equipe.convidar" data-copilot-risk="D">
            Convidar pessoa
          </Button>
        }
      />

      {loading && (
        <div className="space-y-4" role="status" aria-label="Carregando a equipe">
          <div className="h-24 bg-gray-200 rounded-xl animate-pulse" role="status"><span className="sr-only">Carregando</span></div>
          <div className="h-24 bg-gray-200 rounded-xl animate-pulse" role="status"><span className="sr-only">Carregando</span></div>
        </div>
      )}

      {!loading && loadError && (
        <ErrorState title="Não foi possível carregar a equipe." onRetry={() => void retryLoad()} />
      )}

      {!loading && !loadError && (
        <>
          {linkRotationPending && (
            <Card className="mb-6">
              <div role="status">
                <h2 className="text-lg font-bold">Gere um novo link do Elenco</h2>
                <p className="text-sm text-gray-700 mt-1">
                  Alguém que saiu da equipe pode ter guardado o link antigo. Ao gerar um novo, o antigo deixa
                  de valer.
                </p>
              </div>
              <Button
                variant="secondary"
                className="mt-4"
                data-copilot="empresa.equipe.novo-link-elenco"
                data-copilot-risk="D"
                onClick={() => void handleRotateLink()}
                loading={rotating}
                iconLeft={<RefreshCw size={18} />}
              >
                Gerar novo link do Elenco
              </Button>
            </Card>
          )}
          {awaiting.length > 0 && (
            <section aria-labelledby="equipe-confirmar" className="mb-6 space-y-3">
              <h2 id="equipe-confirmar" className="text-xl font-bold">Precisa da sua confirmação</h2>
              {awaiting.map((m) => (
                <Card
                  key={m.memberId}
                  className="border-yellow-500 shadow-[6px_6px_0px_0px_rgba(234,179,8,1)]"
                  aria-label={`${m.displayName ?? 'Pessoa'} aguardando confirmação`}
                >
                  <p className="text-lg font-bold">
                    {m.displayName ?? 'Alguém'} entrou. É a pessoa certa?
                  </p>
                  <p className="text-sm text-gray-700 mt-1">
                    Entrou como {ROLE_LABEL[m.role]}
                    {m.acceptedEmail ? <> com o e-mail <strong className="break-all">{m.acceptedEmail}</strong></> : null}. Enquanto você
                    não confirmar, a pessoa não vê nada do trabalho.
                  </p>
                  {formatSaoPaulo(m.confirmationExpiresAt) && (
                    <p className="text-sm font-bold mt-2">Confirme até {formatSaoPaulo(m.confirmationExpiresAt)}.</p>
                  )}
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Button
                      variant="dark"
                      size="lg"
                      onClick={() => openConfirm(m)}
                      loading={busyId === m.memberId}
                      iconLeft={<Check size={18} />}
                    >
                      Confirmar
                    </Button>
                    <Button
                      variant="danger"
                      size="lg"
                      onClick={() => setRejecting(m)}
                      disabled={busyId === m.memberId}
                      iconLeft={<UserX size={18} />}
                    >
                      Não é essa pessoa
                    </Button>
                  </div>
                </Card>
              ))}
            </section>
          )}

          {members.length === 0 ? (
            <Card className="text-center">
              <h2 className="text-xl font-bold mb-2">Ninguém na equipe ainda</h2>
              <p className="text-sm text-gray-700 mb-5">
                Convide quem toca o dia a dia (um encarregado, por exemplo). Você informa o e-mail e envia o
                link; a pessoa cria uma senha e entra.
              </p>
              <Button variant="dark" size="lg" onClick={openInvite} iconLeft={<UserPlus size={18} />}>
                Convidar alguém da equipe
              </Button>
            </Card>
          ) : (
            others.length > 0 && (
              <section aria-labelledby="equipe-lista" className="space-y-3">
                <h2 id="equipe-lista" className="text-xl font-bold">Pessoas</h2>
                <ul className="space-y-3">
                  {others.map((m) => {
                    const badge = STATE_BADGE[m.state];
                    const pending = m.state === 'invited' || m.state === 'invite_expired';
                    const busy = busyId === m.memberId;
                    return (
                      <li key={m.memberId}>
                        <Card>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-bold">{m.displayName ?? 'Sem nome'}</p>
                            <span className="rounded-pill bg-gray-100 text-gray-700 px-3 py-1 text-xs font-bold">
                              {ROLE_LABEL[m.role]}
                            </span>
                            <span className={`rounded-pill px-3 py-1 text-xs font-bold ${badge.className}`}>
                              {badge.label}
                            </span>
                          </div>
                          {m.acceptedEmail && !pending && (
                            <p className="text-sm text-gray-600 mt-1 break-all">{m.acceptedEmail}</p>
                          )}
                          {m.state === 'pending_expired' && (
                            <p className="text-xs text-gray-600 mt-2">
                              O prazo de 72 horas para confirmar acabou. Envie um novo convite.
                            </p>
                          )}
                          {pending && m.invitedEmail && (
                            <p className="text-sm text-gray-600 mt-1 break-all">{m.invitedEmail}</p>
                          )}
                          {pending && m.invitedEmail === null && (
                            <p role="status" className="text-xs font-bold text-yellow-800 mt-2">
                              Convite antigo, sem e-mail: não funciona mais. Revogue e convide de novo com o e-mail.
                            </p>
                          )}
                          {pending && (
                            <p className="text-xs text-gray-600 mt-2">
                              Gerar um novo link faz o link atual deixar de valer.
                            </p>
                          )}
                          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {pending && (
                              <>
                                <Button
                                  variant="dark"
                                  size="lg"
                                  onClick={() => void handleResend(m)}
                                  loading={busy}
                                  iconLeft={<Send size={16} />}
                                >
                                  Gerar novo link
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="lg"
                                  onClick={() => void handleRevoke(m)}
                                  disabled={busy}
                                  iconLeft={<X size={16} />}
                                >
                                  Revogar convite
                                </Button>
                              </>
                            )}
                            {m.state === 'pending_expired' && (
                              <Button
                                variant="dark"
                                size="lg"
                                onClick={() => handleInviteAgain(m)}
                                iconLeft={<Send size={16} />}
                              >
                                Convidar de novo
                              </Button>
                            )}
                            {m.state === 'active' && m.userId && (
                              <Button
                                variant="secondary"
                                size="lg"
                                onClick={() => void openRemove(m)}
                                loading={busy}
                                iconLeft={<UserX size={16} />}
                              >
                                Remover da equipe
                              </Button>
                            )}
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )
          )}

          {/* R20/R24: etiquetas só depois que existe equipe (divulgação progressiva). */}
          {companyId && members.length > 0 && <TagsPanel companyId={companyId} />}
        </>
      )}

      {/* Convidar / compartilhar */}
      {inviteOpen && (
        <ModalShell labelledBy="convidar-titulo" onClose={closeInvite} focusKey={share ? 'share' : 'form'}>
          <>
            {!share ? (
              <form onSubmit={(e) => void submitInvite(e)} className="space-y-4" noValidate>
                <div className="flex items-start justify-between gap-3">
                  <h2 id="convidar-titulo" className="text-2xl font-bold">Convidar pessoa</h2>
                  <button
                    type="button"
                    onClick={closeInvite}
                    aria-label="Fechar"
                    className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border-2 border-transparent hover:bg-gray-100"
                  >
                    <X size={20} />
                  </button>
                </div>

                <Field label="Nome da pessoa" required hint="Do jeito que você a chama." error={inviteNameError}>
                  <input
                    type="text"
                    name="invitee-name"
                    data-autofocus
                    maxLength={80}
                    autoComplete="off"
                    value={inviteName}
                    onChange={(e) => { setInviteName(e.target.value); setInviteNameError(undefined); }}
                  />
                </Field>

                <fieldset>
                  <legend className="text-sm font-bold mb-2">Papel</legend>
                  <div
                    aria-label="Papel Encarregado"
                    className="rounded-2xl border-2 border-black bg-blue-50 p-4 shadow-[4px_4px_0px_0px_rgba(37,99,235,1)]"
                  >
                    <p className="font-bold">Encarregado</p>
                    <p className="text-sm text-gray-700 mt-1">
                      Cuida do dia a dia dos turnos. Você continua no comando da empresa.
                    </p>
                  </div>
                </fieldset>

                <Field
                  label="E-mail do encarregado"
                  required
                  hint="O convite fica preso a este e-mail. O Worki não envia e-mail: você manda o link."
                  error={inviteEmailError}
                >
                  <input
                    data-copilot-private
                    type="email"
                    name="invitee-email"
                    inputMode="email"
                    autoComplete="off"
                    maxLength={254}
                    placeholder="nome@empresa.com"
                    value={inviteEmail}
                    onChange={(e) => { setInviteEmail(e.target.value); setInviteEmailError(undefined); }}
                  />
                </Field>

                <Button type="submit" variant="dark" size="lg" fullWidth loading={inviting} iconLeft={<UserPlus size={18} />}>
                  Gerar convite
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 id="convidar-titulo" className="text-2xl font-bold">Convite pronto</h2>
                  <button
                    type="button"
                    onClick={closeInvite}
                    aria-label="Fechar"
                    className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border-2 border-transparent hover:bg-gray-100"
                  >
                    <X size={20} />
                  </button>
                </div>
                {share.reused && (
                  <p role="status" className="rounded-xl border-2 border-black bg-yellow-100 p-3 text-sm font-bold">
                    Já havia um convite pendente com esse nome (ou um muito parecido). Este é o mesmo link.
                  </p>
                )}
                <p className="text-sm text-gray-700">
                  Envie este link para <strong>{share.displayName}</strong>.{' '}
                  {share.email ? (
                    <>Ele entra com o e-mail <strong className="break-all">{share.email}</strong> e cria uma senha.</>
                  ) : (
                    <>Ele entra com o e-mail do convite e cria uma senha.</>
                  )}{' '}
                  O link vale por 14 dias e é só dessa pessoa.
                </p>
                <p data-copilot-private className="break-all rounded-xl border-2 border-black bg-gray-50 p-3 text-sm font-mono" data-testid="invite-link">
                  {shareLink}
                </p>
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onClick={() => void copyLink()}
                  iconLeft={copied ? <Check size={18} /> : <Copy size={18} />}
                >
                  {copied ? 'Link copiado!' : 'Copiar link'}
                </Button>
                <Button variant="ghost" size="lg" fullWidth onClick={closeInvite}>
                  Concluir
                </Button>
              </div>
            )}
          </>
        </ModalShell>
      )}

      {/* Remover — informativo, nunca bloqueia (ADR remover-pessoa-so-corta-acesso) */}
      {removing && (
        <ModalShell labelledBy="remover-titulo" onClose={() => { if (!removeBusy) setRemoving(null); }}>
          <>
            <h2 id="remover-titulo" className="text-2xl font-bold mb-3">
              Remover {removing.member.displayName ?? 'esta pessoa'}?
            </h2>
            <ul className="space-y-2 text-sm text-gray-800 mb-5 list-disc pl-5">
              <li>O acesso é cortado agora.</li>
              {removing.preview.openJobs > 0 ? (
                <li>
                  <strong>
                    {removing.preview.openJobs === 1
                      ? '1 turno aberto no nome dessa pessoa ficará com você.'
                      : `${removing.preview.openJobs} turnos abertos no nome dessa pessoa ficarão com você.`}
                  </strong>
                </li>
              ) : (
                <li>Não há turnos abertos no nome dessa pessoa.</li>
              )}
              <li>Nada do que foi feito é apagado: turnos, freelas e pagamentos continuam como estão.</li>
              {removing.preview.elencoLinkRotationAdvised && (
                <li>
                  Essa pessoa chegou a ver o link do seu Elenco. Depois de remover, esta tela vai pedir para
                  gerar um novo.
                </li>
              )}
            </ul>
            <DialogActions>
              <Button variant="secondary" size="lg" data-autofocus onClick={() => setRemoving(null)} disabled={removeBusy}>
                Voltar
              </Button>
              <Button variant="danger" size="lg" onClick={() => void confirmRemove()} loading={removeBusy}>
                Remover agora
              </Button>
            </DialogActions>
          </>
        </ModalShell>
      )}

      {/* Confirmar: o Gestor confere e-mail e hora do aceite e DIGITA o nome do convite */}
      {confirming && (
        <ModalShell labelledBy="confirmar-titulo" onClose={() => { if (!confirmBusy) setConfirming(null); }}>
          <form onSubmit={(e) => void submitConfirm(e)} className="space-y-4" noValidate>
            <h2 id="confirmar-titulo" className="text-2xl font-bold">Confirmar acesso</h2>
            <dl className="rounded-xl border-2 border-black bg-gray-50 p-3 text-sm space-y-2">
              <div>
                <dt className="text-xs font-bold uppercase text-gray-600">Nome no convite</dt>
                <dd className="font-bold">{confirming.displayName ?? 'Sem nome'}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase text-gray-600">E-mail informado no convite</dt>
                <dd className="font-bold break-all">{confirming.acceptedEmail ?? 'Não informado'}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase text-gray-600">Aceitou em (horário de São Paulo)</dt>
                <dd className="font-bold tabular-nums">{formatSaoPaulo(confirming.acceptedAt) ?? 'Não informado'}</dd>
              </div>
            </dl>
            <p className="text-sm text-gray-800">
              Só confirme se você reconhece esse e-mail e esse horário. Para confirmar, digite o nome do convite.
            </p>
            <Field label="Digite o nome da pessoa" required error={confirmError ?? undefined}>
              <input
                type="text"
                data-autofocus
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={80}
                value={typedName}
                onChange={(e) => { setTypedName(e.target.value); setConfirmError(null); }}
              />
            </Field>
            <DialogActions>
              <Button variant="secondary" size="lg" onClick={() => setConfirming(null)} disabled={confirmBusy}>
                Voltar
              </Button>
              <Button
                type="submit"
                variant="dark"
                size="lg"
                disabled={!typedName.trim()}
                loading={confirmBusy}
              >
                Confirmar acesso
              </Button>
            </DialogActions>
          </form>
        </ModalShell>
      )}

      {/* "Não é essa pessoa": passo de confirmação antes de cortar o acesso */}
      {rejecting && (
        <ModalShell labelledBy="rejeitar-titulo" onClose={() => setRejecting(null)}>
          <>
            <h2 id="rejeitar-titulo" className="text-2xl font-bold mb-3">
              Cortar o acesso de {rejecting.displayName ?? 'quem entrou'}?
            </h2>
            <p className="text-sm text-gray-800 mb-5">
              A pessoa perde o acesso agora. Se foi engano, é só enviar um novo convite.
            </p>
            <DialogActions>
              <Button variant="secondary" size="lg" data-autofocus onClick={() => setRejecting(null)}>
                Voltar
              </Button>
              <Button variant="danger" size="lg" onClick={() => void handleReject(rejecting)}>
                Cortar acesso
              </Button>
            </DialogActions>
          </>
        </ModalShell>
      )}
    </div>
  );
}
