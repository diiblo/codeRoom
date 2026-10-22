# Compatibilité et validation fournisseur

Les capacités évoluent selon version, OS et mode d'intégration : ce registre n'est **pas** une promesse universelle.

| Fournisseur | Piste initiale | Points à vérifier localement |
|---|---|---|
| Codex | CLI non interactif et sortie structurée ; explorer app-server/SDK si besoin | format exact événements, authentification, session, interruptions, approbations, confinement |
| Claude Code | Mode non interactif / sortie structurée | reprises, autorisations, messages tool-use, interruption, support de la plateforme |
| Gemini CLI | Mode headless JSON / stream-json | session et reprise, policies, login, gestion des outils, quotas |
| Antigravity 1.4.5 | CLI hôte `agy` en mode headless `--output-format stream-json --sandbox --mode plan --print=<instruction>` | sortie réelle, authentification native, stabilité, timeout/annulation et politique |
| OpenCode 1.18.15 | `opencode run --format json --pure [--model provider/model]` non interactif | session native, permissions, événements JSONL, annulation, confinement et configuration locale |

## Protocole d'essai P0
1. Détecter version, commande d'aide et statut login sans demander de secrets en sortie.
2. Exécuter une requête sans modification de fichiers, capturer sortie et code de retour.
3. Déclencher annulation et timeout ; mesurer résultat observé.
4. Tester une tentative d'action interdite en environnement de test confiné.
5. Tester reprise **si documentée** ; enregistrer `supported/unsupported/unverified`.
6. Vérifier mode structuré d'action : contrôle serveur, pas interprétation opportuniste de texte.

## Documents officiels de référence (à vérifier pour la version installée)
- https://developers.openai.com/codex/non-interactive
- https://developers.openai.com/codex/app-server
- https://code.claude.com/docs/en/headless
- https://geminicli.com/docs/cli/headless/
- https://geminicli.com/docs/cli/cli-reference/
- https://opencode.ai/v2/docs/cli/commands

**Important :** ne pas déclarer la reprise/permission d'un outil opérationnelle à partir de la seule présence d'un drapeau CLI ; tester le comportement réel.
