/**
 * ╳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╳
 *      CynexGP - Open Source Project
 *      Repository: https://github.com/xAyan55/cynex
 *
 *     © 2025 CynexGP. Licensed under the MIT License
 * ╳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╳
 */

import { Router } from 'express';

interface ModuleInfo {
  name: string;
  description: string;
  version: string;
  moduleVersion: string;
  author: string;
  license: string;
}

export interface Module {
  info: ModuleInfo;
  router: (applyWs?: (router: Router) => void) => Router;
}
