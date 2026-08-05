import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import { WalletService } from '../../services/WalletService';
import logger from '../../handlers/logger';

const walletModule: Module = {
  info: {
    name: 'Wallet Module',
    description: 'User wallet and transaction history page.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get('/wallet', isAuthenticated(), async (req: Request, res: Response) => {
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

        const [balance, historyResult, auditLogs] = await Promise.all([
          WalletService.getBalance(userId),
          WalletService.getHistory(userId, page, 20),
          prisma.auditLog.findMany({
            where: { userId: userId },
            orderBy: { createdAt: 'desc' },
            take: 10,
          }),
        ]);

        res.render('user/wallet', {
          user,
          req,
          balance,
          transactions: historyResult.transactions,
          auditLogs,
          page: historyResult.page,
          totalPages: historyResult.totalPages,
          settings,
          title: 'Wallet',
        });
      } catch (error) {
        logger.error('Error loading wallet page:', error);
        res.status(500).send('Error loading wallet.');
      }
    });

    return router;
  },
};

export default walletModule;
