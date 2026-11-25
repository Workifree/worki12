import { describe, it, expect, beforeEach } from 'vitest'
import { forgetMemberships, syncMemberships } from './formerMembership'
import type { MyCompany } from '../types'

const empresa = (company_id: string, role: MyCompany['role'], company_name: string) =>
  ({ company_id, role, company_name }) as MyCompany

beforeEach(() => localStorage.clear())

describe('formerMembership', () => {
  it('avisa quando o vínculo some, até ser dispensado; é por usuário', () => {
    const minha = empresa('m', 'owner', 'Minha')
    expect(syncMemberships('u', [minha, empresa('x', 'encarregado', 'Empresa X')])).toEqual([])
    expect(syncMemberships('outro', [minha])).toEqual([])
    expect(syncMemberships('u', [minha])).toEqual([{ id: 'x', name: 'Empresa X' }])
    expect(syncMemberships('u', [minha])).toHaveLength(1)
    forgetMemberships('u', ['x'])
    expect(syncMemberships('u', [minha])).toEqual([])
  })
})
