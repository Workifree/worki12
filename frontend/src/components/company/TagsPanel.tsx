import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Archive, Pencil } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { Button, DialogActions, Field } from '../ui';
import ModalShell from '../ModalShell';
import { useLatestResponse } from '../../hooks/useLatestResponse';
import { extraTeamMessage } from '../../lib/teamMessages';
import {
  archiveTag,
  createTag,
  listTagsChecked,
  renameTag,
  tagMessage,
  type CompanyTag,
} from '../../services/shiftOperationService';

interface TagsPanelProps {
  companyId: string;
  /** Quantos funcionários (ativos ou convidados) têm cada loja como padrão. */
  memberCounts?: Record<string, number>;
  /** Convites pendentes por loja (separados dos ativos). */
  inviteCounts?: Record<string, number>;
  /** Avisa a tela pai que a lista de lojas mudou. */
  onChanged?: () => void;
}

/**
 * Lojas da empresa: o Gestor cria, renomeia e arquiva. Nunca se apaga.
 * Loja é um rótulo para o financeiro; não dá acesso a ninguém.
 */
export default function TagsPanel({ companyId, memberCounts = {}, inviteCounts = {}, onChanged }: TagsPanelProps) {
  const { addToast } = useToast();
  const [tags, setTags] = useState<CompanyTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<CompanyTag | null>(null);
  const [newName, setNewName] = useState('');

  const [archiving, setArchiving] = useState<CompanyTag | null>(null);

  // Resposta atrasada de uma leitura antiga não pode sobrescrever a lista mais nova.
  const beginLoad = useLatestResponse();
  const reload = useCallback(async () => {
    const claim = beginLoad();
    const result = await listTagsChecked(companyId);
    if (!claim()) return;
    setTags(result.items);
    setLoadFailed(!result.ok);
    setLoading(false);
  }, [companyId, beginLoad]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const claim = beginLoad();
      const result = await listTagsChecked(companyId);
      if (!active || !claim()) return;
      setTags(result.items);
      setLoadFailed(!result.ok);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [companyId, beginLoad]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const result = await createTag(companyId, name);
    setBusy(false);
    const ok = result.outcome === 'created' || result.outcome === 'reactivated';
    addToast(tagMessage(result.outcome), ok ? 'success' : 'error');
    if (ok) { setName(''); onChanged?.(); }
    await reload();
  };

  const archive = async (tag: CompanyTag) => {
    setBusy(true);
    const result = await archiveTag(tag.id);
    setBusy(false);
    const { outcome } = result;
    if (outcome === 'default_of_members') {
      addToast(extraTeamMessage(outcome) ?? 'Não foi possível arquivar.', 'error');
    } else {
      addToast(tagMessage(outcome), outcome === 'archived' ? 'success' : 'error');
      if (outcome === 'archived') onChanged?.();
    }
    await reload();
  };

  const submitRename = async (e: FormEvent) => {
    e.preventDefault();
    if (!renaming || !newName.trim()) return;
    setBusy(true);
    const result = await renameTag(renaming.id, newName);
    setBusy(false);
    const ok = result.outcome === 'renamed';
    addToast(ok ? 'Loja renomeada.' : tagMessage(result.outcome), ok ? 'success' : 'error');
    if (ok) { setRenaming(null); onChanged?.(); }
    await reload();
  };

  return (
    <section aria-label="Lojas">
      <p className="text-sm text-gray-600">
        Loja é um rótulo para o financeiro: separa os turnos e os relatórios por loja.
      </p>

      <form onSubmit={(e) => { void submit(e); }} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Nova loja" className="flex-1" hint="Ex.: Loja Centro. De 1 a 40 caracteres.">
          <input type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </Field>
        <Button type="submit" data-copilot="empresa.etiquetas.criar" variant="dark" size="lg" disabled={!name.trim() || busy}>Criar loja</Button>
      </form>

      <div className="mt-4">
        {loading ? (
          <div className="h-12 animate-pulse rounded-xl bg-gray-200" role="status"><span className="sr-only">Carregando</span></div>
        ) : loadFailed ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-black bg-yellow-50 p-3">
            <p className="text-sm font-semibold">Não foi possível carregar as lojas.</p>
            <Button variant="secondary" size="lg" onClick={() => { void reload(); }}>Tentar de novo</Button>
          </div>
        ) : tags.filter((t) => !t.archivedAt).length === 0 ? (
          <p className="text-sm text-gray-600">Nenhuma loja ainda. Crie a primeira acima.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tags.filter((t) => !t.archivedAt).map((t) => {
              const count = memberCounts[t.id] ?? 0;
              const invites = inviteCounts[t.id] ?? 0;
              return (
                <li key={t.id} className="rounded-xl border-2 border-black p-3">
                  {renaming?.id === t.id ? (
                    <form onSubmit={(e) => { void submitRename(e); }} className="flex flex-col gap-3">
                      <Field label="Novo nome" hint="O nome novo também aparece nos relatórios de turnos passados.">
                        <input type="text" maxLength={40} data-autofocus value={newName} onChange={(e) => setNewName(e.target.value)} disabled={busy} />
                      </Field>
                      <div className="flex gap-3">
                        <Button type="submit" variant="dark" size="lg" disabled={!newName.trim() || busy}>Salvar nome</Button>
                        <Button variant="secondary" size="lg" disabled={busy} onClick={() => setRenaming(null)}>Cancelar</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{t.name}</p>
                        <p className="text-xs text-gray-600">
                          {count === 0 ? 'Nenhum encarregado ativo' : `${count} ${count === 1 ? 'ativo' : 'ativos'}`}
                          {invites > 0 && ` · ${invites} ${invites === 1 ? 'convite' : 'convites'}`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="lg" disabled={busy} aria-label={`Renomear loja ${t.name}`} iconLeft={<Pencil size={16} />} onClick={() => { setRenaming(t); setNewName(t.name); }}>
                          Renomear
                        </Button>
                        <Button variant="secondary" size="lg" disabled={busy} aria-label={`Arquivar loja ${t.name}`} iconLeft={<Archive size={16} />} onClick={() => setArchiving(t)}>
                          Arquivar
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {archiving && (
        <ModalShell labelledBy="arquivar-loja-titulo" onClose={() => setArchiving(null)}>
          <>
            <h2 id="arquivar-loja-titulo" className="mb-3 text-2xl font-bold">Arquivar a loja {archiving.name}?</h2>
            <p className="mb-5 text-sm text-gray-800">
              Ela deixa de aparecer para novos turnos. Os turnos antigos continuam com ela e os relatórios não mudam.
            </p>
            <DialogActions>
              <Button variant="secondary" size="lg" data-autofocus onClick={() => setArchiving(null)}>Voltar</Button>
              <Button variant="danger" size="lg" onClick={() => { const t = archiving; setArchiving(null); void archive(t); }}>
                Arquivar loja
              </Button>
            </DialogActions>
          </>
        </ModalShell>
      )}
    </section>
  );
}
