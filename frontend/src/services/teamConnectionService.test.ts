import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamConnectionService } from './teamConnectionService';
import { supabase } from '../lib/supabase';

// delete().eq().eq().select('id') — a guarda de consentimento (migration
// 20260816000000_team_connections_delete_guard_blocked.sql) faz o DELETE afetar 0 linhas
// (sem erro) quando o freela bloqueou a empresa; por isso o service agora encadeia
// .select('id') pra distinguir "removeu de fato" de "RLS negou silenciosamente".
const mockDeleteSelect = vi.fn().mockResolvedValue({ data: [{ id: 'conn-1' }], error: null });
const mockDeleteEq2 = vi.fn(() => ({ select: mockDeleteSelect }));
const mockDeleteEq1 = vi.fn(() => ({ eq: mockDeleteEq2 }));
const mockDelete = vi.fn(() => ({ eq: mockDeleteEq1 }));

// select('*').eq('company_id', ...).eq('worker_id', ...).maybeSingle() — check de idempotência
// no addToTeam / getConnectionStatus (2 níveis de .eq()).
const mockMaybeSingle = vi.fn();
// select('id, status, worker_id').eq('id', connectionId).maybeSingle() — fetch de estado atual
// em acceptConnection/blockConnection (1 nível de .eq()). Objeto do 1º .eq() suporta os dois
// formatos (mais um .eq() OU .maybeSingle() direto) para não colidir com o caso acima.
const mockFetchMaybeSingle = vi.fn();
const mockSelectEq2 = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelectEq1 = vi.fn(() => ({ eq: mockSelectEq2, maybeSingle: mockFetchMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: mockSelectEq1 }));

// insert(...).select().single() — criação da conexão no addToTeam quando ainda não existe.
const mockInsertSingle = vi.fn();
const mockInsertSelect = vi.fn(() => ({ single: mockInsertSingle }));
const mockInsert = vi.fn(() => ({ select: mockInsertSelect }));

// update(...).eq(...).eq(...).select('id') — acceptConnection / blockConnection. `.select('id')`
// obrigatório (patterns.md): sob RLS um UPDATE que não casa com o USING retorna 0 linhas sem
// erro (PostgREST 204) — sem isso a UI mentiria "sucesso" quando o freela mudou de estado entre
// o fetch e o UPDATE, ou quando o RLS negou.
const mockUpdateSelect = vi.fn().mockResolvedValue({ data: [{ id: 'conn-1' }], error: null });
const mockUpdateEq2 = vi.fn(() => ({ select: mockUpdateSelect }));
const mockUpdateEq1 = vi.fn(() => ({ eq: mockUpdateEq2 }));
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq1 }));

const mockFrom = vi.fn((table: string) => {
  if (table === 'companies') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'comp-12345678-1234-1234-1234-123456789012' }, error: null }),
        })),
      })),
    };
  }
  if (table === 'team_connections') {
    return {
      delete: mockDelete,
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    };
  }
  return {
    select: mockSelect,
  };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'owner-123' } },
        error: null,
      }),
    },
    from: (table: string) => mockFrom(table),
  },
}));

