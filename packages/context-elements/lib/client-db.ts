"use client";

import { init, type InstantReactWebDatabase } from "@instantdb/react";

import schema, { type AppSchema } from "@/instant.schema";

const clients = new Map<string, InstantReactWebDatabase<AppSchema>>();

export function getPreviewDb(appId: string): InstantReactWebDatabase<AppSchema> {
  const existing = clients.get(appId);
  if (existing) return existing;

  const db = init({
    appId,
    schema,
    useDateObjects: true,
  });
  clients.set(appId, db);
  return db;
}
