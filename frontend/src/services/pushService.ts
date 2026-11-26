// Web Push e preferências de avisos. Sem VITE_VAPID_PUBLIC_KEY o push fica desligado, sem erro.
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'
import type { NoticeChannel, NoticePreferences } from '../types'

/** Versão do texto de opt-in do WhatsApp. Mudou o texto, mude a versão. */
export const WHATSAPP_CONSENT_VERSION = 'wa-optin-v1'

export const DEFAULT_PREFERENCES: NoticePreferences = {
    push: true,
    email: true,
    whatsapp: false,
    quiet_start: '22:00',
    quiet_end: '07:00',
    tz: 'America/Sao_Paulo',
}

const SNOOZE_KEY = 'worki:avisos:adiado-em'
export const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000
const READY_TIMEOUT_MS = 5000

export type PushAvailability =
    | 'off' // sem chave pública: recurso desligado
    | 'unsupported'
    | 'ios_needs_install' // iPhone/iPad fora do app instalado
    | 'denied'
    | 'available'

const vapidKey = (): string => (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() ?? ''

export function isIos(): boolean {
    // iPadOS se apresenta como Mac, mas tem tela de toque.
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
    return window.matchMedia?.('(display-mode: standalone)').matches === true ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function getPushAvailability(): PushAvailability {
    if (!vapidKey()) return 'off'
    if (isIos() && !isStandalone()) return 'ios_needs_install'
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        return 'unsupported'
    }
    return Notification.permission === 'denied' ? 'denied' : 'available'
}

/** `serviceWorker.ready` nunca resolve se não houver worker registrado (ex.: dev). */
async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), READY_TIMEOUT_MS)
    })
    try {
        return await Promise.race([navigator.serviceWorker.ready, timeout])
    } finally {
        clearTimeout(timer)
    }
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
    const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replaceAll('-', '+').replaceAll('_', '/')
    const raw = atob(base64)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
    return out
}

async function saveSubscription(subscription: PushSubscription): Promise<boolean> {
    const json = subscription.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false
    const { data, error } = await supabase.rpc('register_push_subscription', {
        p_endpoint: json.endpoint,
        p_p256dh: json.keys.p256dh,
        p_auth: json.keys.auth,
        p_user_agent: navigator.userAgent,
    })
    if (error) {
        logError('pushService.register', error)
        return false
    }
    return (data as { outcome?: string } | null)?.outcome === 'ok'
}

export async function getDeviceSubscription(): Promise<PushSubscription | null> {
    const availability = getPushAvailability()
    if (availability !== 'available') return null
    const registration = await readyRegistration()
    return (await registration?.pushManager.getSubscription()) ?? null
}

export type EnablePushResult = 'enabled' | 'denied' | 'dismissed' | 'unavailable' | 'error'

/** Chame SOMENTE a partir de um clique: é aqui que o navegador pede a permissão. */
export async function enablePush(): Promise<EnablePushResult> {
    if (getPushAvailability() !== 'available') return 'unavailable'
    try {
        const permission = await Notification.requestPermission()
        if (permission === 'denied') return 'denied'
        if (permission !== 'granted') return 'dismissed'
        const registration = await readyRegistration()
        if (!registration) return 'unavailable'
        const subscription = (await registration.pushManager.getSubscription()) ??
            (await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidKey()),
            }))
        return (await saveSubscription(subscription)) ? 'enabled' : 'error'
    } catch (error) {
        logError('pushService.enable', error)
        return 'error'
    }
}

/** Desliga ESTE aparelho. Chamar também no logout (aparelho compartilhado). */
export async function disablePushOnThisDevice(): Promise<void> {
    try {
        if (!('serviceWorker' in navigator)) return
        const registration = await navigator.serviceWorker.getRegistration()
        const subscription = await registration?.pushManager?.getSubscription()
        if (!subscription) return
        const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
        if (error) logError('pushService.delete', error)
        await subscription.unsubscribe()
    } catch (error) {
        logError('pushService.disable', error)
    }
}

