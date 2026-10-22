# TASK-042 — Refonte UI/UX et navigation sans répétitions

**Jalon :** V1-A  
**Statut :** Terminée  
**Demande utilisateur :** 2026-10-22

## Objectif et critères

- Exactement trois entrées dans la navigation principale : Dashboard, Espaces
  de travail et Profils.
- Aucun projet individuel ni bouton d'ajout dans la barre latérale.
- Un titre et une action d'ajout par registre ; les états vides guident vers
  cette action sans la dupliquer.
- Ouverture d'un espace depuis son nom dans le tableau, puis onglets internes
  Vue d'ensemble, Tickets, Équipe, Messages et Activité.
- URLs stables permettant rechargement, liens directs et historique navigateur.
- CRUD des espaces et profils : formulaires dédiés, erreurs conservant la
  saisie, confirmation d'archivage et conservation de l'historique.
- Paramètres accessibles depuis la barre supérieure ; aucun panneau de droite.
- Fournisseur choisi dans l'affectation, depuis les seuls outils détectés.

## Direction visuelle retenue

Palette : navigation bleu nuit `#18233d`, fond clair `#f6f7fb`, panneaux blancs
`#ffffff`, texte `#1d2939`, action indigo `#465fff`, succès `#147d64`.
Typographie système Segoe UI : titre de page de 25 à 30 px, titres de module
de 16 à 18 px, texte de 13 à 14 px. Alignement à gauche ; l'information et les
actions priment sur la décoration.

Disposition : trois liens persistants à gauche, barre supérieure discrète,
puis un en-tête unique et le contenu de la page. Sur mobile, les trois liens
passent en haut et les tableaux des registres deviennent des fiches avec les
actions visibles. Cette structure corrige les doublons des captures utilisateur.

## Dépendances et fichiers

- TASK-039 : CRUD global des profils.
- TASK-040 : statistiques et journal du dashboard.
- TASK-041 : registre des espaces.
- Composants partagés : `src/web/ui.tsx` ; navigation :
  `src/web/navigation.ts` ; écrans : `App.tsx`, `Directories.tsx`,
  `DashboardView.tsx` et `ProjectWorkspace.tsx`.
- Contraste, focus, dialogues natifs, navigation clavier et responsive suivent
  les skills `react-patterns` et `frontend-design` du dépôt.
- CORS autorise PATCH/PUT depuis les seules origines locales déjà admises.
  Le serveur Vite accepte le nom interne Compose `web` pour les tests navigateur.

## Vérification

Le harnais `tools/ui/smoke.mjs` exécute Chromium et axe dans Docker. Il couvre
navigation, titre/action uniques, ouverture/rechargement d'un espace, onglets,
CRUD, annulation d'archivage, pagination/recherche, fournisseurs détectés,
erreur d'enregistrement, erreur réseau/reprise, états vides, fermeture Échap
et restitution du focus. Les contrôles responsive portent sur 320, 390, 768
et 1440 px. Les contrôles axe sur desktop, mobile et formulaire ne signalent
aucune violation des règles WCAG A/AA testées.

Les mutations navigateur utilisent des fixtures isolées. Un passage en lecture
seule ouvre ensuite les vrais espaces et statistiques via l'API Docker. Les
captures sont disponibles localement dans `.runtime/ui-qa/` et ne contiennent
aucune donnée fictive injectée dans l'application réelle.

Exécution et reproduction : [stratégie de tests](../../05-quality/testing.md).
Suite complète : 35 fichiers et 187 tests réussis ; lint, formatage,
typecheck et build passent dans Docker. Le build conserve l'avertissement
de taille de bundle connu.
L'audit complet de sécurité, la messagerie humaine et la validation des CLI
restent dans leurs tâches respectives.
