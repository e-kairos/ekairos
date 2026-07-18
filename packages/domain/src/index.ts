import { i } from "@instantdb/core";
import type { InstantAdminDatabase } from "@instantdb/admin";
import type { EntitiesDef, LinksDef, RoomsDef, InstantSchemaDef, EntityDef, InstaQLParams } from "@instantdb/core";
import { z } from "zod";
import {
  createDomainActionDefinition,
  executeDomainActionPrivate,
  getDomainActionBindingView,
  isDomainActionDefinition,
  isDomainActionRegistration,
  rebindDomainActionOwner,
  registerDomainAction,
  scopeDomainActionRegistration,
  setActiveDomainActionScopeFactory,
  setDomainActionMembership,
} from "./domain-action.internal.js";
export {
  EkairosRuntime,
  type RuntimeForDomain,
  type RuntimeUseForDomain,
  type RuntimeLike,
  type ExplicitRuntimeLike,
} from "./runtime-handle.js";

type DomainIncludeRef = () => unknown;

type DomainMeta = {
  name?: string;
  rootDir?: string;
  packageName?: string;
  includes: DomainIncludeRef[];
};

export type DomainConstructorOptions = {
  name?: string;
  rootDir?: string;
  packageName?: string;
};

export type DomainDocInfo = {
  doc: string;
  docPath?: string;
};

export type DomainDocLoader = (input: {
  scope: "root" | "subdomain";
  meta?: DomainMeta | null;
}) => DomainDocInfo | null;

export type DomainDocNormalizeOptions = {
  subdomains?: string[];
  entities?: string[];
  titlePrefix?: "Domain" | "Subdomain";
  includeSubdomains?: boolean;
};

export type DomainDocNormalizer = (input: {
  docInfo: DomainDocInfo;
  options: DomainDocNormalizeOptions;
}) => { doc: string | null; docPath?: string } | null | undefined;

export type DomainInclude =
  | DomainInstance<any, any, any>
  | AnyDomainSchemaResult
  | InstantSchemaDef<any, any, any>
  | (() => DomainInstance<any, any, any> | AnyDomainSchemaResult | InstantSchemaDef<any, any, any> | undefined)
  | undefined;

export type DomainActionSchema = z.ZodType;

type AnyMaterializedDomain = MaterializedDomainLike;

/** @internal Publicly nameable phantom keys for exported action registrations. */
export const DOMAIN_ACTION_RUNTIME_TYPE: unique symbol = Symbol.for(
  "@ekairos/domain/action-runtime-type",
);
/** @internal Publicly nameable phantom keys for exported action registrations. */
export const DOMAIN_ACTION_OWNER_TYPE: unique symbol = Symbol.for(
  "@ekairos/domain/action-owner-type",
);
/** @internal Publicly nameable phantom keys for exported scoped action registrations. */
export const DOMAIN_ACTION_FULL_INPUT_TYPE: unique symbol = Symbol.for(
  "@ekairos/domain/action-full-input-type",
);

export type DomainActionRuntimeLike<Env = any> = {
  readonly env: Env;
  db(options?: unknown): Promise<unknown>;
  meta(): { domain?: DomainLike | null };
  use<SubD extends AnyMaterializedDomain>(
    subdomain: SubD,
    options?: unknown,
  ): Promise<ActiveDomain<SubD, Env>>;
};

type RuntimeEnvOfActionRuntime<Runtime> =
  Runtime extends { readonly env: infer Env } ? Env : unknown;

type ActionOwnerDomain<Domain> =
  Domain extends AnyMaterializedDomain ? Domain : any;

export type DomainActionExecuteParams<
  InputSchema extends DomainActionSchema = DomainActionSchema,
  Runtime = DomainActionRuntimeLike,
  Domain = unknown,
> = {
  input: z.output<InputSchema>;
  runtime: Runtime;
  domain: DomainRuntime<
    ActionOwnerDomain<Domain>,
    RuntimeEnvOfActionRuntime<Runtime>
  >;
  /** The durable Reaction that invoked this action, when Reactor is the caller. */
  reactionId?: string;
};

export type DomainActionDefinition<
  InputSchema extends DomainActionSchema = DomainActionSchema,
  OutputSchema extends DomainActionSchema = DomainActionSchema,
  Runtime = DomainActionRuntimeLike,
  Domain = unknown,
> = Readonly<{
  description?: string;
  input: InputSchema;
  output: OutputSchema;
  inputSchema?: unknown;
  outputSchema?: unknown;
  requiredScopes?: readonly string[];
  readonly [DOMAIN_ACTION_RUNTIME_TYPE]?: Readonly<{
    runtime: Runtime;
    domain: Domain;
  }>;
}>;

export type DomainActionImplementationDefinition<
  InputSchema extends DomainActionSchema = DomainActionSchema,
  OutputSchema extends DomainActionSchema = DomainActionSchema,
  Runtime = DomainActionRuntimeLike,
  Domain = unknown,
> = {
  description?: string;
  input: InputSchema;
  output: OutputSchema;
  requiredScopes?: readonly string[];
  execute: (
    params: DomainActionExecuteParams<InputSchema, Runtime, Domain>,
  ) => Promise<z.output<OutputSchema>> | z.output<OutputSchema>;
};

type ObjectInputOfSchema<InputSchema extends DomainActionSchema> =
  z.input<InputSchema> extends Record<string, unknown>
    ? z.input<InputSchema>
    : never;

type ScopedActionInputFromSchema<
  InputSchema extends DomainActionSchema,
  Bound extends Partial<ObjectInputOfSchema<InputSchema>>,
> = Simplify<Omit<ObjectInputOfSchema<InputSchema>, keyof Bound>>;

export type DomainActionScopeMethod<
  InputSchema extends DomainActionSchema,
  OutputSchema extends DomainActionSchema,
  Runtime,
  Domain,
  FullInputSchema extends DomainActionSchema,
  Key extends string,
  OwnerDomainName extends string,
> = <const Bound extends Partial<ObjectInputOfSchema<InputSchema>>>(
  boundInput: Bound,
) => DomainActionRegistration<
  z.ZodType<ScopedActionInputFromSchema<InputSchema, Bound>>,
  OutputSchema,
  Runtime,
  Domain,
  Key,
  OwnerDomainName,
  FullInputSchema
>;

export type DomainActionRegistration<
  InputSchema extends DomainActionSchema = DomainActionSchema,
  OutputSchema extends DomainActionSchema = DomainActionSchema,
  Runtime = DomainActionRuntimeLike,
  Domain = unknown,
  Key extends string = string,
  OwnerDomainName extends string = string,
  FullInputSchema extends DomainActionSchema = InputSchema,
> = Readonly<
  DomainActionDefinition<InputSchema, OutputSchema, Runtime, Domain> & {
    id: `${OwnerDomainName}.${Key}`;
    ownerDomain: OwnerDomainName;
    key: Key;
    scope: DomainActionScopeMethod<
      InputSchema,
      OutputSchema,
      Runtime,
      Domain,
      FullInputSchema,
      Key,
      OwnerDomainName
    >;
    readonly [DOMAIN_ACTION_OWNER_TYPE]?: Domain;
    readonly [DOMAIN_ACTION_FULL_INPUT_TYPE]?: FullInputSchema;
  }
>;

export type DomainActionLike =
  | DomainActionDefinition<any, any, any, any>
  | DomainActionRegistration<any, any, any, any>;

export type DomainActionCollection = Readonly<Record<string, DomainActionLike>>;

export type DomainEventSchema = z.ZodType;

export type DomainEventLinkDefinition<
  EntityNamespace extends string = string,
  Cardinality extends "one" | "many" = "one" | "many",
> = {
  readonly on: EntityNamespace;
  readonly has: Cardinality;
};

export type DomainEventDefinition<
  InputSchema extends DomainEventSchema = DomainEventSchema,
  Links extends Record<string, DomainEventLinkDefinition> = {},
> = {
  readonly payload: InputSchema;
  readonly links?: Links;
};

export type DomainEventRegistration<
  InputSchema extends DomainEventSchema = DomainEventSchema,
  Links extends Record<string, DomainEventLinkDefinition> = {},
  OwnerDomain = unknown,
  EventName extends string = string,
  DomainName extends string = string,
  Kind extends string = string,
> = DomainEventDefinition<InputSchema, Links> & {
  name: EventName;
  kind: Kind;
  domain: DomainName;
  ownerDomain?: OwnerDomain;
};

export type DomainEventCollection =
  Record<string, DomainEventDefinition<any, any> | DomainEventRegistration<any, any, any>>;

export type DomainEventMap = Record<string, DomainEventRegistration<any, any, any>>;

type DomainEventLinkValue<Link extends DomainEventLinkDefinition> =
  Link["has"] extends "one" ? string : string | string[];

export type DomainEventLinkParams<Links extends Record<string, DomainEventLinkDefinition>> = {
  [Alias in keyof Links]?: DomainEventLinkValue<Links[Alias]>;
};

export type DomainEventPhysicalLink = Readonly<{
  alias: string;
  key: string;
  target: string;
  has: "one" | "many";
  forwardLabel: string;
  reverseLabel: string;
}>;

export type DomainEventConstructorDefinition<
  InputSchema extends DomainEventSchema = DomainEventSchema,
  Links extends Record<string, DomainEventLinkDefinition> = {},
  Kind extends string = string,
  DomainName extends string = string,
  EventName extends string = string,
> = Readonly<{
  payload: InputSchema;
  links: Readonly<Links>;
  kind: Kind;
  domain: DomainName;
  name: EventName;
  physicalLinks: Readonly<Record<keyof Links & string, DomainEventPhysicalLink>>;
}>;

export type DomainEventDraft<
  Payload = unknown,
  Links extends Record<string, DomainEventLinkDefinition> = {},
  InputSchema extends DomainEventSchema = DomainEventSchema,
  Kind extends string = string,
  DomainName extends string = string,
  EventName extends string = string,
> = Readonly<{
  payload: Payload;
  links: Readonly<Partial<Record<keyof Links & string, string | readonly string[]>>>;
  kind: Kind;
  domain: DomainName;
  name: EventName;
  physicalLinks: Readonly<Record<keyof Links & string, DomainEventPhysicalLink>>;
  definition: DomainEventConstructorDefinition<InputSchema, Links, Kind, DomainName, EventName>;
  link(params: DomainEventLinkParams<Links>): DomainEventDraft<Payload, Links, InputSchema, Kind, DomainName, EventName>;
}>;

type DomainEventPayloadOf<Event> =
  Event extends DomainEventRegistration<infer InputSchema, any, any>
    ? z.output<InputSchema>
    : never;

type DomainEventLinksOf<Event> =
  Event extends DomainEventRegistration<any, infer Links, any> ? Links : {};

type DomainEventSchemaOf<Event> =
  Event extends DomainEventRegistration<infer InputSchema, any, any> ? InputSchema : DomainEventSchema;

export type DomainEventConstructor<
  InputSchema extends DomainEventSchema = DomainEventSchema,
  Links extends Record<string, DomainEventLinkDefinition> = {},
  Kind extends string = string,
  DomainName extends string = string,
  EventName extends string = string,
> = ((payload: z.output<InputSchema>) => DomainEventDraft<
  z.output<InputSchema>, Links, InputSchema, Kind, DomainName, EventName
>) & DomainEventConstructorDefinition<InputSchema, Links, Kind, DomainName, EventName> & Readonly<{
  definition: DomainEventConstructorDefinition<InputSchema, Links, Kind, DomainName, EventName>;
}>;

export type DomainEventMethods<Events extends DomainEventMap> = {
  [K in keyof Events & string]: DomainEventConstructor<
    DomainEventSchemaOf<Events[K]>,
    DomainEventLinksOf<Events[K]>,
    Events[K]["kind"],
    Events[K]["domain"],
    K
  >;
};

