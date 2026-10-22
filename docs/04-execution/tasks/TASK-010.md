# TASK-010 — Implémenter conversations et participants

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Maintenir les conversations principales et directes d’un projet.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/messaging.md`
- `../../01-architecture/domain-model.md`

## Prérequis
- TASK-007
- TASK-009

## Périmètre
Types main/direct, participants, vérifications membership et unicité de groupe principal.

## Hors périmètre
Pas de ticket conversation avant TASK-029.

## Spécifications
Une discussion directe reste dans un projet ; accès interdit aux non-participants.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Aucun agent non participant n'accède à une conversation directe.
- [x] Une seule conversation `main` est garantie par projet.

## Vérification
Tests conversation directe cross-project et participants. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- La migration `0005_conversation_participants.sql` ajoute les participants
  explicites des conversations directes et la table d'idempotence des créations.
- `ConversationService` crée les conversations `direct` dans un projet actif,
  vérifie que chaque participant possède une affectation active dans ce même
  projet et conserve la création idempotente.
- Les conversations `main` utilisent l'index unique existant et dérivent leurs
  participants des affectations actives du projet. Une affectation révoquée
  disparaît donc immédiatement des membres effectifs du `main`.
- Les conversations directes contrôlent l'appartenance explicite avant lecture,
  ajout ou retrait. Un agent membre du projet mais absent de la conversation
  privée est refusé ; une référence d'un autre projet est rejetée.
- L'ajout et le retrait d'un participant sont idempotents. Les conversations
  `ticket` restent hors périmètre conformément à TASK-029.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test` — 32 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose run --rm api npm run db:migrate` — migration v5 appliquée.

Restrictions restantes : la membership humaine, les messages persistants,
l'API HTTP et les événements d'audit restent des tâches ultérieures ; ce lot
ne lance aucune CLI.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
