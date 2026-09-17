export const CRYSTAL_HEXES = [
  "#1F0030", "#46085E", "#54146E", "#5D1C78", "#63237D", "#6A2C82",
  "#7E4196", "#8E51A6", "#9C64B3", "#A875BD", "#B88BC9", "#C6A3D4",
  "#D9C1E3", "#E5D1ED", "#EFE1F5", "#FCF3FF",
] as const;

export const FAIRY_HEXES = [
  "#660033", "#99004C", "#CC0066", "#FF007F", "#FF3399", "#FF66B2",
  "#FF99CC", "#FFCCE5", "#660066", "#990099", "#CC00CC", "#FF00FF",
  "#FF33FF", "#FF66FF", "#FF99FF", "#FFCCFF", "#E5CCFF", "#CC99FF",
  "#B266FF", "#9933FF", "#7F00FF", "#6600CC", "#4C0099", "#330066",
] as const;

const FAIRY_SET = new Set<string>(FAIRY_HEXES);
const CRYSTAL_SET = new Set<string>(CRYSTAL_HEXES);

export type NonExoticHexType = "fairy" | "crystal" | null;

export function normalizeHexForLookup(input?: string | null): string | null {
  if (!input) return null;
  let value = String(input).trim().replace(/^#/, "");
  if (/^[0-9A-Fa-f]{3}$/.test(value)) {
    value = value.split("").map((c) => c + c).join("");
  }
  if (!/^[0-9A-Fa-f]{6}$/.test(value)) return null;
  return `#${value.toUpperCase()}`;
}

export function getNonExoticHexType(input?: string | null): NonExoticHexType {
  const hex = normalizeHexForLookup(input);
  if (!hex) return null;
  if (FAIRY_SET.has(hex)) return "fairy";
  if (CRYSTAL_SET.has(hex)) return "crystal";
  return null;
}
