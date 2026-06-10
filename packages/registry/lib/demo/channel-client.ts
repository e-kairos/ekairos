"use client";

import { init, type InstantReactWebDatabase } from "@instantdb/react";
import { channelDomain } from "@ekairos/channel/schema";

const channelDbCache = new Map<string, InstantReactWebDatabase<any>>();

/**
 * InstantDB react client scoped to the channel domain schema, bound to the
 * visitor's temporary app. Reactive queries over channel_messages — this is
 * the exact client an application gets after pushing the channel schema.
 */
export function getChannelDemoDb(appId: string): InstantReactWebDatabase<any> {
  let db = channelDbCache.get(appId);
  if (!db) {
    db = init({
      appId,
      schema: channelDomain.toInstantSchema() as any,
      useDateObjects: false,
    });
    channelDbCache.set(appId, db);
  }
  return db;
}
