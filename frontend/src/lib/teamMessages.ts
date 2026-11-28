/**
 * Mensagens para desfechos novos de convite, papel e loja (ADR lojas-como-etiquetas-e-equipe-unificada).
 * Devolve `null` quando o desfecho não é um destes, para a tela cair no texto padrão do serviço.
 */
export function extraTeamMessage(outcome: string): string | null {
  switch (outcome) {
    case 'already_member_other_role':
      return 'Essa pessoa já está na equipe com outro papel. Remova-a antes de convidar com um papel novo.';
    case 'already_invited_other_role':
      return 'Já existe um convite pendente para este e-mail com outro papel. Cancele o convite antes de criar outro.';
    case 'invalid_tag':
      return 'Essa loja não está mais disponível. Escolha outra.';
    case 'default_of_members':
      return 'Há pessoas com esta loja como padrão. Troque a loja delas em Pessoas antes de arquivar.';
    case 'manager_requires_verified_signup':
      return 'Para convidar um Gestor, a pessoa precisa antes se cadastrar com este e-mail e confirmá-lo.';
    default:
      return null;
  }
}
