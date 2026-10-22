# TASK-024 — Construire navigation projets et collaborateurs

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Afficher et créer les projets/agents/affectations depuis une UI locale.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../00-product/personas-journeys.md`
- `../../02-features/projects.md`
- `../../02-features/agents.md`

## Prérequis
- TASK-013

## Périmètre
Layout 3 zones simplifié, formulaires validation, écrans projet et collaborateurs, états vide/erreur.

## Hors périmètre
Pas de tableaux de bord sophistiqués ni gestion équipes.

## Spécifications
Appels aux vraies API ; ne pas hardcoder des données ; conserver distinction agent actif et CLI disponible.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Créer projet, agent et affectation depuis l’UI via les vraies routes API.
- [x] Le groupe principal est affiché depuis l’agrégat projet renvoyé par le
  serveur.
- [x] Les erreurs API, réseau et validation sont visibles dans une alerte
  lisible.

## Vérification
La suite métier existante reste verte ; le build Vite et un smoke test des
conteneurs vérifient que l’interface et l’API sont effectivement servies.
L’environnement ne contient pas de navigateur automatisable ni de harness de
tests DOM : aucun scénario navigateur n’est déclaré comme exécuté.

Commandes réellement exécutées dans Docker :

- `docker compose run --rm api npm run typecheck`
- `docker compose run --rm api npm run lint`
- `docker compose run --rm api npm run format:check`
- `docker compose run --rm api npm test` — 19 fichiers, 81 tests passés
- `docker compose run --rm api npm run build`
- `docker compose config --quiet`
- `docker compose up -d --build api web`
- smoke HTTP : `GET http://127.0.0.1:3000/api/v1/status`, `GET
  http://127.0.0.1:5173/` et liste projet filtrée par `org_local`

L’organisation locale `org_local` est provisionnée par migration idempotente
pour rendre le premier démarrage utilisable sans fabriquer de données de projet
ou d’agent dans le frontend.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ;
tests et smoke checks exécutés ; aucune régression connue critique ; absence de
test navigateur automatisé explicitement signalée.
