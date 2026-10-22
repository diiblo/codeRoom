# TASK-021 — Implémenter détection de mentions et routage

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Déclencher exactement une intention par mention valide.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/messaging.md`
- `../../03-contracts/execution.md`

## Prérequis
- TASK-011
- TASK-016
- TASK-020

## Périmètre
Parser mentions à partir des identifiants de participants ; créer intention persistante vers queue si autorisée.

## Hors périmètre
Pas de moteur de workflow configurable.

## Spécifications
Aucun lancement pour message ordinaire ou @tous ; limiter cycles ; refuser destinataire absent/archivé.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Mention répétée ou rediffusée n’entraîne pas doublon.
- [x] Auto-mention désactivée.

## Vérification
Tests mention autorisée, interdit, duplicat, @tous, boucle A-B-A. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- La migration `0011_mention_intentions.sql` ajoute une intention durable,
  bornée au projet et à la conversation, avec unicité sur
  `(messageId, targetAgentId, triggerKind)` et statut `queued` ou `rejected`.
- `MentionRoutingService` parse les identifiants `@agent`, déduplique les
  répétitions, ignore `@tous`, vérifie l'affectation active, l'appartenance à
  la conversation, l'archivage du destinataire et la disponibilité du
  fournisseur.
- Une mention autorisée crée l'intention et l'exécution `queued` dans la même
  transaction. Les refus (cible absente, archivée, hors conversation,
  fournisseur indisponible ou affectation occupée) sont persistés et audités.
- Les mentions produites par un agent sont refusées par défaut
  (`agent_auto_mention_disabled`) : une sortie d'agent ne peut donc pas
  démarrer une cascade A-B-A. L'action structurée `message.send` reste le
  point d'extension prévu par TASK-022 pour une communication contrôlée.
- Les tests couvrent le parsing, le message ordinaire, `@tous`, la mention
  valide, les répétitions/rediffusions, les cibles absente/archivée, la
  conversation directe et la boucle A-B-A.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- src/server/mentions/service.test.ts` — 5 tests passés.
- `docker compose run --rm api npm test` — 17 fichiers, 70 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose config --quiet` — succès.

Restriction restante : aucune CLI réelle Claude, Antigravity ou Codex n'est
lancée ; le worker et le broker restent soumis à TASK-017 et à la preuve de
confinement Linux natif. Le service de routage est prêt pour son raccordement
aux flux applicatifs ultérieurs.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
