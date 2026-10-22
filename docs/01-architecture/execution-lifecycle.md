# Cycle de vie des exécutions

## États canoniques
`queued`, `running`, `awaiting_approval`, `succeeded`, `failed`, `cancelled`, `unknown`.

`queued -> running` ; `running -> awaiting_approval -> running` (approbation), ou `awaiting_approval -> cancelled` (refus). `running -> succeeded|failed|cancelled|unknown`. `queued -> cancelled`. `unknown` n'est jamais « réussi » par défaut. Les états terminaux sont immuables ; reprendre crée une **nouvelle exécution** liée à l'ancienne, éventuellement avec la session fournisseur si supportée.

## Création
1. Enregistrer le déclenchement (`triggerId` unique) et le contrôle d'accès.
2. Persister `Execution(queued)` et son événement dans une transaction.
3. Le runner réserve l'exécution sous verrou/lease locale persistée ; limite de concurrence configurable, **1 exécution à la fois par défaut pour une affectation**.
4. Contrôler l'environnement, les permissions, les capacités détectées et les politiques d'approbation avant lancement.
5. Envoyer événements structurés persistables et diffuser l'avancement côté UI.

## Arrêt et reprise
Annulation demandée → signal gracieux → délai borné → terminaison forcée de l'arbre de processus si possible → état prouvé `cancelled`, sinon `unknown`. Après redémarrage, réconcilier tous les `running/awaiting_approval` : ne jamais déclarer `succeeded` sans résultat fiable. Si la commande a pu produire des effets externes, exiger une intervention avant réexécution.

## Politique anti-boucles
Maximum de déclenchements automatiques par chaîne de corrélation ; profondeur et durée configurables, valeurs fixées et documentées en phase d'implémentation ; une réponse d'agent n'entraîne pas une nouvelle exécution sans demande explicite structurée ou mention autorisée. `@tous` est informatif.

## Pannes
CLI introuvable, login manquant, sortie malformée, dépassement de temps, arrêt host, échec sandbox : fournir erreur codée, trace d'audit et état vérifiable. Aucun retry aveugle d'une action à effets de bord.

Voir [contrat d'exécution](../03-contracts/execution.md) et [spécification orchestration](../02-features/orchestration.md).
