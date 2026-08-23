-- Migration: o termo de prestacao rotulava o documento da empresa SEMPRE como "CNPJ"
--
-- ACHADO (23/08/2026, lendo o recibo gerado no browser): `render_service_term_text` escreve o
-- literal 'CNPJ: ' antes do documento da CONTRATANTE, qualquer que seja o documento.
--
-- Nao e um caso de borda: `CompanyOnboarding` aceita, DE PROPOSITO, 11 ou 14 digitos --
--     (cleanDoc.length === 11 || cleanDoc.length === 14)
-- -- e valida o digito verificador dos dois, porque MEI e empresario individual se cadastram com
-- CPF. Ou seja, o proprio formulario abre um caminho que termina num documento juridico chamando
-- de CNPJ um numero que e CPF.
--
-- POR QUE ISSO IMPORTA MAIS QUE UM ROTULO: este texto e a UNICA razao de o F6 existir. Ele e
-- congelado no aceite (`enforce_service_term_immutability`) para poder responder "o que as duas
-- partes assinaram". Um termo que identifica errado a especie do documento da parte contratante
-- e um termo que erra sobre QUEM contratou.
--
-- ESCOPO — o que esta migration NAO faz: nao reescreve termo ja aceito. `term_text` e imutavel
-- depois de `accepted_at`, e por bom motivo. Documento assinado nao se corrige em silencio; se
-- algum termo aceito tiver o rotulo errado, isso e assunto de reemissao, com novo aceite, nao de
-- UPDATE. A funcao so afeta renderizacao daqui pra frente.
--
-- 'CPF/CNPJ: ' e o fallback para documento ausente ou de tamanho inesperado: melhor generico e
-- verdadeiro do que especifico e falso.
--
-- Article 8: nao toca saldo.

CREATE OR REPLACE FUNCTION public.render_service_term_text(
    p_worker_name   text,
    p_worker_cpf    text,
    p_company_name  text,
    p_company_cnpj  text,
    p_job_title     text,
    p_job_date      date,
    p_amount        numeric,
    p_term_version  text
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
    WITH doc AS (
        SELECT nullif(regexp_replace(coalesce(p_company_cnpj, ''), '\D', '', 'g'), '') AS digitos
    )
    SELECT concat(
        'TERMO DE PRESTAÇÃO DE SERVIÇO AUTÔNOMO E RESPONSABILIDADE TRIBUTÁRIA', E'\n',
        'Modelo ', coalesce(nullif(btrim(p_term_version), ''), 'modelo-worki-v1'), E'\n\n',
        'PRESTADOR: ', coalesce(nullif(btrim(p_worker_name), ''), 'não informado'), E'\n',
        'CPF: ', coalesce(
            nullif(regexp_replace(coalesce(p_worker_cpf, ''), '\D', '', 'g'), ''),
            'não informado'
        ), E'\n\n',
        'CONTRATANTE: ', coalesce(nullif(btrim(p_company_name), ''), 'não informado'), E'\n',
        -- O rotulo segue a especie do documento, nao a suposicao de que empresa tem CNPJ.
        CASE
            WHEN (SELECT length(digitos) FROM doc) = 11 THEN 'CPF: '
            WHEN (SELECT length(digitos) FROM doc) = 14 THEN 'CNPJ: '
            ELSE 'CPF/CNPJ: '
        END,
        coalesce((SELECT digitos FROM doc), 'não informado'), E'\n\n',
        'SERVIÇO: ', coalesce(nullif(btrim(p_job_title), ''), 'sem título'), E'\n',
        'DATA DA PRESTAÇÃO: ', coalesce(to_char(p_job_date, 'DD/MM/YYYY'), 'não informada'), E'\n',
        'VALOR BRUTO: R$ ', coalesce(replace(to_char(p_amount, 'FM9999999990.00'), '.', ','), '0,00'),
        E'\n\n',
        '1. O PRESTADOR declara que executou o serviço acima de forma AUTÔNOMA, sem subordinação, ',
        'habitualidade ou exclusividade, não se caracterizando vínculo empregatício com a CONTRATANTE.',
        E'\n\n',
        '2. O valor acima é BRUTO. O PRESTADOR declara ser o único responsável pelo recolhimento dos ',
        'tributos e das contribuições previdenciárias incidentes sobre o valor recebido, isentando a ',
        'CONTRATANTE de tal responsabilidade.',
        E'\n\n',
        '3. O PRESTADOR declara ter recebido o valor acima diretamente da CONTRATANTE, por meio externo ',
        'à plataforma Worki.',
        E'\n\n',
        '4. A plataforma Worki NÃO é parte deste termo. Ela apenas REGISTRA a declaração e o aceite entre ',
        'PRESTADOR e CONTRATANTE. A Worki não é empregadora, não intermedia o pagamento, não presta ',
        'consultoria jurídica e não garante a validade jurídica deste documento.',
        E'\n\n',
        'Aceite eletrônico registrado pela plataforma na data e hora indicadas neste recibo.'
    );
$$;

COMMENT ON FUNCTION public.render_service_term_text(text,text,text,text,text,date,numeric,text) IS
    'Renderiza o texto do termo de prestacao (F6). O rotulo do documento da CONTRATANTE segue a '
    'contagem de digitos (11=CPF, 14=CNPJ, senao CPF/CNPJ) porque CompanyOnboarding aceita os dois '
    'de proposito (MEI/empresario individual). Ate 20260823000300 dizia sempre CNPJ. Termo ja '
    'aceito NAO e reescrito: term_text e imutavel apos accepted_at.';
