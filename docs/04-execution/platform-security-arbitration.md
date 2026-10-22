# Préparation des arbitrages de sécurité et de plateforme

**Tâche :** [TASK-002](tasks/TASK-002.md)  
**Date :** 2026-10-20  
**Statut des décisions :** D-02 et D-04 amendées explicitement le 2026-10-21 ; D-05 validée le 2026-10-20 ; preuves d'implémentation restantes

Ce document a préparé les gates D-02, D-04 et D-05. Le propriétaire les a
ensuite validées ; le registre [`decisions-open.md`](../00-product/decisions-open.md)
et les ADR acceptés sont désormais les sources d'autorité. L'exécution
autonome réelle reste désactivée jusqu'aux preuves techniques requises.

## Contexte constaté

- La plateforme observée est Ubuntu 26.04 dans WSL2, x86_64, avec Docker
  Desktop 29.9.1 et Compose v5.6.0.
- Node.js applicatif est fourni par les images Docker `node:22-alpine`.
  L'hôte ne doit fournir que les CLI externes lorsqu'ils sont disponibles.
- Le Compose actuel est un environnement de développement : utilisateurs non
  root, `cap_drop: ALL`, `no-new-privileges` et volumes limités sont présents,
  mais `api`/`web` ont un workspace monté en écriture et le worker n'a pas
  encore de politique réseau ou de limites complètes de runner.
- Le worker n'injecte ni binaire CLI, ni socket Docker, ni credential hôte. Le
  bridge vers les outils hôte n'existe pas.
- Docker annonce le profil seccomp intégré et cgroup v2.
- `bwrap` et `systemd-run` sont présents dans WSL ; `firejail`, `nsjail` et
  `podman` ne le sont pas. `/dev/kvm` est absent. La présence d'un binaire ne
  constitue pas une preuve de confinement effectif.

## Matrice de compromis

| Option | Filesystem | Réseau | Secrets | Processus | Intégration des CLI hôte | Compromis / verdict |
|---|---|---|---|---|---|---|
| Runner Docker restreint | Bonne séparation si aucun volume large n'est monté ; perd sa valeur avec `/var/run/docker.sock` ou la racine hôte | `none` ou allowlist possible | Variables explicites, aucun home hôte | Capabilities, seccomp, cgroups et PID namespace disponibles | Mauvaise sans installer le CLI dans l'image ; un montage du binaire ou du socket élargit fortement la confiance | Bon pour API, worker et fournisseur fictif ; insuffisant seul pour lancer les CLI installés sur l'hôte |
| Runner Linux hôte avec sandbox | Peut limiter le workspace à un chemin autorisé et refuser le reste | Namespace réseau fermé ou allowlist | Pas de home hôte ; transmission explicite et éphémère | Namespace utilisateur/PID, `no_new_privs`, seccomp et compte dédié selon la preuve obtenue | Directe, sans exposer Docker au processus | Candidat recommandé, mais doit être testé sur la plateforme supportée avant toute acceptation |
| Broker Windows hôte avec sandbox native | ACL, workspace dédié et processus restreint à prouver | Pare-feu/allowlist à prouver | Aucun profil hôte transmis par défaut ; secrets explicitement injectés | Job/processus restreints et terminaison à prouver | Directe pour `codex.exe`/`agy.exe`, sans binaire Windows dans l'image | Cible retenue ; nécessite un canal Docker borné et une preuve Windows dédiée |
| Compte OS dédié sans sandbox | Permissions utiles pour les fichiers dédiés | Faible : ne bloque pas le réseau par défaut | Réduction des accès, mais pas confinement suffisant | Les processus restent largement visibles/contrôlables selon l'OS | Simple | Mesure complémentaire uniquement, jamais frontière unique |
| VM dédiée | Très forte si les partages hôte sont minimisés | Contrôlable au niveau VM | Meilleure séparation des credentials | Meilleure frontière système | CLI hôte non disponible directement ; nécessite un service déporté ou installation dans la VM | Plus robuste, mais `/dev/kvm` absent et coût opérationnel élevé pour le premier incrément |

### Conclusion technique

Le conteneur de développement ne doit pas être présenté comme la sandbox des
CLI. Pour respecter l'architecture « Node dans Docker, CLI sur l'hôte », la
frontière doit être explicitement séparée :

```text
API/worker Docker
       │ requête autorisée, identifiée et bornée
       ▼
broker hôte minimal
       │ chemin CLI fixe + compte dédié + sandbox prouvée
       ▼
CLI fournisseur hôte
```

Le broker ne doit pas accepter une commande arbitraire, un chemin arbitraire,
un `actorId` fourni par le modèle, un accès au socket Docker ou un montage du
répertoire personnel. Si la sandbox ne peut pas démontrer ces garanties, le
broker doit refuser l'exécution et le mode simulé reste le seul mode autorisé.

## Propositions soumises à validation

### D-02 — OS supporté au lancement

**Décision amendée le 2026-10-21 :** Windows x86_64 avec Docker Desktop est
la plateforme du runner réel initial. WSL2 reste l'environnement de
développement ; les CLI Windows sont lancés par un broker hôte contrôlé. Linux
natif devient une cible ultérieure.

| Choix examiné | Avantage | Coût / risque |
|---|---|---|
| Linux natif x86_64 | Primitives de sandbox explicites | Reporté ; demande une machine distincte |
| Windows + Docker Desktop | Correspond à l'hôte réel et aux CLI disponibles | Broker, mapping workspace et sandbox Windows à prouver |
| Linux natif et Windows dès le MVP | Couverture large | Double matrice de confinement ; reporté |

### D-04 — Exécution et isolation

