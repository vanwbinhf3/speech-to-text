import {
  AudioChunkFanout,
  TARGET_SAMPLE_RATE,
  concatFloat32Arrays,
  downmixToMono,
  resampleLinear,
  type AudioChunkConsumer,
} from "./pcmAudio";
import { mapSpeechError, SpeechServiceError } from "./moonshineService";

export interface AudioCaptureCallbacks {
  onChunk?: AudioChunkConsumer;
  onVolume?: (level: number) => void;
  onInputLevel?: (level: AudioInputLevel) => void;
  onError?: (error: SpeechServiceError) => void;
  audioProcessingConfig?: AudioProcessingConfig;
}

export type BrowserProcessingMode = "enhanced" | "raw";

export interface AudioProcessingConfig {
  inputGain: number;
  noiseGateEnabled: boolean;
  noiseGateThreshold: number;
  browserProcessingMode: BrowserProcessingMode;
}

export interface AudioInputLevel {
  rms: number;
  peak: number;
}

export const DEFAULT_AUDIO_PROCESSING_CONFIG: AudioProcessingConfig = {
  inputGain: 2,
  noiseGateEnabled: false,
  noiseGateThreshold: 0.015,
  browserProcessingMode: "enhanced",
};

export interface AudioCaptureSession {
  addConsumer(consumer: AudioChunkConsumer): () => void;
  stop(): Promise<Float32Array>;
  readonly stopped: boolean;
}

export class BufferedAudioCaptureSession implements AudioCaptureSession {
  private readonly chunks: Float32Array[] = [];
  private readonly fanout = new AudioChunkFanout();
  private stopPromise: Promise<Float32Array> | null = null;
  private stoppedValue = false;
  private cachedAudio: Float32Array | null = null;

  constructor(private readonly stopSource: () => void | Promise<void>) {}

  get stopped(): boolean {
    return this.stoppedValue;
  }

  addConsumer(consumer: AudioChunkConsumer): () => void {
    return this.fanout.addConsumer(consumer);
  }

  push(chunk: Float32Array): void {
    if (this.stoppedValue) return;
    const copy = new Float32Array(chunk);
    this.chunks.push(copy);
    this.fanout.push(copy);
  }

  async stop(): Promise<Float32Array> {
    if (this.cachedAudio) return new Float32Array(this.cachedAudio);
    if (this.stopPromise) return this.stopPromise;

    this.stopPromise = Promise.resolve()
      .then(() => this.stopSource())
      .then(() => {
        this.stoppedValue = true;
        this.cachedAudio = concatFloat32Arrays(this.chunks);
        return new Float32Array(this.cachedAudio);
      });

    return this.stopPromise;
  }
}

export class AudioCaptureService {
  private currentSession: BufferedAudioCaptureSession | null = null;

  async start(callbacks: AudioCaptureCallbacks = {}): Promise<AudioCaptureSession> {
    if (this.currentSession && !this.currentSession.stopped) {
      return this.currentSession;
    }

    try {
      assertAudioSupport();
      const audioProcessingConfig = {
        ...DEFAULT_AUDIO_PROCESSING_CONFIG,
        ...callbacks.audioProcessingConfig,
      };
      const useBrowserProcessing =
        audioProcessingConfig.browserProcessingMode === "enhanced";
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: useBrowserProcessing,
          noiseSuppression: useBrowserProcessing,
          autoGainControl: useBrowserProcessing,
        },
        video: false,
      });
      const AudioContextConstructor =
        window.AudioContext ?? window.webkitAudioContext;
      const audioContext = new AudioContextConstructor();
      const source = audioContext.createMediaStreamSource(mediaStream);
      const session = new BufferedAudioCaptureSession(async () => {
        source.disconnect();
        for (const track of mediaStream.getTracks()) track.stop();
        await audioContext.close();
        if (this.currentSession === session) this.currentSession = null;
      });

      const unsubscribe = callbacks.onChunk
        ? session.addConsumer(callbacks.onChunk)
        : () => undefined;
      const unsubscribeVolume = callbacks.onVolume
        ? session.addConsumer((chunk) => callbacks.onVolume?.(calculateInputVolume(chunk)))
        : () => undefined;
      const unsubscribeInputLevel = callbacks.onInputLevel
        ? session.addConsumer((chunk) =>
            callbacks.onInputLevel?.({
              rms: calculateInputVolume(chunk),
              peak: calculateInputPeakVolume(chunk),
            }),
          )
        : () => undefined;
      const cleanupCallbacks = () => unsubscribe();
      const cleanupVolumeCallbacks = () => unsubscribeVolume();
      const cleanupInputLevelCallbacks = () => unsubscribeInputLevel();

      if (audioContext.audioWorklet) {
        await startWorkletCapture(audioContext, source, session, audioProcessingConfig, () => {
          cleanupCallbacks();
          cleanupVolumeCallbacks();
          cleanupInputLevelCallbacks();
        });
      } else {
        startScriptProcessorCapture(audioContext, source, session, audioProcessingConfig, () => {
          cleanupCallbacks();
          cleanupVolumeCallbacks();
          cleanupInputLevelCallbacks();
        });
      }

      this.currentSession = session;
      return session;
    } catch (error) {
      const mapped = mapSpeechError(error);
      callbacks.onError?.(mapped);
      throw mapped;
    }
  }
}

