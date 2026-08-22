/**
 * Organization — visão mínima de unidades (F13, R16).
 *
 * Rota: `/company/organization` — só acessível a sócio/operador (`organization_members` ativo,
 * `role IN ('owner','operator')`); o gate mora em `ProtectedRoute` (mesma técnica do bloqueio
 * worker⇎company), NÃO nesta página. Se a página renderizar sem gate, o pior caso é uma tela
 * vazia (as queries de contagem também dependem de `is_company_owner`, que já nega gerente
 * comum fora da própria unidade).
 *
 * Escopo desta página (ver ddl-aprovado.md §7 e spec R16):
 * - Lista as unidades da organização com nome, contagem de turnos abertos e do elenco —
 *   `jobs`/`team_connections` count por `company_id`, via `get_my_companies()` (R12) + queries
 *   já existentes escopadas por `company_id`, SEM RPC de agregação nova.
 * - Gestão de gerentes por unidade (R8/R10, R14/R15): convidar por e-mail, ver convites
 *   pendentes/ativos, revogar. Não existe RPC de listagem — `company_members` já tem policy de
 *   SELECT que deixa sócio/operador ler todas as linhas das unidades da própria organização
 *   (`cm_select_self_or_operator`, migration 20260818100000).
 * - NÃO é BI/analytics consolidado (gastos, faltas, comparação) — isso é da spec
 *   `analytics-operacao`, que consome `get_my_companies()` por conta própria.
 */

