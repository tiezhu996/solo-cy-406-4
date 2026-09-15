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

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDbWithSelfHeal().catch((error) => {
      // 打开/升级失败不缓存 rejected promise，允许下次重试，避免数据层永久不可用
      dbPromise = undefined;
      throw error;
    });
  }

  return dbPromise;
}

/**
 * 自愈式打开：
 * 1) 先用“无版本号”连接探测当前库的真实版本与仓库（不触发 upgradeneeded）；
 * 2) 若所需仓库齐全（正常的 v1/v2/v3 库），直接复用，原有记录与顺序不动；
 * 3) 若缺仓库（典型：库停在同版本号但 publications 未建成，此时再用同版本
 *    打开永远不会触发升级），关闭探测连接并以更高版本重开，在升级事务里补齐。
 */
async function openDbWithSelfHeal(): Promise<IDBPDatabase> {
  // 新库探测得到 version 0；旧库为其真实版本
  const probe = await openDB(DB_NAME);
  const missing = missingStores(probe);

  if (missing.length === 0) {
    return probe;
  }

  const currentVersion = probe.version;
  probe.close();

  // 只升不降：取基线版本与“当前版本+1”中的较大者
  const targetVersion = Math.max(DB_VERSION, currentVersion + 1);
  return openDB(DB_NAME, targetVersion, {
    upgrade(db) {
      ensureStores(db);
    }
  });
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
