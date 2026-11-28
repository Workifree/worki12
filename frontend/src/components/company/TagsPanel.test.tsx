import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TagsPanel from './TagsPanel';

vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../../services/shiftOperationService', () => ({
  listTagsChecked: vi.fn().mockResolvedValue({ ok: true, items: [{ id: "t1", name: "Centro", archivedAt: null }] }),
  tagMessage: vi.fn(),
  createTag: vi.fn(),
  renameTag: vi.fn(),
  archiveTag: vi.fn(),
}));

describe('TagsPanel contagem', () => {
  it('mostra ativos e convites separados', async () => {
    render(<TagsPanel companyId="c1" memberCounts={{ t1: 2 }} inviteCounts={{ t1: 1 }} />);
    expect(await screen.findByText(/2 ativos · 1 convite/)).toBeInTheDocument();
  });
});
