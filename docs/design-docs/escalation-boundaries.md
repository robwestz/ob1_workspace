# Escalation Boundaries — OB1

**Summary:** Defines what agents can do autonomously vs. what requires Robin's approval. Clear boundaries prevent both over-asking (slow) and under-asking (dangerous).

## Autonomous (Agent Decides)

Agents can proceed without asking when:
- Single-domain code changes (within one domain's boundaries)
- Documentation corrections (fixing typos, updating stale info)
- Dependency bumps (minor/patch versions only)
- Refactoring within a domain (no API changes)
- Adding tests
- GC sweeps (dead code removal, duplicate cleanup)
- Responding to review comments
- Bug fixes with clear root cause
- Night runner task execution (within configured budget)
- Memory storage/recall operations

## Notify After (Agent Decides, Robin Sees)

Agent proceeds but Robin is notified:
- Cross-domain changes (touching 2+ domains)
- New dependencies added
- Performance-sensitive changes (database queries, API calls)
- .harness/ file updates (quality scores, principle additions)
- Budget threshold warnings (>50% of configured limit)
- Failed QA gates (Bacowr 11-check)
- Night runner errors or unexpected stops

## Requires Approval (Agent Asks First)

Agent must wait for Robin's OK:
- Public API changes (Edge Function signatures, MCP protocol)
- Security changes (RLS policies, auth flow, secret handling)
- Architectural changes (new domains, dependency rule exceptions)
- Database schema changes (new tables, column alterations)
- Deployment to production (Supabase, DigitalOcean)
- Major version dependency upgrades
- Feature deprecation or removal
- Budget limit increases
- .harness/ principle changes (modifying golden rules)
- Escalation boundary changes (modifying THIS document)
- Any action that affects shared state beyond the local repo
- Commercial decisions (Bacowr pricing, customer communication)

## Emergency Protocol

If an agent encounters a situation not covered above:
1. Stop the current action
2. Document what happened and what decision is needed
3. Store as a thought in OB1 memory with tag "escalation"
4. Wait for Robin's next session

## Budget Guardrails

| Context | Max Budget | Escalation |
|---------|-----------|------------|
| Single task | $5 USD | Auto-stop, notify |
| Night runner (total) | $25 USD | Auto-stop, morning report |
| Bacowr batch | $50 USD | Auto-stop, notify |
| Emergency | $0 | Requires approval for any spend |