describe('TeamConnectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteSelect.mockResolvedValue({ data: [{ id: 'conn-1' }], error: null });
    mockUpdateSelect.mockResolvedValue({ data: [{ id: 'conn-1' }], error: null });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'owner-123' } },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getUser>>);
  });

  describe('removeFromTeam', () => {
    it('remove conexão do freela da equipe com sucesso', async () => {
      mockDeleteSelect.mockResolvedValueOnce({ data: [{ id: 'conn-1' }], error: null });

      const result = await TeamConnectionService.removeFromTeam('worker-abc-123');

      expect(result.success).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('retorna erro quando a deleção no supabase falha', async () => {
      mockDeleteSelect.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });

      const result = await TeamConnectionService.removeFromTeam('worker-abc-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Erro ao remover freela do elenco.');
    });

    it('retorna erro quando o DELETE afeta 0 linhas (RLS negou silenciosamente — freela bloqueou a empresa)', async () => {
      mockDeleteSelect.mockResolvedValueOnce({ data: [], error: null });

      const result = await TeamConnectionService.removeFromTeam('worker-abc-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Não foi possível remover este freela: ele encerrou a conexão com a sua empresa.',
      );
    });
  });

  describe('addToTeam', () => {
    it('devolve blocked=true quando a conexão existente está bloqueada pelo freela', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          id: 'conn-1',
          company_id: 'comp-12345678-1234-1234-1234-123456789012',
          worker_id: 'worker-abc-123',
          status: 'blocked',
          source: 'qr',
        },
        error: null,
      });

      const result = await TeamConnectionService.addToTeam('worker-abc-123', 'qr');

      expect(result.alreadyExists).toBe(true);
      expect(result.blocked).toBe(true);
    });

    it('devolve blocked=false quando a conexão existente está accepted (idempotência normal)', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          id: 'conn-1',
          company_id: 'comp-12345678-1234-1234-1234-123456789012',
          worker_id: 'worker-abc-123',
          status: 'accepted',
          source: 'qr',
        },
        error: null,
      });

      const result = await TeamConnectionService.addToTeam('worker-abc-123', 'qr');

      expect(result.alreadyExists).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('devolve "Link de contato inválido ou expirado." quando o INSERT falha por FK violation (worker inexistente)', async () => {
      // Migration 20260816120000_workers_select_by_relationship.sql: a policy de SELECT em
      // `workers` agora é escopada por vínculo, então não dá mais pra pré-checar a existência
      // do worker antes de criar a conexão — a FK do INSERT é quem sinaliza isso (código 23503).
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mockInsertSingle.mockResolvedValueOnce({
        data: null,
        error: { code: '23503', message: 'insert or update on table "team_connections" violates foreign key constraint' },
      });

      const result = await TeamConnectionService.addToTeam('worker-inexistente', 'link');

      expect(result.connection).toBeNull();
      expect(result.error).toBe('Link de contato inválido ou expirado.');
    });
  });

  describe('getConnectionStatus / isWorkerInTeam', () => {
    it('getConnectionStatus devolve o status bruto da conexão quando ela existe', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: { status: 'pending' }, error: null });

      const status = await TeamConnectionService.getConnectionStatus(
        'comp-12345678-1234-1234-1234-123456789012',
        'worker-abc-123',
      );

      expect(status).toBe('pending');
    });

    it('getConnectionStatus devolve null quando não existe conexão nenhuma', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      const status = await TeamConnectionService.getConnectionStatus(
        'comp-12345678-1234-1234-1234-123456789012',
        'worker-abc-123',
      );

      expect(status).toBeNull();
    });

    it('isWorkerInTeam é true SÓ quando o status é accepted (delega a getConnectionStatus)', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: { status: 'pending' }, error: null });
      const pendingResult = await TeamConnectionService.isWorkerInTeam(
        'comp-12345678-1234-1234-1234-123456789012',
        'worker-abc-123',
      );
      expect(pendingResult).toBe(false);

      mockMaybeSingle.mockResolvedValueOnce({ data: { status: 'accepted' }, error: null });
      const acceptedResult = await TeamConnectionService.isWorkerInTeam(
        'comp-12345678-1234-1234-1234-123456789012',
        'worker-abc-123',
      );
      expect(acceptedResult).toBe(true);
    });
  });

  describe('addWorkerToTeamByToken', () => {
    it('cria a conexão direto via addToTeam, SEM pré-checar `workers` (RLS agora é escopada por vínculo)', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mockInsertSingle.mockResolvedValueOnce({
        data: {
          id: 'conn-2',
          company_id: 'comp-12345678-1234-1234-1234-123456789012',
          worker_id: 'worker-12345678-1234-1234-1234-123456789012',
          status: 'pending',
          source: 'link',
        },
        error: null,
      });

      const { token } = TeamConnectionService.generateWorkerInviteToken(
        'worker-12345678-1234-1234-1234-123456789012',
      );

      const result = await TeamConnectionService.addWorkerToTeamByToken(token);

      expect(result.connection).not.toBeNull();
      expect(result.error).toBeUndefined();
      expect(mockInsert).toHaveBeenCalled();
    });

    it('devolve erro sem chamar addToTeam quando o token não tem o prefixo de worker (w_)', async () => {
      const result = await TeamConnectionService.addWorkerToTeamByToken('token-sem-prefixo-valido');

      expect(result.connection).toBeNull();
      expect(result.error).toBe('Link de contato inválido ou expirado.');
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe('acceptConnection', () => {
    it('aceita a conexão pendente com sucesso (pending → accepted)', async () => {
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: { id: 'worker-abc-123' } },
        error: null,
      } as Awaited<ReturnType<typeof supabase.auth.getUser>>);
      mockFetchMaybeSingle.mockResolvedValueOnce({
        data: { id: 'conn-1', status: 'pending', worker_id: 'worker-abc-123' },
        error: null,
      });
      mockUpdateSelect.mockResolvedValueOnce({ data: [{ id: 'conn-1' }], error: null });

      const result = await TeamConnectionService.acceptConnection('conn-1');

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('retorna erro quando o UPDATE afeta 0 linhas (RLS negou silenciosamente) — não pode reportar sucesso falso', async () => {
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: { id: 'worker-abc-123' } },
        error: null,
      } as Awaited<ReturnType<typeof supabase.auth.getUser>>);
      mockFetchMaybeSingle.mockResolvedValueOnce({
        data: { id: 'conn-1', status: 'pending', worker_id: 'worker-abc-123' },
        error: null,
      });
      // RLS negou: 0 linhas afetadas, sem erro (status PostgREST 204)
      mockUpdateSelect.mockResolvedValueOnce({ data: [], error: null });

      const result = await TeamConnectionService.acceptConnection('conn-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Não foi possível aceitar: esta conexão não está mais disponível.');
    });

    it('rejeita transição inválida (status já não é pending) antes mesmo de chamar UPDATE', async () => {
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: { id: 'worker-abc-123' } },
        error: null,
      } as Awaited<ReturnType<typeof supabase.auth.getUser>>);
      mockFetchMaybeSingle.mockResolvedValueOnce({
        data: { id: 'conn-1', status: 'accepted', worker_id: 'worker-abc-123' },
        error: null,
      });

      const result = await TeamConnectionService.acceptConnection('conn-1');

      expect(result.success).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('blockConnection', () => {
    it('bloqueia a conexão com sucesso (o veto do freela)', async () => {
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: { id: 'worker-abc-123' } },
        error: null,
      } as Awaited<ReturnType<typeof supabase.auth.getUser>>);
      mockFetchMaybeSingle.mockResolvedValueOnce({
        data: { id: 'conn-1', status: 'accepted', worker_id: 'worker-abc-123' },
        error: null,
      });
      mockUpdateSelect.mockResolvedValueOnce({ data: [{ id: 'conn-1' }], error: null });

      const result = await TeamConnectionService.blockConnection('conn-1');

      expect(result.success).toBe(true);
    });

    it('retorna erro quando o UPDATE afeta 0 linhas — não pode dizer ao freela que ele saiu quando não saiu', async () => {
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: { id: 'worker-abc-123' } },
        error: null,
      } as Awaited<ReturnType<typeof supabase.auth.getUser>>);
      mockFetchMaybeSingle.mockResolvedValueOnce({
        data: { id: 'conn-1', status: 'accepted', worker_id: 'worker-abc-123' },
        error: null,
      });
      mockUpdateSelect.mockResolvedValueOnce({ data: [], error: null });

      const result = await TeamConnectionService.blockConnection('conn-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Não foi possível bloquear: tente novamente ou atualize a página.');
    });

    it('é idempotente quando a conexão já está blocked (não chama UPDATE)', async () => {
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: { id: 'worker-abc-123' } },
        error: null,
      } as Awaited<ReturnType<typeof supabase.auth.getUser>>);
      mockFetchMaybeSingle.mockResolvedValueOnce({
        data: { id: 'conn-1', status: 'blocked', worker_id: 'worker-abc-123' },
        error: null,
      });

      const result = await TeamConnectionService.blockConnection('conn-1');

      expect(result.success).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('token helpers', () => {
    it('gera e valida worker invite token com prefixo w_', () => {
      const workerId = 'worker-12345678-1234-1234-1234-123456789012';
      const tokenObj = TeamConnectionService.generateWorkerInviteToken(workerId);

      expect(tokenObj.token.startsWith('w_')).toBe(true);
      expect(TeamConnectionService.isWorkerInviteToken(tokenObj.token)).toBe(true);

      const resolvedId = TeamConnectionService.resolveWorkerInviteToken(tokenObj.token);
      expect(resolvedId).toBe(workerId);
    });
  });
});
