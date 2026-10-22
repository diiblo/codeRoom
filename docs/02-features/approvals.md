# Permissions et approbations — V1-A

## Objectif
Autoriser les actions métier ou techniques sans déléguer l'autorité au langage naturel.

## Permissions MVP proposées
`project.read`, `message.read`, `message.send`, `ticket.read`, `ticket.create`, `ticket.assign`, `ticket.update`, `ticket.submit_review`, `review.submit`, `execution.request`, `git.read`, `git.write_scoped`.

Chaque permission est rattachée à un acteur/une affectation et limitée à un projet ; les droits du propriétaire sont séparés des droits des agents. Une action `approval.resolve` est réservée à une identité humaine authentifiée.

## Approbation
Action demandée → validation de schéma et de droits → si nécessaire `approval.pending` → décision humaine acceptation/refus → vérification des droits et du contexte **à nouveau** avant exécution → journal corrélé. Approbation expirée ou modifiée = refus, pas autorisation tacite.

## Cas sensibles MVP
Exécution de commande au-delà de liste/portée autorisée, écriture hors espace de travail, accès à secrets ou au réseau, suppression, fusion dans branche protégée, changement des permissions. La politique exacte doit être éprouvée selon le runner et le fournisseur.

## Acceptation
- Un agent ne peut attribuer lui-même `approval.resolve`.
- Changer `authorId` dans une sortie du CLI ne change pas l'acteur réel.
- Refus/expiration arrête l'action ; chaque approbation est attribuée et historisée.
- Révoquer une affectation invalide ses demandes non exécutées.

Références : [sécurité](../01-architecture/security.md), [actions](../03-contracts/actions.md).
