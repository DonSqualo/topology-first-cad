use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::expr::Expr;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TopologyNode {
    pub id: String,
    pub op: String,
    #[serde(default)]
    pub inputs: Vec<String>,
    #[serde(default)]
    pub params: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TopologySignature {
    pub betti_hint: [u8; 3],
    pub euler_hint: i32,
    pub genus_hint: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TopologyProgram {
    pub format: String,
    pub root: String,
    pub nodes: Vec<TopologyNode>,
    pub invariants: Vec<String>,
    pub signature: TopologySignature,
}

impl Default for TopologyProgram {
    fn default() -> Self {
        Self {
            format: "morse.topo.v1".to_string(),
            root: String::new(),
            nodes: Vec::new(),
            invariants: vec![
                "field_is_truth".to_string(),
                "no_mesh_in_critical_path".to_string(),
                "single_expression_graph".to_string(),
            ],
            signature: TopologySignature {
                betti_hint: [1, 0, 0],
                euler_hint: 1,
                genus_hint: 0,
            },
        }
    }
}

pub fn expr_to_topology(expr: &Expr) -> TopologyProgram {
    fn walk(expr: &Expr, nodes: &mut Vec<TopologyNode>, next_id: &mut u64) -> String {
        let mk = |next_id: &mut u64| {
            let id = format!("n{}", *next_id);
            *next_id += 1;
            id
        };

        match expr {
            Expr::Const(c) => {
                let id = mk(next_id);
                nodes.push(TopologyNode {
                    id: id.clone(),
                    op: "const".to_string(),
                    inputs: vec![],
                    params: json!({ "value": c }),
                });
                id
            }
            Expr::X => {
                let id = mk(next_id);
                nodes.push(TopologyNode {
                    id: id.clone(),
                    op: "x".to_string(),
                    inputs: vec![],
                    params: json!({}),
                });
                id
            }
            Expr::Y => {
                let id = mk(next_id);
                nodes.push(TopologyNode {
                    id: id.clone(),
                    op: "y".to_string(),
                    inputs: vec![],
                    params: json!({}),
                });
                id
            }
            Expr::Z => {
                let id = mk(next_id);
                nodes.push(TopologyNode {
                    id: id.clone(),
                    op: "z".to_string(),
                    inputs: vec![],
                    params: json!({}),
                });
                id
            }
            Expr::Add(a, b)
            | Expr::Sub(a, b)
            | Expr::Mul(a, b)
            | Expr::Div(a, b)
            | Expr::Min(a, b)
            | Expr::Max(a, b) => {
                let ai = walk(a, nodes, next_id);
                let bi = walk(b, nodes, next_id);
                let id = mk(next_id);
                let op = match expr {
                    Expr::Add(_, _) => "add",
                    Expr::Sub(_, _) => "sub",
                    Expr::Mul(_, _) => "mul",
                    Expr::Div(_, _) => "div",
                    Expr::Min(_, _) => "min",
                    Expr::Max(_, _) => "max",
                    _ => unreachable!(),
                };
                nodes.push(TopologyNode {
                    id: id.clone(),
                    op: op.to_string(),
                    inputs: vec![ai, bi],
                    params: json!({}),
                });
                id
            }
            Expr::Neg(a) | Expr::Sin(a) | Expr::Cos(a) | Expr::Exp(a) => {
                let ai = walk(a, nodes, next_id);
                let id = mk(next_id);
                let op = match expr {
                    Expr::Neg(_) => "neg",
                    Expr::Sin(_) => "sin",
                    Expr::Cos(_) => "cos",
                    Expr::Exp(_) => "exp",
                    _ => unreachable!(),
                };
                nodes.push(TopologyNode {
                    id: id.clone(),
                    op: op.to_string(),
                    inputs: vec![ai],
                    params: json!({}),
                });
                id
            }
            Expr::SMin { a, b, k } | Expr::SMax { a, b, k } => {
                let ai = walk(a, nodes, next_id);
                let bi = walk(b, nodes, next_id);
                let id = mk(next_id);
                let op = match expr {
                    Expr::SMin { .. } => "smin",
                    Expr::SMax { .. } => "smax",
                    _ => unreachable!(),
                };
                nodes.push(TopologyNode {
                    id: id.clone(),
                    op: op.to_string(),
                    inputs: vec![ai, bi],
                    params: json!({ "k": k }),
                });
                id
            }
            Expr::Translate { expr, dx, dy, dz } => {
                let ei = walk(expr, nodes, next_id);
                let id = mk(next_id);
                nodes.push(TopologyNode {
                    id: id.clone(),
                    op: "translate".to_string(),
                    inputs: vec![ei],
                    params: json!({ "dx": dx, "dy": dy, "dz": dz }),
                });
                id
            }
        }
    }

    let mut topo = TopologyProgram::default();
    let mut next_id = 0u64;
    topo.root = walk(expr, &mut topo.nodes, &mut next_id);
    topo
}

pub fn topology_to_expr(program: &TopologyProgram) -> Result<Expr, String> {
    let mut built: HashMap<String, Expr> = HashMap::new();

    for node in &program.nodes {
        let get1 = |built: &HashMap<String, Expr>, a: &str| {
            built.get(a).cloned().ok_or_else(|| format!("missing input node: {a}"))
        };
        let get2 = |built: &HashMap<String, Expr>, ins: &[String]| {
            if ins.len() != 2 {
                return Err(format!("op {} expects 2 inputs", node.op));
            }
            Ok((
                built
                    .get(&ins[0])
                    .cloned()
                    .ok_or_else(|| format!("missing input node: {}", ins[0]))?,
                built
                    .get(&ins[1])
                    .cloned()
                    .ok_or_else(|| format!("missing input node: {}", ins[1]))?,
            ))
        };

        let expr = match node.op.as_str() {
            "const" => Expr::Const(
                node.params
                    .get("value")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| "const missing numeric value".to_string())?,
            ),
            "x" => Expr::X,
            "y" => Expr::Y,
            "z" => Expr::Z,
            "add" => {
                let (a, b) = get2(&built, &node.inputs)?;
                Expr::Add(Box::new(a), Box::new(b))
            }
            "sub" => {
                let (a, b) = get2(&built, &node.inputs)?;
                Expr::Sub(Box::new(a), Box::new(b))
            }
            "mul" => {
                let (a, b) = get2(&built, &node.inputs)?;
                Expr::Mul(Box::new(a), Box::new(b))
            }
            "div" => {
                let (a, b) = get2(&built, &node.inputs)?;
                Expr::Div(Box::new(a), Box::new(b))
            }
            "min" => {
                let (a, b) = get2(&built, &node.inputs)?;
                Expr::Min(Box::new(a), Box::new(b))
            }
            "max" => {
                let (a, b) = get2(&built, &node.inputs)?;
                Expr::Max(Box::new(a), Box::new(b))
            }
            "smin" => {
                let (a, b) = get2(&built, &node.inputs)?;
                let k = node
                    .params
                    .get("k")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| "smin missing numeric k".to_string())?;
                Expr::SMin {
                    a: Box::new(a),
                    b: Box::new(b),
                    k,
                }
            }
            "smax" => {
                let (a, b) = get2(&built, &node.inputs)?;
                let k = node
                    .params
                    .get("k")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| "smax missing numeric k".to_string())?;
                Expr::SMax {
                    a: Box::new(a),
                    b: Box::new(b),
                    k,
                }
            }
            "neg" => Expr::Neg(Box::new(get1(&built, &node.inputs[0])?)),
            "sin" => Expr::Sin(Box::new(get1(&built, &node.inputs[0])?)),
            "cos" => Expr::Cos(Box::new(get1(&built, &node.inputs[0])?)),
            "exp" => Expr::Exp(Box::new(get1(&built, &node.inputs[0])?)),
            "translate" => {
                if node.inputs.len() != 1 {
                    return Err("translate expects 1 input".to_string());
                }
                let e = get1(&built, &node.inputs[0])?;
                let dx = node
                    .params
                    .get("dx")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| "translate missing numeric dx".to_string())?;
                let dy = node
                    .params
                    .get("dy")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| "translate missing numeric dy".to_string())?;
                let dz = node
                    .params
                    .get("dz")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| "translate missing numeric dz".to_string())?;
                Expr::Translate {
                    expr: Box::new(e),
                    dx,
                    dy,
                    dz,
                }
            }
            _ => return Err(format!("unsupported topology op: {}", node.op)),
        };

        built.insert(node.id.clone(), expr);
    }

    built
        .remove(&program.root)
        .ok_or_else(|| format!("root node {} not found", program.root))
}
