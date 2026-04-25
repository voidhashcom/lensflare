import { FlutedGlass } from "@paper-design/shaders-react";
import type { ReactNode } from "react";

/**
 * Hero screenshot section — a fluted-glass shader paints a streaked, ribbed
 * abstract behind a transparent screenshot of the Lensflare desktop app, so
 * the colored texture only peeks through where the app window doesn't reach.
 * Shader params and source assets are taken verbatim from the Paper design
 * (https://app.paper.design/file/01KQ1Z41FR6DQKXAPQ37VXG66J/2-0); the glass
 * source has been resized + JPEG-compressed to keep the asset under 1 MB.
 *
 * The component must be hydrated on the client (the shader is WebGL), so the
 * `index.astro` entry mounts it with `client:load`.
 */
export function AppShowcase(): ReactNode {
  return (
    <section className="w-full border-b border-border">
      <div className="relative mx-auto flex max-w-[1152px] items-start border-x border-border">
        <FlutedGlass
          image="/showcase-glass.jpg"
          size={0.77}
          shape="lines"
          angle={0}
          distortionShape="prism"
          distortion={0.5}
          shift={0}
          blur={0}
          edges={0}
          stretch={0}
          scale={1.19}
          fit="cover"
          highlights={0.1}
          shadows={0.25}
          colorBack="#00000000"
          colorHighlight="#FFFFFF"
          colorShadow="#000000"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        />
        <img
          src="/showcase-app.png"
          alt="Lensflare desktop app showing a telemetry trace with span timeline and event properties"
          width={3024}
          height={2072}
          className="relative w-full"
        />
      </div>
    </section>
  );
}
