# TASK-006 — Implémenter contrôle d’accès serveur

**Jalon :** P0 · **Statut :** terminée

## Objectif
Disposer d’une politique centrale de droits par projet et affectation.

## Contexte
Cette tâche contribue à la livraison P0 de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../01-architecture/security.md`
- `../../02-features/approvals.md`
- `../../03-contracts/conventions.md`

## Prérequis
- TASK-003
- TASK-004

## Périmètre
Implémenter vérification identité / projet / permission et décisions autorisées ou refusées journalisables.

## Hors périmètre
Aucun lancement CLI ; la sandbox est TASK-017.

## Spécifications
Les rôles déclarés ne confèrent pas de droits ; action avec mauvais projet ou affectation révoquée est refusée.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Tests de refus par défaut, cross-project et impossibilité d'utiliser un `actorId` injecté.

## Vérification
Tests unitaires matriciels des permissions ; cas adversariaux multi-projet. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Compte rendu d'exécution — 2026-10-20

Le noyau central est implémenté dans
[`src/server/security/authorization.ts`](../../../src/server/security/authorization.ts).
Il exige une identité de session fournie côté serveur, recoupe l'affectation
avec l'agent et le projet, vérifie le statut actif et la permission canonique,
et retourne une décision structurée (`AUTHORIZED`, `UNAUTHORIZED` ou
`FORBIDDEN`) avec motif, corrélation et horodatage. Un callback permet de
journaliser chaque décision sans faire confiance aux champs non fiables de
l'enveloppe d'action.

Les rôles déclarés ne donnent aucun droit. Les identités humaines ou système
sont refusées tant qu'une politique de membership dédiée n'existe pas. Un
`untrustedActorId` ou `untrustedAssignmentId` divergent de l'identité serveur
est refusé avant toute consultation de permission.

### Cas vérifiés

- identité absente : refus par défaut ;
- rôle `admin` sans permission explicite : refus ;
- affectation du mauvais projet : refus ;
- affectation archivée/révoquée : refus ;
- permission absente ou inconnue : refus ;
- `actorId` injecté différent : refus ;
- affectation active et permission explicite : autorisation journalisable.

### Commandes et résultats

- `docker compose run --rm api npm test` : 15 tests réussis.
- `docker compose run --rm api npm run typecheck` : réussi.
- `docker compose run --rm api npm run lint` : réussi.
- `docker compose run --rm api npm run format:check` : réussi.

Les contrôles ont été exécutés dans le conteneur API ; aucun CLI fournisseur
n'a été lancé.

### Restrictions résiduelles

La persistance durable des événements d'audit et l'intégration de cette
politique dans les actions HTTP restent à relier aux tâches d'événements et
d'API. Aucun droit humain, lancement CLI ou contournement par le worker n'est
introduit par TASK-006.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