let domainDocLoader: DomainDocLoader | null = null;
let domainDocNormalizer: DomainDocNormalizer | null = null;

export function configureDomainDocLoader(loader?: DomainDocLoader | null) {
  domainDocLoader = loader ?? null;
}

export function configureDomainDocNormalizer(normalizer?: DomainDocNormalizer | null) {
  domainDocNormalizer = normalizer ?? null;
}

export type DomainContextEntry = {
  name?: string;
  includes?: string[];
  entities?: string[];
  links?: string[];
  rooms?: string[];
  schema?: unknown;
  doc?: string | null;
  docPath?: string | null;
};

export type DomainContext = DomainContextEntry & {
  meta?: Record<string, unknown>;
  registry: DomainContextEntry[];
};

export type DomainContextOptions = {
  meta?: Record<string, unknown>;
  includeSchemas?: boolean;
};

type UnknownDomainNames = string;

type AnyDomainSchemaResult = {
  entities: any;
  links: any;
  rooms: any;
  instantSchema: () => any;
  toInstantSchema?: () => any;
};

const EKAIROS_META = Symbol.for("@ekairos/domain/meta");
const EKAIROS_ACTIONS = Symbol.for("@ekairos/domain/actions");
const EKAIROS_ACTION_MAP = Symbol.for("@ekairos/domain/action-map");
const EKAIROS_EVENT_MAP = Symbol.for("@ekairos/domain/event-map");
declare const DOMAIN_NAME_TYPE: unique symbol;
declare const DOMAIN_INCLUDED_NAMES_TYPE: unique symbol;
declare const DOMAIN_ACTION_MAP_TYPE: unique symbol;
declare const DOMAIN_EVENT_MAP_TYPE: unique symbol;
declare const DOMAIN_LINKS_TYPE: unique symbol;

export type DomainLike = {
  readonly entities: EntitiesDef;
  readonly links: LinksDef<any>;
  readonly rooms: RoomsDef;
  instantSchema: () => any;
  toInstantSchema?: () => any;
  fromDB?: (db: any, bindings?: { env?: unknown; runtime?: unknown }) => any;
  readonly [DOMAIN_NAME_TYPE]?: string;
  readonly [DOMAIN_INCLUDED_NAMES_TYPE]?: string;
  readonly [DOMAIN_ACTION_MAP_TYPE]?: DomainActionMap;
  readonly [DOMAIN_EVENT_MAP_TYPE]?: DomainEventMap;
  readonly [DOMAIN_LINKS_TYPE]?: LinksDef<any>;
};

export type MaterializedDomainLike = DomainLike & {
  readonly originalEntities: EntitiesDef;
  context: (options?: DomainContextOptions) => DomainContext;
  contextString: (options?: DomainContextOptions) => string;
};

// No hard-coded base entities here. InstantDB adds base entities at runtime inside i.schema.
// We only add them at the TYPE level via WithBase<> so links can reference them.

export type DomainDefinition<E extends EntitiesDef, L extends LinksDef<E>, R extends RoomsDef> = DomainConstructorOptions & {
  entities: E;
  links: L;
  rooms: R;
};

export type DomainInstance<E extends EntitiesDef, L extends LinksDef<E>, R extends RoomsDef> = DomainDefinition<E, L, R> & {
  schema: () => any;
  compose: <E2 extends EntitiesDef, L2 extends LinksDef<E2>, R2 extends RoomsDef>(
    other: DomainInstance<E2, L2, R2> | DomainDefinition<E2, L2, R2>
  ) => DomainInstance<E & E2, LinksDef<E & E2>, R & R2>;
  meta?: Record<string, unknown>;
};

export type SchemaOf<D> =
  D extends AnyDomainSchemaResult
    ? ReturnType<D["instantSchema"]>
    : D extends DomainDefinition<infer E, any, infer R>
      ? InstantSchemaDef<E, LinksDef<E>, R>
      : InstantSchemaDef<any, any, any>;

export type DomainDbFor<D> =
  InstantAdminDatabase<SchemaOf<D>, true>;

// --- Schema compatibility helpers for domain composition ---

type EntitiesOf<S> =
  S extends InstantSchemaDef<infer E, any, any> ? E : never;

type LinksOf<S> =
  S extends InstantSchemaDef<any, infer L, any> ? L : never;

type AttrsOfEntity<E> =
  E extends EntityDef<infer Attrs, any, any> ? Attrs : never;

type EnsureIncludesEntityAttrs<
  FullEntity,
  RequiredEntity,
> = [
  {
    [K in keyof AttrsOfEntity<RequiredEntity>]:
      K extends keyof AttrsOfEntity<FullEntity>
        ? (AttrsOfEntity<FullEntity>[K] extends AttrsOfEntity<RequiredEntity>[K] ? never : K)
        : K
  }[keyof AttrsOfEntity<RequiredEntity>]
] extends [never]
  ? true
  : false;

/**
 * Verifies that Full schema includes all entities and links from Required schema.
 * Returns Full if compatible, never otherwise.
 */
type EnsureIncludesSchema<
  Full extends InstantSchemaDef<any, any, any>,
  Required extends InstantSchemaDef<any, any, any>
> =
  // Check entities: Full must contain all entities from Required with compatible types
  [
  {
    [K in keyof EntitiesOf<Required>]:
      K extends keyof EntitiesOf<Full>
        ? (EnsureIncludesEntityAttrs<EntitiesOf<Full>[K], EntitiesOf<Required>[K]> extends true ? never : K)
        : K
  }[keyof EntitiesOf<Required>]
  ] extends [never]
    ? (
        // Check links: Full must contain all links from Required with compatible types
        [
        {
          [K in keyof LinksOf<Required>]:
            K extends keyof LinksOf<Full>
              ? (LinksOf<Full>[K] extends LinksOf<Required>[K] ? never : K)
              : K
        }[keyof LinksOf<Required>]
        ] extends [never]
          ? Full
          : never
      )
    : never;


/**
 * Schema S restricted to be compatible with RequiredDomain.
 * Returns S if compatible, never otherwise.
 * 
 * This is a generic helper that works with any database type wrapper.
 * Consumers should wrap it with their specific DB type (e.g., InstantAdminDatabase).
 * 
 * Usage in @ekairos/events:
 * ```ts
 * import type { InstantAdminDatabase } from "@instantdb/admin";
 * 
 * export function createAgent<S extends InstantSchemaDef<any, any, any>>(
 *   db: InstantAdminDatabase<CompatibleSchemaForDomain<S, typeof threadDomain>>
 * ): CreateAgentEntry
 * ```
 */
export type CompatibleSchemaForDomain<
  S extends InstantSchemaDef<any, any, any>,
  RequiredDomain extends DomainDefinition<any, any, any> | AnyDomainSchemaResult | DomainInstance<any, any, any>
> = EnsureIncludesSchema<S, SchemaOf<RequiredDomain>>;

export type DomainNameOf<D> =
  D extends { readonly [DOMAIN_NAME_TYPE]?: infer Name }
    ? NonNullable<Name> extends string
      ? NonNullable<Name>
      : UnknownDomainNames
    : UnknownDomainNames;

export type IncludedDomainNamesOf<D> =
  D extends { readonly [DOMAIN_INCLUDED_NAMES_TYPE]?: infer Names }
    ? NonNullable<Names> extends string
      ? NonNullable<Names>
      : DomainNameOf<D>
    : DomainNameOf<D>;

export type DomainInstantSchema<D> =
  D extends DomainSchemaResult<infer E, infer L, infer R, any, any, any, any>
    ? InstantSchemaDef<WithBase<E>, L, R>
    : never;

// Utility types for extracting from domain definitions/instances
type ExtractEntities<T> = T extends { entities: infer E } ? E extends EntitiesDef ? E : never : never;
type ExtractLinks<T> = T extends { links: infer L } ? L extends LinksDef<any> ? L : never : never;
type ExtractRooms<T> = T extends { rooms: infer R } ? R extends RoomsDef ? R : never : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type DomainActionMap = Record<string, DomainActionRegistration<any, any, any, any>>;

export type DomainDefinitionOf<D> =
  D extends DomainSchemaResult<
    infer E,
    infer L,
    infer R,
    infer Actions,
    infer Name,
    infer IncludedNames,
    infer Events
  >
    ? DomainSchemaResult<
        Simplify<E>,
        Simplify<L>,
        R,
        Simplify<Actions>,
        Name,
        IncludedNames,
        Simplify<Events>
      >
    : never;

type BindActionToDomain<
  Value,
  OwnerDomain extends AnyMaterializedDomain,
  Key extends string,
> = Value extends DomainActionRegistration<
    infer InputSchema,
    infer OutputSchema,
    infer Runtime,
    infer OriginalOwner,
    infer OriginalKey,
    infer OriginalOwnerName,
    infer FullInputSchema
  >
    ? DomainActionRegistration<
        InputSchema,
        OutputSchema,
        Runtime,
        OriginalOwner,
        OriginalKey,
        OriginalOwnerName,
        FullInputSchema
      >
    : Value extends DomainActionDefinition<
    infer InputSchema,
    infer OutputSchema,
    infer Runtime,
    any
  >
    ? DomainActionRegistration<
        InputSchema,
        OutputSchema,
        Runtime,
        OwnerDomain,
        Key,
        DomainNameOf<OwnerDomain>,
        InputSchema
      >
    : DomainActionRegistration;

type ActionMapFromCollection<
  Input,
  OwnerDomain extends AnyMaterializedDomain = AnyMaterializedDomain,
> =
  Input extends Record<string, any>
    ? {
        [K in keyof Input & string]: BindActionToDomain<Input[K], OwnerDomain, K>;
      }
    : {};

type MergeActionMaps<
  Current extends DomainActionMap,
  Next extends DomainActionMap,
> = Simplify<Omit<Current, keyof Next> & Next>;

type BindEventToDomain<Value, OwnerDomain, EventName extends string> =
  Value extends DomainEventDefinition<infer InputSchema, infer Links>
    ? DomainEventRegistration<
        InputSchema,
        Links,
        OwnerDomain,
        EventName,
        DomainNameOf<OwnerDomain>,
        `${DomainNameOf<OwnerDomain>}.${EventName}`
      >
    : DomainEventRegistration;

type EventMapFromCollection<
  Input,
  OwnerDomain = DomainSchemaResult,
> =
  Input extends Record<string, any>
    ? {
        [K in keyof Input & string]: BindEventToDomain<Input[K], OwnerDomain, K>;
      }
    : {};

type MergeEventMaps<
  Current extends DomainEventMap,
  Next extends DomainEventMap,
> = Simplify<Omit<Current, keyof Next> & Next>;

type EventDomainCharacter =
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m"
  | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z"
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

type NormalizeEventDomain<
  Value extends string,
  Result extends string = "",
  Separator extends boolean = false,
> = Lowercase<Value> extends `${infer Head}${infer Tail}`
  ? Head extends EventDomainCharacter
    ? NormalizeEventDomain<Tail, `${Result}${Separator extends true ? Result extends "" ? "" : "_" : ""}${Head}`, false>
    : NormalizeEventDomain<Tail, Result, true>
  : Result;

type EventGeneratedLink<
  DomainName extends string,
  Alias extends string,
  Link extends DomainEventLinkDefinition,
> = {
  forward: { on: "context_events"; has: Link["has"]; label: `${NormalizeEventDomain<DomainName>}_${Alias}` };
  reverse: { on: Link["on"]; has: "many"; label: `${NormalizeEventDomain<DomainName>}_events_as_${Alias}` };
};

type UnionToIntersection<Union> =
  (Union extends unknown ? (value: Union) => void : never) extends
    (value: infer Intersection) => void ? Intersection : never;

