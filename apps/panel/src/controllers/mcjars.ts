import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { CONFIG } from '../config/index.js';

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 Minutes
let typesCache: CacheEntry<any> | null = null;
const versionsCache = new Map<string, CacheEntry<any>>();

export async function getMcJarsTypesController(req: AuthenticatedRequest, res: Response) {
  try {
    const now = Date.now();
    if (typesCache && now - typesCache.cachedAt < CACHE_TTL_MS) {
      return res.json({ success: true, types: typesCache.data, cached: true });
    }

    const response = await fetch(`${CONFIG.MCJARS_BASE_URL}/api/v2/types`);
    if (!response.ok) {
      throw new Error(`MCJars API error: HTTP ${response.status}`);
    }

    const data = (await response.json()) as any;
    typesCache = { data: data.types || data, cachedAt: now };
    return res.json({ success: true, types: data.types || data });
  } catch (err: any) {
    // Return fallback static types if remote API is down
    const fallbackTypes = {
      VANILLA: { category: "recommended" },
      PAPER: { category: "recommended" },
      PURPUR: { category: "recommended" },
      FABRIC: { category: "recommended" },
      FORGE: { category: "established" },
      NEOFORGE: { category: "established" },
      VELOCITY: { category: "recommended" }
    };
    return res.json({ success: true, types: fallbackTypes, stale: true, error: err.message });
  }
}

export async function getMcJarsVersionsController(req: AuthenticatedRequest, res: Response) {
  try {
    const { type } = req.params;
    const cacheKey = type.toUpperCase();
    const now = Date.now();

    if (versionsCache.has(cacheKey)) {
      const entry = versionsCache.get(cacheKey)!;
      if (now - entry.cachedAt < CACHE_TTL_MS) {
        return res.json({ success: true, versions: entry.data, cached: true });
      }
    }

    const response = await fetch(`${CONFIG.MCJARS_BASE_URL}/api/v3/builds/types/${type}/versions`);
    if (!response.ok) {
      throw new Error(`MCJars API error: HTTP ${response.status}`);
    }

    const data = (await response.json()) as any;
    versionsCache.set(cacheKey, { data: data.versions || data, cachedAt: now });

    return res.json({ success: true, versions: data.versions || data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
