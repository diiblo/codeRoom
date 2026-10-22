# TASK-037 — Valider sauvegarde, restauration et exploitation

**Jalon :** Release · **Statut :** à faire (non implémenté)

## Objectif
Restaurer le projet et ses données après panne locale.

## Contexte
Cette tâche contribue à la livraison Release de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../01-architecture/storage-operations.md`
- `../../05-quality/acceptance.md`

## Prérequis
- TASK-005
- TASK-012
- TASK-027
- TASK-032

## Périmètre
Procédure/outil de sauvegarde cohérente SQLite+artifacts ; guide restauration et vérification.

## Hors périmètre
Pas de service cloud de sauvegarde.

## Spécifications
Inclure manifest des repos Git externes ; pas de backup incohérent DB en écriture.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [ ] Après restauration, conversations/tickets/livrables intacts et chemins documentés..

## Vérification
Restaurer sauvegarde dans environnement isolé et vérifier intégrité/refs. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
