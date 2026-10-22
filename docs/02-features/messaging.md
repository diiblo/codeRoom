# Messagerie et déclenchements — V1-A

## Objectif
Discussions visibles, persistantes et cloisonnées, avec activation explicite des agents.

## Conversations MVP
- Groupe `main` automatique pour chaque projet.
- Conversations directes **dans un même projet**, avec participants définis et vérification d'accès.
- Conversations `ticket` introduites en V1-B, une conversation active par ticket.
- Réponses et fichiers riches en V2 ; en V1 les liens vers tickets/livrables sont des références structurées.

## Règles de déclenchement
- Envoyer un message ne lance jamais une CLI par défaut.
- Mention ciblée `@agent` : intention candidate, puis politique serveur (affectation, conversation, limite, état, disponibilité) ; si autorisée, création d'une exécution persistée.
- `@tous` notifie seulement. Un agent ne s'auto-réveille pas via sa propre sortie.
- Messages destinés aux agents via action `message.send` passent par une validation d'identité/projet/conversation.
- Réponse de l'agent ordinaire : pas de relance en cascade sans mention ou action structurée explicite.
- Exactement une intention traitée par `(messageId,agentId,triggerKind)` via unicité durable ; événements UI tolèrent les doublons.

## Confidentialité
L'accès au projet seul n'accorde pas accès à une conversation directe : vérification des participants, sauf intervention autorisée du propriétaire selon politique affichée aux agents. Aucune conversation entre projets MVP.

## Acceptation
- Un message sans mention n'active aucun CLI.
- Une mention valide active une seule exécution ; mention interdite = refus journalisé.
- Une réponse et l'historique sont disponibles après redémarrage.
- Un agent A ne peut lire une conversation privée B-C où il n'est pas membre.

Références : [actions](../03-contracts/actions.md), [événements](../03-contracts/events.md).
