import {
  defineDomainAction,
  type DomainActionSerializedOutput,
} from "../index";
import { z } from "zod";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type Expect<T extends true> = T;

// given: a normal domain action with explicit zod input and output schemas.
const normalAction = defineDomainAction({
  description: "Return normal JSON-like data.",
  input: z.object({ sandboxId: z.string() }),
  output: z.object({ ok: z.literal(true) }),
  execute() {
    return { ok: true as const };
  },
});

// when: serialized output is extracted from that normal action.
type NormalSerializedOutput = DomainActionSerializedOutput<typeof normalAction>;

// then: the serialized output is inferred from the zod output schema.
type NormalSerializedOutputIsRuntimeOutput = Expect<
  Equal<NormalSerializedOutput, { ok: true }>
>;
