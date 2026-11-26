import { useCallback, useState } from 'react';
import type { BonusAdminAdapter } from './types';
import { edgeBonusAdminAdapter } from './bonusAdminAdapter';
import ReviewQueue from './ReviewQueue';
import PayoutList from './PayoutList';
import EnrollmentsPanel from './EnrollmentsPanel';
import VetosAndParams from './VetosAndParams';
import TrackingPanel from './TrackingPanel';

type Section = 'inscricoes' | 'fila' | 'pix' | 'regras' | 'acompanhamento';

const SECTIONS: { id: Section; label: string }[] = [
    { id: 'fila', label: 'Conferência' },
    { id: 'inscricoes', label: 'Inscrições' },
    { id: 'pix', label: 'PIX da segunda' },
    { id: 'regras', label: 'Vetos e limiares' },
    { id: 'acompanhamento', label: 'Acompanhamento' },
];

interface Props {
    adapter?: BonusAdminAdapter;
}

export default function BonusAdminPanel({ adapter = edgeBonusAdminAdapter }: Props) {
    const [section, setSection] = useState<Section>('fila');
    const [flushError, setFlushError] = useState('');
    const onFlushError = useCallback((m: string) => setFlushError(m), []);

    return (
        <div className="space-y-6">
            <nav aria-label="Trilha de bônus" className="flex flex-wrap gap-2">
                {SECTIONS.map((s) => (
                    <button key={s.id} type="button" aria-pressed={section === s.id} onClick={() => setSection(s.id)}
                        className={`px-4 py-3 rounded-xl text-sm font-black uppercase border-2 transition-colors ${
                            section === s.id ? 'bg-black text-white border-black' : 'bg-white text-black border-gray-300 hover:border-black'
                        }`}>
                        {s.label}
                    </button>
                ))}
            </nav>
            {flushError && (
                <div role="alert" className="bg-white border-2 border-black rounded-xl px-4 py-3 font-bold flex items-center justify-between gap-3">
                    <span>{flushError}</span>
                    <button type="button" onClick={() => setFlushError('')} className="px-4 py-2 rounded-xl border-2 border-black text-sm font-black uppercase">Fechar</button>
                </div>
            )}
            {section === 'fila' && <ReviewQueue adapter={adapter} onFlushError={onFlushError} />}
            {section === 'inscricoes' && <EnrollmentsPanel adapter={adapter} />}
            {section === 'pix' && <PayoutList adapter={adapter} />}
            {section === 'regras' && <VetosAndParams adapter={adapter} />}
            {section === 'acompanhamento' && <TrackingPanel adapter={adapter} />}
        </div>
    );
}
