use crate::ad::eval_ad;
use crate::eval::{eval, Point};
use crate::expr::{bowl_well_hallbach, deep_well_hallbach, ring_cutout_demo_hallbach, sphere, tube, Expr};
use crate::glsl::to_glsl;
use crate::interval::{eval_interval, Interval};
use crate::morse::refine_critical;
use crate::topology::{expr_to_topology, topology_to_expr};
use crate::topology::{TopologyNode, TopologyProgram, TopologySignature};
use serde_json::json;

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

#[test]
fn bowl_well_has_material_and_void_regions() {
    let b = bowl_well_hallbach(0.02);
    // Tube wall region should be solid.
    assert!(eval(&b, Point { x: 0.23, y: 0.0, z: 0.3 }) < 0.0);
    // Axis bore should be empty.
    assert!(eval(&b, Point { x: 0.0, y: 0.0, z: 0.3 }) > 0.0);
}

#[test]
fn deep_well_has_wall_and_void() {
    let d = deep_well_hallbach(0.03);
    assert!(eval(&d, Point { x: 0.35, y: 0.0, z: 0.2 }) < 0.0);
    assert!(eval(&d, Point { x: 0.0, y: 0.0, z: 0.2 }) > 0.0);
}

#[test]
fn ring_cutout_removes_material() {
    let r = ring_cutout_demo_hallbach(0.03);
    assert!(eval(&r, Point { x: 0.8, y: 0.0, z: 0.45 }) > 0.0);
}

#[test]
fn topology_primitive_ops_compile() {
    let topo = TopologyProgram {
        format: "morse.topo.v1".to_string(),
        root: "n4".to_string(),
        nodes: vec![
            TopologyNode {
                id: "n1".to_string(),
                op: "sphere".to_string(),
                inputs: vec![],
                params: json!({ "r": 1.0 }),
            },
            TopologyNode {
                id: "n2".to_string(),
                op: "cylinder".to_string(),
                inputs: vec![],
                params: json!({ "r": 0.25, "h": 2.0 }),
            },
            TopologyNode {
                id: "n3".to_string(),
                op: "translate".to_string(),
                inputs: vec!["n2".to_string()],
                params: json!({ "dx": 0.75, "dy": 0.0, "dz": 0.0 }),
            },
            TopologyNode {
                id: "n4".to_string(),
                op: "difference".to_string(),
                inputs: vec!["n1".to_string(), "n3".to_string()],
                params: json!({}),
            },
        ],
        invariants: vec!["field_is_truth".to_string()],
        signature: TopologySignature {
            betti_hint: [1, 0, 0],
            euler_hint: 1,
            genus_hint: 0,
        },
    };
    let e = topology_to_expr(&topo).expect("compile topology");
    assert!(eval(&e, Point { x: 0.0, y: 0.0, z: 0.0 }) < 0.0);
    assert!(eval(&e, Point { x: 0.75, y: 0.0, z: 0.2 }) > 0.0);
}
