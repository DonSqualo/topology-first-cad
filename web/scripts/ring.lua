base = synthesize("ring",
  require("coverslip", 20),
  require("center_hole", 25),
  require("inner_count", 8),
  require("outer_count", 12),
  require("magnet_size", 12.8),
  require("min_gap", 0.35),
  require("ring_height", 1.15)
)

v1 = void_cylinder(0.0, 0.0, 0.0, 0.24, 1.6)
v2 = void_cylinder(0.0, 0.0, 0.8, 0.16, 0.22)

result = apply_voids(base, v1, v2)
