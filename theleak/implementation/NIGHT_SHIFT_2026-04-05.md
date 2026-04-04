# Night Shift — 2026-04-05 → 2026-04-05

Robin sover. Claude leder.

## Mål: Höj quality scores, stäng gaps, förbered deploy

### Phase A: Tests (biggest gap — F/D across 5 domains)
1. Runtime unit tests (test_coverage D → B)
2. Dashboard component tests (test_coverage F → C)
3. Edge Function handler tests (test_coverage D → B)

### Phase B: Documentation  
4. API reference — alla 52 Edge Function actions dokumenterade
5. Bacowr API reference — alla 8 actions

### Phase C: Deploy Preparation
6. Supabase deploy guide — exakta kommandon Robin behöver köra
7. Night-tasks.json — default konfiguration för nattjobb
8. Verify all SQL migrations are deployable (dry-run parse)

### Phase D: Code Quality
9. Add structured logging to runtime modules that lack it
10. Type-check sweep — ensure all TypeScript compiles clean

### Morning Report
Generera sammanfattning av allt som gjordes under natten.
