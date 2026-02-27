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
- Tube primitive (`tube(outer_r, inner_r, half_h)`)
- BowlWell primitive (`bowl_well_hallbach(scale)`) from `hallbach.lua`
- DeepWell primitive (`deep_well_hallbach(scale)`) from `hallbach.lua`
- Ring-cutout demo primitive (`ring_cutout_demo_hallbach(scale)`) from `hallbach.lua`
- Evaluators:
  - Point eval
  - Interval eval
  - First-order autodiff (value + gradient)
  - GLSL codegen
- Topology transport:
  - `morse.topo.v1` graph format (nodes + root + invariants + topological signature)
  - `expr_to_topology` and `topology_to_expr`
- Topology language (browser editor):
  - Lua-like line assignments + function calls
  - chain methods: `:at(x,y,z)`, `:rotz(a)`
  - shape ops: `sphere`, `cylinder`, `box`, `torus`, `tube`, `union`, `intersect`, `subtract`
  - constraint-first ops:
    - `require_coverslip`, `require_center_hole`, `require_magnet_rings`, `require_ring_height`
    - `synthesize(c1, c2, ...)`
    - bowlwell constraints: `require_upper_bore`, `require_lower_bore_outer_max`, `require_middle_bore`, `require_lower_to_middle`, `require_middle_to_upper`, `require_wall_min`, `synthesize_bowlwell(...)`
    - bowlwell objectives: `objective_maximize_internal_volume(weight)`, `objective_minimize_height(weight)`
    - `void_cylinder`, `apply_voids`, `repeat_polar`
- Morse analysis foundations:
  - Finite-difference Hessian
  - Newton critical point refinement
  - Morse index classification (Jacobi eigenvalue solver)
- WebSocket server with:
  - `topology_scene`, `glsl_topology`, `critical_topology`
  - legacy `eval`, `grad`, `critical`, `glsl` commands
- Three.js viewer with Mittens-style panel workflow:
  - topology-driven rebuild from script editor
  - hallbach-inspired presets (`tube`, `bowlwell`, `deepwell`, `ring-cutouts`)
  - orbit camera
  - browser-side STL meshing/export (marching tetrahedra)

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
