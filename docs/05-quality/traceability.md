# Traçabilité des exigences

| Besoin ID | Exigence | Spécification | Tâches principales | Vérification |
|---|---|---|---|---|
| REQ-01 | Projet + groupe principal | projects, messaging | 007,010 | V1-A E2E |
| REQ-02 | Agents et affectations cloisonnés | agents, domain-model | 008,009,020 | tests cross-project |
| REQ-03 | Discussions durables, déclenchements ciblés | messaging, events | 011,012,021,022 | tests duplication/mentions |
| REQ-04 | CLI multi-fournisseurs | orchestration, agent-adapter | 015–020 | tests contrats/fournisseurs |
| REQ-05 | Contrôle des permissions/actions | approvals, security, actions | 006,017,022,023 | spoofing/refus/gate |
| REQ-06 | Supervision et reprise | execution-lifecycle, supervision | 016,026,035 | crash/reconciliation |
| REQ-07 | Ticket et revue | tickets, actions | 027–029,033,034 | transition + E2E |
| REQ-08 | Code/livrables réels | git-deliverables | 030–032 | repo temporaire/tests |
| REQ-09 | Restauration après incident | storage-operations | 005,037 | restore test |
| REQ-10 | UX collaborative | vision, personas-journeys | 024–026,034 | scénarios UI |

`REQ-01` à `REQ-10` sont des identifiants de traçabilité proposés ; toute évolution du périmètre doit actualiser ce tableau et les tickets affectés.
