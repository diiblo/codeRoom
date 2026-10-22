# ADR-002 — Exécutions sous contrôle et confinement

**Statut : accepté — amendé, preuve d'implémentation requise** · **Proposé : 2026-10-19 · Accepté : 2026-10-20 · Amendé : 2026-10-21**

## Contexte
Un CLI peut lire/écrire et exécuter des processus sous les droits de son utilisateur OS. Les contrôles métier serveur et Git worktrees ne suffisent pas à isoler le système.

## Choix accepté
Runner avec identité d'exécution non usurpable, politique serveur fail-closed, droits minimaux, isolation hôte adaptée à l'OS, appels externes bloqués par défaut, autorisations explicites et journal d'audit. La stratégie concrète est conditionnée au système d'exploitation.

## Options à évaluer
Conteneur restreint, sandbox système, compte OS dédié ou environnement VM ; mesurer isolation réelle des dossiers, secrets, processus et réseau. Aucun ne peut être déclaré sécurisé sans tests sur la plateforme cible.

## Conséquence
Tâches d'exécution réelle bloquées jusqu'au choix de l'OS et à la preuve
d'isolation. Le prototype avec outil factice reste possible. Impacts : runner,
adaptateurs, approbations, Git, déploiement et tests.

## Validation

Le propriétaire a validé le 2026-10-20 le modèle suivant : broker hôte
minimal, compte dédié, sandbox native de la plateforme supportée, réseau fermé
par défaut, secrets explicitement injectés, workspace pré-alloué et refus par
défaut. Les conteneurs CodeRoom ne montent ni le socket Docker ni la racine
hôte et ne lancent pas de commande arbitraire.

### Amendement Windows — 2026-10-21

La plateforme réelle initiale est Windows x86_64 avec Docker Desktop. Le broker
est donc un processus hôte Windows distinct du conteneur Linux ; il découvre ou
reçoit un chemin explicite vers un CLI Windows (`codex.exe`, `agy.exe`,
`opencode.exe`/`opencode.cmd`), vérifie
qu'il appartient à une liste enregistrée et n'accepte jamais une commande
arbitraire issue d'un agent. Le canal Docker → broker, la correspondance des
chemins de workspace et la sandbox Windows doivent être bornés et testés avant
activation. Linux natif devient une cible ultérieure et ne constitue plus un
prérequis du MVP Windows.

Cette acceptation porte sur l'architecture de contrôle, pas sur la preuve
technique. L'exécution réelle reste bloquée jusqu'aux essais de confinement
sur Windows avec Docker Desktop et à la vérification des scénarios filesystem,
processus, réseau, secrets, timeout, terminaison et audit.

### Amendement session fournisseur — 2026-10-22

Le chemin fournisseur CodeRoom n'utilise pas de clé API ni de passerelle
upstream. Le broker propose deux modes explicites : `isolated`, avec un
AppContainer et un profil temporaire sans session personnelle, et
`host-login`, avec le CLI Windows lancé dans le contexte du compte qui l'a
authentifié (`codex login`, ou authentification native du CLI concerné).

Le mode `host-login` ne copie ni `auth.json`, ni credential, ni profil dans
Docker ; le conteneur ne lance toujours aucun binaire fournisseur. Il est
désactivé par défaut et ne peut être considéré comme acceptable pour un projet
non fiable qu'après une preuve séparée du sandbox natif du CLI, du workspace,
des processus, du timeout et de l'absence d'accès hors politique. Le mode
`isolated` reste le défaut fail-closed.

**Décideur :** propriétaire CodeRoom.  
**Documents impactés :** D-02, D-04, D-05, runner, bridge hôte, adaptateurs,
approbations et tests de sécurité.
