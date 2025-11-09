import Redis from 'ioredis';
import { config } from './config.js';

let redisClient;

export function getRedis() {
  if (!redisClient) {
    redisClient = new Redis(config.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableAutoPipelining: true,
    });
  }
  return redisClient;
}

// state keys
const kCollectionHash = (url) => `collection_hash:${url}`;
const kProductState = (identity) => `product_state:${identity}`;
const kEventDedupe = (eventId) => `dedupe:event:${eventId}`;

export async function getCollectionHash(url) {
  const r = getRedis();
  return r.get(kCollectionHash(url));
}

export async function setCollectionHash(url, hash) {
  const r = getRedis();
  await r.set(kCollectionHash(url), hash, 'EX', 3600);
}

export async function getProductState(identity) {
  const r = getRedis();
  const data = await r.hgetall(kProductState(identity));
  if (!data || Object.keys(data).length === 0) return null;
  return {
    lastTotalStock: data.lastTotalStock ? Number(data.lastTotalStock) : null,
    lastEventType: data.lastEventType || null,
    lastEventAt: data.lastEventAt || null,
    firstSeenAt: data.firstSeenAt || null,
    lastPriceYen: data.lastPriceYen ? Number(data.lastPriceYen) : null,
    lastHashNumber: data.lastHashNumber || null,
  };
}

export async function setProductState(identity, state) {
  const r = getRedis();
  const payload = {};
  if (state.lastTotalStock !== undefined) payload.lastTotalStock = String(state.lastTotalStock);
  if (state.lastEventType !== undefined) payload.lastEventType = state.lastEventType ?? '';
  if (state.lastEventAt !== undefined) payload.lastEventAt = state.lastEventAt ?? '';
  if (state.firstSeenAt !== undefined) payload.firstSeenAt = state.firstSeenAt ?? '';
  if (state.lastPriceYen !== undefined) payload.lastPriceYen = String(state.lastPriceYen ?? '');
  if (state.lastHashNumber !== undefined) payload.lastHashNumber = state.lastHashNumber ?? '';
  await r.hset(kProductState(identity), payload);
}

export async function dedupeCheckAndSet(eventId, ttlSec) {
  const r = getRedis();
  const key = kEventDedupe(eventId);
  const ok = await r.set(key, '1', 'NX', 'EX', ttlSec);
  return ok === 'OK';
}

