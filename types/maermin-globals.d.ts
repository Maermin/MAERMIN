// ============================================================================
// MAERMIN — ambient type declarations for the window.* module surface.
// ----------------------------------------------------------------------------
// These give editors IntelliSense + type-checking for the global-IIFE modules
// WITHOUT changing the runtime. They are the contract the TypeScript migration
// will graduate into real .ts files against (see TYPESCRIPT plan in ROADMAP.md).
// ============================================================================

export {};

// ---- shared domain shapes --------------------------------------------------
interface Position { symbol?: string; name?: string; amount?: number | string; purchasePrice?: number; currentPrice?: number; }
type AssetClass = 'crypto' | 'stocks' | 'skins' | 'commodities';
type Portfolio = Partial<Record<AssetClass, Position[]>>;
type Prices = Record<string, number>;
interface Transaction { id?: string | number; symbol?: string; category?: AssetClass; type?: string; quantity?: number; price?: number; currency?: string; date?: string; portfolioId?: string; }

// ---- security foundation ---------------------------------------------------
interface MaerminVaultAPI {
  isSupported(): boolean;
  isUnlocked(): boolean;
  hasVault(): boolean;
  getMeta(): { v: number; kdf: string; params: any; createdAt: number; updatedAt: number; autoLockMs: number; hasPasskey: boolean } | null;
  registerKdf(name: string, impl: { defaultParams(): any; derive(password: string, salt: Uint8Array, params: any): Promise<Uint8Array> }): void;
  create(password: string, opts?: { kdf?: string; params?: any; autoLockMs?: number }): Promise<boolean>;
  unlock(password: string): Promise<boolean>;
  changePassword(oldPw: string, newPw: string, opts?: any): Promise<boolean>;
  lock(): void;
  encrypt(plaintext: string): Promise<string>;
  decrypt(envelope: string): Promise<string>;
  encryptJSON(obj: any): Promise<string>;
  decryptJSON(envelope: string): Promise<any>;
  deriveSubKey(label: string): Promise<ArrayBuffer>;
  configureAutoLock(ms: number): void;
  touch(): void;
  onLock(cb: () => void): void;
  passkeySupported(): boolean;
  enrollPasskey(label?: string): Promise<{ supported: boolean; enrolled?: boolean }>;
  unlockWithPasskey(): Promise<boolean>;
}

interface MaerminStorageAPI {
  SENSITIVE_KEYS: string[];
  isSensitive(key: string): boolean;
  registerSensitiveKey(key: string): void;
  isEnabled(): boolean;
  enableAtRest(): Promise<boolean>;
  disableAtRest(): Promise<boolean>;
  resume(): Promise<boolean>;
  flush(): Promise<boolean>;
  rekey(): Promise<boolean>;
  snapshotPlaintext(): Record<string, string>;
  restoreBackup(): boolean;
}

interface MaerminAuthAPI {
  whenUnlocked(): Promise<boolean>;
  isUnlocked(): boolean;
  lock(): void;
  logout(): void;
  changePassword(oldPw: string, newPw: string): Promise<any>;
  enrollPasskey(label?: string): Promise<any>;
  setAutoLock(ms: number): void;
  getStatus(): { hasVault: boolean; unlocked: boolean; kdf?: string; autoLockMs?: number; hasPasskey: boolean; encryptedAtRest: boolean; passkeySupported: boolean };
}

// ---- PWA -------------------------------------------------------------------
interface MaerminPWAAPI {
  on(type: 'update' | 'install' | 'sync', cb: (payload?: any) => void): void;
  isStandalone(): boolean;
  canInstall(): boolean;
  promptInstall(): Promise<{ outcome: string }>;
  hasUpdate(): boolean;
  applyUpdate(): void;
  notificationsSupported(): boolean;
  notificationPermission(): NotificationPermission;
  requestNotifications(): Promise<NotificationPermission>;
  notify(title: string, options?: NotificationOptions): Promise<boolean>;
  subscribePush(vapidPublicKey: string): Promise<PushSubscription>;
  requestBackgroundSync(tag?: string): Promise<boolean>;
}

