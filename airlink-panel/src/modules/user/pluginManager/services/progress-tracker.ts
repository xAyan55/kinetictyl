import { PluginInstallProgress } from '../types/modrinth-api';

const STAGE_PROGRESS: Record<PluginInstallProgress['stage'], number> = {
  initializing: 5,
  downloading: 25,
  validating: 45,
  installing: 65,
  moving: 85,
  completed: 100,
  failed: 0,
};

class PluginProgressTracker {
  private installations = new Map<string, PluginInstallProgress>();
  private listeners = new Map<string, Set<(progress: PluginInstallProgress) => void>>();

  private key(serverId: string, operationId: string): string {
    return `${serverId}:${operationId}`;
  }

  subscribe(serverId: string, operationId: string, listener: (progress: PluginInstallProgress) => void): () => void {
    const mapKey = this.key(serverId, operationId);
    if (!this.listeners.has(mapKey)) {
      this.listeners.set(mapKey, new Set());
    }
    this.listeners.get(mapKey)!.add(listener);
    return () => {
      this.listeners.get(mapKey)?.delete(listener);
    };
  }

  private emit(progress: PluginInstallProgress): void {
    const mapKey = this.key(progress.serverId, progress.operationId);
    for (const listener of this.listeners.get(mapKey) ?? []) {
      listener(progress);
    }
  }

  initialize(
    serverId: string,
    operationId: string,
    projectId: string,
    projectName: string,
  ): void {
    const progress: PluginInstallProgress = {
      serverId,
      operationId,
      projectId,
      projectName,
      stage: 'initializing',
      stageMessage: 'Preparing installation...',
      overallProgress: 0,
      warnings: [],
      startTime: Date.now(),
      lastUpdate: Date.now(),
    };
    this.installations.set(this.key(serverId, operationId), progress);
    this.emit(progress);
  }

  updateStage(
    serverId: string,
    operationId: string,
    stage: PluginInstallProgress['stage'],
    message: string,
    progressOverride?: number,
  ): void {
    const progress = this.installations.get(this.key(serverId, operationId));
    if (!progress) return;

    progress.stage = stage;
    progress.stageMessage = message;
    progress.lastUpdate = Date.now();
    progress.overallProgress = progressOverride ?? Math.max(progress.overallProgress, STAGE_PROGRESS[stage]);
    this.emit(progress);
  }

  addWarning(serverId: string, operationId: string, warning: string): void {
    const progress = this.installations.get(this.key(serverId, operationId));
    if (!progress || progress.warnings.length >= 20) return;
    progress.warnings.push(warning);
    progress.lastUpdate = Date.now();
    this.emit(progress);
  }

  complete(serverId: string, operationId: string): void {
    this.updateStage(serverId, operationId, 'completed', 'Installation completed successfully', 100);
    setTimeout(() => this.installations.delete(this.key(serverId, operationId)), 30000);
  }

  fail(serverId: string, operationId: string, error: string): void {
    const progress = this.installations.get(this.key(serverId, operationId));
    if (!progress) return;
    progress.stage = 'failed';
    progress.stageMessage = 'Installation failed';
    progress.error = error;
    progress.lastUpdate = Date.now();
    this.emit(progress);
    setTimeout(() => this.installations.delete(this.key(serverId, operationId)), 60000);
  }

  getProgress(serverId: string, operationId: string): PluginInstallProgress | null {
    return this.installations.get(this.key(serverId, operationId)) ?? null;
  }

  serialize(progress: PluginInstallProgress): Record<string, unknown> {
    return {
      serverId: progress.serverId,
      operationId: progress.operationId,
      projectId: progress.projectId,
      projectName: progress.projectName,
      stage: progress.stage,
      stageMessage: progress.stageMessage,
      overallProgress: Math.round(progress.overallProgress),
      error: progress.error,
      warnings: progress.warnings,
      elapsedTime: Date.now() - progress.startTime,
    };
  }
}

export const pluginProgressTracker = new PluginProgressTracker();
