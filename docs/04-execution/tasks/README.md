# Backlog d'exécution pour Codex

**42 tâches** à objectif unique, avec vérification. Le statut réel de chaque
tâche figure dans [le suivi](../status.md). Les références dans chaque tâche
pointent vers la documentation en amont. Ne jamais exécuter deux tâches sur la
même zone de modification sans coordination.

## Utilisation
1. Lire [plan](../plan.md), [dépendances](../dependencies.md) et [gates](../../00-product/decisions-open.md).
2. Choisir une tâche dont tous les prérequis sont satisfaits et les choix nécessaires validés.
3. Fournir à Codex la tâche, ses documents référencés et l'état réel du dépôt.
4. Vérifier les critères ; renseigner un rapport d'exécution et ne passer en terminé qu'après revue.

Le suivi global de l'avancement est maintenu dans [status.md](../status.md).

## Liste
| ID | Objet | Jalon | Dépend de |
|---|---|---|---|
| [TASK-001](TASK-001.md) | Inspecter le dépôt et la plateforme | P0 | — |
| [TASK-002](TASK-002.md) | Préparer les arbitrages de sécurité et plateforme | P0 | TASK-001 |
| [TASK-003](TASK-003.md) | Initialiser structure et scripts du projet | P0 | TASK-001 |
| [TASK-004](TASK-004.md) | Créer schéma et migrations du socle | P0 | TASK-003 |
| [TASK-005](TASK-005.md) | Fiabiliser stockage et migrations | P0 | TASK-004 |
| [TASK-006](TASK-006.md) | Implémenter contrôle d’accès serveur | P0 | TASK-003, TASK-004 |
| [TASK-007](TASK-007.md) | Créer service projets et groupe principal | V1-A | TASK-004, TASK-006 |
| [TASK-008](TASK-008.md) | Créer profils agents et registre fournisseurs | V1-A | TASK-004, TASK-006 |
| [TASK-009](TASK-009.md) | Gérer les affectations et droits projet | V1-A | TASK-006, TASK-007, TASK-008 |
| [TASK-010](TASK-010.md) | Implémenter conversations et participants | V1-A | TASK-007, TASK-009 |
| [TASK-011](TASK-011.md) | Persister et lire les messages | V1-A | TASK-010, TASK-006 |
| [TASK-012](TASK-012.md) | Écrire outbox et événements persistants | V1-A | TASK-004, TASK-006 |
| [TASK-013](TASK-013.md) | Exposer API HTTP du socle | V1-A | TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012 |
| [TASK-014](TASK-014.md) | Diffuser événements WebSocket avec reprise | V1-A | TASK-012, TASK-013 |
| [TASK-015](TASK-015.md) | Créer adaptateur fictif et tests de contrat | P0 | TASK-003 |
| [TASK-016](TASK-016.md) | Implémenter file persistante et transitions | P0 | TASK-004, TASK-012, TASK-015 |
| [TASK-017](TASK-017.md) | Mettre en place runner confiné et gate réel | P0 | TASK-002, TASK-006, TASK-016 |
| [TASK-018](TASK-018.md) | Développer adaptateur Codex validé | V1-A | TASK-015, TASK-017 |
| [TASK-019](TASK-019.md) | Développer second adaptateur validé | V1-A | TASK-015, TASK-017 |
| [TASK-020](TASK-020.md) | Relier sessions fournisseur aux affectations | V1-A | TASK-009, TASK-016 |
| [TASK-021](TASK-021.md) | Implémenter détection de mentions et routage | V1-A | TASK-011, TASK-016, TASK-020 |
| [TASK-022](TASK-022.md) | Connecter action structurée message.send | V1-A | TASK-006, TASK-011, TASK-012, TASK-015, TASK-021 |
| [TASK-023](TASK-023.md) | Implémenter demandes et décisions d’approbation | V1-A | TASK-006, TASK-012, TASK-016 |
| [TASK-024](TASK-024.md) | Construire navigation projets et collaborateurs | V1-A | TASK-013 |
| [TASK-025](TASK-025.md) | Construire messagerie temps réel | V1-A | TASK-013, TASK-014, TASK-021, TASK-024 |
| [TASK-026](TASK-026.md) | Créer activité et boîte d’approbations UI | V1-A | TASK-014, TASK-016, TASK-023, TASK-024 |
| [TASK-027](TASK-027.md) | Ajouter persistance et états des tickets | V1-B | TASK-004, TASK-007, TASK-009, TASK-012 |
| [TASK-028](TASK-028.md) | Implémenter actions de ticket et attribution | V1-B | TASK-006, TASK-009, TASK-022, TASK-027 |
| [TASK-029](TASK-029.md) | Lier une conversation unique à chaque ticket | V1-B | TASK-010, TASK-011, TASK-027 |
| [TASK-030](TASK-030.md) | Relier un dépôt Git autorisé au projet | V1-B | TASK-007, TASK-017 |
| [TASK-031](TASK-031.md) | Allouer espace Git et verrou d’écriture | V1-B | TASK-016, TASK-017, TASK-030 |
| [TASK-032](TASK-032.md) | Capturer livrables Git et preuves de tests | V1-B | TASK-027, TASK-031 |
| [TASK-033](TASK-033.md) | Implémenter soumission et revue séparée | V1-B | TASK-023, TASK-027, TASK-028, TASK-032 |
| [TASK-034](TASK-034.md) | Construire UI tickets et revue | V1-B | TASK-024, TASK-025, TASK-028, TASK-029, TASK-033 |
| [TASK-035](TASK-035.md) | Tester scénarios E2E et reprise | Release | TASK-018, TASK-019, TASK-021, TASK-022, TASK-026, TASK-033, TASK-034 |
| [TASK-036](TASK-036.md) | Auditer la sécurité de bout en bout | Release | TASK-017, TASK-019, TASK-022, TASK-023, TASK-031, TASK-033 |
| [TASK-037](TASK-037.md) | Valider sauvegarde, restauration et exploitation | Release | TASK-005, TASK-012, TASK-027, TASK-032 |
| [TASK-038](TASK-038.md) | Valider jalons et publier documentation MVP | Release | TASK-035, TASK-036, TASK-037 |
| [TASK-039](TASK-039.md) | Finaliser le registre global des profils | V1-A | TASK-008, TASK-009, TASK-013, TASK-024 |
| [TASK-040](TASK-040.md) | Construire le dashboard global | V1-A | TASK-013, TASK-024, TASK-026, TASK-027 |
| [TASK-041](TASK-041.md) | Construire le registre global des projets | V1-A | TASK-007, TASK-013, TASK-024 |
| [TASK-042](TASK-042.md) | Refonte UI/UX et navigation sans répétitions | V1-A | TASK-039, TASK-040, TASK-041 |

Le numéro de tâche indique un ordre de présentation, pas toujours un ordre strict : seules les dépendances listées font foi.
