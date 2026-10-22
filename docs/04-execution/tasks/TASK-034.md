# TASK-034 — Construire UI tickets et revue

**Jalon :** V1-B · **Statut :** terminée — UI tickets/revue livrée ; E2E navigateur réservé à TASK-035

## Objectif
Visualiser le flux création → exécution → revue → terminé.

## Contexte
Cette tâche contribue à la livraison V1-B de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/tickets.md`
- `../../00-product/personas-journeys.md`

## Prérequis
- TASK-024
- TASK-025
- TASK-028
- TASK-029
- TASK-033

## Périmètre
Liste/fiche ticket, état, responsable, critères, conversation, preuves Git/tests et revue.

## Hors périmètre
Pas de Gantt, automatisations ni Kanban complexe.

## Spécifications
Appeler routes/services réels ; afficher avertissement si tests manquants/échoués.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Scénario ticket assigné, changement d’état et revue accessible dans UI.

## Vérification
La suite backend, le typecheck, le lint, le format, le build frontend et la
configuration Compose ont été vérifiés dans Docker. Aucun harnais de test
composant ou E2E navigateur n'est présent dans le dépôt ; la couverture E2E
avec agent factice relève de TASK-035.

Commandes exécutées :

- `docker compose run --rm api npm test` — 26 fichiers, 117 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non
  bloquant sur la taille d'un chunk frontend.
- `docker compose config --quiet` — succès.
- `docker compose ps` — API et web actifs.
- `curl -fsS -I http://127.0.0.1:5173/` — HTTP 200.
- `curl -fsS http://127.0.0.1:3000/health` — `{"status":"ok"}`.

Skills appliqués dans l'ordre requis : `react-patterns`, puis
`frontend-design`.

La vérification visuelle interactive reste à effectuer dans un navigateur ;
aucun navigateur automatisé n'est installé dans l'environnement courant.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
