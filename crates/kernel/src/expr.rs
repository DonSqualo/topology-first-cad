use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Expr {
    Const(f64),
    X,
    Y,
    Z,
    Add(Box<Expr>, Box<Expr>),
    Sub(Box<Expr>, Box<Expr>),
    Mul(Box<Expr>, Box<Expr>),
    Div(Box<Expr>, Box<Expr>),
    Neg(Box<Expr>),
    Sin(Box<Expr>),
    Cos(Box<Expr>),
    Exp(Box<Expr>),
    Min(Box<Expr>, Box<Expr>),
    Max(Box<Expr>, Box<Expr>),
    SMin { a: Box<Expr>, b: Box<Expr>, k: f64 },
    SMax { a: Box<Expr>, b: Box<Expr>, k: f64 },
    Translate {
        expr: Box<Expr>,
        dx: f64,
        dy: f64,
        dz: f64,
    },
}

impl Expr {
    pub fn c(v: f64) -> Self {
        Self::Const(v)
    }
    pub fn add(self, rhs: Expr) -> Self {
        Self::Add(Box::new(self), Box::new(rhs))
    }
    pub fn sub(self, rhs: Expr) -> Self {
        Self::Sub(Box::new(self), Box::new(rhs))
    }
    pub fn mul(self, rhs: Expr) -> Self {
        Self::Mul(Box::new(self), Box::new(rhs))
    }
    pub fn div(self, rhs: Expr) -> Self {
        Self::Div(Box::new(self), Box::new(rhs))
    }
    pub fn neg(self) -> Self {
        Self::Neg(Box::new(self))
    }
    pub fn sin(self) -> Self {
        Self::Sin(Box::new(self))
    }
    pub fn cos(self) -> Self {
        Self::Cos(Box::new(self))
    }
    pub fn exp(self) -> Self {
        Self::Exp(Box::new(self))
    }
}

pub fn sphere(r: f64) -> Expr {
    Expr::X
        .mul(Expr::X)
        .add(Expr::Y.mul(Expr::Y))
        .add(Expr::Z.mul(Expr::Z))
        .sub(Expr::c(r * r))
}

pub fn torus(major_r: f64, minor_r: f64) -> Expr {
    let q = Expr::X.mul(Expr::X).add(Expr::Y.mul(Expr::Y)).add(Expr::Z.mul(Expr::Z));
    let t = q.clone().sub(Expr::c(major_r * major_r + minor_r * minor_r));
    t.clone()
        .mul(t)
        .sub(Expr::c(4.0 * major_r * major_r).mul(Expr::X.mul(Expr::X).add(Expr::Y.mul(Expr::Y))))
}

pub fn tube(outer_r: f64, inner_r: f64, half_h: f64) -> Expr {
    // Solid tube volume: inner_r <= sqrt(x^2+y^2) <= outer_r and |z| <= half_h.
    let r2 = Expr::X.mul(Expr::X).add(Expr::Y.mul(Expr::Y));
    let z2 = Expr::Z.mul(Expr::Z);
    let outer = r2.clone().sub(Expr::c(outer_r * outer_r));
    let inner = Expr::c(inner_r * inner_r).sub(r2);
    let caps = z2.sub(Expr::c(half_h * half_h));
    Expr::Max(
        Box::new(Expr::Max(Box::new(outer), Box::new(inner))),
        Box::new(caps),
    )
}
