import { useEffect, useRef } from "react";

/**
 * Radial burst of music notes exploding from the center of the screen.
 * Notes spawn continuously from the title area and drift outward toward
 * the edges, fading and spinning as they go. Creates a living, breathing
 * "orchestra warming up" effect behind the wizard/loading hero.
 */
export default function OnboardingParticles() {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const SYMBOLS = ["\u266A", "\u266B", "\u2669", "\u266C", "\u{1D160}", "\u{1D15E}"];
    const COLORS = [
      "oklch(0.75 0.18 250)",   // blue
      "oklch(0.80 0.16 200)",   // cyan
      "oklch(0.70 0.20 330)",   // pink
      "oklch(0.85 0.14 85)",    // gold
      "oklch(0.75 0.18 145)",   // green
      "oklch(0.80 0.12 280)",   // purple
      "oklch(0.78 0.15 30)",    // orange
    ];

    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // Spawn a new particle from center with radial velocity
    function spawnParticle() {
      const cx = w / 2;
      const cy = h * 0.38; // slightly above center, where the title sits

      // Random angle for radial burst
      const angle = Math.random() * Math.PI * 2;
      // Speed varies — some fast, some slow for depth
      const speed = Math.random() * 1.8 + 0.4;
      // Slight spread from exact center
      const spread = Math.random() * 20;

      return {
        x: cx + Math.cos(angle) * spread,
        y: cy + Math.sin(angle) * spread,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        // Gentle gravity pulling notes slightly downward
        gravity: 0.003 + Math.random() * 0.005,
        size: Math.random() * 18 + 12,
        symbol: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 2.5,
        life: 0,
        maxLife: 180 + Math.random() * 200, // frames until fade-out complete
        fadeIn: 15, // frames to reach full opacity
      };
    }

    // Seed initial burst so it doesn't start empty
    const initialCount = Math.min(Math.floor((w * h) / 6000), 120);
    particlesRef.current = [];
    for (let i = 0; i < initialCount; i++) {
      const p = spawnParticle();
      // Pre-advance particles so they're already spread out
      const advance = Math.random() * p.maxLife * 0.8;
      p.x += p.vx * advance;
      p.y += p.vy * advance + 0.5 * p.gravity * advance * advance;
      p.rotation += p.rotationSpeed * advance;
      p.life = advance;
      particlesRef.current.push(p);
    }

    // How many to spawn per frame (continuous emission)
    const spawnRate = Math.max(1, Math.floor(initialCount / 90));
    let frameCount = 0;

    const animate = () => {
      ctx.clearRect(0, 0, w, h);
      frameCount++;

      // Spawn new particles continuously
      if (frameCount % 2 === 0) {
        for (let i = 0; i < spawnRate; i++) {
          particlesRef.current.push(spawnParticle());
        }
      }

      const alive = [];

      for (const p of particlesRef.current) {
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.rotation += p.rotationSpeed;

        // Slow down gradually (air resistance)
        p.vx *= 0.998;
        p.vy *= 0.998;

        if (p.life > p.maxLife) continue; // dead
        // Skip if way off screen
        if (p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) continue;

        alive.push(p);

        // Opacity: fade in, hold, fade out
        const fadeInAlpha = Math.min(1, p.life / p.fadeIn);
        const fadeOutStart = p.maxLife * 0.6;
        const fadeOutAlpha = p.life > fadeOutStart
          ? 1 - (p.life - fadeOutStart) / (p.maxLife - fadeOutStart)
          : 1;
        const alpha = fadeInAlpha * fadeOutAlpha * 0.5;

        if (alpha <= 0.01) continue;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = alpha;
        ctx.font = `${p.size}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = p.color;
        ctx.fillText(p.symbol, 0, 0);
        ctx.restore();
      }

      particlesRef.current = alive;
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
}
