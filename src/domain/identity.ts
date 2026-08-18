import type { MemberAlias } from "../model";

export function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export class IdentityResolver {
  private readonly canonicalByIdentity = new Map<string, string>();

  constructor(aliases: MemberAlias[]) {
    for (const entry of aliases) {
      const canonical = entry.canonical.normalize("NFKC").trim();
      if (!canonical) continue;

      this.canonicalByIdentity.set(normalizeIdentity(canonical), canonical);
      for (const alias of entry.aliases) {
        const key = normalizeIdentity(alias);
        if (key) this.canonicalByIdentity.set(key, canonical);
      }
    }
  }

  resolve(value: string): string {
    const display = value.normalize("NFKC").trim();
    if (!display) return "";
    return this.canonicalByIdentity.get(normalizeIdentity(display)) ?? display;
  }

  resolveMany(values: string[]): string[] {
    const resolved = new Map<string, string>();
    for (const value of values) {
      const display = this.resolve(value);
      if (display) resolved.set(normalizeIdentity(display), display);
    }
    return [...resolved.values()];
  }
}

