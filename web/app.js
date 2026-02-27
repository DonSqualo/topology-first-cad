import * as THREE from "https://unpkg.com/three@0.174.0/build/three.module.js";

const ws = new WebSocket(`ws://${location.host}/ws`);

const out = document.getElementById("out");
const topoMeta = document.getElementById("topoMeta");
const editor = document.getElementById("scriptEditor");
const runBtn = document.getElementById("runScript");
const criticalBtn = document.getElementById("critical");
const exportBtn = document.getElementById("exportStl");
const presetBtns = Array.from(document.querySelectorAll(".presetBtn"));

let topology = null;
let glslCode = "float sdf(vec3 p){return length(p)-0.7;}";
let activePreset = "tube";

const PRESETS = {
  tube: {
    criticalSeed: [0.7, 0.0, 0.0],
    exportMesh: { min: -1.7, max: 1.7, res: 38 },
    camera: { dist: 3.2, pitch: 0.25, yaw: 0.6 },
    script: `-- line assignments + function calls + :at/:rotz chaining
outer_r = 1.1
inner_r = 0.65
half_h = 1.1

result = tube(outer_r, inner_r, half_h)
`,
  },
  bowlwell: {
    criticalSeed: [0.0, 0.0, 1.0],
    exportMesh: { min: -2.8, max: 2.8, res: 44 },
    camera: { dist: 4.8, pitch: 0.38, yaw: 0.55 },
    script: `-- Hallbach-inspired BowlWell, scaled to viewport units
radius = 1.45
wall = 0.08
inner_radius = radius - wall
tube_outer = 0.36
tube_inner = 0.30
tube_h = 1.6
thread_h = 0.28
z_center = 1.05

shell = subtract(sphere(radius):at(0,0,z_center), sphere(inner_radius):at(0,0,z_center))
open = box(4,4,2):at(0,0,z_center + 1.0)
bowl = subtract(shell, open)

tube = subtract(cylinder(tube_outer, tube_h):at(0,0,0.25), cylinder(tube_inner, tube_h + 0.02):at(0,0,0.25))
thread_collar = subtract(cylinder(0.34, thread_h):at(0,0,-0.25), cylinder(0.31, thread_h + 0.02):at(0,0,-0.25))
oring_groove = subtract(cylinder(0.335, 0.07):at(0,0,0.05), cylinder(0.27, 0.08):at(0,0,0.05))

base = union(bowl, tube, thread_collar)
result = subtract(base, oring_groove)
`,
  },
  deepwell: {
    criticalSeed: [0.0, 0.0, 0.8],
    exportMesh: { min: -2.4, max: 2.4, res: 42 },
    camera: { dist: 4.3, pitch: 0.36, yaw: 0.48 },
    script: `-- Hallbach DeepWell style
outer = cylinder(0.95, 1.75):at(0,0,0.0)
bore_main = cylinder(0.52, 1.72):at(0,0,0.02)
bore_bottom = cylinder(0.35, 0.34):at(0,0,-0.62)
top_lip = subtract(cylinder(1.08, 0.12):at(0,0,1.78), cylinder(0.52, 0.14):at(0,0,1.78))

body = subtract(subtract(outer, bore_main), bore_bottom)
result = union(body, top_lip)
`,
  },
  "ring-cutouts": {
    criticalSeed: [1.0, 0.0, 0.0],
    exportMesh: { min: -2.3, max: 2.3, res: 42 },
    camera: { dist: 4.0, pitch: 0.32, yaw: 0.58 },
    script: `-- Constraint-first Halbach ring (no direct geometry authoring)
c1 = require_coverslip(20)
c2 = require_center_hole(25)
c3 = require_magnet_rings(8, 12, 12.8, 0.35)
c4 = require_ring_height(1.15)

base = synthesize(c1, c2, c3, c4)

-- Negative-space constraints: these regions must remain empty
v1 = void_cylinder(0.0, 0.0, 0.0, 0.24, 1.6)
v2 = void_cylinder(0.0, 0.0, 0.8, 0.16, 0.22)

result = apply_voids(base, v1, v2)
`,
  },
};

const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const scene = new THREE.Scene();
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
scene.add(quad);

let mat = null;

const cameraState = {
  yaw: 0.6,
  pitch: 0.25,
  dist: 3.2,
  target: new THREE.Vector3(0, 0, 0),
  drag: false,
  mode: "orbit",
  lx: 0,
  ly: 0,
};

function log(msg) {
  out.textContent = `${msg}\n${out.textContent}`.slice(0, 7000);
}

function send(msg) {
  if (ws.readyState !== WebSocket.OPEN) {
    log("ws not ready; message queued by retrying run after connect");
    return;
  }
  ws.send(JSON.stringify(msg));
}

function isShape(v) {
  return Boolean(v && typeof v === "object" && typeof v.sdf === "function");
}