// ---- cloud sync ------------------------------------------------------------
interface SyncTransport {
  get(account: string): Promise<{ rev: number; blob: string } | null>;
  put(account: string, baseRev: number, blob: string): Promise<{ ok: true; rev: number } | { conflict: true; serverRev: number; blob: string }>;
}
interface MaerminSyncAPI {
  configure(cfg: { provider?: 'worker' | 'drive' | 'onedrive'; endpoint?: string; tokenProvider?: () => string | Promise<string>; transport?: SyncTransport; fetchImpl?: typeof fetch }): SyncTransport;
  isConfigured(): boolean;
  getConfig(): { provider: string; endpoint: string | null } | null;
  sync(): Promise<any>;
  hasLocalChanges(): boolean;
  getState(): { rev: number; lastHash: string | null; lastSyncAt: number };
  deviceId(): string;
  accountId(): Promise<string>;
  enableAutoSync(): void;
  onChange(cb: (ev: { type: string; result?: any; error?: any }) => void): void;
  mergeSnapshots(local: any, remote: any): { merged: any; conflicts: any[] };
  WorkerTransport(opts: any): SyncTransport;
  DriveTransport(opts: any): SyncTransport;
  OneDriveTransport(opts: any): SyncTransport;
}

// ---- advisor ---------------------------------------------------------------
interface AdvisorFinding { id: string; severity: 'critical' | 'warning' | 'opportunity' | 'info' | 'good'; category: string; title: string; detail: string; action?: string; metric?: number; }
interface MaerminAdvisorAPI {
  analyzeFromMetrics(bundle: any, t?: any): { findings: AdvisorFinding[]; summary: any };
  analyzePortfolio(portfolio: Portfolio, prices: Prices, transactions: Transaction[], t?: any): { findings: AdvisorFinding[]; summary: any };
  gatherBundle(portfolio: Portfolio, prices: Prices, transactions: Transaction[], t?: any): any;
  chatContext(report: any, question?: string): any;
  ask(report: any, question: string): Promise<string>;
  Panel(props: any): any;
}

// ---- analytics (Epics 5/6/7) ----------------------------------------------
interface MaerminAnalyticsAPI {
  toReturns(series: number[]): number[];
  BENCHMARKS: { key: string; label: string; proxy: string }[];
  benchmarkStats(p: number[], b: number[], opts?: { rf?: number; periodsPerYear?: number }): { available: boolean; beta: number; alpha: number; trackingError: number; informationRatio: number; correlation: number; rSquared: number; periods: number };
  cagr(start: number, end: number, years: number): number;
  annualizedVol(returns: number[], periodsPerYear?: number): number;
  sharpe(returns: number[], rf?: number, periodsPerYear?: number): number;
  maxDrawdown(series: number[]): { maxDrawdown: number; peakIndex: number; troughIndex: number; peak: number; trough: number };
  rollingReturns(returns: number[], window: number): number[];
  rollingVolatility(returns: number[], window: number, periodsPerYear?: number): number[];
  correlationMatrix(seriesMap: Record<string, number[]>): { labels: string[]; matrix: number[][] };
  factorExposure(excess: number[], factors: number[][], names?: string[]): { available: boolean; alpha?: number; betas?: Record<string, number> };
  futureValue(principal: number, monthly: number, annualReturn: number, years: number): number;
  fireProjection(opts: any): any;
  withdrawalSimulation(opts: any): { path: number[]; depletedYear: number | null; survives: boolean; endingBalance: number };
  retirementPlan(opts: any): any;
  monteCarlo(opts: any): { successRate: number; p10: number; median: number; p90: number; mean: number };
}

declare global {
  interface Window {
    MaerminVault: MaerminVaultAPI;
    MaerminStorage: MaerminStorageAPI;
    MaerminAuth: MaerminAuthAPI;
    MaerminPWA: MaerminPWAAPI;
    MaerminSync: MaerminSyncAPI;
    MaerminAdvisor: MaerminAdvisorAPI;
    MaerminAnalytics: MaerminAnalyticsAPI;
    MaerminMetrics: any;
    AICopilot: any;
    PortfolioHealth: any;
    DividendDataService: any;
    MonteCarloEngine: any;
  }
}
