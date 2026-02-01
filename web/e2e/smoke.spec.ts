import { test, expect } from "@playwright/test";

test("/kiosk shows kiosk UI", async ({ page }) => {
  await page.goto("/kiosk");
  await expect(page.getByRole("heading", { name: "KIOSK" })).toBeVisible();
  await expect(page.getByText("Mascot Stage")).toBeVisible();
});

test("/staff shows login UI", async ({ page }) => {
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "STAFF" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
