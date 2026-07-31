"use client";

import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  CONSTRAINED_LAYER_COUNT,
  DESKTOP_LAYER_COUNT,
  getFilamentMaterial,
  getFilamentLayerOptics,
  getLoopProbability,
  MAX_LAYER_COUNT,
} from "./floater-optics.mjs";

type Settings = {
  count: number;
  response: number;
  lag: number;
  damping: number;
  gravity: number;
  blur: number;
  opacity: number;
  length: number;
  filamentThickness: number;
  lengthDistribution: number;
  curl3d: number;
  blobCount: number;
  blobSizeDistribution: number;
};

type Language = "zh" | "en";

type MotionSample = { time: number; vx: number; vy: number };

type Floater = {
  nodeCount: number;
  state: Float32Array;
  projected: Float32Array;
  rest: Float32Array;
  bendRest: Float32Array;
  shapeRest: Float32Array;
  loopPairs: Uint16Array;
  loopRest: Float32Array;
  curveSamples: Float32Array;
  baseZ: number;
  thickness: number;
  phase: number;
  seed: number;
  generatedLengthScale: number;
  anchorIndex: number;
  anchor: Float32Array;
  anchorRest: Float32Array | null;
  dampingOffset: number;
  fallVelocity: number;
  focusDepth: number;
  focusTilt: number;
  focusWave: number;
  cellPhase: number;
};

type BlobFloater = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  depth: number;
  radius: number;
  angle: number;
  spin: number;
  phase: number;
  dampingOffset: number;
  fallVelocity: number;
  sprite: HTMLCanvasElement;
};

const X = 0;
const Y = 1;
const Z = 2;
const VX = 3;
const VY = 4;
const VZ = 5;
const STRIDE = 6;
const DEPTH_RANGE = 240;
const CURVE_SAMPLE_STRIDE = 4;
const MAX_CURVE_SUBDIVISIONS = 6;

const defaults: Settings = {
  count: 10,
  response: 20,
  lag: 180,
  damping: 70,
  gravity: 10,
  blur: 30,
  opacity: 30,
  length: 100,
  filamentThickness: 300,
  lengthDistribution: 100,
  curl3d: 110,
  blobCount: 5,
  blobSizeDistribution: 50,
};

const scenes = [
  { id: "sky", icon: "☀" },
  { id: "paper", icon: "Aa" },
  { id: "room", icon: "▦" },
] as const;

const translations = {
  zh: {
    metaTitle: "飞蚊症模拟器",
    metaDescription: "通过鼠标动作体验飞蚊症视觉模拟。",
    switchLanguage: "Switch to English",
    brand: "飞蚊症模拟器",
    brandSubtitle: "Vitreous Field Study",
    canvasLabel: "三维柔性眼内漂浮物动态模拟",
    gestureTitle: "晃动鼠标，观察滞后",
    gestureSubtitle: "丝状漂浮物会在三维空间中柔性摆动",
    collapsePanel: "收起参数面板",
    expandPanel: "展开参数面板",
    adjust: "调节",
    realtime: "实时参数",
    tuning: "漂浮感调校",
    simulating: "模拟中",
    floaters: "漂浮物",
    count: "数量",
    length: "长度",
    thickness: "条状粗细",
    lengthDistribution: "长度分布",
    curl: "三维蜷曲",
    opacity: "透明度",
    blur: "离焦模糊",
    blobs: "团状漂浮物",
    independentDistribution: "独立分布",
    blobCount: "团状数量",
    blobSizeDistribution: "团状大小分布",
    motionPhysics: "运动物理",
    eyeResponse: "眼球运动响应",
    response: "跟随灵敏度",
    lag: "响应滞后",
    damping: "玻璃体阻尼",
    gravity: "重力沉降",
    physicsNote: "每条漂浮物具有轻微不同的惯性阻尼；重力沉降使用独立通道，不受随机阻尼差异影响。",
    background: "观察背景",
    backgroundHint: "高亮背景更明显",
    scenes: { sky: "晴空", paper: "阅读", room: "室内" },
    custom: "自定义",
    reset: "重置",
    disclaimer: "这是一种视觉现象模拟，并非医学诊断。",
    adaptiveRendering: "三维自适应渲染",
  },
  en: {
    metaTitle: "Eye Floater Simulator",
    metaDescription: "Explore an interactive eye-floater simulation with inertia, gravity, and vitreous damping.",
    switchLanguage: "切换到中文",
    brand: "Vitreous Field Lab",
    brandSubtitle: "Vitreous Field Study",
    canvasLabel: "Interactive three-dimensional eye floater simulation",
    gestureTitle: "Move the pointer to observe the lag",
    gestureSubtitle: "Filaments flex and drift through three-dimensional space",
    collapsePanel: "Collapse controls",
    expandPanel: "Expand controls",
    adjust: "Adjust",
    realtime: "Live parameters",
    tuning: "Floater tuning",
    simulating: "Simulating",
    floaters: "Filament floaters",
    count: "Count",
    length: "Length",
    thickness: "Filament thickness",
    lengthDistribution: "Length distribution",
    curl: "3D curl",
    opacity: "Opacity",
    blur: "Defocus blur",
    blobs: "Cloud floaters",
    independentDistribution: "independent distribution",
    blobCount: "Cloud count",
    blobSizeDistribution: "Cloud size distribution",
    motionPhysics: "Motion physics",
    eyeResponse: "Eye-movement response",
    response: "Follow sensitivity",
    lag: "Response lag",
    damping: "Vitreous damping",
    gravity: "Gravity settling",
    physicsNote: "Each floater has slightly different inertial damping. Gravity settling uses an independent channel and is not affected by this variation.",
    background: "Viewing background",
    backgroundHint: "Floaters stand out against bright scenes",
    scenes: { sky: "Clear sky", paper: "Reading", room: "Indoor" },
    custom: "Custom",
    reset: "Reset",
    disclaimer: "This visual simulation is not a medical diagnosis.",
    adaptiveRendering: "Adaptive 3D rendering",
  },
} as const;

const LANGUAGE_STORAGE_KEY = "vitreous-field-language";

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const randomBetween = (low: number, high: number) => low + Math.random() * (high - low);
const randomSigned = () => Math.random() * 2 - 1;

function filamentLengthScale(length: number) {
  if (length <= 90) return 0.64 + length / 70;
  const previousMaximum = 0.64 + 90 / 70;
  return previousMaximum * (1 + ((length - 90) / 180) * 2);
}

const BASE_STROKE_SCALE = 0.52 + 50 / 58;

function nodeCapForCount(count: number, constrained = false) {
  if (constrained) return count > 56 ? 16 : count > 40 ? 22 : 28;
  if (count > 56) return 20;
  if (count > 40) return 28;
  return 36;
}

