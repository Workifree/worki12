import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Terms() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 mb-6 hover:text-gray-900">
          <ArrowLeft size={20} /> Voltar
        </button>
        <h1 className="text-3xl font-bold mb-6">Termos de Uso</h1>
        <div className="bg-white rounded-xl border-2 border-black p-8 space-y-4 text-sm leading-relaxed">
          <p className="text-gray-600">Última atualização: Agosto de 2026</p>

          <h2 className="text-xl font-bold mt-6">1. Aceitação dos Termos</h2>
          <p>Ao acessar e usar a plataforma Worki ("Plataforma"), você concorda integralmente com estes Termos de Uso. Se não concordar com qualquer cláusula, não utilize a Plataforma. A Worki reserva-se o direito de atualizar estes Termos a qualquer momento, notificando os usuários por e-mail ou pela própria Plataforma.</p>

          <h2 className="text-xl font-bold mt-6">2. Descrição do Serviço</h2>
          <p>Worki é uma plataforma digital que conecta empresas ("Contratantes") a trabalhadores freelancers ("Workers") para prestação de serviços temporários (turnos avulsos/diárias). A Worki atua como intermediária tecnológica, facilitando a conexão entre as partes, a publicação e gestão de vagas e turnos, o convite direto de freelancers já conhecidos da Contratante, e o acompanhamento do turno (chegada, saída e conclusão). O pagamento pelo serviço prestado é combinado e realizado diretamente entre Contratante e Worker — veja a Seção 4.</p>

          <h2 className="text-xl font-bold mt-6">3. Cadastro e Conta</h2>
          <p>Para utilizar a Plataforma, é necessário criar uma conta com informações verdadeiras, completas e atualizadas. O usuário é responsável por manter a confidencialidade de suas credenciais de acesso e por todas as atividades realizadas em sua conta. A Worki pode suspender ou encerrar contas que violem estes Termos ou forneçam informações falsas.</p>

          <h2 className="text-xl font-bold mt-6">4. Pagamento entre Contratante e Worker</h2>
          <p>Neste piloto, o pagamento pelo serviço prestado é combinado e realizado diretamente entre a Contratante e o Worker, por fora da Plataforma:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Combinação e pagamento direto:</strong> Contratante e Worker combinam entre si a forma de pagamento (PIX ou dinheiro) e o pagamento é feito diretamente de um para o outro. A Worki disponibiliza a chave PIX cadastrada pelo Worker para facilitar essa combinação.</li>
            <li><strong>Nenhuma custódia pela Worki:</strong> nenhum valor é depositado, retido ou repassado pela Plataforma. A Worki não é instituição de pagamento nem intermediária financeira nesse fluxo, e não é responsável pela liquidação do pagamento entre as partes.</li>
            <li><strong>Registro e recibo:</strong> após o pagamento, a Contratante pode registrar na Plataforma que o pagamento foi realizado (valor, forma e data). A Worki emite um recibo com esses dados, disponível para as duas partes, e o Worker pode confirmar o recebimento diretamente no recibo. Esse registro tem caráter declaratório — serve como histórico e comprovante entre as partes, mas <strong>não é documento fiscal</strong>, e a Worki não verifica de forma independente se o pagamento de fato ocorreu.</li>
            <li><strong>Responsabilidade pelo pagamento:</strong> o valor, a forma e o prazo de pagamento são de responsabilidade exclusiva da Contratante. A Worki não garante, não antecipa e não se responsabiliza por qualquer valor devido ao Worker.</li>
          </ul>
          <p className="mt-2">A Plataforma também pode oferecer, como recurso opcional, uma carteira digital para depósito e saque via PIX processados por um parceiro de pagamentos. Esse recurso não é o fluxo padrão deste piloto; quando utilizado, aplicam-se as regras específicas exibidas na própria tela da carteira.</p>

          <h2 className="text-xl font-bold mt-6">5. Taxas</h2>
          <p>No piloto atual, a Worki <strong>não cobra nenhuma taxa</strong> sobre o pagamento combinado entre Contratante e Worker: o uso da Plataforma para publicar vagas, convidar freelancers, gerenciar turnos e registrar pagamentos é gratuito. A Worki reserva-se o direito de introduzir cobranças no futuro, notificando os usuários com antecedência mínima de 30 dias.</p>

          <h2 className="text-xl font-bold mt-6">6. Cancelamentos</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Antes da contratação:</strong> vagas e convites de turno podem ser cancelados livremente pela Contratante, e o Worker pode recusar um convite sem custo e sem prejuízo à sua avaliação.</li>
            <li><strong>Após a contratação:</strong> o Worker pode cancelar um turno já aceito diretamente pelo aplicativo; a Contratante é notificada automaticamente para poder se reorganizar.</li>
            <li><strong>Pagamento e não comparecimento:</strong> como o valor do turno é combinado e pago diretamente entre Contratante e Worker, fora da Plataforma, a Worki não retém nem devolve valores. Se uma das partes não comparecer ao turno combinado, o ajuste — inclusive quanto ao pagamento — é resolvido diretamente entre Contratante e Worker.</li>
          </ul>

          <h2 className="text-xl font-bold mt-6">7. Disputas</h2>
          <p>Em caso de desacordo entre Contratante e Worker sobre a conclusão, a qualidade do serviço prestado ou o pagamento combinado, a resolução é entre as próprias partes — como a Worki não custodia nem intermedeia o valor do pagamento neste piloto, ela não tem poder de decisão sobre ele. A Worki pode apurar denúncias de uso indevido da Plataforma (perfis falsos, fraude, comportamento abusivo) e tomar medidas administrativas sobre a conta envolvida, mas isso não substitui a resolução do desacordo financeiro entre as partes. Nenhuma parte abre mão do direito de buscar reparação judicial.</p>

          <h2 className="text-xl font-bold mt-6">8. Responsabilidades e Limitações</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>A Worki <strong>não é parte</strong> na relação de trabalho entre Contratantes e Workers. Não há vínculo empregatício entre as partes ou com a Plataforma.</li>
            <li>Cada parte é responsável pelo cumprimento de suas obrigações legais, tributárias e previdenciárias, incluindo as relativas ao pagamento combinado entre elas.</li>
            <li>A Worki não garante a qualidade, pontualidade ou resultado dos serviços prestados, nem o pagamento combinado entre as partes.</li>
            <li>A Worki não se responsabiliza por danos indiretos, lucros cessantes ou perdas decorrentes do uso da Plataforma.</li>
          </ul>

          <h2 className="text-xl font-bold mt-6">9. Propriedade Intelectual</h2>
          <p>Todo o conteúdo da Plataforma (marca, logotipo, interface, código-fonte) é propriedade da Worki. O uso não autorizado constitui violação de direitos autorais e de propriedade intelectual.</p>

          <h2 className="text-xl font-bold mt-6">10. Proteção de Dados (LGPD)</h2>
          <p>O tratamento de dados pessoais pela Worki está em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018). Consulte nossa <a href="/privacidade" className="text-green-600 font-bold underline">Política de Privacidade</a> para detalhes sobre coleta, uso, compartilhamento e seus direitos como titular dos dados.</p>

          <h2 className="text-xl font-bold mt-6">11. Suspensão e Encerramento</h2>
          <p>A Worki pode suspender ou encerrar o acesso de usuários que: violem estes Termos, realizem atividades fraudulentas, apresentem comportamento abusivo, ou utilizem a Plataforma para fins ilegais. Em caso de encerramento, eventual saldo remanescente na carteira digital opcional da Plataforma (quando esse recurso tiver sido utilizado) será devolvido conforme aplicável.</p>

          <h2 className="text-xl font-bold mt-6">12. Foro e Legislação</h2>
          <p>Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de São Paulo/SP para dirimir quaisquer controvérsias.</p>

          <h2 className="text-xl font-bold mt-6">13. Contato</h2>
          <p>Para dúvidas sobre estes Termos: <a href="mailto:contato@worki.com.br" className="text-green-600 font-bold">contato@worki.com.br</a></p>
        </div>
      </div>
    </div>
  );
}
