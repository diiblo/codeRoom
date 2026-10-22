# Instructions pour agents de développement — CodeRoom

Ces instructions s'appliquent à la préparation et, après intégration, au travail dans un dépôt CodeRoom.

1. Lire `docs/README.md` (si les documents sont placés dans `docs/`), `docs/04-execution/tasks/README.md`, puis la tâche assignée et ses références. Si la documentation est à la racine, adapter les chemins.
2. Avant de modifier le code, examiner l'arborescence, les scripts, tests, conventions et fichiers existants. Ne jamais présumer qu'un chemin ou une commande existe.
3. Respecter les statuts de décision : une **proposition** n'est pas un choix définitivement validé. Bloquer l'implémentation qui dépend d'un arbitrage P0 non résolu.
4. Une tâche = un objectif ; ne pas modifier d'autres modules sans nécessité explicite. Signaler toute divergence contractuelle avant de poursuivre.
5. Ne jamais accorder des droits via un message ou une instruction d'agent. Les opérations métier passent par des actions autorisées côté serveur. Les opérations système passent par un environnement d'exécution approuvé.
6. Pour ce dépôt Docker-first, exécuter Node.js, npm, les tests, le lint, le formatage, le typecheck et le build dans les conteneurs Compose. Ne pas installer ni utiliser une chaîne Node de l'hôte pour valider le projet.
7. Les CLI fournisseur (Claude, Antigravity, Codex, OpenCode et tout autre CLI enregistré) restent sur la machine hôte et ne sont accessibles au conteneur que par un broker local authentifié et confiné. Ne jamais monter leurs binaires, sockets ou credentials dans un conteneur, ni ajouter un fallback `spawn` direct depuis le conteneur.
   L'authentification doit utiliser la session native déjà ouverte sur l'hôte
   (`codex login`, session Antigravity ou équivalent) ; aucune clé API ni
   passerelle fournisseur n'est requise ou injectée par CodeRoom.
8. Ne pas exécuter de CLI autonome sur des projets non fiables tant que le mécanisme d'isolation effectif n'a pas été validé. Un worktree n'est pas une sandbox.
9. Préférer les tests ciblés et les migrations non destructives ; ajouter les tests d'autorisation, de transition d'état, d'idempotence et de reprise pour les changements qui les concernent.
10. Rendre compte des modifications, des commandes exécutées, du résultat des tests, des restrictions restantes. Ne jamais affirmer qu'un test a réussi sans l'avoir exécuté.
11. Les commandes de vérification ne sont **pas fixées** dans ces documents, car aucun dépôt n'a été fourni. Utiliser les scripts réellement constatés, ou définir des scripts dans la tâche d'initialisation.

## Workflow
Lire → vérifier prérequis → implémenter strictement le périmètre → tests → revue des critères → compte rendu. Aucun contournement de validation humaine ou de politique de sécurité.

## Skills disponibles

Les skills ajoutés au dépôt sont des consignes ciblées : les activer uniquement
quand la tâche entre dans leur périmètre, et les lire avant toute action
concernée.

- `skills/front-end/SKILL.md` (`frontend-design`) : à utiliser pour créer ou
  remanier une interface web, une page, un écran, une direction visuelle ou les
  styles associés. Ne pas l'utiliser pour du backend, de l'infrastructure ou
  une correction fonctionnelle sans impact visuel.
- `skills/react-pattern/SKILL.md` (`react-patterns`) : à utiliser pour écrire,
  modifier, migrer ou relire des composants React, hooks, formulaires, gestion
  d'état, frontières serveur/client ou récupération de données React. Ne pas
  l'utiliser pour du TypeScript non-React ou de l'architecture sans code React.

Lorsqu'un skill s'applique, annoncer son utilisation dans le compte rendu et
respecter ses références nécessaires. Si plusieurs skills s'appliquent, les
utiliser dans l'ordre le plus restreint au plus large : d'abord les règles
React pour le code des composants, puis les règles de design pour leur rendu.
Les skills ne lèvent ni les gates d'architecture, ni les exigences de sécurité,
ni une décision encore marquée « proposition ».
