use crate::expr::Expr;

#[derive(Clone, Copy, Debug)]
pub struct Interval {
    pub lo: f64,
    pub hi: f64,
}

impl Interval {
    pub fn new(lo: f64, hi: f64) -> Self {
        Self { lo, hi }
    }
}

pub fn eval_interval(expr: &Expr, x: Interval, y: Interval, z: Interval) -> Interval {
    match expr {
        Expr::Const(c) => Interval::new(*c, *c),
        Expr::X => x,
        Expr::Y => y,
        Expr::Z => z,
        Expr::Add(a, b) => {
            let a = eval_interval(a, x, y, z);
            let b = eval_interval(b, x, y, z);
            Interval::new(a.lo + b.lo, a.hi + b.hi)
        }
        Expr::Sub(a, b) => {
            let a = eval_interval(a, x, y, z);
            let b = eval_interval(b, x, y, z);
            Interval::new(a.lo - b.hi, a.hi - b.lo)
        }
        Expr::Mul(a, b) => {
            let a = eval_interval(a, x, y, z);
            let b = eval_interval(b, x, y, z);
            let p = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
            Interval::new(
                p.iter().fold(f64::INFINITY, |m, v| m.min(*v)),
                p.iter().fold(f64::NEG_INFINITY, |m, v| m.max(*v)),
            )
        }
        Expr::Div(a, b) => {
            let a = eval_interval(a, x, y, z);
            let b = eval_interval(b, x, y, z);
            if b.lo <= 0.0 && b.hi >= 0.0 {
                Interval::new(f64::NEG_INFINITY, f64::INFINITY)
            } else {
                let p = [a.lo / b.lo, a.lo / b.hi, a.hi / b.lo, a.hi / b.hi];
                Interval::new(
                    p.iter().fold(f64::INFINITY, |m, v| m.min(*v)),
                    p.iter().fold(f64::NEG_INFINITY, |m, v| m.max(*v)),
                )
            }
        }
        Expr::Neg(a) => {
            let a = eval_interval(a, x, y, z);
            Interval::new(-a.hi, -a.lo)
        }
        Expr::Sin(_) | Expr::Cos(_) => Interval::new(-1.0, 1.0),
        Expr::Exp(a) => {
            let a = eval_interval(a, x, y, z);
            Interval::new(a.lo.exp(), a.hi.exp())
        }
        Expr::Min(a, b) | Expr::SMin { a, b, .. } => {
            let a = eval_interval(a, x, y, z);
            let b = eval_interval(b, x, y, z);
            Interval::new(a.lo.min(b.lo), a.hi.min(b.hi))
        }
        Expr::Max(a, b) | Expr::SMax { a, b, .. } => {
            let a = eval_interval(a, x, y, z);
            let b = eval_interval(b, x, y, z);
            Interval::new(a.lo.max(b.lo), a.hi.max(b.hi))
        }
        Expr::Translate { expr, .. } => eval_interval(expr, x, y, z),
    }
}
