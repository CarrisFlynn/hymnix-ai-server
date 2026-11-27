#!/usr/bin/env node
/**
 * Hymnix Agent — the terminal face of the app.
 *
 * Same kernel as the window: this process holds no tools and no provider logic,
 * it talks to the loopback bridge, which owns both. That is why a model can be
 * local, a cloud API, or a model shared by another machine, without this file
 * knowing the difference.
 *
 * Approvals mirror Claude's terminal: a dangerous tool prints what it wants and
 * waits for y. Read-only tools run without asking.
 */
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

const PORT = process.env.HYMNIX_AGENT_PORT || "";

// The terminal speaks the interface language. English is the fallback because the
// shipped README and the default UI are English.
const ZH = process.env.HYMNIX_AGENT_LANG === "zh";
const T = {
  hint: ZH ? "/model 切换模型   /models 列出   /new 清空   /tool 手动调工具   /help 帮助   /exit 退出"
           : "/model switch   /models list   /new clear   /tool call a tool   /help help   /exit quit",
  choose: ZH ? "选择模型 (回车用第一个): " : "Pick a model (Enter for the first): ",
  chosen: ZH ? "已选择 " : "Selected ",
  noModel: ZH ? "没有可用模型。先启动 Ollama，或在设置里配一个云端 provider。" : "No model yet. Start Ollama, or add a cloud provider in Settings.",
  model: ZH ? "模型: " : "Model: ",
  none: ZH ? "没有可用模型" : "No model available",
  switched: ZH ? "已切换 " : "Switched to ",
  unknown: ZH ? "没有这个模型" : "No such model",
  cleared: ZH ? "已清空" : "Cleared",
  allow: ZH ? "允许 " : "Allow ",
  denied: ZH ? "已拒绝" : "Denied",
  badJson: ZH ? "参数不是合法 JSON" : "Arguments are not valid JSON",
  noTool: ZH ? "没有这个工具" : "No such tool",
  bye: ZH ? "再见。" : "Goodbye.",
  help: ZH ? ["/model 切换模型   /models 列出模型   /new 清空对话   /exit 退出", "  /tool 名字 {json} 手动调用一个工具（危险工具有 y/N）", "  危险工具会问 y/N；只读工具直接执行。"]
            : ["/model switch model   /models list models   /new clear the conversation   /exit quit", "  /tool <name> {json} call one tool by hand (dangerous ones ask y/N)", "  Dangerous tools ask y/N; read-only tools just run."],
};
const TOKEN = process.env.HYMNIX_AGENT_TOKEN || "";
const BASE = "http://127.0.0.1:" + PORT;

const C = {
  dim: (s) => "\u001b[2m" + s + "\u001b[0m",
  bold: (s) => "\u001b[1m" + s + "\u001b[0m",
  cyan: (s) => "\u001b[36m" + s + "\u001b[0m",
  green: (s) => "\u001b[32m" + s + "\u001b[0m",
  yellow: (s) => "\u001b[33m" + s + "\u001b[0m",
  red: (s) => "\u001b[31m" + s + "\u001b[0m",
};

async function api(path, body) {
  const response = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "X-Agent-Token": TOKEN, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return await response.json();
}

function spec(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.schema },
  }));
}

let state = null;
let model = null;
let messages = [];
const readline = createInterface({ input: stdin, output: stdout, prompt: C.cyan("› ") });

function ask(question) {
  return new Promise((resolve) => readline.question(question, (answer) => resolve(answer.trim())));
}

function printBanner() {
  const local = state.models.filter((row) => row.kind === "ollama").length;
  const cloud = state.models.length - local;
  console.log("");
  console.log(C.bold("  Hymnix Agent") + C.dim("  ·  terminal"));
  console.log(C.dim("  " + state.cwd));
  console.log(C.dim("  " + local + " local · " + cloud + " cloud · " + state.tools.length + " tools"));
  console.log(C.dim("  " + T.hint));
  console.log("");
  if (!state.models.length) console.log(C.yellow("  " + T.noModel));
  else if (model) console.log(C.dim("  " + T.model) + C.cyan(model.label));
  console.log("");
}

async function chooseModel() {
  const rows = state.models;
  if (!rows.length) { model = null; return; }
  rows.forEach((row, index) => console.log("  " + C.bold(String(index + 1)) + ") " + row.label));
  const answer = await ask("  " + T.choose);
  const index = Number(answer) - 1;
  model = Number.isInteger(index) && rows[index] ? rows[index] : rows[0];
  console.log(C.dim("  " + T.chosen) + C.cyan(model.label) + "\n");
}

