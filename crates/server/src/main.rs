use std::net::SocketAddr;

use axum::{
    extract::ws::{Message, WebSocket},
    extract::WebSocketUpgrade,
    response::{Html, IntoResponse},
    routing::get,
    Router,
};
use futures::StreamExt;
use morse_kernel::{
    ad::eval_ad,
    eval::{eval, Point},
    expr::{sphere, tube, Expr},
    glsl::to_glsl,
    morse::refine_critical,
    topology::{expr_to_topology, topology_to_expr, TopologyProgram, TopologySignature},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd")]
enum Request {
    #[serde(rename = "eval")]
    Eval { expr: Expr, x: f64, y: f64, z: f64 },
    #[serde(rename = "grad")]
    Grad { expr: Expr, x: f64, y: f64, z: f64 },
    #[serde(rename = "critical")]
    Critical { expr: Expr, x: f64, y: f64, z: f64 },
    #[serde(rename = "glsl")]
    Glsl { expr: Expr },
    #[serde(rename = "topology_scene")]
    TopologyScene {
        scene: String,
        outer_r: Option<f64>,
        inner_r: Option<f64>,
        half_h: Option<f64>,
    },
    #[serde(rename = "glsl_topology")]
    GlslTopology { topology: TopologyProgram },
    #[serde(rename = "critical_topology")]
    CriticalTopology {
        topology: TopologyProgram,
        x: f64,
        y: f64,
        z: f64,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "ok")]
enum Response {
    #[serde(rename = "eval")]
    Eval { value: f64 },
    #[serde(rename = "grad")]
    Grad { value: f64, grad: [f64; 3] },
    #[serde(rename = "critical")]
    Critical {
        found: bool,
        x: f64,
        y: f64,
        z: f64,
        f: f64,
        index: u8,
    },
    #[serde(rename = "glsl")]
    Glsl { code: String },
    #[serde(rename = "topology")]
    Topology { topology: TopologyProgram },
    #[serde(rename = "error")]
    Error { message: String },
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/", get(index))
        .route("/app.js", get(app_js))
        .route("/style.css", get(style_css))
        .route("/ws", get(ws_handler));

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(8787);
    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .expect("valid socket address");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind listener");
    println!("morse-server listening on http://{addr}");
    axum::serve(listener, app).await.expect("serve axum app");
}

async fn index() -> impl IntoResponse {
    Html(include_str!("../../../web/index.html"))
}

async fn app_js() -> impl IntoResponse {
    (
        [(
            axum::http::header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        include_str!("../../../web/app.js"),
    )
}

async fn style_css() -> impl IntoResponse {
    (
        [(axum::http::header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("../../../web/style.css"),
    )
}

async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_ws)
}

async fn handle_ws(mut socket: WebSocket) {
    while let Some(Ok(msg)) = socket.next().await {
        if let Message::Text(text) = msg {
            let response = match serde_json::from_str::<Request>(&text) {
                Ok(req) => route_request(req),
                Err(err) => Response::Error {
                    message: format!("bad request: {err}"),
                },
            };
            let payload = serde_json::to_string(&response).expect("serialize response");
            if socket.send(Message::Text(payload.into())).await.is_err() {
                break;
            }
        }
    }
}

fn route_request(req: Request) -> Response {
    match req {
        Request::Eval { expr, x, y, z } => Response::Eval {
            value: eval(&expr, Point { x, y, z }),
        },
        Request::Grad { expr, x, y, z } => {
            let ad = eval_ad(&expr, x, y, z);
            Response::Grad {
                value: ad.v,
                grad: ad.g,
            }
        }
        Request::Critical { expr, x, y, z } => critical_response(&expr, x, y, z),
        Request::Glsl { expr } => Response::Glsl {
            code: to_glsl(&expr),
        },
        Request::TopologyScene {
            scene,
            outer_r,
            inner_r,
            half_h,
        } => {
            let topo = match scene.as_str() {
                "tube" => {
                    let outer = outer_r.unwrap_or(1.0).max(0.1);
                    let inner = inner_r.unwrap_or(0.6).clamp(0.01, outer - 0.01);
                    let h = half_h.unwrap_or(1.2).max(0.1);
                    let mut t = expr_to_topology(&tube(outer, inner, h));
                    t.signature = TopologySignature {
                        betti_hint: [1, 1, 0],
                        euler_hint: 0,
                        genus_hint: 1,
                    };
                    t
                }
                _ => expr_to_topology(&sphere(0.75)),
            };
            Response::Topology { topology: topo }
        }
        Request::GlslTopology { topology } => match topology_to_expr(&topology) {
            Ok(expr) => Response::Glsl {
                code: to_glsl(&expr),
            },
            Err(err) => Response::Error {
                message: format!("topology compile failed: {err}"),
            },
        },
        Request::CriticalTopology { topology, x, y, z } => match topology_to_expr(&topology) {
            Ok(expr) => critical_response(&expr, x, y, z),
            Err(err) => Response::Error {
                message: format!("topology compile failed: {err}"),
            },
        },
    }
}

fn critical_response(expr: &Expr, x: f64, y: f64, z: f64) -> Response {
    match refine_critical(expr, x, y, z) {
        Some(c) => Response::Critical {
            found: true,
            x: c.x,
            y: c.y,
            z: c.z,
            f: c.f,
            index: c.index,
        },
        None => Response::Critical {
            found: false,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            f: 0.0,
            index: 0,
        },
    }
}
