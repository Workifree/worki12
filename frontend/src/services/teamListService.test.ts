import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamListService } from './teamListService';

// ---------------------------------------------------------------------------
// Mock supabase — chains explícitas por tabela/operação (molde de
// teamConnectionService.test.ts). teamListService encadeia formas diferentes por
// método (select/insert/update/delete com profundidades distintas), então um
// builder genérico único (como o de shiftCallService.test.ts) não cobre os casos
// sem embaralhar resultados entre chamadas na MESMA tabela dentro do MESMO teste
// (ex.: setMembers lê, insere e remove em `team_list_members` numa única chamada).
// ---------------------------------------------------------------------------

// companies.select('id').eq('owner_id', ...).maybeSingle() — getAuthenticatedCompanyId
const mockCompanyMaybeSingle = vi.fn();

// team_lists.select('*, team_list_members(worker_id)').eq('company_id', ...).order(...) — listLists
const mockListsOrder = vi.fn();
const mockListsSelectEq = vi.fn(() => ({ order: mockListsOrder }));
const mockListsSelect = vi.fn(() => ({ eq: mockListsSelectEq }));

// team_lists.insert({...}).select().single() — createList
const mockListsInsertSingle = vi.fn();
const mockListsInsertSelect = vi.fn(() => ({ single: mockListsInsertSingle }));
const mockListsInsert = vi.fn(() => ({ select: mockListsInsertSelect }));

// team_lists.update({ name }).eq('id', id).select('id') — renameList (LM-1: só `name` no payload)
const mockListsUpdateSelect = vi.fn();
const mockListsUpdateEq = vi.fn(() => ({ select: mockListsUpdateSelect }));
const mockListsUpdate = vi.fn(() => ({ eq: mockListsUpdateEq }));

// team_lists.delete().eq('id', id).select('id') — deleteList
// team_lists.delete().eq('id', id) — compensação do createList (LM-5, sem .select() encadeado)
const mockListsDeleteSelect = vi.fn();
const mockListsDeleteEq = vi.fn(() => ({
  select: mockListsDeleteSelect,
  then: (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(onFulfilled),
}));
const mockListsDelete = vi.fn(() => ({ eq: mockListsDeleteEq }));

// team_list_members.select('worker_id').eq('list_id', id) — fetch do conjunto atual em setMembers
const mockMembersSelectEq = vi.fn();
const mockMembersSelect = vi.fn(() => ({ eq: mockMembersSelectEq }));

// team_list_members.insert([...]) — createList / setMembers (sem .select() encadeado)
const mockMembersInsert = vi.fn();

// team_list_members.delete().eq('list_id', id).in('worker_id', [...]).select('id') — setMembers
const mockMembersDeleteSelect = vi.fn();
const mockMembersDeleteIn = vi.fn(() => ({ select: mockMembersDeleteSelect }));
const mockMembersDeleteEq = vi.fn(() => ({ in: mockMembersDeleteIn }));
const mockMembersDelete = vi.fn(() => ({ eq: mockMembersDeleteEq }));

const mockGetUser = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === 'companies') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mockCompanyMaybeSingle })),
      })),
    };
  }
  if (table === 'team_lists') {
    return {
      select: mockListsSelect,
      insert: mockListsInsert,
      update: mockListsUpdate,
      delete: mockListsDelete,
    };
  }
  if (table === 'team_list_members') {
    return {
      select: mockMembersSelect,
      insert: mockMembersInsert,
      delete: mockMembersDelete,
    };
  }
  throw new Error(`tabela inesperada no mock: ${table}`);
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (table: string) => mockFrom(table),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
  mockCompanyMaybeSingle.mockResolvedValue({ data: { id: 'company-1' }, error: null });
  mockMembersInsert.mockResolvedValue({ data: null, error: null });
  mockMembersSelectEq.mockResolvedValue({ data: [], error: null });
  mockMembersDeleteSelect.mockResolvedValue({ data: [{ id: 'member-1' }], error: null });
  mockListsInsertSingle.mockResolvedValue({
    data: {
      id: 'list-1',
      company_id: 'company-1',
      name: 'Cozinha',
      created_by: 'owner-1',
      created_at: '2026-08-17T00:00:00Z',
      updated_at: '2026-08-17T00:00:00Z',
    },
    error: null,
  });
  mockListsUpdateSelect.mockResolvedValue({ data: [{ id: 'list-1' }], error: null });
  mockListsDeleteSelect.mockResolvedValue({ data: [{ id: 'list-1' }], error: null });
  mockListsOrder.mockResolvedValue({ data: [], error: null });
});

