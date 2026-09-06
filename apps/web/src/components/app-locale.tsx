import type { ReactNode } from "react";
import {
  DirectionProvider,
  I18nProvider,
  useLocale,
} from "@workspace/ui/components/direction";

export const defaultAppLocale = { locale: "en-US", direction: "ltr" } as const;

/** A deterministic locale, then the official direction adapter (no explicit locale override). */
export function AppLocaleProvider({
  children,
  locale = defaultAppLocale.locale,
  direction = defaultAppLocale.direction,
}: {
  children: ReactNode;
  locale?: string;
  direction?: "ltr" | "rtl";
}) {
  return (
    <I18nProvider locale={locale}>
      <DirectionProvider direction={direction}>{children}</DirectionProvider>
    </I18nProvider>
  );
}

/** Use the same context for document attributes and portaled Aria controls. */
export function useAppLocale() {
  const { locale, direction } = useLocale();
  return { lang: new Intl.Locale(locale).language, dir: direction };
}
