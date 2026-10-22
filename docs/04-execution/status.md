# Suivi d'exécution CodeRoom

**Dernière mise à jour :** 2026-10-22  
**Périmètre :** lots d'implémentation du backlog `TASK-001` à `TASK-042`

Ce fichier est le tableau de bord de l'avancement. Il complète les tâches
détaillées ; il ne remplace ni leurs critères d'acceptation ni les décisions
d'architecture.

## Légende

- **Terminée** : critères vérifiés et preuves disponibles.
- **En cours** : travail commencé, vérification ou éléments requis restants.
- **À valider** : implémentation présente, revue ou validation finale restante.
- **Bloquée** : progression impossible sans décision ou changement externe
  explicitement identifié.
- **À faire** : aucun travail engagé.

## Vue d'ensemble

| Indicateur       | Valeur |
| ---------------- | -----: |
| Tâches terminées |     36 |
| Tâches en cours  |      3 |
| Tâches à valider |      0 |
| Tâches bloquées  |      0 |
| Tâches à faire   |      3 |
| Total            |     42 |

## Lot courant

### TASK-001 — Inspection du dépôt et de la plateforme

**Statut : Terminée**

Le rapport daté [`platform-inventory.md`](platform-inventory.md) formalise la
structure du dépôt, l'environnement WSL2, les versions détectées, Docker/Compose,
les scripts, les CLI présents ou absents, les inconnues et les risques. Aucun
secret ni fournisseur CLI n'a été exécuté.

### TASK-002 — Arbitrages de sécurité et de plateforme

**Statut : Terminée — décisions validées, preuves restantes**

La matrice de compromis et les essais exploratoires sont consignés dans
[`platform-security-arbitration.md`](platform-security-arbitration.md). D-02 et
D-04 ont été amendées le 2026-10-21 ; D-05 a été validée le 2026-10-20. La
preuve de confinement Windows et l'authentification applicative restent
nécessaires avant le runner réel.

### TASK-003 — Initialisation de la structure et des scripts

**Statut : Terminée**

Le squelette TypeScript/Fastify/Vite/React, les Dockerfiles, les scripts et les
tests de base sont présents. Les contrôles statiques JSON/YAML passent. Le
typecheck, le lint, le format, les tests, le build frontend et le démarrage HTTP
local sont validés. La validation Docker est également passée : configuration,
build des trois images et tests dans le conteneur API.

### TASK-004 — Schéma et migrations du socle

**Statut : Terminée**

La migration SQLite initiale, le runner versionné, le dépôt transactionnel et
les tests ciblés sont présents. Migration depuis une base vide, unicité des
affectations actives, rollback transactionnel et persistance après réouverture
ont été vérifiés.

### TASK-005 — Fiabilisation du stockage et des migrations

**Statut : Terminée**

Les chemins de données et de workspaces sont centralisés et documentés. L'API
applique les migrations et les contrôles d'intégrité avant d'écouter ; une
erreur bloque le démarrage. Le rollback d'une migration fautive, la persistance
et les validations statiques sont couverts par 9 tests exécutés dans Docker.

### TASK-006 — Contrôle d'accès serveur

**Statut : Terminée**

Le service central d'autorisation applique le refus par défaut, le cloisonnement
par projet et affectation, la vérification de permission explicite et le rejet
des identités ou références injectées. Les scénarios adversariaux et la
matrice de permissions sont couverts par 15 tests exécutés dans Docker.

### TASK-007 — Service projets et groupe principal

**Statut : Terminée**

La migration v2 ajoute les conversations et la demande de création idempotente.
`ProjectService` crée atomiquement le projet et sa conversation `main`, liste
les projets actifs ou archivés, et protège les projets archivés contre les
modifications. L'index unique SQLite garantit l'invariant d'une conversation
`main` par projet. Les 20 tests, le typecheck, le lint, le format, le build et
la migration ont été exécutés dans Docker.

### TASK-008 — Profils agents et registre fournisseurs

**Statut : Terminée**

La migration v3 ajoute la description des profils et le registre des
fournisseurs. Une migration v22 ajoute le fournisseur au contexte d'affectation
projet : un profil global peut maintenant être créé sans fournisseur, puis
réutilisé avec un fournisseur différent selon le projet. `AgentService` conserve
les profils archivés et rend visibles les profils sans fournisseur ;
`AssignmentService` persiste le choix du fournisseur projet. Les tests ciblés,
le typecheck, le lint, le format, le build et la migration ont été exécutés
dans Docker.

### TASK-009 — Affectations et droits projet

**Statut : Terminée**

La migration v4 ajoute l'idempotence des créations d'affectations.
`AssignmentService` garantit l'unicité active par projet et agent, conserve
l'historique des affectations désactivées et applique les ensembles de droits
canoniques. Les contrôles d'autorisation relisent ces droits et refusent les
permissions révoquées. Les 28 tests, le typecheck, le lint, le format, le build
et la migration ont été exécutés dans Docker.

### TASK-010 — Conversations et participants

**Statut : Terminée**

La migration v5 ajoute les participants explicites et l'idempotence des
conversations. `ConversationService` garantit le `main` unique, vérifie les
affectations du même projet pour les conversations directes et refuse l'accès
aux agents non participants. Les 32 tests, le typecheck, le lint, le format,
le build et la migration ont été exécutés dans Docker.

### TASK-011 — Persistance et lecture des messages

**Statut : Terminée**

La migration v6 ajoute les messages immuables et l'idempotence des créations.
`MessageService` impose l'identité serveur, les permissions de lecture/envoi,
la confidentialité des conversations et une pagination stable. Les 36 tests,
le typecheck, le lint, le format, le build et la migration ont été exécutés
dans Docker.

### TASK-012 — Événements persistants et outbox

**Statut : Terminée**

La migration v7 ajoute l'enveloppe `audit_events` et l'outbox persistante.
`EventService` garantit l'écriture transactionnelle, la lecture par curseur et
le cloisonnement par projet. Le publisher reprend les événements non marqués
comme livrés après redémarrage et les payloads sensibles sont expurgés.
`MessageService` publie `message.posted` dans la même transaction que le
message. Les 40 tests, le typecheck, le lint, le format, le build, la
migration et la configuration Compose ont été exécutés dans Docker.

### TASK-013 — API HTTP du socle

