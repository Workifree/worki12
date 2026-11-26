/**
 * Localização do aparelho: uma leitura por gesto, sem acompanhamento contínuo. A coordenada é
 * usada na chamada e descartada: nunca vai para log, storage ou analytics (LGPD).
 * A distância que vale é a calculada no servidor.
 */

export interface DevicePosition {
    lat: number;
    lng: number;
    accuracy: number;
    /** `Date.now()` da leitura, para não reaproveitar posição velha. */
    takenAt: number;
}

export type GeoFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export type GeoResult = { ok: true; position: DevicePosition } | { ok: false; failure: GeoFailure };

export const GEO_FAILURE_MESSAGES: Record<GeoFailure, string> = {
    denied: 'A localização está bloqueada para este site. Libere nas permissões do navegador ou peça a confirmação ao responsável.',
    unavailable: 'O aparelho não conseguiu achar sua localização. Ligue o GPS e vá para perto de uma janela ou área aberta.',
    timeout: 'A localização demorou demais. Vá para perto de uma janela ou área aberta e tente de novo.',
    unsupported: 'Este navegador não informa a localização.',
};

export function getDevicePosition(): Promise<GeoResult> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
        return Promise.resolve({ ok: false, failure: 'unsupported' });
    }
    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => resolve({
                ok: true,
                position: { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, takenAt: Date.now() },
            }),
            // 1 = PERMISSION_DENIED, 3 = TIMEOUT
            (error) => resolve({
                ok: false,
                failure: error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable',
            }),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        );
    });
}
