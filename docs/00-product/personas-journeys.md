# Acteurs et parcours

## Acteurs
- **Propriétaire humain (V1)** : configure le projet, les droits, le dépôt, valide les opérations sensibles et les livrables.
- **Collaborateur IA** : profil persistant avec outil, rôle, instructions ; agit dans un périmètre de projet accordé ; ne possède pas de droits globaux implicites.
- **Système CodeRoom** : émet des événements d'orchestration et impose les politiques ; les événements système ne se font jamais passer pour un humain.

Les rôles architecte, développeur, testeur, chef de projet sont **des fonctions déclarées**, pas des droits techniques. Les permissions reposent sur des autorisations explicites.

## Parcours 1 : collaboration (V1-A)
Créer projet → groupe automatique → affecter Codex et second CLI → mentionner le premier → réception événement/processus → action `message.send` vers le second → réponse ou erreur visible → redémarrage → historique identique.

## Parcours 2 : livraison (V1-B)
Objectif → création d'un ticket autorisée → attribution autorisée → exécution dans espace de travail autorisé → soumission avec référence Git et tests → revue humaine ou agent autorisé → clôture vérifiée.

## Parcours dégradés
Outil absent, authentification du CLI expirée, dépassement de temps, session non reprenable, demande d'approbation, utilisateur qui annule, projet archivé, résultat externe incertain. Chacun doit être montré comme un état explicite sans fausse réussite.
