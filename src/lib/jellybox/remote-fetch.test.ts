import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeRemoteUrl,
  fetchRemoteFile,
  isPrivateIpAddress,
} from "@/lib/jellybox/remote-fetch";

function publicLookup() {
  return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
}

test("isPrivateIpAddress detects private and loopback ranges", () => {
  assert.equal(isPrivateIpAddress("127.0.0.1"), true);
  assert.equal(isPrivateIpAddress("10.0.0.8"), true);
  assert.equal(isPrivateIpAddress("192.168.1.20"), true);
  assert.equal(isPrivateIpAddress("93.184.216.34"), false);
});

test("assertSafeRemoteUrl rejects blocked private targets", async () => {
  await assert.rejects(
    () =>
      assertSafeRemoteUrl("http://localhost/file.txt", {
        lookup: publicLookup,
      }),
    /private or blocked host/i,
  );

  await assert.rejects(
    () =>
      assertSafeRemoteUrl("https://safe.example/file.txt", {
        lookup: async () => [{ address: "10.0.0.3", family: 4 }],
      }),
    /private or blocked address/i,
  );
});

test("fetchRemoteFile rejects oversized responses before buffering", async () => {
  await assert.rejects(
    () =>
      fetchRemoteFile(
        {
          url: "https://example.com/file.bin",
          maxBytes: 5,
        },
        {
          lookup: publicLookup,
          fetchFn: async () =>
            new Response("123456", {
              status: 200,
              headers: {
                "content-length": "6",
                "content-type": "application/octet-stream",
              },
            }),
        },
      ),
    /content-length exceeds/i,
  );
});

test("fetchRemoteFile validates redirect targets before following", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchRemoteFile(
        {
          url: "https://example.com/file.bin",
          maxBytes: 1024,
        },
        {
          lookup: async (hostname) => {
            if (hostname === "example.com") return publicLookup();
            if (hostname === "127.0.0.1") return [{ address: "127.0.0.1", family: 4 }];
            throw new Error(`unexpected host ${hostname}`);
          },
          fetchFn: async () => {
            calls += 1;
            return new Response(null, {
              status: 302,
              headers: { location: "http://127.0.0.1/private" },
            });
          },
        },
      ),
    /private or blocked/i,
  );

  assert.equal(calls, 1);
});
