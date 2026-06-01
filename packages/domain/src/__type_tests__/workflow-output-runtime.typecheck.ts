import { z } from "zod";

import {
  defineDomainAction,
  type DomainActionOutput,
  type DomainActionSerializedOutput,
} from "../index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type Expect<T extends true> = T;

const createSandbox = defineDomainAction({
  description: "Create a serializable sandbox record.",
  input: z.object({ sandboxId: z.string() }),
  output: z.object({
    version: z.literal(1),
    sandboxId: z.string(),
  }),
  async execute({ input }) {
    return {
      version: 1 as const,
      sandboxId: input.sandboxId,
    };
  },
});

type CreateSandboxRuntimeOutput = DomainActionOutput<typeof createSandbox>;
type CreateSandboxSerializedOutput = DomainActionSerializedOutput<typeof createSandbox>;

type CreateSandboxRuntimeOutputIsSerializableRecord = Expect<
  Equal<CreateSandboxRuntimeOutput, { version: 1; sandboxId: string }>
>;
type CreateSandboxSerializedOutputIsSerializableRecord = Expect<
  Equal<CreateSandboxSerializedOutput, { version: 1; sandboxId: string }>
>;
