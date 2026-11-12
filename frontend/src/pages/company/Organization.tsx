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
import { Users, Briefcase, Mail, UserMinus, Send, Copy, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import { getMyCompanies } from '../../services/companyScopeService';
import { inviteManager, listCompanyManagers, revokeManager } from '../../services/organizationService';
import type { MyCompany, CompanyMember } from '../../types';
import PageMeta from '../../components/PageMeta';
import { Button, Card, PageHeader, FIELD_CONTROL_CLASS } from '../../components/ui';

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
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageMeta title="Organização" description="Unidades da sua organização no Worki." />

      <PageHeader
        title="Organização"
        subtitle="Visão das unidades da sua rede — turnos abertos, elenco e gerentes de cada loja."
      />

      {units.length === 0 && (
        <Card padding="lg" className="text-center text-sm text-gray-600">
          Nenhuma unidade encontrada.
        </Card>
      )}

      <div className="space-y-4">
        {units.map(({ company, openJobs, teamSize, managers }) => (
          <Card as="section" key={company.company_id}>
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {company.company_name || 'Unidade sem nome'}
                </h2>
                <span className="inline-block mt-1 px-3 py-1 rounded-pill bg-blue-50 text-blue-700 font-semibold text-xs">
                  {company.role === 'owner' ? 'Dono' : company.role === 'operator' ? 'Operador' : 'Gerente'}
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2 bg-gray-50 border-2 border-gray-200 rounded-xl px-4 py-2">
                  <Briefcase size={18} className="text-gray-500" />
                  <span className="font-bold tabular-nums text-gray-900">{openJobs ?? '—'}</span>
                  <span className="text-xs text-gray-600">Turnos abertos</span>
                </div>
                <div className="flex items-center gap-2 bg-gray-50 border-2 border-gray-200 rounded-xl px-4 py-2">
                  <Users size={18} className="text-gray-500" />
                  <span className="font-bold tabular-nums text-gray-900">{teamSize ?? '—'}</span>
                  <span className="text-xs text-gray-600">No elenco</span>
                </div>
              </div>
            </div>

            <div className="border-t-2 border-gray-200 pt-4">
              <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                <Mail size={16} /> Gerentes da unidade
              </h3>

              {managers.length === 0 && (
                <p className="text-sm text-gray-600 mb-4">Nenhum gerente convidado ainda.</p>
              )}

              <ul className="space-y-2 mb-4">
                {managers.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 border-2 border-gray-200 rounded-xl px-4 py-2"
                  >
                    <div>
                      <span className="font-bold text-gray-900 text-sm">{m.invited_email}</span>
                      <span
                        className={`ml-2 px-2 py-0.5 rounded-pill text-xs font-semibold ${
                          m.status === 'active' ? 'bg-primary-light text-primary' : 'bg-yellow-50 text-yellow-700'
                        }`}
                      >
                        {m.status === 'active' ? 'Ativo' : 'Convidado'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.status === 'invited' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyInviteLink(m.id, m.invite_token)}
                          aria-label={`Copiar link de convite de ${m.invited_email}`}
                          iconLeft={copiedToken === m.id ? <Check size={14} /> : <Copy size={14} />}
                        >
                          Copiar link
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(company.company_id, m.user_id)}
                        loading={revokingId === (m.user_id ?? company.company_id)}
                        aria-label={`Remover ${m.invited_email}`}
                        iconLeft={<UserMinus size={14} />}
                        className="text-red-600 enabled:hover:bg-red-50"
                      >
                        Remover
                      </Button>
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
                  className={`${FIELD_CONTROL_CLASS} flex-1`}
                />
                <Button
                  variant="dark"
                  onClick={() => handleInvite(company.company_id)}
                  loading={invitingFor === company.company_id}
                  iconLeft={<Send size={18} />}
                >
                  Convidar
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
