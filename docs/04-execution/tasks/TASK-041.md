# TASK-041 — Construire le registre global des projets

**Jalon :** V1-A  
**Statut :** Terminée

## Objectif

Améliorer la gestion des espaces/projets avec une vue CRUD conventionnelle,
indépendante du dashboard et du contexte de travail d'un projet sélectionné.

## Dépendances

- TASK-007
- TASK-013
- TASK-024

## Périmètre

- afficher un registre global des projets avec bouton `Ajouter` ;
- lister les projets dans un tableau ou une liste structurée avec statut,
  description, activité et date de mise à jour lorsque disponibles ;
- permettre la modification du nom et de la description ;
- permettre l'archivage avec confirmation et conservation de l'historique ;
- distinguer clairement le registre, le dashboard et la vue détaillée d'un
  projet ;
- gérer les états vide, chargement, erreur et projet archivé ;
- utiliser les routes CRUD déjà présentes ou compléter les contrats si un
  besoin réel est identifié.

## Critères d'acceptation

- un utilisateur peut créer un espace sans confusion avec la sélection d'un
  projet existant ;
- chaque projet est visible avec son état réel ;
- une modification est persistée et visible après rechargement ;
- l'archivage empêche les nouveaux usages interdits tout en conservant les
  données historiques ;
- aucun bouton ne duplique inutilement la même action dans la sidebar, le
  dashboard et le registre ;
- les tests couvrent création, modification, archivage, idempotence et
  navigation vers le détail.

## Restrictions

Le registre ne configure ni le broker ni les fournisseurs. Le fournisseur est
choisi au niveau d'une affectation de profil dans un projet.

## Réalisation et preuves

- navigation globale `Dashboard` / `Espaces de travail` / `Profils` ;
- tableau projet avec recherche, filtre de statut, accès au détail et actions ;
- modification persistée via `PATCH /api/projects/:projectId` ;
- archivage confirmé et persistant via `POST /api/projects/:projectId/archive` ;
- panneau de contexte masqué sur les vues globales ;
- typecheck, lint, format, build et suite complète Docker réussis ;
- 32 fichiers de test et 144 tests passés, dont les tests HTTP de modification,
  archivage et lecture des projets archivés.

La revue utilisateur a révélé des doublons d'en-tête, d'action et de navigation
dans cette première version. TASK-042 les corrige avec trois entrées uniques,
ouverture depuis le registre et validation automatisée Chromium/axe dans Docker.