function chooseNodeCount(lengthDistribution: number, maxNodes: number) {
  const low = [0.42, 0.36, 0.18, 0.04];
  const middle = [0.18, 0.28, 0.34, 0.20];
  const high = [0.06, 0.14, 0.36, 0.44];
  const ultra = [0.02, 0.06, 0.22, 0.70];
  const weights = new Array<number>(4);
  if (lengthDistribution <= 55) {
    const t = lengthDistribution / 55;
    for (let i = 0; i < 4; i++) weights[i] = low[i] + (middle[i] - low[i]) * t;
  } else if (lengthDistribution <= 100) {
    const t = (lengthDistribution - 55) / 45;
    for (let i = 0; i < 4; i++) weights[i] = middle[i] + (high[i] - middle[i]) * t;
  } else {
    const t = clamp((lengthDistribution - 100) / 100, 0, 1);
    for (let i = 0; i < 4; i++) weights[i] = high[i] + (ultra[i] - high[i]) * t;
  }
  const roll = Math.random();
  if (roll < weights[0]) return 1;
  if (roll < weights[0] + weights[1]) return Math.min(maxNodes, 2 + Math.floor(Math.random() * 3));
  if (roll < weights[0] + weights[1] + weights[2]) return Math.min(maxNodes, 5 + Math.floor(Math.random() * 4));
  const requestedLongMax = lengthDistribution <= 85
    ? 14
    : lengthDistribution <= 100
      ? 18
      : 18 + Math.round(((lengthDistribution - 100) / 100) * 18);
  const longMax = Math.min(maxNodes, requestedLongMax);
  return Math.min(longMax, 9 + Math.floor(Math.random() * Math.max(1, longMax - 8)));
}

function makeFloater(width: number, height: number, settings: Settings, maxNodes: number, forceLoop = false): Floater {
  const nodeCount = forceLoop
    ? Math.min(maxNodes, 12 + Math.floor(Math.random() * Math.max(1, Math.min(7, maxNodes - 11))))
    : chooseNodeCount(settings.lengthDistribution, maxNodes);
  const state = new Float32Array(nodeCount * STRIDE);
  const projected = new Float32Array(nodeCount * 3);
  const rest = new Float32Array(Math.max(0, nodeCount - 1));
  const bendRest = new Float32Array(Math.max(0, nodeCount - 2));
  const shapeRest = new Float32Array(Math.max(0, nodeCount - 3));
  const generatedLengthScale = filamentLengthScale(settings.length);
  const baseRest = randomBetween(6.2, 10.5);
  const stepLength = baseRest * generatedLengthScale;
  const baseDepth = randomBetween(0.24, 0.88);
  const baseZ = (baseDepth - 0.5) * DEPTH_RANGE;
  const lengthFactor = nodeCount <= 1 ? 0 : (nodeCount - 1) / Math.max(1, maxNodes - 1);
  const rawCurl = clamp(settings.curl3d / 100, 0, 1.5);
  const curl = rawCurl * (0.34 + lengthFactor * 0.78);
  const extremeCurl = clamp((rawCurl - 0.72) / 0.78, 0, 1) * clamp((nodeCount - 5) / 9, 0, 1);
  const loopProbability = getLoopProbability(nodeCount, settings.curl3d);
  const makesLoop = forceLoop || (loopProbability > 0 && Math.random() < loopProbability);
  const doubleLoopProbability = nodeCount >= 18
    ? loopProbability * 0.25 * clamp(settings.curl3d / 150, 0, 1)
    : 0;
  const loopCount = makesLoop ? (Math.random() < doubleLoopProbability ? 2 : 1) : 0;
  const loopStart = loopCount ? randomBetween(0.14, 0.19) : 0;
  const loopEnd = loopCount ? randomBetween(0.80, 0.85) : 0;

  if (loopCount > 0) {
    const safeX = Math.min(120, width * 0.16);
    const safeY = Math.min(90, height * 0.16);
    const centerX = width > safeX * 2 ? randomBetween(safeX, width - safeX) : width * 0.5;
    const centerY = height > safeY * 2 ? randomBetween(safeY, height - safeY) : height * 0.5;
    const rotation = Math.random() * Math.PI * 2;
    const phase = Math.random() * Math.PI * 2;
    const depthTilt = randomSigned() * randomBetween(0.08, 0.24);
    const loopSpan = loopEnd - loopStart;
    const radiusX = stepLength * Math.max(1.6, (nodeCount * loopSpan) / (Math.PI * 2 * loopCount)) * randomBetween(0.9, 1.12);
    const radiusY = radiusX * randomBetween(0.58, 0.9);
    const tailLength = stepLength * nodeCount * (1 - loopSpan) * randomBetween(0.68, 0.92);

    const localLoopPoint = (q: number) => {
      const theta = Math.PI + q * Math.PI * 2 * loopCount * 1.035;
      const radialNoise = 1 + Math.sin(theta * 3 + phase) * 0.075 + Math.sin(theta * 5.3 - phase * 0.6) * 0.035;
      const drift = (0.12 + (loopCount - 1) * 0.5) * (q - 0.5) * radiusX;
      return {
        x: Math.cos(theta) * radiusX * radialNoise + drift,
        y: Math.sin(theta) * radiusY * radialNoise + Math.sin(q * Math.PI) * radiusY * 0.12,
        z: Math.sin(theta * 0.7 + phase) * stepLength * 0.18 + (q - 0.5) * stepLength * 0.18,
        theta,
      };
    };
    const startPoint = localLoopPoint(0);
    const endPoint = localLoopPoint(1);
    const startTangentLength = Math.max(0.001, Math.hypot(-Math.sin(startPoint.theta) * radiusX, Math.cos(startPoint.theta) * radiusY));
    const startTangentX = (-Math.sin(startPoint.theta) * radiusX) / startTangentLength;
    const startTangentY = (Math.cos(startPoint.theta) * radiusY) / startTangentLength;
    const tangentLength = Math.max(0.001, Math.hypot(-Math.sin(endPoint.theta) * radiusX, Math.cos(endPoint.theta) * radiusY));
    const tangentX = (-Math.sin(endPoint.theta) * radiusX) / tangentLength;
    const tangentY = (Math.cos(endPoint.theta) * radiusY) / tangentLength;

    for (let i = 0; i < nodeCount; i++) {
      const u = nodeCount <= 1 ? 0.5 : i / (nodeCount - 1);
      let lx: number;
      let ly: number;
      let lz: number;
      if (u < loopStart) {
        const q = u / loopStart;
        lx = startPoint.x - startTangentX * tailLength * (1 - q) + Math.sin(q * Math.PI) * radiusX * 0.1;
        ly = startPoint.y - startTangentY * tailLength * (1 - q) + Math.sin(q * Math.PI + phase * 0.4) * radiusY * 0.1;
        lz = startPoint.z - stepLength * 0.16 * (1 - q);
      } else if (u <= loopEnd) {
        const point = localLoopPoint((u - loopStart) / loopSpan);
        lx = point.x;
        ly = point.y;
        lz = point.z;
      } else {
        const q = (u - loopEnd) / (1 - loopEnd);
        lx = endPoint.x + tangentX * tailLength * q + radiusX * 0.16 * q * q;
        ly = endPoint.y + tangentY * tailLength * q + Math.sin(q * Math.PI) * radiusY * 0.14;
        lz = endPoint.z + stepLength * 0.18 * q;
      }
      const offset = i * STRIDE;
      state[offset + X] = centerX + lx * Math.cos(rotation) - ly * Math.sin(rotation);
      state[offset + Y] = centerY + lx * Math.sin(rotation) + ly * Math.cos(rotation);
      state[offset + Z] = clamp(baseZ + lz + ly * depthTilt * 0.16, baseZ - 92, baseZ + 92);
    }
  } else {
    let yaw = Math.random() * Math.PI * 2;
    let pitch = randomBetween(-0.42, 0.42);
    let px = randomBetween(-60, width + 60);
    let py = randomBetween(-40, height + 40);
    let pz = baseZ;
    const curlCenterX = px;
    const curlCenterY = py;
    const curlCenterZ = pz;

    for (let i = 0; i < nodeCount; i++) {
      if (i > 0) {
        yaw += randomSigned() * (0.08 + curl * randomBetween(0.42, 1.08));
        pitch = clamp(pitch + randomSigned() * (0.05 + curl * randomBetween(0.3, 0.78)), -1.28, 1.28);
        if (nodeCount >= 8 && Math.random() < curl * 0.14 + extremeCurl * 0.16) {
          yaw += randomSigned() * randomBetween(0.75, 2.5);
          pitch = clamp(pitch + randomSigned() * randomBetween(0.25, 1.05), -1.32, 1.32);
        }
        if (extremeCurl > 0) {
          const towardX = curlCenterX - px;
          const towardY = curlCenterY - py;
          const towardZ = curlCenterZ - pz;
          const planarDistance = Math.hypot(towardX, towardY);
          const distance = Math.hypot(planarDistance, towardZ);
          const clusterRadius = stepLength * (1.15 + (1 - extremeCurl) * 2.2);
          const inward = clamp((distance - clusterRadius * 0.45) / Math.max(1, clusterRadius), 0, 1) * extremeCurl * randomBetween(0.24, 0.72);
          const targetYaw = Math.atan2(towardY, towardX);
          const targetPitch = Math.atan2(towardZ, Math.max(0.001, planarDistance));
          yaw += Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw)) * inward;
          pitch += (targetPitch - pitch) * inward * randomBetween(0.45, 0.9);
        }
        const irregularStep = stepLength * randomBetween(0.72 + extremeCurl * 0.04, 1.18);
        const planar = Math.cos(pitch) * irregularStep;
        px += Math.cos(yaw) * planar;
        py += Math.sin(yaw) * planar;
        pz = clamp(pz + Math.sin(pitch) * irregularStep, baseZ - 92, baseZ + 92);
      }
      const offset = i * STRIDE;
      state[offset + X] = px;
      state[offset + Y] = py;
      state[offset + Z] = pz;
    }
  }

  for (let i = 0; i < nodeCount - 1; i++) {
    const a = i * STRIDE;
    const b = (i + 1) * STRIDE;
    rest[i] = Math.hypot(state[b + X] - state[a + X], state[b + Y] - state[a + Y], state[b + Z] - state[a + Z]);
  }
  for (let i = 0; i < nodeCount - 2; i++) {
    const a = i * STRIDE;
    const b = (i + 2) * STRIDE;
    bendRest[i] = Math.hypot(state[b + X] - state[a + X], state[b + Y] - state[a + Y], state[b + Z] - state[a + Z]);
  }
  for (let i = 0; i < nodeCount - 3; i++) {
    const a = i * STRIDE;
    const b = (i + 3) * STRIDE;
    shapeRest[i] = Math.hypot(state[b + X] - state[a + X], state[b + Y] - state[a + Y], state[b + Z] - state[a + Z]);
  }

  const loopPairs = new Uint16Array(loopCount * 2);
  const loopRest = new Float32Array(loopCount);
  for (let loop = 0; loop < loopCount; loop++) {
    const startProgress = loopStart + (loopEnd - loopStart) * (loop / loopCount);
    const endProgress = loopStart + (loopEnd - loopStart) * ((loop + 1) / loopCount);
    const first = Math.round(startProgress * (nodeCount - 1));
    const second = Math.round(endProgress * (nodeCount - 1));
    const a = first * STRIDE;
    const b = second * STRIDE;
    loopPairs[loop * 2] = first;
    loopPairs[loop * 2 + 1] = second;
    loopRest[loop] = Math.hypot(state[b + X] - state[a + X], state[b + Y] - state[a + Y], state[b + Z] - state[a + Z]);
  }

  const anchorIndex = nodeCount >= 9 && Math.random() < 0.16 ? (Math.random() < 0.5 ? 0 : nodeCount - 1) : -1;
  const anchor = new Float32Array(3);
  const anchorRest = anchorIndex >= 0 ? new Float32Array(nodeCount * 3) : null;
  if (anchorIndex >= 0) {
    const offset = anchorIndex * STRIDE;
    anchor[0] = state[offset + X];
    anchor[1] = state[offset + Y];
    anchor[2] = state[offset + Z];
    for (let i = 0; i < nodeCount; i++) {
      const source = i * STRIDE;
      const target = i * 3;
      anchorRest![target] = state[source + X] - anchor[0];
      anchorRest![target + 1] = state[source + Y] - anchor[1];
      anchorRest![target + 2] = state[source + Z] - anchor[2];
    }
  }

  const focusRoll = Math.random();
  const focusDepth = focusRoll < 0.25
    ? randomBetween(0.8, 0.98)
    : focusRoll < 0.6
      ? randomBetween(0.32, 0.78)
      : randomBetween(0.03, 0.28);
  const focusTilt = nodeCount >= 5
    ? randomSigned() * randomBetween(0.18, 0.92) * (0.42 + lengthFactor * 0.58)
    : randomSigned() * 0.12;
  const focusWave = nodeCount >= 7 ? randomBetween(0.025, 0.14) * Math.random() : 0;

  return {
    nodeCount,
    state,
    projected,
    rest,
    bendRest,
    shapeRest,
    loopPairs,
    loopRest,
    curveSamples: new Float32Array(Math.max(1, (nodeCount - 1) * MAX_CURVE_SUBDIVISIONS + 1) * CURVE_SAMPLE_STRIDE),
    baseZ,
    thickness: randomBetween(0.75, 1.7),
    phase: Math.random() * Math.PI * 2,
    seed: Math.random() * 1000,
    generatedLengthScale,
    anchorIndex,
    anchor,
    anchorRest,
    dampingOffset: (Math.random() + Math.random() - 1) * 9,
    fallVelocity: 0,
    focusDepth,
    focusTilt,
    focusWave,
    cellPhase: Math.random() * Math.PI * 2,
  };
}

