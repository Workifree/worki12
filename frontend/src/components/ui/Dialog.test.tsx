import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Dialog } from './Dialog'
import type { DialogProps } from './Dialog'
import { MODAL_LAYER } from '../../hooks/useModalDismiss'
import { isShownAfter } from '../../lib/dialogElement'
import { ToastProvider, useToast } from '../../contexts/ToastContext'

function Harness(props: Partial<DialogProps>) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Abrir</button>
            {open && (
                <Dialog labelledBy="t" onClose={() => setOpen(false)} {...props}>
                    <h2 id="t">Título</h2>
                    <input aria-label="Nome" />
                    <button type="button">Salvar</button>
                </Dialog>
            )}
        </>
    )
}

function abrir() {
    const opener = screen.getByRole('button', { name: 'Abrir' })
    opener.focus()
    fireEvent.click(opener)
    return opener
}

const esc = () => fireEvent.keyDown(document, { key: 'Escape' })

describe('Dialog (casca única)', () => {
    it('abre como <dialog>, foca o primeiro campo e devolve o foco ao fechar com Esc', () => {
        render(<Harness />)
        const opener = abrir()
        const dialog = screen.getByRole('dialog', { name: 'Título' })
        expect(dialog.tagName).toBe('DIALOG')
        expect(dialog).toHaveAttribute('open')
        expect(screen.getByLabelText('Nome')).toHaveFocus()
        esc()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(opener).toHaveFocus()
    })

    it('Tab fica preso dentro do diálogo', () => {
        render(<Harness />)
        abrir()
        const salvar = screen.getByRole('button', { name: 'Salvar' })
        salvar.focus()
        fireEvent.keyDown(salvar, { key: 'Tab' })
        expect(screen.getByLabelText('Nome')).toHaveFocus()
    })

    it('toque no fundo fecha; toque dentro não', () => {
        render(<Harness />)
        abrir()
        fireEvent.click(screen.getByRole('heading'))
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('dialog'))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it.each([{ locked: true }, { dismissable: false }])('%o: Esc e fundo não fecham', (props) => {
        render(<Harness {...props} />)
        abrir()
        esc()
        fireEvent.click(screen.getByRole('dialog'))
        expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('camada maior continua na frente mesmo quando outra abre depois', () => {
        const front = vi.fn()
        const back = vi.fn()
        const frontDialog = <Dialog key="f" labelledBy="f" layer={MODAL_LAYER.invite} onClose={front}><h2 id="f">Frente</h2></Dialog>
        const { rerender } = render(<>{frontDialog}</>)
        rerender(<>{frontDialog}<Dialog key="b" labelledBy="b" onClose={back}><h2 id="b">Atrás</h2></Dialog></>)
        const a = screen.getByRole('dialog', { name: 'Frente' }) as HTMLDialogElement
        const b = screen.getByRole('dialog', { name: 'Atrás' }) as HTMLDialogElement
        expect(isShownAfter(a, b)).toBe(true)
        expect(a).not.toHaveAttribute('inert')
        expect(b).toHaveAttribute('inert')
        esc()
        expect(front).toHaveBeenCalledTimes(1)
        expect(back).not.toHaveBeenCalled()
    })

    describe('sem showModal (navegador antigo)', () => {
        const original = HTMLDialogElement.prototype.showModal
        afterEach(() => { HTMLDialogElement.prototype.showModal = original })

        it('abre pelo atributo open e fecha do mesmo jeito', () => {
            HTMLDialogElement.prototype.showModal = undefined as unknown as typeof original
            render(<Harness />)
            abrir()
            expect(screen.getByRole('dialog')).toHaveAttribute('data-fallback')
            expect(screen.getByRole('dialog')).toHaveAttribute('open')
            esc()
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        })
    })
})

function Avisar() {
    const { addToast } = useToast()
    return (
        <>
            <button type="button" onClick={() => addToast('Salvo.', 'success')}>ok</button>
            <button type="button" onClick={() => addToast('Falhou.', 'error')}>falha</button>
        </>
    )
}

describe('Toasts', () => {
    afterEach(() => { vi.useRealTimers() })
    const avancar = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

    it('sucesso some sozinho (e pausa com o ponteiro em cima); erro fica até fechar', () => {
        vi.useFakeTimers()
        render(<ToastProvider><Avisar /></ToastProvider>)
        fireEvent.click(screen.getByRole('button', { name: 'ok' }))
        fireEvent.click(screen.getByRole('button', { name: 'falha' }))
        expect(screen.getByRole('alert')).toHaveTextContent('Falhou.')
        expect(screen.getByRole('status')).toHaveTextContent('Salvo.')

        const sucesso = screen.getByText('Salvo.').parentElement!
        fireEvent.pointerEnter(sucesso)
        avancar(30000)
        expect(screen.getByText('Salvo.')).toBeInTheDocument()
        fireEvent.pointerLeave(sucesso)
        avancar(30000)
        expect(screen.queryByText('Salvo.')).not.toBeInTheDocument()
        expect(screen.getByText('Falhou.')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }))
        expect(screen.queryByText('Falhou.')).not.toBeInTheDocument()
    })

    it('com um diálogo aberto, o aviso é desenhado dentro dele e fechá-lo não fecha o diálogo', () => {
        const onClose = vi.fn()
        render(
            <ToastProvider>
                <Dialog labelledBy="d" onClose={onClose}><h2 id="d">Form</h2><Avisar /></Dialog>
            </ToastProvider>,
        )
        fireEvent.click(screen.getByRole('button', { name: 'falha' }))
        expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('alert'))
        fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }))
        expect(onClose).not.toHaveBeenCalled()
    })
})
