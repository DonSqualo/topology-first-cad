use crate::expr::Expr;

fn emit_with_coords(expr: &Expr, x: &str, y: &str, z: &str) -> String {
    match expr {
        Expr::Const(c) => format!("{c:.12}"),
        Expr::X => x.to_string(),
        Expr::Y => y.to_string(),
        Expr::Z => z.to_string(),
        Expr::Add(a, b) => format!("({} + {})", emit_with_coords(a, x, y, z), emit_with_coords(b, x, y, z)),
        Expr::Sub(a, b) => format!("({} - {})", emit_with_coords(a, x, y, z), emit_with_coords(b, x, y, z)),
        Expr::Mul(a, b) => format!("({} * {})", emit_with_coords(a, x, y, z), emit_with_coords(b, x, y, z)),
        Expr::Div(a, b) => format!("({} / {})", emit_with_coords(a, x, y, z), emit_with_coords(b, x, y, z)),
        Expr::Neg(a) => format!("(-{})", emit_with_coords(a, x, y, z)),
        Expr::Sin(a) => format!("sin({})", emit_with_coords(a, x, y, z)),
        Expr::Cos(a) => format!("cos({})", emit_with_coords(a, x, y, z)),
        Expr::Exp(a) => format!("exp({})", emit_with_coords(a, x, y, z)),
        Expr::Min(a, b) => format!("min({}, {})", emit_with_coords(a, x, y, z), emit_with_coords(b, x, y, z)),
        Expr::Max(a, b) => format!("max({}, {})", emit_with_coords(a, x, y, z), emit_with_coords(b, x, y, z)),
        Expr::SMin { a, b, k } => {
            let as_ = emit_with_coords(a, x, y, z);
            let bs_ = emit_with_coords(b, x, y, z);
            format!(
                "(mix({bs_}, {as_}, clamp(0.5 + 0.5*(({bs_})-({as_}))/{k:.12}, 0.0, 1.0)) - {k:.12}*clamp(0.5 + 0.5*(({bs_})-({as_}))/{k:.12}, 0.0, 1.0)*(1.0-clamp(0.5 + 0.5*(({bs_})-({as_}))/{k:.12}, 0.0, 1.0)))"
            )
        }
        Expr::SMax { a, b, k } => {
            let as_ = emit_with_coords(a, x, y, z);
            let bs_ = emit_with_coords(b, x, y, z);
            format!(
                "(mix({bs_}, {as_}, clamp(0.5 - 0.5*(({bs_})-({as_}))/{k:.12}, 0.0, 1.0)) + {k:.12}*clamp(0.5 - 0.5*(({bs_})-({as_}))/{k:.12}, 0.0, 1.0)*(1.0-clamp(0.5 - 0.5*(({bs_})-({as_}))/{k:.12}, 0.0, 1.0)))"
            )
        }
        Expr::Translate { expr, dx, dy, dz } => {
            let nx = format!("({x} - {dx:.12})");
            let ny = format!("({y} - {dy:.12})");
            let nz = format!("({z} - {dz:.12})");
            emit_with_coords(expr, &nx, &ny, &nz)
        }
        Expr::RotateZ { expr, deg } => {
            let a = (-deg).to_radians();
            let c = a.cos();
            let s = a.sin();
            let nx = format!("({c:.12}*{x} - {s:.12}*{y})");
            let ny = format!("({s:.12}*{x} + {c:.12}*{y})");
            emit_with_coords(expr, &nx, &ny, z)
        }
    }
}

pub fn to_glsl(expr: &Expr) -> String {
    format!(
        "float sdf(vec3 p) {{\n  return {};\n}}",
        emit_with_coords(expr, "p.x", "p.y", "p.z")
    )
}
