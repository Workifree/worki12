import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Licenses from './Licenses'

const TEXTO = `MIT License

Copyright (c) 2026 SimonLuvRamen
Copyright (c) 2026 Alibaba Group Holding Limited

@page-agent/core@1.12.4 (MIT)`

function renderPage() {
  return render(
    <MemoryRouter>
      <Licenses />
    </MemoryRouter>,
  )
}

describe('Licenses', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mostra o aviso de código aberto e o texto das licenças (MIT, page-agent)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(TEXTO, { status: 200 })))
    renderPage()

    expect(screen.getByText(/O Worki usa código aberto/)).toBeInTheDocument()
    expect(await screen.findByText(/MIT License/)).toBeInTheDocument()
    expect(screen.getByText(/@page-agent\/core@1\.12\.4 \(MIT\)/)).toBeInTheDocument()
    expect(screen.getAllByText(/page-agent/).length).toBeGreaterThan(0)
    expect(fetch).toHaveBeenCalledWith('/licencas-de-terceiros.txt', expect.anything())
  })

  it('oferece o arquivo de texto quando o carregamento falha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('rede')))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível carregar/)
    expect(screen.getByRole('link', { name: /Abrir o arquivo de texto/ })).toHaveAttribute(
      'href',
      '/licencas-de-terceiros.txt',
    )
  })
})
