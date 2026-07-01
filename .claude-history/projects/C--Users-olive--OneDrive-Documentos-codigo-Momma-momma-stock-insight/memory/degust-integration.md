# Degust POS Integration Details

## Architecture
- Edge Function `degust-sync-sales` acts as sync + cache layer
- Fetches from Degust API day-by-day, caches in `degust_vendas_diarias` table
- Frontend reads from edge function (which returns cached + freshly synced data)
- If edge function fails, frontend falls back to reading cache table directly

## API Endpoints Tested
- `GET /api/financeiro/movimentacao-produtos` - daily transactions (WORKS, single day via DataCaixa)
- `GET /api/financeiro/exportar-produtos` - product catalog (franchise-level)
- `GET /api/movimentacao/movimentacaoVendaItem` - returned 0 results in testing
- `POST /api/movimentacao/MovProdutos` - product movements (works)
- `GET /api/loja/listarLojasFranquia` - store listing

## Product Mapping
- 124 entries in `degust_product_mapping` covering 76 unique Momma products
- Sectors: PRODUTOS and COMIDAS only (active products)
- Match types: exact, variant, fuzzy

## Token Management
- JWT Bearer token, 4-hour expiration
- Stored as Supabase secret: `DEGUST_API_TOKEN`
- Edge function returns 401 with helpful message when expired
- User must regenerate token from Degust system and update secret

## Frontend Changes (QtdVendas.tsx)
- Lago Sul filtered out from static JSON (`salesDataRaw`)
- When Lago Sul selected: calls edge function, uses `degustProducts` state
- Date presets use `new Date()` as reference for Lago Sul (live data)
- Other stores still use `lastDataDate` from static JSON
- Loading indicator shows "Sincronizando Degust..." / "Degust Live" badge
