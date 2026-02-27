use crate::ad::eval_ad;
use crate::eval::{eval, Point};
use crate::expr::{sphere, Expr};
use crate::glsl::to_glsl;
use crate::interval::{eval_interval, Interval};
use crate::morse::refine_critical;

#[test]
fn sphere_eval_signs() {
    let s = sphere(1.0);
    assert!(eval(&s, Point { x: 0.0, y: 0.0, z: 0.0 }) < 0.0);
    assert!(eval(&s, Point { x: 2.0, y: 0.0, z: 0.0 }) > 0.0);
}

#[test]
fn autodiff_matches_gradient() {
    let e = Expr::X.mul(Expr::X).add(Expr::Y.mul(Expr::Y)).add(Expr::Z.mul(Expr::Z));
    let ad = eval_ad(&e, 2.0, -3.0, 4.0);
    assert!((ad.v - 29.0).abs() < 1e-9);
    assert!((ad.g[0] - 4.0).abs() < 1e-9);
    assert!((ad.g[1] + 6.0).abs() < 1e-9);
    assert!((ad.g[2] - 8.0).abs() < 1e-9);
}

#[test]
fn interval_bounds_point() {
    let e = Expr::X.mul(Expr::X).add(Expr::c(1.0));
    let iv = eval_interval(&e, Interval::new(-2.0, 3.0), Interval::new(0.0, 0.0), Interval::new(0.0, 0.0));
    assert!(iv.lo <= 1.0);
    assert!(iv.hi >= 10.0);
}

#[test]
fn glsl_codegen_contains_sdf() {
    let s = sphere(1.0);
    let g = to_glsl(&s);
    assert!(g.contains("float sdf"));
}

#[test]
fn morse_minimum_for_sphere_field() {
    let s = sphere(2.0);
    let cp = refine_critical(&s, 0.2, -0.1, 0.1).expect("critical point");
    assert!(cp.x.abs() < 1e-6);
    assert!(cp.y.abs() < 1e-6);
    assert!(cp.z.abs() < 1e-6);
    assert_eq!(cp.index, 0);
}
