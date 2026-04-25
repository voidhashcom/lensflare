import type { ComponentType, SVGProps } from "react";

import { LogoSymbol } from "~/components/Logo";
import { cn } from "~/lib/utils";

import type { LogoId } from "./types";

/**
 * Inline brand marks for the integration picker. Each component is a
 * plain `<svg>` with no external network dependency, so the picker stays
 * usable offline and avoids a flash of un-iconned options on first paint.
 *
 * Marks come from svgl.app where available (Node.js, Effect TS) and from
 * the OpenTelemetry brand pack otherwise. The Lensflare mark reuses the
 * shared {@link LogoSymbol} so it tracks future brand updates
 * automatically.
 *
 * Effect's mark is monochrome and renders with `currentColor` so it
 * picks up the surrounding text color in both themes. Node.js and
 * OpenTelemetry are full-colour and stay vivid on either background.
 */
export type LogoComponent = ComponentType<SVGProps<SVGSVGElement>>;

export function NodeJsLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      viewBox="0 0 256 292"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        <linearGradient id="lf-nodejs-a" x1="68.188%" x2="27.823%" y1="17.487%" y2="89.755%">
          <stop offset="0%" stopColor="#41873F" />
          <stop offset="32.88%" stopColor="#418B3D" />
          <stop offset="63.52%" stopColor="#419637" />
          <stop offset="93.19%" stopColor="#3FA92D" />
          <stop offset="100%" stopColor="#3FAE2A" />
        </linearGradient>
        <linearGradient id="lf-nodejs-c" x1="43.277%" x2="159.245%" y1="55.169%" y2="-18.306%">
          <stop offset="13.76%" stopColor="#41873F" />
          <stop offset="40.32%" stopColor="#54A044" />
          <stop offset="71.36%" stopColor="#66B848" />
          <stop offset="90.81%" stopColor="#6CC04A" />
        </linearGradient>
        <linearGradient id="lf-nodejs-f" x1="-4.389%" x2="101.499%" y1="49.997%" y2="49.997%">
          <stop offset="9.192%" stopColor="#6CC04A" />
          <stop offset="28.64%" stopColor="#66B848" />
          <stop offset="59.68%" stopColor="#54A044" />
          <stop offset="86.24%" stopColor="#41873F" />
        </linearGradient>
        <path
          id="lf-nodejs-b"
          d="M134.923 1.832c-4.344-2.443-9.502-2.443-13.846 0L6.787 67.801C2.443 70.244 0 74.859 0 79.745v132.208c0 4.887 2.715 9.502 6.787 11.945l114.29 65.968c4.344 2.444 9.502 2.444 13.846 0l114.29-65.968c4.344-2.443 6.787-7.058 6.787-11.945V79.745c0-4.886-2.715-9.501-6.787-11.944L134.923 1.832Z"
        />
        <path
          id="lf-nodejs-e"
          d="M134.923 1.832c-4.344-2.443-9.502-2.443-13.846 0L6.787 67.801C2.443 70.244 0 74.859 0 79.745v132.208c0 4.887 2.715 9.502 6.787 11.945l114.29 65.968c4.344 2.444 9.502 2.444 13.846 0l114.29-65.968c4.344-2.443 6.787-7.058 6.787-11.945V79.745c0-4.886-2.715-9.501-6.787-11.944L134.923 1.832Z"
        />
      </defs>
      <path
        d="M134.923 1.832c-4.344-2.443-9.502-2.443-13.846 0L6.787 67.801C2.443 70.244 0 74.859 0 79.745v132.208c0 4.887 2.715 9.502 6.787 11.945l114.29 65.968c4.344 2.444 9.502 2.444 13.846 0l114.29-65.968c4.344-2.443 6.787-7.058 6.787-11.945V79.745c0-4.886-2.715-9.501-6.787-11.944L134.923 1.832Z"
        fill="url(#lf-nodejs-a)"
      />
      <mask id="lf-nodejs-d" fill="#fff">
        <use xlinkHref="#lf-nodejs-b" />
      </mask>
      <path
        d="M249.485 67.8 134.65 1.833c-1.086-.542-2.443-1.085-3.529-1.357L2.443 220.912c1.086 1.357 2.444 2.443 3.8 3.258l114.834 65.968c3.258 1.9 7.059 2.443 10.588 1.357L252.47 70.515c-.815-1.086-1.9-1.9-2.986-2.714Z"
        fill="url(#lf-nodejs-c)"
        mask="url(#lf-nodejs-d)"
      />
      <mask id="lf-nodejs-g" fill="#fff">
        <use xlinkHref="#lf-nodejs-e" />
      </mask>
      <path
        d="M249.756 223.898c3.258-1.9 5.701-5.158 6.787-8.687L130.579.204c-3.258-.543-6.787-.272-9.773 1.628L6.786 67.53l122.979 224.238c1.628-.272 3.529-.815 5.158-1.63l114.833-66.239Z"
        fill="url(#lf-nodejs-f)"
        mask="url(#lf-nodejs-g)"
      />
    </svg>
  );
}

