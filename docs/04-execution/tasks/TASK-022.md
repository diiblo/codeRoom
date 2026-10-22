# TASK-022 — Connecter action structurée message.send

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Permettre à un agent de contacter un autre sans interprétation fragile de prose.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../03-contracts/actions.md`
- `../../02-features/messaging.md`

## Prérequis
- TASK-006
- TASK-011
- TASK-012
- TASK-015
- TASK-021

## Périmètre
Recevoir demande structurée authentifiée par exécution/agent ; valider appartenance et persister message.

## Hors périmètre
Pas de généralisation à toutes les actions futures.

## Spécifications
Texte seul « j’ai envoyé » ne crée aucun message ; autoriser action par bridge contrôlé, non JSON arbitraire dans réponse.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Action doublon = un message.
- [x] Action de projet tiers refusée.

## Vérification
Tests de pont simulé, identité falsifiée, déduplication et conversation privée. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- La migration `0012_message_send_actions.sql` persiste l'action acceptée,
  son exécution, son affectation, sa conversation, son message et son
  empreinte. La clé d'idempotence est unique et le résultat d'une rediffusion
  est rejoué sans créer un second message.
- `StructuredMessageActionService` n'accepte que `message.send`. Il recoupe
  l'exécution avec le projet et l'affectation, exige une identité agent
  correspondante et une exécution `running`, puis réutilise l'autorisation
  `message.send` et le contrôle d'appartenance à la conversation.
- Le payload est strictement limité à `conversationId`, `text` et
  `references` normalisées. L'identité et l'`actionId` effectif viennent du
  serveur ; l'`actionId` fourni par le client n'est jamais utilisé comme
  autorité.
- Message, enregistrement de l'action et événement d'acceptation sont écrits
  dans la même transaction. Les refus sont journalisés par
  `action.message_send.rejected` sans produire de message.
- `MessageService.sendMessageWithinTransaction` permet au bridge de conserver
  cette atomicité sans ouvrir de transaction imbriquée.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- src/server/actions/message-send.test.ts src/server/messages/service.test.ts src/server/db/database.test.ts` — 3 fichiers, 14 tests passés.
- `docker compose run --rm api npm test` — 18 fichiers, 75 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose config --quiet` — succès.

Restriction restante : le bridge est un service interne prêt à être appelé par
un adaptateur ou un worker validé ; aucune CLI réelle Claude, Antigravity ou
Codex n'est lancée tant que TASK-017 n'est pas clôturée.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
