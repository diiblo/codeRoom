# Inventaire initial de la plateforme

**Tâche :** [TASK-001](tasks/TASK-001.md)  
**Date de relevé :** 2026-10-20  
**Répertoire inspecté :** racine locale du projet CodeRoom (chemin non contractuel)

## Méthode et portée

L'inventaire a été réalisé depuis le shell WSL du répertoire du projet. Les
commandes utilisées sont des commandes de découverte ou de lecture. Aucun
fournisseur CLI n'a été lancé, aucune dépendance n'a été installée et aucun
secret ou état de connexion n'a été inspecté.

Le relevé décrit l'environnement observé à cette date ; les ressources
mémoire, l'espace disque, les processus et la disponibilité des outils peuvent
évoluer.

## Résultats constatés

### Dépôt et structure

- Le dépôt contient la documentation produit, architecture, contrats,
  exécution et qualité, les skills locaux `frontend-design` et
  `react-patterns`, ainsi que le squelette TypeScript/Fastify/Vite/React.
- Le socle contient `docker-compose.yml`, trois services (`api`, `web`,
  `worker`), deux Dockerfiles Node, une migration SQLite et les scripts npm
  listés ci-dessous.
- `node_modules/` est présent, ainsi que les sorties `dist/`, `.data/` et
  `.runtime/`. Ces répertoires sont des artefacts locaux et ne constituent pas
  une preuve de versionnement.
- Aucun répertoire `.git` n'est présent dans le projet : la racine Git et le
  statut de branche ne peuvent donc pas être déterminés depuis cet espace.

### Système et ressources observées

| Élément | Résultat |
|---|---|
| Système | Ubuntu 26.04.1 LTS dans WSL2 |
| Noyau | Linux 6.18.54.1-microsoft-standard-WSL2 |
| Architecture | x86_64, 64 bits |
| CPU | 20 processeurs logiques |
| Mémoire au relevé | 7,6 GiB au total, 3,4 GiB disponibles |
| Swap au relevé | 2,0 GiB, 37 MiB utilisés |
| Disque du projet | 1007 GiB, 949 GiB disponibles |

### Runtime et outils

| Outil | Résultat |
|---|---|
| Node.js Linux | Absent du `PATH` WSL ; non requis pour le mode Docker-first |
| npm Linux | Résout vers `/mnt/c/Program Files/nodejs/npm`, mais le wrapper Windows échoue depuis le chemin UNC WSL |
| Node.js Windows | `v24.21.0` détecté dans `C:\Program Files\nodejs\node.exe` |
| Git | `2.53.0`, mais aucun dépôt Git local détecté |
| Codex WSL | `codex-cli 0.162.0-alpha.17.2` détecté |
| Codex Windows | `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe` détecté |
| Claude | Non détecté dans WSL ni via la recherche Windows réalisée |
| Antigravity Windows | `%LOCALAPPDATA%\agy\bin\agy.exe` déclaré par l'utilisateur ; version non vérifiée |
| Gemini | Non détecté dans WSL ni via la recherche Windows réalisée |

La version Node Windows satisfait la contrainte `>=22.13.0` déclarée par le
projet, mais elle n'est pas utilisée par l'architecture cible. Le runtime Node
applicatif doit rester dans les images Docker `node:22-alpine` ; l'hôte ne
fournit que les CLI externes Claude, Antigravity et Codex lorsqu'ils sont
disponibles. Le Node Windows détecté est uniquement une possibilité de secours
pour des commandes locales hors architecture cible.

### Docker

| Élément | Résultat |
|---|---|
| Client/serveur Docker | `29.9.1` / `29.9.1` |
| Moteur | Docker Desktop, x86_64 |
| Compose | `v5.6.0` |
| Contexte actif | `default`, socket `/var/run/docker.sock` |
| Compose validé | Configuration valide ; services `api`, `web`, `worker` |
| Ressources annoncées au moteur | 20 CPU, environ 7,6 GiB mémoire |

La configuration Compose a été vérifiée avec `docker compose config --quiet`.
La disponibilité du moteur a aussi été confirmée par `docker info`. Les
validations de build et de tests conteneurisés déjà consignées dans le suivi
restent les preuves d'exécution du lot TASK-003.

