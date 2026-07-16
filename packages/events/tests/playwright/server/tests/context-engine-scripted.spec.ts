import { expect, test } from "@playwright/test";

import { verifyStorySmoke } from "./_story-smoke";

test("persists a scripted Reaction workflow as Session, Reactions, Events, and Event Parts", async ({
  request,
}) => {
  test.setTimeout(180_000);
  const report = await verifyStorySmoke(request, "scripted");
  expect(report.reactionTypes).toEqual(expect.arrayContaining([
    "story.smoke.scripted",
    "agent",
    "emit",
  ]));
  console.log(`[context-e2e-report] ${JSON.stringify(report)}`);
});
