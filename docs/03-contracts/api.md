# API HTTP et notifications WebSocket — proposition MVP

## Principes
HTTP est la voie d'autorité pour lecture et mutation. WebSocket notifie qu'un état a changé ; le client récupère/rejoue les événements durables après reconnexion. Routes à confirmer après inspection du dépôt (aucune route existante n'est présumée).

## Endpoints proposés
| Méthode | Route | Usage | Phase |
|---|---|---|---|
| GET/POST | `/api/projects` | liste/création | V1-A |
| GET/PATCH | `/api/projects/:projectId` | lecture/mise à jour | V1-A |
| POST | `/api/projects/:projectId/archive` | archivage conservant l'historique | V1-A |
| GET/POST | `/api/agents` | profils globaux, sans fournisseur obligatoire | V1-A |
| PATCH | `/api/agents/:agentId` | nom, rôle, description et instructions ; fournisseur refusé | V1-A |
| POST | `/api/agents/:agentId/archive` | archivage idempotent du profil | V1-A |
| GET | `/api/dashboard?organizationId=…` | statistiques filtrées par organisation, identité humaine requise | V1-A |
| POST | `/api/projects/:projectId/assignments` | affectation avec fournisseur de projet | V1-A |
| GET | `/api/projects/:projectId/conversations` | liste accès filtré | V1-A |
| GET/POST | `/api/conversations/:id/messages` | historique/envoi | V1-A |
| GET | `/api/projects/:projectId/executions` | suivi | V1-A |
| POST | `/api/executions/:id/cancel` | demande arrêt | V1-A |
| GET | `/api/approvals` | file des décisions | V1-A |
| POST | `/api/approvals/:id/decision` | décider | V1-A |
| GET/POST | `/api/projects/:projectId/tickets` | tickets | V1-B |
| POST | `/api/tickets/:id/actions` | mutation contrôlée | V1-B |
| GET | `/api/projects/:projectId/activity?cursor=` | événements | V1-A |

## Enveloppes
Réponse succès : objet JSON typé, champ `id` si entité. Erreur : `{ "error": { "code": "FORBIDDEN", "message": "Accès refusé", "correlationId": "..." } }`. Mutations sensibles/idempotentes utilisent en-tête `Idempotency-Key`; même clé + même acteur/opération = même résultat logique ; même clé et payload contradictoire = `CONFLICT`.

Le dashboard renvoie directement `organizationId`, `projects` (actifs/archivés),
`agents` (globaux, actifs/archivés), `assignments.active`, `tickets` et
`executions` indexés par état, `approvals.pending` non expirées,
`recentProjects` (5 maximum) et `recentActivity` (10 maximum). Le journal ne
renvoie que `id`, `type`, `projectId`, `createdAt`, sans payload ni secrets.
Les états absents valent zéro ; une organisation inconnue produit `404`.

## WS
Connexion `/api/events` authentifiée sur loopback, abonnement limité aux projets/conversations autorisés ; message `{id, type, version, projectId, createdAt, payload}`. À reconnexion, le client donne un curseur ou récupère l'historique par HTTP. Dé-duplication sur `id`.

## Cas d'erreur
Référence inter-projet : `NOT_FOUND` ou `FORBIDDEN` selon politique uniformisée ; aucune fuite de métadonnées. `409` conflit/idempotence ; `422` validation. L'autorisation côté serveur reste obligatoire même sur loopback.
