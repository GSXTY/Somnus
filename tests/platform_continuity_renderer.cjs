// Synthetic UI acceptance: actual isolated ASGI storage; deterministic host events, no model requests.
const os = require("node:os");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { createHmac } = require("node:crypto");
const { chromium } = require(
  path.join(
    process.env.SOMNUS_NODE_DEPENDENCIES ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules",
      ),
    "playwright",
  ),
);
(async () => {
  const [origin, token, projectId, cid] = process.argv.slice(2),
    root =
      process.env.SOMNUS_TEST_WEB ||
      path.resolve(__dirname, "../page_design/web"),
    shots =
      (process.env.SOMNUS_TEST_SCREENSHOTS ||
        path.join(os.tmpdir(), "somnus-platform-ui-shots")) + path.sep,
    agent = "11111111-1111-4111-8111-111111111111";
  fs.mkdirSync(shots, { recursive: true });
  let prefs = null;
  let settings = {
      tasks: {
        maxDurationMinutes: 0,
        idleWarningSeconds: 120,
        disconnectTimeoutSeconds: 60,
      },
      diagnostics: { level: "error" },
    },
    cursor = 0;
  const childLinks = new Map();
  let childLookupFailure = false,
    childStatusOverride;
  const followup = process.env.SOMNUS_FOLLOWUP_UI === "1";
  const tasks = [],
    forkCalls = [],
    sends = [];
  let parentTurn;
  const browser = await chromium.launch({
    executablePath:
      process.env.SOMNUS_TEST_BROWSER ||
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  });
  try {
    const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent: "Mozilla/5.0 Chrome/131 Electron/33.0.0",
      }),
      headers = {
        "content-type": "application/json",
        "X-Data-Agent-Native": token,
        "X-Data-Agent-Local": "1",
      };
    const api = async (p, data) => {
      const response = await ctx.request.post(origin + "/api/assistant" + p, {
        headers,
        data,
      });
      assert(response.ok(), await response.text());
      return response.json();
    };
    const reserved = await api("/conversations/" + cid + "/external-turns", {
      content: "请检查合成文件",
      agent_id: agent,
      agent_name: "Somnus",
    });
    parentTurn = reserved.turn_id;
    await api(
      "/conversations/" + cid + "/external-turns/" + parentTurn + "/finish",
      {
        content: "合成任务已完成。\n\n这是可检查的回复，不含真实数据。",
        status: "complete",
        execution: {
          steps: [
            {
              id: "dsh-child-cccccccccccccccccccccccc",
              title: "合成审阅任务",
              kind: "subagent",
              status: "completed",
            },
          ],
          plan: [],
        },
      },
    );
    tasks.push({
      id: parentTurn,
      task_id: parentTurn,
      conversation_id: cid,
      agent_id: agent,
      agent_name: "Somnus",
      runtime: "dsh-native",
      parent_task_id: null,
      message_id: parentTurn,
      title: "合成父任务",
      status: "completed",
      revision: 1,
      created_at: Date.now() / 1000,
      updated_at: Date.now() / 1000,
      progress: null,
      error: null,
      recoverable: false,
      can_cancel: false,
    });
    await ctx.exposeFunction("fixtureHost", async (kind, input) => {
      if(kind==='native-prefs-get'){
        const response=await ctx.request.get(origin+'/api/assistant/conversations/'+input.conversationId+'/native-preferences',{headers});assert(response.ok(),await response.text());return response.json();
      }
      if(kind==='native-prefs-save'){
        const {conversationId,...data}=input;
        const response=await ctx.request.put(origin+'/api/assistant/conversations/'+conversationId+'/native-preferences',{headers,data});
        if(!response.ok())throw Error((await response.json()).error?.message||'Preference save failed');return response.json();
      }
      if (kind === "prefs-get") return prefs;
      if (kind === "prefs-save") {
        prefs = input;
        return prefs;
      }
      if (kind === "settings") {
        settings = input;
        return settings;
      }
      if (kind === "child-link") {
        if (childLookupFailure) throw Error("Synthetic child lookup offline");
        const record = childLinks.get(
          JSON.stringify([
            input.conversationId,
            input.turnId,
            input.subagentId,
          ]),
        );
        if (childStatusOverride)
          return {
            ...record,
            status: childStatusOverride,
            can_open: childStatusOverride === "archived",
            can_send: false,
          };
        return record || { status: "none", can_open: false, can_send: false };
      }
      if (kind === "fork") {
        forkCalls.push(input);
        const created = await api("/conversations", {
          workspace: projectId,
          title: "合成独立分支",
          permission_mode: "read_only",
        });
        if (input.subagentId)
          childLinks.set(
            JSON.stringify([
              input.conversationId,
              input.turnId,
              input.subagentId,
            ]),
            {
              status: "linked",
              conversation_id: created.conversation.id,
              continuation: { agentId: agent },
              can_open: true,
              can_send: true,
            },
          );
        return {
          conversationId: created.conversation.id,
          sessionId: "synthetic-child-session",
          continuation: { agentId: agent },
        };
      }
      if (kind === "send") {
        sends.push(input);
        const result = await api(
          "/conversations/" +
            input.conversationId +
            "/external-turns/" +
            input.turnId +
            "/finish",
          {
            content:
              sends.length === 1
                ? "独立子会话的合成回复。"
                : "第二条独立子会话合成回复。",
            status: "complete",
          },
        );
        tasks.push({
          ...tasks[0],
          id: input.turnId,
          task_id: input.turnId,
          message_id: input.turnId,
          conversation_id: input.conversationId,
          title: "合成子会话任务",
          created_at: Date.now() / 1000,
        });
        cursor++;
        return { text: result.message.content, stopReason: "end_turn" };
      }
      throw Error("unknown fixture operation");
    });
    await ctx.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        ![origin, origin.replace("127.0.0.1", "localhost")].includes(url.origin)
      )
        return route.abort();
      if (url.pathname === "/api/assistant/runtime-tasks")
        return route.fulfill({
          json: {
            tasks,
            cursor,
            epoch: "v2-fixture",
            events: [],
            reset: true,
            conversations: [
              ...new Set(tasks.map((t) => t.conversation_id)),
            ].map((id) => ({
              conversation_id: id,
              status: "completed",
              active_count: 0,
              attention_count: 0,
            })),
          },
        });
      if (
        url.pathname === "/api/assistant/conversations/" + cid &&
        route.request().method() === "GET"
      ) {
        const response = await route.fetch(),
          data = await response.json();
        for (const message of data.messages || [])
          if (message.role === "assistant")
            message.reply_meta = {
              ...message.reply_meta,
              transport: "dsh-native",
              provider_name: "Somnus",
              provider_id: agent,
            };
        return route.fulfill({ response, json: data });
      }
      const resource =
        url.pathname === "/"
          ? "index.html"
          : url.pathname.startsWith("/workbench-assets/")
            ? url.pathname.slice(18)
            : null;
      if (!resource) return route.continue();
      const file = path.join(root, resource);
      if (!fs.existsSync(file)) return route.continue();
      const extension = path.extname(file);
      return route.fulfill({
        body: fs.readFileSync(file),
        contentType:
          {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".png": "image/png",
            ".svg": "image/svg+xml",
          }[extension] || "application/octet-stream",
      });
    });
    await ctx.addCookies([
      {
        url: origin,
        name: "respiratory_desktop",
        value: createHmac("sha256", token)
          .update("vvman-project-browser-session")
          .digest("hex"),
      },
    ]);
    await ctx.addInitScript(
      ({ agent, settings }) => {
        window.fixtureHistory = [];
        window.fixtureInspect = [];
        window.fixtureAppearance = [];
        window.fixtureSettings = [];
        window.fixtureUpdates = [];
        const im = "@xmanrui/dsh-im",
          doc = {
            version: 1,
            title: "合成插件卡片",
            blocks: [
              { type: "text", text: "只读合成信息" },
              { type: "metrics", items: [{ label: "合成文件", value: "2" }] },
            ],
            actions: [
              {
                type: "insertDraft",
                label: "放入草稿",
                text: "请查看合成文件",
              },
            ],
          };
        window.vvmanAcp = {
          list: async () => [{ id: agent, name: "Codex" }],
          discoverModels: async () => ({ models: [] }),
          onUpdate: () => () => {},
          connectionStates: async () => [],
          warmConversation: async () => [],
          dshInstalledPlugins: async () => ({
            plugins: [
              {
                id: im,
                name: "IM 机器人",
                description: "Synthetic",
                source: "community",
                version: "1",
                enabled: true,
                managedDefault: true,
                available: true,
              },
            ],
          }),
          dshPluginSettings: async () => ({ sections: [] }),
        };
        window.somnusDshPluginPage = {
          list: async () => [
            { id: "im-page", pluginId: im, label: "IM 机器人", sidebar: true },
          ],
          extensions: async () => [
            {
              id: "im-settings",
              pluginId: im,
              label: "IM 机器人",
              slot: "settings",
              renderer: "page",
              pageId: "im-page",
              compatibility: "ready",
            },
            {
              id: "im-sidebar",
              pluginId: im,
              label: "IM 机器人",
              slot: "sidebar",
              renderer: "page",
              pageId: "im-page",
              compatibility: "ready",
            },
            {
              id: "synthetic-doc",
              pluginId: "synthetic-plugin",
              label: "合成插件侧栏",
              slot: "sidebar",
              renderer: "declarative",
              document: doc,
              compatibility: "ready",
            },
          ],
          showOwned: async id => {window.fixtureOwnedOpens??=[];window.fixtureOwnedOpens.push(id);},
          bounds: async () => {},
          close: async () => {},
        };
        window.somnusRuntime = {
          uiPreferences: async () => window.fixtureHost("prefs-get"),
          saveUiPreferences: async (value) =>
            window.fixtureHost("prefs-save", value),
          settings: async () => settings,
          setSettings: async (value) => {
            window.fixtureSettings.push(value);
            return window.fixtureHost("settings", value);
          },
          onAppearance: (listener) => {
            window.fixtureAppearanceListener = listener;
            return () => {
              if (window.fixtureAppearanceListener === listener)
                window.fixtureAppearanceListener = undefined;
            };
          },
          setAppearance: async (value) => {
            window.fixtureAppearance.push(value);
            return {
              theme: value.theme,
              effectiveTheme:
                value.theme === "dark" ||
                (value.theme === "system" &&
                  window.matchMedia("(prefers-color-scheme: dark)").matches)
                  ? "dark"
                  : "light",
            };
          },
          capabilities: async () => ({
            runtime: "dsh-native",
            identity: "Somnus",
            capabilities: {
              cancel: "supported",
              approval: "supported",
              resume: "unsupported",
            },
          }),
          interactions: async () => ({}),
          cancelTask: async () => {},
          respondPermission: async () => {},
          respondQuestion: async () => {},
        };
        window.somnusNativeDshChat = {
          nativePreferences:input=>window.fixtureHost('native-prefs-get',input),
          saveNativePreferences:input=>window.fixtureHost('native-prefs-save',input),
          onUpdate: (listener) => {
            window.fixtureUpdates.push(listener);
            return () => {
              window.fixtureUpdates = window.fixtureUpdates.filter(
                (x) => x !== listener,
              );
            };
          },
          promptConversation: async (input) => {
            const value = await window.fixtureHost("send", input);
            return value;
          },
          cancelConversation: async () => {},
          history: async (input) => {
            window.fixtureHistory.push(input);
            return {
              records: [
                {
                  seq: 1,
                  type: "user-message",
                  role: "user",
                  text: "合成输入",
                },
                {
                  seq: 2,
                  type: "tool-call",
                  tool: {
                    callId: "call-1",
                    name: "read_file",
                    status: "completed",
                  },
                },
                {
                  seq: 3,
                  type: "assistant-message",
                  role: "assistant",
                  text: "合成最终回复",
                },
              ],
              cursor: 3,
              hasMore: false,
            };
          },
          historyTool: async (input) => {
            window.fixtureInspect.push(input);
            return {
              text: "Synthetic read_file input/output\nNo credentials or company data.",
            };
          },
          childConversation: async (input) =>
            window.fixtureHost("child-link", input),
          fork: async (input) => window.fixtureHost("fork", input),
          subagentDetail: async () => ({
            title: "合成审阅任务",
            status: "completed",
            messages: [{ role: "assistant", text: "子任务合成记录" }],
            entries: [
              {
                seq: 1,
                type: "message",
                role: "assistant",
                text: "子任务合成记录",
              },
            ],
            truncated: false,
          }),
          subagentToolDetail: async () => null,
        };
      },
      { agent, settings },
    );
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.log("pageerror", error.message);
    });
    await page.goto(origin + "/#assistant?project=" + projectId);
    await page
      .getByRole("button", { name: "Group fixture UI chat", exact: true })
      .first()
      .click();
    await page
      .getByText("合成任务已完成。", { exact: false })
      .first()
      .waitFor();
    await page.waitForTimeout(450);
    await page.screenshot({ path: shots + "platform-v2-light.png" });
    await page
      .getByRole("button", { name: "设置", exact: true })
      .first()
      .click();
    let dialog = page.getByRole("dialog", { name: "设置", exact: true });
    await dialog
      .getByRole("combobox", { name: "外观", exact: true })
      .locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]')
      .click();
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: /^深色$/ })
      .click();
    await page.waitForFunction(
      () => document.documentElement.dataset.somnusTheme === "dark",
    );
    await dialog.getByRole("heading", { name: "通用", exact: true }).click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: shots + "platform-v2-settings-dark.png" });
    await dialog
      .getByRole("button", { name: "会话与项目", exact: false })
      .click();
    await dialog
      .getByRole("combobox", { name: "聊天字号", exact: true })
      .count()
      .then((count) => assert.equal(count, 0));
    await dialog
      .getByRole("combobox", { name: "新会话文件权限", exact: true })
      .locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]')
      .click();
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: /^修改前确认$/ })
      .click();
    await dialog
      .getByRole("combobox", { name: "发送快捷键", exact: true })
      .locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]')
      .click();
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: /^Ctrl Enter 发送$/ })
      .click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: shots + "platform-v2-settings-chat.png" });
    await dialog
      .getByRole("button", { name: "任务与诊断", exact: false })
      .click();
    await dialog
      .getByRole("spinbutton", { name: "任务最长运行时间", exact: true })
      .fill("90");
    await dialog
      .getByRole("button", { name: "保存任务设置", exact: true })
      .click();
    await dialog.getByText("已保存", { exact: true }).waitFor();
    assert.equal(settings.tasks.maxDurationMinutes, 90);
    await dialog.locator("button.ant-modal-close").click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: shots + "platform-v2-dark.png" });
    await page.getByRole("tab", { name: "轨迹", exact: true }).click();
    await page
      .getByRole("button", { name: "原始事件账本", exact: true })
      .click();
    await page.getByText("合成最终回复", { exact: true }).waitFor();
    await page
      .getByRole("button", {
        name: "read_file · completed · 查看调用",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog", { name: "read_file", exact: true })
      .getByText(/Synthetic read_file/)
      .waitFor();
    await page.waitForTimeout(450);
    await page.screenshot({ path: shots + "platform-v2-trajectory.png" });
    await page.getByRole("dialog").locator("button.ant-modal-close").click();
    assert.equal(
      await page.evaluate(() => window.fixtureInspect[0].callId),
      "call-1",
    );
    await page.getByRole("tab", { name: "聊天", exact: true }).click();
    await page.locator("details.assistant-execution > summary").click();
    await page
      .locator("details.assistant-execution-operation > summary")
      .first()
      .click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: shots + "platform-v2-debug-steps.png" });
    console.log(
      "fixture execution:",
      await page.locator("details.assistant-execution").innerText(),
    );
    await page.getByRole("button", { name: "查看子任务", exact: true }).click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: shots + "platform-v2-debug-child.png" });
    console.log("fixture page errors:", errors);
    let child = page.getByRole("dialog", { name: "合成审阅任务", exact: true });
    await child
      .getByText("子任务合成记录", { exact: true })
      .waitFor()
      .catch(async (e) => {
        await page.waitForTimeout(450);
        await page.screenshot({ path: shots + "platform-v2-child-failed.png" });
        console.log(
          "dialogs:",
          await page.getByRole("dialog").allTextContents(),
        );
        throw e;
      });
    await child
      .getByRole("button", { name: "在独立会话继续", exact: true })
      .click();
    await page.getByRole("button",{name:"创建共享目录分支",exact:true}).click();
    await child
      .getByRole("textbox", { name: "给独立子会话发消息", exact: true })
      .fill("请回复一条合成文本。");
    if (followup) {
      const box = child.getByRole("textbox", {
        name: "给独立子会话发消息",
        exact: true,
      });
      await box.press("Enter");
      assert.equal(sends.length, 0);
      await box.press("Control+Enter");
    } else
      await child.getByRole("button", { name: "发送", exact: true }).click();
    await child.getByText("独立子会话的合成回复。", { exact: true }).waitFor();
    assert.equal(sends.length, 1);
    assert.equal(forkCalls.length, 1);
    assert.equal(forkCalls[0].subagentId, "dsh-child-cccccccccccccccccccccccc");
    await page.waitForTimeout(450);
    await page.screenshot({ path: shots + "platform-v2-childpane.png" });
    await child
      .getByRole("button", { name: "关闭", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "查看子任务", exact: true }).click();
    child = page.getByRole("dialog", { name: "合成审阅任务", exact: true });
    await child.getByText("独立子会话的合成回复。", { exact: true }).waitFor();
    assert.equal(forkCalls.length, 1);
    await child
      .getByRole("button", { name: "关闭", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "插件", exact: true }).click();
    const extensions = page.getByRole("region", {
      name: "插件界面扩展",
      exact: true,
    });
    await extensions.getByText("2 项可用", { exact: true }).waitFor();
    assert.equal(await extensions.locator(".plugin-extension-row").count(), 2);
    await page.waitForTimeout(450);
    await page.screenshot({ path: shots + "platform-v2-im-dedup.png" });
    await page
      .getByRole("button", { name: "合成插件侧栏", exact: true })
      .click();
    const sample = page.getByRole("dialog", {
      name: "合成插件侧栏",
      exact: true,
    });
    await sample.getByText("合成插件卡片", { exact: true }).waitFor();
    await page.waitForTimeout(450);
    await page.screenshot({ path: shots + "platform-v2-plugin.png" });
    await sample.locator("button.ant-drawer-close").click();
    await page.setViewportSize({ width: 1040, height: 800 });
    await page
      .getByRole("button", { name: "Group fixture UI chat", exact: true })
      .first()
      .click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: shots + "platform-v2-compact.png" });
    assert.equal(prefs.theme, "dark");
    assert.equal(prefs.defaultPermission, "workspace_write");
    const alternate = origin.replace("127.0.0.1", "localhost");
    await ctx.addCookies([
      {
        url: alternate,
        name: "respiratory_desktop",
        value: createHmac("sha256", token)
          .update("vvman-project-browser-session")
          .digest("hex"),
      },
    ]);
    const second = await ctx.newPage();
    await second.goto(alternate + "/#assistant?project=" + projectId);
    await second.waitForFunction(
      () => document.documentElement.dataset.somnusTheme === "dark",
    );
    assert.equal(
      await second.evaluate(
        () =>
          JSON.parse(localStorage.getItem("somnus.ui-preferences.v1"))
            .defaultPermission,
      ),
      "workspace_write",
    );
    if (followup) {
      second.on("pageerror", (error) => errors.push(error.message));
      assert(
        (await second.evaluate(() => window.fixtureAppearance)).every(
          (value) => value.theme === "dark",
        ),
        "new origin must not apply provisional light",
      );
      const screenshot = async (p, name) => {
        await p.waitForTimeout(450);
        await p.screenshot({
          path: shots + "platform-followup-" + name + ".png",
        });
      };
      const settingsDialog = async (p) => {
        await p
          .getByRole("button", { name: "设置", exact: true })
          .first()
          .click();
        return p.getByRole("dialog", { name: "设置", exact: true });
      };
      const choose = async (p, dialog, label, option) => {
        await dialog
          .getByRole("combobox", { name: label, exact: true })
          .locator(
            'xpath=ancestor::div[contains(@class,"ant-select-selector")][1]',
          )
          .click();
        await p
          .locator(".ant-select-item-option")
          .filter({ hasText: option })
          .click();
      };
      const closeSettings = async (dialog) =>
        dialog.locator("button.ant-modal-close").click();
      const openChild = async (p) => {
        await p
          .getByRole("button", { name: "Group fixture UI chat", exact: true })
          .first()
          .click();
        const execution = p.locator("details.assistant-execution");
        if (!(await execution.evaluate((element) => element.open)))
          await execution.locator(":scope > summary").click();
        const operation = p
          .locator("details.assistant-execution-operation")
          .first();
        if (!(await operation.evaluate((element) => element.open)))
          await operation.locator(":scope > summary").click();
        await p
          .getByRole("button", { name: "查看子任务", exact: true })
          .click();
        return p.getByRole("dialog", { name: "合成审阅任务", exact: true });
      };
      assert.equal(
        await second
          .getByRole("button", { name: "IM 机器人设置", exact: true })
          .count(),
        0,
      );
      await second.evaluate(
        ({ cid, parentTurn }) =>
          localStorage.setItem(
            "somnus.child-conversation:" +
              cid +
              ":" +
              parentTurn +
              ":dsh-child-cccccccccccccccccccccccc",
            JSON.stringify({
              conversationId: "e".repeat(32),
              continuation: { agentId: "wrong-agent" },
            }),
          ),
        { cid, parentTurn },
      );
      let pane = await openChild(second);
      await pane.getByText("独立子会话的合成回复。", { exact: true }).waitFor();
      assert.equal(forkCalls.length, 1);
      await screenshot(second, "cross-origin-child");
      await pane
        .getByRole("button", { name: "关闭", exact: true })
        .first()
        .click();
      await second.reload();
      pane = await openChild(second);
      await pane.getByText("独立子会话的合成回复。", { exact: true }).waitFor();
      assert.equal(forkCalls.length, 1);
      await screenshot(second, "restarted-child");
      childLookupFailure = true;
      await second.evaluate(() => window.dispatchEvent(new Event("focus")));
      await pane.getByText(/Synthetic child lookup offline/).waitFor();
      assert(
        await pane
          .getByRole("textbox", { name: "给独立子会话发消息", exact: true })
          .isDisabled(),
      );
      await pane.getByText("独立子会话的合成回复。", { exact: true }).waitFor();
      assert.equal(forkCalls.length, 1);
      await screenshot(second, "offline-child");
      childLookupFailure = false;
      childStatusOverride = "archived";
      await second.evaluate(() => window.dispatchEvent(new Event("focus")));
      await pane
        .getByText("此前的独立子会话已归档，可查看记录，不能继续发送。", {
          exact: true,
        })
        .waitFor();
      assert(
        await pane
          .getByRole("textbox", { name: "给独立子会话发消息", exact: true })
          .isDisabled(),
      );
      await pane.getByText("独立子会话的合成回复。", { exact: true }).waitFor();
      await screenshot(second, "archived-child");
      childStatusOverride = "deleted";
      await second.evaluate(() => window.dispatchEvent(new Event("focus")));
      await pane
        .getByText("此前的独立子会话已删除，未重新创建。", { exact: true })
        .waitFor();
      assert(
        await pane
          .getByRole("button", { name: "在独立会话继续", exact: true })
          .isDisabled(),
      );
      assert.equal(forkCalls.length, 1);
      await screenshot(second, "deleted-child");
      childStatusOverride = undefined;
      await second.evaluate(() => window.dispatchEvent(new Event("focus")));
      await pane.getByText("独立子会话的合成回复。", { exact: true }).waitFor();
      await pane
        .getByRole("button", { name: "关闭", exact: true })
        .first()
        .click();
      let settingsPane = await settingsDialog(second);
      await settingsPane
        .getByRole("button", { name: "快捷键", exact: false })
        .click();
      assert.equal(
        await settingsPane
          .locator(".shortcut-list li")
          .filter({ hasText: "发送会话消息" })
          .locator("kbd")
          .innerText(),
        "Ctrl+Enter",
      );
      assert(
        (await settingsPane.locator(".shortcut-list").innerText()).includes(
          "Ctrl+Shift+Enter",
        ),
      );
      await screenshot(second, "windows-mod-help");
      await settingsPane
        .getByRole("button", { name: "会话与项目", exact: false })
        .click();
      await choose(second, settingsPane, "发送快捷键", /^Enter 发送$/);
      await settingsPane
        .getByRole("button", { name: "快捷键", exact: false })
        .click();
      assert.equal(
        await settingsPane
          .locator(".shortcut-list li")
          .filter({ hasText: "发送会话消息" })
          .locator("kbd")
          .innerText(),
        "Enter",
      );
      await screenshot(second, "windows-enter-help");
      await closeSettings(settingsPane);
      pane = await openChild(second);
      await pane
        .getByRole("textbox", { name: "给独立子会话发消息", exact: true })
        .fill("第二条 Enter 快捷键合成任务");
      await pane
        .getByRole("textbox", { name: "给独立子会话发消息", exact: true })
        .press("Enter");
      await pane
        .getByText("第二条独立子会话合成回复。", { exact: true })
        .waitFor();
      assert.equal(sends.length, 2);
      assert.equal(forkCalls.length, 1);
      await screenshot(second, "enter-send");
      await pane
        .getByRole("button", { name: "关闭", exact: true })
        .first()
        .click();
      await second.getByRole("button", { name: "插件", exact: true }).click();
      const extension = second
        .getByRole("region", { name: "插件界面扩展", exact: true })
        .locator(".plugin-extension-row")
        .filter({ hasText: "IM 机器人" });
      await extension.getByRole("button", { name: /^设\s*置$/ }).click();
      await second
        .getByRole("button", { name: "配置机器人", exact: true })
        .waitFor();
      assert.equal(
        await second
          .getByRole("button", { name: "IM 机器人设置", exact: true })
          .count(),
        0,
      );
      await screenshot(second, "im-config-no-gear");
      await second.getByRole('button',{name:'配置机器人',exact:true}).click();await second.getByRole('dialog',{name:'IM 机器人',exact:true}).waitFor();await second.waitForFunction(()=>window.fixtureOwnedOpens?.includes('im-page'));await second.getByRole('dialog',{name:'IM 机器人',exact:true}).locator('button.ant-modal-close').click();
      settingsPane = await settingsDialog(second);
      await settingsPane
        .getByRole("button", { name: "会话与项目", exact: false })
        .click();
      await choose(second, settingsPane, "发送快捷键", /^Ctrl Enter 发送$/);
      await settingsPane
        .getByRole("button", { name: "通用", exact: false })
        .click();
      await choose(second, settingsPane, "外观", /^跟随系统$/);
      await closeSettings(settingsPane);
      const mac = await ctx.newPage();
      mac.on("pageerror", (error) => errors.push(error.message));
      await mac.addInitScript(() =>
        Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }),
      );
      await mac.emulateMedia({ colorScheme: "dark" });
      await mac.goto(origin + "/#assistant?project=" + projectId);
      await mac.waitForFunction(
        () => document.documentElement.dataset.somnusTheme === "dark",
      );
      assert(
        (await mac.evaluate(() => window.fixtureAppearance)).every(
          (value) => value.theme === "system",
        ),
        "profile system startup must not apply cached dark or provisional light",
      );
      let macSettings = await settingsDialog(mac);
      await macSettings
        .getByRole("button", { name: "快捷键", exact: false })
        .click();
      assert.equal(
        await macSettings
          .locator(".shortcut-list li")
          .filter({ hasText: "发送会话消息" })
          .locator("kbd")
          .innerText(),
        "⌘+Enter",
      );
      assert(
        (await macSettings.locator(".shortcut-list").innerText()).includes(
          "⌘+Shift+Enter",
        ),
      );
      await screenshot(mac, "mac-help-system");
      await closeSettings(macSettings);
      await mac.evaluate(() =>
        window.fixtureAppearanceListener?.({
          theme: "system",
          effectiveTheme: "light",
        }),
      );
      await mac.waitForFunction(
        () => document.documentElement.dataset.somnusTheme === "light",
      );
      await screenshot(mac, "native-system-event");
      await mac.close();
    }
    if(process.env.SOMNUS_EXPANDED_UI==='1')await require('./platform_expanded_scenarios.cjs')({ctx,origin,cid,projectId,shots,headers});
    await second.close();
    assert.deepEqual(errors, []);
    assert.equal(sends.length, followup ? 2 : 1);
    console.log(
      "PASS Settings actual theme/preferences/runtime bridge; native ledger inspector; child fork and text reply/reopen; IM dedup; safe declarative sidebar; 1440 and compact layouts.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
