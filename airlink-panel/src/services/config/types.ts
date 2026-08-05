export interface EconomyConfig {
  startingCoins: number;
  coinName: string;
  coinSymbol: string;
  maxBalance: number;
  downgradeRefundPercent: number;
  taxPercent: number;
}

export interface StoreConfig {
  ramPricePerMb: number;
  cpuPricePerPercent: number;
  diskPricePerMb: number;
  backupSlotPrice: number;
  databaseSlotPrice: number;
  portPrice: number;
  serverSlotPrice: number;
}

export interface NotificationsConfig {
  notifyOnServerExpiration: boolean;
  notifyOnPurchase: boolean;
  notifyOnCouponRedeem: boolean;
  notifyOnAdminAction: boolean;
  notifyOnMaintenance: boolean;
  expirationWarningDays: number;
}

export interface DefaultServerConfig {
  defaultMemory: number;
  defaultCpu: number;
  defaultDisk: number;
  defaultValidityDays: number;
  defaultBackupSlots: number;
  defaultDatabaseSlots: number;
  defaultPorts: number;
}

export interface RenewalConfig {
  renew7DaysCost: number;
  renew15DaysCost: number;
  renew30DaysCost: number;
  renew60DaysCost: number;
  renew90DaysCost: number;
}

export interface LimitsConfig {
  maxServers: number;
  maxBackupsPerServer: number;
  maxDatabasesPerServer: number;
  maxPortsPerServer: number;
  maxRamUpgrade: number;
  maxCpuUpgrade: number;
  maxDiskUpgrade: number;
  maxWalletBalance: number;
  maxCouponUsesPerUser: number;
}

export interface UIConfig {
  coinIconPath: string;
  dashboardShowResourceCards: boolean;
  dashboardShowStore: boolean;
  dashboardShowCoupons: boolean;
  storeEnabled: boolean;
  couponsEnabled: boolean;
  landingEnabled: boolean;
  brandName: string;
  brandLogo: string;
}

export interface MonetizationConfig {
  enabled: boolean;
  maintenanceMode: boolean;
  requireLogin: boolean;
  fraudDetection: boolean;
  minimumAccountAgeDays: number;
  allowedCountries: string;     // Comma-separated ISO codes
  loggingEnabled: boolean;
  
  // Linkvertise
  linkvertiseEnabled: boolean;
  linkvertisePublisherId: string;
  linkvertiseApiKey: string;
  linkvertiseCallbackSecret: string;
  linkvertiseBaseUrl: string;
  linkvertiseDefaultDestination: string;
  linkvertiseEnableDynamicLinks: boolean;
  linkvertiseEnableRewards: boolean;
  linkvertiseEnableCallbackProcessing: boolean;
  linkvertiseEnableAnalytics: boolean;
  linkvertiseEnableDiagnostics: boolean;
  linkvertiseEnableTestMode: boolean;
  linkvertiseEnableCsvExport: boolean;
  coinsPerLinkCompletion: number;
  minTimeBetweenLinks: number;  // seconds
  maxDailyLinks: number;
  linkCooldownSeconds: number;
  
  // Adsterra
  adsterraEnabled: boolean;
  adsterraPublisherId: string;
  adsterraDomain: string;
  adsterraAdultAds: boolean;
  adsterraPopunderId: string;
  adsterraNativeBannerId: string;
  adsterraBannerId: string;
  adsterraSmartlinkId: string;
  adsterraSocialBarId: string;
  adsterra468x60Id: string;
  adsterra300x250Id: string;
  adsterra160x300Id: string;
  adsterra160x600Id: string;
  adsterra320x50Id: string;
  adsterra728x90Id: string;

  // Ad Placements — each maps to a format name (or '' = disabled)
  placementDashboardHeader: string;   // 728x90 below page title
  placementDashboardMiddle: string;   // 300x250 between stats and server list
  placementDashboardBottom: string;   // 728x90 after server list
  placementInstancesTop: string;      // responsive banner below page title
  placementInstancesMiddle: string;   // native between filters and server list
  placementInstancesBottom: string;   // 728x90 bottom
  placementEarnNative: string;        // native between link section and AFK
  placementEarn300x250: string;       // 300x250 between AFK and streak
  placementEarn728x90: string;        // 728x90 below streak
  placementStoreTop: string;          // responsive banner
  placementStoreMiddle: string;       // native
  placementStoreBottom: string;       // 728x90
  placementWalletTop: string;         // responsive banner
  placementWalletMiddle: string;      // native/300x250 middle
  placementWalletBottom: string;      // 300x250
  placementPurchasesTop: string;      // responsive banner
  placementPurchasesMiddle: string;   // 300x250 middle
  placementPurchasesBottom: string;   // native
  placementRedeemTop: string;         // responsive banner
  placementRedeemMiddle: string;      // native/300x250 middle
  placementRedeemBelow: string;       // 300x250 below coupon form
  placementSidebarSmartlink: string;  // smartlink button only
  placementFooter728x90: string;      // optional global footer
  placementPopunder: string;          // popunder (trigger-based, never visible)
  placementSocialbar: string;         // social bar (official Adsterra script)
  popunderCooldownSeconds: number;
  
  // AFK
  coinsPerAfkMinute: number;
  maxAfkMinutesPerDay: number;
  
  // Limits
  dailyCoinLimit: number;
  
