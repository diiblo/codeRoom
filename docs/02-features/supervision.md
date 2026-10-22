# Activité et supervision — V1-A

## Objectif
Voir ce qui s'exécute, ce qui a échoué et les décisions demandées, sans devoir lire toutes les conversations.

## Vues MVP
- Vue organisation : projets et exécutions actives/échouées.
- Vue projet : chronologie messages/actions/exécutions, auteur et temps.
- Vue exécution : état, durée, fournisseur, erreurs normalisées, commandes/logs expurgés et lien au déclencheur.
- Boîte personnelle : demandes d'approbation en attente, erreurs à résoudre ; tickets bloqués ajoutés en V1-B.

## Règles
Les états proviennent des données persistées, les mises à jour WS sont des notifications qui peuvent être rejouées. Annuler ou approuver exige une action serveur authentifiée ; l'UI ne définit pas la permission.

## Acceptation
- Une exécution interrompue ne disparaît pas après rechargement.
- Une demande d'approbation est actionnable uniquement par propriétaire autorisé.
- Une sortie contenant un secret simulé est masquée à l'affichage et dans les événements diffusés.
- Le statut affiché ne dépend pas d'un WebSocket toujours connecté.
