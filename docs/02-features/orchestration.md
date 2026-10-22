# Orchestration et sessions — V1-A

## Objectif
Traduire les intentions autorisées en exécutions traçables, sans masquer les différences des CLI.

## Règles
- Un registre de fournisseurs détecte exécutable, version, capacité et statut d'authentification **sans afficher de secret**.
- Chaque lancement porte l'agent, l'affectation, le projet, une intention source et un espace autorisé.
- Les sessions fournisseur sont créées dans un contexte projet ; une `providerSessionKey` ne peut être utilisée par un autre projet.
- Exécutions via file persistante ; états et transitions dans [cycle](../01-architecture/execution-lifecycle.md).
- Approbations et restrictions du CLI natif restent actives et ne peuvent être abaissées par un agent.
- Si reprise native absente, proposer nouvelle exécution contrôlée avec contexte explicitement reconstruit ; ne jamais prétendre reprendre une session fournisseur.
- Toute capacité non vérifiée doit être exposée comme `unsupported` ou `unverified`.

## Erreurs
Outil manquant/non authentifié, syntaxe incompatible, JSONL malformé, timeout, interruption, sandbox non prête, double lancement, crash du serveur.

## Acceptation
- Un seul processus réservé pour la même exécution ; `queued` durable.
- Les erreurs de fournisseur n'annoncent jamais un succès.
- Un redémarrage laisse les exécutions incertaines dans un état visible et réconciliable.
- Tout CLI actif a un contexte de projet et de permissions vérifiable.

Références : [adaptateurs](../03-contracts/agent-adapter.md), [exécutions](../03-contracts/execution.md), [sécurité](../01-architecture/security.md).
