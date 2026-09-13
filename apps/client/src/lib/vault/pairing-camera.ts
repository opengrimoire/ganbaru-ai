import { decodePairingQr } from "$lib/api/vault-handoff";

const MAX_SCAN_WIDTH = 1280;
const MAX_SCAN_HEIGHT = 720;

/** Converts an RGBA camera frame into the bounded grayscale input used by the native decoder. */
export function pairingFrameToLuma(rgba: Uint8ClampedArray): Uint8Array {
  if (rgba.length % 4 !== 0) throw new Error("Invalid pairing camera frame");
  const luma = new Uint8Array(rgba.length / 4);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
    luma[target] = Math.round(
      rgba[source] * 0.299 + rgba[source + 1] * 0.587 + rgba[source + 2] * 0.114,
    );
  }
  return luma;
}

/** Owns the Android WebView camera stream used to scan a desktop pairing invitation. */
export class PairingCameraScanner {
  readonly #video: HTMLVideoElement;
  readonly #canvas = document.createElement("canvas");
  #stream: MediaStream | null = null;

  constructor(video: HTMLVideoElement) {
    this.#video = video;
  }

  /** Requests the rear camera and attaches its preview to the supplied video element. */
  async start(): Promise<void> {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera scanning is unavailable on this device");
    }
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: MAX_SCAN_WIDTH },
        height: { ideal: MAX_SCAN_HEIGHT },
      },
    });
    this.#video.srcObject = this.#stream;
    this.#video.playsInline = true;
    await this.#video.play();
  }

  /** Decodes the current preview frame, returning a validated invitation string. */
  async scanFrame(): Promise<string> {
    const sourceWidth = this.#video.videoWidth;
    const sourceHeight = this.#video.videoHeight;
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new Error("Pairing camera is not ready");
    }
    const scale = Math.min(1, MAX_SCAN_WIDTH / sourceWidth, MAX_SCAN_HEIGHT / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    this.#canvas.width = width;
    this.#canvas.height = height;
    const context = this.#canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Pairing camera frame is unavailable");
    context.drawImage(this.#video, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    return decodePairingQr(width, height, pairingFrameToLuma(rgba));
  }

  /** Releases the camera immediately. */
  stop(): void {
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
    this.#video.srcObject = null;
  }
}
