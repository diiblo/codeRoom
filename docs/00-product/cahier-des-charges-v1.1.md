# CodeRoom — Cahier des charges fonctionnel corrigé

**Version : 1.1 (proposition)** · **Date : 2026-10-19** · **Origine :** correction du cahier des charges 1.0 fourni par l'utilisateur.

## 1. Vision
CodeRoom est un espace web local et auto-hébergeable où un propriétaire gère des collaborateurs IA de développement, propulsés par leurs CLI natifs. L'utilisateur définit les objectifs et autorise les actions sensibles ; CodeRoom organise communications, travail, exécutions et preuves. La plateforme n'est pas un nouveau modèle IA.

## 2. Acteurs et concepts
- **Organisation** : un espace local initial ; multi-utilisateurs ou multi-tenant différé.
- **Collaborateur** : identité, fournisseur, rôle, instructions et état d'archivage ; le rôle ne donne pas de permissions.
- **Affectation** : appartenance à un projet et permissions propres au projet.
- **Projet** : objectifs, membres, conversation principale automatique, travaux, historique et dépôt optionnel.
- **Conversation** : principale, directe dans le projet, puis liée aux tickets ; participants autorisés.
- **Session fournisseur** : contexte natif éventuel attaché à une affectation, jamais global au collaborateur.
- **Exécution** : unité de travail persistée avec déclencheur, permissions, états, résultats, incidents et approbations.
- **Action structurée** : mutation de domaine (message, ticket…) contrôlée par le serveur ; ni instruction textuelle ni journal de sortie.

## 3. Les huit domaines fonctionnels

### 3.1 Messagerie collaborative
Messages et mentions dans les projets, conversations principales et directes, historique et événements temps réel. Message sans mention : pas d'exécution. Mention ciblée : déclenchement soumis aux contrôles. `@tous` notifie, sans démarrer tous les agents. Les discussions de ticket démarrent en V1-B ; recherches riches et pièces jointes en V2.

### 3.2 Collaborateurs et équipes
Création, édition et archivage des profils, sélection de l'outil et instructions. Affectations et permissions par projet. Les équipes réutilisables sont conservées dans la vision mais introduites en V2 pour réduire la complexité initiale.

### 3.3 Orchestration CLI
Registre de fournisseurs avec capacités réelles détectées ; adaptateurs par fournisseur, gestion de la file, interruptions, sessions, erreurs, approbations et reprise si supportée. Aucune reprise native universelle présumée. Contrat de lancement piloté par runner contrôlé ; aucun accès direct d'un message à un processus.

### 3.4 Projets et planning
Création des espaces projets, objectifs et suivi d'état au MVP. Organisation avancée (jalons, dépendances et replanification) en V2/V3. Les agents peuvent proposer des plans ; la validation humaine demeure configurable et obligatoire sur décisions sensibles.

### 3.5 Tickets et suivi
Dès V1-B, ticket avec description, critères d'acceptation, responsable, état, conversation et livrable. Flux `todo → in_progress → in_review → done`, avec blocage, annulation et retour pour correction. Une clôture nécessite un verdict autorisé et un livrable vérifiable, pas un message de l'agent.

### 3.6 Documents et connaissances
Import, versions, permissions et connaissances validées en V2 ; dans V1-A/V1-B, seuls les métadonnées, messages et références strictement nécessaires à la livraison sont conservés. Aucune base de connaissances sophistiquée prématurée.

### 3.7 Code, Git et livrables
Un dépôt local autorisé par projet, associé au ticket en V1-B, avec trace des modifications et résultats de test vérifiés. Contrôle des écritures concurrentes et pas de fusion/push automatique au MVP. Worktrees parallèles en V3. **Une worktree n'est pas une sandbox de sécurité**.

### 3.8 Supervision et permissions
Activité et états persistants, arrêt d'exécution, erreurs, approbations et audit. Boîte personnelle de décisions. Permissions vérifiées côté serveur, indépendantes de tout contenu généré. L'UI affiche des vues dérivées de données persistées, non de notifications volatiles.

## 4. Expérience utilisateur
Navigation initiale : **Messagerie, Collaborateurs, Projets, Tâches (à partir de V1-B), Activité**. Projet : Discussion, Équipe, Activité ; Tickets/Code en V1-B, Documents/Planning en V2. Disposition principale : colonne navigation, zone centrale, panneau de contexte optionnel. Les logs et commandes détaillés restent accessibles sur demande. Vue personnelle des approbations et incidents.

## 5. Modes de collaboration
- **V1-A** : dialogue ciblé entre deux fournisseurs, propagation contrôlée d'une demande et réponse visible.
- **V1-B** : partage du travail via ticket, action structurée, livrable Git, demande de revue, corrections.
- **V3** : véritable développement parallèle et revue croisée enrichie.
- **V4** : délégation autonome, débats techniques, workflows et replanification dans des limites définies.

Les messages ne confèrent aucun droit. Une collaboration initiée par agent suit les mêmes règles d'autorisation qu'une demande du propriétaire, avec des droits différents.

## 6. Architecture recommandée
React, TypeScript et Tailwind côté web ; Node.js, TypeScript et Fastify côté serveur ; WebSocket de notification ; SQLite et Drizzle ; monolithe modulaire ; runner d'exécution avec adaptateurs ; Git local. **Statut : proposition, à confirmer pour plateforme et isolation.** Les contrats de référence vivent dans `docs/03-contracts/` ; ne pas les redéfinir dans des tâches.

## 7. Sécurité et fiabilité — exigences de première version
Isolation des projets, affectations à permissions explicites, auteur non usurpable, refus par défaut des opérations sensibles, protection des secrets, audit, gestion des quotas et limites anti-boucles. Journalisation transactionnelle des actions et événements, file persistante, idempotence, état `unknown` au retour d'une exécution incertaine, sauvegarde/restauration vérifiée. Exécution réellement autonome **bloquée** avant validation de l'OS cible, de l'exposition réseau et d'une sandbox effective sur l'hôte.

## 8. Livraison incrémentale corrigée
- **P0 — Faisabilité** : inspection et preuve de compatibilité des deux CLI + isolation.
- **V1-A — Communication fiable** : profils, affectations, discussions, exécutions, permissions et supervision.
- **V1-B — MVP complet** : tickets minimaux, Git autorisé, livrables, revue et acceptation.
- **V2 — Gestion enrichie** : documents, planning, Kanban, équipes et dashboards.
- **V3 — Développement concurrent** : worktrees et tests/revues avancés.
- **V4 — Autonomie avancée** : délégation, automatisations bornées et autres CLI.

## 9. Première démonstration complète (V1-B)
L'utilisateur crée un projet, associe deux agents de fournisseurs distincts, fixe rôles et droits, déclenche un échange, voit un ticket créé par une action structurée et affecté à un second agent, observe un changement Git attribué, une demande de revue et une décision. Après redémarrage, l'historique est intact. L'annulation/reprise respecte les capacités réelles. Toute usurpation de l'utilisateur et opération hors périmètre doit être refusée.

## 10. Limites
Pas d'IDE complet, organigramme, personnages virtuels, autonomie illimitée, service cloud obligatoire ni suppositions sur les abonnements/frais des fournisseurs. Le projet n'est pas déclaré compatible avec une plateforme ou un CLI non effectivement testé.

## 11. Points à arbitrer
Système hôte, second CLI, méthode d'isolation et réseau/authentification de l'interface. Voir [registre des décisions](decisions-open.md). Le présent document reste une **proposition de correction** tant que ces points ne sont pas validés.
