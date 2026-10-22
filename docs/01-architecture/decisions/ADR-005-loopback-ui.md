# ADR-005 — Exposition de l'interface locale

**Statut : accepté** · **Proposé : 2026-10-20 · Accepté : 2026-10-20**

## Contexte

CodeRoom est une application locale et l'interface ne possède pas encore de
modèle d'identité distante. Une écoute réseau large ferait confondre présence
sur le réseau local et session authentifiée.

## Décision

Pour le MVP, l'API et l'interface sont accessibles uniquement via loopback
(`127.0.0.1`). Aucune exposition distante n'est activée. Les commandes
mutantes devront en plus passer par l'authentification applicative et les
contrôles d'origine définis par le serveur ; le binding loopback seul n'est pas
considéré comme une autorisation suffisante.

## Alternatives examinées

- Exposition sur le réseau privé avec authentification : reportée jusqu'à la
  définition d'une identité distante, de la protection CSRF, de l'audit et de
  la gestion des secrets.
- Accès réseau sans authentification supplémentaire : rejeté.

## Conséquences

- Les ports Docker doivent rester publiés sur `127.0.0.1`.
- Toute modification qui expose un port distant doit être bloquée tant qu'un
  nouvel arbitrage n'est pas accepté.
- L'authentification applicative et le contrôle d'autorisation restent à
  implémenter côté serveur.

## Validation

**Décideur :** propriétaire CodeRoom, validation explicite du 2026-10-20.
