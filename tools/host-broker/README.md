# Broker hôte Windows CodeRoom

`serve-windows.ps1` est le point d'entrée du broker hôte Windows. Il est
volontairement en mode fail-closed : il permet la découverte des outils et la
validation d'un plan, mais reste en découverte seule par défaut. Le mode
`-EnableExecution` est une activation explicite, réservée après validation des
preuves natives Windows.

Le broker ne lance aucun CLI fournisseur sans `-EnableExecution`. Il n'utilise
aucune clé API ni passerelle de fournisseur : le mode normal est isolé avec un
profil temporaire, et le mode `host-login` utilise explicitement la session
locale déjà ouverte par l'utilisateur (`codex login`, ou la session native du
CLI concerné).

## Démarrage contrôlé

Depuis PowerShell sur Windows, dans la racine du projet :

```powershell
$env:CODEROOM_BROKER_TOKEN = (New-Guid).Guid.Replace('-', '') + (New-Guid).Guid.Replace('-', '')
$env:CODEROOM_WINDOWS_WORKSPACE_ROOT = 'C:\CodeRoom\workspaces'
$codexPath = Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin\codex.exe'
$antigravityPath = Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'
$opencodePath = $null # facultatif ; sinon recherche de "opencode" dans PATH

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\host-broker\serve-windows.ps1 `
  -CodexPath $codexPath `
  -AntigravityPath $antigravityPath `
  -OpenCodePath $opencodePath
```

Après validation des deux proofs Windows, l'activation explicite du transport
est réalisée en ajoutant `-EnableExecution` à cette commande. Sans ce drapeau,
le broker reste en découverte/planification et `/v1/execute` répond `409`.

Pour utiliser la session locale déjà ouverte, démarrer explicitement le broker
en mode `host-login` :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -Command "& '.\tools\host-broker\serve-windows.ps1' -EnableExecution -EnableHostSession -WorkspaceRoot '$env:CODEROOM_WINDOWS_WORKSPACE_ROOT' -CodexPath '$codexPath' -AntigravityPath '$antigravityPath' -OpenCodePath '$opencodePath'"
```

Ce mode ne copie pas `auth.json`, ne monte aucun profil dans Docker et ne
transmet aucune clé API. Le CLI est lancé par le broker Windows avec le profil
de l'utilisateur qui l'a connecté. Il reste désactivé par défaut et doit être
validé par une preuve native dédiée avant d'être utilisé avec un projet non
fiable.

## Preuve E2E du broker

Pour exécuter en une seule commande le proof stdout, le démarrage temporaire du
broker, health, discovery, plan et un `codex --version` confiné :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\host-broker\prove-windows-broker.ps1 `
  -WorkspaceRoot (Join-Path $env:USERPROFILE 'CodeRoom\workspaces')
```

Le harness crée un token temporaire, utilise un port de test, lit le flux
NDJSON avec `HttpClient`, puis arrête le broker et supprime son workspace de
preuve. Il ne lance aucune instruction autonome ni aucun prompt fournisseur.

Après validation de cette preuve, le smoke Codex réel et explicitement opt-in
se lance avec :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\host-broker\prove-windows-broker.ps1 `
  -WorkspaceRoot (Join-Path $env:USERPROFILE 'CodeRoom\workspaces') `
  -RunRealCodex
```

Pour tester la session `codex login` de l'hôte, ajouter explicitement
`-UseHostSession` :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\host-broker\prove-windows-broker.ps1 `
  -WorkspaceRoot (Join-Path $env:USERPROFILE 'CodeRoom\workspaces') `
  -RunRealCodex `
  -UseHostSession
```

Le smoke réel utilise une durée maximale de 120 secondes par défaut afin de
laisser le CLI initialiser sa session ; `-TimeoutMs` permet de la réduire ou
de l'ajuster dans la limite du broker.

Ce mode utilise uniquement `codex exec --json --ephemeral --sandbox read-only
--skip-git-repo-check`, un workspace temporaire et une instruction sans
modification. Il ne doit être considéré comme réussi que si un événement
`item.completed` retourne `CODEROOM_REAL_SMOKE_OK` et si le broker émet une
fin `succeeded` avec le code 0. Aucune API CodeRoom ne reçoit de credential de
fournisseur ; l'abonnement est utilisé exclusivement par le CLI hôte déjà
connecté.

Pour valider un autre CLI du catalogue avec le même parcours brokerisé, utiliser
le harnais générique :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\host-broker\prove-windows-cli.ps1 `
  -WorkspaceRoot (Join-Path $env:USERPROFILE 'CodeRoom\workspaces') `
  -ToolId antigravity `
  -UseHostSession

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\host-broker\prove-windows-cli.ps1 `
  -WorkspaceRoot (Join-Path $env:USERPROFILE 'CodeRoom\workspaces') `
  -ToolId opencode `
  -OpenCodeModel 'opencode/deepseek-v4.1-flash-free' `
  -UseHostSession
