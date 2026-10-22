# Conventions partagées — propositions

- **IDs** : chaînes opaques (UUID/ULID, décision technique à fixer) ; ne jamais déduire un projet d'un nom libre.
- **Temps** : ISO-8601 UTC pour API ; stockage consistant en base ; UI convertit au fuseau de l'utilisateur.
- **Permissions** : verbes canoniques listés dans [approbations](../02-features/approvals.md) ; l'absence d'un droit vaut refus.
- **Statuts** : énumérations de [cycle d'exécution](../01-architecture/execution-lifecycle.md) et [tickets](../02-features/tickets.md) ; éviter états synonymes.
- **Actions** : `type` namespaced (`ticket.create`, `message.send`…), enveloppe avec identité serveur et `idempotencyKey`.
- **Événements** : événement de domaine au passé (`ticket.created`, `execution.failed`) ; versions entières, occurrence immuable.
- **Erreurs** : `code`, `message` non sensible, `correlationId`, champs `details` validés ; codes `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `CAPABILITY_UNAVAILABLE`, `EXECUTION_UNCERTAIN`, `RATE_LIMITED`.
- **Sécurité** : `actorId`, `projectId`, `executionId` sont déterminés par la session autorisée, pas fiables s'ils proviennent d'un prompt.
- **Tests** : tests de validation d'inputs et autorisation multi-projet pour chaque action.
