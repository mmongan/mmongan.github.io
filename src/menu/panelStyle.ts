export const PANEL_FRAME_COLOR = '#18263b';
export const PANEL_PAPER_COLOR = '#fffdf7';

export function drawPanelButton(
  ctx: CanvasRenderingContext2D, width: number, height: number, label: string, active = false,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = active ? '#245a98' : PANEL_FRAME_COLOR;
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(3, 3, width - 6, height - 6, height * 0.14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(height * 0.4)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, width / 2, height / 2, width - 12);
}
