outer = cylinder(0.95, 1.75):at(0,0,0.0)
bore_main = cylinder(0.52, 1.72):at(0,0,0.02)
bore_bottom = cylinder(0.35, 0.34):at(0,0,-0.62)
top_lip = subtract(cylinder(1.08, 0.12):at(0,0,1.78), cylinder(0.52, 0.14):at(0,0,1.78))

body = subtract(subtract(outer, bore_main), bore_bottom)
result = union(body, top_lip)
