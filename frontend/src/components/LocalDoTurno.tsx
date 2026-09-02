import { MapPin } from 'lucide-react';

/**
 * Endereço do turno como link para o Google Maps (extraído de MyJobs para reuso).
 *
 * O endereço aparecia como texto morto no recibo, no card de recebimento e no
 * takeover de convite — justamente onde o freela decide "consigo chegar?".
 * Texto que aponta uma ação sem oferecê-la é custo de interação puro (NN/g):
 * copiar, trocar de app, colar. Placeholder ("Local a definir") continua texto puro.
 */
export default function LocalDoTurno({ location, size = 14 }: { location: string | null | undefined; size?: number }) {
    const texto = location || 'Local a definir';
    const real = !!location && !/local a (definir|combinar)/i.test(location);
    if (!real) {
        return <><MapPin size={size} /> {texto}</>;
    }
    return (
        <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 underline decoration-dotted underline-offset-2 hover:decoration-solid min-h-11 -my-2 py-2"
            aria-label={`Abrir ${texto} no mapa`}
        >
            <MapPin size={size} /> {texto}
        </a>
    );
}
