# Vision produit

## Existant
Application web locale et auto-hébergeable. Un utilisateur crée des profils d'agents de développement (Codex, Claude Code, Gemini CLI…), les associe à des projets, discute avec eux, distribue le travail et suit des livrables. Collaboration inter-fournisseurs, contrôle humain et traçabilité sont essentiels.

## Proposition de valeur
**Diriger une équipe d'agents IA comme une équipe de développement, sans jongler entre terminaux, conversations et tableaux de tâches.** L'utilisateur dirige ; les agents travaillent ; CodeRoom coordonne et vérifie l'état du travail.

## Utilisateur cible
Au départ : développeur ou responsable technique unique sur une machine qu'il administre. Hypothèse à confirmer : plateforme non destinée aux comptes multiples distants lors du MVP.

## Résultats observables
- Un projet possède un groupe principal et des agents affectés.
- Deux CLI différents peuvent échanger sans relais manuel de l'utilisateur.
- Un agent autorisé crée un ticket ; un autre travaille dessus et demande une revue.
- L'utilisateur voit l'auteur, l'état, les preuves et les actions en attente d'autorisation.
- Un redémarrage ne supprime ni les discussions ni les tickets et n'invente pas la réussite d'une exécution interrompue.

## Non-objectifs initiaux
Nouvel LLM, éditeur IDE, avatars animés, organisation d'entreprise complexe, cloud obligatoire, scheduling autonome sans garde-fous.

## Mesure du succès MVP
Voir [scénario d'acceptation](../05-quality/acceptance.md). Une belle interface n'est pas un substitut à une exécution traçable et vérifiable.
