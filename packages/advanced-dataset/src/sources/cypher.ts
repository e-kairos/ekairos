/**
 * `kind: "cypher"` source — READ-ONLY Cypher against the replicated business
 * graph (Neo4j, projected from the platform ingest). Read-only is enforced by
 * the READ session access mode + executeRead (the server rejects writes in a
 * read transaction). Cypher allowlist/denylist guarding stays at the caller
 * (desktop cypher-guard / platform planner).
 *
 * Envs (defaults match the ekairos-data docker-compose local stack, same as
 * the desktop's graph-query.ts):
 * - NEO4J_URI       default bolt://localhost:7687
 * - NEO4J_USERNAME  (or NEO4J_USER) default neo4j
 * - NEO4J_PASSWORD  default ekairos-neo4j
 */
import neo4j, { type Driver } from "neo4j-driver"

import type { CypherSource, DatasetRow } from "../types.js"
import { normalizeNeo4jRecords } from "./neo4j-normalize.js"

export const CYPHER_QUERY_TIMEOUT_MS = 10_000

let driver: Driver | null = null

export function getNeo4jDriver(): Driver {
  if (driver) return driver
  const uri = process.env.NEO4J_URI?.trim() || "bolt://localhost:7687"
  const username =
    process.env.NEO4J_USERNAME?.trim() || process.env.NEO4J_USER?.trim() || "neo4j"
  const password = process.env.NEO4J_PASSWORD ?? "ekairos-neo4j"
  driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
    connectionAcquisitionTimeout: CYPHER_QUERY_TIMEOUT_MS,
    connectionTimeout: CYPHER_QUERY_TIMEOUT_MS,
  })
  return driver
}

export async function closeNeo4jDriver(): Promise<void> {
  if (driver) {
    await driver.close()
    driver = null
  }
}

export async function runCypherSource(
  source: CypherSource,
  options?: { driver?: Driver },
): Promise<DatasetRow[]> {
  const app = String(source.params?.app ?? "").trim()
  const env = String(source.params?.env ?? "").trim()
  if (!app || !env) {
    throw new Error("advanced_dataset_cypher_scope_required: params.app and params.env are mandatory")
  }
  // tenant scoping is not optional: normalized app/env always win
  const params = { ...source.params, app, env }

  const session = (options?.driver ?? getNeo4jDriver()).session({
    defaultAccessMode: neo4j.session.READ,
  })
  try {
    const work = session.executeRead(async (tx) => await tx.run(source.query, params), {
      timeout: CYPHER_QUERY_TIMEOUT_MS,
    })
    // hard wall-clock ceiling on top of the server-side tx timeout
    const result = await Promise.race([
      work,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("advanced_dataset_cypher_timeout_10s")),
          CYPHER_QUERY_TIMEOUT_MS + 2_000,
        ),
      ),
    ])
    return normalizeNeo4jRecords(result.records)
  } finally {
    await session.close()
  }
}
