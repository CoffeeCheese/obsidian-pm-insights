import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  type SettingDefinition,
  type SettingDefinitionItem
} from "obsidian";
import { translations, type Translations } from "./i18n";
import type { InsightSettings, MemberAlias } from "./model";

export interface SettingsHost {
  app: App;
  settings: InsightSettings;
  saveSettings(): Promise<void>;
  refreshInsights(): Promise<void>;
}

export class InsightsSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost;

  constructor(app: App, plugin: SettingsHost & Plugin) {
    super(app, plugin);
    this.host = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const t = translations(this.host.settings);
    return [
      {
        type: "group",
        heading: t.settingsHeading,
        items: [
          {
            name: t.language,
            desc: t.languageDesc,
            aliases: [t.aliases, t.aliasesDesc, t.canonicalName, t.aliasNames],
            control: {
              type: "dropdown",
              key: "locale",
              options: {
                auto: t.automatic,
                en: t.english,
                "zh-cn": t.chinese
              }
            }
          }
        ]
      },
      {
        type: "list",
        heading: t.aliases,
        addItem: {
          name: t.addAlias,
          action: () => {
            void this.addAlias();
          }
        },
        onDelete: (index) => {
          void this.deleteAlias(index);
        },
        items: this.host.settings.aliases.map((alias) => this.aliasDefinition(alias, t))
      }
    ];
  }

  getControlValue(key: string): unknown {
    return key === "locale" ? this.host.settings.locale : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key !== "locale" || !this.isLocale(value)) return;
    this.host.settings.locale = value;
    await this.host.saveSettings();
    await this.host.refreshInsights();
    this.updateDefinitions();
  }

  // Obsidian versions before 1.13 use this imperative fallback.
  display(): void {
    this.renderLegacySettings();
  }

  private renderLegacySettings(): void {
    const { containerEl } = this;
    const t = translations(this.host.settings);
    containerEl.empty();
    new Setting(containerEl).setName(t.settingsHeading).setHeading();

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
            this.renderLegacySettings();
          })
      );

    new Setting(containerEl).setName(t.aliases).setDesc(t.aliasesDesc).setHeading();

    for (const [index, alias] of this.host.settings.aliases.entries()) {
      this.renderAlias(alias, index);
    }

    new Setting(containerEl).addButton((button) =>
      button.setButtonText(t.addAlias).setCta().onClick(async () => {
        this.host.settings.aliases.push({ canonical: "", aliases: [] });
        await this.host.saveSettings();
        this.renderLegacySettings();
      })
    );
  }

  private aliasDefinition(alias: MemberAlias, t: Translations): SettingDefinition {
    return {
      name: alias.canonical || t.canonicalName,
      desc: alias.aliases.length > 0 ? alias.aliases.join(", ") : t.aliasesDesc,
      render: (setting) => {
        setting
          .setName("")
          .setDesc("")
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
                alias.aliases = this.parseAliases(value);
                await this.host.saveSettings();
                await this.host.refreshInsights();
              })
          );
      }
    };
  }

  private async addAlias(): Promise<void> {
    this.host.settings.aliases.push({ canonical: "", aliases: [] });
    await this.host.saveSettings();
    this.updateDefinitions();
  }

  private async deleteAlias(index: number): Promise<void> {
    this.host.settings.aliases.splice(index, 1);
    await this.host.saveSettings();
    await this.host.refreshInsights();
    this.updateDefinitions();
  }

  private isLocale(value: unknown): value is InsightSettings["locale"] {
    return value === "auto" || value === "en" || value === "zh-cn";
  }

  private parseAliases(value: string): string[] {
    return value
      .split(/[,，]/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private updateDefinitions(): void {
    const update = Reflect.get(this, "update");
    if (typeof update === "function") update.call(this);
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
            alias.aliases = this.parseAliases(value);
            await this.host.saveSettings();
            await this.host.refreshInsights();
          })
      )
      .addExtraButton((button) =>
        button.setIcon("trash-2").setTooltip(t.removeAlias).onClick(async () => {
          this.host.settings.aliases.splice(index, 1);
          await this.host.saveSettings();
          await this.host.refreshInsights();
          this.renderLegacySettings();
        })
      );
  }
}
