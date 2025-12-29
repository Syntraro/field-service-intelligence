interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class CacheService {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTTL = 300;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttl?: number): void {
    const ttlSeconds = ttl ?? this.defaultTTL;
    const expiresAt = Date.now() + (ttlSeconds * 1000);
    this.cache.set(key, { value, expiresAt });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  deletePattern(pattern: string): number {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    let count = 0;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[Cache] Cleaned up ${removed} expired entries. Current size: ${this.cache.size}`);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.clear();
  }
}

export const CacheKeys = {
  companySettings: (companyId: string) => `company:${companyId}:settings`,
  userPermissions: (userId: string) => `user:${userId}:permissions`,
  subscription: (companyId: string) => `company:${companyId}:subscription`,
  jobTemplates: (companyId: string) => `company:${companyId}:job-templates`,
  jobTemplate: (templateId: string) => `job-template:${templateId}`,
  companyData: (companyId: string, resource: string) => `company:${companyId}:${resource}`,
  companyPattern: (companyId: string) => `company:${companyId}:*`,
};

export const CacheTTL = {
  SHORT: 60,
  MEDIUM: 300,
  LONG: 1800,
  VERY_LONG: 3600,
};

export const cache = new CacheService();

process.on('SIGTERM', () => cache.destroy());
process.on('SIGINT', () => cache.destroy());

export async function cached<T>(key: string, fn: () => Promise<T>, ttl?: number): Promise<T> {
  const cachedValue = cache.get<T>(key);
  if (cachedValue !== null) return cachedValue;
  const result = await fn();
  cache.set(key, result, ttl);
  return result;
}

export function invalidateCompanyCache(companyId: string): void {
  const pattern = CacheKeys.companyPattern(companyId);
  const removed = cache.deletePattern(pattern);
  console.log(`[Cache] Invalidated ${removed} entries for company ${companyId}`);
}

export default cache;