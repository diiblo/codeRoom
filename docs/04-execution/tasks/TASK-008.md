# TASK-008 — Créer profils agents et registre fournisseurs

**Jalon :** V1-A · **Statut :** terminée

## Objectif
Gérer des identités durables indépendantes du processus CLI.

## Contexte
Cette tâche contribue à la livraison V1-A de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../02-features/agents.md`
- `../../03-contracts/agent-adapter.md`

## Prérequis
- TASK-004
- TASK-006

## Périmètre
CRUD raisonné + archivage ; associer fournisseur connu ; distinguer indisponibilité et suppression.

## Hors périmètre
Pas de sessions ni activation CLI.

## Spécifications
Profil n’hérite pas de permissions ; provider inconnu est non-exécutable ; pas de contexte partagé.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Les profils archivés sont conservés et exclus des listes actives.
- [x] Un fournisseur absent est visible comme `missing` et rend le profil non exécutable.

## Vérification
Tests CRUD, archivage et fournisseur non disponible. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- La migration `0003_provider_registry.sql` ajoute la description facultative
  des profils et un registre fournisseur avec états `available`,
  `unavailable`, `not-installed` et `unsupported`.
- `AgentService` gère l'enregistrement idempotent des fournisseurs, leur mise
  à jour et leur suppression. Une suppression laisse les profils existants et
  les expose avec l'état distinct `missing`.
- Les profils agents peuvent être créés, lus, listés, modifiés puis archivés.
  L'archivage conserve l'identité et l'historique potentiel, interdit les
  modifications et empêche l'exécution.
- L'état `executable` est dérivé du profil actif et d'un fournisseur réellement
  déclaré `available`. Un fournisseur absent, indisponible, non installé ou
  non supporté n'est jamais exécutable.
- Les capacités sont stockées dans le registre sans donner de permission
  technique au profil ; aucune session CLI ni aucun contexte inter-projet n'est
  créé par cette tâche.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test` — 24 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès.
- `docker compose run --rm api npm run db:migrate` — migration v3 appliquée.

Restriction restante : l'état `available` est une information persistée du
registre ; la détection réelle d'un CLI et l'exécution passent par les
adaptateurs et le runner des tâches ultérieures.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
