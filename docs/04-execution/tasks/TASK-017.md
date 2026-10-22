# TASK-017 — Mettre en place runner confiné et gate réel

**Jalon :** P0 · **Statut :** en cours — gate fail-closed et preuve Windows native passées ; exécution réelle encore fermée

## Objectif
Garantir une frontière technique contrôlée avant tout CLI autonome.

## Contexte
Cette tâche contribue à la livraison P0 de CodeRoom et applique les exigences du cahier de référence. Le code source, l'OS et les outils installés doivent être vérifiés avant toute modification.

## Références
- `../../01-architecture/security.md`
- `../../01-architecture/decisions/ADR-002-execution-security.md`

## Prérequis
- TASK-002
- TASK-006
- TASK-016

## Périmètre
Après approbation humaine des gates, implémenter runner hôte restreint et contrôles fs/réseau/secrets/processus.

## Hors périmètre
Ne pas contourner les contrôles natifs par mode permissif.

## Spécifications
Échec de confinement = refus du lancement ; ne pas traiter worktree comme sandbox ; interrompre arbre de processus.

## Contraintes techniques
Respecter les contrats `03-contracts/`, le cloisonnement par projet, l'idempotence des actions mutantes et l'audit quand applicable. Contrôler l'état réel du dépôt avant de sélectionner des chemins ou commandes. Les arbitrages P0 non acceptés bloquent toute opération privilégiée.

## Critères d'acceptation
- [x] Tests réels prouvant interdiction lecture fichiers hôte, accès secrets, réseau hors politique.
- [x] Logs expurgés.

## Vérification
Tester contre chemins traversants/symlinks, environnement fuitant, processus enfants et terminaison forcée. Documenter exactement les commandes réelles utilisées ; ne pas supposer de script `test` déjà présent.

## Réalisation et preuves

- `src/server/runner/gate.ts` impose une politique fail-closed multi-plateforme :
  outil et chemin exécutable enregistrés, workspace absolu contenu dans sa
  racine, preuve native de la plateforme obligatoire, réseau refusé par défaut,
  environnement allowlisté, secrets explicitement déclarés et redacts dans le
  plan de logs, durée bornée, `shell: false` et terminaison de l'arbre de
  processus exigée. Les chemins POSIX et Win32 sont traités selon la plateforme
  déclarée ; Windows exige `windows-native-v1`, un AppContainer, un token
  restreint de compatibilité et un Job Object prouvés.
- Les flags permissifs `--dangerously-allow-all`, `--yolo` et `--no-sandbox`
  sont refusés. Une preuve WSL, une preuve filesystem incomplète, une tentative
  de traversée, un secret hérité ou un hôte réseau non autorisé sont refusés.
- Le worker Compose est désormais sans réseau (`network_mode: none`), non-root,
  sans capacités, avec `no-new-privileges`, rootfs en lecture seule, limite PID
  et limite mémoire. Aucun socket Docker, binaire fournisseur ou credential hôte
  n'est monté.
- `tools/host-broker/prove-linux-native.sh` reste une preuve historique pour la
  cible Linux ultérieure ; il refuse WSL et ne constitue pas la preuve de la
  cible Windows.
- La cible courante exige un broker Windows hôte, une découverte contrôlée des
  exécutables (`codex.exe`, `agy.exe`, `opencode` ou chemin explicitement fourni), un canal
  Docker → broker borné et un harnais PowerShell de preuve filesystem,
  processus, réseau, secrets, timeout, terminaison et audit.
- `tools/host-broker/discover-windows.ps1` fournit la première brique de
  découverte : chemins `PATH`, emplacements Windows connus et chemins explicites
  sont examinés sans lancer les CLI ; la sortie JSON est marquée
  `execution=discovery-only`.
- `tools/host-broker/serve-windows.ps1` ajoute un canal HTTP authentifié borné
  aux opérations `health`, `discover` et `plan`. Les requêtes sont limitées en
  taille, les chemins sont résolus avant comparaison, l'environnement et les
  arguments sont filtrés, et `/v1/execute` répond en refus par défaut. Son
  activation exige le drapeau explicite `-EnableExecution`, après validation
  de la preuve Windows. Le contrat d'utilisation est documenté dans
  `tools/host-broker/README.md`.
- `src/server/runner/broker.ts` fournit le client côté conteneur : il impose un
  hôte local autorisé, un token, des réponses bornées et un timeout couvrant
  toute la lecture HTTP. Il expose la découverte, la planification et le
  transport NDJSON d'exécution ; ce dernier échoue fermé tant que le broker
  Windows refuse `/v1/execute`.
- `GET /api/v1/status` interroge désormais ce client lorsqu'un token broker
  est configuré et expose seulement l'état, les identifiants d'outils détectés
  et les absences ; aucun chemin Windows ni secret n'est renvoyé à l'interface.
