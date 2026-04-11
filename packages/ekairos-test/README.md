# @ekairos/testing

Testing helpers for Ekairos packages and apps.

## What it provides

- temporary InstantDB apps
- schema push helpers
- perms push helpers
- runtime-oriented test bootstrapping

## Main helpers

- `createTestApp(...)`
- `pushTestSchema(...)`
- `pushTestPerms(...)`
- `destroyTestApp(...)`

## Typical flow

```ts
const app = await createTestApp({ name, token, schema });
// run tests
await destroyTestApp({ appId: app.appId, token });
```

Use this package when tests need a real InstantDB app instead of mocks.
