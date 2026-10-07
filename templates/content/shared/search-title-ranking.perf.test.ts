import { describe, expect, it } from "vitest";

import {
  buildTitleSearchIndex,
  rankTitlesByQuery,
  TITLE_MATCH_TIER,
  type TitleSearchCandidate,
} from "./search-title-ranking";

describe("rankTitlesByQuery performance", () => {
  it("ranks 10,000 titles through the typo tier in under 50ms", () => {
    const items: TitleSearchCandidate[] = Array.from(
      { length: 10_000 },
      (_, index) => ({
        id: `doc-${index}`,
        title: `Quarterly planning notes ${index}`,
        updatedAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
      }),
    );
    const index = buildTitleSearchIndex(items);
    rankTitlesByQuery(index, "plnaning"); // warm up the JIT
    const start = performance.now();
    const ranked = rankTitlesByQuery(index, "plnaning");
    const elapsed = performance.now() - start;
    expect(ranked.length).toBe(10_000);
    expect(ranked[0]!.tier).toBe(TITLE_MATCH_TIER.fuzzy);
    expect(elapsed).toBeLessThan(50);
  });

  it("ranks 10,000 titles in under 50ms", () => {
    const titles = [
      "Task Priorities",
      "Quarterly Roadmap",
      "Engineering Notes",
      "Design Review",
      "Stellar Road Handbook",
    ];
    const items: TitleSearchCandidate[] = Array.from(
      { length: 10_000 },
      (_, index) => ({
        id: `doc-${index}`,
        title: `${titles[index % titles.length]} ${index}`,
        updatedAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
      }),
    );
    const index = buildTitleSearchIndex(items);
    rankTitlesByQuery(index, "road"); // warm up the JIT
    const start = performance.now();
    const ranked = rankTitlesByQuery(index, "road");
    const elapsed = performance.now() - start;
    expect(ranked.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});
