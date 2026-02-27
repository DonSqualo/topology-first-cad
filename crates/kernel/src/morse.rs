use crate::ad::eval_ad;
use crate::expr::Expr;

#[derive(Clone, Copy, Debug)]
pub struct CriticalPoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub f: f64,
    pub index: u8,
}

pub fn gradient(expr: &Expr, x: f64, y: f64, z: f64) -> [f64; 3] {
    eval_ad(expr, x, y, z).g
}

pub fn hessian(expr: &Expr, x: f64, y: f64, z: f64, eps: f64) -> [[f64; 3]; 3] {
    let gxp = gradient(expr, x + eps, y, z);
    let gxm = gradient(expr, x - eps, y, z);
    let gyp = gradient(expr, x, y + eps, z);
    let gym = gradient(expr, x, y - eps, z);
    let gzp = gradient(expr, x, y, z + eps);
    let gzm = gradient(expr, x, y, z - eps);

    [
        [
            (gxp[0] - gxm[0]) / (2.0 * eps),
            (gyp[0] - gym[0]) / (2.0 * eps),
            (gzp[0] - gzm[0]) / (2.0 * eps),
        ],
        [
            (gxp[1] - gxm[1]) / (2.0 * eps),
            (gyp[1] - gym[1]) / (2.0 * eps),
            (gzp[1] - gzm[1]) / (2.0 * eps),
        ],
        [
            (gxp[2] - gxm[2]) / (2.0 * eps),
            (gyp[2] - gym[2]) / (2.0 * eps),
            (gzp[2] - gzm[2]) / (2.0 * eps),
        ],
    ]
}

fn solve3(mut a: [[f64; 3]; 3], mut b: [f64; 3]) -> Option<[f64; 3]> {
    for i in 0..3 {
        let mut pivot = i;
        for r in (i + 1)..3 {
            if a[r][i].abs() > a[pivot][i].abs() {
                pivot = r;
            }
        }
        if a[pivot][i].abs() < 1e-12 {
            return None;
        }
        if pivot != i {
            a.swap(i, pivot);
            b.swap(i, pivot);
        }
        let d = a[i][i];
        for c in i..3 {
            a[i][c] /= d;
        }
        b[i] /= d;

        for r in 0..3 {
            if r == i {
                continue;
            }
            let f = a[r][i];
            for c in i..3 {
                a[r][c] -= f * a[i][c];
            }
            b[r] -= f * b[i];
        }
    }
    Some(b)
}

fn jacobi_eigs(mut a: [[f64; 3]; 3]) -> [f64; 3] {
    for _ in 0..24 {
        let mut p = 0;
        let mut q = 1;
        let mut max = a[0][1].abs();
        for i in 0..3 {
            for j in (i + 1)..3 {
                if a[i][j].abs() > max {
                    max = a[i][j].abs();
                    p = i;
                    q = j;
                }
            }
        }
        if max < 1e-10 {
            break;
        }
        let app = a[p][p];
        let aqq = a[q][q];
        let apq = a[p][q];
        let phi = 0.5 * (2.0 * apq).atan2(aqq - app);
        let c = phi.cos();
        let s = phi.sin();
        for r in 0..3 {
            let arp = a[r][p];
            let arq = a[r][q];
            a[r][p] = c * arp - s * arq;
            a[r][q] = s * arp + c * arq;
        }
        for cidx in 0..3 {
            let apc = a[p][cidx];
            let aqc = a[q][cidx];
            a[p][cidx] = c * apc - s * aqc;
            a[q][cidx] = s * apc + c * aqc;
        }
    }
    [a[0][0], a[1][1], a[2][2]]
}

pub fn morse_index(h: [[f64; 3]; 3]) -> u8 {
    let eigs = jacobi_eigs(h);
    eigs.into_iter().filter(|e| *e < 0.0).count() as u8
}

pub fn refine_critical(expr: &Expr, mut x: f64, mut y: f64, mut z: f64) -> Option<CriticalPoint> {
    for _ in 0..24 {
        let g = gradient(expr, x, y, z);
        let gn = (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]).sqrt();
        if gn < 1e-8 {
            let f = eval_ad(expr, x, y, z).v;
            let h = hessian(expr, x, y, z, 1e-4);
            return Some(CriticalPoint {
                x,
                y,
                z,
                f,
                index: morse_index(h),
            });
        }
        let h = hessian(expr, x, y, z, 1e-4);
        let delta = solve3(h, [-g[0], -g[1], -g[2]])?;
        x += delta[0];
        y += delta[1];
        z += delta[2];
        if !x.is_finite() || !y.is_finite() || !z.is_finite() {
            return None;
        }
    }
    None
}
