/** "Mostrar QR do turno", para quem opera o turno (o servidor decide quem recebe o código). */
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ShowShiftQr } from '../../components/presence/ShowShiftQr';
import { Button, PageHeader } from '../../components/ui';

export default function CompanyShiftQr() {
    const { id } = useParams();
    const navigate = useNavigate();
    return (
        <div className="mx-auto max-w-md pb-6" data-copilot-private>
            <Button variant="ghost" className="-ml-3 mb-2" iconLeft={<ArrowLeft size={16} />} onClick={() => navigate(`/company/jobs/${id}/candidates`)}>
                Voltar ao turno
            </Button>
            <PageHeader title="QR do turno" />
            {id && <ShowShiftQr jobId={id} />}
        </div>
    );
}
