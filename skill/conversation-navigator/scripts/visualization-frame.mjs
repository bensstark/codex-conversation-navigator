// Local HTML runs only inside an opaque-origin sandbox. No network, top-level
// navigation, popups, forms, storage access or conversation API access is granted.
export const VISUALIZATION_CSP = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
  "img-src data: blob:", "font-src data:", "connect-src 'none'", "frame-src 'none'",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'",
  "frame-ancestors 'self'", "sandbox allow-scripts",
].join("; ");

const STYLE = `
:root{color-scheme:light;--background:#fffdf8;--foreground:#25241f;--muted:#f3f0e8;
--muted-foreground:#716f65;--border:#d6d3ca;--primary:#2563eb;--primary-foreground:#fff;
--secondary:#f3f0e8;--secondary-foreground:#25241f;--card:var(--background);
--card-foreground:var(--foreground);--input:var(--border);--ring:#2563eb;
--viz-series-1:#2563eb;--viz-series-2:#e68a19;--viz-series-3:#08916c;
--viz-series-4:#9b59b6;--viz-series-5:#e34b58;--viz-series-6:#0891b2;
font:14px/1.5 system-ui,'Microsoft YaHei',sans-serif}
*{box-sizing:border-box}html{margin:0}body{margin:0;padding:16px;color:var(--foreground);background:var(--background)}
h1,h2,h3{line-height:1.35;margin:0 0 14px}h2{font-size:20px}svg,canvas{max-width:100%}
.viz-controls{display:flex;flex-wrap:wrap;gap:16px}.viz-row{display:flex;align-items:center;gap:12px}
.form-label{display:block;margin-bottom:6px}.form-range{width:100%;accent-color:var(--primary)}
.form-select,select,input[type=number],input[type=text]{font:inherit;color:inherit;background:var(--background);border:1px solid var(--border);border-radius:6px;padding:6px 9px}
button,.btn{font:inherit;color:inherit;background:var(--secondary);border:1px solid var(--border);border-radius:6px;padding:6px 12px;cursor:pointer}
.tabular-nums{font-variant-numeric:tabular-nums}.text-small,.text-sm{font-size:12px}.text-muted{color:var(--muted-foreground)}
`;

const BRIDGE = `
window.openai = {widgetState:null,setWidgetState:async function(state){this.widgetState=state}};
function reportSize(){parent.postMessage({type:'navigator-visualization-size',height:document.body.getBoundingClientRect().height+2},'*')}
addEventListener('DOMContentLoaded',()=>{new ResizeObserver(reportSize).observe(document.body);reportSize()});
addEventListener('load',reportSize);
`;

export function visualizationDocument(source) {
  // Fragments are wrapped, while complete documents get the same base styles
  // and bridge before their own scripts (no unsafe string interpolation in JS).
  const support = `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style><script>${BRIDGE}</script>`;
  if (/<html[\s>]/i.test(source)) {
    if (/<head[\s>][^>]*>/i.test(source)) return source.replace(/<head\b[^>]*>/i, `$&${support}`);
    return source.replace(/<html\b[^>]*>/i, `$&<head>${support}</head>`);
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${support}</head><body>${source}</body></html>`;
}

export function visualizationErrorDocument(message) {
  const escaped = String(message).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[c]);
  return visualizationDocument(`<p role="alert">互动图无法显示：${escaped}</p>`);
}
