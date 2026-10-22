# TASK-028 — Implémenter actions de ticket et attribution

**Jalon :** V1-B · **Statut :** terminée

## Objectif
Permettre création, attribution et suivi de ticket par agent autorisé.

## Contexte
Cette tâche contribue à la livraison V1-B de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../03-contracts/actions.md`
- `../../02-features/tickets.md`

## Prérequis
- TASK-006
- TASK-009
- TASK-022
- TASK-027

## Périmètre
Pont structuré `ticket.create/assign/update` et routes correspondantes.

## Hors périmètre
Pas de création déduite d’une phrase en conversation.

## Spécifications
Cible affectée au même projet, permission vérifiée, idempotence et audit.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Création depuis agent mock visible en API.
- [x] Attribution inter-projet rejetée.

## Vérification
Tests API/action doublon, auteur falsifié et ticket archivé. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.

## Réalisation et preuves

- `migrations/0016_ticket_actions.sql` persiste les actions tickets acceptées,
  leur empreinte, leur résultat et leur clé d’idempotence.
- `src/server/actions/ticket.ts` implémente les actions structurées
  `ticket.create`, `ticket.assign` et `ticket.update`.
- L’exécution invocatrice doit être `running`, son projet et son affectation
  sont recoupés avec l’identité agent serveur, puis la permission canonique est
  contrôlée avant tout effet métier.
- `TicketService` expose les opérations transactionnelles nécessaires au pont
  et vérifie qu’un responsable est actif et affecté au même projet.
- `src/server/http/api.ts` expose `POST /api/actions` et la lecture filtrée
  `GET /api/projects/:projectId/tickets`.
- `src/server/actions/ticket.test.ts` et `src/server/http/api.test.ts`
  couvrent création, replay idempotent, audit, clôture directe refusée et
  attribution cross-project refusée.

Commandes réellement exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/actions/ticket.test.ts src/server/http/api.test.ts src/server/db/database.test.ts` — 3 fichiers, 14 tests passés.
- `docker compose run --rm api npm test` — 21 fichiers, 89 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose config --quiet` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.

Hors périmètre confirmé : conversation dédiée du ticket (TASK-029) et UI
tickets/revue (TASK-034). Aucun CLI réel ni runner privilégié n’est lancé.
