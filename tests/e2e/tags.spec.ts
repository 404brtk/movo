import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("creates, manages and filters a recording's tags with the mouse and keyboard", async ({
  page,
  request,
}) => {
  const title = `Tag test ${randomUUID()}`;
  const name = `Topic ${randomUUID().slice(0, 8)}`;
  const renamed = `${name} renamed`;
  const upload = await request.post("/api/media", {
    data: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
    headers: { "x-file-name": `${title}.wav` },
  });
  expect(upload.status()).toBe(201);
  const recording = await upload.json();
  await page.goto("/");
  const link = page.getByRole("link", { name: `Open ${title}`, exact: true });
  await link.focus();
  await page.keyboard.press("t");
  const find = page.getByRole("combobox", { name: "Find or create a tag" });
  await find.press("Escape");
  await link.hover();
  await page.getByRole("button", { name: `More actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: /Tags…/u }).click();
  await find.fill(name);
  await page.getByRole("option", { name: `Create “${name}”` }).click();
  const options = page.getByRole("button", { name: `Options for ${name}`, exact: true });
  await options.click();
  const colour = page.getByRole("menuitemradio", { name: "Teal" });
  await colour.click();
  await expect(colour).toBeChecked();
  await expect
    .poll(async () => (await (await request.get(`/api/media/${recording.id}`)).json()).tags)
    .toEqual([expect.objectContaining({ name, color: "teal" })]);
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("textbox", { name: `New name for ${name}` });
  await rename.fill(renamed);
  await rename.press("Enter");
  await expect(page.getByRole("option", { name: renamed, selected: true })).toBeVisible();
  await find.press("Escape");
  const search = page.getByRole("combobox", { name: "Search", exact: true });
  await search.fill(`#${name.split(" ")[1]}`);
  await search.press("Enter");
  await expect(page).toHaveURL(/tags=/u);
  await page.reload();
  await expect(link).toBeVisible();
  await expect(page.getByRole("button", { name: `Remove ${renamed}` })).toBeVisible();
  await search.press("Backspace");
  await expect(page).not.toHaveURL(/tags=/u);
  await link.click();
  await page.getByRole("button", { name: "Edit tags" }).click();
  await find.fill(renamed);
  await find.press("ArrowRight");
  await page.getByRole("menuitem", { name: "Delete tag…" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("removed from 1 recording.");
  await confirm.getByRole("button", { name: "Delete tag" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("option", { name: renamed, exact: true })).toBeHidden();
});

test("applies draft tags on import and edits a partially tagged selection", async ({
  page,
  request,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const name = `Interview ${suffix}`;
  const first = `First ${suffix}`;
  const second = `Second ${suffix}`;
  const wave = readFileSync(new URL("../fixtures/tone.wav", import.meta.url));
  const upload = await request.post("/api/media", {
    data: wave,
    headers: { "x-file-name": `${second}.wav` },
  });
  expect(upload.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: "Import files", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import files", exact: true });
  await dialog
    .getByLabel("Choose media files")
    .setInputFiles({ name: `${first}.wav`, mimeType: "audio/wav", buffer: wave });
  await dialog.getByRole("button", { name: "Add tags" }).click();
  const find = page.getByRole("combobox", { name: "Find or create a tag" });
  await find.fill(name);
  await page.getByRole("option", { name: `Create “${name}”` }).click();
  await expect(page.getByRole("option", { name: new RegExp(name), selected: true })).toBeVisible();
  await find.press("Escape");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toBeHidden();
  for (const title of [first, second]) {
    await page.getByRole("link", { name: `Open ${title}` }).hover();
    await page.getByRole("checkbox", { name: `Select ${title}` }).click();
  }
  await page
    .getByLabel("Selected recordings", { exact: true })
    .getByRole("button", { name: "Tags" })
    .click();
  const option = page.getByRole("option", { name: new RegExp(name) });
  await expect(option).toContainText("1 of 2");
  await option.click();
  await expect(option).toContainText("2 of 2");
  await option.click();
  await expect(option).not.toContainText("of 2");
  await page.getByRole("button", { name: `Options for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Delete tag…" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(option).toBeHidden();
});

test("opens the tag count and filters on a narrow library page", async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8);
  const names = [`Client ${suffix}`, `Meeting ${suffix}`, `Archive ${suffix}`] as const;
  const ids = [];
  for (const name of names) {
    const response = await request.post("/api/tags", { data: { name } });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).id);
  }
  const title = `Count ${suffix}`;
  const upload = await request.post(`/api/media?tags=${ids.join(",")}`, {
    data: readFileSync(new URL("../fixtures/tone.wav", import.meta.url)),
    headers: { "x-file-name": `${title}.wav` },
  });
  expect(upload.status()).toBe(201);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const count = page.getByRole("button", { name: new RegExp(`^3 tags: .*${suffix}`) });
  await count.focus();
  await expect(
    page.getByRole("button", { name: `Show recordings tagged ${names[0]}` }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: `Show recordings tagged ${names[0]}` }),
  ).toBeHidden();
  await count.hover();
  const chip = page.getByRole("button", { name: `Show recordings tagged ${names[0]}` });
  await chip.click();
  await expect(page).toHaveURL(new RegExp(ids[0]));
  await page.getByRole("button", { name: "Tags", exact: true }).click();
  await page.getByRole("option", { name: names[1], exact: true }).click();
  await expect(page).toHaveURL(new RegExp(ids[1]));
  await page.getByRole("combobox", { name: "Find a tag" }).press("Escape");
  await expect(page.getByRole("link", { name: `Open ${title}` })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goBack();
  await expect(page.getByRole("button", { name: `Remove ${names[1]}` })).toBeHidden();
});
