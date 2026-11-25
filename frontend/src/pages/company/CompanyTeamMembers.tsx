/**
 * CompanyTeamMembers — Gestão → Equipe e acessos (só Gestor). Rota: /company/configuracoes/equipe.
 *
 * "Equipe" = pessoas que OPERAM a empresa; "Elenco" = freelas (`CompanyTeam`). Nunca misturar rótulos.
 *
 * Spec R11/R12/R15/R17/R22/R24. Convite sem e-mail: gera o link e abre o WhatsApp com a mensagem
 * pronta (telefone opcional, só para abrir a conversa certa — NÃO é enviado ao banco). Remover nunca
 * bloqueia e não exige transferência: o modal só informa (ADR remover-pessoa-so-corta-acesso).
 * Toda autorização real mora nas RPCs; esta tela é UX.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Copy,
  MessageCircle,
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
import { Button, Card, Field, PageHeader } from '../../components/ui';
import { getMyCompanies, isGestor, pickCurrentCompany } from '../../services/companyScopeService';
import {
  buildInviteLink,
  buildInviteMessage,
  buildWhatsAppUrl,
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
  phone: string;
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

export default function CompanyTeamMembers() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteNameError, setInviteNameError] = useState<string | undefined>(undefined);
  const [invitePhone, setInvitePhone] = useState('');
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

  const reload = useCallback(async (id: string): Promise<TeamMemberItem[]> => {
    const result = await listMembers(id);
    if (result.outcome !== 'ok') {
      setLoadError(true);
      return [];
    }
    setLoadError(false);
    setMembers(result.items);
    setLinkRotationPending(result.elencoLinkRotationPending === true);
    return result.items;
  }, []);

  /** Resolve a empresa pelo seam e carrega a equipe. */
  const loadAll = useCallback(async (): Promise<void> => {
    try {
      const current = pickCurrentCompany(await getMyCompanies());
      if (!current || !isGestor(current)) {
        navigate('/company/dashboard', { replace: true });
        return;
      }
      setCompanyId(current.company_id);
      setCompanyName(current.company_name ?? 'Sua empresa');
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
    setInvitePhone('');
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
    if (inviting) return;
    setInviting(true);
    const result = await inviteMember(companyId, name, 'encarregado');
    setInviting(false);
    if (
      (result.outcome === 'invited' || result.outcome === 'reinvited' || result.outcome === 'already_invited')
      && result.inviteToken
    ) {
      const reused = result.outcome === 'already_invited';
      setShare({ displayName: name, token: result.inviteToken, phone: invitePhone, reused });
      const items = await reload(companyId);
      // Convite reaproveitado pode estar gravado com uma variação do nome (acento, espaços): a
      // mensagem e a conferência do Gestor precisam usar o nome que está no convite.
      const stored = reused ? items.find((m) => m.memberId === result.memberId)?.displayName : null;
      if (stored) setShare((current) => (current ? { ...current, displayName: stored } : current));
      return;
    }
    addToast(
      result.outcome === 'invalid_input'
        ? 'Confira o nome (até 80 caracteres, sem símbolos estranhos).'
        : memberActionMessage(result.outcome, 'Não foi possível criar o convite. Tente novamente.'),
      'error',
    );
  };

  const shareLink = share ? buildInviteLink(share.token) : '';
  const shareMessage = share
    ? buildInviteMessage({ displayName: share.displayName, companyName, role: 'encarregado', link: shareLink })
    : '';

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

  const openWhatsApp = () => {
    if (!share) return;
    window.open(buildWhatsAppUrl(shareMessage, share.phone), '_blank', 'noopener,noreferrer');
  };

  const handleResend = async (member: TeamMemberItem) => {
    if (!companyId) return;
    setBusyId(member.memberId);
    const result = await resendInvite(member.memberId);
    setBusyId(null);
    if (result.outcome === 'resent' && result.inviteToken) {
      setCopied(false);
      setInviteOpen(true);
      setShare({ displayName: member.displayName ?? 'a pessoa', token: result.inviteToken, phone: '' });
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

  /** Prazo de confirmação vencido: um convite novo (o aceite dele encerra a entrada antiga). */
  const handleInviteAgain = async (member: TeamMemberItem) => {
    if (!companyId || !member.displayName) {
      openInvite();
      return;
    }
    setBusyId(member.memberId);
    const result = await inviteMember(companyId, member.displayName, 'encarregado');
    setBusyId(null);
    if (result.inviteToken) {
      setCopied(false);
      setInviteOpen(true);
      setShare({
        displayName: member.displayName,
        token: result.inviteToken,
        phone: '',
        reused: result.outcome === 'already_invited',
      });
    } else {
      addToast(memberActionMessage(result.outcome, 'Não foi possível convidar de novo. Tente novamente.'), 'error');
    }
    void reload(companyId);
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
          <Button variant="dark" size="lg" onClick={openInvite} iconLeft={<UserPlus size={18} />}>
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
        <Card className="text-center">
          <p className="font-bold mb-3">Não foi possível carregar a equipe.</p>
          <Button variant="dark" onClick={() => void retryLoad()} iconLeft={<RefreshCw size={16} />}>
            Tentar de novo
          </Button>
        </Card>
      )}

      {!loading && !loadError && (
        <>
          {linkRotationPending && (
            <Card className="mb-6 border-yellow-500 shadow-[6px_6px_0px_0px_rgba(234,179,8,1)]">
              <div role="status">
                <h2 className="text-xl font-black">Gere um novo link do Elenco</h2>
                <p className="text-sm text-gray-700 mt-1">
                  Alguém que saiu da equipe pode ter guardado o link antigo. Ao gerar um novo, o antigo deixa
                  de valer.
                </p>
              </div>
              <Button
                variant="dark"
                size="lg"
                fullWidth
                className="mt-4"
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
              <h2 id="equipe-confirmar" className="text-xl font-black">Precisa da sua confirmação</h2>
              {awaiting.map((m) => (
                <Card
                  key={m.memberId}
                  className="border-yellow-500 shadow-[6px_6px_0px_0px_rgba(234,179,8,1)]"
                  aria-label={`${m.displayName ?? 'Pessoa'} aguardando confirmação`}
                >
                  <p className="text-lg font-black">
                    {m.displayName ?? 'Alguém'} entrou. É a pessoa certa?
                  </p>
                  <p className="text-sm text-gray-700 mt-1">
                    Entrou como {ROLE_LABEL[m.role]}
                    {m.acceptedEmail ? <> com o e-mail <strong>{m.acceptedEmail}</strong></> : null}. Enquanto você
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
              <h2 className="text-xl font-black mb-2">Ninguém na equipe ainda</h2>
              <p className="text-sm text-gray-700 mb-5">
                Convide quem toca o dia a dia (um encarregado, por exemplo). A pessoa entra por um link no
                WhatsApp, sem criar senha.
              </p>
              <Button variant="dark" size="lg" onClick={openInvite} iconLeft={<UserPlus size={18} />}>
                Convidar alguém da equipe
              </Button>
            </Card>
          ) : (
            others.length > 0 && (
              <section aria-labelledby="equipe-lista" className="space-y-3">
                <h2 id="equipe-lista" className="text-xl font-black">Pessoas</h2>
                <ul className="space-y-3">
                  {others.map((m) => {
                    const badge = STATE_BADGE[m.state];
                    const pending = m.state === 'invited' || m.state === 'invite_expired';
                    const busy = busyId === m.memberId;
                    return (
                      <li key={m.memberId}>
                        <Card>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-black">{m.displayName ?? 'Sem nome'}</p>
                            <span className="rounded-pill bg-gray-100 text-gray-700 px-3 py-1 text-xs font-bold">
                              {ROLE_LABEL[m.role]}
                            </span>
                            <span className={`rounded-pill px-3 py-1 text-xs font-bold ${badge.className}`}>
                              {badge.label}
                            </span>
                          </div>
                          {m.acceptedEmail && !pending && (
                            <p className="text-sm text-gray-600 mt-1">{m.acceptedEmail}</p>
                          )}
                          {m.state === 'pending_expired' && (
                            <p className="text-xs text-gray-600 mt-2">
                              O prazo de 72 horas para confirmar acabou. Envie um novo convite.
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
                                onClick={() => void handleInviteAgain(m)}
                                loading={busy}
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
                  <h2 id="convidar-titulo" className="text-2xl font-black">Convidar pessoa</h2>
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
                    <p className="font-black">Encarregado</p>
                    <p className="text-sm text-gray-700 mt-1">
                      Cuida do dia a dia dos turnos. Você continua no comando da empresa.
                    </p>
                  </div>
                </fieldset>

                <Field
                  label="WhatsApp da pessoa (opcional)"
                  hint="Só para abrir a conversa certa. Não fica guardado."
                >
                  <input
                    type="tel"
                    name="invitee-phone"
                    inputMode="tel"
                    autoComplete="off"
                    placeholder="(11) 91234-5678"
                    value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)}
                  />
                </Field>

                <Button type="submit" variant="dark" size="lg" fullWidth loading={inviting} iconLeft={<UserPlus size={18} />}>
                  Gerar convite
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 id="convidar-titulo" className="text-2xl font-black">Convite pronto</h2>
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
                  Envie o link para <strong>{share.displayName}</strong>. O link vale por 14 dias e é só dessa pessoa.
                </p>
                <p className="break-all rounded-xl border-2 border-black bg-gray-50 p-3 text-sm font-mono" data-testid="invite-link">
                  {shareLink}
                </p>
                <Button variant="dark" size="lg" fullWidth onClick={openWhatsApp} iconLeft={<MessageCircle size={18} />}>
                  Enviar no WhatsApp
                </Button>
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
            <h2 id="remover-titulo" className="text-2xl font-black mb-3">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button variant="secondary" size="lg" data-autofocus onClick={() => setRemoving(null)} disabled={removeBusy}>
                Voltar
              </Button>
              <Button variant="danger" size="lg" onClick={() => void confirmRemove()} loading={removeBusy}>
                Remover agora
              </Button>
            </div>
          </>
        </ModalShell>
      )}

      {/* Confirmar: o Gestor confere e-mail e hora do aceite e DIGITA o nome do convite */}
      {confirming && (
        <ModalShell labelledBy="confirmar-titulo" onClose={() => { if (!confirmBusy) setConfirming(null); }}>
          <form onSubmit={(e) => void submitConfirm(e)} className="space-y-4" noValidate>
            <h2 id="confirmar-titulo" className="text-2xl font-black">Confirmar acesso</h2>
            <dl className="rounded-xl border-2 border-black bg-gray-50 p-3 text-sm space-y-2">
              <div>
                <dt className="text-xs font-bold uppercase text-gray-600">Nome no convite</dt>
                <dd className="font-black">{confirming.displayName ?? 'Sem nome'}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase text-gray-600">E-mail verificado</dt>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            </div>
          </form>
        </ModalShell>
      )}

      {/* "Não é essa pessoa": passo de confirmação antes de cortar o acesso */}
      {rejecting && (
        <ModalShell labelledBy="rejeitar-titulo" onClose={() => setRejecting(null)}>
          <>
            <h2 id="rejeitar-titulo" className="text-2xl font-black mb-3">
              Cortar o acesso de {rejecting.displayName ?? 'quem entrou'}?
            </h2>
            <p className="text-sm text-gray-800 mb-5">
              A pessoa perde o acesso agora. Se foi engano, é só enviar um novo convite.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button variant="secondary" size="lg" data-autofocus onClick={() => setRejecting(null)}>
                Voltar
              </Button>
              <Button variant="danger" size="lg" onClick={() => void handleReject(rejecting)}>
                Cortar acesso
              </Button>
            </div>
          </>
        </ModalShell>
      )}
    </div>
  );
}
