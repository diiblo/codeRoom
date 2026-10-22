# Execution et Session — enveloppes contractuelles

```ts
type ExecutionState =
  | 'queued' | 'running' | 'awaiting_approval'
  | 'succeeded' | 'failed' | 'cancelled' | 'unknown';

type ExecutionRequest = {
  projectId: string;
  assignmentId: string;
  triggerId: string;
  instruction: string;
  contextRefs: string[];
  requestedWorkspaceId?: string;
  idempotencyKey: string;
};
```

Le système enrichit la demande après résolution de l'affectation : identité, permissionSet, workspace, quotas, timeouts, approbations, paramètres fournisseur. Les contextRefs sont autorisés un par un dans le projet.

## Invariants
- `triggerId` et idempotence évitent la double mise en file ; un unique état courant est conservé.
- `session` reste dans un projet via `assignmentId` ; clé native optionnelle, version du fournisseur associée.
- Un état final ne revient jamais `running` ; tentative de reprise = nouvelle exécution avec `parentExecutionId`.
- Le succès provient d'un résultat contrôlé, pas du seul texte « terminé ».
- `unknown` impose conciliation humaine ou procédure de reprise prouvée sûre.

## Concurrence
Une réservation atomique évite que deux workers prennent la même ligne. Une `lease` expirée n'implique pas que le processus OS soit arrêté ; vérifier/réconcilier avant toute relance. Pour écritures Git MVP : verrou par dépôt/espace.

## Acceptation
Déduplication, transitions illégales refusées, annulation idempotente, timeout visible, crash suivi de réconciliation.
