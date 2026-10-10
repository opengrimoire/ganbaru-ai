import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}));

beforeEach(() => {
  vi.resetModules();
  invokeMock.mockReset();
});

const identity = {
  publicKey: "a".repeat(43),
  contactId: "person:abcdefghijklmnopqrstuvwxyz012345",
  cardRevision: 2,
  privateKeyAvailable: true,
};

const contact = {
  id: "contact-1",
  publicKey: "b".repeat(43),
  displayName: "Ada",
  color: 7,
  state: "active",
  inviteTrust: "seven_days",
  inviteTrustExpiresAt: "2026-10-15T10:00:00.000Z",
  messageTrust: "not_allowed",
  messageTrustExpiresAt: null,
  acceptedAt: "2026-10-08T10:00:00.000Z",
  blockedAt: null,
  revision: 1,
  createdAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z",
};

const request = {
  id: "request-1",
  direction: "sent",
  publicKey: "c".repeat(43),
  contactId: "person:zyxwvutsrqponmlkjihgfedcba543210",
  displayName: "Grace",
  color: 3,
  verificationCode: "ABCD-EFGH-JKMN",
  inviteTrust: "not_allowed",
  messageTrust: "once",
  state: "pending",
  expiresAt: "2026-10-15T10:00:00.000Z",
  lastAttemptAt: null,
  lastErrorCode: "recipient_unreachable",
  revision: 1,
  createdAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z",
};

describe("parsePeopleSnapshot", () => {
  it("accepts a full snapshot with a missing identity", async () => {
    const { parsePeopleSnapshot } = await import("./people");
    const snapshot = parsePeopleSnapshot({ identity: null, contacts: [contact], requests: [request] });
    expect(snapshot.identity).toBeNull();
    expect(snapshot.contacts[0]?.inviteTrust).toBe("seven_days");
    expect(snapshot.requests[0]?.lastErrorCode).toBe("recipient_unreachable");
  });

  it("rejects trust scopes, states, and colors outside the contract", async () => {
    const { parsePeopleSnapshot } = await import("./people");
    expect(() => parsePeopleSnapshot({ identity, contacts: [{ ...contact, inviteTrust: "forever" }], requests: [] })).toThrow();
    expect(() => parsePeopleSnapshot({ identity, contacts: [{ ...contact, state: "muted" }], requests: [] })).toThrow();
    expect(() => parsePeopleSnapshot({ identity, contacts: [{ ...contact, color: 32 }], requests: [] })).toThrow();
    expect(() => parsePeopleSnapshot({ identity, contacts: [], requests: [{ ...request, direction: "both" }] })).toThrow();
  });
});

describe("parsePeopleLocalCard", () => {
  it("keeps the card absent while the private key is missing", async () => {
    const { parsePeopleLocalCard } = await import("./people");
    const view = parsePeopleLocalCard({ identity: { ...identity, privateKeyAvailable: false }, card: null });
    expect(view.card).toBeNull();
    expect(view.identity.privateKeyAvailable).toBe(false);
  });

  it("validates the QR grid the same way pairing invitations do", async () => {
    const { parsePeopleLocalCard } = await import("./people");
    const card = {
      text: "GANB-abc",
      qr: { width: 2, modules: [true, false, false, true] },
      verificationCode: "ABCD-EFGH-JKMN",
      displayName: "Ada",
      color: 7,
      endpointHint: "",
    };
    expect(parsePeopleLocalCard({ identity, card }).card?.qr.width).toBe(2);
    expect(() => parsePeopleLocalCard({ identity, card: { ...card, qr: { width: 2, modules: [true] } } })).toThrow();
  });
});

describe("normalizePeopleError", () => {
  it("keeps known codes and folds everything else into failed", async () => {
    const { PeopleError, normalizePeopleError } = await import("./people");
    expect(normalizePeopleError({ code: "card_revoked", message: "stale" })).toMatchObject({ code: "card_revoked", message: "stale" });
    expect(normalizePeopleError({ code: "teapot", message: "no" }).code).toBe("failed");
    expect(normalizePeopleError(new Error("boom")).code).toBe("failed");
    expect(normalizePeopleError("plain").message).toBe("plain");
    const typed = new PeopleError("read_only", "ro");
    expect(normalizePeopleError(typed)).toBe(typed);
  });
});

describe("command wrappers", () => {
  it("wraps rejected invocations in a PeopleError", async () => {
    invokeMock.mockRejectedValue({ code: "recipient_unreachable", message: "offline" });
    const { PeopleError, sendContactRequest } = await import("./people");
    await expect(sendContactRequest("GANB-x", { inviteTrust: "once", messageTrust: "not_allowed" })).rejects.toBeInstanceOf(PeopleError);
    expect(invokeMock).toHaveBeenCalledWith("contacts_send_request", {
      request: { cardText: "GANB-x", inviteTrust: "once", messageTrust: "not_allowed" },
    });
  });

  it("sends camera frames as plain arrays and returns the decoded text", async () => {
    invokeMock.mockResolvedValue("GANB-decoded");
    const { decodeContactCardQr } = await import("./people");
    await expect(decodeContactCardQr(2, 1, new Uint8Array([0, 255]))).resolves.toBe("GANB-decoded");
    expect(invokeMock).toHaveBeenCalledWith("contacts_decode_card_qr", { width: 2, height: 1, luma: [0, 255] });
  });

  it("rejects malformed snapshots from the native side", async () => {
    invokeMock.mockResolvedValue({ identity, contacts: "none", requests: [] });
    const { listPeople } = await import("./people");
    await expect(listPeople()).rejects.toThrow();
  });
});
