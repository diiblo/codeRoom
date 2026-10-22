# TASK-004 — Créer schéma et migrations du socle

**Jalon :** P0 · **Statut :** à faire (non implémenté)

## Objectif
Persister organisation, projets, agents, affectations et identités de façon cohérente.

## Contexte
Cette tâche contribue à la livraison P0 de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../01-architecture/domain-model.md`
- `../../01-architecture/storage-operations.md`

## Prérequis
- TASK-003

## Périmètre
Créer schéma, migrations versionnées, contraintes d’unicité et dépôt transactionnel avec SQLite.

## Hors périmètre
Pas de logique tickets/Git ni tables V2–V4.

## Spécifications
Inclure projets, agents, affectations ; préparer modèles de conversation/exécution dans migrations séparées prévues par tâches aval ; timestamps cohérents.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [ ] Migration depuis base vide.
- [ ] contraintes unicité effectives.
- [ ] données conservées au redémarrage..

## Vérification
Lancer migrations et tests DB sur base temporaire ; vérifier violation d’unicité. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
