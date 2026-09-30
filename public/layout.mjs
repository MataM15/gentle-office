// Layout dimensions are CSS pixels; four offices always retain a 2x2 grid.
// With the available height, 2+ offices take the column count that fits the
// biggest office, so a portrait monitor stacks them instead of shrinking them.
export function officeLayout(count, width, height) {
  if (count > 1 && height > 0) {
    let best = null;
    for (let columns = 1; columns <= count; columns++) {
      const rows = Math.ceil(count / columns);
      const fit = Math.min((width - 12 * (columns - 1)) / columns / 640, ((height - 12 * (rows - 1)) / rows - 28) / 432);
      if (!best || fit > best.fit + 1e-9) best = {columns, rows, fit};
    }
    return {columns:best.columns, rows:best.rows, side:false, sideBySide:false};
  }
  const columns = count <= 1 ? 1 : count === 2 ? (width >= 960 ? 2 : 1)
    : count <= 4 ? 2 : Math.min(count, Math.max(1, Math.floor((width - 12) / 332)));
  return {columns, rows:Math.max(1, Math.ceil(count / columns)), side:count === 1, sideBySide:count === 1 && width >= 960};
}
export function officeScale(fit, count) {
  return count <= 1 ? Math.max(1, Math.floor(fit * 2) / 2) : Math.max(.5, Math.floor(fit * 4) / 4);
}
