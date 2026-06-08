// 1 - canvas element and context
const bgCanvas = document.getElementById('bg-canvas');
if (!bgCanvas) throw new Error('bg-canvas not found');
const bgCtx = bgCanvas.getContext('2d');
// end 1

// 2 - resize handler
function resizeBgCanvas() {
  bgCanvas.width = window.innerWidth;
  bgCanvas.height = window.innerHeight;
}
resizeBgCanvas();
window.addEventListener('resize', resizeBgCanvas);
// end 2

// 3 - triangle storage
let triangles = [];
const MAX_TRIANGLES = 20;               // limited to reduce gpu load
// end 3

// 4 - random helper
function rand(min, max) {
  return min + Math.random() * (max - min);
}
// end 4

// 5 - spawn a new triangle
function spawnTriangle() {
  if (triangles.length >= MAX_TRIANGLES) return;
  triangles.push({
    x: Math.random() * bgCanvas.width,
    y: Math.random() * bgCanvas.height,
    vx: rand(-0.2, 0.2),
    vy: rand(-0.2, 0.2),
    size: rand(6, 16),
    alpha: rand(0.2, 0.5),
    angle: rand(0, Math.PI * 2),
    rot: rand(-0.01, 0.01),
  });
}
// end 5

// 6 - initial triangles
for (let i = 0; i < 12; i++) spawnTriangle();
// end 6

// 7 - draw a single triangle
function drawTriangle(t) {
  bgCtx.save();
  bgCtx.translate(t.x, t.y);
  bgCtx.rotate(t.angle);
  bgCtx.globalAlpha = t.alpha;
  bgCtx.fillStyle = 'white';
  bgCtx.beginPath();
  bgCtx.moveTo(0, -t.size);
  bgCtx.lineTo(t.size * 0.9, t.size);
  bgCtx.lineTo(-t.size * 0.9, t.size);
  bgCtx.closePath();
  bgCtx.fill();
  bgCtx.restore();
}
// end 7

// 8 - animation loop with fps throttle
let lastTimestamp = 0;
function animate(timestamp) {
  // throttle to ~30 fps (reduces cpu/gpu usage)
  if (timestamp - lastTimestamp < 33) {
    requestAnimationFrame(animate);
    return;
  }
  lastTimestamp = timestamp;

  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

  // occasionally spawn a new triangle
  if (Math.random() < 0.02 && triangles.length < MAX_TRIANGLES) spawnTriangle();

  for (let i = triangles.length - 1; i >= 0; i--) {
    const t = triangles[i];
    t.x += t.vx;
    t.y += t.vy;
    t.angle += t.rot;
    t.alpha *= 0.998;                // slow fade

    // wrap around edges
    if (t.x < -50) t.x = bgCanvas.width + 50;
    if (t.x > bgCanvas.width + 50) t.x = -50;
    if (t.y < -50) t.y = bgCanvas.height + 50;
    if (t.y > bgCanvas.height + 50) t.y = -50;

    // remove if nearly invisible
    if (t.alpha < 0.02) {
      triangles.splice(i, 1);
      continue;
    }
    drawTriangle(t);
  }
  requestAnimationFrame(animate);
}
// end 8

// 9 - start the animation
requestAnimationFrame(animate);
// end 9