type AllEventLinks<Events extends DomainEventMap> = UnionToIntersection<{
  [EventName in keyof Events]: DomainEventLinksOf<Events[EventName]>;
}[keyof Events]>;

type GeneratedEventLinks<DomainName extends string, Events extends DomainEventMap> =
  AllEventLinks<Events> extends infer EventLinks
    ? [EventLinks] extends [Record<string, DomainEventLinkDefinition>]
      ? Simplify<{
          [Alias in keyof EventLinks & string as `event__${NormalizeEventDomain<DomainName>}__${Alias}`]:
            EventGeneratedLink<DomainName, Alias, Extract<EventLinks[Alias], DomainEventLinkDefinition>>;
        }> extends infer Generated
        ? Generated extends LinksDef<any> ? Generated : {}
        : {}
      : {}
    : {};

type MergeGeneratedEventLinks<
  Links extends LinksDef<any>,
  DomainName extends string,
  Events extends DomainEventMap,
> = Simplify<Links & GeneratedEventLinks<DomainName, Events>> extends infer Merged
  ? Merged extends LinksDef<any> ? Merged : Links
  : Links;

export type ActionMapOf<D> =
  D extends { readonly [DOMAIN_ACTION_MAP_TYPE]?: infer Actions }
    ? NonNullable<Actions>
    : {};

export type EventMapOf<D> =
  D extends { readonly [DOMAIN_EVENT_MAP_TYPE]?: infer Events }
    ? NonNullable<Events>
    : {};

export type DomainActionsOf<D> = ActionMapOf<D>;
export type DomainEventsOf<D> = EventMapOf<D>;

export type DomainActionOwner<Action> =
  Action extends DomainActionRegistration<any, any, any, infer Owner>
    ? Owner
    : never;

type DomainNamesCompatible<
  RootDomain,
  RequiredDomain,
> = string extends IncludedDomainNamesOf<RootDomain>
  ? true
  : string extends IncludedDomainNamesOf<RequiredDomain>
    ? true
    : Exclude<IncludedDomainNamesOf<RequiredDomain>, IncludedDomainNamesOf<RootDomain>> extends never
      ? true
      : false;

export type DomainIncludesDomain<
  RootDomain,
  RequiredDomain,
> = RootDomain extends DomainLike
  ? RequiredDomain extends DomainLike
    ? DomainNamesCompatible<RootDomain, RequiredDomain>
    : false
  : false;

export type DomainActionBelongsTo<
  Action,
  RootDomain,
> = DomainIncludesDomain<RootDomain, DomainActionOwner<Action>>;

type ActionInputOf<Action> =
  Action extends DomainActionDefinition<infer InputSchema, any, any, any>
    ? z.input<InputSchema>
    : never;

type ActionOutputOf<Action> =
  Action extends DomainActionDefinition<any, infer OutputSchema, any, any>
    ? z.output<OutputSchema>
    : never;

export type ScopedDomainActionInput<
  Action,
  Bound extends Partial<ActionInputOf<Action>>,
> = Simplify<Omit<ActionInputOf<Action>, keyof Bound>>;

export type DomainActionInput<Action> = ActionInputOf<Action>;

export type DomainActionFullInput<Action> =
  Action extends DomainActionRegistration<
    any,
    any,
    any,
    any,
    any,
    any,
    infer FullInputSchema
  >
    ? z.output<FullInputSchema>
    : Action extends DomainActionDefinition<infer InputSchema, any, any, any>
      ? z.output<InputSchema>
      : never;

export type DomainActionOutput<Action> =
  Action extends DomainActionDefinition<any, infer OutputSchema, any, any>
    ? z.output<OutputSchema>
    : never;

export type DomainActionSerializedOutput<Action> =
  Action extends DomainActionDefinition<any, infer OutputSchema, any, any>
    ? z.output<OutputSchema>
    : never;

type DomainActionMethodFor<Action> =
  Action extends DomainActionRegistration<
    infer InputSchema,
    infer OutputSchema,
    infer Runtime,
    infer OwnerDomain,
    infer Key,
    infer OwnerDomainName,
    infer FullInputSchema
  >
    ? ((
        input: z.input<InputSchema>,
      ) => Promise<z.output<OutputSchema>>) & {
        scope: <const Bound extends Partial<ObjectInputOfSchema<InputSchema>>>(
          boundInput: Bound,
        ) => DomainActionMethodFor<
          DomainActionRegistration<
            z.ZodType<ScopedActionInputFromSchema<InputSchema, Bound>>,
            OutputSchema,
            Runtime,
            OwnerDomain,
            Key,
            OwnerDomainName,
            FullInputSchema
          >
        >;
      }
    : never;

type DomainActionMethods<Actions extends DomainActionMap> = {
  [K in keyof Actions]: DomainActionMethodFor<Actions[K]>;
};

type DomainDbShortcuts<DB> =
  DB extends { query: infer Query } ? { query: Query } : {};

type RuntimeDomainQueryForParts<
  E extends EntitiesDef,
  L extends LinksDef<any>,
  R extends RoomsDef,
> = <Query extends InstaQLParams<InstantSchemaDef<WithBase<E>, L, R>>>(
  query: Query,
) => Promise<any>;

type CallableDomainActionMethods<Actions extends DomainActionMap, DB> = Omit<
  DomainActionMethods<Actions>,
  | "actions"
  | "context"
  | "contextString"
  | "db"
  | "domain"
  | "env"
  | "schema"
  | keyof DomainDbShortcuts<DB>
>;

export type CallableDomainScope<
  E extends EntitiesDef,
  L extends LinksDef<any>,
  R extends RoomsDef,
  Actions extends DomainActionMap,
  Events extends DomainEventMap,
  Env = unknown,
> =
  & {
    domain: unknown;
    db: { query: RuntimeDomainQueryForParts<E, L, R> };
    schema: InstantSchemaDef<WithBase<E>, L, R>;
    context: (options?: DomainContextOptions) => DomainContext;
    contextString: (options?: DomainContextOptions) => string;
    env: Env;
    actions: DomainActionMethods<Actions>;
    events: DomainEventMethods<Events>;
    query: RuntimeDomainQueryForParts<E, L, R>;
  }
  & CallableDomainActionMethods<Actions, { query: RuntimeDomainQueryForParts<E, L, R> }>;

export type ConcreteDomainFor<
  E extends EntitiesDef,
  L extends LinksDef<any>,
  R extends RoomsDef,
  Actions extends DomainActionMap,
  Events extends DomainEventMap,
  Name extends string,
  IncludedNames extends string,
  DB,
> = {
  domain: DomainSchemaResult<E, L, R, Actions, Name, IncludedNames, Events>;
  db: DB;
  schema: ReturnType<typeof i.schema<WithBase<E>, L, R>>;
  context: (options?: DomainContextOptions) => DomainContext;
  contextString: (options?: DomainContextOptions) => string;
};

export type RuntimeDomainScope<
  D = unknown,
  Env = unknown,
> =
  & ActiveDomain<any, Env>
  & Record<string, unknown>;

type RuntimeCallableForDomain<D extends AnyMaterializedDomain> = {
  use(subdomain: D, options?: unknown): Promise<ActiveDomain<D, unknown>>;
};

// Strip link metadata from entity definitions to avoid nested EntityDef links
type StripEntityLinks<E extends EntitiesDef> = {
  [K in keyof E]: E[K] extends EntityDef<infer Attrs, any, infer AsType>
    ? EntityDef<Attrs, {}, AsType>
    : E[K];
};

type StripEntityLinksValue<E> =
  E extends EntityDef<infer Attrs, any, infer AsType>
    ? EntityDef<Attrs, {}, AsType>
    : E;

type DuplicateEntityAttrKeys<AttrsA, AttrsB> =
  string extends keyof AttrsA
    ? never
    : string extends keyof AttrsB
      ? never
      : Extract<keyof AttrsA, keyof AttrsB>;

type MergeEntityAsType<AsA, AsB> =
  [AsA] extends [void]
    ? AsB
    : [AsB] extends [void]
      ? AsA
      : Simplify<AsA & AsB>;

type MergeEntityDefs<A, B> =
  A extends EntityDef<infer AttrsA, any, infer AsA>
    ? B extends EntityDef<infer AttrsB, any, infer AsB>
      ? [DuplicateEntityAttrKeys<AttrsA, AttrsB>] extends [never]
        ? EntityDef<Simplify<AttrsA & AttrsB>, {}, MergeEntityAsType<AsA, AsB>>
        : never
      : StripEntityLinksValue<B>
    : StripEntityLinksValue<B>;

// Merge entities from multiple sources (flatten + strip nested links)
type MergeEntities<A extends EntitiesDef, B extends EntitiesDef> = Simplify<{
  [K in keyof A | keyof B]: K extends keyof A
    ? K extends keyof B
      ? MergeEntityDefs<StripEntityLinks<A>[K], StripEntityLinks<B>[K]>
      : StripEntityLinks<A>[K]
    : K extends keyof B
      ? StripEntityLinks<B>[K]
      : never;
}>;

// Merge links while preserving literal keys from both sides
type MergeLinks<A extends LinksDef<any>, B extends LinksDef<any>> = Simplify<{
  [K in keyof A | keyof B]: K extends keyof A
    ? A[K]
    : K extends keyof B
      ? B[K]
      : never;
}>;

type DomainSchemaSource =
  | DomainInstance<any, any, any>
  | AnyDomainSchemaResult
  | InstantSchemaDef<any, any, any>;

type EntitiesOfDomainSource<D> =
  D extends { readonly originalEntities: infer E }
    ? E extends EntitiesDef
      ? E
      : {}
    : D extends DomainInstance<infer E, any, any>
      ? E
      : D extends InstantSchemaDef<infer E, any, any>
        ? E
        : {};

type LinksOfDomainSource<D> =
  D extends { readonly [DOMAIN_LINKS_TYPE]?: infer L }
    ? NonNullable<L> extends LinksDef<any>
      ? NonNullable<L>
      : {}
    : D extends { links: infer L }
      ? L extends LinksDef<any>
        ? L
        : {}
    : {};

// Permissive links type that preserves literal keys but doesn't validate entity references
// This allows links to reference entities that will be available after includes ($users, cross-domain entities)
type PermissiveLinksDef = Record<string, {
  forward: { on: string; has: "one" | "many"; label: string };
  reverse: { on: string; has: "one" | "many"; label: string };
}>;

// Simple type to represent entity names for basic validation
type EntityNames<T> = T extends Record<string, any> ? keyof T : never;

// Result of domain.withSchema().
//
// DomainSchemaResult is intentionally the Ekairos domain object, not the
// InstantDB schema object. Use DomainInstantSchema<typeof domain> or
// domain.instantSchema() when an InstantDB schema type/value is needed.
export type DomainSchemaResult<
  E extends EntitiesDef = EntitiesDef,
  L extends LinksDef<any> = LinksDef<any>,
  R extends RoomsDef = RoomsDef,
  Actions extends DomainActionMap = {},
  Name extends string = string,
  IncludedNames extends string = Name,
  Events extends DomainEventMap = {},
