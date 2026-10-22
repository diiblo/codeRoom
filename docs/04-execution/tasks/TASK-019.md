# TASK-019 — Développer second adaptateur validé

**Jalon :** V1-A · **Statut :** terminée — adaptateurs et preuves natives validés

## Objectif
Intégrer un second fournisseur distinct, choisi et vérifié par le propriétaire,
en conservant le même broker pour les autres CLI installés.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../03-contracts/provider-compatibility.md`
- `../../03-contracts/agent-adapter.md`

## Prérequis
- TASK-015
- TASK-017

## Périmètre
Détection, mode headless, sorties, annulation, auth et capabilities d'Antigravity
ou d'OpenCode. Le catalogue broker Windows enregistre désormais `codex`,
`antigravity` et `opencode`, avec recherche PATH ou chemin explicite.

## Hors périmètre
Pas de mélange des formats fournisseur dans un adaptateur : chaque CLI garde
son adaptateur et sa preuve, mais passe par le même contrat brokerisé.

## Spécifications
Séparer les options spécifiques ; enregistrer version testée ; échec mode non interactif explicite.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Contrat identique au mock et usage réel supervisé possible.

## Vérification
Suite de contrat + smoke test fournisseur choisi sur OS validé. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## État actuel

- Le broker Windows utilise un catalogue explicite partagé par la découverte et
  la planification : `codex`, `antigravity` (`agy`) et `opencode`.
- Versions observées sur l'hôte Windows du propriétaire : Antigravity `1.4.5`
  et OpenCode `1.18.15`. La découverte, l'aide CLI et les preuves d'exécution
  native décrites ci-dessous ont été réalisées avec ces installations.
- Chaque outil est recherché dans ses emplacements connus ou dans `PATH` ; un
  chemin explicite peut remplacer la découverte sans ouvrir l'exécution d'un
  binaire non enregistré.
- Le client TypeScript accepte les identifiants et chemins de découverte sans
  exposer les chemins Windows à l'interface.
- `src/server/adapters/cli.ts` fournit le transport NDJSON commun, borné,
  annulable et injecté ; il ne lance jamais un processus hôte depuis le
  conteneur.
- `src/server/adapters/antigravity.ts` utilise `agy --output-format
  stream-json --sandbox --mode plan --print=<instruction>` sans
  `--dangerously-skip-permissions`.
- `src/server/adapters/opencode.ts` utilise `opencode run --format json --pure`
  sans `--auto`, sonde l'authentification locale par `opencode auth list` et
  accepte un sélecteur `provider/model` explicite.
- Le broker conserve une limite de 512 MiB pour les autres outils et applique
  automatiquement 2048 MiB à OpenCode, dont le runtime Bun/JSC dépasse la
  réservation initiale de 512 MiB ; `-ExecutionMemoryLimitMb` permet un
  réglage explicite au démarrage du broker.
- `src/server/adapters/registry.ts` enregistre explicitement les trois
  adaptateurs et conserve leurs parseurs fournisseur séparés.
- `docker compose run --rm api npm test -- --run src/server/adapters/cli.test.ts src/server/adapters/registry.test.ts src/server/adapters/codex.test.ts src/server/adapters/codex-broker.test.ts` — 4 fichiers, 13 tests passés.
- `docker compose run --rm api npm test` — 32 fichiers, 142 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non
  bloquant sur la taille d'un chunk frontend.
- `docker compose config --quiet` — succès.
- Parse syntaxique PowerShell statique des scripts broker/proof dans
  `mcr.microsoft.com/powershell:7.4-ubuntu-22.04` — succès.
- Correction du harnais générique : un chemin fournisseur facultatif vide est
  maintenant accepté, afin de permettre la résolution OpenCode via `PATH`
  sans imposer un chemin propre à l'utilisateur.
- Correction des arguments Antigravity : le prompt est attaché à `--print` et
  `--output-format` est placé avant ce drapeau.
- Le modèle OpenCode est configurable par `--model` ; le harnais accepte
  `-OpenCodeModel`, avec `opencode/deepseek-v4.1-flash-free` comme modèle de
  smoke gratuit par défaut, sans imposer une clé API ni un modèle à tous les
  comptes.
- Le harnais `tools/host-broker/prove-windows-cli.ps1` fournit désormais la
  même preuve `health → discovery → plan → execute` pour chaque outil du
  catalogue, avec ses arguments headless spécifiques et sans clé API.
- Découverte Windows native via `discover-windows.ps1` — succès : `codex`
  (`known-path`), `antigravity`/`agy` (`known-path`) et `opencode.cmd`
  (`PATH`) détectés ; `missing=[]`.

Les tests ci-dessus sont des tests de contrat avec processus injectés. Les
premiers essais natifs avaient été refusés avant démarrage du broker à cause
d'un chemin fournisseur facultatif vide ; ce prérequis est maintenant corrigé.
La découverte Windows réelle est passée. Antigravity et OpenCode sont validés
en session hôte avec `health`, `discovery`, `plan`, `execution` et
`realExecution` à `true`, `exitCode=0`, et le marqueur
`CODEROOM_CLI_SMOKE_OK`. OpenCode a été validé avec le modèle gratuit
`opencode/deepseek-v4.1-flash-free`. Les événements réels reçus sont
`step_start → text → step_finish(reason=stop)`.

Commande de preuve native à exécuter depuis PowerShell Windows, avec la
session locale du fournisseur déjà ouverte :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\host-broker\prove-windows-cli.ps1 `
  -WorkspaceRoot (Join-Path $env:USERPROFILE 'CodeRoom\workspaces') `
  -ToolId antigravity `
  -UseHostSession
```

Puis remplacer `antigravity` par `opencode` et ajouter
`-OpenCodeModel 'opencode/deepseek-v4.1-flash-free'` pour reproduire la seconde
preuve. Les deux résultats JSON complets ont été fournis dans le compte rendu ;
une exécution directe hors broker ne compte pas.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
