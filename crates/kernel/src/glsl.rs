use crate::expr::Expr;

fn emit(expr: &Expr) -> String {
    match expr {
        Expr::Const(c) => format!("{c:.12}"),
        Expr::X => "p.x".to_string(),
        Expr::Y => "p.y".to_string(),
        Expr::Z => "p.z".to_string(),
        Expr::Add(a, b) => format!("({} + {})", emit(a), emit(b)),
        Expr::Sub(a, b) => format!("({} - {})", emit(a), emit(b)),
        Expr::Mul(a, b) => format!("({} * {})", emit(a), emit(b)),
        Expr::Div(a, b) => format!("({} / {})", emit(a), emit(b)),
        Expr::Neg(a) => format!("(-{})", emit(a)),
        Expr::Sin(a) => format!("sin({})", emit(a)),
        Expr::Cos(a) => format!("cos({})", emit(a)),
        Expr::Exp(a) => format!("exp({})", emit(a)),
        Expr::Min(a, b) => format!("min({}, {})", emit(a), emit(b)),
        Expr::Max(a, b) => format!("max({}, {})", emit(a), emit(b)),
        Expr::SMin { a, b, k } => format!(
            "(mix({b}, {a}, clamp(0.5 + 0.5*(({b})-({a}))/{k:.12}, 0.0, 1.0)) - {k:.12}*clamp(0.5 + 0.5*(({b})-({a}))/{k:.12}, 0.0, 1.0)*(1.0-clamp(0.5 + 0.5*(({b})-({a}))/{k:.12}, 0.0, 1.0)))",
            a = emit(a),
            b = emit(b)
        ),
        Expr::SMax { a, b, k } => format!(
            "(mix({b}, {a}, clamp(0.5 - 0.5*(({b})-({a}))/{k:.12}, 0.0, 1.0)) + {k:.12}*clamp(0.5 - 0.5*(({b})-({a}))/{k:.12}, 0.0, 1.0)*(1.0-clamp(0.5 - 0.5*(({b})-({a}))/{k:.12}, 0.0, 1.0)))",
            a = emit(a),
            b = emit(b)
        ),
        Expr::Translate { expr, dx, dy, dz } => {
            format!("({})", emit_sub(expr, *dx, *dy, *dz))
        }
    }
}

fn emit_sub(expr: &Expr, dx: f64, dy: f64, dz: f64) -> String {
    match expr {
        Expr::X => format!("(p.x - {dx:.12})"),
        Expr::Y => format!("(p.y - {dy:.12})"),
        Expr::Z => format!("(p.z - {dz:.12})"),
        _ => emit(expr),
    }
}

pub fn to_glsl(expr: &Expr) -> String {
    format!(
        "float sdf(vec3 p) {{\n  float h = 0.0;\n  return {};\n}}",
        emit(expr)
    )
}
