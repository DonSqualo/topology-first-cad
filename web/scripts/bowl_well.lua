lower = bore("lower", 24.5)
middle = bore("middle", 24.5)
upper = bore("upper", 50)

r1 = relate("min_distance", middle, lower, 30)
r2 = relate("distance", upper, middle, 40)
r3 = relate("outer_max", lower, 24.5)

result = synthesize("bore_stack",
  lower, middle, upper,
  r1, r2, r3,
  require("wall_min", 1.5),
  objective("maximize_internal_volume", 1.0),
  objective("minimize_height", 0.35)
)
