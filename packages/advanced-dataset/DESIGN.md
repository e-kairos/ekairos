# @ekairos/advanced-dataset — diseño

Datasets analíticos de alta performance: **misma interfaz que `@ekairos/dataset`,
store en ClickHouse**. Son el resultado addressable de una consulta (graph_query,
domain_query, o la réplica `ekairos_events`) y el backing de las **vistas MDX** que
el agente compone en sus respuestas.

Regla que gobierna todo: **el agente responde en términos de negocio y compone la
vista; la tool devuelve un dataset, no filas crudas.**

## 1. El dominio

Sibling de `@ekairos/dataset`. La API del builder es idéntica — cambia el `store`:

```ts
import { dataset } from "@ekairos/advanced-dataset"

const ds = await dataset(runtime, { store: "clickhouse" })   // <- único cambio
  .from({ kind: "cypher", query, params: { app, env } })     // o kind: "instaql" | "events"
  .asRows()
  .build()
// → { datasetId, schema: [{name, type}], rowCount, preview: rows[0..5] }
```

- **Store binding, no API nueva**: `store` es configuración, como los providers de
  channel/documents. `@ekairos/dataset` (Instant, reactivo, operacional) y
  `advanced-dataset` (ClickHouse, analítico) comparten builder; el sink decide dónde
  viven las filas.
- **Rows en ClickHouse**: una tabla `advanced_dataset_rows` particionada por
  `dataset_id` (MergeTree ORDER BY (dataset_id, row_idx)), columnas tipadas del
  schema inferido + `dataset_id LowCardinality`. Alternativa por-dataset table si el
  schema lo pide; empezamos con la tabla única particionada (más simple, borra por
  DROP PARTITION).
- **Sin expiración** (decisión): los datasets persisten. (Gancho para TTL futuro:
  columna `created_at` + `pinned` bool ya presentes, no usadas aún.)

## 2. El registry (metadata) — en el platform

Las filas viven en ClickHouse (el dato de alta performance es NUESTRO); la metadata
es addressable y auditable en el catálogo del platform, junto a `ingest_endpoints`:

```
advanced_datasets {
  id unique, name, app indexed, env indexed,
  source { kind, query, params },   // reproducible / refrescable
  schema json,                      // [{name, type}]
  rowCount, createdAt, pinned
}
```

## 3. Lectura vía platform (sin credenciales en el cliente)

El desktop/web NUNCA hablan ClickHouse directo. Leen el dataset por el platform, que
traduce a SELECT con **pushdown** de las operaciones de la vista:

```
GET /api/platform/dataset/:id/rows
    ?select=col,col & where=<filtro> & sort=col:desc & limit=200 & offset=0
    → { rows, schema, rowCount }

GET /api/platform/dataset/:id/aggregate
    ?groupBy=col & metric=sum(x)|count()|avg(x) & where=...
    → { rows: [{group, value}], ... }        // para <Metric> y charts
```

Auth = la del workspace (misma que `domain/run`). El dataset está scopeado por
`{app, env}`; el endpoint valida que el caller tenga acceso a esa app. Column ops en
query params → ClickHouse las ejecuta; el cliente solo recibe lo que va a pintar.

## 4. El contrato dataset ↔ MDX (la pieza a dejar CLEAN)

La respuesta del agente es **MDX**: prosa + componentes que referencian datasets por
handle. El renderer resuelve `dataset="..."` leyendo vía platform y monta el
componente. La vista la compone el modelo, no la predetermina la tool.

```mdx
Ofertaron dos proveedores en LIC-4519:

<DataTable dataset="ds_a1b" columns={["proveedor","oferta","rating"]} sort="oferta:asc" />

La red de adjudicación:

<DataGraph dataset="ds_a1b" />

Bombas Acme ganó con la oferta más competitiva.
```

### El registry de componentes — extensible por diseño

Un componente MDX del sistema es una entrada declarativa. Agregar uno nuevo = agregar
una entrada, nada más:

