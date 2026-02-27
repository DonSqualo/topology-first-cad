use crate::expr::Expr;

#[derive(Clone, Copy, Debug)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub fn eval(expr: &Expr, p: Point) -> f64 {
    match expr {
        Expr::Const(c) => *c,
        Expr::X => p.x,
        Expr::Y => p.y,
        Expr::Z => p.z,
        Expr::Add(a, b) => eval(a, p) + eval(b, p),
        Expr::Sub(a, b) => eval(a, p) - eval(b, p),
        Expr::Mul(a, b) => eval(a, p) * eval(b, p),
        Expr::Div(a, b) => eval(a, p) / eval(b, p),
        Expr::Neg(a) => -eval(a, p),
        Expr::Sin(a) => eval(a, p).sin(),
        Expr::Cos(a) => eval(a, p).cos(),
        Expr::Exp(a) => eval(a, p).exp(),
        Expr::Min(a, b) => eval(a, p).min(eval(b, p)),
        Expr::Max(a, b) => eval(a, p).max(eval(b, p)),
        Expr::SMin { a, b, k } => {
            let va = eval(a, p);
            let vb = eval(b, p);
            let h = ((0.5 + 0.5 * (vb - va) / *k).clamp(0.0, 1.0)).to_owned();
            vb * (1.0 - h) + va * h - *k * h * (1.0 - h)
        }
        Expr::SMax { a, b, k } => {
            let va = eval(a, p);
            let vb = eval(b, p);
            let h = ((0.5 - 0.5 * (vb - va) / *k).clamp(0.0, 1.0)).to_owned();
            vb * (1.0 - h) + va * h + *k * h * (1.0 - h)
        }
        Expr::Translate { expr, dx, dy, dz } => eval(
            expr,
            Point {
                x: p.x - dx,
                y: p.y - dy,
                z: p.z - dz,
            },
        ),
    }
}
