# TASK-014 — Diffuser événements WebSocket avec reprise

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Mettre à jour l’UI sans perdre l’historique lors des reconnexions.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../03-contracts/api.md`
- `../../03-contracts/events.md`

## Prérequis
- TASK-012
- TASK-013

## Périmètre
WS autorisé par projet, notification eventId et reprise via curseur/HTTP.

## Hors périmètre
Pas de présence temps réel sophistiquée.

## Spécifications
WS non autoritaire ; contrôle d’accès à abonnement ; déduplication côté client.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Reconnecte sans trou logique.
- [x] Projet tiers invisible.

## Vérification
Tests integration reconnexion, replay, perte de connexion, isolation. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- Le plugin WebSocket Fastify est enregistré avant la route `GET /api/events`.
  L'abonnement exige un `projectId`, une identité agent et la permission
  `project.read` sur une affectation active du même projet. Les refus sans
  identité et les abonnements inter-projets sont couverts.
- Le serveur envoie un message `ready`, puis les événements persistés avec leur
  `id` et un curseur stable `(createdAt, id)`. La lecture strictement après le
  curseur permet le replay initial et la reprise après reconnexion, sans
  rediffuser l'événement déjà acquitté. Le filtrage par projet est appliqué en
  base avant diffusion.
- Le flux WebSocket reste non autoritaire : `EventService` et les routes HTTP
  d'activité restent la source de récupération persistante. La connexion est
  arrêtée proprement à la fermeture du client ou en cas d'erreur de lecture.
- La dépendance `@fastify/websocket` et ses types `ws` sont déclarés dans le
  manifeste et le lockfile. Aucun changement de schéma ou de migration n'était
  nécessaire.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test` — 47 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose config --quiet` — succès.

Restrictions restantes : les en-têtes ou paramètres d'identité WebSocket sont
un mécanisme de développement loopback et ne remplacent pas une authentification
applicative de session. D-05 reste donc une restriction avant toute exposition
distante ; aucune exécution Claude, Antigravity ou Codex n'est déclenchée.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
