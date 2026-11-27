import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { getMyCompanies, pickCurrentCompany, subscribeCompanyScope, switchCompanyUnit } from '../../services/companyScopeService';
import { logError } from '../../lib/logger';
import type { MyCompany } from '../../types';

/** Seletor de unidade para o celular (no desktop ele mora na lateral). Só aparece com 2+ unidades. */
export default function CompanySwitcher({ className = '' }: { className?: string }) {
    const [companies, setCompanies] = useState<MyCompany[]>([]);
    const [version, setVersion] = useState(0);

    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const list = await getMyCompanies();
                if (active) setCompanies(list);
            } catch (error) {
                logError('CompanySwitcher', error);
            }
        })();
        return () => { active = false; };
    }, [version]);

    useEffect(() => subscribeCompanyScope(() => setVersion((v) => v + 1)), []);

    if (companies.length < 2) return null;
    const current = pickCurrentCompany(companies)?.company_id ?? '';

    return (
        <div className={`relative ${className}`}>
            <label htmlFor="mobile-company-switch" className="sr-only">Trocar de empresa</label>
            <select
                id="mobile-company-switch"
                value={current}
                onChange={(e) => {
                    if (e.target.value === current) return;
                    switchCompanyUnit(e.target.value);
                    window.location.assign('/company/dashboard');
                }}
                className="h-11 w-full cursor-pointer appearance-none rounded-xl border-2 border-black bg-white pl-3 pr-9 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-black"
            >
                {companies.map((c) => (
                    <option key={c.company_id} value={c.company_id}>{c.company_name || 'Empresa sem nome'}</option>
                ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
        </div>
    );
}