export function isPromptSnoozed(now = Date.now()): boolean {
    try {
        const at = Number(localStorage.getItem(SNOOZE_KEY))
        return at > 0 && now - at < SNOOZE_MS
    } catch {
        return false
    }
}

export function snoozePrompt(now = Date.now()): void {
    try {
        localStorage.setItem(SNOOZE_KEY, String(now))
    } catch {
        // armazenamento bloqueado: o cartão volta na próxima visita
    }
}

export async function loadNoticePreferences(userId: string): Promise<NoticePreferences | null> {
    const { data, error } = await supabase
        .from('notice_preferences')
        .select('push, email, whatsapp, quiet_start, quiet_end, tz')
        .eq('user_id', userId)
        .maybeSingle()
    if (error) {
        logError('pushService.loadPreferences', error)
        return null
    }
    if (!data) return DEFAULT_PREFERENCES
    const row = data as NoticePreferences
    return { ...row, quiet_start: row.quiet_start.slice(0, 5), quiet_end: row.quiet_end.slice(0, 5) }
}

/** Liga/desliga um canal. A RPC grava preferência e consentimento na mesma transação. */
export async function setNoticeChannel(
    channel: NoticeChannel, enabled: boolean, whatsappPhone?: string,
): Promise<'ok' | 'phone_and_consent_required' | 'error'> {
    const { data, error } = await supabase.rpc('set_notice_preference', {
        p_channel: channel,
        p_enabled: enabled,
        p_phone: whatsappPhone ?? null,
        p_text_version: channel === 'whatsapp' ? WHATSAPP_CONSENT_VERSION : null,
    })
    if (error) {
        logError('pushService.setChannel', error)
        return 'error'
    }
    const outcome = (data as { outcome?: string } | null)?.outcome
    return outcome === 'ok' || outcome === 'phone_and_consent_required' ? outcome : 'error'
}

export async function saveQuietHours(userId: string, quietStart: string, quietEnd: string): Promise<boolean> {
    const { error } = await supabase
        .from('notice_preferences')
        .upsert({ user_id: userId, quiet_start: quietStart, quiet_end: quietEnd }, { onConflict: 'user_id' })
    if (error) logError('pushService.saveQuietHours', error)
    return !error
}

/** Telefone digitado (BR) para E.164. Devolve null se não for um número utilizável. */
export function toE164(input: string): string | null {
    const trimmed = input.trim()
    const digits = trimmed.replace(/\D/g, '')
    if (trimmed.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null
    if (digits.length === 10 || digits.length === 11) return `+55${digits}`
    return /^55\d{10,11}$/.test(digits) ? `+${digits}` : null
}

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

async function markOpened(eventId: unknown): Promise<void> {
    if (typeof eventId !== 'string' || !UUID.test(eventId)) return
    const { error } = await supabase.rpc('mark_notice_opened', { p_event_id: eventId })
    if (error) logError('pushService.markOpened', error)
}

/**
 * Registra a abertura de um push (`?aviso=` na URL ou mensagem do service worker).
 * Montar uma vez, com usuário logado. Devolve a função de limpeza.
 */
export function watchNoticeOpens(): () => void {
    const url = new URL(window.location.href)
    const fromUrl = url.searchParams.get('aviso')
    if (fromUrl) {
        url.searchParams.delete('aviso')
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
        void markOpened(fromUrl)
    }
    if (!('serviceWorker' in navigator)) return () => undefined
    const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; eventId?: unknown } | null
        if (data?.type === 'NOTICE_OPENED') void markOpened(data.eventId)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
}

/** Renova a inscrição já autorizada (o navegador pode trocá-la). Nunca pede permissão. */
export async function syncPushSubscription(): Promise<void> {
    try {
        if (getPushAvailability() !== 'available' || Notification.permission !== 'granted') return
        const subscription = await getDeviceSubscription()
        if (subscription) await saveSubscription(subscription)
    } catch (error) {
        logError('pushService.sync', error)
    }
}
