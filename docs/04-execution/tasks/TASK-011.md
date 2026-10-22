# TASK-011 — Persister et lire les messages

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Assurer la communication durable sans activation implicite.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/messaging.md`
- `../../03-contracts/api.md`

## Prérequis
- TASK-010
- TASK-006

## Périmètre
Écriture/lecture paginée de messages avec auteur serveur, refs structurées minimales et permissions.

## Hors périmètre
Pas de notifications/mentions : TASK-021.

## Spécifications
L’authorId vient de l’identité validée ; aucun message ordinaire n’appelle le runner.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] L'historique persiste et l'ordre de page est stable via un curseur `(created_at, id)`.
- [x] L'usurpation de l'auteur est refusée par l'identité serveur et l'autorisation.

## Vérification
Tests DB persistance, pagination, expurgation et auteur non falsifiable. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- La migration `0006_messages.sql` ajoute les messages immuables, leur index
  d'ordre par conversation et la table d'idempotence des créations.
- `MessageService` vérifie l'appartenance à la conversation et la permission
  `message.send` avant chaque écriture. L'auteur enregistré provient de
  l'identité serveur validée ; un `untrustedAuthorId` contradictoire est rejeté.
- Les lectures exigent `message.read` et utilisent une pagination par curseur
  stable sur `(created_at, id)`. Les références cross-project ou vers une
  conversation inaccessible sont refusées.
- Les références sont normalisées vers les seuls champs `type`/`id`, ce qui
  expurge les métadonnées arbitraires avant persistance. Les messages sont
  relus après fermeture et réouverture de SQLite.
- Envoyer un message ne crée aucune exécution et n'appelle aucun CLI.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test` — 36 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose run --rm api npm run db:migrate` — migration v6 appliquée.

Restrictions restantes : les routes HTTP, les notifications, les mentions et
l'audit persistant restent des tâches ultérieures ; le modèle de membership
humaine n'est pas encore activé.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
