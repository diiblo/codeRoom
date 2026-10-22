# TASK-035 — Tester scénarios E2E et reprise

**Jalon :** Release · **Statut :** terminée — scénarios E2E/reprise et preuves CLI réelles validés

## Objectif
Vérifier collaboration inter-fournisseurs et livraison de bout en bout.

## Contexte
Cette tâche contribue à la livraison Release de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../05-quality/acceptance.md`
- `../../05-quality/testing.md`

## Prérequis
- TASK-018
- TASK-019
- TASK-021
- TASK-022
- TASK-026
- TASK-033
- TASK-034

## Périmètre
Scénario A crée ticket B exécute et demande revue ; tests crash/reload/reconnect/annulation.

## Hors périmètre
Ne pas élargir aux fonctionnalités V2.

## Spécifications
Marquer les essais réels non réalisables comme bloqués, jamais passés ; pas d’effet externe répété.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Scénarios V1-A/V1-B du périmètre E2E et reprise couverts.
- [x] Preuves de deux CLI réels après gate.

## Vérification
Le harnais [`src/server/release/e2e.test.ts`](../../../src/server/release/e2e.test.ts)
couvre avec le fournisseur fictif :

- le parcours ticket créé et assigné → exécution fake → livrable Git/test →
  soumission en revue → acceptation humaine ;
- la réconciliation d'une exécution `running` en `unknown` après fermeture et
  réouverture de SQLite ;
- l'annulation d'une exécution fake en pause, sans sortie postérieure à l'arrêt.

La reconnexion WebSocket et la reprise après curseur restent vérifiées par
`src/server/http/events-websocket.test.ts`.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/release/e2e.test.ts src/server/http/events-websocket.test.ts` — 2 fichiers, 6 tests passés.
- `docker compose run --rm api npm test` — 32 fichiers, 142 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non
  bloquant sur la taille d'un chunk frontend.
- `docker compose config --quiet` — succès.

Environnement vérifié : Node/npm et tous les contrôles sont exécutés dans le
conteneur API ; Docker Compose est la configuration active. Les preuves
PowerShell Windows natives ont validé Codex, Antigravity et OpenCode via le
broker local authentifié, en mode `host-login`, sans clé API injectée. Les
smokes Antigravity et OpenCode ont renvoyé `CODEROOM_CLI_SMOKE_OK` avec
`exitCode: 0` ; OpenCode utilise le modèle gratuit
`opencode/deepseek-v4.1-flash-free`. Le smoke Codex a renvoyé
`CODEROOM_REAL_SMOKE_OK` avec `exitCode: 0`.

Limite résiduelle : aucun navigateur automatisé n'est installé dans le dépôt,
donc la validation d'interface reste manuelle ; cela ne remet pas en cause les
scénarios backend et brokerisés couverts par cette tâche. Les audits de
sécurité, de sauvegarde et la publication MVP restent suivis par TASK-036 à
TASK-038.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
