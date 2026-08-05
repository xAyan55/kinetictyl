import logger from './logger';

export interface SidebarItem {
  id: string;
  label: string;
  icon: string;
  url: string;
  priority: number;
  section?: string;
  permissions?: string[];
  isActive?: (path: string) => boolean;
  isAdminItem?: boolean;
  isAddon?: boolean;
  matchPrefix?: string;
}

export interface ServerMenuItem {
  id: string;
  label: string;
  icon: string;
  url: string;
  priority: number;
  feature?: string;
  permissions?: string[];
  isAdminItem?: boolean;
  isActive?: (path: string) => boolean;
  isDefault?: boolean;
}

export interface ServerSection {
  id: string;
  title: string;
  priority: number;
  items: ServerSectionItem[];
}

export interface ServerSectionItem {
  id: string;
  label: string;
  value: string;
  icon?: string;
  priority: number;
  type?: 'text' | 'link' | 'button' | 'custom';
  onClick?: string;
  url?: string;
}

class UIComponentStore {
  private sidebarItems: SidebarItem[] = [];
  private serverMenuItems: ServerMenuItem[] = [];
  private serverSections: ServerSection[] = [];
  private addonItemRegistry = new Map<string, { sidebarIds: string[], menuIds: string[], sectionIds: string[] }>();

  private ensureAddonRegistry(addonSlug: string) {
    if (!this.addonItemRegistry.has(addonSlug)) {
      this.addonItemRegistry.set(addonSlug, { sidebarIds: [], menuIds: [], sectionIds: [] });
    }
    return this.addonItemRegistry.get(addonSlug)!;
  }

  public addSidebarItem(item: SidebarItem, addonSlug?: string): void {
    const resolved: SidebarItem = addonSlug ? { ...item, isAddon: true } : item;
    const existingIndex = this.sidebarItems.findIndex(i => i.id === resolved.id);
    if (existingIndex !== -1) {
      this.sidebarItems[existingIndex] = resolved;
    } else {
      this.sidebarItems.push(resolved);
    }
    if (addonSlug) {
      const reg = this.ensureAddonRegistry(addonSlug);
      if (!reg.sidebarIds.includes(resolved.id)) reg.sidebarIds.push(resolved.id);
    }
  }

  public removeSidebarItem(id: string): void {
    this.sidebarItems = this.sidebarItems.filter(item => item.id !== id);
  }

  public getSidebarItems(section?: string, isAdmin?: boolean): SidebarItem[] {
    let items = this.sidebarItems;

    if (section) {
      items = items.filter(item => item.section === section);
    }

    if (isAdmin !== undefined) {
      if (isAdmin) {
        items = items.filter(item => item.isAdminItem === true);
      } else {
        items = items.filter(item => item.isAdminItem !== true);
      }
    }

    return [...items].sort((a, b) => b.priority - a.priority);
  }

  public getAddonSidebarIds(): Set<string> {
    const ids = new Set<string>();
    for (const reg of this.addonItemRegistry.values()) {
      for (const id of reg.sidebarIds) ids.add(id);
    }
    return ids;
  }

  public addServerMenuItem(item: ServerMenuItem, addonSlug?: string): void {
    const existingIndex = this.serverMenuItems.findIndex(i => i.id === item.id);
    if (existingIndex !== -1) {
      this.serverMenuItems[existingIndex] = item;
    } else {
      this.serverMenuItems.push(item);
    }
    if (addonSlug) {
      const reg = this.ensureAddonRegistry(addonSlug);
      if (!reg.menuIds.includes(item.id)) reg.menuIds.push(item.id);
    }
  }

  public removeServerMenuItem(id: string): void {
    this.serverMenuItems = this.serverMenuItems.filter(item => item.id !== id);
  }

  public getServerMenuItems(feature?: string, includeDefaults: boolean = true): ServerMenuItem[] {
    let items = this.serverMenuItems;

    if (!includeDefaults) {
      items = items.filter(item => !item.isDefault);
    }

    if (feature) {
      items = items.filter(item => !item.feature || item.feature === feature);
    }

    return [...items].sort((a, b) => b.priority - a.priority);
  }

  public addServerSection(section: ServerSection, addonSlug?: string): void {
    const existingIndex = this.serverSections.findIndex(s => s.id === section.id);
    if (existingIndex !== -1) {
      this.serverSections[existingIndex] = section;
    } else {
      this.serverSections.push(section);
    }
    if (addonSlug) {
      const reg = this.ensureAddonRegistry(addonSlug);
      if (!reg.sectionIds.includes(section.id)) reg.sectionIds.push(section.id);
    }
  }

