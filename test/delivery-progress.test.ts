import { describe, expect, it } from "vitest";
import {
  aggregateDeliveryProgress,
  deliveryWeightTotal,
  hasDeliveryTagMappingConflict,
  normalizeProgressTag
} from "../src/domain/delivery-progress";
import { DEFAULT_SETTINGS, type DeliveryProgressSettings, type TaskRecord } from "../src/model";

function task(overrides: Partial<TaskRecord> & Pick<TaskRecord, "id">): TaskRecord {
  const { id, ...rest } = overrides;
  return {
    id,
    projectId: "p1",
    parentId: null,
    hierarchy: "subtask",
    title: id,
    path: `Tasks/${id}.md`,
    status: "todo",
    priority: null,
    tags: [],
    assignees: [],
    estimate: 0,
    logged: 0,
    progress: 0,
    completed: false,
    archived: false,
    ...rest
  };
}

function root(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return task({ id, hierarchy: "root", ...overrides });
}

function settings(): DeliveryProgressSettings {
  return structuredClone(DEFAULT_SETTINGS.deliveryProgress);
}

const options = (progressSettings = settings(), includeArchived = false) => ({
  projectIds: new Set(["p1"]),
  includeArchived,
  settings: progressSettings
});

describe("aggregateDeliveryProgress", () => {
  it("normalizes hierarchical tags and classifies leaf descendants recursively", () => {
    const snapshot = aggregateDeliveryProgress([
      root("root"),
      task({ id: "group", parentId: "root", tags: ["type/dev"] }),
      task({
        id: "frontend",
        parentId: "group",
        tags: [" #TYPE/dev/Frontend "],
        completed: true
      }),
      task({ id: "backend", parentId: "group", tags: ["type/dev/backend"] })
    ], options());

    expect(normalizeProgressTag(" #TYPE/dev/Frontend ")).toBe("type/dev/frontend");
    expect(snapshot.stages.development).toMatchObject({
      completed: 1,
      total: 2,
      percentage: 50,
      state: "progress"
    });
    expect(snapshot.quality.unclassifiedTaskCount).toBe(0);
  });

  it("detects overlapping tag hierarchies across stage mappings", () => {
    const progressSettings = settings();
    progressSettings.stages.testing.tags = ["type/dev/frontend"];
    expect(hasDeliveryTagMappingConflict(progressSettings)).toBe(true);
    progressSettings.stages.testing.tags = ["type/test"];
    expect(hasDeliveryTagMappingConflict(progressSettings)).toBe(false);
  });

  it("derives pending and accepted states from prerequisites and the root completion", () => {
    const snapshot = aggregateDeliveryProgress([
      root("accepted", { completed: true }),
      task({ id: "accepted-dev", parentId: "accepted", tags: ["type/dev"], completed: true }),
      task({ id: "accepted-test", parentId: "accepted", tags: ["type/test"], completed: true }),
      root("pending"),
      task({ id: "pending-dev", parentId: "pending", tags: ["type/dev"], completed: true }),
      root("blocked"),
      task({ id: "blocked-dev", parentId: "blocked", tags: ["type/dev"] })
    ], options());

    expect(snapshot.acceptance).toMatchObject({
      accepted: 1,
      pending: 1,
      notReady: 1,
      total: 3,
      percentage: 33.33
    });
    expect(snapshot.quality.missingPrerequisiteCount).toBe(0);
  });

  it("blocks absent prerequisites unless the mapping skips empty work", () => {
    const strict = settings();
    strict.stages.testing.skipWhenEmpty = false;
    const strictSnapshot = aggregateDeliveryProgress([
      root("root"),
      task({ id: "dev", parentId: "root", tags: ["type/dev"], completed: true })
    ], options(strict));

    expect(strictSnapshot.acceptance).toMatchObject({ pending: 0, notReady: 1 });
    expect(strictSnapshot.stages.testing.state).toBe("missing");
    expect(strictSnapshot.quality.missingPrerequisiteCount).toBe(1);

    strict.stages.testing.skipWhenEmpty = true;
    const skippedSnapshot = aggregateDeliveryProgress([
      root("root"),
      task({ id: "dev", parentId: "root", tags: ["type/dev"], completed: true })
    ], options(strict));
    expect(skippedSnapshot.acceptance).toMatchObject({ pending: 1, notReady: 0 });
    expect(skippedSnapshot.stages.testing.state).toBe("skipped");
  });

  it("renormalizes total progress after removing skipped stage weights", () => {
    const progressSettings = settings();
    const snapshot = aggregateDeliveryProgress([
      root("one", { completed: true }),
      task({ id: "one-dev", parentId: "one", tags: ["type/dev"], completed: true }),
      task({ id: "one-test", parentId: "one", tags: ["type/test"], completed: true }),
      root("two"),
      task({ id: "two-dev", parentId: "two", tags: ["type/dev"] }),
      task({ id: "two-test", parentId: "two", tags: ["type/test"], completed: true })
    ], options(progressSettings));

    expect(snapshot.stages.design.state).toBe("skipped");
    expect(snapshot.totalPercentage).toBe(66.67);
    expect(deliveryWeightTotal(progressSettings)).toBe(100);
  });

  it("reports conflicting, unclassified and unlinked leaf tasks without counting them", () => {
    const snapshot = aggregateDeliveryProgress([
      root("root"),
      task({ id: "conflict", parentId: "root", tags: ["type/dev", "type/test"] }),
      task({ id: "unclassified", parentId: "root", tags: ["backend"] }),
      task({ id: "unlinked", parentId: "missing", tags: ["type/dev"] })
    ], options());

    expect(snapshot.stages.development.total).toBe(0);
    expect(snapshot.stages.testing.total).toBe(0);
    expect(snapshot.quality).toMatchObject({
      conflictingTaskCount: 1,
      unclassifiedTaskCount: 1,
      unlinkedTaskCount: 1
    });
  });

  it("excludes cancelled root trees and applies archive propagation", () => {
    const tasks = [
      root("cancelled", { status: "cancelled", completed: true }),
      task({ id: "cancelled-dev", parentId: "cancelled", tags: ["type/dev"] }),
      root("archived", { archived: true }),
      task({ id: "archived-dev", parentId: "archived", tags: ["type/dev"] }),
      root("active"),
      task({ id: "active-dev", parentId: "active", tags: ["type/dev"], completed: true })
    ];

    expect(aggregateDeliveryProgress(tasks, options()).rootTaskCount).toBe(1);
    expect(aggregateDeliveryProgress(tasks, options()).stages.development.total).toBe(1);
    expect(aggregateDeliveryProgress(tasks, options(settings(), true)).rootTaskCount).toBe(2);
    expect(aggregateDeliveryProgress(tasks, options(settings(), true)).stages.development.total).toBe(2);
  });

  it("does not accept a completed root before its prerequisites are met", () => {
    const snapshot = aggregateDeliveryProgress([
      root("root", { completed: true }),
      task({ id: "dev", parentId: "root", tags: ["type/dev"] })
    ], options());

    expect(snapshot.acceptance).toMatchObject({ accepted: 0, pending: 0, notReady: 1 });
    expect(snapshot.quality.prematureCompletionCount).toBe(1);
  });
});
