# TASK-027 — Ajouter persistance et états des tickets

**Jalon :** V1-B · **Statut :** terminée

## Objectif
Stocker des tickets avec critères et transitions contrôlées.

## Contexte
Cette tâche contribue à la livraison V1-B de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/tickets.md`
- `../../01-architecture/domain-model.md`

## Prérequis
- TASK-004
- TASK-007
- TASK-009
- TASK-012

## Périmètre
Migration Ticket, états enum, historique et services de création/transition.

## Hors périmètre
Pas de dépendances complexes entre tickets.

## Spécifications
Transitions illégales refusées ; critère et raison de blocage selon état ; auteur serveur.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Création et reload fiables.
- [x] Clôture directe impossible.

## Vérification
Tests de state machine et migration sur DB temporaire. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.

## Réalisation et preuves

- `migrations/0015_tickets.sql` ajoute les tickets, les demandes idempotentes
  de création et de transition, ainsi que l’historique des transitions.
- `src/server/tickets/service.ts` implémente la création, la lecture, le
  filtrage projet et la machine d’états contrôlée.
- Les transitions illégales sont refusées ; `todo -> done` est impossible.
  Un blocage conserve l’état d’origine et exige une raison. La réouverture de
  `done` exige également une raison.
- `ticket.created` et `ticket.state_changed` sont écrits dans l’audit/outbox.
- `src/server/tickets/service.test.ts` vérifie l’idempotence, le reload sur DB
  temporaire, le cloisonnement projet, les transitions et les refus attendus.

Commandes réellement exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/tickets/service.test.ts src/server/db/database.test.ts` — 2 fichiers, 8 tests passés.
- `docker compose run --rm api npm test` — 20 fichiers, 85 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose config --quiet` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.

Les routes/actions HTTP, l’attribution détaillée, la conversation dédiée et
les gates de livrables/revue sont explicitement reportées à TASK-028,
TASK-029, TASK-032 et TASK-033. Elles ne constituent pas un défaut de ce lot.
