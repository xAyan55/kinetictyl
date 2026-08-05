import { Router } from 'express';
import { Module } from '../../../handlers/moduleInit';
import { isAuthenticatedForServer } from '../../../handlers/utils/auth/serverAuthUtil';
import { createActionRoutes } from './routes/api/actions';

const playerManagerModule: Module = {
  info: {
    name: 'Player Manager',
    description: 'Manage players on your Minecraft server.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.use(
      '/server/:id/players/api',
      isAuthenticatedForServer('id'),
      createActionRoutes(),
    );

    return router;
  },
};

export default playerManagerModule;
