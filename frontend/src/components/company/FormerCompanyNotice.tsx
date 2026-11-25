import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { getMyCompanies, pickCurrentCompany, subscribeCompanyScope } from '../../services/companyScopeService';
import { forgetMemberships, syncMemberships, type RememberedMembership } from '../../lib/formerMembership';
import { Alert, Button } from '../ui';

/**
 * Quem foi tirado da equipe de outra empresa e tem a própria cai nela sem perceber: este aviso
 * conta o que mudou. Só usa o que este aparelho já tinha visto; não concede nem nega nada.
 */
export default function FormerCompanyNotice() {
    const [notice, setNotice] = useState<{ userId: string; ended: RememberedMembership[] } | null>(null);
    const [version, setVersion] = useState(0);

    useEffect(() => subscribeCompanyScope(() => setVersion((v) => v + 1)), []);

    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const { data } = await supabase.auth.getSession();
                const userId = data.session?.user.id;
                if (!userId) return;
                const companies = await getMyCompanies();
                if (!active || companies.length === 0) return;
                const ended = syncMemberships(userId, companies);
                const current = pickCurrentCompany(companies);
                const inOwn = current?.role === 'owner' && current.onboarding_completed;
                setNotice(inOwn && ended.length > 0 ? { userId, ended } : null);
            } catch (error) {
                logError('FormerCompanyNotice', error);
            }
        })();
        return () => { active = false; };
    }, [version]);

    if (!notice) return null;

    return (
        <div className="mb-4 space-y-2">
            {notice.ended.map((company) => (
                <Alert
                    key={company.id}
                    tone="warning"
                    role="status"
                    action={
                        <Button
                            variant="secondary"
                            onClick={() => {
                                forgetMemberships(notice.userId, [company.id]);
                                const ended = notice.ended.filter((c) => c.id !== company.id);
                                setNotice(ended.length ? { ...notice, ended } : null);
                            }}
                        >
                            Entendi
                        </Button>
                    }
                >
                    Seu acesso {company.name ? `à empresa ${company.name}` : 'a uma empresa'} foi encerrado; você está agora na sua empresa.
                </Alert>
            ))}
        </div>
    );
}