> = {
    <Env = unknown>(
      runtime: RuntimeCallableForDomain<
        DomainSchemaResult<E, L, R, Actions, Name, IncludedNames, Events>
      >,
      options?: unknown,
    ): Promise<CallableDomainScope<E, L, R, Actions, Events, Env>>;
    readonly entities: E;
    readonly links: L;
    readonly rooms: R;
    // Add originalEntities property for type-safe access to original entity definitions
    // This preserves type safety while InstaQLParams uses enriched entities for validation
    readonly originalEntities: E;
    readonly [DOMAIN_NAME_TYPE]?: Name;
    readonly [DOMAIN_INCLUDED_NAMES_TYPE]?: IncludedNames;
    readonly [DOMAIN_ACTION_MAP_TYPE]?: Actions;
    readonly [DOMAIN_EVENT_MAP_TYPE]?: Events;
    readonly [DOMAIN_LINKS_TYPE]?: L;
    // Build the complete Instant schema for provisioning/admin usage.
    instantSchema: () => ReturnType<typeof i.schema<WithBase<E>, L, R>>;
    /**
     * @deprecated Use instantSchema().
     */
    toInstantSchema: () => ReturnType<typeof i.schema<WithBase<E>, L, R>>;
    // Return this domain as a materialized type, flattening composition history.
    definition: () => DomainSchemaResult<E, L, R, Actions, Name, IncludedNames, Events>;
    // Build full domain context (schema + registry + docs) for AI/system prompts.
    context: (options?: DomainContextOptions) => DomainContext;
    // Render a prompt-friendly context string for AI system prompts.
    contextString: (options?: DomainContextOptions) => string;
    // Bind a concrete database to this domain for runtime usage.
    fromDB: <DB = any>(
      db: DB,
      bindings?: { env?: unknown; runtime?: unknown },
    ) => ConcreteDomainFor<E, L, R, Actions, Events, Name, IncludedNames, DB>;
    // Optional metadata for this domain.
    meta?: Record<string, unknown>;
    // Raw domain action definitions declared for this domain result.
    readonly actions: Readonly<Actions>;
    // Pure constructors for immutable event drafts.
    readonly events: DomainEventMethods<Events>;
    // Attach explicit domain actions to this domain result.
    withActions: {
      <Input extends Record<string, DomainActionLike>>(
        actions: Input,
      ): DomainSchemaResult<
        E,
        L,
        R,
        MergeActionMaps<
          Actions,
          ActionMapFromCollection<
            Input,
            DomainSchemaResult<E, L, R, DomainActionMap, Name, IncludedNames, Events>
          >
        >,
        Name,
        IncludedNames,
        Events
      >;
    };
    // Retrieve actions explicitly attached to this domain result.
    getActions: () => DomainActionRegistration[];
    getActionMap: () => Actions;
    withEvents: {
      <Input extends Record<string, DomainEventDefinition<any, any> | DomainEventRegistration<any, any, any>>>(
        events: Input,
      ): DomainSchemaResult<
        E,
        MergeGeneratedEventLinks<L, Name, MergeEventMaps<
          Events,
          EventMapFromCollection<
            Input,
            DomainSchemaResult<E, L, R, Actions, Name, IncludedNames, DomainEventMap>
          >
        >>,
        R,
        Actions,
        Name,
        IncludedNames,
        MergeEventMaps<
          Events,
          EventMapFromCollection<
            Input,
            DomainSchemaResult<E, L, R, Actions, Name, IncludedNames, DomainEventMap>
          >
        >
      >;
    };
    getEventMap: () => Events;
  };

export type ConcreteDomain<
  D extends AnyMaterializedDomain = AnyMaterializedDomain,
  DB = any,
> = {
  domain: D;
  db: DB;
  schema: ReturnType<D["instantSchema"]>;
  context: (options?: DomainContextOptions) => DomainContext;
  contextString: (options?: DomainContextOptions) => string;
};

export type ActiveDomain<
  D extends AnyMaterializedDomain = AnyMaterializedDomain,
  Env = unknown,
  Bound extends boolean = true,
> = ConcreteDomain<D, DomainDbFor<D>> & (Bound extends true
  ? {
      env: Env;
      actions: DomainActionMethods<ActionMapOf<D>>;
      events: DomainEventMethods<EventMapOf<D>>;
    }
  : {});

export type DomainRuntimeDb = {
  query: (...args: any[]) => Promise<any>;
  transact: (...args: any[]) => Promise<any>;
  tx: any;
};

export type DomainRuntime<
  D extends AnyMaterializedDomain = AnyMaterializedDomain,
  Env = unknown,
> = D extends DomainSchemaResult<infer E, infer L, infer R, infer Actions, any, any, infer Events>
  ? {
      domain: D;
      db: DomainRuntimeDb;
      schema: ReturnType<typeof i.schema<WithBase<E>, L, R>>;
      context: (options?: DomainContextOptions) => DomainContext;
      contextString: (options?: DomainContextOptions) => string;
      env: Env;
      actions: DomainActionMethods<Actions>;
      events: DomainEventMethods<Events>;
    }
  : ActiveDomain<D, Env>;

// Base entities phantom (type-only) so links can reference $users and $files
type AnyEntityDef = EntitiesDef[string];
// Phantom base entities so links can legally reference $users / $files at type-level
type BaseEntitiesPhantom = {
  $users: EntityDef<any, any, any>;
  $files: EntityDef<any, any, any>;
  $streams: EntityDef<any, any, any>;
};
type WithBase<E extends EntitiesDef> = MergeEntities<E, BaseEntitiesPhantom>;

// Note: createInstantSchema is now deprecated.
// Use domain.instantSchema() directly instead:
// const schema = domain.instantSchema();

// Builder that automatically includes base entities and enforces type-safe links
// AccumL preserves literal link keys from included domains
export type DomainBuilder<
  AccumE extends EntitiesDef,
  AccumL extends LinksDef<any> = LinksDef<any>,
  Name extends string = string,
  IncludedNames extends string = Name,
> = {
  // Include other domains (instances or schema results). Links are merged and literal keys preserved.
  includes<const OtherDomain extends DomainSchemaSource>(
    other:
      | OtherDomain
      | (() => OtherDomain)
      | undefined
  ): DomainBuilder<
    MergeEntities<AccumE, EntitiesOfDomainSource<OtherDomain>>,
    MergeLinks<AccumL, LinksOfDomainSource<OtherDomain>>,
    Name,
    IncludedNames | IncludedDomainNamesOf<OtherDomain>
  >;

  // Define local entities and links
  // LL validates against merged entities (includes + local + base entities)
  // This ensures type safety: links can only reference entities that are available
  // Base entities ($users, $files) are included via WithBase, and included domains via AccumE
  withSchema<LE extends EntitiesDef, const LL extends LinksDef<any>>(def: {
    entities: LE;
    links: LL;
    rooms: RoomsDef;
  }): DomainSchemaResult<MergeEntities<AccumE, LE>, MergeLinks<AccumL, LL>, RoomsDef, {}, Name, IncludedNames>;

  /**
   * @deprecated Use withSchema().
   */
  schema<LE extends EntitiesDef, const LL extends LinksDef<any>>(def: {
    entities: LE;
    links: LL;
    rooms: RoomsDef;
  }): DomainSchemaResult<MergeEntities<AccumE, LE>, MergeLinks<AccumL, LL>, RoomsDef, {}, Name, IncludedNames>;
};

function getMeta(source: unknown): DomainMeta | null {
  if (!isObjectLike(source)) return null;
  return (source as any)[EKAIROS_META] ?? null;
}

function getActionBinding(source: unknown) {
  return getDomainActionBindingView(source);
}

function requireDomainName(source: unknown): string {
  const name = String(getMeta(source)?.name ?? "").trim();
  if (!name) throw new Error("domain_action_owner_required");
  return name;
}

function bindAction(
  action: DomainActionLike,
  params: { domain: unknown; key: string },
): DomainActionRegistration {
  if (isDomainActionRegistration(action)) {
    return action as DomainActionRegistration;
  }
  if (!isDomainActionDefinition(action) || !isObjectLike(params.domain)) {
    throw new Error(`Invalid domain action definition: ${params.key}`);
  }
  return registerDomainAction(action as any, {
    ownerDomain: requireDomainName(params.domain),
    key: params.key,
    ownerDomainObject: params.domain,
  }) as DomainActionRegistration;
}

export function scopeAction<
  Action extends DomainActionRegistration<any, any, any, any, any, any, any>,
  const Bound extends Partial<ActionInputOf<Action>>,
>(
  action: Action,
  boundInput: Bound,
): Action extends DomainActionRegistration<
  any,
  infer OutputSchema,
  infer Runtime,
  infer OwnerDomain,
  infer Key,
  infer OwnerDomainName,
  infer FullInputSchema
>
  ? DomainActionRegistration<
      z.ZodType<ScopedDomainActionInput<Action, Bound>>,
      OutputSchema,
      Runtime,
      OwnerDomain,
      Key,
      OwnerDomainName,
      FullInputSchema
    >
  : never {
  return scopeDomainActionRegistration(action, boundInput) as any;
}

function getStoredActions(source: unknown): DomainActionRegistration[] {
  if (!isObjectLike(source)) return [];
  const raw = (source as any)[EKAIROS_ACTIONS];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isDomainActionRegistration) as DomainActionRegistration[];
}

function getStoredActionMap(source: unknown): DomainActionMap {
  if (!isObjectLike(source)) return {};
  const raw = (source as any)[EKAIROS_ACTION_MAP];
  if (!raw || typeof raw !== "object") return {};
  return raw as DomainActionMap;
}

function getStoredEventMap(source: unknown): DomainEventMap {
  if (!isObjectLike(source)) return {};
  const raw = (source as any)[EKAIROS_EVENT_MAP];
  if (!raw || typeof raw !== "object") return {};
  return raw as DomainEventMap;
}