function assertAudioSupport(): void {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof window === "undefined" ||
    !(window.AudioContext ?? window.webkitAudioContext)
  ) {
    throw new SpeechServiceError(
      "unsupported-browser",
      "Your browser does not support the required audio/WebAssembly features. Please use a recent version of Chrome or Edge.",
    );
  }
}

async function startWorkletCapture(
  audioContext: AudioContext,
  source: MediaStreamAudioSourceNode,
  session: BufferedAudioCaptureSession,
  audioProcessingConfig: AudioProcessingConfig,
  onCleanup: () => void,
): Promise<void> {
  const processorCode = `
    class PcmCaptureProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0] || [];
        if (!input.length || !input[0]?.length) return true;
        const channels = input.map((channel) => new Float32Array(channel));
        this.port.postMessage(channels, channels.map((channel) => channel.buffer));
        return true;
      }
    }
    registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
  `;
  const moduleUrl = URL.createObjectURL(
    new Blob([processorCode], { type: "application/javascript" }),
  );
  await audioContext.audioWorklet.addModule(moduleUrl);
  URL.revokeObjectURL(moduleUrl);

  const node = new AudioWorkletNode(audioContext, "pcm-capture-processor");
  node.port.onmessage = (event: MessageEvent<Float32Array[]>) => {
    pushRawChannels(session, event.data, audioContext.sampleRate, audioProcessingConfig);
  };
  source.connect(node);
  node.connect(audioContext.destination);

  const originalStop = session.stop.bind(session);
  session.stop = async () => {
    node.port.onmessage = null;
    node.disconnect();
    onCleanup();
    return originalStop();
  };
}

function startScriptProcessorCapture(
  audioContext: AudioContext,
  source: MediaStreamAudioSourceNode,
  session: BufferedAudioCaptureSession,
  audioProcessingConfig: AudioProcessingConfig,
  onCleanup: () => void,
): void {
  const node = audioContext.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (event) => {
    const channels = Array.from(
      { length: event.inputBuffer.numberOfChannels },
      (_, index) => new Float32Array(event.inputBuffer.getChannelData(index)),
    );
    pushRawChannels(session, channels, audioContext.sampleRate, audioProcessingConfig);
  };
  source.connect(node);
  node.connect(audioContext.destination);

  const originalStop = session.stop.bind(session);
  session.stop = async () => {
    node.onaudioprocess = null;
    node.disconnect();
    onCleanup();
    return originalStop();
  };
}

function pushRawChannels(
  session: BufferedAudioCaptureSession,
  channels: readonly Float32Array[],
  sampleRate: number,
  audioProcessingConfig: AudioProcessingConfig,
): void {
  const mono = downmixToMono(channels);
  const resampled = resampleLinear(mono, sampleRate, TARGET_SAMPLE_RATE);
  session.push(applyAudioProcessing(resampled, audioProcessingConfig));
}

export const audioCaptureService = new AudioCaptureService();

export function calculateInputVolume(chunk: Float32Array): number {
  if (chunk.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of chunk) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / chunk.length);
  return Math.min(1, Math.max(0, rms));
}

export function calculateInputPeakVolume(chunk: Float32Array): number {
  let peak = 0;
  for (const sample of chunk) peak = Math.max(peak, Math.abs(sample));
  return Math.min(1, Math.max(0, peak));
}

export function applyAudioProcessing(
  chunk: Float32Array,
  config: AudioProcessingConfig,
): Float32Array {
  const gain = Math.min(4, Math.max(1, config.inputGain));
  const gateThreshold = Math.max(0, config.noiseGateThreshold);
  const processed = new Float32Array(chunk.length);

  for (let index = 0; index < chunk.length; index += 1) {
    const sample = chunk[index];
    const gated =
      config.noiseGateEnabled && Math.abs(sample) < gateThreshold ? 0 : sample;
    processed[index] = clampAudioSample(gated * gain);
  }

  return processed;
}

function clampAudioSample(sample: number): number {
  return Math.min(1, Math.max(-1, sample));
}
