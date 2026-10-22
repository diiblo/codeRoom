# TASK-025 — Construire messagerie temps réel

**Jalon :** V1-A · **Statut :** en cours

## Objectif

Discuter et mentionner un agent avec historique cohérent.

## Contexte

Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références

- `../../02-features/messaging.md`
- `../../03-contracts/api.md`

## Prérequis

- TASK-013
- TASK-014
- TASK-021
- TASK-024

## Périmètre

Liste conversations du projet, timeline paginée, saisie, mentions, connexion WS/replay.

## Hors périmètre

Pas d’appels CLI depuis le navigateur.

## Spécifications

Pas de déclenchement si simple message ; reconnexion recharge curseur ; erreur permission visible.

## Contraintes techniques

Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation

- [x] Message reçu après rafraîchissement via l’historique HTTP.
- [ ] une mention déclenche.
- [x] `@tous` est traité comme une notification sans exécution.

## Vérification

Test E2E UI envoi, déconnexion/reconnexion, projet refusé. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- `src/web/MessagingView.tsx` affiche les conversations autorisées, l’historique
  paginé, le composeur, les raccourcis de mentions et les erreurs de permission.
- `src/web/api.ts` expose les lectures/envois de messages et construit l’URL
  WebSocket avec identité, affectation et curseur.
- Le client déduplique les messages par ID, recharge l’historique après
  `message.posted` et reprend le flux après reconnexion.
- L’API évalue les mentions après un envoi et renvoie les intentions dans la
  réponse ; l’idempotence reste portée par `MessageService`.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm test` — 19 fichiers, 81 tests passés.
- `docker compose run --rm api npm test -- --run src/server/http/api.test.ts src/server/mentions/service.test.ts src/server/http/events-websocket.test.ts` — 3 fichiers, 14 tests passés ; couvre le refus anti-cascade, le routage de mentions au niveau service et la reprise WS.
- `docker compose run --rm api npm run build` — succès.
- `docker compose config --quiet` — succès.
- Smoke HTTP : API `/api/v1/status`, interface `/` et `docker compose ps` — succès.

Restriction restante : aucun navigateur automatisable n’est présent. La
politique serveur exige une identité agent affectée et désactive les mentions
issues d’une sortie d’agent ; aucune élévation d’identité humaine n’a été
introduite.

## Définition de terminé

Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