function createBlobSprite(radius: number): HTMLCanvasElement {
  const blur = 9 + radius * 0.2;
  const padding = Math.ceil(blur * 2.6);
  const size = Math.ceil(radius * 2 + padding * 2);
  const source = document.createElement("canvas");
  const sprite = document.createElement("canvas");
  source.width = size;
  source.height = size;
  sprite.width = size;
  sprite.height = size;
  const sourceCtx = source.getContext("2d");
  const spriteCtx = sprite.getContext("2d");
  if (!sourceCtx || !spriteCtx) return sprite;

  const cx = size * 0.5;
  const cy = size * 0.5;
  const points = 14 + Math.floor(Math.random() * 5);
  const vertices: Array<[number, number]> = [];
  let irregularity = randomBetween(0.16, 0.34);
  for (let i = 0; i < points; i++) {
    const theta = (i / points) * Math.PI * 2;
    const lobe = Math.sin(theta * randomBetween(2.2, 4.6) + Math.random() * 5) * irregularity;
    const r = radius * clamp(1 + lobe + randomSigned() * 0.13, 0.58, 1.38);
    vertices.push([cx + Math.cos(theta) * r, cy + Math.sin(theta) * r]);
    irregularity = clamp(irregularity + randomSigned() * 0.045, 0.13, 0.38);
  }

  sourceCtx.beginPath();
  sourceCtx.moveTo(vertices[0][0], vertices[0][1]);
  for (let i = 0; i < points; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % points];
    const mx = (current[0] + next[0]) * 0.5;
    const my = (current[1] + next[1]) * 0.5;
    sourceCtx.quadraticCurveTo(current[0], current[1], mx, my);
  }
  sourceCtx.closePath();
  const gradient = sourceCtx.createRadialGradient(cx - radius * 0.12, cy - radius * 0.1, radius * 0.05, cx, cy, radius * 1.18);
  gradient.addColorStop(0, "rgba(25, 34, 36, 0.24)");
  gradient.addColorStop(0.42, "rgba(30, 39, 41, 0.17)");
  gradient.addColorStop(0.76, "rgba(36, 44, 46, 0.075)");
  gradient.addColorStop(1, "rgba(42, 48, 49, 0)");
  sourceCtx.fillStyle = gradient;
  sourceCtx.fill();

  spriteCtx.filter = `blur(${blur}px)`;
  spriteCtx.drawImage(source, 0, 0);
  return sprite;
}

