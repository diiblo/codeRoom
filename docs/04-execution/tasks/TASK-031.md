# TASK-031 — Allouer espace Git et verrou d’écriture

**Jalon :** V1-B · **Statut :** terminée

## Objectif
Garantir des modifications contrôlées sans conflits concurrents au MVP.

## Contexte
Cette tâche contribue à la livraison V1-B de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/git-deliverables.md`
- `../../03-contracts/execution.md`

## Prérequis
- TASK-016
- TASK-017
- TASK-030

## Périmètre
Stratégie de workspace approuvée par projet/ticket, réservation et verrou persisté, nettoyage prudent.

## Hors périmètre
Pas de worktrees multi-agent parallèles V3.

## Spécifications
Un seul écrivain par zone ; crash implique conciliation du verrou ; le worktree n’est pas sandbox.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Deux writers concurrents sérialisés ou rejetés.
- [x] pas d’effacement de données inconnues.

## Vérification
Tests concurrents sur dépôt temporaire et crash simulé. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.

## Réalisation et preuves

- La migration v19 ajoute les workspaces projet/ticket, les demandes
  d'allocation idempotentes, le verrou courant par dépôt et l'historique des
  grants de verrou.
- Le MVP utilise la stratégie explicite `shared_repository` : le chemin du
  workspace est le dépôt déjà autorisé par TASK-030. Aucun clone, worktree
  parallèle ou appel Git n'est lancé ; TASK-031 protège la réservation, pas la
  sandbox d'exécution.
- `WorkspaceService` réserve atomiquement un dépôt, émet une lease bornée,
  refuse le second writer, recoupe une exécution avec le projet et le workspace
  demandé, puis libère le verrou avec son token.
- Une lease expirée devient `reconciliation_required` et bloque toute reprise
  automatique. Seule une réconciliation humaine explicite peut débloquer le
  dépôt. Le retrait d'un workspace est logique et ne supprime jamais de fichiers
  inconnus.

Commandes réellement exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/workspaces/service.test.ts src/server/db/database.test.ts` — 2 fichiers, 15 tests passés.
- `docker compose run --rm api npm test` — 24 fichiers, 107 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose config --quiet` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.

Restriction résiduelle : l'allocation ne crée pas encore de worktree isolée et
le runner réel reste soumis à la preuve Linux native de TASK-017. Le
parallélisme V3 et la capture des livrables Git relèvent respectivement des
évolutions futures et de TASK-032.
