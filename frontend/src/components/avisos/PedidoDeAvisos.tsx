import { useEffect, useState } from 'react'
import { Bell, Share } from 'lucide-react'
import { Button, Card } from '../ui'
import { useToast } from '../../contexts/ToastContext'
import {
    enablePush, getDeviceSubscription, getPushAvailability, isPromptSnoozed, snoozePrompt,
} from '../../services/pushService'

type Modo = 'oculto' | 'pedir' | 'instalar_ios'

/**
 * Cartão "Avisar quando chegar turno?". Montar só no momento certo (há convite pendente ou o
 * freela acabou de aceitar um). A permissão do navegador só é pedida no clique; "Agora não"
 * silencia por 30 dias.
 */
export default function PedidoDeAvisos() {
    const { addToast } = useToast()
    const [modo, setModo] = useState<Modo>('oculto')
    const [ativando, setAtivando] = useState(false)

    useEffect(() => {
        let active = true
        ;(async () => {
            if (isPromptSnoozed()) return
            const disponibilidade = getPushAvailability()
            if (disponibilidade === 'ios_needs_install') {
                if (active) setModo('instalar_ios')
                return
            }
            if (disponibilidade !== 'available') return
            const inscricao = await getDeviceSubscription().catch(() => null)
            if (active && !inscricao) setModo('pedir')
        })()
        return () => { active = false }
    }, [])

    if (modo === 'oculto') return null

    const adiar = () => {
        snoozePrompt()
        setModo('oculto')
    }

    const ativar = async () => {
        setAtivando(true)
        const resultado = await enablePush()
        setAtivando(false)
        if (resultado === 'enabled') {
            addToast('Avisos ligados neste aparelho.', 'success')
            setModo('oculto')
        } else if (resultado === 'denied' || resultado === 'dismissed') {
            adiar()
        } else {
            addToast('Não foi possível ligar os avisos. Tente de novo.', 'error')
        }
    }

    return (
        <Card as="section" aria-labelledby="pedido-avisos-titulo">
            <div className="flex items-start gap-3">
                <Bell size={24} aria-hidden="true" className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                    <h2 id="pedido-avisos-titulo" className="text-base font-black uppercase">
                        Avisar quando chegar turno?
                    </h2>
                    {modo === 'pedir' ? (
                        <p className="mt-1 text-sm text-gray-700">
                            O aviso chega no celular mesmo com o app fechado. Quem responde primeiro fica com a vaga.
                        </p>
                    ) : (
                        <div className="mt-1 text-sm text-gray-700">
                            <p>No iPhone, os avisos só funcionam com o Worki na tela de início:</p>
                            <ol className="mt-2 list-decimal space-y-1 pl-5">
                                <li>
                                    No Safari, toque em Compartilhar <Share size={14} aria-hidden="true" className="inline" />
                                </li>
                                <li>Escolha &quot;Adicionar à Tela de Início&quot;</li>
                                <li>Abra o Worki pelo ícone novo e ligue os avisos</li>
                            </ol>
                        </div>
                    )}
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        {modo === 'pedir' && (
                            <Button onClick={ativar} loading={ativando} uppercase>Ligar avisos</Button>
                        )}
                        <Button variant="ghost" onClick={adiar} disabled={ativando}>
                            {modo === 'pedir' ? 'Agora não' : 'Entendi'}
                        </Button>
                    </div>
                </div>
            </div>
        </Card>
    )
}
