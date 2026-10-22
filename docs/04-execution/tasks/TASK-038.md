# TASK-038 — Valider jalons et publier documentation MVP

**Jalon :** Release · **Statut :** à faire (non implémenté)

## Objectif
Conclure la livraison avec preuves vérifiables et limites explicites.

## Contexte
Cette tâche contribue à la livraison Release de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../05-quality/acceptance.md`
- `../../00-product/scope.md`

## Prérequis
- TASK-035
- TASK-036
- TASK-037

## Périmètre
Rejouer scénario 10 points, relire décisions acceptées, mettre guide installation et versions validées.

## Hors périmètre
Pas de planification automatique des versions futures.

## Spécifications
Ne pas promettre V1-B si un gate bloquant reste ouvert ; renseigner limitations fournisseur, OS et capacités.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [ ] Checklist d’acceptation signée.
- [ ] version/documentation cohérentes.
- [ ] installation reproductible..

## Vérification
Revue croisée preuves tests et démonstration sans étapes manuelles cachées. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
