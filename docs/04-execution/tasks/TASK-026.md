# TASK-026 — Créer activité et boîte d’approbations UI

**Jalon :** V1-A · **Statut :** en cours — interface et API livrées, validation UI restante

## Objectif
Visualiser processus, incidents et décisions humaines à prendre.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/supervision.md`
- `../../02-features/approvals.md`

## Prérequis
- TASK-014
- TASK-016
- TASK-023
- TASK-024

## Périmètre
Vues activité projet/exécution, état et erreurs, liste pending, boutons annuler/accepter/refuser avec confirmations.

## Hors périmètre
Pas de statistiques de coût non disponibles.

## Spécifications
Statut issu DB/API ; filtrage projet ; rien ne s’auto-approuve.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [ ] Après reload, erreurs/approbations toujours visibles.
- [ ] action refusée reste bloquée.

## Vérification
Tests UI erreurs, autorisations et reload. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- `src/web/ActivityView.tsx` affiche les exécutions, erreurs, approbations,
  confirmations, refus serveur et journal durable agent sans afficher les
  payloads d’action.
- `src/web/api.ts` expose les lectures et mutations d’activité avec clés
  d’idempotence.
- `src/server/executions/service.ts` fournit la lecture filtrée par projet.
- `src/server/http/api.ts` expose les quatre routes du périmètre, cloisonne les
  exécutions agent par conversation projet, borne l’annulation à l’affectation
  cible et conserve la décision propriétaire en fail-closed.
- `src/server/http/api.test.ts` vérifie la lecture persistante, le filtre
  cross-project et le refus `403` qui laisse l’approbation `pending`.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/http/api.test.ts` — 5 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm test` — 19 fichiers, 82 tests passés.
- `docker compose run --rm api npm run build` — succès.

Restriction restante : aucun navigateur automatisable n’est installé, donc les
critères UI de reload, confirmation et rendu d’erreur restent à valider par
une session navigateur. L’authentification applicative du propriétaire humain
reste également hors du dépôt ; accepter/refuser est volontairement refusé
par le serveur tant que cette gate n’est pas injectée.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
