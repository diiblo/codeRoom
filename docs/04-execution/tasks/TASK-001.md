# TASK-001 — Inspecter le dépôt et la plateforme

**Jalon :** P0 · **Statut :** terminée

## Objectif
Obtenir un inventaire fiable de l’existant et des contraintes de l’hôte.

## Contexte
Cette tâche contribue à la livraison P0 de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../00-product/decisions-open.md`
- `../../01-architecture/overview.md`

## Prérequis
- Aucun (point de départ).

## Périmètre
Relever fichiers, framework, scripts, système/architecture CPU, CLI disponibles, Git, configuration et état initial ; produire un rapport daté sans secrets.

## Hors périmètre
Ne pas installer de dépendances ni modifier le dépôt.

## Spécifications
Séparer résultats constatés, absences constatées et inconnues ; ne pas prétendre à des API ou répertoires avant inspection.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Inventaire reproductible.
- [x] Versions détectées lorsque l'outil était accessible.
- [x] Liste des risques, absences, inconnues et scripts disponibles.

## Vérification
Consigner les commandes de découverte réellement lancées et leurs sorties expurgées. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.

## Compte rendu d'exécution — 2026-10-20

Le rapport daté et reproductible est disponible dans
[`../platform-inventory.md`](../platform-inventory.md). Il couvre la structure
du dépôt, les scripts, l'OS WSL2, l'architecture CPU, les ressources, Git,
Node/npm, Docker/Compose et la détection des CLI sans inspecter de secrets ni
lancer d'exécution fournisseur.

### Restrictions résiduelles

Le runtime Node Linux et les CLI Claude/Antigravity ne sont pas détectés dans
l'environnement WSL. Le dépôt n'a pas de métadonnées Git locales. Les décisions
P0 D-02, D-04 et D-05 restent non validées ; aucune exécution autonome de CLI
réel n'est donc autorisée par cette tâche.