```ts
type DatasetComponent<Props> = {
  name: string                         // el tag MDX: <DataTable/>
  propsSchema: ZodType<Props>          // valida los props que el modelo escribe
  // cómo lee el dataset (qué endpoint + qué ops necesita): declarativo
  read: (datasetId: string, props: Props) => DatasetReadPlan
  // el componente React que pinta { rows, schema } + props
  render: FC<{ data: DatasetReadResult; props: Props }>
  // descripción para el modelo (va al prompt/manifest): cuándo usarlo
  usage: string
}

const registry: DatasetComponent<any>[] = [
  DataTableComponent,   // tabla: columns, sort, filter, paginate (pushdown)
  DataGraphComponent,   // grafo: nodes/edges desde el dataset (rows nodo,rel,nodo)
  MetricComponent,      // KPI único: metric + groupBy (aggregate endpoint)
  // ... agregar acá
]
```

- **`DataTable`, `DataGraph`, `Metric`** son las cards actuales refactorizadas a
  **dataset-addressed** (hoy toman el output inline de la action; pasan a tomar un
  `datasetId` y leer vía platform con pushdown). No se tiran: se vuelven la librería
  base.
- El **MDX renderer** del chat: streamdown ya rendea el markdown del asistente; MDX es
  su extensión — un remark/rehype que mapea los tags del registry a los componentes.
  Props inválidos (el modelo escribió mal) → fallback a `DataTable` + warning, nunca
  rompe la respuesta.
