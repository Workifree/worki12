import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Privacy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 mb-6 hover:text-gray-900">
          <ArrowLeft size={20} /> Voltar
        </button>
        <h1 className="text-3xl font-bold mb-6">Política de Privacidade</h1>
        <div className="bg-white rounded-xl border-2 border-black p-8 space-y-4 text-sm leading-relaxed">
          <p className="text-gray-600">Última atualização: Agosto de 2026</p>

          <p>Esta Política de Privacidade descreve como a Worki ("nós", "nossa Plataforma") coleta, utiliza, compartilha e protege seus dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (LGPD - Lei 13.709/2018).</p>

          <h2 className="text-xl font-bold mt-6">1. Dados Coletados</h2>
          <p>Coletamos os seguintes dados pessoais:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Dados de cadastro:</strong> nome completo, e-mail, telefone, CPF (Workers) e data de nascimento (Workers)</li>
            <li><strong>Dados profissionais (Workers):</strong> habilidades, especialidades, experiência, foto, cidade/localização</li>
            <li><strong>Dados empresariais (Contratantes):</strong> razão social, CNPJ ou CPF, setor de atuação</li>
            <li><strong>Dados de pagamento (Workers):</strong> chave PIX cadastrada pelo Worker, usada para viabilizar o pagamento direto feito pela Contratante (a Worki não processa nem custodia esse pagamento — veja a Seção 2)</li>
            <li><strong>Histórico de turnos e pagamentos declarados:</strong> vagas, candidaturas, convites, registros de pagamento (valor, forma e data informados pela Contratante) e confirmações de recebimento pelo Worker</li>
            <li><strong>Dados de uso:</strong> páginas acessadas, ações realizadas, data/hora de acesso, dispositivo e navegador</li>
          </ul>

          <h2 className="text-xl font-bold mt-6">2. Finalidade do Tratamento</h2>
          <p>Utilizamos seus dados para:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Criação e gerenciamento de conta</li>
            <li>Autenticação e segurança de acesso</li>
            <li>Conexão entre Contratantes e Workers (exibição de perfis, elenco/convites e candidaturas)</li>
            <li>Exibição da chave PIX do Worker para a Contratante com quem ele tem vínculo ativo (elenco ou turno), para viabilizar o pagamento direto entre as partes — neste piloto, o pagamento em si é combinado e realizado diretamente entre Contratante e Worker, fora da Plataforma</li>
            <li>Registro de pagamentos declarados pela Contratante e emissão do recibo/comprovante entre as partes</li>
            <li>Para quem optar por usar a carteira digital opcional da Plataforma: processamento de depósitos, saques e saldo via parceiro de pagamentos (Asaas)</li>
            <li>Comunicação de atualizações, notificações e suporte</li>
            <li>Melhoria da Plataforma e análise de uso agregado</li>
            <li>Cumprimento de obrigações legais e regulatórias</li>
          </ul>

          <h2 className="text-xl font-bold mt-6">3. Base Legal (LGPD Art. 7)</h2>
          <p>O tratamento de dados é fundamentado nas seguintes bases legais:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Execução de contrato:</strong> para prestação dos serviços da Plataforma</li>
            <li><strong>Consentimento:</strong> para comunicações de marketing e cookies não essenciais</li>
            <li><strong>Cumprimento de obrigação legal:</strong> para obrigações fiscais e regulatórias</li>
            <li><strong>Interesse legítimo:</strong> para prevenção de fraudes e melhoria da Plataforma</li>
          </ul>

          <h2 className="text-xl font-bold mt-6">4. Compartilhamento de Dados</h2>
          <p>Compartilhamos seus dados apenas com:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Contratante com vínculo ativo:</strong> a chave PIX e demais dados de contato do Worker ficam visíveis apenas para a Contratante com quem ele tem um vínculo ativo (elenco pendente/aceito ou candidatura/convite de turno) — nunca para qualquer conta na Plataforma</li>
            <li><strong>Asaas:</strong> processamento de depósitos, saques e movimentações na carteira digital opcional da Plataforma, apenas para usuários que utilizarem esse recurso (dados necessários à transação). No fluxo padrão deste piloto, o pagamento é combinado diretamente entre Contratante e Worker e não passa pela Worki nem pela Asaas</li>
            <li><strong>Supabase:</strong> infraestrutura de banco de dados e autenticação (dados criptografados)</li>
            <li><strong>Resend:</strong> envio de e-mails transacionais (apenas e-mail e nome)</li>
            <li><strong>Sentry:</strong> monitoramento de erros (dados anonimizados, sem dados pessoais)</li>
            <li><strong>Autoridades competentes:</strong> quando exigido por lei ou ordem judicial</li>
          </ul>
          <p>Não vendemos, alugamos ou compartilhamos seus dados com terceiros para fins de marketing.</p>

          <h2 className="text-xl font-bold mt-6">5. Retenção de Dados</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Dados de conta:</strong> mantidos enquanto a conta estiver ativa. Após exclusão, removidos em até 30 dias.</li>
            <li><strong>Dados financeiros e registros de pagamento:</strong> mantidos por 5 anos após o último registro, conforme legislação fiscal brasileira.</li>
            <li><strong>Dados de uso/logs:</strong> mantidos por até 6 meses para fins de segurança e melhoria.</li>
            <li><strong>Dados de disputa:</strong> mantidos por 2 anos após a resolução.</li>
          </ul>

          <h2 className="text-xl font-bold mt-6">6. Segurança</h2>
          <p>Adotamos as seguintes medidas de segurança:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Criptografia em trânsito (HTTPS/TLS) e em repouso</li>
            <li>Políticas de acesso por linha (RLS) no banco de dados - cada usuário acessa apenas seus próprios dados, e dados sensíveis como CPF e chave PIX do Worker só ficam visíveis para a Contratante com vínculo ativo</li>
            <li>Autenticação segura com tokens JWT e refresh tokens</li>
            <li>Rate limiting nas APIs críticas para prevenir abusos</li>
            <li>Monitoramento contínuo de erros e acessos suspeitos</li>
          </ul>

          <h2 className="text-xl font-bold mt-6">7. Seus Direitos (LGPD Art. 18)</h2>
          <p>Como titular dos dados, você tem direito a:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Confirmação e acesso:</strong> saber se tratamos seus dados e acessar uma cópia</li>
            <li><strong>Correção:</strong> solicitar a correção de dados incompletos, inexatos ou desatualizados</li>
            <li><strong>Anonimização ou eliminação:</strong> solicitar anonimização ou exclusão de dados desnecessários</li>
            <li><strong>Portabilidade:</strong> solicitar a transferência de seus dados para outro fornecedor</li>
            <li><strong>Revogação de consentimento:</strong> revogar consentimento a qualquer momento</li>
            <li><strong>Informação sobre compartilhamento:</strong> saber com quais entidades seus dados são compartilhados</li>
            <li><strong>Oposição:</strong> opor-se ao tratamento quando não baseado em consentimento</li>
          </ul>
          <p className="mt-2">Para exercer seus direitos, envie um e-mail para <a href="mailto:privacidade@worki.com.br" className="text-green-600 font-bold">privacidade@worki.com.br</a> com o assunto "Direitos LGPD". Responderemos em até 15 dias úteis.</p>

          <h2 className="text-xl font-bold mt-6">8. Cookies</h2>
          <p>Utilizamos apenas cookies essenciais para autenticação e funcionamento da Plataforma (tokens de sessão). Não utilizamos cookies de rastreamento, publicidade ou analíticos de terceiros.</p>

          <h2 className="text-xl font-bold mt-6">9. Transferência Internacional</h2>
          <p>Seus dados podem ser processados em servidores localizados fora do Brasil (infraestrutura em nuvem). Nestes casos, garantimos que os provedores adotam níveis adequados de proteção de dados conforme a LGPD.</p>

          <h2 className="text-xl font-bold mt-6">10. Alterações nesta Política</h2>
          <p>Podemos atualizar esta Política periodicamente. Alterações significativas serão comunicadas por e-mail ou pela Plataforma. O uso continuado após as alterações constitui aceitação da nova Política.</p>

          <h2 className="text-xl font-bold mt-6">11. Contato e Encarregado (DPO)</h2>
          <p>Para questões de privacidade e proteção de dados:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>E-mail:</strong> <a href="mailto:privacidade@worki.com.br" className="text-green-600 font-bold">privacidade@worki.com.br</a></li>
            <li><strong>E-mail geral:</strong> <a href="mailto:contato@worki.com.br" className="text-green-600 font-bold">contato@worki.com.br</a></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