  // Streaks
  streakDay1Reward: number;
  streakDay3Reward: number;
  streakDay7Reward: number;
  streakDay14Reward: number;
  streakDay30Reward: number;
  
  // Fraud thresholds
  maxRewardsPerHour: number;
  maxSessionsPerIp: number;
}

export type ConfigGroup = EconomyConfig | StoreConfig | DefaultServerConfig | RenewalConfig | LimitsConfig | UIConfig | NotificationsConfig | MonetizationConfig;

export const defaultValues: Record<string, Record<string, unknown>> = {
  economy: {
    startingCoins: 100,
    coinName: 'Coins',
    coinSymbol: 'C',
    maxBalance: 999999,
    downgradeRefundPercent: 50,
    taxPercent: 0,
  },
  store: {
    ramPricePerMb: 10,
    cpuPricePerPercent: 5,
    diskPricePerMb: 2,
    backupSlotPrice: 500,
    databaseSlotPrice: 300,
    portPrice: 200,
    serverSlotPrice: 1000,
  },
  defaults: {
    defaultMemory: 512,
    defaultCpu: 100,
    defaultDisk: 5120,
    defaultValidityDays: 30,
    defaultBackupSlots: 1,
    defaultDatabaseSlots: 1,
    defaultPorts: 1,
  },
  renewals: {
    renew7DaysCost: 100,
    renew15DaysCost: 200,
    renew30DaysCost: 350,
    renew60DaysCost: 600,
    renew90DaysCost: 800,
  },
  limits: {
    maxServers: 10,
    maxBackupsPerServer: 5,
    maxDatabasesPerServer: 3,
    maxPortsPerServer: 5,
    maxRamUpgrade: 16384,
    maxCpuUpgrade: 400,
    maxDiskUpgrade: 102400,
    maxWalletBalance: 999999,
    maxCouponUsesPerUser: 10,
  },
  ui: {
    coinIconPath: '/assets/dash/coin.png',
    dashboardShowResourceCards: true,
    dashboardShowStore: true,
    dashboardShowCoupons: true,
    storeEnabled: true,
    couponsEnabled: true,
    landingEnabled: false,
    brandName: 'CynexGP',
    brandLogo: '/assets/dash/logo.png',
  },
  notifications: {
    notifyOnServerExpiration: true,
    notifyOnPurchase: true,
    notifyOnCouponRedeem: true,
    notifyOnAdminAction: true,
    notifyOnMaintenance: true,
    expirationWarningDays: 3,
  },
  monetization: {
    enabled: true,
    maintenanceMode: false,
    requireLogin: true,
    fraudDetection: true,
    minimumAccountAgeDays: 0,
    allowedCountries: '',
    loggingEnabled: true,
    
    // Linkvertise
    linkvertiseEnabled: true,
    linkvertisePublisherId: '209302',
    linkvertiseApiKey: '',
    linkvertiseCallbackSecret: 'my_secret',
    linkvertiseBaseUrl: '',
    linkvertiseDefaultDestination: '',
    linkvertiseEnableDynamicLinks: true,
    linkvertiseEnableRewards: true,
    linkvertiseEnableCallbackProcessing: true,
    linkvertiseEnableAnalytics: true,
    linkvertiseEnableDiagnostics: true,
    linkvertiseEnableTestMode: false,
    linkvertiseEnableCsvExport: false,
    coinsPerLinkCompletion: 15,
    minTimeBetweenLinks: 60,
    maxDailyLinks: 10,
    linkCooldownSeconds: 60,
    
    // Adsterra
    adsterraEnabled: true,
    adsterraPublisherId: '109201',
    adsterraDomain: 'adsterra.com',
    adsterraAdultAds: false,
    adsterraPopunderId: '',
    adsterraNativeBannerId: '',
    adsterraBannerId: '',
    adsterraSmartlinkId: '',
    adsterraSocialBarId: '',
    adsterra468x60Id: '',
    adsterra300x250Id: '',
    adsterra160x300Id: '',
    adsterra160x600Id: '',
    adsterra320x50Id: '',
    adsterra728x90Id: '',

    // Ad placements — empty string = disabled
    placementDashboardHeader: '',
    placementDashboardMiddle: '',
    placementDashboardBottom: '',
    placementInstancesTop: '',
    placementInstancesMiddle: '',
    placementInstancesBottom: '',
    placementEarnNative: '',
    placementEarn300x250: '',
    placementEarn728x90: '',
    placementStoreTop: '',
    placementStoreMiddle: '',
    placementStoreBottom: '',
    placementWalletTop: '',
    placementWalletMiddle: '',
    placementWalletBottom: '',
    placementPurchasesTop: '',
    placementPurchasesMiddle: '',
    placementPurchasesBottom: '',
    placementRedeemTop: '',
    placementRedeemMiddle: '',
    placementRedeemBelow: '',
    placementSidebarSmartlink: '',
    placementFooter728x90: '',
    placementPopunder: '',
    placementSocialbar: '',
    popunderCooldownSeconds: 300,
    
    // AFK
    coinsPerAfkMinute: 2,
    maxAfkMinutesPerDay: 240,
    
    // Limits
    dailyCoinLimit: 1000,
    
    // Streaks
    streakDay1Reward: 10,
    streakDay3Reward: 30,
    streakDay7Reward: 100,
    streakDay14Reward: 250,
    streakDay30Reward: 600,
    
    // Fraud thresholds
    maxRewardsPerHour: 100,
    maxSessionsPerIp: 2,
  },
};
