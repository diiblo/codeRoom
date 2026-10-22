# TASK-013 — Exposer API HTTP du socle

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Donner à l’interface des endpoints fiables pour projets, agents, affectations et messages.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../03-contracts/api.md`
- `../../03-contracts/conventions.md`

## Prérequis
- TASK-007
- TASK-008
- TASK-009
- TASK-010
- TASK-011
- TASK-012

## Périmètre
Routes V1-A nécessaires, validation de schéma, identity middleware, erreurs et pagination.

## Hors périmètre
Pas de routes tickets ni workflows futurs.

## Spécifications
Toute mutation utilise le service métier et la politique serveur ; pas d’accès SQL depuis route.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Endpoints filtrés par projet.
- [x] Erreurs typées sans fuite.

## Vérification
Tests HTTP d’autorisation, inputs invalides, identités falsifiées et pagination. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- `buildApp` reçoit désormais la base SQLite ouverte par `main.ts` et
  `registerApiRoutes` expose les routes V1-A des projets, agents,
  affectations, conversations, messages et activité. Les routes délèguent aux
  services métier existants ; elles n'exécutent aucune requête SQL métier.
- Les listes et ressources projet utilisent un identifiant de projet explicite
  et les conversations/messages/activité vérifient l'identité agent et
  l'affectation via les services d'autorisation et de membership. Les curseurs
  de messages et d'activité sont transmis sans perte.
- Le middleware d'identité exige `x-coderoom-actor-id`, accepte le type et
  l'affectation validés par le serveur, et refuse les identités absentes ou
  non-agent pour les opérations conversationnelles. Les champs `authorId`,
  `actorId` et autres champs inconnus ne peuvent pas être injectés dans les
  payloads HTTP.
- Les mutations idempotentes exigent `Idempotency-Key`. Les erreurs de domaine
  sont converties en enveloppe `{ error: { code, message, correlationId } }` et
  les erreurs inattendues ne révèlent ni stack ni détail interne.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test` — 44 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose config --quiet` — succès.

Restrictions restantes : les en-têtes `x-coderoom-*` constituent une identité
de développement pour le loopback et ne remplacent pas une session UI
authentifiée. D-05 reste donc une restriction avant toute exposition distante.
Les routes tickets, exécutions, approbations et WebSocket restent hors
périmètre ; aucune exécution Claude, Antigravity ou Codex n'est déclenchée.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
