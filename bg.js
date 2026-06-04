const bgCanvas = document.getElementById('bg-canvas')
console.log('bgCanvas =', bgCanvas)
if (!bgCanvas) {
  throw new Error('bg-canvas not found')
}
const bgCtx = bgCanvas.getContext('2d')
console.log('bgCtx =', bgCtx)

function resizeBgCanvas() {
  bgCanvas.width = window.innerWidth
  bgCanvas.height = window.innerHeight
}

resizeBgCanvas()
window.addEventListener('resize', resizeBgCanvas)

const bgTriangles = []

function bgRand(min, max) {
  return min + Math.random() * (max - min)
}

function spawnBgTriangle() {

  const maxBlur = bgRand(6, 14)

  bgTriangles.push({
    x: Math.random() * bgCanvas.width,
    y: Math.random() * bgCanvas.height,

    vx: bgRand(-0.25, 0.25),
    vy: bgRand(-0.25, 0.25),

    ax: 0,
    ay: 0,

    size: bgRand(4, 14),

    angle: bgRand(0, Math.PI * 2),
    rot: bgRand(-0.01, 0.01),

    seed: Math.random() * 1000,

    alpha: 0.5,

    blur: maxBlur,
    targetBlur: 0,
    maxBlur: maxBlur,

    focusTimer: bgRand(80, 180),

    dying: false,
    deathProgress: 0,

    appearing: true
  })
}

function drawBgTriangle(t) {

  bgCtx.save()

  bgCtx.translate(t.x, t.y)
  bgCtx.rotate(t.angle)

  /*bgCtx.filter = `blur(${t.blur}px)`*/
  bgCtx.filter = 'none'
  bgCtx.globalAlpha = t.alpha

  bgCtx.fillStyle = 'white'

  bgCtx.beginPath()
  bgCtx.moveTo(0, -t.size)
  bgCtx.lineTo(t.size * 0.9, t.size)
  bgCtx.lineTo(-t.size * 0.9, t.size)
  bgCtx.closePath()
  bgCtx.fill()

  bgCtx.restore()
}

for (let i = 0; i < 20; i++) {
  spawnBgTriangle()
}

function animateBg() {

  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height)

  if (Math.random() < 0.015) {
    spawnBgTriangle()
  }

  const time = performance.now() * 0.001

  for (let i = bgTriangles.length - 1; i >= 0; i--) {

    const t = bgTriangles[i]

    const flowX = Math.sin(time * 0.6 + t.seed)
    const flowY = Math.cos(time * 0.5 + t.seed * 1.4)

    t.ax += flowX * 0.01
    t.ay += flowY * 0.01

    t.vx += t.ax
    t.vy += t.ay

    t.vx *= 0.97
    t.vy *= 0.97

    t.ax *= 0.5
    t.ay *= 0.5

    t.x += t.vx
    t.y += t.vy

    t.angle += t.rot

    if (t.x < -40) t.x = bgCanvas.width + 40
    if (t.x > bgCanvas.width + 40) t.x = -40
    if (t.y < -40) t.y = bgCanvas.height + 40
    if (t.y > bgCanvas.height + 40) t.y = -40

    if (t.appearing) {

      t.blur += (0 - t.blur) * 0.03
      t.alpha += (0.5 - t.alpha) * 0.03

      if (t.blur < 0.5) {
        t.appearing = false
      }
    }

    t.focusTimer--

    if (t.focusTimer <= 0 && !t.dying) {

      t.targetBlur = bgRand(0, t.maxBlur)

      t.focusTimer = bgRand(100, 250)
    }

    t.blur += (t.targetBlur - t.blur) * 0.02

    if (
      !t.dying &&
      t.blur >= t.maxBlur * 0.95 &&
      t.alpha <= 0.05
    ) {
      if (Math.random() < 0.2) {
        t.dying = true
      }
    }

    if (t.dying) {

      t.deathProgress += 0.01

      t.alpha *= 0.97
      t.blur += 0.15

      if (t.deathProgress > 1) {

        bgTriangles.splice(i, 1)

        continue
      }
    }

    drawBgTriangle(t)
  }

  requestAnimationFrame(animateBg)
}

animateBg()