function makeBlob(width: number, height: number, settings: Settings): BlobFloater {
  const spread = clamp(settings.blobSizeDistribution / 100, 0, 1);
  const radius = 15 + Math.pow(Math.random(), 1.65 - spread * 0.9) * (28 + spread * 92);
  return {
    x: randomBetween(-radius, width + radius),
    y: randomBetween(-radius, height + radius),
    vx: 0,
    vy: 0,
    depth: randomBetween(0.12, 0.88),
    radius,
    angle: Math.random() * Math.PI * 2,
    spin: randomSigned() * randomBetween(0.00008, 0.00028),
    phase: Math.random() * Math.PI * 2,
    dampingOffset: (Math.random() + Math.random() - 1) * 9,
    fallVelocity: 0,
    sprite: createBlobSprite(radius),
  };
}

function solveDistance(state: Float32Array, first: number, second: number, target: number, strength: number) {
  const a = first * STRIDE;
  const b = second * STRIDE;
  const dx = state[b + X] - state[a + X];
  const dy = state[b + Y] - state[a + Y];
  const dz = state[b + Z] - state[a + Z];
  const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
  const correction = ((distance - target) / distance) * 0.5 * strength;
  state[a + X] += dx * correction;
  state[a + Y] += dy * correction;
  state[a + Z] += dz * correction;
  state[b + X] -= dx * correction;
  state[b + Y] -= dy * correction;
  state[b + Z] -= dz * correction;
}

function updateProjection(floater: Floater) {
  const { state, projected, nodeCount } = floater;
  let centerX = 0;
  let centerY = 0;
  for (let i = 0; i < nodeCount; i++) {
    const offset = i * STRIDE;
    centerX += state[offset + X];
    centerY += state[offset + Y];
  }
  centerX /= nodeCount;
  centerY /= nodeCount;
  for (let i = 0; i < nodeCount; i++) {
    const source = i * STRIDE;
    const target = i * 3;
    const physicalDepth = clamp(0.02, 0.98, 0.5 + state[source + Z] / DEPTH_RANGE);
    const progress = nodeCount <= 1 ? 0.5 : i / (nodeCount - 1);
    const arc = progress - 0.5;
    const opticalDepth = clamp(0.01, 0.99,
      floater.focusDepth
      + arc * floater.focusTilt
      + Math.sin(progress * Math.PI * 2 + floater.phase) * floater.focusWave,
    );
    const depth = clamp(0.02, 0.98, opticalDepth * 0.82 + physicalDepth * 0.18);
    const perspective = 0.79 + physicalDepth * 0.34;
    projected[target] = centerX + (state[source + X] - centerX) * perspective;
    projected[target + 1] = centerY + (state[source + Y] - centerY) * perspective;
    projected[target + 2] = depth;
  }
}

function traceFloaterPath(ctx: CanvasRenderingContext2D, projected: Float32Array, nodeCount: number) {
  ctx.beginPath();
  ctx.moveTo(projected[0], projected[1]);
  for (let i = 0; i < nodeCount - 1; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    const previous = i > 0 ? (i - 1) * 3 : a;
    const following = i + 2 < nodeCount ? (i + 2) * 3 : b;
    const c1x = projected[a] + (projected[b] - projected[previous]) / 6;
    const c1y = projected[a + 1] + (projected[b + 1] - projected[previous + 1]) / 6;
    const c2x = projected[b] - (projected[following] - projected[a]) / 6;
    const c2y = projected[b + 1] - (projected[following + 1] - projected[a + 1]) / 6;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, projected[b], projected[b + 1]);
  }
}

function sampleProjectedCurve(floater: Floater, subdivisions: number) {
  const { nodeCount, projected, curveSamples } = floater;
  let count = 0;
  for (let segment = 0; segment < nodeCount - 1; segment++) {
    const p0 = Math.max(0, segment - 1) * 3;
    const p1 = segment * 3;
    const p2 = (segment + 1) * 3;
    const p3 = Math.min(nodeCount - 1, segment + 2) * 3;
    const firstStep = segment === 0 ? 0 : 1;
    for (let step = firstStep; step <= subdivisions; step++) {
      const t = step / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;
      const target = count * CURVE_SAMPLE_STRIDE;
      for (let axis = 0; axis < 3; axis++) {
        curveSamples[target + axis] = 0.5 * (
          2 * projected[p1 + axis]
          + (-projected[p0 + axis] + projected[p2 + axis]) * t
          + (2 * projected[p0 + axis] - 5 * projected[p1 + axis] + 4 * projected[p2 + axis] - projected[p3 + axis]) * t2
          + (-projected[p0 + axis] + 3 * projected[p1 + axis] - 3 * projected[p2 + axis] + projected[p3 + axis]) * t3
        );
      }
      if (count === 0) curveSamples[target + 3] = floater.cellPhase;
      else {
        const previous = target - CURVE_SAMPLE_STRIDE;
        curveSamples[target + 3] = Math.atan2(
          curveSamples[target + 1] - curveSamples[previous + 1],
          curveSamples[target] - curveSamples[previous],
        );
      }
      count++;
    }
  }
  return count;
}

function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function getDelayedMotion(history: MotionSample[], targetTime: number) {
  if (!history.length) return { vx: 0, vy: 0 };
  let newer = history.length - 1;
  while (newer > 0 && history[newer - 1].time >= targetTime) newer--;
  if (newer === 0) return history[0];
  const after = history[newer];
  const before = history[newer - 1];
  const span = Math.max(1, after.time - before.time);
  const mix = clamp((targetTime - before.time) / span, 0, 1);
  return { vx: before.vx + (after.vx - before.vx) * mix, vy: before.vy + (after.vy - before.vy) * mix };
}

