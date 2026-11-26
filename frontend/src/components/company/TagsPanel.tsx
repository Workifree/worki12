import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Archive, Tag } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { Button, Card, Field } from '../ui';
import {
  archiveTag,
  createTag,
  listTagsChecked,
  tagMessage,
  type CompanyTag,
} from '../../services/shiftOperationService';

interface TagsPanelProps {
  companyId: string;
}

/** Etiquetas da empresa (R20/R24): o Gestor cria e arquiva. Nunca se apaga: arquivar só tira do seletor. */
export default function TagsPanel({ companyId }: TagsPanelProps) {
  const { addToast } = useToast();
  const [tags, setTags] = useState<CompanyTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const result = await listTagsChecked(companyId);
    setTags(result.items);
    setLoadFailed(!result.ok);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await listTagsChecked(companyId);
      if (!active) return;
      setTags(result.items);
      setLoadFailed(!result.ok);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [companyId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const result = await createTag(companyId, name);
    setBusy(false);
    const ok = result.outcome === 'created' || result.outcome === 'reactivated';
    addToast(tagMessage(result.outcome), ok ? 'success' : 'error');
    if (ok) setName('');
    await reload();
  };

  const archive = async (tag: CompanyTag) => {
    setBusy(true);
    const result = await archiveTag(tag.id);
    setBusy(false);
    addToast(tagMessage(result.outcome), result.outcome === 'archived' ? 'success' : 'error');
    await reload();
  };

  return (
    <Card as="section" aria-label="Etiquetas">
      <div className="flex items-center gap-2">
        <Tag size={18} aria-hidden="true" />
        <h2 className="text-lg font-bold">Etiquetas</h2>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Etiquetas agrupam turnos (ex.: Salão, Evento). Dá para filtrar a tela Hoje por etiqueta.
      </p>

      <form onSubmit={(e) => { void submit(e); }} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Nova etiqueta" className="flex-1" hint="De 1 a 40 caracteres.">
          <input type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </Field>
        <Button type="submit" data-copilot="empresa.etiquetas.criar" variant="dark" size="lg" disabled={!name.trim() || busy}>Criar etiqueta</Button>
      </form>

      <div className="mt-4">
        {loading ? (
          <div className="h-12 animate-pulse rounded-xl bg-gray-200" role="status"><span className="sr-only">Carregando</span></div>
        ) : loadFailed ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-black bg-yellow-50 p-3">
            <p className="text-sm font-semibold">Não foi possível carregar as etiquetas.</p>
            <Button variant="secondary" size="md" onClick={() => { void reload(); }}>Tentar de novo</Button>
          </div>
        ) : tags.length === 0 ? (
          <p className="text-sm text-gray-600">Nenhuma etiqueta ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-black p-3">
                <span className="min-w-0 truncate text-sm font-bold">{t.name}</span>
                <Button variant="secondary" size="md" disabled={busy} aria-label={`Arquivar etiqueta ${t.name}`} iconLeft={<Archive size={16} />} onClick={() => { void archive(t); }}>
                  Arquivar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
