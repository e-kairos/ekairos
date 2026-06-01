import { expect, test } from "@playwright/test";

test("events domain exposes installable components by domain", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/events/components");
  await expect(page.getByRole("heading", { name: "Events components." })).toBeVisible();
  await expect(page.locator("#event-context-panel")).toBeVisible();
  await expect(page.getByText("@ekairos/events@beta").first()).toBeVisible();
  await expect(page.getByText("shadcn@4.8.0").first()).toBeVisible();
  await expect(page.getByText("registry:hook")).toHaveCount(0);
  await expect(page.getByText("components/ekairos/events/context/index.ts")).toHaveCount(0);

  const response = await page.request.get("/r/event-context-panel.json");
  expect(response.ok()).toBe(true);
  const json = await response.json();
  expect(json.type).toBe("registry:component");
  expect(json.dependencies).toContain("@ekairos/events@beta");
  expect(json.files[0].target).toBe("components/ekairos/events/event-context-panel.tsx");
  expect(json.files[0].content).toContain('from "@ekairos/events/react"');

  await page.goto("/registry/event-context-panel");
  await expect(page.getByRole("heading", { name: "EventContextPanel" })).toBeVisible();
  await expect(page.getByText("/events registry component")).toBeVisible();
  await expect(page.getByText("components/ekairos/events/event-context-panel.tsx")).toBeVisible();
});

test("event component docs preview the real domain component", async ({ page }) => {
  const prompt = "Confirma que el preview usa el panel real";

  await page.goto("/docs/components/event-context-panel");
  await expect(page.getByRole("heading", { name: "EventContextPanel" })).toBeVisible();
  await expect(page.getByText("Live context panel")).toBeVisible();
  await expect(page.getByText("registry:hook")).toHaveCount(0);
  await expect(page.getByText("components/ekairos/events/context/index.ts")).toHaveCount(0);

  await page.getByRole("textbox").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(`Preview response for: ${prompt}`)).toBeVisible();
});

test("legacy component shelf routes redirect to the domain catalog", async ({ page }) => {
  for (const legacyPath of [
    "/docs/components/context",
    "/docs/components/event-steps",
    "/docs/components/full-agent",
    "/docs/components/message",
    "/docs/components/prompt",
    "/docs/components/chain-of-thought",
  ]) {
    await page.goto(legacyPath);
    await expect(page).toHaveURL(/\/events\/components$/);
    await expect(page.getByRole("heading", { name: "Events components." })).toBeVisible();
  }
});
