const createApp = require('./app');

async function startServer(options = {}) {
  const service = createApp(options);
  await new Promise((resolve, reject) => {
    service.server.once('error', reject);
    service.server.listen(service.port, service.host, resolve);
  });
  return service;
}

if (require.main === module) {
  startServer().then((service) => {
    const address = service.server.address();
    console.log(`ttyd WebUI listening on http://${service.host}:${address.port}`);

    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\nReceived ${signal}; stopping ttyd processes...`);
      try {
        await service.close();
        await service.sessionManager.cleanup();
      } catch (error) {
        console.error('Shutdown cleanup failed:', error);
        process.exitCode = 1;
      }
    };
    process.on('SIGINT', () => { void shutdown('SIGINT'); });
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  }).catch((error) => {
    console.error('Unable to start ttyd WebUI:', error);
    process.exitCode = 1;
  });
}

module.exports = { startServer };
