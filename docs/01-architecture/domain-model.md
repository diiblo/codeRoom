# Modèle de domaine — MVP

Les champs ci-dessous constituent un modèle logique, pas des migrations SQL déjà créées.

| Entité | Champs minimaux | Relations / invariants |
|---|---|---|
| Organization | id, name, createdAt | Une seule initialement |
| Agent | id, displayName, role, instructions, archivedAt? | Identité globale, sans fournisseur ni accès implicite |
| Project | id, name, status, repositoryPath?, createdAt | Une conversation `main` à la création |
| Assignment | id, projectId, agentId, provider, permissionSet, status | Contexte de projet et fournisseur obligatoires pour l'exécution |
| Conversation | id, projectId, kind (`main`,`direct`,`ticket`), ticketId? | `main` unique par projet, participants explicites |
| Participant | conversationId, agentId? / userId? | Une identité participante valide |
| Message | id, conversationId, authorType, authorId, text, createdAt, requestId? | Auteur déduit d'une identité authentifiée, jamais du contenu |
| Session | id, assignmentId, providerSessionKey?, status, contextScope | Jamais partagée entre projets |
| Execution | id, projectId, agentId, sessionId?, triggerId, state, attempt, timestamps | Un état et une trace durable |
| ActionRequest | id, executionId, type, payload, state, idempotencyKey | Décision d'autorisation enregistrée |
| Approval | id, actionRequestId, status, decidedBy?, timestamps | Décision humaine attribuable |
| Ticket (V1-B) | id, projectId, title, body, ownerId?, state, acceptanceCriteria | Un projet et un responsable explicites |
| Deliverable (V1-B) | id, ticketId, executionId?, gitRef?, testEvidence?, state | Attestation liée au ticket |
| AuditEvent | id, kind, actorType, actorId, projectId?, correlationId, payload, createdAt | Append-only, aucune suppression implicite |

## Contraintes
- Toutes les références vers projet doivent garantir le cloisonnement : ticket, conversation, session, exécution et livrable d'un autre projet sont rejetés.
- Un message système utilise `authorType=system` ; une sortie CLI ne peut jamais choisir `authorType=human`.
- Archiver un agent ne supprime ni l'historique ni les exécutions passées ; l'affectation archivée n'autorise plus de nouveaux déclenchements.
- Les identifiants sont opaques. Les champs fournisseur sont stockés sans les exposer comme IDs internes.
- Les clés d'idempotence et unicité du groupe `main` sont contraintes par base de données, pas seulement par code.

## Diagramme relationnel simplifié
`Project -> Assignment <- Agent`; `Assignment -> Provider`; `Project -> Conversation -> Message`; `Assignment -> Session -> Execution -> ActionRequest -> Approval`; `Project -> Ticket -> Deliverable`; `AuditEvent` référence le projet et la corrélation métier.

## Évolutions
Équipes réutilisables, documents versionnés et dépendances de tickets introduisent des entités supplémentaires en V2/V3, pas des tables factices au MVP.