function isConstraint(v) {
  return Boolean(v && typeof v === "object" && v.__constraint === true);
}

class TopologyBuilder {
  constructor() {
    this.nodes = [];
    this.nextId = 1;
    this.constCache = new Map();
    this._x = this.node("x");
    this._y = this.node("y");
    this._z = this.node("z");
  }

  node(op, inputs = [], params = null) {
    const id = `n${this.nextId++}`;
    const n = { id, op, inputs };
    if (params && Object.keys(params).length > 0) n.params = params;
    this.nodes.push(n);
    return id;
  }

  num(v) {
    const vv = Number(v);
    const key = String(vv);
    if (this.constCache.has(key)) return this.constCache.get(key);
    const id = this.node("const", [], { value: vv });
    this.constCache.set(key, id);
    return id;
  }

  axes() {
    return { x: this._x, y: this._y, z: this._z };
  }

  add(a, b) {
    return this.node("add", [a, b]);
  }

  sub(a, b) {
    return this.node("sub", [a, b]);
  }

  mul(a, b) {
    return this.node("mul", [a, b]);
  }

  div(a, b) {
    return this.node("div", [a, b]);
  }

  neg(a) {
    return this.node("neg", [a]);
  }

  min(a, b) {
    return this.node("min", [a, b]);
  }

  max(a, b) {
    return this.node("max", [a, b]);
  }

  smin(a, b, k) {
    return this.node("smin", [a, b], { k });
  }

  smax(a, b, k) {
    return this.node("smax", [a, b], { k });
  }
}

function makeShape(fn) {
  return { sdf: fn };
}

function coordAt(coord, b, dx, dy, dz) {
  return {
    x: b.sub(coord.x, b.num(dx)),
    y: b.sub(coord.y, b.num(dy)),
    z: b.sub(coord.z, b.num(dz)),
  };
}

function coordRotZ(coord, b, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const cx = b.num(c);
  const sx = b.num(s);
  const nc = b.num(-s);
  return {
    x: b.add(b.mul(cx, coord.x), b.mul(sx, coord.y)),
    y: b.add(b.mul(nc, coord.x), b.mul(cx, coord.y)),
    z: coord.z,
  };
}

function shapeAt(shape, dx, dy, dz) {
  return makeShape((coord, b) => shape.sdf(coordAt(coord, b, dx, dy, dz), b));
}

function shapeRotZ(shape, a) {
  return makeShape((coord, b) => shape.sdf(coordRotZ(coord, b, a), b));
}

function shapeUnionMany(shapes) {
  if (!Array.isArray(shapes) || shapes.length === 0) throw new Error("union requires at least one shape");
  shapes.forEach((s) => ensureShape(s, "union"));
  return shapes.slice(1).reduce((acc, cur) => makeShape((coord, b) => b.min(acc.sdf(coord, b), cur.sdf(coord, b))), shapes[0]);
}

function shapeSub(a, b) {
  ensureShape(a, "subtract");
  ensureShape(b, "subtract");
  return makeShape((coord, builder) => builder.max(a.sdf(coord, builder), builder.neg(b.sdf(coord, builder))));
}

function makeConstraint(kind, data) {
  return { __constraint: true, kind, data };
}

function synthesizeFromConstraints(constraints) {
  const cfg = {
    coverslip_d: 20.0,
    center_hole_d: 25.0,
    magnet_size: 12.8,
    inner_count: 8,
    outer_count: 12,
    min_gap: 0.35,
    ring_half_h: 1.15,
  };

  constraints.forEach((c) => {
    if (!isConstraint(c)) throw new Error("synthesize expects constraint values");
    if (c.kind === "coverslip") cfg.coverslip_d = c.data.diameter;
    if (c.kind === "center_hole") cfg.center_hole_d = c.data.diameter;
    if (c.kind === "magnet_rings") {
      cfg.inner_count = c.data.inner_count;
      cfg.outer_count = c.data.outer_count;
      cfg.magnet_size = c.data.magnet_size;
      cfg.min_gap = c.data.min_gap;
    }
    if (c.kind === "ring_height") cfg.ring_half_h = c.data.half_h;
  });

  return halbachFromConstraints(
    cfg.coverslip_d,
    cfg.center_hole_d,
    cfg.magnet_size,
    cfg.inner_count,
    cfg.outer_count,
    cfg.min_gap,
    cfg.ring_half_h,
  );
}

function polarInstances(shape, count, radius, startA = 0.0, stepA = null) {
  const c = Math.max(1, Math.floor(count));
  const step = stepA == null ? (Math.PI * 2.0) / c : stepA;
  const out = [];
  for (let i = 0; i < c; i += 1) {
    const a = startA + i * step;
    const x = radius * Math.cos(a);
    const y = radius * Math.sin(a);
    out.push(shapeAt(shapeRotZ(shape, a), x, y, 0.0));
  }
  return out;
}

