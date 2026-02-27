use crate::expr::Expr;

#[derive(Clone, Copy, Debug)]
pub struct AD1 {
    pub v: f64,
    pub g: [f64; 3],
}

impl AD1 {
    fn c(v: f64) -> Self {
        Self { v, g: [0.0; 3] }
    }

    fn add(self, rhs: Self) -> Self {
        Self {
            v: self.v + rhs.v,
            g: [self.g[0] + rhs.g[0], self.g[1] + rhs.g[1], self.g[2] + rhs.g[2]],
        }
    }

    fn sub(self, rhs: Self) -> Self {
        Self {
            v: self.v - rhs.v,
            g: [self.g[0] - rhs.g[0], self.g[1] - rhs.g[1], self.g[2] - rhs.g[2]],
        }
    }

    fn mul(self, rhs: Self) -> Self {
        Self {
            v: self.v * rhs.v,
            g: [
                self.g[0] * rhs.v + rhs.g[0] * self.v,
                self.g[1] * rhs.v + rhs.g[1] * self.v,
                self.g[2] * rhs.v + rhs.g[2] * self.v,
            ],
        }
    }

    fn div(self, rhs: Self) -> Self {
        let inv = 1.0 / rhs.v;
        let inv2 = inv * inv;
        Self {
            v: self.v * inv,
            g: [
                (self.g[0] * rhs.v - self.v * rhs.g[0]) * inv2,
                (self.g[1] * rhs.v - self.v * rhs.g[1]) * inv2,
                (self.g[2] * rhs.v - self.v * rhs.g[2]) * inv2,
            ],
        }
    }
}

pub fn eval_ad(expr: &Expr, x: f64, y: f64, z: f64) -> AD1 {
    match expr {
        Expr::Const(c) => AD1::c(*c),
        Expr::X => AD1 { v: x, g: [1.0, 0.0, 0.0] },
        Expr::Y => AD1 { v: y, g: [0.0, 1.0, 0.0] },
        Expr::Z => AD1 { v: z, g: [0.0, 0.0, 1.0] },
        Expr::Add(a, b) => eval_ad(a, x, y, z).add(eval_ad(b, x, y, z)),
        Expr::Sub(a, b) => eval_ad(a, x, y, z).sub(eval_ad(b, x, y, z)),
        Expr::Mul(a, b) => eval_ad(a, x, y, z).mul(eval_ad(b, x, y, z)),
        Expr::Div(a, b) => eval_ad(a, x, y, z).div(eval_ad(b, x, y, z)),
        Expr::Neg(a) => {
            let p = eval_ad(a, x, y, z);
            AD1 {
                v: -p.v,
                g: [-p.g[0], -p.g[1], -p.g[2]],
            }
        }
        Expr::Sin(a) => {
            let p = eval_ad(a, x, y, z);
            let c = p.v.cos();
            AD1 {
                v: p.v.sin(),
                g: [p.g[0] * c, p.g[1] * c, p.g[2] * c],
            }
        }
        Expr::Cos(a) => {
            let p = eval_ad(a, x, y, z);
            let s = -p.v.sin();
            AD1 {
                v: p.v.cos(),
                g: [p.g[0] * s, p.g[1] * s, p.g[2] * s],
            }
        }
        Expr::Exp(a) => {
            let p = eval_ad(a, x, y, z);
            let e = p.v.exp();
            AD1 {
                v: e,
                g: [p.g[0] * e, p.g[1] * e, p.g[2] * e],
            }
        }
        Expr::Min(a, b) => {
            let va = eval_ad(a, x, y, z);
            let vb = eval_ad(b, x, y, z);
            if va.v < vb.v { va } else { vb }
        }
        Expr::Max(a, b) => {
            let va = eval_ad(a, x, y, z);
            let vb = eval_ad(b, x, y, z);
            if va.v > vb.v { va } else { vb }
        }
        Expr::SMin { a, b, k } => {
            let va = eval_ad(a, x, y, z);
            let vb = eval_ad(b, x, y, z);
            let h = (0.5 + 0.5 * (vb.v - va.v) / *k).clamp(0.0, 1.0);
            let v = vb.v * (1.0 - h) + va.v * h - *k * h * (1.0 - h);
            AD1 {
                v,
                g: [
                    vb.g[0] * (1.0 - h) + va.g[0] * h,
                    vb.g[1] * (1.0 - h) + va.g[1] * h,
                    vb.g[2] * (1.0 - h) + va.g[2] * h,
                ],
            }
        }
        Expr::SMax { a, b, k } => {
            let va = eval_ad(a, x, y, z);
            let vb = eval_ad(b, x, y, z);
            let h = (0.5 - 0.5 * (vb.v - va.v) / *k).clamp(0.0, 1.0);
            let v = vb.v * (1.0 - h) + va.v * h + *k * h * (1.0 - h);
            AD1 {
                v,
                g: [
                    vb.g[0] * (1.0 - h) + va.g[0] * h,
                    vb.g[1] * (1.0 - h) + va.g[1] * h,
                    vb.g[2] * (1.0 - h) + va.g[2] * h,
                ],
            }
        }
        Expr::Translate { expr, dx, dy, dz } => eval_ad(expr, x - dx, y - dy, z - dz),
    }
}
