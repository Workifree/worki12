import { PlusCircle } from 'lucide-react';
import { ButtonLink } from '../ui';
import { COMPANY_CREATE_ACTION } from '../../lib/navigation';

/**
 * "Criar turno" no cabeçalho da tela, só no celular (no desktop está no topo da lateral).
 * Substitui o botão flutuante, que cobria as ações dos cartões e o menu "...".
 */
export default function CreateShiftLink() {
    return (
        <ButtonLink
            to={COMPANY_CREATE_ACTION.path}
            variant="dark"
            className="md:hidden"
            iconLeft={<PlusCircle size={16} aria-hidden="true" />}
        >
            {COMPANY_CREATE_ACTION.label}
        </ButtonLink>
    );
}