// ---------------------------------------------------------------------------
// listLists — join embutido de team_list_members → memberIds
// ---------------------------------------------------------------------------

describe('TeamListService.listLists', () => {
  it('mapeia o team_list_members embutido para memberIds', async () => {
    mockListsOrder.mockResolvedValueOnce({
      data: [
        {
          id: 'list-1',
          company_id: 'company-1',
          name: 'Cozinha',
          created_by: 'owner-1',
          created_at: 't1',
          updated_at: 't1',
          team_list_members: [{ worker_id: 'w1' }, { worker_id: 'w2' }],
        },
      ],
      error: null,
    });

    const result = await TeamListService.listLists();

    expect(result).toEqual([
      {
        id: 'list-1',
        company_id: 'company-1',
        name: 'Cozinha',
        created_by: 'owner-1',
        created_at: 't1',
        updated_at: 't1',
        memberIds: ['w1', 'w2'],
      },
    ]);
  });

  it('filtra por company_id da empresa autenticada e embute team_list_members no select (RLS é a defesa real; este teste garante que o filtro não desapareça em silêncio)', async () => {
    await TeamListService.listLists();

    expect(mockListsSelect).toHaveBeenCalledWith('*, team_list_members(worker_id)');
    expect(mockListsSelectEq).toHaveBeenCalledWith('company_id', 'company-1');
  });
});

// ---------------------------------------------------------------------------
// createList — LM-5 (compensação) + validação de nome vazio
// ---------------------------------------------------------------------------

