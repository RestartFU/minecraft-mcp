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

// Confirmation shown by the documented `minecraft://connect` URI for a newly
// added address on this client. Check the dialog frame, green Continue button,
// and gray Cancel button before sending input to it.
function externalServerDialog(pngBase64: string, requireGreen: boolean): boolean {
  const png = PNG.sync.read(Buffer.from(pngBase64, "base64"));
  if (png.width !== 854 || png.height !== 480) return false;
  const rgb = (x: number, y: number) => {
    const i = (y * png.width + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const [borderR, borderG, borderB] = rgb(326, 190);
  const [fieldR, fieldG, fieldB] = rgb(425, 225);
  const [goR, goG, goB] = rgb(360, 265);
  const [cancelR, cancelG, cancelB] = rgb(360, 298);
  const green = goG > 90 && goG > goR * 1.6 && goG > goB * 3;
  const neutral = goR > 145 && Math.abs(goR - goG) < 12 && Math.abs(goG - goB) < 12;
  return borderR > 235 && borderG > 235 && borderB > 235 &&
    fieldR < 30 && fieldG < 30 && fieldB < 30 &&
    (requireGreen ? green : green || neutral) &&
    cancelR > 145 && Math.abs(cancelR - cancelG) < 12 && Math.abs(cancelG - cancelB) < 12;
}

export function externalServerPromptReady(pngBase64: string): boolean {
  return externalServerDialog(pngBase64, true);
}

export function externalServerPromptPresent(pngBase64: string): boolean {
  return externalServerDialog(pngBase64, false);
}

// These checks match the stock 854×480 Servers tab and Add Server form. Sample
// the interior of controls, away from labels and edges, before native clicks.
export function serversTabReady(pngBase64: string): boolean {
  const png = PNG.sync.read(Buffer.from(pngBase64, "base64"));
  if (png.width !== 854 || png.height !== 480) return false;
  const pixel = (x: number, y: number) => {
    const i = (y * png.width + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  return [[130, 96], [285, 95]].every(([x, y]) => {
    const [r, g, b] = pixel(x, y);
    return r > 165 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12;
  });
}

export function addServerFormReady(pngBase64: string): boolean {
  const png = PNG.sync.read(Buffer.from(pngBase64, "base64"));
  if (png.width !== 854 || png.height !== 480) return false;
  const pixel = (x: number, y: number) => {
    const i = (y * png.width + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const [saveR, saveG, saveB] = pixel(220, 220);
  const [playR, playG, playB] = pixel(460, 220);
  const [fieldR, fieldG, fieldB] = pixel(300, 80);
  return saveR > 165 && Math.abs(saveR - saveG) < 12 && Math.abs(saveG - saveB) < 12 &&
    playG > 90 && playG > playR * 1.6 && playG > playB * 3 &&
    fieldR < 90 && fieldG < 90 && fieldB < 90;
}
