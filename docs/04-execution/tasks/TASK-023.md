# TASK-023 — Implémenter demandes et décisions d’approbation

**Jalon :** V1-A · **Statut :** terminée — cœur métier livré, autorisation propriétaire injectable

## Objectif
Permettre le contrôle humain des opérations sensibles.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/approvals.md`
- `../../03-contracts/actions.md`

## Prérequis
- TASK-006
- TASK-012
- TASK-016

## Périmètre
State machine pending/approved/denied/expired, boîte métier et vérification après décision.

## Hors périmètre
Pas de délégation d’approval à une IA.

## Spécifications
Seul propriétaire authentifié décide ; une action dont droits/champ ont changé ne s’exécute pas.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Refus/expiration ne crée aucun effet sensible : l’exécution en attente est
  annulée et aucune reprise n’est possible.
- [x] Décision attribuable et auditée : l’identité humaine ou le système
  d’expiration est persisté et publié dans `approval.resolved`.

## Vérification
Tests spoofing, double décision, expiration, révocation, reprise après
redémarrage et transaction atomique demande/exécution dans
`src/server/approvals/service.test.ts`.

Commandes réellement exécutées dans Docker :

- `docker compose run --rm api npm run typecheck`
- `docker compose run --rm api npm run lint`
- `docker compose run --rm api npm run format:check`
- `docker compose run --rm api npm test -- --run src/server/approvals/service.test.ts src/server/executions/service.test.ts src/server/db/database.test.ts`
- `docker compose run --rm api npm test` — 19 fichiers, 81 tests passés
- `docker compose run --rm api npm run build`

Restriction restante : le dépôt ne fournit pas encore de modèle
d’authentification/ownership humain. `ApprovalService` exige donc un
`ownerAuthorizer` serveur injecté et refuse par défaut toute décision ; la
route HTTP est raccordée mais reste fail-closed avec une simple identité
d’en-tête.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ;
tests pertinents exécutés ; aucune régression connue critique ; restriction
d’authentification propriétaire explicitement conservée en fail-closed.