describe('TeamListService.createList', () => {
  it('recusa nome vazio/só espaços sem tocar o banco', async () => {
    const result = await TeamListService.createList('   ', ['w1']);

    expect(result.list).toBeNull();
    expect(result.error).toBeTruthy();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('cria a lista sem tentar inserir membros quando workerIds está vazio (R6: 0 membros é válido)', async () => {
    const result = await TeamListService.createList('Bar', []);

    expect(result.list?.id).toBe('list-1');
    expect(result.error).toBeUndefined();
    expect(mockMembersInsert).not.toHaveBeenCalled();
  });

  it('LM-5: desfaz (DELETE) a lista recém-criada quando o INSERT dos membros falha por RLS', async () => {
    mockMembersInsert.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'new row violates row-level security policy' },
    });

    const result = await TeamListService.createList('Cozinha', ['w1']);

    // LM-6: erro de RLS traduzido, não repassado cru.
    expect(result.list).toBeNull();
    expect(result.error).toBe('Um dos freelas selecionados não está mais no seu Elenco.');
    // A lista órfã (sem membros) não pode sobreviver ao erro.
    expect(mockListsDelete).toHaveBeenCalled();
    expect(mockListsDeleteEq).toHaveBeenCalledWith('id', 'list-1');
  });

  it('deduplica worker_id repetidos antes de gravar os membros (o UNIQUE (list_id, worker_id) derrubaria o INSERT inteiro)', async () => {
    await TeamListService.createList('Cozinha', ['w1', 'w1', 'w2', 'w1']);

    expect(mockMembersInsert).toHaveBeenCalledTimes(1);
    expect(mockMembersInsert).toHaveBeenCalledWith([
      { list_id: 'list-1', worker_id: 'w1' },
      { list_id: 'list-1', worker_id: 'w2' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// renameList — LM-1 (payload só com name) + LM-4 (0 linhas = RLS negou)
// ---------------------------------------------------------------------------

describe('TeamListService.renameList', () => {
  it('LM-1: envia SÓ { name } no UPDATE — nunca updated_at ou outra coluna', async () => {
    const result = await TeamListService.renameList('list-1', '  Cozinha Nova  ');

    expect(result.success).toBe(true);
    // toHaveBeenCalledWith faz deep-equal exato: qualquer coluna extra no payload
    // (ex.: updated_at) já quebraria esta asserção.
    expect(mockListsUpdate).toHaveBeenCalledWith({ name: 'Cozinha Nova' });
    expect(mockListsUpdate).toHaveBeenCalledTimes(1);
  });

  it('LM-4: retorna erro quando o UPDATE afeta 0 linhas (RLS negou silenciosamente)', async () => {
    mockListsUpdateSelect.mockResolvedValueOnce({ data: [], error: null });

    const result = await TeamListService.renameList('list-1', 'Nova');

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Não foi possível renomear: a lista não existe mais ou não pertence à sua empresa.',
    );
  });

  it('recusa nome vazio sem tocar o banco', async () => {
    const result = await TeamListService.renameList('list-1', '   ');

    expect(result.success).toBe(false);
    expect(mockListsUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteList — LM-4 (0 linhas = RLS negou)
// ---------------------------------------------------------------------------

describe('TeamListService.deleteList', () => {
  it('exclui com sucesso', async () => {
    const result = await TeamListService.deleteList('list-1');

    expect(result.success).toBe(true);
  });

  it('LM-4: retorna erro quando o DELETE afeta 0 linhas (RLS negou silenciosamente)', async () => {
    mockListsDeleteSelect.mockResolvedValueOnce({ data: [], error: null });

    const result = await TeamListService.deleteList('list-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Não foi possível excluir: a lista não existe mais ou não pertence à sua empresa.',
    );
  });
});

// ---------------------------------------------------------------------------
// setMembers — LM-2 (ordem INSERT→DELETE), LM-3 (pula DELETE vazio), LM-4 (0 linhas)
// ---------------------------------------------------------------------------

describe('TeamListService.setMembers', () => {
  it('LM-2: insere os novos ANTES de remover os antigos', async () => {
    mockMembersSelectEq.mockResolvedValueOnce({ data: [{ worker_id: 'w-old' }], error: null });

    const result = await TeamListService.setMembers('list-1', ['w-new']);

    expect(result.success).toBe(true);
    expect(mockMembersInsert).toHaveBeenCalled();
    expect(mockMembersDelete).toHaveBeenCalled();
    const insertOrder = mockMembersInsert.mock.invocationCallOrder[0];
    const deleteOrder = mockMembersDelete.mock.invocationCallOrder[0];
    expect(insertOrder).toBeLessThan(deleteOrder);
  });

  it('LM-2: aborta ANTES do DELETE quando o INSERT dos novos membros falha', async () => {
    mockMembersSelectEq.mockResolvedValueOnce({ data: [{ worker_id: 'w-old' }], error: null });
    mockMembersInsert.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'row-level security' },
    });

    const result = await TeamListService.setMembers('list-1', ['w-new']);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Um dos freelas selecionados não está mais no seu Elenco.');
    // Não pode ter removido os antigos sem garantir que os novos entraram — lista mutilada.
    expect(mockMembersDelete).not.toHaveBeenCalled();
  });

  it('LM-3: pula a chamada de DELETE quando não há ninguém para remover', async () => {
    mockMembersSelectEq.mockResolvedValueOnce({ data: [], error: null });

    const result = await TeamListService.setMembers('list-1', ['w1']);

    expect(result.success).toBe(true);
    expect(mockMembersInsert).toHaveBeenCalledTimes(1);
    expect(mockMembersDelete).not.toHaveBeenCalled();
  });

  it('não chama INSERT nem DELETE quando o conjunto não muda', async () => {
    mockMembersSelectEq.mockResolvedValueOnce({ data: [{ worker_id: 'w1' }], error: null });

    const result = await TeamListService.setMembers('list-1', ['w1']);

    expect(result.success).toBe(true);
    expect(mockMembersInsert).not.toHaveBeenCalled();
    expect(mockMembersDelete).not.toHaveBeenCalled();
  });

  it('LM-4: retorna erro quando o DELETE afeta 0 linhas (RLS negou silenciosamente)', async () => {
    mockMembersSelectEq.mockResolvedValueOnce({ data: [{ worker_id: 'w-old' }], error: null });
    mockMembersDeleteSelect.mockResolvedValueOnce({ data: [], error: null });

    const result = await TeamListService.setMembers('list-1', []);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Não foi possível atualizar a lista: verifique se ela ainda existe.',
    );
  });
});
