import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import { StoreService } from '../../services/StoreService';
import logger from '../../handlers/logger';

const purchasesModule: Module = {
  info: {
    name: 'Purchases Module',
    description: 'Purchase history page.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get('/purchases', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const settings = await prisma.settings.findUnique({ where: { id: 1 } });

        const user = await prisma.users.findUnique({ where: { id: userId } });
        if (!user) {
          res.redirect('/dashboard');
          return;
        }

        let page: number = 1;
        if (typeof req.query.page === 'string') {
          page = parseInt(req.query.page, 10);
        }
        if (isNaN(page) || page < 1) {
          page = 1;
        }

        const historyResult = await StoreService.getPurchaseHistory(userId, page, 20);

        res.render('user/purchases', {
          user,
          req,
          purchases: historyResult.purchases,
          total: historyResult.total,
          page: historyResult.page,
          totalPages: historyResult.totalPages,
          settings,
          title: 'Purchases',
        });
      } catch (error) {
        logger.error('Error loading purchases page:', error);
        res.status(500).send('Error loading purchases.');
      }
    });

    return router;
  },
};

export default purchasesModule;
