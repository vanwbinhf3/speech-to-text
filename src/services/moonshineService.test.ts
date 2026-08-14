import { describe, expect, it, vi } from "vitest";
import { ModelArch } from "@moonshine-ai/moonshine-wasm";

import {
  MOONSHINE_MODELS,
  MoonshineService,
  getBrowserSupportError,
  type MoonshineModelVariant,
  type MoonshineRuntimeFactory,
  type MoonshineStreamListener,
  type RuntimeHandlers,
} from "./moonshineService";

describe("getBrowserSupportError", () => {
  it("requires cross-origin isolation for the threaded Moonshine build", () => {
    expect(
      getBrowserSupportError({
        hasWebAssembly: true,
        hasAudioContext: true,
        hasMediaDevices: true,
        isCrossOriginIsolated: false,
      })?.code,
    ).toBe("cross-origin-isolation");
  });

  it("accepts a compatible browser", () => {
    expect(
      getBrowserSupportError({
        hasWebAssembly: true,
        hasAudioContext: true,
        hasMediaDevices: true,
        isCrossOriginIsolated: true,
      }),
    ).toBeNull();
  });
});

describe("MoonshineService", () => {
  it("maps Tiny, Small, and Medium variants to their streaming architectures", () => {
    expect(MOONSHINE_MODELS["tiny-streaming"].arch).toBe(
      ModelArch.TinyStreaming,
    );
    expect(MOONSHINE_MODELS["small-streaming"].arch).toBe(
      ModelArch.SmallStreaming,
    );
    expect(MOONSHINE_MODELS["medium-streaming"].arch).toBe(
      ModelArch.MediumStreaming,
    );
    expect(MOONSHINE_MODELS["tiny-streaming"].parameters).toBe("34M");
  });

  it("deduplicates concurrent initialization", async () => {
    const { factory } = createFakeRuntime();
    const service = new MoonshineService(factory, () => null);

    await Promise.all([
      service.initialize("small-streaming"),
      service.initialize("small-streaming"),
    ]);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(
      "small-streaming",
      expect.any(Object),
    );
  });

  it("closes the loaded model before switching variants", async () => {
    const first = createFakeRuntime();
    const second = createFakeRuntime();
    const factory = vi
      .fn<MoonshineRuntimeFactory>()
      .mockImplementationOnce(first.factory)
      .mockImplementationOnce(second.factory);
    const service = new MoonshineService(factory, () => null);

    await service.initialize("small-streaming");
    await service.initialize("medium-streaming");

    expect(first.closeTranscriber).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls.map(([variant]) => variant)).toEqual([
      "small-streaming",
      "medium-streaming",
    ]);
  });

  it("discards a stale model load before activating the newer variant", async () => {
    let finishSmall: (() => void) | undefined;
    const small = createFakeRuntime(
      new Promise<void>((resolve) => {
        finishSmall = resolve;
      }),
    );
    const medium = createFakeRuntime();
    const factory = vi
      .fn<MoonshineRuntimeFactory>()
      .mockImplementationOnce(small.factory)
      .mockImplementationOnce(medium.factory);
    const service = new MoonshineService(factory, () => null);

    const smallLoad = service.initialize("small-streaming");
    const mediumLoad = service.initialize("medium-streaming");
    finishSmall?.();
    await Promise.all([smallLoad, mediumLoad]);

    expect(small.closeTranscriber).toHaveBeenCalledTimes(1);
    expect(service.loadedVariant).toBe("medium-streaming");
  });

  it("feeds external PCM chunks into a streaming session", async () => {
    const fake = createFakeRuntime();
    const service = new MoonshineService(fake.factory, () => null);
    const listeningStates: boolean[] = [];

    const session = await service.beginStream({
      onListeningStateChange: (listening) => listeningStates.push(listening),
    });

    session.acceptAudio(Float32Array.from([0.1, 0.2]));

    expect(fake.stream.addAudio).toHaveBeenCalledWith(
      expect.any(Float32Array),
      16_000,
    );
    expect(fake.stream.transcribe).toHaveBeenCalled();
    expect(listeningStates).toEqual([true]);
  });

  it("forwards partial and final transcripts and auto-stops", async () => {
    const fake = createFakeRuntime();
    const service = new MoonshineService(fake.factory, () => null);
    const partials: string[] = [];
    const finals: string[] = [];
    const listeningStates: boolean[] = [];

    await service.beginStream({
      onPartialTranscript: (text) => partials.push(text),
      onFinalTranscript: (result) => finals.push(result.text),
      onListeningStateChange: (listening) => listeningStates.push(listening),
    });
    fake.handlers?.onText("open dash");
    fake.handlers?.onLine({
      id: "9007199254740993001",
      text: "open dashboard",
      lastTranscriptionLatencyMs: 81,
    });
    await vi.waitFor(() => expect(fake.stream.stop).toHaveBeenCalledTimes(1));

    expect(partials).toEqual(["open dash"]);
    expect(finals).toEqual(["open dashboard"]);
    expect(listeningStates).toEqual([true, false]);
  });

  it("deduplicates concurrent stop requests", async () => {
    const fake = createFakeRuntime();
    const service = new MoonshineService(fake.factory, () => null);
    const session = await service.beginStream({});

    await Promise.all([session.stop(), session.stop()]);

    expect(fake.stream.stop).toHaveBeenCalledTimes(1);
  });

  it("cancels deferred disposal when StrictMode immediately initializes again", async () => {
    vi.useFakeTimers();
    const fake = createFakeRuntime();
    const service = new MoonshineService(fake.factory, () => null);
    await service.initialize();

    void service.dispose();
    await service.initialize();
    await vi.runAllTimersAsync();

    expect(fake.stream.close).not.toHaveBeenCalled();
    expect(fake.closeTranscriber).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("closes a runtime that finishes loading after the component unmounts", async () => {
    vi.useFakeTimers();
    let finishLoading: (() => void) | undefined;
    const fake = createFakeRuntime(
      new Promise<void>((resolve) => {
        finishLoading = resolve;
      }),
    );
    const service = new MoonshineService(fake.factory, () => null);
    const initialization = service.initialize();

    const disposal = service.dispose();
    await vi.advanceTimersByTimeAsync(0);
    finishLoading?.();
    await initialization;
    await disposal;

    expect(fake.stream.close).not.toHaveBeenCalled();
    expect(fake.closeTranscriber).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

function createFakeRuntime(loadGate: Promise<void> = Promise.resolve()) {
  let handlers: RuntimeHandlers | undefined;
  let listener: MoonshineStreamListener | undefined;
  const stream = {
    addListener: vi.fn((nextListener: MoonshineStreamListener) => {
      listener = nextListener;
    }),
    removeAllListeners: vi.fn(),
    start: vi.fn(),
    addAudio: vi.fn(),
    transcribe: vi.fn(() => ({ lines: [] })),
    stop: vi.fn(),
    close: vi.fn(),
  };
  const closeTranscriber = vi.fn();
  const factory = vi.fn<MoonshineRuntimeFactory>(async (
    _variant: MoonshineModelVariant,
    nextHandlers: RuntimeHandlers,
  ) => {
    await loadGate;
    handlers = nextHandlers;
    return {
      createStream: () => stream,
      close: closeTranscriber,
    };
  });

  return {
    factory,
    get handlers() {
      return handlers;
    },
    get listener() {
      return listener;
    },
    stream,
    closeTranscriber,
  };
}
