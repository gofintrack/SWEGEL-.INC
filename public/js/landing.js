const canvas = document.getElementById("bgNetwork");
const ctx = canvas.getContext("2d");

const nodes = [];
const nodeCount = 80;
const lineDistance = 140;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function makeNode() {
  return {
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.55,
    vy: (Math.random() - 0.5) * 0.55,
    size: Math.random() * 2 + 0.8
  };
}

function initNodes() {
  nodes.length = 0;
  for (let i = 0; i < nodeCount; i += 1) {
    nodes.push(makeNode());
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255, 16, 16, 0.92)";
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    a.x += a.vx;
    a.y += a.vy;

    if (a.x < 0 || a.x > canvas.width) a.vx *= -1;
    if (a.y < 0 || a.y > canvas.height) a.vy *= -1;

    ctx.beginPath();
    ctx.arc(a.x, a.y, a.size, 0, Math.PI * 2);
    ctx.fill();

    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < lineDistance) {
        const alpha = 1 - distance / lineDistance;
        ctx.strokeStyle = `rgba(255, 34, 34, ${alpha * 0.28})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }
  requestAnimationFrame(draw);
}

function spawnBloodDrop() {
  const bloodLayer = document.getElementById("bloodLayer");
  const drop = document.createElement("span");
  drop.className = "blood-drop";
  drop.style.left = `${Math.random() * 100}%`;
  drop.style.animationDuration = `${2.2 + Math.random() * 2.6}s`;
  drop.style.opacity = `${0.45 + Math.random() * 0.45}`;
  bloodLayer.appendChild(drop);

  setTimeout(() => {
    drop.remove();
  }, 5500);
}

resize();
initNodes();
draw();
setInterval(spawnBloodDrop, 320);
window.addEventListener("resize", () => {
  resize();
  initNodes();
});
