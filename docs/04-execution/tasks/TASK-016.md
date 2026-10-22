# TASK-016 — Implémenter file persistante et transitions

**Jalon :** P0 · **Statut :** terminée

## Objectif
Mettre en file des tâches et les suivre sans double réservation.

## Contexte
Cette tâche contribue à la livraison P0 de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../01-architecture/execution-lifecycle.md`
- `../../03-contracts/execution.md`

## Prérequis
- TASK-004
- TASK-012
- TASK-015

## Périmètre
Modèle Execution/Session minimal, queue SQLite, lease/réservation, transitions, cancel, réconciliation.

## Hors périmètre
Pas de processus externe priviligié ; TASK-017.

## Spécifications
Un état terminal n’est pas relancé ; `unknown` après crash incertain ; 1 travail par affectation par défaut.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Aucun doublon en cas de dispatch répété.
- [x] Un crash ne produit pas de faux succès.

## Vérification
Tests concurrents de réservation, arrêt/restart, transition illégale et idempotence. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- La migration `0008_executions.sql` ajoute les exécutions, l'historique des
  transitions et les sessions fournisseur. La migration `0009_execution_session_keys.sql`
  ajoute l'unicité d'une clé de session fournisseur sans modifier la migration
  déjà appliquée.
- `ExecutionService` crée une file idempotente par `triggerId` et
  `idempotencyKey`, vérifie le projet et l'affectation active, et empêche deux
  travaux actifs pour une même affectation. La réservation est transactionnelle
  et attribue un lease renouvelable à un seul worker.
- Les transitions légales sont imposées (`queued`, `running`,
  `awaiting_approval`, puis états terminaux), avec historique et événement
  d'audit. Les états terminaux sont immuables ; une transition nécessitant un
  worker sans lease est refusée.
- L'annulation d'une tâche en attente est immédiate. Pour une tâche réservée,
  elle est d'abord enregistrée comme demande si aucun worker ne la prouve, puis
  le worker peut la faire passer à `cancelled`. Au redémarrage ou à l'expiration
  du lease, `running` et `awaiting_approval` passent à `unknown` avec l'erreur
  `EXECUTION_UNCERTAIN`, sans succès implicite.
- La création de session est idempotente pour une même exécution et refuse la
  réutilisation d'une identité fournisseur sur une autre exécution.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- src/server/executions/service.test.ts` — 6 tests passés.
- `docker compose run --rm api npm test -- src/server/db/database.test.ts` — 5 tests passés.
- `docker compose run --rm api npm test` — 14 fichiers, 58 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose config --quiet` — succès.

Restrictions restantes : TASK-016 ne lance aucun processus fournisseur et ne
contourne pas la gate de confinement ; le runner réel et les adaptateurs réels
restent du périmètre de TASK-017 et des tâches suivantes. Une exécution
`unknown` n'est pas relancée automatiquement.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
