import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CompanySwitcher from './CompanySwitcher'
import { getSelectedCompanyId } from '../../services/companyScopeService'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({
      data: [
        { company_id: 'minha', company_name: 'Minha Loja', role: 'owner' },
        { company_id: 'outra', company_name: 'Restaurante', role: 'encarregado' },
      ],
      error: null,
    }),
    auth: { getUser: vi.fn() },
  },
}))

describe('D-2: seletor de unidade no celular', () => {
  it('com duas unidades troca a seleção e limpa as dicas de menu', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    sessionStorage.setItem('worki_nav_role_hint', 'gestor')
    sessionStorage.setItem('worki_team_nav_hint', '1')
    render(<CompanySwitcher />)

    fireEvent.change(await screen.findByLabelText('Trocar de unidade'), { target: { value: 'outra' } })

    expect(getSelectedCompanyId()).toBe('outra')
    expect(sessionStorage.getItem('worki_nav_role_hint')).toBeNull()
    expect(sessionStorage.getItem('worki_team_nav_hint')).toBeNull()
    expect(assign).toHaveBeenCalledWith('/company/dashboard')
    vi.unstubAllGlobals()
  })
})
