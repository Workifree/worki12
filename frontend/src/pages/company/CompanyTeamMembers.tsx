/**
 * CompanyTeamMembers — Gestão → Equipe (só Gestor). Rota: /company/configuracoes/equipe.
 *
 * "Equipe" = funcionários que OPERAM a empresa (Gestor e Encarregado); "Elenco" = freelas (`CompanyTeam`).
 * Nunca misturar na mesma tela, lista ou convite.
 *
 * Um só convite ("Convidar pessoa": nome, e-mail, papel, loja padrão): link de uso único preso ao e-mail,
 * (a pessoa é identificada só pelo e-mail; o convite é copiar o link). Gestor convidado só
 * opera depois de confirmado. Loja = etiqueta (`company_tags`). Toda autorização real mora nas RPCs.
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
  ChevronDown,
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
import { listTags, type CompanyTag } from '../../services/shiftOperationService';
import { DialogActions, Button, Card, ErrorState, Field, Menu, PageHeader } from '../../components/ui';
import { getMyCompanies, isGestor, pickCurrentCompany } from '../../services/companyScopeService';
import {
  buildInviteLink,
  confirmMember,
  inviteMember,
  listMembers,
  memberActionMessage,
  rejectMember,
  removeMember,
  resendInvite,
  revokeInvite,
  setMemberDefaultTag,
  ROLE_LABEL,
} from '../../services/teamMembersService';
import type { RemoveMemberResult, TeamMemberItem, TeamMemberRole, TeamMemberState } from '../../types';
import { flushSync } from 'react-dom';
import { focusFirstInvalid } from '../../lib/formErrors';
import { extraTeamMessage } from '../../lib/teamMessages';

const STATE_BADGE: Record<TeamMemberState, { label: string; className: string }> = {
  invited: { label: 'Convite pendente', className: 'bg-blue-50 text-blue-700' },
  invite_expired: { label: 'Expirado', className: 'bg-red-50 text-red-700' },
  awaiting_confirmation: { label: 'Aguardando confirmação', className: 'bg-yellow-100 text-yellow-800' },
  pending_expired: { label: 'Expirado', className: 'bg-red-50 text-red-700' },
  active: { label: 'Ativo', className: 'bg-primary-light text-primary-dark' },
  removed: { label: 'Removido', className: 'bg-gray-100 text-gray-700' },
};

interface ShareState {
  displayName: string;
  token: string;
  /** O banco já tinha um convite pendente (nome igual ou parecido): é o mesmo link. */
  reused?: boolean;
  role: TeamMemberRole;
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
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteNameError, setInviteNameError] = useState<string | undefined>(undefined);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteEmailError, setInviteEmailError] = useState<string | undefined>(undefined);
  const [inviteRole, setInviteRole] = useState<TeamMemberRole>('encarregado');
  const [inviteTagId, setInviteTagId] = useState('');
  const [tags, setTags] = useState<CompanyTag[]>([]);
  const [resendTarget, setResendTarget] = useState<TeamMemberItem | null>(null);
  const [editingTag, setEditingTag] = useState<TeamMemberItem | null>(null);
  const [editTagId, setEditTagId] = useState('');
  const [tagBusy, setTagBusy] = useState(false);
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
  const [justRemoved, setJustRemoved] = useState(false);

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
    return result.items;
  }, [beginMembers]);

  // `company_members` não é publicada: "Fulano entrou. É essa pessoa?" chega pela notificação do Gestor.
  const { user } = useAuth();
  const dialogOpen = useAnyDialogOpen();
  useLiveRefresh({
    sources: user && companyId ? notificationSources(user.id) : [],
    onRefresh: () => (companyId ? reload(companyId, true) : undefined),
    paused: loading || dialogOpen || inviteOpen || inviting || !!busyId || removeBusy || confirmBusy,
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

  const loadTags = useCallback(async (id: string) => {
    setTags(await listTags(id, true));
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    void (async () => {
      const list = await listTags(companyId, true);
      if (active) setTags(list);
    })();
    return () => { active = false; };
  }, [companyId]);

  const activeTags = tags.filter((t) => !t.archivedAt);
  const tagName = (id: string | null | undefined): string | null =>
    (id ? tags.find((t) => t.id === id)?.name ?? null : null);
  const memberCountByTag: Record<string, number> = {};
  for (const m of members) {
    if (m.defaultTagId && (m.state === 'active' || m.state === 'invited' || m.state === 'awaiting_confirmation')) {
      memberCountByTag[m.defaultTagId] = (memberCountByTag[m.defaultTagId] ?? 0) + 1;
    }
  }

  const awaiting = members.filter((m) => m.state === 'awaiting_confirmation' && m.userId);
  const others = members.filter((m) => !(m.state === 'awaiting_confirmation' && m.userId));

  const openInvite = () => {
    setInviteName('');
    setInviteNameError(undefined);
    setInviteEmail('');
    setInviteEmailError(undefined);
    setInviteRole('encarregado');
    setInviteTagId('');
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
    const email = inviteEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const form = e.currentTarget as HTMLFormElement;
      flushSync(() => setInviteEmailError('Digite um e-mail válido.'));
      focusFirstInvalid(form);
      return;
    }
    if (inviting) return;
    setInviting(true);
    const result = await inviteMember(
      companyId, name, inviteRole, email, inviteRole === 'encarregado' && inviteTagId ? inviteTagId : undefined,
    );
    setInviting(false);
    if (
      (result.outcome === 'invited' || result.outcome === 'reinvited' || result.outcome === 'already_invited')
      && result.inviteToken
    ) {
      const reused = result.outcome === 'already_invited';
      setShare({ displayName: name, token: result.inviteToken, reused, role: inviteRole });
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
        : extraTeamMessage(result.outcome) ?? memberActionMessage(result.outcome, 'Não foi possível criar o convite. Tente novamente.'),
      'error',
    );
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
      setShare({ displayName: member.displayName ?? 'a pessoa', token: result.inviteToken, role: member.role });
      addToast('Novo link gerado. O link antigo deixou de valer.', 'success');
      void reload(companyId);
      return;
    }
    addToast(memberActionMessage(result.outcome, 'Não foi possível gerar um novo link. Tente novamente.'), 'error');
    void reload(companyId);
  };

  /** Convite ainda válido pode já ter sido enviado: gerar outro invalida o anterior, então confirma. */
  const askResend = (member: TeamMemberItem) => {
    if (member.state === 'invited') setResendTarget(member);
    else void handleResend(member);
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

  /** Prazo de confirmação vencido: convite novo (o e-mail é pedido de novo). */
  const handleInviteAgain = (member: TeamMemberItem) => {
    openInvite();
    setInviteName(member.displayName ?? '');
    setInviteRole(member.role);
    setInviteTagId(member.defaultTagId ?? '');
  };

  const submitEditTag = async (e: FormEvent) => {
    e.preventDefault();
    if (!companyId || !editingTag) return;
    setTagBusy(true);
    const result = await setMemberDefaultTag(companyId, editingTag.memberId, editTagId || null);
    setTagBusy(false);
    if (result.outcome === 'updated' || result.outcome === 'unchanged') {
      addToast('Loja atualizada. Vale para os próximos turnos.', 'success');
      setEditingTag(null);
    } else {
      addToast(extraTeamMessage(result.outcome) ?? memberActionMessage(result.outcome, 'Não foi possível alterar a loja. Tente novamente.'), 'error');
    }
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
      setJustRemoved(true);
    } else {
      addToast(memberActionMessage(result.outcome, 'Não foi possível remover. Tente novamente.'), 'error');
    }
    void reload(companyId);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <PageMeta title="Equipe" description="Funcionários que operam a empresa com você." />
      <BackToGestao />

      <PageHeader
        title="Equipe"
        subtitle="Funcionários que operam a empresa com você."
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
        <div className="space-y-8">
          {awaiting.length > 0 && (
            <section aria-labelledby="equipe-confirmar" className="space-y-3">
              <h2 id="equipe-confirmar" className="text-xl font-bold">Precisa da sua confirmação</h2>
              {awaiting.map((m) => (
                <Card
                  key={m.memberId}
                  aria-label={`${m.displayName ?? 'Pessoa'} aguardando confirmação`}
                >
                  <span className="mb-2 inline-block rounded-pill bg-yellow-100 px-3 py-1 text-xs font-bold text-yellow-800">
                    Aguardando confirmação
                  </span>
                  <p className="text-lg font-bold">
                    {m.displayName ?? 'Alguém'} entrou. É essa pessoa?
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

          {justRemoved && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-black bg-yellow-50 p-3 text-sm font-semibold">
              <span>Pessoa removida. Para trazer outra, use Convidar pessoa.</span>
              <Button variant="secondary" size="lg" onClick={() => setJustRemoved(false)}>Dispensar aviso</Button>
            </div>
          )}

          <section aria-labelledby="equipe-lista" className="space-y-3">
            <h2 id="equipe-lista" className="text-xl font-bold">Pessoas</h2>
            {others.length === 0 ? (
              <Card className="text-center">
                <h3 className="text-xl font-bold mb-2">Convide seu primeiro encarregado</h3>
                <p className="text-sm text-gray-700 mb-5">
                  A pessoa recebe um link só dela e entra com o e-mail que você informar.
                </p>
                <Button variant="dark" size="lg" onClick={openInvite} iconLeft={<UserPlus size={18} />}>
                  Convidar pessoa
                </Button>
              </Card>
            ) : (
              <ul className="space-y-3">
                {others.map((m) => {
                  const badge = STATE_BADGE[m.state];
                  const pending = m.state === 'invited' || m.state === 'invite_expired';
                  const busy = busyId === m.memberId;
                  const store = tagName(m.defaultTagId);
                  const validUntil = formatSaoPaulo(m.expiresAt);
                  const canEditStore = m.role === 'encarregado' && (m.state === 'active' || m.state === 'invited');
                  return (
                    <li key={m.memberId}>
                      <Card>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-lg font-bold truncate">{m.displayName ?? 'Sem nome'}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="rounded-pill bg-gray-100 text-gray-700 px-3 py-1 text-xs font-bold">
                                {ROLE_LABEL[m.role]}
                              </span>
                              {m.role === 'encarregado' && (
                                <span className="rounded-pill bg-blue-50 text-blue-700 px-3 py-1 text-xs font-bold">
                                  {store ? `Loja: ${store}` : 'Sem loja padrão'}
                                </span>
                              )}
                              <span className={`rounded-pill px-3 py-1 text-xs font-bold ${badge.className}`}>
                                {badge.label}
                              </span>
                            </div>
                          </div>
                          <Menu
                            label={`Ações de ${m.displayName ?? 'pessoa'}`}
                            menuLabel="Ações"
                            triggerVariant="secondary"
                            items={[
                              canEditStore && { label: 'Alterar loja', onSelect: () => { setEditTagId(m.defaultTagId ?? ''); setEditingTag(m); } },
                              pending && { label: 'Gerar novo link', onSelect: () => askResend(m) },
                              pending && { label: 'Cancelar convite', onSelect: () => { void handleRevoke(m); } },
                              m.state === 'pending_expired' && { label: 'Convidar de novo', onSelect: () => handleInviteAgain(m) },
                              m.state === 'active' && !!m.userId && { label: 'Remover', danger: true, onSelect: () => { void openRemove(m); } },
                            ]}
                          />
                        </div>
                        {m.acceptedEmail && !pending && (
                          <p className="text-sm text-gray-600 mt-2 break-all">{m.acceptedEmail}</p>
                        )}
                        {pending && m.invitedEmail && (
                          <p className="text-sm text-gray-600 mt-1 break-all">{m.invitedEmail}</p>
                        )}
                        {pending && m.invitedEmail === null && (
                          <p role="status" className="text-xs font-bold text-yellow-800 mt-2">
                            Convite antigo, sem e-mail: não funciona mais. Cancele e convide de novo com o e-mail.
                          </p>
                        )}
                        {pending && (
                          <>
                            <p className="text-xs text-gray-600 mt-2">
                              {m.state === 'invite_expired'
                                ? 'O link venceu. Gere um novo.'
                                : `Link válido${validUntil ? ` até ${validUntil}` : ''}, só dessa pessoa.`}
                            </p>
                            <p className="text-xs text-gray-600 mt-1">O link anterior deixa de valer.</p>
                            <Button
                              variant="secondary"
                              size="lg"
                              className="mt-3"
                              onClick={() => askResend(m)}
                              loading={busy}
                              iconLeft={<Copy size={16} />}
                            >
                              Gerar novo link
                            </Button>
                          </>
                        )}
                        {m.state === 'pending_expired' && (
                          <p className="text-xs text-gray-600 mt-2">O prazo para confirmar acabou. Convide de novo.</p>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {companyId && (
            <details className="group rounded-2xl border-2 border-black bg-white" data-testid="lojas-section">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 p-4 text-xl font-bold">
                Lojas
                <ChevronDown size={20} className="transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="px-4 pb-4">
                <TagsPanel
                  companyId={companyId}
                  memberCounts={memberCountByTag}
                  onChanged={() => { void loadTags(companyId); }}
                />
              </div>
            </details>
          )}

          <details className="group rounded-2xl border-2 border-black bg-white">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 p-4 text-xl font-bold">
              Papéis
              <ChevronDown size={20} className="transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-3 px-4 pb-4 text-sm text-gray-800">
              <p><strong>Gestor:</strong> vê e faz tudo na empresa, convida pessoas e define as lojas. Só opera depois que você confirma.</p>
              <p><strong>Encarregado:</strong> cuida só dos próprios turnos (ou dos que cobrir). Pode ter uma loja padrão.</p>
            </div>
          </details>
        </div>
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

                <Field label="E-mail da pessoa" required hint="O link só funciona com este e-mail." error={inviteEmailError}>
                  <input
                    data-copilot-private
                    type="email"
                    name="invitee-email"
                    inputMode="email"
                    autoComplete="off"
                    value={inviteEmail}
                    onChange={(e) => { setInviteEmail(e.target.value); setInviteEmailError(undefined); }}
                  />
                </Field>

                <fieldset>
                  <legend className="text-sm font-bold mb-2">Papel</legend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(['encarregado', 'manager'] as const).map((r) => (
                      <label
                        key={r}
                        className={`relative min-h-11 cursor-pointer rounded-2xl border-2 border-black p-4 focus-within:ring-2 focus-within:ring-black focus-within:ring-offset-2 ${inviteRole === r ? 'bg-blue-50 shadow-[4px_4px_0px_0px_rgba(37,99,235,1)]' : 'bg-white'}`}
                      >
                        <input
                          type="radio"
                          name="invitee-role"
                          className="sr-only"
                          checked={inviteRole === r}
                          onChange={() => setInviteRole(r)}
                        />
                        {inviteRole === r && <Check size={18} aria-hidden="true" className="absolute right-3 top-3 text-blue-700" />}
                        <span className="block font-bold">{ROLE_LABEL[r]}</span>
                        <span className="mt-1 block text-sm text-gray-700">
                          {r === 'encarregado'
                            ? 'Cuida só dos próprios turnos.'
                            : 'Acesso total à empresa. A pessoa precisa antes se cadastrar com este e-mail e confirmá-lo; só opera depois da sua confirmação.'}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {inviteRole === 'encarregado' && activeTags.length > 0 && (
                  <Field
                    label="Loja padrão (opcional)"
                    hint="Os turnos que ele criar nascem com esta loja e ele não pode trocar."
                  >
                    <select aria-label="Loja padrão" value={inviteTagId} onChange={(e) => setInviteTagId(e.target.value)}>
                      <option value="">Sem loja padrão</option>
                      {activeTags.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                  </Field>
                )}

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
                  Envie este link para <strong>{share.displayName}</strong>. O link vale por 14 dias e é só dessa pessoa.
                </p>
                <p data-copilot-private className="break-all rounded-xl border-2 border-black bg-gray-50 p-3 text-sm font-mono" data-testid="invite-link">
                  {shareLink}
                </p>
                <Button
                  variant="dark"
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

      {resendTarget && (
        <ModalShell labelledBy="novo-link-titulo" onClose={() => setResendTarget(null)}>
          <>
            <h2 id="novo-link-titulo" className="text-2xl font-bold mb-3">
              Gerar novo link para {resendTarget.displayName ?? 'esta pessoa'}?
            </h2>
            <p className="text-sm text-gray-800 mb-5">
              O link anterior deixa de valer. Se você já o enviou, envie o novo.
            </p>
            <DialogActions>
              <Button variant="secondary" size="lg" data-autofocus onClick={() => setResendTarget(null)}>Voltar</Button>
              <Button variant="dark" size="lg" onClick={() => { const m = resendTarget; setResendTarget(null); void handleResend(m); }}>
                Gerar novo link
              </Button>
            </DialogActions>
          </>
        </ModalShell>
      )}

      {editingTag && (
        <ModalShell labelledBy="loja-titulo" onClose={() => { if (!tagBusy) setEditingTag(null); }}>
          <form onSubmit={(e) => void submitEditTag(e)} className="space-y-4">
            <h2 id="loja-titulo" className="text-2xl font-bold">Alterar loja de {editingTag.displayName ?? 'a pessoa'}</h2>
            <Field label="Loja padrão">
              <select aria-label="Loja padrão" data-autofocus value={editTagId} onChange={(e) => setEditTagId(e.target.value)}>
                <option value="">Sem loja padrão</option>
                {tags.filter((t) => !t.archivedAt || t.id === editTagId).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
            <p className="text-sm text-gray-700">
              Os turnos que este encarregado criar nascem com esta loja e ele não pode trocar; relatórios e
              financeiro filtram por loja. Turnos que já existem não mudam.
            </p>
            <DialogActions>
              <Button variant="secondary" size="lg" onClick={() => setEditingTag(null)} disabled={tagBusy}>Voltar</Button>
              <Button type="submit" variant="dark" size="lg" loading={tagBusy}>Salvar</Button>
            </DialogActions>
          </form>
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
