// The order saves reach the account in, driven through the file Lumiverse loads.
//
// Two saves close together, written at once, can finish the older one last.
// That older copy is then the one every browser loads. Each account's saves
// are written one after another, in the order they were sent.
//
// Run with: bun test

import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const BACKEND = readFileSync(join(root, "dist", "backend.js"), "utf8");

// A store where the first write can be made slow, so a later write would
// finish first if nothing kept them in turn.
function boot() {
  let frontendHandler: any = null;
  const stored: Record<string, any> = {};
  const delays: number[] = [];
  const sent: Array<{ msg: any; user: any }> = [];
  const spindle = {
    storage: {
      read: async () => {
        throw new Error("empty");
      },
      write: async () => {},
    },
    userStorage: {
      getJson: async (file: string, o: any) => {
        const k = String((o && o.userId) || "") + ":" + file;
        return k in stored ? stored[k] : null;
      },
      setJson: async (file: string, value: any, o: any) => {
        const slow = delays.shift();
        if (slow) await new Promise((r) => setTimeout(r, slow));
        stored[String((o && o.userId) || "") + ":" + file] = value;
      },
    },
    onFrontendMessage: (fn: any) => {
      frontendHandler = fn;
    },
    sendToFrontend: (msg: any, user: any) => {
      sent.push({ msg, user });
    },
    on: () => {},
    chat: { getMessages: async () => [], updateMessage: async () => {} },
    registerInterceptor: () => {},
    log: { info() {}, warn() {}, error() {} },
  };
  new Function("spindle", BACKEND)(spindle);
  return {
    stored,
    slowFirst: (ms: number) => delays.push(ms, 0),
    ask: (payload: any, user = "u1") => frontendHandler(payload, user),
    sent,
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("saves reach the account in the order they were made", () => {
  test("an older settings save cannot finish after a newer one and stand", async () => {
    const h = boot();
    h.slowFirst(40);
    const older = h.ask({ type: "save_settings", settings: { maxRetries: 2 } });
    const newer = h.ask({ type: "save_settings", settings: { maxRetries: 5 } });
    await Promise.all([older, newer]);
    await wait(60);
    expect(h.stored["u1:settings.json"].maxRetries).toBe(5);
  });

  test("and the same holds for presets", async () => {
    const h = boot();
    h.slowFirst(40);
    const older = h.ask({ type: "save_presets", presets: { retry: [{ name: "Patient", at: 1 }] } });
    const newer = h.ask({ type: "save_presets", presets: { retry: [{ name: "Patient", at: 2 }] } });
    await Promise.all([older, newer]);
    await wait(60);
    expect(h.stored["u1:presets.json"].retry[0].at).toBe(2);
  });
});

// The chats switched off and the notices already read follow each account on
// its own. Two accounts on one server never see each other's.
describe("the chats switched off follow each account", () => {
  test("each account reads back only its own", async () => {
    const h = boot();
    await h.ask({ type: "save_state", state: { chatsOff: ["chat-a"], builtInSeen: "", movedSeen: "m1" } }, "u1");
    await h.ask({ type: "save_state", state: { chatsOff: ["chat-b"], builtInSeen: "", movedSeen: "" } }, "u2");
    await h.ask({ type: "load_state", requestId: "r1" }, "u1");
    await h.ask({ type: "load_state", requestId: "r2" }, "u2");
    const back = (id: string) => h.sent.find((x) => x.msg && x.msg.type === "loaded_state" && x.msg.requestId === id);
    expect(back("r1")!.msg.state.chatsOff).toEqual(["chat-a"]);
    expect(back("r1")!.user).toBe("u1");
    expect(back("r2")!.msg.state.chatsOff).toEqual(["chat-b"]);
    expect(back("r2")!.user).toBe("u2");
  });

  test("an account with nothing saved reads back nothing", async () => {
    const h = boot();
    await h.ask({ type: "load_state", requestId: "r3" }, "u3");
    const back = h.sent.find((x) => x.msg && x.msg.requestId === "r3");
    expect(back!.msg.state).toBe(null);
  });

  test("an older save cannot finish after a newer one and stand", async () => {
    const h = boot();
    h.slowFirst(40);
    const older = h.ask({ type: "save_state", state: { chatsOff: ["chat-a"] } });
    const newer = h.ask({ type: "save_state", state: { chatsOff: [] } });
    await Promise.all([older, newer]);
    await wait(60);
    expect(h.stored["u1:state.json"].chatsOff).toEqual([]);
  });
});
