/**
 * InviteTakeover — aviso em tela cheia (dentro do app) quando o freela recebe
 * um convite de turno (push, Slice 1).
 *
 * Reusa `useWorkerInvites` (mesma máquina de estados de `ShiftInviteService.respondToInvite`
 * já usada em `MyJobs.tsx`) — não duplica lógica de aceite/recusa.
 *
 * Disparo: escuta `useNotifications()` (Realtime já existente no `NotificationContext`) e,
 * ao detectar uma notificação NOVA de convite de turno, chama `refresh()` do hook de convites
 * pendentes. O overlay some quando não há mais convites pendentes (não-dispensados) — seja
 * porque o worker respondeu, seja porque ele fechou (X) o aviso.
 *
 * Fila: mostra um convite por vez (o mais recente não-dispensado); os demais aparecem em
 * sequência conforme o atual é respondido/fechado. Escolha simples e documentada — não há
 * fila persistida entre sessões.
 */

import { useEffect, useRef, useState } from 'react';
import LocalDoTurno from './LocalDoTurno';
import { MODAL_LAYER } from '../hooks/useModalDismiss';
import { Dialog } from './ui/Dialog';
import { useNavigate } from 'react-router-dom';
import { X, CheckCircle2, XCircle, Building2, Clock, DollarSign, ChevronRight } from 'lucide-react';
import { useWorkerInvites } from '../hooks/useShiftInvites';
import { useAuth } from '../contexts/AuthContext';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { workerShiftSources } from '../lib/realtime/liveSources';
import { useNotifications } from '../contexts/NotificationContext';
import { Alert, Button, IconButton } from './ui';
import type { Notification as AppNotification } from '../contexts/NotificationContext';
import { formatBRL } from '../lib/currency';

// Deve espelhar o título usado em ShiftInviteService.inviteWorkerToShift (notificação in-app).
const SHIFT_INVITE_NOTIFICATION_TITLE = 'Novo convite de turno';

function isShiftInviteNotification(notification: AppNotification): boolean {
  return notification.type === 'status_change' && notification.title === SHIFT_INVITE_NOTIFICATION_TITLE;
}

let hasRequestedBrowserPermission = false;

/**
 * "Push do app" leve e best-effort via Notification API do browser.
 * NÃO é push mobile real (não sobrevive à aba fechada) nem WhatsApp/SMS.
 * TODO: push mobile real (VAPID/service worker) e WhatsApp/SMS = infra gated, Slice 4.
 */
function maybeNotifyBrowser(title: string, body: string): void {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      void new Notification(title, { body });
      return;
    }

    if (Notification.permission === 'default' && !hasRequestedBrowserPermission) {
      hasRequestedBrowserPermission = true;
      void Notification.requestPermission();
    }
  } catch {
    // Best-effort — nunca deve quebrar a UI do takeover.
  }
}

