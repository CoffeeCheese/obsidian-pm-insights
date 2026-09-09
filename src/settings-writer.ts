import type { InsightSettings } from "./model";

/** All settings writers share this queue; publish only after durable save succeeds. */
export class SettingsWriter {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: {
    read(): InsightSettings;
    write(settings: InsightSettings): Promise<void>;
    publish(settings: InsightSettings): void;
  }) {}

  transact<T>(update: (draft: InsightSettings) => T | Promise<T>, force = false): Promise<T> {
    const operation = this.pending.then(async () => {
      const previous = this.options.read();
      const draft = structuredClone(previous);
      const result = await update(draft);
      if (force || JSON.stringify(previous) !== JSON.stringify(draft)) {
        await this.options.write(draft);
        this.options.publish(draft);
      }
      return result;
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}
