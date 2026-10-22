# Données, migrations et exploitation

## Stockage proposé
SQLite avec migrations contrôlées (Drizzle proposé), WAL selon contraintes d'exploitation. Fichiers/artifacts dans répertoire applicatif hors racine servie par le frontend. Éviter d'enregistrer des logs sensibles complets en base.

## Transactions / événements
Toute commande métier validée écrit son état et son `AuditEvent` dans la même transaction. Pour notifications WS et tâches asynchrones, conserver un événement/outbox persistant à publier ensuite, rejouable par curseur ; les consommateurs tolèrent les doublons grâce aux identifiants.

## Sauvegarde
Sauvegarde cohérente SQLite **et** répertoire des fichiers ; répertoires Git externes documentés séparément. Restaurer sur une instance de test et vérifier intégrité + liens références. Ne pas copier simplement un SQLite en écriture sans méthode cohérente.

## Migration
Migration versionnée et sauvegarde préalable des données critiques ; erreur de migration bloque le démarrage plutôt que d'écraser des données. Aucune suppression automatique des historiques à l'archivage.

## Observabilité
Logs structurés avec `correlationId`, `executionId`, `projectId` ; compteurs de file d'attente, erreurs et temps d'exécution ; masquage d'arguments/secrets. Page d'activité depuis données persistées, pas uniquement stdout.

## Déploiement initial
Un hôte local, un service serveur et le frontend. Prévoir limites mémoire/CPU/durée disque ; préciser politiques de logs/rotation. L'accès réseau et l'OS restent des arbitrages explicites.

## Politique implémentée dans le squelette

- La base applicative est `CODE_ROOM_DATABASE_PATH` si cette variable est
  définie, sinon `CODE_ROOM_DATA_DIR/coderoom.sqlite`.
- Le défaut hors conteneur est `.data/coderoom.sqlite`. Le Compose de
  développement utilise `/var/lib/coderoom/coderoom.sqlite`, monté depuis
  `.runtime/data`.
- Les espaces de travail sont explicitement fournis par
  `CODE_ROOM_WORKSPACES_DIR`. Le défaut local est `.runtime/workspaces` ; le
  Compose utilise `/workspaces`.
- L'API initialise la base et applique les migrations avant d'écouter HTTP.
  Une migration ou un contrôle d'intégrité échoué arrête le démarrage sans
  poursuivre avec une base partiellement migrée.
- Le stockage applicatif et les workspaces ne sont pas servis directement par
  le frontend. Les logs de migration n'impriment pas le contenu de l'erreur ni
  de secret ; ils indiquent seulement l'échec et l'arrêt.
- La sauvegarde/restauration cohérente, la rotation des logs et les procédures
  d'exploitation complètes restent du ressort de TASK-037.
