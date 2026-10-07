import type { Page } from "@playwright/test";

export function canvasWheelPoint(
  page: Page,
  point?: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  return page.evaluate((point) => {
    const surface = document.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-surface]",
    );
    if (!surface) throw new Error("Canvas surface not found");
    const box = surface.getBoundingClientRect();
    const left = Math.max(0, box.left);
    const top = Math.max(0, box.top);
    const width = Math.min(innerWidth, box.right) - left;
    const height = Math.min(innerHeight, box.bottom) - top;
    const onCanvas = (x: number, y: number) => {
      return document.elementFromPoint(x, y) === surface;
    };
    const onScreen = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return (
        hit instanceof HTMLElement &&
        surface.contains(hit) &&
        (hit.matches(
          "[data-frame-selection-box] > [data-frame-drag-surface]",
        ) ||
          hit.matches("[data-frame-selection-box] [data-resize-handle]") ||
          hit.matches(
            "[data-screen-shell] [data-frame-label] [data-frame-title]",
          ))
      );
    };
    if (point) {
      if (!onCanvas(point.x, point.y) && !onScreen(point.x, point.y)) {
        throw new Error("Wheel point no longer hits the canvas surface");
      }
      return point;
    }
    for (let row = 0; row < 9; row++) {
      for (let column = 0; column < 9; column++) {
        const x = Math.round(left + ((column + 0.5) * width) / 9);
        const y = Math.round(top + ((row + 0.5) * height) / 9);
        if (onCanvas(x, y)) return { x, y };
      }
    }
    const x = Math.round(left + width / 2);
    const y = Math.round(top + height / 2);
    if (onScreen(x, y)) return { x, y };
    for (const title of surface.querySelectorAll<HTMLElement>(
      "[data-screen-shell] [data-frame-label] [data-frame-title]",
    )) {
      const rect = title.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      if (onScreen(x, y)) return { x, y };
    }
    throw new Error("No unobstructed canvas surface for wheel input");
  }, point);
}
