# TASK-020 — Relier sessions fournisseur aux affectations

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Isoler systématiquement les contextes d’un même agent entre projets.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../01-architecture/domain-model.md`
- `../../03-contracts/execution.md`

## Prérequis
- TASK-009
- TASK-016

## Périmètre
Session persistée avec assignmentId et providerSessionKey facultative et statut ; validate accès avant reprise.

## Hors périmètre
Ne pas inventer une mémoire partagée globale.

## Spécifications
Session A/projet 1 refusée dans projet 2 ; option resume seulement si capacité testée.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Même agent dans 2 projets reçoit des sessions distinctes.
- [x] Une tentative cross-project est rejetée.

## Vérification
Tests de mapping session/project et absence fuite contexte. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- La migration `0010_execution_session_scope.sql` ajoute le statut de session
  (`active` ou `revoked`) et un `context_scope` persistant, borné au projet et
  à l'affectation de l'exécution. Les anciennes lignes retombent sur les clés
  relationnelles si leur contexte JSON est vide.
- `ExecutionService` renseigne le contexte depuis l'exécution contrôlée ; il
  n'est pas fourni par le prompt. Deux affectations du même agent dans deux
  projets produisent deux sessions avec des contextes distincts.
- `SessionService.prepareResume` vérifie le projet, l'affectation, le contexte,
  l'identité authentifiée et `execution.request` avant d'autoriser une reprise.
  Une capacité `nativeResume` `unverified` ou `unsupported` est refusée. Une
  session révoquée ne peut pas être reprise ; sa révocation est idempotente et
  auditée.
- Aucun contexte global partagé n'est créé et aucune session fournisseur n'est
  exposée entre projets.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- src/server/sessions/service.test.ts` — 3 tests passés.
- `docker compose run --rm api npm test -- src/server/db/database.test.ts` — 5 tests passés.
- `docker compose run --rm api npm test` — 16 fichiers, 65 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose config --quiet` — succès.

Restriction restante : la reprise réelle d'un fournisseur reste conditionnée
par la capacité effectivement testée de son adaptateur ; aucun CLI réel n'est
lancé par cette tâche.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
