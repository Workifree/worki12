-- ============================================================
-- Agent Management Tables
-- Infraestrutura para gestão agêntica de 3 níveis
-- ============================================================

-- agent_memory: memória compartilhada entre agentes
CREATE TABLE IF NOT EXISTS agent_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_name TEXT,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    updated_by TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(plan_name, category, key)
);

-- agent_kpis: tracking de KPIs por plano
CREATE TABLE IF NOT EXISTS agent_kpis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_name TEXT NOT NULL,
    kpi_name TEXT NOT NULL,
    target_value NUMERIC,
    current_value NUMERIC,
    unit TEXT,
    measured_at TIMESTAMPTZ DEFAULT NOW(),
    measured_by TEXT
);

-- Indexes
CREATE INDEX idx_agent_memory_plan ON agent_memory(plan_name);
CREATE INDEX idx_agent_memory_category ON agent_memory(category);
CREATE INDEX idx_agent_memory_key ON agent_memory(key);
CREATE INDEX idx_agent_kpis_plan ON agent_kpis(plan_name);
CREATE INDEX idx_agent_kpis_name ON agent_kpis(kpi_name);
CREATE INDEX idx_agent_kpis_measured ON agent_kpis(measured_at);

-- RLS
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_memory" ON agent_memory
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read_memory" ON agent_memory
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_full_kpis" ON agent_kpis
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read_kpis" ON agent_kpis
    FOR SELECT TO authenticated USING (true);

-- Grants
GRANT ALL ON agent_memory TO service_role;
GRANT SELECT ON agent_memory TO authenticated;
GRANT ALL ON agent_kpis TO service_role;
GRANT SELECT ON agent_kpis TO authenticated;
