# TASK-029 — Lier une conversation unique à chaque ticket

**Jalon :** V1-B · **Statut :** terminée

## Objectif
Donner à chaque ticket un espace de discussion persistant.

## Contexte
Cette tâche contribue à la livraison V1-B de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/tickets.md`
- `../../02-features/messaging.md`

## Prérequis
- TASK-010
- TASK-011
- TASK-027

## Périmètre
Créer la conversation `ticket` transactionnellement à la création du ticket et vérifier ses participants.

## Hors périmètre
Pas de groupes temporaires libres.

## Spécifications
Une seule conversation active par ticket, même en appels concurrents ; visibilité limitée au projet.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Ticket et conversation toujours synchronisés.
- [x] Aucune conversation orpheline.

## Vérification
Tests transaction, concurrence, permission et récupération historique. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.

## Réalisation et preuves

- `migrations/0017_ticket_conversations.sql` ajoute le lien ticket-conversation,
  l’index unique par ticket et la reprise des tickets existants.
- `ConversationService` prend en charge le type `ticket`, sa création
  idempotente, ses participants dérivés des affectations actives et son
  cloisonnement projet.
- `TicketService` crée la conversation dans la même transaction que le ticket,
  y compris lors d’une reprise idempotente d’un ticket existant.
- Les conversations ticket sont incluses dans `GET
  /api/projects/:projectId/conversations` et peuvent être lues par le service
  de messages ; l’interface affiche leur nature dédiée.
- Les tests couvrent unicité SQLite, répétition, participants projet, accès
  cross-project refusé, historique de messages, reload et exposition API.

Les skills `react-patterns` puis `frontend-design` ont été utilisés pour la
mise à jour minimale et accessible du client React.

Commandes réellement exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/conversations/service.test.ts src/server/tickets/service.test.ts src/server/http/api.test.ts src/server/db/database.test.ts` — 4 fichiers, 19 tests passés.
- `docker compose run --rm api npm test` — 21 fichiers, 90 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose config --quiet` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.

Les groupes temporaires libres et l’UI complète tickets/revue restent hors
périmètre, respectivement selon la spécification et TASK-034.
