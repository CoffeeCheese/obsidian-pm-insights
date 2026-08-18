import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { translations } from "./i18n";
import type { InsightSettings, MemberAlias } from "./model";

export interface SettingsHost {
  app: App;
  settings: InsightSettings;
  saveSettings(): Promise<void>;
  refreshInsights(): Promise<void>;
}

export class InsightsSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: SettingsHost & Plugin) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    const t = translations(this.host.settings);
    containerEl.empty();
    containerEl.createEl("h2", { text: t.settingsHeading });

    new Setting(containerEl)
      .setName(t.language)
      .setDesc(t.languageDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", t.automatic)
          .addOption("en", t.english)
          .addOption("zh-cn", t.chinese)
          .setValue(this.host.settings.locale)
          .onChange(async (value) => {
            this.host.settings.locale = value as InsightSettings["locale"];
            await this.host.saveSettings();
            await this.host.refreshInsights();
            this.display();
          })
      );

    containerEl.createEl("h3", { text: t.aliases });
    containerEl.createEl("p", { cls: "setting-item-description", text: t.aliasesDesc });

    for (const [index, alias] of this.host.settings.aliases.entries()) {
      this.renderAlias(alias, index);
    }

    new Setting(containerEl).addButton((button) =>
      button.setButtonText(t.addAlias).setCta().onClick(async () => {
        this.host.settings.aliases.push({ canonical: "", aliases: [] });
        await this.host.saveSettings();
        this.display();
      })
    );
  }

  private renderAlias(alias: MemberAlias, index: number): void {
    const t = translations(this.host.settings);
    new Setting(this.containerEl)
      .addText((input) =>
        input
          .setPlaceholder(t.canonicalName)
          .setValue(alias.canonical)
          .onChange(async (value) => {
            alias.canonical = value;
            await this.host.saveSettings();
            await this.host.refreshInsights();
          })
      )
      .addText((input) =>
        input
          .setPlaceholder(t.aliasNames)
          .setValue(alias.aliases.join(", "))
          .onChange(async (value) => {
            alias.aliases = value
              .split(/[,，]/u)
              .map((item) => item.trim())
              .filter(Boolean);
            await this.host.saveSettings();
            await this.host.refreshInsights();
          })
      )
      .addExtraButton((button) =>
        button.setIcon("trash-2").setTooltip(t.removeAlias).onClick(async () => {
          this.host.settings.aliases.splice(index, 1);
          await this.host.saveSettings();
          await this.host.refreshInsights();
          this.display();
        })
      );
  }
}
