import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CONSTRAINED_LAYER_COUNT,
  DESKTOP_LAYER_COUNT,
  getFilamentMaterial,
  getFilamentLayerOptics,
  getLoopProbability,
  MAX_LAYER_COUNT,
} from "../app/floater-optics.mjs";

async function render() {
  return readFile(new URL("../out/index.html", import.meta.url), "utf8");
}

test("statically exports the vitreous field simulator", async () => {
  const html = await render();
  assert.match(html, /<title>飞蚊症模拟器<\/title>/);
  assert.match(html, /<meta name="description" content="通过鼠标动作体验飞蚊症视觉模拟。"\/>/);
  assert.match(html, /飞蚊症模拟器/);
  assert.match(html, /离焦模糊/);
  assert.match(html, /条状粗细/);
  assert.match(html, />长度</);
  assert.doesNotMatch(html, />尺寸</);
  assert.match(html, /三维柔性眼内漂浮物动态模拟/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview/);
});

test("defocus radius is zero at blur zero and grows monotonically", () => {
  assert.equal(DESKTOP_LAYER_COUNT, 6);
  assert.equal(CONSTRAINED_LAYER_COUNT, 4);
  assert.equal(MAX_LAYER_COUNT, DESKTOP_LAYER_COUNT);

  for (let layer = 0; layer < DESKTOP_LAYER_COUNT; layer++) {
    assert.equal(getFilamentLayerOptics(layer, DESKTOP_LAYER_COUNT, 0).radius, 0);
  }

  const medium = Array.from({ length: DESKTOP_LAYER_COUNT }, (_, layer) =>
    getFilamentLayerOptics(layer, DESKTOP_LAYER_COUNT, 42).radius,
  );
  const maximum = Array.from({ length: DESKTOP_LAYER_COUNT }, (_, layer) =>
    getFilamentLayerOptics(layer, DESKTOP_LAYER_COUNT, 90).radius,
  );

  for (let layer = 1; layer < DESKTOP_LAYER_COUNT; layer++) {
    assert.ok(medium[layer] >= medium[layer - 1]);
    assert.ok(maximum[layer] >= maximum[layer - 1]);
    assert.ok(maximum[layer] >= medium[layer]);
  }
  assert.equal(medium[0], 0, "the nearest layer must retain a sharp reference");
  assert.ok(medium.at(-1) > 12, "default blur must be visibly defocused at the far layer");
  assert.equal(maximum[0], 0);
  assert.equal(maximum.at(-1), 30);
  assert.equal(getFilamentLayerOptics(CONSTRAINED_LAYER_COUNT - 1, CONSTRAINED_LAYER_COUNT, 90, true).radius, 24);
  assert.ok(maximum.every((_, layer) => getFilamentLayerOptics(layer, DESKTOP_LAYER_COUNT, 90).contrastGain <= 2.6));
});

test("loop probability depends monotonically on length and curl", () => {
  for (let nodes = 1; nodes <= 8; nodes++) assert.equal(getLoopProbability(nodes, 150), 0);
  assert.ok(getLoopProbability(13, 60) > getLoopProbability(9, 60));
  assert.ok(getLoopProbability(18, 60) > getLoopProbability(13, 60));
  assert.ok(getLoopProbability(18, 150) > getLoopProbability(18, 60));
  assert.ok(getLoopProbability(36, 150) <= 0.78);
});

test("filament material keeps cells subordinate to the translucent core", () => {
  const material = getFilamentMaterial(20, 0.5, 2.6);
  assert.ok(material.alpha <= 0.32);
  assert.ok(material.envelope < material.core);
  assert.ok(material.cells < material.core * 0.11);
  assert.ok(getFilamentMaterial(50, 1, 2.6).alpha <= 0.32);
});

test("control defaults and requested ranges stay aligned", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  for (const expectedDefault of [
    /count:\s*10/,
    /length:\s*100/,
    /filamentThickness:\s*300/,
    /lengthDistribution:\s*100/,
    /curl3d:\s*110/,
    /opacity:\s*30/,
    /blur:\s*30/,
    /blobCount:\s*5/,
    /blobSizeDistribution:\s*50/,
    /response:\s*20/,
    /lag:\s*180/,
    /damping:\s*70/,
    /gravity:\s*10/,
  ]) assert.match(page, expectedDefault);

  assert.match(page, /label=\{text\.count\}[^\n]*min=\{1\} max=\{70\}/);
  assert.match(page, /label=\{text\.thickness\}[^\n]*min=\{200\} max=\{500\}[^\n]*displayValue=/);
  assert.match(page, /label=\{text\.opacity\}[^\n]*min=\{1\} max=\{80\}/);
  assert.match(page, /label=\{text\.gravity\}[^\n]*min=\{0\} max=\{70\}/);
  assert.match(page, /aria-valuetext=/);
});

