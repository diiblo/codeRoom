# TASK-036 — Auditer la sécurité de bout en bout

**Jalon :** Release · **Statut :** à faire (non implémenté)

## Objectif
Démontrer que l’autonomie ne contourne pas les contrôles.

## Contexte
Cette tâche contribue à la livraison Release de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../01-architecture/security.md`
- `../../05-quality/testing.md`

## Prérequis
- TASK-017
- TASK-019
- TASK-022
- TASK-023
- TASK-031
- TASK-033

## Périmètre
Tests host sandbox, prompt injection, spoofing human, permissions, secret exposure, network, path traversal, double action.

## Hors périmètre
Ne pas déclarer une sécurité absolue ou multi-OS sans preuve.

## Spécifications
Tout échec P0 interdit release avec exécution autonome ; preuve technique pour plateforme réelle.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [ ] Aucune escalade via message/CLI.
- [ ] accès hors périmètre et secrets refusés..

## Vérification
Lancer suite sécurité isolée + tests d’attaque manuels consignés. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
