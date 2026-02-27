import * as THREE from "https://unpkg.com/three@0.174.0/build/three.module.js";

const ws = new WebSocket(`ws://${location.host}/ws`);

const out = document.getElementById("out");
const topoMeta = document.getElementById("topoMeta");
const sceneSel = document.getElementById("scene");
const scale = document.getElementById("scale");
const outerR = document.getElementById("outerR");
const innerR = document.getElementById("innerR");
const halfH = document.getElementById("halfH");
const rebuildBtn = document.getElementById("rebuild");
const criticalBtn = document.getElementById("critical");
const exportBtn = document.getElementById("exportStl");

let topology = null;
let glslCode = `float sdf(vec3 p){return length(p)-0.7;}`;
let currentScene = "tube";

const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const scene = new THREE.Scene();
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
scene.add(quad);

let mat = null;

const cameraState = { yaw: 0.6, pitch: 0.25, dist: 3.2, drag: false, lx: 0, ly: 0 };

function log(msg) {
  out.textContent = `${msg}\n${out.textContent}`.slice(0, 6000);
}

function send(msg) {
  ws.send(JSON.stringify(msg));
}

function currentParams() {
  let o = Number(outerR.value);
  let i = Number(innerR.value);
  const h = Number(halfH.value);
  if (i >= o - 0.01) {
    i = o - 0.01;
    innerR.value = String(i);
  }
  return { outer_r: o, inner_r: i, half_h: h, scale: Number(scale.value) };
}

function requestTopology() {
  const p = currentParams();
  currentScene = sceneSel.value;
  send({ cmd: "topology_scene", scene: currentScene, ...p });
}

ws.addEventListener("open", () => {
  log("ws connected");
  requestTopology();
});

ws.addEventListener("message", (evt) => {
  const m = JSON.parse(evt.data);
  if (m.ok === "topology") {
    topology = m.topology;
    topoMeta.textContent = JSON.stringify(
      {
        format: topology.format,
        nodes: topology.nodes.length,
        signature: topology.signature,
      },
      null,
      2,
    );
    send({ cmd: "glsl_topology", topology });
    if (currentScene === "bowlwell") {
      cameraState.dist = 4.8;
      cameraState.pitch = 0.38;
      cameraState.yaw = 0.55;
    } else {
      cameraState.dist = 3.2;
      cameraState.pitch = 0.25;
      cameraState.yaw = 0.6;
    }
    return;
  }
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

rebuildBtn.addEventListener("click", requestTopology);
sceneSel.addEventListener("change", requestTopology);
criticalBtn.addEventListener("click", () => {
  if (!topology) return;
  if (currentScene === "bowlwell") {
    send({ cmd: "critical_topology", topology, x: 0.0, y: 0.0, z: 1.0 });
  } else {
    send({ cmd: "critical_topology", topology, x: 0.7, y: 0.0, z: 0.0 });
  }
});
exportBtn.addEventListener("click", () => {
  if (!topology) return;
  const bounds = currentScene === "bowlwell" ? [-2.8, 2.8] : [-1.7, 1.7];
  const res = currentScene === "bowlwell" ? 44 : 38;
  const stl = meshToAsciiStl(topology, res, bounds[0], bounds[1]);
  const blob = new Blob([stl], { type: "model/stl" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${currentScene}-topology.stl`;
  a.click();
  URL.revokeObjectURL(a.href);
  log("browser meshing complete: STL exported");
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
  vec3 target = vec3(0.0);
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
    },
  });
  quad.material = mat;
  resize();
}

function cameraPos() {
  const cp = Math.cos(cameraState.pitch);
  return new THREE.Vector3(
    cameraState.dist * cp * Math.sin(cameraState.yaw),
    cameraState.dist * Math.sin(cameraState.pitch),
    cameraState.dist * cp * Math.cos(cameraState.yaw),
  );
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
  renderer.render(scene, ortho);
}

canvas.addEventListener("mousedown", (e) => {
  cameraState.drag = true;
  cameraState.lx = e.clientX;
  cameraState.ly = e.clientY;
});
window.addEventListener("mouseup", () => (cameraState.drag = false));
window.addEventListener("mousemove", (e) => {
  if (!cameraState.drag) return;
  const dx = e.clientX - cameraState.lx;
  const dy = e.clientY - cameraState.ly;
  cameraState.lx = e.clientX;
  cameraState.ly = e.clientY;
  cameraState.yaw += dx * 0.007;
  cameraState.pitch = Math.max(-1.35, Math.min(1.35, cameraState.pitch + dy * 0.006));
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  cameraState.dist = Math.max(1.2, Math.min(8.0, cameraState.dist + e.deltaY * 0.003));
});
window.addEventListener("resize", resize);

resize();
render();

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
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
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
            const a = e[0], b = e[1];
            const va = tv[a], vb = tv[b];
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