test("language selection supports Chinese, English, automatic detection, and persistence", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /zh:\s*\{[\s\S]*brand:\s*"飞蚊症模拟器"/);
  assert.match(page, /en:\s*\{[\s\S]*brand:\s*"Vitreous Field Lab"/);
  assert.match(page, /navigator\.languages/);
  assert.match(page, /startsWith\("zh"\)/);
  assert.match(page, /localStorage\.getItem\(LANGUAGE_STORAGE_KEY\)/);
  assert.match(page, /localStorage\.setItem\(LANGUAGE_STORAGE_KEY, next\)/);
  assert.match(page, /document\.documentElement\.lang/);
  assert.match(page, /className=\{`language-toggle/);
});

test("the settings panel prioritizes backgrounds, bundles scene photos, collapses from outside, and has reset only", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  const backgroundSection = page.indexOf('className="control-section background-section"');
  const floaterSection = page.indexOf('<span>{text.floaters}</span>');
  assert.ok(backgroundSection > 0 && backgroundSection < floaterSection);
  assert.match(page, /onPointerDown=\{beginPointer\}/);
  assert.match(page, /collapsePanelOutside\(event\)/);
  assert.match(page, /setPointerCapture\(event\.pointerId\)/);
  assert.match(page, /onPointerUp=\{endPointer\}/);
  assert.match(page, /onPointerCancel=\{endPointer\}/);
  assert.match(page, /!target\.closest\("\.panel"\)/);
  assert.match(page, /!target\.closest\("\.language-toggle"\)/);
  assert.match(css, /\.experience\{[^}]*touch-action:none/);
  assert.match(css, /\.panel\{[^}]*touch-action:pan-y/);
  assert.match(page, /<div className="panel-actions"><button onClick=\{resetSimulation\}>/);
  assert.doesNotMatch(page, /setPaused|text\.pause|text\.continue/);
  assert.doesNotMatch(css, /panel-actions \.primary|status\.paused/);
  assert.match(css, /\.scene-sky\{background-image:url\(["']?\/images\/outdoor\.webp["']?\)\}/);
  assert.match(css, /\.scene-paper\{background-image:url\(["']?\/images\/reading\.webp["']?\)\}/);
  assert.match(css, /\.scene-room\{background-image:url\(["']?\/images\/indoor\.webp["']?\)\}/);

  for (const image of ["outdoor.webp", "reading.webp", "indoor.webp"]) {
    const [source, exported] = await Promise.all([
      readFile(new URL(`../public/images/${image}`, import.meta.url)),
      readFile(new URL(`../out/images/${image}`, import.meta.url)),
    ]);

    assert.equal(source.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(source.subarray(8, 12).toString("ascii"), "WEBP");
    assert.deepEqual(exported, source, `${image} must be copied unchanged into the static export`);
  }
});

test("filaments use compositor blur without the legacy sharp overlay", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /className="filament-layer"/);
  assert.match(page, /getFilamentLayerOptics/);
  assert.match(page, /getFilamentMaterial/);
  assert.match(page, /tube \* 2\.15/);
  assert.match(page, /tube \* 1\.25/);
  assert.match(page, /tube \* 0\.72/);
  assert.match(page, /const thicknessMix = clamp\(\(cfg\.filamentThickness - 200\) \/ 300, 0, 1\)/);
  assert.match(page, /const cellCenterReveal = 0\.22 \+ thicknessMix \* 0\.3/);
  assert.match(page, /globalCompositeOperation = "destination-out"/);
  assert.match(page, /tube \* 0\.08/);
  assert.match(page, /filamentThickness:\s*300/);
  assert.match(page, /cfg\.filamentThickness \/ 100/);
  assert.match(page, /label=\{text\.thickness\}[^\n]*min=\{200\} max=\{500\}[^\n]*displayValue=/);
  assert.match(page, /setValue\("filamentThickness", v\)/);
  assert.match(page, /filamentLengthScale\(cfg\.length\)/);
  assert.match(page, /BASE_STROKE_SCALE/);
  assert.doesNotMatch(page, /strokeScale|settings\.size|cfg\.size|label="尺寸"/);
  assert.doesNotMatch(page, /DEFOCUS_PROFILES|paintStrokeProfile|paintDotProfile/);
  assert.match(css, /\.filament-layer\{[^}]*mix-blend-mode:multiply[^}]*will-change:filter/);
});

test("anchored filaments preserve their local resting curve", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /anchorRest:\s*Float32Array\s*\|\s*null/);
  assert.match(page, /loopPairs:\s*Uint16Array/);
  assert.match(page, /floater\.loopRest\.length/);
  assert.match(page, /shouldIncludeReferenceLoop/);
  assert.match(page, /const restoreStrength = 0\.055 - distanceFromAnchor \* 0\.025/);
  assert.match(page, /state\[anchoredOffset \+ X\] = floater\.anchor\[0\]/);
  assert.doesNotMatch(page, /const mobility = anchored \? 0\.08 : 1/);
});
