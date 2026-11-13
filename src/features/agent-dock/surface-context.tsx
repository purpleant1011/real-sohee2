'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { SurfaceContextState, SurfaceRoute } from './types';

interface SurfaceContextValue {
  context: SurfaceContextState;
  setContextDetails: (details: Partial<Omit<SurfaceContextState, 'route' | 'routeName'>>) => void;
  clearContextDetails: () => void;
  getSurfaceContextPrompt: () => string;
}

const SurfaceContext = createContext<SurfaceContextValue | null>(null);

export function resolveSurfaceRoute(pathname: string): SurfaceRoute {
  if (pathname === '/app' || pathname === '/app/') return 'home';
  if (pathname.startsWith('/app/content')) return 'content';
  if (pathname.startsWith('/app/customers')) return 'customers';
  if (pathname.startsWith('/app/results')) return 'results';
  if (pathname.startsWith('/app/sohee') || pathname.startsWith('/app/campaigns') || pathname.startsWith('/app/plugins')) return 'sohee';
  if (pathname.startsWith('/app/ads')) return 'ads';
  if (pathname.startsWith('/app/system')) return 'system';
  if (pathname.startsWith('/app/missions')) return 'missions';
  return 'unknown';
}

export function getRouteDisplayName(route: SurfaceRoute): string {
  switch (route) {
    case 'home':
      return '홈 워크벤치';
    case 'content':
      return '콘텐츠 센터';
    case 'customers':
      return '고객 인텔리전스';
    case 'results':
      return '성과 분석실';
    case 'sohee':
      return '나의 소희 (설정·지휘·학습)';
    case 'ads':
      return '광고 센터';
    case 'system':
      return '시스템 & 결제 관리';
    case 'missions':
      return '임무 센터';
    default:
      return '소희 서비스';
  }
}

export function SurfaceContextProvider({ children }: { children: React.ReactNode }) {
  let pathname = '/app';
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const path = usePathname();
    if (path) pathname = path;
  } catch {}

  let searchParams: any = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    searchParams = useSearchParams();
  } catch {}

  const tabParam = searchParams?.get('tab') || undefined;

  const [details, setDetails] = useState<Partial<Omit<SurfaceContextState, 'route' | 'routeName'>>>({});

  const routeName = useMemo(() => resolveSurfaceRoute(pathname), [pathname]);

  const routeMissionId = useMemo(() => {
    const match = pathname.match(/^\/app\/missions\/([0-9a-fA-F-]+)/);
    return match ? match[1] : undefined;
  }, [pathname]);

  const context: SurfaceContextState = useMemo(() => {
    const effectiveMissionId = details.missionId || routeMissionId;
    return {
      route: pathname,
      routeName,
      tab: details.tab || tabParam,
      selectedItemId: details.selectedItemId || effectiveMissionId,
      entityType: details.entityType || (effectiveMissionId ? 'mission' : undefined),
      missionId: effectiveMissionId,
      metadata: details.metadata,
    };
  }, [pathname, routeName, tabParam, details, routeMissionId]);

  const setContextDetails = useCallback((newDetails: Partial<Omit<SurfaceContextState, 'route' | 'routeName'>>) => {
    setDetails((prev) => ({ ...prev, ...newDetails }));
  }, []);

  const clearContextDetails = useCallback(() => {
    setDetails({});
  }, []);

  const getSurfaceContextPrompt = useCallback(() => {
    const routeTitle = getRouteDisplayName(context.routeName);
    const parts = [`현재 사장님 화면 위치: ${routeTitle} (${context.route})`];
    if (context.tab) parts.push(`활성 탭: ${context.tab}`);
    if (context.missionId) {
      parts.push(`대상 임무: [mission] ID=${context.missionId}`);
    } else if (context.entityType && context.selectedItemId) {
      parts.push(`선택된 항목: [${context.entityType}] ID=${context.selectedItemId}`);
    }
    return parts.join(', ');
  }, [context]);

  return (
    <SurfaceContext.Provider
      value={{
        context,
        setContextDetails,
        clearContextDetails,
        getSurfaceContextPrompt,
      }}
    >
      {children}
    </SurfaceContext.Provider>
  );
}

export function useSurfaceContext() {
  const ctx = useContext(SurfaceContext);
  if (!ctx) {
    // Graceful fallback if rendered outside provider
    return {
      context: {
        route: '/app',
        routeName: 'home' as SurfaceRoute,
      },
      setContextDetails: () => {},
      clearContextDetails: () => {},
      getSurfaceContextPrompt: () => '현재 사장님 화면 위치: 홈',
    };
  }
  return ctx;
}
