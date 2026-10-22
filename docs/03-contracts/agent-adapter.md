# Contrat AgentAdapter — proposition

## Objectif

Encapsuler les API CLI incompatibles sans exposer aux modules métier les spécificités de commandes et formats.

## Interface conceptuelle TypeScript

```ts
type CapabilityStatus = "supported" | "unsupported" | "unverified";
type AdapterCapabilities = {
  streaming: CapabilityStatus;
  nativeResume: CapabilityStatus;
  nativeApproval: CapabilityStatus;
  structuredActions: CapabilityStatus;
};
type AdapterProbe = {
  provider: string;
  executableVersion?: string;
  installed: boolean;
  authStatus: "ready" | "missing" | "unknown";
  capabilities: AdapterCapabilities;
};
interface AgentAdapter {
  probe(): Promise<AdapterProbe>;
  execute(request: ValidatedExecutionRequest): AsyncIterable<ProviderEvent>;
  cancel(executionHandle: string): Promise<CancelResult>;
}
```

`ValidatedExecutionRequest` est **construit par le runner** après contrôle des droits, de la sandbox, du projet et des chemins. Il n'est jamais produit directement à partir d'un prompt brut. `ProviderEvent` est un événement normalisé (`output`, `tool_activity`, `usage`, `session_metadata`, `error`, `result`) avec champs sensibles filtrés et `rawRef` interne facultatif.

Lorsqu'un adaptateur lance un processus local, `ValidatedExecutionRequest.workspacePath`
porte le workspace déjà résolu et contrôlé par le runner. L'adaptateur ne doit
jamais déduire ce chemin depuis l'instruction ou une référence de contexte.
Le transport de processus doit être injecté par le runner (par exemple un
bridge brokerisé vers l'hôte Windows) ; aucun adaptateur ne doit déduire un
binaire depuis `PATH` ni lancer un processus hôte directement depuis un
conteneur.

## Contrats de capacité

- `streaming=unsupported` : collecte finale sans fausse progression.
- `nativeResume=unsupported` : nouvelle exécution avec contexte explicite, aucune session native réutilisée.
- `nativeApproval=unsupported` : CodeRoom ne délègue pas de permissions élevées au CLI ; si autorisations nécessaires non contrôlables, opération refusée.
- `structuredActions=unsupported` : pas de simulation aveugle d'action par analyse de prose ; mécanisme MCP/bridge conforme requis.

## Tests de contrat

Outil absent, version inattendue, output malformé, sortie volumineuse, timeout, annulation, reprise indisponible, refus d'accès, secret dans stdout, événements désordonnés. Un provider fictif permet de valider le noyau sans frais ni accès réseau.

## Remarque

Les appels CLI concrets et leurs paramètres sont versionnés dans **chaque adaptateur** après prototype ; ne pas figer ici des commandes supposées universelles.
