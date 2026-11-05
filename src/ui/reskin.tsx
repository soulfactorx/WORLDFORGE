import { createContext, useContext } from 'react';

/** 장르 용어 바꾸기 (설계 v3 2.2) — 플레이 화면 안의 컴포넌트가 쓴다 */
export const ReskinContext = createContext<(s: string) => string>((s) => s);
export const useRs = () => useContext(ReskinContext);
