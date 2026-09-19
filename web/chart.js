(function () {
  const PALETTE = [
    "#4f7cf7",
    "#7c5cf7",
    "#f7a54f",
    "#4fd1c5",
    "#f75c8d",
    "#9f7aea",
    "#63b3ed",
    "#f6e05e",
  ];

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function niceMax(value) {
    if (value <= 0) return 1;
    const exp = Math.floor(Math.log10(value));
    const base = Math.pow(10, exp);
    const norm = value / base;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * base;
  }

  function formatNumber(n) {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(Math.round(n * 100) / 100);
  }

  function renderBar(spec, width, height) {
    const data = spec.datasets[0].data;
    const labels = spec.labels;
    const padL = 48;
    const padB = 46;
    const padT = 16;
    const padR = 14;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const max = niceMax(Math.max(...data, 0));
    const barW = Math.max(plotW / data.length - 8, 4);

    let svg = "";

    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      const value = max * (1 - i / 4);
      svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#2a2d34" stroke-width="1"/>`;
      svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6f7480">${formatNumber(value)}</text>`;
    }

    data.forEach((value, i) => {
      const x = padL + (plotW / data.length) * i + (plotW / data.length - barW) / 2;
      const h = max > 0 ? (value / max) * plotH : 0;
      const y = padT + plotH - h;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(h, 1)}" rx="4" fill="${PALETTE[i % PALETTE.length]}" opacity="0.92"/>`;
      svg += `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="9.5" fill="#a9adb8">${formatNumber(value)}</text>`;
    });

    const step = Math.ceil(labels.length / 12);
    labels.forEach((label, i) => {
      if (i % step !== 0) return;
      const x = padL + (plotW / labels.length) * i + plotW / labels.length / 2;
      const text = label.length > 11 ? label.slice(0, 10) + "…" : label;
      svg += `<text x="${x}" y="${height - padB + 17}" text-anchor="middle" font-size="10" fill="#a9adb8" transform="rotate(-18 ${x} ${height - padB + 17})">${esc(text)}</text>`;
    });

    svg += `<line x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" stroke="#3a3f49" stroke-width="1.5"/>`;
    return svg;
  }

  function renderLine(spec, width, height) {
    const data = spec.datasets[0].data;
    const labels = spec.labels;
    const padL = 48;
    const padB = 46;
    const padT = 16;
    const padR = 14;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const max = niceMax(Math.max(...data, 0));

    let svg = "";

    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#2a2d34" stroke-width="1"/>`;
      svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6f7480">${formatNumber(max * (1 - i / 4))}</text>`;
    }

    const points = data.map((value, i) => {
      const x = padL + (data.length === 1 ? plotW / 2 : (plotW / (data.length - 1)) * i);
      const y = padT + plotH - (max > 0 ? (value / max) * plotH : 0);
      return { x, y, value };
    });

    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    const area = `${path} L${points[points.length - 1].x},${padT + plotH} L${points[0].x},${padT + plotH} Z`;

    svg += `<defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4f7cf7" stop-opacity="0.35"/><stop offset="100%" stop-color="#4f7cf7" stop-opacity="0"/></linearGradient></defs>`;
    svg += `<path d="${area}" fill="url(#lg)"/>`;
    svg += `<path d="${path}" fill="none" stroke="#4f7cf7" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;

    points.forEach((p) => {
      svg += `<circle cx="${p.x}" cy="${p.y}" r="3.4" fill="#0f1012" stroke="#4f7cf7" stroke-width="2"/>`;
    });

    const step = Math.ceil(labels.length / 12);
    labels.forEach((label, i) => {
      if (i % step !== 0) return;
      const x = padL + (data.length === 1 ? plotW / 2 : (plotW / (data.length - 1)) * i);
      const text = label.length > 11 ? label.slice(0, 10) + "…" : label;
      svg += `<text x="${x}" y="${height - padB + 17}" text-anchor="middle" font-size="10" fill="#a9adb8" transform="rotate(-18 ${x} ${height - padB + 17})">${esc(text)}</text>`;
    });

    return svg;
  }

  function renderPie(spec, width, height) {
    const data = spec.datasets[0].data;
    const labels = spec.labels;
    const total = data.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
    const cx = Math.min(width * 0.34, 190);
    const cy = height / 2;
    const r = Math.min(cy - 24, 110);

    let angle = -Math.PI / 2;
    let svg = "";

    data.forEach((value, i) => {
      const slice = (Math.max(value, 0) / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + slice);
      const y2 = cy + r * Math.sin(angle + slice);
      const large = slice > Math.PI ? 1 : 0;
      const color = PALETTE[i % PALETTE.length];
      svg += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${color}" opacity="0.92" stroke="#0f1012" stroke-width="1.5"/>`;
      angle += slice;
    });

    svg += `<circle cx="${cx}" cy="${cy}" r="${r * 0.52}" fill="#0f1012"/>`;
    svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="13" fill="#ececf1" font-weight="600">${formatNumber(total)}</text>`;
    svg += `<text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="9.5" fill="#6f7480">total</text>`;

    const legendX = cx + r + 30;
    const rowH = 19;
    const startY = cy - (data.length * rowH) / 2 + 6;

    data.forEach((value, i) => {
      const y = startY + i * rowH;
      const pct = ((value / total) * 100).toFixed(0);
      const label = labels[i].length > 18 ? labels[i].slice(0, 17) + "…" : labels[i];
      svg += `<rect x="${legendX}" y="${y - 8}" width="9" height="9" rx="2.5" fill="${PALETTE[i % PALETTE.length]}"/>`;
      svg += `<text x="${legendX + 15}" y="${y}" font-size="11" fill="#a9adb8">${esc(label)}</text>`;
      svg += `<text x="${width - 14}" y="${y}" text-anchor="end" font-size="11" fill="#6f7480">${pct}%</text>`;
    });

    return svg;
  }

  window.renderChart = function (spec) {
    const width = 620;
    const height = spec.type === "pie" ? 300 : 300;
    let inner;
    if (spec.type === "pie") inner = renderPie(spec, width, height);
    else if (spec.type === "line") inner = renderLine(spec, width, height);
    else inner = renderBar(spec, width, height);

    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${esc(spec.title || "Graphique")}">${inner}</svg>`;
  };
})();
