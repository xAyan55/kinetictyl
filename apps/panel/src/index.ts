import { createPanelApp, autoProvisionLocalNode } from './server.js';
import { CONFIG } from './config/index.js';

async function main() {
  await autoProvisionLocalNode();

  const { httpServer } = createPanelApp();

  httpServer.listen(CONFIG.PORT, () => {
    console.log(`[Kinetictyl Panel] Server listening on http://127.0.0.1:${CONFIG.PORT}`);
  });
}

main().catch(err => {
  console.error('[Kinetictyl Panel] Critical initialization failure:', err);
  process.exit(1);
});
