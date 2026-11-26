import { Alert, ChoiceCard, Field } from '../ui';
import type { CompanySite, PresencePolicy } from '../../lib/presence';

export interface PresencePolicyFieldsProps {
    value: PresencePolicy;
    onChange: (next: PresencePolicy) => void;
    sites: CompanySite[];
    /** Já há registro de presença no turno: modo e local não mudam (o banco recusa). */
    frozen?: boolean;
    siteError?: string;
}

/** "Como confirmar presença" para criar turno, série e padrão da empresa. */
export function PresencePolicyFields({ value, onChange, sites, frozen = false, siteError }: PresencePolicyFieldsProps) {
    const qr = value.presence_mode === 'qr_gps';
    return (
        <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-bold text-black">Como confirmar presença</legend>
            <ChoiceCard pressed={!qr} disabled={frozen} onClick={() => onChange({ ...value, presence_mode: 'dual', site_id: null })}>
                Dupla confirmação
                <span className="block text-xs font-normal text-gray-600">O freela registra e você confirma.</span>
            </ChoiceCard>
            <ChoiceCard
                pressed={qr}
                disabled={frozen || sites.length === 0}
                onClick={() => onChange({ ...value, presence_mode: 'qr_gps', site_id: value.site_id ?? (sites.length === 1 ? sites[0].id : null) })}
            >
                QR do local + localização
                <span className="block text-xs font-normal text-gray-600">
                    {sites.length === 0 ? 'Cadastre um local para usar.' : 'Chegada e saída verificadas no local já contam como confirmadas.'}
                </span>
            </ChoiceCard>
            {frozen && <p className="text-xs text-gray-600">Já há presença registrada neste turno: a forma, o local e o tipo de QR não mudam.</p>}
            {qr && (
                <>
                    <Field label="Local do turno" required error={siteError}>
                        <select value={value.site_id ?? ''} disabled={frozen} onChange={(e) => onChange({ ...value, site_id: e.target.value || null })}>
                            <option value="">Escolha o local…</option>
                            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </Field>
                    <Field label="Tipo de QR">
                        <select value={value.qr_mode} disabled={frozen} onChange={(e) => onChange({ ...value, qr_mode: e.target.value === 'static' ? 'static' : 'rotating' })}>
                            <option value="rotating">Na tela do responsável, muda sozinho (recomendado)</option>
                            <option value="static">Cartaz impresso no local</option>
                        </select>
                    </Field>
                    {value.qr_mode === 'static' && (
                        <Alert tone="warning">O cartaz pode ser fotografado. Use só quando não houver responsável no local.</Alert>
                    )}
                </>
            )}
        </fieldset>
    );
}