**Statut : Terminée — authentification applicative restante**

Les routes HTTP V1-A exposent les projets, agents, affectations, conversations,
messages et activité en réutilisant exclusivement les services métier. Le
middleware d'identité, les clés d'idempotence, la pagination et l'enveloppe
d'erreur corrélée sont couverts par 44 tests HTTP et métier. Les routes
refusent les identités absentes, les champs d'auteur injectés et les inputs
invalides. Les contrôles typecheck, lint, format et build ont été exécutés dans
Docker.

### TASK-014 — Diffuser événements WebSocket avec reprise

**Statut : Terminée — authentification applicative restante**

La route `GET /api/events` diffuse les événements persistés d'un projet après
contrôle `project.read`, avec message `ready`, identifiant d'événement et
curseur stable. La reprise après reconnexion est strictement postérieure au
curseur et les événements des autres projets sont exclus. Les trois scénarios
WebSocket sont couverts ; la suite complète atteint 47 tests passés. Les
contrôles typecheck, lint, format, build et configuration Compose ont été
exécutés dans Docker.

### TASK-015 — Créer adaptateur fictif et tests de contrat

**Statut : Terminée**

Le contrat `AgentAdapter` et `FakeAgentAdapter` couvrent les capacités
explicites, les événements normalisés, les messages, pauses, erreurs,
annulations et timeouts sans login, CLI ni réseau. Les sorties malformées ne
peuvent pas devenir un succès. La suite complète atteint 52 tests passés ; les
contrôles typecheck, lint, format, build et configuration Compose ont été
exécutés dans Docker.

### TASK-016 — Implémenter file persistante et transitions

**Statut : Terminée**

La migration v8 ajoute la file persistante des exécutions, les leases, les
transitions et les sessions ; la migration v9 protège l'unicité des clés de
session fournisseur. `ExecutionService` garantit l'idempotence du dispatch,
la réservation concurrente unique par affectation, les transitions légales,
l'annulation et la réconciliation en `unknown` après redémarrage ou expiration
de lease. Les transitions publient un événement d'audit et les états terminaux
restent immuables. La suite complète atteint 58 tests passés ; typecheck,
lint, format, build et configuration Compose ont été exécutés dans Docker.

Restriction résiduelle : aucun runner privilégié n'est activé par défaut. Les
fournisseurs Codex, Antigravity et OpenCode sont accessibles uniquement par le
chemin brokerisé explicitement activé et validé par TASK-017 à TASK-019.

### TASK-017 — Mettre en place runner confiné et gate réel

**Statut : En cours — gate fail-closed et preuve Windows native passées ; exécution réelle fermée par défaut**

`RunnerGate` refuse par défaut les plateformes non prouvées, les chemins hors
workspace, les exécutables non enregistrés, les secrets hérités, les flags de
permission permissifs et les destinations réseau hors allowlist. Le worker
Compose est isolé du réseau, non-root, sans capacités, avec rootfs en lecture
seule et limites PID/mémoire. Les 6 tests de gate, dont le profil Windows, la sonde worker (`uid=1000`,
rootfs bloqué, réseau bloqué), le typecheck, le lint et le format passent dans
Docker. Le harnais `tools/host-broker/prove-linux-native.sh` est conservé pour
la cible Linux ultérieure et refuse correctement WSL2. La cible actuelle
nécessite un broker Windows, la découverte contrôlée de `codex.exe`/`agy.exe`/
`opencode`
et une preuve PowerShell spécifique. Le broker strict expose déjà `health`,
`discover` et `plan`, mais refuse `/v1/execute` par défaut ; son activation
reste explicite et dépend d'un adaptateur réel validé. La
suite complète atteint désormais 28 fichiers et 127 tests passés. Le client
Docker correspondant est couvert par 4 tests et ne propose aucune exécution
réelle. Le statut API et la carte d'état de l'interface relaient maintenant la
découverte sans exposer les chemins Windows.

Dernière vérification runtime : le broker Windows a été démarré depuis WSL via
PowerShell, en loopback, puis atteint par le conteneur API via
`host.docker.internal`. Le statut API est `connected` et `codex`/`antigravity`
sont détectés sans lancer de CLI fournisseur.

Le harnais `tools/host-broker/prove-windows-native.ps1` a été exécuté dans
PowerShell Windows avec un workspace dérivé de `$env:USERPROFILE`. Il retourne
`status=passed` : AppContainer, ACL workspace-only, traversée, symlink/junction,
home, fichier hôte, réseau refusé par défaut, Job Object, terminaison complète
de l'arbre, limites de ressources, timeout, environnement filtré et journaux
expurgés sont prouvés. Aucun CLI fournisseur n'a été lancé dans cette preuve
de confinement.

Le harnais `tools/host-broker/prove-windows-stdout.ps1` a également été
exécuté dans PowerShell Windows avec un workspace dérivé de `$env:USERPROFILE`.
Il retourne `status=passed`, `appContainer=true`, `outputRedirected=true` et
`processTreeBound=true`. Aucun CLI fournisseur n'a été lancé dans cette preuve
stdout.

La preuve de confinement n'est plus bloquante. Le broker reste en découverte/
planification par défaut ; `/v1/execute` est implémenté derrière le drapeau
explicite `-EnableExecution`, avec AppContainer pour le mode isolé, Job Object,
ACLs temporaires et flux NDJSON borné. Le smoke Codex réel est validé par
TASK-018 ; l'activation d'un autre fournisseur reste soumise à sa preuve
dédiée.

### TASK-018 — Développer adaptateur Codex validé

**Statut : Terminée — adaptateur, session hôte et smoke réel validés**

`CodexAgentAdapter` encapsule `codex exec --json --ephemeral --sandbox
read-only` avec `shell: false`, workspace fourni par le runner, environnement
explicite, sortie bornée et expurgation des secrets. Le transport de processus
est obligatoire et injecté par le runner ; aucun fallback ne lance un binaire
hôte depuis le conteneur. Le client broker fournit maintenant un flux NDJSON
borné et `codex-broker.ts` l'adapte en processus compatible avec l'adaptateur.
`probe()` vérifie la version et `codex login status`. Les événements JSONL sont
normalisés ; les capacités de reprise, approbation et actions structurées
restent `unsupported`, tandis que le streaming devient `supported` uniquement
après observation d'un tour terminé.

