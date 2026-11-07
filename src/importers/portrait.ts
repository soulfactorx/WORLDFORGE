/** 브라우저에서 초상화를 작게 줄여 data URL로 만든다 (패키지 용량 제한: 약 300KB) */
export async function portraitDataUrl(bytes: Uint8Array, mime: string, max = 256): Promise<string | undefined> {
  try {
    const blob = new Blob([new Uint8Array(bytes)], { type: mime });
    // SVG(내장 그림)는 createImageBitmap이 못 읽으므로 <img>로 그린다
    const bitmap: { width: number; height: number } & CanvasImageSource = await createImageBitmap(blob).catch(() => imageOf(blob));
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const [type, q] of [['image/webp', 0.85], ['image/jpeg', 0.8], ['image/jpeg', 0.6]] as const) {
      const url = canvas.toDataURL(type, q);
      if (url.startsWith(`data:${type}`) && url.length < 400_000) return url;
    }
    return undefined;
  } catch {
    return undefined; // 이미지를 해석할 수 없으면 초상화 없이 가져온다
  }
}

/** <img>로 이미지 읽기 (SVG 등 createImageBitmap이 못 읽는 것) */
function imageOf(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); if (!img.width) { img.width = 256; img.height = 256; } ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('이미지를 읽을 수 없습니다')); };
    img.src = url;
  });
}

/** 파일·이미지 URL → 초상화 data URL */
export async function portraitFromBlob(blob: Blob): Promise<string | undefined> {
  return portraitDataUrl(new Uint8Array(await blob.arrayBuffer()), blob.type || 'image/png');
}
