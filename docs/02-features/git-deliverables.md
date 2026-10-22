# Git, espaces de travail et livrables — V1-B

## Objectif
Lier les modifications réelles au ticket et éviter les écritures concurrentes accidentelles.

## Périmètre MVP
Un dépôt Git local existant par projet, associé par le propriétaire ; espace autorisé isolé par ticket/exécution selon une stratégie approuvée ; capture de `git status`, diff, commit/ref et résultats de tests. **Aucune fusion automatique.** Le parallélisme complet via plusieurs worktrees est V3 ; le MVP peut imposer une seule exécution mutante par dépôt.

## Règles
- Valider que le chemin est un dépôt autorisé ; ne pas suivre symlinks/chemins vers des zones hors périmètre sans contrôle.
- Empêcher deux écritures concurrentes incontrôlées sur un même espace ; refuser en cas de verrou non disponible.
- Le livrable a une provenance : ticket, agent/exécution, chemin de travail approuvé, références Git, état propre/sale, tests exécutés et leurs résultats réels.
- Ne jamais faire passer une sortie textuelle du CLI pour un commit ou un test ; vérifier les références Git et l'existence des résultats.
- Refuser suppression de dépôt, push ou fusion sans politique et approbation dédiée ; hors MVP si non spécifié.

## Acceptation
- Deux modifications simultanées sur la même zone sont sérialisées ou rejetées.
- Un `gitRef` inexistant est refusé.
- Le diff consulté correspond au dépôt du projet, pas à un chemin injecté.
- Une livraison en revue renvoie à des modifications effectivement observables.

Références : [sécurité](../01-architecture/security.md), [tickets](tickets.md).