```

Le modèle de smoke par défaut est gratuit. Il peut être remplacé par n'importe
quel modèle visible dans la session OpenCode (`/models`). Le harnais choisit les
arguments headless propres au fournisseur, vérifie le
marqueur `CODEROOM_CLI_SMOKE_OK` dans la sortie NDJSON et exige une frame finale
`succeeded` avec `exitCode=0`. Un résultat direct hors broker ne compte pas.

Le token du broker doit rester dans l'environnement du processus et ne doit
pas être commité. Le mode loopback (`127.0.0.1`) est obligatoire et fonctionne
avec Docker Desktop via `host.docker.internal` dans l'environnement validé.

Les deux chemins explicites ci-dessus sont optionnels : sans ces paramètres,
le broker recherche automatiquement les emplacements `%LOCALAPPDATA%` connus
et les commandes disponibles dans `PATH`. Un autre utilisateur peut donc
utiliser sa propre installation sans modifier le code.

## Endpoints

Tous les endpoints exigent `Authorization: Bearer <token>` et les corps sont
limités à 64 KiB.

- `GET /health` : état du broker ;
- `POST /v1/discover` : recherche les outils enregistrés (`codex`, `agy`/
  Antigravity et `opencode`), sans lancement ;
- `POST /v1/plan` : vérifie outil, chemin résolu, workspace, arguments,
  environnement et timeout ; renvoie uniquement un plan sans valeurs secrètes ;
- `POST /v1/execute` : refus `409` par défaut. En mode `-EnableExecution`, la
  réponse est un flux `application/x-ndjson` borné
  composé de frames `{ type: "stdout", data }`, `{ type: "stderr", data }`
  et d'une frame finale `{ type: "completed", exitCode, signal, status }`.
  Le client conteneur valide chaque frame et interrompt le flux par annulation
  HTTP.

Exemple de découverte sans lancer de fournisseur :

```powershell
$headers = @{ Authorization = "Bearer $env:CODEROOM_BROKER_TOKEN" }
Invoke-RestMethod `
  -Uri 'http://127.0.0.1:47321/v1/discover' `
  -Method Post -Headers $headers -ContentType 'application/json' -Body '{}'
```

Le plan refuse par défaut le réseau, les variables héritées Windows, les
flags `--yolo`, `--no-sandbox` et `--dangerously-allow-all`, les chemins hors
de `CODEROOM_WINDOWS_WORKSPACE_ROOT` et les exécutables non découverts.

## Preuve native Windows

Le harnais `prove-windows-native.ps1` ne lance aucun fournisseur. Il exécute
des processus de test bénins et refuse le statut `passed` dès qu'une garantie
filesystem, réseau, processus ou secrets n'est pas démontrée :

```powershell
$proofRoot = Join-Path $env:USERPROFILE 'CodeRoom\workspaces'
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\host-broker\prove-windows-native.ps1 `
  -WorkspaceRoot $proofRoot
```

La preuve réseau est démontrée par l'AppContainer sans capacité réseau.
`-EnableFirewallProof` reste
refusé tant qu'un exécutable de runner dédié, distinct de PowerShell hôte, et
une règle pare-feu temporaire correctement bornée ne sont pas disponibles.
Le harness ne lance toujours aucun CLI fournisseur.

La redirection native de `stdout` est vérifiée séparément avec le même code
P/Invoke que la preuve principale. Ce test ne lance qu'un `cmd.exe` bénin et
ne doit être exécuté que depuis PowerShell Windows :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\host-broker\prove-windows-stdout.ps1 `
  -WorkspaceRoot (Join-Path $env:USERPROFILE 'CodeRoom\workspaces')
```

Il doit retourner `status=passed` avec `outputRedirected=true`. Cette preuve a
été validée dans PowerShell Windows ; le mode `host-login` doit encore être
validé séparément avec une session CLI locale avant d'être considéré comme
opérationnel pour des projets non fiables.

## Restrictions de validation

Le harnais de confinement AppContainer de base a été exécuté dans PowerShell
Windows et retourne `status=passed`. Le mode `host-login` est explicitement
distinct : il utilise le profil de session du compte Windows et doit être
réservé aux CLI dont le sandbox natif et le comportement d'accès au workspace
auront été prouvés. Aucun credential n'est copié dans Docker ou dans le dépôt.
