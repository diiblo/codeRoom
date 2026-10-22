# TASK-007 — Créer service projets et groupe principal

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Créer un projet avec un groupe principal atomiquement.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/projects.md`
- `../../01-architecture/domain-model.md`

## Prérequis
- TASK-004
- TASK-006

## Périmètre
Service de création/liste/archivage de projet et invariant une conversation main.

## Hors périmètre
Pas de documents, jalons ni équipes.

## Spécifications
Transaction projet + groupe ; unicité ; appel répété idempotent ; archivé non mutable.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Un seul `main` garanti par l'index unique SQLite et la transaction de création.
- [x] Aucune écriture de modification n'est autorisée sur un projet archivé.

## Vérification
Tests SQLite sur création répétée, échec au milieu de la transaction et archivage. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- Ajout de la migration `0002_project_conversations.sql` avec la table des
  conversations, l'index unique partiel `(project_id) WHERE kind = 'main'` et
  la table des requêtes de création idempotentes.
- Ajout de `ProjectService` pour créer, lister, modifier et archiver les
  projets. La création du projet, de sa conversation `main` et de sa clé
  d'idempotence est transactionnelle.
- Les répétitions avec la même empreinte retournent le même agrégat ; une
  réutilisation contradictoire de la clé est refusée ; une erreur de création
  de la conversation annule le projet et la demande associée.
- Les projets archivés restent lisibles mais ne sont plus modifiables ; leur
  archivage est idempotent.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test` — 20 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose run --rm api npm run db:migrate` — migration appliquée.

Restrictions restantes : les routes HTTP et l'intégration avec l'autorisation
à la frontière API restent du périmètre de tâches ultérieures ; les documents,
jalons et équipes ne sont pas concernés par cette tâche.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
