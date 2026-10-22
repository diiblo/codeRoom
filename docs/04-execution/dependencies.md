# Dépendances, parallélisation et gates

Le tableau de [l'index des tâches](tasks/README.md) fournit les prérequis de chaque TASK. Les dépendances sont strictes : il ne suffit pas d'être dans deux modules différents pour pouvoir travailler simultanément.

## Chaîne critique proposée
`001 -> 002 (décisions humaines) -> 017 (sécurité vérifiée) -> 018/019 (CLI réels) -> 021 (routage) -> 035/036 (E2E/sécurité) -> 038 (démo)`.

Chemin métier : `001 -> 003 -> 004 -> 007/008/009 -> 010/011 -> 027/028/029 -> 030/031/032/033 -> 038`.

## Parallélisation seulement après socle commun
- UI projets et modèles backend peuvent progresser sur branches séparées **après** contrats API stabilisés.
- Codex/second CLI après `015` (adaptateur fictif) et `017` (runner sécurisé), sur implémentations fournisseur distinctes.
- Tickets et UI messagerie peuvent coexister après leurs contrats ; les migrations concurrentes doivent être sérialisées.
- Tests sécurité et sauvegarde peuvent avancer avec services stables ; elles doivent être rejouées avant release.

## Collision de fichiers
Même si deux tâches semblent indépendantes, éviter les modifications concurrentes de migrations, routeur API principal, registre de permissions, types d'événements et écran shell commun. Vérifier l'état Git et les zones modifiées avant d'attribuer deux tâches simultanées.

## Interdiction
Ne jamais raccourcir la chaîne en activant les CLI en `dangerously-allow-all`, `yolo` ou permissions équivalentes pour contourner la conception sécurité.
