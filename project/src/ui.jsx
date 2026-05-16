/* ============================================================
   BRAINWORK ROYALE — SHARED UI
   ============================================================ */

const { useState, useEffect, useRef, useMemo } = React;

// ---- Stat bar ----
function StatRow({ label, value, max = 100, color = "var(--mint)", delta = 0 }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="stat-row">
      <span className="stat-row__label">{label}</span>
      <div className="stat-row__bar">
        <div className="stat-row__fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="stat-row__val">
        {value}
        {delta > 0 && <span style={{ color: "var(--mint)", marginLeft: 4 }}>+{delta}</span>}
      </span>
    </div>
  );
}

const STAT_COLOR = {
  speed: "var(--stat-speed)",
  stamina: "var(--stat-stamina)",
  intelligence: "var(--stat-intel)",
  strength: "var(--stat-strength)",
};

function StatBlock({ stats, deltas = {} }) {
  return (
    <div>
      {["speed", "stamina", "intelligence", "strength"].map((k) => (
        <StatRow
          key={k}
          label={k}
          value={stats[k]}
          color={STAT_COLOR[k]}
          delta={deltas[k] || 0}
        />
      ))}
    </div>
  );
}

// ---- Chip ----
function Chip({ children, variant, dot }) {
  return (
    <span className={`chip ${variant ? "chip--" + variant : ""}`}>
      {dot && <span className="chip__dot" />}
      {children}
    </span>
  );
}

// ---- Section header ----
function SectionTitle({ children, link }) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {link && <span className="section-title__link">{link}</span>}
    </div>
  );
}

// ---- Page header ----
function PageHeader({ eyebrow, title, meta, action }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="page-header__sub">{eyebrow}</div>}
        <h1 className="page-header__title">{title}</h1>
      </div>
      <div className="row">
        {meta && <div className="page-header__meta">{meta}</div>}
        {action}
      </div>
    </div>
  );
}

// ---- Toast ----
function Toast({ message, onDone, duration = 2400 }) {
  useEffect(() => {
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [message]);
  return (
    <div className="toast">
      <span className="chip__dot" style={{ background: "var(--mint)" }} />
      <span className="mono tiny">{message}</span>
    </div>
  );
}

// ---- Radar chart (canvas) for AI stats ----
function StatRadar({ stats, color = "oklch(0.85 0.15 175)", size = 240 }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    c.style.width = size + "px"; c.style.height = size + "px";
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2;
    const radius = size * 0.38;
    const keys = ["speed", "stamina", "intelligence", "strength"];
    const labels = ["SPD", "STA", "INT", "STR"];

    // grid rings
    ctx.strokeStyle = "#2a3052";
    ctx.lineWidth = 1;
    for (let r = 1; r <= 4; r++) {
      ctx.beginPath();
      for (let i = 0; i < keys.length; i++) {
        const ang = -Math.PI / 2 + (i / keys.length) * Math.PI * 2;
        const x = cx + Math.cos(ang) * (radius * r / 4);
        const y = cy + Math.sin(ang) * (radius * r / 4);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    // axes
    ctx.strokeStyle = "#1b203a";
    for (let i = 0; i < keys.length; i++) {
      const ang = -Math.PI / 2 + (i / keys.length) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius);
      ctx.stroke();
    }

    // data polygon
    ctx.beginPath();
    keys.forEach((k, i) => {
      const v = (stats[k] || 0) / 100;
      const ang = -Math.PI / 2 + (i / keys.length) * Math.PI * 2;
      const x = cx + Math.cos(ang) * radius * v;
      const y = cy + Math.sin(ang) * radius * v;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = color.replace(")", " / 0.18)");
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    // points
    keys.forEach((k, i) => {
      const v = (stats[k] || 0) / 100;
      const ang = -Math.PI / 2 + (i / keys.length) * Math.PI * 2;
      const x = cx + Math.cos(ang) * radius * v;
      const y = cy + Math.sin(ang) * radius * v;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
    // labels
    ctx.fillStyle = "#8b91b8";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    labels.forEach((lab, i) => {
      const ang = -Math.PI / 2 + (i / keys.length) * Math.PI * 2;
      const x = cx + Math.cos(ang) * (radius + 18);
      const y = cy + Math.sin(ang) * (radius + 18);
      ctx.fillText(lab, x, y);
    });
  }, [stats, color, size]);
  return <canvas ref={ref} />;
}

Object.assign(window, {
  StatRow, StatBlock, Chip, SectionTitle, PageHeader, Toast, StatRadar, STAT_COLOR,
});