function setStoredActions(source: unknown, actions: DomainActionRegistration[]) {
  if (!isObjectLike(source)) return;
  const frozenActions = Object.freeze([...actions]) as unknown as DomainActionRegistration[];
  Object.defineProperty(source, EKAIROS_ACTIONS, {
    value: frozenActions,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  setDomainActionMembership(source, frozenActions);
}

function setStoredActionMap(source: unknown, actionMap: DomainActionMap) {
  if (!isObjectLike(source)) return;
  Object.defineProperty(source, EKAIROS_ACTION_MAP, {
    value: Object.freeze({ ...actionMap }),
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function setStoredEventMap(source: unknown, eventMap: DomainEventMap) {
  if (!isObjectLike(source)) return;
  Object.defineProperty(source, EKAIROS_EVENT_MAP, {
    value: Object.freeze({ ...eventMap }),
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function normalizeActionLike(
  value: DomainActionLike,
  params: { domain: unknown; key: string },
): DomainActionRegistration {
  return bindAction(value, params);
}

function normalizeActionCollection(
  source: unknown,
  input: DomainActionCollection,
): { actions: DomainActionRegistration[]; actionMap: DomainActionMap } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid domain action collection");
  }
  const current = getStoredActions(source);
  const currentActionMap = getStoredActionMap(source);
  const byId = new Set(current.map((action) => action.id));
  const byKey = new Set(Object.keys(currentActionMap));
  const normalized: DomainActionRegistration[] = [];
  const actionMap: DomainActionMap = {};

  const push = (candidate: DomainActionRegistration, key?: string) => {
    if (byId.has(candidate.id)) {
      throw new Error(`Duplicate domain action id: ${candidate.id}`);
    }
    const localKey = String(key ?? "").trim();
    if (localKey) {
      if (byKey.has(localKey)) {
        throw new Error(`Duplicate domain action key: ${localKey}`);
      }
      byKey.add(localKey);
      actionMap[localKey] = candidate;
    }
    byId.add(candidate.id);
    normalized.push(candidate);
  };

  for (const [key, value] of Object.entries(input ?? {})) {
    const normalizedEntry = normalizeActionLike(value as DomainActionLike, {
      domain: source,
      key,
    });
    push(normalizedEntry, key);
  }
  return { actions: normalized, actionMap };
}

function normalizeEventLike(
  value: DomainEventDefinition<any, any> | DomainEventRegistration<any, any, any>,
  params: { fallbackName: string; domain: unknown; domainName?: string },
): DomainEventRegistration {
  if (!value || typeof value !== "object" || !value.payload) {
    throw new Error(`Invalid domain event definition: ${params.fallbackName}`);
  }

  const explicitName = typeof (value as any).name === "string" ? String((value as any).name).trim() : "";
  const name = explicitName || params.fallbackName;
  if (!name) {
    throw new Error(`Domain event is missing a name: ${params.fallbackName}`);
  }

  const kind = typeof (value as DomainEventRegistration).kind === "string" &&
    (value as DomainEventRegistration).kind.trim()
    ? (value as DomainEventRegistration).kind.trim()
    : params.domainName
      ? `${params.domainName}.${name}`
      : name;
  const domainName = params.domainName?.trim() ?? "";
  if (!domainName) {
    throw new Error(`Invalid domain event domain=${domainName || "<missing>"} event=${name}`);
  }
  const links = freezeDomainEventLinks(value.links);

  return Object.freeze({
    ...value,
    links,
    name,
    kind,
    domain: domainName,
    ownerDomain: params.domain,
  }) as DomainEventRegistration;
}

function normalizeEventCollection(
  source: unknown,
  input: DomainEventCollection,
): { eventMap: DomainEventMap } {
  const currentMap = getStoredEventMap(source);
  const byKey = new Set(Object.keys(currentMap));
  const eventMap: DomainEventMap = {};
  const domainName = getMeta(source)?.name;

  const push = (candidate: DomainEventRegistration, key?: string) => {
    const localKey = String(key ?? candidate.name ?? "").trim();
    if (!localKey) {
      throw new Error(`Domain event is missing a key: ${candidate.name}`);
    }
    if (byKey.has(localKey)) {
      throw new Error(`Duplicate domain event key: ${localKey}`);
    }
    byKey.add(localKey);
    eventMap[localKey] = candidate;
  };

  for (const [key, value] of Object.entries(input ?? {})) {
    const normalizedEntry = normalizeEventLike(value, {
      fallbackName: key,
      domain: source,
      domainName,
    });
    push(normalizedEntry, key);
  }

  return { eventMap };
}

function normalizeEventDomainName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) throw new Error(`Invalid domain event domain=${name || "<missing>"}`);
  return normalized;
}

function eventError(params: {
  domain: string;
  event: string;
  alias: string;
  target: string;
  has: unknown;
  message: string;
}) {
  return new Error(
    `${params.message}: domain=${params.domain} event=${params.event} alias=${params.alias} target=${params.target} cardinality=${String(params.has)}`,
  );
}

function compileEventLinks(
  eventMap: DomainEventMap,
  explicitLinks: LinksDef<any>,
): { links: PermissiveLinksDef; physicalByEvent: Record<string, Record<string, DomainEventPhysicalLink>> } {
  const generated: PermissiveLinksDef = {};
  const physicalByEvent: Record<string, Record<string, DomainEventPhysicalLink>> = {};
  const aliases = new Map<string, { on: string; has: "one" | "many"; event: string }>();
  const endpointOwners = new Map<string, string>();
  for (const [key, linkValue] of Object.entries(explicitLinks)) {
    const link = linkValue as any;
    endpointOwners.set(`${link.forward.on}->${link.forward.label}`, key);
    endpointOwners.set(`${link.reverse.on}->${link.reverse.label}`, key);
  }

  for (const [eventKey, event] of Object.entries(eventMap)) {
    const normalizedDomain = normalizeEventDomainName(event.domain);
    physicalByEvent[eventKey] = {};
    for (const [alias, rawValue] of Object.entries(event.links ?? {})) {
      const raw = rawValue as DomainEventLinkDefinition;
      const target = typeof raw?.on === "string" ? raw.on.trim() : "";
      const has = raw?.has;
      const details = { domain: event.domain, event: event.name, alias, target, has };
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias)) {
        throw eventError({ ...details, message: "Invalid domain event link alias" });
      }
      if (!target) throw eventError({ ...details, message: "Invalid domain event link target" });
      if (has !== "one" && has !== "many") {
        throw eventError({ ...details, message: "Invalid domain event link cardinality" });
      }
      const prior = aliases.get(alias);
      if (prior && (prior.on !== target || prior.has !== has)) {
        throw eventError({ ...details, message: `Conflicting domain event link alias (first event=${prior.event} target=${prior.on} cardinality=${prior.has})` });
      }
      aliases.set(alias, { on: target, has, event: event.name });

      const key = `event__${normalizedDomain}__${alias}`;
      const forwardLabel = `${normalizedDomain}_${alias}`;
      const reverseLabel = `${normalizedDomain}_events_as_${alias}`;
      const physical = Object.freeze({ alias, key, target, has, forwardLabel, reverseLabel });
      if (generated[key]) {
        physicalByEvent[eventKey][alias] = physical;
        continue;
      }
      const endpoints = [`context_events->${forwardLabel}`, `${target}->${reverseLabel}`];
      const collision = explicitLinks[key] ? key : endpoints.find((endpoint) => endpointOwners.has(endpoint));
      if (collision) throw eventError({ ...details, message: `Domain event generated link collision key=${key} collision=${collision}` });

      const link = {
        forward: { on: "context_events", has, label: forwardLabel },
        reverse: { on: target, has: "many" as const, label: reverseLabel },
      };
      generated[key] = link;
      endpointOwners.set(endpoints[0], key);
      endpointOwners.set(endpoints[1], key);
      physicalByEvent[eventKey][alias] = physical;
    }
    physicalByEvent[eventKey] = Object.freeze(physicalByEvent[eventKey]);
  }
  return { links: generated, physicalByEvent };
}

function assertEventLinkTargets(eventMap: DomainEventMap, entities: EntitiesDef) {
  for (const event of Object.values(eventMap)) {
    for (const [alias, linkValue] of Object.entries(event.links ?? {})) {
      const link = linkValue as DomainEventLinkDefinition;
      if (!("context_events" in entities)) {
        throw eventError({
          domain: event.domain, event: event.name, alias, target: "context_events", has: link.has,
          message: "Missing domain event source entity",
        });
      }
      if (!(link.on in entities)) {
        throw eventError({
          domain: event.domain,
          event: event.name,
          alias,
          target: link.on,
          has: link.has,
          message: "Missing domain event link target entity",
        });
      }
    }
  }
}

function attachMeta(target: object, meta: DomainMeta) {
  Object.defineProperty(target, EKAIROS_META, {
    value: meta,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function freezeMeta(meta: DomainMeta): DomainMeta {
  const frozenIncludes = Object.freeze([...(meta.includes ?? [])]) as unknown as DomainIncludeRef[];
  return Object.freeze({
    ...meta,
    includes: frozenIncludes,
  }) as DomainMeta;
}

function appendMetaInclude(meta: DomainMeta, include: DomainIncludeRef): DomainMeta {
  return {
    ...meta,
    includes: [...(meta.includes ?? []), include],
  };
}

function cloneRoomsDef<R extends RoomsDef>(rooms: R): R {
  return { ...(rooms as Record<string, unknown>) } as R;
}

function cloneLinksDef<L extends LinksDef<any>>(links: L): L {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((links ?? {}) as Record<string, any>)) {
    out[key] = {
      ...(value ?? {}),
      forward: { ...(value?.forward ?? {}) },
      reverse: { ...(value?.reverse ?? {}) },
    };
  }
  return out as L;
}

function assertNoDuplicateLinkAttributes(links: LinksDef<any>) {
  const ownership = new Map<string, string>();
  const duplicates: Array<{ attribute: string; first: string; second: string }> = [];

  for (const [linkKey, linkValue] of Object.entries((links ?? {}) as Record<string, any>)) {
    const forward = linkValue?.forward;
    if (forward?.on && forward?.label) {
      const attribute = `${String(forward.on)}->${String(forward.label)}`;
      const first = ownership.get(attribute);
      if (first && first !== linkKey) {
        duplicates.push({ attribute, first, second: linkKey });
      } else {
        ownership.set(attribute, linkKey);
      }
    }

    const reverse = linkValue?.reverse;
    if (reverse?.on && reverse?.label) {
      const attribute = `${String(reverse.on)}->${String(reverse.label)}`;
      const first = ownership.get(attribute);
      if (first && first !== linkKey) {
        duplicates.push({ attribute, first, second: linkKey });
      } else {
        ownership.set(attribute, linkKey);
      }
    }
  }

  if (duplicates.length === 0) return;

  const detail = duplicates
    .map((entry) => `${entry.attribute} (${entry.first} vs ${entry.second})`)
    .join(", ");
  throw new Error(`duplicate_link_attribute:${detail}`);
}

function listKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value as object).filter((key) => !key.startsWith("$"));
}

function isObjectLike(value: unknown): value is object {
  return !!value && (typeof value === "object" || typeof value === "function");
}

function isMaterializedDomainSource(value: unknown): boolean {
  if (!isObjectLike(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.instantSchema === "function" ||
    typeof source.toInstantSchema === "function" ||
    ("entities" in source && "links" in source && "rooms" in source)
  );
}

function resolveSchema(source: any): any {
  if (!source) return null;
  if (typeof source.instantSchema === "function") return source.instantSchema();
  if (typeof source.toInstantSchema === "function") return source.toInstantSchema();
  if (typeof source.schema === "function") return source.schema();
  return {
    entities: source.entities ?? {},
    links: source.links ?? {},
    rooms: source.rooms ?? {},
  };
}

function collectSchemaKeys(schema: any): { entities: string[]; links: string[]; rooms: string[] } {
  return {
    entities: Object.keys(schema?.entities ?? {}),
    links: Object.keys(schema?.links ?? {}),
    rooms: Object.keys(schema?.rooms ?? {}),
  };
}

function assertSchemaIncludes(fullSchema: any, requiredSchema: any) {
  if (!fullSchema || !requiredSchema) return;
  const full = collectSchemaKeys(fullSchema);
  const required = collectSchemaKeys(requiredSchema);
  const missingEntities = required.entities.filter((k) => !full.entities.includes(k));
  const missingLinks = required.links.filter((k) => !full.links.includes(k));
  const missingRooms = required.rooms.filter((k) => !full.rooms.includes(k));
  if (missingEntities.length || missingLinks.length || missingRooms.length) {
    const parts: string[] = [];
    if (missingEntities.length) parts.push(`entities: ${missingEntities.join(", ")}`);
    if (missingLinks.length) parts.push(`links: ${missingLinks.join(", ")}`);
    if (missingRooms.length) parts.push(`rooms: ${missingRooms.join(", ")}`);
    throw new Error(`ConcreteDomain: schema is missing required keys (${parts.join(" | ")})`);
  }
}

function collectTransitiveDomainNames(source: unknown, seen = new Set<unknown>()): Set<string> {
  const names = new Set<string>();
  if (!isObjectLike(source)) return names;
  if (seen.has(source)) return names;
  seen.add(source);

  const meta = getMeta(source);
  if (!meta) return names;
  if (meta.name) names.add(meta.name);

  for (const getter of meta.includes ?? []) {
    if (!getter) continue;
    let child: unknown = null;
    try {
      child = getter();
    } catch {
      child = null;
    }
    for (const name of collectTransitiveDomainNames(child, seen)) {
      names.add(name);
    }
  }

  return names;
}

function assertDomainNamesInclude(rootDomain: unknown, requiredDomain: unknown) {
  const rootMeta = getMeta(rootDomain);
  const requiredMeta = getMeta(requiredDomain);
  if (!rootMeta || !requiredMeta) return;

  const rootNames = collectTransitiveDomainNames(rootDomain);
  const requiredNames = collectTransitiveDomainNames(requiredDomain);
  if (rootNames.size === 0 || requiredNames.size === 0) return;

  const missing = Array.from(requiredNames).filter((name) => !rootNames.has(name));
  if (missing.length > 0) {
    throw new Error(`ConcreteDomain: domain is missing required names (${missing.join(", ")})`);
  }
}

function scopeDbToDomainSchema<DB>(db: DB, schema: unknown): DB {
  if (!isObjectLike(db) || !schema) return db;
  const candidate = db as any;
  const config = candidate.config;
  const DbConstructor = candidate.constructor;

  if (
    !config ||
    typeof config !== "object" ||
    typeof config.appId !== "string" ||
    typeof DbConstructor !== "function" ||
    typeof candidate.query !== "function" ||
    typeof candidate.transact !== "function"
  ) {
    return db;
  }

  try {
    const scoped = new DbConstructor({
      ...config,
      schema,
    });
    if ("impersonationOpts" in candidate) {
      scoped.impersonationOpts = candidate.impersonationOpts;
    }
    return scoped as DB;
  } catch {
    return db;
  }
}

function freezeEventValue<Value>(value: Value): Value {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeEventValue(child);
  return Object.freeze(value);
}

function freezeDomainEventLinks<Links extends Record<string, DomainEventLinkDefinition>>(
  links?: Links,
): Readonly<Links> {
  const frozenEntries = Object.entries(links ?? {}).map(([alias, link]) => [
    alias,
    Object.freeze({ on: link.on, has: link.has }),
  ] as const);
  return Object.freeze(Object.fromEntries(frozenEntries)) as Readonly<Links>;
}

function createDomainEventMethods(
  eventMap: DomainEventMap,
  physicalByEvent = compileEventLinks(eventMap, {}).physicalByEvent,
): DomainEventMethods<DomainEventMap> {
  return Object.fromEntries(
    Object.entries(eventMap).map(([key, event]) => {
      const physicalLinks = Object.freeze({ ...(physicalByEvent[key] ?? {}) });
      const definition = Object.freeze({
        payload: event.payload,
        links: event.links ?? Object.freeze({}),
        kind: event.kind,
        domain: event.domain,
        name: event.name,
        physicalLinks,
      }) as DomainEventConstructorDefinition;
      const method = (payload: unknown): DomainEventDraft => {
        const parsedPayload = freezeEventValue(event.payload.parse(payload));
        const makeDraft = (logicalLinks: Record<string, string | readonly string[]>): DomainEventDraft => {
          const draft = {
            payload: parsedPayload,
            links: Object.freeze({ ...logicalLinks }),
            kind: event.kind,
            domain: event.domain,
            name: event.name,
            physicalLinks,
            definition,
            link(params: Record<string, unknown>) {
              const next = { ...logicalLinks };
              for (const [alias, value] of Object.entries(params ?? {})) {
                const definition = event.links?.[alias];
                if (!definition) throw eventError({ domain: event.domain, event: event.name, alias, target: "<unknown>", has: "<unknown>", message: "Unknown domain event link" });
                const valid = definition.has === "one"
                  ? typeof value === "string"
                  : typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"));
                if (!valid) throw eventError({ domain: event.domain, event: event.name, alias, target: definition.on, has: definition.has, message: "Invalid domain event link value" });
                next[alias] = Array.isArray(value) ? Object.freeze([...value]) : value as string;
              }
              return makeDraft(next);
            },
          };
          return Object.freeze(draft) as DomainEventDraft;
        };
        return makeDraft({});
      };
      Object.defineProperties(method, {
        payload: { value: definition.payload, enumerable: true },
        links: { value: definition.links, enumerable: true },
        kind: { value: definition.kind, enumerable: true },
        domain: { value: definition.domain, enumerable: true },
        name: { value: definition.name, enumerable: true, configurable: true },
        physicalLinks: { value: definition.physicalLinks, enumerable: true },
        definition: { value: definition, enumerable: true },
      });
      return [key, Object.freeze(method)];
    }),
  ) as DomainEventMethods<DomainEventMap>;
}

function createConcreteDomain<D extends AnyMaterializedDomain, DB>(
  domainInstance: D,
  db: DB,
  fullSchema?: any,
  bindings?: { env?: unknown; runtime?: unknown },
): ConcreteDomain<D, DB> {
  const baseSchema = fullSchema ?? resolveSchema(domainInstance);
  const domainSchema = resolveSchema(domainInstance);
  const scopedDb = scopeDbToDomainSchema(db, domainSchema);
  const actionMap = getStoredActionMap(domainInstance);
  const eventMap = getStoredEventMap(domainInstance);
  const eventMethods = createDomainEventMethods(eventMap);
  const concrete: ConcreteDomain<D, DB> = {
    domain: domainInstance,
    db: scopedDb,
    schema: domainSchema,
    context: (options?: DomainContextOptions) => domainInstance.context(options),
    contextString: (options?: DomainContextOptions) => domainInstance.contextString(options),
  };
  if (bindings?.runtime !== undefined) {
    const inheritedStack: string[] = [];

    const createActionRuntime = (stack: string[]): any => {
      const runtime = {
        ...concrete,
        ...(bindings.env !== undefined ? { env: bindings.env } : {}),
      } as any;
      runtime.actions = buildActions(stack);
      runtime.events = eventMethods;
      return runtime;
    };

    const createActionMethod = (
      key: string,
      action: DomainActionRegistration<any, any, any, any>,
      stack: string[],
    ) => {
      const method = async (input: unknown) => {
        const binding = getActionBinding(action);
        const execution = await executeDomainActionPrivate(
          bindings.runtime,
          action,
          input,
          {
            stack,
            ...(binding?.ownerDomainObject === domainInstance
              ? { activeDomain: concrete }
              : {}),
          },
        );
        return execution.output;
      };

      Object.defineProperty(method, "scope", {
        value: (boundInput: Record<string, unknown>) =>
          createActionMethod(key, scopeAction(action, boundInput), stack),
        enumerable: false,
        configurable: true,
        writable: false,
      });

      return method;
    };

    const buildActions = (stack: string[]) =>
      Object.fromEntries(
        Object.entries(actionMap).map(([key, action]) => [
          key,
          createActionMethod(
            key,
            action as DomainActionRegistration<any, any, any, any>,
            stack,
          ),
        ]),
      );

    if (bindings.env !== undefined) {
      ;(concrete as any).env = bindings.env;
    }
    ;(concrete as any).actions = buildActions(inheritedStack);
    ;(concrete as any).events = eventMethods;
    setActiveDomainActionScopeFactory(concrete as object, (stack) =>
      createActionRuntime([...stack]),
    );
  }
  return concrete;
}

function promoteRuntimeDomainScope(scoped: any): any {
  const promoted = { ...scoped } as Record<string, unknown>;
  const db = scoped?.db;

  if (db && typeof db.query === "function") {
    promoted.query = db.query.bind(db);
  }

  const actions = scoped?.actions;
  if (actions && typeof actions === "object") {
    for (const [key, action] of Object.entries(actions)) {
      if (key in promoted) continue;
      promoted[key] = action;
    }
  }

  return promoted;
}

async function callDomainRuntimeScope<D extends AnyMaterializedDomain>(
  domainInstance: D,
  runtime: RuntimeCallableForDomain<D>,
  options?: unknown,
): Promise<any> {
  if (!runtime || typeof runtime.use !== "function") {
    throw new Error("domain(runtime) requires an Ekairos runtime with use(domain).");
  }
  return promoteRuntimeDomainScope(await runtime.use(domainInstance, options));
}

export function materializeDomain<
  SubD extends AnyMaterializedDomain,
  Env = unknown,
>(params: {
  rootDomain: DomainSchemaResult;
  subdomain: SubD;
  db: DomainDbFor<SubD>;
  bindings?: { env?: Env; runtime?: unknown };
}): ActiveDomain<SubD, Env> {
  const baseSchema = resolveSchema(params.rootDomain);
  const requiredSchema = resolveSchema(params.subdomain);
  assertDomainNamesInclude(params.rootDomain, params.subdomain);
  assertSchemaIncludes(baseSchema, requiredSchema);
  return createConcreteDomain(
    params.subdomain,
    params.db,
    baseSchema,
    params.bindings,
  ) as ActiveDomain<SubD, Env>;
}

function loadDomainDoc(scope: "root" | "subdomain", meta: DomainMeta | null): DomainDocInfo | null {
  if (!domainDocLoader) return null;
  try {
    return domainDocLoader({ scope, meta }) ?? null;
  } catch {
    return null;
  }
}

function normalizeDoc(
  docInfo: DomainDocInfo | null,
  options: DomainDocNormalizeOptions
): { doc: string | null; docPath?: string } {
  if (!docInfo?.doc) return { doc: null, docPath: docInfo?.docPath };
  if (domainDocNormalizer) {
    try {
      const normalized = domainDocNormalizer({ docInfo, options });
      if (normalized) return normalized;
    } catch {
      // Fall through to raw docs. Domain context must remain usable without the
      // optional markdown/YAML parser in workflow bundles.
    }
  }
  return { doc: docInfo.doc, docPath: docInfo.docPath };
}

function buildRegistryEntries(
  meta: DomainMeta | null,
  options?: DomainContextOptions
): DomainContextEntry[] {
  if (!meta) return [];
  const seen = new Set<unknown>();
  const queue = [...meta.includes];
  const entries: DomainContextEntry[] = [];

  while (queue.length > 0) {
    const getter = queue.shift();
    if (!getter) continue;
    let child: any = null;
    try {
      child = getter();
    } catch {
      child = null;
    }
    if (!isObjectLike(child)) continue;
    if (seen.has(child)) continue;
    seen.add(child);

    const childMeta = getMeta(child);
    const schema = resolveSchema(child);
    const docInfo = loadDomainDoc("subdomain", childMeta);
    const includeSchema = options?.includeSchemas !== false;
    const includeNames = resolveIncludeNames(childMeta);
    const normalizedDoc = normalizeDoc(docInfo, {
      entities: listKeys(schema?.entities),
      titlePrefix: "Subdomain",
      includeSubdomains: false,
    });

    if (childMeta?.name) {
      entries.push({
        name: childMeta.name,
        includes: includeNames,
        entities: listKeys(schema?.entities),
        links: listKeys(schema?.links),
        rooms: listKeys(schema?.rooms),
        schema: includeSchema ? schema : undefined,
        doc: normalizedDoc.doc ?? null,
        docPath: normalizedDoc.docPath,
      });
    }

    if (childMeta?.includes?.length) {
      queue.push(...childMeta.includes);
    }
  }

  return entries;
}

function buildContext(
  source: any,
  options?: DomainContextOptions
): DomainContext {
  const meta = getMeta(source);
  const schema = resolveSchema(source);
  const registry = buildRegistryEntries(meta, options);
  const docInfo = loadDomainDoc("root", meta);
  const includeSchema = options?.includeSchemas !== false;
  const includeNames = resolveIncludeNames(meta);
  const normalizedDoc = normalizeDoc(docInfo, {
    subdomains: registry.map((entry) => entry.name ?? "").filter(Boolean),
    titlePrefix: "Domain",
    includeSubdomains: false,
  });

  return {
    name: meta?.name,
    includes: includeNames,
    entities: listKeys(schema?.entities),
    links: listKeys(schema?.links),
    rooms: listKeys(schema?.rooms),
    meta: options?.meta ?? (source as any)?.meta,
    schema: includeSchema ? schema : undefined,
    doc: normalizedDoc.doc ?? null,
    docPath: normalizedDoc.docPath,
    registry,
  };
}

function contextToString(context: DomainContext): string {
  const lines: string[] = [];

  const pushSection = (title: string) => {
    lines.push("");
    lines.push(`# ${title}`);
  };

  lines.push("# Domain Context");
  if (context.name) lines.push(`Name: ${context.name}`);

  if (context.entities?.length) {
    lines.push(`Entities: ${context.entities.join(", ")}`);
  }
  if (context.links?.length) {
    lines.push(`Links: ${context.links.join(", ")}`);
  }
  if (context.rooms?.length) {
    lines.push(`Rooms: ${context.rooms.join(", ")}`);
  }
  if (context.includes?.length) {
    lines.push(`Includes: ${context.includes.join(", ")}`);
  }

  if (context.doc) {
    pushSection("DOMAIN.md (root)");
    lines.push(context.doc);
  }

  if (context.registry?.length) {
    pushSection("Subdomains");
    for (const entry of context.registry) {
      lines.push("");
      lines.push(`## ${entry.name ?? "unknown"}`);
      if (entry.includes?.length) {
        lines.push(`Includes: ${entry.includes.join(", ")}`);
      }
      if (entry.doc) {
        lines.push(entry.doc);
        continue;
      }
      if (entry.entities?.length) {
        lines.push(`Entities: ${entry.entities.join(", ")}`);
      }
      if (entry.links?.length) {
        lines.push(`Links: ${entry.links.join(", ")}`);
      }
      if (entry.rooms?.length) {
        lines.push(`Rooms: ${entry.rooms.join(", ")}`);
      }
    }
  }

  return lines.join("\n").trim() + "\n";
}

function resolveIncludeNames(meta: DomainMeta | null): string[] {
  if (!meta?.includes?.length) return [];
  const names = new Set<string>();
  for (const getter of meta.includes) {
    if (!getter) continue;
    let child: any = null;
    try {
      child = getter();
    } catch {
      child = null;
    }
    if (!isObjectLike(child)) continue;
    const childMeta = getMeta(child);
    if (childMeta?.name) names.add(childMeta.name);
  }
  return Array.from(names);
}

function isRuntimeEntityDef(value: unknown): value is { attrs: Record<string, any> } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "attrs" in value &&
      (value as { attrs?: unknown }).attrs &&
      typeof (value as { attrs?: unknown }).attrs === "object",
  );
}

function stripRuntimeEntityLinks(entity: unknown) {
  if (!isRuntimeEntityDef(entity)) return entity;
  return i.entity({ ...entity.attrs } as any);
}

function normalizeRuntimeAttrDef(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = normalizeRuntimeAttrDef(record[key]);
  }
  return sorted;
}