/** Run one assistant turn, including the tool loop. */
async function turn(text) {
  messages.push({ role: "user", content: text });
  for (let round = 0; round < 24; round += 1) {
    const response = await fetch(BASE + "/chat", {
      method: "POST",
      headers: { "X-Agent-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: model.id, messages, tools: spec(state.tools) }),
    });
    if (!response.ok || !response.body) { console.log(C.red("  " + (ZH ? "请求失败: " : "Request failed: ") + response.status)); return; }

    let content = "";
    const calls = [];
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame.type === "delta") {
          if (frame.content) { content += frame.content; stdout.write(frame.content); }
          if (Array.isArray(frame.tool_calls)) {
            for (const fragment of frame.tool_calls) {
              const index = Number(fragment.index || 0);
              calls[index] = calls[index] || { id: "", name: "", arguments: "" };
              if (fragment.id) calls[index].id = fragment.id;
              const fn = fragment.function || {};
              if (fn.name) calls[index].name = (calls[index].name || "") + fn.name;
              if (fn.arguments) calls[index].arguments += fn.arguments;
            }
          }
        } else if (frame.type === "error") {
          console.log(C.red("\n  " + frame.error));
        }
      }
    }
    if (content.trim()) { console.log(""); messages.push({ role: "assistant", content }); }
    const pending = calls.filter(Boolean);
    if (!pending.length) return;

    messages.push({
      role: "assistant",
      content,
      tool_calls: pending.map((call, index) => ({
        id: call.id || "call_" + round + "_" + index,
        type: "function",
        function: { name: call.name, arguments: call.arguments || "{}" },
      })),
    });

    for (const call of pending) {
      let args = {};
      try { args = JSON.parse(call.arguments || "{}"); } catch { /* keep empty */ }
      const def = state.tools.find((tool) => tool.name === call.name);
      console.log(C.dim("  ┌ ") + C.bold(call.name) + C.dim("  " + JSON.stringify(args).slice(0, 120)));
      let allowed = true;
      if (def && def.danger) {
        const answer = await ask(C.yellow("  └ " + (ZH ? "允许这次调用？(y/N) " : "Allow this call? (y/N) ")));
        allowed = /^y(es)?$/i.test(answer);
      }
      if (!allowed) {
        console.log(C.red("  └ " + T.denied));
        messages.push({ role: "tool", tool_call_id: call.id || "", content: "denied_by_user" });
        continue;
      }
      const result = await api("/tool", { name: call.name, args });
      const text2 = JSON.stringify(result.ok ? result.result : { error: result.error });
      console.log(C.dim("  └ ") + C.green(text2.slice(0, 200)));
      messages.push({ role: "tool", tool_call_id: call.id || "", content: text2.slice(0, 8000) });
    }
  }
}

async function main() {
  if (!PORT || !TOKEN) {
    console.log("This command only runs inside Hymnix: the bridge address is missing.");
    process.exit(1);
  }
  state = await api("/state");
  printBanner();
  if (!model && state.models.length) await chooseModel();
  readline.prompt();

  readline.on("line", async (line) => {
    const input = line.trim();
    if (!input) { readline.prompt(); return; }
    if (input === "/exit" || input === "/quit") { readline.close(); return; }
    if (input === "/help") {
      for (const line of T.help) console.log("  " + line);


      readline.prompt(); return;
    }
    if (input === "/models") {
      state.models.forEach((row) => console.log("  " + row.label + C.dim("   " + row.id)));
      readline.prompt(); return;
    }
    if (input.startsWith("/tool ")) {
      const rest = input.slice(6).trim();
      const space = rest.indexOf(" ");
      const name = space < 0 ? rest : rest.slice(0, space);
      let args = {};
      try { args = space < 0 ? {} : JSON.parse(rest.slice(space + 1)); } catch { console.log(C.red("  " + T.badJson)); readline.prompt(); return; }
      const def = state.tools.find((tool) => tool.name === name);
      if (!def) { console.log(C.red("  " + T.noTool)); readline.prompt(); return; }
      readline.pause();
      let allowed = true;
      if (def.danger) allowed = /^y(es)?$/i.test(await ask(C.yellow("  " + T.allow + name + (ZH ? " ？(y/N) " : "? (y/N) "))));
      if (!allowed) console.log(C.red("  " + T.denied));
      else {
        const result = await api("/tool", { name, args });
        console.log(C.dim("  → ") + JSON.stringify(result).slice(0, 400));
      }
      readline.resume(); readline.prompt(); return;
    }
    if (input === "/new") { messages = []; console.log(C.dim("  " + T.cleared)); readline.prompt(); return; }
    if (input === "/model" || input.startsWith("/model ")) {
      const wanted = input.slice(6).trim();
      if (!wanted) { await chooseModel(); readline.prompt(); return; }
      const found = state.models.find((row) => row.id === wanted || row.model === wanted || row.label.startsWith(wanted));
      if (found) { model = found; console.log(C.dim("  " + T.switched) + C.cyan(found.label)); }
      else console.log(C.red("  " + T.unknown));
      readline.prompt(); return;
    }
    if (!model) { console.log(C.yellow("  " + T.none)); readline.prompt(); return; }
    readline.pause();
    try { await turn(input); } catch (error) { console.log(C.red("  " + String(error && error.message ? error.message : error))); }
    readline.resume();
    readline.prompt();
  });

  readline.on("close", () => { console.log(C.dim("\n  " + T.bye)); process.exit(0); });
}

main().catch((error) => { console.error(String(error && error.stack ? error.stack : error)); process.exit(1); });
