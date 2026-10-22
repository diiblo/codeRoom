# Architecture générale — proposition

## Style
Monolithe modulaire TypeScript, interface web séparée, worker/processus d'exécution local ; base SQLite et stockage de fichiers local. Les processus CLI sont des dépendances externes, non des sous-modules de confiance.

```text
React UI --HTTP/WS--> Fastify API
                         |
         +---------------+----------------+
         | projets/agents | messages      |
         | tickets        | permissions   |
         | approbations   | documents     |
         +---------------+----------------+
                         |
                   SQLite + filesystem
                         |
            Orchestrateur / file persistante
                         |
               Runner / adaptateurs CLI
                         |
               sandbox / dépôt Git autorisé
```

## Frontières
- `projects` : cycle de vie des projets, affectations.
- `agents` : profils, outils, capacité déclarée, sans sessions globales partagées.
- `conversations` : messages immuables et visibilité ; **ne lance pas de CLI**.
- `orchestration` : transforme les intentions autorisées en exécutions persistées.
- `executions` : ordonnance, lance, arrête, suit, réconcilie les processus.
- `actions` : valide les opérations métier structurées ; pas de SQL direct depuis un adaptateur.
- `tickets` : transitions et critères de revue ; modèle minimal V1-B.
- `git` : espaces de travail, livrables, modifications ; aucune fusion automatique MVP.
- `audit` : événements append-only et corrélation.

## Interactions
HTTP pour commandes/consultation, WebSocket pour notification d'événements persistés ; toute autorité réside côté serveur. Un événement WS n'est pas la source de vérité. Les écritures de domaine et leurs événements sont enregistrés dans une même transaction quand cela est possible.

## Règles de modularité
Chaque module possède son service et ses interfaces publiques. Interdiction de modifier directement les tables privées d'un autre module. Pas de microservices, de broker externe ou de GraphQL obligatoires au MVP.

## Statut
Stack héritée du cahier initial, architecture **proposée**. Les choix finaux sont consignés en ADR.
