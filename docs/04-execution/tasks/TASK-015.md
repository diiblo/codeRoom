# TASK-015 — Créer adaptateur fictif et tests de contrat

**Jalon :** P0 · **Statut :** terminée

## Objectif
Valider l’orchestration sans coût ni fournisseur réel.

## Contexte
Cette tâche contribue à la livraison P0 de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../03-contracts/agent-adapter.md`
- `../../03-contracts/provider-compatibility.md`

## Prérequis
- TASK-003

## Périmètre
Fake adapter paramétrable produisant messages, événements, pauses, erreurs et annulations.

## Hors périmètre
Pas de raccordement CLI réel.

## Spécifications
Expose explicitement supported/unsupported/unverified ; même API que fournisseur réel.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Tests succès, sortie malformée, cancel, timeout, capacités absentes.

## Vérification
Exécuter suite de contrat indépendante d’un login et d’internet. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- Le contrat partagé `AgentAdapter` formalise `probe`, `execute` et `cancel`,
  ainsi que `ValidatedExecutionRequest`, les capacités et les événements
  normalisés (`output`, `tool_activity`, `usage`, `session_metadata`, `error`,
  `result`). Les quatre capacités sont toujours exposées avec un statut
  `supported`, `unsupported` ou `unverified`.
- `FakeAgentAdapter` est paramétrable localement par étapes : messages,
  événements, pauses, erreurs et sorties brutes. Il attribue une séquence aux
  événements, filtre les champs sensibles, produit un résultat contrôlé et ne
  dépend ni d'un login, ni d'un binaire, ni du réseau.
- Les annulations interrompent aussi une pause en cours et produisent des
  événements `CANCELLED` puis `result.cancelled`. Les timeouts et sorties
  malformées produisent une erreur explicite et ne peuvent pas être annoncés
  comme un succès. Une deuxième annulation est idempotente.
- Les tests de contrat couvrent le succès, la capacité absente/non vérifiée,
  la sortie malformée, l'annulation pendant une pause et le timeout.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test` — 52 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose config --quiet` — succès.

Restrictions restantes : l'adaptateur est volontairement fictif et ne lance
aucun fournisseur réel. Les capacités annoncées par les futurs adaptateurs
réels devront être vérifiées localement ; aucune reprise native, approbation
ou action structurée ne doit être inférée de ce fake.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
