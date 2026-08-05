import { z } from 'zod';

const NullableString = z.string().nullable().optional();
const NullString = z.string().nullable();

export const ModrinthProjectSchema = z.object({
  id: z.string(),
  slug: NullableString,
  project_type: z.string(),
  title: z.string(),
  description: z.string().optional().default(''),
  body: z.string().nullable().optional(),
  body_url: z.string().nullable().optional(),
  published: z.string().nullable().optional(),
  updated: z.string().nullable().optional(),
  approved: z.string().nullable().optional(),
  queued: z.string().nullable().optional(),
  followers: z.number().optional().default(0),
  license: z.object({
    id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
  }).nullable().optional(),
  client_side: z.string().optional(),
  server_side: z.string().optional(),
  downloads: z.number().optional().default(0),
  categories: z.array(z.string()).optional().default([]),
  additional_categories: z.array(z.string()).optional().default([]),
  game_versions: z.array(z.string()).optional().default([]),
  loaders: z.array(z.string()).optional().default([]),
  versions: z.array(z.string()).optional().default([]),
  icon_url: z.string().nullable().optional(),
  color: z.number().nullable().optional(),
  thread_id: z.string().nullable().optional(),
  server_integration: z.any().nullable().optional(),
  moderation_reason: z.string().nullable().optional(),
  moderator_message: z.object({
    message: z.string(),
    body: z.string().nullable().optional(),
  }).nullable().optional(),
  source_url: z.string().nullable().optional(),
  discord_url: z.string().nullable().optional(),
  wiki_url: z.string().nullable().optional(),
  issues_url: z.string().nullable().optional(),
  donation_urls: z.array(z.object({
    id: z.string(),
    platform: z.string(),
    url: z.string(),
  })).nullable().optional(),
  gallery: z.array(z.object({
    url: z.string(),
    featured: z.boolean().optional(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })).nullable().optional().default([]),
});

export type ModrinthProject = z.infer<typeof ModrinthProjectSchema>;

export const ModrinthVersionSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  author_id: z.string().optional(),
  name: z.string(),
  version_number: z.string(),
  version_type: z.string(),
  changelog: z.string().nullable().optional(),
  date_published: z.string().optional(),
  downloads: z.number().optional().default(0),
  status: z.string().optional(),
  requested_status: z.string().nullable().optional(),
  featured: z.boolean().optional(),
  game_versions: z.array(z.string()).optional().default([]),
  loaders: z.array(z.string()).optional().default([]),
  dependencies: z.array(z.object({
    version_id: z.string().nullable().optional(),
    project_id: z.string().nullable().optional(),
    file_name: z.string().nullable().optional(),
    dependency_type: z.string(),
  })).optional().default([]),
  files: z.array(z.object({
    hashes: z.object({
      sha512: z.string().nullable().optional(),
      sha1: z.string().nullable().optional(),
    }),
    url: z.string(),
    filename: z.string(),
    primary: z.boolean().optional().default(false),
    size: z.number().optional().default(0),
    file_type: z.string().nullable().optional(),
  })).optional().default([]),
});

export type ModrinthVersion = z.infer<typeof ModrinthVersionSchema>;

export const ModrinthSearchHitSchema = z.object({
  project_id: z.string(),
  title: z.string(),
  description: z.string().optional().default(''),
  project_type: z.string().optional(),
  author: z.string().optional(),
  icon_url: z.string().nullable().optional(),
  downloads: z.number().optional().default(0),
  follows: z.number().optional().default(0),
  categories: z.array(z.string()).optional().default([]),
  date_modified: z.string().nullable().optional(),
  latest_version: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  versions: z.array(z.string()).optional().default([]),
  gallery: z.array(z.string()).nullable().optional().default([]),
  color: z.number().nullable().optional(),
});

export type ModrinthSearchHit = z.infer<typeof ModrinthSearchHitSchema>;

export const ModrinthSearchResponseSchema = z.object({
  hits: z.array(ModrinthSearchHitSchema).optional().default([]),
  total_hits: z.number().optional().default(0),
  offset: z.number().optional().default(0),
  limit: z.number().optional().default(20),
});

export type ModrinthSearchResponse = z.infer<typeof ModrinthSearchResponseSchema>;

export interface DaemonFileEntry {
  name: string;
  type?: string;
  size?: number;
  modified?: string;
}

export interface InstalledPlugin {
  filename: string;
  enabled: boolean;
  size: number;
  modifiedAt: string | null;
  projectId: string | null;
  projectName: string | null;
  versionId: string | null;
  versionNumber: string | null;
  author: string | null;
  installedAt: string | null;
  installationId: number | null;
  updateAvailable: boolean;
  latestVersionNumber: string | null;
  latestVersionId: string | null;
  ignoredUpdate: boolean;
}

export interface CompatibilityResult {
  compatible: boolean;
  warnings: string[];
  errors: string[];
  minecraftVersion: string | null;
  loader: string | null;
  forceAllowed: boolean;
}

export interface PluginInstallProgress {
  serverId: string;
  operationId: string;
  projectId: string;
  projectName: string;
  stage: 'initializing' | 'downloading' | 'validating' | 'installing' | 'moving' | 'completed' | 'failed';
  stageMessage: string;
  overallProgress: number;
  error?: string;
  warnings: string[];
  startTime: number;
  lastUpdate: number;
}
