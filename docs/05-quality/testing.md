# Stratégie de tests

## Niveaux
1. **Unitaires** : règles métier, permissions, transitions, capacité fournisseur, corrélation d'identité, idempotence.
2. **Intégration** : SQLite et migrations temporaires, transaction message→événement, queue et lease, HTTP/WS, stockage/backup, Git sur dépôt temporaire.
3. **Contrats adaptateurs** : fournisseur fictif (`scripted`), variations JSONL, erreurs, interruption, capacité absente ; vrais fournisseurs dans suite marquée dépendante de l'environnement.
4. **End-to-end** : création de projet, agents, mentions, ticket, Git, revue, redémarrage et relecture complète.
5. **Sécurité** : cross-project, spoofing auteur, injection prompt, traversal, lecture de secrets, approbation illégitime, réseau hors politique, double exécution, annulation pendant écriture.

## Test sans frais de CLI
Un adaptateur fictif doit reproduire messages, sortie d'événements, échecs, délais et actions structurées. Les tests CI de base ne doivent pas exiger de compte chez un fournisseur.

## Réalités externes
Les résultats réellement obtenus, restrictions de plateforme et commandes
exécutées sont consignés dans [le suivi](../04-execution/status.md).
Node, les tests et le build sont exécutés dans Compose ; les CLI fournisseur
restent sur l'hôte avec les validations propres à chaque adaptateur.

## Vérification UI/UX dans Docker

`tools/ui/smoke.mjs` pilote Chromium et axe sans chaîne Node sur l'hôte. Les
mutations utilisent des fixtures locales au navigateur ; une seconde page lit
les vrais endpoints Docker sans aucune mutation. Le harnais vérifie les trois
liens de navigation, l'unicité des titres/actions, les CRUD, les URLs et le
rechargement, les fournisseurs détectés, la pagination, les erreurs/reprises,
les dialogues, le focus et les états vides. Les captures sont écrites dans
`.runtime/ui-qa/`, ignoré par Git. Les tests HTTP/SQLite complètent ce harnais
pour valider les vrais services.

Depuis le dépôt, en utilisant un nom de conteneur libre :

```bash
docker compose up -d api web
docker compose run --rm -d --name coderoom-ui-qa --user root --entrypoint tail api -f /dev/null
docker exec coderoom-ui-qa sh -c 'apk add --no-cache chromium && npm install --prefix /tmp/coderoom-ui-qa --no-audit --no-fund playwright @axe-core/playwright'
docker exec --user "$(id -u):$(id -g)" coderoom-ui-qa node tools/ui/smoke.mjs
docker stop coderoom-ui-qa
```

Le conteneur d'inspection est jetable ; Chromium et ses dépendances ne sont pas
ajoutés aux images applicatives. Le nom interne `web` est explicitement admis
par Vite pour permettre cette vérification au sein du réseau Compose.
La sortie attendue est un JSON `status=passed`. Les tests responsive couvrent
320, 390, 768 et 1440 px ; axe contrôle les règles WCAG A/AA sélectionnées,
sans remplacer une évaluation complète avec technologies d'assistance.

## Règle de qualité
Pas de comportement critique validé uniquement par mock : isolation de processus, Git et au moins deux fournisseurs doivent aussi disposer d'une validation réelle avant annonce du MVP complet.
