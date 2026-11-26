export function horizonCull({ threshold = 0.45, nearMargin = 6 } = {}) {
  return (camera, chunk, dist) => {
    const cl = Math.hypot(chunk.center.x, chunk.center.y, chunk.center.z) || 1;
    const cam = Math.hypot(camera.x, camera.y, camera.z) || 1;
    const dot = (camera.x * chunk.center.x + camera.y * chunk.center.y + camera.z * chunk.center.z) / (cl * cam);
    return dot < threshold && dist > nearMargin;
  };
}
