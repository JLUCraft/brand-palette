import type { Brand, BrandRole } from "./brand";
import { RAMP_STEPS, resolveModes, type Ramp } from "./ramp";
import type { BrandJson } from "./emit";

/** Resolve consumer colors from the committed palette. */
export function brandFromManifest(manifest: BrandJson): Brand {
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id) || !manifest.name) {
    throw new Error("Invalid brand identity");
  }
  const readRole = (name: keyof BrandJson["palette"]): BrandRole => {
    const value = manifest.palette[name];
    if (
      !Number.isFinite(value.hue) ||
      !Number.isFinite(value.chroma) ||
      value.chroma < 0 ||
      !RAMP_STEPS.includes(value.base as BrandRole["base"]) ||
      RAMP_STEPS.some((step) => !/^#[0-9a-f]{6}$/.test(value.ramp[step]))
    ) {
      throw new Error(`Invalid brand palette: ${name}`);
    }
    return { ...value, base: value.base as BrandRole["base"], ramp: { ...value.ramp } as BrandRole["ramp"] };
  };
  const palette = {
    primary: readRole("primary"),
    secondary: readRole("secondary"),
    accent: readRole("accent"),
    neutral: readRole("neutral"),
  };
  const ramp = (value: BrandRole): Ramp => ({ ...value, steps: value.ramp });
  return {
    id: manifest.id,
    name: manifest.name,
    monochrome: manifest.monochrome,
    source: manifest.source,
    palette,
    modes: resolveModes({
      brand: ramp(palette.primary),
      secondary: ramp(palette.secondary),
      accent: ramp(palette.accent),
      neutral: ramp(palette.neutral),
      baseStep: palette.primary.base,
    }),
  };
}
