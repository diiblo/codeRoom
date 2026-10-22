# Plan d'implémentation

## Principes
Construire des incréments **verticaux** et démontrables. Les tâches du dossier `tasks/` sont des spécifications de travail, non des tickets déjà importés dans un outil. Inspecter le dépôt avant de choisir chemins/commandes. Le propriétaire doit valider les gates sécurité/plateforme.

## Jalons
| Jalon | Travaux | Démonstration |
|---|---|---|
| J0 : base documentée | TASK-001 à 006, 015–017 | environnement, politiques et fournisseur fictif sans droits |
| J1 : métier de collaboration | TASK-007 à 014, 020–023 | projet, agents, messages, intentions, événements |
| J2 : outils réels | TASK-018/019 après gates | deux CLI lancés avec contraintes prouvées |
| J3 : V1-A UI | TASK-024 à 026, TASK-039 à 042, tests transversaux | dashboard, registres profils/projets, refonte UX, messagerie et supervision persistantes |
| J4 : V1-B | TASK-027 à 034 | ticket → développement Git → revue |
| J5 : release MVP | TASK-035 à 038 | sécurité, reprise, sauvegarde et démonstration |

Les jalons sont des regroupements logiques, pas un ordre strict exclusif : [DAG](dependencies.md) fait autorité.

## Conditions d'arrêt
Pas d'exécution réelle avant décisions D-02/D-04/D-05 acceptées et tests d'isolation probants ; pas de démonstration « deux fournisseurs » sans second CLI testé ; aucune clôture de ticket sans preuve/validation autorisée.

## Livrables de phase
Tout travail livré comprend : diff / fichiers modifiés, migrations si besoin, tests réellement exécutés, preuves observables, risques résiduels et statut des critères.
