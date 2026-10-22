# TASK-030 — Relier un dépôt Git autorisé au projet

**Jalon :** V1-B · **Statut :** terminée

## Objectif
Associer un dépôt local existant sans échapper au périmètre autorisé.

## Contexte
Cette tâche contribue à la livraison V1-B de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/git-deliverables.md`
- `../../01-architecture/security.md`

## Prérequis
- TASK-007
- TASK-017

## Périmètre
Validation chemin canonique, dépôt Git, permissions read/write et stockage chemin dans projet.

## Hors périmètre
Pas de clone/push distant.

## Spécifications
Chemins arbitraires/symlinks non autorisés refusés, erreur explicite si repo absent.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Repo valide lié.
- [x] chemin traversant interdit.
- [x] aucun accès à autre projet.

## Vérification
Tests avec repos temporaires, symlinks et traversal. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.

## Réalisation et preuves

- La migration v18 ajoute l'unicité d'un chemin de dépôt entre projets et la
  table d'idempotence des demandes de liaison.
- `ProjectRepositoryService` refuse les chemins relatifs, les segments `..`,
  les symlinks (y compris les composants parents), les dépôts absents, les
  métadonnées Git incomplètes et les chemins dont la lecture est interdite. Il
  canonicalise le chemin, expose `readable`/`writable`, persiste la liaison dans
  `projects.repository_path` et écrit un événement d'audit.
- `PUT /api/projects/:projectId/repository` est réservé à l'identité humaine,
  exige `Idempotency-Key` et rejoue une requête identique. Un dépôt déjà lié à
  un autre projet est refusé.
- Aucun clone, push, merge ni appel au binaire Git n'est effectué. Les dépôts
  Git avec fichier `.git` indirect (worktree) sont volontairement refusés dans
  ce premier périmètre pour éviter un pointeur de métadonnées hors contrôle.

Commandes réellement exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/projects/repository-service.test.ts src/server/http/repository-api.test.ts src/server/db/database.test.ts` — 3 fichiers, 12 tests passés.
- `docker compose run --rm api npm test` — 23 fichiers, 97 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose config --quiet` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.

Restriction résiduelle : l'identité humaine de l'API repose encore sur le
middleware d'identité local existant ; l'authentification applicative complète
reste une restriction documentée de TASK-013/TASK-017. L'allocation d'espace
et le verrou d'écriture relèvent de TASK-031.