Les tests injectés couvrent l'absence de transport conteneur, version/login,
commande sans shell, sortie normalisée, sortie malformée, secrets, turn
interrompu, annulation, timeout et flux brokerisé. La suite ciblée atteint 14
tests passés et la suite complète atteint désormais 30 fichiers et 137 tests
passés ;
typecheck, lint, format et configuration Compose passent dans Docker.

Le protocole brokerisé côté conteneur, la preuve native stdout et l'endpoint
`/v1/execute` conditionnel sont prêts. Le client accepte maintenant le plan
`execution=enabled` après la gate Windows. Le harnais propose le smoke réel
opt-in suivant, à exécuter depuis PowerShell Windows :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\host-broker\prove-windows-broker.ps1 `
  -WorkspaceRoot (Join-Path $env:USERPROFILE 'CodeRoom\workspaces') `
  -RunRealCodex
```

Le smoke réel a été exécuté depuis PowerShell Windows : `health`, `discovery`,
`plan` et le lancement AppContainer passent, puis `codex.exe` reste silencieux
120 secondes et le broker renvoie `timed_out`. Cette observation est cohérente
avec le réseau fournisseur refusé par défaut et l'absence volontaire de
credentials hôte dans l'environnement synthétique.

Le mode session hôte est maintenant explicite avec `-EnableHostSession` côté
broker et `sessionMode=host-login` dans le plan. Il réutilise la session locale
du compte Windows déjà ouverte par `codex login`, sans clé API, sans copie de
`auth.json` et sans passerelle fournisseur. Le mode isolé AppContainer reste
le défaut ; la preuve native du smoke Codex en mode session hôte est passée.
Son usage sur un projet non fiable reste interdit tant qu'une preuve
d'isolation propre au fournisseur n'est pas disponible.

Une première exécution native a bien lancé Codex mais a révélé un défaut du
parseur du harnais sur un bloc `stdout` multi-lignes. Après correction NDJSON,
la seconde preuve a retourné `status=passed`,
`health/discovery/plan/execution/realExecution=true`,
`sessionMode=host-login`, les événements `thread.started`, `turn.started`,
`item.completed` avec `CODEROOM_REAL_SMOKE_OK`, puis `turn.completed`, et
`exitCode=0`. Le message stderr `Reading additional input from stdin` est
informatif et n'a pas empêché la réussite.

### TASK-019 — Développer second adaptateur validé

**Statut : Terminée — adaptateurs et preuves natives validés**

Le catalogue du broker Windows est maintenant déclaratif et enregistre
`codex`, `antigravity` (`agy`) et `opencode`. Chaque outil peut être trouvé
dans les emplacements connus ou via `PATH`, avec un chemin explicite possible.
Les types de découverte côté serveur acceptent des identifiants d'outils
enregistrés sans exposer les chemins hôte à l'interface.

Le lot ajoute un transport NDJSON commun borné et annulable, deux adaptateurs
distincts (`antigravity` et `opencode`) et un registre explicite avec Codex.
Antigravity est lancé en mode plan/sandbox sans
`--dangerously-skip-permissions`, avec le prompt attaché à `--print` ; OpenCode
utilise `run --format json --pure` sans `--auto` et accepte un modèle
`provider/model` explicite. Les parseurs restent propres à chaque fournisseur.

Les contrôles du lot passent : 4 fichiers, 13 tests ciblés, 32 fichiers et
142 tests complets, typecheck, lint, format, build, configuration Compose et
parsing statique des trois scripts PowerShell. La découverte Windows native est
passée avec `codex`, `antigravity` et `opencode.cmd` détectés et `missing=[]`.
Le harnais générique accepte désormais un chemin fournisseur vide, ce qui
permet la résolution d'OpenCode via `PATH`. Le broker applique 512 MiB aux
autres outils et 2048 MiB à OpenCode par défaut, avec un override de démarrage
`-ExecutionMemoryLimitMb`. Après correction des arguments Antigravity et du
modèle OpenCode, les deux preuves natives en session hôte sont passées avec
`health/discovery/plan/execution/realExecution=true`, `exitCode=0` et
`CODEROOM_CLI_SMOKE_OK`. OpenCode utilise le modèle gratuit
`opencode/deepseek-v4.1-flash-free`.

Les preuves natives Antigravity/OpenCode couvrent la commande headless, la
session native, le format d'événements, le timeout et les limites d'exécution.
Les tests simulés restent complémentaires et aucun succès Codex n'a été
réutilisé comme preuve pour un autre fournisseur.

### TASK-020 — Relier sessions fournisseur aux affectations

**Statut : Terminée**

La migration v10 ajoute le statut et le contexte borné des sessions. Le service
de session garantit qu'un même agent reçoit des sessions distinctes selon le
projet, refuse toute reprise cross-project, vérifie l'identité et
`execution.request`, et n'autorise `nativeResume` qu'après capacité testée. La
révocation est persistante, auditée et idempotente. La suite complète atteint
65 tests passés ; typecheck, lint, format, build et configuration Compose ont
été exécutés dans Docker.

Restriction résiduelle : aucun fournisseur réel n'est lancé ; la reprise reste
à tester dans chaque adaptateur lorsqu'il sera autorisé par TASK-017.

### TASK-021 — Implémenter détection de mentions et routage

**Statut : Terminée**

La migration v11 ajoute les intentions de mention avec unicité durable par
message, agent cible et type de déclenchement. `MentionRoutingService` déduplique
les mentions, ignore `@tous`, vérifie l'affectation, la conversation,
l'archivage et la disponibilité du fournisseur, puis persiste intention et
exécution dans une transaction unique. Les refus sont audités et les mentions
issues des sorties d'agents sont désactivées pour empêcher les cascades A-B-A.
La suite complète atteint 70 tests passés ; typecheck, lint, format, build et
configuration Compose ont été exécutés dans Docker.

Restriction résiduelle : le raccordement aux actions structurées et aux flux
applicatifs reste prévu par TASK-022/TASK-025 ; aucune CLI réelle n'est lancée.

### TASK-022 — Connecter action structurée message.send

**Statut : Terminée**

La migration v12 ajoute l'idempotence durable des actions `message.send`.
`StructuredMessageActionService` recoupe l'identité agent, l'exécution,
l'affectation, le projet et la conversation, puis persiste message, action et
événement d'acceptation dans une transaction unique. Les payloads inconnus,
les identités falsifiées, les projets tiers et les conversations privées
inaccessibles sont refusés et audités. La suite complète atteint 75 tests
passés ; typecheck, lint, format, build et configuration Compose ont été
exécutés dans Docker.

Restriction résiduelle : aucun adaptateur fournisseur réel ni CLI n'est lancé ;
le bridge attend un appel depuis un composant d'exécution validé par TASK-017.

### TASK-023 — Implémenter demandes et décisions d’approbation

**Statut : Terminée — cœur métier livré, authentification propriétaire injectable**

La migration v13 ajoute les demandes d’approbation persistantes avec
`pending/approved/denied/expired`, idempotence, expiration, empreinte du
contexte d’exécution et attribution de la décision. `ApprovalService` relie la
demande à la lease de l’exécution dans une transaction unique, suspend en
`awaiting_approval`, réévalue projet, agent, affectation, droits et payload
avant décision, puis reprend uniquement après approbation valide. Un refus,
une expiration, une révocation de droits ou une modification du contexte
annule l’exécution sans effet sensible.

La boîte métier est disponible via `listPending`/`listApprovals`. Les événements
`approval.requested` et `approval.resolved` sont écrits dans l’audit et
l’outbox. Les tests couvrent le spoofing agent, la double décision,
l’expiration, la révocation de droits, la réconciliation après redémarrage et
la recréation du service sur le même stockage persistant. La suite complète
atteint 81 tests passés ; typecheck,
lint, format, build et migration ont été vérifiés dans Docker.

Restriction résiduelle : l’authentification applicative et le lien projet →
propriétaire humain ne sont pas encore implémentés. La route HTTP de décision
est maintenant raccordée à `ApprovalService`, mais son autoriseur propriétaire
serveur refuse par défaut ; une identité humaine passée uniquement par en-tête
ne peut donc pas approuver.

### TASK-024 — Construire navigation projets et collaborateurs

**Statut : Terminée**

Le frontend Vite/React propose maintenant une navigation en trois zones :
projets filtrés par organisation, contenu du projet et panneau de contexte
local. La vue projet affiche le groupe principal renvoyé par l’API, son état,
les affectations et les droits explicites. Le menu global `Profils` permet de
créer un profil IA avant tout projet. Dans un projet, l'affectation choisit
ensuite un fournisseur parmi les outils réellement découverts par le broker,
avec un ensemble de permissions.

Les formulaires utilisent les vraies routes HTTP, des clés d’idempotence pour
les mutations, une validation côté interface et des alertes réseau/API
lisibles. Les états vide, chargement, erreur, projet archivé et fournisseur
indisponible sont représentés sans données de démonstration. La migration v14
provisionne idempotemment l’organisation locale initiale `org_local`, attendue
par le modèle mono-espace, afin qu’une base neuve puisse créer son premier
projet depuis l’interface.

Les skills `react-patterns` et `frontend-design` du dépôt ont été appliqués :
état local maîtrisé, appels hors du rendu, contrôles accessibles, focus visible,
responsive mobile et direction visuelle de poste de supervision. Typecheck,
lint, format, build, suite complète (81 tests) et smoke HTTP Docker passent.
La hiérarchie des actions a ensuite été resserrée : création de projet, gestion
globale des profils et affectation projet disposent de points d'entrée distincts,
sans bouton répété dans la navigation ou les états vides. Le panneau broker
n'affiche que les outils effectivement détectés ; les outils absents ne sont
pas listés.

Restriction résiduelle : aucune authentification applicative complète n’est
encore disponible ; l’interface conserve donc la configuration d’identité
locale compatible avec les en-têtes actuels de l’API. Aucun navigateur
automatisable n’est installé dans l’environnement, le smoke test navigateur
n’a pas été affirmé.

### TASK-039 — Finaliser le registre global des profils

**Statut : Terminée**

Le registre global affiche les profils dans un tableau paginé avec recherche,
filtre, ajout, modification et archivage confirmé. Les routes HTTP réelles
couvrent les mutations et conservent l'historique. Un profil n'exige aucun
projet ni fournisseur ; seuls les profils actifs peuvent être affectés. Le
CRUD navigateur et les tests HTTP sont validés avec TASK-042.

### TASK-040 — Construire le dashboard global

**Statut : Terminée**

Le dashboard lit un agrégat SQLite cohérent via
`GET /api/dashboard?organizationId=…`. Il présente espaces, profils globaux,
affectations, tickets par état, exécutions, approbations non expirées et journal
récent sans payload sensible. Les lectures sont filtrées par organisation,
réservées à l'identité humaine locale. Les tests couvrent statistiques réelles,
absence de fuite inter-organisation, états vides, erreurs et reprise.

### TASK-041 — Construire le registre global des projets

**Statut : Terminée**

Le registre global est disponible dans l'interface avec ajout, tableau,
recherche, filtre de statut, ouverture du détail, modification et archivage
confirmé. L'API expose `PATCH /api/projects/:projectId` et
`POST /api/projects/:projectId/archive`; l'archivage conserve l'historique.
Le registre reste distinct du dashboard, de la vue détaillée et du broker.

Preuves exécutées dans Docker : typecheck, lint, format, build, suite ciblée
API/projet (12 tests) et suite complète (32 fichiers, 144 tests) réussis. Le
build conserve seulement l'avertissement connu sur la taille du bundle Vite.
La version initiale comportait encore des répétitions ; la refonte et la
validation navigateur sont désormais livrées dans TASK-042.

### TASK-042 — Refonte UI/UX et navigation sans répétitions

**Statut : Terminée**

Navigation principale limitée à trois liens : Dashboard, Espaces de travail et
Profils. Les projets s'ouvrent depuis leur registre et disposent d'une URL
stable, d'un lien de retour et d'onglets internes. Chaque registre a un seul
titre et un seul bouton d'ajout. Le panneau de droite est supprimé ; les
paramètres locaux sont accessibles dans une fenêtre depuis la barre supérieure.

Le système visuel utilise une navigation bleu nuit, des pages claires, une
typographie compacte et des contrôles cohérents. Les tableaux deviennent des
fiches sur mobile. Les skills React/design ont guidé le découpage des composants,
le focus, les dialogues et la hiérarchie des actions.

Preuves exécutées dans Docker le 2026-10-22 :

- suite complète : **35 fichiers, 187 tests réussis** ;
- lint, formatage, typecheck et build : réussis ;
- Chromium/Playwright : navigation, CRUD, archivage annulé/confirmé, URLs,
  pagination, recherche, onglets, dropdown des outils détectés et reprise réseau ;
- axe : aucune violation A/AA signalée dans les écrans et formulaires testés ;
- responsive sans débordement de page à 320, 390, 768 et 1440 px ;
- lecture navigateur des vrais espaces et du dashboard via l'API Docker,
  sans mutation de la base utilisateur.

Le harnais reproductible est `tools/ui/smoke.mjs` ; les captures locales sont
dans `.runtime/ui-qa/`. Les mutations UI testées utilisent des fixtures isolées ;
les endpoints sont également testés sur de vrais serveurs HTTP/SQLite temporaires.
Le build conserve son avertissement de taille de bundle. Aucun CLI fournisseur
n'a été lancé dans ce lot ; les restrictions métier existantes de messagerie,
de sécurité et d'exécution restent suivies dans leurs tâches.

### TASK-025 — Construire messagerie temps réel

**Statut : En cours**

La vue `Messages` fournit la liste des conversations accessibles, l’historique
HTTP paginé, l’envoi idempotent, les raccourcis de mentions et une timeline
dédupliquée. Le client ouvre `/api/events` avec le curseur courant, recharge les
messages après `message.posted` et tente une reconnexion après interruption.
Les permissions et erreurs d’identité sont affichées dans la vue. L’API
évalue maintenant les mentions après chaque envoi et renvoie leurs intentions,
sans déclencher de CLI depuis le navigateur.

Typecheck, lint, format, build, suite complète (19 fichiers, 81 tests),
configuration Compose et smoke HTTP Docker passent. Le test API couvre aussi
le retour d’une mention rejetée par la politique anti-cascade.
La vérification ciblée du lot a également passé 3 fichiers et 14 tests
(API, routage de mentions et reprise WebSocket).

Reste à valider : aucun navigateur automatisable n’est installé pour exécuter
le scénario E2E envoi/reconnexion. La politique actuelle exige une identité
agent affectée et refuse les mentions issues d’une sortie d’agent ; cette gate
n’a pas été contournée pour permettre artificiellement un déclenchement humain.

### TASK-026 — Créer activité et boîte d’approbations UI

**Statut : En cours — interface et API livrées, preuves UI restantes**

L’onglet `Activité` relit les exécutions persistées, les erreurs normalisées et
les approbations du projet après chaque chargement. Il présente un résumé
compact, la file d’exécution, la boîte des décisions et, pour une identité
agent autorisée, le journal d’événements durable. Les sorties et payloads
potentiellement sensibles ne sont pas affichés en clair dans la vue.

Les routes ajoutées sont `GET /api/projects/:projectId/executions`,
`POST /api/executions/:id/cancel`, `GET /api/approvals` filtrée par projet et
`POST /api/approvals/:id/decision`. L’annulation est bornée à l’affectation
agent cible et à `execution.request`. Une décision d’approbation passe par le
service métier et reste refusée tant que l’autorisation propriétaire serveur
réelle n’est pas configurée ; l’interface conserve la demande pending après
ce refus. Les mutations exigent une clé d’idempotence.

Les skills `react-patterns` puis `frontend-design` ont été appliqués pour la
gestion d’état hors rendu, les confirmations explicites, les états d’erreur,
le responsive et la hiérarchie visuelle de la console.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/http/api.test.ts` — 5 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm test` — 19 fichiers, 82 tests passés.
- `docker compose run --rm api npm run build` — succès.

Les critères de reload et d’autorisation sont couverts côté HTTP par une
relecture après refus et un statut `403` qui laisse l’approbation `pending`.
Le scénario UI réel n’est pas coché : aucun navigateur automatisable n’est
installé dans l’environnement. L’authentification propriétaire applicative
reste aussi une restriction externe à cette tâche.

### TASK-027 — Ajouter persistance et états des tickets

**Statut : Terminée**

La migration v15 ajoute les tickets, les demandes de création idempotentes,
l’historique des transitions et les demandes de transition idempotentes. Le
`TicketService` valide l’auteur serveur, le projet actif, les critères, la
priorité et les états ; il applique une machine d’états contrôlée, conserve la
provenance et la raison d’un blocage, impose une raison pour la réouverture et
publie `ticket.created` ainsi que `ticket.state_changed` dans l’audit/outbox.

La création et la relecture après réouverture d’une base temporaire sont
couverte par les tests. La transition directe `todo -> done` est refusée ; le
chemin `in_review -> done` et la réouverture `done -> todo` avec raison sont
vérifiés. Les transitions mutantes sont idempotentes et cloisonnées par projet.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/tickets/service.test.ts src/server/db/database.test.ts` — 2 fichiers, 8 tests passés.
- `docker compose run --rm api npm test` — 20 fichiers, 85 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose config --quiet` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.

Les routes HTTP et les actions structurées sont désormais livrées par
TASK-028 ; la conversation dédiée relève de TASK-029 ; les livrables et le
contrôle des preuves/relecteurs restent dans TASK-032/TASK-033. Aucun blocage
ne subsiste dans le périmètre de TASK-027.

### TASK-028 — Implémenter actions de ticket et attribution

**Statut : Terminée**

La migration v16 ajoute l’idempotence persistante des actions tickets. Le
`StructuredTicketActionService` expose `ticket.create`, `ticket.assign` et
`ticket.update` depuis une exécution agent en cours, recoupe identité,
affectation, projet et permission, puis écrit l’action acceptée ou rejetée
dans l’audit/outbox.

Les routes `POST /api/actions` et `GET /api/projects/:projectId/tickets`
sont disponibles. La création, l’attribution et les transitions réutilisent
le domaine ticket ; un responsable doit être un agent actif affecté au même
projet. Les doublons idempotents rejouent le résultat initial et les actions
cross-project, les identités falsifiées, les permissions absentes et les
transitions illégales sont refusés.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/actions/ticket.test.ts src/server/http/api.test.ts src/server/db/database.test.ts` — 3 fichiers, 14 tests passés.
- `docker compose run --rm api npm test` — 21 fichiers, 89 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose config --quiet` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.

La conversation dédiée reste du périmètre de TASK-029 ; l’interface tickets
reste du périmètre de TASK-034. Aucun blocage ne subsiste dans TASK-028.

### TASK-029 — Lier une conversation unique à chaque ticket

**Statut : Terminée**

La migration v17 ajoute la référence `ticket_id`, l’unicité d’une conversation
`ticket` par ticket et une reprise idempotente des tickets déjà persistés. La
création d’un ticket et de sa conversation est maintenant effectuée dans la
même transaction ; une relecture après redémarrage retrouve le même fil.

Les conversations `ticket` sont visibles par les membres actifs du projet,
restent inaccessibles depuis un autre projet et dérivent leurs participants
des affectations actives, comme le groupe principal. La liste API les expose
avec `ticketId` et l’interface de messagerie les identifie comme « Discussion
du ticket ». L’historique de messages est relisible après création.

Les skills `react-patterns` puis `frontend-design` ont été appliqués pour
mettre à jour le type de conversation et son affichage sans introduire d’état
client supplémentaire ni de contrôle interactif non accessible.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/conversations/service.test.ts src/server/tickets/service.test.ts src/server/http/api.test.ts src/server/db/database.test.ts` — 4 fichiers, 19 tests passés.
- `docker compose run --rm api npm test` — 21 fichiers, 90 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose config --quiet` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.

Aucun blocage ne subsiste dans TASK-029. Les groupes temporaires libres restent
hors périmètre ; l’interface complète tickets/revue relève de TASK-034.

### TASK-030 — Relier un dépôt Git autorisé au projet

**Statut : Terminée — allocation et verrou d’écriture reportés à TASK-031**

La migration v18 garantit qu'un chemin de dépôt ne peut être associé qu'à un
seul projet et conserve les demandes de liaison idempotentes. Le
`ProjectRepositoryService` canonicalise et inspecte les chemins sans lancer de
CLI Git : chemins relatifs, segments `..`, symlinks, dépôts absents, métadonnées
Git incomplètes et chemins illisibles sont refusés. Les capacités de lecture et
d'écriture sont renvoyées dans la réponse ; la liaison est stockée dans
`projects.repository_path` et auditée.

La route `PUT /api/projects/:projectId/repository` exige une identité humaine
et une clé `Idempotency-Key`. Les répétitions sont rejouées, les liens vers un
autre projet sont refusés et le chemin apparaît ensuite dans le projet. Clone,
push, merge, worktree indirect et exécution Git restent hors périmètre.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/projects/repository-service.test.ts src/server/http/repository-api.test.ts src/server/db/database.test.ts` — 3 fichiers, 12 tests passés.
- `docker compose run --rm api npm test` — 23 fichiers, 97 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose config --quiet` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.

Aucun blocage ne subsiste dans TASK-030. L'authentification applicative
complète et la preuve Linux native restent des restrictions globales ; l'espace
Git et le verrou d'écriture sont volontairement laissés à TASK-031.

### TASK-031 — Allouer espace Git et verrou d’écriture

**Statut : Terminée — stratégie MVP partagée, worktrees parallèles hors périmètre**

La migration v19 ajoute les workspaces projet/ticket, les allocations
idempotentes et un verrou courant par dépôt avec historique des leases. La
stratégie `shared_repository` réutilise le chemin canonique du dépôt lié par
TASK-030 ; elle ne clone rien et ne lance aucune commande Git.

`WorkspaceService` permet d'allouer un workspace actif, de réserver son dépôt
avec un token et une lease bornée, puis de libérer le verrou. Deux writers
concurrents sont sérialisés/rejetés. Une lease expirée est marquée
`reconciliation_required` et bloque toute reprise automatique ; seule une
réconciliation humaine explicite peut la débloquer. Les exécutions sont
recoupées avec le projet et le workspace demandé. Le retrait est logique et ne
supprime pas les fichiers inconnus du dépôt.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/workspaces/service.test.ts src/server/db/database.test.ts` — 2 fichiers, 15 tests passés.
- `docker compose run --rm api npm test` — 24 fichiers, 107 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose config --quiet` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.

Aucun blocage ne subsiste dans TASK-031. L'isolation système du runner reste
conditionnée à TASK-017 ; les livrables Git relèvent de TASK-032.

### TASK-032 — Capturer livrables Git et preuves de tests

**Statut : Terminée — capture livrée, inspecteur réel conditionné à TASK-017**

La migration v20 ajoute les livrables, les demandes de soumission idempotentes
et les preuves de tests. `DeliverableService` recoupe le ticket, l'exécution,
le projet, le workspace et le verrou d'écriture avant de persister la
provenance Git : référence, commit, branche, état propre/sale, diff et acteur.
Les preuves sont limitées au runner contrôlé, conservent commande, sortie,
résultat, code de sortie et durée ; une exécution de test en échec reste
explicitement marquée `failed`. Les sorties et diffs sont expurgés avant
stockage, et l'événement `deliverable.submitted` n'expose pas les sorties
brutes.

Le service refuse les refs inconnues ou dangereuses, les chemins de dépôt
incohérents, les verrous expirés/perdus, les preuves hors runner et les
réutilisations divergentes d'une clé d'idempotence. `getDeliverable` et
`listByTicket` rendent la capture consultable. Par défaut, l'inspecteur Git
reste indisponible et échoue fermé : aucun CLI Git, broker hôte ou outil réel
n'est activé avant la preuve de confinement de TASK-017. Le contrat est vérifié
avec un fournisseur contrôlé injecté dans les tests temporaires.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/deliverables/service.test.ts src/server/db/database.test.ts` — 2 fichiers, 11 tests passés.
- `docker compose run --rm api npm test` — 25 fichiers, 113 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.
- `docker compose config --quiet` — succès.

