# AgentAction — demandes structurées et permissions

## Enveloppe proposée
```json
{
  "actionId": "act_opaque",
  "executionId": "exe_opaque",
  "type": "ticket.create",
  "projectId": "prj_opaque",
  "idempotencyKey": "client-generated-key",
  "payload": {"title": "Ajouter une recherche", "acceptanceCriteria": ["Recherche testable"]}
}
```

`executionId`, `projectId` et identité réelle de l'agent sont **recoupés** avec la session invocatrice par le serveur ; une discordance est rejetée. Le `actionId` peut être attribué côté serveur, sans confiance dans sa valeur cliente.

## Actions MVP
| Action | Minimum permission | Effet |
|---|---|---|
| `message.send` | `message.send` + appartenance à conversation | Publier message |
| `execution.request` | `execution.request` | Déclencher un agent autorisé |
| `ticket.create` | `ticket.create` | Créer ticket et conversation V1-B |
| `ticket.assign` | `ticket.assign` | Affecter agent membre du projet |
| `ticket.update` | `ticket.update` | Transition autorisée |
| `ticket.submit_review` | `ticket.submit_review` | Soumettre livrable vérifiable |
| `review.submit` | `review.submit` | Verdict par relecteur distinct ou humain |

`approval.resolve` **n'est pas** une action d'agent. Les permissions Git s'appliquent aussi au runner, pas seulement aux actions API.

## Traitement
Valider schéma → retrouver identité invocatrice → vérifier projet, affectation, conversation et état → idempotence → transaction de domaine + événement → réponse structurée succès/erreur. Une demande en attente d'approbation ne doit produire aucun effet sensible avant décision.

## Risques et erreurs
Action inconnue, limite atteinte, cible archivée, projet croisé, doublon contradictoire, conflit de transition, permission révoquée pendant approbation : refus audité. Un message en langue naturelle ne devient pas automatiquement une action `ticket.create`.
