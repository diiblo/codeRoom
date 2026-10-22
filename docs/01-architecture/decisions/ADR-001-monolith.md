# ADR-001 — Monolithe modulaire local

**Statut : proposé** · **Date : 2026-10-19**

## Contexte
Produit local pour un responsable et plusieurs CLI ; simplicité d'installation recherchée. Le cahier initial propose React/Fastify/SQLite/Drizzle.

## Choix proposé
Un serveur métier monolithe modulaire TypeScript, une API HTTP + WS, SQLite, stockage filesystem ; un gestionnaire d'exécution local séparé logiquement du domaine.

## Compromis
+ Installation et cohérence transactionnelle simples ; maintenance raisonnable.
− Un seul hôte ; la concurrence, la reprise des processus et les migrations doivent être soigneusement conçues.

## Alternatives rejetées pour le MVP
Microservices, Redis obligatoire, cloud et event bus distribué : complexité injustifiée au départ.

## Validation nécessaire
Accepter la stack et les contraintes de plateforme. Impacts : architecture, migrations, scripts d'initialisation et toute tâche backend.
