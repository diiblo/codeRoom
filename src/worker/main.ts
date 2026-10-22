const interval = setInterval(() => {
  // Le worker reste volontairement inactif jusqu'à l'implémentation de la file
  // persistante et du runner confiné. Aucun CLI hôte n'est lancé ici.
}, 30_000);

const shutdown = () => {
  clearInterval(interval);
  process.exitCode = 0;
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log("CodeRoom worker prêt (mode idle, exécution désactivée)");