function stableRuntimeAttrDef(value: unknown): string {
  return JSON.stringify(normalizeRuntimeAttrDef(value));
}

function areRuntimeAttrDefsEquivalent(baseAttr: unknown, nextAttr: unknown) {
  if (baseAttr === nextAttr) return true;
  return stableRuntimeAttrDef(baseAttr) === stableRuntimeAttrDef(nextAttr);
}

function mergeRuntimeEntityDefs(entityName: string, baseEntity: unknown, nextEntity: unknown) {
  if (!isRuntimeEntityDef(baseEntity) || !isRuntimeEntityDef(nextEntity)) {
    return stripRuntimeEntityLinks(nextEntity);
  }

  const conflictingAttrs = Object.keys(nextEntity.attrs).filter((attr) =>
    Object.prototype.hasOwnProperty.call(baseEntity.attrs, attr) &&
    !areRuntimeAttrDefsEquivalent(baseEntity.attrs[attr], nextEntity.attrs[attr]),
  );
  if (conflictingAttrs.length > 0) {
    throw new Error(`domain_duplicate_entity_attr:${entityName}.${conflictingAttrs.join(",")}`);
  }

  return i.entity({
    ...baseEntity.attrs,
    ...nextEntity.attrs,
  } as any);
}

function mergeRuntimeEntities<A extends EntitiesDef, B extends EntitiesDef>(
  baseEntities: A,
  nextEntities: B,
): MergeEntities<A, B> {
  const merged: Record<string, unknown> = {};
  for (const [entityName, entity] of Object.entries(baseEntities)) {
    merged[entityName] = stripRuntimeEntityLinks(entity);
  }
  for (const [entityName, entity] of Object.entries(nextEntities)) {
    merged[entityName] =
      entityName in merged
        ? mergeRuntimeEntityDefs(entityName, merged[entityName], entity)
        : stripRuntimeEntityLinks(entity);
  }
  return merged as MergeEntities<A, B>;
}

