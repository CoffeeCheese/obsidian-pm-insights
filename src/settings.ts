import {
  App,
  ButtonComponent,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TextComponent,
  setIcon,
  type SettingDefinition,
  type SettingDefinitionItem
} from "obsidian";
import { translations, type Translations } from "./i18n";
import {
  type DeliveryProgressSettings,
  type DeliveryStageId,
  type InsightSettings,
  type MemberAlias
} from "./model";
import {
  deliveryWeightTotal,
  hasDeliveryTagMappingConflict,
  normalizeProgressTag
} from "./domain/delivery-progress";
import { collectProjectTagOptions, type ProjectTagOption } from "./domain/project-tags";
import type { ProjectManagerSnapshot } from "./adapters/project-manager";

export interface SettingsHost {
  app: App;
  settings: InsightSettings;
  saveSettings(): Promise<void>;
  refreshInsights(): Promise<void>;
  readProjectManager(): Promise<ProjectManagerSnapshot>;
}

interface ProjectTagPickerCopy {
  title: string;
  description: string;
  searchPlaceholder: string;
  empty: string;
  noMatches: string;
  taskCount: (count: number) => string;
  selectedCount: (count: number) => string;
  usedBy: (stage: string) => string;
  cancel: string;
  apply: string;
}

class ProjectTagPickerModal extends Modal {
  private readonly selected = new Set<string>();
  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private query = "";

  constructor(
    app: App,
    private readonly options: readonly ProjectTagOption[],
    selected: readonly string[],
    private readonly reservedBy: ReadonlyMap<string, string>,
    private readonly copy: ProjectTagPickerCopy,
    private readonly onApply: (selected: string[]) => void
  ) {
    super(app);
    for (const tag of selected) this.selected.add(tag);
  }

  onOpen(): void {
    this.modalEl.addClass("pmi-project-tag-modal");
    this.titleEl.setText(this.copy.title);
    this.contentEl.createEl("p", {
      cls: "pmi-project-tag-modal-description",
      text: this.copy.description
    });

    const search = new TextComponent(this.contentEl);
    search.setPlaceholder(this.copy.searchPlaceholder).onChange((value) => {
      this.query = value.trim().toLocaleLowerCase();
      this.renderOptions();
    });
    search.inputEl.addClass("pmi-project-tag-search");
    search.inputEl.setAttribute("aria-label", this.copy.searchPlaceholder);

    this.listEl = this.contentEl.createDiv("pmi-project-tag-list");
    const footer = this.contentEl.createDiv("pmi-project-tag-footer");
    this.countEl = footer.createSpan("pmi-project-tag-selected-count");
    const actions = footer.createDiv("pmi-project-tag-actions");
    new ButtonComponent(actions).setButtonText(this.copy.cancel).onClick(() => this.close());
    new ButtonComponent(actions).setButtonText(this.copy.apply).setCta().onClick(() => {
      this.onApply([...this.selected]);
      this.close();
    });

    this.renderOptions();
    window.setTimeout(() => search.inputEl.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderOptions(): void {
    this.listEl.empty();
    const visible = this.options.filter((option) => option.tag.includes(this.query));

    if (this.options.length === 0 || visible.length === 0) {
      this.listEl.createDiv({
        cls: "pmi-project-tag-empty",
        text: this.options.length === 0 ? this.copy.empty : this.copy.noMatches
      });
    }

    for (const option of visible) {
      const reservedStage = this.reservedBy.get(option.tag);
      const checked = this.selected.has(option.tag);
      const disabled = Boolean(reservedStage) && !checked;
      const row = this.listEl.createEl("label", {
        cls: `pmi-project-tag-option${disabled ? " is-disabled" : ""}`
      });
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = checked;
      checkbox.disabled = disabled;
      const label = row.createDiv("pmi-project-tag-option-label");
      label.createEl("code", { text: `#${option.tag}` });
      label.createSpan({
        cls: "pmi-project-tag-usage",
        text: reservedStage
          ? this.copy.usedBy(reservedStage)
          : this.copy.taskCount(option.taskCount)
      });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(option.tag);
        else this.selected.delete(option.tag);
        this.updateCount();
      });
    }

    this.updateCount();
  }

