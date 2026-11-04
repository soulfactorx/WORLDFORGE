import { strToU8, zipSync } from 'fflate';
import { makeRisum } from './risum';

/** 테스트용 CHARX: 카드 + 모듈 + 이미지 (prefix: 앞에 붙는 표지 바이트) */
export function makeCharx(prefix = 0, nImages = 30, extra: { lore?: object[]; images?: string[] } = {}) {
  const files: Record<string, Uint8Array> = {};
  const assets: object[] = [{ type: 'icon', uri: 'embeded://assets/icon/main.png', name: 'main', ext: 'png' }];
  files['assets/icon/main.png'] = new Uint8Array([137, 80, 78, 71, 1]);
  for (let i = 0; i < nImages; i++) {
    const path = `assets/other/image/${i}.webp`;
    files[path] = new Uint8Array(10).fill(i % 256);
    const named = extra.images?.[i];
    if (named) assets.push({ type: 'x-risu-asset', uri: `embeded://${path}`, name: named, ext: 'webp' });
    else if (i % 2 === 0) assets.push({ type: 'x-risu-asset', uri: `embeded://${path}`, name: `Hedwig_${i}(F)`, ext: 'webp' });
  }
  const card = { spec: 'chara_card_v3', data: { name: '세계', description: '설명', creator: '작가', first_mes: '황궁의 아침이 밝았다.', character_book: { entries: [{ comment: '카드 로어', keys: ['a'], content: '카드에 있는 내용' }, ...(extra.lore ?? [])] }, assets,
    extensions: { risuai: { toggles: 'kc_lang=언어=select=한국어,English\n=설명 문구=caption\nkc_img=이미지=checkbox' } } } };
  files['card.json'] = strToU8(JSON.stringify(card));
  files['module.risum'] = makeRisum({ name: 'm', lorebook: [{ comment: '카드 로어', content: '카드에 있는 내용' }, { comment: '모듈 전용', key: 'x, y', content: '모듈에만 있는 설정' }, { comment: '폴더', mode: 'folder', content: '' }],
    trigger: [{ effect: [{ type: 'triggerlua', code: 'local RUIN_YEAR, RUIN_DAY = 429, 243\nEVENTS = { { id = "E1", day = 3 } }\nlocal x = foo()\n' }] }],
    regex: [{ comment: '상태창' }], assets: [['map', '', 'png']] }, [new Uint8Array([1, 2, 3])]);
  const zip = zipSync(files, { level: 0 });
  const all = new Uint8Array(prefix + zip.length);
  all.fill(0xff, 0, prefix);
  all.set(zip, prefix);
  return new Blob([all]);
}
