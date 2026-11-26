-- Copiloto: cota por usuário e orçamento diário de tokens.
-- Guarda SÓ contadores. Nenhum conteúdo de pedido, tela ou resposta é persistido.
-- Só a edge function `copilot-llm` (service_role) alcança a tabela e as funções.
-- Não toca saldo (Article 8 intacto). Sem esta migration a função responde 503.

CREATE TABLE IF NOT EXISTS public.copilot_usage_daily (
  user_id       uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day           date    NOT NULL,
  requests      integer NOT NULL DEFAULT 0,
  input_tokens  bigint  NOT NULL DEFAULT 0,
  output_tokens bigint  NOT NULL DEFAULT 0,
  reserved      bigint  NOT NULL DEFAULT 0,
  window_start  timestamptz NOT NULL DEFAULT now(),
  window_count  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_copilot_usage_day ON public.copilot_usage_daily (day);

ALTER TABLE public.copilot_usage_daily ENABLE ROW LEVEL SECURITY;
-- Sem nenhuma policy, de propósito: anon e authenticated não leem nem escrevem.
REVOKE ALL ON public.copilot_usage_daily FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.copilot_usage_daily IS
  'Contadores de uso do copiloto (custo/limite). Proibido guardar conteúdo.';

CREATE OR REPLACE FUNCTION public.copilot_reserve(
  p_user uuid,
  p_per_minute integer,
  p_per_day integer,
  p_user_daily_tokens bigint,
  p_global_daily_tokens bigint,
  p_estimate bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_row public.copilot_usage_daily%ROWTYPE;
  v_global bigint;
  v_window_count integer;
  v_window_start timestamptz;
BEGIN
  IF p_user IS NULL OR p_estimate IS NULL OR p_estimate <= 0 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_input');
  END IF;

  -- Serializa as reservas do dia: sem isto, chamadas simultâneas furam o orçamento global.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('copilot_budget', 0));

  INSERT INTO public.copilot_usage_daily (user_id, day) VALUES (p_user, v_day)
  ON CONFLICT (user_id, day) DO NOTHING;

  SELECT * INTO v_row FROM public.copilot_usage_daily
   WHERE user_id = p_user AND day = v_day FOR UPDATE;

  IF v_row.window_start > now() - interval '1 minute' THEN
    v_window_start := v_row.window_start;
    v_window_count := v_row.window_count;
  ELSE
    v_window_start := now();
    v_window_count := 0;
  END IF;

  IF v_window_count >= p_per_minute THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_minute');
  END IF;
  IF v_row.requests >= p_per_day THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_day');
  END IF;
  IF v_row.input_tokens + v_row.output_tokens + v_row.reserved + p_estimate > p_user_daily_tokens THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'user_budget');
  END IF;

  SELECT COALESCE(SUM(input_tokens + output_tokens + reserved), 0) INTO v_global
    FROM public.copilot_usage_daily WHERE day = v_day;
  IF v_global + p_estimate > p_global_daily_tokens THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'global_budget');
  END IF;

  UPDATE public.copilot_usage_daily
     SET requests = requests + 1,
         reserved = reserved + p_estimate,
         window_start = v_window_start,
         window_count = v_window_count + 1
   WHERE user_id = p_user AND day = v_day;

  RETURN jsonb_build_object('allowed', true, 'day', v_day);
END;
$$;

CREATE OR REPLACE FUNCTION public.copilot_settle(
  p_user uuid,
  p_day date,
  p_estimate bigint,
  p_input bigint,
  p_output bigint
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.copilot_usage_daily
     SET reserved = GREATEST(reserved - GREATEST(p_estimate, 0), 0),
         input_tokens = input_tokens + GREATEST(p_input, 0),
         output_tokens = output_tokens + GREATEST(p_output, 0)
   WHERE user_id = p_user AND day = p_day;
$$;

REVOKE ALL ON FUNCTION public.copilot_reserve(uuid, integer, integer, bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.copilot_settle(uuid, date, bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.copilot_reserve(uuid, integer, integer, bigint, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.copilot_settle(uuid, date, bigint, bigint, bigint) TO service_role;