  public clearAddonItems(addonSlug: string): void {
    const reg = this.addonItemRegistry.get(addonSlug);
    if (!reg) return;
    reg.sidebarIds.forEach(id => this.removeSidebarItem(id));
    reg.menuIds.forEach(id => this.removeServerMenuItem(id));
    reg.sectionIds.forEach(id => this.removeServerSection(id));
    this.addonItemRegistry.delete(addonSlug);
  }

  public removeServerSection(id: string): void {
    this.serverSections = this.serverSections.filter(section => section.id !== id);
  }

  public getServerSections(): ServerSection[] {
    return [...this.serverSections].sort((a, b) => b.priority - a.priority);
  }

  public addServerSectionItem(sectionId: string, item: ServerSectionItem): void {
    const section = this.serverSections.find(s => s.id === sectionId);
    if (section) {
      const existingIndex = section.items.findIndex(i => i.id === item.id);
      if (existingIndex !== -1) {
        section.items[existingIndex] = item;
      } else {
        section.items.push(item);
      }
    } else {
      logger.warn(`Cannot add item to non-existent section: ${sectionId}`);
    }
  }

  public removeServerSectionItem(sectionId: string, itemId: string): void {
    const section = this.serverSections.find(s => s.id === sectionId);
    if (section) {
      section.items = section.items.filter(item => item.id !== itemId);
    }
  }

  public getServerSectionItems(sectionId: string): ServerSectionItem[] {
    const section = this.serverSections.find(s => s.id === sectionId);
    if (section) {
      return [...section.items].sort((a, b) => b.priority - a.priority);
    }
    return [];
  }
}

export const uiComponentStore = new UIComponentStore();