function makeInstance<E extends EntitiesDef, L extends LinksDef<E>, R extends RoomsDef>(
  def: DomainDefinition<E, L, R>,
  metaIncludes: DomainIncludeRef[] = [],
): DomainInstance<E, L, R> {
  const meta: DomainMeta = {
    name: def.name,
    rootDir: def.rootDir,
    packageName: def.packageName,
    includes: [...metaIncludes],
  };

  let instance: DomainInstance<E, L, R>;

  function schema() {
    return i.schema({
      entities: def.entities as E,
      links: def.links as L,
      rooms: def.rooms as R,
    });
  }

  function compose<E2 extends EntitiesDef, L2 extends LinksDef<E2>, R2 extends RoomsDef>(
    other: DomainInstance<E2, L2, R2> | DomainDefinition<E2, L2, R2>
  ): DomainInstance<E & E2, LinksDef<E & E2>, R & R2> {
    const otherDef =
      "schema" in other
        ? { entities: other.entities, links: other.links, rooms: other.rooms }
        : other;

    const mergedEntities = mergeRuntimeEntities(def.entities, otherDef.entities) as E & E2;
    const mergedLinks = { ...(def.links as object), ...(otherDef.links as object) } as LinksDef<E & E2>;
    const mergedRooms = { ...def.rooms, ...otherDef.rooms } as R & R2;

    const composed = makeInstance({
      entities: mergedEntities,
      links: mergedLinks,
      rooms: mergedRooms,
      name: def.name,
      rootDir: def.rootDir,
      packageName: def.packageName,
    }, [() => instance, () => other]);
    return composed;
  }

  instance = {
    entities: def.entities,
    links: def.links,
    rooms: def.rooms,
    schema,
    compose,
  };
  attachMeta(instance, freezeMeta(meta));
  return instance;
}

// Overload 1: classic API: domain({ entities, links, rooms })
export function domain<E extends EntitiesDef, L extends LinksDef<E>, R extends RoomsDef>(
  def: DomainDefinition<E, L, R>
): DomainInstance<E, L, R>;

// Overload 2: builder API preserving the domain name literal.
export function domain<const Name extends string>(name: Name): DomainBuilder<{}, {}, Name, Name>;
export function domain<const Name extends string>(
  options: DomainConstructorOptions & { name: Name }
): DomainBuilder<{}, {}, Name, Name>;

// Overload 3: builder API fallback when the name has already been widened.
export function domain(name?: string | DomainConstructorOptions): DomainBuilder<{}, {}>;