export default function InviteTakeover() {
  const navigate = useNavigate();
  const { pendingInvites, loading, respondingId, respond, refresh } = useWorkerInvites();
  const { notifications } = useNotifications();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  // Recusa irreversivel colada no Aceitar: primeiro toque arma, segundo confirma (4s).
  const [recusaArmada, setRecusaArmada] = useState(false);
  const [acaoEmCurso, setAcaoEmCurso] = useState<'accepted' | 'declined' | null>(null);
  const recusaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenNotifIdsRef = useRef<Set<string> | null>(null);

  // Convite novo (ou retirado) aparece sem recarregar a página.
  const { user } = useAuth();
  useLiveRefresh({
    sources: user ? workerShiftSources(user.id) : [],
    onRefresh: () => refresh({ silent: true }),
    paused: loading || !!respondingId || !!acaoEmCurso,
  });

  // Detecta notificações NOVAS (chegadas via Realtime após o mount) de convite de turno.
  // Na primeira execução só registra o snapshot atual como "visto" — não dispara nada,
  // evitando reabrir o takeover para convites antigos já presentes no histórico.
  useEffect(() => {
    if (seenNotifIdsRef.current === null) {
      seenNotifIdsRef.current = new Set(notifications.map((n) => n.id));
      return;
    }

    const seen = seenNotifIdsRef.current;
    const freshOnes = notifications.filter((n) => !seen.has(n.id));
    if (freshOnes.length === 0) return;
    freshOnes.forEach((n) => seen.add(n.id));

    const inviteNotif = freshOnes.find(isShiftInviteNotification);
    if (inviteNotif) {
      void refresh({ silent: true });
      maybeNotifyBrowser(
        SHIFT_INVITE_NOTIFICATION_TITLE,
        inviteNotif.message || 'Você recebeu um convite para um turno.',
      );
    }
  }, [notifications, refresh]);

  // O convite em tela fica até ser respondido, fechado ou sumir: um que chegue enquanto a pessoa lê
  // não troca o cartão (ela aceitaria o turno errado).
  const [shownId, setShownId] = useState<string | null>(null);
  const available = pendingInvites.filter((invite) => !dismissedIds.has(invite.id));
  const visibleInvite = available.find((invite) => invite.id === shownId) ?? available[0];
  if (!loading && (visibleInvite?.id ?? null) !== shownId) {
    setShownId(visibleInvite?.id ?? null);
    // "Confirmar recusa" armado nunca passa para outro convite.
    if (recusaArmada) setRecusaArmada(false);
  }

  if (loading || !visibleInvite) return null;

  const job = visibleInvite.job;
  const companyInfo = job?.company;
  const companyName = companyInfo?.name ?? 'Empresa';
  const companyLogo = companyInfo?.logo_url ?? null;
  const companyId = companyInfo?.id;
  const jobTitle = job?.title ?? 'Turno';
  const budget = job?.budget && job.budget > 0 ? job.budget : null;
  const isSos = visibleInvite.origin === 'sos';
  const startDate = job?.start_date
    ? new Date(job.start_date).toLocaleDateString('pt-BR')
    : 'Data a definir';
  const startTime = job?.work_start_time ?? '';
  const endTime = job?.work_end_time ?? '';
  const location = job?.location ?? 'Local a definir';
  const briefing = job?.briefing || job?.description;
  const isResponding = respondingId === visibleInvite.id;

  const dismiss = () => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(visibleInvite.id);
      return next;
    });
  };

  const handleRespond = async (response: 'accepted' | 'declined') => {
    setAcaoEmCurso(response);
    try {
      await respond(visibleInvite.id, response);
    } finally {
      setAcaoEmCurso(null);
    }
  };

  // Convite continua pendente após a navegação — só dispensamos o overlay (não respondemos).
  // Ele reaparece na próxima verificação enquanto o convite seguir 'invited'.
  const handleViewCompany = () => {
    if (!companyId) return;
    dismiss();
    navigate(`/empresa/${companyId}`);
  };

  const companyAvatar = (
    <div className="w-12 h-12 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
      {companyLogo ? (
        <img src={companyLogo} alt={companyName} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Building2 size={22} className="text-gray-400" />
        </div>
      )}
    </div>
  );

  return (
    // ESC/toque no fundo = mesmo gesto do X: dispensa o aviso SEM responder o convite. Fica na
    // FRENTE dos outros diálogos (o convite tem prazo) e o foco vai no cartão, não em "Aceitar":
    // um Enter distraído não pode responder o convite.
    <Dialog
      key={visibleInvite.id}
      labelledBy="invite-takeover-title"
      onClose={dismiss}
      layer={MODAL_LAYER.invite}
      initialFocus="panel"
      overlayClassName="!bg-black/70"
      className={isSos ? 'relative border-status-warning-line' : 'relative !shadow-[6px_6px_0px_0px_rgba(0,166,81,1)]'}
    >
        <IconButton onClick={dismiss} aria-label="Fechar aviso de convite" className="absolute top-3 right-3">
          <X size={20} />
        </IconButton>

        <span className="inline-block bg-primary-light text-primary-dark text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-pill border border-green-200 mb-4">
          {isSos ? 'Urgência (SOS)' : 'Convite de turno'}
        </span>

        {isSos && (
          <Alert tone="warning" className="mb-4">
            Você não está no elenco desta empresa. Recebeu porque ativou os chamados de urgência.
          </Alert>
        )}
        {visibleInvite.disputed && (
          <p className="mb-3 text-sm font-semibold text-gray-700">Quem aceitar primeiro fica com a vaga.</p>
        )}

        {companyId ? (
          <button
            type="button"
            onClick={handleViewCompany}
            className="flex items-center gap-3 mb-4 w-full min-h-11 text-left group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
            aria-label={`Ver perfil da empresa ${companyName}`}
          >
            {companyAvatar}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-600">Empresa</p>
              <p className="font-bold line-clamp-2 [overflow-wrap:anywhere] group-hover:text-primary transition-colors">{companyName}</p>
              <span className="flex items-center gap-0.5 text-xs font-semibold text-primary-dark">
                Ver perfil <ChevronRight size={16} />
              </span>
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-3 mb-4 min-w-0">
            {companyAvatar}
            <div className="min-w-0">
              <p className="text-xs text-gray-600">Empresa</p>
              <p className="font-bold">{companyName}</p>
            </div>
          </div>
        )}

        <h2 id="invite-takeover-title" className="font-bold text-xl sm:text-2xl tracking-tight mb-3 [overflow-wrap:anywhere]">
          {jobTitle}
        </h2>

        <div className="flex flex-wrap gap-2 mb-4">
          <span className="flex items-center gap-1.5 text-xs font-semibold bg-gray-100 text-gray-700 px-3 py-1.5 rounded-xl">
            <Clock size={14} /> {startDate}
            {startTime ? ` · ${startTime}${endTime ? `–${endTime}` : ''}` : ''}
          </span>
          <span className="flex items-center gap-1.5 text-xs font-semibold bg-primary-light text-primary-dark px-3 py-1.5 rounded-xl">
            <DollarSign size={14} /> {budget ? formatBRL(budget) : 'Valor não informado'}
          </span>
          {location && (
            <span className="flex items-center gap-1.5 text-xs font-semibold bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl">
              <LocalDoTurno location={location} size={14} />
            </span>
          )}
        </div>

        {briefing && (
          <div className="bg-gray-50 border-l-4 border-black rounded-r-xl p-3 mb-6">
            <p className="text-xs font-semibold text-gray-600 mb-1">Briefing</p>
            <p className="text-sm text-gray-700 line-clamp-4">{briefing}</p>
          </div>
        )}

        <Button variant="ghost" fullWidth onClick={dismiss} className="mb-2">
          Decidir depois
        </Button>

        <div className="worki-dialog-actions flex gap-3">
          <Button
            variant="primary"
            data-copilot="freela.convite-destaque.aceitar"
            data-copilot-risk="D"
            size="lg"
            className="flex-1 min-w-0 !px-2 sm:!px-6"
            onClick={() => void handleRespond('accepted')}
            disabled={isResponding}
            loading={isResponding && acaoEmCurso === 'accepted'}
            iconLeft={<CheckCircle2 size={18} />}
          >
            Aceitar
          </Button>
          <Button
            variant={recusaArmada ? 'danger' : 'secondary'}
            data-copilot="freela.convite-destaque.recusar"
            data-copilot-risk="D"
            size="lg"
            className="flex-1 min-w-0 !px-2 sm:!px-6"
            onClick={() => {
              if (recusaArmada) {
                if (recusaTimerRef.current) clearTimeout(recusaTimerRef.current);
                setRecusaArmada(false);
                void handleRespond('declined');
                return;
              }
              setRecusaArmada(true);
              if (recusaTimerRef.current) clearTimeout(recusaTimerRef.current);
              recusaTimerRef.current = setTimeout(() => setRecusaArmada(false), 4000);
            }}
            disabled={isResponding}
            loading={isResponding && acaoEmCurso === 'declined'}
            iconLeft={<XCircle size={18} />}
          >
            {recusaArmada ? 'Confirmar recusa' : 'Recusar'}
          </Button>
        </div>
    </Dialog>
  );
}
