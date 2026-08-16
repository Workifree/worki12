import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ProfileReviews from '../ProfileReviews'

// Mock supabase — ProfileReviews agora resolve autoria via RPC get_profile_reviews
// (migration 20260816130000_profile_reviews_reader.sql), não mais via .from('workers'/'companies').
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { supabase } from '../../lib/supabase'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProfileReviews — autoria via RPC get_profile_reviews', () => {
  it('renderiza o nome mascarado devolvido pela RPC (ex.: "Carlos S.")', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [
        {
          review_id: 'review-1',
          rating: 5,
          comment: 'Ótimo lugar para trabalhar.',
          created_at: new Date().toISOString(),
          reviewer_id: 'worker-1',
          reviewer_name: 'Carlos S.',
        },
      ],
      error: null,
    } as never)

    render(<ProfileReviews reviewedId="company-1" reviewerRole="worker" title="Avaliações de freelas sobre Cafeteria Central" />)

    await waitFor(() => {
      expect(screen.getByText('Carlos S.')).toBeInTheDocument()
    })

    expect(supabase.rpc).toHaveBeenCalledWith('get_profile_reviews', {
      p_reviewed_id: 'company-1',
      p_direction: 'company',
    })
  })

  it('cai no rótulo genérico "Freela" quando a RPC devolve reviewer_name null (conta anonimizada)', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [
        {
          review_id: 'review-2',
          rating: 4,
          comment: null,
          created_at: new Date().toISOString(),
          reviewer_id: 'worker-2',
          reviewer_name: null,
        },
      ],
      error: null,
    } as never)

    render(<ProfileReviews reviewedId="company-1" reviewerRole="worker" title="Avaliações" />)

    await waitFor(() => {
      expect(screen.getByText('Freela')).toBeInTheDocument()
    })
  })

  it('cai no rótulo genérico "Empresa" quando reviewerRole="company" e a RPC devolve reviewer_name null', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [
        {
          review_id: 'review-3',
          rating: 3,
          comment: null,
          created_at: new Date().toISOString(),
          reviewer_id: 'company-2',
          reviewer_name: null,
        },
      ],
      error: null,
    } as never)

    render(<ProfileReviews reviewedId="worker-1" reviewerRole="company" />)

    await waitFor(() => {
      expect(screen.getByText('Empresa')).toBeInTheDocument()
    })

    expect(supabase.rpc).toHaveBeenCalledWith('get_profile_reviews', {
      p_reviewed_id: 'worker-1',
      p_direction: 'worker',
    })
  })
})
