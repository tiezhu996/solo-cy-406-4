import { openDB, IDBPDatabase } from 'idb';
import { Clause } from '../types/clause';
import { ContractInstance } from '../types/contract-instance';
import { TemplatePublication } from '../types/publication';
import { Template } from '../types/template';
import { Version } from '../types/version';

export const DB_NAME = 'contract-template-editor';
// 模式基线版本（含 publications 仓库）。实际自愈时会取 max(DB_VERSION, 当前版本+1)，
// 保证只会升版本、永不请求更低版本。
export const DB_VERSION = 3;

export const STORE_NAMES = ['templates', 'clauses', 'instances', 'versions', 'publications'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

export interface StoreValueMap {
  templates: Template;
  clauses: Clause;
  instances: ContractInstance;
  versions: Version;
  publications: TemplatePublication;
}

export type StoreValue<S extends StoreName> = StoreValueMap[S];

export interface ExportPayload {
  templates: Template[];
  clauses: Clause[];
  instances: ContractInstance[];
  versions: Version[];
  publications: TemplatePublication[];
  exportedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | undefined;

/** 升级/自愈时幂等创建全部必需仓库；已存在的仓库与其数据原样保留 */
function ensureStores(db: IDBPDatabase) {
  for (const storeName of STORE_NAMES) {
    if (!db.objectStoreNames.contains(storeName)) {
      db.createObjectStore(storeName, { keyPath: 'id' });
    }
  }
}

function missingStores(db: IDBPDatabase): string[] {
  return STORE_NAMES.filter((storeName) => !db.objectStoreNames.contains(storeName));
}

/** 当前受管（缓存）的活动连接 */
let activeDb: IDBPDatabase | undefined;

/**
 * 把连接登记为“受管活动连接”：其它页面请求更高版本（versionchange）时主动关闭它、
 * 清空缓存让出，使对方升级立即继续；后续访问会重新打开新版本。
 */
function registerManagedConnection(db: IDBPDatabase) {
  activeDb = db;
  db.addEventListener('versionchange', () => {
    try {
      db.close();
    } catch {
      // 忽略已关闭连接
    }
    if (activeDb === db) {
      activeDb = undefined;
      dbPromise = undefined;
    }
  });
}

/** 升级被其它页面的旧连接挡住且对方在限定时间内未让出时抛出，可重试 */
export class BlockedUpgradeError extends Error {
  constructor(currentVersion: number, targetVersion: number) {
    super(`数据库升级被其它打开的页面阻塞（v${currentVersion} → v${targetVersion}），请关闭其它标签页后重试。`);
    this.name = 'BlockedUpgradeError';
  }
}

// 阻塞超时：生产 8s，测试可通过 globalThis 覆盖
const BLOCK_TIMEOUT_MS: number =
  (globalThis as { __IDB_BLOCK_TIMEOUT_MS?: number }).__IDB_BLOCK_TIMEOUT_MS ?? 8000;

/** 包裹“需要版本升级”的打开：对方让出则正常完成；超时未让出则抛 BlockedUpgradeError */
function openDbWithBlockGuard(
  name: string,
  targetVersion: number,
  currentVersion: number
): Promise<IDBPDatabase> {
  const opened = openDB(name, targetVersion, {
    upgrade(db) {
      ensureStores(db);
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BlockedUpgradeError(currentVersion, targetVersion)), BLOCK_TIMEOUT_MS);
  });

  return Promise.race([opened, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDbWithSelfHeal().catch((error) => {
      // 打开/升级失败（含被阻塞超时）不缓存 rejected promise，允许下次重试
      dbPromise = undefined;
      throw error;
    });
  }

  return dbPromise;
}

/**
 * 自愈式打开（多标签页安全）：
 * 1) 先用“无版本号”连接探测当前库的真实版本与仓库（不触发 upgradeneeded），并注册
 *    versionchange 让出；若所需仓库齐全，直接复用，原有记录与顺序不动；
 * 2) 若缺仓库，关闭探测连接，再以更高版本重开（只升不降），在升级事务里补齐。
 *    该升级若被其它仍持有旧连接的页面挡住：对方会因同样的 versionchange 监听而关闭让出；
 *    遇到不配合的旧连接，则在有界超时后抛 BlockedUpgradeError（可重试），绝不无限等待。
 */
async function openDbWithSelfHeal(): Promise<IDBPDatabase> {
  // 无版本号打开：已存在则不触发升级；新库得到 version 0
  const probe = await openDB(DB_NAME);

  const missing = missingStores(probe);
  if (missing.length === 0) {
    // 健康连接会长期存活：登记为受管连接，收到其它页面的 versionchange 时主动让出
    registerManagedConnection(probe);
    return probe;
  }

  const currentVersion = probe.version;
  // 主动释放本页探测连接，避免自己挡自己
  probe.close();
  if (activeDb === probe) {
    activeDb = undefined;
  }

  const targetVersion = Math.max(DB_VERSION, currentVersion + 1);
  const healed = await openDbWithBlockGuard(DB_NAME, targetVersion, currentVersion);
  registerManagedConnection(healed);
  return healed;
}

export async function getAllRecords<S extends StoreName>(storeName: S): Promise<StoreValue<S>[]> {
  const db = await getDb();
  return (await db.getAll(storeName)) as StoreValue<S>[];
}

export async function getRecord<S extends StoreName>(storeName: S, id: string): Promise<StoreValue<S> | undefined> {
  const db = await getDb();
  return (await db.get(storeName, id)) as StoreValue<S> | undefined;
}

export async function putRecord<S extends StoreName>(storeName: S, record: StoreValue<S>) {
  const db = await getDb();
  await db.put(storeName, record);
  return record;
}

export async function deleteRecord(storeName: StoreName, id: string) {
  const db = await getDb();
  await db.delete(storeName, id);
}

export async function clearStore(storeName: StoreName) {
  const db = await getDb();
  await db.clear(storeName);
}

export async function exportAllData(): Promise<ExportPayload> {
  const [templates, clauses, instances, versions, publications] = await Promise.all([
    getAllRecords('templates'),
    getAllRecords('clauses'),
    getAllRecords('instances'),
    getAllRecords('versions'),
    getAllRecords('publications')
  ]);

  return {
    templates,
    clauses,
    instances,
    versions,
    publications,
    exportedAt: nowIso()
  };
}

export async function importAllData(payload: Partial<ExportPayload>) {
  const db = await getDb();
  const tx = db.transaction(STORE_NAMES, 'readwrite');

  for (const storeName of STORE_NAMES) {
    const store = tx.objectStore(storeName);
    await store.clear();
    const records = (payload[storeName] ?? []) as StoreValue<typeof storeName>[];
    for (const record of records) {
      await store.put(record);
    }
  }

  await tx.done;
}
