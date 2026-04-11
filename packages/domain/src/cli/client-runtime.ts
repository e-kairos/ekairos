import {
  FrameworkClient,
  init,
  parseSchemaFromJSON,
  type InstantSchemaDef,
  type User,
} from "@instantdb/core"

export type ClientRuntimeParams = {
  appId: string
  refreshToken: string
  apiURI?: string
  schema?: InstantSchemaDef<any, any, any>
}

export class ClientRuntime {
  readonly appId: string
  readonly refreshToken: string
  readonly apiURI: string
  readonly env: {
    appId: string
    refreshToken: string
  }

  constructor(params: ClientRuntimeParams) {
    this.appId = String(params.appId ?? "").trim()
    this.refreshToken = String(params.refreshToken ?? "").trim()
    this.apiURI = String(params.apiURI ?? "https://api.instantdb.com").trim()

    if (!this.appId) {
      throw new Error("ClientRuntime requires appId")
    }
    if (!this.refreshToken) {
      throw new Error("ClientRuntime requires refreshToken")
    }

    this.env = {
      appId: this.appId,
      refreshToken: this.refreshToken,
    }
  }

  private createDb(schema?: InstantSchemaDef<any, any, any> | unknown) {
    const parsedSchema =
      schema && typeof schema === "object"
        ? parseSchemaFromJSON(schema as Record<string, unknown>)
        : undefined
    return init({
      appId: this.appId,
      apiURI: this.apiURI,
      useDateObjects: true,
      ...(parsedSchema ? { schema: parsedSchema } : {}),
    })
  }

  async verify(): Promise<User> {
    const response = await fetch(`${this.apiURI}/runtime/auth/verify_refresh_token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        "app-id": this.appId,
        "refresh-token": this.refreshToken,
      }),
    })
    if (!response.ok) {
      throw new Error(`refresh_token_verify_failed:${response.status}`)
    }
    const data = (await response.json()) as { user?: User }
    if (!data?.user) {
      throw new Error("refresh_token_verify_failed")
    }
    return data.user
  }

  async query(query: Record<string, unknown>, schema?: InstantSchemaDef<any, any, any> | unknown) {
    const db = this.createDb(schema)
    const client = new FrameworkClient({
      db,
      token: this.refreshToken,
    })
    const { query: coerced } = client.hashQuery(query)
    const payload = await client.getTriplesAndAttrsForQuery(coerced)
    return client.completeIsomorphic(
      payload.query,
      payload.triples,
      payload.attrs,
      payload.pageInfo,
    )
  }
}
