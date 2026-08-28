#!/usr/bin/env node
// openai-agent.mjs: drive a Hypernormal app with an agent on the OpenAI API.
// Dependency-free. The whole trick is that a charter's verbs are already
// function tools: name, description, and a JSON Schema for input. Nothing is
// translated by hand; the charter is the tool list.
//
// Usage:
//   node examples/openai-agent.mjs <app url> "<instruction>"
//   node examples/openai-agent.mjs <app url> --dry     # print the derived tools, no model call
//
// Example:
//   OPENAI_API_KEY=sk-… node examples/openai-agent.mjs \
//     https://hypernormal.moldandyeast.com/a/<id> "make the site violet and sharp"
//
// Model: $OPENAI_MODEL if set, else gpt-5.1.

const [appUrl, ...rest] = process.argv.slice(2);
if (!appUrl) {
  console.error('usage: node examples/openai-agent.mjs <app url> "<instruction>" | --dry');
  process.exit(2);
}
const instruction = rest.join(" ") || "--dry";
const base = appUrl.replace(/\/$/, "");

const charterRes = await fetch(base, { headers: { Accept: "application/json" } });
const { ok, charter, error } = await charterRes.json();
if (!ok) { console.error(`could not read the charter: ${error}`); process.exit(1); }

// The Call door: one function per public verb.
const invoke = async (name, input) => {
  const res = await fetch(`${base}/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  return res.json();
};

// The charter, worn as OpenAI function tools. Verbatim schemas.
const tools = Object.entries(charter.verbs)
  .filter(([, v]) => v.access === "public")
  .map(([name, v]) => ({
    type: "function",
    name,
    description: v.description,
    parameters: v.inputSchema,
  }));

if (instruction === "--dry") {
  console.log("tools derived from the charter, ready for the OpenAI API:");
  console.log(JSON.stringify(tools, null, 2));
  process.exit(0);
}

const key = process.env.OPENAI_API_KEY;
if (!key) { console.error("set OPENAI_API_KEY (or use --dry to see the derived tools)."); process.exit(2); }
const model = process.env.OPENAI_MODEL ?? "gpt-5.1";

async function respond(body) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) { console.error(`openai: ${json.error.message}`); process.exit(1); }
  return json;
}

let response = await respond({
  model,
  tools,
  input: [
    { role: "developer", content: `You are operating a durable faceless app through its public verbs. Its charter says: ${charter.intent}` },
    { role: "user", content: instruction },
  ],
});

// Tool loop: execute every function call against the app, feed results back.
for (;;) {
  const calls = response.output.filter((o) => o.type === "function_call");
  if (calls.length === 0) break;
  const outputs = [];
  for (const call of calls) {
    const input = JSON.parse(call.arguments || "{}");
    const result = await invoke(call.name, input);
    console.log(`tool call  ${call.name} ${call.arguments} -> ${JSON.stringify(result)}`);
    outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
  }
  response = await respond({ model, tools, previous_response_id: response.id, input: outputs });
}

const text = response.output
  .filter((o) => o.type === "message")
  .flatMap((o) => o.content)
  .filter((c) => c.type === "output_text")
  .map((c) => c.text)
  .join("\n");
console.log(text || "(the agent said nothing)");
