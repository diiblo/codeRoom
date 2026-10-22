# ADR-003 — Adaptateurs par capacités

**Statut : proposé** · **Date : 2026-10-19**

## Contexte
Les fournisseurs exposent des modes de sortie, reprise, approbation et session différents. Forcer une interface universelle complète conduirait à des approximations.

## Choix proposé
Une interface minimale de lancement/suivi/annulation, plus matrice de capacités détectées par fournisseur/version/OS. La reprise native est facultative ; son absence se traduit par un nouvel essai contrôlé et un contexte explicitement reconstruit, pas une « reprise » inventée.

## Risques
Formats de streaming changeants, authentification CLI, comportements headless et permissions propres à l'outil. Tests de contrat obligatoires.

## Validation
Prototype réel de deux fournisseurs sur la plateforme choisie. Liens : [contrat](../../03-contracts/agent-adapter.md) et [compatibilité](../../03-contracts/provider-compatibility.md).
