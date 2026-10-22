# Projets et affectations — V1-A

## Objectif
Créer un espace de travail isolé et y associer des collaborateurs sans partager leurs sessions d'un autre projet.

La gestion des projets est un registre global : l'utilisateur peut créer un
espace, consulter la liste de ses espaces, modifier leurs informations et les
archiver. Le dashboard donne une synthèse, mais ne remplace pas ce registre.

## Règles
- Le propriétaire crée un projet avec nom non vide, description optionnelle, statut `active` ; identifiant stable.
- Création atomique du projet **et** de sa conversation principale `main`. En cas d'échec, aucun projet partiel visible.
- Les affectations lient un agent, un projet, un fournisseur découvert et un ensemble de droits explicites ; unicité des affectations actives pour une paire `(agent, projet)`.
- Un agent non affecté ne peut ni recevoir un déclenchement ni consulter le projet.
- Projet archivé : lecture historique autorisée selon droits ; nouveaux déclenchements, écritures et tickets refusés ; les exécutions encore actives sont traitées par une politique de fermeture explicite.
- L'archivage est l'opération de suppression métier : il conserve les
  conversations, affectations, tickets, exécutions et l'historique ; une
  suppression physique n'est pas proposée dans l'interface courante.
- Repository path (V1-B) validé côté serveur : existant, dépôt Git attendu et non traversée arbitraire d'autres répertoires.

## Cas limites
Nom vide, doublon de requête, suppression d'affectation pendant exécution, restauration projet, référence inter-projet. Les mutations sont idempotentes si même clé de demande.

## Acceptation
- Créer un projet produit exactement un groupe principal.
- Répéter la commande avec la même clé ne crée pas de doublon.
- Un agent sans affectation reçoit une erreur d'autorisation.
- Historique du projet archivé reste consultable.
- Le registre propose un bouton d'ajout, une liste/tableau, une modification et
  une action d'archivage avec confirmation.
- L'en-tête et le contexte du projet sélectionné restent distincts du registre
  global et du dashboard.

Références : [modèle](../01-architecture/domain-model.md), [contrat API](../03-contracts/api.md).