  private updateCount(): void {
    this.countEl.setText(this.copy.selectedCount(this.selected.size));
  }
}

export class InsightsSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost;
  private progressDraft: DeliveryProgressSettings;
  private progressTotalEl: HTMLElement | null = null;
  private progressErrorEl: HTMLElement | null = null;
  private progressSaveButtonEl: HTMLButtonElement | null = null;

  constructor(app: App, plugin: SettingsHost & Plugin) {
    super(app, plugin);
    this.host = plugin;
    this.progressDraft = structuredClone(this.host.settings.deliveryProgress);
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
        type: "group",
        heading: t.progressSettingsHeading,
        items: [
          {
            name: t.showDeliveryProgress,
            desc: t.showDeliveryProgressDesc,
            control: {
              type: "toggle",
              key: "showDeliveryProgress"
            }
          },
          this.progressStageDefinition("design", t.designStage, t),
          this.progressStageDefinition("development", t.developmentStage, t),
          this.progressStageDefinition("testing", t.testingStage, t),
          {
            name: t.acceptanceWeight,
            desc: t.acceptanceWeightDesc,
            render: (setting) => this.renderAcceptanceWeight(setting, t)
          },
          {
            name: t.saveProgressSettings,
            desc: t.progressSettingsDesc,
            render: (setting) => this.renderProgressSave(setting, t)
          }
        ]
      },
      {
        type: "group",
        heading: t.aliases,
        cls: "pmi-alias-group",
        extraButtons: [
          (button) => button
            .setIcon("plus")
            .setTooltip(t.addAlias)
            .onClick(() => void this.addAlias())
        ],
        items: [
          {
            name: t.aliasGuideTitle,
            desc: t.aliasGuideBody,
            aliases: [t.aliasesDesc, t.canonicalName, t.aliasNames],
            render: (setting) => this.renderAliasGuide(setting, t)
          },
          ...this.host.settings.aliases.map((alias, index) =>
            this.aliasDefinition(alias, index, t)
          )
        ]
      }
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "locale") return this.host.settings.locale;
    if (key === "showDeliveryProgress") return this.host.settings.showDeliveryProgress;
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "locale" && this.isLocale(value)) {
      this.host.settings.locale = value;
      await this.host.saveSettings();
      await this.host.refreshInsights();
      this.updateDefinitions();
      return;
    }
    if (key !== "showDeliveryProgress" || typeof value !== "boolean") return;
    this.host.settings.showDeliveryProgress = value;
    await this.host.saveSettings();
    await this.host.refreshInsights();
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

    this.renderAliasGuide(new Setting(containerEl), t);

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

    new Setting(containerEl)
      .setName(t.progressSettingsHeading)
      .setDesc(t.progressSettingsDesc)
      .setHeading();
    new Setting(containerEl)
      .setName(t.showDeliveryProgress)
      .setDesc(t.showDeliveryProgressDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.host.settings.showDeliveryProgress)
          .onChange(async (value) => {
            this.host.settings.showDeliveryProgress = value;
            await this.host.saveSettings();
            await this.host.refreshInsights();
          })
      );
    this.renderProgressStage(
      new Setting(containerEl).setName(t.designStage),
      "design",
      t
    );
    this.renderProgressStage(
      new Setting(containerEl).setName(t.developmentStage),
      "development",
      t
    );
    this.renderProgressStage(
      new Setting(containerEl).setName(t.testingStage),
      "testing",
      t
    );
    this.renderAcceptanceWeight(
      new Setting(containerEl).setName(t.acceptanceWeight).setDesc(t.acceptanceWeightDesc),
      t
    );
    this.renderProgressSave(new Setting(containerEl).setName(t.saveProgressSettings), t);
  }

  private progressStageDefinition(
    stageId: DeliveryStageId,
    name: string,
    t: Translations
  ): SettingDefinition {
    return {
      name,
      desc: t.progressSettingsDesc,
      render: (setting) => this.renderProgressStage(setting, stageId, t)
    };
  }

  private renderProgressStage(
    setting: Setting,
    stageId: DeliveryStageId,
    t: Translations
  ): void {
    const stage = this.progressDraft.stages[stageId];
    setting.settingEl.addClass("pmi-progress-setting");
    setting.addText((input) => {
      input
        .setPlaceholder(t.stageTags)
        .setValue(stage.tags.join(", "))
        .onChange((value) => {
          stage.tags = this.parseAliases(value);
          this.updateProgressValidation();
        });
      input.inputEl.addClass("pmi-progress-tags-input");
      input.inputEl.setAttribute("aria-label", t.stageTags);
      const field = setting.controlEl.createDiv("pmi-progress-tag-field");
      setting.controlEl.insertBefore(field, input.inputEl);
      field.appendChild(input.inputEl);
      const pickerButton = field.createEl("button", {
        cls: "clickable-icon pmi-progress-tag-picker",
        attr: {
          type: "button",
          "aria-label": t.chooseProjectTags,
          "data-tooltip-position": "top"
        }
      });
      pickerButton.setAttribute("aria-label", t.chooseProjectTags);
      setIcon(pickerButton, "tags");
      pickerButton.addEventListener("click", () => {
        void this.openProjectTagPicker(stageId, input.inputEl, t);
      });
    });
    this.addWeightInput(setting, stage.weight, t.stageWeight, (value) => {
      stage.weight = value;
    });
    this.addCheckbox(
      setting,
      t.acceptancePrerequisite,
      stage.acceptancePrerequisite,
      (checked) => this.saveProgressStageFlag(stageId, "acceptancePrerequisite", checked)
    );
    this.addCheckbox(
      setting,
      t.skipEmptyStatistics,
      stage.skipWhenEmpty,
      (checked) => this.saveProgressStageFlag(stageId, "skipWhenEmpty", checked)
    );
  }

  private async openProjectTagPicker(
    stageId: DeliveryStageId,
    inputEl: HTMLInputElement,
    t: Translations
  ): Promise<void> {
    try {
      const snapshot = await this.host.readProjectManager();
      const options = collectProjectTagOptions(snapshot.tasks);
      const optionTags = new Set(options.map((option) => option.tag));
      const stage = this.progressDraft.stages[stageId];
      const normalizedSelected = stage.tags
        .map(normalizeProgressTag)
        .filter(Boolean);
      const manualTags = stage.tags.filter((tag) => !optionTags.has(normalizeProgressTag(tag)));
      const reservedBy = this.reservedProjectTags(stageId, options, t);
      const copy: ProjectTagPickerCopy = {
        title: t.chooseProjectTags,
        description: t.projectTagsDescription,
        searchPlaceholder: t.searchProjectTags,
        empty: t.noProjectTags,
        noMatches: t.noMatchingProjectTags,
        taskCount: t.projectTagTaskCount,
        selectedCount: t.projectTagsSelected,
        usedBy: t.projectTagUsedBy,
        cancel: t.cancel,
        apply: t.applyProjectTags
      };

      new ProjectTagPickerModal(
        this.app,
        options,
        normalizedSelected.filter((tag) => optionTags.has(tag)),
        reservedBy,
        copy,
        (selected) => {
          stage.tags = [...manualTags, ...selected];
          inputEl.value = stage.tags.join(", ");
          inputEl.dispatchEvent(new Event("input", { bubbles: true }));
          this.updateProgressValidation();
        }
      ).open();
    } catch {
      new Notice(t.projectManagerUnavailable);
    }
  }

  private reservedProjectTags(
    currentStageId: DeliveryStageId,
    options: readonly ProjectTagOption[],
    t: Translations
  ): Map<string, string> {
    const stageNames: Record<DeliveryStageId, string> = {
      design: t.designStage,
      development: t.developmentStage,
      testing: t.testingStage
    };
    const reserved = new Map<string, string>();
    for (const option of options) {
      for (const stageId of ["design", "development", "testing"] as const) {
        if (stageId === currentStageId) continue;
        const conflicts = this.progressDraft.stages[stageId].tags.some((tag) => {
          const mapped = normalizeProgressTag(tag);
          return mapped && (
            option.tag === mapped
            || option.tag.startsWith(`${mapped}/`)
            || mapped.startsWith(`${option.tag}/`)
          );
        });
        if (conflicts) {
          reserved.set(option.tag, stageNames[stageId]);
          break;
        }
      }
    }
    return reserved;
  }

  private renderAcceptanceWeight(setting: Setting, t: Translations): void {
    setting.settingEl.addClass("pmi-progress-setting", "pmi-progress-setting--acceptance");
    this.addWeightInput(
      setting,
      this.progressDraft.acceptanceWeight,
      t.stageWeight,
      (value) => {
        this.progressDraft.acceptanceWeight = value;
      }
    );
  }

  private addWeightInput(
    setting: Setting,
    value: number,
    label: string,
    onChange: (value: number) => void
  ): void {
    setting.addText((input) => {
      input.setValue(String(value)).onChange((raw) => {
        const parsed = Number(raw);
        onChange(raw.trim() && Number.isFinite(parsed) ? parsed : Number.NaN);
        this.updateProgressValidation();
      });
      input.inputEl.type = "number";
      input.inputEl.min = "0";
      input.inputEl.max = "100";
      input.inputEl.step = "1";
      input.inputEl.addClass("pmi-progress-weight-input");
      input.inputEl.setAttribute("aria-label", label);
    });
  }

  private addCheckbox(
    setting: Setting,
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void | Promise<void>
  ): void {
    const wrapper = setting.controlEl.createEl("label", { cls: "pmi-progress-checkbox" });
    const checkbox = wrapper.createEl("input", { type: "checkbox" });
    checkbox.checked = checked;
    wrapper.createSpan({ text: label });
    checkbox.addEventListener("change", () => void onChange(checkbox.checked));
  }

  private async saveProgressStageFlag(
    stageId: DeliveryStageId,
    key: "acceptancePrerequisite" | "skipWhenEmpty",
    checked: boolean
  ): Promise<void> {
    this.progressDraft.stages[stageId][key] = checked;
    this.host.settings.deliveryProgress.stages[stageId][key] = checked;
    await this.host.saveSettings();
    await this.host.refreshInsights();
  }

  private renderProgressSave(setting: Setting, t: Translations): void {
    setting.settingEl.addClass("pmi-progress-save");
    this.progressTotalEl = setting.descEl.createSpan("pmi-progress-weight-total");
    this.progressErrorEl = setting.descEl.createDiv("pmi-progress-weight-error");
    setting.addButton((button) => {
      button.setButtonText(t.saveProgressSettings).setCta().onClick(async () => {
        if (!this.progressSettingsValid()) return;
        this.host.settings.deliveryProgress = structuredClone(this.progressDraft);
        await this.host.saveSettings();
        await this.host.refreshInsights();
      });
      this.progressSaveButtonEl = button.buttonEl;
    });
    this.updateProgressValidation(t);
  }

  private progressSettingsValid(): boolean {
    const weights = [
      ...Object.values(this.progressDraft.stages).map((stage) => stage.weight),
      this.progressDraft.acceptanceWeight
    ];
    return weights.every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 100)
      && Math.abs(deliveryWeightTotal(this.progressDraft) - 100) < 0.001
      && !hasDeliveryTagMappingConflict(this.progressDraft);
  }

  private updateProgressValidation(t = translations(this.host.settings)): void {
    const total = deliveryWeightTotal(this.progressDraft);
    this.progressTotalEl?.setText(t.weightTotal(Number.isFinite(total) ? total : 0));
    const valid = this.progressSettingsValid();
    const weightInvalid = !Number.isFinite(total) || Math.abs(total - 100) >= 0.001;
    this.progressErrorEl?.setText(
      valid ? "" : weightInvalid ? t.weightTotalInvalid : t.tagMappingConflict
    );
    if (this.progressSaveButtonEl) this.progressSaveButtonEl.disabled = !valid;
  }

  private renderAliasGuide(setting: Setting, t: Translations): void {
    setting
      .setName(t.aliasGuideTitle)
      .setDesc(t.aliasGuideBody);
    setting.settingEl.addClass("pmi-alias-guide");

    const equation = setting.controlEl.createDiv({
      cls: "pmi-alias-equation",
      attr: { "aria-label": t.aliasGuideEquation }
    });
    const canonical = equation.createDiv("pmi-alias-example pmi-alias-example--canonical");
    canonical.createSpan({ cls: "pmi-alias-example-label", text: t.canonicalName });
    canonical.createEl("code", { text: t.aliasGuideCanonicalExample });

    const arrow = equation.createSpan({ cls: "pmi-alias-merge-arrow", attr: { "aria-hidden": "true" } });
    setIcon(arrow, "arrow-left");

    const source = equation.createDiv("pmi-alias-example pmi-alias-example--source");
    source.createSpan({ cls: "pmi-alias-example-label", text: t.aliasGuideSource });
    const aliases = source.createDiv("pmi-alias-example-values");
    for (const alias of t.aliasGuideAliasesExample) {
      aliases.createEl("code", { text: alias });
    }
    equation.createDiv({ cls: "pmi-alias-guide-result", text: t.aliasGuideResult });
  }

  private aliasDefinition(
    alias: MemberAlias,
    index: number,
    t: Translations
  ): SettingDefinition {
    return {
      name: alias.canonical || t.canonicalName,
      desc: alias.aliases.length > 0 ? alias.aliases.join(", ") : t.aliasesDesc,
      render: (setting) => {
        setting
          .setName("")
          .setDesc("")
          .addText((input) => {
            input
              .setPlaceholder(t.canonicalName)
              .setValue(alias.canonical)
              .onChange(async (value) => {
                alias.canonical = value;
                await this.host.saveSettings();
                await this.host.refreshInsights();
              });
            input.inputEl.addClass("pmi-alias-canonical-input");
            input.inputEl.setAttribute("aria-label", t.canonicalName);
          })
          .addText((input) => {
            input
              .setPlaceholder(t.aliasNames)
              .setValue(alias.aliases.join(", "))
              .onChange(async (value) => {
                alias.aliases = this.parseAliases(value);
                await this.host.saveSettings();
                await this.host.refreshInsights();
              });
            input.inputEl.addClass("pmi-alias-names-input");
            input.inputEl.setAttribute("aria-label", t.aliasNames);
          })
          .addExtraButton((button) =>
            button.setIcon("x").setTooltip(t.removeAlias).onClick(() => {
              void this.deleteAlias(index);
            })
          );
        setting.settingEl.addClass("pmi-alias-setting");
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
    const setting = new Setting(this.containerEl);
    setting
      .addText((input) => {
        input
          .setPlaceholder(t.canonicalName)
          .setValue(alias.canonical)
          .onChange(async (value) => {
            alias.canonical = value;
            await this.host.saveSettings();
            await this.host.refreshInsights();
          });
        input.inputEl.addClass("pmi-alias-canonical-input");
        input.inputEl.setAttribute("aria-label", t.canonicalName);
      })
      .addText((input) => {
        input
          .setPlaceholder(t.aliasNames)
          .setValue(alias.aliases.join(", "))
          .onChange(async (value) => {
            alias.aliases = this.parseAliases(value);
            await this.host.saveSettings();
            await this.host.refreshInsights();
          });
        input.inputEl.addClass("pmi-alias-names-input");
        input.inputEl.setAttribute("aria-label", t.aliasNames);
      })
      .addExtraButton((button) =>
        button.setIcon("trash-2").setTooltip(t.removeAlias).onClick(async () => {
          this.host.settings.aliases.splice(index, 1);
          await this.host.saveSettings();
          await this.host.refreshInsights();
          this.renderLegacySettings();
        })
      );
    setting.settingEl.addClass("pmi-alias-setting");
  }
}
