import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { WORKER_PROFILE_LINK } from '../lib/navigation';

/** Perfil do freela no cabeçalho do celular, ao lado do sino (a barra inferior não o tem mais). */
export default function ProfileAvatarLink() {
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const { data } = await supabase.from('workers').select('avatar_url').eq('id', user.id).maybeSingle();
                if (active) setAvatarUrl(data?.avatar_url ?? null);
            } catch (error) {
                logError('ProfileAvatarLink.fetch', error);
            }
        })();
        return () => { active = false; };
    }, []);

    return (
        <NavLink
            to={WORKER_PROFILE_LINK.path}
            aria-label={WORKER_PROFILE_LINK.label}
            className="group flex h-11 w-11 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
        >
            {({ isActive }) => (
                <span
                    className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 bg-gray-100 ${
                        isActive ? 'border-primary ring-2 ring-primary' : 'border-black'
                    }`}
                >
                    {avatarUrl
                        ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                        : <User size={18} aria-hidden="true" />}
                </span>
            )}
        </NavLink>
    );
}
