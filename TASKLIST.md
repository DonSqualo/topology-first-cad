# Topology-First CAD Tasklist

## Immediate (active)
- [x] Generic constraint DSL (`require`, `objective`, `synthesize(model, ...)`)
- [x] Feature-relationship syntax (`bore`, `relate`, `synthesize("bore_stack", ...)`)
- [x] BowlWell default script in mm
- [x] URL script loading from file (`/?script=<name>`, `web/scripts/<name>.lua`)
- [x] Camera pan/orbit/zoom and large-scene visibility fixes
- [ ] Add onscreen solved-constraint panel (not only log)

## Short term
- [ ] Relationship graph solver (not just axial stack):
  - [ ] `through`, `connects_to`, `disjoint`, `contains`
  - [ ] multi-branch topology (tees/manifolds)
- [ ] Hard/soft constraint engine:
  - [ ] hard feasibility pass
  - [ ] weighted objective optimizer
- [ ] Constraint diagnostics:
  - [ ] under/over-constrained detection
  - [ ] conflict explanations with source line refs

## Mid term
- [ ] Persistent topological naming for synthesized features
- [ ] Constraint history graph and diffs between revisions
- [ ] Reeb/Morse decomposition over synthesized models
- [ ] Manufacturing constraints in DSL:
  - [ ] min wall
  - [ ] min tool radius
  - [ ] pull direction / no undercut regions

## Long term
- [ ] Pure constraint project format (no geometry script fallback)
- [ ] Full declarative topology editor with autocomplete and linting
- [ ] Direct-to-toolpath from field slices (meshless path)
