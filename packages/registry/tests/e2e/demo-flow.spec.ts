import { expect, test } from "@playwright/test";

test.describe("registry examples navigation", () => {
  test("landing exposes domains first and routes into a domain component catalog", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        name: "Domain components, ready to install.",
      }),
    ).toBeVisible();
    await expect(page.getByText("distribution preview")).toBeVisible();
    await expect(page.getByText("event-context-panel", { exact: true }).first()).toBeVisible();
    const topbar = page.getByRole("navigation", { name: "Registry navigation" });
    await expect(topbar.getByRole("link", { name: "Domains" })).toBeVisible();
    await expect(topbar.getByRole("link", { name: "Manifest" })).toBeVisible();
    await expect(topbar.getByRole("link", { name: "Events" })).toHaveCount(0);

    await page.locator("a[href='/events/components']").first().click();
    await expect(page).toHaveURL(/\/events\/components$/);
    await expect(page.getByRole("heading", { name: "Events components." })).toBeVisible();

    const demoResponse = await page.goto("/demo");
    expect(demoResponse?.status()).toBe(404);

    const codexDemoResponse = await page.goto("/codex-demo");
    expect(codexDemoResponse?.status()).toBe(404);
  });
});
