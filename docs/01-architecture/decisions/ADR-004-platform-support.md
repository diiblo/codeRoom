# ADR-004 — Plateforme supportée au lancement

**Statut : accepté — amendé** · **Proposé : 2026-10-20 · Accepté : 2026-10-20 · Amendé : 2026-10-21**

## Contexte

Le développement actuel se déroule dans Ubuntu sous WSL2 avec Docker Desktop.
Les CLI réels disponibles sont installés sur l'hôte Windows, tandis que Node.js
et l'application restent dans les conteneurs Docker.

## Décision

Windows x86_64 avec Docker Desktop est la plateforme supportée en premier pour
l'exécution réelle. Les CLI Windows sont lancés par un broker hôte contrôlé ;
les conteneurs Linux ne lancent pas directement de `.exe`. WSL2 reste
l'environnement de développement et de validation applicative, mais le runner
réel et sa preuve ciblent la frontière Windows/Docker Desktop. Linux natif est
une cible ultérieure nécessitant sa propre preuve.

## Alternatives examinées

- Linux natif x86_64 comme cible initiale : reporté afin de cibler l'hôte
  Windows réellement utilisé pour le MVP.
- Windows + Docker Desktop avec broker hôte : retenu ; la frontière Windows,
  le canal broker et la sandbox restent à prouver.

## Conséquences

- Les essais de confinement D-04 doivent être exécutés sur Windows avec Docker
  Desktop avant d'activer un runner réel.
- Le Compose Docker-first reste le chemin de développement normal ; Node.js
  demeure dans les conteneurs.
- Les CLI hôte et leur broker doivent déclarer explicitement la plateforme
  supportée, découvrir les exécutables ou accepter un chemin validé, puis
  refuser les environnements non validés.

## Validation

**Décideur :** propriétaire CodeRoom, validation initiale le 2026-10-20 et
amendement explicite le 2026-10-21.  
**Preuve restante :** test réel du runner Windows hôte avec Docker Desktop.
