import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import {
    Alert, Button, ButtonLink, Card, DialogActions, DialogHeader, EmptyState, ErrorState, SkeletonList,
} from '../ui';
import { Dialog } from '../ui/Dialog';
import type { CompanySite } from '../../lib/presence';
import { archiveSite, listSites } from '../../services/presenceService';
import { SiteForm } from './SiteForm';

export interface SiteManagerProps {
    companyId: string;
    /** Só o Gestor grava (o banco também recusa). Sem isto, a lista é somente leitura. */
    canManage: boolean;
    /** Rota do cartaz de impressão de um local. */
    printPath: (siteId: string) => string;
}

/** Conteúdo da página "Locais": lista, cadastro, edição e arquivamento (nunca se apaga). */
export function SiteManager({ companyId, canManage, printPath }: SiteManagerProps) {
    const [sites, setSites] = useState<CompanySite[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [reload, setReload] = useState(0);
    const [editing, setEditing] = useState<CompanySite | 'new' | null>(null);
    const [archiving, setArchiving] = useState<CompanySite | null>(null);
    const [busy, setBusy] = useState(false);
    const [archiveError, setArchiveError] = useState(false);

    useEffect(() => {
        let active = true;
        void listSites(companyId).then((result) => {
            if (!active) return;
            setFailed(result === null);
            if (result) setSites(result);
        });
        return () => { active = false; };
    }, [companyId, reload]);

    const confirmArchive = async () => {
        if (!archiving) return;
        setBusy(true);
        const ok = await archiveSite(archiving.id);
        setBusy(false);
        setArchiving(null);
        setArchiveError(!ok);
        if (ok) setReload((n) => n + 1);
    };

    if (failed) return <ErrorState onRetry={() => { setFailed(false); setReload((n) => n + 1); }} />;
    if (!sites) return <SkeletonList count={3} />;

    if (editing) {
        return (
            <Card>
                <SiteForm
                    companyId={companyId}
                    site={editing === 'new' ? undefined : editing}
                    onSaved={() => { setEditing(null); setReload((n) => n + 1); }}
                    onCancel={() => setEditing(null)}
                />
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {archiveError && <Alert tone="danger" role="alert">Não foi possível arquivar o local.</Alert>}
            {canManage && sites.length > 0 && <Button variant="dark" onClick={() => setEditing('new')}>Novo local</Button>}
            {sites.length === 0 && (
                <EmptyState
                    icon={MapPin}
                    title="Nenhum local cadastrado"
                    description={canManage
                        ? 'Cadastre o local para confirmar presença com QR e localização. Faça isso estando nele.'
                        : 'Peça ao Gestor para cadastrar o local.'}
                    action={canManage ? <Button variant="dark" onClick={() => setEditing('new')}>Cadastrar local</Button> : undefined}
                />
            )}
            {sites.map((site) => (
                <Card key={site.id} padding="sm">
                    <p className="text-base font-bold text-black">{site.name}</p>
                    <p className="text-xs text-gray-600">
                        {[site.address_text, `raio de ${site.radius_m} m`].filter(Boolean).join(' · ')}
                    </p>
                    {canManage && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            <ButtonLink variant="secondary" to={printPath(site.id)}>Cartaz do QR</ButtonLink>
                            <Button variant="secondary" onClick={() => setEditing(site)}>Editar</Button>
                            <Button variant="dangerOutline" onClick={() => setArchiving(site)}>Arquivar</Button>
                        </div>
                    )}
                </Card>
            ))}
            {archiving && (
                <Dialog labelledBy="archive-site-title" role="alertdialog" onClose={() => setArchiving(null)} locked={busy}>
                    <DialogHeader titleId="archive-site-title" title={`Arquivar ${archiving.name}?`} />
                    <p className="text-sm text-black">
                        Ele deixa de aparecer para novos turnos. Turnos que já usam este local continuam funcionando.
                    </p>
                    <DialogActions>
                        <Button variant="secondary" onClick={() => setArchiving(null)} disabled={busy}>Voltar</Button>
                        <Button variant="danger" onClick={confirmArchive} loading={busy}>Arquivar</Button>
                    </DialogActions>
                </Dialog>
            )}
        </div>
    );
}
