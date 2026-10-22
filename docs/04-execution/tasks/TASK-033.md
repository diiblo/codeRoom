# TASK-033 — Implémenter soumission et revue séparée

**Jalon :** V1-B · **Statut :** terminée

## Objectif
Établir une vraie validation avant clôture du ticket.

## Contexte
Cette tâche contribue à la livraison V1-B de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/tickets.md`
- `../../03-contracts/actions.md`

## Prérequis
- TASK-023
- TASK-027
- TASK-028
- TASK-032

## Périmètre
Actions submit_review et review.submit, vérification livrable, relecteur distinct et historique.

## Hors périmètre
Pas de PR GitHub ou workflow distant.

## Spécifications
Une auto-validation par agent responsable est refusée ; acceptation/rejet atomique avec transition.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Review acceptée clôture.
- [x] Refus renvoie en cours.
- [x] Preuve absente bloque.

## Vérification
Tests transitions, reviewer non autorisé, soumission sans livrable. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.

## Compte rendu d'exécution

La migration v21 ajoute l'historique des soumissions en revue, les verdicts,
leurs clés d'idempotence et les demandes d'actions structurées. `ReviewService`
vérifie qu'un ticket est `in_progress`, que le livrable appartient au ticket,
est soumis et contient au moins une preuve de test. La soumission du responsable
fait passer atomiquement le ticket à `in_review` ; un verdict `accepted` le
fait passer à `done`, tandis qu'un verdict `rejected` le remet à `in_progress`
avec une raison obligatoire.

`StructuredReviewActionService` expose `ticket.submit_review` et
`review.submit`, recoupe exécution, affectation, projet et permissions, et
refuse l'auto-validation du responsable ou du soumissionnaire du livrable. Une
transition directe `ticket.update -> in_review` est refusée ; elle doit passer
par la soumission contrôlée. Une route HTTP humaine
`POST /api/tickets/:ticketId/reviews` permet le verdict propriétaire, sans
workflow distant ni PR GitHub.

Les tests couvrent l'acceptation, le rejet, l'idempotence, le reviewer sans
permission, l'auto-validation, la preuve absente, la raison obligatoire et la
persistance de l'historique. L'identité humaine HTTP repose encore sur le
middleware d'identité applicative existant ; son authentification réelle reste
une restriction globale déjà documentée.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/reviews/service.test.ts src/server/db/database.test.ts src/server/http/api.test.ts` — 3 fichiers, 15 tests passés.
- `docker compose run --rm api npm test` — 26 fichiers, 117 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.
- `docker compose config --quiet` — succès.
