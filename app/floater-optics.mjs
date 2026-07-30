export const DESKTOP_LAYER_COUNT = 6;
export const CONSTRAINED_LAYER_COUNT = 4;
export const MAX_LAYER_COUNT = DESKTOP_LAYER_COUNT;

export function getLoopProbability(nodeCount, curl3d) {
  if (nodeCount <= 8) return 0;
  const length = Math.max(0, Math.min(1, (nodeCount - 8) / 10));
  const curl = Math.max(0, Math.min(1, curl3d / 150));
  return Math.max(0, Math.min(0.78, Math.pow(length, 1.25) * (0.12 + 0.72 * curl)));
}

/**
 * Maps the simulation's depth buckets to a real, CSS-space circle of confusion.
 * Keeping this calculation outside the animation component makes the optical
 * response deterministic and directly testable.
 */
export function getFilamentLayerOptics(layerIndex, layerCount, blur, constrained = false) {
  const far = layerCount <= 1 ? 0 : layerIndex / (layerCount - 1);
  const blurStrength = Math.pow(Math.max(0, Math.min(90, blur)) / 90, 0.9);
  const maxBlur = constrained ? 24 : 30;
  const rawRadius = blurStrength * maxBlur * Math.pow(far, 1.28);
  const radius = rawRadius < 0.6 ? 0 : rawRadius;
  const contrastGain = Math.min(2.6, Math.sqrt(1 + radius / 2.5));

  return { far, radius, contrastGain };
}

export function getFilamentMaterial(opacity, depth, contrastGain) {
  const alpha = Math.min(0.32, (Math.max(0, opacity) / 100) * (0.42 + 0.12 * depth) * contrastGain);
  return {
    alpha,
    envelope: alpha * 0.16,
    core: alpha * 0.42,
    cells: alpha * 0.045,
  };
}
