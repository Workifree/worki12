import { useState } from 'react';
import { PresencePolicyFields } from '../presence/PresencePolicyFields';
import { Button, Card } from '../ui';
import { useToast } from '../../contexts/ToastContext';
import { savePresenceDefault } from './presenceDefaults';
import { usePresenceSetup } from './usePresenceSetup';

/** Montado só quando a pessoa abre: lê os locais já com os cadastros recentes. */
function DefaultForm({ companyId, onDone }: { companyId: string; onDone: () => void }) {
    const { sites, policy, setPolicy, siteError } = usePresenceSetup(companyId, true);
    const { addToast } = useToast();
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        const ok = await savePresenceDefault(companyId, policy);
        setSaving(false);
        addToast(ok ? 'Padrão salvo.' : 'Não foi possível salvar o padrão.', ok ? 'success' : 'error');
        if (ok) onDone();
    };

    return (
        <div className="space-y-3">
            <PresencePolicyFields value={policy} onChange={setPolicy} sites={sites} siteError={siteError} />
            <div className="flex flex-wrap gap-2">
                <Button variant="dark" onClick={() => { void save(); }} loading={saving} disabled={!!siteError} data-copilot-risk="D">
                    Salvar padrão
                </Button>
                <Button variant="secondary" onClick={onDone} disabled={saving}>Cancelar</Button>
            </div>
        </div>
    );
}

export default function PresenceDefaultCard({ companyId }: { companyId: string }) {
    const [open, setOpen] = useState(false);
    return (
        <Card as="section" aria-label="Padrão de presença">
            <h2 className="text-lg font-bold">Padrão para turnos novos</h2>
            <p className="mb-3 text-sm text-gray-600">Os turnos já criados não mudam.</p>
            {open
                ? <DefaultForm companyId={companyId} onDone={() => setOpen(false)} />
                : <Button variant="secondary" onClick={() => setOpen(true)}>Definir padrão</Button>}
        </Card>
    );
}
