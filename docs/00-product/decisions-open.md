# Registre des décisions et hypothèses ouvertes

Aucune entrée de cette page ne vaut approbation implicite.

| ID | Type | Sujet | Proposition | Condition de validation |
|---|---|---|---|---|
| D-01 | Existant | Nature du produit | Local, auto-hébergeable, multi-CLI | Confirmer |
| D-02 | Décision P0 | OS supporté au lancement | Windows x86_64 + Docker Desktop pour le support réel ; CLI natifs Windows via broker hôte ; Linux natif ultérieur ; WSL2 reste l'environnement de développement | Validée explicitement par le propriétaire le 2026-10-21 ; preuve Windows encore requise |
| D-03 | Proposition P0 | Second CLI | Gemini CLI ou Claude Code selon prototype | Test de compatibilité sur machine cible |
| D-04 | Décision P0 | Exécution de code | Broker hôte Windows minimal + sandbox native Windows prouvée ; restrictions filesystem, réseau, identifiants et processus ; fail-closed | Validée explicitement par le propriétaire le 2026-10-21 ; preuve réelle de confinement requise avant activation |
| D-05 | Décision P0 | Authentification UI | Interface liée à loopback uniquement pour le MVP ; aucune exposition distante | Validée explicitement par le propriétaire le 2026-10-20 ; authentification applicative à implémenter |
| D-06 | Proposition | Stack | React/TypeScript/Tailwind, Node/Fastify, SQLite/Drizzle, WS | Validation / contraintes OS |
| D-07 | Proposition | Versions | Prototype + V1-A + V1-B avant V2–V4 | Accord sur MVP |
| D-08 | Hypothèse | Dépôts | Un dépôt local Git existant par projet MVP | Scénario utilisateur et politique fichiers |
| D-09 | Proposition | Approbations | Politique explicite côté serveur, opération sensible refusée par défaut | Inventaire des actions sensibles |
| D-10 | Hypothèse | Reprise | Variable selon fournisseur/version ; peut nécessiter nouvelle exécution contrôlée | Capacités testées |

**Gates bloquants :** la preuve de plateforme Windows native pour D-02 et la
preuve réelle de confinement pour D-04 restent obligatoires avant toute mise en
service d'exécutions autonomes. D-05 interdit toute exposition distante tant
que l'authentification correspondante n'est pas implémentée. D-03 reste requis
avant l'acceptation V1-A avec deux fournisseurs. En attendant ces preuves,
implémenter au maximum un mode simulé ou une preuve technique isolée, pas un
moteur privilégié exploitable.

Consigner toute décision acceptée dans [les ADR](../01-architecture/decisions/README.md), avec date, responsable, conséquences et documents impactés.
