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
const MAX_TRIANGLES = 40;               // cap to 40 triangles
// end 3

// 4 - random helper
function rand(min, max) {
  return min + Math.random() * (max - min);
}
// end 4

// 5 - spawn a new triangle
function spawnTriangle() {
  // 5.1 - check cap
  if (triangles.length >= MAX_TRIANGLES) return;
  // end 5.1

  // 5.2 - push new triangle with properties
  triangles.push({
    x: Math.random() * bgCanvas.width,
    y: Math.random() * bgCanvas.height,
    vx: rand(-0.2, 0.2),
    vy: rand(-0.2, 0.2),
    size: rand(12, 32),                // doubled size
    alpha: rand(0.2, 0.5),
    angle: rand(0, Math.PI * 2),
    rot: rand(-0.01, 0.01),
  });
  // end 5.2
}
// end 5

// 6 - initial triangles (half of max)
for (let i = 0; i < 20; i++) spawnTriangle();
// end 6

// 7 - draw a single triangle
function drawTriangle(t) {
  // 7.1 - save context and translate
  bgCtx.save();
  bgCtx.translate(t.x, t.y);
  bgCtx.rotate(t.angle);
  // end 7.1

  // 7.2 - set style and draw triangle
  bgCtx.globalAlpha = t.alpha;
  bgCtx.fillStyle = 'white';
  bgCtx.beginPath();
  bgCtx.moveTo(0, -t.size);
  bgCtx.lineTo(t.size * 0.9, t.size);
  bgCtx.lineTo(-t.size * 0.9, t.size);
  bgCtx.closePath();
  bgCtx.fill();
  // end 7.2

  // 7.3 - restore context
  bgCtx.restore();
  // end 7.3
}
// end 7

// 8 - animation loop with fps throttle
let lastTimestamp = 0;
function animate(timestamp) {
  // 8.1 - throttle to ~30 fps
  if (timestamp - lastTimestamp < 33) {
    requestAnimationFrame(animate);
    return;
  }
  lastTimestamp = timestamp;
  // end 8.1

  // 8.2 - clear canvas
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  // end 8.2

  // 8.3 - occasionally spawn a new triangle
  if (Math.random() < 0.03 && triangles.length < MAX_TRIANGLES) spawnTriangle();
  // end 8.3

  // 8.4 - update and draw each triangle
  for (let i = triangles.length - 1; i >= 0; i--) {
    const t = triangles[i];

    // 8.4.1 - update position and angle
    t.x += t.vx;
    t.y += t.vy;
    t.angle += t.rot;
    t.alpha *= 0.998;                // slow fade
    // end 8.4.1

    // 8.4.2 - wrap around edges
    if (t.x < -50) t.x = bgCanvas.width + 50;
    if (t.x > bgCanvas.width + 50) t.x = -50;
    if (t.y < -50) t.y = bgCanvas.height + 50;
    if (t.y > bgCanvas.height + 50) t.y = -50;
    // end 8.4.2

    // 8.4.3 - remove if nearly invisible
    if (t.alpha < 0.02) {
      triangles.splice(i, 1);
      continue;
    }
    // end 8.4.3

    // 8.4.4 - draw the triangle
    drawTriangle(t);
    // end 8.4.4
  }
  // end 8.4

  // 8.5 - request next frame
  requestAnimationFrame(animate);
  // end 8.5
}
// end 8

// 9 - start the animation
requestAnimationFrame(animate);
// end 9
