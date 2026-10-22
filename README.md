# CodeRoom

CodeRoom est un espace local de supervision de la collaboration entre outils
de développement IA. L'interface propose trois entrées : Dashboard, Espaces
de travail et Profils. Les outils fournisseur utilisent les sessions ouvertes
sur l'hôte, via le broker local ; leur exécution reste soumise aux validations
propres à chaque adaptateur.

## Prérequis

- Docker Desktop avec l’intégration WSL activée : le mode Docker-first exécute
  Node.js, npm, l'API, le frontend et le worker dans les conteneurs ;
- les CLI Claude, Antigravity, Codex et OpenCode restent installés sur la machine hôte
  et ne sont pas copiés dans les images.

Node.js et npm tournent dans Docker, y compris pour les vérifications.

## Démarrage Docker

```bash
docker compose up --build
```

Au premier lancement, copier `.env.example` vers `.env` seulement si ce fichier
n'existe pas encore. L’interface est disponible sur <http://127.0.0.1:5173> et
le health check sur <http://127.0.0.1:3000/health>.

Les services sont exposés uniquement sur loopback. Les outils fournisseur
restent installés sur la machine hôte et sont exposés au conteneur uniquement
par le broker local authentifié et confiné. Le panneau CodeRoom n'affiche que
les outils réellement retournés par la découverte du broker.

## Navigation

- **Dashboard** : statistiques des espaces, profils, tickets, exécutions et
  approbations ; activité récente et actualisation.
- **Espaces de travail** : registre avec recherche, filtres, ajout, modification
  et archivage. Cliquer sur le nom d'un espace ouvre ses onglets de travail.
- **Profils** : registre global indépendant des projets. Le fournisseur est
  choisi lors de l'affectation du profil à un espace.

Chaque registre possède une seule action d'ajout. Les paramètres locaux sont
accessibles par l'icône dans la barre supérieure. L'archivage conserve
l'historique ; les profils archivés sont exclus des nouvelles affectations.

## Stockage local

La base SQLite est déterminée par `CODE_ROOM_DATABASE_PATH`, ou par
`CODE_ROOM_DATA_DIR/coderoom.sqlite` si aucun chemin de base explicite n'est
fourni. En Docker, elle se trouve dans `/var/lib/coderoom/coderoom.sqlite` et
est persistée dans `.runtime/data` sur l'hôte. Les workspaces suivent
`CODE_ROOM_WORKSPACES_DIR` (`/workspaces` dans Docker, `.runtime/workspaces` en
local).

L'API applique les migrations et vérifie l'intégrité SQLite avant d'écouter.
Une migration impossible arrête le démarrage ; elle ne supprime pas
implicitement les données existantes.

## Vérifications

```bash
docker compose run --rm api npm run typecheck
docker compose run --rm api npm run lint
docker compose run --rm api npm run format:check
docker compose run --rm api npm test
```

Pour appliquer les migrations sur la base locale :

```bash
docker compose run --rm api npm run db:migrate
```

Les tests Chromium/axe et les captures de la refonte sont décrits dans
[la stratégie de tests](docs/05-quality/testing.md). L'avancement est maintenu
dans [le suivi](docs/04-execution/status.md).

## Dépannage Docker Desktop / WSL

Si Docker retourne `UtilBindVsockAnyPort` ou indique que l'intégration WSL est
inactive, ouvrir Docker Desktop puis activer la distribution Ubuntu dans
`Settings → Resources → WSL Integration`. Après redémarrage de Docker Desktop,
vérifier avec :

```bash
docker info
docker compose config
```
