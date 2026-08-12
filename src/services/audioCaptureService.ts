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
  onError?: (error: SpeechServiceError) => void;
}

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
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
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
      const cleanupCallbacks = () => unsubscribe();
      const cleanupVolumeCallbacks = () => unsubscribeVolume();

      if (audioContext.audioWorklet) {
        await startWorkletCapture(audioContext, source, session, () => {
          cleanupCallbacks();
          cleanupVolumeCallbacks();
        });
      } else {
        startScriptProcessorCapture(audioContext, source, session, () => {
          cleanupCallbacks();
          cleanupVolumeCallbacks();
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
    pushRawChannels(session, event.data, audioContext.sampleRate);
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
  onCleanup: () => void,
): void {
  const node = audioContext.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (event) => {
    const channels = Array.from(
      { length: event.inputBuffer.numberOfChannels },
      (_, index) => new Float32Array(event.inputBuffer.getChannelData(index)),
    );
    pushRawChannels(session, channels, audioContext.sampleRate);
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
): void {
  const mono = downmixToMono(channels);
  const resampled = resampleLinear(mono, sampleRate, TARGET_SAMPLE_RATE);
  session.push(resampled);
}

export const audioCaptureService = new AudioCaptureService();

export function calculateInputVolume(chunk: Float32Array): number {
  if (chunk.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of chunk) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / chunk.length);
  return Math.min(1, Math.max(0, rms));
}
