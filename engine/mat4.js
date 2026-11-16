/* minimal column-major mat4 helpers — no dependencies */

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ]);
}

export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                     a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/** View matrix for a camera at `eye` oriented by Euler angles.
 *  Camera-to-world is M = Ry(yaw) * Rx(pitch) * Rz(roll), so yaw turns about
 *  world up, pitch tilts about the camera's own right axis, and roll spins
 *  about the view direction. At roll = 0 this reduces exactly to the old
 *  yaw/pitch form. Default orientation (0,0,0) looks down -Z.
 */
export function viewEuler(eye, pitch, yaw, roll) {
  const cy = Math.cos(yaw),   sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll),  sr = Math.sin(roll);

  /* columns of M = the camera's axes in world space */
  const rx =  cy * cr + sy * sp * sr;
  const ry =  cp * sr;
  const rz = -sy * cr + cy * sp * sr;

  const ux = -cy * sr + sy * sp * cr;
  const uy =  cp * cr;
  const uz =  sy * sr + cy * sp * cr;

  const bx =  sy * cp;          /* back = -forward */
  const by = -sp;
  const bz =  cy * cp;

  return new Float32Array([
    rx, ux, bx, 0,
    ry, uy, by, 0,
    rz, uz, bz, 0,
    -(rx*eye[0] + ry*eye[1] + rz*eye[2]),
    -(ux*eye[0] + uy*eye[1] + uz*eye[2]),
    -(bx*eye[0] + by*eye[1] + bz*eye[2]), 1
  ]);
}

/** Back-compat shim: yaw/pitch with no roll. */
export function viewYawPitch(eye, yaw, pitch) {
  return viewEuler(eye, pitch, yaw, 0);
}

/** Project a world point with a view-projection matrix -> NDC xy (or null). */
export function projectPoint(vp, p) {
  const x = vp[0]*p[0] + vp[4]*p[1] + vp[8]*p[2]  + vp[12];
  const y = vp[1]*p[0] + vp[5]*p[1] + vp[9]*p[2]  + vp[13];
  const w = vp[3]*p[0] + vp[7]*p[1] + vp[11]*p[2] + vp[15];
  if (Math.abs(w) < 1e-6) return null;
  return [x / w, y / w];
}

/** Object rotation as a column-major mat3, same Euler convention as the view:
 *  M = Ry(yaw) * Rx(pitch) * Rz(roll). */
export function mat3Euler(pitch, yaw, roll) {
  const cy = Math.cos(yaw),   sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll),  sr = Math.sin(roll);
  return new Float32Array([
    cy*cr + sy*sp*sr,  cp*sr,  -sy*cr + cy*sp*sr,
   -cy*sr + sy*sp*cr,  cp*cr,   sy*sr + cy*sp*cr,
    sy*cp,            -sp,      cy*cp
  ]);
}

/** Apply a column-major mat3 to a vec3. */
export function m3apply(m, v) {
  return [
    m[0]*v[0] + m[3]*v[1] + m[6]*v[2],
    m[1]*v[0] + m[4]*v[1] + m[7]*v[2],
    m[2]*v[0] + m[5]*v[1] + m[8]*v[2]
  ];
}
