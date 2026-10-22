# TASK-003 — Initialiser structure et scripts du projet

**Jalon :** P0 · **Statut :** à faire (non implémenté)

## Objectif
Mettre en place un squelette monolithe modulaire exécutable.

## Contexte
Cette tâche contribue à la livraison P0 de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../01-architecture/overview.md`
- `../../../AGENTS.md`

## Prérequis
- TASK-001

## Périmètre
Selon l’existant, définir arborescence frontend/backend, TypeScript, format, lint, tests et démarrage local minimal.

## Hors périmètre
Aucune logique métier, aucun fournisseur réel.

## Spécifications
Préserver conventions existantes ; n’ajouter des packages que justifiés ; déclarer scripts réels au README du dépôt.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [ ] Démarrage minimal local.
- [ ] scripts lint/typecheck/test opérationnels ou blocage documenté..

## Vérification
Exécuter scripts définis ; joindre codes de sortie et logs utiles. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
