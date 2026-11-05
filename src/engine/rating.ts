/**
 * 콘텐츠 등급 (설계 v3 15.1, D6).
 * - 성인 등급(mature): 잔혹하고 노골적인 묘사(폭력·성적 묘사 포함)를 허용한다. 대신 공유 불가.
 * - 어떤 등급에서도 금지: 미성년자(또는 미성년자로 보이는 인물)가 관련된 성적 내용, 실존 인물의 성적 묘사.
 */
import type { WorldPackage } from './schema';

type Rating = WorldPackage['manifest']['contentRating'];

const ALWAYS = '어떤 경우에도 미성년자(또는 미성년자로 보이는 인물)가 관련된 성적 내용과 실존 인물의 성적 묘사는 쓰지 않는다.';

export const RATING_GUIDE: Record<Rating, string> = {
  all: `콘텐츠 등급: 전체 이용가. 폭력·공포는 최소한으로, 피·상처는 자세히 묘사하지 않는다. 성적 내용은 쓰지 않는다. ${ALWAYS}`,
  teen: `콘텐츠 등급: 청소년 이용가. 긴장감 있는 위험과 전투는 묘사하되 잔혹한 장면은 절제한다. 성적 내용은 분위기·암시까지만. ${ALWAYS}`,
  mature: `콘텐츠 등급: 성인 이용가 (성인 사용자가 확인함). 잔혹하고 노골적인 묘사를 허용한다 — 폭력·고어·성적 장면을 장면이 요구하는 만큼 직접적으로 묘사해도 된다. 등장인물은 모두 성인이다. ${ALWAYS}`,
};

/** 공유(패키지·세이브 내보내기)가 막힌 세계: 타인 작품 기반(개인용) 또는 성인 등급 */
export const shareBlocked = (w: Pick<WorldPackage, 'manifest'>) => !!w.manifest.private || w.manifest.contentRating === 'mature';

export const MATURE_NOTE = '성인 등급 세계는 공유할 수 없습니다 (패키지·세이브 내보내기 불가). 내 다른 기기로는 옮길 수 있습니다.';