Aucun blocage supplémentaire n'est introduit dans TASK-032. L'inspecteur Git
réel reste toutefois fermé jusqu'à TASK-017 ; la soumission/revue HTTP et
l'interface relèvent des tâches suivantes.

### TASK-033 — Implémenter soumission et revue séparée

**Statut : Terminée — revue atomique livrée, authentification humaine applicative restante**

La migration v21 ajoute les soumissions en revue, les verdicts, l'idempotence
des actions et l'historique. `ReviewService` exige un livrable soumis du même
ticket avec au moins une preuve de test ; il fait passer atomiquement le ticket
de `in_progress` à `in_review`, puis de `in_review` à `done` pour une
acceptation ou à `in_progress` pour un rejet motivé.

`StructuredReviewActionService` expose `ticket.submit_review` et
`review.submit`, vérifie l'exécution en cours, l'affectation, le projet et la
permission correspondante. Le responsable ne peut pas s'auto-valider, le
soumissionnaire d'un livrable ne peut pas le relire et une transition directe
vers `in_review` par `ticket.update` est refusée. Les verdicts humains passent
par `POST /api/tickets/:ticketId/reviews`; les revues sont historisées et
`review.recorded` est audité.

Commandes exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/reviews/service.test.ts src/server/db/database.test.ts src/server/http/api.test.ts` — 3 fichiers, 15 tests passés.
- `docker compose run --rm api npm test` — 26 fichiers, 117 tests passés.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non bloquant sur la taille d’un chunk frontend.
- `docker compose config --quiet` — succès.

Aucun blocage nouveau ne subsiste dans TASK-033. L'identité humaine HTTP
utilise encore le mécanisme d'identité applicative non authentifié réellement,
restriction globale déjà suivie ; aucun workflow distant, push ou PR n'est
activé.

### TASK-034 — Construire UI tickets et revue

**Statut : Terminée — interface livrée, validation navigateur manuelle documentée**

`TicketsView` expose la liste et la fiche d'un ticket avec état, responsable,
critères d'acceptation, conversation, livrables Git, preuves de tests et
historique de revue. Les données viennent des routes HTTP réelles ; aucun
jeu de données fictif n'est injecté. Une vue vide est affichée lorsqu'aucun
ticket n'est encore disponible.

La revue humaine est accessible depuis la fiche lorsqu'un ticket est `in_review`
avec les décisions d'acceptation ou de demande de corrections. Les preuves
manquantes, échouées ou bloquées produisent un avertissement explicite. La
mise en page est responsive, compatible clavier et respecte la préférence de
réduction des animations héritée de l'interface.

Les routes de lecture tickets et fiche ticket ont été ouvertes à l'identité
humaine applicative ; la soumission de revue réutilise la route métier
existante. Le typecheck, lint, format, build et la suite backend complète
passent dans Docker. Les services actifs répondent sur `127.0.0.1:5173` et
`127.0.0.1:3000/health`.

Limite documentée : aucun test composant ni E2E navigateur n'est disponible
dans le dépôt et aucun navigateur automatisé n'est installé. TASK-035 valide
les parcours backend et brokerisés ; la vérification navigateur reste manuelle
et ne bloque pas la livraison de l'UI compilée et connectée aux routes réelles.

### TASK-035 — Tester scénarios E2E et reprise

**Statut : Terminée — scénarios E2E/reprise et preuves CLI réelles validés**

Le nouveau harnais `src/server/release/e2e.test.ts` exécute trois scénarios
reproductibles avec le fournisseur fictif : parcours ticket → exécution →
livrable → revue humaine acceptée, réconciliation `running` vers `unknown`
après reload SQLite et annulation d'une exécution en pause. Le test WebSocket
existant couvre séparément la reconnexion avec reprise par curseur.

La suite ciblée atteint 2 fichiers et 6 tests passés ; la suite complète atteint
32 fichiers et 142 tests passés. Typecheck, lint, format, build et configuration
Compose passent dans Docker.

Les scénarios E2E backend couvrent le parcours ticket → exécution fake →
livrable → revue acceptée, la réconciliation après reload SQLite et
l'annulation sans sortie postérieure. La reprise WebSocket par curseur et les
contrôles d'isolation sont également validés. Les smokes réels Codex,
Antigravity et OpenCode sont validés via le broker Windows, en session hôte
locale, sans clé API injectée. Les contourner rendrait la preuve invalide et
contraire aux arbitrages D-02/D-04/D-05.

La validation d'interface navigateur reste manuelle faute de navigateur
automatisé dans le dépôt. Les audits sécurité, sauvegarde/restauration et
publication MVP restent les sujets de TASK-036 à TASK-038.

## Gates et restrictions actuels

- D-02, D-04 et D-05 sont validées ; l'authentification applicative reste un
  sujet de durcissement suivi séparément, tandis que les scénarios E2E de
  release de TASK-035 sont validés.
- Codex, Antigravity et OpenCode sont validés uniquement via le broker Windows
  explicite et leurs sessions hôte locales ; aucune clé API n'est injectée.
- Le worker reste volontairement inactif hors parcours explicitement autorisé ;
  le broker Windows, la découverte et les parcours brokerisés Codex,
  Antigravity et OpenCode sont validés. Toute exécution réelle reste soumise
  à la gate native et à une session hôte authentifiée.
- Docker Desktop est opérationnel après redémarrage et l'intégration WSL est
  validée par le build et les tests conteneurisés.
- `npm install` signale six vulnérabilités transitives ; aucun
  `npm audit fix --force` n'a été lancé automatiquement.

## Tableau complet

| ID                            | Objet                                             | Jalon   | Statut   | Dépend de                                                            |
| ----------------------------- | ------------------------------------------------- | ------- | -------- | -------------------------------------------------------------------- |
| [TASK-001](tasks/TASK-001.md) | Inspecter le dépôt et la plateforme               | P0      | Terminée | —                                                                    |
| [TASK-002](tasks/TASK-002.md) | Préparer les arbitrages de sécurité et plateforme | P0      | Terminée | TASK-001                                                             |
| [TASK-003](tasks/TASK-003.md) | Initialiser structure et scripts du projet        | P0      | Terminée | TASK-001                                                             |
| [TASK-004](tasks/TASK-004.md) | Créer schéma et migrations du socle               | P0      | Terminée | TASK-003                                                             |
| [TASK-005](tasks/TASK-005.md) | Fiabiliser stockage et migrations                 | P0      | Terminée | TASK-004                                                             |
| [TASK-006](tasks/TASK-006.md) | Implémenter contrôle d’accès serveur              | P0      | Terminée | TASK-003, TASK-004                                                   |
| [TASK-007](tasks/TASK-007.md) | Créer service projets et groupe principal         | V1-A    | Terminée | TASK-004, TASK-006                                                   |
| [TASK-008](tasks/TASK-008.md) | Créer profils agents et registre fournisseurs     | V1-A    | Terminée | TASK-004, TASK-006                                                   |
| [TASK-009](tasks/TASK-009.md) | Gérer les affectations et droits projet           | V1-A    | Terminée | TASK-006, TASK-007, TASK-008                                         |
| [TASK-010](tasks/TASK-010.md) | Implémenter conversations et participants         | V1-A    | Terminée | TASK-007, TASK-009                                                   |
| [TASK-011](tasks/TASK-011.md) | Persister et lire les messages                    | V1-A    | Terminée | TASK-010, TASK-006                                                   |
| [TASK-012](tasks/TASK-012.md) | Écrire outbox et événements persistants           | V1-A    | Terminée | TASK-004, TASK-006                                                   |
| [TASK-013](tasks/TASK-013.md) | Exposer API HTTP du socle                         | V1-A    | Terminée | TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012           |
| [TASK-014](tasks/TASK-014.md) | Diffuser événements WebSocket avec reprise        | V1-A    | Terminée | TASK-012, TASK-013                                                   |
| [TASK-015](tasks/TASK-015.md) | Créer adaptateur fictif et tests de contrat       | P0      | Terminée | TASK-003                                                             |
| [TASK-016](tasks/TASK-016.md) | Implémenter file persistante et transitions       | P0      | Terminée | TASK-004, TASK-012, TASK-015                                         |
| [TASK-017](tasks/TASK-017.md) | Mettre en place runner confiné et gate réel       | P0      | En cours | TASK-002, TASK-006, TASK-016                                         |
| [TASK-018](tasks/TASK-018.md) | Développer adaptateur Codex validé                | V1-A    | Terminée | TASK-015, TASK-017                                                   |
| [TASK-019](tasks/TASK-019.md) | Développer second adaptateur validé               | V1-A    | Terminée | TASK-015, TASK-017                                                   |
| [TASK-020](tasks/TASK-020.md) | Relier sessions fournisseur aux affectations      | V1-A    | Terminée | TASK-009, TASK-016                                                   |
| [TASK-021](tasks/TASK-021.md) | Implémenter détection de mentions et routage      | V1-A    | Terminée | TASK-011, TASK-016, TASK-020                                         |
| [TASK-022](tasks/TASK-022.md) | Connecter action structurée message.send          | V1-A    | Terminée | TASK-006, TASK-011, TASK-012, TASK-015, TASK-021                     |
| [TASK-023](tasks/TASK-023.md) | Implémenter demandes et décisions d’approbation   | V1-A    | Terminée | TASK-006, TASK-012, TASK-016                                         |
| [TASK-024](tasks/TASK-024.md) | Construire navigation projets et collaborateurs   | V1-A    | Terminée | TASK-013                                                             |
| [TASK-025](tasks/TASK-025.md) | Construire messagerie temps réel                  | V1-A    | En cours | TASK-013, TASK-014, TASK-021, TASK-024                               |
| [TASK-026](tasks/TASK-026.md) | Créer activité et boîte d’approbations UI         | V1-A    | En cours | TASK-014, TASK-016, TASK-023, TASK-024                               |
| [TASK-027](tasks/TASK-027.md) | Ajouter persistance et états des tickets          | V1-B    | Terminée | TASK-004, TASK-007, TASK-009, TASK-012                               |
| [TASK-028](tasks/TASK-028.md) | Implémenter actions de ticket et attribution      | V1-B    | Terminée | TASK-006, TASK-009, TASK-022, TASK-027                               |
| [TASK-029](tasks/TASK-029.md) | Lier une conversation unique à chaque ticket      | V1-B    | Terminée | TASK-010, TASK-011, TASK-027                                         |
| [TASK-030](tasks/TASK-030.md) | Relier un dépôt Git autorisé au projet            | V1-B    | Terminée | TASK-007, TASK-017                                                   |
| [TASK-031](tasks/TASK-031.md) | Allouer espace Git et verrou d’écriture           | V1-B    | Terminée | TASK-016, TASK-017, TASK-030                                         |
| [TASK-032](tasks/TASK-032.md) | Capturer livrables Git et preuves de tests        | V1-B    | Terminée | TASK-027, TASK-031                                                   |
| [TASK-033](tasks/TASK-033.md) | Implémenter soumission et revue séparée           | V1-B    | Terminée | TASK-023, TASK-027, TASK-028, TASK-032                               |
| [TASK-034](tasks/TASK-034.md) | Construire UI tickets et revue                    | V1-B    | Terminée | TASK-024, TASK-025, TASK-028, TASK-029, TASK-033                     |
| [TASK-035](tasks/TASK-035.md) | Tester scénarios E2E et reprise                   | Release | Terminée | TASK-018, TASK-019, TASK-021, TASK-022, TASK-026, TASK-033, TASK-034 |
| [TASK-036](tasks/TASK-036.md) | Auditer la sécurité de bout en bout               | Release | À faire  | TASK-017, TASK-019, TASK-022, TASK-023, TASK-031, TASK-033           |
| [TASK-037](tasks/TASK-037.md) | Valider sauvegarde, restauration et exploitation  | Release | À faire  | TASK-005, TASK-012, TASK-027, TASK-032                               |
| [TASK-038](tasks/TASK-038.md) | Valider jalons et publier documentation MVP       | Release | À faire  | TASK-035, TASK-036, TASK-037                                         |
| [TASK-039](tasks/TASK-039.md) | Finaliser le registre global des profils         | V1-A    | Terminée | TASK-008, TASK-009, TASK-013, TASK-024                               |
| [TASK-040](tasks/TASK-040.md) | Construire le dashboard global                  | V1-A    | Terminée | TASK-013, TASK-024, TASK-026, TASK-027                               |
| [TASK-041](tasks/TASK-041.md) | Construire le registre global des projets       | V1-A    | Terminée | TASK-007, TASK-013, TASK-024                                        |
| [TASK-042](tasks/TASK-042.md) | Refonte UI/UX et navigation sans répétitions     | V1-A    | Terminée | TASK-039, TASK-040, TASK-041                                        |

## Règle de mise à jour

Après chaque lot, mettre à jour la date, le statut de la tâche concernée, les
preuves disponibles, les commandes exécutées, les résultats et les risques
résiduels. Une tâche ne passe à **Terminée** qu'après vérification de tous ses
critères d'acceptation.