export function initializeDefaultUIComponents(): void {
  uiComponentStore.addSidebarItem({
    id: 'servers',
    label: 'Dashboard',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5 mt-0.5"><path d="M12.378 1.602a.75.75 0 0 0-.756 0L3 6.632l9 5.25 9-5.25-8.622-5.03ZM21.75 7.93l-9 5.25v9l8.628-5.032a.75.75 0 0 0 .372-.648V7.93ZM11.25 22.18v-9l-9-5.25v8.57a.75.75 0 0 0 .372.648l8.628 5.033Z" /></svg>',
    url: '/dashboard',
    priority: 100,
    matchPrefix: '/server'
  });

  uiComponentStore.addServerMenuItem({
    id: 'console',
    label: 'Console',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5 mb-0.5 inline-flex mr-1"><path fill-rule="evenodd" d="M2.25 6a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V6Zm3.97.97a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 0 1-1.06-1.06l1.72-1.72-1.72-1.72a.75.75 0 0 1 0-1.06Zm4.28 4.28a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" clip-rule="evenodd" /></svg>',
    url: '/server/:uuid',
    priority: 100,
    isDefault: true
  });

  uiComponentStore.addSidebarItem({
    id: 'analytics',
    label: 'Analytics',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mt-0.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>',
    url: '/admin/analytics',
    priority: 85,
    isAdminItem: true
  });

  uiComponentStore.addSidebarItem({
    id: 'config',
    label: 'Config',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mt-0.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a7.723 7.723 0 0 1 0 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.542-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.063-.374-.313-.686-.645-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.075-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>',
    url: '/admin/config',
    priority: 80,
    isAdminItem: true
  });

  uiComponentStore.addSidebarItem({
    id: 'monetization',
    label: 'Monetization',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mt-0.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>',
    url: '/admin/monetization',
    priority: 82,
    isAdminItem: true
  });

  uiComponentStore.addSidebarItem({
    id: 'earn',
    label: 'Earn',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mt-0.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>',
    url: '/earn',
    priority: 97,
    matchPrefix: '/earn'
  });

  uiComponentStore.addSidebarItem({
    id: 'store',
    label: 'Store',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mt-0.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-12 0v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-6 0h18M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 9l9-6 9 6" /></svg>',
    url: '/store',
    priority: 95,
    matchPrefix: '/store'
  });

  uiComponentStore.addSidebarItem({
    id: 'redeem',
    label: 'Redeem',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mt-0.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" /></svg>',
    url: '/redeem',
    priority: 90,
    matchPrefix: '/redeem'
  });
  uiComponentStore.addServerMenuItem({
    id: 'admin',
    label: 'Admin',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5 mb-0.5 inline-flex mr-1"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"></path></svg>',
    url: '/admin/servers/edit/:id',
    priority: 55,
    isAdminItem: true,
    isDefault: true
  });

  uiComponentStore.addServerMenuItem({
    id: 'files',
    label: 'Files',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5 mb-0.5 inline-flex mr-1"><path d="M19.906 9c.382 0 .749.057 1.094.162V9a3 3 0 0 0-3-3h-3.879a.75.75 0 0 1-.53-.22L11.47 3.66A2.25 2.25 0 0 0 9.879 3H6a3 3 0 0 0-3 3v3.162A3.756 3.756 0 0 1 4.094 9h15.812ZM4.094 10.5a2.25 2.25 0 0 0-2.227 2.568l.857 6A2.25 2.25 0 0 0 4.951 21H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-2.227-2.568H4.094Z" /></svg>',
    url: '/server/:uuid/files',
    priority: 90,
    isDefault: true
  });

  uiComponentStore.addServerMenuItem({
    id: 'plugins',
    label: 'Plugin Manager',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5 mb-0.5 inline-flex mr-1"><path stroke-linecap="round" stroke-linejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.036 1.007-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.401.604-.401.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z" /></svg>',
    url: '/server/:uuid/plugins',
    priority: 88,
    feature: 'plugins',
    isDefault: true
  });

  uiComponentStore.addServerMenuItem({
    id: 'players',
    label: 'Players',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5 mb-0.5 inline-flex mr-1"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>',
    url: '/server/:uuid/players',
    priority: 80,
    feature: 'players',
    isDefault: true
  });

  uiComponentStore.addServerMenuItem({
    id: 'worlds',
    label: 'Worlds',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5 mb-0.5 inline-flex mr-1"><path stroke-linecap="round" stroke-linejoin="round" d="m20.893 13.393-1.135-1.135a2.252 2.252 0 0 1-.421-.585l-1.08-2.16a.414.414 0 0 0-.663-.107.827.827 0 0 1-.812.21l-1.273-.363a.89.89 0 0 0-.738 1.595l.587.39c.59.395.674 1.23.172 1.732l-.2.2c-.212.212-.33.498-.33.796v.41c0 .409-.11.809-.32 1.158l-1.315 2.191a2.11 2.11 0 0 1-1.81 1.025 1.055 1.055 0 0 1-1.055-1.055v-1.172c0-.92-.56-1.747-1.414-2.089l-.655-.261a2.25 2.25 0 0 1-1.383-2.46l.007-.042a2.25 2.25 0 0 1 .29-.787l.09-.15a2.25 2.25 0 0 1 2.37-1.048l1.178.236a1.125 1.125 0 0 0 1.302-.795l.208-.73a1.125 1.125 0 0 0-.578-1.315l-.665-.332-.091.091a2.25 2.25 0 0 1-1.591.659h-.18c-.249 0-.487.1-.662.274a.931.931 0 0 1-1.458-1.137l1.411-2.353a2.25 2.25 0 0 0 .286-.76m11.928 9.869A9 9 0 0 0 8.965 3.525m11.928 9.868A9 9 0 1 1 8.965 3.525" /></svg>',
    url: '/server/:uuid/worlds',
    priority: 75,
    feature: 'worlds',
    isDefault: true
  });

  uiComponentStore.addServerMenuItem({
    id: 'startup',
    label: 'Startup',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5 mb-0.5 inline-flex mr-1"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" /></svg>',
    url: '/server/:uuid/startup',
    priority: 70,
    isDefault: true
  });

  uiComponentStore.addServerMenuItem({
    id: 'backups',
    label: 'Backups',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5 mb-0.5 inline-flex mr-1"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" /></svg>',
    url: '/server/:uuid/backups',
    priority: 65,
    isDefault: true
  });

  uiComponentStore.addServerMenuItem({
    id: 'settings',
    label: 'Settings',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5 mb-0.5 inline-flex mr-1"><path fill-rule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" clip-rule="evenodd" /></svg>',
    url: '/server/:uuid/settings',
    priority: 60,
    isDefault: true
  });

  uiComponentStore.addSidebarItem({
    id: 'instances',
    label: 'Instances',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mt-0.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.75L4.5 4.5l5.25 5.25M21 14.25a4.5 4.5 0 0 0-.9-2.75l-1.35-2.75-5.25 5.25" /></svg>',
    url: '/instances',
    priority: 98,
    matchPrefix: '/instances'
  });

  uiComponentStore.addSidebarItem({
    id: 'wallet',
    label: 'Wallet',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mt-0.5"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" /></svg>',
    url: '/wallet',
    priority: 87,
    matchPrefix: '/wallet'
  });

  uiComponentStore.addSidebarItem({
    id: 'purchases',
    label: 'Purchases',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mt-0.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" /></svg>',
    url: '/purchases',
    priority: 85,
    matchPrefix: '/purchases'
  });
}

export default {
  uiComponentStore,
  initializeDefaultUIComponents
};
