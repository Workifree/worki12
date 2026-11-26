import { describe, it, expect, vi } from 'vitest'
import { parseSnapshot } from './rpcApi'
import { milestoneCount } from './trailView'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

describe('parseSnapshot (payload de bonus_get_my_trail, migration S3)', () => {
  it('lê group e counts_in_total e deriva o total sem constante', () => {
    const milestones = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      key: `k${i}`,
      group: i === 19 ? 'E' : 'A',
      sort_order: i + 1,
      title: 'Marco',
      amount_cents: 1000,
      counts_in_total: i !== 19,
      earned: i < 2,
      celebrated: true,
    }))
    const snap = parseSnapshot({ status: 'active', milestones })
    expect(milestoneCount(snap.milestones)).toEqual({ done: 2, total: 19 })
    expect(snap.milestones[19].group).toBe('E')
  })
})
