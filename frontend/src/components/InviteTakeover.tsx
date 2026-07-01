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
import { X, CheckCircle2, XCircle, Loader2, Building2, Clock, DollarSign, MapPin } from 'lucide-react';
import { useWorkerInvites } from '../hooks/useShiftInvites';
import { useNotifications } from '../contexts/NotificationContext';
import type { Notification as AppNotification } from '../contexts/NotificationContext';

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
  const { pendingInvites, loading, respondingId, respond, refresh } = useWorkerInvites();
  const { notifications } = useNotifications();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const seenNotifIdsRef = useRef<Set<string> | null>(null);

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
      refresh();
      maybeNotifyBrowser(
        SHIFT_INVITE_NOTIFICATION_TITLE,
        inviteNotif.message || 'Você recebeu um convite para um turno.',
      );
    }
  }, [notifications, refresh]);

  const visibleInvite = pendingInvites.find((invite) => !dismissedIds.has(invite.id));

  if (loading || !visibleInvite) return null;

  const job = visibleInvite.job;
  const companyName = (job?.company as { name?: string } | undefined)?.name ?? 'Empresa';
  const companyLogo = (job?.company as { logo_url?: string | null } | undefined)?.logo_url ?? null;
  const jobTitle = job?.title ?? 'Turno';
  const budget = job?.budget ?? 0;
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
    await respond(visibleInvite.id, response);
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-takeover-title"
    >
      <div className="relative bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,166,81,1)] w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fechar aviso de convite"
          className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-xl border-2 border-black bg-white hover:bg-gray-100 transition-colors"
        >
          <X size={18} />
        </button>

        <span className="inline-block bg-primary-light text-primary text-xs font-black uppercase px-3 py-1.5 rounded-pill border border-green-200 mb-4">
          Convite de turno
        </span>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
            {companyLogo ? (
              <img src={companyLogo} alt={companyName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Building2 size={22} className="text-gray-400" />
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-gray-400">Empresa</p>
            <p className="font-black uppercase">{companyName}</p>
          </div>
        </div>

        <h2 id="invite-takeover-title" className="font-black text-2xl uppercase mb-3">
          {jobTitle}
        </h2>

        <div className="flex flex-wrap gap-2 mb-4">
          <span className="flex items-center gap-1.5 text-xs font-bold bg-gray-100 text-gray-600 px-3 py-1.5 rounded-xl">
            <Clock size={14} /> {startDate}
            {startTime ? ` · ${startTime}${endTime ? `–${endTime}` : ''}` : ''}
          </span>
          <span className="flex items-center gap-1.5 text-xs font-bold bg-primary-light text-primary px-3 py-1.5 rounded-xl">
            <DollarSign size={14} /> R$ {budget.toFixed(2).replace('.', ',')}
          </span>
          {location && (
            <span className="flex items-center gap-1.5 text-xs font-bold bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl">
              <MapPin size={14} /> {location}
            </span>
          )}
        </div>

        {briefing && (
          <div className="bg-gray-50 border-l-4 border-black rounded-r-xl p-3 mb-6">
            <p className="text-xs font-bold uppercase text-gray-400 mb-1">Briefing</p>
            <p className="text-sm font-medium text-gray-700 line-clamp-4">{briefing}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void handleRespond('accepted')}
            disabled={isResponding}
            className="flex-1 bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResponding ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
            Aceitar
          </button>
          <button
            type="button"
            onClick={() => void handleRespond('declined')}
            disabled={isResponding}
            className="flex-1 bg-white hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-xl font-black uppercase border-2 border-gray-300 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <XCircle size={18} />
            Recusar
          </button>
        </div>
      </div>
    </div>
  );
}
