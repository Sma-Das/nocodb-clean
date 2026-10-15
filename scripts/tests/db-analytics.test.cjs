const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const root = resolve(__dirname, "../..");
const backendRequire = createRequire(
  resolve(root, "packages/nocodb/package.json"),
);
const guiRequire = createRequire(resolve(root, "packages/nc-gui/package.json"));
const ts = backendRequire("typescript");
const knex = backendRequire("knex");

// Like clean-performance.test.cjs, execute the actual application methods with
// isolated collaborators rather than booting the entire metadata/auth stack.
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
    ...Object.values(bindings),
  );
  return module.exports;
}
function source(file) {
  return ts.createSourceFile(
    file,
    readFileSync(resolve(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}
function find(file, predicate) {
  const ast = source(file);
  let found;
  function visit(node) {
    if (predicate(node, ast)) found = node;
    else ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `Declaration in ${file}`);
  return found.getText(ast);
}
function method(file, name, bindings) {
  const text = find(
    file,
    (node, ast) =>
      ts.isMethodDeclaration(node) && node.name.getText(ast) === name,
  );
  const C = compile(
    `class Subject { ${text} }; module.exports = Subject;`,
    bindings,
  );
  return new C();
}

test("analytics permission is base-scoped and granted only to base creators/owners", () => {
  const enums = compile(
    readFileSync(resolve(root, "packages/nocodb-sdk/src/lib/enums.ts"), "utf8"),
    {},
  );
  const acl = compile(
    readFileSync(resolve(root, "packages/nocodb/src/utils/acl.ts"), "utf8"),
    {
      require: (name) => {
        assert.equal(name, "nocodb-sdk");
        return enums;
      },
    },
  );
  assert.ok(acl.permissionScopes.base.includes("sourceAnalytics"));
  assert.ok(!acl.permissionScopes.workspace.includes("sourceAnalytics"));
  for (const role of [
    enums.ProjectRoles.VIEWER,
    enums.ProjectRoles.COMMENTER,
    enums.ProjectRoles.EDITOR,
    enums.ProjectRoles.APP_USER,
  ]) {
    assert.ok(!acl.default[role].include.sourceAnalytics);
  }
  for (const role of [enums.ProjectRoles.CREATOR, enums.ProjectRoles.OWNER]) {
    assert.ok(!acl.default[role].exclude.sourceAnalytics);
  }
});

test("actual count and conditionV2 keep OR filters inside view/custom/RLS/where restrictions", async () => {
  const db = new DatabaseSync(":memory:");
  const builder = knex({ client: "pg" });
  try {
    db.exec(
      "CREATE TABLE records (id INTEGER PRIMARY KEY, visible INTEGER, tenant INTEGER, a INTEGER, b INTEGER, deleted INTEGER)",
    );
    db.exec(
      "INSERT INTO records VALUES (1,1,1,1,0,0),(2,1,1,0,1,0),(3,0,1,0,1,0),(4,1,2,0,1,0),(5,1,1,0,0,0),(6,1,1,0,1,1)",
    );
    let toggle = false;
    let view = [];
    class Filter {
      constructor(value) {
        Object.assign(this, value);
      }
      async getChildren() {
        return this.children || [];
      }
      async getColumn() {
        return { column_name: this.fk_column_id, uidt: "Number" };
      }
      static async supportToggle() {
        return toggle;
      }
      static async rootFilterList() {
        return view;
      }
    }
    const filter = (column, value, extra = {}) =>
      new Filter({
        fk_column_id: column,
        comparison_op: "eq",
        value,
        ...extra,
      });
    const path = "packages/nocodb/src/db/conditionV2.ts";
    const parser = find(
      path,
      (node) =>
        ts.isVariableDeclaration(node) &&
        node.name.getText() === "parseConditionV2",
    );
    const { conditionV2 } = compile(
      [
        find(
          path,
          (node) =>
            ts.isFunctionDeclaration(node) &&
            node.name?.text === "getLogicalOpMethod",
        ),
        find(
          path,
          (node) =>
            ts.isFunctionDeclaration(node) &&
            node.name?.text === "isFilterDisabled",
        ),
        `const ${parser};`,
        find(
          path,
          (node) =>
            ts.isFunctionDeclaration(node) && node.name?.text === "conditionV2",
        ),
        "module.exports = { conditionV2 };",
      ].join("\n"),
      {
        Filter,
        getModelContext: () => ({}),
        setModelContext: () => {},
        getRefColumnIfAlias: async (_context, column) => column,
        UITypes: { Number: "Number" },
        FieldHandler: {
          fromBaseModel: () => ({
            verifyFilters: async () => {},
            applyFilter: async (filter, column) => ({
              clause: (qb) => qb.where(column.column_name, filter.value),
            }),
          }),
        },
      },
    );
    let parsedWhere = [];
    const subject = method(
      "packages/nocodb/src/db/BaseModelSqlv2.ts",
      "count",
      {
        Filter,
        conditionV2,
        sanitize: (value) => value,
        extractFilterFromXwhere: () => ({ filters: parsedWhere }),
        debugCount: () => {},
      },
    );
    let generated;
    Object.assign(subject, {
      context: {},
      tnPath: "records",
      dbDriver: builder,
      model: {
        primaryKey: { column_name: "id" },
        getColumns: async () => [],
        getAliasColObjMap: async () => ({}),
      },
      _getListArgs: () => ({}),
      getRlsConditions: async () => [filter("tenant", 1)],
      getSoftDeleteFilter: async () => ({ deleted: 0 }),
      execAndParse: async (qb) => {
        generated = qb.toSQL();
        return db.prepare(generated.sql).get(...generated.bindings);
      },
    });
    const or = [filter("a", 1), filter("b", 1, { logical_op: "or" })];
    view = [filter("visible", 1)];
    subject.viewId = "view";
    assert.equal(await subject.count({ filterArr: or }), 2);
    assert.equal((generated.sql.match(/"a" = \?/g) || []).length, 1);
    assert.equal((generated.sql.match(/"b" = \?/g) || []).length, 1);
    subject.viewId = undefined;
    assert.equal(
      await subject.count({
        filterArr: or,
        customConditions: [filter("visible", 1)],
      }),
      2,
    );
    parsedWhere = [filter("visible", 1)];
    assert.equal(await subject.count({ filterArr: or }), 2);
    assert.equal(
      await subject.count({ filterArr: [filter("a", 1), filter("b", 1)] }),
      0,
    );
    const nestedNot = new Filter({
      is_group: true,
      logical_op: "not",
      children: or,
    });
    assert.equal(await subject.count({ filterArr: [nestedNot] }), 1);
    toggle = true;
    assert.equal(
      await subject.count({ filterArr: [filter("a", 1, { enabled: false })] }),
      3,
    );
    assert.equal(
      await subject.count({
        filterArr: [new Filter({ is_group: true, enabled: 0, children: or })],
      }),
      3,
    );
  } finally {
    db.close();
    await builder.destroy();
  }
});

test("bulk chunks upsert once, invalidate displaced rows, settle early and preserve deferred comments", async () => {
  const vue = guiRequire("vue");
  const cache = {
    cachedRows: vue.ref(
      new Map([[120, { row: { id: "a" }, rowMeta: { rowIndex: 120 } }]]),
    ),
    chunkStates: vue.ref(["loading", "loading", "loaded"]),
    totalRows: vue.ref(200),
  };
  const file = "packages/nc-gui/composables/useInfiniteData.ts";
  const process = find(
    file,
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "processBatch",
  );
  const comments = find(
    file,
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "loadBulkAggCommentsCount",
  );
  const helpers = compile(
    readFileSync(
      resolve(root, "packages/nc-gui/utils/infiniteCacheUtils.ts"),
      "utf8",
    ),
    {},
  );
  let calls = 0;
  let resolveComments;
  const commentResponse = new Promise((resolve) => {
    resolveComments = resolve;
  });
  const settled = [];
  const events = [];
  const row = (id, index) => ({ row: { id }, rowMeta: { rowIndex: index } });
  const pending = [0, 1].map((chunkId) => ({
    chunkId,
    path: [],
    resolve: () => settled.push(chunkId),
    reject: (error) => {
      throw error;
    },
  }));
  const run = compile(
    `let pendingChunkRequests = requests; let batchTimer = null; ${comments}\n${process}\nmodule.exports = processBatch;`,
    {
      requests: pending,
      CHUNK_SIZE: 50,
      isStaleChunkRequest: () => false,
      callbacks: {},
      isUIAllowed: () => true,
      sorts: vue.ref([]),
      nestedFilters: vue.ref([]),
      stringifyFilterOrSortArr: JSON.stringify,
      interfaceDataApi: null,
      isPublic: vue.ref(false),
      isInterfaceOnlyUser: vue.ref(false),
      meta: vue.ref({
        id: "table",
        base_id: "base",
        fk_workspace_id: "ws",
        columns: [],
      }),
      viewMeta: vue.ref({ id: "view" }),
      searchAbortSignal: vue.ref(undefined),
      $api: {
        internal: {
          postOperation: async () => ({
            chunk_0_: { list: [row("a", 0)], pageInfo: {} },
            chunk_1_: { list: [row("b", 50)], pageInfo: {} },
          }),
        },
      },
      getDataCache: () => cache,
      formatData: (rows) => rows,
      getEvaluatedRowMetaRowColorInfo: () => {},
      evaluateButtonVisibility: () => {},
      extractPkFromRow: (row) => row.id,
      upsertCachedRows: (...args) => {
        calls++;
        return helpers.upsertCachedRows(...args);
      },
      invalidateChunksAt: helpers.invalidateChunksAt,
      internalGet: () => commentResponse,
      eventBus: { emit: (event) => events.push(event) },
      SmartsheetStoreEvents: { TRIGGER_RE_RENDER: "paint" },
      axios: { isCancel: () => false },
      console,
    },
  );
  await run();
  assert.equal(calls, 2);
  assert.deepEqual(settled, [0, 1]);
  assert.equal(cache.cachedRows.value.has(120), false);
  assert.equal(cache.chunkStates.value[2], undefined);
  assert.equal(cache.cachedRows.value.get(0).rowMeta.commentCount, undefined);
  resolveComments([{ row_id: "a", count: 3 }]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cache.cachedRows.value.get(0).rowMeta.commentCount, 3);
  assert.deepEqual(events, ["paint"]);
});

test("actual analytics component loads, saves/restores views, rejects invalid thresholds and handles stale responses", async () => {
  const { Window } = await import(guiRequire.resolve("happy-dom"));
  const window = new Window({ url: "http://localhost" });
  // Set up the DOM before Vue's renderer is imported in this process.
  for (const key of [
    "window",
    "document",
    "Element",
    "HTMLElement",
    "SVGElement",
    "Node",
    "Event",
    "localStorage",
  ])
    global[key] = key === "window" ? window : window[key];
  // The cache test uses only reactivity; runtime-dom can have cached a null
  // document. Run this component with a renderer whose host uses this DOM.
  const vue = guiRequire("vue");
  const { parse, compileScript } = guiRequire("@vue/compiler-sfc");
  const file =
    "packages/nc-gui/components/dashboard/settings/SourceAnalytics.vue";
  const { descriptor, errors } = parse(
    readFileSync(resolve(root, file), "utf8"),
  );
  assert.deepEqual(errors, []);
  const compiled = compileScript(descriptor, {
    id: "analytics-test",
    inlineTemplate: true,
  });
  const strings = JSON.parse(
    readFileSync(resolve(root, "packages/nc-gui/lang/en.json"), "utf8"),
  ).sourceAnalytics;
  const t = (key, values = {}) =>
    Object.entries(values).reduce(
      (text, [name, value]) => text.replace(`{${name}}`, String(value)),
      strings[key.split(".").pop()] ?? key,
    );
  const pending = [];
  const payload = (count) => ({
    enabled: true,
    supported: true,
    sourceEnabled: true,
    metrics: {
      startedAt: 1,
      from: 1,
      to: 2,
      summary: {
        count,
        errors: 0,
        slow: 0,
        avgMs: 1,
        maxMs: 1,
        errorRate: 0,
        p95UpperMs: 1,
      },
      series: [],
      queries: [],
      dropped: 0,
    },
    pool: { used: 1, free: 0, pending: 1 },
    health: { status: "available", tables: [] },
  });
  const api = {
    source: {
      list: async () => ({
        list: [
          { id: "a", alias: "A", enabled: true },
          { id: "b", alias: "B", enabled: true },
        ],
      }),
    },
    instance: {
      get: (url, options) =>
        new Promise((resolve) => pending.push({ url, options, resolve })),
    },
  };
  const component = compile(compiled.content, {
    ...vue,
    require: guiRequire,
    useNuxtApp: () => ({ $api: api }),
    useI18n: () => ({ t }),
    useGlobal: () => ({ user: vue.ref({ id: "user-a" }) }),
    localStorage: window.localStorage,
    document: window.document,
    AbortController,
    setTimeout,
    clearTimeout,
  }).default;
  const renderer = vue.createRenderer({
    createElement: (tag) => document.createElement(tag),
    createText: (text) => document.createTextNode(text),
    createComment: (text) => document.createComment(text),
    setText: (node, text) => {
      node.nodeValue = text;
    },
    setElementText: (node, text) => {
      node.textContent = text;
    },
    parentNode: (node) => node.parentNode,
    nextSibling: (node) => node.nextSibling,
    insert: (node, parent, anchor) => parent.insertBefore(node, anchor || null),
    remove: (node) => node.remove(),
    patchProp: (node, key, old, value) => {
      if (key.startsWith("on")) {
        const event = key.slice(2).toLowerCase();
        if (old) node.removeEventListener(event, old);
        if (value) node.addEventListener(event, value);
      } else if (key === "value") node.value = value;
      else if (key === "disabled") node.disabled = !!value;
      else if (value == null) node.removeAttribute(key);
      else node.setAttribute(key, String(value));
    },
  });
  const app = renderer.createApp(component, { baseId: "base-a" });
  app.component("NcButton", {
    props: ["disabled"],
    emits: ["click"],
    setup:
      (props, { slots, emit }) =>
      () =>
        vue.h(
          "button",
          { disabled: props.disabled, onClick: () => emit("click") },
          slots.default?.(),
        ),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await vue.nextTick();
  };
  try {
    app.mount(host);
    await flush();
    assert.equal(pending.length, 1);
    pending[0].resolve({ data: payload(0) });
    await flush();
    assert.match(host.textContent, /connection requests are waiting/);
    assert.match(host.textContent, /query thresholds have no data/);
    const duration = host.querySelector("input[type=number]");
    duration.value = "-1";
    duration.dispatchEvent(new window.Event("input"));
    await flush();
    const name = host.querySelector("input[maxlength]");
    name.value = "Investigation";
    name.dispatchEvent(new window.Event("input"));
    await flush();
    const save = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Save view",
    );
    save.click();
    await flush();
    assert.equal(localStorage.length, 0);
    assert.match(host.textContent, /Choose a duration of at least 1 ms/);
    duration.value = "2000";
    duration.dispatchEvent(new window.Event("input"));
    await flush();
    save.click();
    await flush();
    assert.equal(
      JSON.parse(localStorage.getItem("nc-source-analytics:user-a:base-a"))[0]
        .name,
      "Investigation",
    );
    const sourceSelect = host.querySelector("select");
    sourceSelect.value = "b";
    sourceSelect.dispatchEvent(new window.Event("change"));
    await flush();
    sourceSelect.value = "a";
    sourceSelect.dispatchEvent(new window.Event("change"));
    await flush();
    assert.equal(pending[1].options.signal.aborted, true);
    pending[2].resolve({ data: payload(7) });
    await flush();
    pending[1].resolve({ data: payload(999) });
    await flush();
    assert.doesNotMatch(host.textContent, /999/);
    assert.match(host.textContent, /7/);
    const saved = [...host.querySelectorAll("select")].at(-1);
    saved.value = "Investigation";
    saved.dispatchEvent(new window.Event("change"));
    await flush();
    assert.equal(host.querySelector("input[type=number]").value, "2000");
    sourceSelect.value = "b";
    sourceSelect.dispatchEvent(new window.Event("change"));
    await flush();
    app.unmount();
    assert.equal(pending.at(-1).options.signal.aborted, true);
  } finally {
    if (host.firstChild) app.unmount();
    host.remove();
    window.happyDOM.abort();
  }
});