function halbachFromConstraints(coverslipD, centerHoleD, magnetSize, innerCount, outerCount, minGap, ringHalfH) {
  const csR = Math.max(0.01, coverslipD * 0.5);
  const holeR = Math.max(centerHoleD * 0.5, csR + minGap);
  const magDiag = magnetSize * Math.SQRT2;
  const innerOrbitR = holeR + magDiag * 0.5 + minGap;
  const outerOrbitR = innerOrbitR + magDiag + minGap;
  const ringInnerR = holeR + magDiag + minGap * 0.5;
  const ringOuterR = outerOrbitR + magDiag * 0.55 + minGap;
  const slotSize = magnetSize + minGap * 0.5;

  const base = shapeSub(cylinderShape(ringOuterR, ringHalfH), cylinderShape(holeR, ringHalfH + 0.05));

  const innerSlot = boxShape(slotSize, slotSize, ringHalfH * 2.4);
  const outerSlot = boxShape(slotSize, slotSize, ringHalfH * 2.4);

  const innerCuts = polarInstances(innerSlot, innerCount, innerOrbitR, 0.0);
  const outerCuts = polarInstances(outerSlot, outerCount, outerOrbitR, Math.PI / outerCount);
  const cuts = shapeUnionMany([...innerCuts, ...outerCuts]);

  return shapeSub(base, cuts);
}

function cylinderShape(r, halfH) {
  return makeShape((coord, b) => {
    const rr = b.add(b.mul(coord.x, coord.x), b.mul(coord.y, coord.y));
    const radial = b.sub(rr, b.num(r * r));
    const zcap = b.sub(b.mul(coord.z, coord.z), b.num(halfH * halfH));
    return b.max(radial, zcap);
  });
}

function boxShape(sx, sy, sz) {
  const hx = sx * 0.5;
  const hy = sy * 0.5;
  const hz = sz * 0.5;
  return makeShape((coord, b) => {
    const x = b.max(b.sub(coord.x, b.num(hx)), b.sub(b.num(-hx), coord.x));
    const y = b.max(b.sub(coord.y, b.num(hy)), b.sub(b.num(-hy), coord.y));
    const z = b.max(b.sub(coord.z, b.num(hz)), b.sub(b.num(-hz), coord.z));
    return b.max(x, b.max(y, z));
  });
}

function ensureShape(v, context) {
  if (!isShape(v)) throw new Error(`${context} expects a shape value`);
}

