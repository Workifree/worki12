/**
 * InviteAccept — página de aceite de convite de equipe via link (Slice 1, R1-b).
 *
 * Rota: /convite/:token  (worker-facing, sob ProtectedRoute)
 * Fluxo:
 *   1. Lê :token da URL.
 *   2. Chama TeamConnectionService.addToTeamByToken(token) (deriva workerId da sessão).
 *   3. Exibe loading / sucesso / erro no design neo-brutalista.
 *   4. Em sucesso, navega para /my-jobs (tela de equipes/convites do worker).
 *
 * TODO (v1.1): implementar redirect pós-login para retornar a esta URL quando o
 * worker ainda não está autenticado (ProtectedRoute redireciona para / que redireciona
 * para /login; o token é perdido). Sugestão: passar ?redirect=/convite/<token> ao login.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, Building2, ArrowRight } from 'lucide-react';
import { TeamConnectionService } from '../services/teamConnectionService';
import { logError } from '../lib/logger';
import PageMeta from '../components/PageMeta';

type PageState = 'loading' | 'success' | 'already_exists' | 'error';

interface PageData {
  state: PageState;
  errorMsg?: string;
}

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState<PageData>({ state: 'loading' });

  useEffect(() => {
    let active = true;

    async function processInvite() {
      if (!token) {
        if (active) setPage({ state: 'error', errorMsg: 'Link de convite inválido.' });
        return;
      }

      try {
        const result = await TeamConnectionService.addToTeamByToken(token);

        if (!active) return;

        if (result.error) {
          setPage({ state: 'error', errorMsg: result.error });
          return;
        }

        if (result.alreadyExists) {
          setPage({ state: 'already_exists' });
          return;
        }

        setPage({ state: 'success' });
      } catch (err) {
        logError('InviteAccept.processInvite', err);
        if (active) {
          setPage({ state: 'error', errorMsg: 'Ocorreu um erro inesperado. Tente novamente.' });
        }
      }
    }

    void processInvite();
    return () => { active = false; };
  }, [token]);

  return (
    <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
      <PageMeta
        title="Convite de Elenco"
        description="Aceite o convite para entrar no elenco de uma empresa no Worki."
      />

      <div className="w-full max-w-md">
        {/* Loading */}
        {page.state === 'loading' && (
          <div className="bg-white border-2 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-8 text-center">
            <div className="w-16 h-16 bg-primary-light border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Building2 size={32} className="text-primary" />
            </div>
            <h1 className="text-2xl font-black uppercase tracking-tighter mb-2">
              Convite de Elenco
            </h1>
            <div className="flex items-center justify-center gap-3 text-gray-500 mt-6">
              <Loader2 className="animate-spin text-primary" size={24} />
              <span className="font-bold">Processando convite...</span>
            </div>
            <div className="mt-6 space-y-3 animate-pulse">
              <div className="h-4 bg-gray-200 rounded-xl w-3/4 mx-auto" />
              <div className="h-4 bg-gray-200 rounded-xl w-1/2 mx-auto" />
            </div>
          </div>
        )}

        {/* Sucesso */}
        {page.state === 'success' && (
          <div className="bg-white border-2 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,166,81,1)] p-8 text-center">
            <div className="w-16 h-16 bg-primary border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 size={32} className="text-white" />
            </div>
            <h1 className="text-2xl font-black uppercase tracking-tighter mb-2">
              Convite Aceito!
            </h1>
            <p className="text-gray-600 font-bold mb-8">
              Você entrou para o elenco da empresa. Agora pode receber convites de turno diretamente.
            </p>
            <button
              onClick={() => navigate('/my-jobs')}
              className="w-full bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase transition-colors flex items-center justify-center gap-2"
            >
              Ver Meus Jobs
              <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* Já existe (idempotência) */}
        {page.state === 'already_exists' && (
          <div className="bg-white border-2 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,166,81,1)] p-8 text-center">
            <div className="w-16 h-16 bg-primary-light border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 size={32} className="text-primary" />
            </div>
            <h1 className="text-2xl font-black uppercase tracking-tighter mb-2">
              Você já está no elenco
            </h1>
            <p className="text-gray-600 font-bold mb-8">
              Você já tem uma conexão com esta empresa. Não é necessário aceitar novamente.
            </p>
            <button
              onClick={() => navigate('/my-jobs')}
              className="w-full bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase transition-colors flex items-center justify-center gap-2"
            >
              Ver Meus Jobs
              <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* Erro */}
        {page.state === 'error' && (
          <div className="bg-white border-2 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-8 text-center">
            <div className="w-16 h-16 bg-red-50 border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-6">
              <XCircle size={32} className="text-red-500" />
            </div>
            <h1 className="text-2xl font-black uppercase tracking-tighter mb-2">
              Link Inválido
            </h1>
            <p className="text-gray-600 font-bold mb-2">
              {page.errorMsg ?? 'Não foi possível processar este convite.'}
            </p>
            <p className="text-sm text-gray-400 font-medium mb-8">
              Peça à empresa um novo link de convite.
            </p>
            <button
              onClick={() => navigate('/my-jobs')}
              className="w-full bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase transition-colors flex items-center justify-center gap-2"
            >
              Ir para Meus Jobs
              <ArrowRight size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