import { useCallback, useEffect, useState } from 'react';
import { Network, Users, Briefcase, Mail, UserMinus, Loader2, Send, Copy, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import { getMyCompanies } from '../../services/companyScopeService';
import { inviteManager, listCompanyManagers, revokeManager } from '../../services/organizationService';
import type { MyCompany, CompanyMember } from '../../types';
import PageMeta from '../../components/PageMeta';

interface UnitSummary {
  company: MyCompany;
  openJobs: number | null;
  teamSize: number | null;
  managers: CompanyMember[];
}

async function countRows(table: string, companyId: string, extraEq?: [string, string]): Promise<number | null> {
  let query = supabase.from(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  if (extraEq) query = query.eq(extraEq[0], extraEq[1]);
  const { count, error } = await query;
  if (error) {
    logError('Organization.countRows', error);
    return null;
  }
  return count ?? 0;
}

export default function Organization() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<UnitSummary[]>([]);
  const [inviteEmail, setInviteEmail] = useState<Record<string, string>>({});
  const [invitingFor, setInvitingFor] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const loadUnits = useCallback(async () => {
    setLoading(true);
    try {
      const companies = await getMyCompanies();
      const summaries = await Promise.all(
        companies.map(async (company): Promise<UnitSummary> => {
          const [openJobs, teamSize, managers] = await Promise.all([
            countRows('jobs', company.company_id, ['status', 'open']),
            countRows('team_connections', company.company_id, ['status', 'accepted']),
            listCompanyManagers(company.company_id),
          ]);
          return { company, openJobs, teamSize, managers };
        }),
      );
      setUnits(summaries);
    } catch (error) {
      logError('Organization.loadUnits', error);
      addToast('Erro ao carregar as unidades da organização.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadUnits();
  }, [loadUnits]);

  const handleInvite = async (companyId: string) => {
    const email = (inviteEmail[companyId] || '').trim();
    if (!email) {
      addToast('Informe o e-mail do gerente.', 'error');
      return;
    }
    setInvitingFor(companyId);
    try {
      const result = await inviteManager(companyId, email);
      if (result.outcome === 'invited' || result.outcome === 'already_invited') {
        addToast(
          result.outcome === 'invited' ? 'Convite enviado.' : 'Já existia um convite pendente para este e-mail.',
          'success',
        );
        setInviteEmail((prev) => ({ ...prev, [companyId]: '' }));
        await loadUnits();
      } else if (result.outcome === 'forbidden') {
        addToast('Só sócio/operador pode convidar gerente.', 'error');
      } else if (result.outcome === 'not_found') {
        addToast('Unidade não encontrada.', 'error');
      } else {
        addToast(result.error || 'Não foi possível enviar o convite.', 'error');
      }
    } finally {
      setInvitingFor(null);
    }
  };

  const handleRevoke = async (companyId: string, userId: string | null) => {
    setRevokingId(userId ?? companyId);
    try {
      const result = await revokeManager(companyId, userId);
      if (result.outcome === 'revoked') {
        addToast('Gerente removido da unidade.', 'success');
        await loadUnits();
      } else if (result.outcome === 'forbidden') {
        addToast('Só sócio/operador pode remover gerente.', 'error');
      } else {
        addToast('Não foi possível remover o gerente.', 'error');
      }
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopyInviteLink = async (memberId: string, token: string | null) => {
    if (!token) {
      addToast('Este convite não tem mais um link válido.', 'error');
      return;
    }
    const url = `${window.location.origin}/convite-gerente/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(memberId);
      addToast('Link de convite copiado.', 'success');
      setTimeout(() => setCopiedToken(null), 2500);
    } catch {
      addToast('Não foi possível copiar o link.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 animate-pulse space-y-6">
        <div className="h-10 bg-gray-200 rounded-xl w-1/3" />
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-40 bg-gray-200 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageMeta title="Organização" description="Unidades da sua organização no Worki." />

      <div className="mb-8">
        <h1 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-3 text-gray-900">
          <Network className="w-8 h-8" />
          Organização
        </h1>
        <p className="text-gray-500 font-medium mt-2">
          Visão das unidades da sua rede — turnos abertos, elenco e gerentes de cada loja.
        </p>
      </div>

      {units.length === 0 && (
        <div className="bg-white border-2 border-black rounded-2xl p-8 text-center text-gray-500 font-bold">
          Nenhuma unidade encontrada.
        </div>
      )}

      <div className="space-y-6">
        {units.map(({ company, openJobs, teamSize, managers }) => (
          <div
            key={company.company_id}
            className="bg-white border-2 border-black rounded-2xl p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight text-gray-900">
                  {company.company_name || 'Unidade sem nome'}
                </h2>
                <span className="inline-block mt-1 px-3 py-1 rounded-pill bg-blue-50 text-blue-700 font-black uppercase text-[10px]">
                  {company.role === 'owner' ? 'Dono' : company.role === 'operator' ? 'Operador' : 'Gerente'}
                </span>
              </div>
              <div className="flex gap-4">
                <div className="flex items-center gap-2 bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-2">
                  <Briefcase size={18} className="text-gray-400" />
                  <span className="font-black text-gray-900">{openJobs ?? '—'}</span>
                  <span className="text-xs font-bold text-gray-500 uppercase">Turnos abertos</span>
                </div>
                <div className="flex items-center gap-2 bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-2">
                  <Users size={18} className="text-gray-400" />
                  <span className="font-black text-gray-900">{teamSize ?? '—'}</span>
                  <span className="text-xs font-bold text-gray-500 uppercase">No elenco</span>
                </div>
              </div>
            </div>

            <div className="border-t-2 border-gray-100 pt-4">
              <h3 className="text-sm font-black uppercase text-gray-700 mb-3 flex items-center gap-2">
                <Mail size={16} /> Gerentes da unidade
              </h3>

              {managers.length === 0 && (
                <p className="text-sm text-gray-400 font-medium mb-4">Nenhum gerente convidado ainda.</p>
              )}

              <ul className="space-y-2 mb-4">
                {managers.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-2.5"
                  >
                    <div>
                      <span className="font-bold text-gray-900 text-sm">{m.invited_email}</span>
                      <span
                        className={`ml-2 px-2 py-0.5 rounded-pill text-[10px] font-black uppercase ${
                          m.status === 'active' ? 'bg-primary-light text-primary' : 'bg-yellow-50 text-yellow-700'
                        }`}
                      >
                        {m.status === 'active' ? 'Ativo' : 'Convidado'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.status === 'invited' && (
                        <button
                          type="button"
                          onClick={() => handleCopyInviteLink(m.id, m.invite_token)}
                          aria-label={`Copiar link de convite de ${m.invited_email}`}
                          className="flex items-center gap-1 text-xs font-black uppercase text-gray-500 hover:text-black transition-colors"
                        >
                          {copiedToken === m.id ? <Check size={14} /> : <Copy size={14} />}
                          Copiar link
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRevoke(company.company_id, m.user_id)}
                        disabled={revokingId === (m.user_id ?? company.company_id)}
                        aria-label={`Remover ${m.invited_email}`}
                        className="flex items-center gap-1 text-xs font-black uppercase text-red-600 hover:text-red-800 transition-colors disabled:opacity-50"
                      >
                        {revokingId === (m.user_id ?? company.company_id) ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <UserMinus size={14} />
                        )}
                        Remover
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex flex-col sm:flex-row gap-2">
                <label htmlFor={`invite-email-${company.company_id}`} className="sr-only">
                  E-mail do gerente
                </label>
                <input
                  id={`invite-email-${company.company_id}`}
                  type="email"
                  value={inviteEmail[company.company_id] || ''}
                  onChange={(e) => setInviteEmail((prev) => ({ ...prev, [company.company_id]: e.target.value }))}
                  placeholder="email@gerente.com"
                  className="flex-1 border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary outline-none font-medium"
                />
                <button
                  type="button"
                  onClick={() => handleInvite(company.company_id)}
                  disabled={invitingFor === company.company_id}
                  className="bg-black hover:bg-blue-600 text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {invitingFor === company.company_id ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Send size={18} />
                  )}
                  Convidar
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
