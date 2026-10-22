# Collaborateurs IA — V1-A

## Objectif
Profils permanents réutilisables, sans confondre identité, fournisseur, affectation, session ni exécution.

## Règles
- Profil : nom, rôle métier libre, instructions, description facultative ; avatar et compétences riches après MVP.
- Le profil est global et réutilisable. Le fournisseur est choisi au moment de
  l'affectation à un projet, depuis les outils réellement découverts par le
  broker hôte.
- Affectation par projet avec permissions limitées ; les rôles déclarés ne donnent **aucune permission technique** automatiquement.
- Instructions de profil ajoutées au contexte de session propre au projet ; ne jamais y injecter le contexte d'un autre projet.
- Archivage désactive les nouveaux démarrages et conserve tickets, messages, auteur et historique.
- Disponibilité = information dérivée du fournisseur associé à l'affectation et
  des exécutions, pas promesse que le modèle soit « connecté » en permanence.

## Erreurs
Outil non détecté, fournisseur incompatible, instructions trop volumineuses, affectation désactivée en cours de traitement.

## Acceptation
- Le même agent peut appartenir à deux projets, chacun avec sa session distincte.
- Un agent archivé ne peut plus être activé.
- L'état `not-installed` ou `unavailable` est explicite.

Références : [adaptateurs](../03-contracts/agent-adapter.md), [sécurité](../01-architecture/security.md).
