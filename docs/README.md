# CodeRoom — Spécifications de référence

**Version documentaire :** 1.1-proposition · **Statut :** conception, non implémentée · **Date :** 2026-10-19

CodeRoom est une application web locale, auto-hébergeable, où des agents de développement IA utilisant leurs outils natifs collaborent sur des projets supervisés par l'utilisateur. CodeRoom orchestre la collaboration ; il ne remplace ni les modèles ni les CLI.

## Lire dans cet ordre
1. [Vision](00-product/vision.md), [périmètre et versions](00-product/scope.md), [décisions ouvertes](00-product/decisions-open.md).
2. [Architecture](01-architecture/overview.md), [modèle](01-architecture/domain-model.md), [sécurité](01-architecture/security.md), [cycle des exécutions](01-architecture/execution-lifecycle.md).
3. [Contrats](03-contracts/README.md) puis [spécifications fonctionnelles](02-features/README.md).
4. [Plan d'exécution](04-execution/plan.md), [dépendances](04-execution/dependencies.md), [tâches](04-execution/tasks/README.md), [qualité](05-quality/acceptance.md).

## Notation de décision
- **Existant** : demandé dans le cahier des charges initial.
- **Proposition** : correction ou choix technique recommandé, NON approuvé.
- **Hypothèse** : information manquante à vérifier.
- **Décision** : uniquement après validation explicite, portée par un ADR accepté.

Une spécification peut décrire le *comportement cible proposé* sans prétendre qu'il est implémenté ou déjà approuvé. Les contrats sont des propositions cohérentes permettant de préparer Codex ; ils ne sont pas encore figés.

## Livraison
Les lots sont classés par responsabilité, mais les fichiers se référencent entre eux. Importer tous les lots avant de lancer une tâche. **Ne pas exécuter les tickets marqués « gate » avant résolution des arbitrages correspondants.** Aucun dépôt source ni CLI local n'a été audité.

## Règle centrale
Une opération déclarée dans une conversation n'est jamais tenue pour accomplie : seules les écritures métier et les preuves d'exécution persistées font foi.