function Slider({ label, value, min = 0, max = 100, unit = "", displayValue, onChange }: {
  label: string; value: number; min?: number; max?: number; unit?: string; displayValue?: number; onChange: (value: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const shownValue = displayValue ?? value;
  return (
    <label className="control-row">
      <span className="control-label">{label}<output>{shownValue}{unit}</output></span>
      <input type="range" min={min} max={max} value={value} aria-valuetext={`${shownValue}${unit}`} style={{ "--range": `${pct}%` } as React.CSSProperties} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const filamentLayerRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const particlesRef = useRef<Floater[]>([]);
  const blobsRef = useRef<BlobFloater[]>([]);
  const settingsRef = useRef(defaults);
  const shapeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blobTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, lx: 0, ly: 0, vx: 0, vy: 0, active: false, last: 0, history: [] as MotionSample[] });
  const [settings, setSettings] = useState(defaults);
  const [scene, setScene] = useState("sky");
  const [customBackground, setCustomBackground] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const paused = false;
  const [tipVisible, setTipVisible] = useState(true);
  const [language, setLanguage] = useState<Language>("zh");
  const text = translations[language];

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      let saved: string | null = null;
      try { saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY); } catch { /* Storage may be unavailable in privacy mode. */ }
      if (saved === "zh" || saved === "en") {
        setLanguage(saved);
        return;
      }
      const preferences = navigator.languages?.length ? navigator.languages : [navigator.language];
      setLanguage(preferences.some((locale) => locale.toLowerCase().startsWith("zh")) ? "zh" : "en");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = text.metaTitle;
    document.querySelector('meta[name="description"]')?.setAttribute("content", text.metaDescription);
  }, [language, text.metaDescription, text.metaTitle]);
  useEffect(() => () => {
    if (shapeTimerRef.current) clearTimeout(shapeTimerRef.current);
    if (blobTimerRef.current) clearTimeout(blobTimerRef.current);
  }, []);

  const toggleLanguage = () => {
    const next = language === "zh" ? "en" : "zh";
    setLanguage(next);
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Keep the in-memory choice. */ }
  };

  const setValue = (key: keyof Settings, value: number) => {
    const next = { ...settingsRef.current, [key]: value };
    settingsRef.current = next;
    setSettings(next);
  };

  const seedParticles = useCallback((override?: Settings) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const config = override || settingsRef.current;
    const constrained = typeof window !== "undefined" && ((navigator.hardwareConcurrency || 4) <= 4 || window.matchMedia("(pointer: coarse)").matches);
    const cap = nodeCapForCount(config.count, constrained);
    const next = Array.from({ length: config.count }, () => makeFloater(canvas.clientWidth, canvas.clientHeight, config, cap));
    const shouldIncludeReferenceLoop = config.count >= 16 && config.curl3d >= 45 && config.lengthDistribution >= 40;
    if (shouldIncludeReferenceLoop && !next.some((floater) => floater.loopRest.length > 0)) {
      const loopConfig = { ...config, lengthDistribution: Math.max(100, config.lengthDistribution) };
      const candidate = makeFloater(canvas.clientWidth, canvas.clientHeight, loopConfig, cap, true);
      let replaceIndex = 0;
      for (let i = 1; i < next.length; i++) {
        if (next[i].nodeCount < next[replaceIndex].nodeCount) replaceIndex = i;
      }
      next[replaceIndex] = candidate;
    }
    particlesRef.current = next;
  }, []);

  const seedBlobs = useCallback((override?: Settings) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const config = override || settingsRef.current;
    blobsRef.current = Array.from({ length: config.blobCount }, () => makeBlob(canvas.clientWidth, canvas.clientHeight, config));
  }, []);

  const setShapeValue = (key: "lengthDistribution" | "curl3d", value: number) => {
    setValue(key, value);
    if (shapeTimerRef.current) clearTimeout(shapeTimerRef.current);
    shapeTimerRef.current = setTimeout(() => seedParticles(), 120);
  };

  const setBlobSizeValue = (value: number) => {
    setValue("blobSizeDistribution", value);
    if (blobTimerRef.current) clearTimeout(blobTimerRef.current);
    blobTimerRef.current = setTimeout(() => seedBlobs(), 120);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animation = 0;
    let previous = performance.now();
    let lastDraw = 0;
    let renderDpr = 1;
    let layerScale = 0.62;
    let width = window.innerWidth;
    let height = window.innerHeight;
    const cores = navigator.hardwareConcurrency || 4;
    const isConstrained = cores <= 4 || window.matchMedia("(pointer: coarse)").matches;
    const frameInterval = isConstrained ? 1000 / 45 : 1000 / 60;
    const layerCount = isConstrained ? CONSTRAINED_LAYER_COUNT : DESKTOP_LAYER_COUNT;
    const constraintIterations = isConstrained ? 2 : 3;
    const layerCanvases = filamentLayerRefs.current.slice(0, layerCount);
    const layerContexts = layerCanvases.map((item) => item?.getContext("2d") ?? null);

    if (layerCanvases.length !== layerCount || layerCanvases.some((item) => !item)) return;

    for (let i = 0; i < MAX_LAYER_COUNT; i++) {
      const item = filamentLayerRefs.current[i];
      if (item) item.style.display = i < layerCount ? "block" : "none";
    }

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const megapixels = (width * height) / 1_000_000;
      const dprLimit = isConstrained || megapixels > 2.2 ? 1 : 1.5;
      renderDpr = Math.min(window.devicePixelRatio || 1, dprLimit);
      layerScale = isConstrained ? 0.48 : 0.62;
      canvas.width = Math.round(width * renderDpr);
      canvas.height = Math.round(height * renderDpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(renderDpr, 0, 0, renderDpr, 0, 0);
      const layerDpr = renderDpr * layerScale;
      for (let i = 0; i < layerCount; i++) {
        layerCanvases[i]!.width = Math.max(1, Math.round(width * layerDpr));
        layerCanvases[i]!.height = Math.max(1, Math.round(height * layerDpr));
        layerCanvases[i]!.style.width = `${width}px`;
        layerCanvases[i]!.style.height = `${height}px`;
        layerContexts[i]?.setTransform(layerDpr, 0, 0, layerDpr, 0, 0);
      }
      if (!particlesRef.current.length) seedParticles();
      if (!blobsRef.current.length && settingsRef.current.blobCount > 0) seedBlobs();
    };

    const renderLayerPass = (layerIndex: number, cfg: Settings) => {
      const layerCtx = layerContexts[layerIndex];
      if (!layerCtx) return;
      const strokeFactor = BASE_STROKE_SCALE;
      const optics = getFilamentLayerOptics(layerIndex, layerCount, cfg.blur, isConstrained);
      const layerCanvas = layerCanvases[layerIndex]!;
      const filterValue = optics.radius === 0 ? "none" : `blur(${optics.radius.toFixed(2)}px)`;
      if (layerCanvas.style.filter !== filterValue) layerCanvas.style.filter = filterValue;

      for (const floater of particlesRef.current) {
        const { nodeCount, projected } = floater;
        const bucket = Math.min(layerCount - 1, Math.floor((1 - floater.focusDepth) * layerCount));
        if (bucket !== layerIndex) continue;
        let averageDepth = 0;
        for (let i = 0; i < nodeCount; i++) averageDepth += projected[i * 3 + 2];
        averageDepth /= Math.max(1, nodeCount);
        const material = getFilamentMaterial(cfg.opacity, averageDepth, optics.contrastGain);
        const baseTube = floater.thickness * strokeFactor * (0.76 + averageDepth * 0.48);
        const tube = baseTube * (cfg.filamentThickness / 100);

        if (nodeCount === 1) {
          const radius = Math.max(1.8, tube * 1.4);
          layerCtx.save();
          layerCtx.translate(projected[0], projected[1]);
          layerCtx.rotate(floater.cellPhase);
          layerCtx.beginPath();
          layerCtx.ellipse(0, 0, radius * 0.76, radius * 0.56, 0.18, 0, Math.PI * 2);
          layerCtx.fillStyle = `rgba(10, 13, 14, ${material.envelope})`;
          layerCtx.fill();
          for (let lobe = 0; lobe < 3; lobe++) {
            const theta = lobe * (Math.PI * 2 / 3) + floater.cellPhase * 0.35;
            const jitter = seededUnit(floater.seed + lobe * 7.13);
            layerCtx.beginPath();
            layerCtx.ellipse(
              Math.cos(theta) * radius * 0.18,
              Math.sin(theta) * radius * 0.13,
              radius * (0.38 + jitter * 0.08),
              radius * (0.22 + jitter * 0.07),
              theta + jitter * 0.45,
              0,
              Math.PI * 2,
            );
            layerCtx.fillStyle = `rgba(10, 13, 14, ${material.core * 0.72})`;
            layerCtx.fill();
          }
          layerCtx.restore();
          continue;
        }

        layerCtx.lineCap = "round";
        layerCtx.lineJoin = "round";
        traceFloaterPath(layerCtx, projected, nodeCount);
        layerCtx.lineWidth = Math.max(1.05, tube * 2.15);
        layerCtx.strokeStyle = `rgba(10, 13, 14, ${material.envelope})`;
        layerCtx.stroke();

        traceFloaterPath(layerCtx, projected, nodeCount);
        layerCtx.lineWidth = Math.max(0.72, tube * 1.25);
        layerCtx.strokeStyle = `rgba(10, 13, 14, ${material.core})`;
        layerCtx.stroke();

        const sampleCount = sampleProjectedCurve(floater, isConstrained ? 3 : MAX_CURVE_SUBDIVISIONS);
        const samples = floater.curveSamples;
        // Thick filaments need wider longitudinal spacing. Keeping the old spacing
        // while scaling the width made hundreds of same-colour ellipses overlap
        // until the texture averaged into a featureless solid tube.
        const cellSpacing = Math.max(2.2, baseTube * 1.1, tube * 0.72);
        const thicknessMix = clamp((cfg.filamentThickness - 200) / 300, 0, 1);
        const cellCenterReveal = 0.22 + thicknessMix * 0.3;
        let accumulated = cellSpacing * seededUnit(floater.seed + 19.7);
        let cellIndex = 0;
        layerCtx.beginPath();
        for (let sample = 1; sample < sampleCount; sample++) {
          const current = sample * CURVE_SAMPLE_STRIDE;
          const previous = current - CURVE_SAMPLE_STRIDE;
          accumulated += Math.hypot(samples[current] - samples[previous], samples[current + 1] - samples[previous + 1]);
          if (accumulated < cellSpacing) continue;
          accumulated -= cellSpacing;
          const jitter = seededUnit(floater.seed + cellIndex * 3.71 + 4.2);
          const axisJitter = seededUnit(floater.seed + cellIndex * 5.93 + 8.6);
          const majorRadius = cellSpacing * (0.62 + jitter * 0.08);
          const minorRadius = Math.max(0.32, tube * (0.42 + axisJitter * 0.08));
          const angle = samples[current + 3] + (jitter - 0.5) * 0.16;
          layerCtx.moveTo(
            samples[current] + Math.cos(angle) * majorRadius,
            samples[current + 1] + Math.sin(angle) * majorRadius,
          );
          layerCtx.ellipse(
            samples[current],
            samples[current + 1],
            majorRadius,
            minorRadius,
            angle,
            0,
            Math.PI * 2,
          );
          cellIndex++;
        }

        // The cell structure is primarily a transparency difference: gently
        // remove pigment from each centre, then put back only a faint boundary.
        // This remains visible at blur 0 and naturally merges under defocus.
        layerCtx.save();
        layerCtx.globalCompositeOperation = "destination-out";
        layerCtx.fillStyle = `rgba(0, 0, 0, ${cellCenterReveal})`;
        layerCtx.fill();
        layerCtx.restore();

        layerCtx.lineWidth = Math.max(0.2, tube * 0.08);
        layerCtx.strokeStyle = `rgba(10, 13, 14, ${material.cells})`;
        layerCtx.stroke();
      }
    };

    const frame = (now: number) => {
      if (!paused && now - lastDraw < frameInterval) {
        animation = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min((now - previous) / 16.667, 2.35);
      previous = now;
      lastDraw = now;
      const cfg = settingsRef.current;
      const pointer = pointerRef.current;

      if (!paused) {
        const idle = now - pointer.last > 90;
        if (idle) { pointer.vx *= 0.82; pointer.vy *= 0.82; }
        pointer.history.push({ time: now, vx: pointer.vx, vy: pointer.vy });
        const oldestNeeded = now - 1200;
        while (pointer.history.length > 2 && pointer.history[1].time < oldestNeeded) pointer.history.shift();
        const motion = getDelayedMotion(pointer.history, now - cfg.lag);
        const substeps = dt > 1.45 ? 2 : 1;
        const stepDt = dt / substeps;
        const scaleRatio = filamentLengthScale(cfg.length);
        const curl = clamp(cfg.curl3d / 100, 0, 1.5);

        for (let substep = 0; substep < substeps; substep++) {
          for (const floater of particlesRef.current) {
            const { state, nodeCount } = floater;
            const effectiveDamping = clamp(cfg.damping + floater.dampingOffset, 28, 99);
            const drag = Math.pow(0.88 + effectiveDamping * 0.00108, stepDt);
            const gravityDepth = clamp(0.05, 0.97, 0.5 + floater.baseZ / DEPTH_RANGE);
            floater.fallVelocity *= Math.pow(0.985, stepDt);
            floater.fallVelocity += cfg.gravity * 0.00036 * (0.58 + gravityDepth) * stepDt;
            for (let i = 0; i < nodeCount; i++) {
              const offset = i * STRIDE;
              const anchored = i === floater.anchorIndex;
              const anchorDistance = floater.anchorIndex < 0
                ? 1
                : Math.abs(i - floater.anchorIndex) / Math.max(1, nodeCount - 1);
              const mobility = floater.anchorIndex < 0
                ? 1
                : anchored
                  ? 0.015
                  : 0.16 + anchorDistance * 0.22;
              const depth = clamp(0.05, 0.97, 0.5 + state[offset + Z] / DEPTH_RANGE);
              const arc = nodeCount <= 1 ? 0 : i / (nodeCount - 1) - 0.5;
              const response = (0.8 + depth * 0.36) * (1 + arc * curl * 0.05);
              const impulse = cfg.response * 0.0018 * response;
              const swirl = Math.sin(now * 0.00055 + floater.phase + i * 0.56) * 0.0012 * curl;
              const turbulence = Math.sin(now * 0.00027 + floater.seed + i * 1.71) * 0.00075 * curl;
              state[offset + VX] += (motion.vx * impulse + motion.vy * swirl + turbulence) * mobility * stepDt;
              state[offset + VY] += (motion.vy * impulse - motion.vx * swirl) * mobility * stepDt;
              state[offset + VZ] += (((motion.vx * Math.sin(floater.phase + i) + motion.vy * Math.cos(floater.phase * 0.7 + i)) * 0.00024 * curl + turbulence * 0.55) * mobility - (state[offset + Z] - floater.baseZ) * 0.0001) * stepDt;
              state[offset + VX] *= drag;
              state[offset + VY] *= drag;
              state[offset + VZ] *= Math.min(0.996, drag + 0.025);
              if (floater.anchorIndex >= 0) {
                const anchoredDrag = Math.pow(0.975, stepDt);
                state[offset + VX] *= anchoredDrag;
                state[offset + VY] *= anchoredDrag;
                state[offset + VZ] *= anchoredDrag;
              }
              state[offset + X] += state[offset + VX] * stepDt;
              state[offset + Y] += (state[offset + VY] + floater.fallVelocity) * stepDt;
              state[offset + Z] += state[offset + VZ] * stepDt;
            }

            const lengthScale = scaleRatio / floater.generatedLengthScale;
            const bendStrength = 0.38 + curl * 0.06;
            const shapeStrength = 0.16 + curl * 0.04;
            const iterations = particlesRef.current.length > 56 ? Math.min(2, constraintIterations) : constraintIterations;
            for (let iteration = 0; iteration < iterations; iteration++) {
              for (let i = 0; i < nodeCount - 1; i++) solveDistance(state, i, i + 1, floater.rest[i] * lengthScale, 0.96);
              for (let i = 0; i < nodeCount - 2; i++) solveDistance(state, i, i + 2, floater.bendRest[i] * lengthScale, bendStrength);
              for (let i = 0; i < nodeCount - 3; i++) solveDistance(state, i, i + 3, floater.shapeRest[i] * lengthScale, shapeStrength);
              for (let loop = 0; loop < floater.loopRest.length; loop++) {
                solveDistance(
                  state,
                  floater.loopPairs[loop * 2],
                  floater.loopPairs[loop * 2 + 1],
                  floater.loopRest[loop] * lengthScale,
                  0.1,
                );
              }
              if (floater.anchorIndex >= 0 && floater.anchorRest) {
                for (let i = 0; i < nodeCount; i++) {
                  if (i === floater.anchorIndex) continue;
                  const offset = i * STRIDE;
                  const restOffset = i * 3;
                  const distanceFromAnchor = Math.abs(i - floater.anchorIndex) / Math.max(1, nodeCount - 1);
                  const restoreStrength = 0.055 - distanceFromAnchor * 0.025;
                  const targetX = floater.anchor[0] + floater.anchorRest[restOffset] * lengthScale;
                  const targetY = floater.anchor[1] + floater.anchorRest[restOffset + 1] * lengthScale;
                  const targetZ = floater.anchor[2] + floater.anchorRest[restOffset + 2] * lengthScale;
                  state[offset + X] += (targetX - state[offset + X]) * restoreStrength;
                  state[offset + Y] += (targetY - state[offset + Y]) * restoreStrength;
                  state[offset + Z] += (targetZ - state[offset + Z]) * restoreStrength;
                }
                const anchoredOffset = floater.anchorIndex * STRIDE;
                state[anchoredOffset + X] = floater.anchor[0];
                state[anchoredOffset + Y] = floater.anchor[1];
                state[anchoredOffset + Z] = floater.anchor[2];
                state[anchoredOffset + VX] *= 0.34;
                state[anchoredOffset + VY] *= 0.34;
                state[anchoredOffset + VZ] *= 0.34;
              }
            }
          }

          for (const blob of blobsRef.current) {
            const effectiveDamping = clamp(cfg.damping + blob.dampingOffset, 28, 99);
            const drag = Math.pow(0.88 + effectiveDamping * 0.00108, stepDt);
            const impulse = cfg.response * 0.00145 * (0.78 + blob.depth * 0.34);
            const drift = Math.sin(now * 0.00034 + blob.phase) * 0.0008;
            blob.fallVelocity *= Math.pow(0.985, stepDt);
            blob.fallVelocity += cfg.gravity * 0.00032 * (0.58 + blob.depth) * stepDt;
            blob.vx = (blob.vx + (motion.vx * impulse + drift) * stepDt) * drag;
            blob.vy = (blob.vy + (motion.vy * impulse - drift * 0.6) * stepDt) * drag;
            blob.x += blob.vx * stepDt;
            blob.y += (blob.vy + blob.fallVelocity) * stepDt;
            blob.angle += blob.spin * stepDt * 16.667;
          }
        }

        for (const floater of particlesRef.current) {
          let centerX = 0;
          let centerY = 0;
          for (let i = 0; i < floater.nodeCount; i++) {
            centerX += floater.state[i * STRIDE + X];
            centerY += floater.state[i * STRIDE + Y];
          }
          centerX /= floater.nodeCount;
          centerY /= floater.nodeCount;
          let shiftX = 0;
          let shiftY = 0;
          const margin = 130;
          if (centerX < -margin) shiftX = width + margin * 2;
          else if (centerX > width + margin) shiftX = -(width + margin * 2);
          if (centerY < -margin) shiftY = height + margin * 2;
          else if (centerY > height + margin) shiftY = -(height + margin * 2);
          if (shiftX || shiftY) {
            for (let i = 0; i < floater.nodeCount; i++) {
              floater.state[i * STRIDE + X] += shiftX;
              floater.state[i * STRIDE + Y] += shiftY;
            }
            if (floater.anchorIndex >= 0) {
              floater.anchor[0] += shiftX;
              floater.anchor[1] += shiftY;
            }
          }
          updateProjection(floater);
        }
        for (const blob of blobsRef.current) {
          const margin = blob.sprite.width * 0.55;
          if (blob.x < -margin) blob.x = width + margin;
          else if (blob.x > width + margin) blob.x = -margin;
          if (blob.y < -margin) blob.y = height + margin;
          else if (blob.y > height + margin) blob.y = -margin;
        }
      } else {
        for (const floater of particlesRef.current) updateProjection(floater);
      }

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = clamp(cfg.opacity / 20, 0.08, 1);
      for (const blob of blobsRef.current) {
        const perspective = 0.72 + blob.depth * 0.5;
        const drawSize = blob.sprite.width * perspective;
        ctx.save();
        ctx.translate(blob.x, blob.y);
        ctx.rotate(blob.angle);
        ctx.drawImage(blob.sprite, -drawSize * 0.5, -drawSize * 0.5, drawSize, drawSize);
        ctx.restore();
      }
      ctx.restore();
      for (let i = 0; i < layerCount; i++) {
        layerContexts[i]?.clearRect(0, 0, width, height);
        renderLayerPass(i, cfg);
      }

      if (!paused) animation = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    animation = requestAnimationFrame(frame);
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(animation); };
  }, [paused, seedParticles, seedBlobs]);

  useEffect(() => {
    const desired = settings.count;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const current = particlesRef.current;
    const constrained = (navigator.hardwareConcurrency || 4) <= 4 || window.matchMedia("(pointer: coarse)").matches;
    const cap = nodeCapForCount(desired, constrained);
    if (desired > current.length) {
      current.push(...Array.from({ length: desired - current.length }, () => makeFloater(canvas.clientWidth, canvas.clientHeight, settingsRef.current, cap)));
    } else if (desired < current.length) current.splice(desired);
  }, [settings.count]);

  useEffect(() => {
    const desired = settings.blobCount;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const current = blobsRef.current;
    if (desired > current.length) {
      current.push(...Array.from({ length: desired - current.length }, () => makeBlob(canvas.clientWidth, canvas.clientHeight, settingsRef.current)));
    } else if (desired < current.length) current.splice(desired);
  }, [settings.blobCount]);

  const movePointer = (event: ReactPointerEvent<HTMLElement>) => {
    const pointer = pointerRef.current;
    const now = performance.now();
    const x = event.clientX;
    const y = event.clientY;
    if (pointer.active) {
      const elapsed = Math.max(8, now - pointer.last);
      const gain = 16.67 / elapsed;
      pointer.vx = pointer.vx * 0.38 + (x - pointer.lx) * gain * 0.62;
      pointer.vy = pointer.vy * 0.38 + (y - pointer.ly) * gain * 0.62;
    }
    pointer.x = x; pointer.y = y; pointer.lx = x; pointer.ly = y; pointer.last = now; pointer.active = true;
    if (tipVisible) setTipVisible(false);
  };

  const collapsePanelOutside = (event: ReactPointerEvent<HTMLElement>) => {
    if (!panelOpen) return;
    const target = event.target as Element;
    if (!target.closest(".panel") && !target.closest(".language-toggle")) setPanelOpen(false);
  };

  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setCustomBackground(String(reader.result)); setScene("custom"); };
    reader.readAsDataURL(file);
  };

  const resetSimulation = () => {
    if (shapeTimerRef.current) clearTimeout(shapeTimerRef.current);
    if (blobTimerRef.current) clearTimeout(blobTimerRef.current);
    settingsRef.current = defaults;
    setSettings(defaults);
    pointerRef.current.history.length = 0;
    seedParticles(defaults);
    seedBlobs(defaults);
  };

  const backgroundStyle = customBackground && scene === "custom"
    ? { backgroundImage: `linear-gradient(rgba(255,255,255,.02), rgba(255,255,255,.02)), url(${customBackground})` }
    : undefined;

  return (
    <main className={`experience scene-${scene}`} style={backgroundStyle} onPointerMove={movePointer} onPointerDown={collapsePanelOutside}>
      <div className="scene-content" aria-hidden="true">
        {scene === "paper" && <div className="reading-page"><span>THE QUIET ART OF SEEING</span><h2>Look slowly.</h2><p>When the gaze rests on a bright page, tiny shadows may drift across the field of view—always moving just after the eye.</p><p>Light enters, the page softens, and attention notices what was already there.</p></div>}
        {scene === "room" && <><div className="window-light"/><div className="plant"><i/><i/><i/><b/></div><div className="desk-line"/></>}
        {scene === "sky" && <><div className="sun-glow"/><div className="cloud cloud-one"/><div className="cloud cloud-two"/></>}
      </div>
      <div className="vignette" aria-hidden="true" />
      <canvas ref={canvasRef} className="blob-canvas" aria-label={text.canvasLabel} />
      <div className="filament-layers" aria-hidden="true">
        {Array.from({ length: MAX_LAYER_COUNT }, (_, index) => (
          <canvas
            className="filament-layer"
            key={index}
            ref={(node) => { filamentLayerRefs.current[index] = node; }}
          />
        ))}
      </div>

      <header className="brand"><span className="brand-mark">◉</span><div><strong>{text.brand}</strong><small>{text.brandSubtitle}</small></div></header>

      <button className={`language-toggle ${panelOpen ? "" : "panel-collapsed"}`} type="button" onClick={toggleLanguage} aria-label={text.switchLanguage} title={text.switchLanguage}>{language === "zh" ? "EN" : "中"}</button>

      {tipVisible && <div className="gesture-tip"><span className="cursor-symbol">↗</span><div><strong>{text.gestureTitle}</strong><small>{text.gestureSubtitle}</small></div></div>}

      <aside className={`panel ${panelOpen ? "open" : "closed"}`} onPointerMove={(event) => event.stopPropagation()}>
        <button className="panel-toggle" onClick={() => setPanelOpen((value) => !value)} aria-label={panelOpen ? text.collapsePanel : text.expandPanel}>{panelOpen ? "×" : text.adjust}</button>
        {panelOpen && <>
          <div className="panel-heading"><div><span className="eyebrow">{text.realtime}</span><h1>{text.tuning}</h1></div><span className="status">{text.simulating}</span></div>

          <section className="control-section background-section">
            <div className="section-title"><span>{text.background}</span><em>{text.backgroundHint}</em></div>
            <div className="scene-grid">
              {scenes.map((item) => <button key={item.id} className={scene === item.id ? "active" : ""} onClick={() => setScene(item.id)}><b>{item.icon}</b><span>{text.scenes[item.id]}</span></button>)}
              <label className={scene === "custom" ? "active" : ""}><input type="file" accept="image/*" onChange={chooseImage}/><b>＋</b><span>{text.custom}</span></label>
            </div>
          </section>

          <section className="control-section">
            <div className="section-title"><span>{text.floaters}</span><em>{settings.count} {language === "zh" ? "个" : "floaters"}</em></div>
            <Slider label={text.count} value={settings.count} min={1} max={70} onChange={(v) => setValue("count", v)} />
            <Slider label={text.length} value={settings.length} min={20} max={270} onChange={(v) => setValue("length", v)} />
            <Slider label={text.thickness} value={settings.filamentThickness} min={200} max={500} displayValue={Math.round(((settings.filamentThickness - 200) / 300) * 100)} onChange={(v) => setValue("filamentThickness", v)} />
            <Slider label={text.lengthDistribution} value={settings.lengthDistribution} max={200} onChange={(v) => setShapeValue("lengthDistribution", v)} />
            <Slider label={text.curl} value={settings.curl3d} max={150} onChange={(v) => setShapeValue("curl3d", v)} />
            <Slider label={text.opacity} value={settings.opacity} min={1} max={80} unit="%" onChange={(v) => setValue("opacity", v)} />
            <Slider label={text.blur} value={settings.blur} min={0} max={90} onChange={(v) => setValue("blur", v)} />
          </section>

          <section className="control-section">
            <div className="section-title"><span>{text.blobs}</span><em>{settings.blobCount} {language === "zh" ? "个" : "blobs"} · {text.independentDistribution}</em></div>
            <Slider label={text.blobCount} value={settings.blobCount} min={0} max={24} onChange={(v) => setValue("blobCount", v)} />
            <Slider label={text.blobSizeDistribution} value={settings.blobSizeDistribution} min={0} max={100} onChange={setBlobSizeValue} />
          </section>

          <section className="control-section">
            <div className="section-title"><span>{text.motionPhysics}</span><em>{text.eyeResponse}</em></div>
            <Slider label={text.response} value={settings.response} min={10} max={50} onChange={(v) => setValue("response", v)} />
            <Slider label={text.lag} value={settings.lag} min={0} max={800} unit="ms" onChange={(v) => setValue("lag", v)} />
            <Slider label={text.damping} value={settings.damping} min={35} max={98} onChange={(v) => setValue("damping", v)} />
            <Slider label={text.gravity} value={settings.gravity} min={0} max={70} onChange={(v) => setValue("gravity", v)} />
            <p className="physics-note"><span>i</span>{text.physicsNote}</p>
          </section>

          <div className="panel-actions"><button onClick={resetSimulation}>↺ {text.reset}</button></div>
        </>}
      </aside>

      <footer><span>{text.disclaimer}</span><span className="frame-rate">● {text.adaptiveRendering}</span></footer>
    </main>
  );
}
