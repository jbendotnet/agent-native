import assert from "node:assert/strict";

import { chromium } from "@playwright/test";
import { test } from "vitest";

import { canvasWheelPoint } from "./canvas-wheel-point";

test("trusted Ctrl-wheel stays on the canvas as live iframe screens move and zoom", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    await page.addInitScript("globalThis.__name = (fn) => fn;");
    await page.goto("data:text/html,");
    await page.setContent(`
      <div data-multi-screen-canvas-surface style="position:fixed;left:100px;top:80px;width:950px;height:560px;background:#eee">
        <div data-multi-screen-canvas-world style="transform:scale(1)">
          <div data-screen-shell style="position:absolute;left:0;top:0;width:740px;height:480px">
            <iframe data-design-preview-iframe srcdoc="<main>Live screen</main>" style="width:100%;height:100%;border:0"></iframe>
          </div>
        </div>
      </div>
    `);
    await page
      .locator("iframe[data-design-preview-iframe]")
      .contentFrame()
      .locator("main")
      .waitFor();
    await page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>(
        "[data-multi-screen-canvas-surface]",
      )!;
      const world = document.querySelector<HTMLElement>(
        "[data-multi-screen-canvas-world]",
      )!;
      const seen: { trusted: boolean; ctrl: boolean; target: string }[] = [];
      (window as typeof window & { __wheelSeen: typeof seen }).__wheelSeen =
        seen;
      surface.addEventListener(
        "wheel",
        (event) => {
          seen.push({
            trusted: event.isTrusted,
            ctrl: event.ctrlKey,
            target: (event.target as Element).tagName,
          });
          event.preventDefault();
          const current = Number(
            /scale\(([^)]+)\)/.exec(world.style.transform)![1],
          );
          world.style.transform = `scale(${current * Math.exp(-event.deltaY / 100)})`;
        },
        { passive: false },
      );
    });
    const cdp = await page.context().newCDPSession(page);
    for (const [index, target] of [60, 13, 31, 7, 145, 10, 8].entries()) {
      await page.locator("[data-screen-shell]").evaluate((shell, i) => {
        (shell as HTMLElement).style.left = i % 2 ? "120px" : "0";
        (shell as HTMLElement).style.top = i % 2 ? "70px" : "0";
      }, index);
      let reached = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = await page
          .locator("[data-multi-screen-canvas-world]")
          .evaluate(
            (world) =>
              Number(
                /scale\(([^)]+)\)/.exec(
                  (world as HTMLElement).style.transform,
                )![1],
              ) * 100,
          );
        const off = Math.log(current / target);
        if (Math.abs(off) < 0.06) {
          reached = true;
          break;
        }
        const { x, y } = await canvasWheelPoint(page);
        const hit = await page.evaluate(
          ({ x, y }) => {
            const element = document.elementFromPoint(x, y);
            return {
              canvas:
                element ===
                document.querySelector("[data-multi-screen-canvas-surface]"),
              screen: Boolean(element?.closest("[data-screen-shell]")),
              tag: element?.tagName,
            };
          },
          { x, y },
        );
        assert.equal(hit.canvas, true);
        assert.equal(hit.screen, false);
        assert.notEqual(hit.tag, "IFRAME");
        await page.mouse.move(x, y);
        await canvasWheelPoint(page, { x, y });
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x,
          y,
          deltaX: 0,
          deltaY:
            Math.sign(off) * Math.min(30, Math.max(2, Math.abs(off) * 40)),
          modifiers: 2,
        });
      }
      assert.equal(reached, true, `zoom ${target}% did not converge`);
    }
    const seen = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __wheelSeen: { trusted: boolean; ctrl: boolean; target: string }[];
          }
        ).__wheelSeen,
    );
    assert.ok(seen.length > 7);
    assert.ok(
      seen.every(
        ({ trusted, ctrl, target }) => trusted && ctrl && target !== "IFRAME",
      ),
    );

    await page
      .locator("[data-multi-screen-canvas-surface]")
      .evaluate((surface) => {
        surface.innerHTML =
          '<div data-screen-shell style="position:absolute;inset:0"><iframe srcdoc="<main>Cover</main>" style="width:100%;height:100%;border:0"></iframe></div>';
      });
    await assert.rejects(
      canvasWheelPoint(page),
      /No unobstructed canvas surface/,
    );
    await assert.rejects(
      canvasWheelPoint(page, { x: 575, y: 360 }),
      /Wheel point no longer hits the canvas surface/,
    );
    await page
      .locator("[data-multi-screen-canvas-surface]")
      .evaluate((surface) => {
        surface.innerHTML =
          '<div data-screen-shell style="position:absolute;inset:0"><iframe srcdoc="<main>Cover</main>" style="width:100%;height:100%;border:0"></iframe><div data-frame-label style="position:absolute;left:40px;top:5px;z-index:1"><span data-frame-title>Dashboard 2</span></div></div>';
      });
    const labelPoint = await canvasWheelPoint(page);
    assert.equal(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
        labelPoint,
      ),
      "SPAN",
    );
    assert.deepEqual(await canvasWheelPoint(page, labelPoint), labelPoint);
    await page
      .locator("[data-multi-screen-canvas-surface]")
      .evaluate((surface) => {
        surface.innerHTML =
          '<div data-frame-selection-box style="position:absolute;inset:0"><span data-frame-drag-surface style="position:absolute;inset:0"></span></div>';
      });
    const coveredPoint = await canvasWheelPoint(page);
    assert.deepEqual(coveredPoint, { x: 575, y: 360 });
    assert.deepEqual(await canvasWheelPoint(page, coveredPoint), coveredPoint);
    await page
      .locator("[data-multi-screen-canvas-surface]")
      .evaluate((surface) => {
        surface.innerHTML =
          '<div data-frame-selection-box style="position:absolute;inset:0"><span data-resize-handle="n" style="position:absolute;inset:0"></span></div>';
      });
    assert.deepEqual(await canvasWheelPoint(page, coveredPoint), coveredPoint);
    await page
      .locator("[data-multi-screen-canvas-surface]")
      .evaluate((surface) => {
        surface.innerHTML =
          '<div data-screen-shell style="position:absolute;inset:0"><span data-unknown-overlay style="position:absolute;inset:0"></span></div>';
      });
    await assert.rejects(
      canvasWheelPoint(page, coveredPoint),
      /Wheel point no longer hits the canvas surface/,
    );
    await page
      .locator("[data-multi-screen-canvas-surface]")
      .evaluate((surface) => {
        surface.innerHTML =
          '<div data-non-screen-overlay style="position:absolute;inset:0;background:#eee"></div>';
      });
    await assert.rejects(
      canvasWheelPoint(page),
      /No unobstructed canvas surface/,
    );
    await assert.rejects(
      canvasWheelPoint(page, { x: 900, y: 400 }),
      /Wheel point no longer hits the canvas surface/,
    );
    await page
      .locator("[data-multi-screen-canvas-surface]")
      .evaluate((surface) => surface.remove());
    await assert.rejects(canvasWheelPoint(page), /Canvas surface not found/);
  } finally {
    await browser.close();
  }
});
