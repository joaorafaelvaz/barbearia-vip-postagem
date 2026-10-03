import { PublishError, TokenCipher, generateEncryptionKey } from "@fsp/core";
import type { Publisher } from "@fsp/connectors";
import { describe, expect, it } from "vitest";
import { processTarget, type ProcessorDeps, type TargetRecord, type TargetRepository } from "../processor.js";

const cipher = new TokenCipher(generateEncryptionKey());

function makeTarget(over: Partial<TargetRecord> = {}, acc: Partial<TargetRecord["account"]> = {}): TargetRecord {
  return {
    id: "t1",
    organizationId: "org1",
    status: "SCHEDULED",
    attempts: 0,
    scheduledAt: new Date("2026-10-03T12:00:00Z"),
    post: { caption: "Olá", media: [{ url: "https://cdn/a.jpg", kind: "IMAGE" }] },
    account: {
      id: "acc1",
      organizationId: "org1",
      platform: "FACEBOOK_PAGE",
      externalId: "page1",
      accessTokenEnc: cipher.encrypt("PAGE_TOKEN"),
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      isActive: true,
      ...acc,
    },
    ...over,
  };
}

function fakeRepo(target: TargetRecord | null) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const repo: TargetRepository = {
    async loadTarget() {
      return target;
    },
    async markPublishing(id) {
      calls.push({ op: "publishing", args: [id] });
      return target?.status === "SCHEDULED" || target?.status === "FAILED";
    },
    async markPublished(id, r) {
      calls.push({ op: "published", args: [id, r] });
    },
    async markFailed(id, attempts, error) {
      calls.push({ op: "failed", args: [id, attempts, error] });
    },
    async markRetry(id, attempts, error) {
      calls.push({ op: "retry", args: [id, attempts, error] });
    },
    async updateAccountToken(accountId, enc, exp) {
      calls.push({ op: "token", args: [accountId, enc, exp] });
    },
  };
  return { repo, calls };
}

function deps(repo: TargetRepository, publisher: Publisher, google?: ProcessorDeps["google"]): ProcessorDeps {
  return {
    repo,
    cipher,
    publisherFor: () => publisher,
    google: google ?? { refresh: async () => ({ accessToken: "unused", expiresAt: new Date() }) },
    now: () => new Date("2026-10-03T12:00:00Z"),
  };
}

const okPublisher = (seen: unknown[] = []): Publisher => ({
  platform: "FACEBOOK_PAGE",
  async publish(input) {
    seen.push(input);
    return { externalPostId: "ext1", externalUrl: "https://fb/ext1" };
  },
});

const failingPublisher = (err: Error): Publisher => ({
  platform: "FACEBOOK_PAGE",
  async publish() {
    throw err;
  },
});

describe("processTarget", () => {
  it("publica, descriptografa o token e marca PUBLISHED", async () => {
    const { repo, calls } = fakeRepo(makeTarget());
    const seen: Array<{ account: { accessToken: string } }> = [];
    const out = await processTarget(deps(repo, okPublisher(seen)), "t1");
    expect(out).toEqual({ outcome: "published", externalPostId: "ext1" });
    expect(seen[0]?.account.accessToken).toBe("PAGE_TOKEN");
    expect(calls.map((c) => c.op)).toEqual(["publishing", "published"]);
  });

  it("pula target já publicado ou cancelado sem chamar a API", async () => {
    const { repo, calls } = fakeRepo(makeTarget({ status: "PUBLISHED" }));
    const out = await processTarget(deps(repo, failingPublisher(new Error("não deveria"))), "t1");
    expect(out.outcome).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("pula quando outro worker já reivindicou (markPublishing=false)", async () => {
    const { repo } = fakeRepo(makeTarget({ status: "PUBLISHING" }));
    const out = await processTarget(deps(repo, okPublisher()), "t1");
    expect(out).toEqual({ outcome: "skipped", reason: "já em processamento" });
  });

  it("erro retentável agenda retry com backoff e volta para SCHEDULED", async () => {
    const { repo, calls } = fakeRepo(makeTarget({ attempts: 1 }));
    const err = new PublishError("RATE_LIMITED", "limite", { retryAfterSeconds: 300 });
    const out = await processTarget(deps(repo, failingPublisher(err)), "t1");
    expect(out).toMatchObject({ outcome: "retry", delayMs: 300_000 });
    expect(calls.at(-1)).toMatchObject({ op: "retry", args: ["t1", 2, "[RATE_LIMITED] limite"] });
  });

  it("erro permanente marca FAILED sem retry", async () => {
    const { repo, calls } = fakeRepo(makeTarget());
    const out = await processTarget(deps(repo, failingPublisher(new PublishError("INVALID_TOKEN", "expirado"))), "t1");
    expect(out).toEqual({ outcome: "failed", error: "[INVALID_TOKEN] expirado" });
    expect(calls.at(-1)?.op).toBe("failed");
  });

  it("esgota tentativas: 5a tentativa retentável vira FAILED", async () => {
    const { repo, calls } = fakeRepo(makeTarget({ attempts: 4 }));
    const out = await processTarget(deps(repo, failingPublisher(new PublishError("NETWORK", "net"))), "t1");
    expect(out.outcome).toBe("failed");
    expect(calls.at(-1)).toMatchObject({ op: "failed", args: ["t1", 5, "[NETWORK] net"] });
  });

  it("conta de outra organização falha sem publicar", async () => {
    const { repo } = fakeRepo(makeTarget({}, { organizationId: "org-outra" }));
    const out = await processTarget(deps(repo, failingPublisher(new Error("não deveria"))), "t1");
    expect(out.outcome).toBe("failed");
  });

  it("GBP com token expirado renova via refresh token e persiste criptografado", async () => {
    const target = makeTarget(
      {},
      {
        platform: "GOOGLE_BUSINESS_PROFILE",
        externalId: "accounts/1/locations/2",
        accessTokenEnc: cipher.encrypt("OLD"),
        refreshTokenEnc: cipher.encrypt("REFRESH"),
        tokenExpiresAt: new Date("2026-10-03T12:00:30Z"),
      },
    );
    const { repo, calls } = fakeRepo(target);
    const seen: Array<{ account: { accessToken: string } }> = [];
    const google = {
      refresh: async (rt: string) => {
        expect(rt).toBe("REFRESH");
        return { accessToken: "NEW", expiresAt: new Date("2026-10-03T13:00:00Z") };
      },
    };
    const out = await processTarget(deps(repo, { ...okPublisher(seen), platform: "GOOGLE_BUSINESS_PROFILE" }, google), "t1");
    expect(out.outcome).toBe("published");
    expect(seen[0]?.account.accessToken).toBe("NEW");
    const tokenCall = calls.find((c) => c.op === "token");
    expect(tokenCall).toBeDefined();
    expect(cipher.decrypt(tokenCall!.args[1] as string)).toBe("NEW");
  });
});
