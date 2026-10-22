# TASK-002 — Préparer les arbitrages de sécurité et plateforme

**Jalon :** P0 · **Statut :** terminée — décisions validées, preuves techniques restantes

## Objectif
Rendre les gates D-02, D-04, D-05 décidables par le propriétaire.

## Contexte
Cette tâche contribue à la livraison P0 de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../00-product/decisions-open.md`
- `../../01-architecture/decisions/ADR-002-execution-security.md`

## Prérequis
- TASK-001

## Périmètre
Comparer OS/solutions d’isolation sur critères filesystem, réseau, secrets, processus et installation ; proposer un choix et impacts.

## Hors périmètre
Ne pas accepter soi-même les ADR ni activer l’exécution autonome.

## Spécifications
Documenter options, preuves techniques, risques résiduels et décision explicitement demandée au propriétaire ; n’inscrire “accepté” qu’après validation.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Matrice de compromis complète.
- [x] ADR conservé proposé avant validation humaine, puis accepté après validation explicite.
- [x] Gates clairement listés et décisions demandées au propriétaire.

## Vérification
Relire la matrice avec essais exploratoires isolés et décision signée ou à arbitrer. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Compte rendu d'exécution — 2026-10-20

La matrice et les propositions sont consignées dans
[`../platform-security-arbitration.md`](../platform-security-arbitration.md).
Les essais locaux ont vérifié les primitives visibles de l'hôte et la
configuration Docker sans lancer de CLI fournisseur ni de code non fiable.

Les décisions D-02, D-04 et D-05 ont été validées explicitement par le
propriétaire le 2026-10-20. Cette tâche ne fait toutefois qu'établir les choix :
elle n'autorise pas le runner réel tant que la preuve de confinement Linux natif
et l'authentification applicative ne sont pas disponibles.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
