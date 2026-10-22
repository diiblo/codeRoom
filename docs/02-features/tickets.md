# Tickets, attribution et revue — V1-B

## Objectif
Transformer une intention en travail assigné et résultat vérifiable.

## Modèle
Ticket : identifiant, projet, titre, objectif/description, auteur, responsable optionnel, priorité basique, critères d'acceptation (liste), état, conversation dédiée, historique, livrables. Dépendances complexes et sous-tâches hiérarchiques sont V3.

## États
`todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`. `blocked` conserve la provenance et une raison obligatoire ; `cancelled` ne réouvre pas automatiquement. Réouverture explicite de `done` vers `todo` avec motif et audit.

## Règles
- Création du ticket et de sa conversation transactionnelle ; pas de conversation orpheline.
- Affectation uniquement à un agent actif du même projet et détenteur des droits requis ; responsabilité unique MVP.
- `todo -> in_progress` par responsable autorisé ; `in_progress -> in_review` uniquement avec livrable référencé et preuves minimales déclarées ; `in_review -> done` par relecteur autorisé et distinct de l'exécutant par défaut, ou propriétaire humain ; `in_review -> in_progress` si corrections.
- « Livrable soumis » n'est pas « test réussi » ; les données de test sont des preuves avec source, horodatage et résultat.
- Les changements d'état et auteur sont toujours tracés par action serveur.

## Acceptation
- Un agent du mauvais projet ne peut être affecté.
- Un ticket sans livrable ne peut aller en revue.
- Le responsable ne peut s'auto-valider en contournant la politique.
- Une revue rejetée réouvre le travail et conserve l'historique.

Références : [actions](../03-contracts/actions.md), [Git](git-deliverables.md), [qualité](../05-quality/acceptance.md).