function ensureNum(v, context) {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${context} expects a number`);
}

function ensureConstraint(v, context) {
  if (!isConstraint(v)) throw new Error(`${context} expects a constraint`);
}

function foldShape(fn, args, context) {
  if (args.length < 2) throw new Error(`${context} expects at least 2 shape args`);
  args.forEach((a) => ensureShape(a, context));
  return args.slice(1).reduce((acc, cur) => fn(acc, cur), args[0]);
}

function builtins(name, args) {
  if (name === "sphere") {
    if (args.length !== 1) throw new Error("sphere(r) expects 1 arg");
    ensureNum(args[0], "sphere");
    const r2 = args[0] * args[0];
    return makeShape((coord, b) => {
      const xx = b.mul(coord.x, coord.x);
      const yy = b.mul(coord.y, coord.y);
      const zz = b.mul(coord.z, coord.z);
      return b.sub(b.add(b.add(xx, yy), zz), b.num(r2));
    });
  }

  if (name === "cylinder") {
    if (args.length !== 2) throw new Error("cylinder(r, half_h) expects 2 args");
    ensureNum(args[0], "cylinder");
    ensureNum(args[1], "cylinder");
    const r2 = args[0] * args[0];
    const h2 = args[1] * args[1];
    return makeShape((coord, b) => {
      const rr = b.add(b.mul(coord.x, coord.x), b.mul(coord.y, coord.y));
      const radial = b.sub(rr, b.num(r2));
      const zcap = b.sub(b.mul(coord.z, coord.z), b.num(h2));
      return b.max(radial, zcap);
    });
  }

  if (name === "box") {
    if (args.length !== 3) throw new Error("box(sx, sy, sz) expects 3 args");
    ensureNum(args[0], "box");
    ensureNum(args[1], "box");
    ensureNum(args[2], "box");
    const hx = args[0] * 0.5;
    const hy = args[1] * 0.5;
    const hz = args[2] * 0.5;
    return makeShape((coord, b) => {
      const x = b.max(b.sub(coord.x, b.num(hx)), b.sub(b.num(-hx), coord.x));
      const y = b.max(b.sub(coord.y, b.num(hy)), b.sub(b.num(-hy), coord.y));
      const z = b.max(b.sub(coord.z, b.num(hz)), b.sub(b.num(-hz), coord.z));
      return b.max(x, b.max(y, z));
    });
  }

  if (name === "torus") {
    if (args.length !== 2) throw new Error("torus(major_r, minor_r) expects 2 args");
    ensureNum(args[0], "torus");
    ensureNum(args[1], "torus");
    const R = args[0];
    const r = args[1];
    const k = R * R + r * r;
    return makeShape((coord, b) => {
      const q = b.add(b.add(b.mul(coord.x, coord.x), b.mul(coord.y, coord.y)), b.mul(coord.z, coord.z));
      const t = b.sub(q, b.num(k));
      const lhs = b.mul(t, t);
      const rhs = b.mul(
        b.num(4.0 * R * R),
        b.add(b.mul(coord.x, coord.x), b.mul(coord.y, coord.y)),
      );
      return b.sub(lhs, rhs);
    });
  }

  if (name === "halbach_from_constraints") {
    if (args.length !== 7) {
      throw new Error("halbach_from_constraints(coverslip_d, center_hole_d, magnet_size, inner_count, outer_count, min_gap, ring_half_h) expects 7 args");
    }
    args.forEach((a) => ensureNum(a, "halbach_from_constraints"));
    return halbachFromConstraints(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
  }

  if (name === "require_coverslip") {
    if (args.length !== 1) throw new Error("require_coverslip(diameter) expects 1 arg");
    ensureNum(args[0], "require_coverslip");
    return makeConstraint("coverslip", { diameter: Math.max(1e-6, args[0]) });
  }

  if (name === "require_center_hole") {
    if (args.length !== 1) throw new Error("require_center_hole(diameter) expects 1 arg");
    ensureNum(args[0], "require_center_hole");
    return makeConstraint("center_hole", { diameter: Math.max(1e-6, args[0]) });
  }

  if (name === "require_magnet_rings") {
    if (args.length !== 4) throw new Error("require_magnet_rings(inner_count, outer_count, magnet_size, min_gap) expects 4 args");
    args.forEach((a) => ensureNum(a, "require_magnet_rings"));
    return makeConstraint("magnet_rings", {
      inner_count: Math.max(1, Math.floor(args[0])),
      outer_count: Math.max(1, Math.floor(args[1])),
      magnet_size: Math.max(1e-6, args[2]),
      min_gap: Math.max(0.0, args[3]),
    });
  }

  if (name === "require_ring_height") {
    if (args.length !== 1) throw new Error("require_ring_height(half_h) expects 1 arg");
    ensureNum(args[0], "require_ring_height");
    return makeConstraint("ring_height", { half_h: Math.max(1e-6, args[0]) });
  }

  if (name === "synthesize") {
    if (args.length < 1) throw new Error("synthesize(c1, c2, ...) expects at least 1 constraint");
    args.forEach((a) => ensureConstraint(a, "synthesize"));
    return synthesizeFromConstraints(args);
  }

  if (name === "void_cylinder") {
    if (args.length !== 5) throw new Error("void_cylinder(x, y, z, r, half_h) expects 5 args");
    args.forEach((a) => ensureNum(a, "void_cylinder"));
    return shapeAt(cylinderShape(args[3], args[4]), args[0], args[1], args[2]);
  }

  if (name === "apply_voids") {
    if (args.length < 2) throw new Error("apply_voids(base, void1, ...) expects at least 2 args");
    ensureShape(args[0], "apply_voids");
    const base = args[0];
    const voids = args.slice(1);
    voids.forEach((v) => ensureShape(v, "apply_voids"));
    const voidUnion = shapeUnionMany(voids);
    return shapeSub(base, voidUnion);
  }

  if (name === "tube") {
    if (args.length !== 3) throw new Error("tube(outer_r, inner_r, half_h) expects 3 args");
    ensureNum(args[0], "tube");
    ensureNum(args[1], "tube");
    ensureNum(args[2], "tube");
    if (args[1] >= args[0]) throw new Error("tube requires inner_r < outer_r");
    const outer2 = args[0] * args[0];
    const inner2 = args[1] * args[1];
    const h2 = args[2] * args[2];
    return makeShape((coord, b) => {
      const rr = b.add(b.mul(coord.x, coord.x), b.mul(coord.y, coord.y));
      const outerBound = b.sub(rr, b.num(outer2));
      const innerBound = b.sub(b.num(inner2), rr);
      const wall = b.max(outerBound, innerBound);
      const zcap = b.sub(b.mul(coord.z, coord.z), b.num(h2));
      return b.max(wall, zcap);
    });
  }

  if (name === "union") {
    return shapeUnionMany(args);
  }

  if (name === "intersect") {
    return foldShape((a, c) => makeShape((coord, b) => b.max(a.sdf(coord, b), c.sdf(coord, b))), args, "intersect");
  }

  if (name === "subtract") {
    if (args.length !== 2) throw new Error("subtract(a, b) expects 2 shape args");
    return shapeSub(args[0], args[1]);
  }

  if (name === "smooth_union") {
    if (args.length !== 3) throw new Error("smooth_union(a, b, k) expects 3 args");
    ensureShape(args[0], "smooth_union");
    ensureShape(args[1], "smooth_union");
    ensureNum(args[2], "smooth_union");
    return makeShape((coord, b) => b.smin(args[0].sdf(coord, b), args[1].sdf(coord, b), args[2]));
  }

  if (name === "smooth_subtract") {
    if (args.length !== 3) throw new Error("smooth_subtract(a, b, k) expects 3 args");
    ensureShape(args[0], "smooth_subtract");
    ensureShape(args[1], "smooth_subtract");
    ensureNum(args[2], "smooth_subtract");
    return makeShape((coord, b) => b.smax(args[0].sdf(coord, b), b.neg(args[1].sdf(coord, b)), args[2]));
  }

  if (name === "repeat_polar") {
    if (args.length < 3 || args.length > 5) {
      throw new Error("repeat_polar(shape, count, radius[, start_a, step_a]) expects 3-5 args");
    }
    ensureShape(args[0], "repeat_polar");
    ensureNum(args[1], "repeat_polar");
    ensureNum(args[2], "repeat_polar");
    const shape = args[0];
    const count = Math.max(1, Math.floor(args[1]));
    const radius = args[2];
    const startA = args.length >= 4 ? args[3] : 0.0;
    const stepA = args.length >= 5 ? args[4] : (Math.PI * 2.0) / count;

    const parts = [];
    for (let i = 0; i < count; i += 1) {
      const a = startA + i * stepA;
      const x = radius * Math.cos(a);
      const y = radius * Math.sin(a);
      const inst = shapeAt(shapeRotZ(shape, a), x, y, 0.0);
      parts.push(inst);
    }
    return parts.reduce((acc, cur) => makeShape((coord, b) => b.min(acc.sdf(coord, b), cur.sdf(coord, b))));
  }

  throw new Error(`unknown function: ${name}`);
}

function applyMethod(base, method, args) {
  ensureShape(base, `:${method}`);
  if (method === "at") {
    if (args.length !== 3) throw new Error(":at(x, y, z) expects 3 numbers");
    args.forEach((a) => ensureNum(a, ":at"));
    return shapeAt(base, args[0], args[1], args[2]);
  }
  if (method === "rotz") {
    if (args.length !== 1) throw new Error(":rotz(a) expects 1 number");
    ensureNum(args[0], ":rotz");
    return shapeRotZ(base, args[0]);
  }
  throw new Error(`unknown method: :${method}`);
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j += 1;
      const raw = expr.slice(i, j);
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`bad number literal: ${raw}`);
      tokens.push({ type: "num", value: n });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j += 1;
      tokens.push({ type: "id", value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if ("()+-*/,:".includes(c)) {
      tokens.push({ type: c, value: c });
      i += 1;
      continue;
    }
    throw new Error(`unexpected character: ${c}`);
  }
  return tokens;
}

function parseExpr(expr) {
  const t = tokenize(expr);
  let i = 0;

  function peek() {
    return t[i] || null;
  }

  function take(type) {
    const p = peek();
    if (!p || p.type !== type) return null;
    i += 1;
    return p;
  }

  function need(type) {
    const got = take(type);
    if (!got) throw new Error(`expected '${type}'`);
    return got;
  }

  function parsePrimary() {
    const n = peek();
    if (!n) throw new Error("unexpected end of expression");

    let base;
    if (take("(")) {
      base = parseAddSub();
      need(")");
    } else if (n.type === "num") {
      i += 1;
      base = { type: "num", value: n.value };
    } else if (n.type === "id") {
      i += 1;
      const id = n.value;
      if (take("(")) {
        const args = [];
        if (!take(")")) {
          while (true) {
            args.push(parseAddSub());
            if (take(")")) break;
            need(",");
          }
        }
        base = { type: "call", name: id, args };
      } else {
        base = { type: "var", name: id };
      }
    } else {
      throw new Error(`unexpected token '${n.value}'`);
    }

    while (take(":")) {
      const id = need("id").value;
      need("(");
      const args = [];
      if (!take(")")) {
        while (true) {
          args.push(parseAddSub());
          if (take(")")) break;
          need(",");
        }
      }
      base = { type: "method", base, method: id, args };
    }

    return base;
  }

  function parseUnary() {
    if (take("-")) return { type: "neg", value: parseUnary() };
    return parsePrimary();
  }

  function parseMulDiv() {
    let left = parseUnary();
    while (true) {
      if (take("*")) {
        left = { type: "bin", op: "*", left, right: parseUnary() };
        continue;
      }
      if (take("/")) {
        left = { type: "bin", op: "/", left, right: parseUnary() };
        continue;
      }
      return left;
    }
  }

  function parseAddSub() {
    let left = parseMulDiv();
    while (true) {
      if (take("+")) {
        left = { type: "bin", op: "+", left, right: parseMulDiv() };
        continue;
      }
      if (take("-")) {
        left = { type: "bin", op: "-", left, right: parseMulDiv() };
        continue;
      }
      return left;
    }
  }

  const ast = parseAddSub();
  if (i !== t.length) throw new Error(`unexpected token '${t[i].value}'`);
  return ast;
}

function evalAst(ast, env) {
  if (ast.type === "num") return ast.value;
  if (ast.type === "var") {
    if (!(ast.name in env)) throw new Error(`unknown variable: ${ast.name}`);
    return env[ast.name];
  }
  if (ast.type === "neg") {
    const v = evalAst(ast.value, env);
    ensureNum(v, "unary '-' ");
    return -v;
  }
  if (ast.type === "bin") {
    const a = evalAst(ast.left, env);
    const b = evalAst(ast.right, env);
    ensureNum(a, `operator ${ast.op}`);
    ensureNum(b, `operator ${ast.op}`);
    if (ast.op === "+") return a + b;
    if (ast.op === "-") return a - b;
    if (ast.op === "*") return a * b;
    if (ast.op === "/") return a / b;
    throw new Error(`unsupported operator: ${ast.op}`);
  }
  if (ast.type === "call") {
    const args = ast.args.map((a) => evalAst(a, env));
    return builtins(ast.name, args);
  }
  if (ast.type === "method") {
    const base = evalAst(ast.base, env);
    const args = ast.args.map((a) => evalAst(a, env));
    return applyMethod(base, ast.method, args);
  }
  throw new Error(`unsupported AST type: ${ast.type}`);
}

function compileScriptToTopology(src) {
  const env = { pi: Math.PI };
  const builder = new TopologyBuilder();
  let lastShape = null;

  const lines = src.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx += 1) {
    const raw = lines[idx];
    const line = raw.replace(/--.*$/, "").trim();
    if (!line) continue;

    try {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
      if (m) {
        const name = m[1];
        const expr = m[2];
        const ast = parseExpr(expr);
        const v = evalAst(ast, env);
        env[name] = v;
        if (isShape(v)) lastShape = v;
      } else {
        const ast = parseExpr(line);
        const v = evalAst(ast, env);
        if (isShape(v)) lastShape = v;
      }
    } catch (e) {
      throw new Error(`line ${idx + 1}: ${e.message}`);
    }
  }

  const rootShape = isShape(env.result) ? env.result : lastShape;
  if (!rootShape) throw new Error("no shape result found; assign a shape to 'result'");

  const root = rootShape.sdf(builder.axes(), builder);
  return {
    format: "morse.topo.v1",
    invariants: ["field_is_truth", "no_mesh_in_critical_path", "single_expression_graph"],
    signature: { betti_hint: [1, 0, 0], euler_hint: 1, genus_hint: 0 },
    nodes: builder.nodes,
    root,
  };
}

function applyCameraPreset(name) {
  const p = PRESETS[name] || PRESETS.tube;
  cameraState.dist = p.camera.dist;
  cameraState.pitch = p.camera.pitch;
  cameraState.yaw = p.camera.yaw;
  cameraState.target.set(0, 0, 0);
}

function refreshTopologyMeta() {
  if (!topology) {
    topoMeta.textContent = "";
    return;
  }
  topoMeta.textContent = JSON.stringify(
    {
      format: topology.format,
      nodes: topology.nodes.length,
      signature: topology.signature,
      root: topology.root,
    },
    null,
    2,
  );
}

function compileAndSend() {
  try {
    topology = compileScriptToTopology(editor.value);
    refreshTopologyMeta();
    log(`compiled topology nodes=${topology.nodes.length}`);
    send({ cmd: "glsl_topology", topology });
  } catch (e) {
    log(`compile error: ${e.message}`);
  }
}

function loadPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  activePreset = name;
  editor.value = preset.script;
  applyCameraPreset(name);
  compileAndSend();
}

ws.addEventListener("open", () => {
  log("ws connected");
  compileAndSend();
});

ws.addEventListener("message", (evt) => {
  const m = JSON.parse(evt.data);
  if (m.ok === "glsl") {
    glslCode = m.code;
    rebuildMaterial();
    return;
  }
  if (m.ok === "critical") {
    log(`critical: ${JSON.stringify(m)}`);
    return;
  }
  if (m.ok === "error") {
    log(`error: ${m.message}`);
  }
});

runBtn.addEventListener("click", compileAndSend);
criticalBtn.addEventListener("click", () => {
  if (!topology) return;
  const seed = (PRESETS[activePreset] || PRESETS.tube).criticalSeed;
  send({ cmd: "critical_topology", topology, x: seed[0], y: seed[1], z: seed[2] });
});

exportBtn.addEventListener("click", () => {
  if (!topology) return;
  const meshCfg = (PRESETS[activePreset] || PRESETS.tube).exportMesh;
  const stl = meshToAsciiStl(topology, meshCfg.res, meshCfg.min, meshCfg.max);
  const blob = new Blob([stl], { type: "model/stl" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${activePreset}-topology.stl`;
  a.click();
  URL.revokeObjectURL(a.href);
  log("browser meshing complete: STL exported");
});

presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    loadPreset(btn.dataset.preset);
  });
});

function rebuildMaterial() {
  if (mat) mat.dispose();
  mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `
in vec3 position;
void main(){ gl_Position = vec4(position, 1.0); }
`,
    fragmentShader: `
precision highp float;
out vec4 outColor;
uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec3 uCamTarget;
${glslCode}

vec3 calcNormal(vec3 p){
  float e = 0.001;
  return normalize(vec3(
    sdf(p+vec3(e,0,0))-sdf(p-vec3(e,0,0)),
    sdf(p+vec3(0,e,0))-sdf(p-vec3(0,e,0)),
    sdf(p+vec3(0,0,e))-sdf(p-vec3(0,0,e))
  ));
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  uv.x *= uRes.x / uRes.y;

  vec3 ro = uCamPos;
  vec3 target = uCamTarget;
  vec3 fw = normalize(target - ro);
  vec3 rt = normalize(cross(fw, vec3(0.0,1.0,0.0)));
  vec3 up = normalize(cross(rt, fw));
  vec3 rd = normalize(fw + uv.x*rt*0.9 + uv.y*up*0.9);

  float t = 0.0;
  bool hit = false;
  vec3 p;
  for(int i=0;i<140;i++){
    p = ro + rd*t;
    float d = sdf(p);
    if(abs(d) < 0.0009){ hit = true; break; }
    t += clamp(abs(d), 0.004, 0.08);
    if(t > 12.0) break;
  }

  if(!hit){
    vec3 bg = mix(vec3(0.05,0.08,0.12), vec3(0.02,0.02,0.03), uv.y*0.5 + 0.5);
    outColor = vec4(bg,1.0);
    return;
  }

  vec3 n = calcNormal(p);
  vec3 l = normalize(vec3(0.4, 0.7, 0.6));
  float dif = max(dot(n,l),0.0);
  float rim = pow(1.0 - max(dot(n,-rd),0.0), 2.0);
  vec3 col = vec3(0.28,0.84,0.96)*(0.22 + 0.78*dif) + vec3(0.15,0.2,0.3)*rim;
  outColor = vec4(col, 1.0);
}
`,
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) },
      uCamPos: { value: new THREE.Vector3(0, 0, 3.2) },
      uCamTarget: { value: new THREE.Vector3(0, 0, 0) },
    },
  });
  quad.material = mat;
  resize();
}

