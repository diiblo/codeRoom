# Périmètre et versions corrigés

## Correction essentielle
Le cahier des charges v1.0 mettait les tickets en V2, le Git en V3, mais les exigeait dans la première démonstration. Deux jalons distincts éliminent la contradiction.

| Version | Inclus | Non inclus | Sortie vérifiable |
|---|---|---|---|
| P0 — prototype | Détection et preuve d'exécution contrôlée de deux fournisseurs | Produit complet | Matrice de capacités et limites réelles |
| V1-A — collaboration | Organisation unique, projets, agents, affectations, groupe principal, messages, déclenchement explicite, sessions/exécutions, approbations, supervision minimale | Ticketing, Git avancé, équipes réutilisables | Deux agents échangent, historique persiste |
| V1-B — MVP utile | Ticket simple, actions structurées, discussion liée, espace Git contrôlé, livraison, revue, validation | Kanban avancé, planning complexe | Démonstration complète du cahier des charges |
| V2 — gestion | Documents, Kanban, jalons, planning, équipes réutilisables, tableaux de bord | Replanification autonome avancée | Projet planifié et suivi |
| V3 — collaboration avancée | Worktrees parallèles, tests automatisés enrichis, revues croisées, dépendances, mémoire validée | Autonomie ouverte | Deux travaux simultanés intégrables |
| V4 — autonomie | Délégation, débats, workflows, automatisations, extensions | Opérations non contrôlées | Équipe autonome dans limites autorisées |

## Contraintes de périmètre
La messagerie « privée » du MVP signifie : conversation entre participants déterminés, toujours rattachée à un projet pour garantir le cloisonnement. Les conversations inter-projets restent hors périmètre. `@tous` ne lance aucun processus automatiquement. Le traitement de nouveaux fichiers documentaires riches est V2.

## Definition of MVP
V1-B achevée et conforme à [l'acceptation](../05-quality/acceptance.md), incluant des tests de sécurité. V1-A est un jalon démontrable, pas le MVP métier complet.

## Statut
Découpage **proposé**, non validé. L'exécution autonome de code dépend de la résolution des décisions de sécurité et de plateforme.
