export const PANORAMA_MAX_PITCH = 85;

export function clampPitch(pitch) {
  return Math.max(-PANORAMA_MAX_PITCH, Math.min(PANORAMA_MAX_PITCH, pitch));
}

export function wrapYaw(yaw) {
  return ((yaw + 180) % 360 + 360) % 360 - 180;
}

export function panoramaFov(zoom) {
  const normalizedZoom = Math.max(50, Math.min(200, zoom)) / 100;
  return Math.max(45, Math.min(110, 90 / normalizedZoom));
}

export function panoramaSmoothingFactor(deltaMs, responseMs = 90) {
  const elapsed = Math.max(0, Math.min(64, deltaMs));
  return 1 - Math.exp(-elapsed / Math.max(1, responseMs));
}
