# TASK-039 — Finaliser le registre global des profils

**Jalon :** V1-A  
**Statut :** Terminée

## Objectif

Présenter les profils IA dans une vue globale conventionnelle : bouton
`Ajouter`, tableau listant les profils et actions de modification et
d'archivage. Le profil reste indépendant d'un projet et son fournisseur est
choisi uniquement lors de l'affectation à un projet.

## Dépendances

- TASK-008
- TASK-009
- TASK-013
- TASK-024

## Périmètre

- corriger l'en-tête de la vue globale pour ne plus afficher le projet courant ;
- retirer de cette vue le panneau de configuration latéral non pertinent ;
- ajouter les routes HTTP de mise à jour et d'archivage ;
- afficher un tableau accessible avec les actions par ligne ;
- conserver l'historique par archivage plutôt qu'une suppression destructive ;
- ne jamais afficher un fournisseur comme propriété du profil global.

## Critères d'acceptation

- un profil peut être créé sans projet ;
- un profil peut être modifié, puis réapparaît avec ses nouvelles données ;
- l'archivage retire le profil des nouvelles affectations tout en conservant
  l'historique ;
- la vue n'affiche pas de faux fournisseur ou d'outil absent ;
- les tests HTTP et service couvrent création, modification, archivage et
  idempotence pertinente.

## Restrictions

Le fournisseur demeure une propriété de l'affectation. Le panneau broker et
les CLI hôtes ne sont pas modifiés par cette tâche.

## Réalisation

Le registre propose un tableau paginé, recherche, filtre, ajout, modification
et archivage confirmé. `PATCH /api/agents/:agentId` et
`POST /api/agents/:agentId/archive` utilisent les services existants. Le
fournisseur ne peut pas être modifié par la route de mise à jour du profil.
Les profils archivés restent consultables et sont exclus des nouvelles
affectations. Les tests HTTP réels couvrent validation, rejeu, refus des champs
interdits, absence d'identité et conservation de l'historique ; le harnais
navigateur de TASK-042 couvre le CRUD de bout en bout côté interface.
