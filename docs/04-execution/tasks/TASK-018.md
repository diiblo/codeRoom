# TASK-018 — Développer adaptateur Codex validé

**Jalon :** V1-A · **Statut :** terminée — adaptateur, session hôte et smoke réel validés

## Objectif

Piloter une version installée de Codex depuis le runner contrôlé.

## Contexte

Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références

- `../../03-contracts/agent-adapter.md`
- `../../03-contracts/provider-compatibility.md`

## Prérequis

- TASK-015
- TASK-017

## Périmètre

Détection version/login, appel non interactif selon documentation/version réelle, normalisation sorties et annulation.

## Hors périmètre

Pas de dépendance au format d’un autre fournisseur.

## Spécifications

Ne déclarer resume/actions/approuvals supported qu’après test ; adapter les erreurs au contrat.

## Contraintes techniques

Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation

- [x] Une instruction simple retourne des événements normalisés et une fin
      fiable avec un processus Codex simulé par injection.
- [x] Annulation et timeout testés avec terminaison du processus et résultat
      observable.

## Vérification

Tests de contrat fake + smoke test réel sous confinement avec session disponible. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- `src/server/adapters/codex.ts` implémente `CodexAgentAdapter` autour de la
  surface documentée `codex exec --json`. L'appel est lancé avec `shell: false`,
  `--ephemeral`, `--sandbox read-only`, un workspace fourni par le runner et un
  environnement explicitement fourni ; aucun environnement hôte n'est hérité.
  Le transport de processus est obligatoire et injecté par le runner : il n'y
  a plus de fallback `spawn` local dans le conteneur.
- `src/server/runner/broker.ts` expose le transport d'exécution brokerisé sous
  forme de flux NDJSON borné (`stdout`, `stderr`, `completed`) et
  `src/server/adapters/codex-broker.ts` l'adapte au contrat de processus Codex.
  Une réponse distante non valide, trop volumineuse ou refusée échoue fermé.
- `probe()` vérifie `--version`, puis `login status` sans afficher de secret.
  La sortie JSONL est bornée, les événements `thread.started`, `item.*`,
  `turn.*` et `error` sont normalisés vers le contrat CodeRoom, et les valeurs
  sensibles configurées sont expurgées.
- `nativeResume`, `nativeApproval` et `structuredActions` restent
  `unsupported`. Le streaming reste `unverified` jusqu'à l'observation d'un
  `turn.completed` réel ; aucune capacité avancée n'est déduite d'un simple
  drapeau CLI.
- `src/server/adapters/codex.test.ts` couvre la détection version/login, la
  commande sans shell, la normalisation JSONL, l'expurgation, la sortie
  malformée, l'absence de workspace, l'annulation et le timeout. Les tests
  utilisent uniquement un processus injecté et bénin.

Le client broker accepte désormais les plans `execution=enabled` uniquement
après validation de la gate Windows, tout en conservant le refus
`disabled-until-windows-proof` par défaut. Le harnais
`tools/host-broker/prove-windows-broker.ps1` propose un mode explicite
`-RunRealCodex` qui lance uniquement `codex exec --json --ephemeral
--sandbox read-only --skip-git-repo-check` dans un workspace temporaire et
attend la réponse `CODEROOM_REAL_SMOKE_OK`.

Le mode session hôte est désormais explicite avec `-EnableHostSession` côté
broker et `sessionMode=host-login` dans le plan. Il lance le CLI Windows avec
le profil du compte déjà connecté (`codex login`) sans copier `auth.json`, sans
clé API et sans passerelle fournisseur. Le mode isolé AppContainer reste le
mode par défaut avec un `CODEX_HOME` temporaire ; la preuve native du mode
session hôte est validée pour le smoke Codex. Son usage sur un projet non
fiable reste interdit tant qu'une preuve d'isolation propre au fournisseur
n'est pas disponible.

Une première exécution native avec `codex login` actif a confirmé le lancement
réel en mode `host-login`, mais a révélé un défaut du harnais : un bloc
`stdout` contenant plusieurs événements JSONL était envoyé en une seule fois à
`ConvertFrom-Json`. Le parseur a été corrigé pour traiter chaque ligne NDJSON
séparément. La seconde exécution a retourné `status=passed`,
`health/discovery/plan/execution/realExecution=true`,
`sessionMode=host-login`, `CODEROOM_REAL_SMOKE_OK` et `exitCode=0`.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/runner/broker.test.ts src/server/adapters/codex.test.ts src/server/adapters/codex-broker.test.ts` — 3 fichiers, 14 tests passés.
- `docker compose run --rm api npm test` — 30 fichiers, 137 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès après formatage.
- `docker compose run --rm api npm run build` — succès ; avertissement non
  bloquant sur la taille d'un chunk frontend.
- `docker compose config --quiet` — succès.

La documentation officielle utilisée est [le mode non interactif Codex](https://learn.chatgpt.com/docs/non-interactive-mode),
[la référence de configuration des fournisseurs](https://learn.chatgpt.com/docs/config-file/config-reference) et
[l'authentification](https://learn.chatgpt.com/docs/auth).

## Restrictions restantes

Le smoke réel en mode isolé a été exécuté depuis PowerShell Windows avec le
binaire `codex.exe` installé. `health`, `discovery`, `plan`, AppContainer, ACL,
workspace synthétique et lancement du processus passent ; Codex reste ensuite
silencieux pendant 120 secondes et le Job Object le termine avec
`status=timed_out`. Ce résultat concerne uniquement le mode isolé avec un
environnement synthétique sans session fournisseur. En mode `host-login`, la
preuve réelle corrigée a observé `thread.started`, `turn.started`,
`item.completed` avec `CODEROOM_REAL_SMOKE_OK`, puis `turn.completed`, et le
processus s'est terminé avec succès. Le message stderr
`Reading additional input from stdin` est informatif ; il n'a pas empêché la
réussite du processus ni du harnais.

TASK-018 est terminée pour l'adaptateur Codex et son transport brokerisé. Le
mode session hôte reste réservé aux projets de confiance jusqu'à validation
d'une isolation native propre au fournisseur ; cette restriction ne doit pas
être contournée par un flag permissif.

Commande de reproduction, à exécuter depuis PowerShell Windows natif avec une
session Codex déjà ouverte par `codex login` :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\host-broker\prove-windows-broker.ps1 `
  -WorkspaceRoot (Join-Path $env:USERPROFILE 'CodeRoom\workspaces') `
  -RunRealCodex `
  -UseHostSession
```

## Définition de terminé

Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
