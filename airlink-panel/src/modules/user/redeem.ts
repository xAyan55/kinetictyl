import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import { CouponService } from '../../services/CouponService';
import { WalletService } from '../../services/WalletService';
import logger from '../../handlers/logger';

const redeemModule: Module = {
  info: {
    name: 'Redeem Module',
    description: 'Redeem coupon codes.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get('/redeem', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const balance = await WalletService.getBalance(userId);
        res.render('user/redeem', { user: req.session!.user, req, balance, title: 'Redeem Coupon', error: null, success: null });
      } catch (error) {
        logger.error('Redeem page error:', error);
        res.status(500).send('Error loading page.');
      }
    });

    router.post('/redeem', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const { code } = req.body;
        if (!code || typeof code !== 'string') {
          return res.render('user/redeem', {
            user: req.session!.user, req, balance: await WalletService.getBalance(userId), title: 'Redeem Coupon',
            error: 'Please enter a coupon code.', success: null,
          });
        }

        const result = await CouponService.redeem({ code: code.trim().toUpperCase(), userId, ipAddress: req.ip });
        const balance = await WalletService.getBalance(userId);

        res.render('user/redeem', {
          user: req.session!.user, req, balance, title: 'Redeem Coupon', error: null, success: result,
        });
      } catch (error: any) {
        const userId = req.session!.user!.id;
        const balance = await WalletService.getBalance(userId);
        res.render('user/redeem', {
          user: req.session!.user, req, balance, title: 'Redeem Coupon',
          error: error.message || 'Redemption failed.', success: null,
        });
      }
    });

    return router;
  },
};

export default redeemModule;
