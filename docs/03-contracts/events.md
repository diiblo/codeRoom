# DomainEvent — persistance et diffusion

## Enveloppe stable proposée
```json
{
  "id": "evt_opaque", "type": "execution.started", "version": 1,
  "projectId": "prj_opaque", "actorType": "system", "actorId": "system",
  "correlationId": "cor_opaque", "causationId": "trigger_opaque",
  "createdAt": "2026-10-19T12:00:00Z", "payload": {"executionId": "exe_opaque"}
}
```

## Événements MVP
`project.created`, `agent.assigned`, `message.posted`, `execution.queued`, `execution.started`, `execution.awaiting_approval`, `execution.succeeded`, `execution.failed`, `execution.cancelled`, `execution.unknown`, `approval.requested`, `approval.resolved`, `ticket.created`, `ticket.assigned`, `ticket.state_changed`, `deliverable.submitted`, `review.recorded`.

## Garanties
- Événement et modification métier écrits transactionnellement quand possible ; outbox pour livraison UI éventuelle.
- At-least-once admissible pour la distribution ; consommateurs dédupliquent par ID. **Pas de promesse exactly-once** pour effets systèmes/externes.
- Ordre garanti au mieux par agrégat avec numéro de version si requis ; ne pas inférer un ordre global causal depuis l'horloge.
- Retours WS peuvent être manqués ; consultation HTTP par curseur restaure la vue.
- Ne jamais mettre secrets, instructions système privées ni logs bruts sans filtrage dans les payloads diffusés.

## Tests
Persistance malgré crash entre écriture et notification ; rediffusion sans duplication UI ; vérification qu'un projet tiers ne peut recevoir l'événement.
