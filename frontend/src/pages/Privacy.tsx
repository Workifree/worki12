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
          <p className="text-gray-600">Última atualização: 16 de agosto de 2026</p>

          <p>Esta Política de Privacidade descreve como a Worki ("nós", "nossa Plataforma") coleta, utiliza, compartilha e protege seus dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (LGPD - Lei 13.709/2018).</p>

          <h2 className="text-xl font-bold mt-6">1. Dados Coletados</h2>
          <p>Coletamos os seguintes dados pessoais:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Dados de cadastro:</strong> nome completo, e-mail, telefone, CPF (Workers) e data de nascimento (Workers)</li>
            <li><strong>Dados profissionais (Workers):</strong> habilidades, especialidades, experiência, foto, cidade/localização</li>
            <li><strong>Dados empresariais (Contratantes):</strong> razão social, CNPJ ou CPF, setor de atuação</li>
            <li><strong>Dados de pagamento (Workers):</strong> chave PIX e telefone cadastrados pelo Worker, usados para viabilizar o pagamento direto feito pela Contratante (a Worki não processa nem custodia esse pagamento — veja a Seção 2)</li>
            <li><strong>Histórico de turnos e pagamentos declarados:</strong> vagas, candidaturas, convites, registros de pagamento (valor, forma e data informados pela Contratante) e confirmações de recebimento pelo Worker</li>
            <li><strong>Disponibilidade declarada (Workers):</strong> os dias da semana e períodos (manhã, tarde, noite) em que o Worker informa estar disponível para trabalhar. É uma informação opcional, preenchida por ele, visível às Contratantes com quem ele tem vínculo, e serve para evitar convites em dias que ele já indicou não atender. O Worker pode alterá-la ou removê-la a qualquer momento no perfil.</li>
            <li><strong>Certificações e treinamentos (Workers):</strong> título, instituição emissora, número de registro em conselho e data de validade das certificações que o Worker declara; e o registro de treinamentos internos que uma Contratante informa ter ministrado a ele. <strong>Não coletamos nem armazenamos o arquivo do certificado</strong> — apenas os dados acima, digitados. E <strong>não coletamos documento de saúde de nenhum tipo</strong>: atestado, ASO, exame, carteira de vacinação ou laudo não devem ser informados nesses campos e não são tratados pela Plataforma.</li>
            <li><strong>Termo de prestação de serviço:</strong> quando o Worker aceita eletronicamente o termo referente a um turno, o documento é <strong>congelado</strong> com o nome e o CPF dele, o nome e o CNPJ da Contratante, a data e o valor combinados. Ele é retido como prova da transação encerrada entre as partes — veja a Seção 5.</li>
            <li><strong>Dados de uso:</strong> páginas acessadas, ações realizadas, data/hora de acesso, dispositivo e navegador</li>
          </ul>

          <h2 className="text-xl font-bold mt-6">2. Finalidade do Tratamento</h2>
          <p>Utilizamos seus dados para:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Criação e gerenciamento de conta</li>
            <li>Autenticação e segurança de acesso</li>
            <li>Conexão entre Contratantes e Workers (exibição de perfis, elenco/convites e candidaturas)</li>
            <li>Exibição da chave PIX e do telefone do Worker para a Contratante com quem ele tem vínculo ativo (elenco ou turno), para permitir que a Contratante efetue o pagamento combinado — neste piloto, o pagamento em si é combinado e realizado diretamente entre Contratante e Worker, fora da Plataforma</li>
            <li>Registro de pagamentos declarados pela Contratante e emissão do recibo/comprovante entre as partes</li>
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
            <li><strong>Contratante com vínculo:</strong> a chave PIX e o telefone do Worker ficam visíveis apenas para a Contratante com quem ele tem <strong>elenco aceito</strong> (um convite de elenco ainda pendente NÃO dá esse acesso — só o aceite do Worker dá), ou pelo menos uma candidatura/convite de turno em comum (incluindo turnos já concluídos ou cancelados, para manter o recibo e o histórico legíveis) — com a finalidade exclusiva de permitir que essa Contratante efetue o pagamento combinado pelo turno. A base legal é a execução do contrato entre as partes. Nenhuma outra conta da Plataforma tem acesso a esses dados. Quando o vínculo é só de elenco (sem turno já registrado), o Worker pode encerrar esse acesso a qualquer momento saindo do elenco ou bloqueando a Contratante — e o bloqueio feito pelo Worker não pode ser desfeito pela Contratante</li>
            <li><strong>CPF e data de nascimento do Worker:</strong> essa mesma regra de vínculo controla o acesso no banco de dados a esses dois campos, mas nenhuma tela da Plataforma hoje os exibe para a Contratante — eles ficam armazenados para verificação de identidade e obrigações legais da Worki, não para consulta pela Contratante</li>
            <li><strong>Supabase:</strong> infraestrutura de banco de dados e autenticação (dados criptografados)</li>
            <li><strong>Resend:</strong> envio de e-mails transacionais (apenas e-mail e nome)</li>
            <li><strong>Sentry:</strong> monitoramento de erros (dados anonimizados, sem dados pessoais)</li>
            <li><strong>Autoridades competentes:</strong> quando exigido por lei ou ordem judicial</li>
          </ul>
          <p>Não vendemos, alugamos ou compartilhamos seus dados com terceiros para fins de marketing.</p>

          <h2 className="text-xl font-bold mt-6">5. Retenção de Dados</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Dados de conta:</strong> mantidos enquanto a conta estiver ativa. Ao excluir a conta, suas credenciais de acesso são apagadas e <strong>seu nome, CPF, telefone, data de nascimento, chave PIX e demais dados pessoais são removidos</strong> em até 30 dias.</li>
            <li><strong>O que permanece após a exclusão, e por quê:</strong> os registros dos turnos que você trabalhou, dos pagamentos recebidos e dos termos de prestação de serviço que você aceitou <strong>continuam existindo, sem os seus dados pessoais</strong> — ligados apenas a um identificador interno que não permite identificá-lo. Isso é exigido pela legislação fiscal e trabalhista brasileira (Lei Geral de Proteção de Dados, art. 16, I e II) e protege igualmente você e a empresa contratante, porque é a prova de que o trabalho foi feito e pago. O mesmo vale para o registro de que uma pessoa operou determinada unidade de uma empresa e quando.</li>
            <li><strong>Dados financeiros e registros de pagamento:</strong> mantidos por 6 anos após o último registro. O prazo cobre a prescrição civil (Código Civil, art. 206, §5º, I) e a trabalhista (Constituição, art. 7º, XXIX), porque é justamente nesses processos que o termo de prestação de serviço precisa poder ser apresentado.</li>
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