**Décision amendée le 2026-10-21 :** broker hôte Windows minimal, lancé avec
un compte dédié, qui délègue les CLI à une sandbox Windows à prouver. Les
conteneurs CodeRoom ne doivent ni monter le socket Docker, ni accéder à la
racine hôte, ni exécuter un binaire fournisseur arbitraire. Réseau fermé par
défaut, secrets explicitement injectés, workspace pré-alloué et chemins
vérifiés côté serveur. Tout échec de preuve produit un refus, jamais un
fallback permissif.

**Preuve obligatoire avant acceptation :** lecture/écriture uniquement dans le
workspace autorisé, refus de `..` et des liens sortants, absence de lecture du
home et des secrets, processus hors périmètre inaccessibles, réseau refusé par
défaut, timeout et terminaison de l'arbre, et audit corrélé. Ces essais doivent
être effectués avec un fournisseur fictif ou une commande inoffensive dans un
environnement de test dédié ; aucun CLI réel n'est activé par cette tâche.

### D-05 — Authentification et exposition UI

**Décision validée :** loopback uniquement pour le MVP (`127.0.0.1`), avec
authentification de session ou token local pour les commandes mutantes, contrôle
d'origine et refus par défaut. L'écoute réseau distante, même sur un réseau
privé, reste désactivée tant qu'une identité distante, une protection CSRF et
une politique d'audit n'ont pas été définies.

Le Compose actuel publie déjà les ports sur loopback côté hôte. Cela réduit la
surface réseau, mais ne remplace pas l'authentification applicative et ne doit
pas être présenté comme une autorisation complète.

## Validation reçue du propriétaire — 2026-10-20 et amendement du 2026-10-21

- **D-02 :** Windows x86_64 + Docker Desktop pour le support réel ; WSL2 pour
  le développement ; Linux natif ultérieur.
- **D-04 :** broker hôte Windows minimal + sandbox Windows à prouver, avec
  refus par défaut et sans socket Docker exposé.
- **D-05 :** loopback uniquement pour le MVP ; aucune exposition distante.

Cette validation ne transforme pas la sonde Docker en preuve de confinement et
n'autorise pas encore les CLI réels. Les tests Windows du broker et
l'authentification applicative restent nécessaires.

## Trace de l'arbitrage demandé au propriétaire

Les choix soumis pour clore les gates étaient :

1. **D-02 :** Linux natif d'abord, Windows/WSL2 d'abord, ou les deux ;
2. **D-04 :** broker hôte + sandbox Linux prouvée, VM dédiée, ou aucun runner
   réel tant qu'une autre preuve n'est pas disponible ;
3. **D-05 :** loopback uniquement pour le MVP, ou exposition distante avec
   exigences d'authentification à définir.

Cette section est conservée comme trace de l'arbitrage initial ; la réponse
favorable est maintenant reportée dans ADR-002, ADR-004 et ADR-005 avec date,
décideur, alternatives et conséquences. Le mode réel demeure bloqué tant que
les preuves techniques ne sont pas produites.

## Vérifications exploratoires exécutées

Les commandes suivantes ont été lancées depuis le projet, sans installer de
paquet ni exécuter de CLI fournisseur :

```text
command -v bwrap firejail nsjail systemd-run podman docker
test -e /dev/kvm
systemd-detect-virt
sysctl -n kernel.unprivileged_userns_clone
stat -fc '%T' /sys/fs/cgroup
docker info --format '{{json .SecurityOptions}}'
docker compose config --quiet
docker run --rm --network none --read-only --user 1000:1000 --cap-drop ALL \
  --security-opt no-new-privileges:true --pids-limit 32 --memory 128m \
  --tmpfs /tmp:rw,noexec,nosuid,nodev coderoom-worker:latest node -e \
  "const fs=require('node:fs'); const net=require('node:net'); const checks=[]; checks.push('uid='+process.getuid()); try { fs.writeFileSync('/etc/coderoom-probe','x'); checks.push('rootfs-write=unexpected'); } catch { checks.push('rootfs-write=blocked'); } try { fs.writeFileSync('/tmp/coderoom-probe','ok'); checks.push('tmp-write=allowed'); } catch { checks.push('tmp-write=blocked'); } const s=net.createConnection({host:'1.1.1.1',port:80}); s.setTimeout(500); s.on('connect',()=>{console.log(checks.concat('network=unexpected').join(';')); process.exit(1)}); s.on('timeout',()=>{console.log(checks.concat('network=blocked').join(';')); s.destroy(); process.exit(0)}); s.on('error',()=>{console.log(checks.concat('network=blocked').join(';')); process.exit(0)});"
```

Résultats utiles : `bwrap` et `systemd-run` présents, `firejail`/`nsjail`/
`podman` absents, environnement détecté comme `wsl`, cgroup v2 (`cgroup2fs`),
`/dev/kvm` absent, Docker avec `seccomp` intégré et `cgroupns`, configuration
Compose valide. La sonde éphémère avec l'image locale `coderoom-worker:latest`
a également observé `uid=1000`, écriture racine bloquée, écriture de `/tmp`
autorisée et réseau bloqué. Cette sonde ne teste ni un CLI réel, ni les
processus hors périmètre, ni les secrets ; elle confirme seulement que les
restrictions Docker demandées sont applicables à cette image. Ces résultats
restent donc des prérequis d'étude, pas une validation de sandbox.

## Conclusion TASK-002

La matrice de compromis, les options, les preuves locales, les risques et les
validations sont documentés. D-02, D-04 et D-05 sont acceptées par le
propriétaire ; la préparation de TASK-002 reste terminée. La preuve de
confinement Windows, le broker et l'implémentation de l'authentification
loopback restent obligatoires avant tout runner réel.
