# TASK-032 — Capturer livrables Git et preuves de tests

**Jalon :** V1-B · **Statut :** terminée — capture livrée, inspecteur réel conditionné à TASK-017

## Objectif
Relier un résultat vérifiable à un ticket et à son exécution.

## Contexte
Cette tâche contribue à la livraison V1-B de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/git-deliverables.md`
- `../../02-features/tickets.md`

## Prérequis
- TASK-027
- TASK-031

## Périmètre
Capturer diff/status/gitRef, preuve test (commande, sortie expurgée, résultat, temps), provenance.

## Hors périmètre
Pas de fusion ni push automatique.

## Spécifications
Ref inconnue refusée ; texte d’agent seul ne vaut pas résultat ; chemins contrôlés.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Livrable consultable, référence Git valide, test échoué clairement marqué.

## Vérification
Tests dépôt temporaire : ref valide/invalide, test success/failure, provenance. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.

## Compte rendu d'exécution

La migration v20 ajoute les livrables, les demandes de soumission idempotentes
et les preuves de tests. `DeliverableService` recoupe le ticket, l'exécution,
le projet, le workspace et le verrou d'écriture avant de persister une
provenance Git (`gitRef`, commit, branche, état du dépôt et diff) ainsi que les
preuves issues uniquement du runner contrôlé. Les sorties et diffs sont
expurgés avant stockage ; une preuve échouée reste explicitement `failed` avec
son code de sortie. Les événements `deliverable.submitted` ne contiennent pas
les sorties brutes.

Les tests couvrent une référence valide/invalide, une référence dangereuse, la
provenance du workspace, l'idempotence, le verrou perdu, les preuves
`passed`/`failed`, les sorties expurgées et le refus d'une preuve déclarée hors
runner. Sans fournisseur injecté, l'inspection Git échoue fermé avec
`CAPABILITY_UNAVAILABLE` ; aucun CLI Git ni outil hôte n'est exécuté par cette
tâche. Le raccordement à un inspecteur réel reste soumis à la preuve de
confinement de TASK-017.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/deliverables/service.test.ts src/server/db/database.test.ts` — 2 fichiers, 11 tests passés.
- `docker compose run --rm api npm test` — 25 fichiers, 113 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.
- `docker compose config --quiet` — succès.
