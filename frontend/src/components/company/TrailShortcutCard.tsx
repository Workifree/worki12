import { Link } from 'react-router-dom';
import { ChevronRight, Trophy } from 'lucide-react';
import { useBonusTrailAccess } from '../../hooks/useBonusTrailAccess';

/** Atalho compacto da Trilha no Início — só com inscrição ativa. */
export default function TrailShortcutCard({ className = '' }: { className?: string }) {
    const hasTrail = useBonusTrailAccess();
    if (!hasTrail) return null;
    return (
        <Link
            to="/company/trilha"
            className={`flex min-h-11 items-center gap-3 rounded-2xl border-2 border-black bg-white px-4 py-3 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 ${className}`}
        >
            <Trophy size={20} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 flex-1 text-sm font-bold">Trilha de bônus</span>
            <ChevronRight size={18} aria-hidden="true" className="shrink-0" />
        </Link>
    );
}
