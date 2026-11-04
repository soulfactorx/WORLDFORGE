/** 브라우저에서 초상화를 작게 줄여 data URL로 만든다 (패키지 용량 제한: 약 300KB) */
export async function portraitDataUrl(bytes: Uint8Array, mime: string, max = 256): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime }));
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
