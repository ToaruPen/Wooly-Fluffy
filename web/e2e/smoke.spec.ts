import { test, expect } from "@playwright/test";

test("/kiosk shows kiosk UI", async ({ page }) => {
  await page.goto("/kiosk");
  await expect(page.getByRole("heading", { name: "KIOSK" })).toBeVisible();

  // Stage should render either the VRM canvas or a fallback.
  const stage = page.getByRole("region", { name: "Mascot stage" });
  await expect(stage).toBeVisible();
  await expect(
    stage.getByTestId("mascot-stage-fallback").or(stage.locator("canvas")),
  ).toBeVisible();

  const stageBgVar = await stage.evaluate((el) => {
    return (el as HTMLElement).style.getPropertyValue("--wf-kiosk-stage-bg");
  });
  expect(stageBgVar === "none" || stageBgVar.includes("url(")).toBe(true);
});

test("/staff shows login UI", async ({ page }) => {
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "STAFF" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
