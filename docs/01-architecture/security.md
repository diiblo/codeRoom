# Modèle de sécurité et limites

## Modèle de menace
Contenu non fiable (documents, messages, diff Git, stdout des outils), injection de prompt, usurpation d'identité, CLI capable d'exécuter des commandes, exfiltration de secrets, fuite inter-projets, débordement d'une exécution, abus de `@agent`.

## Garanties attendues
1. **Autorisation côté serveur** : permission attachée à affectation/projet + identité authentifiée, jamais extraite du texte ; rejet par défaut.
2. **Acteur réel** : appel d'action signé par la session d'exécution contrôlée, corrélé à l'agent et au projet ; aucun paramètre `asUser` provenant d'un LLM.
3. **Separation données/instructions** : document tiers, message ou stdout traité comme données non fiables ; il ne peut pas modifier la politique ou les droits.
4. **Isolation système** : une worktree n'est **pas** une sandbox ; restreindre filesystem, réseau, processus, identifiants, chemins et dépôts selon la plateforme réellement supportée. Pour code non fiable, aucune exécution autonome tant qu'une isolation effective n'est pas prouvée.
5. **Secrets** : pas de credentials frontend, journaux ni prompts par défaut ; transmettre uniquement les variables explicitement requises au processus concerné.
6. **Approvals** : demande persistante pour opérations sensibles ; décision explicite et attribuable au propriétaire ; permissions natives fournisseur configurées pour ne pas contourner la politique.
7. **Interface** : écouter loopback par défaut ; ne pas exposer à un réseau sans authentification et protection d'origine adaptées. Ne pas confondre utilisateur local et session web authentifiée.
8. **Audit** : trace corrélée des actions, décisions, erreurs ; protéger contre la divulgation de secrets et mettre une politique de rétention.

## Catégories d'actions
- **Lecture autorisée** : consultation limitée au projet et contexte.
- **Métier contrôlé** : messages, tickets, affectations après vérification du rôle/droit.
- **Sensible** : commandes à effets externes, suppressions, fusion Git, écritures hors périmètre, accès réseau/credentials ; exigent politique explicite et souvent approbation humaine.

## Gate de sécurité
D-02/D-04/D-05 dans [registre](../00-product/decisions-open.md) avant tout runner réellement autonome. Le MVP en mode simulé reste possible sans gate ; il ne doit pas être présenté comme sécurisé pour exécuter du code tiers.

## Tests minimum
Injection de prompt visant `approval.grant`, message falsifié auteur humain, référence cross-project, chemins traversant `..`, doublon d'action, interruption pendant commande mutante, accès secret externe à l'espace de travail, accès réseau refusé, contournement via CLI natif.
