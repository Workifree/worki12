import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { COMPANY_GESTAO_PATH } from '../../lib/navigation';

/** "‹ Gestão": volta das sub-telas para o hub. */
export default function BackToGestao() {
    return (
        <Link
            to={COMPANY_GESTAO_PATH}
            className="-ml-2 mb-2 inline-flex min-h-11 min-w-11 items-center gap-1 rounded-xl px-2 text-sm font-bold text-gray-700 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black print:hidden"
        >
            <ChevronLeft size={18} aria-hidden="true" /> Gestão
        </Link>
    );
}
