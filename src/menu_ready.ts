import { PNG } from "pngjs";

// Bedrock 1.26's main menu has two centered horizontal buttons here. Check both
// buttons so a rendered loading frame (which already reports FPS) is not mistaken
// for an interactive menu. Samples are far from button labels and edges.
export function mainMenuReady(pngBase64: string): boolean {
  const png = PNG.sync.read(Buffer.from(pngBase64, "base64"));
  const sample = (x: number, y: number) => {
    const i = (Math.round(y * png.height) * png.width + Math.round(x * png.width)) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const neutral = ([r, g, b]: number[]) => r >= 145 && r <= 230 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12;
  const green = ([r, g, b]: number[]) => g > 90 && g > r * 1.6 && g > b * 3;
  for (const x of [0.423, 0.552]) {
    const play = sample(x, 0.544);
    const settings = sample(x, 0.619);
    if (!(neutral(play) || green(play)) || !neutral(settings)) return false;
  }
  return true;
}