function cameraPos() {
  const cp = Math.cos(cameraState.pitch);
  const offset = new THREE.Vector3(
    cameraState.dist * cp * Math.sin(cameraState.yaw),
    cameraState.dist * Math.sin(cameraState.pitch),
    cameraState.dist * cp * Math.cos(cameraState.yaw),
  );
  return offset.add(cameraState.target);
}

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  if (mat) mat.uniforms.uRes.value.set(w, h);
}

function render() {
  requestAnimationFrame(render);
  if (!mat) return;
  mat.uniforms.uCamPos.value.copy(cameraPos());
  mat.uniforms.uCamTarget.value.copy(cameraState.target);
  renderer.render(scene, ortho);
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("mousedown", (e) => {
  cameraState.drag = true;
  cameraState.mode = (e.button === 1 || e.button === 2 || e.shiftKey) ? "pan" : "orbit";
  cameraState.lx = e.clientX;
  cameraState.ly = e.clientY;
});
window.addEventListener("mouseup", () => {
  cameraState.drag = false;
});
window.addEventListener("mousemove", (e) => {
  if (!cameraState.drag) return;
  const dx = e.clientX - cameraState.lx;
  const dy = e.clientY - cameraState.ly;
  cameraState.lx = e.clientX;
  cameraState.ly = e.clientY;
  if (cameraState.mode === "pan") {
    const ro = cameraPos();
    const fw = cameraState.target.clone().sub(ro).normalize();
    const rt = new THREE.Vector3().crossVectors(fw, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(rt, fw).normalize();
    const panScale = cameraState.dist * 0.0015;
    cameraState.target.addScaledVector(rt, -dx * panScale);
    cameraState.target.addScaledVector(up, dy * panScale);
  } else {
    cameraState.yaw += dx * 0.007;
    cameraState.pitch = Math.max(-1.35, Math.min(1.35, cameraState.pitch + dy * 0.006));
  }
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  cameraState.dist = Math.max(0.5, Math.min(12.0, cameraState.dist + e.deltaY * 0.003));
});
window.addEventListener("resize", resize);

resize();
render();
loadPreset(activePreset);

function evalTopology(program, x, y, z) {
  const m = new Map();
  for (const n of program.nodes) {
    const ins = n.inputs.map((id) => m.get(id));
    const p = n.params || {};
    let v = 0;
    if (n.op === "const") v = Number(p.value);
    else if (n.op === "x") v = x;
    else if (n.op === "y") v = y;
    else if (n.op === "z") v = z;
    else if (n.op === "add") v = ins[0] + ins[1];
    else if (n.op === "sub") v = ins[0] - ins[1];
    else if (n.op === "mul") v = ins[0] * ins[1];
    else if (n.op === "div") v = ins[0] / ins[1];
    else if (n.op === "neg") v = -ins[0];
    else if (n.op === "sin") v = Math.sin(ins[0]);
    else if (n.op === "cos") v = Math.cos(ins[0]);
    else if (n.op === "exp") v = Math.exp(ins[0]);
    else if (n.op === "min") v = Math.min(ins[0], ins[1]);
    else if (n.op === "max") v = Math.max(ins[0], ins[1]);
    else if (n.op === "smin") {
      const k = Number(p.k ?? 0.1);
      const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (ins[1] - ins[0]) / k));
      v = ins[1] * (1 - h) + ins[0] * h - k * h * (1 - h);
    } else if (n.op === "smax") {
      const k = Number(p.k ?? 0.1);
      const h = Math.max(0, Math.min(1, 0.5 - 0.5 * (ins[1] - ins[0]) / k));
      v = ins[1] * (1 - h) + ins[0] * h + k * h * (1 - h);
    } else {
      throw new Error(`unsupported op in browser mesher: ${n.op}`);
    }
    m.set(n.id, v);
  }
  return m.get(program.root);
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function triNormal(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function meshToAsciiStl(program, res = 34, min = -1.7, max = 1.7) {
  const step = (max - min) / (res - 1);

  const tetra = [
    [0, 5, 1, 6],
    [0, 5, 6, 4],
    [0, 2, 6, 1],
    [0, 2, 3, 6],
    [0, 7, 4, 6],
    [0, 3, 7, 6],
  ];
  const edges = [
    [0, 1],
    [1, 2],
    [2, 0],
    [0, 3],
    [1, 3],
    [2, 3],
  ];

  const tris = [];

  for (let ix = 0; ix < res - 1; ix++) {
    for (let iy = 0; iy < res - 1; iy++) {
      for (let iz = 0; iz < res - 1; iz++) {
        const p = [
          [min + ix * step, min + iy * step, min + iz * step],
          [min + (ix + 1) * step, min + iy * step, min + iz * step],
          [min + ix * step, min + (iy + 1) * step, min + iz * step],
          [min + (ix + 1) * step, min + (iy + 1) * step, min + iz * step],
          [min + ix * step, min + iy * step, min + (iz + 1) * step],
          [min + (ix + 1) * step, min + iy * step, min + (iz + 1) * step],
          [min + ix * step, min + (iy + 1) * step, min + (iz + 1) * step],
          [min + (ix + 1) * step, min + (iy + 1) * step, min + (iz + 1) * step],
        ];

        const f = p.map((v) => evalTopology(program, v[0], v[1], v[2]));

        for (const t of tetra) {
          const tp = [p[t[0]], p[t[1]], p[t[2]], p[t[3]]];
          const tv = [f[t[0]], f[t[1]], f[t[2]], f[t[3]]];
          const hit = [];

          for (const e of edges) {
            const a = e[0];
            const b = e[1];
            const va = tv[a];
            const vb = tv[b];
            if ((va < 0 && vb < 0) || (va >= 0 && vb >= 0)) continue;
            const t01 = va / (va - vb);
            hit.push(lerp3(tp[a], tp[b], t01));
          }

          if (hit.length === 3) tris.push([hit[0], hit[1], hit[2]]);
          if (hit.length === 4) {
            tris.push([hit[0], hit[1], hit[2]]);
            tris.push([hit[0], hit[2], hit[3]]);
          }
        }
      }
    }
  }

  let s = "solid morse_topology\n";
  for (const tri of tris) {
    const n = triNormal(tri[0], tri[1], tri[2]);
    s += `  facet normal ${n[0]} ${n[1]} ${n[2]}\n`;
    s += "    outer loop\n";
    s += `      vertex ${tri[0][0]} ${tri[0][1]} ${tri[0][2]}\n`;
    s += `      vertex ${tri[1][0]} ${tri[1][1]} ${tri[1][2]}\n`;
    s += `      vertex ${tri[2][0]} ${tri[2][1]} ${tri[2][2]}\n`;
    s += "    endloop\n";
    s += "  endfacet\n";
  }
  s += "endsolid morse_topology\n";
  return s;
}
