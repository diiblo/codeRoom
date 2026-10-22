# TASK-009 — Gérer les affectations et droits projet

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Autoriser un profil à participer à un projet donné avec des droits explicités.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/projects.md`
- `../../02-features/agents.md`

## Prérequis
- TASK-006
- TASK-007
- TASK-008

## Périmètre
Créer, désactiver et consulter l’affectation en respectant unicité et projet actif.

## Hors périmètre
Pas de gestion des équipes réutilisables.

## Spécifications
PermissionSet appartient à l’affectation ; désactivation empêche nouveaux lancements ; historique conservé.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Deux projets pour le même agent restent indépendants.
- [x] Les permissions révoquées sont immédiatement appliquées par l'autorisation serveur.

## Vérification
Tests DB d’unicité et contrôles d’accès par projet. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- La migration `0004_assignment_requests.sql` persiste les empreintes de
  création idempotente des affectations.
- `AssignmentService` crée, consulte, modifie les permissions et désactive les
  affectations. L'index unique existant sur `(project_id, agent_id)` pour les
  affectations actives est complété par un contrôle transactionnel.
- Un même agent peut avoir une affectation active dans plusieurs projets avec
  des ensembles de permissions distincts. Une affectation archivée conserve
  son historique et libère le couple pour une nouvelle affectation.
- Les créations et modifications exigent un projet actif et un agent actif ;
  un projet ou agent inconnu est refusé. Une affectation archivée ne peut plus
  être modifiée.
- Les permissions sont validées contre le registre canonique et normalisées.
  `AuthorizationService` relit l'affectation après modification : une
  permission retirée est immédiatement refusée, et une affectation désactivée
  n'autorise plus de nouvel accès.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test` — 28 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose run --rm api npm run db:migrate` — migration v4 appliquée.

Restrictions restantes : les routes HTTP et les événements d'audit persistants
restent du périmètre de tâches ultérieures ; cette tâche ne crée ni équipe
réutilisable ni session CLI.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
