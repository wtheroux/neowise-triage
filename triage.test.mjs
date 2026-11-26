import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp, triage } from "./server.mjs";
import { submitTriage } from "./client.mjs";

const manual = { status: "manual_review", topic: null, draft: null };

test("API validates input, classifies valid text and safely handles every mock failure", async (t) => {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(`${url}/api/triage`, { method: "POST", body });
  for (const body of ['{', '{}', 'null', '[]', '{"text":null}', '{"text":123}', '{"text":"   "}']) {
    const response = await post(body);
    assert.equal(response.status, 400, body);
    assert.deepEqual(await response.json(), { status: "invalid_input" });
  }
  for (const [text, topic] of [["Доставка", "delivery"], ["Стоимость", "pricing"], ["Привет", "other"]]) {
    const response = await post(JSON.stringify({ text }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, "ready");
    assert.equal(data.topic, topic);
    assert.ok(data.draft.trim());
  }
  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]", "[timeout]"]) {
    const start = performance.now();
    const response = await post(JSON.stringify({ text: marker }));
    assert.equal(response.status, 200, marker);
    assert.deepEqual(await response.json(), manual, marker);
    if (marker === "[timeout]") assert.ok(performance.now() - start < 1000, "must not wait for 1200ms mock");
  }
  const page = await fetch(url);
  assert.match(await page.text(), /client.mjs/);
  const script = await fetch(`${url}/client.mjs`);
  assert.equal(script.status, 200);
});

test("deadline works even when provider ignores abort", async () => {
  const start = performance.now();
  assert.deepEqual(await triage("text", () => new Promise(() => {})), manual);
  assert.ok(performance.now() - start < 1000);
});

const reply = data => ({ ok: true, status: 200, json: async () => data });
const ready = draft => ({ status: "ready", topic: "other", draft });

test("UI removes previous draft on AI and network failure; blank input does not call API", async () => {
  let screen = "";
  const render = value => { screen = value; };
  await submitTriage("text", render, async () => reply(ready("OLD DRAFT")));
  assert.match(screen, /OLD DRAFT/);
  await submitTriage("text", render, async () => {
    assert.doesNotMatch(screen, /OLD DRAFT/);
    return reply(manual);
  });
  assert.match(screen, /вручную/);
  assert.doesNotMatch(screen, /OLD DRAFT/);
  await submitTriage("text", render, async () => { throw new Error("offline"); });
  assert.match(screen, /вручную/);
  await submitTriage("   ", render, () => { throw new Error("must not fetch"); });
  assert.equal(screen, "Введите текст заявки.");
});

test("late response cannot replace newest result", async () => {
  let screen;
  let resolveOld;
  const old = submitTriage("old", value => { screen = value; }, () => new Promise(resolve => { resolveOld = resolve; }));
  await submitTriage("new", value => { screen = value; }, async () => reply(ready("NEW DRAFT")));
  resolveOld(reply(ready("OLD DRAFT")));
  await old;
  assert.match(screen, /NEW DRAFT/);
  assert.doesNotMatch(screen, /OLD DRAFT/);
});

test("rejects structurally invalid model JSON", async () => {
  for (const value of [null, [], {}, { topic: "other", draft: 4 }, { topic: "refund", draft: "ok" }]) {
    assert.deepEqual(await triage("text", async () => JSON.stringify(value)), manual);
  }
});

test("late failure cannot hide newest result", async () => {
  let screen;
  let rejectOld;
  const old = submitTriage("old", value => { screen = value; }, () => new Promise((_, reject) => { rejectOld = reject; }));
  await submitTriage("new", value => { screen = value; }, async () => reply(ready("NEW DRAFT")));
  rejectOld(new Error("late error"));
  await old;
  assert.match(screen, /NEW DRAFT/);
});
