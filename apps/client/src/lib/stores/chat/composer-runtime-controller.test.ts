import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatInteractionStateRead,
  ChatThreadShellRead,
  ResolveChatApprovalCommand,
  ResolveChatUserInputCommand,
} from "$lib/chat/contracts";
import { ChatComposerRuntimeController } from "./composer-runtime-controller.svelte";

const api = vi.hoisted(() => ({
  readInteraction: vi.fn<(threadId: string) => Promise<ChatInteractionStateRead>>(),
  resolveApproval: vi.fn<(request: ResolveChatApprovalCommand) => Promise<void>>(),
  resolveUserInput: vi.fn<(request: ResolveChatUserInputCommand) => Promise<void>>(),
}));

vi.mock("$lib/api/chat", async (importOriginal) => ({
  ...await importOriginal<typeof import("$lib/api/chat")>(),
  readChatInteractionState: api.readInteraction,
  resolveChatApproval: api.resolveApproval,
  resolveChatUserInput: api.resolveUserInput,
}));

describe("ChatComposerRuntimeController interactions", () => {
  beforeEach(() => {
    api.readInteraction.mockReset();
    api.resolveApproval.mockReset().mockResolvedValue();
    api.resolveUserInput.mockReset().mockResolvedValue();
  });

  it("resolves pending requests without a streaming-sensitive thread revision", async () => {
    const thread = threadShell();
    const controller = new ChatComposerRuntimeController({
      selectedThread: () => thread,
      selectedThreadId: () => thread.id,
      selectedWorkingFolderId: () => thread.workingFolderId,
      selectedExecutionEnvironmentId: () => null,
      setSelectedThreadId: vi.fn(),
      upsertThread: vi.fn(),
      loadTimeline: vi.fn(async () => undefined),
      clearTimeline: vi.fn(),
      setSettings: vi.fn(),
      onComposerChanged: vi.fn(),
    });
    controller.interaction = interaction("approval");
    api.readInteraction.mockResolvedValue(interaction(null));

    await controller.resolveApproval({
      kind: "allow_once",
      providerOptionId: "accept",
      updatedToolInput: null,
    });

    expect(api.resolveApproval).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ expectedThreadRevision: null }),
      threadId: thread.id,
      requestId: "request-1",
      providerRequestId: "provider-request-1",
    }));

    controller.interaction = interaction("user_input");
    await controller.resolveUserInput([{
      questionId: "scope",
      selectedOptionIds: ["tests"],
      freeFormText: null,
    }]);

    expect(api.resolveUserInput).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ expectedThreadRevision: null }),
      threadId: thread.id,
      requestId: "request-1",
      providerRequestId: "provider-request-1",
    }));
  });
});

function interaction(requestKind: "approval" | "user_input" | null): ChatInteractionStateRead {
  return {
    sessionId: "session-1",
    sessionState: requestKind === "approval" ? "waiting_for_approval"
      : requestKind === "user_input" ? "waiting_for_user_input"
      : "active",
    activeTurnId: "turn-1",
    capabilities: { entries: [] },
    pendingRequest: requestKind ? {
      id: "request-1",
      turnId: "turn-1",
      providerRequestId: "provider-request-1",
      requestKind,
      safeDisplay: { schemaVersion: 1, value: {} },
      allowedDecisions: { schemaVersion: 1, value: [] },
      openedAt: "2026-08-04T12:00:00.000Z",
    } : null,
    queuedFollowup: null,
    usage: null,
    accountStatus: null,
    rateLimitStatus: null,
    automaticCompactionReported: false,
  };
}

function threadShell(): ChatThreadShellRead {
  return {
    id: "thread-1",
    workingFolderId: "working-folder-1",
    executionEnvironmentId: "current-folder:working-folder-1",
    scratchGenerationId: null,
    projectId: "project-1",
    title: "Thread",
    providerFamilyId: "codex",
    providerInstanceId: "codex-1",
    providerThreadId: "provider-thread-1",
    modelId: "gpt-5.6-sol",
    modelOptions: [],
    modes: { safetyMode: "ask_for_approval", interactionMode: "build" },
    state: "active",
    latestTurnState: "active",
    latestPreview: null,
    messageCount: 1,
    revision: 1,
    lastEventSequence: 0,
    lastActivityAt: "2026-08-04T12:00:00.000Z",
    unreadAt: null,
    archivedAt: null,
  };
}
