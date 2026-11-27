import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import HomeRedirect from './components/HomeRedirect';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider, ToastRouteDismiss } from './contexts/ToastContext';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import PwaPrompts from './components/PwaPrompts';
import RouteFocus from './components/RouteFocus';
import PageMeta from './components/PageMeta';
import { GuideProvider } from './components/guide/GuideProvider';
import CopilotRoot from './components/copilot/CopilotRoot';
import { guia } from './lib/guide/api';
import { isLoteEnabled, isPresencaEnabled } from './lib/features';

import { Suspense, lazy } from 'react';
import type { ReactNode } from 'react';

// Lazy Load Layouts
const MainLayout = lazy(() => import('./layouts/MainLayout'));
const CompanyLayout = lazy(() => import('./layouts/CompanyLayout'));

// Lazy Load Pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Login = lazy(() => import('./pages/Login'));
const CompanyOnboarding = lazy(() => import('./pages/company/CompanyOnboarding'));
const WorkerOnboarding = lazy(() => import('./pages/worker/WorkerOnboarding'));
const CompanyDashboard = lazy(() => import('./pages/company/CompanyDashboard'));
const Messages = lazy(() => import('./pages/Messages'));
const Profile = lazy(() => import('./pages/Profile'));
const MyJobs = lazy(() => import('./pages/MyJobs'));
const CarteiraClientes = lazy(() => import('./pages/CarteiraClientes'));
const MeusRecebimentos = lazy(() => import('./pages/MeusRecebimentos'));
const CompanyPublicProfile = lazy(() => import('./pages/CompanyPublicProfile'));
const QuemTeIndicou = lazy(() => import('./pages/QuemTeIndicou'));

