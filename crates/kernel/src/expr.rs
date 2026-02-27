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

fn sphere_shifted(r: f64, zc: f64) -> Expr {
    let z = Expr::Z.sub(Expr::c(zc));
    Expr::X
        .mul(Expr::X)
        .add(Expr::Y.mul(Expr::Y))
        .add(z.clone().mul(z))
        .sub(Expr::c(r * r))
}

fn cylinder_z(r: f64) -> Expr {
    Expr::X
        .mul(Expr::X)
        .add(Expr::Y.mul(Expr::Y))
        .sub(Expr::c(r * r))
}

fn z_slab(z0: f64, z1: f64) -> Expr {
    Expr::Max(
        Box::new(Expr::c(z0).sub(Expr::Z)),
        Box::new(Expr::Z.sub(Expr::c(z1))),
    )
}

fn union(a: Expr, b: Expr) -> Expr {
    Expr::Min(Box::new(a), Box::new(b))
}

fn intersect(a: Expr, b: Expr) -> Expr {
    Expr::Max(Box::new(a), Box::new(b))
}

fn subtract(a: Expr, b: Expr) -> Expr {
    Expr::Max(Box::new(a), Box::new(b.neg()))
}

pub fn bowl_well_hallbach(scale: f64) -> Expr {
    // Based on hallbach.lua BowlWell geometry, scaled for viewport stability.
    let s = scale.max(1e-6);

    let radius = 50.0 * s;
    let wall = 1.5 * s;
    let inner_radius = radius - wall;
    let print_clearance = 0.25 * s;
    let ring_center_hole_radius = 12.5 * s;
    let ring_platform_height = 0.5 * s;
    let tube_height = 25.0 * s;
    let tube_overlap = 1.0 * s;
    let thread_height = 6.0 * s;
    let thread_diameter = 22.5 * s;
    let thread_wall = 0.9 * s;
    let tube_outer_radius = ring_center_hole_radius - print_clearance;
    let tube_inner_radius = 10.0 * s;

    let intersection_offset = (radius * radius - tube_outer_radius * tube_outer_radius).sqrt();
    let cap_top = tube_height - ring_platform_height - tube_overlap + thread_height;
    let z_center = cap_top + intersection_offset;

    // Bowl shell and opening.
    let shell = subtract(
        sphere_shifted(radius, z_center),
        sphere_shifted(inner_radius, z_center),
    );
    let open_half = Expr::Z.sub(Expr::c(z_center));
    let bowl = intersect(shell, open_half);
    let bowl_with_hole = subtract(bowl, cylinder_z(tube_outer_radius));

    // Tube and thread collar.
    let tube_z0 = -ring_platform_height + thread_height;
    let tube_z1 = tube_z0 + tube_height;
    let tube_wall = intersect(
        subtract(cylinder_z(tube_outer_radius), cylinder_z(tube_inner_radius)),
        z_slab(tube_z0, tube_z1),
    );

    let thread_outer = (thread_diameter * 0.5) + thread_wall;
    let thread_inner = (thread_diameter * 0.5) - (1.1 * s);
    let thread_collar = intersect(
        subtract(cylinder_z(thread_outer), cylinder_z(thread_inner.max(1e-6))),
        z_slab(-ring_platform_height, -ring_platform_height + thread_height),
    );

    let base = union(union(bowl_with_hole, tube_wall), thread_collar);

    // O-ring groove subtraction.
    let groove_z0 = -ring_platform_height + thread_height;
    let groove_z1 = groove_z0 + (1.5 * s);
    let groove = intersect(
        subtract(cylinder_z(11.2 * s), cylinder_z(8.8 * s)),
        z_slab(groove_z0, groove_z1),
    );

    subtract(base, groove)
}
