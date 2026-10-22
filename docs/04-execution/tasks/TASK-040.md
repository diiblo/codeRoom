# TASK-040 — Construire le dashboard global

**Jalon :** V1-A  
**Statut :** Terminée

## Objectif

Fournir une vue de pilotage globale donnant une synthèse des projets, profils,
affectations, tickets, approbations et exécutions disponibles.

## Dépendances

- TASK-013
- TASK-024
- TASK-026
- TASK-027

## Périmètre

- ajouter une entrée globale `Dashboard` dans la navigation ;
- exposer une lecture agrégée depuis les données métier existantes ;
- présenter des cartes de synthèse et des listes d'activité récentes ;
- relier les indicateurs aux vues détaillées quand une route existe ;
- représenter les états vides, chargement, erreur et données partielles ;
- rafraîchir les indicateurs après mutation ou rechargement.

## Critères d'acceptation

- le dashboard fonctionne sans projet sélectionné ;
- aucun chiffre de démonstration n'est affiché ;
- les statistiques distinguent les états métier réels ;
- aucune information sensible du broker ou des credentials n'est exposée ;
- les tests API et frontend couvrent agrégation, état vide et erreur de lecture.

## Restrictions

Le dashboard ne devient pas un panneau de configuration. Le choix du
fournisseur reste dans l'affectation projet et le broker ne liste que les outils
effectivement découverts.

## Avancement

Le dashboard lit `GET /api/dashboard?organizationId=…` : espaces actifs/archivés,
profils globaux, affectations dans les espaces actifs, tickets et exécutions par
état, approbations non expirées et métadonnées d'activité récente. Le service
SQLite utilise un instantané de lecture et filtre les données projet par
organisation. L'accès est réservé à l'identité humaine locale existante.

Les indicateurs Espaces et Profils ouvrent leurs registres ; les événements
ouvrent l'activité de l'espace concerné. Chargement, état vide, erreur et
actualisation sont explicites. Les tests HTTP réels couvrent isolation,
agrégation, états absents et erreurs ; le navigateur couvre les états vides,
la panne de lecture et l'affichage responsive avec le harnais TASK-042.