// Company Pages
const CompanyCreateJob = lazy(() => import('./pages/company/CompanyCreateJob'));
const CompanyCreateBatch = lazy(() => import('./pages/company/CompanyCreateBatch'));
const CompanySites = lazy(() => import('./pages/company/CompanySites'));
const CompanySiteQr = lazy(() => import('./pages/company/CompanySiteQr'));
const CompanyShiftQr = lazy(() => import('./pages/company/CompanyShiftQr'));
const CompanyJobs = lazy(() => import('./pages/company/CompanyJobs'));
const CompanyProfile = lazy(() => import('./pages/company/CompanyProfile'));
const CompanyJobDetails = lazy(() => import('./pages/company/CompanyJobDetails'));
const CompanyJobCandidates = lazy(() => import('./pages/company/CompanyJobCandidates'));
const CompanyMessages = lazy(() => import('./pages/company/CompanyMessages'));
const CompanyTeam = lazy(() => import('./pages/company/CompanyTeam'));
const CompanyOrdersReport = lazy(() => import('./pages/company/CompanyOrdersReport'));
const CompanyOperationAnalytics = lazy(() => import('./pages/company/CompanyOperationAnalytics'));
const WorkerPublicProfile = lazy(() => import('./pages/company/WorkerPublicProfile'));
const CompanyReferrals = lazy(() => import('./pages/company/CompanyReferrals'));
const CompanyTeamMembers = lazy(() => import('./pages/company/CompanyTeamMembers'));
const CompanyToday = lazy(() => import('./pages/company/CompanyToday'));
const BonusTrail = lazy(() => import('./pages/company/BonusTrail'));
const CompanyGestao = lazy(() => import('./pages/company/CompanyGestao'));
const AcceptTeamInvite = lazy(() => import('./pages/AcceptTeamInvite'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Terms = lazy(() => import('./pages/Terms'));
const Privacy = lazy(() => import('./pages/Privacy'));
const BonusRules = lazy(() => import('./pages/BonusRules'));
const Licenses = lazy(() => import('./pages/Licenses'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Admin = lazy(() => import('./pages/Admin'));
const Help = lazy(() => import('./pages/Help'));
const Notifications = lazy(() => import('./pages/Notifications'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const InviteAccept = lazy(() => import('./pages/InviteAccept'));
const ReceiptView = lazy(() => import('./pages/ReceiptView'));

// Loading Component - Skeleton placeholder
const PageLoader = () => (
  <div className="h-screen w-full bg-canvas animate-pulse" role="status">
    <span className="sr-only">Carregando</span>
    <div className="flex flex-col md:flex-row max-w-7xl mx-auto min-h-screen">
      <div className="hidden md:block w-64 p-6 space-y-4">
        <div className="h-8 w-24 bg-gray-200 rounded-lg" />
        <div className="space-y-3 mt-8">
          {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded-xl" />)}
        </div>
      </div>
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div className="h-10 w-48 bg-gray-200 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
        </div>
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
        </div>
      </main>
    </div>
  </div>
);

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
      refetchOnWindowFocus: false,
    },
  },
});

/** Título da aba para as telas que não declaram o próprio <PageMeta>. */
const titled = (title: string, page: ReactNode) => (
  <>
    <PageMeta title={title} />
    {page}
  </>
);

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NotificationProvider>
          <ToastProvider>
            <BrowserRouter>
              <GuideProvider>
              <PwaPrompts />
              <CopilotRoot mobileLauncher={false} onOpenGuide={() => { guia.abrirAjuda(); }} />
              <RouteFocus />
              <ToastRouteDismiss />
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  {/* Public Routes */}
                  <Route path="/" element={<HomeRedirect />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/termos" element={titled('Termos de Uso', <Terms />)} />
                  <Route path="/privacidade" element={titled('Política de Privacidade', <Privacy />)} />
                  <Route path="/licencas" element={titled('Licenças de código aberto', <Licenses />)} />
                  <Route path="/regulamento-trilha" element={titled('Regulamento da trilha', <BonusRules />)} />
                  <Route path="/esqueci-senha" element={titled('Recuperar senha', <ForgotPassword />)} />
                  <Route path="/redefinir-senha" element={titled('Nova senha', <ResetPassword />)} />
                  <Route path="/ajuda" element={titled('Ajuda', <Help />)} />
                  <Route path="/sobre" element={<LandingPage />} />

                  {/*
                    Convite de equipe via link — rota PÚBLICA (fora do ProtectedRoute).
                    Motivo (bug crítico do GTM, item 11): quando a empresa manda o link, o freela
                    normalmente AINDA NÃO tem conta. Se a rota ficasse sob ProtectedRoute, o guard
                    redirecionava para /login antes de o InviteAccept montar e o token se perdia.
                    Agora InviteAccept lida com sessão ausente internamente: guarda o token e manda
                    para /login?redirect=/convite/<token>; o Login volta pra cá após autenticar.
                  */}
                  <Route path="/convite/:token" element={<InviteAccept />} />

                  {/* Convite de gerente de unidade: unidades saíram da experiência (dono, 11/2026). */}
                  <Route path="/convite-gerente/:token" element={<Navigate to="/" replace />} />

                  {/*
                    Convite de EQUIPE (Encarregado) — rota PÚBLICA pelo mesmo motivo: o convidado ainda
                    não tem sessão (entra por código de e-mail, sem senha, dentro da própria página).
                  */}
                  <Route path="/convite-equipe/:token" element={<AcceptTeamInvite />} />

                  {/* Protected Routes */}
                  <Route element={<ProtectedRoute />}>

                    {/* Admin Route - protected, Admin.tsx checks email authorization */}
                    <Route path="/admin" element={titled('Administração', <Admin />)} />

                    {/* Onboarding Routes - still protected as they need user session but not full layout yet if incomplete */}
                    <Route path="/company/onboarding" element={<CompanyOnboarding />} />
                    <Route path="/worker/onboarding" element={<WorkerOnboarding />} />

                    {/* Recibo de pagamento (modo A) — cross-papel (empresa e freela), fora dos layouts para impressão limpa */}
                    <Route path="/recibo/:jobId" element={<ReceiptView />} />

                    {/* Worker Layout Routes */}
                    <Route path="/" element={<MainLayout />}>
                      <Route path="dashboard" element={<Dashboard />} />
                      <Route path="my-jobs" element={<MyJobs />} />
                      <Route path="carteira" element={<CarteiraClientes />} />
                      <Route path="recebimentos" element={<MeusRecebimentos />} />
                      <Route path="empresa/:id" element={<CompanyPublicProfile />} />
                      <Route path="indicacoes" element={titled('Quem te indicou', <QuemTeIndicou />)} />
                      <Route path="profile" element={titled('Meu perfil', <Profile />)} />
                      <Route path="messages" element={titled('Mensagens', <Messages />)} />
                      <Route path="notifications" element={titled('Notificações', <Notifications />)} />
                    </Route>

                    {/* Company Layout Routes */}
                    <Route path="/company" element={<CompanyLayout />}>
                      <Route path="dashboard" element={<CompanyDashboard />} />
                      <Route path="create" element={titled('Criar turno', isLoteEnabled() ? <CompanyCreateBatch /> : <CompanyCreateJob />)} />
                      {isPresencaEnabled() && (
                        <>
                          <Route path="locais" element={titled('Locais', <CompanySites />)} />
                          <Route path="locais/:id/qr" element={titled('Cartaz do QR', <CompanySiteQr />)} />
                          <Route path="jobs/:id/qr" element={titled('QR do turno', <CompanyShiftQr />)} />
                        </>
                      )}
                      <Route path="jobs" element={<CompanyJobs />} />
                      <Route path="jobs/:id" element={<CompanyJobDetails />} />
                      <Route path="jobs/:id/edit" element={titled('Editar turno', <CompanyCreateJob />)} />
                      <Route path="jobs/:id/candidates" element={titled('Presença e pagamento', <CompanyJobCandidates />)} />
                      <Route path="worker/:id" element={<WorkerPublicProfile />} />
                      {/* DS11 (badges-empresas/ddl-aprovado.md §2.1): rota-espelho de /empresa/:id
                          para o mesmo CompanyPublicProfile, sob CompanyLayout. mode='view' do
                          CompanyBadges navega para cá — nunca para /empresa/:id (worker-only). */}
                      <Route path="empresa/:id" element={<CompanyPublicProfile />} />
                      <Route path="gestao" element={<CompanyGestao />} />
                      <Route path="profile" element={titled('Dados da empresa', <CompanyProfile />)} />
                      <Route path="messages" element={titled('Mensagens', <CompanyMessages />)} />
                      <Route path="team" element={titled('Meu Elenco', <CompanyTeam />)} />
                      <Route path="indicacoes" element={titled('Indicações', <CompanyReferrals />)} />
                      <Route path="configuracoes/equipe" element={<CompanyTeamMembers />} />
                      {/* Hoje (E5/R25): turnos de hoje e dos próximos dias por responsável. As
                          notificações de passar/cobrir apontam para cá. */}
                      <Route path="hoje" element={<CompanyToday />} />
                      <Route path="trilha" element={<BonusTrail />} />
                      <Route path="relatorio" element={<CompanyOrdersReport />} />
                      <Route path="operacao" element={<CompanyOperationAnalytics />} />
                      <Route path="notifications" element={titled('Notificações', <Notifications />)} />
                    </Route>

                  </Route>
                  <Route path="*" element={titled('Página não encontrada', <NotFound />)} />
                </Routes>
              </Suspense>
              </GuideProvider>
            </BrowserRouter>
          </ToastProvider>
        </NotificationProvider>
      </AuthProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
