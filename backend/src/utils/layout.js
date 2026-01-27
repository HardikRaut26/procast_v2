export function getGridLayout(count, width = 1280, height = 720) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  const tileW = Math.floor(width / cols);
  const tileH = Math.floor(height / rows);

  return { cols, rows, tileW, tileH };
}
