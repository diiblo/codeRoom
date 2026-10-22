# TASK-012 — Écrire outbox et événements persistants

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Faire de chaque changement métier un événement récupérable.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../03-contracts/events.md`
- `../../01-architecture/storage-operations.md`

## Prérequis
- TASK-004
- TASK-006

## Périmètre
Schéma AuditEvent/outbox, transaction, IDs, corrélation et lecture par curseur.

## Hors périmètre
Pas de bus distribué ni garanties exactly-once externes.

## Spécifications
Même transaction que l’écriture de domaine lorsque possible ; rediffusion sans duplication logique.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Crash entre écriture et publication ne perd aucun événement.

## Vérification
Tests de transaction atomique, restart publisher, filtre projet. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- La migration `0007_audit_events_outbox.sql` ajoute l'enveloppe persistante
  `audit_events`, l'outbox durable `event_outbox` et leurs index de lecture et
  de reprise. La clé étrangère empêche de livrer un événement sans audit
  correspondant.
- `EventService.recordEvent` reçoit les identifiants opaques, la version, le
  projet, l'acteur, la corrélation, la causalité et le payload. Il écrit
  l'événement et l'entrée outbox dans la transaction appelante ;
  `MessageService` émet ainsi `message.posted` atomiquement avec le message.
- La lecture utilise un curseur stable `(created_at, id)` et un filtre strict
  `project_id`. Le publisher incrémente le nombre de tentatives sans marquer
  l'événement comme livré : un redémarrage peut donc le reprendre. Le marquage
  livré est idempotent.
- Les clés sensibles et sorties brutes sont remplacées par `[REDACTED]` dans
  les payloads persistés ; aucun bus distribué ni exactly-once externe n'est
  introduit.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test` — 40 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose run --rm api npm run db:migrate` — migration v7 appliquée.
- `docker compose config --quiet` — succès.

Restrictions restantes : les autres agrégats émettront leurs types d'événement
au moment de leurs prochaines mutations métier ; les routes HTTP, la
diffusion WebSocket et le publisher vers un bus restent hors périmètre de ce
lot. Aucun CLI hôte ni runner n'est activé.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
