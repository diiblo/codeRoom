# Contrats inter-modules — source de vérité unique

Ces contrats sont **proposés** ; leur validation suit les ADR. Ne pas copier des variantes différentes dans les tâches.

- [API HTTP / erreurs / WS](api.md)
- [Actions métier et autorisation](actions.md)
- [Événements persistants](events.md)
- [Adaptateurs fournisseurs](agent-adapter.md)
- [Exécutions et sessions](execution.md)
- [Compatibilité fournisseurs](provider-compatibility.md)
- [Conventions et permissions](conventions.md)

## Politique d'évolution
Versionner les événements et payloads incompatibles. Tout changement de contrat doit lister les consommateurs impactés et les tests de compatibilité. Les champs « exemple » ne sont pas des implémentations existantes.
