import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  askAgentI,
  buildAgentIBody,
  clearAgentIYahooCookie,
  extractAgentIText,
  getAgentICredentials,
  getAgentIHistory,
  readBoundedAgentIResponse,
  resetAgentISession,
  setAgentIYahooCookie,
} from "./agentIService.js";

const previousFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = previousFetch;
  for (const id of ["fixture-a", "fixture-b"]) resetAgentISession(id);
});

function mockYahoo() {
  const sent: { cookie: string | null; body: { chats: unknown[] } }[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method !== "POST")
      return new Response("", { headers: { "set-cookie": "anon=fixture; Secure" } });
    sent.push({
      cookie: new Headers(init.headers).get("cookie"),
      body: JSON.parse(String(init.body)),
    });
    return new Response('data: {"text":"fixture answer"}\n\n');
  }) as unknown as typeof fetch;
  return sent;
}

describe("Agent I session privacy", () => {
  test("an empty anonymous mint can be retried without retaining a broken session", async () => {
    globalThis.fetch = (async () => new Response("")) as unknown as typeof fetch;
    await expect(askAgentI("fixture-a", "first try")).rejects.toThrow();
    const sent = mockYahoo();
    await askAgentI("fixture-a", "retry");
    expect(sent[0]!.cookie).toBe("anon=fixture");
  });
  test("a fresh backend process cannot recover credentials or dialogue", async () => {
    setAgentIYahooCookie("fixture-a", "Y=synthetic-process-secret");
    const source = new URL("agentIService.ts", import.meta.url).href;
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { getAgentICredentials, getAgentIHistory } from ${JSON.stringify(source)}; console.log(JSON.stringify({ credentials: getAgentICredentials("fixture-a"), history: getAgentIHistory("fixture-a") }));`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(JSON.parse(output)).toEqual({
      credentials: { yahooCookieConfigured: false, expiresAt: null },
      history: [],
    });
  });
  test("uses Yahoo credentials only when explicitly requested, isolated by account", async () => {
    const sent = mockYahoo();
    setAgentIYahooCookie("fixture-a", "Y=synthetic-secret; T=fixture");
    expect(getAgentICredentials("fixture-a")).toEqual({
      yahooCookieConfigured: true,
      expiresAt: expect.any(Number),
    });
    expect(JSON.stringify(getAgentICredentials("fixture-a"))).not.toContain("synthetic-secret");
    await askAgentI("fixture-a", "anonymous default");
    await askAgentI("fixture-a", "opt in", [], "authenticated");
    const fallback = await askAgentI("fixture-b", "unregistered", [], "authenticated");
    expect(sent.map((item) => item.cookie)).toEqual([
      "anon=fixture",
      "Y=synthetic-secret; T=fixture",
      "anon=fixture",
    ]);
    expect(fallback.authMode).toBe("anonymous");
    expect(getAgentIHistory("fixture-b")).toHaveLength(2);
  });

  test("keeps dialogue locally but sends history only when supplied explicitly", async () => {
    const sent = mockYahoo();
    await askAgentI("fixture-a", "first private question");
    await askAgentI("fixture-a", "second question");
    expect(sent[1]!.body.chats).toHaveLength(1);
    const history = getAgentIHistory("fixture-a");
    expect(history).toHaveLength(4);
    history[0]!.text = "mutated copy";
    expect(getAgentIHistory("fixture-a")[0]!.text).toBe("first private question");
    await askAgentI("fixture-a", "explicit context", getAgentIHistory("fixture-a"));
    expect(sent[2]!.body.chats).toHaveLength(5);
    expect(getAgentIHistory("fixture-b")).toEqual([]);
  });

  test("expires cookies and history without forwarding expired credentials", async () => {
    const sent = mockYahoo();
    setAgentIYahooCookie("fixture-a", "Y=expired-secret");
    await askAgentI("fixture-a", "private", [], "authenticated");
    const { expiresAt } = getAgentICredentials("fixture-a");
    const clock = spyOn(Date, "now").mockReturnValue(expiresAt! + 1);
    try {
      expect(getAgentICredentials("fixture-a")).toEqual({
        yahooCookieConfigured: false,
        expiresAt: null,
      });
      expect(getAgentIHistory("fixture-a")).toEqual([]);
      await askAgentI("fixture-a", "after expiry", [], "authenticated");
      expect(sent[1]!.cookie).toBe("anon=fixture");
    } finally {
      clock.mockRestore();
    }
  });

  test("rejects malformed/header-injection/oversized cookies without network access", () => {
    globalThis.fetch = (() => {
      throw Error("network forbidden");
    }) as unknown as typeof fetch;
    for (const cookie of [
      "",
      "Cookie: Y=secret",
      "Y=secret\r\nInjected=yes",
      "Y=has space",
      "Y=x; Path=/\n",
      `Y=${"x".repeat(16_384)}`,
    ]) {
      expect(() => setAgentIYahooCookie("fixture-a", cookie)).toThrow();
    }
    expect(getAgentICredentials("fixture-a").yahooCookieConfigured).toBe(false);
  });

  test("manual removal clears credentials and dialogue, and changing Yahoo identity clears history", async () => {
    mockYahoo();
    setAgentIYahooCookie("fixture-a", "Y=identity-one");
    await askAgentI("fixture-a", "first identity", [], "authenticated");
    setAgentIYahooCookie("fixture-a", "Y=identity-two");
    expect(getAgentIHistory("fixture-a")).toEqual([]);
    await askAgentI("fixture-a", "second identity", [], "authenticated");
    clearAgentIYahooCookie("fixture-a");
    expect(getAgentICredentials("fixture-a").yahooCookieConfigured).toBe(false);
    expect(getAgentIHistory("fixture-a")).toEqual([]);
  });

  test("revoking a session cancels in-flight work and cannot restore cleared history", async () => {
    setAgentIYahooCookie("fixture-a", "Y=revoked-secret");
    let finish!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }) as unknown as typeof fetch;
    const pending = askAgentI("fixture-a", "in flight", [], "authenticated");
    await Promise.resolve();
    resetAgentISession("fixture-a");
    expect(signal?.aborted).toBe(true);
    finish(new Response('data: {"text":"late answer"}\n\n'));
    await expect(pending).rejects.toThrow();
    expect(getAgentIHistory("fixture-a")).toEqual([]);
    expect(getAgentICredentials("fixture-a").yahooCookieConfigured).toBe(false);
  });

  test("a cleared anonymous mint cannot make a later chat request", async () => {
    let finish!: (response: Response) => void;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }) as unknown as typeof fetch;
    const pending = askAgentI("fixture-a", "in flight");
    resetAgentISession("fixture-a");
    finish(new Response("", { headers: { "set-cookie": "anon=late" } }));
    await expect(pending).rejects.toThrow();
    expect(requests).toBe(1);
    expect(getAgentIHistory("fixture-a")).toEqual([]);
  });

  test("Yahoo authentication rejection clears credentials and does not retry or expose response details", async () => {
    setAgentIYahooCookie("fixture-a", "Y=rejected-secret");
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return new Response("echo Y=rejected-secret", { status: 401 });
    }) as unknown as typeof fetch;
    await expect(askAgentI("fixture-a", "test", [], "authenticated")).rejects.toThrow("Yahoo");
    expect(requests).toBe(1);
    expect(getAgentICredentials("fixture-a").yahooCookieConfigured).toBe(false);
  });
});

describe("Agent I request contract", () => {
  test("builds a bounded multi-turn request without raw LINE metadata", () => {
    const body = buildAgentIBody("返信を丁寧にして", [
      { role: "user", text: "明日の予定は？" },
      { role: "assistant", text: "予定を確認します。" },
    ]);

    expect(body.chats).toEqual([
      {
        id: expect.any(String),
        role: "user",
        contents: [{ type: "text", text: "明日の予定は？" }],
      },
      {
        id: expect.any(String),
        role: "assistant",
        contents: [{ type: "text", text: "予定を確認します。" }],
      },
      {
        id: expect.any(String),
        role: "user",
        contents: [{ type: "text", text: "返信を丁寧にして" }],
      },
    ]);
    expect(body.context.agentMode).toBe("multi");
    expect(JSON.stringify(body)).not.toContain("chatMid");
  });

  test("extracts text deltas from SSE payloads", () => {
    const sse = [
      'event: message\ndata: {"type":"compositeMessage-delta","text":"こんにちは"}\n\n',
      'data: {"delta":{"text":"世界"}}\n\n',
    ].join("");

    expect(extractAgentIText(sse)).toBe("こんにちは世界");
  });

  test("does not expose Agent I control event names as the answer", () => {
    const sse = [
      'data: {"type":"agentstate"}\n\n',
      'data: {"type":"compositeMessage-start"}\n\n',
      'data: {"type":"compositeMessage-delta"}\n\n',
      'data: {"type":"attachment"}\n\n',
      'data: {"type":"execution-end"}\n\n',
    ].join("");

    expect(extractAgentIText(sse)).toBe("");
  });

  test("extracts the current Yahoo value.message delta shape", () => {
    const sse = [
      'data: {"type":"compositeMessage-delta","value":{"message":"こんにちは"}}\n\n',
      'data: {"type":"compositeMessage-delta","value":{"message":"世界"}}\n\n',
    ].join("");

    expect(extractAgentIText(sse)).toBe("こんにちは世界");
  });

  test("bounds declared and streamed SSE response bytes", async () => {
    await expect(
      readBoundedAgentIResponse(new Response("x", { headers: { "content-length": "9" } }), 8),
    ).rejects.toThrow("response too large");

    const streamed = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("12345678"));
          controller.enqueue(new TextEncoder().encode("9"));
          controller.close();
        },
      }),
    );
    await expect(readBoundedAgentIResponse(streamed, 8)).rejects.toThrow("response exceeded");
  });
});
