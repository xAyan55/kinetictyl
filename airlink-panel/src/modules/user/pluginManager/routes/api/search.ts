import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ModrinthClient } from '../../services/modrinth-client';
import { PluginManagerSortIndex } from '../../config';

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

export function createSearchRoutes(modrinthClient: ModrinthClient): Router {
  const router = Router({ mergeParams: true });

  router.get('/', searchLimiter, async (req: Request, res: Response) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const page = Number.parseInt(String(req.query.page || '1'), 10) || 1;
      const sort = (typeof req.query.sort === 'string' ? req.query.sort : 'relevance') as PluginManagerSortIndex;
      const categories = typeof req.query.categories === 'string'
        ? req.query.categories.split(',').map((entry) => entry.trim()).filter(Boolean)
        : undefined;

      const results = await modrinthClient.searchPlugins(query, page, sort, categories);
      res.json({ success: true, data: results });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Search failed';
      res.status(502).json({ success: false, error: message });
    }
  });

  return router;
}
