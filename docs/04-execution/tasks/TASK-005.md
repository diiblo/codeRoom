# TASK-005 — Fiabiliser stockage et migrations

**Jalon :** P0 · **Statut :** terminée

## Objectif
Empêcher les migrations destructives et documenter le stockage local.

## Contexte
Cette tâche contribue à la livraison P0 de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../01-architecture/storage-operations.md`

## Prérequis
- TASK-004

## Périmètre
Définir chemin des données, gestion d’erreur de migration, intégrité SQLite et politiques de fichiers.

## Hors périmètre
Le flux complet sauvegarde/restauration reste TASK-037.

## Spécifications
Une migration échouée doit bloquer le démarrage ; logs sans secrets ; aucune suppression implicite des données.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Test de migration impossible = démarrage refusé.
- [x] Chemins de stockage explicités.

## Vérification
Simuler migration fautive sur DB temporaire et vérifier absence de corruption. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Compte rendu d'exécution — 2026-10-20

Les chemins sont centralisés dans `src/server/db/config.ts` : base SQLite,
répertoire de données et workspaces peuvent être explicitement configurés par
variables d'environnement, avec des défauts locaux documentés. L'API initialise
la base avant l'écoute HTTP et refuse de démarrer si une migration ou un
contrôle d'intégrité échoue.

La migration est transactionnelle et les migrations invalides, les versions
dupliquées et les schémas plus récents que l'application sont refusés. Les
tests vérifient qu'une migration fautive laisse la base précédente lisible,
n'ajoute pas sa table partielle et ne valide pas sa version.

### Commandes et résultats

- `docker compose run --rm api npm test` : 9 tests réussis.
- `docker compose run --rm api npm run typecheck` : réussi.
- `docker compose run --rm api npm run lint` : réussi.
- `docker compose run --rm api npm run format:check` : réussi.
- `docker compose run --rm api npm run db:migrate` : réussi sur
  `/var/lib/coderoom/coderoom.sqlite`.

Les contrôles ont été exécutés dans le conteneur API ; aucun runtime Node de
l'hôte n'a été utilisé.

### Restrictions résiduelles

La sauvegarde/restauration complète reste TASK-037. Les contrôles d'intégrité
ne remplacent pas une procédure de backup cohérent. Les logs d'échec sont
volontairement génériques et ne contiennent pas le détail de l'erreur SQLite.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
