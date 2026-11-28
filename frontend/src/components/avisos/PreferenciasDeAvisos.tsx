import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import ErroDeCarga from '../ErroDeCarga'
import WorkerSwitch from '../WorkerSwitch'
import { Button, Card, Field, Skeleton } from '../ui'
import { useToast } from '../../contexts/ToastContext'
import { checkSession } from '../../lib/authSession'
import {
    disablePushOnThisDevice, enablePush, getDeviceSubscription, getPushAvailability, loadNoticePreferences,
    saveQuietHours, setNoticeChannel, toE164,
} from '../../services/pushService'
import type { NoticePreferences } from '../../types'

interface PreferenciasDeAvisosProps {
    /** F3: só mostrar quando o WhatsApp estiver ligado no servidor. Desligado por padrão. */
    whatsappDisponivel?: boolean
}

const TEXTO_PUSH: Record<ReturnType<typeof getPushAvailability>, string | null> = {
    off: null,
    unsupported: 'Este navegador não recebe avisos no celular.',
    ios_needs_install: 'No iPhone, adicione o Workyn à Tela de Início e abra pelo ícone para ligar os avisos.',
    denied: 'Os avisos estão bloqueados. Libere nas configurações do navegador para este site.',
    available: null,
}

/** Preferências de avisos (canais, horário silencioso, opt-in do WhatsApp). Cross-papel. */
export default function PreferenciasDeAvisos({ whatsappDisponivel = false }: PreferenciasDeAvisosProps) {
    const { addToast } = useToast()
    const [userId, setUserId] = useState<string | null>(null)
    const [prefs, setPrefs] = useState<NoticePreferences | null>(null)
    const [neste, setNeste] = useState(false)
    const [carregando, setCarregando] = useState(true)
    const [salvando, setSalvando] = useState(false)
    const [telefone, setTelefone] = useState('')
    const [aceite, setAceite] = useState(false)
    const [erroTelefone, setErroTelefone] = useState('')
    const disponibilidade = getPushAvailability()

    const carregar = useCallback(async () => {
        setCarregando(true)
        const sessao = await checkSession()
        if (sessao.status !== 'ok') {
            setPrefs(null)
            setCarregando(false)
            return
        }
        const [carregadas, inscricao] = await Promise.all([
            loadNoticePreferences(sessao.user.id),
            getDeviceSubscription().catch(() => null),
        ])
        setUserId(sessao.user.id)
        setPrefs(carregadas)
        setNeste(!!inscricao)
        setCarregando(false)
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    if (carregando) return <Skeleton className="h-48 w-full" />
    if (!prefs || !userId) return <ErroDeCarga onRetry={() => void carregar()} />

    const falhou = () => addToast('Não foi possível salvar a preferência.', 'error')

    // "Ligado" neste aparelho = permissão, inscrição e preferência.
    const pushLigado = prefs.push && neste

    const alternarPush = async () => {
        setSalvando(true)
        if (pushLigado) {
            // desliga só este aparelho; outros aparelhos continuam
            await disablePushOnThisDevice()
            setNeste(false)
        } else {
            const resultado = await enablePush()
            if (resultado === 'enabled' && (await setNoticeChannel('push', true)) === 'ok') {
                setNeste(true)
                setPrefs({ ...prefs, push: true })
            } else if (resultado !== 'dismissed') {
                falhou()
            }
        }
        setSalvando(false)
    }

    const alternarEmail = async () => {
        setSalvando(true)
        if ((await setNoticeChannel('email', !prefs.email)) === 'ok') setPrefs({ ...prefs, email: !prefs.email })
        else falhou()
        setSalvando(false)
    }

    const salvarHorario = async (event: FormEvent) => {
        event.preventDefault()
        if (!prefs.quiet_start || !prefs.quiet_end) return
        setSalvando(true)
        if (await saveQuietHours(userId, prefs.quiet_start, prefs.quiet_end)) {
            addToast('Horário silencioso salvo.', 'success')
        } else falhou()
        setSalvando(false)
    }

    const ligarWhatsapp = async (event: FormEvent) => {
        event.preventDefault()
        const numero = toE164(telefone)
        if (!numero) {
            setErroTelefone('Informe o número com DDD.')
            return
        }
        setErroTelefone('')
        setSalvando(true)
        if ((await setNoticeChannel('whatsapp', true, numero)) === 'ok') setPrefs({ ...prefs, whatsapp: true })
        else falhou()
        setSalvando(false)
    }

    const desligarWhatsapp = async () => {
        setSalvando(true)
        if ((await setNoticeChannel('whatsapp', false)) === 'ok') {
            setPrefs({ ...prefs, whatsapp: false })
            setAceite(false)
        } else falhou()
        setSalvando(false)
    }

    return (
        <Card as="section" aria-labelledby="preferencias-avisos-titulo">
            <h2 id="preferencias-avisos-titulo" className="text-lg font-black uppercase">Avisos</h2>
            <p className="mt-1 text-sm text-gray-700">O sino dentro do app continua sempre ligado.</p>

            <div className="mt-4 flex flex-col gap-3">
                {disponibilidade === 'available' && (
                    <WorkerSwitch
                        checked={pushLigado}
                        label="Avisos no celular"
                        text="Receber avisos neste aparelho"
                        onToggle={() => void alternarPush()}
                        disabled={salvando}
                    />
                )}
                {TEXTO_PUSH[disponibilidade] && (
                    <p className="text-sm text-gray-700">{TEXTO_PUSH[disponibilidade]}</p>
                )}
                <WorkerSwitch
                    checked={prefs.email}
                    label="Avisos por e-mail"
                    text="Receber avisos por e-mail"
                    onToggle={() => void alternarEmail()}
                    disabled={salvando}
                />
                <p className="text-sm text-gray-700">
                    Receba avisos de turnos, confirmações e recibos direto no seu e-mail.
                </p>
            </div>

            <form onSubmit={salvarHorario} className="mt-6">
                <fieldset disabled={salvando}>
                    <legend className="text-sm font-black uppercase">Horário silencioso</legend>
                    <p className="mt-1 text-xs text-gray-600">
                        Neste intervalo os avisos esperam. Turno urgente chega mesmo assim.
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                        <Field label="Começa">
                            <input
                                type="time"
                                value={prefs.quiet_start}
                                onChange={(e) => setPrefs({ ...prefs, quiet_start: e.target.value })}
                            />
                        </Field>
                        <Field label="Termina">
                            <input
                                type="time"
                                value={prefs.quiet_end}
                                onChange={(e) => setPrefs({ ...prefs, quiet_end: e.target.value })}
                            />
                        </Field>
                    </div>
                    <Button type="submit" variant="secondary" className="mt-3">Salvar horário</Button>
                </fieldset>
            </form>

            {whatsappDisponivel && (
                <div className="mt-6">
                    <h3 className="text-sm font-black uppercase">WhatsApp</h3>
                    {prefs.whatsapp ? (
                        <>
                            <p className="mt-1 text-sm text-gray-700">
                                Turnos urgentes sem resposta chegam no seu WhatsApp.
                            </p>
                            <Button variant="secondary" className="mt-3" loading={salvando} onClick={() => void desligarWhatsapp()}>
                                Parar de receber no WhatsApp
                            </Button>
                        </>
                    ) : (
                        <form onSubmit={ligarWhatsapp} noValidate className="mt-2 flex flex-col gap-3">
                            <Field label="Celular com DDD" error={erroTelefone || undefined}>
                                <input
                                    type="tel"
                                    inputMode="tel"
                                    autoComplete="tel"
                                    value={telefone}
                                    onChange={(e) => setTelefone(e.target.value)}
                                />
                            </Field>
                            {/* Texto versionado (WHATSAPP_CONSENT_VERSION): mudou aqui, mude a versão. */}
                            <label className="flex items-start gap-3 text-sm">
                                <input
                                    type="checkbox"
                                    className="mt-0.5 h-5 w-5 shrink-0 accent-black"
                                    checked={aceite}
                                    onChange={(e) => setAceite(e.target.checked)}
                                />
                                <span>
                                    Autorizo o Workyn a me enviar pelo WhatsApp avisos de turno urgente neste número.
                                    Posso parar quando quiser, aqui ou respondendo PARAR.
                                </span>
                            </label>
                            <Button type="submit" disabled={!aceite} loading={salvando}>Receber no WhatsApp</Button>
                        </form>
                    )}
                </div>
            )}
        </Card>
    )
}
