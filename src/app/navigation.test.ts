import { beforeEach, describe, expect, it } from "vitest";

import { navigateTo, routeFromHash } from "@/app/navigation";
import { appRoutes } from "@/config/app";

describe("desktop hash navigation", () => {
  beforeEach(() => {
    window.location.hash = appRoutes.usage;
  });

  it("recognizes allow-listed application routes", () => {
    window.location.hash = appRoutes.dictionary;
    expect(routeFromHash()).toBe(appRoutes.dictionary);
  });

  it("falls back to usage for unknown native navigation targets", () => {
    navigateTo("/not-a-real-route");
    expect(window.location.hash).toBe(`#${appRoutes.usage}`);
    expect(routeFromHash()).toBe(appRoutes.usage);
  });
});