// Impl
export function domain(arg?: unknown): any {
  // Default include: start with an empty entities object
  // Base entities ($users, $files) are added at toInstantSchema() time to ensure they're always available
  // This allows links to reference them even when they're not explicitly defined in domains
  const base = i.schema({ entities: {}, links: {}, rooms: {} });
  const baseEntities = { ...base.entities };

  if (arg === undefined || arg === null) {
    throw new Error("domain() requires a name");
  }

  if (typeof arg === "object" && arg !== null) {
    const maybeDef = arg as DomainDefinition<any, LinksDef<any>, any>;
    if ("entities" in maybeDef && "links" in maybeDef && "rooms" in maybeDef) {
      if (!maybeDef.name) {
        throw new Error("domain() requires a name");
      }
      // classic API path: def provided directly
      return makeInstance(maybeDef);
    }
    const opts = arg as DomainConstructorOptions;
    if (!opts.name) {
      throw new Error("domain() requires a name");
    }
    return createBuilder<{}, {}, string, string>(baseEntities, {} as any, [], {
      name: opts.name,
      rootDir: opts.rootDir,
      packageName: opts.packageName,
      includes: [],
    });
  }

  // builder API - runtime state tracks accumulated dependencies
  // Support lazy includes for circular dependencies by storing references and resolving at schema()/toInstantSchema() time
  // AL preserves literal link keys from included domains
  function createBuilder<
    AE extends EntitiesDef,
    AL extends LinksDef<any> = LinksDef<any>,
    Name extends string = string,
    IncludedNames extends string = Name,
  >(
    deps: AE,
    linkDeps: AL,
    lazyIncludes: Array<() => DomainInstance<any, any, any> | AnyDomainSchemaResult | InstantSchemaDef<any, any, any> | undefined> = [],
    meta: DomainMeta
  ): DomainBuilder<AE, AL, Name, IncludedNames> {
    const builder = {
      includes<const OtherDomain extends DomainSchemaSource>(other: OtherDomain | (() => OtherDomain) | undefined) {
        type E2 = EntitiesOfDomainSource<OtherDomain>;
        type L2 = LinksOfDomainSource<OtherDomain>;
        type NextIncludedNames = IncludedNames | IncludedDomainNamesOf<OtherDomain>;
        // Support lazy includes via function for circular dependencies
        if (typeof other === 'function' && !isMaterializedDomainSource(other)) {
          const lazyGetter = () => {
            try {
              return (other as () => unknown)();
            } catch (e) {
              return undefined;
            }
          };
          const nextMeta = appendMetaInclude(meta, lazyGetter as DomainIncludeRef);
          // Preserve link literal keys using MergeLinks
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>, Name, NextIncludedNames>(
            deps as MergeEntities<AE, E2>,
            linkDeps as MergeLinks<AL, L2>,
            [...lazyIncludes, lazyGetter as any],
            nextMeta
          );
        }
        
        // If other is undefined (circular dependency), store a lazy getter
        // Entities will be resolved from app domain composition at toInstantSchema() time
        if (!other || other === undefined) {
          // Create a lazy getter that returns undefined
          // Entities will be available from app domain's merged entities when toInstantSchema() is called
          const lazyGetter = () => undefined;
          const nextMeta = appendMetaInclude(meta, lazyGetter as DomainIncludeRef);
          // Preserve link literal keys
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>, Name, NextIncludedNames>(
            deps as MergeEntities<AE, E2>,
            linkDeps as MergeLinks<AL, L2>,
            [...lazyIncludes, lazyGetter],
            nextMeta
          );
        }
        
        // Try to get entities and links immediately
        try {
          const entities = (other as any).entities as E2 | undefined;
          if (!entities) {
            // If entities don't exist yet, store as lazy
            const lazyGetter = () => other;
            const nextMeta = appendMetaInclude(meta, lazyGetter as DomainIncludeRef);
            // Preserve link literal keys
            return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>, Name, NextIncludedNames>(
              deps as MergeEntities<AE, E2>,
              linkDeps as MergeLinks<AL, L2>,
              [...lazyIncludes, lazyGetter as any],
              nextMeta
            );
          }
          
          const links = (other as any).links as L2 | undefined;
          const mergedEntities = mergeRuntimeEntities(deps, entities) as MergeEntities<AE, E2>;
          // Preserve literal link keys by merging directly (not casting to LinksDef)
          const mergedLinks = (links ? { ...linkDeps, ...links } : { ...linkDeps }) as MergeLinks<AL, L2>;
          const includeRef = () => other as any;
          const nextMeta = appendMetaInclude(meta, includeRef);
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>, Name, NextIncludedNames>(mergedEntities, mergedLinks, lazyIncludes, nextMeta);
        } catch (e) {
          // If accessing entities throws, store as lazy
          const lazyGetter = () => other;
          const nextMeta = appendMetaInclude(meta, lazyGetter as DomainIncludeRef);
          // Preserve link literal keys
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>, Name, NextIncludedNames>(
            deps as MergeEntities<AE, E2>,
            linkDeps as MergeLinks<AL, L2>,
            [...lazyIncludes, lazyGetter as any],
            nextMeta
          );
        }
      },
      withSchema<LE extends EntitiesDef, const LL extends LinksDef<any>>(def: {
        entities: LE;
        links: LL;
        rooms: RoomsDef;
      }): DomainSchemaResult<MergeEntities<AE, LE>, MergeLinks<AL, LL>, RoomsDef, {}, Name, IncludedNames> {
        // Resolve lazy includes at schema() time (when all domains should be initialized)
        // This handles circular dependencies by deferring entity resolution
        let resolvedDeps: EntitiesDef = { ...deps };
        const pendingLazyIncludes: typeof lazyIncludes = [];
        // Preserve literal link keys from accumulated links
        let resolvedLinks: AL = { ...linkDeps } as AL;
        for (const lazyGetter of lazyIncludes) {
          try {
            const other = lazyGetter();
            if (other) {
              const entities = (other as any).entities as EntitiesDef;
              if (entities) {
                resolvedDeps = mergeRuntimeEntities(resolvedDeps, entities) as EntitiesDef;
              }
              const links = (other as any).links as LinksDef<any>;
              if (links) {
                // Merge links preserving literal keys
                resolvedLinks = { ...resolvedLinks, ...links } as AL;
              }
            } else {
              pendingLazyIncludes.push(lazyGetter);
            }
          } catch (e) {
            // If lazy resolution fails, continue - entities might be available via string references
            // This is expected for circular dependencies that will be resolved when all domains are composed
            pendingLazyIncludes.push(lazyGetter);
          }
        }
        
        // Runtime merge for output; compile-time validation handled by types above
        const allEntities = mergeRuntimeEntities(resolvedDeps as AE, def.entities) as MergeEntities<AE, LE>;
        // allLinks contains merged links from included domains + current domain
        // Preserve literal link keys (owner, related, parent, etc.) by using MergeLinks
        const allLinks = { ...resolvedLinks, ...def.links } as MergeLinks<AL, LL>;
        
        // Capture the literal type of merged links - this is critical for preserving literal link keys
        // MergeLinks<AL, LL> preserves literal keys from both included domains (AL) and local links (LL)
        // The 'const' modifier on LL parameter ensures literal keys are preserved
        type MergedLinksType = MergeLinks<AL, LL>;
        type MergedEntitiesType = MergeEntities<AE, LE>;
        
        const createDomainResult = <
          Actions extends DomainActionMap = {},
          Events extends DomainEventMap = {},
        >(
          seedActions: DomainActionRegistration[] = [],
          seedActionMap: Actions = {} as Actions,
          seedEventMap: Events = {} as Events,
          rebindOwnerFrom?: object,
        ): DomainSchemaResult<MergedEntitiesType, MergedLinksType, typeof def.rooms, Actions, Name, IncludedNames, Events> => {
          type InstantSchemaResult = ReturnType<
            DomainSchemaResult<MergedEntitiesType, MergedLinksType, typeof def.rooms, Actions, Name, IncludedNames, Events>["toInstantSchema"]
          >;
          const capturedEntities = { ...allEntities };
          const compiledEvents = compileEventLinks(seedEventMap, allLinks);
          const capturedLinks = cloneLinksDef({ ...allLinks, ...compiledEvents.links } as MergedLinksType);
          const capturedRooms = cloneRoomsDef(def.rooms);
          let cachedInstantSchema: InstantSchemaResult | null = null;

          const instantSchema = () => {
            if (cachedInstantSchema) {
              return cachedInstantSchema;
            }

            let finalEntities: EntitiesDef = { ...capturedEntities } as EntitiesDef;
            let finalLinks = cloneLinksDef(capturedLinks);
            let hasUnresolvedIncludes = false;

            // Try to resolve lazy includes one more time (domains should be initialized by now)
            for (const lazyGetter of pendingLazyIncludes) {
              try {
                const other = lazyGetter();
                if (other) {
                  const entities = (other as any).entities as EntitiesDef;
                  if (entities) {
                    finalEntities = mergeRuntimeEntities(finalEntities, entities) as EntitiesDef;
                  }
                  const links = (other as any).links as LinksDef<any>;
                  if (links) {
                    finalLinks = { ...finalLinks, ...links } as typeof finalLinks;
                  }
                } else {
                  hasUnresolvedIncludes = true;
                }
              } catch {
                // If still can't resolve, entities should already be in allEntities from app domain composition
                hasUnresolvedIncludes = true;
              }
            }

            assertNoDuplicateLinkAttributes(finalLinks as LinksDef<any>);

            // Include base entities ($users, $files, $streams) that InstantDB manages
            // These need to be explicitly included since InstantDB doesn't auto-add them
            const baseEntities = {
              $users: i.entity({
                email: i.string().optional().indexed(),
              }),
              $files: i.entity({
                path: i.string(),
                url: i.string().optional(),
                contentType: i.string().optional(),
                size: i.number().optional(),
              }),
              $streams: i.entity({
                clientId: i.string().optional().indexed(),
                size: i.number().optional(),
                createdAt: i.date().optional().indexed(),
                updatedAt: i.date().optional().indexed(),
              }),
            };

            // Merge base entities with user entities, user entities take precedence
            const allEntitiesWithBase = {
              ...baseEntities,
              ...finalEntities,
            } as WithBase<MergedEntitiesType>;

            assertEventLinkTargets(seedEventMap, allEntitiesWithBase);

            const schemaResult = i.schema({
              entities: allEntitiesWithBase,
              links: cloneLinksDef(finalLinks as MergedLinksType) as LinksDef<WithBase<MergedEntitiesType>>,
              rooms: cloneRoomsDef(capturedRooms),
            });

            const frozenSchema = Object.freeze(schemaResult) as InstantSchemaResult;
            if (!hasUnresolvedIncludes) {
              cachedInstantSchema = frozenSchema;
            }
            return frozenSchema;
          };

          let result: DomainSchemaResult<MergedEntitiesType, MergedLinksType, typeof def.rooms, Actions, Name, IncludedNames, Events>;
          const callableResult = (
            runtime: RuntimeCallableForDomain<
              DomainSchemaResult<MergedEntitiesType, MergedLinksType, typeof def.rooms, Actions, Name, IncludedNames, Events>
            >,
            options?: unknown,
          ) => callDomainRuntimeScope(result as any, runtime as any, options);
          result = Object.assign(
            callableResult,
            {
              entities: Object.freeze({ ...allEntities }) as MergedEntitiesType,
              // Strip base phantom from public type so it's assignable to i.schema()
              links: Object.freeze(cloneLinksDef(capturedLinks)) as MergedLinksType,
              rooms: Object.freeze(cloneRoomsDef(def.rooms)),
              // Add originalEntities for type-safe access to original entity definitions
              originalEntities: Object.freeze({ ...allEntities }) as MergedEntitiesType,
              instantSchema,
              toInstantSchema: instantSchema,
            },
          ) as unknown as DomainSchemaResult<MergedEntitiesType, MergedLinksType, typeof def.rooms, Actions, Name, IncludedNames, Events>;

          attachMeta(result as object, freezeMeta(meta));
          (result as any).context = (options?: DomainContextOptions) =>
            buildContext(result, options);
          (result as any).contextString = (options?: DomainContextOptions) =>
            contextToString(buildContext(result, options));
          (result as any).fromDB = <DB = any>(
            db: DB,
            bindings?: { env?: unknown; runtime?: unknown },
          ) => createConcreteDomain(result as any, db, resolveSchema(result), bindings);

          const reboundByAction = new Map<DomainActionRegistration, DomainActionRegistration>();
          const reboundActionMap = Object.fromEntries(
            Object.entries(seedActionMap).map(([key, action]) => {
              const binding = getActionBinding(action);
              const rebound = rebindOwnerFrom &&
                binding?.ownerDomainObject === rebindOwnerFrom
                ? rebindDomainActionOwner(action, result as object) as DomainActionRegistration
                : action;
              reboundByAction.set(action, rebound);
              return [key, rebound] as const;
            }),
          ) as Actions;
          const reboundActions = seedActions.map((action) => {
            const rebound = reboundByAction.get(action);
            if (rebound) return rebound;
            const binding = getActionBinding(action);
            return rebindOwnerFrom && binding?.ownerDomainObject === rebindOwnerFrom
              ? rebindDomainActionOwner(action, result as object) as DomainActionRegistration
              : action;
          });
          setStoredActions(result as any, [...reboundActions]);
          setStoredActionMap(result as any, reboundActionMap);
          setStoredEventMap(result as any, seedEventMap);
          (result as any).actions = getStoredActionMap(result as any);
          (result as any).events = createDomainEventMethods(getStoredEventMap(result as any), compiledEvents.physicalByEvent);
          (result as any).withActions = (actionsInput: DomainActionCollection) => {
            const current = getStoredActions(result as any);
            const currentMap = getStoredActionMap(result as any);
            const additions = normalizeActionCollection(result as any, actionsInput);
            return createDomainResult(
              [...current, ...additions.actions],
              { ...currentMap, ...additions.actionMap },
              getStoredEventMap(result as any),
              result as object,
            );
          };
          (result as any).getActions = () => [...getStoredActions(result as any)];
          (result as any).getActionMap = () => ({ ...getStoredActionMap(result as any) });
          (result as any).withEvents = (eventsInput: DomainEventCollection) => {
            const currentMap = getStoredEventMap(result as any);
            const additions = normalizeEventCollection(result as any, eventsInput);
            return createDomainResult(
              getStoredActions(result as any),
              getStoredActionMap(result as any),
              { ...currentMap, ...additions.eventMap },
              result as object,
            );
          };
          (result as any).getEventMap = () => ({ ...getStoredEventMap(result as any) });
          (result as any).definition = () => result;

          return Object.freeze(result as any);
        };

        return createDomainResult([], {} as any, {} as any) as any;
      },
      schema<LE extends EntitiesDef, const LL extends LinksDef<any>>(def: {
        entities: LE;
        links: LL;
        rooms: RoomsDef;
      }): DomainSchemaResult<MergeEntities<AE, LE>, MergeLinks<AL, LL>, RoomsDef, {}, Name, IncludedNames> {
        return this.withSchema(def) as any;
      },
    };
    return builder as unknown as DomainBuilder<AE, AL, Name, IncludedNames>;
  }

  if (typeof arg === "string" && !arg.trim()) {
    throw new Error("domain() requires a name");
  }

  const meta: DomainMeta = { name: String(arg), includes: [] };

  return createBuilder<{}, {}, string, string>(baseEntities, {} as any, [], meta);
}

export function composeDomain(
  name: string | DomainConstructorOptions,
  includes: DomainInclude[] = [],
): DomainSchemaResult<any, any, any> {
  let builder: any = domain(name);
  for (const include of includes) {
    builder = builder.includes(include as any);
  }
  return builder.withSchema({ entities: {}, links: {}, rooms: {} });
}

export function defineEvent<
  InputSchema extends DomainEventSchema,
  const Links extends Record<string, DomainEventLinkDefinition> = {},
>(
  definition: DomainEventDefinition<InputSchema, Links>,
): DomainEventDefinition<InputSchema, Links> {
  if (!definition || typeof definition !== "object" || !definition.payload) {
    throw new Error("defineEvent requires a payload schema.");
  }
  return Object.freeze({
    payload: definition.payload,
    links: freezeDomainEventLinks(definition.links),
  }) as DomainEventDefinition<InputSchema, Links>;
}

export function defineDomainAction<
  InputSchema extends DomainActionSchema,
  OutputSchema extends DomainActionSchema,
  Runtime = DomainActionRuntimeLike,
  Domain = unknown,
>(
  action: DomainActionImplementationDefinition<
    InputSchema,
    OutputSchema,
    Runtime,
    Domain
  >,
): DomainActionDefinition<InputSchema, OutputSchema, Runtime, Domain>;
export function defineDomainAction(
  action: DomainActionImplementationDefinition<any, any, any, any>,
): DomainActionDefinition<any, any, any, any> {
  return createDomainActionDefinition(action as any) as DomainActionDefinition;
}

export const defineAction = defineDomainAction;

export function getDomainActions(source: unknown): DomainActionRegistration[] {
  return getStoredActions(source);
}
