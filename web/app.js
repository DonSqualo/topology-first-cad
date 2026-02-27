import * as THREE from "https://unpkg.com/three@0.174.0/build/three.module.js";

const ws = new WebSocket(`ws://${location.host}/ws`);
const out = document.getElementById("out");
const button = document.getElementById("critical");

let sceneExpr = null;
let glslBody = "return length(p)-0.75;";

function send(obj) {
  ws.send(JSON.stringify(obj));
}

ws.addEventListener("open", () => {
  send({ cmd: "default_scene" });
});

ws.addEventListener("message", (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.ok === "default_scene") {
    sceneExpr = msg.expr;
    send({ cmd: "glsl", expr: sceneExpr });
  } else if (msg.ok === "glsl") {
    glslBody = msg.code;
    buildRenderer();
  } else if (msg.ok === "critical") {
    out.textContent = JSON.stringify(msg, null, 2);
  } else if (msg.ok === "error") {
    out.textContent = msg.message;
  }
});

button.addEventListener("click", () => {
  if (!sceneExpr) return;
  send({ cmd: "critical", expr: sceneExpr, x: 0.1, y: 0.2, z: -0.1 });
});

const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
const scene = new THREE.Scene();
scene.add(quad);

function buildMaterial() {
  const frag = `
precision highp float;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
${glslBody}

vec3 estimateNormal(vec3 p){
  float e = 0.001;
  float x = sdf(p + vec3(e,0,0)) - sdf(p - vec3(e,0,0));
  float y = sdf(p + vec3(0,e,0)) - sdf(p - vec3(0,e,0));
  float z = sdf(p + vec3(0,0,e)) - sdf(p - vec3(0,0,e));
  return normalize(vec3(x,y,z));
}

void main(){
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  uv.x *= uRes.x / uRes.y;

  vec3 ro = vec3(0.0, 0.0, 3.0);
  vec3 rd = normalize(vec3(uv, -1.8));

  float t = 0.0;
  bool hit = false;
  vec3 p;
  for (int i=0; i<128; i++) {
    p = ro + rd * t;
    float d = sdf(p);
    if (abs(d) < 0.001) { hit = true; break; }
    t += clamp(abs(d), 0.005, 0.1);
    if (t > 8.0) break;
  }

  if (!hit) {
    outColor = vec4(0.02, 0.03, 0.05, 1.0);
    return;
  }

  vec3 n = estimateNormal(p);
  vec3 l = normalize(vec3(0.5, 0.8, 0.7));
  float diff = max(dot(n, l), 0.0);
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
  vec3 col = vec3(0.2, 0.8, 0.9) * (0.2 + 0.8 * diff) + vec3(0.3,0.35,0.5)*rim;
  outColor = vec4(col, 1.0);
}
`;

  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `
in vec3 position;
void main() { gl_Position = vec4(position, 1.0); }
`,
    fragmentShader: frag,
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
    },
  });
}

let material = null;

function buildRenderer() {
  if (material) material.dispose();
  material = buildMaterial();
  quad.material = material;
  resize();
  render(0);
}

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  if (material) {
    material.uniforms.uRes.value.set(w, h);
  }
}

window.addEventListener("resize", resize);

function render(t) {
  if (!material) return;
  material.uniforms.uTime.value = t * 0.001;
  renderer.render(scene, ortho);
  requestAnimationFrame(render);
}
