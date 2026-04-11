# ekairos

Convenience package that re-exports the main Ekairos surfaces.

## Entry points

- `ekairos`
- `ekairos/context`
- `ekairos/domain`
- `ekairos/dataset`

## Example

```ts
import { createContext } from "ekairos/context";

const demo = createContext("demo")
  .context((stored) => stored.content ?? {})
  .narrative(() => "Demo context")
  .actions(() => ({}))
  .build();
```
