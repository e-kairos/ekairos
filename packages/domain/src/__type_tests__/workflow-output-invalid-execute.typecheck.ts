import { z } from "zod";

import { defineDomainAction } from "../index";

const sandboxOutputSchema = z.object({
  version: z.literal(1),
  sandboxId: z.string(),
});

// given: an action declares a concrete zod output schema.
defineDomainAction({
  description: "Invalid serializable output.",
  input: z.object({ sandboxId: z.string() }),
  output: sandboxOutputSchema,
  // then: defineDomainAction rejects implementations that do not return the
  // declared output shape.
  // @ts-expect-error output.version must be the declared literal `1`.
  async execute({ input }) {
    return {
      version: 2,
      sandboxId: input.sandboxId,
    };
  },
});