export function EffectLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      fill="none"
      viewBox="0 0 220 220"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        clipRule="evenodd"
        d="M205.593 165.181c3.26-1.836 4.373-5.904 2.493-9.087-1.88-3.18-6.045-4.271-9.304-2.435l-88.946 50.154-88.619-49.968c-3.256-1.836-7.42-.748-9.304 2.435-1.88 3.183-.763 7.251 2.493 9.087l91.766 51.74a6.932 6.932 0 0 0 5.295.632 6.967 6.967 0 0 0 2.364-.815l91.762-51.743Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        clipRule="evenodd"
        d="M214.794 113.73c.283-2.68-1.036-5.4-3.587-6.831l-97.01-54.436a7.326 7.326 0 0 0-2.463-.85 7.342 7.342 0 0 0-5.599.66L9.122 106.71c-2.742 1.54-4.06 4.571-3.492 7.438-.035 2.181.99 4.365 3.525 5.794l97.01 54.699a7.338 7.338 0 0 0 5.602.665 7.27 7.27 0 0 0 2.495-.858l97.014-54.703c2.62-1.477 3.628-3.76 3.518-6.014Zm-20.971-.385-83.828-47.038-83.78 47.013 83.828 47.266 83.78-47.241Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        clipRule="evenodd"
        d="M216.215 72.942c3.62-2.04 4.86-6.557 2.769-10.092-2.088-3.531-6.714-4.743-10.333-2.704l-98.782 55.7-98.414-55.493c-3.62-2.043-8.245-.83-10.333 2.704C-.97 66.588.27 71.11 3.89 73.15L105.8 130.61a7.707 7.707 0 0 0 5.885.698 7.654 7.654 0 0 0 2.621-.901l101.909-57.465Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        d="m18.906 66.546 90.775-55.407 90.774 55.404-90.774 51.717-90.775-51.714Z"
        fill="currentColor"
      />
      <path
        clipRule="evenodd"
        d="M216.095 58.37c3.627 2.036 4.883 6.55 2.807 10.085-2.081 3.531-6.706 4.746-10.333 2.711L109.772 15.73 11.335 70.967c-3.627 2.035-8.253.82-10.333-2.712-2.077-3.535-.82-8.048 2.802-10.084L105.718.987a7.712 7.712 0 0 1 5.881-.694 7.7 7.7 0 0 1 2.587.893l101.909 57.185Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

export function OpenTelemetryLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M135.44 139.918c-10.906 10.905-10.906 28.587 0 39.492c10.907 10.906 28.59 10.906 39.497 0c10.906-10.905 10.906-28.587 0-39.492s-28.59-10.905-39.497 0m29.525 29.548c-5.4 5.4-14.152 5.4-19.553 0s-5.401-14.151 0-19.552s14.152-5.4 19.553 0c5.402 5.375 5.402 14.151 0 19.552M174.47 2.512l-17.112 17.11c-3.35 3.35-3.35 8.855 0 12.204l66.814 66.808c3.35 3.35 8.855 3.35 12.205 0l17.113-17.111c3.35-3.35 3.35-8.854 0-12.203L186.65 2.512c-3.35-3.35-8.83-3.35-12.18 0M54.577 221.162c3.038-3.038 3.038-7.997 0-11.035l-8.699-8.699c-3.038-3.037-7.998-3.037-11.036 0l-17.97 17.968l-.026.026l-4.933-4.933c-2.727-2.727-7.167-2.727-9.868 0c-2.727 2.726-2.727 7.166 0 9.866l29.603 29.6c2.727 2.727 7.167 2.727 9.868 0c2.7-2.726 2.726-7.166 0-9.866l-4.934-4.934l.026-.026z"
        fill="#f5a800"
      />
      <path
        d="M145.1 51.638L107.084 89.65c-3.376 3.375-3.376 8.932 0 12.307l23.474 23.472c16.594-11.943 39.86-10.463 54.792 4.466l19.008-19.006c3.376-3.375 3.376-8.932 0-12.307l-46.95-46.944c-3.375-3.402-8.932-3.402-12.308 0m-24.41 83.684l-13.866-13.865c-3.246-3.246-8.57-3.246-11.815 0l-48.897 48.918c-3.246 3.245-3.246 8.568 0 11.814l27.707 27.704c3.246 3.246 8.57 3.246 11.815 0l31.447-31.495c-6.648-13.736-5.453-30.327 3.61-43.076"
        fill="#425cc7"
      />
    </svg>
  );
}

export function LensflareLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  // Reuses the shared brand symbol so it tracks future brand updates.
  return <LogoSymbol aria-hidden="true" className={cn("size-4 shrink-0", className)} {...props} />;
}

/** Lookup table used by the registry/picker. */
export const INTEGRATION_LOGOS: Record<LogoId, LogoComponent> = {
  nodejs: NodeJsLogo,
  effect: EffectLogo,
  opentelemetry: OpenTelemetryLogo,
  lensflare: LensflareLogo,
};