- La carte d'état de l'interface affiche ces informations sous forme de statut
  lisible (`connecté`, `indisponible`, `configuration invalide` ou
  `non configuré`) sans proposer d'action d'exécution.
- `tools/host-broker/prove-windows-native.ps1` fournit désormais un harnais
  PowerShell fail-closed : il crée un AppContainer et un Job Object natifs,
  applique des ACLs temporaires, exécute uniquement un batch de test bénin et
  produit un objet `windows-native-v1` sans lancer de CLI fournisseur. Il
  refuse `passed` si les ACL hors workspace, le réseau, les liens de reparse,
  l'arbre de processus, les secrets ou les journaux ne sont pas démontrés.
- `tools/host-broker/prove-windows-stdout.ps1` réutilise le même type natif et
  vérifie la redirection `stdout` via handles hérités explicitement listés,
  sans lancer de CLI fournisseur. Cette preuve est un prérequis distinct avant
  l'ouverture de `/v1/execute` et retourne désormais `status=passed` avec
  `appContainer=true`, `outputRedirected=true` et `processTreeBound=true`.

Vérifications exécutées dans Docker :

- `docker compose run --rm api npm test -- --run src/server/runner/gate.test.ts` — 6 tests passés, dont le profil Windows.
- `docker compose run --rm api npm test` — 28 fichiers, 127 tests passés.
- `docker compose run --rm worker node -e 'const fs=require("node:fs"); const net=require("node:net"); const checks=[\`uid=\${process.getuid()}\`]; try{fs.writeFileSync("/etc/coderoom-probe","x"); checks.push("rootfs-write=unexpected")}catch{checks.push("rootfs-write=blocked")} try{fs.writeFileSync("/tmp/coderoom-probe","ok"); checks.push("tmp-write=allowed")}catch{checks.push("tmp-write=blocked")} const s=net.createConnection({host:"1.1.1.1",port:80}); s.setTimeout(500); s.on("connect",()=>{console.log(checks.concat("network=unexpected").join(";")); process.exit(1)}); s.on("timeout",()=>{console.log(checks.concat("network=blocked").join(";")); s.destroy(); process.exit(0)}); s.on("error",()=>{console.log(checks.concat("network=blocked").join(";")); process.exit(0)})'` — `uid=1000`, écriture rootfs bloquée, écriture `/tmp` autorisée, réseau bloqué.
- `docker compose run --rm api npm run typecheck` — succès.
- `docker compose run --rm api npm run lint` — succès.
- `docker compose run --rm api npm run format:check` — succès.
- `docker compose run --rm api npm run build` — succès ; avertissement non
  bloquant sur la taille d'un chunk frontend.
- `docker compose config --quiet` — succès.
- `bash -n tools/host-broker/prove-linux-native.sh` — succès.
- `./tools/host-broker/prove-linux-native.sh` — refus attendu sur WSL2 :
  `sandbox-proof status=refused reason=wsl-is-development-only`.
- Le parsing PowerShell de `tools/host-broker/discover-windows.ps1` n'a pas pu
  être exécuté depuis WSL : l'interopération `powershell.exe` a échoué avec
  `UtilBindVsockAnyPort: socket failed 1`, avant le parsing. Aucun CLI n'a été
  lancé.
- Le parsing et le démarrage de `tools/host-broker/serve-windows.ps1` restent à
  exécuter depuis PowerShell Windows ; aucune preuve de réseau, de processus ou
  de sandbox n'est déduite de la seule lecture du script.
- `tools/host-broker/prove-windows-native.ps1` a été exécuté dans PowerShell
  Windows avec `-WorkspaceRoot (Join-Path $env:USERPROFILE 'CodeRoom\workspaces')`.
  La sortie est `status=passed` : AppContainer, filesystem workspace-only,
  traversée, symlink/junction, home, fichier hôte, réseau par défaut refusé,
  Job Object, terminaison de l'arbre, limites, timeout, environnement et
  journaux expurgés sont tous à `true`. Aucun CLI fournisseur n'a été lancé
  par cette preuve de confinement.
- `tools/host-broker/prove-windows-stdout.ps1` a été exécuté dans le même
  PowerShell Windows avec un workspace dérivé de `$env:USERPROFILE`. Il
  retourne `status=passed`, avec stdout capturé et arbre de processus borné.
  Aucun CLI fournisseur n'a été lancé par cette preuve stdout.

## Limite de périmètre restante

La décision de plateforme Windows est validée et la preuve native est acceptée
par la gate. Le broker reste en découverte/planification par défaut ;
`/v1/execute` n'est activé qu'avec `-EnableExecution` et un adaptateur réel
validé. Le smoke Codex est maintenant validé par TASK-018 ; cette restriction
reste en place pour les fournisseurs non validés, notamment TASK-019.

## Définition de terminé
Code livré dans le périmètre annoncé ; critères vérifiés et preuves jointes ; tests pertinents exécutés (ou blocages précis signalés) ; aucune régression connue critique ; compte rendu des modifications et risques résiduels.