### Scripts disponibles

Les scripts réellement déclarés dans `package.json` sont :

```text
api:dev       tsx watch src/server/main.ts
db:migrate    tsx src/server/db/migrate.ts
web:dev       vite --host 0.0.0.0
worker:dev    tsx watch src/worker/main.ts
build         tsc --noEmit && vite build
typecheck     tsc --noEmit
lint          eslint .
format:check  prettier --check ...
test          vitest run
```

Le lockfile est au format npm `3`, pour le paquet `coderoom` version `0.1.0`.

## Absences et inconnues

- Il n'existe pas de runtime Node Linux directement appelable depuis le shell
  WSL. Ce n'est pas un blocage pour le mode Docker-first, mais cela empêche un
  repli implicite vers des commandes npm exécutées sur l'hôte.
- L'état Git (branche, commit, remote et modifications versionnées) est
  inconnu, car le répertoire fourni n'est pas une copie Git.
- La disponibilité et le protocole utilisable de Claude ne sont pas établis.
  Codex est détecté et le binaire Antigravity Windows est déclaré par
  l'utilisateur, mais leur compatibilité avec le futur bridge n'est pas
  validée.
- Aucun état de connexion, secret, abonnement ou credential de fournisseur n'a
  été inspecté.
- Le mécanisme d'isolation d'exécution des CLI n'est pas validé. Une worktree
  ou un conteneur de développement ne constitue pas à elle seule une sandbox
  conforme aux exigences du projet.

## Risques et restrictions

| ID | Risque ou restriction | Conséquence |
|---|---|---|
| R-001 | Node Linux absent du PATH WSL | Aucun impact sur le mode cible : exécuter Node et npm dans Docker ; ne pas supposer un runtime hôte |
| R-002 | Pas de métadonnées Git dans l'espace fourni | Impossible d'attacher l'inventaire à un commit ou de produire un diff Git fiable |
| R-003 | Claude non détecté ; Antigravity Windows non vérifié par exécution | Aucun adaptateur réel ni test fournisseur ne peut être déclaré disponible |
| R-004 | D-02, D-04 et D-05 sont acceptées, mais la preuve Windows et l'authentification restent incomplètes | Aucune exécution autonome ou exposition réseau supplémentaire ne doit être activée |
| R-005 | D-03 et la compatibilité fournisseur restent non validés | Codex détecté ne suffit pas à accepter un second fournisseur |
| R-006 | L'isolation effective n'est pas prouvée | Aucun CLI non fiable ne doit être exécuté autonomement |

## Commandes de découverte exécutées

Depuis la racine locale du projet, les familles de commandes suivantes ont
été réellement lancées :

```text
date -Is
uname -a
sed -n '1,12p' /etc/os-release
uname -m
getconf LONG_BIT
nproc
free -h
df -h .
command -v node npm docker git claude codex antigravity gemini
node --version
npm --version
git --version
git rev-parse --show-toplevel
git status --short
find . -maxdepth 3 -type f ...
du -sh .data .runtime node_modules
docker version --format '...'
docker compose version
docker compose config --quiet
docker context show
docker context ls
docker info --format '...'
docker compose config --services
codex --version
/mnt/c/Program Files/nodejs/node.exe --version
cmd.exe /c where claude
cmd.exe /c where codex
cmd.exe /c where antigravity
cmd.exe /c where gemini
/mnt/c/Program Files/nodejs/node.exe -e 'lecture de package.json'
/mnt/c/Program Files/nodejs/node.exe -e 'lecture de package-lock.json'
```

Les sorties complètes ne sont pas recopiées lorsqu'elles contiennent des
chemins locaux ou des messages d'environnement ; les valeurs utiles et les
erreurs déterminantes sont synthétisées ci-dessus. Aucun secret n'a été
collecté.

## Conclusion TASK-001

Les critères d'inventaire reproductible, de versions détectées, de risques et
de scripts disponibles sont couverts par ce rapport daté. Les inconnues sont
séparées des absences constatées et les gates P0 restent explicitement
inchangées. TASK-001 peut passer à **Terminée**.
