import { expect, test } from "@playwright/test";

import { verifyStorySmoke } from "./_story-smoke";

for (const mode of ["success", "tool-error"] as const) {
  test(`persists the ${mode} Reaction workflow result`, async ({ request }) => {
    test.setTimeout(180_000);
    const report = await verifyStorySmoke(request, mode);
    expect(report.reactionTypes).toEqual(expect.arrayContaining([
      mode === "tool-error" ? "story.smoke.tool-error" : "story.smoke",
      "agent",
      "emit",
    ]));
    console.log(`[context-e2e-report] ${JSON.stringify(report)}`);
  });
}
