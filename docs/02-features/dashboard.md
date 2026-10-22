# Dashboard global — V1-A

## Objectif

Donner une vue d'ensemble de CodeRoom avant d'entrer dans un projet ou dans le
registre des profils. Le dashboard est une vue de pilotage ; il ne remplace ni
la gestion détaillée d'un projet, ni la configuration du broker hôte.

## Informations attendues

- nombre de projets par état (`active`, `archived` et autres états supportés) ;
- projets récemment créés ou modifiés ;
- nombre de profils actifs et archivés ;
- affectations actives, avec répartition par projet et fournisseur découvert ;
- tickets par état et activité récente ;
- demandes d'approbation en attente ;
- exécutions récentes, succès, échecs et états bloqués lorsque ces données sont
  disponibles dans les contrats existants.

Les statistiques doivent être dérivées des données persistées et afficher un
état vide explicite lorsqu'aucune donnée n'existe. Aucune valeur de démonstration
ne doit être injectée.

## Navigation et responsabilités

- `Dashboard` est une entrée globale, indépendante du projet sélectionné ;
- `Espaces de travail` ouvre le registre CRUD ; un clic sur le nom ouvre le projet ;
- `Profils` ouvre le registre CRUD des profils réutilisables ;
- le broker reste une information technique séparée et n'est affiché que pour
  les outils effectivement détectés ;
- les fournisseurs restent choisis au niveau d'une affectation de projet, pas
  au niveau du profil global.

Ces trois entrées sont les seuls liens de la navigation principale. Aucun
projet individuel ni bouton d'ajout n'y est répété. Un registre possède un seul
titre et un seul bouton d'ajout ; les paramètres locaux sont accessibles dans
une fenêtre depuis la barre supérieure.

## Acceptation

- le dashboard reste compréhensible sans projet sélectionné ;
- chaque indicateur indique sa source métier et son état de chargement ;
- un clic sur un indicateur mène vers le contexte correspondant quand cette
  navigation est définie ;
- les données sont rafraîchies après une mutation pertinente ou un rechargement ;
- aucun secret, token ou détail interne du broker n'est exposé.

Références : [projets](projects.md), [profils](agents.md),
[modèle de domaine](../01-architecture/domain-model.md),
[contrat API](../03-contracts/api.md).
