const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");

const root = resolve(__dirname, "../..");
const backendRequire = createRequire(
  resolve(root, "packages/nocodb/package.json")
);
const guiRequire = createRequire(resolve(root, "packages/nc-gui/package.json"));
const ts = backendRequire("typescript");
const { computed, ref } = guiRequire("vue");

function compile(source, bindings) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  });
  const module = { exports: {} };
  new Function("module", "exports", ...Object.keys(bindings), outputText)(
    module,
    module.exports,
    ...Object.values(bindings)
  );
  return module.exports;
}

// Exercise the actual service methods with isolated database collaborators. This
// avoids booting Nest, Redis, or a database just to verify metadata scheduling.
function methods(file, className, names, bindings) {
  const source = ts.createSourceFile(
    file,
    readFileSync(resolve(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const cls = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name.text === className
  );
  const members = cls.members.filter(
    (node) => node.name && names.includes(node.name.getText(source))
  );
  assert.equal(members.length, names.length);
  return compile(
    `class ${className} { ${members
      .map((node) => node.getText(source))
      .join("\n")} }\nmodule.exports = ${className};`,
    bindings
  );
}

const { NcConcurrent } = compile(
  readFileSync(
    resolve(root, "packages/nocodb/src/utils/NcConcurrent.ts"),
    "utf8"
  ),
  {
    require: backendRequire,
    AbortController,
  }
);
const context = { workspace_id: "workspace", base_id: "base" };
const roles = {
  OWNER: "owner",
  CREATOR: "creator",
  VIEWER: "viewer",
  EDITOR: "editor",
  COMMENTER: "commenter",
  GUEST: "guest",
};
const tableFile = "packages/nocodb/src/services/tables.service.ts";

function service(overrides = {}) {
  const bindings = {
    NcConcurrent,
    Model: { list: async () => [] },
    ModelRoleVisibility: { list: async () => [] },
    View: {
      maskPasswordForResponse: (view) => ({
        ...view,
        password: view.password ? "MASKED" : null,
      }),
    },
    ProjectRoles: roles,
    Permission: { list: async () => [] },
    isServiceUser: () => false,
    hasTableVisibilityAccess: async () => true,
    hasDefaultTableVisibility: () => true,
    hasViewersAndUpTableVisibility: () => false,
    ...overrides,
  };
  const Class = methods(
    tableFile,
    "TablesService",
    ["xcVisibilityMetaGet", "getAccessibleTables"],
    bindings
  );
  return new Class();
}

function model(id, extra = {}) {
  return {
    id,
    table_name: id,
    title: id,
    type: "table",
    meta: {},
    getViews: async () => [
      { id: `view-${id}`, fk_model_id: id, title: id, password: null },
    ],
    ...extra,
  };
}

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

test("view metadata loads concurrently, stays ordered, masks passwords, and isolates role flags", async () => {
  let active = 0;
  let peak = 0;
  const models = Array.from({ length: 8 }, (_, i) =>
    model(String(i), {
      getViews: async () => {
        peak = Math.max(peak, ++active);
        await delay((8 - i) * 2);
        active--;
        return [
          {
            id: `view-${i}`,
            fk_model_id: String(i),
            title: String(i),
            password: "bcrypt-secret",
          },
        ];
      },
    })
  );
  const s = service({
    ModelRoleVisibility: {
      list: async () => [
        { fk_view_id: "view-0", role: "viewer", disabled: true },
      ],
    },
  });
  const views = await s.xcVisibilityMetaGet(context, "base", models);
  assert.equal(peak, 3);
  assert.deepEqual(
    views.map((v) => v.id),
    models.map((m) => `view-${m.id}`)
  );
  assert.ok(views.every((v) => v.password === "MASKED"));
  assert.equal(views[0].disabled.viewer, true);
  assert.equal(views[1].disabled.viewer, false);
});

test("metadata loading propagates failure instead of returning partial permissions", async () => {
  const failure = new Error("database unavailable");
  await assert.rejects(
    service().xcVisibilityMetaGet(context, "base", [
      model("a", {
        getViews: async () => {
          throw failure;
        },
      }),
    ]),
    (error) => error === failure
  );
});

test("empty bases return no views", async () => {
  assert.deepEqual(
    await service().xcVisibilityMetaGet(context, "base", []),
    []
  );
});

test("table listing reuses the source-scoped model query and excludes junction metadata", async () => {
  let calls = 0;
  let junctionReads = 0;
  const s = service({
    Model: {
      list: async (ctx, query) => {
        calls++;
        assert.equal(ctx, context);
        assert.deepEqual(query, { base_id: "base", source_id: "source" });
        return [
          model("a"),
          model("junction", {
            mm: true,
            getViews: async () => {
              junctionReads++;
              return [];
            },
          }),
        ];
      },
    },
  });
  const tables = await s.getAccessibleTables(context, {
    baseId: "base",
    sourceId: "source",
    roles: { owner: true },
    user: {},
  });
  assert.deepEqual(
    tables.map((m) => m.id),
    ["a"]
  );
  assert.equal(calls, 1);
  assert.equal(junctionReads, 0);
});

test("allSources and includeM2M retain all eligible tables", async () => {
  const s = service({
    Model: {
      list: async (_ctx, query) => {
        assert.equal(query.source_id, undefined);
        return [model("a"), model("junction", { mm: true })];
      },
    },
  });
  const tables = await s.getAccessibleTables(context, {
    baseId: "base",
    sourceId: "source",
    allSources: true,
    includeM2M: true,
    roles: { owner: true },
    user: {},
  });
  assert.deepEqual(
    tables.map((m) => m.id),
    ["a", "junction"]
  );
});

test("view role restrictions and table visibility permissions remain enforced", async () => {
  const s = service({
    Model: {
      list: async () => [
        model("hidden-view"),
        model("hidden-table"),
        model("allowed"),
      ],
    },
    ModelRoleVisibility: {
      list: async () => [
        { fk_view_id: "view-hidden-view", role: "viewer", disabled: true },
      ],
    },
    hasTableVisibilityAccess: async (_ctx, id) => id !== "hidden-table",
  });
  const tables = await s.getAccessibleTables(context, {
    baseId: "base",
    roles: { viewer: true },
    user: { id: "user" },
  });
  assert.deepEqual(
    tables.map((m) => m.id),
    ["allowed"]
  );
});

test("public bases retain only default or viewers-and-up table visibility", async () => {
  const s = service({
    Model: {
      list: async () => [model("default"), model("viewers"), model("private")],
    },
    hasDefaultTableVisibility: (id) => id === "default",
    hasViewersAndUpTableVisibility: (id) => id === "viewers",
    hasTableVisibilityAccess: async () => {
      throw new Error("public requests must not use user permissions");
    },
  });
  const tables = await s.getAccessibleTables(context, {
    baseId: "base",
    roles: { viewer: true },
    user: {},
    isPublicBase: true,
  });
  assert.deepEqual(
    tables.map((m) => m.id),
    ["default", "viewers"]
  );
});

test("individual view hydration is bounded and preserves input order", async () => {
  let active = 0;
  let peak = 0;
  const list = Array.from({ length: 9 }, (_, i) => ({
    id: i,
    getViewWithInfo: async (meta) => {
      assert.equal(meta, "meta");
      peak = Math.max(peak, ++active);
      await delay((9 - i) * 2);
      active--;
    },
  }));
  const View = methods(
    "packages/nocodb/src/models/View.ts",
    "View",
    ["listWithInfo"],
    { NcConcurrent }
  );
  View.list = async () => list;
  assert.equal(await View.listWithInfo(context, "table", "meta"), list);
  assert.equal(peak, 4);
});

test("individual view hydration propagates errors", async () => {
  const View = methods(
    "packages/nocodb/src/models/View.ts",
    "View",
    ["listWithInfo"],
    { NcConcurrent }
  );
  View.list = async () => [
    {
      getViewWithInfo: async () => {
        throw new Error("hydration failed");
      },
    },
  ];
  await assert.rejects(
    View.listWithInfo(context, "table", "meta"),
    /hydration failed/
  );
});

test("frozen-column width is cached and invalidated when widths or frozen state change", () => {
  const file =
    "packages/nc-gui/components/smartsheet/grid/canvas/composables/useCanvasRender.ts";
  const source = ts.createSourceFile(
    file,
    readFileSync(resolve(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  let initializer;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "fixedColumnsWidth"
    )
      initializer = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(initializer);
  let parses = 0;
  const columns = ref([
    { fixed: true, width: "100px" },
    { fixed: false, width: "90px" },
    { fixed: true, width: "45px" },
  ]);
  const width = compile(`module.exports = ${initializer};`, {
    columns,
    computed,
    parseCellWidth: (value) => {
      parses++;
      return parseFloat(value);
    },
  });
  assert.equal(width.value, 145);
  for (let i = 0; i < 100; i++) assert.equal(width.value, 145);
  assert.equal(parses, 2);
  columns.value[0].width = "120px";
  assert.equal(width.value, 165);
  columns.value[1].fixed = true;
  assert.equal(width.value, 255);
  columns.value = [];
  assert.equal(width.value, 0);
});

test("telemetry calls schedule no timers and perform no external work", async () => {
  let machineIdReads = 0;
  const { Tele } = compile(
    readFileSync(resolve(root, "packages/nocodb/src/utils/tele.ts"), "utf8"),
    {
      require: (name) => {
        assert.equal(name, "node-machine-id");
        return {
          machineIdSync: () => {
            machineIdReads++;
            return "stable-server-id";
          },
        };
      },
      setTimeout: () => {
        throw new Error("telemetry timer");
      },
      setInterval: () => {
        throw new Error("telemetry interval");
      },
    }
  );
  Tele.init({
    instance: () => {
      throw new Error("instance scan");
    },
  });
  Tele.emit("evt", { evt_type: "a:sync-request:test" });
  Tele.page({});
  Tele.event({});
  assert.equal(await Tele.payload(), null);
  assert.equal(machineIdReads, 0);
  assert.equal(Tele.id, "stable-server-id");
});

test("legacy promotional API endpoints return empty responses", async () => {
  const Utils = methods(
    "packages/nocodb/src/services/utils.service.ts",
    "UtilsService",
    ["feed", "cloudFeatures"],
    {}
  );
  const s = new Utils();
  assert.deepEqual(await s.feed({ query: {} }), []);
  assert.deepEqual(await s.cloudFeatures({ query: {} }), []);
});

test("app info disables promotional services without scanning instance usage", async () => {
  let firstUserChecks = 0;
  const Utils = methods(
    "packages/nocodb/src/services/utils.service.ts",
    "UtilsService",
    ["appInfo"],
    {
      User: {
        isFirst: async () => {
          firstUserChecks++;
          return false;
        },
      },
      Noco: {
        isEE: () => false,
        getAppSettings: async () => ({}),
        getConfig: () => ({ meta: { db: { client: "pg" } } }),
      },
      process,
      isCloud: false,
      isEE: false,
      isOnPrem: true,
      packageVersion: "test",
      defaultLimitConfig: { limitDefault: 25, limitMin: 1, limitMax: 1000 },
      defaultGroupByLimitConfig: {},
      defaultConnectionConfig: {},
      DriverClient: { SQLITE: "sqlite3" },
      NC_DISABLE_UNDO_REDO: false,
      NC_DISABLE_GROUP_BY_AGG: false,
      NC_ATTACHMENT_FIELD_SIZE: 0,
      NC_MAX_ATTACHMENTS_ALLOWED: 0,
      NC_MAX_TEXT_LENGTH: 0,
      NC_DATA_IMPORT_FILE_SIZE: 0,
      NC_GRID_MAX_SELECTION_LIMIT: 0,
    }
  );
  const s = new Utils();
  s.configService = { get: () => false };
  const info = await s.appInfo({ req: { ncSiteUrl: "http://localhost:8080" } });
  assert.equal(info.teleEnabled, false);
  assert.equal(info.feedEnabled, false);
  assert.equal(info.disableSupportChat, true);
  assert.equal(info.giftUrl, null);
  assert.equal(firstUserChecks, 1);
  assert.equal(info.defaultLimit, 25);
});

test("frontend instrumentation stays callable without listeners or a socket", () => {
  const plugin = compile(
    readFileSync(resolve(root, "packages/nc-gui/plugins/tele.ts"), "utf8"),
    {
      defineNuxtPlugin: (fn) => fn,
    }
  ).default;
  const provided = {};
  plugin({
    vueApp: {
      directive: (name, hooks) => {
        assert.equal(name, "e");
        assert.deepEqual(hooks, {});
      },
    },
    provide: (name, value) => {
      provided[name] = value;
    },
  });
  provided.e("event", { data: "example" });
  provided.tele.emit("event", {});
});