- **El modelo sabe qué componentes existen** por el manifest de dominio (punto 2 del
  plan): el registry se serializa a una sección del contexto ("componentes de vista
  disponibles y cuándo usarlos"), igual que las actions.

### `Dynamic` — el norte (diseñado, NO implementado aún)

El escape hatch que vuelve las vistas hyper-dinámicas. Recibe una **instrucción** y la
renderiza como componente React bound al dataset — el mismo pipeline uigen que ya
funciona en el canvas:

```mdx
<Dynamic dataset="ds_a1b"
  instruction="Un funnel horizontal: proveedores → ofertas → orden ganadora,
               resaltando el ganador. Paleta ekairos." />
```

- `Dynamic` es una entrada MÁS del registry (misma forma), pero su `render` delega en
  el pipeline uigen: `instruction + schema del dataset` → componente React generado →
  montado con `dataset` (las rows) como global, exactamente como `canvas_generate_ui`
  hoy pasa `dataJson`.
- Bound al dataset: la UI generada recibe las filas reales; refresca cuando el dataset
  cambia (re-query al endpoint). Ahí nacen los dashboards en vivo.
- **Por qué encaja limpio**: el contrato del registry ya separa "cómo leo el dataset"
  (declarativo) de "qué React monto" (render). `Dynamic` solo hace el render generativo
  en vez de estático. Cero forma nueva.

## 5. UNA sola tool: `query` (se consulta el dominio, no el store)

`graph_query` y `domain_query` se COLAPSAN en una. Tener dos filtraba el storage
(Instant/InstaQL vivo vs Neo4j/Cypher replicado) hacia el agente y lo obligaba a
elegir dónde vive el dato — que no debe saber, y por eso elegía mal. La interfaz es
el **dominio** (`@ekairos/domain` expone entidades + relaciones); el store es un
detalle de resolución.

```ts
query({ intent })   // el agente describe QUÉ quiere en términos del dominio:
                    // entidades, relaciones a recorrer, filtros, agregaciones.
  → planner resuelve el backing disponible (según el manifest, §2) y la forma:
      · relaciones / caminos / patrones     → grafo (Cypher)
      · estado actual / filtro puntual      → dominio EN VIVO (InstaQL) si conectado
      · agregación sobre historia           → ClickHouse (events)
  → dataset(runtime, { store: "clickhouse" }).from({ kind, ... }).asRows().build()
  → { datasetId, schema, preview, rowCount }
```

- **El agente nunca escribe Cypher ni InstaQL, nunca elige store.** Describe en
  términos de negocio; el planner compila.
- **Fallback transparente**: si el dominio en vivo no está conectado, el planner cae
  al grafo replicado sin que el agente lo note (mata el `api_key_missing → se rinde`).
- **Cómo sabe cuál usar**: NO lo sabe el agente. Lo decide el planner con (a) el
  manifest de dominio (qué backings existen para esta app) + (b) la forma de la query
  (traversal → grafo, lookup → vivo, agregación → ClickHouse). Routing, no elección
  del modelo.
- **Output uniforme**: siempre un dataset. Da igual el motor; el chip muestra el
  preview compacto, el modelo recibe `{datasetId, schema, preview}` (no las filas →
  menos tokens/latencia) y compone la vista MDX sobre el handle.

La representación de query arranca simple (el agente describe contra el manifest) y
evoluciona hacia un lenguaje de dominio que compila a los tres targets.

## Orden de implementación (3 packages)

1. **`@ekairos/advanced-dataset`** (ekairos-base): builder con `store: clickhouse`,
   sink ClickHouse (tabla particionada), inferencia de schema, `from({kind})` para
   cypher/instaql/events. Reusa el cliente ClickHouse del projector de ingest.
2. **Platform** (ekairos-core/web/platform): registry `advanced_datasets` +
   endpoints `/dataset/:id/rows` y `/aggregate` con pushdown y auth de workspace.
3. **Desktop** (ekairos-core/desktop): MDX renderer + registry de componentes
   (DataTable/DataGraph/Metric refactor dataset-addressed); tools del agente devuelven
   datasets; manifest de componentes al contexto. `Dynamic` queda declarado como
   entrada del registry con render pendiente (uigen).

## Estado de implementación

- **Package 1 (`@ekairos/advanced-dataset`) — HECHO y probado E2E** contra
  ClickHouse + Neo4j reales (2026-07-03). Builder `dataset(runtime,{store:"clickhouse"})`
  con sources `cypher` y `events` (`instaql` declarado, difiere al planner del
  package 3). Sink = tabla única `advanced_dataset_rows` particionada por
  `dataset_id`, filas como JSON, pushdown en ClickHouse vía JSONExtract con
  bind params y guards anti-injection. Lectura: `readDatasetRows` /
  `aggregateDataset` (las funciones que el platform envuelve en package 2).
  Normalización: cuando la query devuelve UN solo nodo (`RETURN n`), sus props
  se desenvuelven a columnas top-level (`namespace`, no `n.namespace`) — datasets
  limpios que las vistas MDX referencian natural; con múltiples columnas se
  mantiene el prefijo de variable. 36 unit tests + E2E verde (cypher→CH→read
  con filtro/select/sort + aggregate por namespace).
- **Package 2 (platform) — HECHO** (2026-07-03). Registry `advanced_datasets`
  en el schema del platform (`packages/domain/src/platform/dataset/schema.ts`,
  record id = datasetId). Endpoints: `POST /api/platform/dataset` (sources
  `cypher` con guard read-only server-side + scoping $app/$env forzado,
  `events`, y `rows` — filas materializadas por el caller, p.ej. dominio en
  vivo resuelto por el planner del desktop), `GET /dataset/:id/rows` y
  `GET /dataset/:id/aggregate` con pushdown (parseo puro de query params en
  `src/lib/dataset/params.ts`, 21 unit tests). Auth workspace en todos +
  validación de acceso a la app del dataset vía `workspace_applications`.
- **Package 3 (desktop) — HECHO** (2026-07-03). UNA tool `query`
  ({describe, cypher?, instaql?}) — graph_query y domain_query REMOVIDAS
  (colapsadas). Planner v1 puro (`src/main/dataset/query-planner.ts`):
  cypher → grafo; instaql → dominio en vivo con fallback TRANSPARENTE al
  grafo (compilador instaql→cypher best-effort); 12 unit tests. La tool
  materializa vía `POST /api/platform/dataset` y devuelve
  {datasetId, schema, preview, rowCount}. Renderer: parser MDX dirigido
  (`components/ekairos/dataset/mdx-tags.ts`, 10 unit tests) + registry
  declarativo (DataTable/DataGraph/Metric refactor dataset-addressed con
  pushdown vía IPC dataset.readRows/aggregate; `Dynamic` declarado con
  render placeholder). SYSTEM_PROMPT con sección COMPONENTES DE VISTA.

## Decisiones cerradas

- Nombre: `advanced-dataset`. Store: ClickHouse (dato de alta performance, nuestro).
- Lectura siempre vía platform (cero creds en cliente). Sin expiración (gancho listo).
- Registry de componentes declarativo y extensible; `Dynamic` (uigen) es el norte,
  misma forma, render generativo — se diseña ahora, se implementa después.
