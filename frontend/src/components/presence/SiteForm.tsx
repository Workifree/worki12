import { useState } from 'react';
import type { FormEvent } from 'react';
import { LocateFixed } from 'lucide-react';
import { Alert, Button, Field } from '../ui';
import {
    DEFAULT_RADIUS_M, MAX_RADIUS_M, MIN_RADIUS_M, SITE_CAPTURE_MAX_ACCURACY_M,
} from '../../lib/presence';
import type { CompanySite } from '../../lib/presence';
import { GEO_FAILURE_MESSAGES, getDevicePosition } from '../../lib/presenceGeo';
import { saveSite } from '../../services/presenceService';

export interface SiteFormProps {
    companyId: string;
    /** Presente = edição. */
    site?: CompanySite;
    onSaved: (site: CompanySite) => void;
    onCancel?: () => void;
}

/** Cadastro de local. O ponto vem de "Estou aqui agora": sem geocodificação e sem mapa externo. */
export function SiteForm({ companyId, site, onSaved, onCancel }: SiteFormProps) {
    const [name, setName] = useState(site?.name ?? '');
    const [address, setAddress] = useState(site?.address_text ?? '');
    const [radius, setRadius] = useState(String(site?.radius_m ?? DEFAULT_RADIUS_M));
    const [point, setPoint] = useState<{ lat: number; lng: number; accuracy?: number } | null>(
        site ? { lat: site.lat, lng: site.lng } : null,
    );
    const [locating, setLocating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [geoError, setGeoError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [errors, setErrors] = useState<{ name?: string; radius?: string; point?: string }>({});

    const capture = async () => {
        setLocating(true);
        setGeoError(null);
        const result = await getDevicePosition();
        setLocating(false);
        if (!result.ok) {
            setGeoError(GEO_FAILURE_MESSAGES[result.failure].replace(' ou peça a confirmação ao responsável', ''));
            return;
        }
        const { lat, lng, accuracy } = result.position;
        if (!(accuracy <= SITE_CAPTURE_MAX_ACCURACY_M)) {
            setGeoError(`A precisão ficou em cerca de ${Math.round(accuracy)} m, e precisamos de ${SITE_CAPTURE_MAX_ACCURACY_M} m ou menos. Vá para perto de uma janela ou área aberta e tente de novo.`);
            return;
        }
        setPoint({ lat, lng, accuracy });
        setErrors((e) => ({ ...e, point: undefined }));
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const radiusM = Number(radius);
        const next = {
            name: name.trim() ? undefined : 'Dê um nome ao local.',
            radius: Number.isInteger(radiusM) && radiusM >= MIN_RADIUS_M && radiusM <= MAX_RADIUS_M
                ? undefined : `Informe um raio entre ${MIN_RADIUS_M} e ${MAX_RADIUS_M} metros.`,
            point: point ? undefined : 'Toque em "Estou aqui agora" estando no local.',
        };
        setErrors(next);
        if (next.name || next.radius || next.point || !point) return;
        setSaving(true);
        setSaveError(null);
        const saved = await saveSite(companyId, {
            name: name.trim(), address_text: address.trim() || null, lat: point.lat, lng: point.lng, radius_m: radiusM,
        }, site?.id);
        setSaving(false);
        if (saved) onSaved(saved);
        else setSaveError('Não foi possível salvar o local. Só o Gestor pode cadastrar locais.');
    };

    return (
        <form noValidate onSubmit={submit} className="space-y-4">
            <Field label="Nome do local" required error={errors.name}>
                <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Loja do shopping" />
            </Field>
            <Field label="Endereço" hint="Aparece no cartaz do QR.">
                <input value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} />
            </Field>

            <div className="space-y-2">
                <p className="text-sm font-bold text-black">Ponto do local</p>
                <p className="text-xs text-gray-600">Faça isto de dentro do local. Usamos a posição deste aparelho como o ponto do local.</p>
                <Button variant="secondary" onClick={capture} loading={locating} iconLeft={<LocateFixed size={18} aria-hidden="true" />}>
                    {point ? 'Atualizar: estou aqui agora' : 'Estou aqui agora'}
                </Button>
                <p role="status" className="text-sm text-black">
                    {point && (point.accuracy != null
                        ? `Ponto capturado (precisão de cerca de ${Math.round(point.accuracy)} m).`
                        : 'Ponto já cadastrado.')}
                </p>
                {point && (
                    <a
                        href={`https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=19/${point.lat}/${point.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center text-sm font-bold underline"
                    >
                        Conferir no mapa
                    </a>
                )}
                {geoError && <Alert tone="warning" role="alert">{geoError}</Alert>}
                {errors.point && <p role="alert" className="text-xs font-bold text-red-600">{errors.point}</p>}
            </div>

            <Field label="Raio aceito (metros)" error={errors.radius} hint={`De ${MIN_RADIUS_M} a ${MAX_RADIUS_M}. O padrão é ${DEFAULT_RADIUS_M}.`}>
                <input type="number" inputMode="numeric" min={MIN_RADIUS_M} max={MAX_RADIUS_M} value={radius} onChange={(e) => setRadius(e.target.value)} />
            </Field>

            {saveError && <Alert tone="danger" role="alert">{saveError}</Alert>}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                {onCancel && <Button variant="secondary" onClick={onCancel} disabled={saving}>Voltar</Button>}
                <Button type="submit" variant="dark" loading={saving}>{site ? 'Salvar local' : 'Cadastrar local'}</Button>
            </div>
        </form>
    );
}
