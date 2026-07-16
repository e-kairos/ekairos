import { expect, test, type Page } from "@playwright/test"

import { reactorDocsNav } from "../../lib/reactor-docs"

const reactorPages = reactorDocsNav.flatMap(group => group.links)

function normalizeClipboardText(value: string) {
  return value.replace(/\r\n?/g, "\n")
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const widths = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ),
  }))

  expect(
    widths.scrollWidth,
    `${label} has horizontal page overflow: ${widths.scrollWidth}px > ${widths.clientWidth}px`,
  ).toBeLessThanOrEqual(widths.clientWidth + 1)
}

test.describe("Reactor documentation", () => {
  test("desktop navigation reaches every Reactor page without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(reactorPages[0].href)

    const sidebar = page.locator("aside")
    await expect(sidebar).toBeVisible()

    for (const reactorPage of reactorPages) {
      await sidebar.getByRole("link", { name: reactorPage.label, exact: true }).click()
      await expect.poll(() => new URL(page.url()).pathname).toBe(reactorPage.href)
      await expect(page.locator("article h1")).toBeVisible()
      await expectNoHorizontalOverflow(page, reactorPage.href)
    }
  })

  test("code blocks copy exact source with accessible feedback and stable layout", async ({ context, page }) => {
    await page.goto("/reactor/docs")
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    })

    const codeBlock = page.locator("figure").first()
    const copyButton = codeBlock.locator("button[data-copy-state]")
    const expectedCode = await codeBlock.locator("code").textContent()
    const before = await codeBlock.boundingBox()

    if (expectedCode === null || before === null) throw new Error("Expected a measurable Reactor code block")

    await expect(copyButton).toHaveAccessibleName("Copy code")
    await copyButton.hover()
    await expect(page.getByRole("tooltip")).toHaveText("Copy code")
    await copyButton.click()

    await expect(copyButton).toHaveAccessibleName("Code copied")
    await expect(codeBlock.getByRole("status")).toHaveText("Code copied")
    await expect.poll(async () => normalizeClipboardText(
      await page.evaluate(() => navigator.clipboard.readText()),
    )).toBe(normalizeClipboardText(expectedCode))

    const after = await codeBlock.boundingBox()
    if (after === null) throw new Error("Expected the Reactor code block to remain measurable")
    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
  })

  test("mobile navigation opens, routes, closes, and avoids horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/reactor/docs")

    const sidebar = page.locator("aside")
    const toggle = page.getByRole("button", { name: "Toggle Reactor docs navigation" })

    await expect(sidebar).not.toBeInViewport()
    await toggle.click()
    await expect(sidebar).toBeInViewport()
    await expect(page.getByRole("button", { name: "Close Reactor docs navigation" })).toBeVisible()

    const targetPage = reactorPages.at(-1)
    if (!targetPage) throw new Error("Expected Reactor navigation entries")
    await sidebar.getByRole("link", { name: targetPage.label, exact: true }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(targetPage.href)
    await expect(sidebar).not.toBeInViewport()
    await expectNoHorizontalOverflow(page, targetPage.href)

    await toggle.click()
    await expect(sidebar).toBeInViewport()
    await page.getByRole("button", { name: "Close Reactor docs navigation" }).click({
      position: { x: 350, y: 100 },
    })
    await expect(sidebar).not.toBeInViewport()
    await expectNoHorizontalOverflow(page, `${targetPage.href} (mobile menu closed)`)
  })
})
