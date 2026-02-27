# Topology-First CAD Kernel (Rust + WebSocket + Three.js)

Topology-first implicit CAD kernel from scratch.

## Core Rule
`f(x,y,z)` is the source of truth. Topology, geometry, analysis, and rendering derive from field evaluation.

## Stack
- Kernel: Rust (`crates/kernel`)
- Runtime API: Rust WebSocket/HTTP (`crates/server`)
- Viz: Three.js browser client (`web/`)

## Implemented in this bootstrap
- Expression tree (`Expr`) with arithmetic, trig, booleans, smooth booleans, transforms
- Evaluators:
  - Point eval
  - Interval eval
  - First-order autodiff (value + gradient)
  - GLSL codegen
- Morse analysis foundations:
  - Finite-difference Hessian
  - Newton critical point refinement
  - Morse index classification (Jacobi eigenvalue solver)
- WebSocket server with:
  - `eval`, `grad`, `critical`, `glsl` commands
- Three.js viewer with basic raymarch shader compiled from generated GLSL snippet

## Run
```bash
cargo run -p morse-server
# open http://127.0.0.1:8787
# or: PORT=8790 cargo run -p morse-server
# or: HOST=0.0.0.0 PORT=8790 cargo run -p morse-server
```

## systemd + nginx + Tailscale
Simple CLI: `ops/morsectl`
Service default port for systemd/nginx is `8790` (to avoid common local conflicts on `8787`).
systemd units set `HOST=0.0.0.0` so the app is reachable on your Tailscale `100.x` IP.

User service (no sudo):
```bash
./ops/morsectl user-install
./ops/morsectl user-start
./ops/morsectl user-status
```

System service + nginx reverse proxy (sudo):
```bash
./ops/morsectl install-system
./ops/morsectl system-start
./ops/morsectl install-nginx
```

Tailscale check/open:
```bash
./ops/morsectl tailscale-status
./ops/morsectl tailscale-open
./ops/morsectl tailscale-serve
```

## Status vs target roadmap
This is a clean-room reimplementation start, not yet full parity with the prior JS system. Next milestones:
1. Expand primitive/operation set.
2. Add exact arithmetic evaluator.
3. Add interval pruning + robust critical point tracker.
4. Add Reeb graph + Euler/Betti/genus pipelines.
5. Add manufacturing analysis + export toolchains.
