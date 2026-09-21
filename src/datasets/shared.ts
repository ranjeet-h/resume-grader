import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

export function getString(row: JsonRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function getStringArray(row: JsonRecord, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) {
      return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((x) => x.trim())
        .filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(/[;,|]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export function getNumber(row: JsonRecord, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    const number =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

export async function readJson(pathname: string): Promise<unknown> {
  return JSON.parse(await readFile(pathname, 'utf8')) as unknown;
}

export function asArray(value: unknown, source: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${source} must contain a JSON array`);
  return value;
}

export async function hashFiles(files: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(path.basename(file));
    hash.update(await readFile(file));
  }
  return hash.digest('hex');
}

export function stableSeededSample<T>(items: readonly T[], limit: number, seed: number): T[] {
  if (!Number.isInteger(limit) || limit < 0)
    throw new RangeError('limit must be a nonnegative integer');
  if (items.length <= limit) return [...items];
  const shuffled = [...items];
  const random = seededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled.slice(0, limit);
}

export function stratifiedSample<T>(
  items: readonly T[],
  limit: number,
  seed: number,
  getStratum: (item: T) => string,
): T[] {
  if (!Number.isInteger(limit) || limit < 0)
    throw new RangeError('limit must be a nonnegative integer');
  if (items.length <= limit) return [...items];

  const random = seededRandom(seed);
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getStratum(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) shuffleInPlace(group, random);

  const keys = [...groups.keys()].sort();
  const output: T[] = [];
  let cursor = 0;
  while (output.length < limit) {
    let added = false;
    for (let offset = 0; offset < keys.length && output.length < limit; offset += 1) {
      const key = keys[(cursor + offset) % keys.length]!;
      const item = groups.get(key)?.shift();
      if (item !== undefined) {
        output.push(item);
        added = true;
      }
    }
    if (!added) break;
    cursor = (cursor + 1) % keys.length;
  }
  return output;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffleInPlace<T>(items: T[], random: () => number): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex]!, items[index]!];
  }
}
