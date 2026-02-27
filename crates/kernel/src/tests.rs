use crate::ad::eval_ad;
use crate::eval::{eval, Point};
use crate::expr::{sphere, tube, Expr};
use crate::glsl::to_glsl;
use crate::interval::{eval_interval, Interval};
use crate::morse::refine_critical;
use crate::topology::{expr_to_topology, topology_to_expr};

#[test]
fn sphere_eval_signs() {
    let s = sphere(1.0);
    assert!(eval(&s, Point { x: 0.0, y: 0.0, z: 0.0 }) < 0.0);
    assert!(eval(&s, Point { x: 2.0, y: 0.0, z: 0.0 }) > 0.0);
}

#[test]
fn tube_eval_signs() {
    let t = tube(1.0, 0.5, 1.2);
    assert!(eval(&t, Point { x: 0.75, y: 0.0, z: 0.0 }) < 0.0);
    assert!(eval(&t, Point { x: 0.25, y: 0.0, z: 0.0 }) > 0.0);
    assert!(eval(&t, Point { x: 1.2, y: 0.0, z: 0.0 }) > 0.0);
    assert!(eval(&t, Point { x: 0.75, y: 0.0, z: 1.3 }) > 0.0);
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
    let iv = eval_interval(
        &e,
        Interval::new(-2.0, 3.0),
        Interval::new(0.0, 0.0),
        Interval::new(0.0, 0.0),
    );
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

#[test]
fn topology_roundtrip_matches_eval() {
    let e = tube(1.0, 0.5, 1.0).add(sphere(0.2));
    let topo = expr_to_topology(&e);
    let e2 = topology_to_expr(&topo).expect("topology to expr");
    let p = Point {
        x: 0.71,
        y: -0.22,
        z: 0.31,
    };
    let v1 = eval(&e, p);
    let v2 = eval(&e2, p);
    assert!((v1 - v2).abs() < 1e-10);
}
