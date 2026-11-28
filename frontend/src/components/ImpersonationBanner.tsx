import { useState } from 'react';
import { ShieldAlert, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function ImpersonationBanner() {
  const email = sessionStorage.getItem('worki_impersonating_email');
  const name = sessionStorage.getItem('worki_impersonating_name');
  const [exiting, setExiting] = useState(false);

  if (!email) return null;

  const handleExit = async () => {
    setExiting(true);
    sessionStorage.removeItem('worki_impersonating_email');
    sessionStorage.removeItem('worki_impersonating_name');
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div
      role="status"
      className="sticky top-0 z-[100] flex flex-wrap items-center justify-between gap-2 border-b-2 border-black bg-red-600 px-4 py-2 text-xs font-bold text-white"
    >
      <div className="flex items-center gap-2">
        <ShieldAlert size={16} className="shrink-0" />
        <span>
          Modo Suporte SysAdmin — operando como <strong>{name || email}</strong> ({email})
        </span>
      </div>
      <button
        type="button"
        onClick={() => void handleExit()}
        disabled={exiting}
        className="inline-flex items-center gap-1.5 rounded-lg border-2 border-white bg-black px-3 py-1 text-xs font-bold text-white hover:bg-gray-900 disabled:opacity-50"
      >
        <LogOut size={13} />
        {exiting ? 'Saindo...' : 'Sair do modo suporte'}
      </button>
    </div>
  );
}
