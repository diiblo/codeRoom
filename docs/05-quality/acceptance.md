# Acceptation par jalon

## V1-A — Collaboration fiable
- [ ] Projet créé avec une et une seule conversation `main`.
- [ ] Deux agents utilisant des fournisseurs distincts sont configurables après validation de compatibilité.
- [ ] Un message ordinaire n'exécute aucun CLI ; une mention autorisée déclenche au maximum une exécution.
- [ ] A peut envoyer une demande structurée à B ; B reçoit une activation autorisée, sans relais humain.
- [ ] L'UI montre messages et états provenant de l'enregistrement durable.
- [ ] Après redémarrage, historique intact, `running` orphelines réconciliées sans faux succès.
- [ ] Usurpation utilisateur par sortie CLI et accès inter-projet refusés et audités.
- [ ] Demande d'approbation refusée/expirée n'exécute pas l'action.

## V1-B — Développement vérifiable
- [ ] Agent A crée un ticket avec critères d'acceptation ; agent B actif du même projet est affecté.
- [ ] Le ticket possède conversation dédiée, états conformes et historique complet.
- [ ] B travaille dans l'espace Git **autorisé** et produit modifications consultables.
- [ ] B soumet livrable avec preuves Git/tests vérifiées par CodeRoom.
- [ ] A ou propriétaire autorisé effectue revue, accepte ou demande corrections.
- [ ] Le ticket ne passe `done` que par transition serveur autorisée.
- [ ] Écriture concurrente non contrôlée et fusion/push sensibles interdits.
- [ ] Annulation/reprise cohérentes avec capacités du CLI et absence de redoublement d'effets.

## Conditions de release
- [ ] D-02/D-04/D-05 arbitrées et ADR mis à jour en `accepté`.
- [ ] Tests d'isolation réels et tests de sécurité passants pour OS ciblé.
- [ ] Sauvegarde et restauration démontrées.
- [ ] Deux fournisseurs vérifiés sur environnement cible (ou limite clairement déclarée, sans revendiquer le scénario complet).
- [ ] Procédure d'installation et reprise documentée ; aucun secret dans les logs/événements.

**Attention :** les cases ci-dessus sont des attentes, pas des validations réalisées.
